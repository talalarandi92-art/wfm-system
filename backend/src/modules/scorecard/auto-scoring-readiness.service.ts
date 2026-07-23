/**
 * AUTO-SCORING READINESS (wave B6 gate).
 *
 * B7 proved the SCORING ENGINE is right (98.95% vs the Director's own workbooks).
 * That answers "can we score correctly?" — it does NOT answer "do we have the
 * numbers to score FROM?". Those are different questions, and building an
 * auto-scorer without asking the second one produces a machine that confidently
 * scores nothing.
 *
 * This service asks the second question against the LIVE database: for every KPI
 * in the registry, does a real feed carry its raw value, how fresh is it, and how
 * many people does it cover. Nothing is hardcoded as "ready" — each probe is a
 * COUNT over the actual table, so the verdict changes by itself the day a feed
 * lands (or stops).
 *
 * The output is a decision instrument, not a status page: it prices each missing
 * feed in NET POINTS, so "should we chase the Sprinklr key?" becomes a number
 * instead of an opinion.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SEED_KPIS } from '../kpi-registry/kpi-seed';

interface ProbeResult { rows: number; people: number; latest: string | null; error: string | null }

export type ReadyState = 'ready' | 'partial' | 'missing' | 'not-scored' | 'probe-error';

export interface KpiReadiness {
  kpiCode: string;
  nameEn: string;
  nameAr: string;
  /** Max points this KPI contributes to Net Points (0 = tracked, not scored). */
  weight: number;
  /** Where the raw value is supposed to come from (registry text). */
  source: string;
  /** The table/column actually probed, so the verdict is auditable. */
  probe: string;
  /** Rows carrying a usable raw value in the probe window. */
  rowsWithValue: number;
  /** Distinct people covered. */
  peopleCovered: number;
  /** Newest date the feed carries, ISO. */
  latestDate: string | null;
  /** peopleCovered / the scoreable population — the honest coverage measure. */
  coveragePct: number | null;
  state: ReadyState;
  /** What is blocking, in one sentence — empty when ready. */
  blockedBy: string;
}

export interface ReadinessReport {
  generatedAt: string;
  window: { from: string; to: string };
  /** Distinct people on the roster in the window — the coverage denominator. */
  population: number;
  /** Net Points the engine could compute today, out of the scored total. */
  autoScorablePoints: number;
  scoredPointsTotal: number;
  autoScorablePct: number;
  /** Points each missing feed would unlock, biggest first — the decision list. */
  unlockedBy: { feed: string; points: number; kpis: string[] }[];
  kpis: KpiReadiness[];
  /** Plain-language verdict; never a green light the data does not support. */
  verdict: { canAutoScore: boolean; text_en: string; text_ar: string };
}

/** Which feed a KPI's raw value must arrive on — used to price the blockers. */
const FEED_OF: Record<string, string> = {
  QUALITY: 'QA monthly file (manual upload)',
  PRR: 'Sprinklr survey export',
  SURVEY_RR: 'Sprinklr survey export',
  FCR: 'Sprinklr Case-Assignments',
  CTR: 'Sprinklr / Ameyo contacts-vs-tickets',
  RESPONSE_TIME: 'Sprinklr Case-Assignments',
  AHT: 'Sprinklr agent performance / Ameyo voice',
  QUIZ: 'MS-Forms quiz export (manual upload)',
  COMMON_MISTAKES: 'TL/QA mistake log (manual)',
  COMMITMENT: 'MS-Forms quiz export (manual upload)',
  INCIDENTS: 'TL/RTA incident log (manual)',
  CSAT: 'Sprinklr survey export',
  NPS: 'Sprinklr survey export',
  PRODUCTIVITY: 'roster_days (already live)',
  ATTENDANCE: 'roster_days (already live)',
};

