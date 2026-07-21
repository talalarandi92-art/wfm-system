/**
 * WEEK QUALITY STRIP — per-day staffed-vs-required chips for the Schedule grid.
 *
 * Reads GET /roster-v2/schedule-quality?from&to via useMaybe(): renders NOTHING
 * until the endpoint is live (hide-on-404 — the grid loses nothing today, and
 * gains the demand context automatically when the backend agent lands).
 */
import { Scale } from 'lucide-react';
import { useMaybe, normalizeQuality, gapHue, fmtDayShort, SPAL, nfmt } from './kit';

export default function WeekQualityStrip({ from, to, dates, ar }: {
  from: string; to: string; dates: string[]; ar: boolean;
}) {
  const q = useMaybe<unknown>(`/roster-v2/schedule-quality?from=${from}&to=${to}`);
  if (q.status !== 'live') return null;
  const quality = normalizeQuality(q.data);
  if (!quality || !quality.perDay.length) return null;

  const byDate = new Map(quality.perDay.map(d => [d.date, d]));
  const shown = dates.filter(d => byDate.has(d));
  if (!shown.length) return null;

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-2 flex-wrap card dark:bg-white/[0.03]">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider me-1"
        style={{ color: 'var(--text-3)' }}>
        <Scale size={12} style={{ color: SPAL.required }} />
        {ar ? 'مجدول / مطلوب' : 'Staffed / required'}
      </span>
      {shown.map(d => {
        const day = byDate.get(d)!;
        const color = gapHue(day.gap);
        const tip = ar
          ? `${fmtDayShort(d, true)} — مجدول ${day.staffed ?? '—'} · مطلوب ${day.required ?? '—'} · ${day.gap > 0 ? `عجز ${day.gap}` : day.gap < 0 ? `فائض ${-day.gap}` : 'مغطى'}`
          : `${fmtDayShort(d, false)} — staffed ${day.staffed ?? '—'} · required ${day.required ?? '—'} · ${day.gap > 0 ? `short ${day.gap}` : day.gap < 0 ? `surplus ${-day.gap}` : 'covered'}`;
        return (
          <span key={d} title={tip}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10.5px] font-bold tabular-nums"
            style={{ background: `${color}12`, color, border: `1px solid ${color}35` }}>
            <span className="font-semibold opacity-80">{fmtDayShort(d, ar)}</span>
            {day.staffed != null && day.required != null
              ? <span>{nfmt(day.staffed)}<span className="opacity-60"> / {nfmt(day.required)}</span></span>
              : <span>{day.gap > 0 ? `−${nfmt(day.gap)}` : day.gap < 0 ? `+${nfmt(-day.gap)}` : '✓'}</span>}
          </span>
        );
      })}
      <span className="text-[9px] ms-auto" style={{ color: 'var(--text-3)' }}>
        {ar ? 'المصدر: /roster-v2/schedule-quality' : 'source: /roster-v2/schedule-quality'}
      </span>
    </div>
  );
}
