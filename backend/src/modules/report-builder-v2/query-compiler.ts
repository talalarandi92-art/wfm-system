/**
 * BUILDER v2 — QUERY COMPILER (BLD-1, pure + unit-tested).
 *
 * Input {sourceKey, dimensions, metrics, filters, dateFrom, dateTo, granularity}
 * → a parameterized SQL string + params array.
 *
 * SECURITY MODEL — ALLOWLIST ONLY. Every dimension, metric, and filter target MUST
 * resolve to a catalog entry for the chosen source; anything else throws
 * BuilderValidationError. No column name, table name, or expression ever comes from
 * the client — the client only sends catalog KEYS. All values are bound as $N
 * parameters. There is no raw-SQL surface. tenant_id is always injected as $1.
 */
import { DATA_SOURCES, SOURCE_BY_KEY, DataSourceDef, Dimension, Metric } from './data-sources';

export class BuilderValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BuilderValidationError'; }
}

export type FilterOp = 'eq' | 'ne' | 'lt' | 'gt' | 'lte' | 'gte' | 'in' | 'like' | 'not_null' | 'is_null';
export type Granularity = 'none' | 'day' | 'week' | 'month';

export interface FilterInput { dim: string; op: FilterOp; value?: any; }
/** Server-side trusted filter (col is a catalog-derived SQL expr, never client input). */
export interface EnforcedFilter { col: string; op: FilterOp; value?: any; }

export interface CompileInput {
  sourceKey: string;
  tenantId: string;
  dimensions?: string[];
  metrics?: string[];
  filters?: FilterInput[];
  dateFrom?: string;
  dateTo?: string;
  granularity?: Granularity;
  enforcedFilters?: EnforcedFilter[];
  limit?: number;
}

export interface CompiledColumn { key: string; label_en: string; label_ar: string; kind: 'dimension' | 'metric'; type?: string; time?: boolean; format?: string; }
export interface CompiledQuery { sql: string; params: any[]; columns: CompiledColumn[]; }

/** One aggregated cell's dimension value (dim is a catalog KEY, value is $N-bound). */
export interface DrillCell { dim: string; value: any; }
export interface DrillInput {
  sourceKey: string;
  tenantId: string;
  cell?: DrillCell[];                                  // the aggregated cell's non-period dim values
  period?: { granularity: Granularity; value: any } | null; // a bucketed (day/week/month) cell value
  metrics?: string[];                                  // metric KEYS whose per-row base to surface
  filters?: FilterInput[];                             // the report's active filters, re-applied
  dateFrom?: string;
  dateTo?: string;
  enforcedFilters?: EnforcedFilter[];                  // agent self-scope (trusted col)
  limit?: number;
}

const OPS: Record<FilterOp, string> = {
  eq: '=', ne: '<>', lt: '<', gt: '>', lte: '<=', gte: '>=', in: 'IN', like: 'ILIKE', not_null: 'IS NOT NULL', is_null: 'IS NULL',
};
const VALUELESS: FilterOp[] = ['not_null', 'is_null'];
const MAX_LIMIT = 50000;

function bucketExpr(dateCol: string, g: Granularity): string {
  switch (g) {
    case 'day':   return `${dateCol}::text`;
    case 'week':  return `to_char(date_trunc('week', ${dateCol}::timestamp),'YYYY-MM-DD')`;
    case 'month': return `to_char(${dateCol}::timestamp,'YYYY-MM')`;
    default:      return '';
  }
}

export function getSource(sourceKey: string): DataSourceDef {
  const src = SOURCE_BY_KEY[sourceKey];
  if (!src) throw new BuilderValidationError(`Unknown data source: ${sourceKey}`);
  return src;
}

/**
 * Compile a builder request into parameterized SQL. Throws BuilderValidationError
 * on any key that is not in the source's allowlist.
 */
