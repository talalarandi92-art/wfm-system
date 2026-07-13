import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentRunner } from '@common/agent-runner';
import { GeneratorService } from '@modules/schedule-generator/generator.service';

/**
 * System Smoke Test — actually EXERCISES the app's write/feature paths to catch
 * functional bugs that compile-time checks (tsc/build) and data/rule monitors
 * cannot see — e.g. raw-SQL type/length/constraint errors like the "Save as Draft"
 * varchar(5)/uuid bug.
 *
 * Two probe styles:
 *  • tx-rollback: open a transaction, run the real write SQL, ALWAYS roll back —
 *    exercises the schema contract with zero mutation.
 *  • real-path: call the real service method then clean up (e.g. save → delete).
 */

export interface Probe { name: string; label: string; labelAr: string; area: string; ok: boolean; error?: string }

@Injectable()
export class SmokeTestService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SmokeTest');
  private timer?: NodeJS.Timeout;

  private readonly runner: AgentRunner;
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly gen: GeneratorService,
  ) {
    this.runner = new AgentRunner(this.ds, 'smoke-test-loop');
  }

  onModuleInit() {
    // First sweep 3 min after boot, then once a day.
    setTimeout(() => this.sweepAllExclusive(), 180_000);
    this.timer = setInterval(() => this.sweepAllExclusive(), 24 * 3600_000);
  }

  // Advisory-lock exclusive so multi-instance never double-notifies on a failed probe. The
  // on-demand run(tid,userId) path (controller) rolls back its probe writes and is NOT gated.
  private sweepAllExclusive() {
    this.runner.runExclusive(() => this.sweepAll()).catch(() => {});
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // Autonomous daily run across tenants; notify admins on any failed probe.
  private async sweepAll() {
    const tenants: { id: string }[] = await this.ds.query('SELECT id FROM tenants').catch(() => []);
    for (const t of tenants) {
      const admin = await this.ds.query(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
          WHERE u.tenant_id=$1 AND u.status='active' AND r.code IN ('platform_admin','wfm_analyst') LIMIT 1`, [t.id],
      ).then((r: any) => r[0]?.id).catch(() => null);
      if (!admin) continue;
      const report = await this.run(t.id, admin).catch(() => null);
      if (!report) continue;
      const failed = report.probes.filter(p => !p.ok);
      if (failed.length) await this.notify(t.id, failed).catch(() => {});
    }
  }

  private async notify(tid: string, failed: Probe[]) {
    const labels = failed.map(f => f.labelAr).join('، ');
    const admins: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
        WHERE u.tenant_id=$1 AND u.status='active' AND r.code IN ('platform_admin','wfm_analyst')`, [tid],
    ).catch(() => []);
    for (const a of admins) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, action_url, created_at)
         VALUES ($1,$2,'smoke_test',$3,$4,$5,$6,'smoke_test','/chief',NOW())`,
        [tid, a.id, 'System smoke test failed', 'فشل اختبار وظيفي', `Failing: ${failed.map(f => f.name).join(', ')}`, `وظائف فشلت: ${labels}`],
      ).catch(() => {});
    }
    this.log.warn(`tenant ${tid}: smoke test failures → ${failed.map(f => f.name).join(', ')}`);
  }

  async run(tid: string, userId: string): Promise<{ passed: number; total: number; probes: Probe[] }> {
    const probes: Probe[] = [];
    probes.push(await this.scheduleSave(tid, userId));
    probes.push(await this.txProbe('publish_apply', 'Publish schedule to staff', 'نشر الجدول للموظفين', 'schedule', q => this.publishApplyStep(tid, q)));
    probes.push(await this.txProbe('request_create', 'Create request', 'إنشاء طلب', 'requests', q => this.requestStep(tid, q)));
    probes.push(await this.txProbe('attendance_correction', 'Attendance correction', 'تصحيح حضور', 'attendance', q => this.attendanceStep(tid, q)));
    probes.push(await this.readProbe('functions_read', 'Read functions', 'قراءة الأقسام', 'schedule', () => this.gen.getFunctions(tid)));
    probes.push(await this.readProbe('versions_read', 'Read schedule versions', 'قراءة نسخ الجدول', 'schedule', () => this.gen.listVersions(tid)));
    probes.push(await this.readProbe('coverage_read', 'Read coverage', 'قراءة التغطية', 'coverage',
      () => this.ds.query(`SELECT 1 FROM attendance_records WHERE tenant_id=$1 LIMIT 1`, [tid])));

    const passed = probes.filter(p => p.ok).length;
    return { passed, total: probes.length, probes };
  }

  // ── Probe helpers ────────────────────────────────────────────────────────────
  private async txProbe(name: string, label: string, labelAr: string, area: string, steps: (q: (t: string, p?: any[]) => Promise<any>) => Promise<void>): Promise<Probe> {
    const qr = this.ds.createQueryRunner();
    try {
      await qr.connect(); await qr.startTransaction();
      await steps((t, p) => qr.query(t, p));
      await qr.rollbackTransaction();
      return { name, label, labelAr, area, ok: true };
    } catch (e: any) {
      try { await qr.rollbackTransaction(); } catch { /* */ }
      return { name, label, labelAr, area, ok: false, error: e?.message ?? String(e) };
    } finally { try { await qr.release(); } catch { /* */ } }
  }

  private async readProbe(name: string, label: string, labelAr: string, area: string, fn: () => Promise<any>): Promise<Probe> {
    try { await fn(); return { name, label, labelAr, area, ok: true }; }
    catch (e: any) { return { name, label, labelAr, area, ok: false, error: e?.message ?? String(e) }; }
  }

  // ── Real-path: generate (one small function) → saveDraft → delete ────────────
  private async scheduleSave(tid: string, userId: string): Promise<Probe> {
    const name = 'schedule_save', label = 'Save schedule (real path)', labelAr = 'حفظ جدول (مسار حقيقي)', area = 'schedule';
    let versionId: string | null = null;
    try {
      const funcs = await this.gen.getFunctions(tid);
      if (!funcs.length) return { name, label, labelAr, area, ok: true };  // nothing to generate → not a failure
      const smallest = [...funcs].sort((a: any, b: any) => Number(a.employee_count) - Number(b.employee_count))[0];
      const sat = this.nextSaturday();
      const result = await this.gen.generate(tid, sat, [smallest.id], {});
      versionId = await this.gen.saveDraft(tid, result as any, userId, '__smoke__');
      return { name, label, labelAr, area, ok: true };
    } catch (e: any) {
      return { name, label, labelAr, area, ok: false, error: e?.message ?? String(e) };
    } finally {
      if (versionId) {
        await this.ds.query(`DELETE FROM schedule_entries WHERE schedule_version_id = $1`, [versionId]).catch(() => {});
        await this.ds.query(`DELETE FROM schedule_versions WHERE id = $1`, [versionId]).catch(() => {});
      }
    }
  }

  // ── Write-path steps (run inside a rolled-back transaction) ──────────────────
  private async publishApplyStep(tid: string, q: (t: string, p?: any[]) => Promise<any>) {
    const [emp] = await q(`SELECT id FROM employees WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tid]);
    const [sc] = await q(`SELECT id, start_time, end_time FROM shift_codes WHERE tenant_id=$1 AND start_time IS NOT NULL LIMIT 1`, [tid]);
    if (!emp || !sc) return;
    await q(
      `INSERT INTO attendance_records (id, tenant_id, employee_id, attendance_date, scheduled_shift_code_id, scheduled_start, scheduled_end, attendance_marker, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, DATE '2099-12-26', $3, $4, $5, 'present'::attendance_marker_enum, NOW(), NOW())
       ON CONFLICT (tenant_id, employee_id, attendance_date) DO UPDATE SET scheduled_start = EXCLUDED.scheduled_start, updated_at = NOW()`,
      [tid, emp.id, sc.id, sc.start_time, sc.end_time]);
  }

  private async requestStep(tid: string, q: (t: string, p?: any[]) => Promise<any>) {
    const [rt] = await q(`SELECT id FROM request_types WHERE tenant_id=$1 AND is_active=true LIMIT 1`, [tid]);
    const [u] = await q(`SELECT id, employee_id FROM users WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tid]);
    const [emp] = await q(`SELECT id FROM employees WHERE tenant_id=$1 LIMIT 1`, [tid]);
    if (!rt || !u) return;
    await q(
      `INSERT INTO requests (id, tenant_id, request_type_id, requester_id, employee_id, status, submitted_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending', NOW(), NOW(), NOW())`,
      [tid, rt.id, u.id, u.employee_id ?? emp?.id ?? null]);
  }

  private async attendanceStep(tid: string, q: (t: string, p?: any[]) => Promise<any>) {
    const [emp] = await q(`SELECT id FROM employees WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tid]);
    if (!emp) return;
    await q(
      `INSERT INTO attendance_records (id, tenant_id, employee_id, attendance_date, punch_late_minutes, attendance_marker, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, DATE '2099-12-27', 5, 'present'::attendance_marker_enum, NOW(), NOW())
       ON CONFLICT (tenant_id, employee_id, attendance_date) DO UPDATE SET punch_late_minutes = 5, updated_at = NOW()`,
      [tid, emp.id]);
  }

  private nextSaturday(): string {
    const d = new Date(Date.now() + 3 * 3600_000); // Kuwait
    const dow = d.getUTCDay(); // 6 = Saturday
    const add = (6 - dow + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + add);
    return d.toISOString().slice(0, 10);
  }
}
