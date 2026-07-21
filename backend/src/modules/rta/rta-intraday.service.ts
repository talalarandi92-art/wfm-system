import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CRED_LATE, CRED_EARLY } from '@common/wfm-metrics';
import { STD_SHIFT_START_SQL, STD_SHIFT_END_SQL } from '../attendance-recon/coverage-core';
import { SprinklrService } from '../integrations/sprinklr/sprinklr.service';
import {
  buildIntraday, deriveAlerts, mergeGapWindows, DEFAULT_GRAIN_MIN,
  IntradayRow, IntradayResult, RtaAlert, AlertInput, GapWindow,
} from './rta-intraday.core';

/**
 * RTA intraday analysis + live-ops alerts (Stage 4A, 2026-07-21).
 *
 * SPINE: `roster_days` — the canonical reconciled roster. The scheduled shift
 * window and the ACTUAL system login/logout come from the same reconciled row,
 * so "were we staffed to plan, hour by hour" is answered from one truth, not by
 * joining a plan table to a live scrape.
 *
 * FRESHNESS IS PART OF THE ANSWER: roster_days is rebuilt by the recon pipeline,
 * so the newest reconciled day is usually BEHIND today. Every response carries
 * the requested date, the date actually served, and its age — an RTA board must
 * never present a days-old day as "now".
 *
 * SELECT-only. Nothing here writes.
 */
@Injectable()
export class RtaIntradayService {
  private readonly logger = new Logger(RtaIntradayService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly sprinklr: SprinklrService,
  ) {}

