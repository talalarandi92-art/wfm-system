import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Response } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ReportsService } from './reports.service';

// Build a CSV string from an array of objects using its keys as headers.
function rowsToCsv(rows: any[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('reports.view')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly svc: ReportsService,
  ) {}

  // Send `rows` as csv | xlsx | json depending on `format`.
  private deliver(res: Response, rows: any[], format: string | undefined, baseName: string, sheet = 'Report') {
    if (format === 'xlsx') {
      const buf = this.svc.sheetToXlsx(rows, sheet);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      return res.send(buf);
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send('﻿' + rowsToCsv(rows));
    }
    return rows;
  }

  /* ── Detailed requests (full approval chain + SLA + rejection) ── */
  @Get('requests-detailed')
  @ApiOperation({ summary: 'Detailed requests: approval chain, SLA, reasons' })
  async requestsDetailed(
    @CurrentUser() user: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('type') type?: string, @Query('status') status?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { fromDate, toDate } = await this.svc.resolveRange(user.tenantId, from, to);
    const rows = await this.svc.requestsDetailed(user.tenantId, fromDate, toDate, type, status);
    if (format) return this.deliver(res!, rows, format, `requests_detailed_${fromDate}_${toDate}`, 'Requests');
    return { period: { from: fromDate, to: toDate }, total: rows.length, data: rows };
  }

  /* ── Permissions (استئذان): hours, type, intervals early/late ── */
  @Get('permissions')
  @ApiOperation({ summary: 'Permissions report: hours, types, interval breakdown' })
  async permissions(
    @CurrentUser() user: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('view') view?: string, @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { fromDate, toDate } = await this.svc.resolveRange(user.tenantId, from, to);
    const r = await this.svc.permissionsDetailed(user.tenantId, fromDate, toDate);
    const rows = view === 'intervals' ? r.intervals : view === 'summary' ? r.summary : r.detail;
    if (format) return this.deliver(res!, rows, format, `permissions_${view ?? 'detail'}_${fromDate}_${toDate}`, 'Permissions');
    return { period: { from: fromDate, to: toDate }, ...r };
  }

  /* ── Breaks: count, duration, shift, approver ── */
  @Get('breaks')
  @ApiOperation({ summary: 'Breaks report: duration, shift, approver' })
  async breaks(
    @CurrentUser() user: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('view') view?: string, @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { fromDate, toDate } = await this.svc.resolveRange(user.tenantId, from, to);
    const r = await this.svc.breaksDetailed(user.tenantId, fromDate, toDate);
    const rows = view === 'summary' ? r.summary : r.detail;
    if (format) return this.deliver(res!, rows, format, `breaks_${view ?? 'detail'}_${fromDate}_${toDate}`, 'Breaks');
    return { period: { from: fromDate, to: toDate }, ...r };
  }

  /* ── Audit: who changed what, when, why ── */
  @Get('audit')
  @ApiOperation({ summary: 'Audit trail: who/what/when/why' })
  async audit(
    @CurrentUser() user: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('module') module?: string, @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { fromDate, toDate } = await this.svc.resolveRange(user.tenantId, from, to);
    const r = await this.svc.auditDetailed(user.tenantId, fromDate, toDate, module);
    if (format) return this.deliver(res!, r.detail, format, `audit_${fromDate}_${toDate}`, 'Audit');
    return { period: { from: fromDate, to: toDate }, ...r };
  }

  /* ── Overtime detailed: before/after shift + % of work ── */
  @Get('overtime-detailed')
  @ApiOperation({ summary: 'Overtime: before/after shift split + % of work hours' })
  async overtimeDetailed(
    @CurrentUser() user: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('view') view?: string, @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { fromDate, toDate } = await this.svc.resolveRange(user.tenantId, from, to);
    const r = await this.svc.overtimeDetailed(user.tenantId, fromDate, toDate);
    const rows = view === 'daily' ? r.detail : r.ranking;
    if (format) return this.deliver(res!, rows, format, `overtime_${view ?? 'ranking'}_${fromDate}_${toDate}`, 'Overtime');
    return { period: { from: fromDate, to: toDate }, ...r };
  }

  /* ── Master workbook: every report bundled in one multi-sheet .xlsx ── */
  @Get('workbook')
  @ApiOperation({ summary: 'Download ALL reports as one multi-sheet Excel workbook' })
  async workbook(
    @CurrentUser() user: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { fromDate, toDate } = await this.svc.resolveRange(user.tenantId, from, to);
    const buf = await this.svc.buildWorkbook(user.tenantId, fromDate, toDate);
    res!.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res!.setHeader('Content-Disposition', `attachment; filename="WFM_full_report_${fromDate}_${toDate}.xlsx"`);
    return res!.send(buf);
  }

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

  /** Requests & approvals report — JSON preview + CSV export */
  @Get('requests')
  @ApiOperation({ summary: 'Requests & approvals report' })
  async requests(
    @CurrentUser() user: any,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
    @Query('status') status?: string,
    @Query('type')   type?: string,
    @Query('format') format?: string,
    @Query('limit')  limitQ?: string,
    @Query('offset') offsetQ?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const tid    = user.tenantId;
    const limit  = format === 'csv' ? 5000 : parseInt(limitQ ?? '100', 10);
    const offset = parseInt(offsetQ ?? '0', 10);
    const toDate   = to   ?? new Date().toISOString().slice(0, 10);
    const fromDate = from ?? toDate.slice(0, 7) + '-01';

    const params: any[] = [tid, fromDate, toDate];
    const conds: string[] = [];
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`); }
    if (type)   { params.push(type);   conds.push(`rt.code = $${params.length}`); }
    const extra = conds.length ? 'AND ' + conds.join(' AND ') : '';

    // Status breakdown (for summary chips)
    const breakdown = await this.ds.query(
      `SELECT r.status, COUNT(*) AS cnt FROM requests r
       WHERE r.tenant_id=$1 AND r.submitted_at::date BETWEEN $2 AND $3
       GROUP BY r.status`, [tid, fromDate, toDate],
    );

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id=$1 AND r.submitted_at::date BETWEEN $2 AND $3 ${extra}`, params,
    );

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT r.submitted_at, r.status, r.is_urgent, r.sla_due_at, r.rejection_reason,
              rt.code AS type_code, rt.name AS type_name,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE r.tenant_id=$1 AND r.submitted_at::date BETWEEN $2 AND $3 ${extra}
       ORDER BY r.submitted_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );

    const mapped = rows.map((r: any) => ({
      submittedAt:  r.submitted_at,
      employeeNo:   r.employee_no,
      employeeName: r.employee_name?.trim(),
      function:     r.function_name,
      type:         r.type_name,
      typeCode:     r.type_code,
      status:       r.status,
      urgent:       r.is_urgent,
      slaDue:       r.sla_due_at,
      reason:       r.rejection_reason,
    }));

    if (format === 'csv') {
      const headers = ['Submitted','Emp#','Name','Function','Type','Status','Urgent','SLA Due','Reason'];
      const csvRows = mapped.map(r => [
        r.submittedAt ? new Date(r.submittedAt).toISOString().slice(0, 16).replace('T', ' ') : '',
        r.employeeNo ?? '', `"${r.employeeName ?? ''}"`, `"${r.function ?? ''}"`,
        `"${r.type ?? ''}"`, r.status, r.urgent ? 'Yes' : 'No',
        r.slaDue ? new Date(r.slaDue).toISOString().slice(0, 16).replace('T', ' ') : '',
        `"${(r.reason ?? '').replace(/"/g, '""')}"`,
      ].join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="requests_${fromDate}_${toDate}.csv"`);
      return res!.send('﻿' + csv);
    }

    const statusBreakdown: Record<string, number> = {};
    for (const b of breakdown) statusBreakdown[b.status] = parseInt(b.cnt, 10);
    return { total: parseInt(total, 10), period: { from: fromDate, to: toDate }, limit, offset, statusBreakdown, data: mapped };
  }

  /** Cross-skill coverage moves report — who covered which function/gap, when */
  @Get('cross-skill')
  @ApiOperation({ summary: 'Cross-skill coverage dispatch report' })
  async crossSkill(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to')   to?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const tid = user.tenantId;
    const toDate   = to   ?? new Date().toISOString().slice(0, 10);
    const fromDate = from ?? toDate.slice(0, 7) + '-01';

    const rows = await this.ds.query(
      `SELECT m.start_at, m.end_at, m.from_function, m.to_function, m.status, m.reason,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              ru.username AS requested_by, au.username AS approved_by
       FROM cross_skill_moves m
       LEFT JOIN employees e ON e.id = m.employee_id
       LEFT JOIN users ru ON ru.id = m.requested_by
       LEFT JOIN users au ON au.id = m.approved_by
       WHERE m.tenant_id = $1 AND m.start_at::date BETWEEN $2 AND $3
       ORDER BY m.start_at DESC`,
      [tid, fromDate, toDate],
    ).catch(() => []);

    const mapped = rows.map((r: any) => ({
      startAt: r.start_at, endAt: r.end_at,
      employeeNo: r.employee_no, employeeName: r.employee_name?.trim(),
      fromFunction: r.from_function, toFunction: r.to_function,
      status: r.status, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by,
    }));

    if (format === 'csv') {
      const headers = ['Start', 'End', 'Emp#', 'Name', 'From', 'To', 'Status', 'Requested By', 'Approved By', 'Reason'];
      const csvRows = mapped.map(r => [
        r.startAt ? new Date(r.startAt).toISOString().slice(0, 16).replace('T', ' ') : '',
        r.endAt ? new Date(r.endAt).toISOString().slice(0, 16).replace('T', ' ') : '',
        r.employeeNo ?? '', `"${r.employeeName ?? ''}"`, `"${r.fromFunction ?? ''}"`, `"${r.toFunction ?? ''}"`,
        r.status, `"${r.requestedBy ?? ''}"`, `"${r.approvedBy ?? ''}"`, `"${(r.reason ?? '').replace(/"/g, '""')}"`,
      ].join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="cross_skill_${fromDate}_${toDate}.csv"`);
      return res!.send('﻿' + csv);
    }
    return { total: mapped.length, period: { from: fromDate, to: toDate }, data: mapped };
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
