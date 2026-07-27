/**
 * Dashboard Composer — widget editor modal.
 *
 * Two ways to build a widget:
 *   1. From a saved report  — pick one; its source/dims/metrics/filters/viz load in.
 *   2. Inline               — pick a source, then dims & metrics via the shared
 *                             FieldPicker, add filters, choose a viz.
 * Plus: title, granularity, wide-span, and an optional per-widget pinned date
 * window (opts the widget out of the dashboard date cascade).
 */
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, X, Plus, Filter, Database, Table2, BarChart3, LineChart, PieChart, Hash, Bookmark, Layers } from 'lucide-react';
import { apiClient } from '@/api/client';
import { tp, ts, NxBtn } from '@/components/ds';
import { FieldPicker, PickerField } from '@/components/report-builder/FieldPicker';
import { DateRangePicker, DateRangeValue } from '@/components/report-builder/DateRangePicker';
import { useSources, useSourceDetail } from './sourceCatalog';
import { fmtLocalDate } from '@/utils/format';
import {
  WidgetConfig, Viz, Gran, FilterOp, OPS_BY_TYPE, OP_LABEL, VALUELESS, newWidget, SavedReportLite,
} from './types';

const VIZZES: [Viz, any, { en: string; ar: string }][] = [
  ['table', Table2, { en: 'Table', ar: 'جدول' }],
  ['bar', BarChart3, { en: 'Bar', ar: 'أعمدة' }],
  ['line', LineChart, { en: 'Line', ar: 'خطي' }],
  ['donut', PieChart, { en: 'Donut', ar: 'دائري' }],
  ['stat', Hash, { en: 'Stat', ar: 'رقم' }],
];
const GRANS: [Gran, { en: string; ar: string }][] = [
  ['none', { en: 'Total', ar: 'إجمالي' }], ['day', { en: 'Day', ar: 'يوم' }], ['week', { en: 'Week', ar: 'أسبوع' }], ['month', { en: 'Month', ar: 'شهر' }],
];

