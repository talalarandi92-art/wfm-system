import {
  Injectable, ForbiddenException, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compile, compileDrill, getSource, listCatalog, CompileInput, DrillInput, EnforcedFilter, BuilderValidationError } from './query-compiler';
import { DataSourceDef } from './data-sources';
import { DATA_SOURCES, dimensionBadge, metricBadge, contractFormat, contractType } from './data-sources';

/**
 * BUILDER v2 service — universal self-service report engine (BLD-1).
 *
 * RBAC: a source is readable only if the user holds its declared permission. Agents
 * (no attendance.view_team / view_all) are hard-scoped to their OWN person via a
 * server-enforced filter on the source's personCol; sources without a personCol are
 * denied to agents entirely. tenant_id is always injected by the compiler.
 */
@Injectable()
export class ReportBuilderV2Service {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private has(perms: string[], code: string) { return perms.includes(code); }
  private isTeamViewer(perms: string[]) {
    return this.has(perms, 'attendance.view_team') || this.has(perms, 'attendance.view_all');
  }

  /** Resolve the caller's own person key (roster_days.person_no / scorecard employee_no). */
  private async ownPersonNo(tid: string, employeeId?: string | null): Promise<string | null> {
    if (!employeeId) return null;
    const [e] = await this.ds.query(`SELECT employee_no FROM employees WHERE id=$1 AND tenant_id=$2`, [employeeId, tid]).catch(() => []);
    if (!e?.employee_no) return null;
    // fold an old/superseded id into its canonical person via the identity layer
    const [i] = await this.ds.query(
      `SELECT person_no FROM employee_identity WHERE tenant_id=$1 AND employee_no=$2 LIMIT 1`, [tid, e.employee_no]).catch(() => []);
    return i?.person_no || e.employee_no;
  }

  /** Sources the user may see (permission-filtered). */
  sources(perms: string[]) {
    return { sources: listCatalog(perms) };
  }

  /** Full dims+metrics for one source (if permitted). */
  sourceDetail(perms: string[], key: string) {
    const src = this.resolveSource(key);
    if (!this.has(perms, src.permission)) throw new ForbiddenException('Not permitted to read this data source');
    return {
      key: src.key, label_en: src.label_en, label_ar: src.label_ar, group: src.group,
      category: src.category ?? src.group,
      description_en: src.description_en ?? '', description_ar: src.description_ar ?? '',
      dateColumn: src.dateCol, personScoped: !!src.personCol, personCol: src.personCol ?? null,
      dimensions: src.dimensions.map(d => ({
        key: d.key, label_en: d.label_en, label_ar: d.label_ar,
        type: contractType(d.type), time: !!d.time,
        ...(d.time ? { format: 'time' as const } : {}),
        kind: 'dimension' as const, badge: dimensionBadge(d),
        category: d.category ?? 'General',
        description_en: d.description_en ?? '', description_ar: d.description_ar ?? '',
      })),
      metrics: src.metrics.map(m => ({
        key: m.key, label_en: m.label_en, label_ar: m.label_ar,
        type: 'number' as const, kind: 'metric' as const, badge: metricBadge(m),
        format: contractFormat(m),
        category: m.category ?? 'Metrics',
        description_en: m.description_en ?? '', description_ar: m.description_ar ?? '',
      })),
    };
  }

  /**
   * Resolve RBAC + agent self-scope for a source: throws if the caller may not read
   * it; returns the server-enforced filters (agent hard-scoped to own person). Shared
   * by run() and drill() so both apply IDENTICAL scoping.
   */
  private async resolveScope(
    user: { tenantId: string; employeeId?: string | null; permissionCodes: string[] },
    src: DataSourceDef,
  ): Promise<EnforcedFilter[]> {
    const perms = user.permissionCodes ?? [];
    if (!this.has(perms, src.permission)) throw new ForbiddenException(`Not permitted to read source "${src.key}"`);
    const enforced: EnforcedFilter[] = [];
    if (!this.isTeamViewer(perms)) {
      // agent: restrict to own person, or deny if the source has no person grain
      if (!src.personCol) throw new ForbiddenException('This data source is not available at agent scope');
      const own = await this.ownPersonNo(user.tenantId, user.employeeId ?? null);
      if (!own) throw new ForbiddenException('No employee profile linked to this account');
      enforced.push({ col: src.personCol, op: 'eq', value: own });
    }
    return enforced;
  }

