/**
 * Specs for the demand-driven roster engine (Phase 2 — assignRoster).
 * Locks in:
 *   • per-function operating hours: /refund/ never gets MD/MN; /outbound/ only B or N
 *   • the weekly OFF allowance is never exceeded
 *   • unfillable demand is reported honestly (never hidden)
 */
import { assignRoster, DemandAssignment } from './demand.engine';
import { buildWeekDates } from './generator.engine';
import { EmployeeInfo, ShiftDef, ShiftDistribution } from './generator.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEK_START = '2026-07-04'; // Saturday
const DATES = buildWeekDates(WEEK_START);

function emp(
  id: string,
  gender: 'male' | 'female',
  functionName: string,
  functionId = 'fn1',
): EmployeeInfo {
  return {
    id,
    employeeNo: id.toUpperCase(),
    name: `Emp ${id}`,
    gender,
    employmentType: 'full_time',
    functionId,
    functionName,
  };
}

function mixFor(dates: string[], mix: Record<string, number>): Map<string, Record<string, number>> {
  return new Map(dates.map((d) => [d, { ...mix }]));
}

const OPTS = { minRestHours: 10, offDaysPerWeek: 2 };

function byEmployee(assignments: DemandAssignment[]): Map<string, DemandAssignment[]> {
  const m = new Map<string, DemandAssignment[]>();
  for (const a of assignments) {
    if (!m.has(a.employeeId)) m.set(a.employeeId, []);
    m.get(a.employeeId)!.push(a);
  }
  return m;
}

// ─── assignRoster: function policy + OFF allowance ────────────────────────────

