import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as xmlrpc from 'xmlrpc'; // will install below

/**
 * Odoo integration via XML-RPC (the official Odoo external API).
 *
 * Odoo exposes two XML-RPC endpoints:
 *   /xmlrpc/2/common  — authentication (no session needed)
 *   /xmlrpc/2/object  — all model operations (requires uid from auth)
 *
 * We use the `xmlrpc` npm package to call these.
 * npm install xmlrpc @types/xmlrpc
 */

export interface OdooConfig {
  url:       string;   // e.g. https://boutiqaat.odoo.com
  db:        string;   // database name
  username:  string;   // Odoo user email
  apiKey:    string;   // Odoo API key (preferred over password)
}

export interface OdooEmployee {
  id:            number;
  name:          string;
  employeeNo?:   string;
  jobTitle?:     string;
  departmentId?: number;
  departmentName?: string;
  mobile?:       string;
  gender?:       string;
  active:        boolean;
}

export interface OdooLeave {
  id:             number;
  employeeId:     number;
  employeeName:   string;
  leaveType:      string;
  dateFrom:       string;
  dateTo:         string;
  state:          'draft' | 'confirm' | 'validate' | 'refuse';
  numberOfDays:   number;
}

@Injectable()
export class OdooService {
  private readonly logger = new Logger(OdooService.name);

  // UID cache per tenant (avoid re-authenticating every call)
  private readonly uidCache = new Map<string, { uid: number; expiresAt: number }>();

  constructor(private readonly dataSource: DataSource) {}

  // ── Authenticate and get UID ───────────────────────────────────────────────
  async authenticate(config: OdooConfig): Promise<number> {
    const cached = this.uidCache.get(config.url);
    if (cached && Date.now() < cached.expiresAt) return cached.uid;

    const uid = await new Promise<number>((resolve, reject) => {
      const client = this.makeClient(config.url, '/xmlrpc/2/common');
      client.methodCall('authenticate', [config.db, config.username, config.apiKey, {}], (err: any, val: any) => {
        if (err) reject(new BadRequestException(`Odoo auth failed: ${String(err)}`));
        else if (!val) reject(new BadRequestException('Odoo authentication returned 0 — wrong credentials or database'));
        else resolve(val as number);
      });
    });

    this.uidCache.set(config.url, { uid, expiresAt: Date.now() + 30 * 60_000 }); // cache 30 min
    return uid;
  }

  // ── Generic model call ─────────────────────────────────────────────────────
  private async call<T>(config: OdooConfig, model: string, method: string, args: any[], kwargs: any = {}): Promise<T> {
    const uid = await this.authenticate(config);
    return new Promise<T>((resolve, reject) => {
      const client = this.makeClient(config.url, '/xmlrpc/2/object');
      client.methodCall('execute_kw', [config.db, uid, config.apiKey, model, method, args, kwargs], (err: any, val: any) => {
        if (err) reject(new BadRequestException(`Odoo call failed [${model}.${method}]: ${String(err)}`));
        else resolve(val as T);
      });
    });
  }

  // ── Employees sync ─────────────────────────────────────────────────────────
  async fetchEmployees(config: OdooConfig, activeOnly = true): Promise<OdooEmployee[]> {
    const domain = activeOnly ? [['active', '=', true]] : [];
    const fields = ['name', 'employee_id', 'job_title', 'department_id', 'mobile_phone', 'gender', 'active'];

    const records = await this.call<any[]>(config, 'hr.employee', 'search_read', [domain], {
      fields,
      limit: 2000,
    });

    return records.map(r => ({
      id:              r.id,
      name:            r.name,
      employeeNo:      r.employee_id || '',
      jobTitle:        r.job_title   || '',
      departmentId:    Array.isArray(r.department_id) ? r.department_id[0] : null,
      departmentName:  Array.isArray(r.department_id) ? r.department_id[1] : '',
      mobile:          r.mobile_phone || '',
      gender:          r.gender       || '',
      active:          r.active,
    }));
  }

