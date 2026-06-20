import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreatePermissionRequestDto,
  ApproveRequestDto,
  RejectRequestDto,
  HcImpactResult,
  HcIntervalCell,
  HcImpactFunction,
  PermissionRequestRow,
  PERMISSION_RULES,
} from './permission-request.types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateIntervals(startHhmm: string, endHhmm: string, stepMins = 30): string[] {
  const result: string[] = [];
  let cur = toMinutes(startHhmm);
  const end = toMinutes(endHhmm);
  // Handle cross-midnight
  const adjustedEnd = end <= cur ? end + 24 * 60 : end;
  while (cur < adjustedEnd) {
    result.push(fromMinutes(cur));
    cur += stepMins;
  }
  return result;
}

function overlapsInterval(
  empStart: string, empEnd: string,
  intStart: string, intEnd: string,
): boolean {
  const es = toMinutes(empStart);
  let ee = toMinutes(empEnd);
  const is = toMinutes(intStart);
  const ie = toMinutes(intEnd);
  if (ee <= es) ee += 24 * 60; // cross midnight
  return es <= is && ee >= ie;
}

function permissionOverlaps(
  permStart: string, permEnd: string,
  intStart: string, intEnd: string,
): boolean {
  const ps = toMinutes(permStart);
  const pe = toMinutes(permEnd);
  const is = toMinutes(intStart);
  const ie = toMinutes(intEnd);
  // Permission overlaps interval if they share any time
  return ps < ie && pe > is;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PermissionRequestService implements OnModuleInit {
  constructor(private readonly ds: DataSource) {}

  async onModuleInit() {
    // Ensure permission request_type row exists (already seeded, but safe to skip if present)
    // No DDL needed — tables exist from Phase 1 migration
    const pm = this.ds.createQueryRunner();
    await pm.release();
  }

  // ── List requests ──────────────────────────────────────────────────────────

  async getRequests(tenantId: string, filters: {
    status?: string;
    employeeId?: string;
    functionId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: PermissionRequestRow[]; total: number }> {
    const conditions: string[] = [
      `r.tenant_id = $1`,
      `rt.code = 'permission'`,
    ];
    const params: any[] = [tenantId];
    let pidx = 2;

    if (filters.status) {
      conditions.push(`r.status = $${pidx++}::request_status_enum`);
      params.push(filters.status);
    }
    if (filters.employeeId) {
      conditions.push(`r.employee_id = $${pidx++}`);
      params.push(filters.employeeId);
    }
    if (filters.functionId) {
      conditions.push(`rp.function_id = $${pidx++}`);
      params.push(filters.functionId);
    }
    if (filters.dateFrom) {
      conditions.push(`rp.permission_date >= $${pidx++}`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conditions.push(`rp.permission_date <= $${pidx++}`);
      params.push(filters.dateTo);
    }

    const where = conditions.join(' AND ');
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const sql = `
      SELECT
        r.id,
        r.employee_id,
        e.first_name_en || ' ' || e.last_name_en AS employee_name,
        e.employee_no,
        fn.name      AS function_name,
        COALESCE(rp.function_id, e.function_id)::text AS function_id,
        rp.permission_date::text,
        rp.start_time::text,
        rp.end_time::text,
        rp.duration_minutes,
        rp.permission_type,
        rp.reason,
        r.status,
        r.is_urgent,
        r.submitted_at,
        u1.first_name || ' ' || u1.last_name AS approver_l1_name,
        u2.first_name || ' ' || u2.last_name AS approver_l2_name,
        r.notes,
        r.rejection_reason,
        r.hc_impact,
        r.sla_due_at,
        COUNT(*) OVER() AS total_count
      FROM requests r
      JOIN request_types rt ON rt.id = r.request_type_id
      JOIN request_permissions rp ON rp.request_id = r.id
      JOIN employees e ON e.id = r.employee_id
      LEFT JOIN functions fn ON fn.id = COALESCE(rp.function_id, e.function_id)
      LEFT JOIN users u1 ON u1.id = r.approver_l1_id
      LEFT JOIN users u2 ON u2.id = r.approver_l2_id
      WHERE ${where}
      ORDER BY r.submitted_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await this.ds.query(sql, params);
    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    return {
      total,
      rows: rows.map((row: any) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        employeeNo: row.employee_no,
        functionName: row.function_name,
        functionId: row.function_id,
        permissionDate: row.permission_date,
        startTime: row.start_time ? row.start_time.slice(0, 5) : '',
        endTime: row.end_time ? row.end_time.slice(0, 5) : '',
        durationMinutes: row.duration_minutes,
        permissionType: row.permission_type ?? null,
        reason: row.reason,
        status: row.status,
        isUrgent: row.is_urgent,
        submittedAt: row.submitted_at,
        approverL1Name: row.approver_l1_name ?? null,
        approverL2Name: row.approver_l2_name ?? null,
        notes: row.notes ?? null,
        rejectionReason: row.rejection_reason ?? null,
        hcImpact: row.hc_impact ?? null,
        slaRemainingHours: row.sla_due_at
          ? Math.round((new Date(row.sla_due_at).getTime() - Date.now()) / 3_600_000)
          : null,
      })),
    };
  }

  // ── Campaign window helpers ──────────────────────────────────────────────
  // During campaigns, permissions are EXCEPTIONAL — never blocked, but flagged
  // and surfaced to WFM/RTA (Ops rule: permissions during campaigns are rare).
  // Any active campaign covering the date triggers it (independent of the
  // campaign's restricted_types list).
  private async activeCampaignName(tenantId: string, dateStr: string): Promise<string | null> {
    if (!dateStr) return null;
    const rows = await this.ds.query(
      `SELECT name FROM campaigns
        WHERE tenant_id = $1 AND is_active = TRUE
          AND $2::date BETWEEN start_date AND end_date
        ORDER BY start_date LIMIT 1`,
      [tenantId, String(dateStr).slice(0, 10)],
    ).catch(() => []);
    return rows[0]?.name ?? null;
  }

  private async notifyCampaignReviewers(tenantId: string, requestId: string, body: string): Promise<void> {
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
         VALUES ($1, $2, 'request.campaign_exception', $3, $4, 'request', $5)`,
        [tenantId, rv.id, 'استئذان استثنائي خلال حملة', body, requestId],
      ).catch(() => {});
    }
  }

  // ── Create request ─────────────────────────────────────────────────────────

  async createRequest(tenantId: string, dto: CreatePermissionRequestDto): Promise<{ id: string }> {
    // ── Validate permission type ────────────────────────────────────────────
    const validTypes = ['late_in', 'early_out', 'temp_out', 'return_during_shift'];
    if (!validTypes.includes(dto.permissionType)) {
      throw new BadRequestException(
        `نوع الإذن غير صحيح. الأنواع المتاحة: ${validTypes.join(', ')}`,
      );
    }

    // ── Duration validation ─────────────────────────────────────────────────
    const startMins = toMinutes(dto.startTime);
    const endMins   = toMinutes(dto.endTime);
    const durationMinutes = endMins > startMins
      ? endMins - startMins
      : (24 * 60 - startMins) + endMins;

    if (durationMinutes < PERMISSION_RULES.MIN_DURATION_MINUTES) {
      throw new BadRequestException(
        `الحد الأدنى لمدة الإذن هو ${PERMISSION_RULES.MIN_DURATION_MINUTES} دقيقة. ` +
        `المدة المدخلة: ${durationMinutes} دقيقة.`,
      );
    }
    if (durationMinutes > PERMISSION_RULES.MAX_DURATION_MINUTES) {
      throw new BadRequestException(
        `الحد الأقصى لمدة الإذن هو ${PERMISSION_RULES.MAX_DURATION_MINUTES} دقيقة (3 ساعات). ` +
        `المدة المدخلة: ${durationMinutes} دقيقة.`,
      );
    }

    // ── Weekly quota check (max 3 permissions per WFM week: Sat–Fri) ──────
    // Determine the Sat–Fri week containing permissionDate
    const permDate = new Date(dto.permissionDate);
    const dayOfWeek = permDate.getDay(); // 0=Sun, 6=Sat
    // Days since last Saturday (Sat=0 in WFM week)
    const daysSinceSat = (dayOfWeek + 1) % 7; // Sat→0, Sun→1, … Fri→6
    const weekSat = new Date(permDate);
    weekSat.setDate(permDate.getDate() - daysSinceSat);
    const weekFri = new Date(weekSat);
    weekFri.setDate(weekSat.getDate() + 6);
    const weekSatStr = weekSat.toISOString().slice(0, 10);
    const weekFriStr = weekFri.toISOString().slice(0, 10);

    const weekCountRows = await this.ds.query(
      `SELECT COUNT(*) AS cnt
       FROM requests r
       JOIN request_permissions rp ON rp.request_id = r.id
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1
         AND r.employee_id = $2
         AND rt.code = 'permission'
         AND rp.permission_date BETWEEN $3::date AND $4::date
         AND r.status NOT IN ('rejected','cancelled')`,
      [tenantId, dto.employeeId, weekSatStr, weekFriStr],
    );
    const weekCount = parseInt(weekCountRows[0]?.cnt ?? '0', 10);
    if (weekCount >= PERMISSION_RULES.MAX_PER_WEEK) {
      throw new BadRequestException(
        `تجاوز الحد الأقصى للأذونات هذا الأسبوع (${PERMISSION_RULES.MAX_PER_WEEK} أذونات). ` +
        `المستخدم لديه بالفعل ${weekCount} أذونات من ${weekSatStr} حتى ${weekFriStr}.`,
      );
    }

    // Cumulative duration cap: 6 hours of permission per week/cycle.
    const weekMinsRows = await this.ds.query(
      `SELECT COALESCE(SUM(rp.duration_minutes),0) AS mins
       FROM requests r
       JOIN request_permissions rp ON rp.request_id = r.id
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1 AND r.employee_id = $2 AND rt.code = 'permission'
         AND rp.permission_date BETWEEN $3::date AND $4::date
         AND r.status NOT IN ('rejected','cancelled')`,
      [tenantId, dto.employeeId, weekSatStr, weekFriStr],
    );
    const usedMins = parseInt(weekMinsRows[0]?.mins ?? '0', 10);
    if (usedMins + durationMinutes > PERMISSION_RULES.MAX_MINUTES_PER_WEEK) {
      throw new BadRequestException(
        `تجاوز رصيد الاستئذان الأسبوعي (${PERMISSION_RULES.MAX_MINUTES_PER_WEEK / 60} ساعات). ` +
        `المستخدم استخدم ${usedMins} دقيقة، وهذا الطلب ${durationMinutes} دقيقة.`,
      );
    }

    // Resolve permission request_type id
    const rtRows = await this.ds.query(
      `SELECT id FROM request_types WHERE tenant_id = $1 AND code = 'permission' LIMIT 1`,
      [tenantId],
    );
    if (!rtRows.length) throw new BadRequestException('Permission request type not configured');
    const requestTypeId = rtRows[0].id;

    // Resolve employee function if not provided
    let functionId = dto.functionId;
    if (!functionId) {
      const emp = await this.ds.query(
        `SELECT function_id FROM employees WHERE id = $1 AND tenant_id = $2`,
        [dto.employeeId, tenantId],
      );
      if (!emp.length) throw new NotFoundException('Employee not found');
      functionId = emp[0].function_id;
    }

    // Calculate HC impact before saving
    const impact = await this.calculateHcImpact(tenantId, {
      date: dto.permissionDate,
      startTime: dto.startTime,
      endTime: dto.endTime,
      functionId,
    });

    // SLA: 4 hours from now
    const sla = new Date(Date.now() + 4 * 3_600_000);

    // Resolve requester_id: find linked user, or use the first admin user as fallback
    let requesterId: string;
    const linkedUser = await this.ds.query(
      `SELECT id FROM users WHERE employee_id = $1 AND tenant_id = $2 LIMIT 1`,
      [dto.employeeId, tenantId],
    );
    if (linkedUser.length) {
      requesterId = linkedUser[0].id;
    } else {
      const adminUser = await this.ds.query(
        `SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
        [tenantId],
      );
      if (!adminUser.length) throw new BadRequestException('No system user found');
      requesterId = adminUser[0].id;
    }

    // Campaign window → mark this permission as an EXCEPTIONAL case (warn-only):
    // flag the notes, force urgent so it surfaces, and notify WFM/RTA.
    const campaign = await this.activeCampaignName(tenantId, dto.permissionDate);
    const notesFinal = campaign
      ? `${dto.notes ? dto.notes + ' | ' : ''}⚠ استئذان استثنائي خلال حملة «${campaign}»`
      : (dto.notes ?? null);
    const isUrgentFinal = campaign ? true : (dto.isUrgent ?? false);

    const requestRows = await this.ds.query(
      `INSERT INTO requests
         (tenant_id, request_type_id, requester_id, employee_id, status, is_urgent, notes, hc_impact, sla_due_at, submitted_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'pending'::request_status_enum,$5,$6,$7,$8,NOW(),NOW(),NOW())
       RETURNING id`,
      [tenantId, requestTypeId, requesterId, dto.employeeId, isUrgentFinal,
       notesFinal, JSON.stringify(impact), sla],
    );
    const requestId = requestRows[0].id;

    await this.ds.query(
      `INSERT INTO request_permissions
         (request_id, permission_date, start_time, end_time, duration_minutes,
          permission_type, reason, function_id)
       VALUES ($1,$2,$3,$4,$5,$6::permission_type_enum,$7,$8)`,
      [requestId, dto.permissionDate, dto.startTime, dto.endTime,
       durationMinutes, dto.permissionType, dto.reason, functionId],
    );

    if (campaign) {
      await this.notifyCampaignReviewers(
        tenantId, requestId,
        `استئذان (${dto.permissionDate} ${dto.startTime}-${dto.endTime}) خلال حملة «${campaign}» — حالة استثنائية، راجع التغطية`,
      );
    }

    return { id: requestId, campaignWarning: campaign ?? null } as any;
  }

  // ── Approve / Reject ───────────────────────────────────────────────────────

  async approveRequest(tenantId: string, requestId: string, dto: ApproveRequestDto): Promise<void> {
    const rows = await this.ds.query(
      `SELECT r.id, r.status, r.approver_l1_id, r.approved_l1_at FROM requests r WHERE r.id=$1 AND r.tenant_id=$2`,
      [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Request not found');
    const req = rows[0];
    if (['approved','rejected','cancelled'].includes(req.status)) {
      throw new BadRequestException(`Request is already ${req.status}`);
    }

    // If no L1 approval yet → set L1
    if (!req.approved_l1_at) {
      await this.ds.query(
        `UPDATE requests SET approver_l1_id=$1, approved_l1_at=NOW(), updated_at=NOW(), notes=COALESCE($2,notes) WHERE id=$3`,
        [dto.approverId, dto.notes ?? null, requestId],
      );
      // Approval level 1 done — if only 1 level required, mark approved
      const rtRows = await this.ds.query(
        `SELECT rt.approval_levels FROM requests r JOIN request_types rt ON rt.id=r.request_type_id WHERE r.id=$1`,
        [requestId],
      );
      if (rtRows[0]?.approval_levels <= 1) {
        await this.ds.query(
          `UPDATE requests SET status='approved'::request_status_enum, updated_at=NOW() WHERE id=$1`,
          [requestId],
        );
      }
    } else {
      // L2 approval → mark fully approved
      await this.ds.query(
        `UPDATE requests SET approver_l2_id=$1, approved_l2_at=NOW(), status='approved'::request_status_enum, updated_at=NOW() WHERE id=$2`,
        [dto.approverId, requestId],
      );
    }
  }

  async rejectRequest(tenantId: string, requestId: string, dto: RejectRequestDto): Promise<void> {
    const rows = await this.ds.query(
      `SELECT id, status FROM requests WHERE id=$1 AND tenant_id=$2`, [requestId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Request not found');
    if (['approved','rejected'].includes(rows[0].status)) {
      throw new BadRequestException(`Request already ${rows[0].status}`);
    }
    await this.ds.query(
      `UPDATE requests SET status='rejected'::request_status_enum, rejected_by=$1, rejected_at=NOW(), rejection_reason=$2, updated_at=NOW() WHERE id=$3`,
      [dto.rejectorId, dto.reason, requestId],
    );
  }

  async cancelRequest(tenantId: string, requestId: string, employeeId: string): Promise<void> {
    const rows = await this.ds.query(
      `SELECT id, status FROM requests WHERE id=$1 AND tenant_id=$2 AND employee_id=$3`,
      [requestId, tenantId, employeeId],
    );
    if (!rows.length) throw new NotFoundException('Request not found');
    if (!['pending'].includes(rows[0].status)) throw new BadRequestException('Can only cancel pending requests');
    await this.ds.query(
      `UPDATE requests SET status='cancelled'::request_status_enum, updated_at=NOW() WHERE id=$1`, [requestId],
    );
  }

  // ── HC Impact Calculator ───────────────────────────────────────────────────

  async calculateHcImpact(tenantId: string, params: {
    date: string;
    startTime: string;
    endTime: string;
    functionId?: string;
    excludeRequestId?: string;
  }): Promise<HcImpactResult> {
    const { date, startTime, endTime, functionId, excludeRequestId } = params;

    // Determine window to analyse: from shift start to end (or full day window)
    // We generate intervals covering the permission window ± buffer
    const permStartMins = toMinutes(startTime);
    const permEndMins   = toMinutes(endTime);

    // Expand window to show context: 2 hours before/after permission
    const windowStart = fromMinutes(Math.max(0, permStartMins - 120));
    const windowEnd   = fromMinutes(Math.min(23 * 60, permEndMins + 120));
    const intervals   = generateIntervals(windowStart, windowEnd, 30);

    // Get functions to analyse
    let functionsToAnalyse: { id: string; name: string }[] = [];
    if (functionId) {
      const fnRows = await this.ds.query(
        `SELECT id, name FROM functions WHERE id = $1 AND tenant_id = $2`, [functionId, tenantId],
      );
      functionsToAnalyse = fnRows;
    } else {
      // Get functions that have scheduled employees on this date
      const fnRows = await this.ds.query(
        `SELECT DISTINCT fn.id, fn.name
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         JOIN functions fn ON fn.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date
           AND ar.scheduled_start IS NOT NULL
           AND ar.attendance_marker NOT IN ('off','leave','absent','sick','holiday','comp')
         ORDER BY fn.name`,
        [tenantId, date],
      );
      functionsToAnalyse = fnRows;
    }

    // Get all approved/pending permissions on this date
    let permExclude = '';
    const permParams: any[] = [tenantId, date];
    if (excludeRequestId) {
      permExclude = ` AND r.id != $3`;
      permParams.push(excludeRequestId);
    }

    const activePermissions = await this.ds.query(
      `SELECT
         r.id, r.employee_id, r.status,
         rp.start_time::text AS start_time,
         rp.end_time::text   AS end_time,
         e.first_name_en || ' ' || e.last_name_en AS full_name,
         e.function_id
       FROM requests r
       JOIN request_permissions rp ON rp.request_id = r.id
       JOIN employees e ON e.id = r.employee_id
       WHERE r.tenant_id = $1
         AND rp.permission_date = $2::date
         AND r.status IN ('pending','approved')${permExclude}`,
      permParams,
    );

    const warnings: string[] = [];
    const results: HcImpactFunction[] = [];
    let worstRisk: 'ok' | 'warning' | 'critical' = 'ok';

    for (const fn of functionsToAnalyse) {
      // Get scheduled employees for this function/date
      const scheduled = await this.ds.query(
        `SELECT
           ar.employee_id,
           e.first_name_en || ' ' || e.last_name_en AS full_name,
           ar.scheduled_start::text AS scheduled_start,
           ar.scheduled_end::text   AS scheduled_end
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         WHERE ar.tenant_id = $1
           AND ar.attendance_date = $2::date
           AND e.function_id = $3
           AND ar.scheduled_start IS NOT NULL
           AND ar.attendance_marker NOT IN ('off','leave','absent','sick','holiday','comp')`,
        [tenantId, date, fn.id],
      );

      // Filter permissions for this function
      const fnPermissions = activePermissions.filter(
        (p: any) => p.function_id === fn.id,
      );

      const intervalCells: HcIntervalCell[] = [];

      for (let i = 0; i < intervals.length - 1; i++) {
        const intStart = intervals[i];
        const intEnd   = intervals[i + 1];

        // Count scheduled employees who are present in this interval
        const scheduledInInterval = scheduled.filter((e: any) => {
          const ss = e.scheduled_start ? e.scheduled_start.slice(0, 5) : null;
          const se = e.scheduled_end ? e.scheduled_end.slice(0, 5) : null;
          if (!ss || !se) return false;
          return overlapsInterval(ss, se, intStart, intEnd);
        });

        // Count approved permissions
        const approvedPerm = fnPermissions.filter(
          (p: any) => p.status === 'approved' && permissionOverlaps(
            p.start_time.slice(0, 5), p.end_time.slice(0, 5), intStart, intEnd,
          ),
        );

        // Count pending permissions
        const pendingPerm = fnPermissions.filter(
          (p: any) => p.status === 'pending' && permissionOverlaps(
            p.start_time.slice(0, 5), p.end_time.slice(0, 5), intStart, intEnd,
          ),
        );

        const scheduledHc    = scheduledInInterval.length;
        const onPermissionHc = approvedPerm.length;
        const pendingHc      = pendingPerm.length;
        const availableHc    = Math.max(0, scheduledHc - onPermissionHc - pendingHc);

        // Simple required HC rule: 70% of scheduled (or at least 1)
        const requiredHc = scheduledHc > 0 ? Math.max(1, Math.ceil(scheduledHc * 0.70)) : null;
        const gap = requiredHc !== null ? availableHc - requiredHc : null;

        let riskLevel: 'ok' | 'warning' | 'critical' = 'ok';
        if (gap !== null) {
          if (gap < 0) riskLevel = 'critical';
          else if (gap < 2) riskLevel = 'warning';
        }

        if (riskLevel === 'critical' && worstRisk !== 'critical') worstRisk = 'critical';
        if (riskLevel === 'warning' && worstRisk === 'ok') worstRisk = 'warning';

        intervalCells.push({
          intervalStart: intStart,
          intervalEnd: intEnd,
          scheduledHc,
          onPermissionHc,
          pendingHc,
          availableHc,
          requiredHc,
          gap,
          riskLevel,
          affectedEmployees: [
            ...approvedPerm.map((p: any) => ({ id: p.employee_id, name: p.full_name, status: 'approved' })),
            ...pendingPerm.map((p: any) => ({ id: p.employee_id, name: p.full_name, status: 'pending' })),
          ],
        });
      }

      const minAvailable = intervalCells.length > 0
        ? Math.min(...intervalCells.map(c => c.availableHc))
        : 0;
      const peakScheduled = intervalCells.length > 0
        ? Math.max(...intervalCells.map(c => c.scheduledHc))
        : 0;
      const peakOnPerm = intervalCells.length > 0
        ? Math.max(...intervalCells.map(c => c.onPermissionHc + c.pendingHc))
        : 0;

      const fnRisk = intervalCells.some(c => c.riskLevel === 'critical')
        ? 'critical' : intervalCells.some(c => c.riskLevel === 'warning') ? 'warning' : 'ok';

      if (fnRisk === 'critical' && peakScheduled > 0) {
        warnings.push(`⚠️ ${fn.name}: تحت الحد الأدنى في بعض الفترات`);
      }

      results.push({
        functionId: fn.id,
        functionName: fn.name,
        intervals: intervalCells,
        peakScheduledHc: peakScheduled,
        peakOnPermHc: peakOnPerm,
        minAvailableHc: minAvailable,
        overallRisk: fnRisk as any,
      });
    }

    return {
      date,
      functions: results,
      worstRisk,
      warnings,
    };
  }

  // ── Get single request with impact ────────────────────────────────────────

  async getRequestWithImpact(tenantId: string, requestId: string): Promise<{
    request: PermissionRequestRow;
    impact: HcImpactResult;
  }> {
    const { rows } = await this.getRequests(tenantId, {});
    const req = rows.find(r => r.id === requestId);
    // Fetch directly if not in default page
    const allRows = await this.ds.query(
      `SELECT r.id, r.employee_id, e.first_name_en || ' ' || e.last_name_en AS employee_name, e.employee_no,
              fn.name AS function_name, fn.id AS function_id,
              rp.permission_date::text, rp.start_time::text, rp.end_time::text,
              rp.duration_minutes, rp.permission_type, rp.reason, rp.function_id AS rp_function_id,
              r.status, r.is_urgent, r.submitted_at, r.notes, r.rejection_reason, r.hc_impact, r.sla_due_at,
              u1.first_name || ' ' || u1.last_name AS approver_l1_name,
              u2.first_name || ' ' || u2.last_name AS approver_l2_name
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id AND rt.code = 'permission'
       JOIN request_permissions rp ON rp.request_id = r.id
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN functions fn ON fn.id = COALESCE(rp.function_id, e.function_id)
       LEFT JOIN users u1 ON u1.id = r.approver_l1_id
       LEFT JOIN users u2 ON u2.id = r.approver_l2_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!allRows.length) throw new NotFoundException('Request not found');
    const row = allRows[0];

    const permRow: PermissionRequestRow = {
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      employeeNo: row.employee_no,
      functionName: row.function_name,
      functionId: row.rp_function_id ?? row.function_id,
      permissionDate: row.permission_date,
      startTime: row.start_time?.slice(0, 5) ?? '',
      endTime: row.end_time?.slice(0, 5) ?? '',
      durationMinutes: row.duration_minutes,
      permissionType: row.permission_type ?? null,
      reason: row.reason,
      status: row.status,
      isUrgent: row.is_urgent,
      submittedAt: row.submitted_at,
      approverL1Name: row.approver_l1_name ?? null,
      approverL2Name: row.approver_l2_name ?? null,
      notes: row.notes ?? null,
      rejectionReason: row.rejection_reason ?? null,
      hcImpact: row.hc_impact ?? null,
      slaRemainingHours: row.sla_due_at
        ? Math.round((new Date(row.sla_due_at).getTime() - Date.now()) / 3_600_000)
        : null,
    };

    const impact = await this.calculateHcImpact(tenantId, {
      date: row.permission_date,
      startTime: row.start_time?.slice(0, 5) ?? '09:00',
      endTime: row.end_time?.slice(0, 5) ?? '10:00',
      functionId: row.rp_function_id ?? row.function_id ?? undefined,
      excludeRequestId: requestId,
    });

    impact.requestId     = requestId;
    impact.employeeName  = row.employee_name;
    impact.employeeFunction = row.function_name;
    impact.permissionStart  = row.start_time?.slice(0, 5);
    impact.permissionEnd    = row.end_time?.slice(0, 5);

    return { request: permRow, impact };
  }

  // ── HC Dashboard (date-level overview) ────────────────────────────────────

  async getHcDashboard(tenantId: string, date: string): Promise<HcImpactResult> {
    return this.calculateHcImpact(tenantId, {
      date,
      startTime: '06:00',
      endTime:   '23:30',
    });
  }

  // ── Weekly usage summary (quota check) ────────────────────────────────────

  async getWeeklyUsage(tenantId: string, employeeId: string, date: string): Promise<{
    weekStart: string;
    weekEnd: string;
    used: number;
    remaining: number;
    max: number;
    requests: { id: string; permissionDate: string; startTime: string; endTime: string; durationMinutes: number; permissionType: string | null; status: string }[];
  }> {
    const permDate = new Date(date);
    const dayOfWeek = permDate.getDay();
    const daysSinceSat = (dayOfWeek + 1) % 7;
    const weekSat = new Date(permDate);
    weekSat.setDate(permDate.getDate() - daysSinceSat);
    const weekFri = new Date(weekSat);
    weekFri.setDate(weekSat.getDate() + 6);
    const weekSatStr = weekSat.toISOString().slice(0, 10);
    const weekFriStr = weekFri.toISOString().slice(0, 10);

    const rows = await this.ds.query(
      `SELECT r.id, rp.permission_date::text, rp.start_time::text, rp.end_time::text,
              rp.duration_minutes, rp.permission_type, r.status
       FROM requests r
       JOIN request_permissions rp ON rp.request_id = r.id
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1
         AND r.employee_id = $2
         AND rt.code = 'permission'
         AND rp.permission_date BETWEEN $3::date AND $4::date
         AND r.status NOT IN ('rejected','cancelled')
       ORDER BY rp.permission_date, rp.start_time`,
      [tenantId, employeeId, weekSatStr, weekFriStr],
    );

    const used = rows.length;
    return {
      weekStart: weekSatStr,
      weekEnd: weekFriStr,
      used,
      remaining: Math.max(0, PERMISSION_RULES.MAX_PER_WEEK - used),
      max: PERMISSION_RULES.MAX_PER_WEEK,
      requests: rows.map((r: any) => ({
        id: r.id,
        permissionDate: r.permission_date,
        startTime: r.start_time?.slice(0, 5) ?? '',
        endTime: r.end_time?.slice(0, 5) ?? '',
        durationMinutes: r.duration_minutes,
        permissionType: r.permission_type ?? null,
        status: r.status,
      })),
    };
  }

  // ── Get employees for selector ──────────────────────────────────────────────

  async getEmployees(tenantId: string): Promise<{ id: string; name: string; employeeNo: string; functionId: string; functionName: string }[]> {
    const rows = await this.ds.query(
      `SELECT e.id, e.first_name_en || ' ' || e.last_name_en AS name, e.employee_no, e.function_id,
              fn.name AS function_name
       FROM employees e
       LEFT JOIN functions fn ON fn.id = e.function_id
       WHERE e.tenant_id = $1 AND e.status = 'active'
       ORDER BY e.first_name_en`,
      [tenantId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      employeeNo: r.employee_no,
      functionId: r.function_id,
      functionName: r.function_name,
    }));
  }
}
