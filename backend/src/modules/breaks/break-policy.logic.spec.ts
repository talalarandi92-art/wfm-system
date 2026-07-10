import {
  BreakPolicyV2Row,
  computeEntitlement,
  functionSimultaneousCap,
  generationWindow,
  pickMostSpecificPolicy,
  plannedDateFor,
  sessionPattern,
  slotPositionBucket,
  wallClockHHMM,
} from './break-policy.logic';

const mkPolicy = (over: Partial<BreakPolicyV2Row> = {}): BreakPolicyV2Row => ({
  id: over.id ?? 'p-default',
  tenant_id: 't1',
  function_name: null,
  shift_type: null,
  employment_type: null,
  total_daily_minutes: 60,
  max_sessions: 4,
  duration_pattern: [15, 15, 15, 15],
  protected_first_min: 60,
  protected_last_min: 60,
  min_gap_between_breaks_min: 90,
  min_work_before_first_min: 60,
  max_delay_min: 45,
  release_mode: 'hybrid',
  thresholds: { coverage_ratio: 0.7, max_simultaneous_per_team: 1 },
  active: true,
  ...over,
});

describe('pickMostSpecificPolicy — most-specific wins', () => {
  const def = mkPolicy({ id: 'def' });
  const fnOnly = mkPolicy({ id: 'fn', function_name: 'Customer Care' });
  const fnShift = mkPolicy({ id: 'fn+shift', function_name: 'Customer Care', shift_type: 'N' });
  const fnShiftEmp = mkPolicy({ id: 'fn+shift+emp', function_name: 'Customer Care', shift_type: 'N', employment_type: 'intern' });
  const shiftOnly = mkPolicy({ id: 'shift', shift_type: 'N' });
  const all = [def, fnOnly, fnShift, fnShiftEmp, shiftOnly];

  it('falls back to the tenant default when nothing matches', () => {
    expect(pickMostSpecificPolicy(all, 'Social Media', 'M', 'full_time')?.id).toBe('def');
  });

  it('function-only beats default', () => {
    expect(pickMostSpecificPolicy(all, 'Customer Care', 'M', 'full_time')?.id).toBe('fn');
  });

  it('function+shift beats function-only', () => {
    expect(pickMostSpecificPolicy(all, 'Customer Care', 'N', 'full_time')?.id).toBe('fn+shift');
  });

  it('function+shift+employment is the most specific', () => {
    expect(pickMostSpecificPolicy(all, 'Customer Care', 'N', 'intern')?.id).toBe('fn+shift+emp');
  });

  it('function beats shift-only (function weighs more)', () => {
    expect(pickMostSpecificPolicy(all, 'Customer Care', 'N', undefined)?.id).toBe('fn+shift');
    expect(pickMostSpecificPolicy([def, fnOnly, shiftOnly], 'Customer Care', 'N', null)?.id).toBe('fn');
  });

  it('shift-only beats default when no function row matches', () => {
    expect(pickMostSpecificPolicy(all, 'Support', 'N', null)?.id).toBe('shift');
  });

  it('inactive rows never match; matching is case-insensitive', () => {
    const inactive = mkPolicy({ id: 'x', function_name: 'Customer Care', active: false });
    expect(pickMostSpecificPolicy([def, inactive], 'customer care', null, null)?.id).toBe('def');
    expect(pickMostSpecificPolicy([def, fnOnly], 'CUSTOMER CARE', null, null)?.id).toBe('fn');
  });

  it('returns null when nothing matches at all', () => {
    expect(pickMostSpecificPolicy([fnOnly], 'Support', null, null)).toBeNull();
  });
});

describe('sessionPattern — pattern capped by sessions and total minutes', () => {
  it('returns the configured pattern', () => {
    expect(sessionPattern(mkPolicy())).toEqual([15, 15, 15, 15]);
  });
  it('caps at max_sessions', () => {
    expect(sessionPattern(mkPolicy({ max_sessions: 2 }))).toEqual([15, 15]);
  });
  it('never exceeds total_daily_minutes (trims the overflowing session)', () => {
    expect(sessionPattern(mkPolicy({ duration_pattern: [30, 30, 30], total_daily_minutes: 70 })))
      .toEqual([30, 30, 10]);
  });
  it('drops a trailing residual smaller than 5 minutes', () => {
    expect(sessionPattern(mkPolicy({ duration_pattern: [30, 30, 30], total_daily_minutes: 63 })))
      .toEqual([30, 30]);
  });
  it('supports asymmetric patterns like 10+20+10+20', () => {
    expect(sessionPattern(mkPolicy({ duration_pattern: [10, 20, 10, 20] }))).toEqual([10, 20, 10, 20]);
  });
});