  // ── Leaves / Absences sync ─────────────────────────────────────────────────
  async fetchLeaves(config: OdooConfig, dateFrom: string, dateTo: string): Promise<OdooLeave[]> {
    const domain = [
      ['date_from', '>=', dateFrom],
      ['date_to',   '<=', dateTo],
      ['state', 'in', ['validate', 'confirm']],
    ];
    const fields = ['employee_id', 'holiday_status_id', 'date_from', 'date_to', 'state', 'number_of_days'];

    const records = await this.call<any[]>(config, 'hr.leave.allocation', 'search_read', [domain], { fields });

    // Also check hr.leave (actual time-off requests)
    const timeoffDomain = [
      ['date_from', '>=', dateFrom + ' 00:00:00'],
      ['date_to',   '<=', dateTo   + ' 23:59:59'],
      ['state', 'in', ['validate', 'validate1']],
    ];
    const timeoffs = await this.call<any[]>(config, 'hr.leave', 'search_read', [timeoffDomain], {
      fields: ['employee_id', 'holiday_status_id', 'date_from', 'date_to', 'state', 'number_of_days'],
    }).catch(() => []);

    const map = (r: any): OdooLeave => ({
      id:           r.id,
      employeeId:   Array.isArray(r.employee_id) ? r.employee_id[0] : r.employee_id,
      employeeName: Array.isArray(r.employee_id) ? r.employee_id[1] : '',
      leaveType:    Array.isArray(r.holiday_status_id) ? r.holiday_status_id[1] : '',
      dateFrom:     (r.date_from || '').slice(0, 10),
      dateTo:       (r.date_to   || '').slice(0, 10),
      state:        r.state,
      numberOfDays: r.number_of_days || 0,
    });

    return [...records.map(map), ...timeoffs.map(map)];
  }

  // ── Sync Odoo employees → WFM employees ───────────────────────────────────
  async syncEmployeesToWfm(tenantId: string, config: OdooConfig): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
    const odooEmployees = await this.fetchEmployees(config);
    let created = 0, updated = 0;
    const errors: string[] = [];

    for (const emp of odooEmployees) {
      if (!emp.name) continue;
      try {
        const [existing] = await this.dataSource.query(
          `SELECT id FROM employees WHERE tenant_id = $1 AND employee_no = $2`,
          [tenantId, emp.employeeNo],
        );

        if (existing) {
          // Update name / department if changed
          await this.dataSource.query(
            `UPDATE employees
             SET first_name_en = $1, odoo_id = $2, updated_at = NOW()
             WHERE id = $3`,
            [emp.name, emp.id, existing.id],
          );
          updated++;
        } else if (emp.employeeNo) {
          // Insert new employee (minimal — WFM admin must complete profile)
          const nameParts = emp.name.trim().split(' ');
          const firstName = nameParts[0];
          const lastName  = nameParts.slice(1).join(' ') || null;
          await this.dataSource.query(
            `INSERT INTO employees
               (tenant_id, employee_no, first_name_en, last_name_en, gender, odoo_id, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,'active',NOW(),NOW())
             ON CONFLICT (tenant_id, employee_no) DO UPDATE
             SET first_name_en=$3, last_name_en=$4, odoo_id=$6, updated_at=NOW()`,
            [tenantId, emp.employeeNo, firstName, lastName, emp.gender?.toLowerCase() ?? 'male', emp.id],
          );
          created++;
        }
      } catch (e: any) {
        errors.push(`${emp.name}: ${e.message}`);
      }
    }

    // Log the sync
    await this.logSync(tenantId, 'employees', odooEmployees.length, created + updated, errors);

