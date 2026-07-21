/* ── RTA INTRADAY CORE (Stage 4A, 2026-07-21) ─────────────────────────────────
 * PURE functions — no Nest, no DB, no clock. Everything the intraday adherence
 * board and the live-ops alert feed compute lives here so it can be proven with
 * fixtures (rta-intraday.core.spec.ts).
 *
 * THE HONESTY CONTRACT (why this file exists):
 *  - "Actual on system" is evidence, not opinion: a scheduled person counts as
 *    on-seat for an interval ONLY if a recon-captured system session covers it.
 *  - A scheduled person with NO system session at all that day is NOT counted as
 *    absent — they are `noEvidence`. They leave the adherence DENOMINATOR, so a
 *    missing feed can never masquerade as 0 % adherence (the same failure mode
 *    the Sprinklr 0-queue → 100 % SLA fix closed on the queue side).
 *  - adherencePct is `null` — never 0 — when nothing is measurable.
 *  - `gap` is the PESSIMISTIC (evidence-only) staffing delta; when the shortfall
 *    could be fully explained by missing evidence the interval is reported
 *    `unknown`, not `short`.
 *
 * Conventions (docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md):
 *  - minutes-of-day 0..1439; a cross-midnight window is stored either wrapped
 *    (end <= start, e.g. MD 1320→420) or canonical (end > 1440). Both accepted.
 *  - Sprinklr times in roster_days are LOCAL Kuwait — the grid is local too, so
 *    no timezone maths happens here.
 */

export const DEFAULT_GRAIN_MIN = 30;
export const DAY_MIN = 1440;

/** A wrap-corrected session longer than this is not a shift, it is data noise
 *  (a logout timestamp that belongs to another day). Such a row yields NO
 *  evidence rather than a 20-hour phantom presence. */
export const MAX_SESSION_MIN = 16 * 60;

/** Credible tardiness band (BR-TRD-001/002, @common/wfm-metrics) mirrored here
 *  for the pure alert derivation — SQL side still uses CRED_LATE/CRED_EARLY. */
export const CRED_MIN = 7;
export const CRED_MAX = 240;

export type Risk = 'ok' | 'watch' | 'at_risk' | 'critical' | 'unknown';
export type CoverageState = 'surplus' | 'met' | 'short' | 'unknown';

/** One roster_days row, reduced to what the intraday grid needs. */
export interface IntradayRow {
  /** the row's OWN work_date (YYYY-MM-DD) — may be the day before the target */
  workDate: string;
  functionName: string;
  personNo: string;
  name?: string | null;
  presence: string | null;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
  sysLoginMin: number | null;
  sysLogoutMin: number | null;
  sysLogin2Min?: number | null;
  sysLogout2Min?: number | null;
  permissionType?: string | null;
}

export interface Win { s: number; e: number }

/** Presence values that mean "the person was actually at work" (office or WFH). */
export const WORKING_PRESENCE = new Set(['office', 'wfh']);
/** Presence values that mean "planned to work but lost to shrinkage". */
export const SHRINKAGE_PRESENCE = new Set(['sick', 'absent', 'leave']);

/** Wrap-correct a window. Returns null when unusable.
 *  end > start  → already canonical (may exceed 1440 for a midnight shift)
 *  end <= start → wrapped over midnight, add a day. */
export function normalizeWindow(start: number | null | undefined, end: number | null | undefined): Win | null {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= DAY_MIN) return null;
  const e = end > start ? end : end + DAY_MIN;
  if (e <= start) return null;
  return { s: start, e };
}

/** Shift a window onto the target day's absolute minute axis (0 = target 00:00).
 *  A row that belongs to the PREVIOUS day contributes only its overnight tail. */
export function shiftWindow(w: Win, dayOffsetMin: number): Win {
  return { s: w.s + dayOffsetMin, e: w.e + dayOffsetMin };
}

export function overlaps(w: Win, from: number, to: number): boolean {
  return w.s < to && w.e > from;
}

/** Day offset for a row relative to the target date: 0 for the day itself,
 *  -1440 for the previous day. Anything else is out of grid. */
