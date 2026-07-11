import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Wrench, Play, Save, Bookmark, X, Plus, Filter,
  Table2, BarChart3, PieChart, LineChart, Download, Database, Trash2,
  ChevronUp, ChevronDown, RefreshCw, Sparkles, Layers,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import {
  useInjectDsStyles, card, tp, ts, NxCard, NxBtn, NxLoading, NxEmpty, NxError, NxPageHeader,
} from '@/components/ds';
import { BarRow, Donut } from '@/components/dazzle';
import { FieldPicker, PickerField } from '@/components/report-builder/FieldPicker';
import { DateRangePicker, DateRangeValue, presetById } from '@/components/report-builder/DateRangePicker';

/* ── types mirroring the BLD-1/BLD-2 backend (category/description/badge are
      optional — the picker falls back gracefully on today's payload) ───────── */
type Source = { key: string; label_en: string; label_ar: string; group: string; category?: string; permission?: string; description_en?: string; description_ar?: string };
type Field  = { key: string; label_en: string; label_ar: string; type: string; time?: boolean; badge?: PickerField['badge']; category?: string; description_en?: string; description_ar?: string };
type Metric = { key: string; label_en: string; label_ar: string; format: string; badge?: PickerField['badge']; category?: string; description_en?: string; description_ar?: string };
type SourceDetail = { key: string; label_en: string; label_ar: string; dateColumn?: string; personCol?: string; personScoped?: boolean; dimensions: Field[]; metrics: Metric[] };
type Column = { key: string; label_en: string; label_ar: string; kind: 'dimension' | 'metric'; type?: string; format?: string; time?: boolean };
type RunResult = { sourceKey: string; columns: Column[]; rowCount: number; rows: any[] };
type FilterRow = { dim: string; op: FilterOp; value: string };
type FilterOp = 'eq' | 'ne' | 'lt' | 'gt' | 'lte' | 'gte' | 'in' | 'like' | 'not_null' | 'is_null';
type Viz = 'table' | 'bar' | 'line' | 'donut';
type Gran = 'none' | 'day' | 'week' | 'month';
type SavedReport = { id: string; name: string; description?: string; source_key: string; viz?: Viz; shared?: boolean; is_owner?: boolean; config?: any };

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#a3e635', '#eab308', '#06b6d4'];