export function compile(input: CompileInput): CompiledQuery {
  const src = getSource(input.sourceKey);
  const dimByKey: Record<string, Dimension> = Object.fromEntries(src.dimensions.map(d => [d.key, d]));
  const metricByKey: Record<string, Metric> = Object.fromEntries(src.metrics.map(m => [m.key, m]));

  const dimKeys = input.dimensions ?? [];
  const metricKeys = input.metrics ?? [];
  const granularity: Granularity = input.granularity ?? 'none';

  // ── allowlist validation ──────────────────────────────────────────────────
  for (const k of dimKeys) if (!dimByKey[k]) throw new BuilderValidationError(`Unknown dimension "${k}" for source "${src.key}"`);
  for (const k of metricKeys) if (!metricByKey[k]) throw new BuilderValidationError(`Unknown metric "${k}" for source "${src.key}"`);
  if (metricKeys.length === 0) throw new BuilderValidationError('At least one metric is required');

  const params: any[] = [input.tenantId];
  const where: string[] = [`${src.tenantCol} = $1`];

  // date range on the source's date column.
  // Upper bound is HALF-OPEN and date-normalized so the WHOLE end day is included even when
  // dateCol is a timestamp/timestamptz (e.g. requests_sla.submitted_at): `<= 'YYYY-MM-DD'` would
  // coerce to local midnight and silently drop every row after 00:00 on the final day. For a plain
  // DATE column `< (d::date + 1)` is equivalent to `<= d`; for a timestamp column it spans the day.
  if (input.dateFrom) { params.push(input.dateFrom); where.push(`${src.dateCol} >= $${params.length}::date`); }
  if (input.dateTo)   { params.push(input.dateTo);   where.push(`${src.dateCol} < ($${params.length}::date + 1)`); }

  // client filters — dim must be allowlisted, op allowlisted, value bound
  for (const f of input.filters ?? []) {
    const d = dimByKey[f.dim];
    if (!d) throw new BuilderValidationError(`Unknown filter dimension "${f.dim}" for source "${src.key}"`);
    if (!OPS[f.op]) throw new BuilderValidationError(`Unsupported filter operator "${f.op}"`);
    where.push(buildCond(d.col, f.op, f.value, params));
  }
  // server-enforced filters (agent self-scope) — col is trusted catalog SQL
  for (const f of input.enforcedFilters ?? []) {
    if (!OPS[f.op]) throw new BuilderValidationError(`Unsupported enforced operator "${f.op}"`);
    where.push(buildCond(f.col, f.op, f.value, params));
  }

  // ── SELECT: dims + optional period bucket + metrics ───────────────────────
  const selectParts: string[] = [];
  const groupOrdinals: number[] = [];
  const columns: CompiledColumn[] = [];
  let ordinal = 0;

  if (granularity !== 'none') {
    ordinal++;
    selectParts.push(`${bucketExpr(src.dateCol, granularity)} AS "period"`);
    groupOrdinals.push(ordinal);
    columns.push({ key: 'period', label_en: 'Period', label_ar: 'الفترة', kind: 'dimension', type: 'string' });
  }
  for (const k of dimKeys) {
    const d = dimByKey[k]; ordinal++;
    selectParts.push(`${d.col} AS "${k}"`);
    groupOrdinals.push(ordinal);
    columns.push({ key: k, label_en: d.label_en, label_ar: d.label_ar, kind: 'dimension', type: d.type, time: d.time });
  }
  for (const k of metricKeys) {
    const m = metricByKey[k]; ordinal++;
    selectParts.push(`${m.expr} AS "${k}"`);
    columns.push({ key: k, label_en: m.label_en, label_ar: m.label_ar, kind: 'metric', format: m.format });
  }

  const limit = Math.min(Math.max(1, input.limit ?? 1000), MAX_LIMIT);
  let sql = `SELECT ${selectParts.join(', ')} FROM ${src.from} WHERE ${where.join(' AND ')}`;
  if (groupOrdinals.length) sql += ` GROUP BY ${groupOrdinals.join(', ')}`;
  // order: by first grouping column when grouped, else by first metric descending
  sql += groupOrdinals.length ? ` ORDER BY 1` : ` ORDER BY ${ordinal} DESC NULLS LAST`;
  sql += ` LIMIT ${limit}`;

  return { sql, params, columns };
}

