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
