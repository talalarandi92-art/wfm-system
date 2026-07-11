import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BreakSchedulerService } from './break-scheduler.service';
import { BreakPolicyService } from './break-policy.service';

@Injectable()
export class BreaksService {
  private readonly logger = new Logger(BreaksService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduler: BreakSchedulerService,
    private readonly policyService: BreakPolicyService,
  ) {}

  // ── Live queue state (Sprinklr bridge) — drives the auto-approve decision ──
  // Thresholds: auto-approve only when, AFTER this agent leaves, at least
  // MIN_AVAILABLE agents remain AND no queue is at risk.
  private static readonly MIN_AVAILABLE_AFTER_BREAK = 3;

  async getLiveQueueState(tenantId: string): Promise<{
    fresh: boolean; capturedAt: string | null; staleSec: number;
    availableNow: number; busyNow: number; onBreakNow: number;
    totalWaiting: number; atRiskQueues: { name: string; waiting: number; slaPct: number }[];
  } | null> {
    try {
      const [row] = await this.dataSource.query(
        `SELECT captured_at, queues_json, agents_json FROM integration_snapshots
         WHERE tenant_id = $1 AND source = 'sprinklr'
         ORDER BY captured_at DESC LIMIT 1`,
        [tenantId],
      );
      if (!row) return null;
      const parse = (v: any) => (Array.isArray(v) ? v : JSON.parse(v || '[]'));
      const agents: any[] = parse(row.agents_json);
      const queues: any[] = parse(row.queues_json);
      const atRisk = queues
        .filter(q => (q.slaPct ?? 100) < 80 || (q.waiting ?? 0) > 50)
        .map(q => ({ name: q.queueName, waiting: q.waiting ?? 0, slaPct: q.slaPct ?? 100 }));
      return {
        fresh:        Date.now() - new Date(row.captured_at).getTime() < 5 * 60_000,
        capturedAt:   row.captured_at,
        staleSec:     Math.round((Date.now() - new Date(row.captured_at).getTime()) / 1000),
        availableNow: agents.filter(a => a.status === 'available' || a.status === 'idle').length,
        busyNow:      agents.filter(a => a.status === 'busy').length,
        onBreakNow:   agents.filter(a => a.status === 'break' || a.status === 'away').length,
        totalWaiting: queues.reduce((s, q) => s + (q.waiting ?? 0), 0),
        atRiskQueues: atRisk,
      };
    } catch {
      return null;
    }
  }

