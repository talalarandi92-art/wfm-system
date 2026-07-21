/**
 * Specs for the Stage-2A verdict/quality layer (verdict.engine.ts).
 * Fixture-based — locks in:
 *   • buildGenerateVerdict: the UI-ready verdict shape, self-verifying rule
 *     recounts (female-blocked, rest<10h, OFF allowance, consecutive days),
 *     coverage math from the 48-slot curves, unfilled-with-reasons grouping.
 *   • scoreScheduleQuality: grading a saved window from roster_days-shaped rows —
 *     rest violations from real minutes, female midnight detection, OFF
 *     distribution, coverage vs baseline, honest no-baseline omission.
 *   • fairnessFromDistributions: the calcFairness REUSE bridge.
 */
import {
  buildGenerateVerdict,
  recountCompliance,
  scoreScheduleQuality,
  fairnessFromDistributions,
  GenerateVerdictInput,
  VerdictGridRow,
  QualityRow,
} from './verdict.engine';
import { buildWeekDates } from './generator.engine';
import { ShiftDistribution } from './generator.types';

const WEEK_START = '2026-07-25'; // Saturday
const DATES = buildWeekDates(WEEK_START);

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** days record from a code sequence aligned to DATES */
function daysOf(codes: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  codes.forEach((c, i) => { out[DATES[i]] = c; });
  return out;
}

function gridRow(name: string, gender: string, fn: string, codes: string[]): VerdictGridRow {
  return { employeeId: name, name, gender, functionName: fn, days: daysOf(codes) };
}

/** Flat 48-slot curve builder: value v on [fromSlot, toSlot) */
function curve(v: number, fromSlot = 0, toSlot = 48): number[] {
  return Array.from({ length: 48 }, (_, i) => (i >= fromSlot && i < toSlot ? v : 0));
}

const CLEAN_GRID: VerdictGridRow[] = [
  // male: M M B OFF C N OFF — legal rests, 2 OFF
  gridRow('m1', 'male', 'Customer Care', ['M', 'M', 'B', 'OFF', 'C', 'N', 'OFF']),
  // female: day-only rotation, 2 OFF
  gridRow('f1', 'female', 'Customer Care', ['B', 'C', 'OFF', 'M', 'B', 'OFF', 'C']),
  // male midnights: MD block then OFF, 2 OFF
  gridRow('m2', 'male', 'Customer Care', ['MD', 'MD', 'OFF', 'MD', 'MD', 'OFF', 'MD']),
];

function verdictInput(over: Partial<GenerateVerdictInput> = {}): GenerateVerdictInput {
  const fairness = fairnessFromDistributions([], new Map());
  return {
    dates: DATES,
    grid: CLEAN_GRID,
    days: DATES.map((date) => ({
      date,
      requiredCurve: curve(2, 16, 40),        // 2 HC across 08:00–20:00
      staffedCurve: curve(2, 16, 40),         // fully staffed
      residualGaps: [],
      riskStatus: 'safe',
      perFunction: [{ functionName: 'Customer Care', requiredPeak: 2, staffedPeak: 2, mix: { M: 1, C: 1 }, residualGaps: 0 }],
    })),
    unfilled: [],
    warnings: [],
    offDaysPerWeek: 2,
    minRestHours: 10,
    fairness,
    ...over,
  };
}

// ─── buildGenerateVerdict ────────────────────────────────────────────────────

describe('buildGenerateVerdict (shape + clean grid)', () => {
  const v = buildGenerateVerdict(verdictInput());

  it('carries the complete UI-ready shape', () => {
    expect(v).toEqual(expect.objectContaining({
      status: expect.any(String),
      score: expect.any(Number),
      headlineEn: expect.any(String),
      headlineAr: expect.any(String),
      scoreParts: expect.objectContaining({
        coveragePct: expect.any(Number),
        fairnessScore: expect.any(Number),
        complianceScore: expect.any(Number),
      }),
      coverage: expect.objectContaining({ totals: expect.any(Object), perDay: expect.any(Array) }),
      fairness: expect.objectContaining({ score: expect.any(Number), thisWeek: expect.any(Object) }),
      ruleCompliance: expect.any(Object),
      unfilled: expect.objectContaining({ total: 0, byReason: {}, items: [] }),
      unscheduled: expect.objectContaining({ people: 0 }),
    }));
  });

  it('clean grid → ready status, 100% coverage, zero violation counters', () => {
    expect(v.status).toBe('ready');
    expect(v.coverage.totals.coveragePct).toBe(100);
    expect(v.ruleCompliance.femaleNightViolations).toBe(0);
    expect(v.ruleCompliance.restViolations).toBe(0);
    expect(v.ruleCompliance.offPerWeekOk).toBe(true);
    expect(v.ruleCompliance.maxConsecutiveDays).toBeLessThanOrEqual(6);
    expect(v.ruleCompliance.consecutiveOk).toBe(true);
  });

  it('coverage math: 2 HC × 12h × 7d = 168 required person-hours, all covered', () => {
    expect(v.coverage.totals.requiredHours).toBe(168);
    expect(v.coverage.totals.coveredHours).toBe(168);
    expect(v.coverage.totals.surplusHours).toBe(0);
    expect(v.coverage.perDay).toHaveLength(7);
    expect(v.coverage.perDay[0].functions).toEqual([
      expect.objectContaining({ functionName: 'Customer Care', required: 2, staffed: 2, gap: 0 }),
    ]);
  });

  it('thisWeek hard-shift summary counts night/midnight from the grid', () => {
    expect(v.fairness.thisWeek.night.shifts).toBe(1);      // m1's single N
    expect(v.fairness.thisWeek.midnight.shifts).toBe(5);   // m2's 5 MDs
    expect(v.fairness.thisWeek.midnight.people).toBe(1);
    expect(v.fairness.thisWeek.midnight.eligibleMales).toBe(2);
  });
});

