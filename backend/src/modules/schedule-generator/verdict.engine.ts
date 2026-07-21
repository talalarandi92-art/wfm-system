/**
 * VERDICT / QUALITY ANALYSIS LAYER (Stage 2A, 2026-07-20) — the layer that makes a
 * schedule SELL itself: verdicts, fairness, coverage explainability.
 *
 * Two consumers, ONE set of definitions:
 *   • buildGenerateVerdict — enriches a generate-demand PREVIEW with a complete,
 *     UI-ready `verdict` block (coverage per day/function, fairness, rule-compliance
 *     counters, unfilled-with-reasons). SELF-VERIFYING: every compliance counter is
 *     RECOUNTED from the final grid — never echoed from the engine that produced it.
 *   • scoreScheduleQuality — grades an EXISTING saved/published window from
 *     canonical roster_days rows the same way (coverage vs observed baseline,
 *     fairness, rule compliance, shift-mix), so the Director can grade last week's
 *     schedule, not just a fresh generate.
 *
 * Pure functions, no DB. Fairness is NOT re-derived — both paths call the classic
 * engine's calcFairness (generator.engine.ts) via fairnessFromDistributions.
 */

import {
  SHIFTS,
  ShiftDef,
  ShiftDistribution,
  FairnessReport,
  EmployeeSchedule,
  EmployeeInfo,
} from './generator.types';
import { calcRestHours, calcFairness } from './generator.engine';

// SHIFTS is keyed by catalog KEY (N2 for EE) — resolve by shift CODE.
const SHIFT_BY_CODE: Record<string, ShiftDef> =
  Object.fromEntries(Object.values(SHIFTS).map((s) => [s.code, s]));

/** Codes a female must NEVER carry (rule 6.4): E/EE end past midnight, MD/MN are midnight. */
const FEMALE_BLOCKED = /^(E|EE|MD|MN)$/;
/** The warn-tier late shift — allowed for females only by operational necessity. */
const FEMALE_WARN = /^N$/;
const NON_WORK = new Set(['OFF', 'L']);

const isFemale = (g: string | null | undefined) =>
  String(g ?? '').toLowerCase().startsWith('f');

function emptyDist(): ShiftDistribution {
  return {
    morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0,
    off: 0, leave: 0, total: 0, byCodes: {},
    weekendOff: 0, weekendWork: 0, maxConsecutive: 0,
  };
}

/**
 * REUSE bridge: run the classic engine's calcFairness (the ONE fairness scoring)
 * over plain {person, distribution} pairs — no schedule objects required.
 */
