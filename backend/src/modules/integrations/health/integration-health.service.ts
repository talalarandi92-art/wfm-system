import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Auto-Ingest A4 — Bridge health / auto-ingest status.
 *
 * Read-only aggregation over the capture pipeline so the Director can see, at a
 * glance, which session-riding bridge is flowing and which is still waiting for
 * a live capture. Every query is defensive (.catch → empty) — a missing table
 * NEVER 500s this endpoint. Nothing here writes.
 *
 * Verdict grammar (staleness-driven):
 *   green  = has data AND fresh (age ≤ threshold)
 *   amber  = has data but stale (age > threshold)  OR  empty staging source still
 *            awaiting the Director's live session
 *   red    = a LIVE source that has never produced a single capture
 *
 * Thresholds are documented constants (below). Live snapshots (Sprinklr/Ameyo)
 * are expected within minutes; staged report/Odoo rows within a day.
 */

// ── Staleness thresholds (documented) ────────────────────────────────────────
export const HEALTH_THRESHOLDS = {
  sprinklrLiveSec: 5 * 60,       // Sprinklr live RTA snapshot — every ~30-60s when the tab is open
  sprinklrReportSec: 24 * 3600,  // Sprinklr reporting-table staging — captured per reporting session
  odooSec: 24 * 3600,            // Odoo staging (attendance/permission/comp/leave)
  ameyoLiveSec: 5 * 60,          // Ameyo live snapshot
} as const;

type Verdict = 'green' | 'amber' | 'red';

// Odoo model → group classification (mirrors the recon-emit filters exactly).
const ODOO_ATTENDANCE = /(^|\.)hr\.attendance$/i;
const ODOO_PERMISSION = /permission/i;
const ODOO_COMP = /comp[._]?off/i;
const ODOO_LEAVE = /leave|time.?off|holiday/i;
const ODOO_PERM_EXCLUDE = /balance|total|extra|overtime/i;
const ODOO_NON_REQUEST = /^(res\.|ir\.|bus\.|mail\.|web|base|website|crm)/i;

function ageSecOf(ts: any): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

