/**
 * BUILDER v2 · BLD-4 — DRILL MODAL.
 *
 * Given ONE aggregated cell (a run-result row / a bar / a widget data-point), this
 * modal calls POST /report-builder-v2/drill and shows the UNDERLYING un-aggregated
 * rows behind that cell — the source's raw dimension columns + each metric's per-row
 * base (which sums back to the aggregate). Shared by ReportBuilder and the Dashboard
 * widgets. Theme-aware (dark flag), AR/EN + RTL, with the same client-side CSV export.
 *
 * The client only ever sends catalog KEYS (dim/metric) and $N-bound VALUES; the
 * backend re-applies the source allowlist + RBAC + agent self-scope.
 */
import { useEffect, useMemo, useState } from 'react';
import { Layers, X, Download, ChevronRight } from 'lucide-react';
import { apiClient } from '@/api/client';
import { card, tp, ts, NxLoading, NxEmpty, NxError, NxBtn } from '@/components/ds';

export type DrillGran = 'none' | 'day' | 'week' | 'month';
export type DrillColumn = { key: string; label_en: string; label_ar: string; kind: 'dimension' | 'metric'; type?: string; format?: string; time?: boolean };
export type DrillRunFilter = { dim: string; op: string; value?: any };

/** A fully-formed drill request + the labels naming the cell (for the header). */
export type DrillRequest = {
  sourceKey: string;
  cell: { dim: string; value: any }[];
  period: { granularity: DrillGran; value: any } | null;
  metrics: string[];
  filters: DrillRunFilter[];
  dateFrom: string;
  dateTo: string;
  /** {label, value} pairs describing the clicked cell, for the modal header */
  cellLabels: { label: string; value: string }[];
};

type DrillResult = { sourceKey: string; columns: DrillColumn[]; rowCount: number; truncated?: boolean; rows: any[] };

