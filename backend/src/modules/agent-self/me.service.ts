import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Self-service data for the logged-in employee only — never team-wide.
 * Every query is scoped to (tenantId, employeeId / employee_no).
 */
@Injectable()
export class MeService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getOverview(tenantId: string, employeeId: string | null) {
    if (!employeeId) {
      return { linked: false, shiftRate: null, adherence: null, score: null, schedule: [] };
    }

    const [shiftRate, adherence, score, schedule] = await Promise.all([
      this.shiftRate(tenantId, employeeId),
      this.adherence(tenantId, employeeId),
      this.score(tenantId, employeeId),
      this.upcomingSchedule(tenantId, employeeId),
    ]);

    return { linked: true, shiftRate, adherence, score, schedule };
  }

  /** YTD shift distribution by start-time category — the agent's own rotation balance. */
  private async shiftRate(tenantId: string, employeeId: string) {
    const [r] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker='present' AND EXTRACT(HOUR FROM scheduled_start) BETWEEN 5 AND 11)  AS morning,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND EXTRACT(HOUR FROM scheduled_start) BETWEEN 12 AND 16) AS evening,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND EXTRACT(HOUR FROM scheduled_start) BETWEEN 17 AND 21) AS night,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND (EXTRACT(HOUR FROM scheduled_start) >= 22 OR EXTRACT(HOUR FROM scheduled_start) < 5)) AS midnight,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND scheduled_start IS NULL) AS unclassified,
         COUNT(*) FILTER (WHERE attendance_marker='off')                                 AS off_days,
         COUNT(*) FILTER (WHERE attendance_marker IN ('leave','sick','holiday'))          AS leave_days
       FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2
         AND attendance_date >= date_trunc('year', CURRENT_DATE)`,
      [tenantId, employeeId],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    const morning = n(r.morning), evening = n(r.evening), night = n(r.night), midnight = n(r.midnight);
    const working = morning + evening + night + midnight + n(r.unclassified);
    const pct = (v: number) => working ? Math.round(100 * v / working) : 0;
    return {
      working,
      morning, evening, night, midnight,
      morningPct: pct(morning), eveningPct: pct(evening), nightPct: pct(night), midnightPct: pct(midnight),
      offDays: n(r.off_days), leaveDays: n(r.leave_days),
    };
  }

  /** Adherence / conformance (التزام) — last 30 days, from the RTA adherence engine. */
  private async adherence(tenantId: string, employeeId: string) {
    const [agg] = await this.ds.query(
      `SELECT COUNT(*)                                  AS days,
              ROUND(AVG(adherence_pct)::numeric, 1)     AS avg_adherence,
              ROUND(AVG(conformance_pct)::numeric, 1)   AS avg_conformance
       FROM adherence_daily
       WHERE tenant_id = $1 AND employee_id = $2
         AND stat_date >= CURRENT_DATE - INTERVAL '30 days'`,
      [tenantId, employeeId],
    );
    const recent = await this.ds.query(
      `SELECT stat_date::text AS date, adherence_pct, conformance_pct, shift_code
       FROM adherence_daily
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY stat_date DESC LIMIT 7`,
      [tenantId, employeeId],
    );
    const f = (v: any) => v === null || v === undefined ? null : parseFloat(v);
    return {
      days: parseInt(agg?.days ?? '0', 10),
      avgAdherence: f(agg?.avg_adherence),
      avgConformance: f(agg?.avg_conformance),
      recent: recent.map((x: any) => ({
        date: x.date, adherence: f(x.adherence_pct), conformance: f(x.conformance_pct), shiftCode: x.shift_code,
      })),
    };
  }

  /** Latest scorecard result (Final week of most recent batch) for this employee. */
  private async score(tenantId: string, employeeId: string) {
    const [row] = await this.ds.query(
      `SELECT se.net_points, se.function_rank, se.function_name,
              se.quality_actual, se.aht_actual, se.fcr_actual,
              b.period_name, b.period_year, b.period_month
       FROM scorecard_entries se
       JOIN scorecard_batches b ON b.id = se.batch_id
       JOIN employees e ON e.employee_no = se.employee_no AND e.tenant_id = se.tenant_id
       WHERE se.tenant_id = $1 AND e.id = $2 AND se.week_label = 'Final'
       ORDER BY b.period_year DESC, b.period_month DESC
       LIMIT 1`,
      [tenantId, employeeId],
    );
    if (!row) return null;
    const f = (v: any) => v === null || v === undefined ? null : parseFloat(v);
    return {
      periodName: row.period_name,
      netPoints: row.net_points !== null ? parseInt(row.net_points, 10) : null,
      functionRank: row.function_rank !== null ? parseInt(row.function_rank, 10) : null,
      functionName: row.function_name,
      qualityPct: row.quality_actual !== null ? Math.round(f(row.quality_actual)! * 100) : null,
      fcrPct: row.fcr_actual !== null ? Math.round(f(row.fcr_actual)! * 100) : null,
    };
  }

  /** The agent's own shifts — recent + upcoming window (from attendance_records). */
  private async upcomingSchedule(tenantId: string, employeeId: string) {
    const rows = await this.ds.query(
      `SELECT ar.attendance_date::text AS date, ar.attendance_marker, ar.is_wfh,
              ar.scheduled_start, ar.scheduled_end, sc.code AS shift_code
       FROM attendance_records ar
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       WHERE ar.tenant_id = $1 AND ar.employee_id = $2
         AND ar.attendance_date >= CURRENT_DATE - INTERVAL '2 days'
       ORDER BY ar.attendance_date ASC
       LIMIT 14`,
      [tenantId, employeeId],
    );
    return rows.map((r: any) => ({
      date: r.date,
      marker: r.attendance_marker,
      isWfh: r.is_wfh,
      shiftCode: r.shift_code,
      start: r.scheduled_start ? String(r.scheduled_start).slice(0, 5) : null,
      end: r.scheduled_end ? String(r.scheduled_end).slice(0, 5) : null,
    }));
  }
}
