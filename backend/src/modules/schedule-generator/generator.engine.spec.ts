/**
 * Specs for the pure schedule-generation engine.
 * Locks in the business rules from docs/knowledge/WFM_RULES_AND_DECISIONS.md:
 *   • rest calculation (cross-midnight aware, OFF/null = unlimited)
 *   • female shift rules (E/EE/MD/MN always blocked; N warn unless allowed)
 *   • weekly OFF allowance (exactly offDaysPerWeek, no 3+ consecutive OFF)
 *   • approved leave 'L' (not working, never consumes the OFF allowance)
 *   • classifier parity with the ONE canonical mapping (common/shift-category)
 */
import {
  calcRestHours,
  validateShift,
  generateWeeklySchedule,
  buildWeekDates,
} from './generator.engine';
import {
  SHIFTS,
  EmployeeInfo,
  ShiftDef,
  ShiftDistribution,
  GeneratorOptions,
  functionAllowsFemaleLate,
  allowedShiftCodes,
} from './generator.types';
import { shiftCategoryFromCode } from '../../common/shift-category';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEK_START = '2026-07-04'; // a Saturday (workforce week starts Saturday)

function opts(over: Partial<GeneratorOptions> = {}): GeneratorOptions {
  return {
    minRestHours: 10,
    offDaysPerWeek: 2,
    internProductivity: 0.7,
    allowFemaleN: false,
    weeks: 1,
    ...over,
  };
}

