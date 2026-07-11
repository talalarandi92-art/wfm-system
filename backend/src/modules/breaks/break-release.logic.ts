/**
 * Smart Break Management — B3 LIVE RELEASE ENGINE pure logic.
 * Zero I/O. Everything here is unit-testable: risk assessment (§5/§6/§23 with
 * §30 fail-safe stale degradation), fair priority scoring with explainable
 * breakdown (§7/§22), release-mode decisions (§13), anti-cluster live guard
 * (§9), and the delay-escalation ladder (§11).
 */

// ─── Risk engine (§5, §6, §23, §30) ─────────────────────────────────────────

export type RiskLevel = 'green' | 'yellow' | 'orange' | 'red' | 'critical';

const RISK_RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, orange: 2, red: 3, critical: 4 };
const RISK_BY_RANK: RiskLevel[] = ['green', 'yellow', 'orange', 'red', 'critical'];

export const riskAtLeast = (a: RiskLevel, b: RiskLevel): RiskLevel =>
  RISK_RANK[a] >= RISK_RANK[b] ? a : b;

export interface ReleaseThresholds {
  coverage_ratio?: number;          // min fraction of required HC that must stay available (0.7)
  queue_waiting_max?: number;       // total waiting contacts ceiling (50)
  occupancy_max?: number;           // reserved (0.9)
  min_available_hc?: number;        // absolute live floor of available agents after release (3)
  max_simultaneous?: number | null; // per-function cap (null = computed)
  max_simultaneous_per_team?: number; // per team_manager cap (1)
  buffer_hc?: number;               // safety buffer above required (default 1)
  delay_ladder?: number[];          // delay escalation minutes
  priority_weights?: Partial<PriorityWeights>;
}

export const THRESHOLD_DEFAULTS: Required<Pick<ReleaseThresholds,
  'coverage_ratio' | 'queue_waiting_max' | 'occupancy_max' | 'min_available_hc' | 'max_simultaneous_per_team' | 'buffer_hc'>> = {
  coverage_ratio: 0.7,
  queue_waiting_max: 50,
  occupancy_max: 0.9,
  min_available_hc: 3,
  max_simultaneous_per_team: 1,
  buffer_hc: 1,
};

