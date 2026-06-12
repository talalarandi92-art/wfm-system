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
  return Object.values(SHIFTS).filter((s) => {
    if (s.code === 'OFF') return false;
    if (emp.gender === 'female') {
      if (s.femaleRule === 'blocked') return false;
      if (s.femaleRule === 'warn' && !options.allowFemaleN) return false;
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

/**
 * Determine which date(s) to assign as OFF for each employee in the week.
 * Spreads OFF across all 7 days (round-robin by employee position),
 * ensuring that no employee ends up with MORE than 6 consecutive working days
 * given their `priorConsecutiveDays` coming into this week.
 *
 * Weekend days (Thu/Fri = indices 5/6 in a Sat-start week) are spread fairly:
 *   - employees whose priorConsecutiveDays is highest get priority for the
 *     closest upcoming day as OFF.
 */
/**
 * Assign OFF days for the week.
 *
 * Rules:
 * 1. Spread OFF across all 7 days (different slot per employee).
 * 2. Weekend OFF priority: employees with fewer YTD weekend-offs get the
 *    Fri/Sat slot preference (dates[5]=Thu, dates[6]=Fri in Sat-start week).
 * 3. Forced early OFF if employee comes in with >= 5 consecutive days.
 */
function assignOffDays(
  employees: EmployeeInfo[],
  dates: string[],
  offDaysPerWeek: number,
  priorConsecutiveDays?: Map<string, number>,
  ytdDist?: Map<string, ShiftDistribution>,
): Map<string, Set<string>> {
  // Weekend indices in a Sat-start 7-day week:
  //   dates[0]=Sat, [1]=Sun, [2]=Mon, [3]=Tue, [4]=Wed, [5]=Thu, [6]=Fri
  // Fri (idx 6) is typically a preferred OFF day culturally.
  const PREFERRED_WEEKEND_SLOTS = [6, 5]; // Fri first, Thu second

  // Sort employees by YTD weekend-off ratio (ascending) so the lowest get weekend OFF priority
  const sorted = [...employees].sort((a, b) => {
    const distA = ytdDist?.get(a.id);
    const distB = ytdDist?.get(b.id);
    const wkndA = (distA?.weekendOff ?? 0) / Math.max((distA?.weekendOff ?? 0) + (distA?.weekendWork ?? 0), 1);
    const wkndB = (distB?.weekendOff ?? 0) / Math.max((distB?.weekendOff ?? 0) + (distB?.weekendWork ?? 0), 1);
    return wkndA - wkndB; // lowest weekendOffPct gets priority
  });

  const offMap = new Map<string, Set<string>>();
  // Track which weekend slots are taken this week (max 1 employee per slot)
  const weekendSlotUsed = new Set<number>();

  sorted.forEach((e, i) => {
    const offDates = new Set<string>();
    const prior = priorConsecutiveDays?.get(e.id) ?? 0;

    // Forced early off if consecutive days ≥ 5
    const forcedEarlyOff = prior >= 5 ? Math.max(0, 6 - prior - 1) : -1;

    for (let d = 0; d < offDaysPerWeek; d++) {
      if (forcedEarlyOff >= 0 && d === 0) {
        offDates.add(dates[forcedEarlyOff]);
        continue;
      }

      // Try to give weekend OFF to employees with low weekend-off ratio (first half of sorted list)
      const wantsWeekend = i < Math.ceil(sorted.length / 2);
      if (wantsWeekend) {
        for (const slot of PREFERRED_WEEKEND_SLOTS) {
          if (!weekendSlotUsed.has(slot) && dates[slot] && !offDates.has(dates[slot])) {
            offDates.add(dates[slot]);
            weekendSlotUsed.add(slot);
            break;
          }
        }
        if (offDates.size > (d > 0 ? d : 0)) continue; // got a weekend slot
      }

      // Default: spread by position across all days
      const spread = Math.ceil(employees.length / Math.max(offDaysPerWeek, 1));
      const dayIdx = (i * offDaysPerWeek + d * spread) % 7;
      offDates.add(dates[dayIdx]);
    }

    offMap.set(e.id, offDates);
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

  // Shift fairness: 100 - weighted variance (lower variance = fairer)
  const shiftFairnessScore = Math.max(0, Math.round(100 - (nightVar + morningVar) / 2));
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
    const offMap = assignOffDays(employees, dates, options.offDaysPerWeek, priorConsecutiveDays, ytdDistMap);

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
      if (lastShift && lastShift.code !== 'OFF') {
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

      // ── Consecutive days tracking ─────────────────────────────────────────
      let consecutiveDays = priorConsecutiveDays?.get(emp.id) ?? 0;
      const MAX_CONSECUTIVE = 6;

      const assignments: DayAssignment[] = [];
      let prevShift: ShiftDef | null = lastShift;

      // Track intra-week distribution
      const weekDist = { ...dist };

      for (const date of dates) {
        const dayName = getDayNameAr(date);

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
  const workingDays   = allSchedules.reduce((a, es) => a + (7 - es.weekStats.offCount), 0);

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