function emp(
  id: string,
  gender: 'male' | 'female',
  functionName = 'Customer Care',
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

const FEMALE = emp('f1', 'female');
const MALE = emp('m1', 'male');

// ─── calcRestHours ────────────────────────────────────────────────────────────

describe('calcRestHours', () => {
  it('MD (22:00–07:00 cross-midnight) → M (07:00) next day = 0h rest (invalid)', () => {
    expect(calcRestHours(SHIFTS.MD, SHIFTS.M)).toBe(0);
  });

  it('MD → EE (18:00 start, SHIFTS.N2) = 11h rest (valid vs 10h minimum)', () => {
    expect(SHIFTS.N2.code).toBe('EE');
    expect(SHIFTS.N2.start).toBe('18:00');
    expect(calcRestHours(SHIFTS.MD, SHIFTS.N2)).toBe(11);
  });

  it('prev OFF or null → 999 (unlimited rest)', () => {
    expect(calcRestHours(SHIFTS.OFF, SHIFTS.M)).toBe(999);
    expect(calcRestHours(null, SHIFTS.M)).toBe(999);
  });

  it('non-cross-midnight prev: M (ends 16:00) → M (07:00 next day) = 15h', () => {
    expect(calcRestHours(SHIFTS.M, SHIFTS.M)).toBe(15);
  });
});

// ─── validateShift ────────────────────────────────────────────────────────────

describe('validateShift', () => {
  const BLOCKED_FOR_FEMALE: ShiftDef[] = [SHIFTS.E, SHIFTS.N2, SHIFTS.MD, SHIFTS.MN];

  it('female is ALWAYS blocked on E / EE / MD / MN — even with allowFemaleN=true', () => {
    for (const shift of BLOCKED_FOR_FEMALE) {
      expect(validateShift(FEMALE, shift, null, opts())).toContain(`female_blocked:${shift.code}`);
      expect(validateShift(FEMALE, shift, null, opts({ allowFemaleN: true }))).toContain(
        `female_blocked:${shift.code}`,
      );
    }
  });

  it('female on N = warn when allowFemaleN is off; clean when allowFemaleN is on', () => {
    expect(validateShift(FEMALE, SHIFTS.N, null, opts())).toContain('female_warn:N');
    const withOverride = validateShift(FEMALE, SHIFTS.N, null, opts({ allowFemaleN: true }));
    expect(withOverride.filter((v) => v.startsWith('female_'))).toEqual([]);
  });

  it('male has no gender violations on any shift (incl. midnight)', () => {
    for (const shift of [SHIFTS.N, SHIFTS.E, SHIFTS.N2, SHIFTS.MD, SHIFTS.MN]) {
      const v = validateShift(MALE, shift, null, opts());
      expect(v.filter((x) => x.startsWith('female_'))).toEqual([]);
    }
  });

  it('rest below minRestHours is flagged (MD → M = 0h)', () => {
    expect(validateShift(MALE, SHIFTS.M, SHIFTS.MD, opts())).toContain('rest:0h');
  });

  it('rest at/above minimum is NOT flagged (MD → EE = 11h ≥ 10h)', () => {
    const v = validateShift(MALE, SHIFTS.N2, SHIFTS.MD, opts());
    expect(v.filter((x) => x.startsWith('rest:'))).toEqual([]);
  });

  it('function-level female-late config: Outbound allows the late (warn) shift', () => {
    expect(functionAllowsFemaleLate('Outbound')).toBe(true);
    expect(functionAllowsFemaleLate('Customer Care')).toBe(false);
    expect(allowedShiftCodes('Outbound')).toEqual(new Set(['B', 'N']));
  });

  // Regression — the exception used to be answered differently in each place that
  // asked. Shift selection honoured the function config while validateShift only
  // read options.allowFemaleN, so every OMT woman was offered N and then vetoed,
  // and the team's 18:00–22:00 window could not be staffed at all. validateShift
  // must ask the same question.
  it('validateShift honours the per-function female-late exception, not just the global flag', () => {
    const outbound = emp('f-omt', 'female', 'Outbound', 'fn-omt');
    const care = emp('f-care', 'female', 'Customer Care', 'fn-care');

    expect(validateShift(outbound, SHIFTS.N, null, opts())).toEqual([]);
    expect(validateShift(care, SHIFTS.N, null, opts())).toContain('female_warn:N');

    // the per-run pick grants it too
    expect(validateShift(care, SHIFTS.N, null, opts({ femaleLateFunctionIds: ['fn-care'] }))).toEqual([]);

    // and it NEVER reaches a blocked shift, whichever source grants it
    for (const o of [opts(), opts({ allowFemaleN: true }), opts({ femaleLateFunctionIds: ['fn-omt'] })]) {
      for (const s of [SHIFTS.E, SHIFTS.N2, SHIFTS.MD, SHIFTS.MN]) {
        expect(validateShift(outbound, s, null, o)).toContain(`female_blocked:${s.code}`);
      }
    }
  });
});

// ─── generateWeeklySchedule ───────────────────────────────────────────────────

describe('generateWeeklySchedule', () => {
  const pool: EmployeeInfo[] = [
    emp('m1', 'male'),
    emp('m2', 'male'),
    emp('m3', 'male'),
    emp('m4', 'male'),
    emp('f1', 'female'),
    emp('f2', 'female'),
  ];
  const byFunction = [{ id: 'fn1', name: 'Customer Care', employees: pool }];
  const emptyDist = new Map<string, ShiftDistribution>();
  const emptyLast = new Map<string, ShiftDef>();

  function run(onLeave?: Map<string, Set<string>>) {
    return generateWeeklySchedule(
      byFunction,
      emptyDist,
      emptyLast,
      WEEK_START,
      opts(),
      undefined,
      onLeave,
    );
  }

  it('every employee gets EXACTLY offDaysPerWeek (2) OFF days in the week', () => {
    const result = run();
    const schedules = result.functions[0].employees;
    expect(schedules).toHaveLength(pool.length);
    for (const es of schedules) {
      expect(es.assignments).toHaveLength(7);
      expect(es.weekStats.offCount).toBe(2);
    }
    expect(result.summary.offAssigned).toBe(pool.length * 2);
  });

  it('no employee has 3+ consecutive OFF days', () => {
    const result = run();
    for (const es of result.functions[0].employees) {
      let runLen = 0;
      let maxRun = 0;
      for (const a of es.assignments) {
        runLen = a.shift.code === 'OFF' ? runLen + 1 : 0;
        maxRun = Math.max(maxRun, runLen);
      }
      expect(maxRun).toBeLessThanOrEqual(2);
    }
  });

  it('females are NEVER assigned E / EE / MD / MN', () => {
    const result = run();
    const blocked = ['E', 'EE', 'MD', 'MN'];
    for (const es of result.functions[0].employees) {
      if (es.employee.gender !== 'female') continue;
      for (const a of es.assignments) {
        expect(blocked).not.toContain(a.shift.code);
      }
    }
    // and no female_blocked violation appears anywhere
    expect(result.violations.filter((v) => v.type === 'female_blocked')).toEqual([]);
  });

  it('approved leave dates get L markers — not working, not consuming the OFF allowance', () => {
    // Determine 2 working dates for m1 from a leave-free run (OFF placement is
    // deterministic and independent of onLeave, so those OFF dates stay put).
    const baseline = run();
    const m1Base = baseline.functions[0].employees.find((es) => es.employee.id === 'm1')!;
    const leaveDates = m1Base.assignments
      .filter((a) => a.shift.code !== 'OFF')
      .slice(0, 2)
      .map((a) => a.date);
    expect(leaveDates).toHaveLength(2);

    const onLeave = new Map<string, Set<string>>([['m1', new Set(leaveDates)]]);
    const result = run(onLeave);
    const m1 = result.functions[0].employees.find((es) => es.employee.id === 'm1')!;

    // Leave markers exactly on the approved dates
    for (const d of leaveDates) {
      const day = m1.assignments.find((a) => a.date === d)!;
      expect(day.shift.code).toBe('L');
      expect(day.violations).toEqual([]);
    }
    expect(m1.assignments.filter((a) => a.shift.code === 'L')).toHaveLength(2);
    // L days are neither OFF nor working: OFF allowance still fully honored
    expect(m1.weekStats.offCount).toBe(2);
    // 7 days = 2 L + 2 OFF + 3 working
    const working = m1.assignments.filter(
      (a) => a.shift.code !== 'OFF' && a.shift.code !== 'L',
    );
    expect(working).toHaveLength(3);
    // Coverage never counts L as working
    for (const d of leaveDates) {
      const covWith = result.coverage.find((c) => c.date === d)!;
      const covBase = baseline.coverage.find((c) => c.date === d)!;
      expect(covWith.working).toBe(covBase.working - 1);
    }
  });

  it('restricted all-female function (Outbound) only uses its allowed codes B/N', () => {
    const outbound = [
      emp('of1', 'female', 'Outbound', 'fn2'),
      emp('of2', 'female', 'Outbound', 'fn2'),
    ];
    const result = generateWeeklySchedule(
      [{ id: 'fn2', name: 'Outbound', employees: outbound }],
      emptyDist,
      emptyLast,
      WEEK_START,
      opts(),
    );
    for (const es of result.functions[0].employees) {
      for (const a of es.assignments) {
        expect(['B', 'N', 'OFF', 'L']).toContain(a.shift.code);
      }
    }
  });

  it('buildWeekDates returns 7 consecutive dates starting at weekStart', () => {
    const dates = buildWeekDates(WEEK_START);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-07-04');
    expect(dates[6]).toBe('2026-07-10');
  });
});

// ─── Classifier parity with the ONE canonical mapping ─────────────────────────

describe('canonical shift-category classifier parity (common/shift-category)', () => {
  it('M / B / C / AM → morning', () => {
    for (const code of ['M', 'B', 'C', 'AM']) {
      expect(shiftCategoryFromCode(code)).toBe('morning');
    }
  });

  it('N / N20 → night', () => {
    expect(shiftCategoryFromCode('N')).toBe('night');
    expect(shiftCategoryFromCode('N20')).toBe('night');
  });

  it('E / EE20 → evening', () => {
    expect(shiftCategoryFromCode('E')).toBe('evening');
    expect(shiftCategoryFromCode('EE20')).toBe('evening');
  });

  it('MD / MN → midnight', () => {
    expect(shiftCategoryFromCode('MD')).toBe('midnight');
    expect(shiftCategoryFromCode('MN')).toBe('midnight');
  });
});
