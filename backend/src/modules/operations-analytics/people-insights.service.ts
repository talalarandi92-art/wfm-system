import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';

/**
 * People / Function 360 — merges EVERY ingested source per employee (and per
 * function) over a date range, with name/ID + function filters:
 *   attendance (present/wfh/office/sick/leave/absence/off, late/early, OT,
 *   missing punch, conformance) + voice productivity (calls/AHT/occupancy/break)
 *   + scorecard Net Points. Powers the rich, filterable Insights explorer.
 */
@Injectable()
export class PeopleInsightsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Resolve a sane default date window from attendance data. */
  private async window(tenantId: string, from?: string, to?: string) {
    if (from && to) return { from, to };
    const r = await this.ds.query(
      `SELECT MIN(attendance_date)::text a, MAX(attendance_date)::text b
         FROM attendance_records WHERE tenant_id=$1`, [tenantId]);
    const max = to || r[0]?.b || '2026-06-30';
    // default = the month of the latest data
    const def = from || (max ? `${max.slice(0, 7)}-01` : '2026-06-01');
    return { from: def, to: max };
  }

  /* Shared CTEs that aggregate each source over a date window. */
  private cteBlock() {
    return `
      att AS (
        SELECT ar.employee_id,
               COUNT(*) FILTER (WHERE ar.attendance_marker='present')                         AS working_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='present' AND ar.is_wfh)            AS wfh_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='present' AND NOT ar.is_wfh)        AS office_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='sick')                             AS sick_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='leave')                            AS leave_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='absent')                           AS absence_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='off')                              AS off_days,
               COUNT(*) FILTER (WHERE ar.attendance_marker='comp')                             AS comp_days,
               COUNT(*) FILTER (WHERE ar.punch_late_minutes > 0)                               AS late_count,
               COALESCE(SUM(ar.punch_late_minutes),0)                                          AS late_minutes,
               COUNT(*) FILTER (WHERE ar.punch_early_out_minutes > 0)                          AS early_count,
               COALESCE(SUM(ar.punch_early_out_minutes),0)                                     AS early_minutes,
               COUNT(*) FILTER (WHERE ar.is_missing_punch AND ar.attendance_marker='present')  AS missing_punch,
               COUNT(*) FILTER (WHERE ar.is_missing_system AND ar.attendance_marker='present') AS missing_system,
               ROUND(COALESCE(SUM(ar.ot_minutes),0)/60.0, 1)                                   AS ot_hours,
               -- conformance: present days with no unauthorised late/early/missing
               COUNT(*) FILTER (WHERE ar.attendance_marker='present'
                 AND COALESCE(ar.punch_late_minutes,0)=0 AND COALESCE(ar.punch_early_out_minutes,0)=0
                 AND NOT ar.is_missing_punch)                                                  AS conforming_days
          FROM attendance_records ar
         WHERE ar.tenant_id=$1 AND ar.attendance_date BETWEEN $2 AND $3
         GROUP BY ar.employee_id
      ),
      prod AS (
        SELECT employee_no,
               SUM(wrapped_calls)::int                                                         AS calls,
               SUM(staffed_seconds)::bigint                                                    AS staffed,
               SUM(talk_seconds)::bigint                                                       AS talk,
               SUM(acw_seconds)::bigint                                                        AS acw,
               SUM(break_seconds)::bigint                                                      AS brk
          FROM agent_productivity_daily
         WHERE tenant_id=$1 AND employee_no IS NOT NULL AND work_date BETWEEN $2 AND $3
         GROUP BY employee_no
      ),
      sc AS (
        SELECT employee_no, ROUND(AVG(avg_net_points),1) AS avg_net, COUNT(*)::int AS sc_months
          FROM scorecard_monthly
         WHERE tenant_id=$1 AND make_date(year, month, 1) BETWEEN date_trunc('month',$2::date) AND $3
         GROUP BY employee_no
      ),
      fcr AS (
        SELECT employee_id, ROUND(100.0*SUM(resolved_yes)/NULLIF(SUM(total),0),1) AS fcr_pct, SUM(total)::int AS fcr_total
          FROM survey_fcr_monthly
         WHERE tenant_id=$1 AND employee_id IS NOT NULL
           AND year_month::date BETWEEN date_trunc('month',$2::date) AND $3
         GROUP BY employee_id
      )`;
  }

  /** Per-employee 360 list with filters. */
  async people(tenantId: string, opts: {
    from?: string; to?: string; functionId?: string; search?: string;
    sort?: string; limit?: number; offset?: number;
  }) {
    const { from, to } = await this.window(tenantId, opts.from, opts.to);
    const params: any[] = [tenantId, from, to];
    // reference $2/$3 (from/to) harmlessly so the count query — which reuses this
    // WHERE but not the CTEs — supplies the same param count PG expects.
    let where = `e.tenant_id=$1 AND $2::date IS NOT NULL AND $3::date IS NOT NULL`;
    // Fold interns into the parent team: picking a parent includes its interns (canon_fn on names).
    if (opts.functionId) { params.push(opts.functionId); where += ` AND e.function_id IN (SELECT id FROM functions WHERE canon_fn(name)=canon_fn((SELECT name FROM functions WHERE id=$${params.length})))`; }
    if (opts.search) {
      params.push(`%${opts.search.toLowerCase()}%`);
      where += ` AND (lower(e.first_name_en||' '||COALESCE(e.last_name_en,'')) LIKE $${params.length} OR e.employee_no ILIKE $${params.length})`;
    }
    const sortMap: Record<string, string> = {
      name: `name ASC`, late: `late_count DESC NULLS LAST`, sick: `sick_days DESC NULLS LAST`,
      ot: `ot_hours DESC NULLS LAST`, calls: `calls DESC NULLS LAST`, aht: `aht_sec ASC NULLS LAST`,
      conformance: `conformance_pct DESC NULLS LAST`, score: `avg_net DESC NULLS LAST`,
      absence: `absence_days DESC NULLS LAST`,
    };
    const order = sortMap[opts.sort || ''] || `working_days DESC NULLS LAST`;
    const limit = Math.min(Number(opts.limit) || 100, 500);
    const offset = Number(opts.offset) || 0;

    const rows = await this.ds.query(`
      WITH ${this.cteBlock()}
      SELECT e.id, e.employee_no,
             TRIM(e.first_name_en||' '||COALESCE(e.last_name_en,'')) AS name,
             f.name AS function_name, e.employment_type, e.gender, e.status,
             tm.first_name_en AS manager_first,
             COALESCE(att.working_days,0)::int AS working_days,
             COALESCE(att.office_days,0)::int  AS office_days,
             COALESCE(att.wfh_days,0)::int     AS wfh_days,
             COALESCE(att.sick_days,0)::int    AS sick_days,
             COALESCE(att.leave_days,0)::int   AS leave_days,
             COALESCE(att.absence_days,0)::int AS absence_days,
             COALESCE(att.off_days,0)::int     AS off_days,
             COALESCE(att.comp_days,0)::int    AS comp_days,
             COALESCE(att.late_count,0)::int   AS late_count,
             COALESCE(att.late_minutes,0)::int AS late_minutes,
             COALESCE(att.early_count,0)::int  AS early_count,
             COALESCE(att.missing_punch,0)::int  AS missing_punch,
             COALESCE(att.missing_system,0)::int AS missing_system,
             COALESCE(att.ot_hours,0)::float   AS ot_hours,
             CASE WHEN att.working_days>0 THEN ROUND(100.0*att.conforming_days/att.working_days,1) ELSE NULL END AS conformance_pct,
             COALESCE(prod.calls,0)::int       AS calls,
             CASE WHEN prod.calls>0 THEN ROUND((prod.talk+prod.acw)/prod.calls) ELSE NULL END AS aht_sec,
             CASE WHEN prod.staffed>0 THEN ROUND(100.0*(prod.talk+prod.acw)/prod.staffed,1) ELSE NULL END AS occupancy,
             CASE WHEN prod.staffed>0 THEN ROUND(100.0*prod.brk/prod.staffed,1) ELSE NULL END AS break_pct,
             ROUND(prod.staffed/3600.0,1)      AS staffed_h,
             sc.avg_net, sc.sc_months,
             fcr.fcr_pct::float AS fcr_pct, fcr.fcr_total
        FROM employees e
        LEFT JOIN functions f ON f.id=e.function_id
        LEFT JOIN employees tm ON tm.id=e.direct_manager_id
        LEFT JOIN att  ON att.employee_id=e.id
        LEFT JOIN prod ON prod.employee_no=e.employee_no
        LEFT JOIN sc   ON sc.employee_no=e.employee_no
        LEFT JOIN fcr  ON fcr.employee_id=e.id
       WHERE ${where}
       ORDER BY ${order}
       LIMIT ${limit} OFFSET ${offset}
    `, params);

    const totalRow = await this.ds.query(
      `SELECT COUNT(*)::int n FROM employees e WHERE ${where}`, params);

    return { from, to, total: totalRow[0]?.n || 0, count: rows.length, limit, offset, rows };
  }

  /** Per-function 360 rollup. */
  async functions360(tenantId: string, from?: string, to?: string) {
    const w = await this.window(tenantId, from, to);
    const rows = await this.ds.query(`
      WITH ${this.cteBlock()}
      SELECT canon_fn(COALESCE(f.name,'(none)')) AS function_name,
             COUNT(DISTINCT e.id)::int AS employees,
             SUM(COALESCE(att.working_days,0))::int AS working_days,
             SUM(COALESCE(att.sick_days,0))::int    AS sick_days,
             SUM(COALESCE(att.leave_days,0))::int   AS leave_days,
             SUM(COALESCE(att.absence_days,0))::int AS absence_days,
             SUM(COALESCE(att.late_count,0))::int   AS late_count,
             ROUND(SUM(COALESCE(att.ot_hours,0))::numeric,1)::float AS ot_hours,
             SUM(COALESCE(prod.calls,0))::int       AS calls,
             CASE WHEN SUM(prod.calls)>0 THEN ROUND(SUM(prod.talk+prod.acw)/SUM(prod.calls)) ELSE NULL END AS aht_sec,
             CASE WHEN SUM(prod.staffed)>0 THEN ROUND(100.0*SUM(prod.talk+prod.acw)/SUM(prod.staffed),1) ELSE NULL END AS occupancy,
             CASE WHEN SUM(att.working_days)>0 THEN ROUND(100.0*SUM(att.conforming_days)/SUM(att.working_days),1) ELSE NULL END AS conformance_pct,
             ROUND(AVG(sc.avg_net),1) AS avg_net,
             CASE WHEN SUM(fcr.fcr_total)>0 THEN ROUND(AVG(fcr.fcr_pct),1) ELSE NULL END AS fcr_pct
        FROM employees e
        LEFT JOIN functions f ON f.id=e.function_id
        LEFT JOIN att  ON att.employee_id=e.id
        LEFT JOIN prod ON prod.employee_no=e.employee_no
        LEFT JOIN sc   ON sc.employee_no=e.employee_no
        LEFT JOIN fcr  ON fcr.employee_id=e.id
       WHERE e.tenant_id=$1
       GROUP BY canon_fn(COALESCE(f.name,'(none)'))
       ORDER BY employees DESC
    `, [tenantId, w.from, w.to]);
    return { from: w.from, to: w.to, functions: rows };
  }

  /** Build a styled .xlsx of the filtered people list (People 360 + Functions). */
  async exportPeople(tenantId: string, opts: { from?: string; to?: string; functionId?: string; search?: string; sort?: string }) {
    const list = await this.people(tenantId, { ...opts, limit: 1000 });
    const funcs = await this.functions360(tenantId, opts.from, opts.to);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WFM System';

    const ws = wb.addWorksheet('Employees 360');
    const cols = [
      ['Employee No', 'employee_no', 12], ['Name', 'name', 26], ['Function', 'function_name', 20],
      ['Type', 'employment_type', 12], ['Work Days', 'working_days', 10], ['Office', 'office_days', 9],
      ['WFH', 'wfh_days', 8], ['Sick', 'sick_days', 8], ['Leave', 'leave_days', 8], ['Absence', 'absence_days', 9],
      ['Off', 'off_days', 7], ['Late', 'late_count', 8], ['Late Min', 'late_minutes', 9], ['Early Out', 'early_count', 9],
      ['Miss Punch', 'missing_punch', 10], ['Miss System', 'missing_system', 11], ['OT Hours', 'ot_hours', 9],
      ['Conformance %', 'conformance_pct', 13], ['Calls', 'calls', 9], ['AHT (s)', 'aht_sec', 9],
      ['Occupancy %', 'occupancy', 11], ['Break %', 'break_pct', 9], ['FCR %', 'fcr_pct', 9], ['Score', 'avg_net', 8],
    ] as [string, string, number][];
    ws.columns = cols.map(([h, k, w]) => ({ header: h, key: k, width: w }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    ws.getRow(1).alignment = { horizontal: 'center' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'X1' };
    for (const r of list.rows) ws.addRow(r);

    const fs2 = wb.addWorksheet('By Function');
    fs2.columns = [
      { header: 'Function', key: 'function_name', width: 22 }, { header: 'Employees', key: 'employees', width: 11 },
      { header: 'Work Days', key: 'working_days', width: 11 }, { header: 'Sick', key: 'sick_days', width: 8 },
      { header: 'Leave', key: 'leave_days', width: 8 }, { header: 'Absence', key: 'absence_days', width: 9 },
      { header: 'Late', key: 'late_count', width: 8 }, { header: 'OT Hours', key: 'ot_hours', width: 10 },
      { header: 'Calls', key: 'calls', width: 9 }, { header: 'AHT (s)', key: 'aht_sec', width: 9 },
      { header: 'Occupancy %', key: 'occupancy', width: 12 }, { header: 'Conformance %', key: 'conformance_pct', width: 13 },
      { header: 'FCR %', key: 'fcr_pct', width: 9 }, { header: 'Score', key: 'avg_net', width: 8 },
    ];
    fs2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fs2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5A4' } };
    fs2.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of funcs.functions) fs2.addRow(r);

    const meta = wb.addWorksheet('Info');
    meta.addRow(['People 360 export']);
    meta.addRow(['Period', `${list.from} → ${list.to}`]);
    meta.addRow(['Employees', list.total]);
    meta.addRow(['Filter', opts.search || opts.functionId || 'all']);

    return wb.xlsx.writeBuffer();
  }

  /** Full 360 detail for one employee incl. daily attendance + monthly trends. */
  async person(tenantId: string, employeeId: string, from?: string, to?: string) {
    const w = await this.window(tenantId, from, to);
    const head = (await this.ds.query(`
      SELECT e.id, e.employee_no, TRIM(e.first_name_en||' '||COALESCE(e.last_name_en,'')) AS name,
             e.first_name_ar, e.last_name_ar, f.name AS function_name, e.employment_type,
             e.gender, e.status, e.hire_date::text, tm.first_name_en AS manager
        FROM employees e LEFT JOIN functions f ON f.id=e.function_id
        LEFT JOIN employees tm ON tm.id=e.direct_manager_id
       WHERE e.tenant_id=$1 AND e.id=$2`, [tenantId, employeeId]))[0];
    if (!head) return { error: 'not found' };

    const summary = (await this.people(tenantId, { from: w.from, to: w.to, search: head.employee_no, limit: 1 })).rows[0] || {};
    const daily = await this.ds.query(`
      SELECT attendance_date::text date, attendance_marker AS marker, is_wfh,
             punch_in::text, punch_out::text, punch_late_minutes AS late, punch_early_out_minutes AS early,
             ot_minutes AS ot, is_missing_punch AS miss_punch
        FROM attendance_records WHERE tenant_id=$1 AND employee_id=$2 AND attendance_date BETWEEN $3 AND $4
       ORDER BY attendance_date`, [tenantId, employeeId, w.from, w.to]);
    const scoreTrend = await this.ds.query(`
      SELECT year, month, avg_net_points::float avg_net, best_net::float best_net, worst_net::float worst_net, weeks_scored, function_name
        FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no=$2 ORDER BY year, month`,
      [tenantId, head.employee_no]);
    const prodTrend = await this.ds.query(`
      SELECT work_date::text date, wrapped_calls AS calls,
             CASE WHEN wrapped_calls>0 THEN ROUND((talk_seconds+acw_seconds)/wrapped_calls) ELSE 0 END aht_sec,
             ROUND(staffed_seconds/3600.0,1) staffed_h
        FROM agent_productivity_daily WHERE tenant_id=$1 AND employee_no=$2 AND work_date BETWEEN $3 AND $4
       ORDER BY work_date`, [tenantId, head.employee_no, w.from, w.to]);

    return { from: w.from, to: w.to, employee: head, summary, daily, scoreTrend, prodTrend };
  }
}
