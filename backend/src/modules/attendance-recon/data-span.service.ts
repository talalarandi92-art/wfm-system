/**
 * WHERE THE DATA ACTUALLY IS — one authoritative answer, so no screen has to guess.
 *
 * THE PROBLEM THIS FIXES: pages were choosing their own opening date three different
 * ways — one hard-coded a month, one asked for "this week", one asked for "today".
 * All three are wrong the moment the roster is not current: on 2026-07-24 the spine
 * ended 2026-07-03, so "this week" and "today" both opened a blank screen while the
 * database held 19,295 rows. A blank screen is the worst possible answer, because it
 * looks like the system has nothing rather than like the question was aimed past the
 * data.
 *
 * So every date-driven screen asks THIS, once, and opens on ground that exists:
 *   · `latestDay`      the newest day the roster covers
 *   · `latestWeek`     the newest Saturday week with data (BR-TIM-001)
 *   · `latestFullWeek` the newest Saturday week that is COMPLETE — what you want for
 *                      a weekly comparison, since a part-week always looks like a dip
 *   · `latestMonth`    the newest month with data, and its exact first/last day
 *   · `freshness`      how many days behind each feed is, stated plainly
 *
 * It never invents a date and never returns "today" unless today really has data.
 * READ-ONLY.
 */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DataSpanFeed {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  rows: number;
  /** Days between this feed's newest row and today. null when the feed is empty. */
  daysBehind: number | null;
  /** true when the feed is current enough to drive a "live" screen. */
  current: boolean;
}

export interface DataSpanReport {
  today: string;
  roster: { from: string | null; to: string | null; days: number; rows: number; people: number };
  latestDay: string | null;
  latestWeek: string | null;
  latestFullWeek: string | null;
  latestMonth: string | null;
  latestMonthFrom: string | null;
  latestMonthTo: string | null;
  /** A sensible default window for a report page: the newest complete month. */
  defaultFrom: string | null;
  defaultTo: string | null;
  daysBehind: number | null;
  feeds: DataSpanFeed[];
  note: string;
}

