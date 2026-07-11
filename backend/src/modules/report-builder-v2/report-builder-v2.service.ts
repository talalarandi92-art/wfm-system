import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compile, getSource, listCatalog, CompileInput, EnforcedFilter, BuilderValidationError } from './query-compiler';
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
    const src = getSource(key);
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

  /** Compile + execute a builder request with RBAC + agent self-scope. */
  async run(user: { tenantId: string; employeeId?: string | null; permissionCodes: string[] }, body: any) {
    const perms = user.permissionCodes ?? [];
    const src = getSource(body?.sourceKey);
    if (!this.has(perms, src.permission)) throw new ForbiddenException(`Not permitted to read source "${src.key}"`);

    const enforced: EnforcedFilter[] = [];
    if (!this.isTeamViewer(perms)) {
      // agent: restrict to own person, or deny if the source has no person grain
      if (!src.personCol) throw new ForbiddenException('This data source is not available at agent scope');
      const own = await this.ownPersonNo(user.tenantId, user.employeeId ?? null);
      if (!own) throw new ForbiddenException('No employee profile linked to this account');
      enforced.push({ col: src.personCol, op: 'eq', value: own });
    }

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

  private formatRows(rows: any[], columns: { key: string; time?: boolean }[]) {
    const timeCols = columns.filter(c => c.time).map(c => c.key);
    if (!timeCols.length) return rows;
    const fmt = (m: any) => (m == null ? '' : `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`);
    return rows.map(r => { const o = { ...r }; for (const k of timeCols) o[k] = fmt(Number(o[k])); return o; });
  }

  /* ── SAVED REPORTS ───────────────────────────────────────────────────────── */
  async listReports(tid: string, userId: string) {
    return this.ds.query(
      `SELECT id, name, description, source_key, viz, shared, owner_user, created_at, updated_at,
              (owner_user=$2) AS is_owner
         FROM rb_saved_reports WHERE tenant_id=$1 AND (owner_user=$2 OR shared) ORDER BY updated_at DESC`, [tid, userId]);
  }
  async getReport(tid: string, userId: string, id: string) {
    const [r] = await this.ds.query(
      `SELECT * FROM rb_saved_reports WHERE tenant_id=$1 AND id=$2 AND (owner_user=$3 OR shared)`, [tid, id, userId]);
    if (!r) throw new BadRequestException('Report not found');
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
    if (!own) throw new BadRequestException('Report not found');
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
    if (!own) throw new BadRequestException('Report not found');
    if (own.owner_user !== user.id) throw new ForbiddenException('Only the owner can delete this report');
    await this.ds.query(`DELETE FROM rb_saved_reports WHERE tenant_id=$1 AND id=$2`, [user.tenantId, id]);
    await this.audit(user, 'report_builder.report.deleted', 'rb_saved_reports', id, {});
    return { ok: true };
  }

  /* ── SAVED DASHBOARDS ────────────────────────────────────────────────────── */
  async listDashboards(tid: string, userId: string) {
    return this.ds.query(
      `SELECT id, name, description, shared, owner_user, created_at, updated_at, (owner_user=$2) AS is_owner
         FROM rb_saved_dashboards WHERE tenant_id=$1 AND (owner_user=$2 OR shared) ORDER BY updated_at DESC`, [tid, userId]);
  }
  async getDashboard(tid: string, userId: string, id: string) {
    const [d] = await this.ds.query(
      `SELECT * FROM rb_saved_dashboards WHERE tenant_id=$1 AND id=$2 AND (owner_user=$3 OR shared)`, [tid, id, userId]);
    if (!d) throw new BadRequestException('Dashboard not found');
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
    if (!own) throw new BadRequestException('Dashboard not found');
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
    if (!own) throw new BadRequestException('Dashboard not found');
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
