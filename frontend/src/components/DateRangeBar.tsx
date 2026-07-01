/**
 * DateRangeBar — a reusable, theme-aware date-range control for the WHOLE system.
 *
 *   <DateRangeBar from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t);}} fullRange={data?.range} />
 *
 * Renders: a single-calendar range picker (pick start → end in one popup, with range
 * highlight + month nav) + quick preset chips (Today / Yesterday / This week / Last week /
 * Last 7 / Last 30 / This month / Last month / All). Saturday-start WFM week. Reads the
 * language from the UI store, so pages just pass from/to/onChange.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';

const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ── Single-calendar range picker ── */
function RangeCalendar({ from, to, ar, onApply }: { from: string; to: string; ar: boolean; onApply: (f: string, t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [selStart, setSelStart] = useState<string | null>(from);
  const [selEnd, setSelEnd] = useState<string | null>(to);
  const [hover, setHover] = useState<string | null>(null);
  const parse = (s: string) => { const d = new Date(s + 'T00:00:00'); return isNaN(+d) ? new Date() : d; };
  const [view, setView] = useState(() => { const d = parse(from); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelStart(from); setSelEnd(to); }, [from, to]);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const disp = (s: string) => { const d = parse(s); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const HEAD = ar ? ['سبت', 'أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع'] : ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];
  const monthLabel = view.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' });
  const lead = (new Date(view.getFullYear(), view.getMonth(), 1).getDay() + 1) % 7;
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);
  const click = (d: Date) => {
    const iso = fmtD(d);
    if (!selStart || (selStart && selEnd)) { setSelStart(iso); setSelEnd(null); }
    else if (iso >= selStart) { setSelEnd(iso); onApply(selStart, iso); setOpen(false); }
    else setSelStart(iso);
  };
  const e2 = selEnd || hover;
  const [lo, hi] = !selStart ? [null, null] : (!e2 ? [selStart, selStart] : (selStart <= e2 ? [selStart, e2] : [e2, selStart]));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{ background: 'var(--surface-2)', border: `1px solid ${open ? '#6366f1' : 'var(--border)'}`, color: 'var(--text-1)' }}>
        <CalendarDays size={14} style={{ color: '#818cf8' }} />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{disp(from)} <span style={{ color: 'var(--text-3)' }}>→</span> {disp(to)}</span>
        <ChevronDown size={13} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 p-3 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 16px 44px rgba(0,0,0,0.4)', width: 272, insetInlineStart: 0 }}>
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1))} className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}><ChevronRight size={15} /></button>
            <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{monthLabel}</span>
            <button onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1))} className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}><ChevronLeft size={15} /></button>
          </div>
          <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>
            {HEAD.map((h, i) => <div key={i} className="text-center" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-3)' }}>{h}</div>)}
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7,1fr)' }} onMouseLeave={() => setHover(null)}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const iso = fmtD(d);
              const edge = iso === lo || iso === hi;
              const inR = !!(lo && hi && iso >= lo && iso <= hi);
              return (
                <button key={i} onMouseEnter={() => setHover(iso)} onClick={() => click(d)}
                  style={{ aspectRatio: '1 / 1', borderRadius: edge ? 9 : (inR ? 4 : 9), fontSize: 11, fontWeight: edge ? 800 : 500, fontVariantNumeric: 'tabular-nums', cursor: 'pointer', border: 'none',
                    background: edge ? '#6366f1' : (inR ? 'rgba(99,102,241,0.16)' : 'transparent'), color: edge ? '#fff' : (inR ? '#a5b4fc' : 'var(--text-2)'), transition: 'background .12s' }}>{d.getDate()}</button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2.5 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{selStart && !selEnd ? (ar ? '↩ اختر تاريخ النهاية' : '↩ pick end date') : (ar ? 'اختر تاريخ البداية' : 'pick start date')}</span>
            <button onClick={() => { const t = fmtD(new Date()); onApply(t, t); setOpen(false); }} className="text-[11px] font-semibold" style={{ color: '#818cf8' }}>{ar ? 'اليوم' : 'Today'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DateRangeBar({ from, to, onChange, fullRange, presets = true }: {
  from: string; to: string; onChange: (f: string, t: string) => void;
  fullRange?: { a?: string | null; b?: string | null }; presets?: boolean;
}) {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const satOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 1) % 7)); return x; };
  const chips: { k: string; l: string; r: () => [string, string] }[] = [
    { k: 'today', l: ar ? 'اليوم' : 'Today', r: () => { const s = fmtD(new Date()); return [s, s]; } },
    { k: 'yesterday', l: ar ? 'أمس' : 'Yesterday', r: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = fmtD(d); return [s, s]; } },
    { k: 'thisWeek', l: ar ? 'هذا الأسبوع' : 'This week', r: () => { const s = satOf(new Date()); const e = new Date(s); e.setDate(e.getDate() + 6); return [fmtD(s), fmtD(e)]; } },
    { k: 'lastWeek', l: ar ? 'الأسبوع الماضي' : 'Last week', r: () => { const s = satOf(new Date()); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return [fmtD(s), fmtD(e)]; } },
    { k: 'last7', l: ar ? 'آخر ٧ أيام' : 'Last 7 days', r: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 6); return [fmtD(s), fmtD(e)]; } },
    { k: 'last30', l: ar ? 'آخر ٣٠ يوم' : 'Last 30 days', r: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 29); return [fmtD(s), fmtD(e)]; } },
    { k: 'thisMonth', l: ar ? 'هذا الشهر' : 'This month', r: () => { const n = new Date(); return [fmtD(new Date(n.getFullYear(), n.getMonth(), 1)), fmtD(new Date(n.getFullYear(), n.getMonth() + 1, 0))]; } },
    { k: 'lastMonth', l: ar ? 'الشهر الماضي' : 'Last month', r: () => { const n = new Date(); return [fmtD(new Date(n.getFullYear(), n.getMonth() - 1, 1)), fmtD(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
    ...(fullRange?.a && fullRange?.b ? [{ k: 'all', l: ar ? 'الكل' : 'All', r: () => [fullRange.a as string, fullRange.b as string] as [string, string] }] : []),
  ];
  const active = chips.find(p => { const [f, t] = p.r(); return f === from && t === to; })?.k;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RangeCalendar from={from} to={to} ar={ar} onApply={onChange} />
      {presets && chips.map(p => { const on = active === p.k; return (
        <button key={p.k} onClick={() => { const [f, t] = p.r(); onChange(f, t); }} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: on ? '#6366f1' : 'var(--surface-2)', color: on ? '#fff' : 'var(--text-2)', border: `1px solid ${on ? '#6366f1' : 'var(--border)'}`, boxShadow: on ? '0 4px 12px rgba(99,102,241,0.35)' : 'none', transition: 'all .15s' }}>{p.l}</button>
      ); })}
    </div>
  );
}