describe('buildGenerateVerdict (violations are recounted, never trusted)', () => {
  it('a female on MD in the final grid → femaleNightViolations>0 and critical status', () => {
    const grid = [
      ...CLEAN_GRID,
      gridRow('f-bad', 'female', 'Customer Care', ['MD', 'OFF', 'B', 'C', 'OFF', 'B', 'C']),
    ];
    const v = buildGenerateVerdict(verdictInput({ grid }));
    expect(v.ruleCompliance.femaleNightViolations).toBe(1);
    expect(v.ruleCompliance.femaleNightViolationSamples[0]).toContain('f-bad');
    expect(v.status).toBe('critical');
  });

  it('MD→M back-to-back (0h rest) → restViolations>0 with a sample', () => {
    const grid = [
      ...CLEAN_GRID,
      gridRow('m-tired', 'male', 'Customer Care', ['MD', 'M', 'OFF', 'B', 'C', 'OFF', 'B']),
    ];
    const v = buildGenerateVerdict(verdictInput({ grid }));
    expect(v.ruleCompliance.restViolations).toBeGreaterThan(0);
    expect(v.ruleCompliance.restViolationSamples[0]).toContain('MD→M');
    expect(v.status).toBe('critical');
  });

  it('females on N are WARN-tier assignments, never violations', () => {
    const grid = [
      ...CLEAN_GRID,
      gridRow('f-n', 'female', 'Outbound', ['N', 'OFF', 'B', 'N', 'OFF', 'B', 'N']),
    ];
    const v = buildGenerateVerdict(verdictInput({ grid }));
    expect(v.ruleCompliance.femaleNightViolations).toBe(0);
    expect(v.ruleCompliance.femaleLateAssignments).toBe(3);
  });

  it('3 OFF (over the allowance, no leave) → offPerWeekOk=false with the outlier named', () => {
    const grid = [
      ...CLEAN_GRID,
      gridRow('m-lazy', 'male', 'Customer Care', ['M', 'OFF', 'OFF', 'B', 'OFF', 'C', 'M']),
    ];
    const v = buildGenerateVerdict(verdictInput({ grid }));
    expect(v.ruleCompliance.offPerWeekOk).toBe(false);
    expect(v.ruleCompliance.offOutliers.join(' ')).toContain('m-lazy');
  });

  it('1 OFF + leave days is EXPLAINED (leave never counts against the allowance)', () => {
    const grid = [
      ...CLEAN_GRID,
      gridRow('m-leave', 'male', 'Customer Care', ['M', 'L', 'L', 'B', 'OFF', 'C', 'M']),
    ];
    const v = buildGenerateVerdict(verdictInput({ grid }));
    expect(v.ruleCompliance.offPerWeekOk).toBe(true);
  });

  it('7 straight working days → consecutiveOk=false', () => {
    const c = recountCompliance(
      [gridRow('m-run', 'male', 'CC', ['M', 'M', 'M', 'M', 'M', 'M', 'M'])],
      DATES, { minRestHours: 10, offDaysPerWeek: 2 },
    );
    expect(c.maxConsecutiveDays).toBe(7);
    expect(c.consecutiveOk).toBe(false);
  });
});

