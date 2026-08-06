/**
 * Specs for the demand-driven roster engine (Phase 2 — assignRoster).
 * Locks in:
 *   • per-function operating hours: /refund/ never gets MD/MN; /outbound/ only B or N
 *   • the weekly OFF allowance is never exceeded
 *   • unfillable demand is reported honestly (never hidden)
 */
import { assignRoster, computeShiftMix, DemandAssignment } from './demand.engine';
import { buildWeekDates } from './generator.engine';
import { EmployeeInfo, ShiftDef, ShiftDistribution, SHIFTS } from './generator.types';

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
      { ...OPTS, offDaysPerWeek: 0 },   // 1-day probe of SHIFT assignment — no OFF allowance (2 OFF in 1 day is degenerate; the coverage-floor placement would otherwise rest this sole employee)
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

// ─── computeShiftMix: edge-patch pass (window open/close coverage) ───────────
// The greedy alone favors mid-day shifts (B/C) and strands the window edges —
// 08:00 is coverable ONLY by M, 18–20 only by C/N/EE. The patch pass must fix
// coverable edges and never inflate the body count.

describe('computeShiftMix (edge-patch pass)', () => {
  // required = 2 concurrent across an 08:00–20:00 operating window
  const windowCurve = Array.from({ length: 48 }, (_, i) => (i >= 16 && i < 40 ? 2 : 0));

  it('fully covers a 2-flat 08–20 window with 4 bodies (2×M + 2×C shape)', () => {
    const day = computeShiftMix('2026-07-11', windowCurve, 4);
    expect(day.residualGaps).toHaveLength(0);
    expect(Object.values(day.mix).reduce((a, b) => a + b, 0)).toBe(4);
    // 08:00–09:00 is only reachable by M — the patch must have placed two of them
    expect(day.mix['M']).toBe(2);
  });

  it('never places redundant bodies when uncapped (4 suffice, greedy alone used 5)', () => {
    const day = computeShiftMix('2026-07-11', windowCurve, Number.MAX_SAFE_INTEGER);
    expect(day.residualGaps).toHaveLength(0);
    expect(Object.values(day.mix).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('with an infeasible ceiling the residual is honest and minimal-total', () => {
    const day = computeShiftMix('2026-07-11', windowCurve, 2);
    // 2 bodies × 9h = 36 covered slot-units vs 48 required → 12 must remain
    const totalDeficit = day.requiredCurve
      .reduce((s, r, i) => s + Math.max(0, r - day.staffedCurve[i]), 0);
    expect(Object.values(day.mix).reduce((a, b) => a + b, 0)).toBe(2);
    expect(totalDeficit).toBe(12);
  });

  it('worst-interval deficit is patched down when total allows (−2@08:00 → −1)', () => {
    // required: 4 at 08–09 (window open), 2 across 09–20; ceiling 5.
    // Greedy alone: B,B,C,M,M → −2 at 08:00. Patched: −1 worst, smaller total.
    const curve = Array.from({ length: 48 }, (_, i) =>
      (i >= 16 && i < 18 ? 4 : i >= 18 && i < 40 ? 2 : 0));
    const day = computeShiftMix('2026-07-11', curve, 5);
    const worst = Math.max(...day.requiredCurve.map((r, i) => r - day.staffedCurve[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });
});

// ─── Behavioral-merge options (Director-approved 2026-07-08) ─────────────────

describe('assignRoster — weekend-fair OFF structure + rotation-band fairness', () => {
  const males = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id) => emp(id, 'male', 'Customer Care'));
  const emptyDist = new Map<string, ShiftDistribution>();
  const emptyLast = new Map<string, ShiftDef>();
  const noPrior = new Map<string, number>();
  const mixByDate = mixFor(DATES, { M: 2, C: 2, N: 1 });

  it('weekend-fair: exactly 2 OFF each — one on Thu/Fri/Sat, one mid-week, never adjacent-only weekend pair', () => {
    const result = assignRoster(DATES, mixByDate, males, emptyDist, emptyLast, noPrior, {
      ...OPTS, offStrategy: 'weekend-fair',
    });
    // Sat-start week: [0]=Sat [1]=Sun [2]=Mon [3]=Tue [4]=Wed [5]=Thu [6]=Fri.
    // Weekend is Thu+Fri+Sat (2026-08-06 ruling) — Saturday belongs here now, and
    // this spec pinned it to Thu/Fri only, which is why OFF placement kept Saturday
    // out of the weekend pool while every fairness report counted it as one.
    const weekend = new Set([DATES[0], DATES[5], DATES[6]]);
    for (const [, rows] of byEmployee(result.assignments)) {
      const offs = rows.filter((r) => r.code === 'OFF').map((r) => r.date);
      expect(offs).toHaveLength(2);
      expect(offs.filter((d) => weekend.has(d))).toHaveLength(1);
      expect(offs.filter((d) => !weekend.has(d))).toHaveLength(1);
    }
  });

  it('rotation-band: the band-matching employee wins the shift among equally-fair peers', () => {
    const oneDay = [DATES[0]];
    // z-late worked night last week → target band 'afternoon' (C). a-early worked
    // afternoon → target 'morning'. Without the flag the id tiebreak gives C to
    // a-early; with it, rotation sends z-late to C and a-early to M.
    const pool = [emp('a-early', 'male', 'Customer Care'), emp('z-late', 'male', 'Customer Care')];
    const last = new Map<string, ShiftDef>([['z-late', SHIFTS.N], ['a-early', SHIFTS.C]]);
    const mix = mixFor(oneDay, { C: 1, M: 1 });

    // 1-day probe of ROTATION fairness on the shift assignment — no OFF allowance
    // (2 OFF in 1 day is degenerate; the coverage-floor placement would otherwise
    // rest one of the two and leave a shift unassigned).
    const plain = assignRoster(oneDay, mix, pool, emptyDist, last, noPrior, { ...OPTS, offDaysPerWeek: 0 });
    expect(plain.assignments.find((a) => a.code === 'C')!.employeeId).toBe('a-early');

    const rotated = assignRoster(oneDay, mix, pool, emptyDist, last, noPrior, {
      ...OPTS, offDaysPerWeek: 0, rotationFairness: true,
    });
    expect(rotated.assignments.find((a) => a.code === 'C')!.employeeId).toBe('z-late');
    expect(rotated.assignments.find((a) => a.code === 'M')!.employeeId).toBe('a-early');
  });

  it('rotation-band never routes a female toward a blocked band (stays morning/afternoon)', () => {
    const pool = [emp('f-x', 'female', 'Customer Care'), emp('m-x', 'male', 'Customer Care')];
    // Her last category was afternoon → mixed cycle says 'morning' next; a male
    // coming off midnight targets 'night'. She must never receive E/EE/MD/MN.
    const last = new Map<string, ShiftDef>([['f-x', SHIFTS.C], ['m-x', SHIFTS.MD]]);
    const result = assignRoster(DATES, mixFor(DATES, { M: 1, E: 1 }), pool, emptyDist, last, noPrior, {
      ...OPTS, rotationFairness: true,
    });
    for (const a of result.assignments.filter((x) => x.employeeId === 'f-x')) {
      expect(['E', 'EE', 'MD', 'MN']).not.toContain(a.code);
    }
  });
});

// ─── Coverage floor: a whole (small) function can never go OFF on one day ────
// Regression guard for the 2026-07-08 concentration bug (a 13-person function had
// 11/13 OFF on a single day — zero coverage). Per-function pools run assignRoster
// independently, so the OFF distribution MUST stay balanced with a hard per-day cap.
describe('assignRoster — per-function OFF coverage floor', () => {
  const emptyDist = new Map<string, ShiftDistribution>();
  const emptyLast = new Map<string, ShiftDef>();
  const noPrior = new Map<string, number>();

  for (const n of [13, 8, 6, 3, 2]) {
    it(`n=${n}: no day exceeds the even-share OFF cap, everyone gets exactly the allowance`, () => {
      const pool = Array.from({ length: n }, (_, i) => emp(`e${i}`, 'male', 'Customer Care'));
      // low, flat demand → the OLD engine dumped everyone OFF on the lowest-demand day
      const result = assignRoster(DATES, mixFor(DATES, { M: 1, C: 1 }), pool, emptyDist, emptyLast, noPrior, OPTS);
      const dayCap = Math.max(1, Math.ceil(n * OPTS.offDaysPerWeek / DATES.length));
      const offPerDay = new Map<string, number>(DATES.map((d) => [d, 0]));
      for (const a of result.assignments) if (a.code === 'OFF') offPerDay.set(a.date, offPerDay.get(a.date)! + 1);
      for (const [, cnt] of offPerDay) expect(cnt).toBeLessThanOrEqual(dayCap);   // coverage floor holds
      for (const [, rows] of byEmployee(result.assignments)) {
        expect(rows.filter((r) => r.code === 'OFF')).toHaveLength(OPTS.offDaysPerWeek);   // exactly-2-off
      }
    });
  }
});
