/**
 * B5 — simulation pure-logic tests: deterministic seeding, scenario mapping,
 * policy overrides (no mutation), delayed projection, late-return math.
 */
import {
  hash01, isSimAbsent, normalizeScenario, queueSpikeInputs,
  applyPolicyOverrides, projectDelayed, lateReturnMin,
} from './break-simulation.logic';
import { riskAssess, RiskLevel } from './break-release.logic';
import { BreakPolicyV2Row } from './break-policy.logic';

describe('hash01 / isSimAbsent (deterministic seeding §28)', () => {
  it('is stable across calls and bounded to [0,1)', () => {
    const ids = ['emp-a', 'emp-b', '550e8400-e29b-41d4-a716-446655440000', ''];
    for (const id of ids) {
      const v = hash01(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(id)).toBe(v);          // same input → same output, always
    }
    expect(hash01('emp-a')).not.toBe(hash01('emp-b'));
  });

  it('same employee set + same absencePct → identical absent set (reproducible)', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `employee-${i}`);
    const run = () => ids.filter(id => isSimAbsent(id, 30));
    const a = run(), b = run();
    expect(a).toEqual(b);
    // ~30% ± tolerance — hash spread sanity
    expect(a.length).toBeGreaterThan(200 * 0.15);
    expect(a.length).toBeLessThan(200 * 0.45);
  });

  it('0% → nobody absent; 100% → everybody absent', () => {
    const ids = ['x', 'y', 'z'];
    expect(ids.filter(id => isSimAbsent(id, 0))).toHaveLength(0);
    expect(ids.filter(id => isSimAbsent(id, 100))).toHaveLength(3);
  });
});

describe('normalizeScenario', () => {
  it('clamps and defaults', () => {
    expect(normalizeScenario(null)).toMatchObject({ absencePct: 0, queueSpike: 'none', extraStaff: 0 });
    expect(normalizeScenario({ absencePct: 250, extraStaff: -5, queueSpike: 'bogus' as any }))
      .toMatchObject({ absencePct: 100, extraStaff: 0, queueSpike: 'none' });
    expect(normalizeScenario({ absencePct: 12.5, queueSpike: 'severe', extraStaff: 3.9, mode: 'freeze' }))
      .toMatchObject({ absencePct: 12.5, queueSpike: 'severe', extraStaff: 3, mode: 'freeze' });
  });
});

describe('queueSpikeInputs → riskAssess integration (§28 scenario mapping)', () => {
  const healthy = (spike: ReturnType<typeof queueSpikeInputs>) => riskAssess({
    requiredNow: 10, scheduledNow: 20, onBreakNow: 0,
    liveAvailableNow: null,
    queueWaiting: spike.queueWaiting, atRiskQueueCount: spike.atRiskQueueCount,
    forecastRequiredNext30: 0, forecastScheduledNext30: 20,
    staleSec: spike.staleSec, thresholds: null,
  });

  it('none → green when staffing is healthy (fresh synthetic snapshot, no §30 bump)', () => {
    expect(healthy(queueSpikeInputs('none')).level).toBe('green');
  });
  it('moderate → orange (1 queue at SLA risk + waiting approaching max)', () => {
    expect(healthy(queueSpikeInputs('moderate')).level).toBe('orange');
  });
  it('severe → red (waiting over max + 3 queues at risk)', () => {
    expect(healthy(queueSpikeInputs('severe')).level).toBe('red');
  });
});

describe('applyPolicyOverrides', () => {
  const row: BreakPolicyV2Row = {
    id: 'p1', tenant_id: 't', function_name: null, shift_type: null, employment_type: null,
    total_daily_minutes: 60, max_sessions: 3, duration_pattern: [15, 30, 15],
    protected_first_min: 60, protected_last_min: 60, min_gap_between_breaks_min: 90,
    min_work_before_first_min: 120, max_delay_min: 45, release_mode: 'hybrid',
    thresholds: { coverage_ratio: 0.7, buffer_hc: 1 }, active: true,
  };

  it('patches allowed keys, deep-merges thresholds, never mutates input', () => {
    const out = applyPolicyOverrides([row], { max_sessions: 2, thresholds: { coverage_ratio: 0.8 } });
    expect(out[0].max_sessions).toBe(2);
    expect(out[0].thresholds).toEqual({ coverage_ratio: 0.8, buffer_hc: 1 });
    // original untouched
    expect(row.max_sessions).toBe(3);
    expect(row.thresholds).toEqual({ coverage_ratio: 0.7, buffer_hc: 1 });
  });

  it('ignores non-overridable keys; mode param wins release_mode', () => {
    const out = applyPolicyOverrides([row], { id: 'HACK', tenant_id: 'HACK', total_daily_minutes: 45 }, 'freeze');
    expect(out[0].id).toBe('p1');
    expect(out[0].tenant_id).toBe('t');
    expect(out[0].total_daily_minutes).toBe(45);
    expect(out[0].release_mode).toBe('freeze');
  });
});

describe('projectDelayed (§28: slots landing in red/critical hours)', () => {
  const H = (h: number) => h * 60; // minutes
  const risk = new Map<string, RiskLevel>([
    [`${H(14)}|CC`, 'red'],
    [`${H(15)}|CC`, 'green'],
    [`${H(14)}|SM`, 'green'],
  ]);
  it('flags overlap with a red hour of the SAME function only', () => {
    const slots = [
      { functionName: 'CC', startMin: H(14) + 30, endMin: H(14) + 45 },  // inside red 14:00 CC → delayed
      { functionName: 'CC', startMin: H(15) + 10, endMin: H(15) + 25 },  // green hour → fine
      { functionName: 'SM', startMin: H(14) + 30, endMin: H(14) + 45 },  // SM green at 14 → fine
      { functionName: 'CC', startMin: H(13) + 50, endMin: H(14) + 5 },   // spills into red hour → delayed
    ];
    const delayed = projectDelayed(slots, risk);
    expect(delayed).toHaveLength(2);
    expect(delayed.map(d => d.startMin).sort((a, b) => a - b)).toEqual([H(13) + 50, H(14) + 30]);
  });
});

describe('lateReturnMin (report math spot-checks)', () => {
  it('simple: planned 30, actual 42 → 12 late', () => {
    expect(lateReturnMin(14 * 60, 14 * 60 + 30, 14 * 60, 14 * 60 + 42)).toBe(12);
  });
  it('early return → 0 (never negative)', () => {
    expect(lateReturnMin(14 * 60, 14 * 60 + 30, 14 * 60, 14 * 60 + 20)).toBe(0);
  });
  it('cross-midnight planned AND actual', () => {
    // planned 23:50–00:20 (30m), actual 23:50–00:35 (45m) → 15 late
    expect(lateReturnMin(23 * 60 + 50, 20, 23 * 60 + 50, 35)).toBe(15);
  });
});