export function WidgetEditor({ initial, savedReports, dark, ar, onSave, onCancel }: {
  initial: WidgetConfig | null;
  savedReports: SavedReportLite[];
  dark: boolean; ar: boolean;
  onSave: (w: WidgetConfig) => void;
  onCancel: () => void;
}) {
  const L = (en: string, arv: string) => (ar ? arv : en);
  const [w, setW] = useState<WidgetConfig>(initial ?? newWidget());
  const [tab, setTab] = useState<'inline' | 'saved'>(initial?.savedReportId ? 'saved' : 'inline');
  const [picker, setPicker] = useState<null | 'dimension' | 'metric'>(null);

  const { sources } = useSources();
  const { detail } = useSourceDetail(w.sourceKey || null);

  const patch = (p: Partial<WidgetConfig>) => setW(prev => ({ ...prev, ...p }));

  const label = (o: { label_en: string; label_ar: string }) => (ar ? o.label_ar : o.label_en) || o.label_en;
  const dimByKey = useMemo(() => Object.fromEntries((detail?.dimensions ?? []).map(d => [d.key, d])), [detail]);
  const metByKey = useMemo(() => Object.fromEntries((detail?.metrics ?? []).map(m => [m.key, m])), [detail]);
  const pickerFields = useMemo<PickerField[]>(() => [
    ...(detail?.dimensions ?? []).map(d => ({ ...d, kind: 'dimension' as const, badge: d.badge ?? 'dimension' as const })),
    ...(detail?.metrics ?? []).map(m => ({ ...m, kind: 'metric' as const, badge: m.badge ?? 'metric' as const })),
  ], [detail]);

  const grouped = useMemo(() => {
    const g: Record<string, typeof sources> = {};
    for (const s of sources) (g[s.group] ??= []).push(s);
    return g;
  }, [sources]);

  const pickSource = (key: string) => {
    if (key === w.sourceKey) return;
    setW(prev => ({ ...prev, sourceKey: key, dimensions: [], metrics: [], filters: [], savedReportId: null }));
  };

  const loadFromSaved = async (id: string) => {
    const rep = savedReports.find(r => r.id === id);
    try {
      const r: any = await apiClient.get(`/report-builder-v2/saved-reports/${id}`);
      const cfg = r.data?.config ?? {};
      setW(prev => ({
        ...prev,
        title: prev.title && prev.title !== 'Untitled widget' ? prev.title : (rep?.name ?? r.data?.name ?? 'Widget'),
        sourceKey: r.data?.source_key ?? rep?.source_key ?? '',
        dimensions: cfg.dimensions ?? [], metrics: cfg.metrics ?? [], filters: cfg.filters ?? [],
        viz: (cfg.viz ?? r.data?.viz ?? 'table') as Viz, granularity: cfg.granularity ?? 'none',
        savedReportId: id,
      }));
    } catch { /* leave draft as-is */ }
  };

  /* filters */
  const addFilter = () => { const d = detail?.dimensions?.[0]; if (!d) return; patch({ filters: [...w.filters, { dim: d.key, op: (OPS_BY_TYPE[d.type ?? 'string'] ?? OPS_BY_TYPE.string)[0], value: '' }] }); };
  const setFilter = (i: number, p: Partial<{ dim: string; op: FilterOp; value: string }>) =>
    patch({ filters: w.filters.map((f, ix) => ix === i ? { ...f, ...p } : f) });
  const delFilter = (i: number) => patch({ filters: w.filters.filter((_, ix) => ix !== i) });

  const canSave = !!w.sourceKey && w.metrics.length > 0 && !!w.title.trim();

  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
  const inputStyle: React.CSSProperties = { padding: '7px 10px', borderRadius: 9, fontSize: 12, background: dark ? 'rgba(255,255,255,0.05)' : '#fff', border: `1px solid ${border}`, color: tp(dark), outline: 'none' };
  const chip = (active: boolean, color = '#6366f1'): React.CSSProperties => ({
    padding: '6px 11px', borderRadius: 9, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
    border: `1px solid ${active ? color + '80' : border}`, background: active ? `${color}22` : 'transparent', color: active ? color : ts(dark),
  });
  const secTitle = (en: string, arv: string) => (
    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: ts(dark), marginBottom: 6 }}>{L(en, arv)}</div>
  );

  // pinned-date picker value
  const pinVal: DateRangeValue = { dateFrom: w.pinnedDates?.dateFrom ?? '', dateTo: w.pinnedDates?.dateTo ?? '', timeFrom: '00:00', timeTo: '23:59', rolling: null };

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 68, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'} style={{
        width: 760, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        borderRadius: 18, overflow: 'hidden', background: dark ? '#0e1326' : '#fff', border: `1px solid ${border}`, boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: `1px solid ${border}` }}>
          <LayoutGrid size={16} style={{ color: '#8b5cf6' }} />
          <span style={{ fontSize: 14.5, fontWeight: 800, color: tp(dark) }}>{initial ? L('Edit widget', 'تعديل الأداة') : L('Add widget', 'إضافة أداة')}</span>
          <button onClick={onCancel} style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: ts(dark), display: 'flex' }}><X size={18} /></button>
        </div>

        {/* mode tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 18px 0' }}>
          <button onClick={() => setTab('inline')} style={chip(tab === 'inline', '#8b5cf6')}><Layers size={12} /> {L('Build inline', 'بناء مباشر')}</button>
          <button onClick={() => setTab('saved')} style={chip(tab === 'saved', '#6366f1')}><Bookmark size={12} /> {L('From saved report', 'من تقرير محفوظ')} {savedReports.length ? `(${savedReports.length})` : ''}</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {tab === 'saved' && (
            <div>
              {secTitle('Pick a saved report', 'اختر تقريراً محفوظاً')}
              {savedReports.length === 0 && <div style={{ fontSize: 12, color: ts(dark) }}>{L('No saved reports yet — build one in Report Builder, or switch to “Build inline”.', 'لا توجد تقارير محفوظة — أنشئ واحداً في منشئ التقارير أو استخدم «بناء مباشر».')}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {savedReports.map(r => (
                  <button key={r.id} onClick={() => loadFromSaved(r.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'start', padding: '10px 12px', borderRadius: 11, cursor: 'pointer',
                    border: `1px solid ${w.savedReportId === r.id ? '#6366f180' : border}`, background: w.savedReportId === r.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                  }}>
                    <Bookmark size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: tp(dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                      <span style={{ fontSize: 10.5, color: ts(dark) }}>{r.source_key}{r.shared ? ` · ${L('shared', 'مشترك')}` : ''}</span>
                    </span>
                    {w.savedReportId === r.id && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>{L('loaded', 'محمّل')}</span>}
                  </button>
                ))}
              </div>
              {w.savedReportId && <div style={{ fontSize: 11, color: ts(dark), marginTop: 8 }}>{L('You can still tweak the visualization, title and filters below.', 'يمكنك تعديل العرض والعنوان والفلاتر أدناه.')}</div>}
            </div>
          )}

          {tab === 'inline' && (
            <div>
              {secTitle('Data source', 'مصدر البيانات')}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {Object.entries(grouped).map(([grp, list]) => (
                  <div key={grp} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: ts(dark) }}>{grp}</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {list.map(s => <button key={s.key} onClick={() => pickSource(s.key)} style={chip(w.sourceKey === s.key, '#8b5cf6')}>{label(s)}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* fields (both modes, once a source is chosen) */}
          {w.sourceKey && detail && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                {secTitle('Group by (dimensions)', 'التجميع (الأبعاد)')}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
                  {w.dimensions.length === 0 && <span style={{ fontSize: 11, color: ts(dark) }}>{L('none — totals only', 'لا شيء — الإجمالي فقط')}</span>}
                  {w.dimensions.map(k => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.35)', color: '#818cf8' }}>
                      {label(dimByKey[k] ?? { label_en: k, label_ar: k })}
                      <X size={11} style={{ cursor: 'pointer' }} onClick={() => patch({ dimensions: w.dimensions.filter(x => x !== k) })} />
                    </span>
                  ))}
                </div>
                <button onClick={() => setPicker('dimension')} style={{ ...chip(false), borderStyle: 'dashed' }}><Plus size={11} /> {L('Add dimension', 'إضافة بُعد')}</button>
              </div>
              <div>
                {secTitle('Metrics *', 'المقاييس *')}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
                  {w.metrics.length === 0 && <span style={{ fontSize: 11, color: '#f59e0b' }}>{L('add at least one metric', 'أضف مقياساً واحداً على الأقل')}</span>}
                  {w.metrics.map(k => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)', color: '#22c55e' }}>
                      {label(metByKey[k] ?? { label_en: k, label_ar: k })}
                      <X size={11} style={{ cursor: 'pointer' }} onClick={() => patch({ metrics: w.metrics.filter(x => x !== k) })} />
                    </span>
                  ))}
                </div>
                <button onClick={() => setPicker('metric')} style={{ ...chip(false, '#22c55e'), borderStyle: 'dashed' }}><Plus size={11} /> {L('Add metric', 'إضافة مقياس')}</button>
              </div>
            </div>
          )}

          {/* filters */}
          {w.sourceKey && detail && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: w.filters.length ? 8 : 0 }}>
                <Filter size={13} style={{ color: ts(dark) }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: tp(dark) }}>{L('Filters', 'الفلاتر')}</span>
                <button onClick={addFilter} style={{ ...chip(false), marginInlineStart: 'auto' }}><Plus size={10} /> {L('Add filter', 'إضافة فلتر')}</button>
              </div>
              {w.filters.map((f, i) => {
                const dt = dimByKey[f.dim]?.type ?? 'string';
                const ops = OPS_BY_TYPE[dt] ?? OPS_BY_TYPE.string;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <select value={f.dim} onChange={e => { const nd = detail.dimensions.find(d => d.key === e.target.value)!; const nops = OPS_BY_TYPE[nd.type ?? 'string'] ?? OPS_BY_TYPE.string; setFilter(i, { dim: e.target.value, op: nops.includes(f.op) ? f.op : nops[0] }); }} style={inputStyle}>
                      {detail.dimensions.map(d => <option key={d.key} value={d.key}>{label(d)}</option>)}
                    </select>
                    <select value={f.op} onChange={e => setFilter(i, { op: e.target.value as FilterOp })} style={inputStyle}>
                      {ops.map(op => <option key={op} value={op}>{ar ? OP_LABEL[op].ar : OP_LABEL[op].en}</option>)}
                    </select>
                    {!VALUELESS.includes(f.op) && (
                      <input value={typeof f.value === 'string' ? f.value : (f.value ?? []).join(',')} onChange={e => setFilter(i, { value: e.target.value })}
                        placeholder={f.op === 'in' ? L('a, b, c', 'أ، ب، ج') : L('value', 'قيمة')} type={dt === 'date' ? 'date' : 'text'} style={{ ...inputStyle, minWidth: 130 }} />
                    )}
                    <button onClick={() => delFilter(i)} style={{ ...chip(false, '#ef4444'), padding: '6px' }}><X size={12} /></button>
                  </div>
                );
              })}
            </div>
          )}

          {/* presentation: title / viz / gran / span / pin */}
          {w.sourceKey && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4, borderTop: `1px solid ${border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: tp(dark), minWidth: 46 }}>{L('Title', 'العنوان')}</span>
                <input value={w.title} onChange={e => patch({ title: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 180 }} placeholder={L('Widget title', 'عنوان الأداة')} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: tp(dark), minWidth: 46 }}>{L('Viz', 'العرض')}</span>
                {VIZZES.map(([v, Ic, lb]) => <button key={v} onClick={() => patch({ viz: v })} style={{ ...chip(w.viz === v, '#8b5cf6'), padding: '7px 11px' }}><Ic size={13} /> {ar ? lb.ar : lb.en}</button>)}
              </div>

              {w.viz !== 'stat' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: tp(dark), minWidth: 46 }}>{L('Bucket', 'التقسيم')}</span>
                  {GRANS.map(([g, lb]) => <button key={g} onClick={() => patch({ granularity: g })} style={chip(w.granularity === g)}>{ar ? lb.ar : lb.en}</button>)}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11.5, color: tp(dark), fontWeight: 600 }}>
                  <input type="checkbox" checked={w.span === 2} onChange={e => patch({ span: e.target.checked ? 2 : 1 })} style={{ accentColor: '#8b5cf6' }} />
                  {L('Wide (full row)', 'عريض (صف كامل)')}
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11.5, color: tp(dark), fontWeight: 600 }}>
                  <input type="checkbox" checked={!!w.pinnedDates} onChange={e => patch({ pinnedDates: e.target.checked ? { dateFrom: pinVal.dateFrom || fmtLocalDate(new Date()), dateTo: pinVal.dateTo || fmtLocalDate(new Date()) } : null })} style={{ accentColor: '#f59e0b' }} />
                  {L('Pin own dates (ignore dashboard date)', 'تثبيت تاريخ خاص (تجاهل تاريخ اللوحة)')}
                </label>
                {w.pinnedDates && (
                  <DateRangePicker value={{ ...pinVal, dateFrom: w.pinnedDates.dateFrom, dateTo: w.pinnedDates.dateTo }} dark={dark} ar={ar}
                    onApply={v => patch({ pinnedDates: { dateFrom: v.dateFrom, dateTo: v.dateTo } })} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: `1px solid ${border}` }}>
          {!canSave && <span style={{ fontSize: 11, color: '#f59e0b', marginInlineEnd: 'auto' }}>{L('Pick a source, a metric and a title.', 'اختر مصدراً ومقياساً وعنواناً.')}</span>}
          <div style={{ marginInlineStart: canSave ? 'auto' : undefined, display: 'flex', gap: 8 }}>
            <NxBtn variant="ghost" dark={dark} onClick={onCancel}>{L('Cancel', 'إلغاء')}</NxBtn>
            <NxBtn color="#8b5cf6" dark={dark} onClick={() => canSave && onSave(w)} disabled={!canSave}>{initial ? L('Save changes', 'حفظ التعديلات') : L('Add widget', 'إضافة الأداة')}</NxBtn>
          </div>
        </div>
      </div>

      {/* field picker modal (over the editor) */}
      {picker && detail && (
        <FieldPicker
          fields={pickerFields}
          kindDefault={picker}
          initial={picker === 'dimension' ? w.dimensions : w.metrics}
          dark={dark} ar={ar}
          onCancel={() => setPicker(null)}
          onDone={selected => {
            const dimKeys = new Set((detail.dimensions ?? []).map(d => d.key));
            const metKeys = new Set((detail.metrics ?? []).map(m => m.key));
            const pickedDims = selected.filter(k => dimKeys.has(k));
            const pickedMets = selected.filter(k => metKeys.has(k) && !dimKeys.has(k));
            if (picker === 'dimension') {
              patch({ dimensions: pickedDims, ...(pickedMets.length ? { metrics: [...w.metrics, ...pickedMets.filter(k => !w.metrics.includes(k))] } : {}) });
            } else {
              patch({ metrics: pickedMets, ...(pickedDims.length ? { dimensions: [...w.dimensions, ...pickedDims.filter(k => !w.dimensions.includes(k))] } : {}) });
            }
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