describe('buildGenerateVerdict (gaps + unfilled are surfaced honestly)', () => {
  it('understaffed curves → coverage<100, gap hours counted, review status', () => {
    const days = DATES.map((date) => ({
      date,
      requiredCurve: curve(4, 16, 40),   // need 4
      staffedCurve: curve(3, 16, 40),    // staffed 3
      residualGaps: [{ interval: '08:00', deficit: 1 }],
      riskStatus: 'critical',
      perFunction: [{ functionName: 'CC', requiredPeak: 4, staffedPeak: 3, mix: {}, residualGaps: 1 }],
    }));
    const v = buildGenerateVerdict(verdictInput({ days }));
    expect(v.coverage.totals.coveragePct).toBe(75);
    expect(v.coverage.totals.criticalDays).toBe(7);
    expect(v.coverage.perDay[0].functions[0].gap).toBe(-1);
    expect(v.status).toBe('review');
  });

  it('unfilled slots group by reason and by function', () => {
    const unfilled = [
      { date: DATES[0], code: 'E', reason: 'no eligible employee (rest/consecutive/gender constraints)', functionName: 'CH - WA' },
      { date: DATES[1], code: 'E', reason: 'no eligible employee (rest/consecutive/gender constraints)', functionName: 'CH - WA' },
      { date: DATES[2], code: 'MD', reason: 'constraint conflict', functionName: 'Social Media' },
    ];
    const v = buildGenerateVerdict(verdictInput({ unfilled }));
    expect(v.unfilled.total).toBe(3);
    expect(v.unfilled.byReason['no eligible employee (rest/consecutive/gender constraints)']).toBe(2);
    expect(v.unfilled.byFunction['CH - WA']).toBe(2);
    expect(v.unfilled.byFunction['Social Media']).toBe(1);
  });

  it('rows with no assignments are reported as unscheduled by function', () => {
    const grid = [...CLEAN_GRID, { name: 'x1', gender: 'male', functionName: 'Fraud', days: {} }];
    const v = buildGenerateVerdict(verdictInput({ grid }));
    expect(v.unscheduled.people).toBe(1);
    expect(v.unscheduled.byFunction['Fraud']).toBe(1);
  });
});

// ─── scoreScheduleQuality ────────────────────────────────────────────────────

function qRow(
  personNo: string, name: string, gender: string, fn: string, date: string,
  code: string | null, category: string, ss: number | null, se: number | null, presence: string,
): QualityRow {
  return { personNo, name, gender, fn, date, code, category, ss, se, presence };
}

/** A person's clean week: work M (07:00–16:00) 5 days + 2 OFF */
function cleanWeek(no: string, name: string, gender: string, fn = 'CC'): QualityRow[] {
  const codes = ['M', 'M', 'M', 'OFF', 'M', 'M', 'OFF'];
  return DATES.map((d, i) => codes[i] === 'OFF'
    ? qRow(no, name, gender, fn, d, 'OFF', 'other', null, null, 'off')
    : qRow(no, name, gender, fn, d, 'M', 'morning', 420, 960, 'office'));
}