  /** Compile + execute a builder request with RBAC + agent self-scope. */

  /**
   * getSource() throws BuilderValidationError for an unknown or missing key — the
   * right error, raised in the wrong place: every caller invoked it BEFORE the
   * try/catch that turns those into a 400, so a body with no `sourceKey` (or a
   * mistyped one) came back as a bare 500 "Internal server error" with nothing to
   * act on. Resolve through here instead, and say which keys are valid.
   */
  private resolveSource(key: any) {
    try {
      return getSource(key);
    } catch (e) {
      if (e instanceof BuilderValidationError) {
        throw new BadRequestException(
          `${e.message}. Valid sourceKey values: ${listCatalog(['*']).map((s: any) => s.key).join(', ')}`);
      }
      throw e;
    }
  }

  async run(user: { tenantId: string; employeeId?: string | null; permissionCodes: string[] }, body: any) {
    const src = this.resolveSource(body?.sourceKey);
    const enforced = await this.resolveScope(user, src);

    const input: CompileInput = {
      sourceKey: src.key, tenantId: user.tenantId,
      dimensions: Array.isArray(body?.dimensions) ? body.dimensions : [],
      metrics: Array.isArray(body?.metrics) ? body.metrics : [],
      filters: Array.isArray(body?.filters) ? body.filters : [],
      dateFrom: body?.dateFrom, dateTo: body?.dateTo,
      granularity: body?.granularity, enforcedFilters: enforced,
      limit: body?.limit,
    };

    let compiled;
    try { compiled = compile(input); }
    catch (e) { if (e instanceof BuilderValidationError) throw new BadRequestException(e.message); throw e; }

    const rows = await this.ds.query(compiled.sql, compiled.params);
    const formatted = this.formatRows(rows, compiled.columns);
    return { sourceKey: src.key, columns: compiled.columns, rowCount: formatted.length, rows: formatted };
  }

  /**
   * DRILL — the UN-aggregated rows behind ONE aggregated cell. Same RBAC + agent
   * self-scope as run(); the compiler re-applies the source's allowlist so only
   * catalog keys reach SQL. Returns up to `cap` rows with a `truncated` flag.
   */
  async drill(user: { tenantId: string; employeeId?: string | null; permissionCodes: string[] }, body: any) {
    const src = this.resolveSource(body?.sourceKey);
    const enforced = await this.resolveScope(user, src);
    const cap = Math.min(Math.max(1, Number(body?.limit) || 500), 500);

    const input: DrillInput = {
      sourceKey: src.key, tenantId: user.tenantId,
      cell: Array.isArray(body?.cell) ? body.cell : [],
      period: body?.period && body.period.granularity ? body.period : null,
      metrics: Array.isArray(body?.metrics) ? body.metrics : [],
      filters: Array.isArray(body?.filters) ? body.filters : [],
      dateFrom: body?.dateFrom, dateTo: body?.dateTo,
      enforcedFilters: enforced,
      limit: cap + 1, // over-fetch by one to detect truncation
    };

    let compiled;
    try { compiled = compileDrill(input); }
    catch (e) { if (e instanceof BuilderValidationError) throw new BadRequestException(e.message); throw e; }

    const raw = await this.ds.query(compiled.sql, compiled.params);
    const truncated = raw.length > cap;
    const rows = this.formatRows(truncated ? raw.slice(0, cap) : raw, compiled.columns);
    return { sourceKey: src.key, columns: compiled.columns, rowCount: rows.length, truncated, rows };
  }

  private formatRows(rows: any[], columns: { key: string; time?: boolean }[]) {
    const timeCols = columns.filter(c => c.time).map(c => c.key);
    if (!timeCols.length) return rows;
    const fmt = (m: any) => (m == null ? '' : `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`);
    return rows.map(r => { const o = { ...r }; for (const k of timeCols) o[k] = fmt(Number(o[k])); return o; });
  }