/* operators available per dimension type */
const OPS_BY_TYPE: Record<string, FilterOp[]> = {
  string: ['eq', 'ne', 'in', 'like', 'not_null', 'is_null'],
  date:   ['eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'not_null', 'is_null'],
  number: ['eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'not_null', 'is_null'],
};
const OP_LABEL: Record<FilterOp, { en: string; ar: string }> = {
  eq: { en: '=', ar: '=' }, ne: { en: '≠', ar: '≠' }, lt: { en: '<', ar: '<' }, gt: { en: '>', ar: '>' },
  lte: { en: '≤', ar: '≤' }, gte: { en: '≥', ar: '≥' }, in: { en: 'in (a,b,c)', ar: 'ضمن (أ،ب،ج)' },
  like: { en: 'contains', ar: 'يحتوي' }, not_null: { en: 'is set', ar: 'موجود' }, is_null: { en: 'is empty', ar: 'فارغ' },
};
const VALUELESS: FilterOp[] = ['not_null', 'is_null'];

/* default range = rolling Last 30 Days */
function defaultRange(): DateRangeValue {
  const [f, t] = presetById('last30')!.range();
  return { dateFrom: f, dateTo: t, timeFrom: '00:00', timeTo: '23:59', rolling: { preset: 'last30' } };
}

/* value formatter honoring column.format */
function fmtCell(v: any, col: Column): string {
  if (v == null || v === '') return '—';
  if (col.kind === 'dimension' || col.time) return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  switch (col.format) {
    case 'hours':   return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
    case 'minutes': return `${n.toLocaleString()} m`;
    case 'percent': return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'count':
    case 'number':  return n.toLocaleString();
    default:        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

export default function ReportBuilderPage() {
  useInjectDsStyles();
  const { lang, dark } = useUiStore(); const ar = lang === 'ar';
  const L = (en: string, arv: string) => (ar ? arv : en);

  const [sources, setSources] = useState<Source[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [dims, setDims] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [dateVal, setDateVal] = useState<DateRangeValue>(defaultRange);
  const from = dateVal.dateFrom, to = dateVal.dateTo;
  const [gran, setGran] = useState<Gran>('none');
  const [viz, setViz] = useState<Viz>('table');
  const [picker, setPicker] = useState<null | 'dimension' | 'metric'>(null);

  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  /* ── initial loads ── */
  useEffect(() => {
    apiClient.get('/report-builder-v2/sources')
      .then((r: any) => setSources(r.data?.sources ?? []))
      .catch(() => setErr('sources'));
    refreshSaved();
  }, []); // eslint-disable-line

  const refreshSaved = useCallback(() => {
    apiClient.get('/report-builder-v2/saved-reports').then((r: any) => setSaved(r.data ?? [])).catch(() => {});
  }, []);

  /* ── on source change → fetch its schema ── */
  const loadSource = useCallback((key: string, keep = false) => {
    setSourceKey(key);
    apiClient.get(`/report-builder-v2/sources/${key}`).then((r: any) => {
      const d: SourceDetail = r.data;
      setDetail(d);
      if (!keep) { setDims([]); setMetrics([]); setFilters([]); setResult(null); }
    }).catch(() => setErr('source'));
  }, []);

  /* ── run (debounced) ── */
  const runNow = useCallback(() => {
    if (!sourceKey || metrics.length === 0) { setResult(null); return; }
    setLoading(true); setErr(null);
    apiClient.post('/report-builder-v2/run', {
      sourceKey, dimensions: dims, metrics,
      filters: filters.filter(f => f.dim && (VALUELESS.includes(f.op) || f.value !== '')).map(f => ({
        dim: f.dim, op: f.op,
        ...(VALUELESS.includes(f.op) ? {} : { value: f.op === 'in' ? f.value.split(',').map(s => s.trim()).filter(Boolean) : f.value }),
      })),
      dateFrom: from, dateTo: to, granularity: gran, limit: 5000,
    }).then((r: any) => setResult(r.data)).catch((e: any) => {
      setErr(e?.response?.data?.message || 'run'); setResult(null);
    }).finally(() => setLoading(false));
  }, [sourceKey, dims, metrics, filters, from, to, gran]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const t = setTimeout(runNow, 400);
    return () => clearTimeout(t);
  }, [sourceKey, dims, metrics, filters, from, to, gran]); // eslint-disable-line

  /* ── library helpers ── */
  const toggle = (arr: string[], setArr: (v: string[]) => void, k: string) =>
    setArr(arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k]);
  const move = (arr: string[], setArr: (v: string[]) => void, k: string, dir: -1 | 1) => {
    const i = arr.indexOf(k); const j = i + dir; if (i < 0 || j < 0 || j >= arr.length) return;
    const next = [...arr]; [next[i], next[j]] = [next[j], next[i]]; setArr(next);
  };
  const label = (o: { label_en: string; label_ar: string }) => (ar ? o.label_ar : o.label_en);
  const dimByKey = useMemo(() => Object.fromEntries((detail?.dimensions ?? []).map(d => [d.key, d])), [detail]);
  const metByKey = useMemo(() => Object.fromEntries((detail?.metrics ?? []).map(m => [m.key, m])), [detail]);

  /* ── filters ── */
  const addFilter = () => { const d = detail?.dimensions?.[0]; if (!d) return; setFilters(f => [...f, { dim: d.key, op: (OPS_BY_TYPE[d.type] ?? OPS_BY_TYPE.string)[0], value: '' }]); };
  const setFilter = (i: number, patch: Partial<FilterRow>) => setFilters(f => f.map((r, ix) => ix === i ? { ...r, ...patch } : r));
  const delFilter = (i: number) => setFilters(f => f.filter((_, ix) => ix !== i));

  /* ── save / load / delete ── */
  const doSave = async () => {
    if (!sourceKey || metrics.length === 0) { alert(L('Pick a source and at least one metric first.', 'اختر مصدراً ومقياساً واحداً على الأقل.')); return; }
    const name = window.prompt(L('Report name:', 'اسم التقرير:')); if (!name) return;
    const sharedYes = window.confirm(L('Share this report with the team? (OK = shared, Cancel = private)', 'مشاركة التقرير مع الفريق؟ (موافق = مشترك، إلغاء = خاص)'));
    /* timeFrom/timeTo/rolling are stored for forward-compat — /run consumes dateFrom/dateTo today */
    const config = { dimensions: dims, metrics, filters, dateFrom: from, dateTo: to, timeFrom: dateVal.timeFrom, timeTo: dateVal.timeTo, rolling: dateVal.rolling ?? null, granularity: gran, viz };
    try {
      await apiClient.post('/report-builder-v2/saved-reports', { name, sourceKey, config, viz, shared: sharedYes });
      refreshSaved();
    } catch { alert(L('Save failed.', 'فشل الحفظ.')); }
  };
  const doLoad = async (id: string) => {
    try {
      const r: any = await apiClient.get(`/report-builder-v2/saved-reports/${id}`);
      const rep = r.data; const cfg = rep.config ?? {};
      setLoadedId(id); setDrawer(false);
      // load the source schema first, then repopulate config
      await new Promise<void>(res => { loadSource(rep.source_key, true); res(); });
      setDims(cfg.dimensions ?? []); setMetrics(cfg.metrics ?? []); setFilters(cfg.filters ?? []);
      setGran(cfg.granularity ?? 'none'); setViz(cfg.viz ?? rep.viz ?? 'table');
      /* rolling preset re-evaluates on load; legacy cfg.preset supported */
      const rollId = cfg.rolling?.preset ?? (cfg.preset && cfg.preset !== 'custom' ? cfg.preset : null);
      const rp = rollId ? presetById(rollId) : null;
      if (rp) {
        const [f, t] = rp.range();
        setDateVal({ dateFrom: f, dateTo: t, timeFrom: cfg.timeFrom ?? '00:00', timeTo: cfg.timeTo ?? '23:59', rolling: { preset: rollId } });
      } else if (cfg.dateFrom && cfg.dateTo) {
        setDateVal({ dateFrom: cfg.dateFrom, dateTo: cfg.dateTo, timeFrom: cfg.timeFrom ?? '00:00', timeTo: cfg.timeTo ?? '23:59', rolling: null });
      }
      setTimeout(runNow, 500);
    } catch { alert(L('Load failed.', 'فشل التحميل.')); }
  };
  const doDelete = async (id: string) => {
    if (!window.confirm(L('Delete this report?', 'حذف هذا التقرير؟'))) return;
    try { await apiClient.delete(`/report-builder-v2/saved-reports/${id}`); if (loadedId === id) setLoadedId(null); refreshSaved(); } catch {}
  };

  /* ── CSV export of current rows (no xlsx dep in this app) ── */
  const exportCsv = () => {
    if (!result?.rows?.length) return;
    const cols = result.columns;
    const esc = (s: any) => { const v = s == null ? '' : String(s); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const head = cols.map(c => esc(label(c))).join(',');
    const body = result.rows.map(row => cols.map(c => esc(fmtCell(row[c.key], c) === '—' ? '' : row[c.key])).join(',')).join('\n');
    const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${sourceKey || 'report'}_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  /* ── grouped source list ── */
  const grouped = useMemo(() => {
    const g: Record<string, Source[]> = {};
    for (const s of sources) (g[s.group] ??= []).push(s);
    return g;
  }, [sources]);

  /* ── chart data: first dimension/period as label, first metric as value ── */
  const chart = useMemo(() => {
    if (!result) return null;
    const dimCol = result.columns.find(c => c.kind === 'dimension');
    const metCol = result.columns.find(c => c.kind === 'metric');
    if (!dimCol || !metCol) return null;
    const pts = result.rows.slice(0, 24).map((r, i) => ({
      label: String(r[dimCol.key] ?? '—'), value: Number(r[metCol.key]) || 0, color: CHART_COLORS[i % CHART_COLORS.length],
    }));
    return { dimCol, metCol, pts, max: Math.max(1, ...pts.map(p => p.value)) };
  }, [result]);

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 9, fontSize: 12,
    background: dark ? 'rgba(255,255,255,0.05)' : '#fff',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    color: tp(dark), outline: 'none',
  };
  const chip = (active: boolean, color = '#6366f1'): React.CSSProperties => ({
    padding: '5px 10px', borderRadius: 9, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? color + '80' : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)')}`,
    background: active ? `${color}22` : (dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
    color: active ? color : ts(dark), display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all .15s',
  });

  /* unified picker catalog — badge inferred from kind when the backend doesn't send one */
  const pickerFields = useMemo<PickerField[]>(() => [
    ...(detail?.dimensions ?? []).map(d => ({ ...d, kind: 'dimension' as const, badge: d.badge ?? 'dimension' as const })),
    ...(detail?.metrics ?? []).map(m => ({ ...m, kind: 'metric' as const, badge: m.badge ?? 'metric' as const })),
  ], [detail]);

  return (
    <div style={{ animation: 'ds-fadein .4s ease' }}>
      <NxPageHeader
        title="Report Builder" titleAr="منشئ التقارير"
        desc="Universal self-service builder — pick a source, dimensions & metrics, filter, visualize, save"
        descAr="منشئ تقارير شامل — اختر مصدراً وأبعاداً ومقاييس، فلتر، اعرض، احفظ"
        icon={Wrench} color="#8b5cf6" dark={dark} ar={ar}
        actions={<>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 20, background: 'rgba(139,92,246,0.14)', color: '#a78bfa', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={11} /> Builder v2
          </span>
          <NxBtn icon={Bookmark} variant="outline" color="#6366f1" dark={dark} onClick={() => setDrawer(true)}>
            {L('Saved', 'المحفوظة')} {saved.length ? `(${saved.length})` : ''}
          </NxBtn>
          <NxBtn icon={Save} color="#6366f1" dark={dark} onClick={doSave}>{L('Save', 'حفظ')}</NxBtn>
        </>}
      />

      {err === 'sources' && <NxError onRetry={() => window.location.reload()} dark={dark} ar={ar} />}

      {/* ── 1. SOURCE PICKER ── */}
      <NxCard dark={dark} style={{ marginBottom: 14 }} pad="16px 18px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Database size={14} style={{ color: '#8b5cf6' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: tp(dark) }}>{L('Data source', 'مصدر البيانات')}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(grouped).map(([grp, list]) => (
            <div key={grp} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: ts(dark) }}>{grp}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {list.map(s => (
                  <button key={s.key} onClick={() => loadSource(s.key)} style={{
                    ...chip(sourceKey === s.key, '#8b5cf6'), padding: '8px 13px', fontSize: 12.5,
                  }}>{label(s)}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </NxCard>

      {!detail && (
        <NxEmpty icon={Database} ar={ar} dark={dark}
          title="Choose a data source to start building" titleAr="اختر مصدر بيانات للبدء"
          desc="7 sources available — overtime, login/logout, attendance, scorecard, permissions, breaks, coverage"
          descAr="٧ مصادر متاحة — الإضافي، الدخول/الخروج، الحضور، بطاقة الأداء، الاستئذانات، الاستراحات، التغطية" />
      )}

      {detail && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: 14, alignItems: 'start' }}>
          {/* ── LEFT: fields (picker-driven, reorderable) ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <NxCard dark={dark} pad="14px 16px">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Layers size={13} style={{ color: '#6366f1' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: tp(dark) }}>{L('Fields', 'الحقول')}</span>
                <span style={{ marginInlineStart: 'auto', fontSize: 10.5, color: ts(dark) }}>{pickerFields.length} {L('available', 'متاح')}</span>
              </div>

              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: ts(dark), marginBottom: 6 }}>{L('Group by (dimensions)', 'التجميع (الأبعاد)')}</div>
              {dims.length === 0 && <div style={{ fontSize: 11, color: ts(dark), marginBottom: 8 }}>{L('none — totals only', 'لا شيء — الإجمالي فقط')}</div>}
              {dims.map(k => (
                <SelChip key={k} label={label(dimByKey[k] ?? { label_en: k, label_ar: k })} color="#6366f1" dark={dark}
                  onUp={() => move(dims, setDims, k, -1)} onDown={() => move(dims, setDims, k, 1)} onRemove={() => toggle(dims, setDims, k)} />
              ))}
              <button onClick={() => setPicker('dimension')} style={{ ...chip(false), width: '100%', justifyContent: 'center', padding: '8px 10px', marginBottom: 12, borderStyle: 'dashed' }}>
                <Plus size={11} /> {L('Add dimension', 'إضافة بُعد')}
              </button>

              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: ts(dark), marginBottom: 6 }}>{L('Metrics', 'المقاييس')} <span style={{ color: '#ef4444' }}>*</span></div>
              {metrics.length === 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 8 }}>{L('add at least one metric', 'أضف مقياساً واحداً على الأقل')}</div>}
              {metrics.map(k => (
                <SelChip key={k} label={label(metByKey[k] ?? { label_en: k, label_ar: k })} color="#22c55e" dark={dark}
                  onUp={() => move(metrics, setMetrics, k, -1)} onDown={() => move(metrics, setMetrics, k, 1)} onRemove={() => toggle(metrics, setMetrics, k)} />
              ))}
              <button onClick={() => setPicker('metric')} style={{ ...chip(false, '#22c55e'), width: '100%', justifyContent: 'center', padding: '8px 10px', borderStyle: 'dashed' }}>
                <Plus size={11} /> {L('Add metric', 'إضافة مقياس')}
              </button>
            </NxCard>
          </div>

          {/* ── RIGHT: controls + result ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* date + granularity + filters + viz */}
            <NxCard dark={dark} pad="14px 16px">
              {/* date range pill (Sprinklr-style) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <DateRangePicker value={dateVal} dark={dark} ar={ar} onApply={setDateVal} />
                <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: ts(dark) }}>{L('Bucket', 'التقسيم')}</span>
                  {(['none', 'day', 'week', 'month'] as Gran[]).map(g => (
                    <button key={g} onClick={() => setGran(g)} style={chip(gran === g)}>{L(g, { none: 'بدون', day: 'يوم', week: 'أسبوع', month: 'شهر' }[g])}</button>
                  ))}
                </div>
              </div>

              {/* filters */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: filters.length ? 8 : 0 }}>
                <Filter size={13} style={{ color: ts(dark) }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: tp(dark) }}>{L('Filters', 'الفلاتر')}</span>
                <button onClick={addFilter} style={{ ...chip(false), marginInlineStart: 'auto' }}><Plus size={10} /> {L('Add filter', 'إضافة فلتر')}</button>
              </div>
              {filters.map((f, i) => {
                const dt = dimByKey[f.dim]?.type ?? 'string';
                const ops = OPS_BY_TYPE[dt] ?? OPS_BY_TYPE.string;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <select value={f.dim} onChange={e => { const nd = detail.dimensions.find(d => d.key === e.target.value)!; const nops = OPS_BY_TYPE[nd.type] ?? OPS_BY_TYPE.string; setFilter(i, { dim: e.target.value, op: nops.includes(f.op) ? f.op : nops[0] }); }} style={inputStyle}>
                      {detail.dimensions.map(d => <option key={d.key} value={d.key}>{label(d)}</option>)}
                    </select>
                    <select value={f.op} onChange={e => setFilter(i, { op: e.target.value as FilterOp })} style={inputStyle}>
                      {ops.map(op => <option key={op} value={op}>{ar ? OP_LABEL[op].ar : OP_LABEL[op].en}</option>)}
                    </select>
                    {!VALUELESS.includes(f.op) && (
                      <input value={f.value} onChange={e => setFilter(i, { value: e.target.value })}
                        placeholder={f.op === 'in' ? L('a, b, c', 'أ، ب، ج') : L('value', 'قيمة')}
                        type={dt === 'date' ? 'date' : 'text'} style={{ ...inputStyle, minWidth: 140 }} />
                    )}
                    <button onClick={() => delFilter(i)} style={{ ...chip(false, '#ef4444'), padding: '6px' }}><X size={12} /></button>
                  </div>
                );
              })}

              {/* viz toggle + actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {([['table', Table2], ['bar', BarChart3], ['line', LineChart], ['donut', PieChart]] as [Viz, any][]).map(([v, Ic]) => (
                  <button key={v} onClick={() => setViz(v)} style={{ ...chip(viz === v, '#8b5cf6'), padding: '7px 11px' }}><Ic size={13} /> {L(v[0].toUpperCase() + v.slice(1), { table: 'جدول', bar: 'أعمدة', line: 'خطي', donut: 'دائري' }[v])}</button>
                ))}
                <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
                  <NxBtn icon={RefreshCw} variant="ghost" size="sm" dark={dark} onClick={runNow}>{L('Run', 'تشغيل')}</NxBtn>
                  <NxBtn icon={Download} variant="outline" size="sm" color="#22c55e" dark={dark} onClick={exportCsv}>{L('Export CSV', 'تصدير CSV')}</NxBtn>
                </div>
              </div>
            </NxCard>

            {/* result */}
            <NxCard dark={dark} pad="0" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Play size={12} style={{ color: '#6366f1' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: tp(dark) }}>{L('Preview', 'المعاينة')}</span>
                {result && <span style={{ fontSize: 11, color: ts(dark) }}>{result.rowCount.toLocaleString()} {L('rows', 'صف')} · {from} → {to}</span>}
              </div>

              {loading && <NxLoading dark={dark} ar={ar} />}
              {!loading && err && err !== 'sources' && (
                <div style={{ padding: 16 }}><NxError onRetry={runNow} dark={dark} ar={ar} /></div>
              )}
              {!loading && !err && metrics.length === 0 && (
                <NxEmpty icon={Sparkles} ar={ar} dark={dark} title="Add a metric to see results" titleAr="أضف مقياساً لعرض النتائج"
                  desc="Pick at least one metric from the library on the left." descAr="اختر مقياساً واحداً على الأقل من المكتبة." />
              )}
              {!loading && !err && metrics.length > 0 && result && result.rows.length === 0 && (
                <NxEmpty ar={ar} dark={dark} title="No data for this range/filters" titleAr="لا توجد بيانات لهذا النطاق/الفلاتر"
                  desc="Try widening the date range or removing filters." descAr="جرّب توسيع النطاق الزمني أو إزالة الفلاتر." />
              )}

              {!loading && !err && result && result.rows.length > 0 && (
                <div style={{ padding: viz === 'table' ? 0 : 18 }}>
                  {viz === 'table' && <ResultTable result={result} dark={dark} ar={ar} label={label} />}
                  {(viz === 'bar' || viz === 'line') && chart && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 11, color: ts(dark), marginBottom: 4 }}>{label(chart.metCol)} {L('by', 'حسب')} {label(chart.dimCol)}</div>
                      {viz === 'bar'
                        ? chart.pts.map((p, i) => <BarRow key={i} label={p.label} value={p.value} max={chart.max} color={p.color} delay={i * 40} />)
                        : <LineChartSvg pts={chart.pts} dark={dark} />}
                    </div>
                  )}
                  {viz === 'donut' && chart && (
                    <Donut segments={chart.pts} centerNum={chart.pts.reduce((a, p) => a + p.value, 0)} centerLabel={label(chart.metCol)} />
                  )}
                  {viz !== 'table' && !chart && (
                    <div style={{ fontSize: 12, color: ts(dark), padding: 8 }}>{L('Add a dimension to chart this data.', 'أضف بُعداً لعرض هذه البيانات كرسم.')}</div>
                  )}
                </div>
              )}
            </NxCard>
          </div>
        </div>
      )}

      {/* ── FIELD PICKER MODAL ── */}
      {picker && detail && (
        <FieldPicker
          fields={pickerFields}
          kindDefault={picker}
          initial={picker === 'dimension' ? dims : metrics}
          dark={dark} ar={ar}
          onCancel={() => setPicker(null)}
          onDone={(selected) => {
            /* the picker can select across kinds — route each key to its list */
            const dimKeys = new Set((detail.dimensions ?? []).map(d => d.key));
            const metKeys = new Set((detail.metrics ?? []).map(m => m.key));
            const pickedDims = selected.filter(k => dimKeys.has(k));
            const pickedMets = selected.filter(k => metKeys.has(k) && !dimKeys.has(k));
            if (picker === 'dimension') {
              setDims(pickedDims);
              if (pickedMets.length) setMetrics(prev => [...prev, ...pickedMets.filter(k => !prev.includes(k))]);
            } else {
              setMetrics(pickedMets);
              if (pickedDims.length) setDims(prev => [...prev, ...pickedDims.filter(k => !prev.includes(k))]);
            }
            setPicker(null);
          }}
        />
      )}

      {/* ── SAVED DRAWER ── */}
      {drawer && (
        <div onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 360, maxWidth: '90vw', height: '100%', overflowY: 'auto', ...card(dark), borderRadius: 0, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Bookmark size={16} style={{ color: '#6366f1' }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: tp(dark) }}>{L('Saved reports', 'التقارير المحفوظة')}</span>
              <button onClick={() => setDrawer(false)} style={{ marginInlineStart: 'auto', ...chip(false, '#ef4444'), padding: 6 }}><X size={14} /></button>
            </div>
            {saved.length === 0 && <NxEmpty ar={ar} dark={dark} title="No saved reports yet" titleAr="لا توجد تقارير محفوظة" desc="Build a report and press Save." descAr="ابنِ تقريراً واضغط حفظ." />}
            {saved.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, marginBottom: 8, border: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`, background: loadedId === s.id ? 'rgba(99,102,241,0.1)' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => doLoad(s.id)}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: tp(dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, color: ts(dark), display: 'flex', gap: 6 }}>
                    <span>{s.source_key}</span>
                    {s.shared && <span style={{ color: '#22c55e' }}>· {L('shared', 'مشترك')}</span>}
                    {!s.is_owner && <span>· {L('by teammate', 'من زميل')}</span>}
                  </div>
                </div>
                {s.is_owner && <button onClick={() => doDelete(s.id)} style={{ ...chip(false, '#ef4444'), padding: 6 }}><Trash2 size={12} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── selected chip with reorder ── */
function SelChip({ label, color, dark, onUp, onDown, onRemove }: { label: string; color: string; dark: boolean; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 9, marginBottom: 5, background: `${color}18`, border: `1px solid ${color}40` }}>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <button onClick={onUp} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, display: 'flex' }}><ChevronUp size={13} /></button>
      <button onClick={onDown} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, display: 'flex' }}><ChevronDown size={13} /></button>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 0, display: 'flex' }}><X size={13} /></button>
    </div>
  );
}

/* ── result table ── */
function ResultTable({ result, dark, ar, label }: { result: RunResult; dark: boolean; ar: boolean; label: (o: any) => string }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: '58vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: dark ? '#11162a' : '#f8fafc' }}>
          <tr>
            {result.columns.map((c, i) => (
              <th key={c.key} style={{ padding: '10px 16px', textAlign: i === 0 ? 'start' : 'end', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: c.kind === 'metric' ? '#22c55e' : ts(dark), whiteSpace: 'nowrap' }}>{label(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 1000).map((r, ri) => (
            <tr key={ri} style={{ borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` }}>
              {result.columns.map((c, ci) => (
                <td key={c.key} style={{ padding: '9px 16px', textAlign: ci === 0 ? 'start' : 'end', color: ci === 0 ? tp(dark) : (c.kind === 'metric' ? tp(dark) : ts(dark)), fontWeight: ci === 0 ? 600 : (c.kind === 'metric' ? 700 : 400), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {fmtCell(r[c.key], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > 1000 && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: ts(dark) }}>{ar ? `عرض أول ١٠٠٠ من ${result.rowCount} — صدّر CSV للكل` : `Showing first 1,000 of ${result.rowCount} — export CSV for all`}</div>
      )}
    </div>
  );
}

/* ── minimal line chart (theme-aware SVG) ── */
function LineChartSvg({ pts, dark }: { pts: { label: string; value: number; color: string }[]; dark: boolean }) {
  const W = 640, H = 200, pad = 28;
  const max = Math.max(1, ...pts.map(p => p.value));
  const x = (i: number) => pad + (pts.length <= 1 ? 0 : (i * (W - pad * 2)) / (pts.length - 1));
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ minWidth: W }}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke={dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'} />
        <path d={d} fill="none" stroke="#6366f1" strokeWidth={2} />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="#6366f1" />
            <text x={x(i)} y={H - pad + 14} textAnchor="middle" fontSize={9} fill={dark ? '#64748b' : '#94a3b8'}>{p.label.length > 8 ? p.label.slice(0, 8) : p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
