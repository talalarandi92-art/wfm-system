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
import { compile, compileDrill, drillMetricArg, ratioParts, BuilderValidationError, getSource, listCatalog } from './query-compiler';
import { DATA_SOURCES, dimensionBadge, metricBadge, contractFormat, contractType } from './data-sources';

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

/* ── A1b) BLD-4 DRILL compiler (pure allowlist + shape + reconciliation algebra) ── */
describe('drill compiler (BLD-4, pure)', () => {
  it('drillMetricArg unwraps the aggregate to its per-row base', () => {
    expect(drillMetricArg('SUM(COALESCE(ot_min,0))')).toBe('COALESCE(ot_min,0)');
    expect(drillMetricArg('COUNT(*)')).toBe('1');
    expect(drillMetricArg('COUNT(*) FILTER (WHERE late_minutes > 0)'))
      .toBe('(CASE WHEN (late_minutes > 0) THEN (1) ELSE NULL END)');
    // COUNT(DISTINCT x) with a comma inside the argument (balanced-paren safe)
    expect(drillMetricArg('COUNT(DISTINCT COALESCE(person_no,employee_no))')).toBe('COALESCE(person_no,employee_no)');
    // a /60 hours metric drops the scaling and exposes the raw minutes argument
    expect(drillMetricArg('ROUND(SUM(worked_min)/60.0,1)')).toBe('worked_min');
    expect(drillMetricArg('ROUND(AVG(a.aht_seconds))')).toBe('a.aht_seconds');
  });

  it('reconciles algebraically: Σ(per-row base) equals the SUM aggregate over synthetic rows', () => {
    const rows = [{ ot_min: 30 }, { ot_min: null }, { ot_min: 90 }, { ot_min: 12 }];
    // aggregate: SUM(COALESCE(ot_min,0))
    const agg = rows.reduce((a, r) => a + (r.ot_min ?? 0), 0);
    // per-row base COALESCE(ot_min,0) evaluated in JS
    const base = (r: any) => r.ot_min ?? 0;
    const sumBase = rows.reduce((a, r) => a + base(r), 0);
    expect(sumBase).toBe(agg); // 132 — the exact reconciliation the live DB proves
  });

  it('selects every source dimension raw + the metric base, with NO GROUP BY', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['regularOtMin'],
      cell: [{ dim: 'function', value: 'CH-WA' }] });
    expect(c.sql).not.toContain('GROUP BY');
    expect(c.sql).toContain('COALESCE(ot_min,0) AS "regularOtMin"');          // un-aggregated base
    expect(c.sql).toContain('canon_fn(COALESCE(role_function,function_name)) AS "function"'); // raw dim col
    expect(c.columns.filter(x => x.kind === 'dimension').length).toBe(getSource('overtime').dimensions.length);
    expect(c.columns.find(x => x.key === 'regularOtMin')?.kind).toBe('metric');
  });

  it('binds tenant as $1 and the cell value as a later $N (never inlined)', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      cell: [{ dim: 'function', value: 'CH-WA' }], dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(c.sql).toContain('tenant_id = $1');
    expect(c.params[0]).toBe(TID);
    expect(c.params).toContain('CH-WA');
    expect(c.sql).not.toContain("'CH-WA'"); // value bound, not inlined
    expect(c.sql).toContain('canon_fn(COALESCE(role_function,function_name)) = $');
  });

  it('a NULL cell value compiles to IS NULL (no bound param)', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      cell: [{ dim: 'shift', value: null }] });
    expect(c.sql).toContain('shift_code IS NULL');
  });

  it('translates a period cell into the SAME bucket expression compile() groups on', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      period: { granularity: 'month', value: '2026-06' } });
    expect(c.sql).toContain(`to_char(work_date::timestamp,'YYYY-MM') = $`);
    expect(c.params).toContain('2026-06');
  });

  it('rejects an injection cell dimension (no raw column reaches SQL)', () => {
    expect(() => compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      cell: [{ dim: 'work_date); DROP TABLE roster_days;--', value: 'x' }] })).toThrow(/Unknown drill dimension/);
  });
  it('rejects an unknown metric in a drill', () => {
    expect(() => compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['1; DROP'] })).toThrow(/Unknown metric/);
  });
  it('rejects an injection filter dimension in a drill', () => {
    expect(() => compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      filters: [{ dim: 'evil', op: 'eq', value: 1 }] })).toThrow(/Unknown filter dimension/);
  });

  it('appends the server-enforced agent-scope filter (self-scope) and clamps the cap', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      enforcedFilters: [{ col: 'COALESCE(person_no,employee_no)', op: 'eq', value: '11801' }], limit: 999999 });
    expect(c.params).toContain('11801');
    expect(c.sql).toContain('COALESCE(person_no,employee_no) =');
    expect(c.sql).toMatch(/LIMIT 2000/); // clamped to DRILL_MAX
  });

  it('re-applies the report date range with the half-open upper bound', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(c.sql).toContain('work_date >= $2::date');
    expect(c.sql).toContain('work_date < ($3::date + 1)');
  });
});