  /** Resolve the date actually served: never in the future, never a day with no
   *  reconciled rows — fall back to the newest day at/before the request. */
  async resolveDate(tenantId: string, requested?: string): Promise<{
    today: string; requestedDate: string; date: string | null;
    maxDate: string | null; ageDays: number | null; isExact: boolean; isToday: boolean;
  }> {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? '') ? requested! : null;
    const [row] = await this.ds.query(
      `SELECT CURRENT_DATE::text AS today,
              LEAST(COALESCE($2::date, CURRENT_DATE), CURRENT_DATE)::text AS requested,
              (SELECT MAX(work_date)::text FROM roster_days WHERE tenant_id = $1) AS max_date,
              (SELECT MAX(work_date)::text FROM roster_days
                WHERE tenant_id = $1
                  AND work_date <= LEAST(COALESCE($2::date, CURRENT_DATE), CURRENT_DATE)) AS resolved`,
      [tenantId, valid],
    );
    const date: string | null = row?.resolved ?? null;
    const ageDays = date ? Math.round((Date.parse(`${row.today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000) : null;
    return {
      today: row.today,
      requestedDate: row.requested,
      date,
      maxDate: row.max_date ?? null,
      ageDays,
      isExact: date === row.requested,
      isToday: date === row.today,
    };
  }

  /** Raw roster rows for the target day + the previous day (cross-midnight tails). */
  private async fetchRows(tenantId: string, date: string, functionName?: string): Promise<IntradayRow[]> {
    const params: any[] = [tenantId, date];
    let fnFilter = '';
    if (functionName) {
      params.push(functionName);
      fnFilter = ` AND canon_fn(COALESCE(role_function, function_name)) = canon_fn($${params.length})`;
    }
    const rows = await this.ds.query(
      `SELECT work_date::text                                        AS work_date,
              canon_fn(COALESCE(role_function, function_name, '—'))  AS function_name,
              COALESCE(person_no, employee_no)                       AS person_no,
              COALESCE(clean_name, name)                             AS name,
              presence,
              COALESCE(shift_start_min, ${STD_SHIFT_START_SQL})      AS shift_start_min,
              COALESCE(shift_end_min,   ${STD_SHIFT_END_SQL})        AS shift_end_min,
              sys_login_min, sys_logout_min, sys_login2_min, sys_logout2_min,
              permission_type
         FROM roster_days
        WHERE tenant_id = $1
          AND is_active
          AND work_date IN ($2::date, $2::date - 1)${fnFilter}`,
      params,
    );
    return rows.map((r: any): IntradayRow => ({
      workDate: r.work_date,
      functionName: r.function_name ?? '—',
      personNo: r.person_no,
      name: r.name,
      presence: r.presence,
      shiftStartMin: r.shift_start_min == null ? null : Number(r.shift_start_min),
      shiftEndMin: r.shift_end_min == null ? null : Number(r.shift_end_min),
      sysLoginMin: r.sys_login_min == null ? null : Number(r.sys_login_min),
      sysLogoutMin: r.sys_logout_min == null ? null : Number(r.sys_logout_min),
      sysLogin2Min: r.sys_login2_min == null ? null : Number(r.sys_login2_min),
      sysLogout2Min: r.sys_logout2_min == null ? null : Number(r.sys_logout2_min),
      permissionType: r.permission_type,
    }));
  }

  /** GET /rta/intraday — per-interval scheduled vs actual-on-system, per function. */
  async intraday(tenantId: string, opts: { date?: string; functionName?: string; grain?: number }) {
    const grainMin = [15, 30, 60].includes(Number(opts.grain)) ? Number(opts.grain) : DEFAULT_GRAIN_MIN;
    const res = await this.resolveDate(tenantId, opts.date);

    const meta = {
      requestedDate: res.requestedDate,
      date: res.date,
      today: res.today,
      ageDays: res.ageDays,
      isToday: res.isToday,
      servedExactDate: res.isExact,
      latestReconciledDate: res.maxDate,
      grainMin,
      source: 'roster_days (reconciled schedule window vs actual system login/logout, local Kuwait time)',
      basis:
        'scheduled = shift window covers the interval (cross-midnight aware, previous-day tails included); ' +
        'onSystem = a recon-captured system session covers the interval; ' +
        'adherence = scheduledOnSystem / (scheduled − noEvidence) — NULL, never 0, when nothing is measurable; ' +
        'gap = onSystem − scheduled (evidence-only, pessimistic); a shortfall explainable by missing evidence is reported "unknown", not "short".',
      warning: res.date == null
        ? 'No reconciled roster rows exist — nothing can be measured.'
        : res.isToday ? null
          : `Reconciled roster does not reach ${res.requestedDate}; serving ${res.date} (${res.ageDays} day(s) old). These are NOT live figures.`,
    };

    if (!res.date) return { ...meta, functions: [], total: null, intervals: [] };

    const rows = await this.fetchRows(tenantId, res.date, opts.functionName);
    const grid: IntradayResult = buildIntraday(rows, res.date, grainMin);

    return {
      ...meta,
      functionFilter: opts.functionName ?? null,
      rowsConsidered: rows.length,
      total: grid.total,
      /** convenience: the ALL-functions interval series */
      intervals: grid.total.intervals,
      functions: grid.functions,
      /** the at-risk/critical runs, worst first — the "what broke and when" list */
      gapWindows: this.worstWindows(grid, 20),
    };
  }

  /** Worst gap WINDOWS across functions — consecutive at-risk/critical intervals
   *  merged per function, worst-first. Feeds both the intraday payload and the
   *  staffing-gap alerts (one alert per window, not one per 30 minutes). */
  private worstWindows(grid: IntradayResult, limit = 8): GapWindow[] {
    const out: GapWindow[] = [];
    for (const f of grid.functions) out.push(...mergeGapWindows(f.functionName, f.intervals));
    return out
      .sort((a, b) => a.gap - b.gap || (a.adherencePct ?? 101) - (b.adherencePct ?? 101) || b.spanIntervals - a.spanIntervals)
      .slice(0, limit);
  }

  /** GET /rta/alerts — derived from captured state only. */
  async alerts(tenantId: string): Promise<{ generatedAt: string; asOf: any; count: number; bySeverity: Record<string, number>; alerts: RtaAlert[] }> {
    const res = await this.resolveDate(tenantId);

    // ── Sprinklr bridge state (READ-only reuse of the honest degraded-feed flags)
    let feed: AlertInput['feed'] = null;
    try {
      const snap: any = await this.sprinklr.getLatestSnapshot(tenantId);
      if (snap) {
        const agents: any[] = Array.isArray(snap.agents) ? snap.agents : [];
        feed = {
          hasSnapshot: true,
          capturedAt: snap.capturedAt ?? null,
          staleSec: snap.staleSec ?? null,
          isStale: !!snap.isStale,
          queueFeedMissing: !!snap.queueFeedMissing,
          queueCount: Array.isArray(snap.queues) ? snap.queues.length : 0,
          agentCount: agents.length,
          knownStatusAgents: agents.filter(a => a?.status && a.status !== 'unknown').length,
        };
      } else {
        feed = { hasSnapshot: false, capturedAt: null, staleSec: null, isStale: true, queueFeedMissing: false, queueCount: 0, agentCount: 0, knownStatusAgents: 0 };
      }
    } catch (e: any) {
      this.logger.warn(`alerts: Sprinklr snapshot unavailable — ${e.message}`);
      feed = null;
    }

    const [liveRow] = await this.ds.query(
      `SELECT MAX(live_updated_at)::text AS lu,
              MAX(snapshot_date)::text   AS sd,
              ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(live_updated_at))) / 60)::int AS age_min
         FROM headcount_intervals WHERE tenant_id = $1`,
      [tenantId],
    ).catch(() => [null]);

    const [statRow] = await this.ds.query(
      `SELECT MAX(stat_date)::text AS mx, (CURRENT_DATE - MAX(stat_date))::int AS age
         FROM agent_daily_stats WHERE tenant_id = $1`,
      [tenantId],
    ).catch(() => [null]);

    let tardiness: AlertInput['tardiness'] = null;
    let worst: GapWindow[] = [];
    let unknownIntervals = 0;

    if (res.date) {
      const [t] = await this.ds.query(
        `SELECT COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int AS working,
                COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND ${CRED_LATE}  AND permission_type IS NULL)::int AS late,
                COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND ${CRED_EARLY} AND permission_type IS NULL)::int AS early,
                COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND sys_login_min IS NULL)::int AS missing_system
           FROM roster_days
          WHERE tenant_id = $1 AND work_date = $2::date AND is_active`,
        [tenantId, res.date],
      );
      tardiness = {
        date: res.date,
        lateLogins: t?.late ?? 0,
        earlyLogouts: t?.early ?? 0,
        missingSystem: t?.missing_system ?? 0,
        workingHeadcount: t?.working ?? 0,
      };

      const grid = buildIntraday(await this.fetchRows(tenantId, res.date), res.date, DEFAULT_GRAIN_MIN);
      worst = this.worstWindows(grid);
      unknownIntervals = grid.functions.reduce((n, f) => n + f.summary.unknownIntervals, 0);
    }

    const alerts = deriveAlerts({
      today: res.today,
      feed,
      roster: { maxDate: res.maxDate, ageDays: res.ageDays, resolvedDate: res.date },
      liveCoverage: liveRow
        ? { lastUpdatedAt: liveRow.lu ?? null, ageMin: liveRow.age_min ?? null, snapshotDate: liveRow.sd ?? null }
        : null,
      agentStats: statRow?.mx ? { maxStatDate: statRow.mx, ageDays: statRow.age ?? null } : null,
      intraday: { date: res.date, worst, unknownIntervals },
      tardiness,
    });

    const bySeverity = alerts.reduce<Record<string, number>>((m, a) => { m[a.severity] = (m[a.severity] ?? 0) + 1; return m; }, {});
    return {
      generatedAt: new Date().toISOString(),
      asOf: {
        today: res.today,
        rosterDate: res.date,
        rosterAgeDays: res.ageDays,
        sprinklrCapturedAt: feed?.capturedAt ?? null,
      },
      count: alerts.length,
      bySeverity,
      alerts,
    };
  }
}
