/**
 * B3 live release engine — pure-logic spec.
 * Covers: riskAssess matrix incl. §30 stale degradation, priorityScore
 * breakdown + strict ordering, decideRelease mode matrix (§13),
 * anti-cluster guard (§9), capacity math (§6), delay ladder (§11).
 */
import {
  riskAssess, RiskInputs,
  maxSimultaneousBreaks,
  priorityScore, PriorityCandidate, orderCandidates,
  decideRelease,
  antiClusterOk,
  delayLadder, delayStage,
} from './break-release.logic';

const baseRisk = (over: Partial<RiskInputs> = {}): RiskInputs => ({
  requiredNow: 10,
  scheduledNow: 14,
  onBreakNow: 1,
  liveAvailableNow: 8,
  queueWaiting: 5,
  atRiskQueueCount: 0,
  forecastRequiredNext30: 10,
  forecastScheduledNext30: 14,
  staleSec: 60,
  thresholds: null,
  ...over,
});

describe('riskAssess (§5/§6/§23)', () => {
  it('green when coverage, queues and live availability are all healthy', () => {
    const r = riskAssess(baseRisk());
    expect(r.level).toBe('green');
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('yellow on thin buffer (after-release surplus < buffer)', () => {
    // scheduled 12, onBreak 1 → after release 10 = required exactly, surplus 0 < buffer 1
    const r = riskAssess(baseRisk({ scheduledNow: 12, forecastScheduledNext30: 12 }));
    expect(r.level).toBe('yellow');
    expect(r.reasons.join(' ')).toMatch(/thin buffer/);
  });

  it('orange when release drops below required HC', () => {
    // after release 9 < required 10 but coverage 90% >= 70%
    const r = riskAssess(baseRisk({ scheduledNow: 11, forecastScheduledNext30: 20 }));
    expect(r.level).toBe('orange');
    expect(r.reasons.join(' ')).toMatch(/below required/);
  });

  it('red when coverage after release falls under the coverage_ratio floor', () => {
    // after release 6/10 = 60% < 70%
    const r = riskAssess(baseRisk({ scheduledNow: 8, onBreakNow: 1, forecastScheduledNext30: 20 }));
    expect(r.level).toBe('red');
  });

  it('critical when coverage after release < 50%', () => {
    const r = riskAssess(baseRisk({ scheduledNow: 5, onBreakNow: 0 })); // after release 4/10 = 40%
    expect(r.level).toBe('critical');
  });

  it('red on queue waiting above max', () => {
    const r = riskAssess(baseRisk({ queueWaiting: 51 }));
    expect(r.level).toBe('red');
    expect(r.reasons.join(' ')).toMatch(/queue waiting 51/);
  });

  it('yellow when queue waiting approaches (>80% of) max', () => {
    const r = riskAssess(baseRisk({ queueWaiting: 45 }));
    expect(r.level).toBe('yellow');
  });

  it('orange on 1 at-risk queue, red on 3+', () => {
    expect(riskAssess(baseRisk({ atRiskQueueCount: 1 })).level).toBe('orange');
    expect(riskAssess(baseRisk({ atRiskQueueCount: 3 })).level).toBe('red');
  });

  it('red when live available minus one is below the absolute floor', () => {
    const r = riskAssess(baseRisk({ liveAvailableNow: 3 })); // 3-1=2 < 3
    expect(r.level).toBe('red');
  });

  it('ignores the live floor when the snapshot is stale (but degrades instead)', () => {
    const r = riskAssess(baseRisk({ liveAvailableNow: 3, staleSec: 400 }));
    // floor check skipped (stale), green base degraded one level → yellow
    expect(r.level).toBe('yellow');
    expect(r.reasons.join(' ')).toMatch(/degraded one level/);
  });

  it('yellow when the 30-min forecast tightens', () => {
    const r = riskAssess(baseRisk({ forecastRequiredNext30: 13, forecastScheduledNext30: 14 }));
    expect(r.level).toBe('yellow');
    expect(r.reasons.join(' ')).toMatch(/forecast/);
  });

  it('§30 FAIL-SAFE: no snapshot at all → orange floor, never green', () => {
    const r = riskAssess(baseRisk({ staleSec: null, liveAvailableNow: null }));
    expect(r.level).toBe('orange');
    expect(r.reasons.join(' ')).toMatch(/no live snapshot/);
  });

  it('§30 FAIL-SAFE: snapshot >15min old → orange floor even when everything else is healthy', () => {
    const r = riskAssess(baseRisk({ staleSec: 1000 }));
    expect(r.level).toBe('orange');
    expect(r.reasons.join(' ')).toMatch(/15min/);
  });

  it('§30 FAIL-SAFE: >5min stale degrades one level minimum (green→yellow)', () => {
    const r = riskAssess(baseRisk({ staleSec: 400 }));
    expect(r.level).toBe('yellow');
  });

  it('§30 FAIL-SAFE: >5min stale degrades an already-red level to critical', () => {
    const r = riskAssess(baseRisk({ queueWaiting: 60, staleSec: 400 }));
    expect(r.level).toBe('critical');
  });

  it('stale degradation never IMPROVES a critical level', () => {
    const r = riskAssess(baseRisk({ scheduledNow: 5, onBreakNow: 0, staleSec: 1000 }));
    expect(r.level).toBe('critical'); // orange floor does not lower critical
  });
});

describe('maxSimultaneousBreaks (§6)', () => {
  it('working − required − buffer when demand is known', () => {
    expect(maxSimultaneousBreaks(21, 18, { buffer_hc: 2 })).toBe(1); // spec §6 example
  });
  it('never negative', () => {
    expect(maxSimultaneousBreaks(10, 12, null)).toBe(0);
  });
  it('policy explicit cap wins only downward (min of both)', () => {
    expect(maxSimultaneousBreaks(30, 10, { max_simultaneous: 3, buffer_hc: 1 })).toBe(3);
    expect(maxSimultaneousBreaks(12, 10, { max_simultaneous: 5, buffer_hc: 1 })).toBe(1);
  });
  it('unknown demand (required=0) falls back to a conservative fraction of scheduled', () => {
    expect(maxSimultaneousBreaks(10, 0, null)).toBe(3); // floor(10 × 0.3) = 3
  });
});

const cand = (over: Partial<PriorityCandidate> = {}): PriorityCandidate => ({
  slotId: 's1',
  sessionsToday: 1,
  maxSessions: 4,
  minutesUsedToday: 15,
  entitledMinutes: 60,
  plannedStartMin: 1000,
  latestStartMin: 1100,
  shiftStartMin: 700,
  shiftEndMin: 1240,
  lastBreakEndMin: 800,
  wasDelayedToday: false,
  ...over,
});

describe('priorityScore (§7/§22)', () => {
  it('produces an explainable non-empty breakdown with points + AR reasons', () => {
    const { score, breakdown } = priorityScore(cand(), [cand({ slotId: 's2' })], 1010);
    expect(score).toBeGreaterThan(0);
    expect(breakdown.length).toBeGreaterThan(0);
    for (const line of breakdown) {
      expect(typeof line.points).toBe('number');
      expect(line.reason.length).toBeGreaterThan(0);
      expect(line.reasonAr.length).toBeGreaterThan(0);
    }
  });

  it('fewer sessions today scores higher than more sessions (all else equal)', () => {
    const peers = [cand({ slotId: 'p' })];
    const a = priorityScore(cand({ sessionsToday: 0, minutesUsedToday: 0, lastBreakEndMin: null }), peers, 1010);
    const b = priorityScore(cand({ sessionsToday: 3, minutesUsedToday: 45, lastBreakEndMin: null }), peers, 1010);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('waiting past planned adds +1/min capped at 25', () => {
    const peers = [cand({ slotId: 'p' })];
    const w10 = priorityScore(cand({ lastBreakEndMin: null }), peers, 1010); // waited 10
    const w40 = priorityScore(cand({ lastBreakEndMin: null }), peers, 1040); // waited 40 → capped
    const wait10 = w10.breakdown.find(l => /Waited/.test(l.reason));
    const wait40 = w40.breakdown.find(l => /Waited/.test(l.reason));
    expect(wait10?.points).toBe(10);
    expect(wait40?.points).toBe(25);
  });

  it('previously delayed today adds the flat bonus', () => {
    const peers = [cand({ slotId: 'p' })];
    const yes = priorityScore(cand({ wasDelayedToday: true }), peers, 1010);
    const no = priorityScore(cand({ wasDelayedToday: false }), peers, 1010);
    expect(yes.score - no.score).toBe(10);
    expect(yes.breakdown.some(l => /previously delayed/i.test(l.reason))).toBe(true);
  });

  it('approaching latest_start adds points, past latest gives the full weight', () => {
    const peers = [cand({ slotId: 'p' })];
    const past = priorityScore(cand({ latestStartMin: 1000 }), peers, 1010);
    const line = past.breakdown.find(l => /latest/i.test(l.reason));
    expect(line?.points).toBe(15);
  });

  it('recently returned applies a −15 penalty (today only)', () => {
    const peers = [cand({ slotId: 'p' })];
    const recent = priorityScore(cand({ lastBreakEndMin: 1000 }), peers, 1010); // 10 min ago
    const line = recent.breakdown.find(l => l.points < 0 && /Returned/.test(l.reason));
    expect(line?.points).toBe(-15);
  });

  it('more sessions than the peer median applies a penalty', () => {
    const peers = [cand({ slotId: 'p1', sessionsToday: 0 }), cand({ slotId: 'p2', sessionsToday: 0 })];
    const r = priorityScore(cand({ sessionsToday: 2 }), peers, 1010);
    expect(r.breakdown.some(l => l.points === -10 && /median/.test(l.reason))).toBe(true);
  });

  it('score is never negative', () => {
    const peers = [cand({ slotId: 'p', sessionsToday: 0 })];
    const r = priorityScore(
      cand({ sessionsToday: 4, minutesUsedToday: 60, lastBreakEndMin: 1005, plannedStartMin: 1020, latestStartMin: 2000, shiftEndMin: 5000 }),
      peers, 1010,
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('weights are configurable via thresholds.priority_weights', () => {
    const peers = [cand({ slotId: 'p' })];
    const r = priorityScore(cand({ wasDelayedToday: true }), peers, 1010, { previously_delayed: 99 });
    expect(r.breakdown.find(l => /previously delayed/i.test(l.reason))?.points).toBe(99);
  });
});

describe('orderCandidates', () => {
  it('orders by score desc, tie → earlier planned start, then slotId', () => {
    const xs = [
      { slotId: 'c', score: 50, plannedStartMin: 1000 },
      { slotId: 'a', score: 80, plannedStartMin: 1030 },
      { slotId: 'b', score: 50, plannedStartMin: 990 },
      { slotId: 'd', score: 50, plannedStartMin: 990 },
    ];
    expect(orderCandidates(xs).map(x => x.slotId)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('decideRelease (§13 mode matrix)', () => {
  it('freeze blocks everything regardless of risk', () => {
    expect(decideRelease('freeze', 'green')).toBe('frozen');
    expect(decideRelease('freeze', 'critical')).toBe('frozen');
  });
  it('red/critical hold in every non-frozen mode', () => {
    for (const mode of ['auto', 'supervisor', 'hybrid'] as const) {
      expect(decideRelease(mode, 'red')).toBe('hold');
      expect(decideRelease(mode, 'critical')).toBe('hold');
    }
  });
  it('supervisor mode never auto-releases — recommend only', () => {
    expect(decideRelease('supervisor', 'green')).toBe('recommend');
    expect(decideRelease('supervisor', 'yellow')).toBe('recommend');
    expect(decideRelease('supervisor', 'orange')).toBe('recommend');
  });
  it('auto releases on green/yellow, recommends on orange', () => {
    expect(decideRelease('auto', 'green')).toBe('release');
    expect(decideRelease('auto', 'yellow')).toBe('release');
    expect(decideRelease('auto', 'orange')).toBe('recommend');
  });
  it('hybrid releases normally but routes exceptions to the supervisor', () => {
    expect(decideRelease('hybrid', 'green')).toBe('release');
    expect(decideRelease('hybrid', 'green', { inProtectedWindow: true })).toBe('recommend');
    expect(decideRelease('hybrid', 'yellow', { entitlementOverride: true })).toBe('recommend');
    expect(decideRelease('hybrid', 'orange')).toBe('recommend');
  });
});

describe('antiClusterOk (§9)', () => {
  it('blocks when the function cap is full', () => {
    const r = antiClusterOk({ activeInFunction: 2, functionCap: 2, activeInTeam: 0, teamCap: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/function break capacity/);
  });
  it('blocks when the team_manager cap is full', () => {
    const r = antiClusterOk({ activeInFunction: 0, functionCap: 5, activeInTeam: 1, teamCap: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/team/);
  });
  it('allows when both caps have room; null team skips the team check', () => {
    expect(antiClusterOk({ activeInFunction: 1, functionCap: 3, activeInTeam: 0, teamCap: 1 }).ok).toBe(true);
    expect(antiClusterOk({ activeInFunction: 0, functionCap: 1, activeInTeam: null, teamCap: 1 }).ok).toBe(true);
  });
});

describe('delay ladder (§11)', () => {
  it('default ladder derives from max_delay', () => {
    expect(delayLadder(null, 45)).toEqual([10, 20, 30, 45]);
    expect(delayLadder(null, 60)).toEqual([10, 20, 30, 60]);
  });
  it('policy delay_ladder overrides', () => {
    expect(delayLadder({ delay_ladder: [5, 15] }, 45)).toEqual([5, 15]);
  });
  it('delayStage counts crossed thresholds — fires once per stage', () => {
    const ladder = [10, 20, 30, 45];
    expect(delayStage(0, ladder)).toBe(0);
    expect(delayStage(10, ladder)).toBe(1);
    expect(delayStage(25, ladder)).toBe(2);
    expect(delayStage(45, ladder)).toBe(4);
    // once-per-stage: stage(prev) < stage(new) is the firing condition
    expect(delayStage(22, ladder)).toBe(delayStage(29, ladder));
  });
});