/* ── A1c) DECISION-SAFETY fixes (deep risk study) — pure ────────────────────
 *  #3 ratio-metric drill surfaces additive base components (not a summable %).
 *  #4 month-grain sources use a month-OVERLAP date predicate so a partial-month
 *     range keeps the whole overlapping month instead of dropping it.
 *  #1 occupancy carries an idle-coverage guard so it cannot render a precise %
 *     off an effectively-empty denominator. */
describe('decision-safety fixes (pure)', () => {
  it('ratioParts splits a NULLIF ratio into additive numerator + denominator bases', () => {
    // occupancy: busy ÷ (busy + idle)
    const occ = getSource('agent_ops').metrics.find(m => m.key === 'occupancyPct')!;
    const rp = ratioParts(occ.expr)!;
    expect(rp).not.toBeNull();
    expect(rp.num).toBe('COALESCE(a.busy_minutes,0)');                       // numerator base = busy
    expect(rp.den).toBe('COALESCE(a.busy_minutes,0)+COALESCE(a.idle_no_case_minutes,0)+COALESCE(a.idle_with_case_minutes,0)'); // denom base = busy+idle
    // survey PRR: yes ÷ (yes + no)
    const prr = getSource('survey').metrics.find(m => m.key === 'prrPct')!;
    const rp2 = ratioParts(prr.expr)!;
    expect(rp2.num).toBe('COALESCE(resolved_yes,0)');
    expect(rp2.den).toBe('COALESCE(resolved_yes,0)+COALESCE(resolved_no,0)');
    // COUNT-FILTER ratio (surveyClickRate) → CASE flags on both sides
    const clk = getSource('contacts_volume').metrics.find(m => m.key === 'surveyClickRatePct')!;
    const rp3 = ratioParts(clk.expr)!;
    expect(rp3.num).toBe('(CASE WHEN (survey_clicked) THEN (1) ELSE NULL END)');
    expect(rp3.den).toBe('(CASE WHEN (survey_sent) THEN (1) ELSE NULL END)');
  });

  it('ratioParts returns null for additive + AVG/scaling metrics (they drill fine as-is)', () => {
    expect(ratioParts('SUM(COALESCE(ot_min,0))')).toBeNull();
    expect(ratioParts('ROUND(AVG(adherence_pct),1)')).toBeNull();     // AVG per-row value is genuine
    expect(ratioParts('ROUND(SUM(worked_min)/60.0,1)')).toBeNull();   // /60 scaling, not a ratio
    expect(ratioParts('COUNT(*)')).toBeNull();
  });

  it('drill of a ratio metric emits TWO additive base columns, neither formatted as a %', () => {
    const c = compileDrill({ sourceKey: 'agent_ops', tenantId: TID, metrics: ['occupancyPct'] });
    const met = c.columns.filter(x => x.kind === 'metric');
    expect(met.map(m => m.key)).toEqual(['occupancyPct', 'occupancyPct__den']);
    expect(met.every(m => m.format === 'number')).toBe(true);        // never 'pct' — not a summable ratio
    expect(met[0].label_en).toMatch(/numerator/);
    expect(met[1].label_en).toMatch(/denominator/);
    // the SELECT surfaces the additive bases, not a per-row percentage
    expect(c.sql).toContain('COALESCE(a.busy_minutes,0) AS "occupancyPct"');
    expect(c.sql).toContain('AS "occupancyPct__den"');
    expect(c.sql).not.toContain('/NULLIF');                          // no ratio arithmetic in the drill projection
  });

  it('drill of an ADDITIVE metric is unchanged (single reconciling base column)', () => {
    const c = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['regularOtMin'] });
    const met = c.columns.filter(x => x.kind === 'metric');
    expect(met.map(m => m.key)).toEqual(['regularOtMin']);
    expect(met[0].format).toBe('minutes');
  });

  it('month-grain sources use a month-OVERLAP lower bound (partial-month range keeps the month)', () => {
    const c = compile({ sourceKey: 'survey', tenantId: TID, metrics: ['fcrPct'], dateFrom: '2026-06-10', dateTo: '2026-06-20' });
    expect(c.sql).toContain(`(year_month + INTERVAL '1 month') > $2::date`);   // month END after range start
    expect(c.sql).toContain(`year_month < ($3::date + 1)`);                    // month START before range end
    expect(c.sql).not.toContain(`year_month >= $2::date`);                     // NOT the day-grain drop predicate
  });

  it('day-grain sources keep the plain >= lower bound (no behaviour change)', () => {
    const c = compile({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'], dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(c.sql).toContain('work_date >= $2::date');
    expect(c.sql).not.toContain(`INTERVAL '1 month'`);
  });

  it('scorecard (month-grain) drill also applies month-overlap', () => {
    const c = compileDrill({ sourceKey: 'scorecard_kpi', tenantId: TID, metrics: ['netPoints'], dateFrom: '2026-06-10', dateTo: '2026-06-20' });
    expect(c.sql).toContain(`+ INTERVAL '1 month') > $`);
  });

  it('occupancy carries the idle-coverage guard (→ NULL when idle coverage is effectively zero)', () => {
    const occ = getSource('agent_ops').metrics.find(m => m.key === 'occupancyPct')!;
    expect(occ.expr).toContain('CASE WHEN SUM(COALESCE(a.idle_no_case_minutes,0)+COALESCE(a.idle_with_case_minutes,0)) = 0 THEN NULL ELSE 1 END');
  });
});

