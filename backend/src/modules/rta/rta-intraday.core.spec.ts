import {
  normalizeWindow, dayOffset, rowWindows, buildIntraday, riskFor, coverageStateFor,
  hhmm, deriveAlerts, mergeGapWindows, MAX_SESSION_MIN, IntradayRow, AlertInput,
} from './rta-intraday.core';

const D = '2026-07-03';
const PREV = '2026-07-02';

const row = (o: Partial<IntradayRow>): IntradayRow => ({
  workDate: D, functionName: 'Inbound', personNo: 'P1', presence: 'office',
  shiftStartMin: 420, shiftEndMin: 960, sysLoginMin: 420, sysLogoutMin: 960,
  sysLogin2Min: null, sysLogout2Min: null, permissionType: null, ...o,
});

/* ── window maths ──────────────────────────────────────────────────────────── */
describe('normalizeWindow', () => {
  it('keeps a same-day window', () => {
    expect(normalizeWindow(420, 960)).toEqual({ s: 420, e: 960 });
  });
  it('unwraps a cross-midnight window stored as end <= start (MD 22:00→07:00)', () => {
    expect(normalizeWindow(1320, 420)).toEqual({ s: 1320, e: 1860 });
  });
  it('accepts an already-canonical end beyond 1440 (shift-dictionary fallback)', () => {
    expect(normalizeWindow(1320, 1860)).toEqual({ s: 1320, e: 1860 });
  });
  it('rejects nulls and out-of-range starts', () => {
    expect(normalizeWindow(null, 500)).toBeNull();
    expect(normalizeWindow(420, null)).toBeNull();
    expect(normalizeWindow(1500, 100)).toBeNull();
  });
});

describe('dayOffset', () => {
  it('is 0 for the target date and -1440 for the day before', () => {
    expect(dayOffset(D, D)).toBe(0);
    expect(dayOffset(PREV, D)).toBe(-1440);
  });
  it('is null for anything else (incl. month boundaries handled by Date)', () => {
    expect(dayOffset('2026-07-01', D)).toBeNull();
    expect(dayOffset('2026-06-30', '2026-07-01')).toBe(-1440);
  });
});

describe('rowWindows', () => {
  it('discards an implausible session (> MAX_SESSION_MIN) as noise, not presence', () => {
    const w = rowWindows(row({ sysLoginMin: 60, sysLogoutMin: 2 }), 0);   // 23h58 wrapped
    expect(MAX_SESSION_MIN).toBe(960);
    expect(w.sessions).toHaveLength(0);
    expect(w.hasEvidence).toBe(false);
    expect(w.suspect).toBe(true);
  });
  it('keeps both sessions of a split shift', () => {
    const w = rowWindows(row({ sysLogin2Min: 1000, sysLogout2Min: 1200 }), 0);
    expect(w.sessions).toHaveLength(2);
  });
  it('treats an open session (no logout) as no evidence', () => {
    const w = rowWindows(row({ sysLogoutMin: null }), 0);
    expect(w.hasEvidence).toBe(false);
  });
  it('places a previous-day row on the negative axis so only its tail lands on the day', () => {
    const w = rowWindows(row({ workDate: PREV, shiftStartMin: 1320, shiftEndMin: 420 }), -1440);
    expect(w.shift).toEqual({ s: -120, e: 420 });   // 22:00 D-1 → 07:00 D
  });
});