describe('computeEntitlement — daily balance enforcement', () => {
  it('allows within limits', () => {
    const r = computeEntitlement(60, 4, 30, 2, 15);
    expect(r.allowed).toBe(true);
    expect(r.remainingMin).toBe(30);
    expect(r.remainingSessions).toBe(2);
  });
  it('rejects when session count is exhausted', () => {
    const r = computeEntitlement(60, 4, 45, 4, 15);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('session limit');
    expect(r.reasonAr).toBeTruthy();
  });
  it('rejects when minutes are exhausted', () => {
    const r = computeEntitlement(60, 4, 55, 2, 15);
    expect(r.allowed).toBe(false);
    expect(r.remainingMin).toBe(5);
    expect(r.reason).toContain('exceeds remaining');
  });
  it('exact remaining minutes are allowed', () => {
    expect(computeEntitlement(60, 4, 45, 3, 15).allowed).toBe(true);
  });
});

describe('generationWindow — protected first/last hours', () => {
  const policy = { protected_first_min: 60, protected_last_min: 60, min_work_before_first_min: 60 };

  it('9h shift, 15m break → window [60, 405] (no start in first hour, no end in last hour)', () => {
    const w = generationWindow(540, 15, policy);
    expect(w).toEqual({ earliestStartMin: 60, latestStartMin: 540 - 60 - 15 });
  });

  it('min_work_before_first dominates the protected first window when larger', () => {
    const w = generationWindow(540, 15, { ...policy, min_work_before_first_min: 120 });
    expect(w?.earliestStartMin).toBe(120);
  });

  it('a break can never END inside the protected last window', () => {
    const w = generationWindow(540, 30, policy)!;
    expect(w.latestStartMin + 30).toBe(540 - 60); // end lands exactly at the protected boundary
  });

  it('too-short shift yields null', () => {
    expect(generationWindow(120, 15, policy)).toBeNull();
  });
});

describe('cross-midnight slot dating', () => {
  it('same-day slot keeps the schedule date (MD shift 22:00, break +60min → 23:00 same day)', () => {
    expect(plannedDateFor('2026-07-01', 22 * 60, 60)).toBe('2026-07-01');
    expect(wallClockHHMM(22 * 60, 60)).toBe('23:00');
  });
  it('slot past midnight belongs to the NEXT calendar day', () => {
    expect(plannedDateFor('2026-07-01', 22 * 60, 180)).toBe('2026-07-02'); // 22:00 + 3h = 01:00 next day
    expect(wallClockHHMM(22 * 60, 180)).toBe('01:00');
  });
  it('month rollover is correct', () => {
    expect(plannedDateFor('2026-06-30', 23 * 60, 120)).toBe('2026-07-01');
  });
  it('exact midnight belongs to the next day', () => {
    expect(plannedDateFor('2026-07-01', 22 * 60, 120)).toBe('2026-07-02');
    expect(wallClockHHMM(22 * 60, 120)).toBe('00:00');
  });
});

describe('slotPositionBucket — fairness ledger classification', () => {
  it('classifies thirds of the shift', () => {
    expect(slotPositionBucket(60, 540)).toBe('early');
    expect(slotPositionBucket(270, 540)).toBe('mid');
    expect(slotPositionBucket(420, 540)).toBe('late');
  });
});

describe('functionSimultaneousCap — anti-clustering', () => {
  it('uses the explicit threshold when configured', () => {
    expect(functionSimultaneousCap(30, 20, { max_simultaneous: 5 })).toBe(5);
  });
  it('uses real surplus when a demand source exists', () => {
    expect(functionSimultaneousCap(30, 22, {})).toBe(8);
  });
  it('falls back to coverage-ratio headroom in the degenerate required==scheduled case', () => {
    expect(functionSimultaneousCap(30, 30, {}, 0.7)).toBe(9); // floor(30 × 0.3)
  });
  it('never returns less than 1', () => {
    expect(functionSimultaneousCap(2, 2, {}, 0.7)).toBe(1);
  });
});