@Injectable()
export class IntegrationHealthService {
  private readonly logger = new Logger(IntegrationHealthService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getHealth(tenantId: string) {
    const [sprinklrLive, sprinklrReports, odoo, ameyo, emitters] = await Promise.all([
      this.sprinklrLive(tenantId),
      this.sprinklrReports(tenantId),
      this.odoo(tenantId),
      this.ameyoLive(tenantId),
      this.emitters(tenantId),
    ]);

    const sources = [sprinklrLive, sprinklrReports, odoo, ameyo];

    // Overall = worst verdict across the live+staging sources (emitters are readiness, not health).
    const rank: Record<Verdict, number> = { green: 0, amber: 1, red: 2 };
    const overall = sources.reduce<Verdict>(
      (worst, s) => (rank[s.verdict] > rank[worst] ? s.verdict : worst),
      'green',
    );

    return {
      generatedAt: new Date().toISOString(),
      tenantId,
      thresholds: HEALTH_THRESHOLDS,
      overall,
      sources,
      emitters,
    };
  }

  // ── Sprinklr live RTA snapshot ─────────────────────────────────────────────
  private async sprinklrLive(tenantId: string) {
    const rows: any[] = await this.ds
      .query(
        `SELECT captured_at, queue_count, agent_count
           FROM integration_snapshots
          WHERE tenant_id = $1 AND source = 'sprinklr'
          ORDER BY captured_at DESC LIMIT 1`,
        [tenantId],
      )
      .catch(() => []);

    const row = rows[0] || null;
    const ageSec = row ? ageSecOf(row.captured_at) : null;
    const isStale = ageSec == null || ageSec > HEALTH_THRESHOLDS.sprinklrLiveSec;
    const verdict: Verdict = !row ? 'red' : isStale ? 'amber' : 'green';

    return {
      key: 'sprinklr_live',
      kind: 'live' as const,
      lastCaptureAt: row?.captured_at ?? null,
      ageSec,
      isStale,
      verdict,
      awaiting: !row,
      detail: { queues: row?.queue_count ?? 0, agents: row?.agent_count ?? 0 },
    };
  }

  // ── Sprinklr reporting-table staging (login/logout · survey · agent-perf) ──
  private async sprinklrReports(tenantId: string) {
    const rows: any[] = await this.ds
      .query(
        `SELECT report_type,
                COUNT(*)::int          AS reports,
                COALESCE(SUM(row_count),0)::int AS rows,
                MAX(captured_at)       AS last_captured
           FROM sprinklr_report_staging
          WHERE tenant_id = $1
          GROUP BY report_type
          ORDER BY reports DESC`,
        [tenantId],
      )
      .catch(() => []);

    const byType = rows.map((r) => ({
      reportType: r.report_type,
      reports: r.reports,
      rows: r.rows,
      lastCaptureAt: r.last_captured,
      ageSec: ageSecOf(r.last_captured),
    }));
    const totalRows = byType.reduce((s, r) => s + (r.rows || 0), 0);
    const latest = byType.reduce<any>((mx, r) => (!mx || (r.lastCaptureAt && r.lastCaptureAt > mx) ? r.lastCaptureAt : mx), null);
    const ageSec = ageSecOf(latest);
    const has = totalRows > 0;
    const isStale = ageSec == null || ageSec > HEALTH_THRESHOLDS.sprinklrReportSec;
    // Empty report staging is EXPECTED until the Director opens the reporting tab → amber/awaiting.
    const verdict: Verdict = !has ? 'amber' : isStale ? 'amber' : 'green';

    return {
      key: 'sprinklr_reports',
      kind: 'staging' as const,
      lastCaptureAt: latest ?? null,
      ageSec,
      isStale,
      verdict,
      awaiting: !has,
      detail: { totalRows, byType },
    };
  }

  // ── Odoo staging (per model-group: attendance / permission / comp / leave) ──
  private async odoo(tenantId: string) {
    const rows: any[] = await this.ds
      .query(
        `SELECT model,
                COUNT(*)::int    AS rows,
                MAX(captured_at) AS last_captured
           FROM odoo_staging
          WHERE tenant_id = $1
          GROUP BY model`,
        [tenantId],
      )
      .catch(() => []);

    const groupOf = (model: string): string => {
      const m = String(model || '');
      if (ODOO_ATTENDANCE.test(m)) return 'attendance';
      if (ODOO_PERMISSION.test(m) && !ODOO_PERM_EXCLUDE.test(m) && !ODOO_NON_REQUEST.test(m)) return 'permission';
      if (ODOO_COMP.test(m) && !ODOO_PERM_EXCLUDE.test(m) && !ODOO_NON_REQUEST.test(m)) return 'comp';
      if (ODOO_LEAVE.test(m) && !ODOO_NON_REQUEST.test(m)) return 'leave';
      return 'other';
    };

    const groupMap: Record<string, { rows: number; lastCaptureAt: any; models: string[] }> = {};
    for (const r of rows) {
      const g = groupOf(r.model);
      if (!groupMap[g]) groupMap[g] = { rows: 0, lastCaptureAt: null, models: [] };
      groupMap[g].rows += r.rows || 0;
      groupMap[g].models.push(r.model);
      if (r.last_captured && (!groupMap[g].lastCaptureAt || r.last_captured > groupMap[g].lastCaptureAt)) {
        groupMap[g].lastCaptureAt = r.last_captured;
      }
    }

    const groups = Object.entries(groupMap).map(([group, v]) => ({
      group,
      rows: v.rows,
      models: v.models,
      lastCaptureAt: v.lastCaptureAt,
      ageSec: ageSecOf(v.lastCaptureAt),
    }));

    const totalRows = groups.reduce((s, g) => s + g.rows, 0);
    const latest = groups.reduce<any>((mx, g) => (g.lastCaptureAt && (!mx || g.lastCaptureAt > mx) ? g.lastCaptureAt : mx), null);
    const ageSec = ageSecOf(latest);
    const has = totalRows > 0;
    const isStale = ageSec == null || ageSec > HEALTH_THRESHOLDS.odooSec;
    const verdict: Verdict = !has ? 'amber' : isStale ? 'amber' : 'green';

    return {
      key: 'odoo',
      kind: 'staging' as const,
      lastCaptureAt: latest ?? null,
      ageSec,
      isStale,
      verdict,
      awaiting: !has,
      detail: { totalRows, groups },
    };
  }

  // ── Ameyo live snapshot ────────────────────────────────────────────────────
  private async ameyoLive(tenantId: string) {
    const rows: any[] = await this.ds
      .query(
        `SELECT captured_at, queue_count, agent_count
           FROM integration_snapshots
          WHERE tenant_id = $1 AND source = 'ameyo'
          ORDER BY captured_at DESC LIMIT 1`,
        [tenantId],
      )
      .catch(() => []);

    const row = rows[0] || null;
    const ageSec = row ? ageSecOf(row.captured_at) : null;
    const isStale = ageSec == null || ageSec > HEALTH_THRESHOLDS.ameyoLiveSec;
    // Ameyo bridge is discovery-stage — treat "never captured" as amber/awaiting, not red.
    const verdict: Verdict = !row ? 'amber' : isStale ? 'amber' : 'green';

    return {
      key: 'ameyo_live',
      kind: 'live' as const,
      lastCaptureAt: row?.captured_at ?? null,
      ageSec,
      isStale,
      verdict,
      awaiting: !row,
      detail: { queues: row?.queue_count ?? 0, agents: row?.agent_count ?? 0 },
    };
  }

  // ── Emitter readiness (do the 3 recon-emit inputs have rows?) ──────────────
  private async emitters(tenantId: string) {
    const one = async (label: string, sql: string): Promise<{ rows: number; latest: any }> => {
      const r: any[] = await this.ds.query(sql, [tenantId]).catch(() => []);
      const row = r[0] || {};
      return { rows: Number(row.rows || 0), latest: row.latest ?? null };
    };

    const [sessions, fingerprint, permissions] = await Promise.all([
      one(
        'sprinklr_sessions',
        `SELECT COUNT(*)::int AS rows, MAX(captured_at) AS latest
           FROM sprinklr_report_staging
          WHERE tenant_id = $1 AND report_type = 'login_logout'`,
      ),
      one(
        'odoo_fingerprint',
        `SELECT COUNT(*)::int AS rows, MAX(captured_at) AS latest
           FROM odoo_staging
          WHERE tenant_id = $1 AND model ~* '(^|\\.)hr\\.attendance$'`,
      ),
      one(
        'odoo_permissions',
        `SELECT COUNT(*)::int AS rows, MAX(captured_at) AS latest
           FROM odoo_staging
          WHERE tenant_id = $1
            AND model ~* 'permission|comp[._]?off'
            AND model !~* 'balance|total|extra|overtime'
            AND model !~* '^(res\\.|ir\\.|bus\\.|mail\\.|web|base|website|crm)'`,
      ),
    ]);

    const mk = (key: string, emits: string, r: { rows: number; latest: any }) => ({
      key,
      emits, // the recon xlsx shape this emitter produces
      inputRows: r.rows,
      lastCaptureAt: r.latest,
      ageSec: ageSecOf(r.latest),
      ready: r.rows > 0,
    });

    return [
      mk('sprinklr_sessions', 'Login and Logout sprinklr.xlsx', sessions),
      mk('odoo_fingerprint', 'Odoo Fingerprint.xlsx', fingerprint),
      mk('odoo_permissions', 'Permission & Compo.xlsx', permissions),
    ];
  }
}
