import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type PeriodType = 'today' | 'week' | 'month' | 'custom';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Date helpers ────────────────────────────────────────────────────────────

  private periodDates(period: PeriodType, from?: string, to?: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (period === 'today') {
      const t = fmt(now);
      return { from: t, to: t };
    }
    if (period === 'week') {
      // Boutiqaat week starts Saturday
      const day = now.getDay(); // 0=Sun … 6=Sat
      const diffToSat = (day - 6 + 7) % 7;
      const sat = new Date(now);
      sat.setDate(now.getDate() - diffToSat);
      return { from: fmt(sat), to: fmt(now) };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(start), to: fmt(now) };
    }
    // custom
    return { from: from ?? fmt(new Date(now.getFullYear(), 0, 1)), to: to ?? fmt(now) };
  }

  // ── 1. Summary Cards ────────────────────────────────────────────────────────

  async getSummary(tenantId: string, period: PeriodType, from?: string, to?: string) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    const [rows] = await this.ds.query(`
      SELECT
        COUNT(*)                                                      AS total_records,
        COUNT(*) FILTER (WHERE attendance_marker = 'present')        AS present_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'absent')         AS absent_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'sick')           AS sick_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'leave')          AS leave_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'holiday')        AS holiday_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'off')            AS off_days,
        COUNT(*) FILTER (WHERE is_wfh = true
                           AND attendance_marker = 'present')        AS wfh_present,
        COUNT(*) FILTER (WHERE is_wfh = false
                           AND attendance_marker = 'present')        AS office_present,
        COUNT(*) FILTER (WHERE punch_late_minutes > 0)               AS late_punch_count,
        COUNT(*) FILTER (WHERE system_late_minutes > 0)              AS late_system_count,
        COALESCE(SUM(punch_late_minutes), 0)                         AS total_late_punch_min,
        COALESCE(SUM(system_late_minutes), 0)                        AS total_late_system_min,
        COALESCE(SUM(ot_minutes), 0)                                 AS total_ot_min,
        COUNT(*) FILTER (WHERE ot_minutes > 0)                       AS ot_count,
        COUNT(*) FILTER (WHERE is_missing_punch = true
                           AND attendance_marker = 'present')        AS missing_punch_count,
        COUNT(*) FILTER (WHERE is_missing_system = true
                           AND attendance_marker = 'present')        AS missing_system_count,
        COUNT(DISTINCT employee_id)                                  AS total_employees
      FROM attendance_records
      WHERE tenant_id = $1
        AND attendance_date BETWEEN $2 AND $3
    `, [tenantId, dateFrom, dateTo]);

    return {
      period: { from: dateFrom, to: dateTo },
      ...this.numericRow(rows),
    };
  }

  // ── 2. Top Late Employees ───────────────────────────────────────────────────

  async getTopLate(
    tenantId: string,
    period: PeriodType,
    from?: string, to?: string,
    limit = 15,
    type: 'punch' | 'system' | 'both' = 'punch',
  ) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    const lateCol = type === 'system' ? 'system_late_minutes' : 'punch_late_minutes';
    const lateCountFilter = type === 'system'
      ? 'system_late_minutes > 0'
      : 'punch_late_minutes > 0';

    return this.ds.query(`
      SELECT
        e.id                                              AS employee_id,
        e.employee_no,
        CONCAT(e.first_name_en, ' ', COALESCE(e.last_name_en, '')) AS full_name,
        f.name                                            AS function_name,
        COUNT(*) FILTER (WHERE ${lateCountFilter})       AS late_count,
        COALESCE(SUM(ar.${lateCol}), 0)                  AS total_late_minutes,
        ROUND(AVG(ar.${lateCol}) FILTER (WHERE ${lateCountFilter}))
                                                          AS avg_late_minutes,
        MAX(ar.${lateCol})                                AS max_late_minutes,
        COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present_days
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE ar.tenant_id = $1
        AND ar.attendance_date BETWEEN $2 AND $3
        AND ar.attendance_marker = 'present'
      GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
      HAVING SUM(ar.${lateCol}) > 0
      ORDER BY total_late_minutes DESC
      LIMIT $4
    `, [tenantId, dateFrom, dateTo, limit]);
  }

  // ── 3. Function Breakdown ───────────────────────────────────────────────────

  async getByFunction(tenantId: string, period: PeriodType, from?: string, to?: string) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    return this.ds.query(`
      SELECT
        f.id                                                          AS function_id,
        COALESCE(f.name, 'Unknown')                                   AS function_name,
        COUNT(*)                                                      AS total_records,
        COUNT(*) FILTER (WHERE ar.attendance_marker = 'present')     AS present_days,
        COUNT(*) FILTER (WHERE ar.is_wfh = true
                          AND ar.attendance_marker = 'present')      AS wfh_days,
        COUNT(*) FILTER (WHERE ar.attendance_marker = 'absent')      AS absent_days,
        COUNT(*) FILTER (WHERE ar.attendance_marker = 'sick')        AS sick_days,
        COUNT(*) FILTER (WHERE ar.attendance_marker = 'leave')       AS leave_days,
        COUNT(*) FILTER (WHERE ar.punch_late_minutes > 0)            AS late_count,
        COALESCE(SUM(ar.punch_late_minutes), 0)                      AS total_late_minutes,
        COALESCE(SUM(ar.ot_minutes), 0)                              AS total_ot_minutes,
        COUNT(*) FILTER (WHERE ar.is_missing_punch = true
                          AND ar.attendance_marker = 'present')      AS missing_punch,
        COUNT(DISTINCT ar.employee_id)                               AS employee_count,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ar.attendance_marker = 'present')
          / NULLIF(COUNT(*) FILTER (WHERE ar.attendance_marker NOT IN ('off','holiday')), 0)
        , 1)                                                          AS attendance_pct
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE ar.tenant_id = $1
        AND ar.attendance_date BETWEEN $2 AND $3
      GROUP BY f.id, f.name
      ORDER BY total_records DESC
    `, [tenantId, dateFrom, dateTo]);
  }

  // ── 4. Attendance Markers Distribution ─────────────────────────────────────

  async getMarkersDistribution(tenantId: string, period: PeriodType, from?: string, to?: string) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    return this.ds.query(`
      SELECT
        attendance_marker,
        COUNT(*)                        AS count,
        COUNT(DISTINCT employee_id)     AS unique_employees,
        ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS percentage
      FROM attendance_records
      WHERE tenant_id = $1
        AND attendance_date BETWEEN $2 AND $3
      GROUP BY attendance_marker
      ORDER BY count DESC
    `, [tenantId, dateFrom, dateTo]);
  }

  // ── 5. Daily Trend ──────────────────────────────────────────────────────────

  async getDailyTrend(tenantId: string, days = 30) {
    return this.ds.query(`
      SELECT
        attendance_date::text                                    AS date,
        COUNT(*) FILTER (WHERE attendance_marker = 'present')   AS present,
        COUNT(*) FILTER (WHERE attendance_marker = 'absent')    AS absent,
        COUNT(*) FILTER (WHERE attendance_marker = 'sick')      AS sick,
        COUNT(*) FILTER (WHERE punch_late_minutes > 0)          AS late,
        COUNT(*) FILTER (WHERE is_wfh = true
                          AND attendance_marker = 'present')    AS wfh,
        COALESCE(SUM(ot_minutes), 0) / 60.0                     AS ot_hours
      FROM attendance_records
      WHERE tenant_id = $1
        AND attendance_date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY attendance_date
      ORDER BY attendance_date ASC
    `, [tenantId]);
  }

  // ── 6. Missing Punch/System Ranking ────────────────────────────────────────

  async getMissingRanking(
    tenantId: string,
    period: PeriodType,
    from?: string, to?: string,
    type: 'punch' | 'system' = 'punch',
    limit = 15,
  ) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);
    const missingCol = type === 'system' ? 'is_missing_system' : 'is_missing_punch';

    return this.ds.query(`
      SELECT
        e.employee_no,
        CONCAT(e.first_name_en, ' ', COALESCE(e.last_name_en, '')) AS full_name,
        f.name                                                       AS function_name,
        COUNT(*) FILTER (WHERE ar.${missingCol} = true)             AS missing_count,
        COUNT(*) FILTER (WHERE ar.attendance_marker = 'present')    AS present_days,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ar.${missingCol} = true)
          / NULLIF(COUNT(*) FILTER (WHERE ar.attendance_marker = 'present'), 0)
        , 1)                                                         AS missing_pct
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE ar.tenant_id = $1
        AND ar.attendance_date BETWEEN $2 AND $3
        AND ar.attendance_marker = 'present'
      GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
      HAVING COUNT(*) FILTER (WHERE ar.${missingCol} = true) > 0
      ORDER BY missing_count DESC
      LIMIT $4
    `, [tenantId, dateFrom, dateTo, limit]);
  }

  // ── 7. OT Ranking ──────────────────────────────────────────────────────────

  async getOtRanking(
    tenantId: string,
    period: PeriodType,
    from?: string, to?: string,
    limit = 15,
  ) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    return this.ds.query(`
      SELECT
        e.employee_no,
        CONCAT(e.first_name_en, ' ', COALESCE(e.last_name_en, '')) AS full_name,
        f.name                                                       AS function_name,
        COUNT(*) FILTER (WHERE ar.ot_minutes > 0)                   AS ot_days,
        COALESCE(SUM(ar.ot_minutes), 0)                             AS total_ot_minutes,
        ROUND(COALESCE(SUM(ar.ot_minutes), 0) / 60.0, 1)           AS total_ot_hours,
        MAX(ar.ot_minutes)                                           AS max_ot_minutes
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE ar.tenant_id = $1
        AND ar.attendance_date BETWEEN $2 AND $3
        AND ar.ot_minutes > 0
      GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
      ORDER BY total_ot_minutes DESC
      LIMIT $4
    `, [tenantId, dateFrom, dateTo, limit]);
  }

  // ── 8. WFH vs Office Breakdown ─────────────────────────────────────────────

  async getWfhBreakdown(
    tenantId: string,
    period: PeriodType,
    from?: string, to?: string,
  ) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    const [summary] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_wfh = true  AND attendance_marker = 'present') AS wfh_days,
        COUNT(*) FILTER (WHERE is_wfh = false AND attendance_marker = 'present') AS office_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'present')                    AS total_present
      FROM attendance_records
      WHERE tenant_id = $1
        AND attendance_date BETWEEN $2 AND $3
    `, [tenantId, dateFrom, dateTo]);

    const byFunction = await this.ds.query(`
      SELECT
        COALESCE(f.name, 'Unknown')                                       AS function_name,
        COUNT(*) FILTER (WHERE ar.is_wfh = true
                          AND ar.attendance_marker = 'present')           AS wfh_days,
        COUNT(*) FILTER (WHERE ar.is_wfh = false
                          AND ar.attendance_marker = 'present')           AS office_days,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ar.is_wfh = true AND ar.attendance_marker = 'present')
          / NULLIF(COUNT(*) FILTER (WHERE ar.attendance_marker = 'present'), 0)
        , 1)                                                               AS wfh_pct
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE ar.tenant_id = $1
        AND ar.attendance_date BETWEEN $2 AND $3
      GROUP BY f.name
      ORDER BY wfh_days DESC
    `, [tenantId, dateFrom, dateTo]);

    return {
      period: { from: dateFrom, to: dateTo },
      summary: this.numericRow(summary),
      byFunction,
    };
  }

  // ── 9. Agent Personal Metrics ───────────────────────────────────────────────

  async getAgentMetrics(
    tenantId: string,
    employeeId: string,
    period: PeriodType,
    from?: string, to?: string,
  ) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);

    const [summary] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE attendance_marker = 'present')        AS present_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'absent')         AS absent_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'sick')           AS sick_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'leave')          AS leave_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'holiday')        AS holiday_days,
        COUNT(*) FILTER (WHERE attendance_marker = 'off')            AS off_days,
        COUNT(*) FILTER (WHERE is_wfh = true
                          AND attendance_marker = 'present')         AS wfh_days,
        COUNT(*) FILTER (WHERE is_wfh = false
                          AND attendance_marker = 'present')         AS office_days,
        COUNT(*) FILTER (WHERE punch_late_minutes > 0)               AS late_punch_count,
        COALESCE(SUM(punch_late_minutes), 0)                         AS total_late_punch_min,
        COUNT(*) FILTER (WHERE system_late_minutes > 0)              AS late_system_count,
        COALESCE(SUM(system_late_minutes), 0)                        AS total_late_system_min,
        COALESCE(SUM(ot_minutes), 0)                                 AS total_ot_min,
        COUNT(*) FILTER (WHERE ot_minutes > 0)                       AS ot_days,
        COUNT(*) FILTER (WHERE is_missing_punch = true
                          AND attendance_marker = 'present')         AS missing_punch,
        COUNT(*) FILTER (WHERE is_missing_system = true
                          AND attendance_marker = 'present')         AS missing_system
      FROM attendance_records
      WHERE tenant_id  = $1
        AND employee_id = $2
        AND attendance_date BETWEEN $3 AND $4
    `, [tenantId, employeeId, dateFrom, dateTo]);

    const recentDays = await this.ds.query(`
      SELECT
        ar.attendance_date::text,
        ar.attendance_marker,
        ar.is_wfh,
        ar.punch_late_minutes,
        ar.system_late_minutes,
        ar.ot_minutes,
        ar.is_missing_punch,
        ar.is_missing_system,
        sc.code AS shift_code
      FROM attendance_records ar
      LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
      WHERE ar.tenant_id  = $1
        AND ar.employee_id = $2
        AND ar.attendance_date BETWEEN $3 AND $4
      ORDER BY ar.attendance_date DESC
      LIMIT 60
    `, [tenantId, employeeId, dateFrom, dateTo]);

    return {
      period: { from: dateFrom, to: dateTo },
      summary: this.numericRow(summary),
      recentDays,
    };
  }

  // ── 10. Full employee list with attendance score ────────────────────────────

  async getEmployeeAttendanceList(
    tenantId: string,
    period: PeriodType,
    from?: string, to?: string,
    functionId?: string,
    limit = 50,
    offset = 0,
  ) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);
    const fnFilter = functionId ? `AND e.function_id = '${functionId}'` : '';

    return this.ds.query(`
      SELECT
        e.id                                                              AS employee_id,
        e.employee_no,
        CONCAT(e.first_name_en, ' ', COALESCE(e.last_name_en, ''))      AS full_name,
        e.gender,
        f.name                                                            AS function_name,
        COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'present')    AS present_days,
        COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'absent')     AS absent_days,
        COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'sick')       AS sick_days,
        COUNT(ar.id) FILTER (WHERE ar.is_wfh = true
                              AND ar.attendance_marker = 'present')     AS wfh_days,
        COUNT(ar.id) FILTER (WHERE ar.punch_late_minutes > 0)           AS late_count,
        COALESCE(SUM(ar.punch_late_minutes), 0)                         AS total_late_min,
        COALESCE(SUM(ar.ot_minutes), 0)                                 AS total_ot_min,
        COUNT(ar.id) FILTER (WHERE ar.is_missing_punch = true
                              AND ar.attendance_marker = 'present')     AS missing_punch,
        ROUND(
          100.0 * COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'present')
          / NULLIF(COUNT(ar.id) FILTER (
              WHERE ar.attendance_marker NOT IN ('off','holiday')
          ), 0)
        , 1)                                                              AS attendance_pct
      FROM employees e
      LEFT JOIN attendance_records ar
             ON ar.employee_id = e.id
            AND ar.attendance_date BETWEEN $2 AND $3
            AND ar.tenant_id = $1
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE e.tenant_id = $1
        AND e.status = 'active'
        ${fnFilter}
      GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, e.gender, f.name
      ORDER BY total_late_min DESC, e.first_name_en
      LIMIT $4 OFFSET $5
    `, [tenantId, dateFrom, dateTo, limit, offset]);
  }

  // ── Helper ──────────────────────────────────────────────────────────────────

  private numericRow(row: Record<string, any>): Record<string, number | string> {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      result[k] = v === null ? 0 : isNaN(Number(v)) ? v : Number(v);
    }
    return result;
  }
}
