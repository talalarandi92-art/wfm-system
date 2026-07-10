import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Rebuild headcount_intervals (15-min snapshots) from the canonical roster_days.
 * Extracted from CoverageController (R3/B2) so the break scheduler can invoke the
 * SAME rebuild in-process (no HTTP) when a target date has no interval rows.
 * Behavior is byte-identical to the original POST /coverage/headcount-intervals/rebuild:
 * windowed DELETE+INSERT, canon_fn folds, cross-midnight spill into the next day,
 * required_hc = scheduled_hc (v1 — no per-interval demand source yet).
 */
@Injectable()
export class CoverageRebuildService {
  private readonly logger = new Logger(CoverageRebuildService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async rebuild(tenantId: string, from: string, to: string): Promise<{ inserted: number }> {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `DELETE FROM headcount_intervals WHERE tenant_id = $1 AND snapshot_date BETWEEN $2 AND $3`,
        [tenantId, from, to],
      );
      const [ins] = await qr.query(
        `WITH fns AS (
           SELECT canon_fn(name) AS cname,
                  (array_agg(id ORDER BY (canon_fn(name) = name) DESC, name))[1] AS fid
           FROM functions WHERE tenant_id = $1 GROUP BY canon_fn(name)
         ),
         rd AS (
           SELECT r.work_date, canon_fn(r.role_function) AS cname,
                  r.shift_start_min AS ss, r.shift_end_min AS se,
                  (r.presence IN ('office','wfh'))            AS worked,
                  (r.presence = 'sick' OR NULLIF(r.sick, '') IS NOT NULL) AS on_sick,
                  (r.presence = 'absent')                     AS on_absent,
                  (r.permission_status ILIKE '%approved%')    AS on_perm
           FROM roster_days r
           WHERE r.tenant_id = $1 AND r.is_active
             AND r.work_date BETWEEN ($2::date - 1) AND $3::date
             AND r.shift_start_min IS NOT NULL AND r.shift_end_min IS NOT NULL
             AND r.shift_end_min > r.shift_start_min
         ),
         slots AS (
           SELECT d::date AS snapshot_date, m
           FROM generate_series($2::date, $3::date, '1 day') d
           CROSS JOIN generate_series(0, 1425, 15) m
         ),
         agg AS (
           SELECT s.snapshot_date, s.m, f.fid,
                  COUNT(*)::int                              AS scheduled,
                  COUNT(*) FILTER (WHERE rd.worked)::int     AS actual,
                  COUNT(*) FILTER (WHERE rd.on_perm)::int    AS on_perm,
                  COUNT(*) FILTER (WHERE rd.on_sick)::int    AS on_sick,
                  COUNT(*) FILTER (WHERE rd.on_absent)::int  AS on_absent
           FROM slots s
           JOIN rd ON (rd.work_date = s.snapshot_date       AND s.m >= rd.ss AND s.m < LEAST(rd.se, 1440))
                   OR (rd.work_date = s.snapshot_date - 1   AND rd.se > 1440 AND s.m < rd.se - 1440)
           JOIN fns f ON f.cname = rd.cname
           GROUP BY s.snapshot_date, s.m, f.fid
         )
         INSERT INTO headcount_intervals
           (tenant_id, snapshot_date, interval_start, interval_end, function_id,
            required_hc, scheduled_hc, actual_hc, on_permission_hc, on_sick_hc, on_leave_hc,
            computed_at)
         SELECT $1, a.snapshot_date,
                a.snapshot_date::timestamptz + make_interval(mins => a.m),
                a.snapshot_date::timestamptz + make_interval(mins => a.m + 15),
                a.fid,
                a.scheduled,                                   -- required = scheduled (v1, no interval demand source)
                a.scheduled, a.actual, a.on_perm, a.on_sick, 0,
                NOW()
         FROM agg a
         RETURNING 1`,
        // available_hc / gap_hc are GENERATED ALWAYS columns — the schema computes them.
        [tenantId, from, to],
      ).then((rows: any[]) => [rows.length]);
      await qr.commitTransaction();
      return { inserted: ins };
    } catch (e) {
      await qr.rollbackTransaction().catch(() => {});
      throw e;
    } finally {
      await qr.release();
    }
  }
}