  // ── Notifications: employee + RTA/WFM ──────────────────────────────────────
  private async notifyBreakEvent(tenantId: string, opts: {
    employeeId: string; requestId: string;
    status: 'auto_approved' | 'pending' | 'approved' | 'rejected';
    window: string;             // "14:30–14:45"
    impactLine?: string;        // EN impact summary
    impactLineAr?: string;      // AR impact summary
    reason?: string;
  }): Promise<void> {
    const TXT: Record<string, { t: string; ta: string; b: string; ba: string }> = {
      auto_approved: {
        t: 'Break auto-approved',           ta: 'تمت الموافقة على البريك تلقائياً',
        b: `Your break ${opts.window} was auto-approved — queue coverage allows it.`,
        ba: `بريكك ${opts.window} اعتُمد تلقائياً — وضع الطوابير يسمح.`,
      },
      pending: {
        t: 'Break request pending review',  ta: 'طلب البريك قيد المراجعة',
        b: `Your break request ${opts.window} needs RTA review. ${opts.impactLine ?? ''}`,
        ba: `طلب بريكك ${opts.window} يحتاج مراجعة الـ RTA. ${opts.impactLineAr ?? ''}`,
      },
      approved: {
        t: 'Break approved',                ta: 'تمت الموافقة على البريك',
        b: `Your break ${opts.window} was approved.`,
        ba: `تمت الموافقة على بريكك ${opts.window}.`,
      },
      rejected: {
        t: 'Break request rejected',        ta: 'تم رفض طلب البريك',
        b: `Your break request ${opts.window} was rejected. ${opts.reason ?? ''}`,
        ba: `تم رفض طلب بريكك ${opts.window}. ${opts.reason ?? ''}`,
      },
    };
    const txt = TXT[opts.status];

    try {
      // 1. The employee (their user account)
      await this.dataSource.query(
        `INSERT INTO notifications
           (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar,
            entity_type, entity_id, action_url)
         SELECT $1, u.id, 'break_request', $2, $3, $4, $5, 'break_request', $6, '/breaks'
         FROM users u WHERE u.tenant_id = $1 AND u.employee_id = $7 AND u.status = 'active'`,
        [tenantId, txt.t, txt.ta, txt.b, txt.ba, opts.requestId, opts.employeeId],
      );

      // 2. RTA / WFM — only for events they act on or must watch live
      if (opts.status === 'pending' || opts.status === 'auto_approved') {
        const empRows = await this.dataSource.query(
          `SELECT TRIM(CONCAT(first_name_en,' ',COALESCE(last_name_en,''))) AS name
           FROM employees WHERE id = $1`, [opts.employeeId]);
        const empName = empRows?.[0]?.name ?? 'Employee';
        const rtaTitle   = opts.status === 'pending' ? 'Break request needs review' : 'Break auto-approved';
        const rtaTitleAr = opts.status === 'pending' ? 'طلب بريك يحتاج مراجعة'      : 'بريك معتمد تلقائياً';
        await this.dataSource.query(
          `INSERT INTO notifications
             (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar,
              entity_type, entity_id, action_url)
           SELECT $1, u.id, 'break_request', $2, $3, $4, $5, 'break_request', $6, '/breaks'
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE u.tenant_id = $1 AND u.status = 'active'
             AND r.code IN ('rta', 'wfm_analyst')
             AND u.username <> 'wfm-bridge'`,
          [
            tenantId, rtaTitle, rtaTitleAr,
            `${empName} — ${opts.window}. ${opts.impactLine ?? ''}`,
            `${empName} — ${opts.window}. ${opts.impactLineAr ?? ''}`,
            opts.requestId,
          ],
        );
      }
    } catch (e: any) {
      this.logger.warn(`Break notification failed: ${e.message}`);
    }
  }