describe('scoreScheduleQuality (saved-week grading)', () => {
  it('clean window → good status, zero violations, exact OFF distribution', () => {
    const rows = [...cleanWeek('1001', 'Alice', 'female'), ...cleanWeek('1002', 'Bob', 'male')];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.people).toBe(2);
    expect(q.ruleCompliance.femaleNightViolations).toBe(0);
    expect(q.ruleCompliance.restViolations).toBe(0);
    expect(q.ruleCompliance.offPerWeekOk).toBe(true);
    expect(q.ruleCompliance.offDistribution['2 OFF']).toBe(2);
    expect(q.status).not.toBe('critical');
    expect(typeof q.score).toBe('number');
    expect(['A', 'B', 'C', 'D']).toContain(q.grade);
  });

  it('female on a midnight row → femaleNightViolations + critical', () => {
    const rows = [
      ...cleanWeek('1001', 'Alice', 'female'),
      // overwrite her day 0 with a midnight shift (22:00→07:00, canonical end 1860)
      qRow('1001', 'Alice', 'female', 'CC', DATES[0], 'MD', 'midnight', 1320, 1860, 'office'),
    ];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.ruleCompliance.femaleNightViolations).toBeGreaterThan(0);
    expect(q.status).toBe('critical');
  });

  it('MD (ends 07:00) followed by M (starts 07:00) next day → rest violation (0h)', () => {
    const rows = [
      qRow('2001', 'Zed', 'male', 'CC', DATES[0], 'MD', 'midnight', 1320, 1860, 'office'),
      qRow('2001', 'Zed', 'male', 'CC', DATES[1], 'M', 'morning', 420, 960, 'office'),
    ];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.ruleCompliance.restViolations).toBe(1);
    expect(q.ruleCompliance.restViolationSamples[0]).toContain('Zed');
  });

  it('MD then EE20-style evening (18:00) is LEGAL rest (11h) — cross-midnight aware', () => {
    const rows = [
      qRow('2002', 'Ed', 'male', 'CC', DATES[0], 'MD', 'midnight', 1320, 1860, 'office'),
      qRow('2002', 'Ed', 'male', 'CC', DATES[1], 'EE', 'evening', 1080, 1560, 'office'),
    ];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.ruleCompliance.restViolations).toBe(0);
  });

  it('raw wall-clock end (se<ss) is treated as cross-midnight, not negative duration', () => {
    // MD stored raw: ss=1320, se=420 (07:00 wall clock) — duration must be 9h, so
    // the next-day 07:00 M start is a 0h-rest violation exactly as in canonical form.
    const rows = [
      qRow('2003', 'Raw', 'male', 'CC', DATES[0], 'MD', 'midnight', 1320, 420, 'office'),
      qRow('2003', 'Raw', 'male', 'CC', DATES[1], 'M', 'morning', 420, 960, 'office'),
    ];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.ruleCompliance.restViolations).toBe(1);
  });

  it('coverage vs baseline: fully-matching schedule scores 100, short hours are flagged', () => {
    const rows = [...cleanWeek('1001', 'Alice', 'female'), ...cleanWeek('1002', 'Bob', 'male')];
    // Baseline demands 2 HC across 07:00–15:00 (inside M window) → fully covered on
    // work days? Scheduled avg = working-day count/7 ≈ 1.43 per person-pair… use a
    // baseline of 1 to keep the fixture deterministic: avg scheduled ≥ 1 for 07–15.
    const baseline = { CC: Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 15 ? 1 : 0)) };
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2, baseline });
    expect(q.coverage.pct).toBeGreaterThan(99);
    const cc = q.coverage.byFunction.find((f: any) => f.fn === 'CC')!;
    expect(cc.verdict).toBe('ok');
    // night hours have no baseline demand → never flagged
    expect(cc.shortHours).toEqual([]);
  });

  it('no baseline → coverage honestly omitted (null), score reweights to fairness+compliance', () => {
    const rows = [...cleanWeek('1001', 'Alice', 'female')];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.coverage.pct).toBeNull();
    expect(q.coverage.basis).toContain('no pre-window baseline');
    expect(q.scoreParts.coveragePct).toBeNull();
    expect(typeof q.score).toBe('number');
  });

  it('shift-mix distribution counts codes and per-day working/off', () => {
    const rows = [...cleanWeek('1001', 'Alice', 'female'), ...cleanWeek('1002', 'Bob', 'male')];
    const q = scoreScheduleQuality({ rows, dates: DATES, minRestHours: 10, offDaysPerWeek: 2 });
    expect(q.shiftMix.byCode['M']).toBe(10);       // 5 M-days × 2 people
    expect(q.shiftMix.perDay).toHaveLength(7);
    expect(q.shiftMix.perDay[0]).toEqual(expect.objectContaining({ working: 2, off: 0 }));
    expect(q.shiftMix.byCategoryPct.morning).toBe(100);
  });
});

// ─── fairnessFromDistributions (the calcFairness reuse bridge) ───────────────

describe('fairnessFromDistributions', () => {
  const dist = (over: Partial<ShiftDistribution>): ShiftDistribution => ({
    morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0,
    off: 0, leave: 0, total: 0, byCodes: {}, weekendOff: 0, weekendWork: 0, maxConsecutive: 0,
    ...over,
  });

  it('perfectly even hard-shift load → higher score than a lopsided one', () => {
    const people = [
      { id: 'a', name: 'A', gender: 'male' },
      { id: 'b', name: 'B', gender: 'male' },
    ];
    const even = fairnessFromDistributions(people, new Map([
      ['a', dist({ night: 5, midnight: 5, morning: 10, total: 20 })],
      ['b', dist({ night: 5, midnight: 5, morning: 10, total: 20 })],
    ]));
    const lopsided = fairnessFromDistributions(people, new Map([
      ['a', dist({ night: 10, midnight: 10, total: 20 })],
      ['b', dist({ morning: 20, total: 20 })],
    ]));
    expect(even.score).toBeGreaterThan(lopsided.score);
    expect(lopsided.nightVariance).toBeGreaterThan(even.nightVariance);
  });

  it('female forced-zero midnights do NOT depress the score (rule-eligible pool only)', () => {
    const people = [
      { id: 'm', name: 'M', gender: 'male' },
      { id: 'f', name: 'F', gender: 'female' },
    ];
    const rep = fairnessFromDistributions(people, new Map([
      ['m', dist({ midnight: 10, total: 20, morning: 10 })],
      ['f', dist({ morning: 20, total: 20 })],
    ]));
    // midnight variance measured over males only → single male → variance 0
    expect(rep.midnightVariance).toBe(0);
  });
});
