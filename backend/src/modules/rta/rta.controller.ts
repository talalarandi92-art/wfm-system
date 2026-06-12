import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

@ApiTags('RTA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('rta.view')
@Controller({ path: 'rta', version: '1' })
export class RtaController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get('live')
  @ApiOperation({ summary: 'RTA live monitoring snapshot' })
  async live(@CurrentUser() user: any) {
    const tid = user.tenantId;

    const [refRow] = await this.ds.query(
      `SELECT CASE
         WHEN EXISTS(SELECT 1 FROM attendance_records WHERE attendance_date = CURRENT_DATE AND tenant_id = $1)
         THEN CURRENT_DATE ELSE (SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1)
       END AS d`, [tid],
    );
    const refDate: string = refRow.d;

    const [summary, byFunction, agents, lateAgents, missingAgents] = await Promise.all([

      // Overall summary
      this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE attendance_marker = 'present') AS present,
           COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_wfh) AS wfh,
           COUNT(*) FILTER (WHERE attendance_marker IN ('absent','sick')) AS absent,
           COUNT(*) FILTER (WHERE attendance_marker = 'off') AS off_day,
           COUNT(*) FILTER (WHERE attendance_marker = 'leave') AS on_leave,
           COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_missing_punch) AS missing_punch,
           COUNT(*) FILTER (WHERE punch_late_minutes > 0) AS late_in,
           COUNT(*) FILTER (WHERE punch_late_minutes > 30) AS late_over_30,
           COUNT(*) FILTER (WHERE ot_minutes > 0) AS ot_active,
           COUNT(*) AS total_scheduled
         FROM attendance_records
         WHERE tenant_id = $1 AND attendance_date = $2`,
        [tid, refDate],
      ),

      // Per function breakdown
      this.ds.query(
        `SELECT f.name AS function_name, f.id AS function_id,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present' AND ar.is_wfh) AS wfh,
           COUNT(*) FILTER (WHERE ar.attendance_marker IN ('absent','sick')) AS absent,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'off') AS off_day,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'leave') AS on_leave,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present' AND ar.is_missing_punch) AS missing_punch,
           COUNT(*) FILTER (WHERE ar.punch_late_minutes > 0) AS late_in,
           COUNT(*) AS total
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
         GROUP BY f.id, f.name
         ORDER BY present DESC`,
        [tid, refDate],
      ),

      // All agents with status
      this.ds.query(
        `SELECT e.id, e.employee_no,
           e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
           e.gender, f.name AS function_name,
           ar.attendance_marker,
           ar.is_wfh,
           ar.punch_late_minutes,
           ar.system_late_minutes,
           ar.is_missing_punch,
           ar.is_missing_system,
           ar.ot_minutes,
           ar.punch_in,
           ar.system_login,
           ar.scheduled_start,
           ar.absence_reason
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
         ORDER BY f.name, ar.attendance_marker, e.first_name_en`,
        [tid, refDate],
      ),

      // Top late arrivals
      this.ds.query(
        `SELECT e.employee_no,
           e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
           f.name AS function_name,
           ar.punch_late_minutes,
           ar.system_late_minutes
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
           AND ar.punch_late_minutes > 0
         ORDER BY ar.punch_late_minutes DESC
         LIMIT 10`,
        [tid, refDate],
      ),

      // Missing punch
      this.ds.query(
        `SELECT e.employee_no,
           e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
           f.name AS function_name,
           ar.scheduled_start
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
           AND ar.is_missing_punch = true AND ar.attendance_marker = 'present'
         ORDER BY f.name, e.first_name_en
         LIMIT 20`,
        [tid, refDate],
      ),
    ]);

    const s = summary[0];
    const toInt = (v: any) => parseInt(v ?? '0', 10);

    return {
      refDate,
      summary: {
        present:      toInt(s.present),
        wfh:          toInt(s.wfh),
        absent:       toInt(s.absent),
        offDay:       toInt(s.off_day),
        onLeave:      toInt(s.on_leave),
        missingPunch: toInt(s.missing_punch),
        lateIn:       toInt(s.late_in),
        lateOver30:   toInt(s.late_over_30),
        otActive:     toInt(s.ot_active),
        totalScheduled: toInt(s.total_scheduled),
        coveragePct: toInt(s.total_scheduled) > 0
          ? Math.round((toInt(s.present) / toInt(s.total_scheduled)) * 100)
          : 0,
      },
      byFunction: byFunction.map((r: any) => ({
        functionId:   r.function_id,
        functionName: r.function_name,
        present:      toInt(r.present),
        wfh:          toInt(r.wfh),
        absent:       toInt(r.absent),
        offDay:       toInt(r.off_day),
        onLeave:      toInt(r.on_leave),
        missingPunch: toInt(r.missing_punch),
        lateIn:       toInt(r.late_in),
        total:        toInt(r.total),
        coveragePct: toInt(r.total) > 0
          ? Math.round((toInt(r.present) / toInt(r.total)) * 100)
          : 0,
      })),
      agents: agents.map((a: any) => ({
        id:              a.id,
        employeeNo:      a.employee_no,
        fullName:        a.full_name.trim(),
        gender:          a.gender,
        functionName:    a.function_name,
        status:          a.attendance_marker,
        isWfh:           a.is_wfh,
        lateMinutes:     toInt(a.punch_late_minutes),
        systemLateMin:   toInt(a.system_late_minutes),
        missingPunch:    a.is_missing_punch,
        missingSystem:   a.is_missing_system,
        otMinutes:       toInt(a.ot_minutes),
        punchIn:         a.punch_in,
        systemLogin:     a.system_login,
        scheduledStart:  a.scheduled_start,
        absenceReason:   a.absence_reason,
      })),
      lateAgents: lateAgents.map((a: any) => ({
        employeeNo:   a.employee_no,
        fullName:     a.full_name.trim(),
        functionName: a.function_name,
        lateMinutes:  toInt(a.punch_late_minutes),
        sysLateMin:   toInt(a.system_late_minutes),
      })),
      missingAgents: missingAgents.map((a: any) => ({
        employeeNo:    a.employee_no,
        fullName:      a.full_name.trim(),
        functionName:  a.function_name,
        scheduledStart: a.scheduled_start,
      })),
    };
  }
}
