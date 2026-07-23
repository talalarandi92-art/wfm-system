/**
 * The readiness report's only value is its HONESTY, so the tests guard the two
 * ways it lied during development:
 *   1. a probe that hit a wrong column name was swallowed and rendered as
 *      "no data" — a populated table looked like an empty feed;
 *   2. "ready" used a fixed threshold of 20 people, so a feed covering 20 of 128
 *      people (16%) was reported ready.
 */
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AutoScoringReadinessService } from './auto-scoring-readiness.service';

const TID = 't1';

/** Feeds the service canned rows per SQL fragment; anything else → error. */
function makeDs(plan: { match: RegExp; row?: any; throws?: string }[]) {
  return {
    query: jest.fn(async (sql: string) => {
      if (/AS "from"/.test(sql)) return [{ from: '2026-04-23', to: '2026-07-23' }];
      const hit = plan.find((p) => p.match.test(sql));
      if (!hit) return [{ rows: 0, people: 0, latest: null }];
      if (hit.throws) throw new Error(hit.throws);
      return [hit.row];
    }),
  };
}

async function build(ds: any) {
  const mod = await Test.createTestingModule({
    providers: [AutoScoringReadinessService, { provide: getDataSourceToken(), useValue: ds }],
  }).compile();
  return mod.get(AutoScoringReadinessService);
}

const ROSTER_FULL = { match: /FROM roster_days[\s\S]*work_date >= \$2/, row: { rows: 3000, people: 128, latest: '2026-07-03' } };

describe('AutoScoringReadinessService — the report cannot flatter itself', () => {
  it('a FAILED probe is reported as probe-error, never as "missing"', async () => {
    const svc = await build(makeDs([
      ROSTER_FULL,
      { match: /FROM scorecard_entries/, throws: 'column "employee_id" does not exist' },
    ]));
    const r = await svc.report(TID);
    const quality = r.kpis.find((k) => k.kpiCode === 'QUALITY')!;
    expect(quality.state).toBe('probe-error');
    expect(quality.blockedBy).toContain('the readiness probe itself failed');
    expect(quality.blockedBy).toContain('employee_id');
    // and it must NOT be silently counted as auto-scorable
    expect(r.autoScorablePoints).toBeLessThan(r.scoredPointsTotal);
  });

  it('a feed covering 20 of 128 people is PARTIAL, not ready (no magic threshold)', async () => {
    const svc = await build(makeDs([
      ROSTER_FULL,
      { match: /avg_response_seconds IS NOT NULL/, row: { rows: 400, people: 20, latest: '2026-07-10' } },
    ]));
    const r = await svc.report(TID);
    const rt = r.kpis.find((k) => k.kpiCode === 'RESPONSE_TIME')!;
    expect(rt.state).toBe('partial');
    expect(rt.coveragePct).toBeCloseTo(15.6, 1);
    expect(rt.blockedBy).toContain('20 of 128');
  });

  it('a feed covering nearly everyone IS ready, and its points count', async () => {
    const svc = await build(makeDs([
      ROSTER_FULL,
      { match: /worked_min > 0/, row: { rows: 2800, people: 125, latest: '2026-07-03' } },
    ]));
    const r = await svc.report(TID);
    const prod = r.kpis.find((k) => k.kpiCode === 'PRODUCTIVITY')!;
    expect(prod.state).toBe('ready');
    expect(prod.coveragePct).toBeGreaterThanOrEqual(80);
    expect(r.autoScorablePoints).toBeGreaterThanOrEqual(prod.weight);
  });

  it('a manually-uploaded KPI is never "ready" even when rows exist', async () => {
    const svc = await build(makeDs([
      ROSTER_FULL,
      { match: /FROM scorecard_entries/, row: { rows: 367, people: 128, latest: '2026-06-11' } },
    ]));
    const r = await svc.report(TID);
    for (const code of ['QUALITY', 'QUIZ', 'COMMON_MISTAKES']) {
      const k = r.kpis.find((x) => x.kpiCode === code)!;
      expect(k.state).toBe('partial');                 // present, but a human put it there
      expect(k.blockedBy).toContain('a person must upload it');
    }
  });

  it('the verdict refuses a green light the data does not support', async () => {
    const svc = await build(makeDs([ROSTER_FULL]));   // nothing else has any data
    const r = await svc.report(TID);
    expect(r.verdict.canAutoScore).toBe(false);
    expect(r.verdict.text_en).toContain('NOT viable');
    expect(r.verdict.text_en).toContain('the DATA is what is missing');
    // every blocker is priced, biggest first
    expect(r.unlockedBy.length).toBeGreaterThan(0);
    for (let i = 1; i < r.unlockedBy.length; i++) {
      expect(r.unlockedBy[i - 1].points).toBeGreaterThanOrEqual(r.unlockedBy[i].points);
    }
  });

  it('prices the blockers so they sum to what is NOT auto-scorable', async () => {
    const svc = await build(makeDs([
      ROSTER_FULL,
      { match: /worked_min > 0/, row: { rows: 2800, people: 125, latest: '2026-07-03' } },
    ]));
    const r = await svc.report(TID);
    const blocked = r.unlockedBy.reduce((s, u) => s + u.points, 0);
    expect(blocked + r.autoScorablePoints).toBeCloseTo(r.scoredPointsTotal, 5);
  });
});