const DRILL_MAX = 2000;

/**
 * DRILL (BLD-4) — compile a request for the UN-aggregated rows behind ONE aggregated
 * cell. SAME allowlist discipline as compile(): every dim/metric/filter target must
 * resolve to a catalog entry for the source; the client only sends catalog KEYS; all
 * values are $N-bound; tenant is $1; enforcedFilters carry the trusted agent-scope col.
 *
 * The projection is the source's RAW dimension columns (per-row, no GROUP BY) plus,
 * for each requested metric, its PER-ROW BASE — the aggregate's inner argument
 * (drillMetricArg). For an additive metric SUM(x)→x, so Σ(base over the drill rows)
 * reconciles EXACTLY to the aggregated cell; COUNT(*)→1, COUNT(*) FILTER (WHERE p)→a
 * CASE flag, so their row-count / sum reconciles too.
 */
export function compileDrill(input: DrillInput): CompiledQuery {
  const src = getSource(input.sourceKey);
  const dimByKey: Record<string, Dimension> = Object.fromEntries(src.dimensions.map(d => [d.key, d]));
  const metricByKey: Record<string, Metric> = Object.fromEntries(src.metrics.map(m => [m.key, m]));

  const metricKeys = input.metrics ?? [];
  for (const k of metricKeys) if (!metricByKey[k]) throw new BuilderValidationError(`Unknown metric "${k}" for source "${src.key}"`);

  const params: any[] = [input.tenantId];
  const where: string[] = [`${src.tenantCol} = $1`];

  // date range — identical half-open, date-normalized bound as compile()
  if (input.dateFrom) { params.push(input.dateFrom); where.push(`${src.dateCol} >= $${params.length}::date`); }
  if (input.dateTo)   { params.push(input.dateTo);   where.push(`${src.dateCol} < ($${params.length}::date + 1)`); }

  // the aggregated cell's non-period dimension values → equality (NULL → IS NULL)
  for (const c of input.cell ?? []) {
    const d = dimByKey[c.dim];
    if (!d) throw new BuilderValidationError(`Unknown drill dimension "${c.dim}" for source "${src.key}"`);
    if (c.value === null || c.value === undefined || c.value === '') where.push(`${d.col} IS NULL`);
    else where.push(buildCond(d.col, 'eq', c.value, params));
  }

  // a bucketed (period) cell → constrain by the EXACT same bucket expression compile() groups on
  if (input.period && input.period.granularity && input.period.granularity !== 'none') {
    const be = bucketExpr(src.dateCol, input.period.granularity);
    if (be) { params.push(input.period.value); where.push(`${be} = $${params.length}`); }
  }

  // the report's active client filters (allowlisted) + server-enforced agent-scope
  for (const f of input.filters ?? []) {
    const d = dimByKey[f.dim];
    if (!d) throw new BuilderValidationError(`Unknown filter dimension "${f.dim}" for source "${src.key}"`);
    if (!OPS[f.op]) throw new BuilderValidationError(`Unsupported filter operator "${f.op}"`);
    where.push(buildCond(d.col, f.op, f.value, params));
  }
  for (const f of input.enforcedFilters ?? []) {
    if (!OPS[f.op]) throw new BuilderValidationError(`Unsupported enforced operator "${f.op}"`);
    where.push(buildCond(f.col, f.op, f.value, params));
  }

  // ── SELECT: every source dimension (raw, per-row) + each metric's per-row base ──
  const selectParts: string[] = [];
  const columns: CompiledColumn[] = [];
  for (const d of src.dimensions) {
    selectParts.push(`${d.col} AS "${d.key}"`);
    columns.push({ key: d.key, label_en: d.label_en, label_ar: d.label_ar, kind: 'dimension', type: d.type, time: d.time });
  }
  for (const k of metricKeys) {
    const m = metricByKey[k];
    selectParts.push(`${drillMetricArg(m.expr)} AS "${k}"`);
    columns.push({ key: k, label_en: m.label_en, label_ar: m.label_ar, kind: 'metric', format: m.format });
  }

  const limit = Math.min(Math.max(1, input.limit ?? 500), DRILL_MAX);
  let sql = `SELECT ${selectParts.join(', ')} FROM ${src.from} WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY ${src.dateCol} NULLS LAST`;
  sql += ` LIMIT ${limit}`;

  return { sql, params, columns };
}

