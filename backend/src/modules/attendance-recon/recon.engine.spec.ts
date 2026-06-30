import { reconcileDay } from './recon.engine';

// Shift 09:00–18:00 → 540..1080 (minutes from midnight)
const SHIFT = { shiftStartMin: 540, shiftEndMin: 1080 };

describe('reconcileDay — presence', () => {
  it('system + punch = office', () => {
    expect(reconcileDay({ ...SHIFT, systemStartMin: 540, systemEndMin: 1080, punchInMin: 540, punchOutMin: 1080 }).presence).toBe('office');
  });
  it('system, no punch = office (MISSING PUNCH, not WFH — WFH only from a WFH code/location)', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 540, systemEndMin: 1080, punchInMin: null, punchOutMin: null });
    expect(r.presence).toBe('office');
    expect(r.flags).toContain('missing_punch');
  });
  it('punch, no system = anomaly', () => {
    expect(reconcileDay({ ...SHIFT, systemStartMin: null, systemEndMin: null, punchInMin: 540, punchOutMin: 1080 }).presence).toBe('anomaly');
  });
  it('neither = absent', () => {
    expect(reconcileDay({ ...SHIFT, systemStartMin: null, systemEndMin: null, punchInMin: null, punchOutMin: null }).presence).toBe('absent');
  });
});

describe('reconcileDay — late: compensation always, deduction after 20', () => {
  it('late 3 min → owes 3, no deduction', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 543, systemEndMin: 1080, punchInMin: 543, punchOutMin: 1080 });
    expect(r.punchLateMin).toBe(3);
    expect(r.compensationOwedMin).toBe(3);
    expect(r.deductionApplies).toBe(false);
  });
  it('late 25 min → owes 25, deduction applies', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 565, systemEndMin: 1080, punchInMin: 565, punchOutMin: 1080 });
    expect(r.compensationOwedMin).toBe(25);
    expect(r.deductionApplies).toBe(true);
  });
  it('late exactly 20 → no deduction (threshold is >20)', () => {
    expect(reconcileDay({ ...SHIFT, systemStartMin: 560, systemEndMin: 1080, punchInMin: 560, punchOutMin: 1080 }).deductionApplies).toBe(false);
  });
  it('approved permission exempts the late', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 570, systemEndMin: 1080, punchInMin: 570, punchOutMin: 1080, approvedLateMin: 30 });
    expect(r.effectiveLateMin).toBe(0);
    expect(r.deductionApplies).toBe(false);
    expect(r.flags).toContain('late_covered_by_permission');
  });
});

describe('reconcileDay — system-only (no punch) uses system late', () => {
  it('system-only late 10 → governed by system (office / missing-punch, not WFH)', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 550, systemEndMin: 1080, punchInMin: null, punchOutMin: null });
    expect(r.presence).toBe('office');
    expect(r.effectiveLateMin).toBe(10);
  });
});

describe('reconcileDay — overtime before vs after', () => {
  it('started 30 before shift → OT-before', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 510, systemEndMin: 1080, punchInMin: 510, punchOutMin: 1080 });
    expect(r.otBeforeMin).toBe(30);
    expect(r.otAfterMin).toBe(0);
  });
  it('stayed 45 after shift → OT-after', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 540, systemEndMin: 1125, punchInMin: 540, punchOutMin: 1125 });
    expect(r.otAfterMin).toBe(45);
    expect(r.otBeforeMin).toBe(0);
  });
});

describe('reconcileDay — cross-midnight (MD 22:00→07:00)', () => {
  // 22:00=1320 start, 07:00=420 end (next day)
  const MD = { shiftStartMin: 1320, shiftEndMin: 420 };
  it('punch out at 07:00 → no early-out, no OT-after', () => {
    const r = reconcileDay({ ...MD, systemStartMin: 1320, systemEndMin: 420, punchInMin: 1320, punchOutMin: 420 });
    expect(r.punchEarlyOutMin).toBe(0);
    expect(r.otAfterMin).toBe(0);
  });
  it('stayed to 07:30 → OT-after 30', () => {
    const r = reconcileDay({ ...MD, systemStartMin: 1320, systemEndMin: 450, punchInMin: 1320, punchOutMin: 450 });
    expect(r.otAfterMin).toBe(30);
  });
  it('left at 06:30 → early-out 30', () => {
    const r = reconcileDay({ ...MD, systemStartMin: 1320, systemEndMin: 390, punchInMin: 1320, punchOutMin: 390 });
    expect(r.punchEarlyOutMin).toBe(30);
  });
});

describe('reconcileDay — early out', () => {
  it('left 10 early, no permission', () => {
    const r = reconcileDay({ ...SHIFT, systemStartMin: 540, systemEndMin: 1070, punchInMin: 540, punchOutMin: 1070 });
    expect(r.effectiveEarlyOutMin).toBe(10);
  });
});