    return { synced: odooEmployees.length, created, updated, errors };
  }

  // ── Sync Odoo leaves → WFM schedule (mark leave days) ─────────────────────
  async syncLeavesToWfm(tenantId: string, config: OdooConfig, dateFrom: string, dateTo: string) {
    const leaves = await this.fetchLeaves(config, dateFrom, dateTo);
    let applied = 0;
    const errors: string[] = [];

    for (const leave of leaves) {
      try {
        // Find WFM employee by Odoo ID or name
        const [emp] = await this.dataSource.query(
          `SELECT id FROM employees WHERE tenant_id = $1 AND (odoo_id = $2 OR employee_no = $3)`,
          [tenantId, leave.employeeId, leave.employeeId.toString()],
        );
        if (!emp) {
          errors.push(`Employee not found: ${leave.employeeName} (Odoo ID: ${leave.employeeId})`);
          continue;
        }

        // Map leave type to WFM shift code
        const shiftCode = mapLeaveType(leave.leaveType);

        // Create/update schedule record for each leave day
        const start = new Date(leave.dateFrom);
        const end   = new Date(leave.dateTo);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          await this.dataSource.query(
            `INSERT INTO schedule_records
               (tenant_id, employee_id, schedule_date, shift_code, source, created_at, updated_at)
             VALUES ($1,$2,$3::date,$4,'odoo_sync',NOW(),NOW())
             ON CONFLICT (tenant_id, employee_id, schedule_date)
             DO UPDATE SET shift_code=$4, source='odoo_sync', updated_at=NOW()`,
            [tenantId, emp.id, dateStr, shiftCode],
          );
          applied++;
        }
      } catch (e: any) {
        errors.push(`Leave ${leave.id}: ${e.message}`);
      }
    }

    await this.logSync(tenantId, 'leaves', leaves.length, applied, errors);

    return { leaves: leaves.length, applied, errors };
  }

  // ── Test connection ────────────────────────────────────────────────────────
  async testConnection(config: OdooConfig): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const version = await new Promise<any>((resolve, reject) => {
        const client = this.makeClient(config.url, '/xmlrpc/2/common');
        client.methodCall('version', [], (err, val) => {
          if (err) reject(err); else resolve(val);
        });
      });
      const uid = await this.authenticate(config);
      return { ok: !!uid, version: version?.server_version };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────
  async getConfig(tenantId: string): Promise<OdooConfig | null> {
    try {
      const [row] = await this.dataSource.query(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'odoo_config'`,
        [tenantId],
      );
      return row ? JSON.parse(row.value) : null;
    } catch { return null; }
  }

  async saveConfig(tenantId: string, config: OdooConfig): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO settings (tenant_id, key, value, updated_at)
       VALUES ($1,'odoo_config',$2::jsonb,NOW())
       ON CONFLICT (tenant_id, key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
      [tenantId, JSON.stringify(config)],
    );
  }

  // ── Sync history ──────────────────────────────────────────────────────────
  async getSyncHistory(tenantId: string) {
    try {
      return this.dataSource.query(
        `SELECT * FROM integration_sync_log
         WHERE tenant_id = $1 AND source = 'odoo'
         ORDER BY created_at DESC LIMIT 50`,
        [tenantId],
      );
    } catch { return []; }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private makeClient(url: string, path: string) {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const port    = parsed.port ? +parsed.port : (isHttps ? 443 : 80);

    const factory = isHttps ? xmlrpc.createSecureClient : xmlrpc.createClient;
    return factory({ host: parsed.hostname, port, path });
  }

  private async logSync(tenantId: string, dataType: string, total: number, applied: number, errors: string[]) {
    try {
      await this.dataSource.query(
        `INSERT INTO integration_sync_log
           (tenant_id, source, data_type, total_records, applied_records, error_count, errors_json, created_at)
         VALUES ($1,'odoo',$2,$3,$4,$5,$6::jsonb,NOW())`,
        [tenantId, dataType, total, applied, errors.length, JSON.stringify(errors.slice(0, 20))],
      );
    } catch { /* non-fatal */ }
  }
}

function mapLeaveType(odooType: string): string {
  const t = (odooType || '').toLowerCase();
  if (t.includes('annual') || t.includes('vacation') || t.includes('سنوية')) return 'L';
  if (t.includes('sick')   || t.includes('مرض'))                              return 'SL';
  if (t.includes('death')  || t.includes('وفاة'))                             return 'DL';
  if (t.includes('comp')   || t.includes('تعويض'))                            return 'COMP';
  if (t.includes('unpaid') || t.includes('بدون'))                             return 'UPL';
  return 'L'; // default to annual leave
}