export interface RiskInputs {
  /** required HC for the current 15-min bucket (headcount_intervals) — 0 = unknown/no demand */
  requiredNow: number;
  /** scheduled HC for the current bucket */
  scheduledNow: number;
  /** employees of this function currently on released/active break */
  onBreakNow: number;
  /** live Sprinklr available agents (global), null when no snapshot */
  liveAvailableNow: number | null;
  /** live total waiting contacts across queues */
  queueWaiting: number;
  /** live queues currently at SLA risk */
  atRiskQueueCount: number;
  /** max required HC over the next 30 min (2 buckets) */
  forecastRequiredNext30: number;
  /** min scheduled HC over the next 30 min */
  forecastScheduledNext30: number;
  /** seconds since the live snapshot was captured; null = NO snapshot at all */
  staleSec: number | null;
  thresholds?: ReleaseThresholds | null;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

/**
 * §23 risk ladder + §30 fail-safe. Simulates releasing ONE more employee.
 * FAIL-SAFE: stale snapshot >5min degrades one level minimum; >15min (or no
 * snapshot) enforces an orange floor. NEVER assumes safe on missing data.
 */
export function riskAssess(i: RiskInputs): RiskAssessment {
  const t = { ...THRESHOLD_DEFAULTS, ...(i.thresholds ?? {}) };
  const reasons: string[] = [];
  let level: RiskLevel = 'green';
  const bump = (to: RiskLevel, reason: string) => {
    if (RISK_RANK[to] > RISK_RANK[level]) level = to;
    reasons.push(`[${to}] ${reason}`);
  };

  const availableNow = i.scheduledNow - i.onBreakNow;
  const afterRelease = availableNow - 1;

  // Staffing vs required (schedule spine)
  if (i.requiredNow > 0) {
    const covAfter = afterRelease / i.requiredNow;
    if (covAfter < 0.5) {
      bump('critical', `coverage after release ${(covAfter * 100).toFixed(0)}% < 50% of required (${afterRelease}/${i.requiredNow})`);
    } else if (covAfter < t.coverage_ratio) {
      bump('red', `coverage after release ${(covAfter * 100).toFixed(0)}% < floor ${(t.coverage_ratio * 100).toFixed(0)}%`);
    } else if (afterRelease < i.requiredNow) {
      bump('orange', `release drops below required HC (${afterRelease} < ${i.requiredNow})`);
    } else if (afterRelease - i.requiredNow < t.buffer_hc) {
      bump('yellow', `thin buffer after release (surplus ${afterRelease - i.requiredNow} < buffer ${t.buffer_hc})`);
    }
  }

  // Live queue pressure
  if (i.queueWaiting > t.queue_waiting_max) {
    bump('red', `queue waiting ${i.queueWaiting} > max ${t.queue_waiting_max}`);
  } else if (i.queueWaiting > 0.8 * t.queue_waiting_max) {
    bump('yellow', `queue waiting ${i.queueWaiting} approaching max ${t.queue_waiting_max}`);
  }
  if (i.atRiskQueueCount >= 3) {
    bump('red', `${i.atRiskQueueCount} queues at SLA risk`);
  } else if (i.atRiskQueueCount > 0) {
    bump('orange', `${i.atRiskQueueCount} queue(s) at SLA risk`);
  }

  // Live availability absolute floor (only when the snapshot is usable-fresh)
  if (i.liveAvailableNow != null && i.staleSec != null && i.staleSec <= 300) {
    if (i.liveAvailableNow - 1 < t.min_available_hc) {
      bump('red', `live available ${i.liveAvailableNow} − 1 < floor ${t.min_available_hc}`);
    }
  }

  // Near-term forecast (next 30 min)
  if (i.forecastRequiredNext30 > 0 && i.forecastScheduledNext30 - i.onBreakNow - 1 < i.forecastRequiredNext30) {
    bump('yellow', `forecast next 30min tightens (required ${i.forecastRequiredNext30} vs after-release ${i.forecastScheduledNext30 - i.onBreakNow - 1})`);
  }

  // §30 FAIL-SAFE — stale data can only make things WORSE, never better
  if (i.staleSec == null) {
    bump('orange', 'stale-data: no live snapshot — supervisor-confirm floor');
  } else if (i.staleSec > 900) {
    bump('orange', `stale-data: snapshot ${Math.round(i.staleSec / 60)}min old (>15min) — supervisor-confirm floor`);
  } else if (i.staleSec > 300) {
    const degraded = RISK_BY_RANK[Math.min(RISK_RANK[level] + 1, 4)];
    reasons.push(`[${degraded}] stale-data: snapshot ${Math.round(i.staleSec / 60)}min old (>5min) — degraded one level`);
    level = degraded;
  }

  if (reasons.length === 0) reasons.push('[green] coverage, queues and live availability all within safe thresholds');
  return { level, reasons };
}

/**
 * §6 dynamic break capacity: max simultaneous breaks for a function NOW.
 * = min(policy explicit cap, working − required − buffer). When required is
 * unknown (0) fall back to a conservative fraction of scheduled HC.
 */
export function maxSimultaneousBreaks(
  scheduledNow: number,
  requiredNow: number,
  thresholds?: ReleaseThresholds | null,
): number {
  const t = { ...THRESHOLD_DEFAULTS, ...(thresholds ?? {}) };
  const explicit = Number(t.max_simultaneous);
  let computed: number;
  if (requiredNow > 0) {
    computed = Math.max(0, scheduledNow - requiredNow - t.buffer_hc);
  } else {
    computed = Math.max(1, Math.floor(scheduledNow * (1 - t.coverage_ratio)));
  }
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(0, Math.min(Math.floor(explicit), computed));
  return computed;
}

// ─── Fair priority engine (§7, §22) ─────────────────────────────────────────

export interface PriorityWeights {
  fewer_sessions: number;            // max points for fewest sessions today
  fewer_minutes: number;             // max points, proportional to unused entitlement
  wait_per_min: number;              // points per minute waited past planned
  wait_cap: number;                  // cap on wait points
  longest_work: number;              // max points for longest continuous work among peers
  previously_delayed: number;        // flat bonus if a break today was delayed
  approaching_latest: number;        // max points as latest_start approaches
  approaching_latest_window_min: number;
  shift_ends_sooner: number;         // max points for the soonest-ending shift among peers
  recently_returned_penalty: number; // negative
  recently_returned_window_min: number;
  above_median_sessions_penalty: number; // negative
}

export const PRIORITY_WEIGHT_DEFAULTS: PriorityWeights = {
  fewer_sessions: 20,
  fewer_minutes: 15,
  wait_per_min: 1,
  wait_cap: 25,
  longest_work: 15,
  previously_delayed: 10,
  approaching_latest: 15,
  approaching_latest_window_min: 30,
  shift_ends_sooner: 10,
  recently_returned_penalty: -15,
  recently_returned_window_min: 30,
  above_median_sessions_penalty: -10,
};

/** All *Min fields are absolute minutes on a single timeline (e.g. epoch-minutes). */
export interface PriorityCandidate {
  slotId: string;
  sessionsToday: number;
  maxSessions: number;
  minutesUsedToday: number;
  entitledMinutes: number;
  plannedStartMin: number;
  latestStartMin: number;
  shiftStartMin: number;
  shiftEndMin: number;
  /** end of this employee's last completed break today (abs min), null = none */
  lastBreakEndMin: number | null;
  /** any of this employee's breaks today was delayed */
  wasDelayedToday: boolean;
}

export interface ScoreLine {
  points: number;
  reason: string;
  reasonAr: string;
}

export interface PriorityResult {
  score: number;
  breakdown: ScoreLine[];
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * §7/§22 transparent priority score. Weights configurable via
 * thresholds.priority_weights. Penalties look at TODAY only (no permanent
 * punishment). Every non-zero factor produces an explainable breakdown line.
 */
export function priorityScore(
  c: PriorityCandidate,
  peers: PriorityCandidate[],
  nowMin: number,
  weights?: Partial<PriorityWeights> | null,
): PriorityResult {
  const w = { ...PRIORITY_WEIGHT_DEFAULTS, ...(weights ?? {}) };
  const breakdown: ScoreLine[] = [];
  const add = (points: number, reason: string, reasonAr: string) => {
    const p = Math.round(points * 10) / 10;
    if (p !== 0) breakdown.push({ points: p, reason, reasonAr });
  };

  // 1. Fewer sessions today (proportional to unused sessions)
  const sessFrac = c.maxSessions > 0 ? Math.min(1, c.sessionsToday / c.maxSessions) : 1;
  add(w.fewer_sessions * (1 - sessFrac),
    `Only ${c.sessionsToday} of ${c.maxSessions} break sessions used`,
    `استخدم ${c.sessionsToday} من ${c.maxSessions} جلسات بريك فقط`);

  // 2. Fewer minutes used (proportional to unused entitlement)
  const minFrac = c.entitledMinutes > 0 ? Math.min(1, c.minutesUsedToday / c.entitledMinutes) : 1;
  add(w.fewer_minutes * (1 - minFrac),
    `${c.minutesUsedToday} of ${c.entitledMinutes} break minutes used`,
    `استُخدمت ${c.minutesUsedToday} من ${c.entitledMinutes} دقيقة بريك`);

  // 3. Waited past planned time (+1/min capped)
  const waited = Math.max(0, nowMin - c.plannedStartMin);
  if (waited > 0) {
    add(Math.min(w.wait_cap, waited * w.wait_per_min),
      `Waited ${waited} min past planned break time`,
      `انتظر ${waited} دقيقة بعد الوقت المخطط للبريك`);
  }

  // 4. Longest continuous work since shift start / last break (relative to peers)
  const contOf = (x: PriorityCandidate) =>
    Math.max(0, nowMin - Math.max(x.shiftStartMin, x.lastBreakEndMin ?? x.shiftStartMin));
  const myCont = contOf(c);
  const maxCont = Math.max(myCont, ...peers.map(contOf), 1);
  if (myCont > 0) {
    add(w.longest_work * (myCont / maxCont),
      `${Math.round(myCont / 60 * 10) / 10}h continuous work since last break/shift start`,
      `${Math.round(myCont / 60 * 10) / 10} ساعة عمل متواصل منذ آخر بريك/بداية الشفت`);
  }

  // 5. Previously delayed today
  if (c.wasDelayedToday) {
    add(w.previously_delayed, 'A break today was previously delayed', 'تأجل بريك سابق اليوم');
  }

  // 6. Approaching latest safe start
  const toLatest = c.latestStartMin - nowMin;
  if (toLatest <= w.approaching_latest_window_min) {
    const frac = 1 - Math.max(0, toLatest) / Math.max(1, w.approaching_latest_window_min);
    add(w.approaching_latest * frac,
      toLatest <= 0 ? 'Past latest safe break start' : `Only ${toLatest} min until latest safe start`,
      toLatest <= 0 ? 'تجاوز آخر وقت آمن للبريك' : `بقي ${toLatest} دقيقة فقط على آخر وقت آمن`);
  }

  // 7. Shift ends sooner (relative to peers)
  const ends = [c.shiftEndMin, ...peers.map(p => p.shiftEndMin)];
  const minEnd = Math.min(...ends), maxEnd = Math.max(...ends);
  if (maxEnd > minEnd) {
    const frac = 1 - (c.shiftEndMin - minEnd) / (maxEnd - minEnd);
    add(w.shift_ends_sooner * frac,
      'Shift ends sooner than peers',
      'ينتهي شفته قبل زملائه');
  }

  // 8. Penalty: recently returned from a break (today only)
  if (c.lastBreakEndMin != null) {
    const sinceReturn = nowMin - c.lastBreakEndMin;
    if (sinceReturn >= 0 && sinceReturn < w.recently_returned_window_min) {
      add(w.recently_returned_penalty,
        `Returned from a break only ${sinceReturn} min ago`,
        `عاد من بريك قبل ${sinceReturn} دقيقة فقط`);
    }
  }

  // 9. Penalty: more sessions than the peer median (today only)
  const med = median(peers.map(p => p.sessionsToday));
  if (c.sessionsToday > med) {
    add(w.above_median_sessions_penalty,
      `More sessions today (${c.sessionsToday}) than peer median (${med})`,
      `جلسات اليوم (${c.sessionsToday}) أكثر من وسيط الزملاء (${med})`);
  }

  const score = Math.max(0, Math.round(breakdown.reduce((s, l) => s + l.points, 0)));
  return { score, breakdown };
}

/** Strict release ordering: score desc, tie → earlier planned start, then slotId. */
export function orderCandidates<T extends { score: number; plannedStartMin: number; slotId: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) =>
    b.score - a.score || a.plannedStartMin - b.plannedStartMin || a.slotId.localeCompare(b.slotId));
}

