import * as fs from 'fs';
import * as path from 'path';
import {
  StaffingService, computeCellRequirement, normalizeShares, backtestStats, deriveInsights,
} from './staffing.service';

/* ═════════════════════════════════════════════════════════════════════════════
 * Stage-1A accuracy audit + analysis-layer specs (2026-07-20).
 *
 * The hand-computed cell below is a REAL live-data cell, verified against the
 * running engine during the audit:
 *   Inbound (erlang_c, voice share 0.85), Tuesday 2026-07-21, 12:00 —
 *   same-weekday baseline (last 4 Tuesdays' offered) = 962.5 contacts/day,
 *   intraday shares for slots 24+25 = 54013/777674 of the day.
 * ════════════════════════════════════════════════════════════════════════════ */

describe('engine chain — one real cell recomputed by hand (audit 1a)', () => {
  // volume = daily baseline × channel share × intraday share of the hour
  const volume = 962.5 * 0.85 * (54013 / 777674);

  it('volume ties to the hand computation (≈56.8 contacts in the 12:00 hour)', () => {
    expect(volume).toBeCloseTo(56.82, 1);
  });

  it('erlang_c: 56.82 contacts × 330s AHT → 5.21 Erl → 8 agents @ SL80/20s → sched 12 @ 28% shrinkage', () => {
    const cell = computeCellRequirement(volume, 330, 0, {
      model: 'erlang_c', targetSl: 0.8, targetAnswerSec: 20, occupancyCap: 0.85,
      shrinkage: 0.28, productivity: 1.0, concurrency: 1, marginalEff: 0.75,
    });
    expect(cell.erlangs).toBeCloseTo(5.208, 2);                     // 56.82 × 330 / 3600
    expect(cell.agentsForSl).toBe(8);                               // SL(7)=0.663 < 0.80 ≤ SL(8)=0.831
    expect(cell.erlangs / cell.serverCapacity).toBeCloseTo(0.651, 2); // occupancy = A/N
    expect(cell.afterProductivity).toBe(8);                         // ÷ productivity 1.0
    expect(cell.requiredScheduledHc).toBe(12);                      // ceil(8 / (1 − 0.28)) = ceil(11.11)
  });

  it('concurrency: occupancy divides by agents × EFFECTIVE servers (c=4 → 3.25/agent), never raw agents (audit 1e)', () => {
    // CH-WA live cell 12:00: 70.3 contacts × 330s → 6.44 Erl → 8 servers → ceil(8/3.25)=3 agents
    const cell = computeCellRequirement(70.3, 330, 0, {
      model: 'concurrency', targetSl: 0.8, targetAnswerSec: 60, occupancyCap: 0.85,
      shrinkage: 0.30, productivity: 0.80, concurrency: 4, marginalEff: 0.75,
    });
    expect(cell.agentsForSl).toBe(3);
    expect(cell.serverCapacity).toBeCloseTo(cell.agentsForSl * 3.25, 6);
    expect(cell.erlangs / cell.serverCapacity).toBeCloseTo(6.44 / 9.75, 2);   // 0.661 — NOT 6.44/3
    // chain tail: 3 ÷ 0.8 productivity = 3.75 → ceil(3.75 / 0.7) = 6 scheduled
    expect(cell.afterProductivity).toBeCloseTo(3.75, 6);
    expect(cell.requiredScheduledHc).toBe(6);
  });

  it('throughput: staffs workload at the occupancy cap (back-office)', () => {
    const cell = computeCellRequirement(30, 600, 0, {
      model: 'throughput', targetSl: 0.8, targetAnswerSec: 0, occupancyCap: 0.85,
      shrinkage: 0.25, productivity: 1.0, concurrency: 1, marginalEff: 0.75,
    });
    expect(cell.erlangs).toBe(5);                          // 30 × 600 / 3600
    expect(cell.agentsForSl).toBe(Math.ceil(5 / 0.85));    // 6
    expect(cell.requiredScheduledHc).toBe(Math.ceil(6 / 0.75)); // 8
  });

  it('learned floor overrides a lower estimate and flags the cell; zero-volume cell stays zero without a floor', () => {
    const p = { model: 'throughput' as const, targetSl: 0.8, targetAnswerSec: 0, occupancyCap: 0.85, shrinkage: 0.25, productivity: 1.0, concurrency: 1, marginalEff: 0.75 };
    const floored = computeCellRequirement(0, 300, 2.5, p);
    expect(floored.erlangs).toBe(2.5);
    expect(floored.learnedApplied).toBe(true);
    expect(floored.requiredScheduledHc).toBeGreaterThan(0);
    const empty = computeCellRequirement(0, 300, 0, p);
    expect(empty.requiredScheduledHc).toBe(0);
    expect(empty.learnedApplied).toBe(false);
  });
});

