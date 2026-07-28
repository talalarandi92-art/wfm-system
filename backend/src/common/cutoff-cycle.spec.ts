import { cutoffCycleFor, cycleKindFor } from './cutoff-cycle';

/**
 * The permission balance is counted over these windows, so a boundary that is off
 * by one day moves a request into the wrong cycle and mis-states someone's
 * remaining entitlement. Every boundary case is pinned.
 */
describe('cut-off cycles (BR-TIM-002)', () => {
  describe('full-time — the 15th to the 14th', () => {
    it('the 15th opens a new cycle', () => {
      expect(cutoffCycleFor('2026-07-15')).toMatchObject({ from: '2026-07-15', to: '2026-08-14' });
    });
    it('the 14th still belongs to the cycle that opened last month', () => {
      expect(cutoffCycleFor('2026-07-14')).toMatchObject({ from: '2026-06-15', to: '2026-07-14' });
    });
    it('mid-cycle lands in the right window', () => {
      expect(cutoffCycleFor('2026-07-28')).toMatchObject({ from: '2026-07-15', to: '2026-08-14' });
      expect(cutoffCycleFor('2026-08-01')).toMatchObject({ from: '2026-07-15', to: '2026-08-14' });
    });
    it('crosses the year boundary', () => {
      expect(cutoffCycleFor('2026-01-03')).toMatchObject({ from: '2025-12-15', to: '2026-01-14' });
      expect(cutoffCycleFor('2025-12-20')).toMatchObject({ from: '2025-12-15', to: '2026-01-14' });
    });
    it('handles February — the short month does not shorten the cycle end', () => {
      expect(cutoffCycleFor('2026-02-20')).toMatchObject({ from: '2026-02-15', to: '2026-03-14' });
      expect(cutoffCycleFor('2026-03-01')).toMatchObject({ from: '2026-02-15', to: '2026-03-14' });
    });
  });

  describe('interns — the calendar month', () => {
    it('the 1st and the last day are the same cycle', () => {
      expect(cutoffCycleFor('2026-07-01', 'intern')).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
      expect(cutoffCycleFor('2026-07-31', 'intern')).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
    });
    it('February 2026 ends on the 28th — 2026 is not a leap year', () => {
      expect(cutoffCycleFor('2026-02-10', 'intern')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    });
    it('an intern on the 15th is NOT pushed into a full-time window', () => {
      expect(cutoffCycleFor('2026-07-15', 'intern').to).toBe('2026-07-31');
    });
  });

  describe('Bahrain — the 25th to the 24th', () => {
    it('computes correctly when a kind is passed explicitly', () => {
      expect(cutoffCycleFor('2026-07-26', 'bahrain')).toMatchObject({ from: '2026-07-25', to: '2026-08-24' });
      expect(cutoffCycleFor('2026-07-24', 'bahrain')).toMatchObject({ from: '2026-06-25', to: '2026-07-24' });
    });
    /* Nothing in the schema identifies a Bahrain employee, so nobody is routed
       here automatically. This asserts that gap rather than hiding it: if a site
       column is added and this stops being true, the test tells you to wire it. */
    it('is not reachable from employment_type — the schema cannot express it yet', () => {
      expect(cycleKindFor('bahrain')).toBe('full_time');
      expect(cycleKindFor('Bahrain')).toBe('full_time');
    });
  });

  describe('employment_type mapping', () => {
    it('interns map to the calendar-month cycle, everyone else to full-time', () => {
      expect(cycleKindFor('intern')).toBe('intern');
      expect(cycleKindFor('full_time')).toBe('full_time');
      expect(cycleKindFor(null)).toBe('full_time');
      expect(cycleKindFor(undefined)).toBe('full_time');
    });
  });

  describe('the window is contiguous and never overlaps', () => {
    it('the day after a cycle ends opens the next one, with no gap', () => {
      for (const kind of ['full_time', 'intern', 'bahrain'] as const) {
        const c = cutoffCycleFor('2026-05-20', kind);
        const dayAfterEnd = new Date(new Date(`${c.to}T00:00:00Z`).getTime() + 86400000)
          .toISOString().slice(0, 10);
        expect(cutoffCycleFor(dayAfterEnd, kind).from).toBe(dayAfterEnd);
      }
    });
  });
});