export function dayOffset(rowDate: string, targetDate: string): number | null {
  if (rowDate === targetDate) return 0;
  const prev = new Date(`${targetDate}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  if (rowDate === prev.toISOString().slice(0, 10)) return -DAY_MIN;
  return null;
}

export interface RowWindows {
  shift: Win | null;
  sessions: Win[];
  /** the row carries at least one usable system session */
  hasEvidence: boolean;
  /** a session existed but was discarded as implausible (> MAX_SESSION_MIN) */
  suspect: boolean;
}

/** Shift + system-session windows of a row, already placed on the target day's axis. */
export function rowWindows(row: IntradayRow, offsetMin: number): RowWindows {
  const shiftRaw = normalizeWindow(row.shiftStartMin, row.shiftEndMin);
  const shift = shiftRaw ? shiftWindow(shiftRaw, offsetMin) : null;

  const sessions: Win[] = [];
  let suspect = false;
  const pairs: Array<[number | null | undefined, number | null | undefined]> = [
    [row.sysLoginMin, row.sysLogoutMin],
    [row.sysLogin2Min, row.sysLogout2Min],
  ];
  for (const [lo, hi] of pairs) {
    if (lo == null) continue;
    if (hi == null) continue;              // open session → no measurable window
    const w = normalizeWindow(lo, hi);
    if (!w) continue;
    if (w.e - w.s > MAX_SESSION_MIN) { suspect = true; continue; }
    sessions.push(shiftWindow(w, offsetMin));
  }
  return { shift, sessions, hasEvidence: sessions.length > 0, suspect };
}

export interface IntervalCell {
  index: number;
  /** local wall-clock label of the interval start on the target date */
  start: string;
  startMin: number;
  endMin: number;
  /** planned at seat (shift window covers the interval) — includes shrinkage rows */
  scheduled: number;
  /** planned AND provably on the system for this interval */
  scheduledOnSystem: number;
  /** provably on the system (scheduled or not) */
  onSystem: number;
  /** on the system without a shift covering this interval (OT / off-schedule) */
  unscheduledOnSystem: number;
  /** scheduled rows with no usable system session that day — presence unknowable */
  noEvidence: number;
  /** scheduled rows we could actually measure = scheduled − noEvidence */
  measured: number;
  /** scheduled but marked sick / absent / leave */
  shrinkage: number;
  /** scheduled rows carrying an approved permission that day */
  onPermission: number;
  /** scheduledOnSystem / measured, ×100 — null when nothing is measurable */
  adherencePct: number | null;
  /** onSystem − scheduled, evidence-only (pessimistic) */
  gap: number;
  coverageState: CoverageState;
  risk: Risk;
}

export interface FunctionIntraday {
  functionName: string;
  intervals: IntervalCell[];
  summary: {
    peakScheduled: number;
    peakOnSystem: number;
    /** person-interval weighted adherence over the day (null if unmeasurable) */
    adherencePct: number | null;
    measuredCoveragePct: number | null;
    worstGap: number;
    worstInterval: string | null;
    riskIntervals: number;
    criticalIntervals: number;
    unknownIntervals: number;
  };
}

export interface IntradayResult {
  grainMin: number;
  functions: FunctionIntraday[];
  total: FunctionIntraday;
}

/** Risk grade for one interval. Escalation only — a headcount shortfall can
 *  raise the grade the adherence band gave, never lower it. */
export function riskFor(cell: {
  scheduled: number; measured: number; adherencePct: number | null; gap: number; coverageState: CoverageState;
}): Risk {
  if (cell.scheduled === 0) return 'ok';                 // nothing planned → nothing to miss
  if (cell.measured === 0 || cell.adherencePct == null) return 'unknown';
  let r: Risk =
    cell.adherencePct >= 90 ? 'ok'
      : cell.adherencePct >= 80 ? 'watch'
        : cell.adherencePct >= 60 ? 'at_risk'
          : 'critical';
  if (cell.coverageState === 'short') {
    const order: Risk[] = ['ok', 'watch', 'at_risk', 'critical'];
    const bump: Risk = cell.gap <= -5 ? 'critical' : cell.gap <= -3 ? 'at_risk' : 'watch';
    if (order.indexOf(bump) > order.indexOf(r)) r = bump;
  }
  return r;
}

export function coverageStateFor(gap: number, noEvidence: number): CoverageState {
  if (gap > 0) return 'surplus';
  if (gap === 0) return 'met';
  // A shortfall that missing evidence alone could explain is NOT a proven shortfall.
  if (noEvidence > 0 && gap + noEvidence >= 0) return 'unknown';
  return 'short';
}

export function hhmm(min: number): string {
  const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const emptyCell = (index: number, grainMin: number): IntervalCell => ({
  index,
  start: hhmm(index * grainMin),
  startMin: index * grainMin,
  endMin: index * grainMin + grainMin,
  scheduled: 0, scheduledOnSystem: 0, onSystem: 0, unscheduledOnSystem: 0,
  noEvidence: 0, measured: 0, shrinkage: 0, onPermission: 0,
  adherencePct: null, gap: 0, coverageState: 'met', risk: 'ok',
});

function finalizeCell(c: IntervalCell): IntervalCell {
  c.measured = Math.max(0, c.scheduled - c.noEvidence);
  c.adherencePct = c.measured > 0 ? Math.round((c.scheduledOnSystem / c.measured) * 1000) / 10 : null;
  c.gap = c.onSystem - c.scheduled;
  c.coverageState = c.scheduled === 0 && c.onSystem === 0 ? 'met' : coverageStateFor(c.gap, c.noEvidence);
  c.risk = riskFor(c);
  return c;
}

function summarize(functionName: string, intervals: IntervalCell[]): FunctionIntraday {
  let onNum = 0, onDen = 0, schedSum = 0, measuredSum = 0;
  let worstGap = 0, worstInterval: string | null = null;
  let riskIntervals = 0, criticalIntervals = 0, unknownIntervals = 0;
  let peakScheduled = 0, peakOnSystem = 0;
  for (const c of intervals) {
    onNum += c.scheduledOnSystem; onDen += c.measured;
    schedSum += c.scheduled; measuredSum += c.measured;
    peakScheduled = Math.max(peakScheduled, c.scheduled);
    peakOnSystem = Math.max(peakOnSystem, c.onSystem);
    if (c.coverageState === 'short' && c.gap < worstGap) { worstGap = c.gap; worstInterval = c.start; }
    if (c.risk === 'at_risk' || c.risk === 'critical') riskIntervals++;
    if (c.risk === 'critical') criticalIntervals++;
    if (c.risk === 'unknown') unknownIntervals++;
  }
  return {
    functionName,
    intervals,
    summary: {
      peakScheduled, peakOnSystem,
      adherencePct: onDen > 0 ? Math.round((onNum / onDen) * 1000) / 10 : null,
      measuredCoveragePct: schedSum > 0 ? Math.round((measuredSum / schedSum) * 1000) / 10 : null,
      worstGap, worstInterval, riskIntervals, criticalIntervals, unknownIntervals,
    },
  };
}

/**
 * Build the intraday grid for `targetDate` from roster_days rows of that date
 * AND the previous date (a night shift started on D-1 staffs D's early hours —
 * dropping it undercounts the night, the 2026-07-03 cross-midnight bug).
 */
export function buildIntraday(
  rows: IntradayRow[],
  targetDate: string,
  grainMin: number = DEFAULT_GRAIN_MIN,
): IntradayResult {
  const nCells = Math.ceil(DAY_MIN / grainMin);
  const byFn = new Map<string, IntervalCell[]>();
  const totals: IntervalCell[] = Array.from({ length: nCells }, (_, i) => emptyCell(i, grainMin));
  const cellsFor = (fn: string) => {
    if (!byFn.has(fn)) byFn.set(fn, Array.from({ length: nCells }, (_, i) => emptyCell(i, grainMin)));
    return byFn.get(fn)!;
  };

  for (const row of rows) {
    const off = dayOffset(row.workDate, targetDate);
    if (off == null) continue;
    const { shift, sessions, hasEvidence } = rowWindows(row, off);
    if (!shift && !sessions.length) continue;

    const fn = row.functionName || '—';
    const cells = cellsFor(fn);
    const isShrinkage = SHRINKAGE_PRESENCE.has(String(row.presence ?? ''));
    const hasPermission = !!row.permissionType;

    for (let i = 0; i < nCells; i++) {
      const from = i * grainMin, to = from + grainMin;
      const scheduled = !!shift && overlaps(shift, from, to);
      const on = sessions.some(s => overlaps(s, from, to));
      if (!scheduled && !on) continue;
      for (const c of [cells[i], totals[i]]) {
        if (scheduled) {
          c.scheduled++;
          if (isShrinkage) c.shrinkage++;
          if (hasPermission) c.onPermission++;
          if (!hasEvidence) c.noEvidence++;
        }
        if (on) {
          c.onSystem++;
          if (scheduled) c.scheduledOnSystem++;
          else c.unscheduledOnSystem++;
        }
      }
    }
  }

  const functions = [...byFn.entries()]
    .map(([fn, cells]) => summarize(fn, cells.map(finalizeCell)))
    .filter(f => f.summary.peakScheduled > 0 || f.summary.peakOnSystem > 0)
    .sort((a, b) => b.summary.peakScheduled - a.summary.peakScheduled || a.functionName.localeCompare(b.functionName));

  return { grainMin, functions, total: summarize('ALL', totals.map(finalizeCell)) };
}

/* ══ ALERTS ═══════════════════════════════════════════════════════════════════
 * Derived from REAL captured state only. No LLM, no heuristic "predictions" —
 * every alert names the metric and the as-of moment it was computed from.
 */

export type Severity = 'critical' | 'warning' | 'info';

export interface RtaAlert {
  id: string;
  severity: Severity;
  type: string;
  text_en: string;
  text_ar: string;
  metric: Record<string, any>;
  source: string;
  asOf: string | null;
}

/** A run of consecutive at-risk/critical intervals in one function, already
 *  merged so the feed says "13:00–14:30" once instead of three times. */
export interface GapWindow {
  functionName: string;
  start: string;
  /** exclusive end label; equals `start` when a single interval */
  end: string;
  spanIntervals: number;
  risk: Risk;
  scheduled: number;
  onSystem: number;
  adherencePct: number | null;
  gap: number;
}

/** Merge consecutive interval cells of one function into gap windows, keeping
 *  the WORST cell's numbers for the window (never an average that softens it). */
export function mergeGapWindows(
  functionName: string,
  cells: Array<{ index: number; start: string; endMin: number; risk: Risk; scheduled: number; onSystem: number; adherencePct: number | null; gap: number }>,
): GapWindow[] {
  const flagged = cells.filter(c => c.risk === 'at_risk' || c.risk === 'critical').sort((a, b) => a.index - b.index);
  const out: GapWindow[] = [];
  let run: typeof flagged = [];
  const flush = () => {
    if (!run.length) return;
    const worst = run.reduce((w, c) => (c.gap < w.gap || (c.gap === w.gap && (c.adherencePct ?? 101) < (w.adherencePct ?? 101)) ? c : w), run[0]);
    out.push({
      functionName,
      start: run[0].start,
      end: hhmm(run[run.length - 1].endMin),
      spanIntervals: run.length,
      risk: run.some(c => c.risk === 'critical') ? 'critical' : 'at_risk',
      scheduled: worst.scheduled, onSystem: worst.onSystem, adherencePct: worst.adherencePct, gap: worst.gap,
    });
    run = [];
  };
  for (const c of flagged) {
    if (run.length && c.index !== run[run.length - 1].index + 1) flush();
    run.push(c);
  }
  flush();
  return out;
}

export interface AlertInput {
  today: string;
  /** Sprinklr bridge state — null when no snapshot has ever arrived */
  feed: {
    hasSnapshot: boolean;
    capturedAt: string | null;
    staleSec: number | null;
    isStale: boolean;
    queueFeedMissing: boolean;
    queueCount: number;
    agentCount: number;
    knownStatusAgents: number;
  } | null;
  /** canonical reconciled roster freshness */
  roster: { maxDate: string | null; ageDays: number | null; resolvedDate: string | null };
  /** headcount_intervals live overlay freshness (written by the Sprinklr bridge) */
  liveCoverage: { lastUpdatedAt: string | null; ageMin: number | null; snapshotDate: string | null } | null;
  /** agent_daily_stats — what enriches the live agent board */
  agentStats: { maxStatDate: string | null; ageDays: number | null } | null;
  /** worst intraday windows (from buildIntraday; consecutive intervals merged) on `date` */
  intraday: {
    date: string | null;
    worst: GapWindow[];
    unknownIntervals: number;
  };
  /** attendance exceptions on the resolved roster date */
  tardiness: {
    date: string | null;
    lateLogins: number; earlyLogouts: number; missingSystem: number; workingHeadcount: number;
  } | null;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Human "N days ago" phrasing that never claims data is from today. */
export function asOfPhrase(date: string | null, ageDays: number | null, ar: boolean): string {
  if (!date) return ar ? 'لا توجد بيانات' : 'no data';
  if (ageDays === 0) return ar ? 'اليوم' : 'today';
  if (ageDays === 1) return ar ? 'أمس' : 'yesterday';
  return ar ? `${date} (متأخر ${ageDays} يوم)` : `${date} (${ageDays} days old)`;
}

export function deriveAlerts(input: AlertInput): RtaAlert[] {
  const out: RtaAlert[] = [];
  const push = (a: RtaAlert) => out.push(a);

  // ── 1. Sprinklr bridge health ───────────────────────────────────────────────
  const f = input.feed;
  if (!f || !f.hasSnapshot) {
    push({
      id: 'feed.absent', severity: 'critical', type: 'feed_absent',
      text_en: 'No Sprinklr snapshot has been received — the live agent/queue board is not live.',
      text_ar: 'لم يتم استلام أي لقطة من Sprinklr — لوحة الوكلاء/الطوابير غير مباشرة.',
      metric: { hasSnapshot: false },
      source: 'sprinklr-bridge', asOf: null,
    });
  } else {
    const mins = f.staleSec != null ? Math.round(f.staleSec / 60) : null;
    if (f.isStale) {
      push({
        id: 'feed.stale', severity: mins != null && mins >= 60 ? 'critical' : 'warning', type: 'feed_stale',
        text_en: `Sprinklr snapshot is ${mins != null ? `${mins} min` : 'over 2 min'} old — live figures are not current.`,
        text_ar: `آخر لقطة من Sprinklr عمرها ${mins != null ? `${mins} دقيقة` : 'أكثر من دقيقتين'} — الأرقام المباشرة ليست محدّثة.`,
        metric: { staleSec: f.staleSec, staleMin: mins, capturedAt: f.capturedAt },
        source: 'sprinklr-bridge', asOf: f.capturedAt,
      });
    }
    if (f.queueFeedMissing) {
      push({
        id: 'feed.queue_blind', severity: 'critical', type: 'queue_feed_missing',
        text_en: `Queue feed missing: ${f.agentCount} agents captured but 0 queues — SLA, waiting and at-risk queues are UNKNOWN (not zero).`,
        text_ar: `تغذية الطوابير مفقودة: تم التقاط ${f.agentCount} وكيلًا و0 طابور — مستوى الخدمة والانتظار غير معروف (وليس صفرًا).`,
        metric: { queueCount: f.queueCount, agentCount: f.agentCount },
        source: 'sprinklr-bridge', asOf: f.capturedAt,
      });
    }
    if (f.agentCount > 0 && f.knownStatusAgents === 0) {
      push({
        id: 'feed.status_blind', severity: 'critical', type: 'agent_status_blind',
        text_en: `Agent statuses are blind: all ${f.agentCount} captured agents report an unknown status — the live board cannot say who is logged in.`,
        text_ar: `حالات الوكلاء غير مرئية: جميع الوكلاء (${f.agentCount}) بحالة غير معروفة — لا يمكن تحديد من هو متصل.`,
        metric: { agentCount: f.agentCount, knownStatusAgents: 0 },
        source: 'sprinklr-bridge', asOf: f.capturedAt,
      });
    } else if (f.agentCount > 0 && f.knownStatusAgents < f.agentCount / 2) {
      push({
        id: 'feed.status_partial', severity: 'warning', type: 'agent_status_partial',
        text_en: `Only ${f.knownStatusAgents} of ${f.agentCount} captured agents have a known status — live headcount is a floor, not the truth.`,
        text_ar: `${f.knownStatusAgents} فقط من أصل ${f.agentCount} وكيل لديهم حالة معروفة — العدد المباشر هو حد أدنى وليس الحقيقة.`,
        metric: { agentCount: f.agentCount, knownStatusAgents: f.knownStatusAgents },
        source: 'sprinklr-bridge', asOf: f.capturedAt,
      });
    }
  }

  // ── 2. Live coverage overlay (headcount_intervals.live_hc) ──────────────────
  const lc = input.liveCoverage;
  if (lc && (lc.lastUpdatedAt == null || (lc.ageMin != null && lc.ageMin > 5))) {
    push({
      id: 'coverage.live_stale', severity: 'warning', type: 'live_coverage_stale',
      text_en: lc.lastUpdatedAt
        ? `Live coverage overlay last updated ${lc.ageMin} min ago — live HC on the coverage grid is stale, not 0.`
        : 'Live coverage overlay has never been written — the coverage grid shows plan only.',
      text_ar: lc.lastUpdatedAt
        ? `آخر تحديث لطبقة التغطية المباشرة قبل ${lc.ageMin} دقيقة — العدد المباشر قديم وليس صفرًا.`
        : 'لم تُكتب طبقة التغطية المباشرة إطلاقًا — الشبكة تعرض الخطة فقط.',
      metric: { lastUpdatedAt: lc.lastUpdatedAt, ageMin: lc.ageMin, snapshotDate: lc.snapshotDate },
      source: 'headcount_intervals', asOf: lc.lastUpdatedAt,
    });
  }

  // ── 3. Reconciled roster freshness (the adherence truth source) ─────────────
  const r = input.roster;
  if (!r.maxDate) {
    push({
      id: 'roster.absent', severity: 'critical', type: 'roster_absent',
      text_en: 'No reconciled roster data exists — intraday adherence cannot be computed.',
      text_ar: 'لا توجد بيانات روستر مطابَقة — لا يمكن حساب الالتزام خلال اليوم.',
      metric: {}, source: 'roster_days', asOf: null,
    });
  } else if ((r.ageDays ?? 0) >= 1) {
    push({
      id: 'roster.stale', severity: (r.ageDays ?? 0) >= 3 ? 'warning' : 'info', type: 'roster_stale',
      text_en: `Reconciled roster is ${r.ageDays} day(s) behind (latest ${r.maxDate}) — intraday adherence is reported for that date, not today.`,
      text_ar: `الروستر المطابَق متأخر ${r.ageDays} يوم (آخر تاريخ ${r.maxDate}) — يُعرض الالتزام لذلك التاريخ وليس لليوم.`,
      metric: { maxDate: r.maxDate, ageDays: r.ageDays, today: input.today },
      source: 'roster_days', asOf: r.maxDate,
    });
  }

  // ── 4. Agent-board enrichment freshness ─────────────────────────────────────
  const st = input.agentStats;
  if (st && st.maxStatDate && (st.ageDays ?? 0) >= 1) {
    push({
      id: 'agentboard.stats_stale', severity: (st.ageDays ?? 0) >= 3 ? 'warning' : 'info', type: 'agent_stats_stale',
      text_en: `Live agent-board stats (contacts / AHT / adherence) come from ${asOfPhrase(st.maxStatDate, st.ageDays, false)} — they are not today's numbers.`,
      text_ar: `إحصاءات لوحة الوكلاء (المحادثات / متوسط المعالجة / الالتزام) مصدرها ${asOfPhrase(st.maxStatDate, st.ageDays, true)} — ليست أرقام اليوم.`,
      metric: { maxStatDate: st.maxStatDate, ageDays: st.ageDays },
      source: 'agent_daily_stats', asOf: st.maxStatDate,
    });
  }

  // ── 5. Intraday staffing gaps (from the interval grid above) ────────────────
  for (const w of input.intraday.worst) {
    const span = w.spanIntervals > 1 ? `${w.start}–${w.end}` : w.start;
    push({
      id: `intraday.gap.${w.functionName}.${w.start}`,
      severity: w.risk === 'critical' ? 'critical' : 'warning',
      type: 'intraday_staffing_gap',
      text_en: `${w.functionName} ${w.spanIntervals > 1 ? `from ${span}` : `at ${span}`}: worst ${w.onSystem} on system vs ${w.scheduled} scheduled (${w.gap}), adherence ${w.adherencePct ?? '—'}%.`,
      text_ar: `${w.functionName} ${w.spanIntervals > 1 ? `من ${span}` : `الساعة ${span}`}: الأسوأ ${w.onSystem} متصل مقابل ${w.scheduled} مجدول (${w.gap})، الالتزام ${w.adherencePct ?? '—'}%.`,
      metric: {
        functionName: w.functionName, interval: w.start, until: w.end, spanIntervals: w.spanIntervals,
        scheduled: w.scheduled, onSystem: w.onSystem, gap: w.gap, adherencePct: w.adherencePct, risk: w.risk,
      },
      source: 'roster_days:intraday', asOf: input.intraday.date,
    });
  }
  if (input.intraday.unknownIntervals > 0) {
    push({
      id: 'intraday.unknown', severity: 'info', type: 'intraday_unmeasurable',
      text_en: `${input.intraday.unknownIntervals} function-interval(s) have scheduled staff but no system evidence — adherence there is unknown, not 0%.`,
      text_ar: `${input.intraday.unknownIntervals} فترة/وظيفة بها موظفون مجدولون بلا دليل نظام — الالتزام غير معروف وليس 0%.`,
      metric: { unknownIntervals: input.intraday.unknownIntervals },
      source: 'roster_days:intraday', asOf: input.intraday.date,
    });
  }

  // ── 6. Attendance exceptions on the resolved date ───────────────────────────
  const t = input.tardiness;
  if (t && t.date) {
    if (t.lateLogins > 0) {
      const pct = t.workingHeadcount > 0 ? Math.round((t.lateLogins / t.workingHeadcount) * 100) : null;
      push({
        id: 'attendance.late', severity: pct != null && pct >= 25 ? 'warning' : 'info', type: 'late_logins',
        text_en: `${t.lateLogins} late system login(s)${pct != null ? ` (${pct}% of ${t.workingHeadcount} working)` : ''} on ${t.date}.`,
        text_ar: `${t.lateLogins} تسجيل دخول متأخر${pct != null ? ` (${pct}% من ${t.workingHeadcount} على رأس العمل)` : ''} بتاريخ ${t.date}.`,
        metric: { lateLogins: t.lateLogins, workingHeadcount: t.workingHeadcount, pct, band: `${CRED_MIN}-${CRED_MAX} min` },
        source: 'roster_days', asOf: t.date,
      });
    }
    if (t.earlyLogouts > 0) {
      const pct = t.workingHeadcount > 0 ? Math.round((t.earlyLogouts / t.workingHeadcount) * 100) : null;
      push({
        id: 'attendance.early', severity: pct != null && pct >= 25 ? 'warning' : 'info', type: 'early_logouts',
        text_en: `${t.earlyLogouts} early system logout(s)${pct != null ? ` (${pct}% of ${t.workingHeadcount} working)` : ''} on ${t.date}.`,
        text_ar: `${t.earlyLogouts} تسجيل خروج مبكر${pct != null ? ` (${pct}% من ${t.workingHeadcount} على رأس العمل)` : ''} بتاريخ ${t.date}.`,
        metric: { earlyLogouts: t.earlyLogouts, workingHeadcount: t.workingHeadcount, pct, band: `${CRED_MIN}-${CRED_MAX} min` },
        source: 'roster_days', asOf: t.date,
      });
    }
    if (t.missingSystem > 0) {
      push({
        id: 'attendance.missing_system', severity: 'info', type: 'missing_system_login',
        text_en: `${t.missingSystem} working row(s) on ${t.date} have no system session — those people are excluded from adherence, not counted absent.`,
        text_ar: `${t.missingSystem} سجل عمل بتاريخ ${t.date} بلا جلسة نظام — يُستبعدون من حساب الالتزام ولا يُحتسبون غيابًا.`,
        metric: { missingSystem: t.missingSystem, workingHeadcount: t.workingHeadcount },
        source: 'roster_days', asOf: t.date,
      });
    }
  }

  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.id.localeCompare(b.id));
}