describe('intraday profile normalization (audit 1d)', () => {
  it('48 raw weights normalize to shares summing to exactly 1', () => {
    const raw = Array.from({ length: 48 }, (_, i) => (i % 7) * 13.7 + 1);
    const shares = normalizeShares(raw);
    expect(shares).toHaveLength(48);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    // proportionality preserved
    expect(shares[8] / shares[1]).toBeCloseTo(raw[8] / raw[1], 9);
  });
  it('all-zero profile stays zero — no NaN, no division blow-up', () => {
    const shares = normalizeShares(new Array(48).fill(0));
    expect(shares.every(v => v === 0)).toBe(true);
  });
});

describe('measured-AHT window regression guard (the 2026-07-20 stale-data fix)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'staffing.service.ts'), 'utf8');
  it('AHT anchors to each channel\'s LAST available data day, never a calendar window that can go empty', () => {
    expect(src).toContain('last_day - 28');
    expect(src).toContain('MAX(vol_date) OVER (PARTITION BY channel)');
    // the old calendar-anchored window (went EMPTY when ingest lagged 28+ days → silent 300s fallback)
    expect(src).not.toContain("vol_date BETWEEN ($2::date - 28) AND $2::date");
  });
  it('the AHT window is emitted to the UI so staleness is visible, never silent', () => {
    expect(src).toContain('measuredAhtWindow');
  });
});

describe('forecast-accuracy backtest math (audit 2a)', () => {
  it('WAPE and bias hand-computed on a small fixture', () => {
    const rows = [
      { actual: 100, forecast: 110 },   // +10
      { actual: 200, forecast: 180 },   // −20
      { actual: 100, forecast: 100 },   //  0
    ];
    // Σ|F−A| = 30, ΣA = 400 → WAPE 7.5% ;  Σ(F−A) = −10 → bias −2.5% (under-forecast)
    const s = backtestStats(rows);
    expect(s.n).toBe(3);
    expect(s.wapePct).toBe(7.5);
    expect(s.biasPct).toBe(-2.5);
  });
  it('degenerate inputs return null rates — never NaN/Infinity', () => {
    expect(backtestStats([])).toEqual({ n: 0, wapePct: null, biasPct: null });
    expect(backtestStats([{ actual: 0, forecast: 5 }]).wapePct).toBeNull();
    const s = backtestStats([{ actual: NaN as any, forecast: 10 }, { actual: 100, forecast: 90 }]);
    expect(s.wapePct).toBe(10);   // the NaN row is skipped, not poisoning the sums
  });
  it('a perfect forecast scores WAPE 0 / bias 0', () => {
    const s = backtestStats([{ actual: 50, forecast: 50 }, { actual: 70, forecast: 70 }]);
    expect(s.wapePct).toBe(0);
    expect(s.biasPct).toBe(0);
  });
});

describe('scenario-compare definitions (audit 2b)', () => {
  it('base ×1.0 / surge ×1.2 / quiet ×0.85 / base+OT-10% — fixed grid', () => {
    expect(StaffingService.SCENARIO_DEFS.map(s => [s.key, s.ordersScale, s.otPct])).toEqual([
      ['base', 1.0, 0], ['surge', 1.2, 0], ['quiet', 0.85, 0], ['base+ot10', 1.0, 0.10],
    ]);
  });
});

