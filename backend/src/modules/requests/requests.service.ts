import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { LeaveBalancesService } from '@modules/leave-balances/leave-balances.service';
import {
  CreateShiftSwapDto,
  CreateLeaveDto,
  CreateOvertimeDto,
  CreateBreakDto,
  PeerRespondDto,
  ApproveRejectDto,
  SwapValidation,
  ShiftInfo,
} from './requests.types';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *  Correct column names from DB:
 *  requests: employee_id, requester_id, approver_l1_id, approver_l2_id,
 *            approved_l1_at, approved_l2_at, rejected_at, rejected_by,
 *            rejection_reason, sla_due_at, submitted_at, hc_impact, is_urgent
 *  shift_codes: code, description, description_ar, allows_female
 *  functions: name, name_ar  (NOT name_en)
 *  teams: name, name_ar
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

@Injectable()
export class RequestsService {
  constructor(
    private readonly ds: DataSource,
    private readonly leaveBalances: LeaveBalancesService,
  ) {}

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  TIME HELPERS
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private parseTimeMin(t: string): number {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  private restMinutes(prevEnd: string, nextStart: string): number {
    let prev = this.parseTimeMin(prevEnd);
    let next = this.parseTimeMin(nextStart);
    if (next <= prev) next += 24 * 60;
    return next - prev;
  }

  private isMidnightShift(start: string | null): boolean {
    if (!start) return false;
    const h = parseInt(start.split(':')[0] ?? '0');
    return h >= 22 || h < 5;
  }

  private isNightShift(start: string | null): boolean {
    if (!start) return false;
    const h = parseInt(start.split(':')[0] ?? '0');
    return h >= 18 || h < 5;
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  SHIFT INFO
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private async getShiftInfo(
    tenantId: string,
    employeeId: string,
    dateStr: string,
  ): Promise<ShiftInfo | null> {
    const rows = await this.ds.query(
      `SELECT ar.scheduled_start, ar.scheduled_end,
              e.first_name_en || ' ' || e.last_name_en AS employee_name,
              e.gender, e.function_id,
              f.name AS function_name,
              sc.code AS shift_code,
              ar.attendance_date
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id AND e.tenant_id = ar.tenant_id
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       WHERE ar.tenant_id = $1
         AND ar.employee_id = $2
         AND ar.attendance_date::date = $3::date
       LIMIT 1`,
      [tenantId, employeeId, dateStr],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      employeeId,
      employeeName: r.employee_name,
      gender: r.gender,
      functionId: r.function_id,
      functionName: r.function_name ?? 'غير محدد',
      date: dateStr,
      scheduledStart: r.scheduled_start,
      scheduledEnd: r.scheduled_end,
      shiftCode: r.shift_code,
      isNightShift: this.isNightShift(r.scheduled_start),
      isMidnightShift: this.isMidnightShift(r.scheduled_start),
    };
  }

  private async getShiftCodeId(tenantId: string, code: string | null): Promise<string | null> {
    if (!code) return null;
    const r = await this.ds.query(
      `SELECT id FROM shift_codes WHERE code = $1 AND tenant_id = $2 LIMIT 1`,
      [code, tenantId],
    );
    return r.length ? r[0].id : null;
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  SWAP VALIDATION
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private async validateSwap(
    tenantId: string,
    requesterInfo: ShiftInfo,
    targetInfo: ShiftInfo,
  ): Promise<SwapValidation> {
    const result: SwapValidation = {
      restCheckPassed: true,
      genderCheckPassed: true,
      coverageCheckPassed: true,
    };

    // Gender rule: female can't take midnight shift (after swap)
    if (requesterInfo.gender === 'female' && targetInfo.isMidnightShift) {
      result.genderCheckPassed = false;
      result.genderWarning = `${requesterInfo.employeeName} (أنثى) لا يمكنها أخذ شيفت منتصف الليل`;
    }
    if (targetInfo.gender === 'female' && requesterInfo.isMidnightShift) {
      result.genderCheckPassed = false;
      result.genderWarning = (result.genderWarning ? result.genderWarning + ' | ' : '')
        + `${targetInfo.employeeName} (أنثى) لا يمكنها أخذ شيفت منتصف الليل`;
    }

    // Rest check â€” after swap, requester gets target's shift times
    const newReqStart = targetInfo.scheduledStart;
    const newReqEnd   = targetInfo.scheduledEnd;
    const newTgtStart = requesterInfo.scheduledStart;
    const newTgtEnd   = requesterInfo.scheduledEnd;

    // Adjacent shifts for requester
    const reqPrevEnd = await this.getAdjacentEnd(tenantId, requesterInfo.employeeId, requesterInfo.date);
    const reqNextStart = await this.getAdjacentStart(tenantId, requesterInfo.employeeId, requesterInfo.date);

    if (reqPrevEnd && newReqStart) {
      const rest = this.restMinutes(reqPrevEnd, newReqStart);
      if (rest < 600) {
        result.restCheckPassed = false;
        result.restWarning = `${requesterInfo.employeeName}: راحة قبل الشيفت الجديد ${Math.round(rest / 60)}س (الحد 10س)`;
      }
    }
    if (newReqEnd && reqNextStart) {
      const rest = this.restMinutes(newReqEnd, reqNextStart);
      if (rest < 600) {
        result.restCheckPassed = false;
        result.restWarning = (result.restWarning ?? '') + ` | ${requesterInfo.employeeName}: راحة بعد الشيفت ${Math.round(rest / 60)}س`;
      }
    }

    // Adjacent shifts for target
    const tgtPrevEnd = await this.getAdjacentEnd(tenantId, targetInfo.employeeId, targetInfo.date);
    const tgtNextStart = await this.getAdjacentStart(tenantId, targetInfo.employeeId, targetInfo.date);

    if (tgtPrevEnd && newTgtStart) {
      const rest = this.restMinutes(tgtPrevEnd, newTgtStart);
      if (rest < 600) {
        result.restCheckPassed = false;
        result.restWarning = (result.restWarning ?? '') + ` | ${targetInfo.employeeName}: راحة قبل الشيفت الجديد ${Math.round(rest / 60)}س`;
      }
    }
    if (newTgtEnd && tgtNextStart) {
      const rest = this.restMinutes(newTgtEnd, tgtNextStart);
      if (rest < 600) {
        result.restCheckPassed = false;
        result.restWarning = (result.restWarning ?? '') + ` | ${targetInfo.employeeName}: راحة بعد الشيفت ${Math.round(rest / 60)}س`;
      }
    }

    // Coverage check â€” warn if function HC is thin
    const reqDateHc = await this.getDateHc(tenantId, requesterInfo.functionId, requesterInfo.date);
    const tgtDateHc = await this.getDateHc(tenantId, targetInfo.functionId, targetInfo.date);
    if (reqDateHc <= 1 || tgtDateHc <= 1) {
      result.coverageCheckPassed = false;
      result.coverageWarning = 'تحذير: قد يتأثر التغطية في أحد التواريخ بسبب محدودية الموظفين';
    }

    return result;
  }

  private async getAdjacentEnd(tenantId: string, empId: string, dateStr: string): Promise<string | null> {
    const r = await this.ds.query(
      `SELECT scheduled_end FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2
         AND attendance_date::date < $3::date AND scheduled_end IS NOT NULL
       ORDER BY attendance_date DESC LIMIT 1`,
      [tenantId, empId, dateStr],
    );
    return r.length ? r[0].scheduled_end : null;
  }

  private async getAdjacentStart(tenantId: string, empId: string, dateStr: string): Promise<string | null> {
    const r = await this.ds.query(
      `SELECT scheduled_start FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2
         AND attendance_date::date > $3::date AND scheduled_start IS NOT NULL
       ORDER BY attendance_date ASC LIMIT 1`,
      [tenantId, empId, dateStr],
    );
    return r.length ? r[0].scheduled_start : null;
  }

  private async getDateHc(tenantId: string, functionId: string, dateStr: string): Promise<number> {
    const r = await this.ds.query(
      `SELECT COUNT(*) AS cnt FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       WHERE ar.tenant_id = $1 AND e.function_id = $2
         AND ar.attendance_date::date = $3::date AND ar.scheduled_start IS NOT NULL`,
      [tenantId, functionId, dateStr],
    );
    return parseInt(r[0]?.cnt ?? '0');
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  RESOLVE requester_id (users FK)
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private async resolveRequesterId(tenantId: string, employeeId: string): Promise<string> {
    const linked = await this.ds.query(
      `SELECT id FROM users WHERE employee_id = $1 AND tenant_id = $2 LIMIT 1`,
      [employeeId, tenantId],
    );
    if (linked.length) return linked[0].id;
    const admin = await this.ds.query(
      `SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    return admin[0]?.id ?? 'd0000000-0000-0000-0000-000000000001';
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  STATS
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async getStats(tenantId: string) {
    const r = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'peer_pending')::int AS peer_pending,
         COUNT(*) FILTER (WHERE status = 'approved' AND approved_l1_at >= NOW() - INTERVAL '7 days')::int AS approved_week,
         COUNT(*) FILTER (WHERE status = 'rejected' AND rejected_at >= NOW() - INTERVAL '7 days')::int AS rejected_week,
         COUNT(*) FILTER (WHERE status IN ('pending','peer_pending') AND sla_due_at < NOW())::int AS overdue
       FROM requests WHERE tenant_id = $1`,
      [tenantId],
    );
    return r[0] ?? { pending: 0, peer_pending: 0, approved_week: 0, rejected_week: 0, overdue: 0 };
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  UNIFIED LIST
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async listAll(tenantId: string, filters: {
    status?: string; type?: string; employeeId?: string;
    page?: number; limit?: number;
  }) {
    const page   = Math.max(filters.page ?? 1, 1);  // clamp to min 1 â€” controller may pass 0
    const limit  = filters.limit ?? 30;
    const offset = (page - 1) * limit;
    const params: any[] = [tenantId];
    let pi = 2;
    const conds: string[] = [`r.tenant_id = $1`];

    if (filters.status) { conds.push(`r.status = $${pi++}`); params.push(filters.status); }
    if (filters.type)   { conds.push(`rt.code  = $${pi++}`); params.push(filters.type);   }
    if (filters.employeeId) { conds.push(`e.id = $${pi++}`); params.push(filters.employeeId); }

    const where = conds.join(' AND ');

    const rows = await this.ds.query(
      `SELECT
         r.id, r.status, r.notes, r.submitted_at,
         r.approved_l1_at, r.approved_l2_at, r.rejected_at, r.rejection_reason,
         r.is_urgent, r.sla_due_at,
         rt.code AS type_code, rt.name_ar AS type_name_ar,
         e.first_name_en || ' ' || e.last_name_en AS requester_name,
         e.employee_no AS requester_employee_no,
         f.name AS requester_function,
         -- Permission
         rp.permission_date, rp.start_time AS perm_start, rp.end_time AS perm_end,
         rp.duration_minutes, rp.reason AS perm_reason,
         -- Swap
         rss.swap_type, rss.requester_date, rss.target_date,
         rss.peer_accepted_at, rss.peer_rejected_at, rss.peer_rejection_reason,
         rss.coverage_check_passed, rss.rest_check_passed, rss.gender_check_passed,
         req_sc.code AS requester_shift_code,
         tgt_sc.code AS target_shift_code,
         te.first_name_en || ' ' || te.last_name_en AS target_name,
         -- Leave
         rl.leave_type, rl.start_date AS leave_start, rl.end_date AS leave_end,
         rl.duration_days, rl.is_half_day, rl.medical_certificate_required,
         rl.attachment_submitted,
         -- Break
         rb.break_date, rb.start_time AS break_start, rb.end_time AS break_end,
         rb.duration_minutes AS break_minutes, rb.break_type, rb.reason AS break_reason,
         -- Attachments count
         (SELECT COUNT(*)::int FROM attachments a
            WHERE a.entity_type = 'request' AND a.entity_id = r.id) AS attachment_count
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN request_permissions rp ON rp.request_id = r.id
       LEFT JOIN request_shift_swaps rss ON rss.request_id = r.id
       LEFT JOIN shift_codes req_sc ON req_sc.id = rss.requester_shift_code_id
       LEFT JOIN shift_codes tgt_sc ON tgt_sc.id = rss.target_shift_code_id
       LEFT JOIN employees te ON te.id = rss.target_employee_id
       LEFT JOIN request_leaves rl ON rl.request_id = r.id
       LEFT JOIN request_breaks rb ON rb.request_id = r.id
       WHERE ${where}
       ORDER BY r.submitted_at DESC NULLS LAST, r.created_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, limit, offset],
    );

    const countRow = await this.ds.query(
      `SELECT COUNT(*) AS cnt
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       JOIN employees e ON e.id = r.employee_id
       WHERE ${where}`,
      params,
    );

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        type: r.type_code,
        typeNameAr: r.type_name_ar,
        status: r.status,
        isUrgent: r.is_urgent,
        slaDueAt: r.sla_due_at,
        requesterName: r.requester_name,
        requesterEmployeeNo: r.requester_employee_no,
        requesterFunction: r.requester_function ?? 'â€”',
        submittedAt: r.submitted_at,
        notes: r.notes,
        // Permission
        permissionDate: r.permission_date,
        permissionStart: r.perm_start,
        permissionEnd: r.perm_end,
        permissionDuration: r.duration_minutes,
        permissionReason: r.perm_reason,
        // Swap
        swapType: r.swap_type,
        requesterDate: r.requester_date,
        requesterShift: r.requester_shift_code,
        targetName: r.target_name,
        targetDate: r.target_date,
        targetShift: r.target_shift_code,
        peerAcceptedAt: r.peer_accepted_at,
        peerRejectedAt: r.peer_rejected_at,
        peerRejectionReason: r.peer_rejection_reason,
        coverageCheckPassed: r.coverage_check_passed,
        restCheckPassed: r.rest_check_passed,
        genderCheckPassed: r.gender_check_passed,
        // Leave
        leaveType: r.leave_type,
        leaveStart: r.leave_start,
        leaveEnd: r.leave_end,
        leaveDays: r.duration_days,
        isHalfDay: r.is_half_day,
        medicalCertRequired: r.medical_certificate_required,
        attachmentSubmitted: r.attachment_submitted,
        attachmentCount: r.attachment_count ?? 0,
        // Break
        breakDate: r.break_date,
        breakStart: r.break_start,
        breakEnd: r.break_end,
        breakMinutes: r.break_minutes,
        breakType: r.break_type,
        breakReason: r.break_reason,
        // Approval
        approvedL1At: r.approved_l1_at,
        approvedL2At: r.approved_l2_at,
        rejectedAt: r.rejected_at,
        rejectionReason: r.rejection_reason,
      })),
      total: parseInt(countRow[0]?.cnt ?? '0'),
    };
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  EMPLOYEES LIST
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async getEmployees(tenantId: string, search?: string) {
    const params: any[] = [tenantId];
    let searchClause = '';
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      searchClause = `AND (LOWER(e.first_name_en || ' ' || e.last_name_en) LIKE $2 OR LOWER(e.employee_no) LIKE $2)`;
    }
    return this.ds.query(
      `SELECT e.id, e.employee_no, e.gender,
              e.first_name_en || ' ' || e.last_name_en AS full_name,
              f.name AS function_name, f.id AS function_id,
              t.name AS team_name
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN teams t ON t.id = e.team_id
       WHERE e.tenant_id = $1 AND e.status = 'active' ${searchClause}
       ORDER BY e.first_name_en
       LIMIT 100`,
      params,
    );
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  SWAP CANDIDATES
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async getSwapCandidates(tenantId: string, employeeId: string, date: string) {
    const funcRow = await this.ds.query(
      `SELECT function_id FROM employees WHERE id = $1 AND tenant_id = $2`,
      [employeeId, tenantId],
    );
    const funcId = funcRow[0]?.function_id ?? null;

    return this.ds.query(
      `SELECT e.id, e.employee_no, e.gender,
              e.first_name_en || ' ' || e.last_name_en AS full_name,
              f.name AS function_name,
              ar.scheduled_start, ar.scheduled_end,
              sc.code AS shift_code,
              CASE WHEN e.function_id = $3 THEN true ELSE false END AS same_function
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       WHERE ar.tenant_id = $1
         AND ar.employee_id != $2
         AND ar.attendance_date::date = $4::date
         AND ar.scheduled_start IS NOT NULL
         AND e.status = 'active'
       ORDER BY same_function DESC, e.first_name_en
       LIMIT 60`,
      [tenantId, employeeId, funcId, date],
    );
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  CREATE SHIFT SWAP
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * Campaign blackout check — does an active campaign restrict this request type
   * on this date? Warn-only (per Ops decision): never blocks, just flags + notifies.
   */
  private async campaignBlackout(
    tenantId: string, dateStr: string, candidateCodes: string[],
  ): Promise<{ name: string; type: string } | null> {
    if (!dateStr) return null;
    const rows = await this.ds.query(
      `SELECT name, campaign_type, restricted_types FROM campaigns
        WHERE tenant_id = $1 AND is_active = TRUE AND restrict_requests = TRUE
          AND $2::date BETWEEN start_date AND end_date`,
      [tenantId, String(dateStr).slice(0, 10)],
    ).catch(() => []);
    if (!rows.length) return null;
    const norm = (s: string) => String(s).toLowerCase().replace(/_leave$/, '').replace(/_/g, '');
    const cands = candidateCodes.map(norm);
    for (const r of rows) {
      const types = (typeof r.restricted_types === 'string' ? JSON.parse(r.restricted_types) : (r.restricted_types ?? []))
        .map(norm);
      if (types.length === 0 || types.some((t: string) => cands.includes(t))) {
        return { name: r.name, type: r.campaign_type };
      }
    }
    return null;
  }

  /** Notify WFM/RTA reviewers a request was filed during a campaign window. */
  private async notifyCampaignReviewers(tenantId: string, requestId: string, body: string) {
    const reviewers = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1 AND r.code IN ('rta','wfm_analyst','wfm_supervisor','platform_admin')`,
      [tenantId],
    ).catch(() => []);
    for (const rv of reviewers) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, body, entity_type, entity_id)
         VALUES ($1, $2, 'request.campaign_blackout', $3, $4, 'request', $5)`,
        [tenantId, rv.id, 'طلب خلال فترة حملة', body, requestId],
      ).catch(() => {});
    }
  }

  async createShiftSwap(tenantId: string, dto: CreateShiftSwapDto) {
    const requesterId = await this.resolveRequesterId(tenantId, dto.requesterEmployeeId);

    const requesterInfo = await this.getShiftInfo(tenantId, dto.requesterEmployeeId, dto.requesterDate);
    const targetInfo    = await this.getShiftInfo(tenantId, dto.targetEmployeeId, dto.targetDate);

    if (!requesterInfo?.scheduledStart) {
      throw new BadRequestException(`لا يوجد شيفت للموظف الأول في ${dto.requesterDate}`);
    }
    if (!targetInfo?.scheduledStart) {
      throw new BadRequestException(`لا يوجد شيفت للموظف الثاني في ${dto.targetDate}`);
    }

    const validation = await this.validateSwap(tenantId, requesterInfo, targetInfo);

    const typeCode = dto.swapType === 'off' ? 'off_swap' : 'shift_swap';
    const rtRow = await this.ds.query(
      `SELECT id, sla_hours FROM request_types WHERE code = $1 AND tenant_id = $2`,
      [typeCode, tenantId],
    );
    if (!rtRow.length) throw new BadRequestException('نوع الطلب غير موجود');

    const reqShiftCodeId = await this.getShiftCodeId(tenantId, requesterInfo.shiftCode);
    const tgtShiftCodeId = await this.getShiftCodeId(tenantId, targetInfo.shiftCode);

    const requestId = uuid();

    // Campaign blackout (warn-only): swaps inside a restricted campaign window
    // get flagged + WFM/RTA notified.
    const blackout = await this.campaignBlackout(tenantId, dto.requesterDate, [typeCode, 'shift_swap', 'off_swap'])
      ?? await this.campaignBlackout(tenantId, dto.targetDate, [typeCode, 'shift_swap', 'off_swap']);
    const notesFinal = blackout
      ? `${dto.notes ? dto.notes + ' | ' : ''}⚠ حملة (${blackout.name}) — تحتاج مراجعة WFM`
      : (dto.notes ?? null);

    await this.ds.query(
      `INSERT INTO requests
         (id, tenant_id, request_type_id, requester_id, employee_id,
          status, notes, sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'peer_pending', $6,
               NOW() + ($7 || ' hours')::interval,
               NOW(), NOW(), NOW())`,
      [requestId, tenantId, rtRow[0].id, requesterId, dto.requesterEmployeeId,
       notesFinal, rtRow[0].sla_hours],
    );

    await this.ds.query(
      `INSERT INTO request_shift_swaps
         (request_id, swap_type, requester_date, requester_shift_code_id,
          target_employee_id, target_date, target_shift_code_id,
          coverage_check_passed, rest_check_passed, gender_check_passed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        requestId, dto.swapType, dto.requesterDate, reqShiftCodeId,
        dto.targetEmployeeId, dto.targetDate, tgtShiftCodeId,
        validation.coverageCheckPassed, validation.restCheckPassed, validation.genderCheckPassed,
      ],
    );

    if (blackout) {
      await this.notifyCampaignReviewers(
        tenantId, requestId,
        `طلب تبديل (${dto.requesterDate} ↔ ${dto.targetDate}) خلال حملة «${blackout.name}» — راجع التغطية`,
      );
    }

    return {
      id: requestId,
      status: 'peer_pending',
      campaignWarning: blackout?.name ?? null,
      validation,
      requesterShift: {
        date: dto.requesterDate,
        start: requesterInfo.scheduledStart,
        end: requesterInfo.scheduledEnd,
        code: requesterInfo.shiftCode,
        name: requesterInfo.employeeName,
      },
      targetShift: {
        date: dto.targetDate,
        start: targetInfo.scheduledStart,
        end: targetInfo.scheduledEnd,
        code: targetInfo.shiftCode,
        name: targetInfo.employeeName,
      },
      message: 'تم إرسال طلب التبادل — في انتظار موافقة ' + targetInfo.employeeName,
    };
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  PEER ACCEPT / REJECT
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  private async assertSwapTarget(tenantId: string, requestId: string, targetEmpId: string) {
    const rows = await this.ds.query(
      `SELECT rss.target_employee_id, r.status
       FROM requests r JOIN request_shift_swaps rss ON rss.request_id = r.id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('الطلب غير موجود');
    if (rows[0].target_employee_id !== targetEmpId)
      throw new BadRequestException('أنت لست الموظف المستهدف في هذا الطلب');
    if (rows[0].status !== 'peer_pending')
      throw new BadRequestException('الطلب لم يعد في انتظار موافقة الزميل');
  }

  async peerAccept(tenantId: string, requestId: string, dto: PeerRespondDto) {
    await this.assertSwapTarget(tenantId, requestId, dto.targetEmployeeId);
    await this.ds.query(
      `UPDATE request_shift_swaps SET peer_accepted_at = NOW() WHERE request_id = $1`, [requestId],
    );
    await this.ds.query(
      `UPDATE requests SET status = 'pending', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId],
    );
    return { success: true, message: 'وافقت على التبادل — الطلب الآن بانتظار WFM' };
  }

  async peerReject(tenantId: string, requestId: string, dto: PeerRespondDto) {
    await this.assertSwapTarget(tenantId, requestId, dto.targetEmployeeId);
    await this.ds.query(
      `UPDATE request_shift_swaps
       SET peer_rejected_at = NOW(), peer_rejection_reason = $2
       WHERE request_id = $1`,
      [requestId, dto.reason ?? 'رفض الموظف'],
    );
    await this.ds.query(
      `UPDATE requests SET status = 'rejected', rejected_at = NOW(),
              rejection_reason = $2, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $3`,
      [requestId, dto.reason ?? 'رفض الموظف الثاني', tenantId],
    );
    return { success: true, message: 'تم رفض طلب التبادل' };
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  APPROVE / REJECT (WFM)
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async approve(tenantId: string, requestId: string, dto: ApproveRejectDto) {
    const rows = await this.ds.query(
      `SELECT r.id, r.status, rt.code AS type_code
       FROM requests r JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('الطلب غير موجود');
    const req = rows[0];

    const isSwap = req.type_code === 'shift_swap' || req.type_code === 'off_swap';
    if (isSwap && req.status === 'peer_pending') {
      throw new BadRequestException('لم يوافق الموظف الثاني بعد على التبادل');
    }
    if (!['pending', 'peer_pending'].includes(req.status)) {
      throw new BadRequestException('الطلب ليس في انتظار الموافقة');
    }

    const approverId = await this.resolveUserIdOrNull(tenantId, dto.approverId);

    // Write the swap to the live schedule FIRST. If it throws (e.g. a missing
    // schedule row), the request stays pending rather than approved-but-unapplied.
    if (isSwap) {
      await this.applySwap(tenantId, requestId, approverId);
    }

    await this.ds.query(
      `UPDATE requests
       SET status = 'approved', approved_l1_at = NOW(),
           approver_l1_id = $2, current_approver_id = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $3`,
      [requestId, approverId, tenantId],
    );

    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'request.approved','requests','request',$3,$4)`,
      [tenantId, approverId, requestId, `Approved ${req.type_code}`],
    ).catch(() => {});

    return { success: true, message: 'تمت الموافقة على الطلب' };
  }

  async reject(tenantId: string, requestId: string, dto: ApproveRejectDto) {
    const rows = await this.ds.query(
      `SELECT id FROM requests WHERE id = $1 AND tenant_id = $2`, [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('الطلب غير موجود');

    const rejecterId = await this.resolveUserIdOrNull(tenantId, dto.approverId);

    await this.ds.query(
      `UPDATE requests
       SET status = 'rejected', rejected_at = NOW(),
           rejected_by = $2, rejection_reason = $3,
           current_approver_id = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $4`,
      [requestId, rejecterId, dto.reason ?? 'مرفوض', tenantId],
    );
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'request.rejected','requests','request',$3,$4)`,
      [tenantId, rejecterId, requestId, dto.reason ?? 'rejected'],
    ).catch(() => {});
    return { success: true, message: 'تم رفض الطلب' };
  }

  /** Cancel a request â€” only by the requesting employee, only while still pending */
  async cancel(tenantId: string, requestId: string, employeeId: string) {
    const rows = await this.ds.query(
      `SELECT id, status, employee_id FROM requests WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('الطلب غير موجود');
    const req = rows[0];

    if (req.employee_id !== employeeId) {
      throw new BadRequestException('لا يمكن إلغاء طلب موظف آخر');
    }
    if (!['pending', 'peer_pending'].includes(req.status)) {
      throw new BadRequestException('لا يمكن إلغاء طلب تمت معالجته');
    }

    await this.ds.query(
      `UPDATE requests
       SET status = 'cancelled', current_approver_id = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId],
    );
    return { success: true, message: 'تم إلغاء الطلب' };
  }

  private async resolveUserIdOrNull(tenantId: string, userId: string | undefined): Promise<string | null> {
    if (!userId) return null;
    const r = await this.ds.query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [userId, tenantId],
    );
    return r.length ? userId : null;
  }

  /**
   * Apply an approved swap to the live schedule — runs ONLY after both gates pass:
   *   1. peer_accepted_at is set (the colleague accepted), AND
   *   2. the request reached final 'approved' status (RTA/supervisor approved).
   * Swaps the two employees' full schedule tuple atomically (marker + times +
   * split-shift segment + WFH flag), appends a version-history entry into each
   * cell's notes timeline (read by getCellTimeline), writes audit_logs entries,
   * marks the swap applied, and notifies both employees.
   * Fairness stays PRE-swap (loadYtdDistribution reverses swaps).
   */
  private async applySwap(tenantId: string, requestId: string, approverUserId: string | null) {
    const swap = await this.ds.query(
      `SELECT rss.*, r.employee_id AS requester_employee_id
       FROM request_shift_swaps rss JOIN requests r ON r.id = rss.request_id
       WHERE rss.request_id = $1`,
      [requestId],
    );
    if (!swap.length) return;
    const s = swap[0];

    // Gate 1 — the colleague must have accepted (peer_accepted_at set, not rejected)
    if (!s.peer_accepted_at || s.peer_rejected_at) {
      throw new BadRequestException('لا يمكن تطبيق التبديل قبل قبول الموظف الثاني');
    }
    // OFF swaps may legitimately have one side without a target row; shift swaps need both.
    if (!s.target_employee_id) return;

    const swapType = s.swap_type === 'off' ? 'off_swap' : 'shift_swap';

    // Approver attribution for the version-history entries
    let approverEmail: string | null = null;
    if (approverUserId) {
      const ar = await this.ds
        .query(`SELECT email FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [approverUserId, tenantId])
        .catch(() => []);
      approverEmail = ar?.[0]?.email ?? null;
    }

    await this.ds.transaction(async (trx) => {
      // Lock both schedule rows for the swap dates. We swap the WHOLE scheduled
      // tuple — including attendance_marker, the split-shift 2nd segment and the
      // WFH flag — because the grid derives the displayed cell from the marker +
      // times (deriveShiftLabel), NOT from shift_code_id. Without the marker an
      // OFF↔shift swap would never visually apply.
      const cols = `id, employee_id,
                attendance_marker, scheduled_start, scheduled_end,
                scheduled_start_2, scheduled_end_2, scheduled_shift_code_id, is_wfh, notes,
                (SELECT TRIM(COALESCE(e.first_name_en,'') || ' ' || COALESCE(e.last_name_en,''))
                   FROM employees e WHERE e.id = attendance_records.employee_id) AS emp_name,
                (SELECT f.name FROM employees e LEFT JOIN functions f ON f.id = e.function_id
                   WHERE e.id = attendance_records.employee_id) AS function_name`;
      const reqRec = await trx.query(
        `SELECT ${cols} FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date::date = $3::date
         FOR UPDATE`,
        [tenantId, s.requester_employee_id, s.requester_date],
      );
      const tgtRec = await trx.query(
        `SELECT ${cols} FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date::date = $3::date
         FOR UPDATE`,
        [tenantId, s.target_employee_id, s.target_date],
      );
      if (!reqRec.length || !tgtRec.length) {
        throw new BadRequestException('سجل الجدول غير موجود لأحد الطرفين في تاريخ التبديل');
      }
      const rr = reqRec[0];
      const tr = tgtRec[0];

      // New shift-code strings (for version-history "to.code" labels)
      const codeOf = async (id: string | null): Promise<string | null> => {
        if (!id) return null;
        const r = await trx
          .query(`SELECT code FROM shift_codes WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId])
          .catch(() => []);
        return r?.[0]?.code ?? null;
      };
      const reqNewCode = await codeOf(tr.scheduled_shift_code_id); // requester receives target's shift
      const tgtNewCode = await codeOf(rr.scheduled_shift_code_id); // target receives requester's shift

      // Append a proper version-history edit into the notes JSON timeline that
      // the schedule UI reads (getCellTimeline) — never corrupt it with text.
      const buildNotes = (
        rec: any,
        from: { marker: string; start: string | null; end: string | null },
        to: { marker: string; start: string | null; end: string | null; code: string | null },
        otherName: string,
        otherDate: string,
      ): string => {
        let audit: { original?: any; edits: any[] } = { edits: [] };
        if (rec.notes) {
          try {
            const p = JSON.parse(rec.notes);
            if (p && typeof p === 'object' && Array.isArray(p.edits)) audit = p;
          } catch { /* legacy/plain notes — start a fresh audit */ }
        }
        if (!Array.isArray(audit.edits)) audit.edits = [];
        if (audit.edits.length === 0) audit.original = from;
        audit.edits.push({
          seq: audit.edits.length + 1,
          by: approverEmail ?? 'WFM',
          byId: approverUserId,
          at: new Date().toISOString(),
          from,
          to,
          type: swapType,
          reason: `تبادل ${swapType === 'off_swap' ? 'يوم راحة' : 'شيفت'} مع ${otherName} (${otherDate})`,
          sourceOfChange: 'shift_swap',
          validations: [],
          requiresApproval: false,
          employeeName: rec.emp_name,
          functionName: rec.function_name,
        });
        return JSON.stringify(audit);
      };

      const rrFrom = { marker: rr.attendance_marker, start: rr.scheduled_start, end: rr.scheduled_end };
      const trFrom = { marker: tr.attendance_marker, start: tr.scheduled_start, end: tr.scheduled_end };
      const rrNotes = buildNotes(rr, rrFrom, { ...trFrom, code: reqNewCode }, tr.emp_name, s.target_date);
      const trNotes = buildNotes(tr, trFrom, { ...rrFrom, code: tgtNewCode }, rr.emp_name, s.requester_date);

      // Atomic exchange: requester gets target's full shift tuple, and vice-versa
      const writeShift = async (id: string, src: any, notes: string) =>
        trx.query(
          `UPDATE attendance_records
           SET scheduled_start = $1, scheduled_end = $2,
               scheduled_start_2 = $3, scheduled_end_2 = $4,
               scheduled_shift_code_id = $5,
               attendance_marker = $6::attendance_marker_enum,
               is_wfh = $7, notes = $8, updated_at = NOW()
           WHERE id = $9`,
          [src.scheduled_start, src.scheduled_end, src.scheduled_start_2, src.scheduled_end_2,
           src.scheduled_shift_code_id, src.attendance_marker, src.is_wfh, notes, id],
        );
      await writeShift(rr.id, tr, rrNotes);
      await writeShift(tr.id, rr, trNotes);

      // Mark the swap applied (migration 033_swap_applied_at adds the column)
      await trx.query(
        `UPDATE request_shift_swaps SET applied_at = NOW() WHERE request_id = $1`, [requestId],
      );

      // Audit both sides (append-only audit_logs)
      for (const [rec, other] of [[rr, tr], [tr, rr]] as const) {
        await trx.query(
          `INSERT INTO audit_logs
             (tenant_id, actor_id, action, module, entity_type, entity_id, old_value, new_value, notes)
           VALUES ($1, $2, 'schedule.swap_applied', 'requests', 'attendance_record', $3, $4::jsonb, $5::jsonb, $6)`,
          [
            tenantId, approverUserId, rec.id,
            JSON.stringify({ marker: rec.attendance_marker, scheduled_start: rec.scheduled_start, scheduled_end: rec.scheduled_end, shift_code_id: rec.scheduled_shift_code_id }),
            JSON.stringify({ marker: other.attendance_marker, scheduled_start: other.scheduled_start, scheduled_end: other.scheduled_end, shift_code_id: other.scheduled_shift_code_id }),
            `${swapType} applied (request ${requestId})`,
          ],
        );
      }
    });

    // Notify both employees (their user accounts) — outside the txn
    const notify = async (employeeId: string, dateStr: string) => {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
         SELECT $1, u.id, 'request.swap_applied',
                'Shift swap applied', 'تم تطبيق تبديل الشفت',
                'Your schedule was updated for ' || $3, 'تم تحديث جدولك بتاريخ ' || $3,
                'request', $4, '/schedule'
         FROM users u WHERE u.tenant_id = $1 AND u.employee_id = $2 AND u.status = 'active'`,
        [tenantId, employeeId, dateStr, requestId],
      ).catch(() => {});
    };
    await notify(s.requester_employee_id, s.requester_date);
    await notify(s.target_employee_id, s.target_date ?? s.requester_date);
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  CREATE LEAVE
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async createLeave(tenantId: string, dto: CreateLeaveDto) {
    const requesterId = await this.resolveRequesterId(tenantId, dto.employeeId);

    const emp = await this.ds.query(
      `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [dto.employeeId, tenantId],
    );
    if (!emp.length) throw new BadRequestException('الموظف غير موجود أو غير نشط');

    const rtRow = await this.ds.query(
      `SELECT id, sla_hours, requires_attachment FROM request_types WHERE code = $1 AND tenant_id = $2`,
      [dto.leaveType, tenantId],
    );
    if (!rtRow.length) throw new BadRequestException(`نوع الإجازة '${dto.leaveType}' غير مدعوم`);

    const start = new Date(dto.startDate);
    const end   = new Date(dto.endDate);
    let durationDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
    if (dto.isHalfDay) durationDays = 0.5;

    if (dto.leaveType === 'death_leave' && durationDays > 3)
      throw new BadRequestException('إجازة الوفاة تكون 3 أيام كحد أقصى');
    if (dto.leaveType === 'comp_off' && durationDays > 1)
      throw new BadRequestException('اليوم التعويضي يوم واحد فقط');

    // Block over-requesting against the annual entitlement (only when one is set).
    await this.leaveBalances.assertCanRequest(
      tenantId, dto.employeeId, dto.leaveType, durationDays, start.getFullYear());

    const requestId = uuid();

    // Campaign blackout (warn-only): flag the request + notify WFM/RTA if it
    // falls in a restricted campaign window for this leave type.
    const blackout = await this.campaignBlackout(tenantId, dto.startDate, [dto.leaveType]);
    const notesFinal = blackout
      ? `${dto.notes ? dto.notes + ' | ' : ''}⚠ حملة (${blackout.name}) — تحتاج مراجعة WFM`
      : (dto.notes ?? null);

    await this.ds.query(
      `INSERT INTO requests
         (id, tenant_id, request_type_id, requester_id, employee_id,
          status, notes, sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6,
               NOW() + ($7 || ' hours')::interval,
               NOW(), NOW(), NOW())`,
      [requestId, tenantId, rtRow[0].id, requesterId, dto.employeeId,
       notesFinal, rtRow[0].sla_hours],
    );

    await this.ds.query(
      `INSERT INTO request_leaves
         (request_id, leave_type, start_date, end_date, duration_days,
          is_half_day, medical_certificate_required, attachment_submitted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        requestId, dto.leaveType, dto.startDate, dto.endDate,
        durationDays, dto.isHalfDay ?? false,
        rtRow[0].requires_attachment, dto.attachmentSubmitted ?? false,
      ],
    );

    if (blackout) {
      await this.notifyCampaignReviewers(
        tenantId, requestId,
        `طلب ${dto.leaveType} (${dto.startDate} → ${dto.endDate}) خلال حملة «${blackout.name}» — راجع التغطية`,
      );
    }

    const arabicNames: Record<string, string> = {
      annual_leave: 'الإجازة السنوية', sick_leave: 'الإجازة المرضية',
      death_leave: 'إجازة الوفاة', comp_off: 'اليوم التعويضي', wfh: 'العمل من المنزل',
    };

    return {
      id: requestId, status: 'pending', durationDays,
      campaignWarning: blackout?.name ?? null,
      message: `تم تقديم طلب ${arabicNames[dto.leaveType] ?? dto.leaveType} بنجاح`,
    };
  }

  /* ────────────────────────────────────────────────────────────────────────
   *  CREATE OVERTIME REQUEST
   * ──────────────────────────────────────────────────────────────────────── */
  async createOvertime(tenantId: string, dto: CreateOvertimeDto) {
    const requesterId = await this.resolveRequesterId(tenantId, dto.employeeId);

    const emp = await this.ds.query(
      `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [dto.employeeId, tenantId],
    );
    if (!emp.length) throw new BadRequestException('الموظف غير موجود أو غير نشط');

    const rtRow = await this.ds.query(
      `SELECT id, sla_hours FROM request_types WHERE code = 'overtime' AND tenant_id = $1`,
      [tenantId],
    );
    if (!rtRow.length) throw new BadRequestException('نوع الطلب overtime غير مدعوم');

    const durationMinutes = Math.round(dto.hours * 60);
    const startTime = dto.startTime ?? '00:00';
    const [sh, sm] = startTime.split(':').map(Number);
    const endMins = sh * 60 + sm + durationMinutes;
    const endTime = `${String(Math.floor(endMins / 60) % 24).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

    const requestId = uuid();

    await this.ds.query(
      `INSERT INTO requests
         (id, tenant_id, request_type_id, requester_id, employee_id,
          status, notes, sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6,
               NOW() + ($7 || ' hours')::interval,
               NOW(), NOW(), NOW())`,
      [requestId, tenantId, rtRow[0].id, requesterId, dto.employeeId,
       dto.notes ?? null, rtRow[0].sla_hours],
    );

    await this.ds.query(
      `INSERT INTO request_overtimes
         (request_id, ot_date, start_time, end_time, duration_minutes, ot_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, dto.otDate, startTime, endTime, durationMinutes, dto.reason ?? null],
    );

    return {
      id: requestId, status: 'pending',
      message: `تم تقديم طلب الأوفر تايم (${dto.hours} ساعة) بنجاح`,
    };
  }

  /* ────────────────────────────────────────────────────────────────────────
   *  CREATE MANUAL BREAK REQUEST
   * ──────────────────────────────────────────────────────────────────────── */
  async createBreak(tenantId: string, dto: CreateBreakDto) {
    const requesterId = await this.resolveRequesterId(tenantId, dto.employeeId);

    const emp = await this.ds.query(
      `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [dto.employeeId, tenantId],
    );
    if (!emp.length) throw new BadRequestException('الموظف غير موجود أو غير نشط');

    const rtRow = await this.ds.query(
      `SELECT id, sla_hours FROM request_types WHERE code = 'break' AND tenant_id = $1`,
      [tenantId],
    );
    if (!rtRow.length) throw new BadRequestException('نوع الطلب break غير مدعوم');

    // From → To times. Duration is derived; date defaults to submission date (today).
    const toMin = (t: string) => {
      const [h, m] = String(t).split(':').map(Number);
      return isNaN(h) ? NaN : h * 60 + (m || 0);
    };
    const sMin = toMin(dto.startTime), eMin = toMin(dto.endTime);
    if (isNaN(sMin) || isNaN(eMin)) throw new BadRequestException('وقت البداية أو النهاية غير صحيح');
    const dur = eMin - sMin;
    if (dur <= 0) throw new BadRequestException('وقت النهاية يجب أن يكون بعد وقت البداية');
    if (dur < 5 || dur > 240) throw new BadRequestException('مدة البريك بين 5 و 240 دقيقة');

    const requestId = uuid();

    await this.ds.query(
      `INSERT INTO requests
         (id, tenant_id, request_type_id, requester_id, employee_id,
          status, notes, sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6,
               NOW() + ($7 || ' hours')::interval,
               NOW(), NOW(), NOW())`,
      [requestId, tenantId, rtRow[0].id, requesterId, dto.employeeId,
       dto.notes ?? null, rtRow[0].sla_hours],
    );

    // break_date defaults to today (Asia/Kuwait) — auto from submission time.
    const [{ break_date }] = await this.ds.query(
      `INSERT INTO request_breaks
         (request_id, break_date, start_time, end_time, duration_minutes, break_type, reason)
       VALUES ($1, COALESCE($2::date, (NOW() AT TIME ZONE 'Asia/Kuwait')::date), $3, $4, $5, $6, $7)
       RETURNING break_date`,
      [requestId, dto.breakDate ?? null, dto.startTime, dto.endTime, dur, dto.breakType ?? 'manual', dto.reason ?? null],
    );

    return {
      id: requestId, status: 'pending', breakDate: break_date,
      message: `تم تقديم طلب البريك (${dto.startTime}-${dto.endTime}، ${dur} دقيقة) بنجاح`,
    };
  }

  /* ────────────────────────────────────────────────────────────────────────
   *  ATTACHMENTS — upload / list a file linked to a request (entity_type='request')
   * ──────────────────────────────────────────────────────────────────────── */
  async addAttachment(
    tenantId: string, requestId: string,
    file: { originalname: string; filename: string; path: string; size: number; mimetype: string },
    uploadedByUserId?: string,
  ) {
    const reqRow = await this.ds.query(
      `SELECT id FROM requests WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!reqRow.length) throw new BadRequestException('الطلب غير موجود');

    const id = uuid();
    await this.ds.query(
      `INSERT INTO attachments
         (id, tenant_id, entity_type, entity_id, original_filename, stored_filename,
          file_path, file_size_bytes, mime_type, uploaded_by, created_at)
       VALUES ($1, $2, 'request', $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [id, tenantId, requestId, file.originalname, file.filename,
       `/uploads/requests/${file.filename}`, file.size, file.mimetype, uploadedByUserId ?? null],
    );
    // Flag the request as having its attachment submitted (leave extension if present).
    await this.ds.query(
      `UPDATE request_leaves SET attachment_submitted = TRUE WHERE request_id = $1`,
      [requestId],
    ).catch(() => {});

    return { id, url: `/uploads/requests/${file.filename}`, name: file.originalname, size: file.size };
  }

  async listAttachments(tenantId: string, requestId: string) {
    return this.ds.query(
      `SELECT id, original_filename AS name, file_path AS url, file_size_bytes AS size,
              mime_type AS type, created_at
         FROM attachments
        WHERE tenant_id = $1 AND entity_type = 'request' AND entity_id = $2
        ORDER BY created_at`,
      [tenantId, requestId],
    );
  }

  async getPeerPending(tenantId: string, employeeId: string) {
    return this.ds.query(
      `SELECT r.id, r.submitted_at, r.notes,
              rt.code AS type_code, rt.name_ar AS type_name_ar,
              req_emp.first_name_en || ' ' || req_emp.last_name_en AS requester_name,
              req_emp.employee_no,
              rss.swap_type, rss.requester_date, rss.target_date,
              req_sc.code AS requester_shift_code,
              tgt_sc.code AS target_shift_code,
              req_ar.scheduled_start AS req_start, req_ar.scheduled_end AS req_end,
              tgt_ar.scheduled_start AS tgt_start, tgt_ar.scheduled_end AS tgt_end
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       JOIN request_shift_swaps rss ON rss.request_id = r.id
       JOIN employees req_emp ON req_emp.id = r.employee_id
       LEFT JOIN shift_codes req_sc ON req_sc.id = rss.requester_shift_code_id
       LEFT JOIN shift_codes tgt_sc ON tgt_sc.id = rss.target_shift_code_id
       LEFT JOIN attendance_records req_ar
         ON req_ar.employee_id = r.employee_id
         AND req_ar.attendance_date::date = rss.requester_date::date
         AND req_ar.tenant_id = r.tenant_id
       LEFT JOIN attendance_records tgt_ar
         ON tgt_ar.employee_id = rss.target_employee_id
         AND tgt_ar.attendance_date::date = rss.target_date::date
         AND tgt_ar.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
         AND rss.target_employee_id = $2
         AND r.status = 'peer_pending'
       ORDER BY r.submitted_at DESC NULLS LAST`,
      [tenantId, employeeId],
    );
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  SINGLE REQUEST
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async getOne(tenantId: string, requestId: string) {
    const rows = await this.ds.query(
      `SELECT r.id, r.status, r.notes, r.submitted_at,
              r.approved_l1_at, r.rejected_at, r.rejection_reason, r.is_urgent,
              rt.code AS type_code, rt.name_ar,
              e.first_name_en || ' ' || e.last_name_en AS requester_name,
              e.employee_no, e.gender,
              f.name AS function_name,
              rss.swap_type, rss.requester_date, rss.target_date,
              rss.peer_accepted_at, rss.peer_rejected_at, rss.peer_rejection_reason,
              rss.coverage_check_passed, rss.rest_check_passed, rss.gender_check_passed,
              req_sc.code AS req_shift_code, tgt_sc.code AS tgt_shift_code,
              te.first_name_en || ' ' || te.last_name_en AS target_name, te.gender AS target_gender,
              rl.leave_type, rl.start_date, rl.end_date, rl.duration_days, rl.is_half_day,
              rl.medical_certificate_required, rl.attachment_submitted,
              rp.permission_date, rp.start_time, rp.end_time, rp.duration_minutes, rp.reason
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN request_shift_swaps rss ON rss.request_id = r.id
       LEFT JOIN shift_codes req_sc ON req_sc.id = rss.requester_shift_code_id
       LEFT JOIN shift_codes tgt_sc ON tgt_sc.id = rss.target_shift_code_id
       LEFT JOIN employees te ON te.id = rss.target_employee_id
       LEFT JOIN request_leaves rl ON rl.request_id = r.id
       LEFT JOIN request_permissions rp ON rp.request_id = r.id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('الطلب غير موجود');
    return rows[0];
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  HC IMPACT â€” for any request type before/after approval
   * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  async getHcImpact(tenantId: string, requestId: string) {
    const req = await this.getOne(tenantId, requestId);
    const typeCode: string = req.type_code;

    // â”€â”€ Leaves / WFH / Comp Off â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (['annual_leave','sick_leave','death_leave','comp_off','wfh'].includes(typeCode)) {
      return this.leaveHcImpact(tenantId, req);
    }

    // â”€â”€ Shift / Off Swap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (typeCode === 'shift_swap' || typeCode === 'off_swap') {
      return this.swapHcImpact(tenantId, req);
    }

    // â”€â”€ Permission (basic summary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (typeCode === 'permission') {
      return this.permissionHcImpact(tenantId, req);
    }

    return { type: typeCode, dates: [], summary: 'No HC impact for this request type', summaryAr: 'لا يوجد تأثير HC لهذا النوع' };
  }

  /** Format a Date as YYYY-MM-DD using LOCAL components â€” toISOString() shifts
   *  Kuwait (+03) local midnight back to the previous day in UTC. */
  private static ymdLocal(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Leave HC impact: for each date in range, show HC before/after */
  private async leaveHcImpact(tenantId: string, req: any) {
    const start = new Date(req.start_date);
    const end   = new Date(req.end_date);

    // Collect unique dates in range (max 14) â€” iterate on local-midnight dates
    const dates: string[] = [];
    const cur    = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(),   end.getMonth(),   end.getDate());
    while (cur <= endDay && dates.length < 14) {
      dates.push(RequestsService.ymdLocal(cur));
      cur.setDate(cur.getDate() + 1);
    }

    // Get employee_id from requests table (getOne() doesn't expose it)
    const empRow = await this.ds.query(
      `SELECT r.employee_id, e.function_id, f.name AS func_name
       FROM requests r
       JOIN employees e ON e.id = r.employee_id
       JOIN functions f ON f.id = e.function_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [req.id, tenantId],
    );
    const empId   = empRow[0]?.employee_id;
    const funcId   = empRow[0]?.function_id;
    const funcName = empRow[0]?.func_name ?? req.function_name ?? 'â€”';

    // For each date, count working HC in the function.
    // Only attendance_marker = 'present' counts as coverage â€” employees already
    // sick/absent/off/on-leave keep their scheduled times but provide no coverage.
    const dateRows = await Promise.all(
      dates.map(async (d) => {
        const hcRow = await this.ds.query(
          `SELECT COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS total,
                  COUNT(*) FILTER (WHERE ar.attendance_marker = 'present'
                                     AND ar.employee_id != $3)              AS after_approval,
                  COUNT(*) FILTER (WHERE ar.attendance_marker = 'present'
                                     AND ar.employee_id  = $3)              AS requester_working
           FROM attendance_records ar
           JOIN employees e ON e.id = ar.employee_id
           WHERE ar.tenant_id = $1
             AND e.function_id = $2
             AND ar.attendance_date::date = $4::date`,
          [tenantId, funcId, empId, d],
        );
        const total   = parseInt(hcRow[0]?.total ?? '0');
        const after   = parseInt(hcRow[0]?.after_approval ?? '0');
        const requesterScheduled = parseInt(hcRow[0]?.requester_working ?? '0') > 0;
        const required = Math.max(Math.ceil(total * 0.75), 2);
        const gap     = Math.max(required - after, 0);
        return {
          date: d,
          scheduledHc: total,
          afterApproval: after,
          requesterScheduled,
          requiredHc: required,
          gap,
          risk: gap > 2 ? 'critical' : gap > 0 ? 'warning' : 'ok',
        };
      }),
    );

    const hasRisk      = dateRows.some(d => d.risk !== 'ok');
    const hasCritical  = dateRows.some(d => d.risk === 'critical');
    const notScheduled = dateRows.filter(d => !d.requesterScheduled).length;

    return {
      type: req.type_code,
      functionName: funcName,
      requesterName: req.requester_name,
      dates: dateRows,
      summary: hasCritical
        ? `Critical: ${dateRows.filter(d => d.risk === 'critical').length} day(s) will be below minimum coverage`
        : hasRisk
        ? `Warning: ${dateRows.filter(d => d.risk === 'warning').length} day(s) near minimum coverage`
        : notScheduled === dateRows.length
        ? 'Employee not scheduled on request days — no coverage impact'
        : 'Coverage acceptable for all requested days',
      summaryAr: hasCritical
        ? `تحذير حرج: ${dateRows.filter(d => d.risk === 'critical').length} يوم سيكون تحت الحد الأدنى للتغطية`
        : hasRisk
        ? `تحذير: ${dateRows.filter(d => d.risk === 'warning').length} يوم يحتاج مراجعة`
        : notScheduled === dateRows.length
        ? 'الموظف غير مجدول للعمل في أيام الطلب — لا تأثير على التغطية'
        : 'التغطية مقبولة في جميع الأيام',
      requesterNotScheduledDays: notScheduled,
      overallRisk: hasCritical ? 'critical' : hasRisk ? 'warning' : 'ok',
    };
  }

  /** Swap HC impact: same total HC, but shift timing changes */
  private async swapHcImpact(tenantId: string, req: any) {
    const reqDate = req.requester_date;
    const tgtDate = req.target_date;

    // Get requester's current shift and function
    const reqShiftRow = await this.ds.query(
      `SELECT ar.scheduled_start, ar.scheduled_end, f.name AS func_name, e.first_name_en || ' ' || e.last_name_en AS emp_name
       FROM attendance_records ar
       JOIN requests r ON r.id = $1
       JOIN employees e ON e.id = r.employee_id
       JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $2 AND ar.employee_id = e.id
         AND ar.attendance_date::date = $3::date`,
      [req.id, tenantId, reqDate],
    );

    // Total HC on requester date (same function)
    const reqDateHc = await this.ds.query(
      `SELECT COUNT(*) AS hc
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       JOIN requests r ON r.id = $1
       JOIN employees req_emp ON req_emp.id = r.employee_id
       WHERE ar.tenant_id = $2
         AND e.function_id = req_emp.function_id
         AND ar.attendance_date::date = $3::date
         AND ar.scheduled_start IS NOT NULL`,
      [req.id, tenantId, reqDate],
    );

    return {
      type: req.type_code,
      requesterName: req.requester_name,
      targetName: req.target_name,
      swapNote: 'تبادل الشيفت لا يؤثر على إجمالي عدد الموظفين، لكنه قد يؤثر على التوقيت',
      swapNoteEn: 'The shift swap does not change total headcount, but it may affect timing.',
      requesterDate: {
        date: reqDate,
        hcCount: parseInt(reqDateHc[0]?.hc ?? '0'),
        requesterShift: req.req_shift_code ?? `${req.peer_accepted_at ? 'معتمد' : 'قيد الانتظار'}`,
        risk: 'ok',
      },
      targetDate: {
        date: tgtDate,
        targetShift: req.tgt_shift_code,
        risk: 'ok',
      },
      validationSummary: {
        restCheckPassed: req.rest_check_passed,
        genderCheckPassed: req.gender_check_passed,
        coverageCheckPassed: req.coverage_check_passed,
      },
      overallRisk: (!req.rest_check_passed || !req.gender_check_passed) ? 'warning' : 'ok',
    };
  }

  /** Permission HC impact: simplified — show duration and function HC at that time */
  private async permissionHcImpact(tenantId: string, req: any) {
    if (!req.permission_date || !req.start_time) {
      return { type: 'permission', dates: [], summary: 'Permission data incomplete', summaryAr: 'بيانات الاستئذان غير مكتملة' };
    }

    const funcInfo = await this.ds.query(
      `SELECT r.employee_id, e.function_id, f.name AS func_name
       FROM requests r
       JOIN employees e ON e.id = r.employee_id
       JOIN functions f ON f.id = e.function_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [req.id, tenantId],
    );
    const empId    = funcInfo[0]?.employee_id;
    const funcId   = funcInfo[0]?.function_id;
    const funcName = funcInfo[0]?.func_name ?? '—';

    // Pull all working shifts that can cover any hour of the permission date:
    // shifts ON the date itself + cross-midnight shifts from the PREVIOUS day
    // that spill into the early hours of the date.
    const permDate = typeof req.permission_date === 'string'
      ? req.permission_date.substring(0, 10)
      : RequestsService.ymdLocal(new Date(req.permission_date));
    const shifts = await this.ds.query(
      `SELECT ar.employee_id, ar.scheduled_start, ar.scheduled_end,
              ar.attendance_date::date::text AS att_date
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       WHERE ar.tenant_id = $1 AND e.function_id = $2
         AND ar.attendance_marker = 'present'
         AND ar.scheduled_start IS NOT NULL
         AND ar.attendance_date::date IN ($3::date, $3::date - 1)`,
      [tenantId, funcId, permDate],
    );

    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };

    /** Does this shift cover minute-of-day `mod` on the permission date? */
    const covers = (s: any, mod: number): boolean => {
      const start = toMin(s.scheduled_start);
      const end   = toMin(s.scheduled_end);
      const crossesMidnight = end <= start;
      const isPrevDay = s.att_date < permDate;
      if (isPrevDay) {
        // Previous-day shift only matters if it crosses midnight into this date
        return crossesMidnight && mod < end;
      }
      if (crossesMidnight) return mod >= start;          // covers start→24:00 on this date
      return mod >= start && mod < end;                  // normal same-day shift
    };

    const permStart = toMin(req.start_time);
    const permEnd   = toMin(req.end_time);
    const durationMins = req.duration_minutes ?? Math.max(permEnd - permStart, 0);

    // Requester's own shift today (for scheduled check + display)
    const reqShift = shifts.find((s: any) => s.employee_id === empId && s.att_date === permDate);
    const requesterScheduled = !!reqShift;

    // Hour-by-hour breakdown across the permission window
    const firstHour = Math.floor(permStart / 60);
    const lastHour  = Math.ceil(permEnd / 60);
    const hourly: any[] = [];
    for (let h = firstHour; h < lastHour && hourly.length < 12; h++) {
      const midpoint = h * 60 + 30;   // sample mid-hour to decide coverage
      const working = shifts.filter((s: any) => covers(s, midpoint));
      const scheduled = working.length;
      const requesterWorksThisHour = !!reqShift && covers(reqShift, midpoint);
      const after = requesterWorksThisHour ? scheduled - 1 : scheduled;
      const required = Math.max(Math.ceil(scheduled * 0.75), 2);
      hourly.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00-${String((h + 1) % 24).padStart(2, '0')}:00`,
        scheduled,
        afterApproval: after,
        requesterWorking: requesterWorksThisHour,
        gap: Math.max(required - after, 0),
        risk: after < required - 2 ? 'critical' : after < required ? 'warning' : 'ok',
      });
    }

    const hasCritical = hourly.some(h => h.risk === 'critical');
    const hasWarning  = hourly.some(h => h.risk === 'warning');
    const minAfter = hourly.length ? Math.min(...hourly.map(h => h.afterApproval)) : 0;
    const maxScheduled = hourly.length ? Math.max(...hourly.map(h => h.scheduled)) : 0;

    return {
      type: 'permission',
      functionName: funcName,
      permissionDate: req.permission_date,
      permissionTime: `${req.start_time?.substring(0,5)} - ${req.end_time?.substring(0,5)}`,
      durationMinutes: durationMins,
      requesterScheduled,
      requesterShift: reqShift
        ? `${reqShift.scheduled_start.substring(0,5)} - ${reqShift.scheduled_end.substring(0,5)}`
        : null,
      hourly,
      // Day-level summary kept for backwards compatibility
      scheduledHcOnDate: maxScheduled,
      afterApproval: minAfter,
      risk: hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok',
      summary: !requesterScheduled
        ? 'Employee not scheduled — check permission date'
        : hasCritical
        ? 'Critical: coverage will drop below minimum during permission hours'
        : hasWarning
        ? 'Warning: some permission hours are near minimum coverage'
        : 'Coverage acceptable for all permission hours',
      summaryAr: !requesterScheduled
        ? 'الموظف غير مجدول في هذا اليوم — راجع تاريخ الاستئذان'
        : hasCritical
        ? 'تحذير حرج: ساعات الاستئذان ستكون تحت الحد الأدنى للتغطية'
        : hasWarning
        ? 'تحذير: بعض ساعات الاستئذان قريبة من الحد الأدنى'
        : 'التغطية مقبولة في جميع ساعات الاستئذان',
      overallRisk: !requesterScheduled ? 'warning' : hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok',
    };
  }
}