  /* ── SAVED REPORTS ───────────────────────────────────────────────────────── */
  async listReports(tid: string, userId: string) {
    // library shape: owner display name + is_owner flag alongside the saved config.
    return this.ds.query(
      `SELECT r.id, r.name, r.description, r.source_key, r.viz, r.shared, r.owner_user,
              r.created_at, r.updated_at, (r.owner_user=$2) AS is_owner,
              COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),''), u.email) AS owner_name
         FROM rb_saved_reports r
         LEFT JOIN users u ON u.id = r.owner_user AND u.tenant_id = r.tenant_id
        WHERE r.tenant_id=$1 AND (r.owner_user=$2 OR r.shared)
        ORDER BY r.updated_at DESC`, [tid, userId]);
  }
  /** Duplicate a report the user can see (own OR shared) into a fresh, private copy owned by them. */
  async duplicateReport(user: any, id: string) {
    const [r] = await this.ds.query(
      `SELECT name, description, source_key, config, viz FROM rb_saved_reports
        WHERE tenant_id=$1 AND id=$2 AND (owner_user=$3 OR shared)`, [user.tenantId, id, user.id]);
    if (!r) throw new NotFoundException('Report not found');
    const [n] = await this.ds.query(
      `INSERT INTO rb_saved_reports (tenant_id, owner_user, name, description, source_key, config, viz, shared)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
      [user.tenantId, user.id, `${r.name} (copy)`, r.description ?? null, r.source_key,
       JSON.stringify(r.config ?? {}), r.viz ?? 'table']);
    await this.audit(user, 'report_builder.report.duplicated', 'rb_saved_reports', n.id, { from: id, name: `${r.name} (copy)` });
    return { id: n.id };
  }
  async getReport(tid: string, userId: string, id: string) {
    const [r] = await this.ds.query(
      `SELECT * FROM rb_saved_reports WHERE tenant_id=$1 AND id=$2 AND (owner_user=$3 OR shared)`, [tid, id, userId]);
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }
  async saveReport(user: any, b: any) {
    if (!b?.name || !b?.sourceKey) throw new BadRequestException('name and sourceKey are required');
    getSource(b.sourceKey); // validate source exists
    const [r] = await this.ds.query(
      `INSERT INTO rb_saved_reports (tenant_id, owner_user, name, description, source_key, config, viz, shared)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [user.tenantId, user.id, b.name, b.description ?? null, b.sourceKey, JSON.stringify(b.config ?? {}), b.viz ?? 'table', !!b.shared]);
    await this.audit(user, 'report_builder.report.created', 'rb_saved_reports', r.id, { name: b.name, sourceKey: b.sourceKey });
    return { id: r.id };
  }
  async updateReport(user: any, id: string, b: any) {
    const [own] = await this.ds.query(`SELECT owner_user FROM rb_saved_reports WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    if (!own) throw new NotFoundException('Report not found');
    if (own.owner_user !== user.id) throw new ForbiddenException('Only the owner can edit this report');
    await this.ds.query(
      `UPDATE rb_saved_reports SET name=COALESCE($3,name), description=COALESCE($4,description),
              config=COALESCE($5,config), viz=COALESCE($6,viz), shared=COALESCE($7,shared), updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [user.tenantId, id, b.name ?? null, b.description ?? null, b.config ? JSON.stringify(b.config) : null, b.viz ?? null, typeof b.shared === 'boolean' ? b.shared : null]);
    await this.audit(user, 'report_builder.report.updated', 'rb_saved_reports', id, { name: b.name });
    return { ok: true };
  }
  async deleteReport(user: any, id: string) {
    const [own] = await this.ds.query(`SELECT owner_user FROM rb_saved_reports WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    if (!own) throw new NotFoundException('Report not found');
    if (own.owner_user !== user.id) throw new ForbiddenException('Only the owner can delete this report');
    await this.ds.query(`DELETE FROM rb_saved_reports WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    await this.audit(user, 'report_builder.report.deleted', 'rb_saved_reports', id, {});
    return { ok: true };
  }

  /* ── SAVED DASHBOARDS ────────────────────────────────────────────────────── */
  async listDashboards(tid: string, userId: string) {
    // library shape: owner name + is_owner + section/widget counts (for the card summary).
    return this.ds.query(
      `SELECT d.id, d.name, d.description, d.shared, d.owner_user, d.created_at, d.updated_at,
              (d.owner_user=$2) AS is_owner,
              COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),''), u.email) AS owner_name,
              COALESCE(jsonb_array_length(d.sections),0) AS section_count,
              COALESCE((SELECT SUM(jsonb_array_length(COALESCE(s->'widgets','[]'::jsonb)))
                          FROM jsonb_array_elements(d.sections) s),0) AS widget_count
         FROM rb_saved_dashboards d
         LEFT JOIN users u ON u.id = d.owner_user AND u.tenant_id = d.tenant_id
        WHERE d.tenant_id=$1 AND (d.owner_user=$2 OR d.shared)
        ORDER BY d.updated_at DESC`, [tid, userId]);
  }
  /** Duplicate a dashboard the user can see (own OR shared) into a fresh, private copy owned by them. */
  async duplicateDashboard(user: any, id: string) {
    const [d] = await this.ds.query(
      `SELECT name, description, sections, date_range, filters FROM rb_saved_dashboards
        WHERE tenant_id=$1 AND id=$2 AND (owner_user=$3 OR shared)`, [user.tenantId, id, user.id]);
    if (!d) throw new NotFoundException('Dashboard not found');
    const [n] = await this.ds.query(
      `INSERT INTO rb_saved_dashboards (tenant_id, owner_user, name, description, sections, date_range, filters, shared)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
      [user.tenantId, user.id, `${d.name} (copy)`, d.description ?? null, JSON.stringify(d.sections ?? []),
       d.date_range ? JSON.stringify(d.date_range) : null, JSON.stringify(d.filters ?? [])]);
    await this.audit(user, 'report_builder.dashboard.duplicated', 'rb_saved_dashboards', n.id, { from: id, name: `${d.name} (copy)` });
    return { id: n.id };
  }
  async getDashboard(tid: string, userId: string, id: string) {
    const [d] = await this.ds.query(
      `SELECT * FROM rb_saved_dashboards WHERE tenant_id=$1 AND id=$2 AND (owner_user=$3 OR shared)`, [tid, id, userId]);
    if (!d) throw new NotFoundException('Dashboard not found');
    return d;
  }
  async saveDashboard(user: any, b: any) {
    if (!b?.name) throw new BadRequestException('name is required');
    const [d] = await this.ds.query(
      `INSERT INTO rb_saved_dashboards (tenant_id, owner_user, name, description, sections, date_range, filters, shared)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [user.tenantId, user.id, b.name, b.description ?? null, JSON.stringify(b.sections ?? []),
       b.dateRange ? JSON.stringify(b.dateRange) : null, JSON.stringify(b.filters ?? []), !!b.shared]);
    await this.audit(user, 'report_builder.dashboard.created', 'rb_saved_dashboards', d.id, { name: b.name });
    return { id: d.id };
  }
  async updateDashboard(user: any, id: string, b: any) {
    const [own] = await this.ds.query(`SELECT owner_user FROM rb_saved_dashboards WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    if (!own) throw new NotFoundException('Dashboard not found');
    if (own.owner_user !== user.id) throw new ForbiddenException('Only the owner can edit this dashboard');
    await this.ds.query(
      `UPDATE rb_saved_dashboards SET name=COALESCE($3,name), description=COALESCE($4,description),
              sections=COALESCE($5,sections), date_range=COALESCE($6,date_range), filters=COALESCE($7,filters),
              shared=COALESCE($8,shared), updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [user.tenantId, id, b.name ?? null, b.description ?? null, b.sections ? JSON.stringify(b.sections) : null,
       b.dateRange ? JSON.stringify(b.dateRange) : null, b.filters ? JSON.stringify(b.filters) : null,
       typeof b.shared === 'boolean' ? b.shared : null]);
    await this.audit(user, 'report_builder.dashboard.updated', 'rb_saved_dashboards', id, { name: b.name });
    return { ok: true };
  }
  async deleteDashboard(user: any, id: string) {
    const [own] = await this.ds.query(`SELECT owner_user FROM rb_saved_dashboards WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    if (!own) throw new NotFoundException('Dashboard not found');
    if (own.owner_user !== user.id) throw new ForbiddenException('Only the owner can delete this dashboard');
    await this.ds.query(`DELETE FROM rb_saved_dashboards WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    await this.audit(user, 'report_builder.dashboard.deleted', 'rb_saved_dashboards', id, {});
    return { ok: true };
  }

  private async audit(user: any, action: string, entity: string, entityId: string, payload: any) {
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value)
       VALUES ($1,$2,$3,$4,'report_builder',$5,$6,$7)`,
      [user.tenantId, user.id, user.email ?? null, action, entity, entityId, JSON.stringify(payload)]).catch(() => {});
  }

  /** For diagnostics / tests: number of catalog sources. */
  get sourceCount() { return DATA_SOURCES.length; }
}
