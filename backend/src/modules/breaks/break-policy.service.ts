import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BreakPolicyV2Row,
  EntitlementCheck,
  computeEntitlement,
  pickMostSpecificPolicy,
} from './break-policy.logic';

/**
 * B1 policy engine: resolves the most-specific active break_policies_v2 row and
 * enforces the daily entitlement (max_sessions + total_daily_minutes) from
 * break_daily_balance + live break_slots. Also maintains the daily balance
 * ledger transactionally on slot completion.
 */
@Injectable()
export class BreakPolicyService {
  private readonly logger = new Logger(BreakPolicyService.name);

  constructor(private readonly dataSource: DataSource) {}

  private normalizeRow(r: any): BreakPolicyV2Row {
    return {
      ...r,
      duration_pattern: Array.isArray(r.duration_pattern)
        ? r.duration_pattern.map((n: any) => Number(n))
        : JSON.parse(r.duration_pattern ?? '[]'),
      thresholds: typeof r.thresholds === 'string' ? JSON.parse(r.thresholds) : (r.thresholds ?? {}),
      total_daily_minutes: Number(r.total_daily_minutes),
      max_sessions: Number(r.max_sessions),
      protected_first_min: Number(r.protected_first_min),
      protected_last_min: Number(r.protected_last_min),
      min_gap_between_breaks_min: Number(r.min_gap_between_breaks_min),
      min_work_before_first_min: Number(r.min_work_before_first_min),
      max_delay_min: Number(r.max_delay_min),
    };
  }

  /** All active v2 policy rows for a tenant (scheduler resolves per employee in-memory). */
  async loadActivePolicies(tenantId: string): Promise<BreakPolicyV2Row[]> {
    const rows = await this.dataSource.query(
      `SELECT * FROM break_policies_v2 WHERE tenant_id = $1 AND active = TRUE`,
      [tenantId],
    );
    return rows.map((r: any) => this.normalizeRow(r));
  }

  /**
   * Most-specific active policy for (function, shift, employment type).
   * function+shift_type > function > shift_type > tenant default; employment_type
   * adds specificity within each level. Never null on a seeded tenant (default row).
   */
  async resolvePolicy(
    tenantId: string,
    functionName: string | null,
    shiftCode: string | null,
    employmentType: string | null,
  ): Promise<BreakPolicyV2Row | null> {
    const rows = await this.loadActivePolicies(tenantId);
    return pickMostSpecificPolicy(rows, functionName, shiftCode, employmentType);
  }

  /** Resolve the employee's canon function name, scheduled shift code and employment type for a date. */
  private async employeeContext(tenantId: string, employeeId: string, date: string): Promise<{
    functionName: string | null; shiftCode: string | null; employmentType: string | null;
  }> {
    const [row] = await this.dataSource.query(
      `SELECT canon_fn(f.name) AS function_name,
              e.employment_type::text AS employment_type,
              sc.code AS shift_code
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN attendance_records ar
         ON ar.tenant_id = e.tenant_id AND ar.employee_id = e.id AND ar.attendance_date = $3::date
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       WHERE e.id = $2 AND e.tenant_id = $1
       LIMIT 1`,
      [tenantId, employeeId, date],
    );
    return {
      functionName: row?.function_name ?? null,
      shiftCode: row?.shift_code ?? null,
      employmentType: row?.employment_type ?? null,
    };
  }

  /**
   * Enforce the daily entitlement for one more break of `requestedMin` minutes.
   * used = MAX(break_daily_balance ledger, live completed/active slots) so neither
   * a stale ledger nor an unposted completion lets an employee overdraw.
   */
  async enforceEntitlement(
    tenantId: string,
    employeeId: string,
    date: string,
    requestedMin: number,
  ): Promise<EntitlementCheck & { entitledMinutes: number; maxSessions: number; policyId: string | null }> {
    const ctx = await this.employeeContext(tenantId, employeeId, date);
    const policy = await this.resolvePolicy(tenantId, ctx.functionName, ctx.shiftCode, ctx.employmentType);
    const entitled = policy?.total_daily_minutes ?? 60;
    const maxSessions = policy?.max_sessions ?? 4;

    const [usage] = await this.dataSource.query(
      `SELECT
         COALESCE(b.used_minutes, 0)  AS bal_used,
         COALESCE(b.sessions_used, 0) AS bal_sessions,
         COALESCE(s.slot_used, 0)     AS slot_used,
         COALESCE(s.slot_sessions, 0) AS slot_sessions
       FROM (SELECT 1) one
       LEFT JOIN break_daily_balance b
         ON b.tenant_id = $1 AND b.employee_id = $2 AND b.balance_date = $3::date
       LEFT JOIN LATERAL (
         SELECT
           SUM(CASE
                 WHEN bs.status = 'completed' AND bs.actual_start IS NOT NULL AND bs.actual_end IS NOT NULL
                   THEN GREATEST(0, (EXTRACT(EPOCH FROM (bs.actual_end - bs.actual_start)) / 60
                        + CASE WHEN bs.actual_end < bs.actual_start THEN 1440 ELSE 0 END))::int
                 ELSE GREATEST(0, (EXTRACT(EPOCH FROM (bs.planned_end - bs.planned_start)) / 60
                        + CASE WHEN bs.planned_end < bs.planned_start THEN 1440 ELSE 0 END))::int
               END)::int AS slot_used,
           COUNT(*)::int AS slot_sessions
         FROM break_slots bs
         WHERE bs.tenant_id = $1 AND bs.employee_id = $2 AND bs.schedule_date = $3::date
           AND bs.status IN ('completed','active','released')
       ) s ON TRUE`,
      [tenantId, employeeId, date],
    );

    const usedMin = Math.max(Number(usage?.bal_used ?? 0), Number(usage?.slot_used ?? 0));
    const sessionsUsed = Math.max(Number(usage?.bal_sessions ?? 0), Number(usage?.slot_sessions ?? 0));

    const check = computeEntitlement(entitled, maxSessions, usedMin, sessionsUsed, requestedMin);
    return { ...check, entitledMinutes: entitled, maxSessions, policyId: policy?.id ?? null };
  }

