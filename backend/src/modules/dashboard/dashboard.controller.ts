import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('reports.view')   // org-wide KPI dashboard — WFM/TL/RTA, not agents
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Main dashboard summary — real-time KPIs */
  @Get('summary')
  @ApiOperation({ summary: 'Dashboard summary stats' })
  async summary(@CurrentUser() user: any) {
    const tid = user.tenantId;

    const [
      empRow, todayRow, requestsRow, trendRows, funcRows, alertsRow,
    ] = await Promise.all([
      // Active employees breakdown
      this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active')   AS total_active,
           COUNT(*) FILTER (WHERE status = 'active' AND employment_type = 'intern') AS total_interns,
           COUNT(*) FILTER (WHERE status = 'active' AND gender = 'female') AS total_female
         FROM employees WHERE tenant_id = $1`, [tid],
      ),

      // Today's attendance (use today, fallback to latest available date)
      this.ds.query(
        `WITH ref_date AS (
           SELECT CASE
             WHEN EXISTS (SELECT 1 FROM attendance_records WHERE attendance_date = CURRENT_DATE AND tenant_id = $1)
             THEN CURRENT_DATE
             ELSE (SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1)
           END AS d
         )
         SELECT
           (SELECT d FROM ref_date) AS ref_date,
           COUNT(*) FILTER (WHERE attendance_marker = 'present')                 AS present,
           COUNT(*) FILTER (WHERE attendance_marker IN ('absent', 'sick'))        AS absent_sick,
           COUNT(*) FILTER (WHERE attendance_marker = 'off')                     AS off_day,
           COUNT(*) FILTER (WHERE attendance_marker = 'leave')                   AS on_leave,
           COUNT(*) FILTER (WHERE attendance_marker = 'holiday')                 AS on_holiday,
           COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_wfh)      AS wfh,
           COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_missing_punch) AS missing_punch,
           COUNT(*) FILTER (WHERE punch_late_minutes > 0)                        AS late_in
         FROM attendance_records ar
         WHERE ar.tenant_id = $1
           AND ar.attendance_date = (SELECT d FROM ref_date)`,
        [tid],
      ),

      // Pending requests
      this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')       AS pending,
           COUNT(*) FILTER (WHERE status = 'peer_pending')  AS peer_pending,
           COUNT(*) FILTER (WHERE status = 'approved' AND updated_at >= NOW() - INTERVAL '7 days') AS approved_week,
           COUNT(*) FILTER (WHERE status = 'rejected' AND updated_at >= NOW() - INTERVAL '7 days') AS rejected_week
         FROM requests WHERE tenant_id = $1`, [tid],
      ),

      // 14-day attendance trend (present + absent per day)
      this.ds.query(
        `SELECT attendance_date::text AS date,
           COUNT(*) FILTER (WHERE attendance_marker = 'present')          AS present,
           COUNT(*) FILTER (WHERE attendance_marker IN ('absent','sick'))  AS absent,
           COUNT(*) FILTER (WHERE attendance_marker = 'off')              AS off_day,
           COUNT(*) FILTER (WHERE attendance_marker = 'leave')            AS on_leave
         FROM attendance_records
         WHERE tenant_id = $1
           AND attendance_date >= (
             SELECT MAX(attendance_date) - INTERVAL '13 days'
             FROM attendance_records WHERE tenant_id = $1
           )
         GROUP BY attendance_date
         ORDER BY attendance_date`, [tid],
      ),

      // Top 8 functions by present today
      this.ds.query(
        `WITH ref AS (
           SELECT COALESCE(
             (SELECT CURRENT_DATE WHERE EXISTS (SELECT 1 FROM attendance_records WHERE attendance_date = CURRENT_DATE AND tenant_id = $1)),
             (SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1)
           ) AS d
         )
         SELECT f.name AS function_name,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present,
           COUNT(*) AS scheduled
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = (SELECT d FROM ref)
         GROUP BY f.name
         ORDER BY present DESC
         LIMIT 8`, [tid],
      ),

      // Alerts
      this.ds.query(
        `SELECT
           (SELECT COUNT(*) FROM attendance_records
            WHERE tenant_id = $1
              AND attendance_date = (SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1)
              AND is_missing_punch = true AND attendance_marker = 'present') AS missing_punch_today,
           (SELECT COUNT(*) FROM attendance_records
            WHERE tenant_id = $1
              AND attendance_date = (SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1)
              AND punch_late_minutes > 30) AS late_over_30,
           (SELECT COUNT(*) FROM employees
            WHERE tenant_id = $1 AND status = 'active'
              AND id NOT IN (SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND tenant_id = $1)
           ) AS unlinked_employees`,
        [tid],
      ),
    ]);

    // Month-to-date attendance rate
    const [mtdRow] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker = 'present')             AS present,
         COUNT(*) FILTER (WHERE attendance_marker IN ('absent','sick'))     AS absent_sick,
         COUNT(*) FILTER (WHERE attendance_marker = 'present' AND punch_late_minutes > 0) AS late,
         COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_missing_punch) AS missing_punch,
         COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_wfh)  AS wfh,
         COUNT(*) FILTER (WHERE ot_minutes > 0)                             AS ot_records
       FROM attendance_records
       WHERE tenant_id = $1
         AND attendance_date >= DATE_TRUNC('month', (
           SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1
         ))`,
      [tid],
    );

    const emp     = empRow[0];
    const today   = todayRow[0];
    const reqs    = requestsRow[0];
    const alerts  = alertsRow[0];

    const presentN    = parseInt(today.present,    10);
    const absentN     = parseInt(today.absent_sick,10);
    const onLeaveN    = parseInt(today.on_leave,   10);
    const wfhN        = parseInt(today.wfh,        10);
    const missingN    = parseInt(today.missing_punch, 10);
    const lateN       = parseInt(today.late_in,    10);

    const mtdPresent  = parseInt(mtdRow.present,    10);
    const mtdAbsent   = parseInt(mtdRow.absent_sick,10);
    const mtdLate     = parseInt(mtdRow.late,       10);
    const mtdMissing  = parseInt(mtdRow.missing_punch, 10);
    const mtdWfh      = parseInt(mtdRow.wfh,        10);
    const mtdOt       = parseInt(mtdRow.ot_records, 10);

    const attendanceRate = mtdPresent + mtdAbsent > 0
      ? Math.round((mtdPresent / (mtdPresent + mtdAbsent)) * 100)
      : null;

    const lateRate = mtdPresent > 0
      ? Math.round((mtdLate / mtdPresent) * 100)
      : null;

    const missingPunchRate = mtdPresent > 0
      ? Math.round((mtdMissing / mtdPresent) * 100)
      : null;

    const wfhRate = mtdPresent > 0
      ? Math.round((mtdWfh / mtdPresent) * 100)
      : null;

    return {
      refDate: today.ref_date,

      // Top-level cards
      employees: {
        total:   parseInt(emp.total_active,  10),
        interns: parseInt(emp.total_interns, 10),
        female:  parseInt(emp.total_female,  10),
      },

      today: {
        present:      presentN,
        absentSick:   absentN,
        onLeave:      onLeaveN,
        off:          parseInt(today.off_day, 10),
        wfh:          wfhN,
        missingPunch: missingN,
        lateIn:       lateN,
      },

      requests: {
        pending:      parseInt(reqs.pending,      10),
        peerPending:  parseInt(reqs.peer_pending, 10),
        approvedWeek: parseInt(reqs.approved_week,10),
        rejectedWeek: parseInt(reqs.rejected_week,10),
      },

      // Month-to-date KPIs
      mtd: {
        attendanceRate,
        lateRate,
        missingPunchRate,
        wfhRate,
        otCount: mtdOt,
      },

      // Chart data
      trend: trendRows.map((r: any) => ({
        date:    r.date,
        present: parseInt(r.present,  10),
        absent:  parseInt(r.absent,   10),
        off:     parseInt(r.off_day,  10),
        leave:   parseInt(r.on_leave, 10),
      })),

      // Function breakdown
      functions: funcRows.map((r: any) => ({
        name:      r.function_name,
        present:   parseInt(r.present,   10),
        scheduled: parseInt(r.scheduled, 10),
      })),

      // Alerts
      alerts: {
        missingPunchToday: parseInt(alerts.missing_punch_today, 10),
        lateOver30:        parseInt(alerts.late_over_30,        10),
        unlinkedEmployees: parseInt(alerts.unlinked_employees,  10),
      },
    };
  }
}