// ─── Release modes (§13) ────────────────────────────────────────────────────

export type ReleaseMode = 'auto' | 'supervisor' | 'hybrid' | 'freeze';
export type ReleaseDecision = 'release' | 'recommend' | 'hold' | 'frozen';

export interface ReleaseFlags {
  inProtectedWindow?: boolean;
  entitlementOverride?: boolean;
}

/**
 * Mode × risk decision matrix:
 *  freeze      → frozen (no releases, emergency)
 *  red/critical→ hold in every non-frozen mode (never release, never recommend-as-safe)
 *  supervisor  → recommend only (never auto-release)
 *  auto        → green/yellow release; orange recommend
 *  hybrid      → like auto, EXCEPT protected-window / entitlement-override /
 *                orange risk → supervisor recommend
 */
export function decideRelease(mode: ReleaseMode, risk: RiskLevel, flags?: ReleaseFlags): ReleaseDecision {
  if (mode === 'freeze') return 'frozen';
  if (risk === 'red' || risk === 'critical') return 'hold';
  if (mode === 'supervisor') return 'recommend';
  const exceptional = !!flags?.inProtectedWindow || !!flags?.entitlementOverride;
  if (mode === 'hybrid' && exceptional) return 'recommend';
  if (risk === 'orange') return 'recommend';
  return 'release';
}