export function fairnessFromDistributions(
  people: { id: string; name: string; gender: string }[],
  dist: Map<string, ShiftDistribution>,
): FairnessReport {
  const schedules: EmployeeSchedule[] = people.map((p) => ({
    employee: {
      id: p.id, employeeNo: '', name: p.name,
      gender: (isFemale(p.gender) ? 'female' : 'male') as EmployeeInfo['gender'],
      employmentType: '', functionId: '', functionName: '',
    },
    ytdDist: dist.get(p.id) ?? emptyDist(),
    assignments: [],
    weekStats: {
      morningCount: 0, afternoonCount: 0, eveningCount: 0,
      nightCount: 0, midnightCount: 0, offCount: 0, violationCount: 0,
    },
  }));
  return calcFairness(schedules);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  1. GENERATE VERDICT — the UI-ready block attached to generate-demand
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface VerdictGridRow {
  employeeId?: string;
  employeeNo?: string;
  name: string;
  gender: string;
  functionName: string;
  days: Record<string, string>;   // date → shift code / OFF / L
}

export interface VerdictDemandDay {
  date: string;
  requiredCurve: number[];        // 48 × 30-min required HC
  staffedCurve: number[];         // 48 × 30-min staffed HC
  residualGaps: { interval: string; deficit: number; functionName?: string }[];
  riskStatus?: string;            // safe | warning | critical
  perFunction?: {
    functionName: string;
    requiredPeak: number;
    staffedPeak: number;
    mix: Record<string, number>;
    residualGaps: number;
  }[] | null;
}

export interface GenerateVerdictInput {
  dates: string[];
  grid: VerdictGridRow[];
  days: VerdictDemandDay[];
  unfilled: { date: string; code: string; reason: string; functionName?: string }[];
  warnings: string[];
  offDaysPerWeek: number;
  minRestHours: number;
  maxConsecutive?: number;        // engine default 6
  fairness: FairnessReport;       // from fairnessFromDistributions (calcFairness reuse)
}

export interface RuleCompliance {
  femaleNightViolations: number;      // females on E/EE/MD/MN — must be 0
  femaleNightViolationSamples: string[];
  femaleLateAssignments: number;      // females on N (warn tier — supervisor approval)
  restViolations: number;             // adjacent-day rest < minRestHours
  restViolationSamples: string[];
  minRestHours: number;
  offTarget: number;                  // expected OFF per person for the window
  offPerWeekOk: boolean;
  offDistribution: Record<string, number>;  // "<n> OFF" → people
  offOutliers: string[];              // people off-target WITHOUT leave explaining it
  maxConsecutiveDays: number;
  consecutiveLimit: number;
  consecutiveOk: boolean;
  basis: string;
}

export interface GenerateVerdict {
  status: 'ready' | 'review' | 'critical';
  score: number;                      // 0-100 composite
  headlineEn: string;
  headlineAr: string;
  scoreParts: { coveragePct: number; fairnessScore: number; complianceScore: number };
  coverage: {
    totals: {
      requiredHours: number;          // person-hours of demand across the window
      staffedHours: number;
      coveredHours: number;           // min(staffed, required) — what demand was met
      surplusHours: number;
      coveragePct: number;            // covered / required
      residualGapIntervals: number;
      criticalDays: number;
      warningDays: number;
      safeDays: number;
    };
    perDay: {
      date: string;
      riskStatus: string;
      requiredHours: number;
      staffedHours: number;
      coveragePct: number;
      requiredPeak: number;
      staffedPeak: number;
      gapIntervals: number;
      functions: { functionName: string; required: number; staffed: number; gap: number; gapIntervals: number }[];
    }[];
  };
  fairness: FairnessReport & {
    basis: string;
    thisWeek: {
      night: { shifts: number; people: number; maxPerPerson: number };
      midnight: { shifts: number; people: number; maxPerPerson: number; eligibleMales: number };
    };
  };
  ruleCompliance: RuleCompliance;
  unfilled: {
    total: number;
    byReason: Record<string, number>;
    byFunction: Record<string, number>;
    items: { date: string; code: string; reason: string; functionName?: string }[];
  };
  unscheduled: { people: number; byFunction: Record<string, number> };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Recount rule compliance from a final code grid — the self-verifying core. */
export function recountCompliance(
  grid: VerdictGridRow[],
  dates: string[],
  opts: { minRestHours: number; offDaysPerWeek: number; maxConsecutive?: number },
): RuleCompliance {
  const limit = opts.maxConsecutive ?? 6;
  let femaleViol = 0; const femaleSamples: string[] = [];
  let femaleLate = 0;
  let restViol = 0; const restSamples: string[] = [];
  const offDistribution: Record<string, number> = {};
  const offOutliers: string[] = [];
  let maxConsec = 0;
  // Window may span multiple weeks — OFF target scales with full weeks.
  const offTarget = Math.round(opts.offDaysPerWeek * dates.length / 7);
  let offOk = true;

  for (const row of grid) {
    const codes = dates.map((d) => row.days[d]).filter((c): c is string => !!c);
    if (!codes.length) continue;    // unscheduled row (no forecast basis) — reported separately

    // Gender rules — recounted from the actual codes
    if (isFemale(row.gender)) {
      for (let i = 0; i < codes.length; i++) {
        if (FEMALE_BLOCKED.test(codes[i])) {
          femaleViol++;
          if (femaleSamples.length < 5) femaleSamples.push(`${row.name} ${dates[i]} ${codes[i]}`);
        } else if (FEMALE_WARN.test(codes[i])) {
          femaleLate++;
        }
      }
    }

    // Rest rule — adjacent days via the canonical catalog windows
    for (let i = 1; i < codes.length; i++) {
      const prev = SHIFT_BY_CODE[codes[i - 1]];
      const next = SHIFT_BY_CODE[codes[i]];
      if (!prev || !next || NON_WORK.has(prev.code) || NON_WORK.has(next.code)) continue;
      const rest = calcRestHours(prev, next);
      if (rest < opts.minRestHours) {
        restViol++;
        if (restSamples.length < 5) {
          restSamples.push(`${row.name} ${dates[i]} ${prev.code}→${next.code} (${r1(rest)}h)`);
        }
      }
    }

    // OFF allowance — exact target unless approved leave explains the shortfall
    const offs = codes.filter((c) => c === 'OFF').length;
    const leaves = codes.filter((c) => c === 'L').length;
    const key = `${offs} OFF`;
    offDistribution[key] = (offDistribution[key] ?? 0) + 1;
    const explained = offs === offTarget || (offs < offTarget && leaves > 0);
    if (!explained) {
      offOk = false;
      if (offOutliers.length < 8) offOutliers.push(`${row.name}: ${offs} OFF (${leaves} L)`);
    }

    // Consecutive working days (in-window)
    let run = 0;
    for (const c of codes) {
      if (NON_WORK.has(c)) { run = 0; continue; }
      run++;
      if (run > maxConsec) maxConsec = run;
    }
  }

  return {
    femaleNightViolations: femaleViol,
    femaleNightViolationSamples: femaleSamples,
    femaleLateAssignments: femaleLate,
    restViolations: restViol,
    restViolationSamples: restSamples,
    minRestHours: opts.minRestHours,
    offTarget,
    offPerWeekOk: offOk,
    offDistribution,
    offOutliers,
    maxConsecutiveDays: maxConsec,
    consecutiveLimit: limit,
    consecutiveOk: maxConsec <= limit,
    basis: `recounted from the final grid (self-verifying — catalog shift windows, min rest ${opts.minRestHours}h, ` +
      `${opts.offDaysPerWeek} OFF/week, ≤${limit} consecutive days); never echoed from the engine`,
  };
}

export function buildGenerateVerdict(input: GenerateVerdictInput): GenerateVerdict {
  const { dates, grid, days, unfilled, offDaysPerWeek, minRestHours, fairness } = input;

  // ── Coverage from the demand/staffed curves (30-min slots → person-hours) ──
  let requiredH = 0, staffedH = 0, coveredH = 0, surplusH = 0, residual = 0;
  const perDay = days.map((d) => {
    const req = d.requiredCurve.reduce((s, x) => s + x, 0) / 2;
    const stf = d.staffedCurve.reduce((s, x) => s + x, 0) / 2;
    const cov = d.requiredCurve.reduce((s, x, i) => s + Math.min(x, d.staffedCurve[i] ?? 0), 0) / 2;
    const sur = d.requiredCurve.reduce((s, x, i) => s + Math.max(0, (d.staffedCurve[i] ?? 0) - x), 0) / 2;
    requiredH += req; staffedH += stf; coveredH += cov; surplusH += sur;
    residual += d.residualGaps.length;
    return {
      date: d.date,
      riskStatus: d.riskStatus ?? 'unknown',
      requiredHours: r1(req),
      staffedHours: r1(stf),
      coveragePct: req > 0 ? r1((cov / req) * 100) : 100,
      requiredPeak: Math.max(0, ...d.requiredCurve),
      staffedPeak: Math.max(0, ...d.staffedCurve),
      gapIntervals: d.residualGaps.length,
      functions: (d.perFunction ?? []).map((f) => ({
        functionName: f.functionName,
        required: f.requiredPeak,
        staffed: f.staffedPeak,
        gap: r1(f.staffedPeak - f.requiredPeak),   // negative = gap, positive = surplus
        gapIntervals: f.residualGaps,
      })),
    };
  });
  const coveragePct = requiredH > 0 ? r1((coveredH / requiredH) * 100) : 100;

  // ── Rule compliance — recounted from the grid, not trusted from the engine ──
  const ruleCompliance = recountCompliance(grid, dates, {
    minRestHours, offDaysPerWeek, maxConsecutive: input.maxConsecutive,
  });

  // ── This week's hard-shift distribution (who actually carries night/midnight) ──
  const nightBy = new Map<string, number>();
  const midBy = new Map<string, number>();
  let eligibleMales = 0;
  for (const row of grid) {
    const codes = Object.values(row.days ?? {});
    if (!codes.length) continue;
    if (!isFemale(row.gender)) eligibleMales++;
    const n = codes.filter((c) => /^N$/.test(c)).length;
    const m = codes.filter((c) => /^(MD|MN)$/.test(c)).length;
    if (n) nightBy.set(row.name, n);
    if (m) midBy.set(row.name, m);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, x) => s + x, 0);
  const max = (m: Map<string, number>) => Math.max(0, ...m.values());

  // ── Unfilled with reasons + unscheduled functions (honest disclosure) ──
  const byReason: Record<string, number> = {};
  const byFn: Record<string, number> = {};
  for (const u of unfilled) {
    byReason[u.reason] = (byReason[u.reason] ?? 0) + 1;
    const k = u.functionName ?? '(pool)';
    byFn[k] = (byFn[k] ?? 0) + 1;
  }
  const unschedFn: Record<string, number> = {};
  let unscheduledPeople = 0;
  for (const row of grid) {
    if (Object.keys(row.days ?? {}).length === 0) {
      unscheduledPeople++;
      unschedFn[row.functionName] = (unschedFn[row.functionName] ?? 0) + 1;
    }
  }

  // ── Composite score + status ──
  let complianceScore = 100;
  if (ruleCompliance.femaleNightViolations > 0) complianceScore -= 40;
  if (ruleCompliance.restViolations > 0) complianceScore -= 30;
  if (!ruleCompliance.offPerWeekOk) complianceScore -= 20;
  if (!ruleCompliance.consecutiveOk) complianceScore -= 10;
  complianceScore = Math.max(0, complianceScore);
  const fairnessScore = fairness.score ?? 0;
  const score = Math.round(0.5 * coveragePct + 0.3 * fairnessScore + 0.2 * complianceScore);

  const criticalDays = perDay.filter((d) => d.riskStatus === 'critical').length;
  const warningDays = perDay.filter((d) => d.riskStatus === 'warning').length;
  const safeDays = perDay.filter((d) => d.riskStatus === 'safe').length;
  const hardBreach = ruleCompliance.femaleNightViolations > 0 || ruleCompliance.restViolations > 0;
  const status: GenerateVerdict['status'] =
    hardBreach || coveragePct < 70 ? 'critical'
      : criticalDays > 0 || unfilled.length > 0 || coveragePct < 95 || !ruleCompliance.offPerWeekOk ? 'review'
        : 'ready';

  const headlineEn = hardBreach
    ? `RULE BREACH — ${ruleCompliance.femaleNightViolations} female-night, ${ruleCompliance.restViolations} rest violation(s); do not publish as-is`
    : status === 'review'
      ? `Coverage ${coveragePct}% of demand · ${unfilled.length} unfilled slot(s) · ${criticalDays} critical day(s) — review the gaps, rules all hold`
      : `Ready — ${coveragePct}% coverage, rules clean, fairness ${fairnessScore}`;
  const headlineAr = hardBreach
    ? `خرق قاعدة — ${ruleCompliance.femaleNightViolations} ليلي للإناث و${ruleCompliance.restViolations} خرق راحة؛ لا تنشر كما هو`
    : status === 'review'
      ? `تغطية ${coveragePct}% من الطلب · ${unfilled.length} خانة غير مغطاة · ${criticalDays} يوم حرج — راجع الفجوات، القواعد كلها سليمة`
      : `جاهز — تغطية ${coveragePct}%، القواعد سليمة، العدالة ${fairnessScore}`;

  return {
    status,
    score,
    headlineEn,
    headlineAr,
    scoreParts: { coveragePct, fairnessScore, complianceScore },
    coverage: {
      totals: {
        requiredHours: r1(requiredH),
        staffedHours: r1(staffedH),
        coveredHours: r1(coveredH),
        surplusHours: r1(surplusH),
        coveragePct,
        residualGapIntervals: residual,
        criticalDays, warningDays, safeDays,
      },
      perDay,
    },
    fairness: {
      ...fairness,
      basis: 'classic-engine calcFairness over the pre-swap YTD distribution (swaps cannot game rotation) — same scoring as /schedule-generator/generate',
      thisWeek: {
        night: { shifts: sum(nightBy), people: nightBy.size, maxPerPerson: max(nightBy) },
        midnight: { shifts: sum(midBy), people: midBy.size, maxPerPerson: max(midBy), eligibleMales },
      },
    },
    ruleCompliance,
    unfilled: { total: unfilled.length, byReason, byFunction: byFn, items: unfilled.slice(0, 100) },
    unscheduled: { people: unscheduledPeople, byFunction: unschedFn },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  2. SCHEDULE QUALITY — grade an EXISTING saved/published window (roster_days)
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface QualityRow {
  personNo: string;
  name: string;
  gender: string;
  fn: string;
  date: string;                   // YYYY-MM-DD
  code: string | null;            // raw shift code
  category: string;               // canonical category from SQL (morning/evening/night/midnight/other)
  ss: number | null;              // shift_start_min
  se: number | null;              // shift_end_min (raw or canonical — duration guard applied)
  presence: string | null;        // office/wfh/off/leave/sick/absent/holiday/left…
}

export interface ScheduleQualityInput {
  rows: QualityRow[];
  dates: string[];                // the window, ascending
  minRestHours: number;
  offDaysPerWeek: number;
  /** fn → 24 observed baseline required HC per hour (28d pre-window avg); null = no baseline */
  baseline?: Record<string, number[]> | null;
}

const WORKING = new Set(['office', 'wfh']);
const isWeekendDate = (d: string) => {
  const dow = new Date(d + 'T00:00:00Z').getUTCDay();
  return dow === 4 || dow === 5;    // Thu + Fri — Director's official ruling 2026-07-02
};

export function scoreScheduleQuality(input: ScheduleQualityInput) {
  const { rows, dates, minRestHours, offDaysPerWeek } = input;
  const baseline = input.baseline ?? null;

  // ── Per-person aggregation ──
  type P = {
    name: string; gender: string; fn: string;
    dist: ShiftDistribution;
    byDate: Map<string, QualityRow>;
  };
  const people = new Map<string, P>();
  for (const rw of rows) {
    let p = people.get(rw.personNo);
    if (!p) {
      p = { name: rw.name, gender: rw.gender, fn: rw.fn, dist: emptyDist(), byDate: new Map() };
      people.set(rw.personNo, p);
    }
    p.byDate.set(rw.date, rw);
    const d = p.dist;
    const wknd = isWeekendDate(rw.date);
    if (rw.presence && WORKING.has(rw.presence)) {
      d.total++;
      if (wknd) d.weekendWork++;
      if (rw.category === 'morning') d.morning++;
      else if (rw.category === 'evening') d.evening++;
      else if (rw.category === 'night') d.night++;
      else if (rw.category === 'midnight') d.midnight++;
      if (rw.code) d.byCodes[rw.code] = (d.byCodes[rw.code] ?? 0) + 1;
    } else if (rw.presence === 'off') {
      d.total++; d.off++;
      if (wknd) d.weekendOff++;
    } else if (rw.presence === 'leave' || rw.presence === 'sick') {
      d.total++; d.leave++;
    }
  }

  // ── Rule compliance over the real rows ──
  let femaleViol = 0; const femaleSamples: string[] = [];
  let femaleLate = 0;
  let restViol = 0; const restSamples: string[] = [];
  const offDistribution: Record<string, number> = {};
  const offOutliers: string[] = [];
  let maxConsec = 0;
  const offTarget = Math.round(offDaysPerWeek * dates.length / 7);
  let offOk = true;

  const durOf = (ss: number, se: number) => (se <= ss ? se + 1440 - ss : se - ss);
  const addDays = (iso: string, n: number) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  for (const [, p] of people) {
    const female = isFemale(p.gender);
    let run = 0;
    for (const date of dates) {
      const rw = p.byDate.get(date);
      const working = !!rw?.presence && WORKING.has(rw.presence);
      if (!working) { run = 0; continue; }
      run++;
      if (run > maxConsec) maxConsec = run;
      if (female) {
        if (rw!.category === 'midnight' || /^(E|EE)/i.test(String(rw!.code ?? ''))) {
          femaleViol++;
          if (femaleSamples.length < 5) femaleSamples.push(`${p.name} ${date} ${rw!.code}`);
        } else if (rw!.category === 'night') {
          femaleLate++;
        }
      }
      // rest vs the NEXT calendar day's shift
      const next = p.byDate.get(addDays(date, 1));
      if (rw!.ss != null && rw!.se != null && next?.presence && WORKING.has(next.presence) && next.ss != null) {
        const prevEnd = ((rw!.ss % 1440) + 1440) % 1440 + durOf(((rw!.ss % 1440) + 1440) % 1440, ((rw!.se % 1440) + 1440) % 1440);
        const rest = (1440 + ((next.ss % 1440) + 1440) % 1440 - prevEnd) / 60;
        if (rest < minRestHours) {
          restViol++;
          if (restSamples.length < 5) {
            restSamples.push(`${p.name} ${addDays(date, 1)} ${rw!.code}→${next.code} (${r1(rest)}h)`);
          }
        }
      }
    }
    // OFF allowance for the window (leave explains a shortfall, never an excess)
    const offs = p.dist.off;
    const key = `${offs} OFF`;
    offDistribution[key] = (offDistribution[key] ?? 0) + 1;
    const scheduledDays = p.dist.total;
    if (scheduledDays >= dates.length * 0.7) {   // present most of the window → allowance applies
      const explained = offs === offTarget || (offs < offTarget && p.dist.leave > 0);
      if (!explained) {
        offOk = false;
        if (offOutliers.length < 8) offOutliers.push(`${p.name}: ${offs} OFF (${p.dist.leave} L)`);
      }
    }
  }

  const ruleCompliance: RuleCompliance = {
    femaleNightViolations: femaleViol,
    femaleNightViolationSamples: femaleSamples,
    femaleLateAssignments: femaleLate,
    restViolations: restViol,
    restViolationSamples: restSamples,
    minRestHours,
    offTarget,
    offPerWeekOk: offOk,
    offDistribution,
    offOutliers,
    maxConsecutiveDays: maxConsec,
    consecutiveLimit: 6,
    consecutiveOk: maxConsec <= 6,
    basis: `recounted from roster_days schedule rows (verified data) — real shift windows, min rest ${minRestHours}h, ` +
      `${offDaysPerWeek} OFF/week scaled to the window, ≤6 consecutive days`,
  };

  // ── Coverage: scheduled HC per fn × hour (avg/day) vs observed baseline ──
  const nDays = Math.max(1, dates.length);
  const schedByFn = new Map<string, number[]>();
  for (const rw of rows) {
    if (!rw.presence || !WORKING.has(rw.presence) || rw.ss == null || rw.se == null) continue;
    const counts = schedByFn.get(rw.fn) ?? schedByFn.set(rw.fn, new Array(24).fill(0)).get(rw.fn)!;
    const a = ((rw.ss % 1440) + 1440) % 1440;
    const e = a + durOf(a, ((rw.se % 1440) + 1440) % 1440);
    for (let h = 0; h < 24; h++) {
      const h0 = h * 60;
      if ((a < h0 + 60 && Math.min(e, 1440) > h0) || (e > 1440 && e - 1440 > h0)) counts[h]++;
    }
  }
  let covNum = 0, covDen = 0;
  const byFunction = [...schedByFn.entries()].map(([fn, counts]) => {
    const base = baseline?.[fn] ?? null;
    const hours = counts.map((c, h) => {
      const planned = r1(c / nDays);
      const b = base ? r1(base[h] ?? 0) : null;
      if (b != null && b > 0) { covNum += Math.min(planned, b); covDen += b; }
      return { hour: h, scheduled: planned, baseline: b, short: b != null && b >= 1 && planned < b * 0.85 };
    });
    const shortHours = hours.filter((x) => x.short).map((x) => x.hour);
    return {
      fn, hours, shortHours,
      verdict: base ? (shortHours.length ? 'review' : 'ok') : 'no-baseline',
    };
  }).sort((a, b) =>
    b.hours.reduce((s, x) => s + x.scheduled, 0) - a.hours.reduce((s, x) => s + x.scheduled, 0));
  const coveragePct = covDen > 0 ? r1((covNum / covDen) * 100) : null;

  // ── Shift-mix distribution (window totals + per day) ──
  const mixByCode: Record<string, number> = {};
  const catTotals = { morning: 0, evening: 0, night: 0, midnight: 0, other: 0 } as Record<string, number>;
  const perDayMix = dates.map((date) => {
    const dayCat = { morning: 0, evening: 0, night: 0, midnight: 0 } as Record<string, number>;
    let working = 0, off = 0;
    for (const [, p] of people) {
      const rw = p.byDate.get(date);
      if (!rw) continue;
      if (rw.presence && WORKING.has(rw.presence)) {
        working++;
        if (dayCat[rw.category] != null) dayCat[rw.category]++;
        catTotals[rw.category] = (catTotals[rw.category] ?? 0) + 1;
        if (rw.code) mixByCode[rw.code] = (mixByCode[rw.code] ?? 0) + 1;
      } else if (rw.presence === 'off') off++;
    }
    return { date, working, off, byCategory: dayCat };
  });
  const workedTotal = Object.values(catTotals).reduce((s, x) => s + x, 0);
  const byCategoryPct = Object.fromEntries(
    Object.entries(catTotals).map(([k, v]) => [k, workedTotal ? r1((v / workedTotal) * 100) : 0]),
  );

  // ── Fairness — REUSE calcFairness over the window distributions ──
  const fairness = fairnessFromDistributions(
    [...people.entries()].map(([id, p]) => ({ id, name: p.name, gender: p.gender })),
    new Map([...people.entries()].map(([id, p]) => [id, p.dist])),
  );

  // ── Composite score ──
  let complianceScore = 100;
  if (femaleViol > 0) complianceScore -= 40;
  if (restViol > 0) complianceScore -= 30;
  if (!offOk) complianceScore -= 15;
  if (maxConsec > 6) complianceScore -= 15;
  complianceScore = Math.max(0, complianceScore);
  const score = coveragePct != null
    ? Math.round(0.4 * coveragePct + 0.3 * fairness.score + 0.3 * complianceScore)
    : Math.round(0.5 * fairness.score + 0.5 * complianceScore);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D';
  const hardBreach = femaleViol > 0 || restViol > 0;
  const status = hardBreach ? 'critical' : score >= 80 ? 'good' : 'review';

  return {
    window: { from: dates[0], to: dates[dates.length - 1], days: dates.length },
    people: people.size,
    workedPersonDays: workedTotal,
    score, grade, status,
    verdictTextEn: hardBreach
      ? `RULE BREACH in the saved schedule — ${femaleViol} female-night, ${restViol} rest violation(s)`
      : `Score ${score}/100 (${grade}) — coverage ${coveragePct ?? 'n/a'}%, fairness ${fairness.score}, compliance ${complianceScore}`,
    verdictTextAr: hardBreach
      ? `خرق قاعدة في الجدول المحفوظ — ${femaleViol} ليلي للإناث و${restViol} خرق راحة`
      : `التقييم ${score}/100 (${grade}) — تغطية ${coveragePct ?? 'غير متاح'}%، عدالة ${fairness.score}، التزام ${complianceScore}`,
    scoreParts: { coveragePct, fairnessScore: fairness.score, complianceScore },
    coverage: {
      pct: coveragePct,
      basis: baseline
        ? 'baseline = observed avg scheduled HC per hour over the 28 days before the window (not an Erlang demand) — same basis as the generator hourly health'
        : 'no pre-window baseline available — coverage not scored (honest omission, never faked)',
      byFunction,
    },
    fairness: {
      score: fairness.score,
      nightVariance: fairness.nightVariance,
      midnightVariance: fairness.midnightVariance,
      morningVariance: fairness.morningVariance,
      weekendFairnessScore: fairness.weekendFairnessScore,
      basis: 'classic-engine calcFairness (the ONE fairness scoring) over the window distribution per person',
      details: fairness.details,
    },
    ruleCompliance,
    shiftMix: { byCode: mixByCode, byCategoryPct, perDay: perDayMix },
  };
}
