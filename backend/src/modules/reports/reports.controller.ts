import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Response } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('reports.view')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Attendance report — JSON preview + CSV export */
  @Get('attendance')
  @ApiOperation({ summary: 'Attendance report' })
  async attendance(
    @CurrentUser() user: any,
    @Query('from')       from?: string,
    @Query('to')         to?: string,
    @Query('functionId') functionId?: string,
    @Query('marker')     marker?: string,
    @Query('format')     format?: string,
    @Query('limit')      limitQ?: string,
    @Query('offset')     offsetQ?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const tid    = user.tenantId;
    const limit  = format === 'csv' ? 5000 : parseInt(limitQ  ?? '100', 10);
    const offset = parseInt(offsetQ ?? '0', 10);

    const [dateRow] = await this.ds.query(
      `SELECT MAX(attendance_date) AS latest FROM attendance_records WHERE tenant_id = $1`, [tid],
    );
    const latest = (dateRow.latest instanceof Date ? dateRow.latest.toISOString() : (dateRow.latest ?? new Date().toISOString())).slice(0, 10);
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const params: any[] = [tid, fromDate, toDate];
    const conds: string[] = [];
    if (functionId) { params.push(functionId); conds.push(`e.function_id = $${params.length}`); }
    if (marker)     { params.push(marker);      conds.push(`ar.attendance_marker = $${params.length}`); }
    const extra = conds.length ? 'AND ' + conds.join(' AND ') : '';

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       WHERE ar.tenant_id = $1 AND ar.attendance_date BETWEEN $2 AND $3 ${extra}`, params,
    );

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT ar.attendance_date, e.employee_no,
         e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
         e.gender, f.name AS function_name,
         ar.attendance_marker, ar.is_wfh,
         ar.scheduled_start, ar.scheduled_end,
         ar.punch_in, ar.punch_out,
         ar.punch_late_minutes, ar.punch_early_out_minutes,
         ar.system_late_minutes, ar.system_early_out_minutes,
         ar.is_missing_punch, ar.is_missing_system,
         ar.ot_minutes, ar.absence_reason
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $1 AND ar.attendance_date BETWEEN $2 AND $3 ${extra}
       ORDER BY ar.attendance_date DESC, f.name, e.first_name_en
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const mapped = rows.map((r: any) => ({
      date:              r.attendance_date,
      employeeNo:        r.employee_no,
      employeeName:      r.employee_name?.trim(),
      gender:            r.gender,
      function:          r.function_name,
      marker:            r.attendance_marker,
      isWfh:             r.is_wfh,
      scheduledStart:    r.scheduled_start,
      scheduledEnd:      r.scheduled_end,
      punchIn:           r.punch_in ? new Date(r.punch_in).toTimeString().slice(0, 5) : null,
      punchOut:          r.punch_out ? new Date(r.punch_out).toTimeString().slice(0, 5) : null,
      lateMinutes:       r.punch_late_minutes,
      earlyOutMinutes:   r.punch_early_out_minutes,
      sysLateMinutes:    r.system_late_minutes,
      sysEarlyOutMinutes:r.system_early_out_minutes,
      missingPunch:      r.is_missing_punch,
      missingSystem:     r.is_missing_system,
      otMinutes:         r.ot_minutes,
      absenceReason:     r.absence_reason,
    }));

    if (format === 'csv') {
      const headers = [
        'Date','Emp#','Name','Gender','Function','Status','WFH',
        'Sched Start','Sched End','Punch In','Punch Out',
        'Late(min)','Early Out(min)','Sys Late(min)','Sys Early Out(min)',
        'Missing Punch','Missing System','OT(min)','Absence Reason',
      ];
      const csvRows = mapped.map(r => [
        r.date, r.employeeNo, `"${r.employeeName}"`, r.gender, `"${r.function}"`,
        r.marker, r.isWfh ? 'Yes' : 'No',
        r.scheduledStart ?? '', r.scheduledEnd ?? '',
        r.punchIn ?? '', r.punchOut ?? '',
        r.lateMinutes, r.earlyOutMinutes, r.sysLateMinutes, r.sysEarlyOutMinutes,
        r.missingPunch ? 'Yes' : 'No', r.missingSystem ? 'Yes' : 'No',
        r.otMinutes, r.absenceReason ?? '',
      ].join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="attendance_${fromDate}_${toDate}.csv"`);
      return res!.send('﻿' + csv); // BOM for Excel Arabic
    }

    return { total: parseInt(total, 10), period: { from: fromDate, to: toDate }, limit, offset, data: mapped };
  }

  /** Late report */
  @Get('late')
  @ApiOperation({ summary: 'Late arrivals report' })
  async late(
    @CurrentUser() user: any,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const tid = user.tenantId;
    const [dateRow] = await this.ds.query(
      `SELECT MAX(attendance_date) AS latest FROM attendance_records WHERE tenant_id = $1`, [tid],
    );
    const latest = (dateRow.latest instanceof Date ? dateRow.latest.toISOString() : (dateRow.latest ?? new Date().toISOString())).slice(0, 10);
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const rows = await this.ds.query(
      `SELECT e.employee_no,
         e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
         f.name AS function_name, e.gender,
         COUNT(*) AS late_count,
         SUM(ar.punch_late_minutes) AS total_late_minutes,
         ROUND(AVG(ar.punch_late_minutes)) AS avg_late_minutes,
         MAX(ar.punch_late_minutes) AS max_late_minutes
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
         AND ar.punch_late_minutes > 0
         AND ar.attendance_marker = 'present'
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, e.gender, f.name
       ORDER BY late_count DESC, total_late_minutes DESC
       LIMIT 200`,
      [tid, fromDate, toDate],
    );

    const mapped = rows.map((r: any, i: number) => ({
      rank:           i + 1,
      employeeNo:     r.employee_no,
      employeeName:   r.employee_name?.trim(),
      functionName:   r.function_name,
      gender:         r.gender,
      lateCount:      parseInt(r.late_count, 10),
      totalLateMin:   parseInt(r.total_late_minutes, 10),
      avgLateMin:     parseInt(r.avg_late_minutes, 10),
      maxLateMin:     parseInt(r.max_late_minutes, 10),
    }));

    if (format === 'csv') {
      const headers = ['Rank','Emp#','Name','Function','Gender','Late Count','Total Late(min)','Avg Late(min)','Max Late(min)'];
      const csv = [headers.join(','),
        ...mapped.map(r => [r.rank, r.employeeNo, `"${r.employeeName}"`, `"${r.functionName}"`, r.gender, r.lateCount, r.totalLateMin, r.avgLateMin, r.maxLateMin].join(','))
      ].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="late_report_${fromDate}_${toDate}.csv"`);
      return res!.send('﻿' + csv);
    }
    return { period: { from: fromDate, to: toDate }, data: mapped };
  }

  /** OT report */
  @Get('overtime')
  @ApiOperation({ summary: 'Overtime report' })
  async overtime(
    @CurrentUser() user: any,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const tid = user.tenantId;
    const [dateRow] = await this.ds.query(
      `SELECT MAX(attendance_date) AS latest FROM attendance_records WHERE tenant_id = $1`, [tid],
    );
    const latest = (dateRow.latest instanceof Date ? dateRow.latest.toISOString() : (dateRow.latest ?? new Date().toISOString())).slice(0, 10);
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const rows = await this.ds.query(
      `SELECT e.employee_no,
         e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
         f.name AS function_name, e.gender,
         COUNT(*) AS ot_days,
         SUM(ar.ot_minutes) AS total_ot_minutes,
         ROUND(AVG(ar.ot_minutes)) AS avg_ot_minutes
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
         AND ar.ot_minutes > 0
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, e.gender, f.name
       ORDER BY total_ot_minutes DESC
       LIMIT 200`,
      [tid, fromDate, toDate],
    );

    const mapped = rows.map((r: any, i: number) => ({
      rank:         i + 1,
      employeeNo:   r.employee_no,
      employeeName: r.employee_name?.trim(),
      functionName: r.function_name,
      gender:       r.gender,
      otDays:       parseInt(r.ot_days, 10),
      totalOtMin:   parseInt(r.total_ot_minutes, 10),
      totalOtHours: +(parseInt(r.total_ot_minutes, 10) / 60).toFixed(1),
      avgOtMin:     parseInt(r.avg_ot_minutes, 10),
    }));

    if (format === 'csv') {
      const headers = ['Rank','Emp#','Name','Function','Gender','OT Days','Total OT(min)','Total OT(hrs)','Avg OT(min)'];
      const csv = [headers.join(','),
        ...mapped.map(r => [r.rank, r.employeeNo, `"${r.employeeName}"`, `"${r.functionName}"`, r.gender, r.otDays, r.totalOtMin, r.totalOtHours, r.avgOtMin].join(','))
      ].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="overtime_${fromDate}_${toDate}.csv"`);
      return res!.send('﻿' + csv);
    }
    return { period: { from: fromDate, to: toDate }, data: mapped };
  }

  /** Summary counts for the reports home */
  @Get('meta')
  async meta(@CurrentUser() user: any) {
    const tid = user.tenantId;
    const [row] = await this.ds.query(
      `SELECT
         (SELECT COUNT(*) FROM attendance_records WHERE tenant_id = $1) AS attendance_count,
         (SELECT COUNT(*) FROM requests WHERE tenant_id = $1) AS request_count,
         (SELECT COUNT(*) FROM outages WHERE tenant_id = $1) AS outage_count,
         (SELECT MIN(attendance_date) FROM attendance_records WHERE tenant_id = $1) AS from_date,
         (SELECT MAX(attendance_date) FROM attendance_records WHERE tenant_id = $1) AS to_date`,
      [tid],
    );
    return {
      attendanceCount: parseInt(row.attendance_count, 10),
      requestCount:    parseInt(row.request_count,    10),
      outageCount:     parseInt(row.outage_count,     10),
      dateRange:       { from: row.from_date, to: row.to_date },
    };
  }
}
