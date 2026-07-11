import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import {
  RawReportItem, SprinklrReportType, classifyReport,
  parseLoginLogout, parseSurvey, isEmail, isDateOnly,
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
}

const VALID_TYPES = new Set(['login_logout', 'survey', 'agent_perf', 'unknown']);

@Injectable()
export class SprinklrReportService {
  private readonly logger = new Logger(SprinklrReportService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Stage one or many captured reports. Idempotent per (tenant, report_type, content_hash). */
  async ingestReports(tenantId: string, reports: IncomingReport[]): Promise<{ staged: number; skipped: number; byType: Record<string, number> }> {
    let staged = 0, skipped = 0;
    const byType: Record<string, number> = {};

    for (const rep of reports) {
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
        if (Array.isArray(res) && res.length > 0) { staged++; byType[reportType] = (byType[reportType] || 0) + 1; }
        else skipped++;
      } catch (e: any) {
        this.logger.warn(`[${tenantId}] report stage failed (${reportType}): ${e?.message}`);
        skipped++;
      }
    }

    if (staged > 0) this.logger.log(`[${tenantId}] staged ${staged} Sprinklr report(s): ${JSON.stringify(byType)}`);
    return { staged, skipped, byType };
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
        if (r.report_type === 'login_logout') return { ...base, normalized: parseLoginLogout(staged).slice(0, 100) };
        if (r.report_type === 'survey') return { ...base, normalized: parseSurvey(staged).slice(0, 100) };
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
