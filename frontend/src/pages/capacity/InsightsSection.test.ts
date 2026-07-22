/**
 * Regression guard for the crash that blanked the Capacity page.
 *
 * /capacity/staffing/insights returns a DIFFERENT `metric` shape per insight
 * kind. The chip rendered it straight into JSX → React #31 ("objects are not
 * valid as a React child") → the whole page unmounted a second after load.
 * A metric chip may only ever carry a scalar.
 */
import { describe, it, expect } from 'vitest';
import { metricLabel, normalizeInsights } from './InsightsSection';

describe('metricLabel — a chip never receives an object', () => {
  it('renders scalars', () => {
    expect(metricLabel(32)).toBe('32');
    expect(metricLabel(0)).toBe('0');
    expect(metricLabel('CH - WA')).toBe('CH - WA');
    expect(metricLabel(true)).toBe('true');
  });

  it('returns null for EVERY real metric shape the endpoint sends', () => {
    // captured live from GET /capacity/staffing/insights
    const shapes = [
      { latestMeasuredDate: '2026-06-21', staleDays: 32 },
      { functionKey: 'CH - WA', date: '2026-07-27', hour: 16, required: 22 },
      { functionKey: 'Inbound', margin: 0.2, fieldablePerDay: 3, bodiesNeeded: 9, worstDay: '2026-07-26' },
      { worstChannel: 'chat', wapePct: 18.2, biasPct: -4, perChannel: [] },
      { channel: 'voice', pct: 12, last7: 100, prev7: 89 },
      { cellsApplied: 44, perFunction: {} },
      { perFunction: {} },
    ];
    for (const s of shapes) expect(metricLabel(s)).toBeNull();
    expect(metricLabel([1, 2, 3])).toBeNull();
  });

  it('returns null for empty / non-finite values instead of printing junk', () => {
    expect(metricLabel(null)).toBeNull();
    expect(metricLabel(undefined)).toBeNull();
    expect(metricLabel('   ')).toBeNull();
    expect(metricLabel(NaN)).toBeNull();
    expect(metricLabel(Infinity)).toBeNull();
  });
});

describe('normalizeInsights', () => {
  it('accepts the live envelope and a bare array, and never throws on junk', () => {
    expect(normalizeInsights({ insights: [{ text: 'a' }] })).toHaveLength(1);
    expect(normalizeInsights([{ text: 'a' }, { text: 'b' }])).toHaveLength(2);
    expect(normalizeInsights({ bullets: [{ text: 'a' }] })).toHaveLength(1);
    expect(normalizeInsights(null)).toEqual([]);
    expect(normalizeInsights('nope')).toEqual([]);
    expect(normalizeInsights({ insights: 'not-an-array' })).toEqual([]);
  });
});