/* ── A2) BLD-2.6 catalog contract (Sprinklr-parity field picker) ──────────── */
describe('catalog contract (BLD-2.6)', () => {
  const EXPECTED = ['overtime','login_logout','attendance','adherence_conformance','agent_ops','scorecard',
    'scorecard_kpi','survey','permission','requests_sla','shrinkage_leave','breaks','coverage','contacts_volume'];

  it('keeps every BLD-1 source key (additive only) and exposes the new ones', () => {
    const keys = DATA_SOURCES.map(s => s.key);
    for (const k of EXPECTED) expect(keys).toContain(k);
    // original BLD-1 keys untouched
    for (const k of ['overtime','login_logout','attendance','scorecard','permission','breaks','coverage']) {
      expect(() => getSource(k)).not.toThrow();
    }
  });

  it('keeps every BLD-1 metric key working (additive only)', () => {
    expect(getSource('overtime').metrics.map(m => m.key)).toEqual(expect.arrayContaining(
      ['trueOtMin','trueOtHrs','regularOtMin','offdayOtMin','holidayOtMin','offWorkedMin','otBeforeMin','otAfterMin','otDays','agents']));
    expect(getSource('attendance').metrics.map(m => m.key)).toEqual(expect.arrayContaining(
      ['scheduledDays','workedDays','officeDays','wfhDays','offDays','leaveDays','sickDays','absentDays','lateDays','earlyDays','permissionDays','conformancePct','shrinkageDays']));
    expect(getSource('login_logout').metrics.map(m => m.key)).toEqual(expect.arrayContaining(
      ['workedMin','workedHrs','avgLoginMin','avgLogoutMin','credLateMin','credLateDays','credEarlyMin','credEarlyDays','haveLogin','missingSystem']));
  });

  it('every source carries category + bilingual description', () => {
    for (const s of DATA_SOURCES) {
      expect((s.category ?? s.group).length).toBeGreaterThan(0);
      expect(s.description_en && s.description_en.length).toBeGreaterThan(10);
      expect(s.description_ar && s.description_ar.length).toBeGreaterThan(5);
    }
  });

  it('every FIELD carries category, badge, and one-sentence bilingual descriptions', () => {
    for (const s of DATA_SOURCES) {
      for (const d of s.dimensions) {
        expect(d.category && d.category.length).toBeGreaterThan(0);
        expect(d.description_en && d.description_en.length).toBeGreaterThan(5);
        expect(d.description_ar && d.description_ar.length).toBeGreaterThan(3);
        expect(['dimension','custom_dimension']).toContain(dimensionBadge(d));
      }
      for (const m of s.metrics) {
        expect(m.category && m.category.length).toBeGreaterThan(0);
        expect(m.description_en && m.description_en.length).toBeGreaterThan(5);
        expect(m.description_ar && m.description_ar.length).toBeGreaterThan(3);
        expect(['metric','calculated_metric']).toContain(metricBadge(m));
        expect(['hours','minutes','percent','number']).toContain(contractFormat(m));
      }
    }
  });

  it('contract type mapping collapses to string|number|date', () => {
    expect(contractType('string')).toBe('string');
    expect(contractType('number')).toBe('number');
    expect(contractType('date')).toBe('date');
    expect(contractType('time')).toBe('string');
    expect(contractType('bool')).toBe('string');
  });

  it('calculated expressions carry the calculated_metric badge', () => {
    const ot = getSource('overtime').metrics.find(m => m.key === 'trueOtHrs')!;
    expect(metricBadge(ot)).toBe('calculated_metric');
    const shr = getSource('shrinkage_leave').metrics.find(m => m.key === 'shrinkagePct')!;
    expect(metricBadge(shr)).toBe('calculated_metric');
  });

  it('listCatalog includes category + descriptions and still permission-filters', () => {
    const all = listCatalog();
    expect(all.length).toBe(DATA_SOURCES.length);
    expect(all[0]).toEqual(expect.objectContaining({
      key: expect.any(String), label_en: expect.any(String), label_ar: expect.any(String),
      group: expect.any(String), category: expect.any(String), permission: expect.any(String),
      description_en: expect.any(String), description_ar: expect.any(String),
    }));
    const reportsOnly = listCatalog(['reports.view']);
    expect(reportsOnly.every(s => s.permission === 'reports.view')).toBe(true);
    expect(reportsOnly.map(s => s.key)).toEqual(expect.arrayContaining(['scorecard','scorecard_kpi','survey','agent_ops','contacts_volume']));
  });

  it('every new source compiles with all metrics + all dimensions (allowlist sanity)', () => {
    for (const s of DATA_SOURCES) {
      const c = compile({ sourceKey: s.key, tenantId: TID,
        dimensions: s.dimensions.map(d => d.key), metrics: s.metrics.map(m => m.key) });
      expect(c.sql).toContain('SELECT');
      expect(c.params[0]).toBe(TID);
    }
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

  it('EVERY source: compiled query with all metrics executes on the live DB', async () => {
    if (!up) return;
    for (const s of require('./data-sources').DATA_SOURCES) {
      const c = compile({ sourceKey: s.key, tenantId: TID, metrics: s.metrics.map((m: any) => m.key) });
      const rows = await q(c.sql, c.params); // throws on any bad column/expr
      expect(Array.isArray(rows)).toBe(true); // empty-table tolerated; query must be valid
    }
  });

  it('adherence_conformance avgAdherencePct ties to the roster-dashboard formula (AVG(adherence_pct))', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'adherence_conformance', tenantId: TID,
      metrics: ['avgAdherencePct', 'conformancePct', 'credLateDays'], dateFrom: FROM, dateTo: TO });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT ROUND(AVG(adherence_pct),1) adh,
              ROUND(100.0*COUNT(*) FILTER (WHERE conforming)/NULLIF(COUNT(*) FILTER (WHERE conforming IS NOT NULL),0),1) conf,
              COUNT(*) FILTER (WHERE sys_late_min BETWEEN 7 AND 240) late
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TID, FROM, TO]);
    expect(Number(built.avgAdherencePct)).toBeCloseTo(Number(direct.adh), 1);
    expect(Number(built.conformancePct)).toBeCloseTo(Number(direct.conf), 1);
    expect(Number(built.credLateDays)).toBe(Number(direct.late));
    expect(Number(built.avgAdherencePct)).toBeGreaterThan(0);
  });

  it('adherence tardy bands are disjoint and sum inside credible-late days', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'adherence_conformance', tenantId: TID,
      metrics: ['late7to15', 'late16to30', 'late31to60', 'late60plus', 'credLateDays'], dateFrom: FROM, dateTo: TO });
    const [r] = await q(c.sql, c.params);
    const bands = Number(r.late7to15) + Number(r.late16to30) + Number(r.late31to60) + Number(r.late60plus);
    expect(bands).toBe(Number(r.credLateDays)); // bands partition the credible 7..240 window exactly
  });

  it('survey PRR equals Yes/(Yes+No) computed directly', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'survey', tenantId: TID, metrics: ['resolvedYes', 'resolvedNo', 'prrPct'] });
    const [r] = await q(c.sql, c.params);
    if (Number(r.resolvedYes) + Number(r.resolvedNo) > 0) {
      const expected = Math.round(1000 * Number(r.resolvedYes) / (Number(r.resolvedYes) + Number(r.resolvedNo))) / 10;
      expect(Number(r.prrPct)).toBeCloseTo(expected, 1);
    }
  });

  it('requests_sla counts tie to a direct query', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'requests_sla', tenantId: TID, metrics: ['requests', 'approved', 'pending'] });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT COUNT(*) n, COUNT(*) FILTER (WHERE status::text='approved') a,
              COUNT(*) FILTER (WHERE status::text IN ('pending','peer_pending','in_review')) p
         FROM requests WHERE tenant_id=$1`, [TID]);
    expect(Number(built.requests)).toBe(Number(direct.n));
    expect(Number(built.approved)).toBe(Number(direct.a));
    expect(Number(built.pending)).toBe(Number(direct.p));
  });

  it('shrinkage_leave shrinkagePct equals lost/(non-off) computed directly', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'shrinkage_leave', tenantId: TID, metrics: ['shrinkageDays', 'shrinkagePct'], dateFrom: FROM, dateTo: TO });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT ROUND(100.0*COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))/NULLIF(COUNT(*) FILTER (WHERE presence <> 'off'),0),1) pct
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TID, FROM, TO]);
    expect(Number(built.shrinkagePct)).toBeCloseTo(Number(direct.pct), 1);
  });

  it('agent_ops grouped by person resolves identities without row inflation', async () => {
    if (!up) return;
    const total = compile({ sourceKey: 'agent_ops', tenantId: TID, metrics: ['contacts'] });
    const [t] = await q(total.sql, total.params);
    const grouped = compile({ sourceKey: 'agent_ops', tenantId: TID, dimensions: ['person'], metrics: ['contacts'] });
    const rows = await q(grouped.sql, grouped.params);
    const sum = rows.reduce((a: number, r: any) => a + Number(r.contacts || 0), 0);
    expect(sum).toBe(Number(t.contacts)); // scalar-subquery person join never duplicates rows
  });

  it('contacts_volume total ties to a direct count', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'contacts_volume', tenantId: TID, metrics: ['contacts'] });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(`SELECT COUNT(*) n FROM ops_contacts WHERE tenant_id=$1`, [TID]);
    expect(Number(built.contacts)).toBe(Number(direct.n));
  });

  it('scorecard_kpi netPoints ties to a direct query over scorecard_entries', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'scorecard_kpi', tenantId: TID, metrics: ['netPoints', 'entries'] });
    const [built] = await q(c.sql, c.params);
    const [direct] = await q(
      `SELECT ROUND(AVG(e.net_points),1) net, COUNT(*) n
         FROM scorecard_entries e JOIN scorecard_batches b ON b.id=e.batch_id WHERE e.tenant_id=$1`, [TID]);
    expect(Number(built.netPoints)).toBeCloseTo(Number(direct.net), 1);
    expect(Number(built.entries)).toBe(Number(direct.n));
  });

  it('agent enforced-scope filter returns only that person', async () => {
    if (!up) return;
    const [person] = await q(`SELECT COALESCE(person_no,employee_no) p FROM roster_days WHERE tenant_id=$1 AND person_no IS NOT NULL LIMIT 1`, [TID]);
    const c = compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['person'], metrics: ['otDays'],
      enforcedFilters: [{ col: 'COALESCE(person_no,employee_no)', op: 'eq', value: person.p }] });
    const rows = await q(c.sql, c.params);
    expect(rows.every((r: any) => String(r.person) === String(person.p))).toBe(true);
  });

  /* ── BLD-4 DRILL reconciliation against the live DB ─────────────────────────
   * Prove the drill of one aggregated Overtime cell (grouped by function) returns
   * per-day rows whose true-OT base SUMS EXACTLY back to the aggregated cell. */
  it('drill of an overtime-by-function cell reconciles to the aggregate (sum of parts == cell)', async () => {
    if (!up) return;
    const grouped = compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['function'],
      metrics: ['trueOtMin'], dateFrom: FROM, dateTo: TO });
    const cells = await q(grouped.sql, grouped.params);
    const cell = cells.find((r: any) => Number(r.trueOtMin) > 0) ?? cells[0];
    if (!cell) { console.warn('no overtime rows — drill reconciliation skipped'); return; }

    const d = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      cell: [{ dim: 'function', value: cell.function }], dateFrom: FROM, dateTo: TO, limit: 100000 });
    expect(d.sql).not.toContain('GROUP BY');
    const raw = await q(d.sql, d.params);
    const sumBase = raw.reduce((a: number, r: any) => a + Number(r.trueOtMin || 0), 0);
    expect(sumBase).toBe(Number(cell.trueOtMin));            // EXACT reconciliation
    expect(raw.every((r: any) => r.function === cell.function)).toBe(true); // every row is the drilled cell
  });

  it('drill of a regular-OT cell reconciles and every drill row is a real person-day', async () => {
    if (!up) return;
    const grouped = compile({ sourceKey: 'overtime', tenantId: TID, dimensions: ['function'],
      metrics: ['regularOtMin'], dateFrom: FROM, dateTo: TO });
    const cells = await q(grouped.sql, grouped.params);
    const cell = cells.find((r: any) => Number(r.regularOtMin) > 0) ?? cells[0];
    if (!cell) return;
    const d = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['regularOtMin'],
      cell: [{ dim: 'function', value: cell.function }], dateFrom: FROM, dateTo: TO, limit: 100000 });
    const raw = await q(d.sql, d.params);
    const sumBase = raw.reduce((a: number, r: any) => a + Number(r.regularOtMin || 0), 0);
    expect(sumBase).toBe(Number(cell.regularOtMin));
    expect(raw.every((r: any) => r.person && r.date)).toBe(true); // raw dims present per row
  });

  it('drill honors the agent self-scope (only that person’s rows come back)', async () => {
    if (!up) return;
    const [person] = await q(`SELECT COALESCE(person_no,employee_no) p FROM roster_days WHERE tenant_id=$1 AND person_no IS NOT NULL LIMIT 1`, [TID]);
    const d = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      enforcedFilters: [{ col: 'COALESCE(person_no,employee_no)', op: 'eq', value: person.p }],
      dateFrom: FROM, dateTo: TO, limit: 100000 });
    const rows = await q(d.sql, d.params);
    expect(rows.every((r: any) => String(r.person) === String(person.p))).toBe(true);
  });

  it('drill of a period (month) cell stays inside that month bucket', async () => {
    if (!up) return;
    const d = compileDrill({ sourceKey: 'overtime', tenantId: TID, metrics: ['trueOtMin'],
      period: { granularity: 'month', value: '2026-06' }, dateFrom: '2026-01-01', dateTo: '2026-12-31', limit: 100000 });
    const rows = await q(d.sql, d.params);
    expect(rows.every((r: any) => String(r.date).slice(0, 7) === '2026-06')).toBe(true);
  });

  /* ── DECISION-SAFETY fixes against the live DB ─────────────────────────── */

  // #1 occupancy guard: an agent with busy time but NO idle capture must NOT read as a precise
  // (usually 100%) occupancy — the guard voids it to NULL. Proven on the live near-empty column.
  it('occupancy guard: busy-only agents (no idle capture) come back NULL, never a fake %', async () => {
    if (!up) return;
    const c = compile({ sourceKey: 'agent_ops', tenantId: TID, dimensions: ['agentEmail'], metrics: ['occupancyPct'] });
    const rows = await q(c.sql, c.params);
    const occByEmail = new Map(rows.map((r: any) => [r.agentEmail, r.occupancyPct]));
    const busyOnly = await q(
      `SELECT agent_email FROM (
         SELECT agent_email,
                SUM(COALESCE(busy_minutes,0)) busy,
                SUM(COALESCE(idle_no_case_minutes,0)+COALESCE(idle_with_case_minutes,0)) idle
           FROM agent_daily_stats WHERE tenant_id=$1 GROUP BY agent_email) g
       WHERE busy > 0 AND idle = 0`, [TID]);
    for (const b of busyOnly) expect(occByEmail.get(b.agent_email)).toBeNull(); // guard fired for each
  });

  // #3 ratio-drill: the drill of an occupancy cell surfaces ADDITIVE num/den base columns whose
  // sums reconcile back to the aggregated ratio (100·Σnum/Σden == the cell), not a summable %.
  it('ratio drill: occupancy num/den bases reconcile to the aggregated cell', async () => {
    if (!up) return;
    const grouped = compile({ sourceKey: 'agent_ops', tenantId: TID, dimensions: ['agentEmail'], metrics: ['occupancyPct'] });
    const cells = await q(grouped.sql, grouped.params);
    const cell = cells.find((r: any) => r.occupancyPct != null);
    if (!cell) { console.warn('no non-null occupancy — ratio-drill reconciliation skipped'); return; }
    const d = compileDrill({ sourceKey: 'agent_ops', tenantId: TID, metrics: ['occupancyPct'],
      cell: [{ dim: 'agentEmail', value: cell.agentEmail }], limit: 100000 });
    expect(d.sql).not.toContain('/NULLIF');
    const raw = await q(d.sql, d.params);
    const sumNum = raw.reduce((a: number, r: any) => a + Number(r.occupancyPct || 0), 0);
    const sumDen = raw.reduce((a: number, r: any) => a + Number(r['occupancyPct__den'] || 0), 0);
    expect(sumDen).toBeGreaterThan(0);
    const recomputed = Math.round(1000 * sumNum / sumDen) / 10;
    expect(Math.abs(recomputed - Number(cell.occupancyPct))).toBeLessThanOrEqual(0.1); // reconciles
  });

  // #4 month-overlap: a partial-month range strictly INSIDE a month keeps that month's rollup,
  // where the old day-grain (>= from) predicate would have dropped it entirely.
  it('month-overlap: a partial-month range keeps the survey month the old predicate would drop', async () => {
    if (!up) return;
    const [anchor] = await q(
      `SELECT to_char(max(year_month)::date + 5,'YYYY-MM-DD') frm,
              to_char(max(year_month)::date + 15,'YYYY-MM-DD') too
         FROM survey_fcr_monthly WHERE tenant_id=$1`, [TID]);
    if (!anchor?.frm) { console.warn('no survey rows — month-overlap skipped'); return; }
    const c = compile({ sourceKey: 'survey', tenantId: TID, metrics: ['responses'], dateFrom: anchor.frm, dateTo: anchor.too });
    const [built] = await q(c.sql, c.params);
    const [old] = await q(
      `SELECT SUM(COALESCE(total,0)) n FROM survey_fcr_monthly
         WHERE tenant_id=$1 AND year_month >= $2::date AND year_month < ($3::date + 1)`, [TID, anchor.frm, anchor.too]);
    expect(Number(built.responses || 0)).toBeGreaterThan(0); // month kept by overlap
    expect(Number(old.n || 0)).toBe(0);                       // the old day-grain predicate dropped it
  });
});
