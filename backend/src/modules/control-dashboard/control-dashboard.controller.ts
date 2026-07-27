import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TRUE_OT } from '@common/wfm-metrics';
import { kwToday } from '@common/kw-date';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Control Dashboards (Module 06) — one KPI bundle from the real facts
 * (requests + attendance + coaching + campaigns + OT). The frontend renders
 * the role-relevant slice (Exec / WFM / TL).
 */
@ApiTags('Control Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'control-dashboard', version: '1' })
@RequirePermissions('reports.view')
export class ControlDashboardController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Role dashboard KPI bundle' })
  async summary(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    const tid = user.tenantId;
    /* Kuwait-local today. `toISOString()` is UTC, so during the first three hours
       of the 1st of a month it still named the LAST day of the previous month —
       and `fromDate` below derives from it, so the executive "month to date" bundle
       silently reported the whole prior month. */
    const toDate   = to   ?? kwToday();
    const fromDate = from ?? toDate.slice(0, 7) + '-01';

    // Latest attendance date (data may be historical)
    const [ld] = await this.ds.query(
      `SELECT MAX(attendance_date)::text AS d FROM attendance_records WHERE tenant_id = $1`, [tid],
    ).catch(() => [{ d: null }]);
    const latest = ld?.d ?? toDate;

    const [reqRow] = await this.ds.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
         COUNT(*) FILTER (WHERE status IN ('pending','peer_pending')) AS pending,
         COUNT(*) FILTER (WHERE escalated_at IS NOT NULL) AS escalated,
         COUNT(*) FILTER (WHERE sla_due_at < NOW() AND status IN ('pending','peer_pending')) AS overdue,
         COUNT(*) FILTER (WHERE is_urgent) AS urgent,
         ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(rejected_at, approved_l2_at, approved_l1_at) - submitted_at))/3600)
           FILTER (WHERE COALESCE(rejected_at, approved_l2_at, approved_l1_at) IS NOT NULL)::numeric, 1) AS avg_decision_hours
       FROM requests
       WHERE tenant_id = $1 AND submitted_at::date BETWEEN $2 AND $3`,
      [tid, fromDate, toDate],
    ).catch(() => [null]);

    const [attRow] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker = 'present') AS present,
         COUNT(*) FILTER (WHERE attendance_marker = 'absent')  AS absent,
         COUNT(*) FILTER (WHERE punch_late_minutes > 0)        AS late,
         COUNT(*) FILTER (WHERE punch_early_out_minutes > 0)   AS early_out,
         COUNT(*) FILTER (WHERE is_missing_punch)              AS missing_punch
       FROM attendance_records WHERE tenant_id = $1 AND attendance_date = $2::date`,
      [tid, latest],
    ).catch(() => [null]);

    const coachRows = await this.ds.query(
      `SELECT severity, COUNT(*) AS n FROM coaching_flags
       WHERE tenant_id = $1 AND status = 'open' GROUP BY severity`, [tid],
    ).catch(() => []);
    const coaching = { high: 0, medium: 0, low: 0 };
    for (const r of coachRows) (coaching as any)[r.severity] = parseInt(r.n, 10);

    const [campRow] = await this.ds.query(
      `SELECT COUNT(*) AS active FROM campaigns
       WHERE tenant_id = $1 AND is_active = TRUE AND CURRENT_DATE BETWEEN start_date AND end_date`, [tid],
    ).catch(() => [{ active: null }]);

    /* The Exec/WFM "Overtime (h)" tile. It summed attendance_records.ot_minutes —
       a table with ONE OT column — so it was structurally incapable of matching
       TRUE_OT and undercounted by ~28%, while CommandCenter showed the real figure
       under the same name. The drift was disclosed only inside a hover tooltip; the
       number an executive actually reads was still wrong. Payable OT over the
       canonical spine, same definition as every other OT surface.
       A FAILED query returns null, not 0 — see `num()`: a zero that means "the
       query broke" is indistinguishable from a quiet day, on an executive screen. */
    const [otRow] = await this.ds.query(
      `SELECT COALESCE(SUM(${TRUE_OT}), 0) AS ot_min FROM roster_days
       WHERE tenant_id = $1 AND work_date BETWEEN $2 AND $3
         AND is_active AND NOT COALESCE(ot_record_only, false)`, [tid, fromDate, toDate],
    ).catch(() => [{ ot_min: null }]);

    const byType = await this.ds.query(
      `SELECT rt.name, COUNT(*) AS n FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1 AND r.submitted_at::date BETWEEN $2 AND $3
       GROUP BY rt.name ORDER BY n DESC LIMIT 8`, [tid, fromDate, toDate],
    ).catch(() => []);

    const byFunction = await this.ds.query(
      `SELECT canon_fn(COALESCE(f.name,'—')) AS name,
              COUNT(*) FILTER (WHERE ar.punch_late_minutes > 0) AS late,
              COUNT(*) FILTER (WHERE ar.attendance_marker = 'absent') AS absent,
              COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date
       GROUP BY canon_fn(COALESCE(f.name,'—')) ORDER BY late DESC, absent DESC LIMIT 10`, [tid, latest],
    ).catch(() => []);

    /* `parseInt(v ?? 0) || 0` turned a BROKEN query into a measured zero. Each
       block's .catch now yields null, and this keeps the null all the way to the
       client so the UI can render "—" plus an "unavailable" chip. An executive
       could not previously tell a quiet day from a query that failed. */
    const num = (v: any) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    const otMin = num(otRow?.ot_min);
    return {
      period: { from: fromDate, to: toDate, attendanceDate: latest },
      requests: {
        total: num(reqRow?.total), approved: num(reqRow?.approved), rejected: num(reqRow?.rejected),
        pending: num(reqRow?.pending), escalated: num(reqRow?.escalated), overdue: num(reqRow?.overdue),
        urgent: num(reqRow?.urgent), avgDecisionHours: reqRow?.avg_decision_hours != null ? +reqRow.avg_decision_hours : null,
      },
      attendance: {
        present: num(attRow?.present), absent: num(attRow?.absent), late: num(attRow?.late),
        earlyOut: num(attRow?.early_out), missingPunch: num(attRow?.missing_punch),
      },
      coaching,
      campaignsActive: num(campRow?.active),
      otHours: otMin == null ? null : +(otMin / 60).toFixed(1),
      byType: byType.map((r: any) => ({ name: r.name, count: num(r.n) })),
      byFunction: byFunction.map((r: any) => ({
        name: r.name, late: num(r.late), absent: num(r.absent), present: num(r.present),
      })),
    };
  }
}
