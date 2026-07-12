import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import {
  RawReportItem, SprinklrReportType, ReportColumn, classifyReport,
  parseLoginLogout, parseSurvey, parseAgentSummary, agentSummaryToStatRow,
  AgentIdentity, isEmail, isDateOnly,
} from './sprinklr-report.parser';

/**
 * A0 report-row receiver. Separate from SprinklrService.ingestSnapshot (the live-status path) —
 * this only stages captured reporting TABLES into sprinklr_report_staging, idempotently.
 */

export interface IncomingReport {
  reportType?: string;
  reportName?: string;
  sourceOp?: string;
  url?: string;
  capturedAt?: string;
  columns?: { key: string; label?: string | null }[];
  rows?: RawReportItem[];
  rawSample?: string;
  /** TEMP debug-capture: the raw intercepted JSON payload (string), for shape discovery only. */
  rawPayload?: string;
  truncated?: boolean;
}

// 'debug_raw' is a store-only shape-discovery bucket — never parsed/promoted, but VALID so the
// getStaging endpoint can filter to it (?type=debug_raw).
const VALID_TYPES = new Set(['login_logout', 'survey', 'agent_perf', 'agent_summary', 'debug_raw', 'unknown']);

@Injectable()
export class SprinklrReportService {
  private readonly logger = new Logger(SprinklrReportService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Stage one or many captured reports. Idempotent per (tenant, report_type, content_hash). */
  async ingestReports(tenantId: string, reports: IncomingReport[]): Promise<{ staged: number; skipped: number; promoted: number; byType: Record<string, number> }> {
    let staged = 0, skipped = 0, promoted = 0;
    const byType: Record<string, number> = {};

    for (const rep of reports) {
      // TEMP debug-capture: store the raw payload as-is and STOP — never parse or promote it.
      // This is how we learn the real reportingQuery / label-metadata JSON shape before fixing
      // the agent_summary parser. Store-only, idempotent per (tenant, 'debug_raw', content_hash).
      if (rep?.reportType === 'debug_raw') {
        if (await this.stageDebugRaw(tenantId, rep)) { staged++; byType['debug_raw'] = (byType['debug_raw'] || 0) + 1; }
        else skipped++;
        continue;
      }

      const rows: RawReportItem[] = Array.isArray(rep?.rows) ? rep.rows : [];
      if (!rows.length) { skipped++; continue; }

      // Trust the extension's report_type when valid; otherwise re-classify server-side.
      let reportType: SprinklrReportType =
        (rep?.reportType && VALID_TYPES.has(rep.reportType) ? rep.reportType : classifyReport(rows)) as SprinklrReportType;
      if (!VALID_TYPES.has(reportType)) reportType = 'unknown';

      // Single-agent / single-day convenience columns (NULL when the report spans many).
      const { agentEmail, day } = this.summarizeScope(rows);

      const payload = {
        columns: Array.isArray(rep?.columns) ? rep.columns : null,
        rows,
        rawSample: typeof rep?.rawSample === 'string' ? rep.rawSample.slice(0, 60000) : undefined,
        sourceUrl: rep?.url ?? null,
        reportName: rep?.reportName ?? null,
      };
      const hash = this.hashReport(reportType, rows);

      try {
        const res = await this.ds.query(
          `INSERT INTO sprinklr_report_staging
             (tenant_id, report_type, source_op, day, agent_email, payload, row_count, content_hash, captured_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8, COALESCE($9::timestamptz, now()))
           ON CONFLICT (tenant_id, report_type, content_hash) DO NOTHING
           RETURNING id`,
          [tenantId, reportType, rep?.sourceOp ?? null, day, agentEmail,
           JSON.stringify(payload), rows.length, hash,
           this.safeIso(rep?.capturedAt)],
        );
        if (Array.isArray(res) && res.length > 0) {
          staged++; byType[reportType] = (byType[reportType] || 0) + 1;
          // Auto-promote agent-summary rows straight into agent_daily_stats so the Builder's
          // agent_ops source + the Inbound scorecard AHT see the REAL numbers as soon as captured.
          if (reportType === 'agent_summary') {
            try {
              const cols = Array.isArray(rep?.columns) ? (rep!.columns as ReportColumn[]) : undefined;
              promoted += await this.promoteAgentSummary(tenantId, rows, cols);
            } catch (e: any) {
              this.logger.warn(`[${tenantId}] agent_summary promotion failed: ${e?.message}`);
            }
          }
        } else skipped++;
      } catch (e: any) {
        this.logger.warn(`[${tenantId}] report stage failed (${reportType}): ${e?.message}`);
        skipped++;
      }
    }

    if (staged > 0) this.logger.log(`[${tenantId}] staged ${staged} Sprinklr report(s): ${JSON.stringify(byType)}${promoted ? ` | promoted ${promoted} agent-day stat(s)` : ''}`);
    return { staged, skipped, promoted, byType };
  }

  /**
   * TEMP debug-capture: store one raw intercepted payload for shape discovery. Store-ONLY — this
   * NEVER parses or promotes. row_count=0, day/agent_email NULL; the raw JSON lives in payload.rawPayload.
   * Idempotent per (tenant, 'debug_raw', content_hash) so the throttled poll can't duplicate.
   * Inspect with: SELECT report_type, source_op, left(payload::text,4000) FROM sprinklr_report_staging
   *               WHERE report_type='debug_raw' ORDER BY captured_at DESC LIMIT 5;
   */
  private async stageDebugRaw(tenantId: string, rep: IncomingReport): Promise<boolean> {
    const raw = typeof rep?.rawPayload === 'string' ? rep.rawPayload
      : (typeof rep?.rawSample === 'string' ? rep.rawSample : '');
    if (!raw) return false;

    const payload = {
      rawPayload: raw.slice(0, 200000),
      sourceOp: rep?.sourceOp ?? null,
      sourceUrl: rep?.url ?? null,
      truncated: rep?.truncated ?? undefined,
    };
    const hash = createHash('sha256')
      .update('debug_raw\n' + (rep?.sourceOp ?? '') + '\n' + raw)
      .digest('hex');

    try {
      const res = await this.ds.query(
        `INSERT INTO sprinklr_report_staging
           (tenant_id, report_type, source_op, day, agent_email, payload, row_count, content_hash, captured_at)
         VALUES ($1,'debug_raw',$2,NULL,NULL,$3::jsonb,0,$4, COALESCE($5::timestamptz, now()))
         ON CONFLICT (tenant_id, report_type, content_hash) DO NOTHING
         RETURNING id`,
        [tenantId, rep?.sourceOp ?? null, JSON.stringify(payload), hash, this.safeIso(rep?.capturedAt)],
      );
      return Array.isArray(res) && res.length > 0;
    } catch (e: any) {
      this.logger.warn(`[${tenantId}] debug_raw stage failed: ${e?.message}`);
      return false;
    }
  }

  /**
   * Promote captured Agent-Summary rows → agent_daily_stats (aht_seconds + contacts_received +
   * talk/hold/acw detail in `extra`). Resolves the numeric Sprinklr id + employee_id per agent
   * from the identity maps (so it merges with the live-status row for that agent/day); when the
   * email is unresolved it uses a deterministic `email:<addr>` key that stays idempotent and never
   * double-counts against the live path (which owns the busy/idle minutes). Returns rows upserted.
   */
  async promoteAgentSummary(tenantId: string, rows: RawReportItem[], columns?: ReportColumn[]): Promise<number> {
    const normalized = parseAgentSummary(rows, columns);
    const idCache = new Map<string, AgentIdentity>();
    let n = 0;

    for (const row of normalized) {
      if (!row.agent_email || !row.day) continue;         // need both the identity and the day
      const email = row.agent_email;
      let ident = idCache.get(email);
      if (!ident) { ident = await this.resolveIdentity(tenantId, email); idCache.set(email, ident); }

      const s = agentSummaryToStatRow(row, ident);
      if (!s.sprinklr_agent_id || !s.stat_date) continue;

      await this.ds.query(
        `INSERT INTO agent_daily_stats
           (tenant_id, stat_date, sprinklr_agent_id, agent_name, agent_email, employee_id,
            contacts_received, aht_seconds, avg_response_seconds, extra, computed_at)
         VALUES ($1,$2::date,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10::jsonb, NOW())
         ON CONFLICT (tenant_id, stat_date, sprinklr_agent_id) DO UPDATE SET
           agent_name           = COALESCE(EXCLUDED.agent_name, agent_daily_stats.agent_name),
           agent_email          = COALESCE(EXCLUDED.agent_email, agent_daily_stats.agent_email),
           employee_id          = COALESCE(EXCLUDED.employee_id, agent_daily_stats.employee_id),
           contacts_received    = COALESCE(EXCLUDED.contacts_received, agent_daily_stats.contacts_received),
           aht_seconds          = COALESCE(EXCLUDED.aht_seconds, agent_daily_stats.aht_seconds),
           avg_response_seconds = COALESCE(EXCLUDED.avg_response_seconds, agent_daily_stats.avg_response_seconds),
           extra                = COALESCE(agent_daily_stats.extra, '{}'::jsonb) || EXCLUDED.extra,
           computed_at          = NOW()`,
        [tenantId, s.stat_date, s.sprinklr_agent_id, s.agent_name, s.agent_email, s.employee_id,
         s.contacts_received, s.aht_seconds, s.avg_response_seconds, JSON.stringify(s.extra)],
      );
      n++;
    }
    if (n > 0) this.logger.log(`[${tenantId}] agent_summary → agent_daily_stats: ${n} agent-day row(s) upserted`);
    return n;
  }

  /** Re-promote ALL staged agent_summary reports (backfill / manual re-run — no re-capture needed). */
  async promoteAllStagedAgentSummary(tenantId: string): Promise<{ reports: number; promoted: number }> {
    const staged = await this.ds.query(
      `SELECT payload FROM sprinklr_report_staging
        WHERE tenant_id = $1 AND report_type = 'agent_summary' ORDER BY captured_at ASC`, [tenantId],
    ).catch(() => []);
    let promoted = 0;
    for (const r of staged) {
      const rows: RawReportItem[] = Array.isArray(r.payload?.rows) ? r.payload.rows : [];
      const cols: ReportColumn[] | undefined = Array.isArray(r.payload?.columns) ? r.payload.columns : undefined;
      if (rows.length) promoted += await this.promoteAgentSummary(tenantId, rows, cols).catch(() => 0);
    }
    return { reports: staged.length, promoted };
  }

  /** Resolve an agent email → { sprinklrAgentId, employeeId } via the identity maps (best effort). */
  private async resolveIdentity(tenantId: string, email: string): Promise<AgentIdentity> {
    const out: AgentIdentity = { sprinklrAgentId: null, employeeId: null };
    const im = await this.ds.query(
      `SELECT sprinklr_agent_id, employee_id FROM employee_identity_map
        WHERE tenant_id = $1 AND (lower(email) = lower($2) OR lower(sprinklr_email) = lower($2))
        ORDER BY resolved DESC, confidence DESC LIMIT 1`, [tenantId, email],
    ).catch(() => []);
    if (im?.length) { out.sprinklrAgentId = im[0].sprinklr_agent_id || null; out.employeeId = im[0].employee_id || null; }
    if (!out.sprinklrAgentId || !out.employeeId) {
      const am = await this.ds.query(
        `SELECT sprinklr_agent_id, employee_id FROM sprinklr_agent_map
          WHERE tenant_id = $1 AND lower(agent_email) = lower($2)
          ORDER BY (employee_id IS NOT NULL) DESC, last_seen DESC LIMIT 1`, [tenantId, email],
      ).catch(() => []);
      if (am?.length) {
        out.sprinklrAgentId = out.sprinklrAgentId || am[0].sprinklr_agent_id || null;
        out.employeeId = out.employeeId || am[0].employee_id || null;
      }
    }
    return out;
  }

  /** Inspect staged reports (metadata + optional normalized preview). */
  async getStaging(
    tenantId: string,
    opts: { type?: string; from?: string; to?: string; limit?: number; normalize?: boolean } = {},
  ) {
    const params: any[] = [tenantId];
    let where = 'tenant_id = $1';
    if (opts.type && VALID_TYPES.has(opts.type)) { params.push(opts.type); where += ` AND report_type = $${params.length}`; }
    if (opts.from) { params.push(opts.from); where += ` AND captured_at >= $${params.length}::timestamptz`; }
    if (opts.to) { params.push(opts.to); where += ` AND captured_at <= $${params.length}::timestamptz`; }
    const limit = Math.min(500, Math.max(1, opts.limit || 100));

    const rows = await this.ds.query(
      `SELECT id, report_type, source_op, day, agent_email, row_count, content_hash, captured_at,
              payload
         FROM sprinklr_report_staging
        WHERE ${where}
        ORDER BY captured_at DESC
        LIMIT ${limit}`, params).catch(() => []);

    const summary = await this.ds.query(
      `SELECT report_type, COUNT(*)::int reports, SUM(row_count)::int total_rows,
              MAX(captured_at) last_captured
         FROM sprinklr_report_staging WHERE tenant_id = $1
        GROUP BY report_type ORDER BY reports DESC`, [tenantId]).catch(() => []);

    const items = rows.map((r: any) => {
      const base = {
        id: r.id, report_type: r.report_type, source_op: r.source_op,
        day: r.day, agent_email: r.agent_email, row_count: r.row_count,
        captured_at: r.captured_at,
        columns: r.payload?.columns ?? null,
        rawSample: r.payload?.rawSample ?? undefined,
      };
      if (opts.normalize) {
        const staged: RawReportItem[] = Array.isArray(r.payload?.rows) ? r.payload.rows : [];
        const cols: ReportColumn[] | undefined = Array.isArray(r.payload?.columns) ? r.payload.columns : undefined;
        if (r.report_type === 'login_logout') return { ...base, normalized: parseLoginLogout(staged).slice(0, 100) };
        if (r.report_type === 'survey') return { ...base, normalized: parseSurvey(staged).slice(0, 100) };
        if (r.report_type === 'agent_summary') return { ...base, normalized: parseAgentSummary(staged, cols).slice(0, 100) };
      }
      return base;
    });

    return { summary, count: items.length, items };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private summarizeScope(rows: RawReportItem[]): { agentEmail: string | null; day: string | null } {
    const emails = new Set<string>();
    const days = new Set<string>();
    for (const it of rows) {
      const vals: any[] = [];
      if (Array.isArray(it.expandedKey)) vals.push(...it.expandedKey);
      for (const v of Object.values(it.dims || {})) Array.isArray(v) ? vals.push(...v) : vals.push(v);
      for (const v of vals) {
        if (isEmail(v)) emails.add(String(v).toLowerCase());
        else if (isDateOnly(v)) days.add(String(v));
      }
    }
    return {
      agentEmail: emails.size === 1 ? [...emails][0] : null,
      day: days.size === 1 ? [...days][0] : null,
    };
  }

  private hashReport(reportType: string, rows: RawReportItem[]): string {
    // Stable content hash — sort keys so JSON key order can't defeat dedup.
    const norm = rows.map((r) => ({
      d: this.sortObj(r.dims || {}),
      m: this.sortObj(r.measures || {}),
      e: Array.isArray(r.expandedKey) ? r.expandedKey : undefined,
    }));
    return createHash('sha256').update(reportType + '\n' + JSON.stringify(norm)).digest('hex');
  }

  private sortObj(o: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const k of Object.keys(o).sort()) out[k] = o[k];
    return out;
  }

  private safeIso(v?: string): string | null {
    if (!v) return null;
    const t = Date.parse(v);
    return isNaN(t) ? null : new Date(t).toISOString();
  }
}