  // ── Generate break schedule for a date (idempotent regenerate) ──────────────
  // Replaces ONLY auto+'scheduled' slots for the date; active/completed/manual
  // slots are never touched (the scheduler already numbered around them and
  // pre-occupied their coverage).
  async generate(
    tenantId: string,
    scheduleDate: string,
    functionId?: string,
    actor?: { id?: string | null; email?: string | null },
  ) {
    const result = await this.scheduler.generateForDate(tenantId, scheduleDate, functionId);

    // optimization_version increments per regenerate of the date
    const [ver] = await this.dataSource.query(
      `SELECT COALESCE(MAX(optimization_version), 0) + 1 AS v
       FROM break_slots WHERE tenant_id = $1 AND schedule_date = $2::date`,
      [tenantId, scheduleDate],
    );
    const optimizationVersion = Number(ver?.v ?? 1);

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let inserted = 0;
    try {
      // Idempotent replace: drop previous auto-scheduled plan for the date only.
      await qr.query(
        `DELETE FROM break_slots
         WHERE tenant_id = $1 AND schedule_date = $2::date
           AND status = 'scheduled' AND generated_by = 'auto'`,
        [tenantId, scheduleDate],
      );

      for (const slot of result.slots) {
        await qr.query(
          `INSERT INTO break_slots
             (tenant_id, employee_id, schedule_date, break_type_id, slot_number,
              planned_start, planned_end, planned_date, earliest_start, latest_start,
              generated_reason, optimization_version, priority_score, generated_by, status)
           VALUES ($1,$2,$3::date,$4,$5,$6::time,$7::time,$8::date,$9::time,$10::time,$11,$12,$13,'auto','scheduled')
           ON CONFLICT (tenant_id, employee_id, schedule_date, slot_number) DO NOTHING`,
          [
            slot.tenant_id, slot.employee_id, slot.schedule_date, slot.break_type_id,
            slot.slot_number, slot.planned_start, slot.planned_end, slot.planned_date,
            slot.earliest_start, slot.latest_start, slot.generated_reason,
            optimizationVersion, slot.priority_score,
          ],
        );
        inserted += 1;
      }
      await qr.commitTransaction();
    } catch (e) {
      await qr.rollbackTransaction().catch(() => {});
      throw e;
    } finally {
      await qr.release();
    }

    if (inserted === 0) {
      await this.policyService.audit(tenantId, actor ?? null, 'breaks.generate', 'break_slots', null,
        `${scheduleDate}: 0 slots (coverage=${result.coverageSource}, v${optimizationVersion}); warnings=${result.warnings.length}`);
      return { inserted: 0, warnings: result.warnings, coverageSource: result.coverageSource, optimizationVersion, message: 'No break slots generated.' };
    }

    // Fairness ledger — including the early/mid/late slot-position counts
    for (const [empId, fair] of result.fairnessMap.entries()) {
      const [year, month] = scheduleDate.split('-').map(Number);
      await this.dataSource.query(
        `INSERT INTO break_fairness
           (tenant_id, employee_id, period_year, period_month, fairness_score,
            early_slot_count, mid_slot_count, late_slot_count, total_breaks, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (tenant_id, employee_id, period_year, period_month)
         DO UPDATE SET
           fairness_score   = break_fairness.fairness_score   + $5,
           early_slot_count = break_fairness.early_slot_count + $6,
           mid_slot_count   = break_fairness.mid_slot_count   + $7,
           late_slot_count  = break_fairness.late_slot_count  + $8,
           total_breaks     = break_fairness.total_breaks     + $9,
           updated_at       = NOW()`,
        [tenantId, empId, year, month, fair.delta, fair.early, fair.mid, fair.late,
         fair.early + fair.mid + fair.late],
      );
    }

    await this.policyService.audit(tenantId, actor ?? null, 'breaks.generate', 'break_slots', null,
      `${scheduleDate}: ${inserted} slots generated (coverage=${result.coverageSource}, v${optimizationVersion}, warnings=${result.warnings.length})`);

    return {
      inserted,
      warnings: result.warnings,
      coverageSource: result.coverageSource,
      optimizationVersion,
      message: `Generated ${inserted} break slots.`,
    };
  }

  // ── Get daily break schedule ─────────────────────────────────────────────────
  async getSchedule(tenantId: string, scheduleDate: string, functionId?: string) {
    const rows = await this.dataSource.query(
      `SELECT
        bs.id, bs.schedule_date,
        bs.planned_start, bs.planned_end,
        bs.actual_start, bs.actual_end,
        bs.status, bs.slot_number, bs.generated_by,
        bs.late_minutes, bs.early_end_minutes, bs.is_missed, bs.notes,
        e.id AS employee_id,
        e.employee_no,
        (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
        e.gender,
        f.id AS function_id, f.name AS function_name,
        bt.id AS break_type_id,
        bt.name AS break_type, bt.name_ar AS break_type_ar,
        bt.duration_minutes, bt.color, bt.icon,
        bt.is_mandatory, bt.is_prayer,
        to_char(ar.scheduled_start,'HH24:MI') AS shift_start,
        to_char(ar.scheduled_end,'HH24:MI')   AS shift_end
       FROM break_slots bs
       JOIN employees  e  ON e.id  = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       JOIN break_types bt ON bt.id = bs.break_type_id
       LEFT JOIN attendance_records ar
         ON ar.tenant_id = bs.tenant_id AND ar.employee_id = bs.employee_id
        AND ar.attendance_date = bs.schedule_date
       WHERE bs.tenant_id = $1
         AND bs.schedule_date = $2::date
         ${functionId ? 'AND e.function_id = $3' : ''}
       ORDER BY e.first_name_en, e.last_name_en, bs.planned_start`,
      functionId ? [tenantId, scheduleDate, functionId] : [tenantId, scheduleDate],
    );

    return rows;
  }

