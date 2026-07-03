import {
  Controller, Get, Post, Param, Body, Query, UseGuards, BadRequestException, NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Schedule Change requests (Phase-1 new type).
 * Agent/TL requests changing a shift on a date. On approval the new shift's
 * times are applied to attendance_records (the canonical scheduled-shift store).
 */
@ApiTags('Schedule Changes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('requests.view_own')   // agents submit + see own; team/all view & approval relaxed/raised per method
@Controller({ path: 'schedule-changes', version: '1' })
export class ScheduleChangesController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Saturday that starts the week containing `dateStr` (workforce week = Sat→Fri). */
  private weekStartFor(dateStr: string): string {
    const d = new Date(dateStr);
    const diffToSat = (d.getDay() - 6 + 7) % 7;
    const sat = new Date(d);
    sat.setDate(d.getDate() - diffToSat);
    return `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
  }

  /** Locked-week + approved-range soft-lock guard (mirrors recon.controller.assertScheduleEditable). */
  private async assertScheduleEditable(user: any, date: string) {
    // Hard lock: the week's publish/lock lifecycle status
    const ws = this.weekStartFor(date);
    const [wk] = await this.ds.query(
      `SELECT status FROM schedule_week_status WHERE tenant_id = $1 AND week_start = $2::date`,
      [user.tenantId, ws],
    ).catch(() => [null]);
    if (wk?.status === 'locked') {
      throw new ForbiddenException(`Schedule week ${ws} is locked — unlock it before applying schedule changes`);
    }
    // Soft lock: the approved roster range (tenant_settings 'schedule_lock', set on upload)
    const [r] = await this.ds.query(
      `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'schedule_lock'`,
      [user.tenantId],
    ).catch(() => [null]);
    const v = r?.setting_value;
    const lock = v ? (typeof v === 'string' ? JSON.parse(v) : v) : null;
    const locked = !!lock && date >= lock.from && date <= lock.to;
    const perms = user.permissionCodes ?? user.permissions ?? [];
    if (locked && !perms.includes('schedule.publish')) {
      throw new ForbiddenException(
        `Schedule ${date} is inside the approved/locked range (${lock.from} → ${lock.to}). Manual edits are not allowed — re-upload the schedule to change it (a supervisor with schedule.publish may override, with audit).`,
      );
    }
  }

  /* ── Create ───────────────────────────────────────────────────────────── */
  @Post()
  @RequirePermissions('requests.create')
  @ApiOperation({ summary: 'Submit a schedule change request' })
  async create(@CurrentUser() user: any, @Body() body: any) {
    const tid = user.tenantId;
    if (!body.employeeId || !body.changeDate || !body.requestedShiftCode || !body.reason) {
      throw new BadRequestException('employeeId, changeDate, requestedShiftCode, reason مطلوبة');
    }

    const [rt] = await this.ds.query(
      `SELECT id, sla_hours FROM request_types WHERE tenant_id = $1 AND code = 'schedule_change'`,
      [tid],
    );
    if (!rt) throw new BadRequestException("نوع 'schedule_change' غير موجود — شغّل migration 026");

    // Derive current shift from attendance_records if not supplied.
    let current = body.currentShiftCode ?? null;
    if (!current) {
      const [ar] = await this.ds.query(
        `SELECT to_char(scheduled_start,'HH24:MI') AS s, to_char(scheduled_end,'HH24:MI') AS e
         FROM attendance_records WHERE tenant_id=$1 AND employee_id=$2 AND attendance_date=$3`,
        [tid, body.employeeId, body.changeDate],
      ).catch(() => [null]);
      if (ar?.s) current = `${ar.s}-${ar.e}`;
    }

    const [req] = await this.ds.query(
      `INSERT INTO requests
         (tenant_id, request_type_id, requester_id, employee_id, status, notes,
          sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'pending',$5, NOW() + ($6 || ' hours')::interval, NOW(), NOW(), NOW())
       RETURNING id`,
      [tid, rt.id, user.id, body.employeeId, body.notes ?? null, rt.sla_hours],
    );

    await this.ds.query(
      `INSERT INTO request_schedule_changes
         (request_id, change_date, current_shift_code, requested_shift_code, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.id, body.changeDate, current, body.requestedShiftCode, body.reason],
    );

    return { id: req.id, status: 'pending' };
  }

  /* ── List ─────────────────────────────────────────────────────────────── */
  @Get()
  @ApiOperation({ summary: 'List schedule change requests' })
  async list(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    const params: any[] = [user.tenantId];
    const conds: string[] = [];
    // Self-scope: only team/all viewers see everyone; agents see their own rows.
    const perms = user.permissionCodes ?? user.permissions ?? [];
    const canSeeAll = perms.includes('requests.view_team') || perms.includes('requests.view_all');
    if (!canSeeAll) {
      params.push(user.employeeId ?? '00000000-0000-0000-0000-000000000000');
      conds.push(`r.employee_id = $${params.length}`);
    }
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`); }
    if (from)   { params.push(from);   conds.push(`sc.change_date >= $${params.length}`); }
    if (to)     { params.push(to);     conds.push(`sc.change_date <= $${params.length}`); }
    const where = conds.length ? 'AND ' + conds.join(' AND ') : '';

    const rows = await this.ds.query(
      `SELECT r.id, r.status, r.submitted_at, r.rejection_reason,
              sc.change_date, sc.current_shift_code, sc.requested_shift_code, sc.reason, sc.applied,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name
       FROM requests r
       JOIN request_schedule_changes sc ON sc.request_id = r.id
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE r.tenant_id = $1 ${where}
       ORDER BY r.submitted_at DESC
       LIMIT 500`,
      params,
    ).catch(() => []);

    return rows.map((r: any) => ({
      id:               r.id,
      status:           r.status,
      submittedAt:      r.submitted_at,
      employeeNo:       r.employee_no,
      employeeName:     (r.employee_name ?? '').trim(),
      function:         r.function_name,
      changeDate:       String(r.change_date).slice(0, 10),
      currentShiftCode: r.current_shift_code,
      requestedShiftCode: r.requested_shift_code,
      reason:           r.reason,
      applied:          r.applied,
      rejectionReason:  r.rejection_reason,
    }));
  }

  /* ── Approve + apply to attendance_records (scheduled shift) ───────────── */
  @Post(':id/approve')
  @RequirePermissions('requests.approve_l1')
  @ApiOperation({ summary: 'Approve a schedule change and apply it' })
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    const tid = user.tenantId;
    const [row] = await this.ds.query(
      `SELECT r.id, r.status, r.employee_id, sc.change_date, sc.requested_shift_code
       FROM requests r JOIN request_schedule_changes sc ON sc.request_id = r.id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [id, tid],
    );
    if (!row) throw new NotFoundException('Schedule change not found');
    if (['approved', 'rejected', 'cancelled'].includes(row.status)) {
      throw new BadRequestException(`Request already ${row.status}`);
    }

    // Resolve the requested shift code → times (NULL for OFF/leave codes).
    const [sc] = await this.ds.query(
      `SELECT start_time, end_time FROM shift_codes WHERE tenant_id = $1 AND code = $2`,
      [tid, row.requested_shift_code],
    ).catch(() => [null]);
    const start = sc?.start_time ?? null;
    const end   = sc?.end_time ?? null;
    const marker = start ? 'present' : 'off';
    const date = String(row.change_date).slice(0, 10);

    // Lock enforcement: locked week + approved-range soft lock (same rule as manual cell edits)
    await this.assertScheduleEditable(user, date);

    // Upsert the scheduled shift for that employee/date.
    const updated = await this.ds.query(
      `UPDATE attendance_records
          SET scheduled_start = $3, scheduled_end = $4, attendance_marker = $5::attendance_marker_enum, updated_at = NOW()
        WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date = $6::date
        RETURNING employee_id`,
      [tid, row.employee_id, start, end, marker, date],
    ).catch(() => []);
    if (!updated.length) {
      await this.ds.query(
        `INSERT INTO attendance_records
           (tenant_id, employee_id, attendance_date, attendance_marker, scheduled_start, scheduled_end)
         VALUES ($1,$2,$3::date,$4::attendance_marker_enum,$5,$6)`,
        [tid, row.employee_id, date, marker, start, end],
      ).catch(() => {});
    }

    await this.ds.query(
      `UPDATE request_schedule_changes SET applied = TRUE, applied_at = NOW() WHERE request_id = $1`, [id],
    );
    await this.ds.query(
      `UPDATE requests SET status = 'approved', approved_l1_at = NOW(), current_approver_id = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tid],
    );
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value, notes)
       VALUES ($1,$2,$3,'request.schedule_change.approved','requests','request',$4,$5,'Applied to attendance_records')`,
      [tid, user.id, user.email ?? null, id,
       JSON.stringify({ date, shift: row.requested_shift_code, start, end })],
    ).catch(() => {});

    return { id, status: 'approved', applied: true, shift: row.requested_shift_code };
  }

  /* ── Reject ───────────────────────────────────────────────────────────── */
  @Post(':id/reject')
  @RequirePermissions('requests.approve_l1')
  @ApiOperation({ summary: 'Reject a schedule change' })
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
