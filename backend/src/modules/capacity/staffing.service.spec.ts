import * as fs from 'fs';
import * as path from 'path';
import { cappedLearnedFloor, LEARNED_ERL_CEIL } from './staffing.service';

/**
 * Regression lock for the 2026-07-12 learned-floor runaway fix (commit e265b0e + this guard).
 * A single Sunday Sprinklr snapshot with ~1032 conversations WAITING once produced a 593-Erlang
 * "measured" floor (n=2) → CH-WA 402 bodies/day → +508 hire. The fix: floor = P90 of concurrent
 * `erlangs` ONLY, over ≥5 samples, capped at LEARNED_ERL_CEIL. These tests fail if any of those
 * three guards regress.
 */
describe('staffing learned-floor guards', () => {
  describe('cappedLearnedFloor', () => {
    it('passes a normal measured floor through unchanged', () => {
      expect(cappedLearnedFloor(48, 1)).toBe(48);
      expect(cappedLearnedFloor(0, 1)).toBe(0);
    });
    it('scales by the orders scenario', () => {
      expect(cappedLearnedFloor(50, 1.2)).toBeCloseTo(60, 6);
    });
    it('CLAMPS a garbage-level floor at the ceiling (the runaway can never recur)', () => {
      expect(cappedLearnedFloor(593.5, 1)).toBe(593.5);       // under the default 1000 ceiling
      expect(cappedLearnedFloor(5000, 1)).toBe(LEARNED_ERL_CEIL);
      expect(cappedLearnedFloor(400, 5)).toBe(LEARNED_ERL_CEIL); // 2000 → clamped
    });
    it('never returns a negative or NaN floor', () => {
      expect(cappedLearnedFloor(-10, 1)).toBe(0);
      expect(cappedLearnedFloor(NaN, 1)).toBe(0);
      expect(cappedLearnedFloor(100, -1)).toBe(0);
    });
    it('honours a caller-supplied ceiling', () => {
      expect(cappedLearnedFloor(300, 1, 100)).toBe(100);
    });
  });

  describe('learned-floor SQL cannot regress to include WAITING or a <5 sample gate', () => {
    const src = fs.readFileSync(path.join(__dirname, 'staffing.service.ts'), 'utf8');
    it('the learned floor orders by erlangs ONLY — never erlangs + waiting_avg', () => {
      expect(src).not.toContain('ORDER BY erlangs + waiting_avg');
      expect(src).toContain('PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY erlangs)');
    });
    it('requires >=5 same-weekday-hour samples before a cell becomes a floor', () => {
      expect(src).toContain('HAVING COUNT(*) >= 5');
      expect(src).not.toContain('HAVING COUNT(*) >= 2');
    });
  });
});
