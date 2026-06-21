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

  // ── Tardiness vs authorized permission (team) ───────────────────────────────
  // A late-in / early-out is TARDY unless covered by an approved permission of
  // the matching type that day. Attendance conformance = present days with NO
  // unauthorized tardiness ÷ present days.
  private readonly PERM_JOIN = `
    LEFT JOIN LATERAL (
      SELECT COALESCE(bool_or(rp.permission_type = 'late_in'), FALSE) AS perm_late,
             COALESCE(bool_or(rp.permission_type IN ('early_out','temp_out')), FALSE) AS perm_early
        FROM request_permissions rp JOIN requests rq ON rq.id = rp.request_id
       WHERE rq.tenant_id = ar.tenant_id AND rq.employee_id = ar.employee_id
         AND rq.status = 'approved' AND rp.permission_date = ar.attendance_date
    ) perm ON TRUE`;

  async getTardiness(tenantId: string, period: PeriodType, from?: string, to?: string, limit = 200) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);
    const TARDY_LATE  = `COALESCE(ar.punch_late_minutes,0) > 0 AND NOT perm.perm_late`;
    const TARDY_EARLY = `(COALESCE(ar.punch_early_out_minutes,0) > 0 OR COALESCE(ar.system_early_out_minutes,0) > 0) AND NOT perm.perm_early`;
    const PERMIT_LATE = `COALESCE(ar.punch_late_minutes,0) > 0 AND perm.perm_late`;
    const PERMIT_EARLY= `(COALESCE(ar.punch_early_out_minutes,0) > 0 OR COALESCE(ar.system_early_out_minutes,0) > 0) AND perm.perm_early`;

    const rows = await this.ds.query(`
      SELECT e.id AS employee_id, e.employee_no,
             CONCAT(e.first_name_en, ' ', COALESCE(e.last_name_en,'')) AS full_name,
             f.name AS function_name,
             COUNT(*) FILTER (WHERE ar.attendance_marker='present')                AS working_days,
             COUNT(*) FILTER (WHERE ${TARDY_LATE})                                 AS tardy_late,
             COALESCE(SUM(ar.punch_late_minutes) FILTER (WHERE ${TARDY_LATE}),0)   AS tardy_late_minutes,
             COUNT(*) FILTER (WHERE ${PERMIT_LATE})                                AS permitted_late,
             COUNT(*) FILTER (WHERE ${TARDY_EARLY})                                AS tardy_early,
             COALESCE(SUM(GREATEST(COALESCE(ar.punch_early_out_minutes,0),COALESCE(ar.system_early_out_minutes,0))) FILTER (WHERE ${TARDY_EARLY}),0) AS tardy_early_minutes,
             COUNT(*) FILTER (WHERE ${PERMIT_EARLY})                               AS permitted_early,
             COUNT(*) FILTER (WHERE ar.attendance_marker='present'
                                AND NOT (${TARDY_LATE}) AND NOT (${TARDY_EARLY}))  AS conforming_days
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      ${this.PERM_JOIN}
      WHERE ar.tenant_id = $1 AND ar.attendance_date BETWEEN $2 AND $3
      GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
      HAVING COUNT(*) FILTER (WHERE ar.attendance_marker='present') > 0
      ORDER BY (COUNT(*) FILTER (WHERE ${TARDY_LATE}) + COUNT(*) FILTER (WHERE ${TARDY_EARLY})) DESC,
               CONCAT(e.first_name_en, ' ', COALESCE(e.last_name_en,''))
      LIMIT $4
    `, [tenantId, dateFrom, dateTo, limit]);

    const n = (v: any) => parseInt(v ?? '0', 10);
    const employees = rows.map((r: any) => {
      const working = n(r.working_days), conf = n(r.conforming_days);
      return {
        employeeId: r.employee_id, employeeNo: r.employee_no,
        name: String(r.full_name).trim(), functionName: r.function_name,
        workingDays: working,
        tardyLate: n(r.tardy_late), tardyLateMinutes: n(r.tardy_late_minutes), permittedLate: n(r.permitted_late),
        tardyEarly: n(r.tardy_early), tardyEarlyMinutes: n(r.tardy_early_minutes), permittedEarly: n(r.permitted_early),
        conformingDays: conf,
        conformancePct: working ? Math.round((conf / working) * 1000) / 10 : null,
      };
    });
    const sum = (k: string) => employees.reduce((a: number, e: any) => a + (e[k] ?? 0), 0);
    const totWorking = sum('workingDays'), totConf = sum('conformingDays');
    return {
      period: { from: dateFrom, to: dateTo },
      totals: {
        employees: employees.length, workingDays: totWorking,
        tardyLate: sum('tardyLate'), permittedLate: sum('permittedLate'),
        tardyEarly: sum('tardyEarly'), permittedEarly: sum('permittedEarly'),
        conformancePct: totWorking ? Math.round((totConf / totWorking) * 1000) / 10 : null,
      },
      employees,
    };
  }

  /** By scheduled-start hour: how many scheduled, present, and tardy-late at each hour/shift. */
  async getTardinessByHour(tenantId: string, period: PeriodType, from?: string, to?: string) {
    const { from: dateFrom, to: dateTo } = this.periodDates(period, from, to);
    const rows = await this.ds.query(`
      SELECT EXTRACT(HOUR FROM ar.scheduled_start)::int AS hour,
             sc.code AS shift_code,
             COUNT(*)                                                      AS scheduled,
             COUNT(*) FILTER (WHERE ar.punch_in IS NOT NULL)               AS present,
             COUNT(*) FILTER (WHERE COALESCE(ar.punch_late_minutes,0) > 0 AND NOT perm.perm_late)  AS tardy_late,
             COUNT(*) FILTER (WHERE (COALESCE(ar.punch_early_out_minutes,0) > 0 OR COALESCE(ar.system_early_out_minutes,0) > 0) AND NOT perm.perm_early) AS tardy_early
      FROM attendance_records ar
      LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
      ${this.PERM_JOIN}
      WHERE ar.tenant_id = $1 AND ar.attendance_date BETWEEN $2 AND $3
        AND ar.attendance_marker = 'present' AND ar.scheduled_start IS NOT NULL
      GROUP BY EXTRACT(HOUR FROM ar.scheduled_start), sc.code
      ORDER BY hour, shift_code
    `, [tenantId, dateFrom, dateTo]);
    const n = (v: any) => parseInt(v ?? '0', 10);
    return {
      period: { from: dateFrom, to: dateTo },
      rows: rows.map((r: any) => ({
        hour: n(r.hour), shiftCode: r.shift_code,
        scheduled: n(r.scheduled), present: n(r.present),
        tardyLate: n(r.tardy_late), tardyEarly: n(r.tardy_early),
      })),
    };
  }

  // ── Attrition by year (RES = resignation, TER = termination) ────────────────
  // Leavers are marked by a RES/TER shift code on a date; last working day = the
  // last 'present' day on/before that. Rate = leavers ÷ that year's headcount.
  async getAttrition(tenantId: string) {
    // Multi-year attrition unified in attrition_events (RES = resignation, TER =
    // termination), sourced from the yearly schedule workbooks + 2026 attendance.
    // Leavers are kept here even after they're removed from the active roster.
    const leavers = await this.ds.query(`
      SELECT employee_no, name, function_name, type,
             leave_date::text AS leave_date,
             last_working_day::text AS last_working_day,
             year, source
        FROM attrition_events
       WHERE tenant_id = $1
       ORDER BY leave_date DESC, employee_no
    `, [tenantId]);

    // Per-year headcount denominator (distinct employees who actually worked that
    // year), captured from the schedule at import time.
    const hc = await this.ds.query(
      `SELECT year, headcount FROM attrition_headcount_yearly WHERE tenant_id = $1`,
      [tenantId],
    );
    const hcByYear = new Map<number, number>(
      hc.map((r: any) => [Number(r.year), parseInt(r.headcount, 10)]),
    );

    const byYearMap = new Map<number, { resignations: number; terminations: number }>();
    for (const l of leavers) {
      const y = Number(l.year);
      if (!byYearMap.has(y)) byYearMap.set(y, { resignations: 0, terminations: 0 });
      const e = byYearMap.get(y)!;
      if (l.type === 'termination') e.terminations++; else e.resignations++;
    }
    // Include years that only have a headcount (no leavers) too.
    for (const y of hcByYear.keys()) if (!byYearMap.has(y)) byYearMap.set(y, { resignations: 0, terminations: 0 });

    const byYear = [...byYearMap.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => {
      const leaverCount = v.resignations + v.terminations;
      const headcount: number | null = hcByYear.get(year) ?? null;
      return {
        year, resignations: v.resignations, terminations: v.terminations, leavers: leaverCount,
        headcount,
        attritionPct: headcount ? Math.round((leaverCount / headcount) * 1000) / 10 : null,
      };
    });

    return {
      byYear,
      leavers: leavers.map((l: any) => ({
        employeeNo: l.employee_no, name: l.name, functionName: l.function_name,
        type: l.type,
        leaveDate: l.leave_date, lastWorkingDay: l.last_working_day,
        year: Number(l.year), source: l.source,
      })),
    };
  }

  // ── 2b. Overtime: peak-event calendar + monthly OT trend ────────────────────

  /** Peak/holiday OT events (from the real Overtime workbooks) — a demand calendar. */
  async getPeakEvents(tenantId: string, year?: number) {
    const events = await this.ds.query(
      `SELECT event_name, year, start_date::text AS start_date, end_date::text AS end_date,
              headcount, ot_hours::float AS ot_hours, source_file
         FROM peak_events
        WHERE tenant_id = $1 ${year ? 'AND year = $2' : ''}
        ORDER BY start_date DESC NULLS LAST, event_name`,
      year ? [tenantId, year] : [tenantId],
    );
    const byYear = await this.ds.query(
      `SELECT year, COUNT(*)::int AS events, COALESCE(SUM(headcount),0)::int AS slots,
              ROUND(COALESCE(SUM(ot_hours),0))::int AS ot_hours
         FROM peak_events WHERE tenant_id = $1 GROUP BY year ORDER BY year`,
      [tenantId],
    );
    return { byYear, events };
  }

  /** Approved OT hours by month (trend) + top OT employees, from consolidated OT files. */
  async getOtMonthly(tenantId: string, year?: number, limit = 20) {
    const trend = await this.ds.query(
      `SELECT year, month, ROUND(SUM(ot_hours))::int AS ot_hours,
              COUNT(DISTINCT name)::int AS employees
         FROM ot_monthly WHERE tenant_id = $1 ${year ? 'AND year = $2' : ''}
        GROUP BY year, month ORDER BY year, month`,
      year ? [tenantId, year] : [tenantId],
    );
    const top = await this.ds.query(
      `SELECT name, employee_no, ROUND(SUM(ot_hours))::int AS ot_hours
         FROM ot_monthly WHERE tenant_id = $1 ${year ? 'AND year = $2' : ''}
        GROUP BY name, employee_no ORDER BY SUM(ot_hours) DESC LIMIT ${Number(limit) || 20}`,
      year ? [tenantId, year] : [tenantId],
    );
    return { trend, top };
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
