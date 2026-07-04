/**
 * Pure schedule generation engine — no DB dependencies.
 * All functions are deterministic and unit-testable.
 */
import {
  SHIFTS,
  ShiftDef,
  EmployeeInfo,
  ShiftDistribution,
  DayAssignment,
  EmployeeSchedule,
  CoverageDay,
  GeneratorViolation,
  FairnessReport,
  GeneratorOptions,
  GeneratorResult,
  allowedShiftCodes,
  functionAllowsFemaleLate,
} from './generator.types';

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function buildWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const d = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    dates.push(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY_NAMES_AR = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export function getDayNameAr(dateStr: string): string {
  const d = new Date(dateStr);
  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  // weekDayIndex: Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
  const idx = (d.getDay() + 1) % 7; // Sat=0 ... Fri=6
  return DAY_NAMES_AR[idx];
}

// ─── Rest Calculation ─────────────────────────────────────────────────────────

/**
 * Returns rest hours between end of prevShift and start of nextShift (next calendar day).
 * If prevShift is OFF or null → returns 999 (unlimited rest).
 */
export function calcRestHours(
  prevShift: ShiftDef | null,
  nextShift: ShiftDef,
): number {
  if (!prevShift || prevShift.code === 'OFF' || !prevShift.end || !nextShift.start) return 999;

  // End minutes from midnight (Day 1). If cross-midnight, add 24h.
  const [prevH, prevM] = prevShift.end.split(':').map(Number);
  const prevEndMins = prevH * 60 + prevM + (prevShift.crossMidnight ? 24 * 60 : 0);

  // Start minutes from midnight (Day 2 = Day 1 + 24h)
  const [nextH, nextM] = nextShift.start.split(':').map(Number);
  const nextStartMins = nextH * 60 + nextM + 24 * 60;

  return (nextStartMins - prevEndMins) / 60;
}

// ─── Validity Check ───────────────────────────────────────────────────────────

export function validateShift(
  emp: EmployeeInfo,
  shift: ShiftDef,
  prevShift: ShiftDef | null,
  options: GeneratorOptions,
): string[] {
  const violations: string[] = [];

  if (shift.code === 'OFF') return violations;

  // Gender rule
  if (emp.gender === 'female') {
    if (shift.femaleRule === 'blocked') {
      violations.push(`female_blocked:${shift.code}`);
    } else if (shift.femaleRule === 'warn' && !options.allowFemaleN) {
      violations.push(`female_warn:${shift.code}`);
    }
  }

  // Rest rule
  const rest = calcRestHours(prevShift, shift);
  if (rest < options.minRestHours) {
    violations.push(`rest:${Math.round(rest * 10) / 10}h`);
  }

  return violations;
}

// ─── Available Shifts for Employee ────────────────────────────────────────────

function getWorkingShifts(emp: EmployeeInfo, options: GeneratorOptions): ShiftDef[] {
  // Per-function operating hours: a function may only use its allowed shift codes.
  const allowed = allowedShiftCodes(emp.functionName);
  // Some functions (e.g. all-female Outbound ending 22:00) let females work their
  // late ('warn') shift; midnight/E/EE ('blocked') stay off-limits regardless.
  // Female late ('warn') shift allowed when: the function permanently allows it
  // (config, e.g. OMT), OR it was picked for this generation, OR the global override.
  const femaleLateOk =
    functionAllowsFemaleLate(emp.functionName) ||
    !!options.femaleLateFunctionIds?.includes(emp.functionId) ||
    options.allowFemaleN;
  return Object.values(SHIFTS).filter((s) => {
    if (s.code === 'OFF' || s.code === 'L') return false;  // non-working codes
    if (allowed && !allowed.has(s.code)) return false;   // function shift policy
    if (emp.gender === 'female') {
      if (s.femaleRule === 'blocked') return false;       // E/EE/MD/MN always off-limits
      if (s.femaleRule === 'warn' && !femaleLateOk) return false;
    }
    return true;
  });
}

// ─── Weekly Rotation Cycle ────────────────────────────────────────────────────
// User-defined rotation: Night → Between → Morning → Midnight → Night …
// Each employee's target category for the week is derived from their last week's
// dominant category. Within the week, all working days use shifts from that category.
//
//   night / evening  →  between  (B / C)
//   between          →  morning  (M / AM)
//   morning          →  midnight (MD / MN)
//   midnight         →  night    (E / N)
//   off / no history →  morning  (fresh start or spread by index)

// Rotation cycle: night → afternoon (B/C) → morning → midnight → night …
// Note: 'between' is a display concept; in the generator ShiftDef,
//        B maps to 'morning' and C maps to 'afternoon'.
// User-requested cycle: Night → B/C → Morning → Midnight → Night
export const ROTATION_NEXT: Record<string, string> = {
  night:     'afternoon',  // Night week → next week afternoon (C/B shifts)
  evening:   'afternoon',
  afternoon: 'morning',   // Afternoon week → next week morning (M/AM shifts)
  morning:   'midnight',  // Morning week → next week midnight (MD/MN shifts)
  midnight:  'night',     // Midnight week → next week night (N/E shifts)
  off:       'morning',
};

// Preferred shift codes per rotation target category
const CATEGORY_PREFERRED: Record<string, string[]> = {
  morning:   ['M', 'B', 'AM'],
  afternoon: ['B', 'C'],
  night:     ['N', 'E'],
  midnight:  ['MD', 'MN'],
  evening:   ['E', 'EE'],
};

// ─── Shift Scoring (fairness + rotation target) ───────────────────────────────

/**
 * Score a shift candidate.
 * targetCategory is the employee's assigned rotation band for this week.
 * Bonus: +50 if shift matches target category (drives weekly consistency).
 * Fairness: secondary — balances YTD distribution deficit.
 */
function shiftScore(
  shift: ShiftDef,
  dist: ShiftDistribution,
  targetCategory: string,
  date?: string,       // for weekend bonus
): number {
  // Primary: +50 if this shift is the target category for this week (rotation)
  const rotationBonus = shift.category === targetCategory ? 50 : 0;

  if (dist.total === 0) return rotationBonus + 10;
  const total = Math.max(dist.total, 1);

  // Weekend fairness: if today is a weekend and employee has low weekend-off ratio, penalise
  // working them more on weekends (prefer giving them OFF) — handled in assignOffDays.
  // Here we just add a small bonus to shifts that help balance the category distribution.
  const morningPct  = (dist.morning + dist.afternoon) / total;
  const nightPct    = dist.night / total;
  const midnightPct = dist.midnight / total;

  let fairnessBonus = 0;
  switch (shift.category) {
    case 'morning':
    case 'afternoon': fairnessBonus = Math.max(0, 0.40 - morningPct) * 30; break;
    case 'night':
    case 'evening':   fairnessBonus = Math.max(0, 0.25 - nightPct) * 25; break;
    case 'midnight':  fairnessBonus = Math.max(0, 0.10 - midnightPct) * 20; break;
    default:          fairnessBonus = 0; break;
  }

  // Per-code fairness: if this exact code has been over-assigned, small penalty
  const codeCount = dist.byCodes?.[shift.code] ?? 0;
  const avgCodeCount = total / Math.max(Object.keys(dist.byCodes ?? {}).length, 1);
  const codeOverusePenalty = codeCount > avgCodeCount * 1.5 ? -10 : 0;

  return rotationBonus + fairnessBonus + codeOverusePenalty;
}

// ─── Pick Best Shift ──────────────────────────────────────────────────────────

/**
 * Pick the best shift for an employee on a given day.
 * targetCategory: the rotation band assigned for this employee this week.
 * Priority: 1) no rest/gender blocker, 2) matches targetCategory, 3) fairness score.
 */
export function pickBestShift(
  emp: EmployeeInfo,
  dist: ShiftDistribution,
  prevShift: ShiftDef | null,
  targetCategory: string,
  options: GeneratorOptions,
): DayAssignment['shift'] & { violations: string[]; restHours: number } {
  const available = getWorkingShifts(emp, options);

  const scored = available.map((s) => {
    const violations = validateShift(emp, s, prevShift, options);
    const hasBlocker = violations.some((v) => v.startsWith('female_blocked') || v.startsWith('rest'));
    const restH = calcRestHours(prevShift, s);
    const score = shiftScore(s, dist, targetCategory);
    return { shift: s, violations, hasBlocker, restH, score };
  });

  // Sort: valid (no blocker) first, then by score desc
  scored.sort((a, b) => {
    if (a.hasBlocker !== b.hasBlocker) return a.hasBlocker ? 1 : -1;
    return b.score - a.score;
  });

  const best = scored[0];
  if (!best) {
    return { ...SHIFTS.OFF, violations: ['no_valid_shift'], restHours: 999 };
  }
  return { ...best.shift, violations: best.violations, restHours: Math.round(best.restH * 10) / 10 };
}

// ─── OFF Day Distribution ─────────────────────────────────────────────────────

// Weekend = THURSDAY + FRIDAY only — OFFICIAL RULING by the Director 2026-07-02
// (Saturday is a regular working day; resolves the old Thu/Fri drift).
// In a Saturday-start 7-day week:
//   dates[0]=Sat, [1]=Sun, [2]=Mon, [3]=Tue, [4]=Wed, [5]=Thu, [6]=Fri
const WEEKEND_DAY_INDICES = [5, 6];
const WEEKDAY_INDICES     = [0, 1, 2, 3, 4]; // Sat, Sun, Mon, Tue, Wed

// Week index (whole weeks since epoch) — used only to rotate which days absorb
// the leftover OFF slots, so the pattern is not byte-identical every week even
// before any YTD history exists.
function weekIndexOf(dateStr: string): number {
  const ms = new Date(dateStr + 'T00:00:00').getTime();
  return Number.isFinite(ms) ? Math.floor(ms / (7 * 86_400_000)) : 0;
}

// Rotate an array left by `by` positions (used to vary tie-breaking per week so
// the same low-index day isn't always chosen first → no static pattern).
function rotate<T>(arr: T[], by: number): T[] {
  const n = arr.length;
  if (n === 0) return arr;
  const k = ((by % n) + n) % n;
  return arr.slice(k).concat(arr.slice(0, k));
}

// Pick the candidate day with the most remaining OFF capacity that the employee
// has not already taken. Candidate order matters only for ties — callers pass a
// week-rotated order so ties spread across days. Returns -1 when no candidate
// has spare capacity.
function pickDayWithCapacity(
  candidates: number[],
  capacity: number[],
  used: number[],
  taken: Set<string>,
  dates: string[],
): number {
  let best = -1;
  let bestRemain = 0;
  for (const idx of candidates) {
    if (taken.has(dates[idx])) continue;
    const remain = capacity[idx] - used[idx];
    if (remain > bestRemain) { bestRemain = remain; best = idx; }
  }
  return best;
}

// Build per-day capacity for a set of day indices: `count` OFFs spread as evenly
// as possible across `days`, with the leftover rotated by week so it isn't static.
function spreadCapacity(
  capacity: number[],
  days: number[],
  count: number,
  wk: number,
): void {
  if (!days.length || count <= 0) return;
  const base = Math.floor(count / days.length);
  const rem  = count % days.length;
  days.forEach(idx => { capacity[idx] += base; });
  for (let r = 0; r < rem; r++) capacity[days[(r + wk) % days.length]]++;
}

/**
 * Assign OFF days for the week with FAIR weekend distribution.
 *
 * Structure (business rule — confirmed by WFM):
 *   • With 2 OFF days/week: each employee gets ONE weekend OFF (Thu/Fri) and
 *     ONE mid-week OFF (Sun/Mon/Tue/Wed). The weekend OFF is rationed fairly —
 *     employees with the FEWEST year-to-date weekend OFFs pick first — and both
 *     OFFs rotate week to week so the pattern is never static.
 *   • With 1 OFF day/week: the single OFF is spread evenly across all 7 days,
 *     so every employee cycles through weekend OFFs over time.
 *
 * The 6-consecutive-day guideline is intentionally NOT enforced rigidly here —
 * one OFF mid-week + one at the weekend naturally keeps runs short, and a run of
 * 5–7 days now and then is acceptable (it must never inflate the OFF count).
 */
function assignOffDays(
  employees: EmployeeInfo[],
  dates: string[],
  offDaysPerWeek: number,
  priorConsecutiveDays?: Map<string, number>,
  ytdDist?: Map<string, ShiftDistribution>,
  weekStart?: string,
): Map<string, Set<string>> {
  const offMap = new Map<string, Set<string>>();
  const n = employees.length;
  if (!n) return offMap;

  const perWeek = Math.max(offDaysPerWeek, 1);
  const wk = weekIndexOf(weekStart ?? dates[0]);

  // Guarantee a high-carryover employee gets an OFF early enough that the engine
  // never has to inject an EXTRA forced OFF (which would push them to 3/week).
  // The earliest OFF must land on or before index (MAX_CONSECUTIVE - prior).
  const MAXCON = 9;
  const enforceEarlyOff = (taken: Set<string>, prior: number, used: number[]) => {
    if (prior <= 0) return;
    const maxFirst = Math.max(0, MAXCON - prior);
    const idxs = [...taken].map(ds => dates.indexOf(ds)).filter(i => i >= 0).sort((a, b) => a - b);
    if (!idxs.length || idxs[0] <= maxFirst) return;          // already has an early OFF
    let early = -1;
    for (let i = 0; i <= maxFirst; i++) if (!taken.has(dates[i])) { early = i; break; }
    if (early < 0) return;
    const latest = idxs[idxs.length - 1];                     // move the latest OFF earlier
    taken.delete(dates[latest]); used[latest]--;
    taken.add(dates[early]);     used[early]++;
  };

  // ── Weekend-fairness order — fewest YTD weekend-OFFs picks first ──
  const sorted = [...employees].sort((a, b) => {
    const da = ytdDist?.get(a.id);
    const db = ytdDist?.get(b.id);
    const offA = da?.weekendOff ?? 0;
    const offB = db?.weekendOff ?? 0;
    if (offA !== offB) return offA - offB;            // fewer weekend OFFs → first
    return (db?.weekendWork ?? 0) - (da?.weekendWork ?? 0); // worked more weekends → first
  });

  const used = new Array(7).fill(0);
  const weekendOrder = rotate(WEEKEND_DAY_INDICES, wk);
  const weekdayOrder = rotate(WEEKDAY_INDICES, wk);
  const anyOrder     = rotate([0, 1, 2, 3, 4, 5, 6], wk);

  if (perWeek === 1) {
    // ── 1 OFF/week: spread evenly across ALL 7 days (weekend rotates over time) ──
    const capacity = new Array(7).fill(0);
    spreadCapacity(capacity, [0, 1, 2, 3, 4, 5, 6], n, wk);

    sorted.forEach((e) => {
      const taken = new Set<string>();
      // Weekend-deficit employees get first crack at a weekend day, then any day.
      let idx = pickDayWithCapacity(weekendOrder, capacity, used, taken, dates);
      if (idx < 0) idx = pickDayWithCapacity(anyOrder, capacity, used, taken, dates);
      if (idx < 0) idx = anyOrder.find(x => !taken.has(dates[x])) ?? 0;
      taken.add(dates[idx]);
      used[idx]++;
      enforceEarlyOff(taken, priorConsecutiveDays?.get(e.id) ?? 0, used);
      offMap.set(e.id, taken);
    });
    return offMap;
  }

  // ── 2+ OFF/week: ONE weekend OFF + (perWeek-1) mid-week OFFs per employee ──
  const capacity = new Array(7).fill(0);
  spreadCapacity(capacity, WEEKEND_DAY_INDICES, n, wk);                 // 1 weekend OFF each
  spreadCapacity(capacity, WEEKDAY_INDICES, n * (perWeek - 1), wk);     // mid-week OFFs

  sorted.forEach((e) => {
    const taken = new Set<string>();

    // 1) Weekend OFF (Thu/Fri) — fairness order already prioritises deficit.
    let widx = pickDayWithCapacity(weekendOrder, capacity, used, taken, dates);
    if (widx < 0) widx = weekendOrder.find(x => !taken.has(dates[x])) ?? WEEKEND_DAY_INDICES[0];
    taken.add(dates[widx]);
    used[widx]++;

    // 2) Mid-week OFF(s) — Sun/Mon/Tue/Wed, balanced by capacity, and NOT
    //    calendar-adjacent to an already-taken OFF (prevents 2 OFFs back-to-back
    //    within the week → caps cross-week runs at 2, never 3+).
    for (let d = 1; d < perWeek; d++) {
      const takenIdx = [...taken].map(ds => dates.indexOf(ds));
      const notAdjacent = (i: number) => !takenIdx.some(ti => ti >= 0 && Math.abs(ti - i) === 1);
      const wPref = weekdayOrder.filter(notAdjacent);
      const aPref = anyOrder.filter(notAdjacent);
      let didx = pickDayWithCapacity(wPref, capacity, used, taken, dates);     // weekday, non-adjacent
      if (didx < 0) didx = pickDayWithCapacity(aPref, capacity, used, taken, dates); // any, non-adjacent
      if (didx < 0) didx = pickDayWithCapacity(weekdayOrder, capacity, used, taken, dates); // relax adjacency
      if (didx < 0) didx = pickDayWithCapacity(anyOrder, capacity, used, taken, dates);
      if (didx < 0) didx = (aPref.find(x => !taken.has(dates[x])) ?? anyOrder.find(x => !taken.has(dates[x])) ?? 0);
      taken.add(dates[didx]);
      used[didx]++;
    }

    enforceEarlyOff(taken, priorConsecutiveDays?.get(e.id) ?? 0, used);
    offMap.set(e.id, taken);
  });

  return offMap;
}

// ─── Coverage Calculation ─────────────────────────────────────────────────────

function buildCoverage(dates: string[], employeeSchedules: EmployeeSchedule[]): CoverageDay[] {
  return dates.map((date, i) => {
    const cov: CoverageDay = {
      date,
      dayName: DAY_NAMES_AR[i],
      total: 0, working: 0, off: 0,
      morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0,
      coveragePct: 0,
    };
    for (const es of employeeSchedules) {
      const day = es.assignments.find((a) => a.date === date);
      if (!day) continue;
      cov.total++;
      if (day.shift.code === 'OFF') { cov.off++; continue; }
      if (day.shift.code === 'L') continue;   // approved leave — neither working nor OFF
      cov.working++;
      if (day.shift.category === 'morning')   cov.morning++;
      if (day.shift.category === 'afternoon') cov.afternoon++;
      if (day.shift.category === 'evening')   cov.evening++;
      if (day.shift.category === 'night')     cov.night++;
      if (day.shift.category === 'midnight')  cov.midnight++;
    }
    cov.coveragePct = cov.total > 0 ? Math.round((cov.working / cov.total) * 100) : 0;
    return cov;
  });
}

// ─── Violations Collection ────────────────────────────────────────────────────

function collectViolations(schedules: EmployeeSchedule[]): GeneratorViolation[] {
  const violations: GeneratorViolation[] = [];
  for (const es of schedules) {
    for (const day of es.assignments) {
      for (const v of day.violations) {
        if (v.startsWith('female_blocked')) {
          violations.push({
            type: 'female_blocked',
            employeeId: es.employee.id,
            employeeName: es.employee.name,
            date: day.date,
            shiftCode: day.shift.code,
            severity: 'error',
            messageAr: `${es.employee.name}: وردية ${day.shift.label} ممنوعة للإناث`,
            messageEn: `${es.employee.name}: ${day.shift.labelEn} shift blocked for female`,
          });
        } else if (v.startsWith('female_warn')) {
          violations.push({
            type: 'female_warn',
            employeeId: es.employee.id,
            employeeName: es.employee.name,
            date: day.date,
            shiftCode: day.shift.code,
            severity: 'warning',
            messageAr: `${es.employee.name}: وردية ${day.shift.label} تحتاج موافقة للإناث`,
            messageEn: `${es.employee.name}: ${day.shift.labelEn} needs approval for female`,
          });
        } else if (v.startsWith('rest:')) {
          const h = v.split(':')[1];
          violations.push({
            type: 'rest_violation',
            employeeId: es.employee.id,
            employeeName: es.employee.name,
            date: day.date,
            shiftCode: day.shift.code,
            restHours: parseFloat(h),
            severity: 'error',
            messageAr: `${es.employee.name}: راحة ${h} ساعة فقط (أقل من الحد المطلوب)`,
            messageEn: `${es.employee.name}: only ${h}h rest (below minimum)`,
          });
        } else if (v === 'no_valid_shift') {
          violations.push({
            type: 'coverage_gap',
            employeeId: es.employee.id,
            employeeName: es.employee.name,
            date: day.date,
            severity: 'error',
            messageAr: `${es.employee.name}: لا توجد وردية صالحة بتاريخ ${day.date}`,
            messageEn: `${es.employee.name}: no valid shift found on ${day.date}`,
          });
        }
      }
    }
  }
  return violations;
}

// ─── Fairness Report ─────────────────────────────────────────────────────────

function calcFairness(schedules: EmployeeSchedule[]): FairnessReport {
  const details = schedules
    .filter((es) => es.ytdDist.total > 0)
    .map((es) => {
      const t = Math.max(es.ytdDist.total, 1);
      const totalWeekend = (es.ytdDist.weekendOff ?? 0) + (es.ytdDist.weekendWork ?? 0);
      return {
        employeeId:      es.employee.id,
        name:            es.employee.name,
        morningPct:      Math.round(((es.ytdDist.morning + es.ytdDist.afternoon) / t) * 100),
        eveningPct:      Math.round((es.ytdDist.evening / t) * 100),
        nightPct:        Math.round((es.ytdDist.night / t) * 100),
        midnightPct:     Math.round((es.ytdDist.midnight / t) * 100),
        weekendOffCount: es.ytdDist.weekendOff ?? 0,
        weekendWorkCount:es.ytdDist.weekendWork ?? 0,
        weekendOffPct:   totalWeekend > 0 ? Math.round(((es.ytdDist.weekendOff ?? 0) / totalWeekend) * 100) : 0,
        shiftCodes:      es.ytdDist.byCodes ?? {},
      };
    });

  const variance = (arr: number[]) => {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.round(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
  };

  const nightVar    = variance(details.map(d => d.nightPct));
  const morningVar  = variance(details.map(d => d.morningPct));
  const midnightVar = variance(details.map(d => d.midnightPct));
  const weekendVar  = variance(details.map(d => d.weekendOffPct));

  // Shift fairness: 100 - sqrt of the mean night/midnight variance — the HARD
  // shifts are what fairness is about; sqrt keeps the score in a usable range.
  const shiftFairnessScore = Math.max(0, Math.round(100 - Math.sqrt((nightVar + midnightVar) / 2)));
  // Weekend fairness: 100 - sqrt(weekendVar)
  const weekendScore       = Math.max(0, Math.round(100 - Math.sqrt(weekendVar) * 5));

  return {
    score: Math.round((shiftFairnessScore * 0.7) + (weekendScore * 0.3)),
    nightVariance:   nightVar,
    morningVariance: morningVar,
    midnightVariance:midnightVar,
    weekendFairnessScore: weekendScore,
    details,
  };
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export function generateWeeklySchedule(
  employeesByFunction: { id: string; name: string; employees: EmployeeInfo[] }[],
  ytdDistMap: Map<string, ShiftDistribution>,
  lastShiftMap: Map<string, ShiftDef>,   // empId → last shift before week
  weekStart: string,
  options: GeneratorOptions,
  priorConsecutiveDays?: Map<string, number>,  // consecutive working days before weekStart
  onLeave?: Map<string, Set<string>>,          // empId → dates with APPROVED leave → 'L'
): GeneratorResult {
  const dates = buildWeekDates(weekStart);
  const weekEnd = dates[6];

  const resultFunctions: GeneratorResult['functions'] = [];
  const allSchedules: EmployeeSchedule[] = [];

  // Rotation bands: spread employees across 4 bands for teams with no history
  const INITIAL_ROTATION_BANDS = ['morning', 'afternoon', 'night', 'midnight'];

  for (const fn of employeesByFunction) {
    const { employees } = fn;
    if (!employees.length) continue;

    // Assign OFF days with consecutive-day awareness + weekend fairness
    const offMap = assignOffDays(employees, dates, options.offDaysPerWeek, priorConsecutiveDays, ytdDistMap, weekStart);

    // Restricted-function rotation: the categories this function may actually use.
    // Null = unrestricted (24/7). For a 2-shift function (OMT = B+N) this makes
    // employees rotate across BOTH shifts instead of collapsing to the first one.
    const fnCodes = allowedShiftCodes(fn.name);
    const fnCats = fnCodes
      ? [...new Set(Object.values(SHIFTS).filter(s => s.code !== 'OFF' && fnCodes.has(s.code)).map(s => s.category))]
      : null;
    const fnWk = weekIndexOf(weekStart);

    // Sort: employees who have worked the most consecutive days get OFF earlier
    const sorted = [...employees].sort((a, b) => {
      const consA = priorConsecutiveDays?.get(a.id) ?? 0;
      const consB = priorConsecutiveDays?.get(b.id) ?? 0;
      return consB - consA; // most consecutive first → gets early OFF
    });

    const employeeSchedules: EmployeeSchedule[] = [];

    sorted.forEach((emp, empIdx) => {
      const dist = ytdDistMap.get(emp.id) ?? {
        morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0, off: 0, leave: 0, total: 0, byCodes: {}, weekendOff: 0, weekendWork: 0, maxConsecutive: 0,
      };
      const offDates = offMap.get(emp.id) ?? new Set();

      // ── Rotation target for this week ─────────────────────────────────────
      // Derived from employee's last shift category (weekly rotation cycle).
      // If no history → spread evenly across team by position.
      const lastShift = lastShiftMap.get(emp.id) ?? null;
      let targetCategory: string;
      if (fnCats && fnCats.length) {
        // Restricted function → round-robin across its allowed categories,
        // rotated weekly so each employee cycles through them over time.
        targetCategory = fnCats[(empIdx + fnWk) % fnCats.length];
      } else if (lastShift && lastShift.code !== 'OFF') {
        targetCategory = ROTATION_NEXT[lastShift.category] ?? 'morning';
      } else if (dist.total === 0) {
        // Fresh employee: spread across 4 bands by position
        targetCategory = INITIAL_ROTATION_BANDS[empIdx % 4];
      } else {
        // Had OFF last shift but has history → figure out what they had before
        // Use YTD to decide: assign the category they have the LEAST of
        const t = Math.max(dist.total, 1);
        const cats = [
          { cat: 'morning',  pct: (dist.morning + dist.afternoon) / t },
          { cat: 'afternoon',pct: (dist.morning + dist.afternoon) / t },
          { cat: 'night',    pct: dist.night / t },
          { cat: 'midnight', pct: dist.midnight / t },
        ];
        cats.sort((a, b) => a.pct - b.pct);
        targetCategory = cats[0].cat;
      }

      // ── Female rotation guard ─────────────────────────────────────────────
      // The mixed-gender rotation cycle (morning→midnight→night→afternoon) sends a woman to
      // midnight — which she is BLOCKED from — so she falls back to morning EVERY week and freezes
      // on one shift (the real bug behind "why am I always on M?"). Rotate her only through the
      // bands she may actually work: morning↔afternoon by default; + night/evening when the
      // female-late exception is enabled for her. This restores the variety the manual roster had.
      if (emp.gender === 'female') {
        const lateOk = !!options.allowFemaleN || !!options.femaleLateFunctionIds?.includes(emp.functionId);
        const bands = lateOk ? ['morning', 'afternoon', 'night', 'evening'] : ['morning', 'afternoon'];
        if (!bands.includes(targetCategory)) {
          const prev = lastShift?.category && bands.includes(lastShift.category) ? lastShift.category : bands[bands.length - 1];
          targetCategory = bands[(bands.indexOf(prev) + 1) % bands.length];
        }
      }

      // ── Consecutive days tracking ─────────────────────────────────────────
      // Soft guideline is ~6 consecutive days, but the OFF structure (one
      // mid-week + one weekend OFF) already keeps runs short, and the business
      // rule is NOT to enforce 6 rigidly (a 5–7 run is fine). MAX here is only a
      // safety ceiling so we never inject an extra OFF under normal planning —
      // it fires solely for pathological long runs.
      let consecutiveDays = priorConsecutiveDays?.get(emp.id) ?? 0;
      const MAX_CONSECUTIVE = 9;

      const assignments: DayAssignment[] = [];
      let prevShift: ShiftDef | null = lastShift;

      // Track intra-week distribution
      const weekDist = { ...dist };

      for (const date of dates) {
        const dayName = getDayNameAr(date);

        // Approved leave short-circuit — the employee is simply not available.
        // 'L' is NOT an OFF: it never consumes the weekly OFF allowance.
        if (onLeave?.get(emp.id)?.has(date)) {
          assignments.push({ date, dayName, shift: SHIFTS.L, violations: [], restHours: 999 });
          prevShift = SHIFTS.OFF;   // full rest after a leave day
          weekDist.leave++;
          consecutiveDays = 0;
          continue;
        }

        // Force REST if consecutive days would exceed MAX
        const forceOff = consecutiveDays >= MAX_CONSECUTIVE && !offDates.has(date);

        if (offDates.has(date) || forceOff) {
          assignments.push({ date, dayName, shift: SHIFTS.OFF, violations: [], restHours: 999 });
          prevShift = SHIFTS.OFF;
          weekDist.off++;
          consecutiveDays = 0;
          continue;
        }

        const result = pickBestShift(emp, weekDist, prevShift, targetCategory, options);
        const { violations, restHours, ...shift } = result;

        assignments.push({ date, dayName, shift, violations, restHours });

        // Update intra-week dist
        if (shift.category === 'morning' || shift.category === 'afternoon') weekDist.morning++;
        else if (shift.category === 'evening') weekDist.evening++;
        else if (shift.category === 'night')   weekDist.night++;
        else if (shift.category === 'midnight') weekDist.midnight++;

        prevShift = shift;
        consecutiveDays++;
      }

      // Week stats
      const weekStats = {
        morningCount:   assignments.filter((a) => a.shift.category === 'morning').length,
        afternoonCount: assignments.filter((a) => a.shift.category === 'afternoon').length,
        eveningCount:   assignments.filter((a) => a.shift.category === 'evening').length,
        nightCount:     assignments.filter((a) => a.shift.category === 'night').length,
        midnightCount:  assignments.filter((a) => a.shift.category === 'midnight').length,
        offCount:       assignments.filter((a) => a.shift.code === 'OFF').length,
        violationCount: assignments.reduce((acc, a) => acc + a.violations.length, 0),
      };

      employeeSchedules.push({ employee: emp, ytdDist: dist, assignments, weekStats });
      allSchedules.push({ employee: emp, ytdDist: dist, assignments, weekStats });
    });

    resultFunctions.push({ id: fn.id, name: fn.name, employees: employeeSchedules });
  }

  // Build coverage
  const coverage = buildCoverage(dates, allSchedules);

  // Collect violations
  const violations = collectViolations(allSchedules);

  // Fairness report
  const fairness = calcFairness(allSchedules);

  // Summary
  const totalErrors   = violations.filter((v) => v.severity === 'error').length;
  const totalWarnings = violations.filter((v) => v.severity === 'warning').length;
  const avgCovPct     = coverage.length > 0
    ? Math.round(coverage.reduce((a, c) => a + c.coveragePct, 0) / coverage.length)
    : 0;
  const offAssigned   = allSchedules.reduce((a, es) => a + es.weekStats.offCount, 0);
  const workingDays   = allSchedules.reduce((a, es) =>
    a + es.assignments.filter(x => x.shift.code !== 'OFF' && x.shift.code !== 'L').length, 0);

  return {
    weekStart,
    weekEnd,
    dates,
    functions: resultFunctions,
    coverage,
    violations,
    fairness,
    summary: {
      totalEmployees: allSchedules.length,
      totalErrors,
      totalWarnings,
      avgCoveragePct: avgCovPct,
      offAssigned,
      workingDays,
    },
    generatedAt: new Date().toISOString(),
  };
}