@Injectable()
export class AutoScoringReadinessService {
  private readonly log = new Logger(AutoScoringReadinessService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * COUNT probe that never throws. CRITICAL: a failed probe reports `error` — it
   * does NOT return a zero. A wrong column name once made a populated table look
   * like an empty feed, which is the exact dishonesty this report exists to kill.
   */
  private async probe(
    sql: string,
    params: unknown[],
  ): Promise<ProbeResult> {
    try {
      const [r] = await this.ds.query(sql, params);
      return {
        rows: Number(r?.rows ?? 0),
        people: Number(r?.people ?? 0),
        latest: r?.latest ?? null,
        error: null,
      };
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      this.log.warn(`readiness probe FAILED (reported, not swallowed): ${msg}`);
      return { rows: 0, people: 0, latest: null, error: msg };
    }
  }

  async report(tenantId: string, months = 3): Promise<ReadinessReport> {
    const [win] = await this.ds.query(
      `SELECT (CURRENT_DATE - ($1::int * INTERVAL '1 month'))::date::text AS "from",
              CURRENT_DATE::text AS "to"`,
      [months],
    );

    /* ── the probes. Each one asks the DB, so the report cannot go stale. ──
       The Sprinklr probes count DISTINCT employee_id, never sprinklr_agent_id:
       the denominator is roster PEOPLE, so counting agent ids compared two
       different populations — and a stat row with no employee link cannot be
       attributed to anyone, so it is worth nothing to scoring however rich it is. */
    const rosterProd = await this.probe(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT person_no) AS people, MAX(work_date)::text AS latest
         FROM roster_days
        WHERE tenant_id = $1 AND work_date >= $2::date AND worked_min > 0`,
      [tenantId, win.from],
    );
    const rosterAtt = await this.probe(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT person_no) AS people, MAX(work_date)::text AS latest
         FROM roster_days
        WHERE tenant_id = $1 AND work_date >= $2::date`,
      [tenantId, win.from],
    );
    const aht = await this.probe(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT employee_id) AS people, MAX(stat_date)::text AS latest
         FROM agent_daily_stats
        WHERE tenant_id = $1 AND stat_date >= $2::date AND aht_seconds IS NOT NULL`,
      [tenantId, win.from],
    );
    const frt = await this.probe(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT employee_id) AS people, MAX(stat_date)::text AS latest
         FROM agent_daily_stats
        WHERE tenant_id = $1 AND stat_date >= $2::date AND avg_response_seconds IS NOT NULL`,
      [tenantId, win.from],
    );
    const contacts = await this.probe(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT employee_id) AS people, MAX(stat_date)::text AS latest
         FROM agent_daily_stats
        WHERE tenant_id = $1 AND stat_date >= $2::date AND contacts_received IS NOT NULL`,
      [tenantId, win.from],
    );
    /* QA / quiz / mistakes only ever arrive inside an uploaded scorecard batch —
       probing scorecard_entries tells us whether a HUMAN uploaded them, which is
       exactly the dependency we are trying to remove. */
    const uploaded = await this.probe(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT employee_no) AS people, MAX(created_at)::date::text AS latest
         FROM scorecard_entries
        WHERE tenant_id = $1`,
      [tenantId],
    );

    /* The denominator for coverage: people actually on the roster in the window.
       A feed covering 20 of 128 people is 16% covered, not "ready" — the earlier
       fixed threshold of 20 called exactly that case ready. */
    const population = rosterAtt.people || 0;
    /** A column/table that genuinely does not exist — nothing found, no error. */
    const EMPTY: ProbeResult = { rows: 0, people: 0, latest: null, error: null };

    const PROBES: Record<string, { probe: string; res: ProbeResult }> = {
      PRODUCTIVITY:    { probe: 'roster_days.worked_min',                res: rosterProd },
      ATTENDANCE:      { probe: 'roster_days (all rows)',                res: rosterAtt },
      AHT:             { probe: 'agent_daily_stats.aht_seconds',         res: aht },
      RESPONSE_TIME:   { probe: 'agent_daily_stats.avg_response_seconds', res: frt },
      CTR:             { probe: 'agent_daily_stats.contacts_received',   res: contacts },
      FCR:             { probe: 'agent_daily_stats (no FCR column)',     res: EMPTY },
      PRR:             { probe: 'no survey table',                       res: EMPTY },
      SURVEY_RR:       { probe: 'no survey table',                       res: EMPTY },
      CSAT:            { probe: 'no survey table',                       res: EMPTY },
      NPS:             { probe: 'no survey table',                       res: EMPTY },
      QUALITY:         { probe: 'scorecard_entries (manual upload only)', res: uploaded },
      QUIZ:            { probe: 'scorecard_entries (manual upload only)', res: uploaded },
      COMMITMENT:      { probe: 'scorecard_entries (manual upload only)', res: uploaded },
      COMMON_MISTAKES: { probe: 'scorecard_entries (manual upload only)', res: uploaded },
      INCIDENTS:       { probe: 'no incident table',                     res: EMPTY },
    };

    /* A KPI sourced from a MANUAL upload is never "ready" for AUTO-scoring, even
       when rows exist — the rows are there because a person put them there. That
       distinction is the whole point of this report. */
    const MANUAL = new Set(['QUALITY', 'QUIZ', 'COMMITMENT', 'COMMON_MISTAKES', 'INCIDENTS']);

    const kpis: KpiReadiness[] = SEED_KPIS.map((k) => {
      const p = PROBES[k.code] ?? { probe: '(no probe defined)', res: EMPTY };
      const scored = k.weight > 0;
      const coveragePct = population > 0 ? +(100 * p.res.people / population).toFixed(1) : null;

      let state: ReadyState;
      if (p.res.error) state = 'probe-error';                 // never dressed up as "missing"
      else if (!scored) state = 'not-scored';
      else if (MANUAL.has(k.code)) state = p.res.rows > 0 ? 'partial' : 'missing';
      else if (p.res.rows === 0) state = 'missing';
      else if ((coveragePct ?? 0) < 80) state = 'partial';    // covers most of the floor, or it is not ready
      else state = 'ready';

      const feed = FEED_OF[k.code] ?? 'unknown feed';
      const blockedBy =
        state === 'probe-error' ? `the readiness probe itself failed: ${p.res.error}`
          : state === 'ready' || state === 'not-scored' ? ''
            : MANUAL.has(k.code)
              ? `arrives only via ${feed} — a person must upload it`
              : p.res.rows === 0
                ? `${feed} carries no value in the window`
                : `${feed} covers only ${p.res.people} of ${population} people (${coveragePct}%)`;

      return {
        kpiCode: k.code, nameEn: k.nameEn, nameAr: k.nameAr,
        weight: k.weight, source: k.source, probe: p.probe,
        rowsWithValue: p.res.rows, peopleCovered: p.res.people, latestDate: p.res.latest,
        coveragePct, state, blockedBy,
      };
    });

    const scoredKpis = kpis.filter((k) => k.weight > 0);
    const scoredPointsTotal = scoredKpis.reduce((s, k) => s + k.weight, 0);
    const autoScorablePoints = scoredKpis.filter((k) => k.state === 'ready').reduce((s, k) => s + k.weight, 0);

    /* Price every blocker in points — the decision list. */
    const byFeed = new Map<string, { points: number; kpis: string[] }>();
    for (const k of scoredKpis) {
      if (k.state === 'ready') continue;
      const feed = FEED_OF[k.kpiCode] ?? 'unknown feed';
      const e = byFeed.get(feed) ?? { points: 0, kpis: [] };
      e.points += k.weight;
      e.kpis.push(k.kpiCode);
      byFeed.set(feed, e);
    }
    const unlockedBy = [...byFeed.entries()]
      .map(([feed, v]) => ({ feed, points: v.points, kpis: v.kpis }))
      .sort((a, b) => b.points - a.points);

    const pct = scoredPointsTotal ? +(100 * autoScorablePoints / scoredPointsTotal).toFixed(1) : 0;
    const top = unlockedBy[0];

    return {
      generatedAt: new Date().toISOString(),
      window: { from: win.from, to: win.to },
      population,
      autoScorablePoints, scoredPointsTotal, autoScorablePct: pct,
      unlockedBy, kpis,
      verdict: {
        // Deliberately strict: auto-scoring is only honest when the engine can
        // reach most of the score. Anything less produces a scorecard with holes.
        canAutoScore: pct >= 80,
        text_en: pct >= 80
          ? `Auto-scoring is viable: ${autoScorablePoints} of ${scoredPointsTotal} Net Points are computable from live feeds.`
          : `Auto-scoring is NOT viable yet — only ${autoScorablePoints} of ${scoredPointsTotal} Net Points (${pct}%) can be computed from live feeds. The engine is validated; the DATA is what is missing.${top ? ` Biggest single unlock: ${top.feed} → +${top.points} points.` : ''}`,
        text_ar: pct >= 80
          ? `التسجيل الآلي ممكن: ${autoScorablePoints} من ${scoredPointsTotal} نقطة قابلة للحساب من التغذيات الحية.`
          : `التسجيل الآلي غير ممكن بعد — فقط ${autoScorablePoints} من ${scoredPointsTotal} نقطة (${pct}%) تُحسب من التغذيات الحية. المحرّك مثبَت؛ الناقص هو البيانات.${top ? ` أكبر مصدر مفقود: ${top.feed} ← +${top.points} نقطة.` : ''}`,
      },
    };
  }
}