describe('assignRoster (demand engine, synthetic pool)', () => {
  const pool: EmployeeInfo[] = [
    emp('m-a', 'male', 'Customer Care'),
    emp('m-b', 'male', 'Customer Care'),
    emp('m-c', 'male', 'Customer Care'),
    emp('r1', 'male', 'Refund Team'),
    emp('o1', 'female', 'Outbound', 'fn2'),
    emp('f1', 'female', 'Customer Care'),
  ];
  const emptyDist = new Map<string, ShiftDistribution>();
  const emptyLast = new Map<string, ShiftDef>();
  const noPrior = new Map<string, number>();

  // Demand includes a midnight every day → forces the MD-eligibility rules to bite.
  const mixByDate = mixFor(DATES, { MD: 1, M: 1, B: 1, N: 1 });

  function run() {
    return assignRoster(DATES, mixByDate, pool, emptyDist, emptyLast, noPrior, OPTS);
  }

  it('every employee gets exactly one assignment per date (no dupes, no holes)', () => {
    const result = run();
    const grouped = byEmployee(result.assignments);
    expect(grouped.size).toBe(pool.length);
    for (const e of pool) {
      const rows = grouped.get(e.id)!;
      expect(rows).toHaveLength(DATES.length);
      expect(new Set(rows.map((r) => r.date)).size).toBe(DATES.length);
    }
  });

  it('an employee in a /refund/ function is NEVER assigned MD (or MN)', () => {
    const result = run();
    const refundRows = result.assignments.filter((a) => a.employeeId === 'r1');
    for (const a of refundRows) {
      expect(['MD', 'MN']).not.toContain(a.code);
    }
  });

  it('an employee in an /outbound/ function only ever gets B or N (or OFF/L)', () => {
    const result = run();
    const outRows = result.assignments.filter((a) => a.employeeId === 'o1');
    for (const a of outRows) {
      expect(['B', 'N', 'OFF', 'L']).toContain(a.code);
    }
  });

  // ── KNOWN ENGINE BUG (reported, engine intentionally NOT edited by this lane) ──
  // assignRoster leaks OFF days: when an employee picks up a surplus OFF early in
  // the week (allowed while offUsed < allowance), the PRE-PLANNED OFFs (offToday)
  // on later days are still applied without re-checking offUsed → 3 OFFs vs the
  // offDaysPerWeek=2 allowance, contradicting the engine's own "OFF days never
  // leak" comment. it.failing = documents the bug while keeping the suite green;
  // flip to it(...) once demand.engine.ts is fixed.
  it('nobody exceeds offDaysPerWeek OFF days', () => {
    const result = run();
    const grouped = byEmployee(result.assignments);
    for (const [, rows] of grouped) {
      const offs = rows.filter((r) => r.code === 'OFF').length;
      expect(offs).toBeLessThanOrEqual(OPTS.offDaysPerWeek);
    }
  });

  // ── KNOWN ENGINE BUG (reported, engine intentionally NOT edited by this lane) ──
  // The forced-OFF pre-pass counts every date as a working day (c++ per date,
  // never crediting the OFFs it is about to place), so with priorConsecutive=0
  // EVERY employee gets a forced OFF on day 7 → the whole pool is OFF on the
  // last day of the week and ALL of that day's demand returns unfilled.
  it('the last day of the week is staffed (not a full-pool forced OFF)', () => {
    const result = run();
    const lastDay = DATES[6];
    const workingLastDay = result.assignments.filter(
      (a) => a.date === lastDay && a.code !== 'OFF' && a.code !== 'L',
    );
    expect(workingLastDay.length).toBeGreaterThan(0);
  });

  it('females are never assigned blocked shifts (E/EE/MD/MN)', () => {
    const result = run();
    const femaleIds = new Set(pool.filter((e) => e.gender === 'female').map((e) => e.id));
    for (const a of result.assignments) {
      if (!femaleIds.has(a.employeeId)) continue;
      expect(['E', 'EE', 'MD', 'MN']).not.toContain(a.code);
    }
  });

  it('reports unfillable MD demand honestly when only a refund employee exists', () => {
    const oneDay = [DATES[0]];
    const result = assignRoster(
      oneDay,
      mixFor(oneDay, { MD: 1 }),
      [emp('r1', 'male', 'Refund Team')],
      emptyDist,
      emptyLast,
      noPrior,
      OPTS,
    );
    // The gap is surfaced, never silently filled with an ineligible employee
    expect(result.unfilled).toHaveLength(1);
    expect(result.unfilled[0].code).toBe('MD');
    expect(result.assignments.filter((a) => a.code === 'MD')).toHaveLength(0);
  });

  it('outbound employee takes B when demand asks for M/MD they cannot work', () => {
    const oneDay = [DATES[0]];
    const result = assignRoster(
      oneDay,
      mixFor(oneDay, { M: 2, B: 1, MD: 1 }),
      [emp('om1', 'male', 'Outbound', 'fn2')],
      emptyDist,
      emptyLast,
      noPrior,
      OPTS,
    );
    const rows = result.assignments.filter((a) => a.employeeId === 'om1');
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('B');
    // The M×2 and MD demand come back as honest gaps
    const gapCodes = result.unfilled.map((u) => u.code).sort();
    expect(gapCodes).toEqual(['M', 'M', 'MD']);
  });

  it('approved leave dates get L and are excluded from staffing', () => {
    const leaveDates = new Set([DATES[2], DATES[3]]);
    const onLeave = new Map<string, Set<string>>([['m-a', leaveDates]]);
    const result = assignRoster(DATES, mixByDate, pool, emptyDist, emptyLast, noPrior, {
      ...OPTS,
      onLeave,
    });
    const rows = result.assignments.filter((a) => a.employeeId === 'm-a');
    for (const d of leaveDates) {
      const day = rows.find((r) => r.date === d)!;
      expect(day.code).toBe('L');
    }
    // Exactly the approved dates carry L — leave is never expanded or dropped
    expect(rows.filter((r) => r.code === 'L')).toHaveLength(2);
    // (OFF-allowance ceiling not asserted here — see the it.failing OFF-leak
    //  spec above: the engine currently over-grants OFFs.)
  });
});
