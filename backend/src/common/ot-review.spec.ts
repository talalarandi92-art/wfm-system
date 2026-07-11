import { payableOtMin, mergePendingFlags, PENDING_THRESHOLD, OtFlag, OtEvidence } from './ot-review';

describe('payableOtMin (Director decisions 2026-07-11)', () => {
  it('sums regular + off-day + holiday + acknowledged review minutes', () => {
    expect(payableOtMin({ regularMin: 120, offdayMin: 60, holidayMin: 30, ackReviewMin: 45 })).toBe(255);
  });
  it('EXCLUDES OFF-worked hours — they are not even a parameter (decision 1)', () => {
    // an OFF-worked day contributes 0 offday/holiday; only its (absent) payable buckets count
    expect(payableOtMin({ regularMin: 0, offdayMin: 0, holidayMin: 0, ackReviewMin: 0 })).toBe(0);
  });
  it('INCLUDES only acknowledged review minutes, never pending/ignored (decision 2)', () => {
    // pending/ignored are simply never passed in as ackReviewMin
    expect(payableOtMin({ regularMin: 100, ackReviewMin: 0 })).toBe(100);
    expect(payableOtMin({ regularMin: 100, ackReviewMin: 90 })).toBe(190);
  });
  it('clamps negatives and rounds', () => {
    expect(payableOtMin({ regularMin: -5, offdayMin: 10.4, holidayMin: 0.6 })).toBe(11);
  });
});

describe('mergePendingFlags — preserve-on-rebuild (decision 2)', () => {
  const ev = (personNo: string, date: string, kind: 'before' | 'after', minutes: number): OtEvidence => ({ personNo, date, kind, minutes });
  const fl = (personNo: string, date: string, kind: 'before' | 'after', status: any, minutes: number): OtFlag => ({ personNo, date, kind, status, minutes });

  it('preserves an ACKNOWLEDGED decision across a rebuild — never re-opened', () => {
    const existing = [fl('101', '2026-06-05', 'after', 'acknowledged', 60)];
    const out = mergePendingFlags(existing, [ev('101', '2026-06-05', 'after', 60)]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('acknowledged');
  });

  it('preserves an IGNORED decision across a rebuild', () => {
    const existing = [fl('101', '2026-06-05', 'before', 'ignored', 30)];
    const out = mergePendingFlags(existing, [ev('101', '2026-06-05', 'before', 30)]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('ignored');
  });

  it('creates a fresh pending flag for new evidence at/above the threshold', () => {
    const out = mergePendingFlags([], [ev('202', '2026-06-06', 'after', PENDING_THRESHOLD)]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('pending');
    expect(out[0].minutes).toBe(PENDING_THRESHOLD);
  });

  it('ignores sub-threshold evidence', () => {
    const out = mergePendingFlags([], [ev('202', '2026-06-06', 'after', PENDING_THRESHOLD - 1)]);
    expect(out).toHaveLength(0);
  });

  it('a resolved flag wins even if fresh evidence still present', () => {
    const existing = [fl('303', '2026-06-07', 'before', 'acknowledged', 40)];
    const out = mergePendingFlags(existing, [ev('303', '2026-06-07', 'before', 55)]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('acknowledged');
    expect(out[0].minutes).toBe(40); // preserved verbatim, not refreshed
  });
});
