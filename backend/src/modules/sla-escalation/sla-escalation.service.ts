import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentRunner } from '@common/agent-runner';

/**
 * SLA auto-escalation.
 * A lightweight background loop (no external scheduler dependency) escalates
 * requests whose sla_due_at has passed while still pending, and notifies
 * WFM / RTA / Ops. Idempotent via requests.escalated_at.
 */
@Injectable()
export class SlaEscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaEscalationService.name);
  private timer?: NodeJS.Timeout;
  private readonly INTERVAL_MS = 3 * 60_000; // every 3 minutes

  private readonly runner: AgentRunner;
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.runner = new AgentRunner(this.ds, 'sla-escalation-loop');
  }

  onModuleInit() {
    // First pass shortly after boot, then on a fixed cadence.
    setTimeout(() => this.run(), 30_000);
    this.timer = setInterval(() => this.run(), this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private run() {
    // Cross-process exclusivity: a pg advisory lock ensures only ONE instance runs this
    // write-loop per tick, so a multi-instance deploy never double-escalates / double-notifies.
    this.runner.runExclusive(async () => {
      await Promise.all([
        this.escalateOverdue().catch(e => this.logger.warn(`SLA escalation pass failed: ${e.message}`)),
        this.escalateOverdueTechReports().catch(e => this.logger.warn(`Tech-report SLA pass failed: ${e.message}`)),
      ]);
    }).catch(e => this.logger.warn(`SLA escalation lock skipped: ${e.message}`));
  }

  /** Reviewers (RTA/WFM/Ops/Admin) for a tenant — notification recipients. */
  private async reviewersFor(tid: string): Promise<string[]> {
    const rows = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1 AND r.code IN ('rta','wfm_analyst','wfm_supervisor','operations_manager','platform_admin')`,
      [tid],
    ).catch(() => []);
    return rows.map((x: any) => x.id);
  }

  /** Escalate technical issues whose 48h SLA has passed while still open. Idempotent via sla_escalated_at. */
  async escalateOverdueTechReports(): Promise<number> {
    const overdue = await this.ds.query(
      `SELECT id, tenant_id, title, COALESCE(reporter_name,'—') AS reporter
         FROM agent_tech_reports
        WHERE status NOT IN ('resolved','rejected','escalated_to_outage')
          AND sla_due_at IS NOT NULL AND sla_due_at < NOW()
          AND sla_escalated_at IS NULL
        LIMIT 500`,
    ).catch(() => []);
    if (!overdue.length) return 0;
    let count = 0;
    for (const t of overdue) {
      await this.ds.query(`UPDATE agent_tech_reports SET sla_escalated_at = NOW(), updated_at = NOW() WHERE id = $1`, [t.id]).catch(() => {});
      const reviewers = await this.reviewersFor(t.tenant_id);
      const body = `مشكلة تقنية «${t.title}» (المُبلِّغ ${String(t.reporter).trim()}) تجاوزت SLA (48 ساعة) — تحتاج تحقّق/تصعيد عاجل`;
      for (const uid of reviewers) {
        await this.ds.query(
          `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id)
           VALUES ($1,$2,'tech_issue.sla_escalation','Tech issue past SLA','تصعيد SLA لمشكلة تقنية',$3,$3,'tech_issue',$4)`,
          [t.tenant_id, uid, body, t.id],
        ).catch(() => {});
      }
      await this.ds.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
         VALUES ($1, NULL, 'system', 'tech_issue.sla_escalated', 'technical-issues', 'tech_issue', $2, 'Auto-escalated on SLA breach')`,
        [t.tenant_id, t.id],
      ).catch(() => {});
      count++;
    }
    if (count > 0) this.logger.log(`SLA escalation: ${count} overdue tech report(s) escalated`);
    return count;
  }

  /** Escalate every overdue, not-yet-escalated, still-open request. Returns count. */
  async escalateOverdue(): Promise<number> {
    const overdue = await this.ds.query(
      `SELECT r.id, r.tenant_id, rt.name AS type_name,
              COALESCE(e.first_name_en || ' ' || COALESCE(e.last_name_en,''), '—') AS emp
         FROM requests r
         JOIN request_types rt ON rt.id = r.request_type_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.status IN ('pending','peer_pending')
          AND r.sla_due_at IS NOT NULL AND r.sla_due_at < NOW()
          AND r.escalated_at IS NULL
        LIMIT 500`,
    ).catch(() => []);
    if (!overdue.length) return 0;

    // Cache reviewers per tenant to avoid repeat lookups.
    const reviewerCache = new Map<string, string[]>();
    const reviewersFor = async (tid: string): Promise<string[]> => {
      if (reviewerCache.has(tid)) return reviewerCache.get(tid)!;
      const rows = await this.ds.query(
        `SELECT DISTINCT u.id FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
          WHERE u.tenant_id = $1 AND r.code IN ('rta','wfm_analyst','wfm_supervisor','operations_manager','platform_admin')`,
        [tid],
      ).catch(() => []);
      const ids = rows.map((x: any) => x.id);
      reviewerCache.set(tid, ids);
      return ids;
    };

    let count = 0;
    for (const r of overdue) {
      await this.ds.query(
        `UPDATE requests SET escalated_at = NOW(), escalation_level = 1, updated_at = NOW() WHERE id = $1`,
        [r.id],
      );
      const reviewers = await reviewersFor(r.tenant_id);
      const body = `طلب ${r.type_name} (${String(r.emp).trim()}) تجاوز زمن الاستجابة (SLA) — يحتاج قرار عاجل`;
      for (const uid of reviewers) {
        await this.ds.query(
          `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, body, entity_type, entity_id)
           VALUES ($1, $2, 'request.sla_escalation', 'تصعيد SLA', $3, 'request', $4)`,
          [r.tenant_id, uid, body, r.id],
        ).catch(() => {});
      }
      await this.ds.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
         VALUES ($1, NULL, 'system', 'request.sla_escalated', 'requests', 'request', $2, 'Auto-escalated on SLA breach')`,
        [r.tenant_id, r.id],
      ).catch(() => {});
      count++;
    }
    if (count > 0) this.logger.log(`SLA escalation: ${count} overdue request(s) escalated`);
    return count;
  }
}
