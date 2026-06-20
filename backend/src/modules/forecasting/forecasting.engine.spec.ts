import {
  dowOf, dateRange, buildProfile, forecastRange, dailyTotals, accuracy, VolumePoint,
  serviceLevel, requiredAgents, eventFactor,
} from './forecasting.engine';

describe('forecasting.engine', () => {
  it('dowOf is timezone-safe (UTC)', () => {
    // 2026-06-20 is a Saturday
    expect(dowOf('2026-06-20')).toBe(6);
    expect(dowOf('2026-06-21')).toBe(0); // Sunday
  });

  it('dateRange is inclusive', () => {
    expect(dateRange('2026-06-01', '2026-06-03')).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(dateRange('2026-06-01', '2026-06-01')).toEqual(['2026-06-01']);
  });

  it('buildProfile weights recent occurrences more', () => {
    // Same weekday/hour, three Saturdays — volumes 10, 20, 60 (oldest→newest).
    const history: VolumePoint[] = [
      { date: '2026-06-06', hour: 10, channel: 'voice', volume: 10 },
      { date: '2026-06-13', hour: 10, channel: 'voice', volume: 20 },
      { date: '2026-06-20', hour: 10, channel: 'voice', volume: 60 },
    ];
    const prof = buildProfile(history, 'voice');
    const cell = prof.get('6|10')!;
    // weighted: (1*10 + 2*20 + 3*60) / (1+2+3) = 230/6 ≈ 38.3  (vs flat mean 30)
    expect(cell.samples).toBe(3);
    expect(cell.avg).toBeCloseTo(38.33, 1);
  });

  it('forecastRange projects the weekday-hour profile onto future dates', () => {
    const history: VolumePoint[] = [
      { date: '2026-06-06', hour: 9, channel: 'voice', volume: 40 },
      { date: '2026-06-13', hour: 9, channel: 'voice', volume: 40 },
    ];
    const fc = forecastRange(history, 'voice', '2026-06-27', '2026-06-27'); // another Saturday
    const at9 = fc.find(f => f.hour === 9)!;
    expect(at9.forecast).toBe(40);
    expect(at9.basis).toBe(2);
    // hours with no history forecast 0 with basis 0
    expect(fc.find(f => f.hour === 3)!.forecast).toBe(0);
    expect(fc.length).toBe(24);
  });

  it('dailyTotals sums intervals per day/channel', () => {
    const history: VolumePoint[] = [
      { date: '2026-06-06', hour: 9, channel: 'voice', volume: 10 },
      { date: '2026-06-06', hour: 10, channel: 'voice', volume: 5 },
    ];
    const fc = forecastRange(history, 'voice', '2026-06-13', '2026-06-13');
    const totals = dailyTotals(fc);
    expect(totals).toEqual([{ date: '2026-06-13', channel: 'voice', total: 15 }]);
  });

  it('accuracy computes WAPE/MAPE/bias on matched cells', () => {
    const actuals: VolumePoint[] = [
      { date: '2026-06-20', hour: 9, channel: 'voice', volume: 100 },
      { date: '2026-06-20', hour: 10, channel: 'voice', volume: 50 },
    ];
    const forecasts = [
      { date: '2026-06-20', hour: 9, channel: 'voice', forecast: 110, basis: 4 },
      { date: '2026-06-20', hour: 10, channel: 'voice', forecast: 40, basis: 4 },
    ];
    const a = accuracy(actuals, forecasts);
    // abs err = 10 + 10 = 20 ; sumActual = 150 → WAPE = 13.3%
    expect(a.wape).toBeCloseTo(13.3, 1);
    // signed err = +10 -10 = 0 → bias 0
    expect(a.bias).toBe(0);
    // MAPE = mean(10/100, 10/50) = mean(0.1, 0.2) = 0.15 → 15%
    expect(a.mape).toBeCloseTo(15, 1);
    expect(a.matched).toBe(2);
  });

  it('serviceLevel rises with more agents and saturates ≤ intensity', () => {
    // 100 contacts/hr, AHT 300s → intensity A = 100*300/3600 ≈ 8.33 erlangs
    const A = 100 * 300 / 3600;
    expect(serviceLevel(8, A, 20, 300)).toBe(0);          // N ≤ A → unstable
    const slLow = serviceLevel(10, A, 20, 300);
    const slHigh = serviceLevel(14, A, 20, 300);
    expect(slHigh).toBeGreaterThan(slLow);
    expect(slHigh).toBeLessThanOrEqual(1);
  });

  it('requiredAgents staffs above intensity and grosses up for shrinkage', () => {
    const r = requiredAgents(100, { ahtSec: 300, intervalSec: 3600, targetSL: 0.8, targetSec: 20, shrinkage: 0.3 });
    expect(r.intensity).toBeCloseTo(8.33, 1);
    expect(r.pure).toBeGreaterThan(8);                     // must exceed intensity for stability
    expect(r.required).toBeGreaterThanOrEqual(r.pure);     // shrinkage gross-up
    expect(r.serviceLevel).toBeGreaterThanOrEqual(80);     // meets target SL
    expect(r.occupancy).toBeLessThanOrEqual(85);           // within occupancy cap
  });

  it('requiredAgents is zero for zero volume', () => {
    const r = requiredAgents(0, { ahtSec: 300 });
    expect(r.required).toBe(0);
    expect(r.pure).toBe(0);
  });

  it('eventFactor combines overlapping events multiplicatively', () => {
    const events = [
      { from: '2026-06-15', to: '2026-06-25', multiplier: 1.3, label: 'Mega Sale', color: '#f00' },
      { from: '2026-06-20', to: '2026-06-30', multiplier: 1.1, label: 'Ramadan' },
    ];
    const inside = eventFactor('2026-06-22', events); // both apply
    expect(inside.multiplier).toBeCloseTo(1.43, 2);
    expect(inside.labels).toEqual(['Mega Sale', 'Ramadan']);
    expect(inside.color).toBe('#f00');
    const edge = eventFactor('2026-06-16', events); // only Mega Sale
    expect(edge.multiplier).toBeCloseTo(1.3, 2);
    const outside = eventFactor('2026-07-01', events);
    expect(outside.multiplier).toBe(1);
    expect(outside.labels).toEqual([]);
  });
});