/** Return the balanced content of the parenthesis that OPENS at `openIdx`. */
function balanced(s: string, openIdx: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return { inner: s.slice(openIdx + 1, i), end: i }; }
  }
  throw new BuilderValidationError('Unbalanced parentheses in metric expression');
}

/**
 * Reduce an aggregate metric expression to its PER-ROW base value:
 *   SUM(x)                         → x                       (Σ base == aggregate)
 *   COUNT(*)                       → 1                       (Σ base == count)
 *   COUNT(*) FILTER (WHERE p)      → CASE WHEN (p) THEN 1 END (Σ base == filtered count)
 *   COUNT(DISTINCT x) / AVG(x) …   → x                       (row shows the underlying value)
 *   ROUND(SUM(x)/60.0,1) etc.      → x  (first real aggregate found; scaling drops off)
 * Non-decomposable ratios surface their first aggregate's argument — still the raw
 * underlying value for that row. All column refs are unchanged, so the result is valid
 * SQL over the same FROM as the aggregate.
 */
export function drillMetricArg(expr: string): string {
  const m = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i.exec(expr);
  if (!m) return expr; // already per-row
  const openIdx = expr.indexOf('(', m.index);
  const { inner, end } = balanced(expr, openIdx);
  // an immediately following FILTER (WHERE …) narrows the aggregate to matching rows
  let filterCond: string | null = null;
  if (/^\s*FILTER\s*\(\s*WHERE\b/i.test(expr.slice(end + 1))) {
    const fopen = expr.indexOf('(', end + 1);
    filterCond = balanced(expr, fopen).inner.replace(/^\s*WHERE\s+/i, '').trim();
  }
  const t = inner.trim();
  const base = t === '*' ? '1' : t.replace(/^DISTINCT\s+/i, '');
  return filterCond ? `(CASE WHEN (${filterCond}) THEN (${base}) ELSE NULL END)` : base;
}

function buildCond(col: string, op: FilterOp, value: any, params: any[]): string {
  if (VALUELESS.includes(op)) return `${col} ${OPS[op]}`;
  if (op === 'in') {
    const arr = Array.isArray(value) ? value : [value];
    if (arr.length === 0) return '1=0'; // empty IN → match nothing (safe)
    const placeholders = arr.map(v => { params.push(v); return `$${params.length}`; });
    return `${col} IN (${placeholders.join(', ')})`;
  }
  if (op === 'like') { params.push(`%${value}%`); return `${col} ILIKE $${params.length}`; }
  params.push(value);
  return `${col} ${OPS[op]} $${params.length}`;
}

/** Public catalog listing (labels + category + descriptions), optionally filtered
 *  by the permission codes a user holds. Additive to the BLD-1 shape. */
export function listCatalog(userPermissions?: string[]) {
  return DATA_SOURCES
    .filter(s => !userPermissions || userPermissions.includes(s.permission))
    .map(s => ({
      key: s.key, label_en: s.label_en, label_ar: s.label_ar, group: s.group,
      category: s.category ?? s.group, permission: s.permission,
      description_en: s.description_en ?? '', description_ar: s.description_ar ?? '',
    }));
}