/* ── interval grid ─────────────────────────────────────────────────────────── */
describe('buildIntraday', () => {
  it('counts a fully adherent morning shift as 100% for its own hours only', () => {
    const g = buildIntraday([row({})], D, 60);
    const at = (h: number) => g.total.intervals[h];
    expect(at(6).scheduled).toBe(0);              // 06:00 — before the 07:00 shift
    expect(at(7).scheduled).toBe(1);
    expect(at(7).onSystem).toBe(1);
    expect(at(7).adherencePct).toBe(100);
    expect(at(7).risk).toBe('ok');
    expect(at(15).scheduled).toBe(1);             // 15:00 — last hour before 16:00
    expect(at(16).scheduled).toBe(0);
  });

  it('carries a previous-day midnight shift into the early hours of the target day', () => {
    const g = buildIntraday(
      [row({ workDate: PREV, shiftStartMin: 1320, shiftEndMin: 420, sysLoginMin: 1320, sysLogoutMin: 420 })],
      D, 60,
    );
    expect(g.total.intervals[0].scheduled).toBe(1);    // 00:00 staffed by D-1's MD
    expect(g.total.intervals[0].onSystem).toBe(1);
    expect(g.total.intervals[6].scheduled).toBe(1);    // 06:00 — last hour before 07:00
    expect(g.total.intervals[7].scheduled).toBe(0);
    expect(g.total.intervals[23].scheduled).toBe(0);   // the D-1 evening is NOT re-counted on D
  });

  it('a late login costs adherence in the hours it actually missed', () => {
    // scheduled 07:00-16:00, logged in 09:00 → 07 and 08 missed
    const g = buildIntraday([row({ sysLoginMin: 540 })], D, 60);
    expect(g.total.intervals[7].adherencePct).toBe(0);
    expect(g.total.intervals[7].risk).toBe('critical');
    expect(g.total.intervals[9].adherencePct).toBe(100);
    expect(g.total.summary.adherencePct).toBeCloseTo(77.8, 1);   // 7 of 9 hours
  });

  it('NEVER reports 0% when the evidence is missing — it reports null/unknown', () => {
    const g = buildIntraday([row({ sysLoginMin: null, sysLogoutMin: null })], D, 60);
    const c = g.total.intervals[8];
    expect(c.scheduled).toBe(1);
    expect(c.noEvidence).toBe(1);
    expect(c.measured).toBe(0);
    expect(c.adherencePct).toBeNull();
    expect(c.risk).toBe('unknown');
    expect(c.coverageState).toBe('unknown');       // the shortfall is unproven
    expect(g.total.summary.adherencePct).toBeNull();
    expect(g.total.summary.measuredCoveragePct).toBe(0);
  });

  it('mixes measurable and unmeasurable rows without letting the blind row score 0', () => {
    const g = buildIntraday([
      row({ personNo: 'A' }),                                        // on system
      row({ personNo: 'B', sysLoginMin: null, sysLogoutMin: null }), // no evidence
    ], D, 60);
    const c = g.total.intervals[8];
    expect(c.scheduled).toBe(2);
    expect(c.noEvidence).toBe(1);
    expect(c.measured).toBe(1);
    expect(c.adherencePct).toBe(100);              // 1 of 1 MEASURABLE, not 50
    expect(c.gap).toBe(-1);
    expect(c.coverageState).toBe('unknown');       // gap fully explained by the blind row
  });

  it('counts work outside the shift as unscheduled-on-system surplus (OT / off-day OT)', () => {
    const g = buildIntraday([
      row({ presence: 'off', shiftStartMin: null, shiftEndMin: null, sysLoginMin: 600, sysLogoutMin: 900 }),
    ], D, 60);
    const c = g.total.intervals[10];
    expect(c.scheduled).toBe(0);
    expect(c.onSystem).toBe(1);
    expect(c.unscheduledOnSystem).toBe(1);
    expect(c.gap).toBe(1);
    expect(c.coverageState).toBe('surplus');
  });

  it('tags shrinkage and permission rows while still counting them as scheduled', () => {
    const g = buildIntraday([
      row({ personNo: 'S', presence: 'sick', sysLoginMin: null, sysLogoutMin: null }),
      row({ personNo: 'P', permissionType: 'personal' }),
    ], D, 60);
    const c = g.total.intervals[8];
    expect(c.scheduled).toBe(2);
    expect(c.shrinkage).toBe(1);
    expect(c.onPermission).toBe(1);
  });

  it('splits by function and keeps a per-function + ALL total', () => {
    const g = buildIntraday([
      row({ functionName: 'Inbound' }),
      row({ functionName: 'CH - WA', personNo: 'X' }),
    ], D, 60);
    expect(g.functions.map(f => f.functionName).sort()).toEqual(['CH - WA', 'Inbound']);
    expect(g.total.intervals[8].scheduled).toBe(2);
    expect(g.functions[0].intervals[8].scheduled).toBe(1);
  });

  it('honours the grain (30 min default → 48 cells, 15 → 96)', () => {
    expect(buildIntraday([], D).total.intervals).toHaveLength(48);
    expect(buildIntraday([], D, 15).total.intervals).toHaveLength(96);
    expect(buildIntraday([], D, 60).total.intervals).toHaveLength(24);
  });
});

