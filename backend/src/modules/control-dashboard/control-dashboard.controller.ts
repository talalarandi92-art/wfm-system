import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
    const toDate   = to   ?? new Date().toISOString().slice(0, 10);
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
    ).catch(() => [{}]);

    const [attRow] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker = 'present') AS present,
         COUNT(*) FILTER (WHERE attendance_marker = 'absent')  AS absent,
         COUNT(*) FILTER (WHERE punch_late_minutes > 0)        AS late,
         COUNT(*) FILTER (WHERE punch_early_out_minutes > 0)   AS early_out,
         COUNT(*) FILTER (WHERE is_missing_punch)              AS missing_punch
       FROM attendance_records WHERE tenant_id = $1 AND attendance_date = $2::date`,
      [tid, latest],
    ).catch(() => [{}]);

    const coachRows = await this.ds.query(
      `SELECT severity, COUNT(*) AS n FROM coaching_flags
       WHERE tenant_id = $1 AND status = 'open' GROUP BY severity`, [tid],
    ).catch(() => []);
    const coaching = { high: 0, medium: 0, low: 0 };
    for (const r of coachRows) (coaching as any)[r.severity] = parseInt(r.n, 10);

    const [campRow] = await this.ds.query(
      `SELECT COUNT(*) AS active FROM campaigns
       WHERE tenant_id = $1 AND is_active = TRUE AND CURRENT_DATE BETWEEN start_date AND end_date`, [tid],
    ).catch(() => [{ active: 0 }]);

    const [otRow] = await this.ds.query(
      `SELECT COALESCE(SUM(ot_minutes), 0) AS ot_min FROM attendance_records
       WHERE tenant_id = $1 AND attendance_date BETWEEN $2 AND $3`, [tid, fromDate, toDate],
    ).catch(() => [{ ot_min: 0 }]);

    const byType = await this.ds.query(
      `SELECT rt.name, COUNT(*) AS n FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1 AND r.submitted_at::date BETWEEN $2 AND $3
       GROUP BY rt.name ORDER BY n DESC LIMIT 8`, [tid, fromDate, toDate],
    ).catch(() => []);

    const byFunction = await this.ds.query(
      `SELECT COALESCE(f.name,'—') AS name,
              COUNT(*) FILTER (WHERE ar.punch_late_minutes > 0) AS late,
              COUNT(*) FILTER (WHERE ar.attendance_marker = 'absent') AS absent,
              COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date
       GROUP BY f.name ORDER BY late DESC, absent DESC LIMIT 10`, [tid, latest],
    ).catch(() => []);

    const num = (v: any) => parseInt(v ?? 0, 10) || 0;
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
      otHours: +(num(otRow?.ot_min) / 60).toFixed(1),
      byType: byType.map((r: any) => ({ name: r.name, count: num(r.n) })),
      byFunction: byFunction.map((r: any) => ({
        name: r.name, late: num(r.late), absent: num(r.absent), present: num(r.present),
      })),
    };
  }
}
