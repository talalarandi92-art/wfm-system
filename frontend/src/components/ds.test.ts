/**
 * Smoke tests — design-system pure tokens (no rendering, no DOM).
 * Guards the theme contract: dark vs light values must stay distinct and
 * the unified status palette must keep its green/amber/red semantics.
 */
import { describe, it, expect } from 'vitest';
import { tp, ts, divider, STATUS, sevColor, gapColor, scoreColor } from './ds';

describe('theme tokens — dark vs light', () => {
  it('tp (primary text) flips between near-white and near-black', () => {
    expect(tp(true)).toBe('#f1f5f9');
    expect(tp(false)).toBe('#0f172a');
    expect(tp(true)).not.toBe(tp(false));
  });
  it('ts (secondary text) is dimmer than tp in both themes and theme-distinct', () => {
    expect(ts(true)).toBe('#64748b');
    expect(ts(false)).toBe('#94a3b8');
    expect(ts(true)).not.toBe(ts(false));
  });
  it('divider uses white alpha in dark, black alpha in light', () => {
    expect(divider(true)).toContain('rgba(255,255,255');
    expect(divider(false)).toContain('rgba(0,0,0');
  });
});

describe('unified status palette', () => {
  it('sevColor resolves aliases onto the same hex', () => {
    expect(sevColor('ok')).toBe(STATUS.good);
    expect(sevColor('fail')).toBe(STATUS.risk);
    expect(sevColor('neutral')).toBe(STATUS.info);
  });
  it('gapColor: surplus green, exactly-at-threshold amber, shortfall red', () => {
    expect(gapColor(2)).toBe(STATUS.ok);    // >= warnAt+1
    expect(gapColor(0)).toBe(STATUS.warn);  // == warnAt
    expect(gapColor(-1)).toBe(STATUS.risk); // below
    // custom threshold
    expect(gapColor(5, 5)).toBe(STATUS.warn);
    expect(gapColor(6, 5)).toBe(STATUS.ok);
  });
  it('scoreColor bands: >=90 green, >=70 amber, else red', () => {
    expect(scoreColor(90)).toBe(STATUS.ok);
    expect(scoreColor(89.9)).toBe(STATUS.warn);
    expect(scoreColor(70)).toBe(STATUS.warn);
    expect(scoreColor(69)).toBe(STATUS.risk);
  });
});