/* ── grading ───────────────────────────────────────────────────────────────── */
describe('riskFor / coverageStateFor', () => {
  const base = { scheduled: 10, measured: 10, adherencePct: 100, gap: 0, coverageState: 'met' as const };
  it('bands adherence 90/80/60', () => {
    expect(riskFor({ ...base, adherencePct: 95 })).toBe('ok');
    expect(riskFor({ ...base, adherencePct: 85 })).toBe('watch');
    expect(riskFor({ ...base, adherencePct: 70 })).toBe('at_risk');
    expect(riskFor({ ...base, adherencePct: 40 })).toBe('critical');
  });
  it('escalates on a proven headcount shortfall but never downgrades', () => {
    expect(riskFor({ ...base, adherencePct: 95, gap: -5, coverageState: 'short' })).toBe('critical');
    expect(riskFor({ ...base, adherencePct: 95, gap: -3, coverageState: 'short' })).toBe('at_risk');
    expect(riskFor({ ...base, adherencePct: 40, gap: -1, coverageState: 'short' })).toBe('critical');
  });
  it('is unknown when nothing is measurable and ok when nothing is planned', () => {
    expect(riskFor({ ...base, measured: 0, adherencePct: null })).toBe('unknown');
    expect(riskFor({ ...base, scheduled: 0 })).toBe('ok');
  });
  it('only calls a shortfall "short" when evidence cannot explain it', () => {
    expect(coverageStateFor(2, 0)).toBe('surplus');
    expect(coverageStateFor(0, 0)).toBe('met');
    expect(coverageStateFor(-2, 3)).toBe('unknown');
    expect(coverageStateFor(-4, 1)).toBe('short');
  });
  it('formats interval labels', () => {
    expect(hhmm(0)).toBe('00:00');
    expect(hhmm(90)).toBe('01:30');
    expect(hhmm(1425)).toBe('23:45');
  });
});

/* ── gap windows ───────────────────────────────────────────────────────────── */
describe('mergeGapWindows', () => {
  const cell = (index: number, risk: any, gap: number, adh: number | null) => ({
    index, start: hhmm(index * 30), endMin: index * 30 + 30, risk,
    scheduled: 4, onSystem: 4 + gap, adherencePct: adh, gap,
  });
  it('merges consecutive flagged intervals and keeps the WORST numbers', () => {
    const w = mergeGapWindows('Social Media & Email', [
      cell(28, 'ok', 0, 100),
      cell(29, 'at_risk', -2, 66.7),
      cell(30, 'critical', -3, 50),
      cell(31, 'critical', -3, 50),
      cell(32, 'ok', 0, 100),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      functionName: 'Social Media & Email', start: '14:30', end: '16:00',
      spanIntervals: 3, risk: 'critical', gap: -3, adherencePct: 50,
    });
  });
  it('keeps non-adjacent runs separate', () => {
    const w = mergeGapWindows('Inbound', [
      cell(18, 'at_risk', -2, 66),
      cell(20, 'critical', -4, 30),
      cell(21, 'critical', -4, 30),
    ]);
    expect(w.map(x => [x.start, x.spanIntervals])).toEqual([['09:00', 1], ['10:00', 2]]);
  });
  it('returns nothing when nothing is flagged', () => {
    expect(mergeGapWindows('X', [cell(1, 'ok', 0, 100), cell(2, 'unknown', 0, null)])).toEqual([]);
  });
});

/* ── alerts ────────────────────────────────────────────────────────────────── */
const alertInput = (o: Partial<AlertInput> = {}): AlertInput => ({
  today: '2026-07-21',
  feed: {
    hasSnapshot: true, capturedAt: '2026-07-21T10:00:00.000Z', staleSec: 30, isStale: false,
    queueFeedMissing: false, queueCount: 5, agentCount: 100, knownStatusAgents: 100,
  },
  roster: { maxDate: '2026-07-21', ageDays: 0, resolvedDate: '2026-07-21' },
  liveCoverage: { lastUpdatedAt: '2026-07-21T10:00:00.000Z', ageMin: 1, snapshotDate: '2026-07-21' },
  agentStats: { maxStatDate: '2026-07-21', ageDays: 0 },
  intraday: { date: '2026-07-21', worst: [], unknownIntervals: 0 },
  tardiness: { date: '2026-07-21', lateLogins: 0, earlyLogouts: 0, missingSystem: 0, workingHeadcount: 50 },
  ...o,
});
const types = (a: ReturnType<typeof deriveAlerts>) => a.map(x => x.type);

