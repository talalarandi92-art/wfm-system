/**
 * Dashboard Composer (BLD-3) — shared types + helpers.
 * A dashboard = tabbed sections; a section = a responsive grid of widgets.
 * Each widget runs its own /report-builder-v2/run with the dashboard-level
 * date range + function filter cascaded in (unless the widget pins its own
 * dates, and only where the widget's source actually carries a `function` dim).
 */
import type { DateRangeValue } from '@/components/report-builder/DateRangePicker';
import { presetById } from '@/components/report-builder/DateRangePicker';

export type Viz = 'table' | 'bar' | 'line' | 'donut' | 'stat';
export type Gran = 'none' | 'day' | 'week' | 'month';

export type FilterOp = 'eq' | 'ne' | 'lt' | 'gt' | 'lte' | 'gte' | 'in' | 'like' | 'not_null' | 'is_null';
export type WidgetFilter = { dim: string; op: FilterOp; value?: string | string[] };

export type WidgetConfig = {
  id: string;
  title: string;
  sourceKey: string;
  dimensions: string[];
  metrics: string[];
  filters: WidgetFilter[];
  viz: Viz;
  granularity: Gran;
  /** widget opts out of the dashboard date cascade when set */
  pinnedDates: { dateFrom: string; dateTo: string } | null;
  /** provenance: widget was created from this saved report (informational) */
  savedReportId?: string | null;
  /** grid span: 1 = normal, 2 = wide (full row on desktop) */
  span?: 1 | 2;
};

export type SectionConfig = { id: string; name: string; widgets: WidgetConfig[] };

/** dashboard-level cascading filters — stored as an array so the model can grow */
export type DashFilter = { dim: string; value: string };

export type SavedDashboard = {
  id: string; name: string; description?: string | null;
  shared?: boolean; is_owner?: boolean;
  sections?: SectionConfig[];
  date_range?: DateRangeValue | null;
  filters?: DashFilter[] | null;
  updated_at?: string;
};

/* ── source-schema shapes (fetched once per sourceKey, shared across widgets) ─ */
export type SourceMeta = {
  key: string; label_en: string; label_ar: string; group: string;
  category?: string; permission?: string; description_en?: string; description_ar?: string;
};
export type SourceField = {
  key: string; label_en: string; label_ar: string; type?: string; format?: string;
  time?: boolean; badge?: 'dimension' | 'custom_dimension' | 'metric' | 'calculated_metric';
  category?: string; description_en?: string; description_ar?: string;
};
export type SourceDetail = {
  key: string; label_en: string; label_ar: string;
  group?: string; category?: string; dateColumn?: string; personCol?: string; personScoped?: boolean;
  dimensions: SourceField[]; metrics: SourceField[];
};

export type RunColumn = { key: string; label_en: string; label_ar: string; kind: 'dimension' | 'metric'; type?: string; format?: string; time?: boolean };
export type RunResult = { sourceKey: string; columns: RunColumn[]; rowCount: number; rows: any[] };

export type SavedReportLite = { id: string; name: string; source_key: string; viz?: Viz; shared?: boolean; is_owner?: boolean; config?: any };

export const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#a3e635', '#eab308', '#06b6d4'];

/* filter operators — mirrors ReportBuilder */
export const OPS_BY_TYPE: Record<string, FilterOp[]> = {
  string: ['eq', 'ne', 'in', 'like', 'not_null', 'is_null'],
  date:   ['eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'not_null', 'is_null'],
  number: ['eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'not_null', 'is_null'],
};
export const OP_LABEL: Record<FilterOp, { en: string; ar: string }> = {
  eq: { en: '=', ar: '=' }, ne: { en: '≠', ar: '≠' }, lt: { en: '<', ar: '<' }, gt: { en: '>', ar: '>' },
  lte: { en: '≤', ar: '≤' }, gte: { en: '≥', ar: '≥' }, in: { en: 'in (a,b,c)', ar: 'ضمن (أ،ب،ج)' },
  like: { en: 'contains', ar: 'يحتوي' }, not_null: { en: 'is set', ar: 'موجود' }, is_null: { en: 'is empty', ar: 'فارغ' },
};
export const VALUELESS: FilterOp[] = ['not_null', 'is_null'];

export const uid = () => `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
export const sid = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** default dashboard range = rolling Last 30 Days */
export function defaultRange(): DateRangeValue {
  const [f, t] = presetById('last30')!.range();
  return { dateFrom: f, dateTo: t, timeFrom: '00:00', timeTo: '23:59', rolling: { preset: 'last30' } };
}

export function newSection(name: string): SectionConfig {
  return { id: sid(), name, widgets: [] };
}
export function newWidget(partial: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    id: uid(), title: partial.title ?? 'Untitled widget', sourceKey: partial.sourceKey ?? '',
    dimensions: partial.dimensions ?? [], metrics: partial.metrics ?? [], filters: partial.filters ?? [],
    viz: partial.viz ?? 'table', granularity: partial.granularity ?? 'none',
    pinnedDates: partial.pinnedDates ?? null, savedReportId: partial.savedReportId ?? null, span: partial.span ?? 1,
  };
}

/** the effective date window for a widget (its pin wins over the dashboard cascade) */
export function effectiveDates(w: WidgetConfig, dash: { dateFrom: string; dateTo: string }) {
  return w.pinnedDates ?? dash;
}

/** value formatter honoring column.format (same rules as ReportBuilder's fmtCell) */
export function fmtVal(v: any, col?: { kind?: string; format?: string; time?: boolean }): string {
  if (v == null || v === '') return '—';
  if (col?.kind === 'dimension' || col?.time) return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  switch (col?.format) {
    case 'hours':   return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
    case 'minutes': return `${n.toLocaleString()} m`;
    case 'pct':
    case 'percent': return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'count':
    case 'number':  return n.toLocaleString();
    default:        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}
