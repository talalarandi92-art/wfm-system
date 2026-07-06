import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';

/**
 * AI WORKFORCE — the shared agent scaffold (W0, 2026-07-06; AI_WORKFORCE_ARCHITECTURE.md §1/§3).
 *
 * Every AI agent (the existing 8 guards + Chief, and the 35-agent target set) runs through this
 * contract instead of copy-pasted setInterval loops:
 *   • publishEvent()  — append-only agent_events row (the pub/sub backbone + the explainability
 *     record: payload carries the evidence, never a black-box verdict).
 *   • consumeEvents() — read other agents' events since a watermark (collaboration without a
 *     hardcoded exchange graph).
 *   • runExclusive()  — a Postgres advisory-lock distributed lock, so multi-instance deploys
 *     never double-run a scheduled agent loop (no duplicate notifications).
 *
 * Wave plan: W0 this scaffold · W1 expose the 13 EXISTS agents through it · W2 extend the 16
 * PARTIALs · W3 data pipelines · W4 the 6 NEW agents. LLM narration activates when
 * ANTHROPIC_API_KEY lands (LlmService.isConfigured()) — agents degrade to their deterministic
 * path until then. Human-in-the-loop for regulated/pay actions is NON-negotiable.
 */

export type AgentEventType = 'finding' | 'recommendation' | 'decision' | 'alert' | 'learning' | 'sync';
export type AgentSeverity = 'info' | 'warn' | 'critical';

export interface AgentEvent {
  id: number;
  agent: string;
  eventType: AgentEventType;
  subjectRef: string | null;
  severity: AgentSeverity;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class AgentRunner {
  private readonly log: Logger;

  constructor(
    private readonly ds: DataSource,
    /** agent name, e.g. 'health-guard', 'wfm-copilot' — shows on every event it publishes */
    public readonly agent: string,
  ) {
    this.log = new Logger(`Agent:${agent}`);
  }

  /** Publish a finding/recommendation/decision to the bus. payload = the EVIDENCE (explainable AI). */
  async publishEvent(
    tenantId: string,
    eventType: AgentEventType,
    payload: Record<string, unknown>,
    opts: { subjectRef?: string; severity?: AgentSeverity } = {},
  ): Promise<void> {
    await this.ds.query(
      `INSERT INTO agent_events (tenant_id, agent, event_type, subject_ref, severity, payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [tenantId, this.agent, eventType, opts.subjectRef ?? null, opts.severity ?? 'info', JSON.stringify(payload)],
    ).catch((e) => this.log.warn(`publishEvent failed: ${e.message}`));
  }

  /** Consume events from OTHER agents (optionally filtered) newer than sinceId. */
  async consumeEvents(
    tenantId: string,
    opts: { sinceId?: number; agents?: string[]; types?: AgentEventType[]; subjectRef?: string; limit?: number } = {},
  ): Promise<AgentEvent[]> {
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1 AND agent <> ' + `$${params.push(this.agent)}`;
    if (opts.sinceId)   where += ` AND id > $${params.push(opts.sinceId)}`;
    if (opts.agents?.length) where += ` AND agent = ANY($${params.push(opts.agents)})`;
    if (opts.types?.length)  where += ` AND event_type = ANY($${params.push(opts.types)})`;
    if (opts.subjectRef)     where += ` AND subject_ref = $${params.push(opts.subjectRef)}`;
    const rows = await this.ds.query(
      `SELECT id, agent, event_type, subject_ref, severity, payload, created_at
         FROM agent_events WHERE ${where} ORDER BY id ASC LIMIT $${params.push(Math.min(opts.limit ?? 200, 1000))}`,
      params,
    ).catch(() => []);
    return rows.map((r: any) => ({
      id: +r.id, agent: r.agent, eventType: r.event_type, subjectRef: r.subject_ref,
      severity: r.severity, payload: r.payload ?? {}, createdAt: r.created_at,
    }));
  }

  /**
   * Run `fn` under a Postgres advisory lock derived from the agent name — in a multi-instance
   * deploy only ONE instance executes a given agent's scheduled loop (no duplicate work/notifications).
   * Returns null when another instance holds the lock.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T | null> {
    const key = this.lockKey();
    const [row] = await this.ds.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
    if (!row?.ok) { this.log.debug('another instance holds the lock — skipping this tick'); return null; }
    try { return await fn(); }
    finally { await this.ds.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {}); }
  }

  /** Stable 32-bit lock key from the agent name. */
  private lockKey(): number {
    let h = 0x811c9dc5;
    for (const ch of `wfm-agent:${this.agent}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
    return h | 0;
  }
}