  /**
   * Maintain break_daily_balance transactionally when a slot completes.
   * consumedMin = actual duration when known, else planned.
   */
  async recordCompletion(
    tenantId: string,
    employeeId: string,
    date: string,
    consumedMin: number,
    breakEndAt: Date | null,
  ): Promise<void> {
    const ctx = await this.employeeContext(tenantId, employeeId, date);
    const policy = await this.resolvePolicy(tenantId, ctx.functionName, ctx.shiftCode, ctx.employmentType);
    const entitled = policy?.total_daily_minutes ?? 60;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `INSERT INTO break_daily_balance
           (tenant_id, employee_id, balance_date, entitled_minutes, used_minutes, sessions_used, last_break_end, updated_at)
         VALUES ($1,$2,$3::date,$4,$5,1,$6,NOW())
         ON CONFLICT (tenant_id, employee_id, balance_date)
         DO UPDATE SET
           used_minutes   = break_daily_balance.used_minutes + $5,
           sessions_used  = break_daily_balance.sessions_used + 1,
           last_break_end = COALESCE($6, break_daily_balance.last_break_end),
           updated_at     = NOW()`,
        [tenantId, employeeId, date, entitled, Math.max(0, Math.round(consumedMin)), breakEndAt],
      );
      await qr.commitTransaction();
    } catch (e) {
      await qr.rollbackTransaction().catch(() => {});
      throw e;
    } finally {
      await qr.release();
    }
  }

  /** Immutable audit trail for break-engine mutations (module='breaks'). */
  async audit(
    tenantId: string,
    actor: { id?: string | null; email?: string | null } | null,
    action: string,
    entityType: string,
    entityId: string | null,
    notes: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,$3,$4,'breaks',$5,$6,$7)`,
      [tenantId, actor?.id ?? null, actor?.email ?? null, action, entityType, entityId, notes],
    ).catch((e) => this.logger.warn(`audit insert failed: ${e.message}`));
  }

  // ── Policy CRUD (thin — list + update, both audited via controller) ────────
  async listPolicies(tenantId: string) {
    return this.dataSource.query(
      `SELECT * FROM break_policies_v2 WHERE tenant_id = $1 ORDER BY function_name NULLS FIRST, shift_type NULLS FIRST`,
      [tenantId],
    );
  }

  async updatePolicy(tenantId: string, id: string, patch: Record<string, unknown>): Promise<{ before: any; after: any } | null> {
    const ALLOWED = new Set([
      'function_name', 'shift_type', 'employment_type', 'total_daily_minutes', 'max_sessions',
      'duration_pattern', 'protected_first_min', 'protected_last_min', 'min_gap_between_breaks_min',
      'min_work_before_first_min', 'max_delay_min', 'release_mode', 'thresholds', 'active',
    ]);
    const [before] = await this.dataSource.query(
      `SELECT * FROM break_policies_v2 WHERE id = $1 AND tenant_id = $2`, [id, tenantId],
    );
    if (!before) return null;

    const sets: string[] = [];
    const params: unknown[] = [id, tenantId];
    for (const [k, v] of Object.entries(patch)) {
      if (!ALLOWED.has(k)) continue;
      params.push(k === 'duration_pattern' || k === 'thresholds' ? JSON.stringify(v) : v);
      sets.push(`${k} = $${params.length}${k === 'duration_pattern' || k === 'thresholds' ? '::jsonb' : ''}`);
    }
    if (!sets.length) return { before, after: before };
    const res = await this.dataSource.query(
      `UPDATE break_policies_v2 SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      params,
    );
    const after = Array.isArray(res?.[0]) ? res[0][0] : res[0];
    return { before, after };
  }
}