  // ── Get break schedule for a single employee ─────────────────────────────────
  async getEmployeeSchedule(tenantId: string, employeeId: string, scheduleDate: string) {
    return this.dataSource.query(
      `SELECT bs.*, bt.name, bt.name_ar, bt.color, bt.icon, bt.is_prayer, bt.duration_minutes
       FROM break_slots bs
       JOIN break_types bt ON bt.id = bs.break_type_id
       WHERE bs.tenant_id = $1 AND bs.employee_id = $2 AND bs.schedule_date = $3::date
       ORDER BY bs.planned_start`,
      [tenantId, employeeId, scheduleDate],
    );
  }

  // ── Submit break request (agent requesting time change) ──────────────────────
  async submitRequest(tenantId: string, employeeId: string, dto: {
    scheduleDate: string;
    breakTypeId: string;
    requestedStart: string;
    requestedEnd: string;
    reason?: string;
    breakSlotId?: string;
    overrideEntitlement?: boolean;   // explicit manual exception — audited
  }, actor?: { id?: string | null; email?: string | null }) {
    // 0. ENTITLEMENT GATE (B1): max_sessions + total_daily_minutes from the
    //    resolved break policy. Manual exception only via explicit override flag,
    //    which is recorded in the audit trail.
    const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    let reqMin = toMin(dto.requestedEnd) - toMin(dto.requestedStart);
    if (reqMin <= 0) reqMin += 1440; // cross-midnight window
    const ent = await this.policyService.enforceEntitlement(tenantId, employeeId, dto.scheduleDate, reqMin);
    if (!ent.allowed) {
      if (!dto.overrideEntitlement) {
        throw new BadRequestException(`${ent.reasonAr} — ${ent.reason}`);
      }
      await this.policyService.audit(tenantId, actor ?? null, 'breaks.entitlement.override', 'break_request', null,
        `employee=${employeeId} date=${dto.scheduleDate} requested=${reqMin}m over limit (${ent.reason})`);
    }

    // 1. Scheduled coverage impact (from break slots / schedule)
    const coverageBefore = await this.getCoverageSnapshot(tenantId, dto.scheduleDate, dto.requestedStart, dto.requestedEnd);

    // Simulate coverage after approving request
    const coverageAfter = coverageBefore.map(c => ({
      ...c,
      on_break: c.on_break + 1,
      available: c.available - 1,
      gap: c.gap - 1,
    }));

    // Math.min() of an empty array is Infinity — would auto-approve everything!
    const minGap = coverageAfter.length
      ? Math.min(...coverageAfter.map(c => c.gap))
      : null;
    const scheduledOk = minGap == null ? true : minGap >= 0; // unknown schedule → don't block on it

    // 2. LIVE queue state (Sprinklr bridge) — the real-time gate
    const live = await this.getLiveQueueState(tenantId);
    const availableAfter = live ? live.availableNow - 1 : null;
    const liveOk = !!live && live.fresh
      && availableAfter! >= BreaksService.MIN_AVAILABLE_AFTER_BREAK
      && live.atRiskQueues.length === 0;

    // Auto-approve ONLY when both the schedule and the live queues allow it.
    // No fresh live data → human (RTA) decides.
    const autoApproveEligible = scheduledOk && liveOk;

    const liveImpact = live ? {
      capturedAt:     live.capturedAt,
      fresh:          live.fresh,
      availableNow:   live.availableNow,
      availableAfter,
      busyNow:        live.busyNow,
      onBreakNow:     live.onBreakNow,
      totalWaiting:   live.totalWaiting,
      atRiskQueues:   live.atRiskQueues,
      decision:       autoApproveEligible ? 'auto_approved'
                      : !live.fresh ? 'pending_no_live_data'
                      : live.atRiskQueues.length ? 'pending_queues_at_risk'
                      : availableAfter! < BreaksService.MIN_AVAILABLE_AFTER_BREAK ? 'pending_low_coverage'
                      : 'pending_schedule_gap',
      minAvailableThreshold: BreaksService.MIN_AVAILABLE_AFTER_BREAK,
    } : { capturedAt: null, fresh: false, decision: 'pending_no_live_data' as const };

    const [req] = await this.dataSource.query(
      `INSERT INTO break_requests
         (tenant_id, employee_id, break_slot_id, schedule_date, break_type_id,
          requested_start, requested_end, reason,
          coverage_before_json, coverage_after_json, min_coverage_gap,
          auto_approve_eligible, status)
       VALUES ($1,$2,$3,$4::date,$5,$6::time,$7::time,$8,$9,$10,$11,$12,
               CASE WHEN $12 THEN 'auto_approved' ELSE 'pending' END)
       RETURNING id, status, auto_approve_eligible`,
      [
        tenantId,
        employeeId,
        dto.breakSlotId ?? null,
        dto.scheduleDate,
        dto.breakTypeId,
        dto.requestedStart,
        dto.requestedEnd,
        dto.reason ?? null,
        JSON.stringify({ intervals: coverageBefore, live: liveImpact }),
        JSON.stringify({ intervals: coverageAfter,  live: liveImpact }),
        minGap ?? 0,
        autoApproveEligible,
      ],
    );

    // If auto-approved, update the slot immediately
    if (autoApproveEligible && dto.breakSlotId) {
      await this.dataSource.query(
        `UPDATE break_slots
         SET planned_start = $1::time, planned_end = $2::time,
             status = 'scheduled', updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
        [dto.requestedStart, dto.requestedEnd, dto.breakSlotId, tenantId],
      );
    }

    // Notify the employee + RTA/WFM with the live impact
    const window = `${dto.requestedStart.slice(0, 5)}–${dto.requestedEnd.slice(0, 5)}`;
    const lv = liveImpact as any;
    const impactLine = lv.availableNow != null
      ? `Available now ${lv.availableNow} → ${lv.availableAfter} after. Waiting: ${lv.totalWaiting}. At-risk queues: ${lv.atRiskQueues?.length ?? 0}.`
      : 'No live queue data.';
    const impactLineAr = lv.availableNow != null
      ? `المتاحين الآن ${lv.availableNow} ← ${lv.availableAfter} بعد الموافقة. بالانتظار: ${lv.totalWaiting}. طوابير بخطر: ${lv.atRiskQueues?.length ?? 0}.`
      : 'لا توجد بيانات حية من الطوابير.';
    void this.notifyBreakEvent(tenantId, {
      employeeId, requestId: req.id,
      status: autoApproveEligible ? 'auto_approved' : 'pending',
      window, impactLine, impactLineAr,
    });

    return {
      requestId: req.id,
      status: req.status,
      autoApproved: req.auto_approve_eligible,
      coverageImpact: { before: coverageBefore, after: coverageAfter, minGap },
      liveImpact,
    };
  }

  // ── List break requests ───────────────────────────────────────────────────────
  async listRequests(tenantId: string, filters: {
    status?: string;
    employeeId?: string;
    functionId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['br.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filters.status)     { params.push(filters.status);     conditions.push(`br.status = $${params.length}`); }
    if (filters.employeeId) { params.push(filters.employeeId); conditions.push(`br.employee_id = $${params.length}`); }
    if (filters.dateFrom)   { params.push(filters.dateFrom);   conditions.push(`br.schedule_date >= $${params.length}::date`); }
    if (filters.dateTo)     { params.push(filters.dateTo);     conditions.push(`br.schedule_date <= $${params.length}::date`); }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      this.dataSource.query(
        `SELECT
          br.id, br.schedule_date, br.requested_start, br.requested_end,
          br.reason, br.status, br.auto_approve_eligible, br.min_coverage_gap,
          br.coverage_before_json, br.coverage_after_json,
          br.reviewed_at, br.review_comment, br.created_at,
          (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
          e.employee_no, e.gender,
          f.name AS function_name,
          bt.name AS break_type, bt.name_ar AS break_type_ar,
          bt.color, bt.icon, bt.is_prayer,
          (ru.first_name || ' ' || COALESCE(ru.last_name,'')) AS reviewed_by
         FROM break_requests br
         JOIN employees  e  ON e.id = br.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         JOIN break_types bt ON bt.id = br.break_type_id
         LEFT JOIN users ru ON ru.id = br.reviewed_by_id
         WHERE ${where}
         ORDER BY br.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      this.dataSource.query(`SELECT COUNT(*) FROM break_requests br WHERE ${where}`, params),
    ]);

    return {
      data: rows,
      total: parseInt(countResult[0].count, 10),
      page,
      limit,
    };
  }

  // ── Approve request ──────────────────────────────────────────────────────────
  async approveRequest(tenantId: string, requestId: string, reviewerId: string, comment?: string) {
    const [req] = await this.dataSource.query(
      `SELECT * FROM break_requests WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!req) throw new NotFoundException('Break request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request is not pending');

    // Coverage re-check before approval (empty coverage → no data, don't block)
    const coverage = await this.getCoverageSnapshot(
      tenantId, req.schedule_date, req.requested_start, req.requested_end,
    );
    const minGap = coverage.length ? Math.min(...coverage.map(c => c.gap - 1)) : null;
    if (minGap != null && minGap < -1) {
      throw new BadRequestException(
        `Approval would cause critical undercoverage (gap: ${minGap}). Reject or reschedule.`,
      );
    }

    await this.dataSource.query(
      `UPDATE break_requests
       SET status = 'approved', reviewed_by_id = $1, reviewed_at = NOW(),
           review_comment = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [reviewerId, comment ?? null, requestId, tenantId],
    );

    // Update the actual slot
    if (req.break_slot_id) {
      await this.dataSource.query(
        `UPDATE break_slots
         SET planned_start = $1::time, planned_end = $2::time, updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
        [req.requested_start, req.requested_end, req.break_slot_id, tenantId],
      );
    }

    void this.notifyBreakEvent(tenantId, {
      employeeId: req.employee_id, requestId,
      status: 'approved',
      window: `${String(req.requested_start).slice(0, 5)}–${String(req.requested_end).slice(0, 5)}`,
    });

    return { success: true, message: 'Break request approved.' };
  }

  // ── Reject request ───────────────────────────────────────────────────────────
  async rejectRequest(tenantId: string, requestId: string, reviewerId: string, reason: string) {
    const [req] = await this.dataSource.query(
      `SELECT id, status, employee_id, requested_start, requested_end
       FROM break_requests WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId],
    );
    if (!req) throw new NotFoundException('Break request not found');
    if (req.status !== 'pending') throw new BadRequestException('Request is not pending');

    await this.dataSource.query(
      `UPDATE break_requests
       SET status = 'rejected', reviewed_by_id = $1, reviewed_at = NOW(),
           review_comment = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [reviewerId, reason, requestId, tenantId],
    );

    void this.notifyBreakEvent(tenantId, {
      employeeId: req.employee_id, requestId,
      status: 'rejected',
      window: `${String(req.requested_start).slice(0, 5)}–${String(req.requested_end).slice(0, 5)}`,
      reason,
    });

    return { success: true, message: 'Break request rejected.' };
  }

  // ── Coverage impact by interval ──────────────────────────────────────────────
  async getCoverage(tenantId: string, scheduleDate: string, functionId?: string) {
    return this.dataSource.query(
      `SELECT
        TO_CHAR(hi.interval_start, 'HH24:MI') AS interval_start,
        TO_CHAR(hi.interval_end,   'HH24:MI') AS interval_end,
        hi.required_hc,
        hi.scheduled_hc,
        COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0) AS on_break,
        hi.scheduled_hc - COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0) AS available,
        hi.scheduled_hc - COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0) - hi.required_hc AS gap,
        CASE
          WHEN hi.required_hc = 0 THEN 'ok'
          WHEN (hi.scheduled_hc - COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0))::numeric / hi.required_hc >= 0.9 THEN 'ok'
          WHEN (hi.scheduled_hc - COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0))::numeric / hi.required_hc >= 0.7 THEN 'warn'
          ELSE 'critical'
        END AS risk_level
       FROM headcount_intervals hi
       LEFT JOIN break_slots bs
         ON bs.tenant_id = hi.tenant_id
        AND bs.schedule_date = hi.snapshot_date
        AND hi.interval_start::time <= bs.planned_end
        AND hi.interval_end::time   >= bs.planned_start
        AND bs.status IN ('scheduled','active')
       WHERE hi.tenant_id = $1 AND hi.snapshot_date = $2::date
         ${functionId ? 'AND hi.function_id = $3' : ''}
       GROUP BY hi.interval_start, hi.interval_end, hi.required_hc, hi.scheduled_hc
       ORDER BY hi.interval_start`,
      functionId ? [tenantId, scheduleDate, functionId] : [tenantId, scheduleDate],
    );
  }

  // ── Adherence report ─────────────────────────────────────────────────────────
  async getAdherence(tenantId: string, scheduleDate: string, functionId?: string) {
    return this.dataSource.query(
      `SELECT
        (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
        e.employee_no, f.name AS function_name,
        COUNT(bs.id)                                        AS total_breaks,
        COUNT(CASE WHEN bs.is_missed THEN 1 END)            AS missed_breaks,
        SUM(COALESCE(bs.late_minutes, 0))                   AS total_late_minutes,
        SUM(COALESCE(bs.early_end_minutes, 0))              AS total_early_end_minutes,
        ROUND(
          100.0 * COUNT(CASE WHEN bs.status = 'completed' AND NOT bs.is_missed THEN 1 END)
          / NULLIF(COUNT(bs.id), 0), 1
        ) AS adherence_pct
       FROM break_slots bs
       JOIN employees  e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bs.tenant_id = $1 AND bs.schedule_date = $2::date
         ${functionId ? 'AND e.function_id = $3' : ''}
       GROUP BY e.id, e.first_name_en, e.last_name_en, e.employee_no, f.name
       ORDER BY adherence_pct ASC NULLS LAST`,
      functionId ? [tenantId, scheduleDate, functionId] : [tenantId, scheduleDate],
    );
  }

  // ── Update actual break times (RTA marks completion) ─────────────────────────
  async recordActual(tenantId: string, slotId: string, dto: {
    actualStart?: string;
    actualEnd?: string;
    status: string;
    notes?: string;
  }) {
    const lateMin = dto.actualStart && dto.actualEnd
      ? await this.computeLateMinutes(tenantId, slotId, dto.actualStart)
      : 0;

    // Load the slot BEFORE the update so a repeat 'completed' isn't double-posted
    // into the daily balance ledger.
    const [slot] = await this.dataSource.query(
      `SELECT employee_id, schedule_date::text AS schedule_date,
              COALESCE(planned_date, schedule_date)::text AS planned_date,
              planned_start::text, planned_end::text, status AS prev_status
       FROM break_slots WHERE id = $1 AND tenant_id = $2`,
      [slotId, tenantId],
    );
    if (!slot) throw new NotFoundException('Break slot not found');

    await this.dataSource.query(
      `UPDATE break_slots
       SET actual_start = $1::time,
           actual_end   = $2::time,
           status       = $3::text,
           late_minutes = $4,
           is_missed    = ($3::text = 'missed'),
           notes        = $5,
           updated_at   = NOW()
       WHERE id = $6 AND tenant_id = $7`,
      [
        dto.actualStart ?? null,
        dto.actualEnd ?? null,
        dto.status,
        lateMin,
        dto.notes ?? null,
        slotId,
        tenantId,
      ],
    );

    // B1: maintain break_daily_balance transactionally on slot COMPLETION.
    if (dto.status === 'completed' && slot.prev_status !== 'completed') {
      const toMin = (t?: string | null) => {
        if (!t) return null;
        const [h, m] = String(t).split(':').map(Number);
        return isNaN(h) ? null : h * 60 + (m || 0);
      };
      const as = toMin(dto.actualStart), ae = toMin(dto.actualEnd);
      const ps = toMin(slot.planned_start), pe = toMin(slot.planned_end);
      let consumed = (as != null && ae != null) ? ae - as : (ps != null && pe != null ? pe - ps : 0);
      if (consumed < 0) consumed += 1440; // cross-midnight break
      const endHHMM = (dto.actualEnd ?? slot.planned_end ?? '').slice(0, 5);
      const endAt = endHHMM ? new Date(`${slot.planned_date}T${endHHMM}:00+03:00`) : null;
      await this.policyService.recordCompletion(
        tenantId, slot.employee_id, slot.schedule_date, consumed, endAt,
      ).catch((e) => this.logger.warn(`break_daily_balance update failed for slot ${slotId}: ${e.message}`));
    }

    return { success: true };
  }

  // ── Fairness report ──────────────────────────────────────────────────────────
  async getFairness(tenantId: string, year: number, month: number, functionId?: string) {
    return this.dataSource.query(
      `SELECT
        (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
        e.employee_no, f.name AS function_name,
        bf.early_slot_count, bf.mid_slot_count, bf.late_slot_count,
        bf.prayer_break_count, bf.total_breaks, bf.missed_breaks,
        bf.total_late_minutes, bf.adherence_pct, bf.fairness_score
       FROM break_fairness bf
       JOIN employees e ON e.id = bf.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bf.tenant_id = $1 AND bf.period_year = $2 AND bf.period_month = $3
         ${functionId ? 'AND e.function_id = $4' : ''}
       ORDER BY bf.fairness_score DESC`,
      functionId ? [tenantId, year, month, functionId] : [tenantId, year, month],
    );
  }

  // ── Break types list ─────────────────────────────────────────────────────────
  async getBreakTypes(tenantId: string) {
    return this.dataSource.query(
      `SELECT * FROM break_types WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order`,
      [tenantId],
    );
  }

  // ── Prayer times for date ────────────────────────────────────────────────────
  async getPrayerTimes(tenantId: string, date: string) {
    const [row] = await this.dataSource.query(
      `SELECT * FROM prayer_times WHERE tenant_id = $1 AND prayer_date = $2::date`,
      [tenantId, date],
    );
    return row ?? null;
  }

  // ── Upsert prayer times ──────────────────────────────────────────────────────
  async upsertPrayerTimes(tenantId: string, dto: {
    date: string; dhuhr?: string; asr?: string; maghrib?: string;
  }) {
    await this.dataSource.query(
      `INSERT INTO prayer_times (tenant_id, prayer_date, dhuhr, asr, maghrib)
       VALUES ($1, $2::date, $3::time, $4::time, $5::time)
       ON CONFLICT (tenant_id, prayer_date, location)
       DO UPDATE SET dhuhr=$3::time, asr=$4::time, maghrib=$5::time`,
      [tenantId, dto.date, dto.dhuhr ?? null, dto.asr ?? null, dto.maghrib ?? null],
    );
    return { success: true };
  }

  // ── Private: get coverage snapshot for an interval ──────────────────────────
  private async getCoverageSnapshot(
    tenantId: string,
    scheduleDate: string,
    startTime: string,
    endTime: string,
  ) {
    return this.dataSource.query(
      `SELECT
        TO_CHAR(hi.interval_start, 'HH24:MI') AS interval,
        hi.required_hc,
        hi.scheduled_hc,
        COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0) AS on_break,
        hi.scheduled_hc - COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0) AS available,
        hi.scheduled_hc - COALESCE(SUM(CASE WHEN bs.status IN ('scheduled','active') THEN 1 ELSE 0 END), 0) - hi.required_hc AS gap
       FROM headcount_intervals hi
       LEFT JOIN break_slots bs
         ON bs.tenant_id = hi.tenant_id
        AND bs.schedule_date = hi.snapshot_date
        AND hi.interval_start::time <= bs.planned_end
        AND hi.interval_end::time   >= bs.planned_start
       WHERE hi.tenant_id = $1 AND hi.snapshot_date = $2::date
         AND hi.interval_start::time >= $3::time
         AND hi.interval_end::time   <= $4::time
       GROUP BY hi.interval_start, hi.interval_end, hi.required_hc, hi.scheduled_hc
       ORDER BY hi.interval_start`,
      [tenantId, scheduleDate, startTime, endTime],
    );
  }

  private async computeLateMinutes(tenantId: string, slotId: string, actualStart: string): Promise<number> {
    const [slot] = await this.dataSource.query(
      `SELECT planned_start FROM break_slots WHERE id = $1 AND tenant_id = $2`,
      [slotId, tenantId],
    );
    if (!slot) return 0;
    const planned = slot.planned_start.slice(0, 5);
    const [ph, pm] = planned.split(':').map(Number);
    const [ah, am] = actualStart.split(':').map(Number);
    return Math.max(0, (ah * 60 + am) - (ph * 60 + pm));
  }
}
