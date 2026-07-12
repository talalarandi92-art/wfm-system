/**
 * Dashboard Composer — theme-aware viz renderers shared by widget cards and the
 * editor preview. Colours come from CSS variables (--surface / --border /
 * --text-1/2/3) so one component renders correctly in all three themes.
 */
import { RunResult, RunColumn, fmtVal, CHART_COLORS } from './types';

const labelOf = (o: { label_en: string; label_ar: string }, ar: boolean) => (ar ? o.label_ar : o.label_en) || o.label_en;

/* ── compact result table ── */
export function WidgetTable({ result, ar, maxRows = 200 }: { result: RunResult; ar: boolean; maxRows?: number }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: 320 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-2)' }}>
          <tr>
            {result.columns.map((c, i) => (
              <th key={c.key} style={{ padding: '8px 12px', textAlign: i === 0 ? 'start' : 'end', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: c.kind === 'metric' ? '#22c55e' : 'var(--text-3)', whiteSpace: 'nowrap' }}>
                {labelOf(c, ar)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, maxRows).map((r, ri) => (
            <tr key={ri} style={{ borderTop: '1px solid var(--border)' }}>
              {result.columns.map((c, ci) => (
                <td key={c.key} style={{ padding: '7px 12px', textAlign: ci === 0 ? 'start' : 'end', color: ci === 0 ? 'var(--text-1)' : (c.kind === 'metric' ? 'var(--text-1)' : 'var(--text-2)'), fontWeight: ci === 0 ? 600 : (c.kind === 'metric' ? 700 : 400), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {fmtVal(r[c.key], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > maxRows && (
        <div style={{ padding: '6px 12px', fontSize: 10.5, color: 'var(--text-3)' }}>
          {ar ? `عرض أول ${maxRows} من ${result.rowCount}` : `Showing first ${maxRows} of ${result.rowCount.toLocaleString()}`}
        </div>
      )}
    </div>
  );
}

/* ── minimal theme-aware line chart ── */
export function WidgetLine({ pts }: { pts: { label: string; value: number }[] }) {
  const W = 560, H = 200, pad = 26;
  const max = Math.max(1, ...pts.map(p => p.value));
  const x = (i: number) => pad + (pts.length <= 1 ? 0 : (i * (W - pad * 2)) / (pts.length - 1));
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const step = Math.ceil(pts.length / 12);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ minWidth: 320 }}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
        <path d={d} fill="none" stroke="#6366f1" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={3} fill="#6366f1" />
            {i % step === 0 && (
              <text x={x(i)} y={H - pad + 13} textAnchor="middle" fontSize={8.5} fill="var(--text-3)">
                {p.label.length > 8 ? p.label.slice(0, 8) : p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** derive {dimCol, metCol, pts} from a run result for bar/line/donut */
export function chartData(result: RunResult) {
  const dimCol = result.columns.find(c => c.kind === 'dimension') as RunColumn | undefined;
  const metCol = result.columns.find(c => c.kind === 'metric') as RunColumn | undefined;
  if (!dimCol || !metCol) return null;
  const pts = result.rows.slice(0, 24).map((r, i) => ({
    label: String(r[dimCol.key] ?? '—'), value: Number(r[metCol.key]) || 0, color: CHART_COLORS[i % CHART_COLORS.length],
  }));
  return { dimCol, metCol, pts, max: Math.max(1, ...pts.map(p => p.value)) };
}