describe('insight derivations (audit 2c) — pure, verified numbers only', () => {
  const fixture = () => ({
    from: '2026-07-21',
    dataAnchor: '2026-06-21',   // 30 days stale → critical freshness
    days: [{
      date: '2026-07-21', dow: 2,
      functions: [
        { functionKey: 'Inbound', hours: [
          { hour: 11, requiredScheduledHc: 9 },
          { hour: 12, requiredScheduledHc: 13, learned: true },
        ] },
        { functionKey: 'Support', hours: [
          { hour: 12, requiredScheduledHc: 4 },   // > team of 3 → impossible hour
        ] },
      ],
    }],
    hiringPerFunction: [
      { functionKey: 'Inbound', currentTeam: 30, fieldablePerDay: 21, scheduleBodiesWorstDay: 25, coverageWorstDay: '2026-07-21', surplusBodies: 0 },
      { functionKey: 'Support', currentTeam: 3, fieldablePerDay: 2, scheduleBodiesWorstDay: 4, coverageWorstDay: '2026-07-21', surplusBodies: 0 },
      { functionKey: 'CH - WA', currentTeam: 38, fieldablePerDay: 27, scheduleBodiesWorstDay: 16, coverageWorstDay: '2026-07-21', surplusBodies: 11 },
    ],
    wow: [
      { channel: 'voice', last7: 5000, prev7: 6500 },   // −23.1% → the biggest mover, warn
      { channel: 'chat', last7: 4200, prev7: 4000 },    // +5%
    ],
  });

  it('flags stale data as critical when the plan starts >28 days after the last measured day', () => {
    const ins = deriveInsights(fixture());
    const fresh = ins.find(i => i.id === 'data-freshness')!;
    expect(fresh.severity).toBe('critical');
    expect(fresh.metric.staleDays).toBe(30);
  });

  it('emits the peak day/hour per function from the real requirement grid', () => {
    const ins = deriveInsights(fixture());
    const peak = ins.find(i => i.id === 'peak:Inbound')!;
    expect(peak.metric).toMatchObject({ date: '2026-07-21', hour: 12, required: 13 });
    expect(peak.severity).toBe('info');
  });

  it('names the tightest function by smallest schedulable margin (negative → critical)', () => {
    const ins = deriveInsights(fixture());
    const tight = ins.find(i => i.id === 'tightest-function')!;
    expect(tight.metric.functionKey).toBe('Inbound');   // 21 − 25 = −4 < Support's 2 − 4 = −2
    expect(tight.metric.margin).toBe(-4);
    expect(tight.severity).toBe('critical');
  });

  it('counts function-hours the current team cannot staff (required > headcount) as critical', () => {
    const ins = deriveInsights(fixture());
    const imp = ins.find(i => i.id === 'impossible-hours')!;
    expect(imp.severity).toBe('critical');
    expect(imp.metric.hours).toBe(1);
    expect(imp.metric.perFunction).toEqual({ Support: 1 });
  });

  it('reports learned-floor coverage honestly (count of cells where measurement beat estimation)', () => {
    const ins = deriveInsights(fixture());
    const lf = ins.find(i => i.id === 'learned-floor')!;
    expect(lf.metric.cellsApplied).toBe(1);
    expect(lf.metric.perFunction).toEqual({ Inbound: 1 });
  });

  it('surfaces the biggest week-over-week measured-volume mover (≥20% → warn)', () => {
    const ins = deriveInsights(fixture());
    const wow = ins.find(i => i.id === 'wow-volume')!;
    expect(wow.metric.channel).toBe('voice');
    expect(wow.metric.pct).toBe(-23.1);
    expect(wow.severity).toBe('warn');
  });

  it('lists overstaffed functions as cross-skill donor candidates', () => {
    const ins = deriveInsights(fixture());
    const over = ins.find(i => i.id === 'overstaffed')!;
    expect(over.metric.perFunction).toEqual({ 'CH - WA': 11 });
    expect(over.severity).toBe('info');
  });

  it('surfaces forecast quality: WAPE ≥50% on any channel makes the verdict read as an upper bound (critical)', () => {
    const ins = deriveInsights({ ...fixture(), backtest: [
      { channel: 'voice', wapePct: 155.7, biasPct: 153.4 },
      { channel: 'chat', wapePct: 12.0, biasPct: -2.1 },
      { channel: 'email', wapePct: null, biasPct: null },   // unscorable channel is skipped, not crashed on
    ] });
    const fq = ins.find(i => i.id === 'forecast-quality')!;
    expect(fq.severity).toBe('critical');
    expect(fq.metric.worstChannel).toBe('voice');
    expect(fq.text).toContain('upper bound');
  });

  it('a healthy backtest (WAPE <25%) stays info', () => {
    const ins = deriveInsights({ ...fixture(), backtest: [{ channel: 'voice', wapePct: 8.2, biasPct: 1.4 }] });
    expect(ins.find(i => i.id === 'forecast-quality')!.severity).toBe('info');
  });

  it('with no history at all, says so critically instead of inventing numbers', () => {
    const ins = deriveInsights({ ...fixture(), dataAnchor: null });
    const fresh = ins.find(i => i.id === 'data-freshness')!;
    expect(fresh.severity).toBe('critical');
    expect(fresh.text).toContain('No measured volume history');
  });
});
