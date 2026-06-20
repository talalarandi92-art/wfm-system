import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Leave types that draw down an annual entitlement (others are unlimited/by-policy). */
export const BALANCE_LEAVE_TYPES = ['annual_leave', 'comp_off', 'sick_leave'] as const;

@Injectable()
export class LeaveBalancesService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  private year(y?: number): number { return y && y > 2000 ? y : new Date().getFullYear(); }

  /** Sum of leave days for an employee/type/year at a given request status. */
  private async daysAt(tenantId: string, employeeId: string, leaveType: string, year: number, status: string): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT COALESCE(SUM(rl.duration_days),0)::numeric AS days
         FROM requests r
         JOIN request_leaves rl ON rl.request_id = r.id
        WHERE r.tenant_id = $1 AND r.employee_id = $2 AND rl.leave_type = $3
          AND EXTRACT(YEAR FROM rl.start_date) = $4 AND r.status = $5`,
      [tenantId, employeeId, leaveType, year, status]);
    return Number(r?.days ?? 0);
  }

  /** Live balance for one (employee, type, year): entitlement − taken − pending. */
  async getBalance(tenantId: string, employeeId: string, leaveType: string, yearIn?: number) {
    const year = this.year(yearIn);
    const [row] = await this.ds.query(
      `SELECT entitlement_days FROM leave_balances
        WHERE tenant_id = $1 AND employee_id = $2 AND leave_type = $3 AND calendar_year = $4`,
      [tenantId, employeeId, leaveType, year]);
    const configured = !!row;
    const entitlement = Number(row?.entitlement_days ?? 0);
    const taken = await this.daysAt(tenantId, employeeId, leaveType, year, 'approved');
    const pending = await this.daysAt(tenantId, employeeId, leaveType, year, 'pending');
    return {
      leaveType, year, configured,
      entitlement,
      taken, pending,
      remaining: Math.round((entitlement - taken - pending) * 10) / 10,
    };
  }

  /** All balance-bearing types for an employee in a year. */
  async listForEmployee(tenantId: string, employeeId: string, yearIn?: number) {
    const year = this.year(yearIn);
    return Promise.all(BALANCE_LEAVE_TYPES.map(t => this.getBalance(tenantId, employeeId, t, year)));
  }

  /**
   * Admin grid: every active employee with their balance for each balance-bearing
   * type in a year. One pass for entitlements + one each for taken/pending, joined
   * in memory — avoids 162×3×2 round-trips.
   */
  async listAllEmployees(tenantId: string, yearIn?: number) {
    const year = this.year(yearIn);
    const employees = await this.ds.query(
      `SELECT e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name AS function_name
         FROM employees e
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE e.tenant_id = $1 AND e.status = 'active'
        ORDER BY e.first_name_en, e.last_name_en`,
      [tenantId]);

    const ents = await this.ds.query(
      `SELECT employee_id, leave_type, entitlement_days
         FROM leave_balances WHERE tenant_id = $1 AND calendar_year = $2`,
      [tenantId, year]);
    const drawn = await this.ds.query(
      `SELECT r.employee_id, rl.leave_type, r.status,
              COALESCE(SUM(rl.duration_days),0)::numeric AS days
         FROM requests r
         JOIN request_leaves rl ON rl.request_id = r.id
        WHERE r.tenant_id = $1 AND EXTRACT(YEAR FROM rl.start_date) = $2
          AND r.status IN ('approved','pending')
        GROUP BY r.employee_id, rl.leave_type, r.status`,
      [tenantId, year]);

    const entMap = new Map<string, number>();      // emp|type → entitlement
    for (const e of ents) entMap.set(`${e.employee_id}|${e.leave_type}`, Number(e.entitlement_days));
    const takenMap = new Map<string, number>(), pendMap = new Map<string, number>();
    for (const d of drawn) {
      const k = `${d.employee_id}|${d.leave_type}`;
      (d.status === 'approved' ? takenMap : pendMap).set(k, Number(d.days));
    }

    return employees.map((e: any) => ({
      employeeId: e.id,
      employeeNo: e.employee_no,
      name: `${e.first_name_en ?? ''} ${e.last_name_en ?? ''}`.trim(),
      functionName: e.function_name,
      balances: BALANCE_LEAVE_TYPES.map(t => {
        const k = `${e.id}|${t}`;
        const entitlement = entMap.get(k);
        const taken = takenMap.get(k) ?? 0, pending = pendMap.get(k) ?? 0;
        return {
          leaveType: t,
          configured: entitlement !== undefined,
          entitlement: entitlement ?? 0,
          taken, pending,
          remaining: entitlement === undefined ? null : Math.round((entitlement - taken - pending) * 10) / 10,
        };
      }),
    }));
  }

  /** Admin: set/replace the entitlement for an employee/type/year. */
  async setEntitlement(tenantId: string, userId: string | null, body: {
    employeeId: string; leaveType: string; year?: number; days: number; notes?: string;
  }) {
    const year = this.year(body.year);
    if (body.days < 0) throw new BadRequestException('Entitlement cannot be negative');
    await this.ds.query(
      `INSERT INTO leave_balances (tenant_id, employee_id, leave_type, calendar_year, entitlement_days, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, employee_id, leave_type, calendar_year)
       DO UPDATE SET entitlement_days = EXCLUDED.entitlement_days, notes = EXCLUDED.notes, updated_at = now()`,
      [tenantId, body.employeeId, body.leaveType, year, body.days, body.notes ?? null, userId]);
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'leave_balance.set','leave-balances','employee',$3,$4)`,
      [tenantId, userId, body.employeeId, `${body.leaveType} ${year} → ${body.days}d`]).catch(() => {});
    return this.getBalance(tenantId, body.employeeId, body.leaveType, year);
  }

  /**
   * Bulk set entitlements from pasted/imported rows. Each row carries an
   * employee_no and any subset of the balance-bearing types. Matches by
   * employee_no (the canonical key — never by name); rows that don't match an
   * active employee are returned as `unmatched` so the caller can fix them.
   */
  async bulkSetEntitlements(
    tenantId: string,
    userId: string | null,
    year: number,
    rows: Array<{ employeeNo: string; annual_leave?: number; comp_off?: number; sick_leave?: number }>,
  ) {
    const y = this.year(year);
    // Map employee_no → id once.
    const emps = await this.ds.query(
      `SELECT id, employee_no FROM employees WHERE tenant_id = $1 AND status = 'active'`, [tenantId]);
    const byNo = new Map<string, string>();
    for (const e of emps) if (e.employee_no) byNo.set(String(e.employee_no).trim(), e.id);

    const unmatched: string[] = [];
    let applied = 0, employeesTouched = 0;
    for (const row of rows) {
      const no = String(row.employeeNo ?? '').trim();
      const empId = byNo.get(no);
      if (!empId) { if (no) unmatched.push(no); continue; }
      let touched = false;
      for (const t of BALANCE_LEAVE_TYPES) {
        const v = (row as any)[t];
        if (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) continue;
        await this.setEntitlement(tenantId, userId, { employeeId: empId, leaveType: t, year: y, days: Number(v) });
        applied++; touched = true;
      }
      if (touched) employeesTouched++;
    }
    return { applied, employeesTouched, unmatched, year: y };
  }

  /**
   * Guard used at leave-request creation. Only blocks when an entitlement has
   * actually been configured for this (employee, type, year) — otherwise it is a
   * no-op so the existing flow is unchanged until balances are set up.
   */
  async assertCanRequest(tenantId: string, employeeId: string, leaveType: string, requestedDays: number, yearIn?: number) {
    if (!(BALANCE_LEAVE_TYPES as readonly string[]).includes(leaveType)) return;
    const b = await this.getBalance(tenantId, employeeId, leaveType, yearIn);
    if (!b.configured) return; // no entitlement set up → don't enforce
    if (requestedDays > b.remaining) {
      throw new BadRequestException(
        `الرصيد غير كافٍ: المتبقّي ${b.remaining} يوم من أصل ${b.entitlement} (${leaveType})، والطلب ${requestedDays} يوم.`,
      );
    }
  }
}
