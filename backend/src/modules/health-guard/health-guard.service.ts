import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * System Integrity & Health Guard.
 *
 * Two layers, run as one battery:
 *   • TECHNICAL  — is the platform itself healthy (DB, schema/migrations, data
 *                  freshness, background workers)?
 *   • CALCULATION — does the live schedule obey the rules we codified (female
 *                  shift rules, rest ≥10h, per-function policy, data integrity)?
 *
 * Deterministic — no AI/ML. Each check returns pass/warn/fail with a count and a
 * short sample so the operator can drill in. Runs on demand (controller) and on a
 * background loop that notifies admins when a NEW failure appears.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export interface HealthCheck {
  id: string;
  category: 'technical' | 'calculation';
  label: string;
  labelAr: string;
  status: CheckStatus;
  count: number;          // offending rows (0 when pass)
  detail: string;         // human summary
  sample?: any[];         // up to a few offending rows for drill-down
}
export interface HealthReport {
  generatedAt: string;
  score: number;          // 0..100
  status: CheckStatus;    // worst of the checks
  counts: { pass: number; warn: number; fail: number; skip: number };
  checks: HealthCheck[];
}

const FEMALE = "lower(e.gender::text) = 'female'";

@Injectable()
export class HealthGuardService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('HealthGuard');
  private timer?: NodeJS.Timeout;
  private lastFailIds: Record<string, Set<string>> = {}; // tenant -> failed check ids

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  onModuleInit() {
    // First sweep after 60s, then every 30 minutes.
    setTimeout(() => this.sweepAll().catch(() => {}), 60_000);
    this.timer = setInterval(() => this.sweepAll().catch(() => {}), 30 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ── Background sweep across tenants; notify on newly-appeared failures ──────
  private async sweepAll() {
    const tenants: { id: string }[] = await this.ds
      .query('SELECT id FROM tenants').catch(() => []);
    for (const t of tenants) {
      const report = await this.run(t.id).catch(() => null);
      if (!report) continue;
      const failed = new Set(report.checks.filter(c => c.status === 'fail').map(c => c.id));
      const prev = this.lastFailIds[t.id] ?? new Set();
      const fresh = [...failed].filter(id => !prev.has(id));
      this.lastFailIds[t.id] = failed;
      if (fresh.length) await this.notify(t.id, report, fresh).catch(() => {});
    }
  }

  private async notify(tid: string, report: HealthReport, freshIds: string[]) {
    const labelsAr = report.checks.filter(c => freshIds.includes(c.id)).map(c => c.labelAr).join('، ');
    const labelsEn = report.checks.filter(c => freshIds.includes(c.id)).map(c => c.label).join(', ');
    const admins: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM users u
        WHERE u.tenant_id = $1 AND u.status = 'active'
          AND EXISTS (
            SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id
               AND r.code IN ('platform_admin','wfm_analyst','rta'))`,
      [tid],
    ).catch(() => []);
    for (const a of admins) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, action_url, created_at)
         VALUES ($1,$2,'health_guard',$3,$4,$5,$6,'health_guard','/system-health',NOW())`,
        [tid, a.id, 'System health alert', 'تنبيه سلامة النظام', `Checks failing: ${labelsEn}`, `فحوصات فشلت: ${labelsAr}`],
      ).catch(() => {});
    }
    this.log.warn(`tenant ${tid}: new health failures → ${freshIds.join(', ')}`);
  }

  // ── On-demand full battery ──────────────────────────────────────────────────
  async run(tid: string): Promise<HealthReport> {
    const checks: HealthCheck[] = [];
    for (const fn of [
      () => this.dbConnection(),
      () => this.schemaMigrations(),
      () => this.attendanceFreshness(tid),
      () => this.sprinklrFreshness(tid),
      () => this.slaWorker(tid),
      () => this.femaleCrossMidnight(tid),
      () => this.femaleLateNight(tid),
      () => this.functionShiftPolicy(tid),
      () => this.restUnder10h(tid),
      () => this.presentNoSchedule(tid),
      () => this.employeeNoFunction(tid),
    ]) {
      try { checks.push(await fn()); }
      catch (e: any) {
        checks.push({ id: 'unknown', category: 'technical', label: 'check failed', labelAr: 'فحص فشل', status: 'skip', count: 0, detail: e?.message ?? 'error' });
      }
    }
    const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
    for (const c of checks) counts[c.status]++;
    const scored = checks.filter(c => c.status !== 'skip').length || 1;
    const score = Math.round(((counts.pass + counts.warn * 0.5) / scored) * 100);
    const status: CheckStatus = counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass';
    return { generatedAt: new Date().toISOString(), score, status, counts, checks };
  }

  // ── TECHNICAL ───────────────────────────────────────────────────────────────
  private async dbConnection(): Promise<HealthCheck> {
    await this.ds.query('SELECT 1');
    return { id: 'db_connection', category: 'technical', label: 'Database reachable', labelAr: 'قاعدة البيانات متصلة', status: 'pass', count: 0, detail: 'Connection OK' };
  }

  private async schemaMigrations(): Promise<HealthCheck> {
    const need = ['campaigns', 'coaching_flags', 'request_attendance_corrections', 'request_schedule_changes', 'notifications'];
    const rows = await this.ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1)`, [need]);
    const have = new Set(rows.map((r: any) => r.table_name));
    const missingT = need.filter(t => !have.has(t));
    const col = await this.ds.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='requests' AND column_name='escalated_at'`);
    const missingC = col.length ? [] : ['requests.escalated_at'];
    const missing = [...missingT, ...missingC];
    return {
      id: 'schema_migrations', category: 'technical',
      label: 'Migrations applied', labelAr: 'الترحيلات مطبّقة',
      status: missing.length ? 'fail' : 'pass', count: missing.length,
      detail: missing.length ? `Missing: ${missing.join(', ')}` : 'All expected tables/columns present',
      sample: missing,
    };
  }

  private async attendanceFreshness(tid: string): Promise<HealthCheck> {
    const [r] = await this.ds.query(
      `SELECT MAX(attendance_date)::text mx,
              (MAX(attendance_date) - CURRENT_DATE) AS days_ahead
         FROM attendance_records WHERE tenant_id = $1`, [tid]);
    if (!r?.mx) return { id: 'attendance_freshness', category: 'technical', label: 'Schedule horizon', labelAr: 'أفق الجدول', status: 'warn', count: 0, detail: 'No attendance/schedule data' };
    const ahead = Number(r.days_ahead);
    const status: CheckStatus = ahead >= 0 ? 'pass' : ahead >= -3 ? 'warn' : 'fail';
    return { id: 'attendance_freshness', category: 'technical', label: 'Schedule horizon', labelAr: 'أفق الجدول', status, count: ahead < 0 ? -ahead : 0, detail: `Latest schedule date ${r.mx} (${ahead >= 0 ? `+${ahead}` : ahead}d vs today)` };
  }

  private async sprinklrFreshness(tid: string): Promise<HealthCheck> {
    const [r] = await this.ds.query(
      `SELECT MAX(captured_at) mx, EXTRACT(EPOCH FROM (NOW() - MAX(captured_at)))/60 AS mins
         FROM integration_snapshots WHERE tenant_id = $1 AND source = 'sprinklr'`, [tid]);
    if (!r?.mx) return { id: 'sprinklr_freshness', category: 'technical', label: 'Sprinklr feed', labelAr: 'تغذية سبرينكلر', status: 'skip', count: 0, detail: 'No Sprinklr snapshots yet' };
    const mins = Math.round(Number(r.mins));
    const status: CheckStatus = mins <= 120 ? 'pass' : mins <= 1440 ? 'warn' : 'fail';
    return { id: 'sprinklr_freshness', category: 'technical', label: 'Sprinklr feed', labelAr: 'تغذية سبرينكلر', status, count: 0, detail: `Last snapshot ${mins} min ago` };
  }

  private async slaWorker(tid: string): Promise<HealthCheck> {
    // Pending requests past SLA that the escalation loop should already have flagged.
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM requests
        WHERE tenant_id = $1 AND status IN ('pending','peer_pending')
          AND sla_due_at IS NOT NULL AND sla_due_at < NOW() - INTERVAL '15 minutes'
          AND escalated_at IS NULL`, [tid]);
    const n = r?.n ?? 0;
    const status: CheckStatus = n === 0 ? 'pass' : n <= 3 ? 'warn' : 'fail';
    return { id: 'sla_worker', category: 'technical', label: 'SLA escalation worker', labelAr: 'مُصعّد الـ SLA', status, count: n, detail: n ? `${n} overdue request(s) not escalated — worker may be down` : 'No overdue-unescalated requests' };
  }

  // ── CALCULATION (forward-looking: schedule we own, date >= today) ───────────
  private async femaleCrossMidnight(tid: string): Promise<HealthCheck> {
    const rows = await this.ds.query(
      `SELECT ar.attendance_date::text d, e.first_name_en, e.last_name_en, e.employee_no,
              to_char(ar.scheduled_start,'HH24:MI') ss, to_char(ar.scheduled_end,'HH24:MI') se
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
        WHERE ar.tenant_id = $1 AND ${FEMALE}
          AND ar.attendance_date >= CURRENT_DATE
          AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL
          AND ar.scheduled_end::time < ar.scheduled_start::time
        ORDER BY ar.attendance_date LIMIT 20`, [tid]);
    return {
      id: 'female_cross_midnight', category: 'calculation',
      label: 'Female on cross-midnight shift', labelAr: 'إناث على وردية تعبر منتصف الليل',
      status: rows.length ? 'fail' : 'pass', count: rows.length,
      detail: rows.length ? `${rows.length} female assignment(s) crossing midnight (E/EE/MD/MN) — hard rule violation` : 'No female crosses midnight',
      sample: rows.map((r: any) => ({ emp: `${r.first_name_en} ${r.last_name_en}`, no: r.employee_no, date: r.d, shift: `${r.ss}→${r.se}` })),
    };
  }

  private async femaleLateNight(tid: string): Promise<HealthCheck> {
    // Same-day shift ending after 20:00 (e.g. N→22:00) — allowed only as a per-function exception, so warn for review.
    const rows = await this.ds.query(
      `SELECT ar.attendance_date::text d, e.first_name_en, e.last_name_en, e.employee_no,
              to_char(ar.scheduled_end,'HH24:MI') se, COALESCE(f.name,'—') fn
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE ar.tenant_id = $1 AND ${FEMALE}
          AND ar.attendance_date >= CURRENT_DATE
          AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL
          AND ar.scheduled_end::time >= ar.scheduled_start::time
          AND ar.scheduled_end::time > TIME '20:00'
        ORDER BY ar.attendance_date LIMIT 20`, [tid]);
    return {
      id: 'female_late_night', category: 'calculation',
      label: 'Female ending after 20:00', labelAr: 'إناث تنتهي ورديتهم بعد 8 مساءً',
      status: rows.length ? 'warn' : 'pass', count: rows.length,
      detail: rows.length ? `${rows.length} female shift(s) end after 20:00 — confirm a per-function exception was intended` : 'No female works past 20:00',
      sample: rows.map((r: any) => ({ emp: `${r.first_name_en} ${r.last_name_en}`, no: r.employee_no, date: r.d, ends: r.se, fn: r.fn })),
    };
  }

  private async functionShiftPolicy(tid: string): Promise<HealthCheck> {
    // OMT/Outbound must use only B(09→18)/N(13→22): flag any cross-midnight or starts outside {09,10,...,13}.
    const rows = await this.ds.query(
      `SELECT ar.attendance_date::text d, e.first_name_en, e.last_name_en, e.employee_no,
              to_char(ar.scheduled_start,'HH24:MI') ss, to_char(ar.scheduled_end,'HH24:MI') se, f.name fn
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
         JOIN functions f ON f.id = e.function_id
        WHERE ar.tenant_id = $1
          AND (f.name ILIKE '%outbound%' OR f.name ILIKE '%omt%')
          AND ar.attendance_date >= CURRENT_DATE
          AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL
          AND ( ar.scheduled_end::time < ar.scheduled_start::time          -- cross-midnight (not allowed)
             OR ar.scheduled_start::time NOT BETWEEN TIME '09:00' AND TIME '13:00' )
        ORDER BY ar.attendance_date LIMIT 20`, [tid]);
    return {
      id: 'function_shift_policy', category: 'calculation',
      label: 'Outbound/OMT shift policy (B/N only)', labelAr: 'سياسة ورديات أوتباوند/OMT (B و N فقط)',
      status: rows.length ? 'warn' : 'pass', count: rows.length,
      detail: rows.length ? `${rows.length} Outbound/OMT assignment(s) outside the B/N policy` : 'Outbound/OMT within B/N policy',
      sample: rows.map((r: any) => ({ emp: `${r.first_name_en} ${r.last_name_en}`, no: r.employee_no, date: r.d, shift: `${r.ss}→${r.se}`, fn: r.fn })),
    };
  }

  private async restUnder10h(tid: string): Promise<HealthCheck> {
    // Pull forward roster; compute rest between an employee's consecutive working days in JS.
    const rows = await this.ds.query(
      `SELECT ar.employee_id, e.first_name_en, e.last_name_en, e.employee_no,
              ar.attendance_date::text d,
              to_char(ar.scheduled_start,'HH24:MI') ss, to_char(ar.scheduled_end,'HH24:MI') se
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
        WHERE ar.tenant_id = $1 AND ar.attendance_date >= CURRENT_DATE
          AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL
        ORDER BY ar.employee_id, ar.attendance_date`, [tid]);
    const toMin = (t: string) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
    const dayNo = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
    const byEmp = new Map<string, any[]>();
    for (const r of rows) { if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []); byEmp.get(r.employee_id)!.push(r); }
    const viol: any[] = [];
    for (const list of byEmp.values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1], cur = list[i];
        const gapDays = dayNo(cur.d) - dayNo(prev.d);
        if (gapDays < 1 || gapDays > 1) continue;             // only adjacent calendar days
        const pStart = toMin(prev.ss), pEnd = toMin(prev.se);
        const prevEndAbs = (pEnd <= pStart ? 24 * 60 : 0) + pEnd;   // cross-midnight → spills into next day
        const restMin = (24 * 60 + toMin(cur.ss)) - prevEndAbs;     // next day's start minus prev end
        if (restMin < 10 * 60) {
          viol.push({ emp: `${prev.first_name_en} ${prev.last_name_en}`, no: prev.employee_no, from: `${prev.d} ${prev.se}`, to: `${cur.d} ${cur.ss}`, restH: +(restMin / 60).toFixed(1) });
        }
      }
    }
    return {
      id: 'rest_under_10h', category: 'calculation',
      label: 'Rest < 10h between shifts', labelAr: 'راحة أقل من 10 ساعات بين ورديتين',
      status: viol.length ? 'fail' : 'pass', count: viol.length,
      detail: viol.length ? `${viol.length} consecutive-day pair(s) with rest under 10h` : 'All consecutive shifts ≥ 10h rest',
      sample: viol.slice(0, 20),
    };
  }

  private async presentNoSchedule(tid: string): Promise<HealthCheck> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM attendance_records
        WHERE tenant_id = $1 AND attendance_marker = 'present'
          AND scheduled_start IS NULL
          AND attendance_date >= CURRENT_DATE - INTERVAL '30 days'`, [tid]);
    const n = r?.n ?? 0;
    return { id: 'present_no_schedule', category: 'calculation', label: 'Present without a scheduled shift', labelAr: 'حضور بدون وردية مجدولة', status: n === 0 ? 'pass' : 'warn', count: n, detail: n ? `${n} present record(s) (last 30d) have no scheduled shift` : 'Every present record has a scheduled shift' };
  }

  private async employeeNoFunction(tid: string): Promise<HealthCheck> {
    const rows = await this.ds.query(
      `SELECT employee_no, first_name_en, last_name_en FROM employees
        WHERE tenant_id = $1 AND status = 'active' AND function_id IS NULL LIMIT 20`, [tid]);
    return { id: 'employee_no_function', category: 'calculation', label: 'Active employee without a function', labelAr: 'موظف نشط بدون قسم', status: rows.length ? 'warn' : 'pass', count: rows.length, detail: rows.length ? `${rows.length} active employee(s) have no function assigned` : 'All active employees have a function', sample: rows.map((r: any) => ({ emp: `${r.first_name_en} ${r.last_name_en}`, no: r.employee_no })) };
  }
}
