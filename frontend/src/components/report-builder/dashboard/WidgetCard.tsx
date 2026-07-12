/**
 * Dashboard Composer — a single widget card.
 *
 * Each card runs ITS OWN POST /report-builder-v2/run with the effective date
 * window (its pin overrides the dashboard cascade) and effective filters (its
 * own filters + the dashboard function filter, but only where the widget's
 * source actually carries a `function` dimension). Loading / empty / error are
 * fully isolated: a failed widget shows a retry card and never breaks the page.
 *
 * Viz: table · bar · line · donut · stat (stat renders <Kpi> with provenance).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Pencil, X, Pin, PinOff, AlertTriangle, Database, Maximize2, Minimize2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { BarRow, Donut } from '@/components/dazzle';
import { Kpi } from '@/components/kpi';
import { useSourceDetail } from './sourceCatalog';
import { WidgetTable, WidgetLine, chartData } from './viz';
import {
  WidgetConfig, RunResult, Gran, VALUELESS, fmtVal, CHART_COLORS, effectiveDates,
} from './types';

const GRAN_LABEL: Record<Gran, { en: string; ar: string }> = {
  none: { en: 'Total', ar: 'إجمالي' }, day: { en: 'Day', ar: 'يوم' }, week: { en: 'Week', ar: 'أسبوع' }, month: { en: 'Month', ar: 'شهر' },
};

export function WidgetCard({ widget, dashDate, dashFunc, mode, dark, ar, onEdit, onRemove, onChange }: {
  widget: WidgetConfig;
  dashDate: { dateFrom: string; dateTo: string };
  dashFunc: string;
  mode: 'edit' | 'view';
  dark: boolean; ar: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<WidgetConfig>) => void;
}) {
  const L = (en: string, arv: string) => (ar ? arv : en);
  const { detail } = useSourceDetail(widget.sourceKey || null);
  const hasFunctionDim = useMemo(() => !!detail?.dimensions?.some(d => d.key === 'function'), [detail]);

  const eff = effectiveDates(widget, dashDate);
  const effFunc = hasFunctionDim ? dashFunc : '';

  const [result, setResult] = useState<RunResult | null>(null);
  const [spark, setSpark] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);

  const buildFilters = useCallback(() => {
    const own = (widget.filters ?? []).filter(f => f.dim && (VALUELESS.includes(f.op) || (f.value !== '' && f.value != null)));
    const casc = effFunc ? [{ dim: 'function', op: 'eq' as const, value: effFunc }] : [];
    return [...own, ...casc];
  }, [widget.filters, effFunc]);

  const run = useCallback(() => {
    if (!widget.sourceKey || widget.metrics.length === 0) { setResult(null); setSpark(null); return; }
    const id = ++runId.current;
    setLoading(true); setErr(null);
    const isStat = widget.viz === 'stat';
    // stat headline = totals-only for a correct aggregate (percent metrics don't average)
    const body = {
      sourceKey: widget.sourceKey,
      dimensions: isStat ? [] : widget.dimensions,
      metrics: widget.metrics,
      filters: buildFilters(),
      dateFrom: eff.dateFrom, dateTo: eff.dateTo,
      granularity: isStat ? 'none' : widget.granularity,
      limit: 5000,
    };
    apiClient.post('/report-builder-v2/run', body)
      .then((r: any) => {
        if (id !== runId.current) return;
        setResult(r.data); setLoading(false);
        // stat sparkline (best-effort, non-blocking): daily series of the first metric
        if (isStat) {
          apiClient.post('/report-builder-v2/run', { ...body, dimensions: [], granularity: 'day', limit: 400 })
            .then((s: any) => {
              if (id !== runId.current) return;
              const mCol = (s.data?.columns ?? []).find((c: any) => c.kind === 'metric');
              const series = mCol ? (s.data.rows ?? []).map((row: any) => Number(row[mCol.key]) || 0) : [];
              setSpark(series.length >= 2 ? series : null);
            })
            .catch(() => { if (id === runId.current) setSpark(null); });
        } else setSpark(null);
      })
      .catch((e: any) => {
        if (id !== runId.current) return;
        setErr(e?.response?.data?.message || L('Run failed', 'فشل التشغيل')); setResult(null); setSpark(null); setLoading(false);
      });
  }, [widget.sourceKey, widget.dimensions, widget.metrics, widget.viz, widget.granularity, buildFilters, eff.dateFrom, eff.dateTo]); // eslint-disable-line

  useEffect(() => { run(); }, [run, nonce]);

  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const iconBtn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer',
    background: 'transparent', border: `1px solid ${border}`, color: 'var(--text-3)',
  };

  /* ── body renderer (viz-specific, isolated) ── */
  const renderBody = () => {
    if (loading && !result) return <Center><Spinner /></Center>;
    if (err) return (
      <Center>
        <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
          <AlertTriangle size={20} style={{ color: '#ef4444', marginBottom: 6 }} />
          <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{err}</div>
          <button onClick={() => setNonce(n => n + 1)} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'none', cursor: 'pointer' }}>{L('Retry', 'إعادة')}</button>
        </div>
      </Center>
    );
    if (!widget.sourceKey || widget.metrics.length === 0)
      return <Center><Muted>{L('Configure this widget — pick a source & metric.', 'اضبط هذه الأداة — اختر مصدراً ومقياساً.')}</Muted></Center>;
    if (!result || result.rows.length === 0)
      return <Center><Muted>{L('No data for this range/filters.', 'لا توجد بيانات لهذا النطاق/الفلاتر.')}</Muted></Center>;

    if (widget.viz === 'stat') {
      const mCol = result.columns.find(c => c.kind === 'metric');
      const raw = mCol ? result.rows[0]?.[mCol.key] : null;
      const accent = CHART_COLORS[0];
      return (
        <div style={{ padding: 4 }}>
          <Kpi
            label={mCol ? (ar ? mCol.label_ar : mCol.label_en) : widget.title}
            value={fmtVal(raw, mCol)}
            accent={accent}
            spark={spark ?? undefined}
            source={{
              endpoint: 'POST /api/v1/report-builder-v2/run',
              table: widget.sourceKey,
              definition: mCol ? (ar ? mCol.label_ar : mCol.label_en) : widget.title,
              period: `${eff.dateFrom} → ${eff.dateTo}`,
            }}
          />
        </div>
      );
    }

    if (widget.viz === 'table') return <WidgetTable result={result} ar={ar} />;

    const c = chartData(result);
    if (!c) return <Center><Muted>{L('Add a dimension to chart this data.', 'أضف بُعداً لعرض هذه البيانات كرسم.')}</Muted></Center>;
    const metLabel = ar ? c.metCol.label_ar : c.metCol.label_en;
    if (widget.viz === 'donut')
      return <div style={{ padding: 6 }}><Donut segments={c.pts} centerNum={c.pts.reduce((a, p) => a + p.value, 0)} centerLabel={metLabel} /></div>;
    if (widget.viz === 'line')
      return <div style={{ padding: 6 }}><WidgetLine pts={c.pts} /></div>;
    // bar
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '6px 4px' }}>
        {c.pts.map((p, i) => <BarRow key={i} label={p.label} value={p.value} max={c.max} color={p.color} delay={i * 30} />)}
      </div>
    );
  };

  const pinned = !!widget.pinnedDates;

  return (
    <div style={{
      gridColumn: widget.span === 2 ? '1 / -1' : undefined,
      display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden',
      background: 'var(--surface)', border: `1px solid ${border}`, boxShadow: dark ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
      minHeight: 140,
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${border}` }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{widget.title}</div>
          <div style={{ fontSize: 9.5, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <Database size={9} /> {detail ? (ar ? detail.label_ar : detail.label_en) : widget.sourceKey || '—'}
            {pinned && <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 2 }}><Pin size={9} /> {eff.dateFrom} → {eff.dateTo}</span>}
            {loading && result && <RefreshCw size={9} style={{ animation: 'ds-spin .7s linear infinite' }} />}
          </div>
        </div>

        {mode === 'edit' && widget.viz !== 'stat' && (
          <select value={widget.granularity} onChange={e => onChange({ granularity: e.target.value as Gran })}
            title={L('Bucket', 'التقسيم')}
            style={{ fontSize: 10.5, padding: '3px 6px', borderRadius: 7, background: dark ? 'rgba(255,255,255,0.05)' : '#fff', border: `1px solid ${border}`, color: 'var(--text-2)', cursor: 'pointer', outline: 'none' }}>
            {(['none', 'day', 'week', 'month'] as Gran[]).map(g => <option key={g} value={g}>{ar ? GRAN_LABEL[g].ar : GRAN_LABEL[g].en}</option>)}
          </select>
        )}

        <button onClick={() => setNonce(n => n + 1)} title={L('Refresh', 'تحديث')} style={iconBtn}><RefreshCw size={12} /></button>

        {mode === 'edit' && <>
          <button
            onClick={() => onChange({ pinnedDates: pinned ? null : { dateFrom: eff.dateFrom, dateTo: eff.dateTo } })}
            title={pinned ? L('Unpin (follow dashboard date)', 'إلغاء التثبيت') : L('Pin dates (ignore dashboard date)', 'تثبيت التاريخ')}
            style={{ ...iconBtn, color: pinned ? '#f59e0b' : 'var(--text-3)', borderColor: pinned ? '#f59e0b55' : border }}>
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
          <button onClick={() => onChange({ span: widget.span === 2 ? 1 : 2 })} title={widget.span === 2 ? L('Narrow', 'تضييق') : L('Widen', 'توسيع')} style={iconBtn}>
            {widget.span === 2 ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button onClick={onEdit} title={L('Edit', 'تعديل')} style={{ ...iconBtn, color: '#6366f1', borderColor: '#6366f155' }}><Pencil size={12} /></button>
          <button onClick={onRemove} title={L('Remove', 'حذف')} style={{ ...iconBtn, color: '#ef4444', borderColor: '#ef444455' }}><X size={12} /></button>
        </>}
      </div>

      {/* body */}
      <div style={{ flex: 1, padding: widget.viz === 'table' ? 0 : '10px 12px', minHeight: 0 }}>
        {renderBody()}
      </div>
    </div>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', placeItems: 'center', minHeight: 120, padding: 16 }}>{children}</div>
);
const Muted = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center', maxWidth: 240 }}>{children}</div>
);
const Spinner = () => (
  <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1', animation: 'ds-spin .7s linear infinite' }} />
);