@Injectable()
export class DataSpanService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Does a table/column pair exist? Feeds come and go across migrations; a missing
   *  one must degrade to "unknown", never take the whole endpoint down. */
  private async has(table: string, column: string): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column],
    ).catch(() => []);
    return rows.length > 0;
  }

  private async feed(key: string, label: string, table: string, dateCol: string, currentWithinDays: number): Promise<DataSpanFeed> {
    const empty: DataSpanFeed = { key, label, from: null, to: null, rows: 0, daysBehind: null, current: false };
    if (!(await this.has(table, dateCol))) return empty;
    const [r] = await this.ds.query(
      `SELECT MIN(${dateCol})::text AS a, MAX(${dateCol})::text AS b, COUNT(*)::int AS n,
              (CURRENT_DATE - MAX(${dateCol})::date)::int AS behind
         FROM ${table}`,
    ).catch(() => [null]);
    if (!r || !r.b) return empty;
    return {
      key, label, from: r.a, to: r.b, rows: r.n,
      daysBehind: r.behind, current: r.behind <= currentWithinDays,
    };
  }

  async build(tenantId: string): Promise<DataSpanReport> {
    const [span] = await this.ds.query(
      `SELECT MIN(work_date)::text AS a, MAX(work_date)::text AS b,
              COUNT(*)::int AS rows, COUNT(DISTINCT person_no)::int AS people,
              COUNT(DISTINCT work_date)::int AS days,
              (CURRENT_DATE - MAX(work_date)::date)::int AS behind,
              CURRENT_DATE::text AS today
         FROM roster_days WHERE tenant_id = $1`,
      [tenantId],
    ).catch(() => [null]);

    const today = span?.today ?? new Date().toISOString().slice(0, 10);
    if (!span?.b) {
      return {
        today, roster: { from: null, to: null, days: 0, rows: 0, people: 0 },
        latestDay: null, latestWeek: null, latestFullWeek: null,
        latestMonth: null, latestMonthFrom: null, latestMonthTo: null,
        defaultFrom: null, defaultTo: null, daysBehind: null, feeds: [],
        note: 'The roster is empty — upload a month and rebuild before using the date-driven screens.',
      };
    }

    /* Saturday weeks, computed in SQL so the week rule (BR-TIM-001) is applied once.
       `date_trunc('week')` is Monday-based, so shift by one day either side. */
    const [weeks] = await this.ds.query(
      `WITH w AS (
         SELECT (date_trunc('week', work_date + INTERVAL '1 day') - INTERVAL '1 day')::date AS wk,
                COUNT(DISTINCT work_date)::int AS days
           FROM roster_days WHERE tenant_id = $1 GROUP BY 1
       )
       SELECT (SELECT wk::text FROM w ORDER BY wk DESC LIMIT 1)                    AS latest_week,
              (SELECT wk::text FROM w WHERE days >= 7 ORDER BY wk DESC LIMIT 1)    AS latest_full_week`,
      [tenantId],
    ).catch(() => [{}]);

    const [month] = await this.ds.query(
      `SELECT to_char(MAX(work_date), 'YYYY-MM')                                   AS m,
              date_trunc('month', MAX(work_date))::date::text                      AS m_from,
              (date_trunc('month', MAX(work_date)) + INTERVAL '1 month - 1 day')::date::text AS m_to
         FROM roster_days WHERE tenant_id = $1`,
      [tenantId],
    ).catch(() => [{}]);

    /* The newest month is often a PART month (the roster stops mid-month). For a
       report's opening window a complete month reads better — a half month looks
       like a collapse in every total. Prefer the newest complete one; fall back to
       the part month rather than showing nothing. */
    const [full] = await this.ds.query(
      `SELECT to_char(work_date, 'YYYY-MM') AS m,
              date_trunc('month', work_date)::date::text AS m_from,
              (date_trunc('month', work_date) + INTERVAL '1 month - 1 day')::date::text AS m_to
         FROM roster_days WHERE tenant_id = $1
        GROUP BY 1, 2, 3
       HAVING MAX(work_date) >= (date_trunc('month', MIN(work_date)) + INTERVAL '1 month - 1 day')::date
        ORDER BY 1 DESC LIMIT 1`,
      [tenantId],
    ).catch(() => [null]);

    const feeds = await Promise.all([
      this.feed('roster', 'Reconciled roster (roster_days)', 'roster_days', 'work_date', 2),
      this.feed('sprinklr', 'Sprinklr agent stats', 'agent_daily_stats', 'stat_date', 1),
      this.feed('schedule', 'Schedule grid', 'schedule_entries', 'work_date', 2),
      this.feed('volume', 'Contact volume', 'contact_volume_daily', 'work_date', 3),
    ]);

    const defFrom = full?.m_from ?? month?.m_from ?? span.a;
    const defTo = full?.m_to ?? span.b;

    return {
      today,
      roster: { from: span.a, to: span.b, days: span.days, rows: span.rows, people: span.people },
      latestDay: span.b,
      latestWeek: weeks?.latest_week ?? null,
      latestFullWeek: weeks?.latest_full_week ?? weeks?.latest_week ?? null,
      latestMonth: month?.m ?? null,
      latestMonthFrom: month?.m_from ?? null,
      latestMonthTo: month?.m_to ?? null,
      defaultFrom: defFrom,
      defaultTo: defTo,
      daysBehind: span.behind,
      feeds: feeds.filter((f) => f.rows > 0),
      note:
        span.behind > 2
          ? `The roster is ${span.behind} day(s) behind today (${today}); it covers ${span.a} → ${span.b}. ` +
            'Date-driven screens open on the newest day that has data rather than on an empty "today".'
          : `The roster is current through ${span.b}.`,
    };
  }
}
