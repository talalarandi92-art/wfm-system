import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BreakSchedulerService } from './break-scheduler.service';

@Injectable()
export class BreaksService {
  private readonly logger = new Logger(BreaksService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduler: BreakSchedulerService,
  ) {}

  // ── Generate break schedule for a date ──────────────────────────────────────
  async generate(tenantId: string, scheduleDate: string, functionId?: string) {
    const result = await this.scheduler.generateForDate(tenantId, scheduleDate, functionId);

    if (result.slots.length === 0) {
      return { inserted: 0, warnings: result.warnings, message: 'No break slots generated.' };
    }

    // Upsert generated slots
    const inserted: number[] = [];
    for (const slot of result.slots) {
      await this.dataSource.query(
        `INSERT INTO break_slots
           (tenant_id, employee_id, schedule_date, break_type_id, slot_number,
            planned_start, planned_end, generated_by, status)
         VALUES ($1,$2,$3::date,$4,$5,$6::time,$7::time,'auto','scheduled')
         ON CONFLICT (tenant_id, employee_id, schedule_date, slot_number)
         DO UPDATE SET
           break_type_id = EXCLUDED.break_type_id,
           planned_start = EXCLUDED.planned_start,
           planned_end   = EXCLUDED.planned_end,
           status        = 'scheduled',
           updated_at    = NOW()`,
        [
          slot.tenant_id,
          slot.employee_id,
          slot.schedule_date,
          slot.break_type_id,
          slot.slot_number,
          slot.planned_start,
          slot.planned_end,
        ],
      );
      inserted.push(1);
    }

    // Update fairness ledger
    for (const [empId, score] of result.fairnessMap.entries()) {
      const [year, month] = scheduleDate.split('-').map(Number);
      await this.dataSource.query(
        `INSERT INTO break_fairness
           (tenant_id, employee_id, period_year, period_month, fairness_score, total_breaks, updated_at)
         VALUES ($1,$2,$3,$4,$5,1,NOW())
         ON CONFLICT (tenant_id, employee_id, period_year, period_month)
         DO UPDATE SET
           fairness_score = break_fairness.fairness_score + $5,
           total_breaks   = break_fairness.total_breaks + 1,
           updated_at     = NOW()`,
        [tenantId, empId, year, month, score],
      );
    }

    return {
      inserted: inserted.length,
      warnings: result.warnings,
      message: `Generated ${inserted.length} break slots.`,
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
        bt.is_mandatory, bt.is_prayer
       FROM break_slots bs
       JOIN employees  e  ON e.id  = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       JOIN break_types bt ON bt.id = bs.break_type_id
       WHERE bs.tenant_id = $1
         AND bs.schedule_date = $2::date
         ${functionId ? 'AND e.function_id = $3' : ''}
       ORDER BY bs.planned_start, e.first_name_en`,
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
  }) {
    // Calculate coverage impact
    const coverageBefore = await this.getCoverageSnapshot(tenantId, dto.scheduleDate, dto.requestedStart, dto.requestedEnd);

    // Simulate coverage after approving request
    const coverageAfter = coverageBefore.map(c => ({
      ...c,
      on_break: c.on_break + 1,
      available: c.available - 1,
      gap: c.gap - 1,
    }));

    const minGap = Math.min(...coverageAfter.map(c => c.gap));
    const autoApproveEligible = minGap >= 0; // safe to auto-approve if no gap

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
        JSON.stringify(coverageBefore),
        JSON.stringify(coverageAfter),
        minGap,
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

    return {
      requestId: req.id,
      status: req.status,
      autoApproved: req.auto_approve_eligible,
      coverageImpact: { before: coverageBefore, after: coverageAfter, minGap },
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

    // Coverage re-check before approval
    const coverage = await this.getCoverageSnapshot(
      tenantId, req.schedule_date, req.requested_start, req.requested_end,
    );
    const minGap = Math.min(...coverage.map(c => c.gap - 1));
    if (minGap < -1) {
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

    return { success: true, message: 'Break request approved.' };
  }

  // ── Reject request ───────────────────────────────────────────────────────────
  async rejectRequest(tenantId: string, requestId: string, reviewerId: string, reason: string) {
    const [req] = await this.dataSource.query(
      `SELECT id, status FROM break_requests WHERE id = $1 AND tenant_id = $2`,
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

    await this.dataSource.query(
      `UPDATE break_slots
       SET actual_start = $1::time,
           actual_end   = $2::time,
           status       = $3,
           late_minutes = $4,
           is_missed    = ($3 = 'missed'),
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
         AND hi.interval_start >= $3::interval
         AND hi.interval_end   <= $4::interval
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