/** value formatter — same rules as the builder's fmtCell/fmtVal */
function fmtCell(v: any, col: DrillColumn): string {
  if (v == null || v === '') return '—';
  if (col.kind === 'dimension' || col.time) return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  switch (col.format) {
    case 'hours':   return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
    case 'minutes': return `${n.toLocaleString()} m`;
    case 'pct':
    case 'percent': return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'count':
    case 'number':  return n.toLocaleString();
    default:        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

export function DrillModal({ request, dark, ar, onClose }: {
  request: DrillRequest; dark: boolean; ar: boolean; onClose: () => void;
}) {
  const L = (en: string, arv: string) => (ar ? arv : en);
  const label = (o: { label_en: string; label_ar: string }) => (ar ? o.label_ar : o.label_en);

  const [result, setResult] = useState<DrillResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchDrill = () => {
    setLoading(true); setErr(null);
    apiClient.post('/report-builder-v2/drill', {
      sourceKey: request.sourceKey,
      cell: request.cell,
      period: request.period,
      metrics: request.metrics,
      filters: request.filters,
      dateFrom: request.dateFrom, dateTo: request.dateTo,
    })
      .then((r: any) => setResult(r.data))
      .catch((e: any) => setErr(e?.response?.data?.message || 'drill'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchDrill, []); // eslint-disable-line

  // close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const exportCsv = () => {
    if (!result?.rows?.length) return;
    const cols = result.columns;
    const esc = (s: any) => { const v = s == null ? '' : String(s); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const head = cols.map(c => esc(label(c))).join(',');
    const body = result.rows.map(row => cols.map(c => esc(fmtCell(row[c.key], c) === '—' ? '' : row[c.key])).join(',')).join('\n');
    const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `drill_${request.sourceKey}_${request.dateFrom}_${request.dateTo}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const cellLabels = useMemo(() => request.cellLabels.filter(c => c.value !== '' && c.value != null), [request]);

  return (
    <div onClick={onClose} dir={ar ? 'rtl' : 'ltr'}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'ds-fadein .2s ease' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ ...card(dark), width: 'min(920px, 96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
        {/* header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Layers size={16} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: tp(dark) }}>{L('Underlying rows', 'الصفوف الأساسية')}</div>
            <div style={{ fontSize: 11, color: ts(dark), display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {cellLabels.length === 0 && <span>{L('Grand total', 'الإجمالي الكلي')}</span>}
              {cellLabels.map((c, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {i > 0 && <ChevronRight size={11} style={{ opacity: 0.5 }} />}
                  <span style={{ color: ts(dark) }}>{c.label}</span>
                  <span style={{ fontWeight: 700, color: tp(dark), padding: '1px 7px', borderRadius: 7, background: 'rgba(99,102,241,0.14)' }}>{c.value}</span>
                </span>
              ))}
              <span style={{ marginInlineStart: 6, opacity: 0.8 }}>· {request.dateFrom} → {request.dateTo}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {result && result.rows.length > 0 &&
              <NxBtn icon={Download} variant="outline" size="sm" color="#22c55e" dark={dark} onClick={exportCsv}>{L('CSV', 'CSV')}</NxBtn>}
            <button onClick={onClose} aria-label="close" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'transparent', border: `1px solid ${border}`, color: ts(dark) }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* body */}
        <div style={{ flex: 1, minHeight: 120, overflow: 'auto' }}>
          {loading && <NxLoading dark={dark} ar={ar} />}
          {!loading && err && <div style={{ padding: 18 }}><NxError onRetry={fetchDrill} dark={dark} ar={ar} /></div>}
          {!loading && !err && result && result.rows.length === 0 && (
            <NxEmpty ar={ar} dark={dark} title="No underlying rows" titleAr="لا توجد صفوف أساسية"
              desc="This cell has no raw rows for the current filters." descAr="لا توجد صفوف خام لهذه الخلية ضمن الفلاتر الحالية." />
          )}
          {!loading && !err && result && result.rows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: dark ? '#11162a' : '#f8fafc' }}>
                <tr>
                  {result.columns.map((c, i) => (
                    <th key={c.key} style={{ padding: '9px 14px', textAlign: i === 0 ? 'start' : 'end', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: c.kind === 'metric' ? '#22c55e' : ts(dark), whiteSpace: 'nowrap' }}>
                      {label(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, ri) => (
                  <tr key={ri} style={{ borderTop: `1px solid ${border}` }}>
                    {result.columns.map((c, ci) => (
                      <td key={c.key} style={{ padding: '8px 14px', textAlign: ci === 0 ? 'start' : 'end', color: ci === 0 ? tp(dark) : (c.kind === 'metric' ? tp(dark) : ts(dark)), fontWeight: ci === 0 ? 600 : (c.kind === 'metric' ? 700 : 400), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {fmtCell(r[c.key], c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* footer */}
        {!loading && !err && result && (
          <div style={{ padding: '9px 16px', borderTop: `1px solid ${border}`, fontSize: 11, color: ts(dark), display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{result.rowCount.toLocaleString()} {L('rows', 'صف')}</span>
            {result.truncated && <span style={{ color: '#f59e0b', fontWeight: 700 }}>· {L('showing first 500 — refine filters to see the rest', 'عرض أول ٥٠٠ — حسّن الفلاتر لرؤية الباقي')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Build a DrillRequest from a run-result ROW. `dimCols`/`metCols` come from the run
 * result columns; `period` cells route to a bucket filter, all other dims to equality.
 */
export function drillRequestFromRow(opts: {
  sourceKey: string;
  columns: DrillColumn[];
  row: any;
  granularity: DrillGran;
  filters: DrillRunFilter[];
  dateFrom: string;
  dateTo: string;
  ar: boolean;
}): DrillRequest {
  const { sourceKey, columns, row, granularity, filters, dateFrom, dateTo, ar } = opts;
  const dimCols = columns.filter(c => c.kind === 'dimension');
  const metrics = columns.filter(c => c.kind === 'metric').map(c => c.key);
  const cell: { dim: string; value: any }[] = [];
  let period: DrillRequest['period'] = null;
  const cellLabels: { label: string; value: string }[] = [];
  const lbl = (c: DrillColumn) => (ar ? c.label_ar : c.label_en);

  for (const c of dimCols) {
    const raw = row[c.key];
    if (c.key === 'period') {
      period = { granularity, value: raw };
      cellLabels.push({ label: lbl(c), value: raw == null ? '—' : String(raw) });
    } else {
      cell.push({ dim: c.key, value: raw });
      cellLabels.push({ label: lbl(c), value: raw == null || raw === '' ? '—' : String(raw) });
    }
  }
  return { sourceKey, cell, period, metrics, filters, dateFrom, dateTo, cellLabels };
}