describe('deriveAlerts', () => {
  it('is silent when everything is fresh and healthy', () => {
    expect(deriveAlerts(alertInput())).toEqual([]);
  });

  it('raises a critical when no snapshot has ever arrived', () => {
    const a = deriveAlerts(alertInput({ feed: null }));
    expect(types(a)).toContain('feed_absent');
    expect(a[0].severity).toBe('critical');
  });

  it('raises queue-blind + status-blind for the live degraded capture', () => {
    const a = deriveAlerts(alertInput({
      feed: {
        hasSnapshot: true, capturedAt: '2026-07-20T18:27:28.000Z', staleSec: 66000, isStale: true,
        queueFeedMissing: true, queueCount: 0, agentCount: 180, knownStatusAgents: 0,
      },
    }));
    expect(types(a)).toEqual(expect.arrayContaining(['feed_stale', 'queue_feed_missing', 'agent_status_blind']));
    expect(a.every(x => x.text_en.length > 0 && x.text_ar.length > 0)).toBe(true);
    const q = a.find(x => x.type === 'queue_feed_missing')!;
    expect(q.severity).toBe('critical');
    expect(q.metric).toMatchObject({ queueCount: 0, agentCount: 180 });
    // it must say UNKNOWN, never a green zero
    expect(q.text_en).toMatch(/UNKNOWN/);
  });

  it('warns when the reconciled roster is behind today', () => {
    const a = deriveAlerts(alertInput({
      roster: { maxDate: '2026-07-03', ageDays: 18, resolvedDate: '2026-07-03' },
    }));
    const r = a.find(x => x.type === 'roster_stale')!;
    expect(r.metric).toMatchObject({ ageDays: 18, maxDate: '2026-07-03' });
    expect(r.asOf).toBe('2026-07-03');
  });

  it('flags stale agent-board enrichment so old stats are not read as today', () => {
    const a = deriveAlerts(alertInput({ agentStats: { maxStatDate: '2026-07-16', ageDays: 5 } }));
    expect(types(a)).toContain('agent_stats_stale');
  });

  it('flags a stale live-coverage overlay instead of trusting a bare 0', () => {
    const a = deriveAlerts(alertInput({
      liveCoverage: { lastUpdatedAt: '2026-07-14T12:27:10.000Z', ageMin: 10080, snapshotDate: '2026-07-03' },
    }));
    expect(types(a)).toContain('live_coverage_stale');
  });

  it('emits one staffing-gap alert per WINDOW (not per interval), critical first', () => {
    const a = deriveAlerts(alertInput({
      intraday: {
        date: '2026-07-03', unknownIntervals: 3,
        worst: [
          { functionName: 'Inbound', start: '22:00', end: '23:30', spanIntervals: 3, risk: 'critical', scheduled: 8, onSystem: 2, adherencePct: 25, gap: -6 },
          { functionName: 'CH - WA', start: '13:30', end: '14:00', spanIntervals: 1, risk: 'at_risk', scheduled: 6, onSystem: 4, adherencePct: 66.7, gap: -2 },
        ],
      },
    }));
    const gaps = a.filter(x => x.type === 'intraday_staffing_gap');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].severity).toBe('critical');
    expect(gaps[0].metric).toMatchObject({ functionName: 'Inbound', interval: '22:00', until: '23:30', spanIntervals: 3, gap: -6 });
    expect(gaps[0].text_en).toContain('22:00–23:30');
    expect(gaps.find(g => g.metric.functionName === 'CH - WA')!.text_en).toContain('at 13:30');
    expect(types(a)).toContain('intraday_unmeasurable');
  });

  it('reports today late/early counts with their share of the working headcount', () => {
    const a = deriveAlerts(alertInput({
      tardiness: { date: '2026-07-03', lateLogins: 20, earlyLogouts: 3, missingSystem: 5, workingHeadcount: 58 },
    }));
    const late = a.find(x => x.type === 'late_logins')!;
    expect(late.metric).toMatchObject({ lateLogins: 20, workingHeadcount: 58, pct: 34 });
    expect(late.severity).toBe('warning');
    expect(a.find(x => x.type === 'early_logouts')!.severity).toBe('info');   // 5% → info
    const ms = a.find(x => x.type === 'missing_system_login')!;
    expect(ms.text_en).toMatch(/not counted absent/);
  });

  it('sorts critical → warning → info and gives every alert a bilingual text + source', () => {
    const a = deriveAlerts(alertInput({
      feed: { hasSnapshot: true, capturedAt: null, staleSec: 7200, isStale: true, queueFeedMissing: true, queueCount: 0, agentCount: 180, knownStatusAgents: 0 },
      roster: { maxDate: '2026-07-03', ageDays: 18, resolvedDate: '2026-07-03' },
      tardiness: { date: '2026-07-03', lateLogins: 2, earlyLogouts: 0, missingSystem: 0, workingHeadcount: 58 },
    }));
    const sev = a.map(x => x.severity);
    expect(sev).toEqual([...sev].sort((x, y) => ({ critical: 0, warning: 1, info: 2 }[x] - { critical: 0, warning: 1, info: 2 }[y])));
    for (const x of a) {
      expect(x.text_en.trim().length).toBeGreaterThan(10);
      expect(x.text_ar.trim().length).toBeGreaterThan(10);
      expect(x.source.length).toBeGreaterThan(0);
      expect(typeof x.metric).toBe('object');
    }
  });
});
