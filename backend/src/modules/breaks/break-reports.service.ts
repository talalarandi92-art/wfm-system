import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';

/**
 * B5 — REPORTING & ANALYTICS (§25). One consolidated read-only report over
 * break_slots / break_daily_balance / break_fairness / break_requests /
 * audit_logs for a date range (optionally one canon function). Zero writes.
 * The Excel export reuses the exact sections (one sheet per section + Summary),
 * following the attendance-recon exceljs pattern.
 */

// duration of a slot in minutes, cross-midnight safe (SQL fragment)
const DUR = (a: string, b: string) =>
  `GREATEST(0, (EXTRACT(EPOCH FROM (${b} - ${a})) / 60 + CASE WHEN ${b} < ${a} THEN 1440 ELSE 0 END))::int`;

@Injectable()
export class BreakReportsService {
  constructor(private readonly dataSource: DataSource) {}

  private range(from?: string, to?: string): { from: string; to: string } {
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!ok(from) || !ok(to)) throw new BadRequestException('Query params "from" and "to" (YYYY-MM-DD) are required.');
    if (from! > to!) throw new BadRequestException('"from" must be <= "to".');
    return { from: from!, to: to! };
  }

  /** WHERE fragment + params for the optional canon-function filter. */
  private fnFilter(functionName: string | undefined, paramIdx: number): { sql: string; params: string[] } {
    if (!functionName) return { sql: '', params: [] };
    return { sql: ` AND canon_fn(COALESCE(f.name,'—')) = canon_fn($${paramIdx})`, params: [functionName] };
  }

  async getReports(tenantId: string, fromQ?: string, toQ?: string, functionName?: string) {
    const { from, to } = this.range(fromQ, toQ);
    const ds = this.dataSource;
    const fn = this.fnFilter(functionName, 4);
    const base = [tenantId, from, to, ...fn.params];

    // ── 1. Entitlement vs used (per employee) ────────────────────────────────
    const entitlement = await ds.query(
      `WITH day AS (
         SELECT bs.employee_id, bs.schedule_date,
                COALESCE(MAX(b.entitled_minutes), 60) AS entitled,
                GREATEST(COALESCE(MAX(b.used_minutes), 0),
                  COALESCE(SUM(CASE WHEN bs.status = 'completed' THEN
                    CASE WHEN bs.actual_start IS NOT NULL AND bs.actual_end IS NOT NULL
                      THEN ${DUR('bs.actual_start', 'bs.actual_end')}
                      ELSE ${DUR('bs.planned_start', 'bs.planned_end')} END
                    ELSE 0 END), 0)) AS used_min,
                GREATEST(COALESCE(MAX(b.sessions_used), 0),
                  COUNT(*) FILTER (WHERE bs.status = 'completed')::int) AS sessions,
                COUNT(*) FILTER (WHERE bs.is_missed OR bs.status = 'missed')::int AS missed
         FROM break_slots bs
         JOIN employees e ON e.id = bs.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         LEFT JOIN break_daily_balance b
           ON b.tenant_id = bs.tenant_id AND b.employee_id = bs.employee_id AND b.balance_date = bs.schedule_date
         WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date
           AND bs.status <> 'cancelled'${fn.sql}
         GROUP BY bs.employee_id, bs.schedule_date
       )
       SELECT e.employee_no,
              (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
              canon_fn(COALESCE(f.name,'—')) AS function_name,
              COUNT(*)::int                  AS days,
              SUM(d.entitled)::int           AS entitled_min,
              SUM(LEAST(d.used_min, d.entitled))::int AS used_min,
              SUM(d.sessions)::int           AS sessions,
              SUM(d.missed)::int             AS missed_slots,
              SUM(GREATEST(0, d.entitled - d.used_min))::int AS missed_entitlement_min
       FROM day d
       JOIN employees e ON e.id = d.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
       ORDER BY missed_entitlement_min DESC, employee_name`,
      base,
    );

    // ── 2. Delay stats ───────────────────────────────────────────────────────
    const delayCore = `
      FROM break_slots bs
      JOIN employees e ON e.id = bs.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date
        AND COALESCE(bs.delay_min, 0) > 0${fn.sql}`;
    const [delayTotals] = await ds.query(
      `SELECT COUNT(*)::int AS delayed_count,
              ROUND(AVG(bs.delay_min), 1)::float AS avg_delay_min,
              MAX(bs.delay_min)::int AS max_delay_min,
              SUM(bs.delay_min)::int AS total_delay_min ${delayCore}`, base);
    const delayByFunction = await ds.query(
      `SELECT canon_fn(COALESCE(f.name,'—')) AS function_name, COUNT(*)::int AS delayed_count,
              ROUND(AVG(bs.delay_min), 1)::float AS avg_delay_min, MAX(bs.delay_min)::int AS max_delay_min
       ${delayCore} GROUP BY 1 ORDER BY delayed_count DESC`, base);
    const delayByDay = await ds.query(
      `SELECT bs.schedule_date::text AS date, COUNT(*)::int AS delayed_count,
              ROUND(AVG(bs.delay_min), 1)::float AS avg_delay_min, MAX(bs.delay_min)::int AS max_delay_min
       ${delayCore} GROUP BY 1 ORDER BY 1`, base);

    // ── 3. Release stats (auto vs manual vs exception; eligible→released time) ─
    const releaseBySource = await ds.query(
      `SELECT COALESCE(bs.release_source, 'unreleased') AS source, COUNT(*)::int AS count,
              ROUND(AVG(
                GREATEST(0, EXTRACT(EPOCH FROM (bs.released_at -
                  ((COALESCE(bs.planned_date, bs.schedule_date)::text || ' ' || bs.earliest_start::text || '+03')::timestamptz)
                )) / 60)
              ) FILTER (WHERE bs.released_at IS NOT NULL AND bs.earliest_start IS NOT NULL), 1)::float AS avg_eligible_to_release_min
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date${fn.sql}
       GROUP BY 1 ORDER BY count DESC`,
      base,
    );
    const [exceptions] = await ds.query(
      `SELECT COUNT(*) FILTER (WHERE action = 'breaks.entitlement.override')::int AS entitlement_overrides,
              COUNT(*) FILTER (WHERE action = 'breaks.engine.mode')::int          AS mode_changes,
              COUNT(*) FILTER (WHERE action = 'breaks.release.manual')::int       AS manual_releases_audited,
              COUNT(*) FILTER (WHERE action = 'breaks.delay.escalated')::int      AS delay_escalations
       FROM audit_logs
       WHERE tenant_id = $1 AND module = 'breaks' AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );

    // ── 4. Late returns (actual duration > planned duration) ────────────────
    const lateReturns = await ds.query(
      `SELECT e.employee_no,
              (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
              canon_fn(COALESCE(f.name,'—')) AS function_name,
              COUNT(*)::int AS late_return_count,
              SUM(x.late_min)::int AS late_return_minutes,
              MAX(x.late_min)::int AS worst_late_return_min
       FROM (
         SELECT bs.employee_id,
                GREATEST(0, ${DUR('bs.actual_start', 'bs.actual_end')} - ${DUR('bs.planned_start', 'bs.planned_end')}) AS late_min
         FROM break_slots bs
         WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date
           AND bs.status = 'completed' AND bs.actual_start IS NOT NULL AND bs.actual_end IS NOT NULL
       ) x
       JOIN employees e ON e.id = x.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE x.late_min > 0${fn.sql}
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
       ORDER BY late_return_minutes DESC`,
      base,
    );

    // ── 5. Unauthorized / overdue ────────────────────────────────────────────
    const [overdue] = await ds.query(
      `SELECT COUNT(*) FILTER (WHERE bs.status = 'overdue')::int AS currently_overdue,
              COUNT(*) FILTER (WHERE bs.is_missed OR bs.status = 'missed')::int AS missed_breaks,
              COUNT(*) FILTER (WHERE bs.actual_start IS NOT NULL AND bs.released_at IS NULL
                               AND bs.release_source IS NULL AND bs.generated_by = 'auto')::int AS started_without_release
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date${fn.sql}`,
      base,
    );
    const [overdueEvents] = await ds.query(
      `SELECT COUNT(*)::int AS overdue_events
       FROM audit_logs
       WHERE tenant_id = $1 AND module = 'breaks' AND action = 'breaks.overdue'
         AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );

    // ── 6. Fairness distribution (monthly ledger months touching the range) ──
    const fairness = await ds.query(
      `SELECT e.employee_no,
              (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
              canon_fn(COALESCE(f.name,'—')) AS function_name,
              bf.period_year, bf.period_month,
              bf.early_slot_count, bf.mid_slot_count, bf.late_slot_count,
              bf.total_breaks, bf.missed_breaks, bf.fairness_score
       FROM break_fairness bf
       JOIN employees e ON e.id = bf.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bf.tenant_id = $1
         AND make_date(bf.period_year, bf.period_month, 1)
             BETWEEN date_trunc('month', $2::date) AND $3::date${fn.sql}
       ORDER BY bf.fairness_score DESC, employee_name`,
      base,
    );

    // ── 7. Peak request / delay hours (histogram by hour of day) ────────────
    const peakHours = await ds.query(
      `SELECT h.hour,
              COALESCE(s.slots, 0)     AS slots,
              COALESCE(s.delayed, 0)   AS delayed,
              COALESCE(r.requests, 0)  AS requests
       FROM generate_series(0, 23) AS h(hour)
       LEFT JOIN (
         SELECT EXTRACT(HOUR FROM bs.planned_start)::int AS hour,
                COUNT(*)::int AS slots,
                COUNT(*) FILTER (WHERE COALESCE(bs.delay_min, 0) > 0)::int AS delayed
         FROM break_slots bs
         JOIN employees e ON e.id = bs.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date${fn.sql}
         GROUP BY 1
       ) s ON s.hour = h.hour
       LEFT JOIN (
         SELECT EXTRACT(HOUR FROM br.requested_start)::int AS hour, COUNT(*)::int AS requests
         FROM break_requests br
         JOIN employees e ON e.id = br.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE br.tenant_id = $1 AND br.schedule_date BETWEEN $2::date AND $3::date${fn.sql}
         GROUP BY 1
       ) r ON r.hour = h.hour
       ORDER BY h.hour`,
      base,
    );

    // ── Summary ──────────────────────────────────────────────────────────────
    const [totals] = await ds.query(
      `SELECT COUNT(*)::int AS total_slots,
              COUNT(DISTINCT bs.employee_id)::int AS employees,
              COUNT(DISTINCT bs.schedule_date)::int AS days,
              COUNT(*) FILTER (WHERE bs.status = 'completed')::int AS completed
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2::date AND $3::date${fn.sql}`,
      base,
    );

    return {
      range: { from, to },
      function: functionName ?? null,
      summary: {
        totalSlots: totals?.total_slots ?? 0,
        employees: totals?.employees ?? 0,
        days: totals?.days ?? 0,
        completed: totals?.completed ?? 0,
        delayedCount: delayTotals?.delayed_count ?? 0,
        avgDelayMin: delayTotals?.avg_delay_min ?? 0,
        maxDelayMin: delayTotals?.max_delay_min ?? 0,
        overdueEvents: overdueEvents?.overdue_events ?? 0,
        missedBreaks: overdue?.missed_breaks ?? 0,
        entitlementOverrides: exceptions?.entitlement_overrides ?? 0,
      },
      sections: {
        entitlement,
        delays: { totals: delayTotals ?? {}, byFunction: delayByFunction, byDay: delayByDay },
        releases: { bySource: releaseBySource, exceptions: exceptions ?? {} },
        lateReturns,
        overdue: { ...(overdue ?? {}), overdue_events: overdueEvents?.overdue_events ?? 0 },
        fairness,
        peakHours,
      },
    };
  }

  // ── Excel export — one sheet per section + Summary (recon controllers pattern) ─
  async buildWorkbook(tenantId: string, from?: string, to?: string, functionName?: string): Promise<ExcelJS.Workbook> {
    const rep = await this.getReports(tenantId, from, to, functionName);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WFM System — Smart Break Engine';

    const sheet = (name: string, cols: { header: string; key: string; width?: number }[], rows: any[], color = 'FF4F46E5') => {
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map(c => ({ ...c, width: c.width || 16 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
      rows.forEach(r => ws.addRow(r));
    };

    sheet('Summary', [{ header: 'Metric', key: 'k', width: 34 }, { header: 'Value', key: 'v', width: 22 }], [
      { k: 'Range', v: `${rep.range.from} → ${rep.range.to}` },
      { k: 'Function filter', v: rep.function ?? '(all)' },
      { k: 'Total break slots', v: rep.summary.totalSlots },
      { k: 'Employees', v: rep.summary.employees },
      { k: 'Days', v: rep.summary.days },
      { k: 'Completed breaks', v: rep.summary.completed },
      { k: 'Delayed breaks', v: rep.summary.delayedCount },
      { k: 'Avg delay (min)', v: rep.summary.avgDelayMin },
      { k: 'Max delay (min)', v: rep.summary.maxDelayMin },
      { k: 'Overdue events', v: rep.summary.overdueEvents },
      { k: 'Missed breaks', v: rep.summary.missedBreaks },
      { k: 'Entitlement overrides', v: rep.summary.entitlementOverrides },
    ], 'FF334155');

    sheet('Entitlement', [
      { header: 'Employee No', key: 'employee_no' }, { header: 'Employee', key: 'employee_name', width: 26 },
      { header: 'Function', key: 'function_name', width: 18 }, { header: 'Days', key: 'days', width: 8 },
      { header: 'Entitled (min)', key: 'entitled_min' }, { header: 'Used (min)', key: 'used_min' },
      { header: 'Sessions', key: 'sessions', width: 10 }, { header: 'Missed Slots', key: 'missed_slots', width: 12 },
      { header: 'Missed Entitlement (min)', key: 'missed_entitlement_min', width: 22 },
    ], rep.sections.entitlement, 'FF0EA5E9');

    sheet('Delays_ByFunction', [
      { header: 'Function', key: 'function_name', width: 22 }, { header: 'Delayed', key: 'delayed_count' },
      { header: 'Avg Delay (min)', key: 'avg_delay_min' }, { header: 'Max Delay (min)', key: 'max_delay_min' },
    ], rep.sections.delays.byFunction, 'FFD97706');

    sheet('Delays_ByDay', [
      { header: 'Date', key: 'date' }, { header: 'Delayed', key: 'delayed_count' },
      { header: 'Avg Delay (min)', key: 'avg_delay_min' }, { header: 'Max Delay (min)', key: 'max_delay_min' },
    ], rep.sections.delays.byDay, 'FFD97706');

    sheet('Releases', [
      { header: 'Source', key: 'source', width: 18 }, { header: 'Count', key: 'count' },
      { header: 'Avg Eligible→Release (min)', key: 'avg_eligible_to_release_min', width: 24 },
    ], [
      ...rep.sections.releases.bySource,
      { source: '— entitlement overrides (audited)', count: (rep.sections.releases.exceptions as any).entitlement_overrides ?? 0 },
      { source: '— mode changes (audited)', count: (rep.sections.releases.exceptions as any).mode_changes ?? 0 },
      { source: '— delay escalations (audited)', count: (rep.sections.releases.exceptions as any).delay_escalations ?? 0 },
    ], 'FF059669');

    sheet('Late_Returns', [
      { header: 'Employee No', key: 'employee_no' }, { header: 'Employee', key: 'employee_name', width: 26 },
      { header: 'Function', key: 'function_name', width: 18 }, { header: 'Late Returns', key: 'late_return_count', width: 12 },
      { header: 'Late Minutes', key: 'late_return_minutes', width: 12 }, { header: 'Worst (min)', key: 'worst_late_return_min', width: 12 },
    ], rep.sections.lateReturns, 'FFDC2626');

    sheet('Overdue', [{ header: 'Metric', key: 'k', width: 30 }, { header: 'Value', key: 'v' }], [
      { k: 'Overdue events (audited)', v: (rep.sections.overdue as any).overdue_events },
      { k: 'Currently overdue slots', v: (rep.sections.overdue as any).currently_overdue },
      { k: 'Missed breaks', v: (rep.sections.overdue as any).missed_breaks },
      { k: 'Started without release', v: (rep.sections.overdue as any).started_without_release },
    ], 'FFDC2626');

    sheet('Fairness', [
      { header: 'Employee No', key: 'employee_no' }, { header: 'Employee', key: 'employee_name', width: 26 },
      { header: 'Function', key: 'function_name', width: 18 }, { header: 'Year', key: 'period_year', width: 8 },
      { header: 'Month', key: 'period_month', width: 8 }, { header: 'Early', key: 'early_slot_count', width: 8 },
      { header: 'Mid', key: 'mid_slot_count', width: 8 }, { header: 'Late', key: 'late_slot_count', width: 8 },
      { header: 'Total', key: 'total_breaks', width: 8 }, { header: 'Missed', key: 'missed_breaks', width: 8 },
      { header: 'Fairness Score', key: 'fairness_score', width: 14 },
    ], rep.sections.fairness, 'FF7C3AED');

    sheet('Peak_Hours', [
      { header: 'Hour', key: 'hour', width: 8 }, { header: 'Slots', key: 'slots' },
      { header: 'Delayed', key: 'delayed' }, { header: 'Requests', key: 'requests' },
    ], rep.sections.peakHours, 'FF6366F1');

    return wb;
  }
}
