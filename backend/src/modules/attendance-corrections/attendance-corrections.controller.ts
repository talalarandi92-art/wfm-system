import {
  Controller, Get, Post, Param, Body, Query, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Attendance Correction requests (Phase-1 new type).
 * Fix missing/incorrect fingerprint or system login times. On approval the
 * correction is applied to attendance_records and audited.
 */
@ApiTags('Attendance Corrections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'attendance-corrections', version: '1' })
export class AttendanceCorrectionsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Columns on attendance_records that a correction may set (whitelist — safe to interpolate).
  private static FIELDS = new Set(['punch_in', 'punch_out', 'system_login', 'system_logout']);

  /* ── Create ───────────────────────────────────────────────────────────── */
  @Post()
  @ApiOperation({ summary: 'Submit an attendance correction request' })
  async create(@CurrentUser() user: any, @Body() body: any) {
    const tid = user.tenantId;
    if (!body.employeeId || !body.attendanceDate || !body.correctionType || !body.reason) {
      throw new BadRequestException('employeeId, attendanceDate, correctionType, reason مطلوبة');
    }
    if (body.field && !AttendanceCorrectionsController.FIELDS.has(body.field)) {
      throw new BadRequestException('حقل غير مسموح');
    }

    const [rt] = await this.ds.query(
      `SELECT id, sla_hours FROM request_types WHERE tenant_id = $1 AND code = 'attendance_correction'`,
      [tid],
    );
    if (!rt) throw new BadRequestException("نوع 'attendance_correction' غير موجود — شغّل migration 025");

    const [req] = await this.ds.query(
      `INSERT INTO requests
         (tenant_id, request_type_id, requester_id, employee_id, status, notes,
          sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'pending', $5, NOW() + ($6 || ' hours')::interval, NOW(), NOW(), NOW())
       RETURNING id`,
      [tid, rt.id, user.id, body.employeeId, body.notes ?? null, rt.sla_hours],
    );

    await this.ds.query(
      `INSERT INTO request_attendance_corrections
         (request_id, attendance_date, correction_type, field, requested_value, current_value, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.id, body.attendanceDate, body.correctionType, body.field ?? null,
       body.requestedValue || null, body.currentValue || null, body.reason],
    );

    return { id: req.id, status: 'pending' };
  }

  /* ── List ─────────────────────────────────────────────────────────────── */
  @Get()
  @ApiOperation({ summary: 'List attendance correction requests' })
  async list(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    const params: any[] = [user.tenantId];
    const conds: string[] = [];
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`); }
    if (from)   { params.push(from);   conds.push(`ac.attendance_date >= $${params.length}`); }
    if (to)     { params.push(to);     conds.push(`ac.attendance_date <= $${params.length}`); }
    const where = conds.length ? 'AND ' + conds.join(' AND ') : '';

    const rows = await this.ds.query(
      `SELECT r.id, r.status, r.submitted_at, r.notes, r.rejection_reason,
              ac.attendance_date, ac.correction_type, ac.field, ac.requested_value,
              ac.current_value, ac.reason, ac.applied, ac.applied_at,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name
       FROM requests r
       JOIN request_attendance_corrections ac ON ac.request_id = r.id
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE r.tenant_id = $1 ${where}
       ORDER BY r.submitted_at DESC
       LIMIT 500`,
      params,
    ).catch(() => []);

    return rows.map((r: any) => ({
      id:             r.id,
      status:         r.status,
      submittedAt:    r.submitted_at,
      employeeNo:     r.employee_no,
      employeeName:   (r.employee_name ?? '').trim(),
      function:       r.function_name,
      attendanceDate: String(r.attendance_date).slice(0, 10),
      correctionType: r.correction_type,
      field:          r.field,
      requestedValue: r.requested_value ? String(r.requested_value).slice(0, 5) : null,
      currentValue:   r.current_value ? String(r.current_value).slice(0, 5) : null,
      reason:         r.reason,
      applied:        r.applied,
      appliedAt:      r.applied_at,
      rejectionReason:r.rejection_reason,
    }));
  }

  /* ── Approve + apply to attendance_records ────────────────────────────── */
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a correction and apply it to attendance' })
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    const tid = user.tenantId;
    const [row] = await this.ds.query(
      `SELECT r.id, r.status, r.employee_id, ac.attendance_date, ac.field, ac.requested_value, ac.current_value
       FROM requests r JOIN request_attendance_corrections ac ON ac.request_id = r.id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [id, tid],
    );
    if (!row) throw new NotFoundException('Correction not found');
    if (['approved', 'rejected', 'cancelled'].includes(row.status)) {
      throw new BadRequestException(`Request already ${row.status}`);
    }

    let applied = false;
    if (row.field && AttendanceCorrectionsController.FIELDS.has(row.field) && row.requested_value) {
      const col  = row.field;                                  // whitelisted column
      const date = String(row.attendance_date).slice(0, 10);   // YYYY-MM-DD
      const time = String(row.requested_value).slice(0, 8);    // HH:MM[:SS]
      // Set the column to a Kuwait-local timestamp built from the date + corrected time.
      await this.ds.query(
        `UPDATE attendance_records
            SET ${col} = (($1::text || ' ' || $2::text)::timestamp AT TIME ZONE 'Asia/Kuwait'),
                is_missing_punch  = CASE WHEN $3 IN ('punch_in','punch_out')         THEN FALSE ELSE is_missing_punch  END,
                is_missing_system = CASE WHEN $3 IN ('system_login','system_logout') THEN FALSE ELSE is_missing_system END,
                updated_at = NOW()
          WHERE tenant_id = $4 AND employee_id = $5 AND attendance_date = $1::date`,
        [date, time, col, tid, row.employee_id],
      );
      applied = true;
      await this.ds.query(
        `UPDATE request_attendance_corrections SET applied = TRUE, applied_at = NOW() WHERE request_id = $1`,
        [id],
      );
    }

    await this.ds.query(
      `UPDATE requests SET status = 'approved', approved_l1_at = NOW(), current_approver_id = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tid],
    );

    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value, notes)
       VALUES ($1,$2,$3,'request.attendance_correction.approved','requests','request',$4,$5,$6)`,
      [tid, user.id, user.email ?? null, id,
       JSON.stringify({ field: row.field, value: row.requested_value, date: String(row.attendance_date).slice(0, 10), applied }),
       applied ? 'Applied to attendance_records' : 'Approved (no field to apply)'],
    ).catch(() => {});

    return { id, status: 'approved', applied };
  }

  /* ── Reject ───────────────────────────────────────────────────────────── */
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a correction' })
  async reject(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    await this.ds.query(
      `UPDATE requests SET status = 'rejected', rejected_at = NOW(), rejected_by = $3,
              rejection_reason = $4, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('approved','rejected','cancelled')`,
      [id, user.tenantId, user.id, body?.reason ?? null],
    );
    return { id, status: 'rejected' };
  }
}
