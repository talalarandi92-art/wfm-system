import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AnalystService } from '@modules/analyst/analyst.service';

/**
 * Auto Mode — the Chief acting as deputy on requests. When enabled, a background
 * loop decides pending requests by the live coverage verdict of the requester's
 * function on the request date:
 *   • function has SAFE surplus  → auto-approve (if auto_approve on)
 *   • function is in DANGER       → auto-reject (only if auto_reject on) else hold
 *   • otherwise                   → hold for a human
 * Scope is limited to coverage-driven, status-only request types (default:
 * permission). Every action is attributed to whoever enabled Auto Mode, written to
 * automode_decisions + audit_logs + a requester notification, and is reversible.
 */
@Injectable()
export class AutoModeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AutoMode');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly analyst: AnalystService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.tickAll().catch(() => {}), 100_000);
    this.timer = setInterval(() => this.tickAll().catch(() => {}), 3 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ── Settings ─────────────────────────────────────────────────────────────────
  async getSettings(tid: string) {
    const [r] = await this.ds.query(`SELECT * FROM automode_settings WHERE tenant_id = $1`, [tid]).catch(() => []);
    if (r) return r;
    return { tenant_id: tid, enabled: false, auto_approve: true, auto_reject: false, allowed_types: ['permission'], updated_by: null };
  }
  async saveSettings(tid: string, userId: string, dto: any) {
    const allowed = Array.isArray(dto.allowedTypes) && dto.allowedTypes.length ? dto.allowedTypes : ['permission'];
    const [r] = await this.ds.query(
      `INSERT INTO automode_settings (tenant_id, enabled, auto_approve, auto_reject, allowed_types, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET enabled=$2, auto_approve=$3, auto_reject=$4, allowed_types=$5::jsonb, updated_by=$6, updated_at=NOW()
       RETURNING *`,
      [tid, !!dto.enabled, dto.autoApprove !== false, !!dto.autoReject, JSON.stringify(allowed), userId],
    ).then((x: any) => Array.isArray(x?.[0]) ? x[0] : x);
    if (dto.enabled) this.tick(tid).catch(() => {});   // act immediately on enable
    return r;
  }

  // ── Background ───────────────────────────────────────────────────────────────
  private async tickAll() {
    const tenants: { id: string }[] = await this.ds.query('SELECT tenant_id AS id FROM automode_settings WHERE enabled = true').catch(() => []);
    for (const t of tenants) await this.tick(t.id).catch(() => {});
  }

  async tick(tid: string) {
    const s = await this.getSettings(tid);
    if (!s.enabled) return { acted: 0 };
    const types: string[] = Array.isArray(s.allowed_types) ? s.allowed_types : ['permission'];

    // Pending requests of allowed types with the requester's function + the permission date.
    const pend: any[] = await this.ds.query(
      `SELECT r.id, rt.code AS type, r.requester_id, r.employee_id,
              COALESCE(rp.function_id, e.function_id) AS function_id,
              COALESCE(f1.name, f2.name, '—') AS function_name,
              rp.permission_date::text AS pdate
         FROM requests r
         JOIN request_types rt ON rt.id = r.request_type_id
         LEFT JOIN request_permissions rp ON rp.request_id = r.id
         LEFT JOIN employees e ON e.id = r.employee_id
         LEFT JOIN functions f1 ON f1.id = rp.function_id
         LEFT JOIN functions f2 ON f2.id = e.function_id
        WHERE r.tenant_id = $1 AND r.status IN ('pending')
          AND rt.code = ANY($2)
          AND NOT EXISTS (SELECT 1 FROM automode_decisions d WHERE d.request_id = r.id AND d.decision IN ('approve','reject'))
        LIMIT 50`, [tid, types]).catch(() => []);
    if (!pend.length) return { acted: 0 };

    // Cache assessment per date.
    const assessCache = new Map<string, any>();
    const verdictFor = async (date: string, functionId: string) => {
      if (!assessCache.has(date)) assessCache.set(date, await this.analyst.assess(tid, date).catch(() => null));
      const a = assessCache.get(date);
      const fn = a?.coverage?.functions?.find((f: any) => f.functionId === functionId);
      return fn ? { verdict: fn.verdict, gap: fn.bottleneck.gap, hour: fn.bottleneck.hour } : null;
    };

    let acted = 0;
    for (const req of pend) {
      const date = req.pdate ?? new Date().toISOString().slice(0, 10);
      const v = req.function_id ? await verdictFor(date, req.function_id) : null;
      let decision: 'approve' | 'reject' | 'hold' = 'hold';
      let reason = 'لا توجد قراءة تغطية كافية — تُرك للمراجعة البشرية.';
      if (v) {
        if (v.verdict === 'approve' && s.auto_approve) { decision = 'approve'; reason = `فائض آمن بالقسم ${req.function_name} (هامش ${v.gap})`; }
        else if (v.verdict === 'danger' && s.auto_reject) { decision = 'reject'; reason = `نقص تغطية بالقسم ${req.function_name} (${-v.gap} عند ${pad(v.hour)})`; }
        else reason = `تغطية ${v.verdict} بالقسم ${req.function_name} — تُرك للمراجعة.`;
      }
      await this.apply(tid, req, decision, reason, v, s.updated_by);
      if (decision !== 'hold') acted++;
    }
    if (acted) this.log.log(`tenant ${tid}: auto-decided ${acted} request(s)`);
    return { acted };
  }

  private async apply(tid: string, req: any, decision: 'approve' | 'reject' | 'hold', reason: string, metrics: any, actor: string | null) {
    // Record the decision (hold included, but only act on approve/reject).
    await this.ds.query(
      `INSERT INTO automode_decisions (tenant_id, request_id, request_type, decision, reason, function_name, scope_date, metrics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (request_id) WHERE (decision IN ('approve','reject')) DO NOTHING`,
      [tid, req.id, req.type, decision, reason, req.function_name, req.pdate ?? null, JSON.stringify(metrics ?? {})],
    ).catch(() => {});
    if (decision === 'hold') return;

    if (decision === 'approve') {
      await this.ds.query(
        `UPDATE requests SET status='approved', approved_l1_at=NOW(), current_approver_id=NULL, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.id, tid]).catch(() => {});
    } else {
      await this.ds.query(
        `UPDATE requests SET status='rejected', rejected_at=NOW(), rejected_by=$3, rejection_reason=$4, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
        [req.id, tid, actor, `Auto Mode: ${reason}`]).catch(() => {});
    }
    // Attributed audit entry (actor = whoever enabled Auto Mode).
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value, notes, created_at)
       VALUES ($1,$2,'auto-mode',$3,'automode','request',$4,$5::jsonb,$6,NOW())`,
      [tid, actor, decision === 'approve' ? 'auto_approve' : 'auto_reject', req.id, JSON.stringify({ decision, reason }), reason]).catch(() => {});
    // Notify the requester.
    await this.ds.query(
      `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url, created_at)
       VALUES ($1,$2,'automode',$3,$4,$5,$6,'request',$7,'/requests',NOW())`,
      [tid, req.requester_id, `Request ${decision}d (Auto Mode)`, `طلبك ${decision === 'approve' ? 'تمت الموافقة عليه' : 'رُفض'} (Auto Mode)`, reason, reason, req.id]).catch(() => {});
  }

  // ── Revert ───────────────────────────────────────────────────────────────────
  async revert(tid: string, decisionId: string, userId: string) {
    const [d] = await this.ds.query(`SELECT * FROM automode_decisions WHERE id=$1 AND tenant_id=$2 AND reverted=false AND decision IN ('approve','reject')`, [decisionId, tid]).catch(() => []);
    if (!d) return { ok: false, message: 'لا يوجد قرار قابل للتراجع' };
    await this.ds.query(`UPDATE requests SET status='pending', approved_l1_at=NULL, rejected_at=NULL, rejected_by=NULL, rejection_reason=NULL, current_approver_id=NULL, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [d.request_id, tid]).catch(() => {});
    await this.ds.query(`UPDATE automode_decisions SET reverted=true, reverted_by=$3, reverted_at=NOW() WHERE id=$1 AND tenant_id=$2`, [decisionId, tid, userId]).catch(() => {});
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes, created_at)
       VALUES ($1,$2,'auto-mode-revert','revert_auto_decision','automode','request',$3,$4,NOW())`,
      [tid, userId, d.request_id, `Reverted ${d.decision}`]).catch(() => {});
    return { ok: true };
  }

  async listDecisions(tid: string, limit = 40) {
    return this.ds.query(
      `SELECT d.id, d.request_type, d.decision, d.reason, d.function_name, d.scope_date, d.reverted, d.decided_at
         FROM automode_decisions d WHERE d.tenant_id = $1 ORDER BY d.decided_at DESC LIMIT $2`, [tid, limit]).catch(() => []);
  }

  // Summary for the Chief.
  async summary(tid: string) {
    const s = await this.getSettings(tid);
    const [c] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE decision='approve' AND NOT reverted)::int approved,
              COUNT(*) FILTER (WHERE decision='reject' AND NOT reverted)::int rejected,
              COUNT(*) FILTER (WHERE decided_at > NOW() - INTERVAL '24 hours')::int last24
         FROM automode_decisions WHERE tenant_id = $1`, [tid]).catch(() => [{}]);
    return { enabled: s.enabled, autoApprove: s.auto_approve, autoReject: s.auto_reject, allowedTypes: s.allowed_types, approved: c?.approved ?? 0, rejected: c?.rejected ?? 0, last24: c?.last24 ?? 0 };
  }
}

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }
