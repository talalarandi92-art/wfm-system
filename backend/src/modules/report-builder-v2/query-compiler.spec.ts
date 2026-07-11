/**
 * BUILDER v2 — query-compiler GATE (BLD-1).
 *  A) Pure compiler correctness: allowlist rejects unknown cols, GROUP BY + date
 *     bucket, parameter binding, operators, limits.
 *  B) PARITY against the live DB: the compiled SQL totals equal an independent
 *     hand-written canonical query for Overtime, Login/Logout and Scorecard — so a
 *     builder number == the dedicated report number.
 */
import * as fs from 'fs';
import * as path from 'path';
import { compile, BuilderValidationError, getSource } from './query-compiler';

const TID = 'a0000000-0000-0000-0000-000000000001';

describe('query-compiler (pure allowlist + shape)', () => {
  it('rejects an unknown data source', () => {
    expect(() => compile({ sourceKey: 'nope', tenantId: TID, metrics: ['x'] })).toThrow(BuilderValidationError);
  });
  it('rejects an unknown dimension', () => {
    expect(() => compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['DROP TABLE'], metrics: ['trueOtMin'] })).toThrow(/Unknown dimension/);
  });
  it('rejects an unknown metric', () => {
    expect(() => compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['1; DROP'] })).toThrow(/Unknown metric/);
  });
  it('requires at least one metric', () => {
    expect(() => compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['function'], metrics: [] })).toThrow(/metric is required/);
  });
  it('rejects an unknown filter dimension (no injection surface)', () => {
    expect(() => compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], filters: [{ dim: 'evil', op: 'eq', value: 1 }] })).toThrow(/Unknown filter dimension/);
  });
  it('rejects an unsupported operator', () => {
    expect(() => compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], filters: [{ dim: 'shift', op: 'DROP' as any, value: 1 }] })).toThrow(/Unsupported filter operator/);
  });

  it('injects tenant as $1 and binds it', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'] });
    expect(c.sql).toContain('tenant_id = $1');
    expect(c.params[0]).toBe(TID);
  });

  it('builds GROUP BY ordinals for the selected dimensions', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['function', 'shift'], metrics: ['trueOtMin'] });
    expect(c.sql).toMatch(/GROUP BY 1, 2/);
    expect(c.sql).toMatch(/ORDER BY 1/);
    // two dimension columns + one metric column in the projection meta
    expect(c.columns.filter(x => x.kind === 'dimension').length).toBe(2);
    expect(c.columns.filter(x => x.kind === 'metric').length).toBe(1);
  });

  it('emits a month date bucket as leading period column', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], granularity: 'month' });
    expect(c.sql).toContain(`to_char(work_date::timestamp,'YYYY-MM') AS "period"`);
    expect(c.sql).toMatch(/GROUP BY 1/);
  });
  it('emits a week date bucket', () => {
    const c = compile({ sourceKey: 'login_logout', tenantId: TID, metrics: ['workedMin'], granularity: 'week' });
    expect(c.sql).toContain(`date_trunc('week'`);
  });

  it('parameterizes filter values and date range', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], dateFrom: '2026-06-01', dateTo: '2026-06-30', filters: [{ dim: 'shift', op: 'eq', value: 'M' }] });
    expect(c.params).toEqual([TID, '2026-06-01', '2026-06-30', 'M']);
    expect(c.sql).toContain('shift_code = $4');
    expect(c.sql).not.toContain("'M'"); // value never inlined
  });

  it('appends server-enforced (agent-scope) filters', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], enforcedFilters: [{ col: 'COALESCE(person_no,employee_no)', op: 'eq', value: '11801' }] });
    expect(c.params).toContain('11801');
    expect(c.sql).toContain('COALESCE(person_no,employee_no) = $2');
  });

  it('omits GROUP BY and orders by the metric when no dims/granularity', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'] });
    expect(c.sql).not.toContain('GROUP BY');
    expect(c.sql).toMatch(/ORDER BY 1 DESC/);
  });

  it('clamps the limit to the ceiling', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], limit: 999999 });
    expect(c.sql).toMatch(/LIMIT 50000/);
  });

  it('builds an IN list with one placeholder per value', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], filters: [{ dim: 'shift', op: 'in', value: ['M', 'N', 'E'] }] });
    expect(c.sql).toContain('shift_code IN ($2, $3, $4)');
    expect(c.params.slice(1)).toEqual(['M', 'N', 'E']);
  });

  it('wraps LIKE values with % and uses ILIKE', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], filters: [{ dim: 'name', op: 'like', value: 'aya' }] });
    expect(c.sql).toContain('ILIKE $2');
    expect(c.params[1]).toBe('%aya%');
  });

  it('supports valueless operators (not_null)', () => {
    const c = compile({ sourceKey: 'attendance', tenantId: TID, metrics: ['permissionDays'], filters: [{ dim: 'hrCode', op: 'not_null' }] });
    expect(c.sql).toContain('hr_code IS NOT NULL');
    expect(c.params.length).toBe(1); // only tenant bound
  });
});

/* ── B) live-DB parity ──────────────────────────────────────────────────────
 * Loads .env like the repo's db-probe and compares compiled SQL to an independent
 * canonical query over the same range. Skips gracefully if the DB is unreachable. */
const { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '..', '..', '.env'), path.join(__dirname, '..', '..', '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

describe('query-compiler PARITY (live wfm_db)', () => {
  let client: any; let up = false;
  const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

  beforeAll(async () => {
    client = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || 'wfm_db', user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
    try { await client.connect(); up = true; } catch (e) { up = false; }
  });
  afterAll(async () => { if (up) await client.end(); });

  const FROM = '2026-06-01', TO = '2026-06-30';

  it('overtime TRUE_OT (min) matches a direct canonical query', async () => {
    if (!up) { console.warn('DB down — parity skipped'); return; }
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], dateFrom: FROM, dateTo: TO });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0)) trueotmin
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TID, FROM, TO]);
    expect(Number(built.trueOtMin)).toBe(Number(direct.trueotmin));
    expect(Number(built.trueOtMin)).toBeGreaterThan(0);
  });

  it('login_logout worked (min) + credible-late days match direct queries', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'login_logout', tenantId: TID, metrics: ['workedMin', 'credLateDays'], dateFrom: FROM, dateTo: TO });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT SUM(COALESCE(worked_min,0)) worked, COUNT(*) FILTER (WHERE sys_late_min BETWEEN 7 AND 240) late
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TID, FROM, TO]);
    expect(Number(built.workedMin)).toBe(Number(direct.worked));
    expect(Number(built.credLateDays)).toBe(Number(direct.late));
  });

  it('scorecard avgNetPoints matches a direct query', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'scorecard', tenantId: TID, metrics: ['avgNetPoints', 'agents'] });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT ROUND(AVG(avg_net_points),2) avg, COUNT(DISTINCT employee_no) agents FROM scorecard_monthly WHERE tenant_id=$1`, [TID]);
    expect(Number(built.avgNetPoints)).toBeCloseTo(Number(direct.avg), 2);
    expect(Number(built.agents)).toBe(Number(direct.agents));
  });

  it('grouping by function preserves the overtime total (sum of parts == whole)', async () => {
    if (!up) return;
    const grouped = compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['function'], metrics: ['trueOtMin'], dateFrom: FROM, dateTo: TO });
    const rows = await q(grouped.sql, grouped.params);
    const sumParts = rows.reduce((a: number, r: any) => a + Number(r.trueOtMin || 0), 0);
    const whole = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], dateFrom: FROM, dateTo: TO });
    const [total] = await q(whole.sql, whole.params);
    expect(sumParts).toBe(Number(total.trueOtMin));
  });

  it('agent enforced-scope filter returns only that person', async () => {
    if (!up) return;
    const [person] = await q(`SELECT COALESCE(person_no,employee_no) p FROM roster_days WHERE tenant_id=$1 AND person_no IS NOT NULL LIMIT 1`, [TID]);
    const c = compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['person'], metrics: ['otDays'],
      enforcedFilters: [{ col: 'COALESCE(person_no,employee_no)', op: 'eq', value: person.p }] });
    const rows = await q(c.sql, c.params);
    expect(rows.every((r: any) => String(r.person) === String(person.p))).toBe(true);
  });
});
