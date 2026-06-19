import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Security Guard — continuous security/compliance monitoring (deterministic, no AI).
 * Watches three surfaces and flags risk:
 *   • accounts — login hygiene (failed logins, lockouts, stale passwords, dormant)
 *   • access   — privilege sprawl, orphan accounts, and access NOT revoked for
 *                terminated/resigned employees (the highest-value check)
 *   • audit    — audit-trail freshness + untraceable changes
 *
 * Mirrors the Health Guard shape: a battery of pass/warn/fail/skip checks with a
 * score, plus a background sweep that notifies admins when a NEW failure appears.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type Lang = 'ar' | 'en';
const L = (lang: Lang, en: string, ar: string) => (lang === 'en' ? en : ar);
export interface SecCheck {
  id: string; category: 'accounts' | 'access' | 'audit';
  label: string; labelAr: string; status: CheckStatus; count: number; detail: string; sample?: any[];
}
export interface SecReport {
  generatedAt: string; score: number; status: CheckStatus;
  counts: { pass: number; warn: number; fail: number; skip: number };
  checks: SecCheck[];
}

@Injectable()
export class SecurityGuardService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SecurityGuard');
  private timer?: NodeJS.Timeout;
  private lastFail: Record<string, Set<string>> = {};

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  onModuleInit() {
    setTimeout(() => this.sweepAll().catch(() => {}), 75_000);
    this.timer = setInterval(() => this.sweepAll().catch(() => {}), 30 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async sweepAll() {
    const tenants: { id: string }[] = await this.ds.query('SELECT id FROM tenants').catch(() => []);
    for (const t of tenants) {
      const report = await this.run(t.id).catch(() => null);
      if (!report) continue;
      const failed = new Set(report.checks.filter(c => c.status === 'fail').map(c => c.id));
      const prev = this.lastFail[t.id] ?? new Set();
      const fresh = [...failed].filter(id => !prev.has(id));
      this.lastFail[t.id] = failed;
      if (fresh.length) await this.notify(t.id, report, fresh).catch(() => {});
    }
  }

  private async notify(tid: string, report: SecReport, freshIds: string[]) {
    const labelsAr = report.checks.filter(c => freshIds.includes(c.id)).map(c => c.labelAr).join('، ');
    const labelsEn = report.checks.filter(c => freshIds.includes(c.id)).map(c => c.label).join(', ');
    const admins: { id: string }[] = await this.ds.query(
      `SELECT u.id FROM users u
        WHERE u.tenant_id = $1 AND u.status = 'active'
          AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.code IN ('platform_admin','wfm_analyst'))`, [tid],
    ).catch(() => []);
    for (const a of admins) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, action_url, created_at)
         VALUES ($1,$2,'security_guard',$3,$4,$5,$6,'security_guard','/security-guard',NOW())`,
        [tid, a.id, 'Security alert', 'تنبيه أمني', `Security checks failing: ${labelsEn}`, `فحوصات أمنية فشلت: ${labelsAr}`],
      ).catch(() => {});
    }
    this.log.warn(`tenant ${tid}: new security failures → ${freshIds.join(', ')}`);
  }

  async run(tid: string, lang: Lang = 'ar'): Promise<SecReport> {
    const checks: SecCheck[] = [];
    for (const fn of [
      () => this.failedLogins(tid, lang),
      () => this.lockedAccounts(tid, lang),
      () => this.stalePasswords(tid, lang),
      () => this.dormantActive(tid, lang),
      () => this.mustChange(tid, lang),
      () => this.privilegedAdmins(tid, lang),
      () => this.orphanUsers(tid, lang),
      () => this.accessNotRevoked(tid, lang),
      () => this.auditFreshness(tid, lang),
      () => this.untraceableChanges(tid, lang),
    ]) {
      try { checks.push(await fn()); }
      catch (e: any) { checks.push({ id: 'unknown', category: 'accounts', label: 'check failed', labelAr: 'فحص فشل', status: 'skip', count: 0, detail: e?.message ?? 'error' }); }
    }
    const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
    for (const c of checks) counts[c.status]++;
    const scored = checks.filter(c => c.status !== 'skip').length || 1;
    const score = Math.round(((counts.pass + counts.warn * 0.5) / scored) * 100);
    const status: CheckStatus = counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass';
    return { generatedAt: new Date().toISOString(), score, status, counts, checks };
  }

  // ── accounts ─────────────────────────────────────────────────────────────────
  private async failedLogins(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const rows = await this.ds.query(
      `SELECT email, failed_attempts FROM users
        WHERE tenant_id = $1 AND failed_attempts >= 3 AND locked_at IS NULL AND locked_until IS NULL
        ORDER BY failed_attempts DESC LIMIT 20`, [tid]);
    const hard = rows.some((r: any) => r.failed_attempts >= 5);
    return { id: 'failed_logins', category: 'accounts', label: 'Repeated failed logins', labelAr: 'محاولات دخول فاشلة متكرّرة', status: rows.length ? (hard ? 'fail' : 'warn') : 'pass', count: rows.length, detail: rows.length ? L(lang, `${rows.length} account(s) with repeated failed logins — possible breach attempt`, `${rows.length} حساب عليه محاولات فاشلة متكرّرة — احتمال محاولة اختراق`) : L(lang, 'No suspicious login attempts', 'لا محاولات دخول مشبوهة'), sample: rows.map((r: any) => ({ email: r.email, attempts: r.failed_attempts })) };
  }

  private async lockedAccounts(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const rows = await this.ds.query(
      `SELECT email, locked_until FROM users
        WHERE tenant_id = $1 AND (locked_until > NOW() OR (locked_at IS NOT NULL AND locked_until IS NULL)) LIMIT 20`, [tid]);
    return { id: 'locked_accounts', category: 'accounts', label: 'Currently locked accounts', labelAr: 'حسابات مقفولة حالياً', status: rows.length ? 'warn' : 'pass', count: rows.length, detail: rows.length ? L(lang, `${rows.length} locked account(s) — review the lock reason`, `${rows.length} حساب مقفول — راجع سبب القفل`) : L(lang, 'No locked accounts', 'لا حسابات مقفولة'), sample: rows.map((r: any) => ({ email: r.email, until: r.locked_until })) };
  }

  private async stalePasswords(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM users
        WHERE tenant_id = $1 AND status = 'active'
          AND (password_changed_at IS NULL OR password_changed_at < NOW() - INTERVAL '90 days')`, [tid]);
    const n = r?.n ?? 0;
    return { id: 'stale_passwords', category: 'accounts', label: 'Passwords older than 90 days', labelAr: 'كلمات مرور أقدم من 90 يوم', status: n ? 'warn' : 'pass', count: n, detail: n ? L(lang, `${n} active account(s) with an old/un-updated password`, `${n} حساب نشط بكلمة مرور قديمة/غير محدّثة`) : L(lang, 'All passwords up to date', 'كل كلمات المرور محدّثة') };
  }

  private async dormantActive(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const rows = await this.ds.query(
      `SELECT email, last_login_at FROM users
        WHERE tenant_id = $1 AND status = 'active'
          AND (last_login_at IS NULL OR last_login_at < NOW() - INTERVAL '60 days')
        ORDER BY last_login_at NULLS FIRST LIMIT 20`, [tid]);
    return { id: 'dormant_active', category: 'accounts', label: 'Dormant but active accounts', labelAr: 'حسابات خاملة لكنها فعّالة', status: rows.length ? 'warn' : 'pass', count: rows.length, detail: rows.length ? L(lang, `${rows.length} active account(s) with no login for 60+ days — consider disabling`, `${rows.length} حساب نشط بلا دخول منذ 60+ يوم — يُفضّل تعطيله`) : L(lang, 'No dormant accounts', 'لا حسابات خاملة'), sample: rows.map((r: any) => ({ email: r.email, lastLogin: r.last_login_at ?? L(lang, 'never', 'أبداً') })) };
  }

  private async mustChange(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM users WHERE tenant_id = $1 AND status = 'active' AND must_change_password = true`, [tid]);
    const n = r?.n ?? 0;
    return { id: 'must_change', category: 'accounts', label: 'Pending forced password change', labelAr: 'بانتظار تغيير كلمة مرور إجباري', status: n ? 'warn' : 'pass', count: n, detail: n ? L(lang, `${n} account(s) with a pending forced password change`, `${n} حساب عليه تغيير إجباري لكلمة المرور لم يتم`) : L(lang, 'No pending forced changes', 'لا تغييرات إجبارية معلّقة') };
  }

  // ── access ───────────────────────────────────────────────────────────────────
  private async privilegedAdmins(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const rows = await this.ds.query(
      `SELECT DISTINCT u.email FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1 AND u.status = 'active' AND r.code = 'platform_admin' LIMIT 30`, [tid]);
    return { id: 'privileged_admins', category: 'access', label: 'Privileged admin accounts', labelAr: 'حسابات أدمن صلاحياتها واسعة', status: rows.length > 3 ? 'warn' : 'pass', count: rows.length, detail: rows.length > 3 ? L(lang, `${rows.length} admin account(s) — more than necessary, reduce broad privileges`, `${rows.length} حساب أدمن — أكثر من اللازم، قلّل الصلاحيات الواسعة`) : L(lang, `${rows.length} admin account(s) (reasonable)`, `${rows.length} حساب أدمن (ضمن المعقول)`), sample: rows.map((r: any) => ({ email: r.email })) };
  }

  private async orphanUsers(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const rows = await this.ds.query(
      `SELECT email FROM users WHERE tenant_id = $1 AND status = 'active' AND employee_id IS NULL LIMIT 20`, [tid]);
    return { id: 'orphan_users', category: 'access', label: 'Accounts not linked to an employee', labelAr: 'حسابات غير مرتبطة بموظف', status: rows.length ? 'warn' : 'pass', count: rows.length, detail: rows.length ? L(lang, `${rows.length} active account(s) not linked to an employee — review legitimacy`, `${rows.length} حساب نشط غير مربوط بموظف — راجع شرعيّته`) : L(lang, 'All accounts linked to employees', 'كل الحسابات مربوطة بموظفين'), sample: rows.map((r: any) => ({ email: r.email })) };
  }

  private async accessNotRevoked(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const rows = await this.ds.query(
      `SELECT u.email, e.first_name_en, e.last_name_en, e.status, e.employee_no
         FROM users u JOIN employees e ON e.id = u.employee_id
        WHERE u.tenant_id = $1 AND u.status = 'active'
          AND e.status IN ('terminated','resigned','inactive') LIMIT 20`, [tid]);
    return { id: 'access_not_revoked', category: 'access', label: 'Active login for terminated/resigned staff', labelAr: 'وصول فعّال لموظف منتهٍ/مستقيل', status: rows.length ? 'fail' : 'pass', count: rows.length, detail: rows.length ? L(lang, `${rows.length} terminated/resigned employee(s) still have an active account — revoke access now`, `${rows.length} موظف منتهٍ/مستقيل لا يزال حسابه فعّالاً — اسحب الوصول فوراً`) : L(lang, 'No un-revoked access', 'لا وصول غير مسحوب'), sample: rows.map((r: any) => ({ emp: `${r.first_name_en} ${r.last_name_en}`, no: r.employee_no, status: r.status, email: r.email })) };
  }

  // ── audit ────────────────────────────────────────────────────────────────────
  private async auditFreshness(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const [r] = await this.ds.query(
      `SELECT MAX(created_at) mx, EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/3600 hrs
         FROM audit_logs WHERE tenant_id = $1`, [tid]);
    if (!r?.mx) return { id: 'audit_freshness', category: 'audit', label: 'Audit trail activity', labelAr: 'نشاط سجلّ التدقيق', status: 'warn', count: 0, detail: L(lang, 'No audit trail', 'لا يوجد سجلّ تدقيق') };
    const hrs = Math.round(Number(r.hrs));
    return { id: 'audit_freshness', category: 'audit', label: 'Audit trail activity', labelAr: 'نشاط سجلّ التدقيق', status: hrs <= 168 ? 'pass' : 'warn', count: 0, detail: L(lang, `Last audit entry ${hrs}h ago`, `آخر إدخال تدقيق منذ ${hrs} ساعة`) };
  }

  private async untraceableChanges(tid: string, lang: Lang = 'ar'): Promise<SecCheck> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM audit_logs
        WHERE tenant_id = $1 AND actor_id IS NULL AND created_at > NOW() - INTERVAL '30 days'`, [tid]);
    const n = r?.n ?? 0;
    return { id: 'untraceable_changes', category: 'audit', label: 'Untraceable changes (no actor)', labelAr: 'تعديلات بلا منفّذ معروف', status: n ? 'warn' : 'pass', count: n, detail: n ? L(lang, `${n} change(s) in the last 30 days with no recorded actor`, `${n} تعديل بآخر 30 يوم بلا منفّذ مسجّل`) : L(lang, 'All changes have a recorded actor', 'كل التعديلات لها منفّذ مسجّل') };
  }
}