// ─── Anti-cluster live guard (§9) ───────────────────────────────────────────

export interface ClusterState {
  /** released+active breaks in this function right now */
  activeInFunction: number;
  functionCap: number;
  /** released+active breaks under the same team_manager right now (null team = skip) */
  activeInTeam: number | null;
  teamCap: number;
}

export function antiClusterOk(s: ClusterState): { ok: boolean; reason: string | null } {
  if (s.activeInFunction + 1 > s.functionCap) {
    return { ok: false, reason: `function break capacity full (${s.activeInFunction}/${s.functionCap})` };
  }
  if (s.activeInTeam != null && s.activeInTeam + 1 > s.teamCap) {
    return { ok: false, reason: `team already has ${s.activeInTeam} on break (cap ${s.teamCap})` };
  }
  return { ok: true, reason: null };
}

// ─── Delay escalation ladder (§11) ──────────────────────────────────────────

/** Ladder from policy: thresholds.delay_ladder or [10,20,30,max_delay]. */
export function delayLadder(thresholds: ReleaseThresholds | null | undefined, maxDelayMin: number): number[] {
  const raw = thresholds?.delay_ladder;
  if (Array.isArray(raw) && raw.length && raw.every(n => Number.isFinite(Number(n)) && Number(n) > 0)) {
    return [...raw].map(Number).sort((a, b) => a - b);
  }
  const top = Math.max(45, maxDelayMin || 45);
  return [10, 20, 30, top].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
}

/** How many ladder stages a delay has crossed (0 = none). */
export function delayStage(delayMin: number, ladder: number[]): number {
  let stage = 0;
  for (const step of ladder) if (delayMin >= step) stage += 1;
  return stage;
}
