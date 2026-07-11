/**
 * DateRangePicker — Sprinklr-grade date-range popover for Builder v2.
 *
 * Left preset rail (Last 7/28/30/60/90/120/180 days, This/Last month,
 * This/Last year, Last 365, Lifetime, Custom Range) + dual-month calendar +
 * start/end time selects (30-min steps) + app timezone label + a
 * "Rolling range" toggle (honest label: the relative preset is re-evaluated
 * on every run) + Cancel/Apply.
 *
 * Emits { dateFrom, dateTo, timeFrom?, timeTo?, rolling?: { preset } }.
 * /run only consumes dateFrom/dateTo today — times + rolling are persisted in
 * the saved-report config for forward compatibility.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, Globe, RefreshCw } from 'lucide-react';
import { tp, ts, NxBtn } from '@/components/ds';

export type DateRangeValue = {
  dateFrom: string; dateTo: string;
  timeFrom?: string; timeTo?: string;
  rolling?: { preset: string } | null;
};

const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const RANGE_PRESETS: { id: string; en: string; ar: string; range: () => [string, string] }[] = (() => {
  const back = (n: number): [string, string] => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - (n - 1)); return [fmtD(s), fmtD(e)]; };
  const n = () => new Date();
  return [
    { id: 'last7',   en: 'Last 7 Days',   ar: 'آخر ٧ أيام',    range: () => back(7) },
    { id: 'last28',  en: 'Last 28 Days',  ar: 'آخر ٢٨ يوماً',  range: () => back(28) },
    { id: 'last30',  en: 'Last 30 Days',  ar: 'آخر ٣٠ يوماً',  range: () => back(30) },
    { id: 'last60',  en: 'Last 60 Days',  ar: 'آخر ٦٠ يوماً',  range: () => back(60) },
    { id: 'last90',  en: 'Last 90 Days',  ar: 'آخر ٩٠ يوماً',  range: () => back(90) },
    { id: 'last120', en: 'Last 120 Days', ar: 'آخر ١٢٠ يوماً', range: () => back(120) },
    { id: 'last180', en: 'Last 180 Days', ar: 'آخر ١٨٠ يوماً', range: () => back(180) },
    { id: 'thisMonth', en: 'This Month', ar: 'هذا الشهر', range: () => [fmtD(new Date(n().getFullYear(), n().getMonth(), 1)), fmtD(n())] },
    { id: 'lastMonth', en: 'Last Month', ar: 'الشهر الماضي', range: () => [fmtD(new Date(n().getFullYear(), n().getMonth() - 1, 1)), fmtD(new Date(n().getFullYear(), n().getMonth(), 0))] },
    { id: 'thisYear', en: 'This Year', ar: 'هذه السنة', range: () => [fmtD(new Date(n().getFullYear(), 0, 1)), fmtD(n())] },
    { id: 'lastYear', en: 'Last Year', ar: 'السنة الماضية', range: () => [`${n().getFullYear() - 1}-01-01`, `${n().getFullYear() - 1}-12-31`] },
    { id: 'last365', en: 'Last 365 Days', ar: 'آخر ٣٦٥ يوماً', range: () => back(365) },
    { id: 'lifetime', en: 'Lifetime', ar: 'كل الفترة', range: () => ['2020-01-01', fmtD(n())] },
  ];
})();

export function presetById(id: string) { return RANGE_PRESETS.find(p => p.id === id) ?? null; }

/* 30-min time options 00:00 … 23:30, plus 23:59 */
const TIME_OPTS = [...Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`), '23:59'];

/* ── one month grid (Saturday-start WFM week) ── */
function MonthGrid({ view, lo, hi, dark, ar, onPick, onHover }: {
  view: Date; lo: string | null; hi: string | null; dark: boolean; ar: boolean;
  onPick: (iso: string) => void; onHover: (iso: string | null) => void;
}) {
  const HEAD = ar ? ['سبت', 'أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع'] : ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];
  const lead = (new Date(view.getFullYear(), view.getMonth(), 1).getDay() + 1) % 7;
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);
  const today = fmtD(new Date());
  return (
    <div style={{ width: 224 }}>
      <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 800, color: tp(dark), marginBottom: 6 }}>
        {view.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>
        {HEAD.map((h, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: ts(dark) }}>{h}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }} onMouseLeave={() => onHover(null)}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = fmtD(d);
          const edge = iso === lo || iso === hi;
          const inR = !!(lo && hi && iso > lo && iso < hi);
          return (
            <button key={i} onMouseEnter={() => onHover(iso)} onClick={() => onPick(iso)} style={{
              aspectRatio: '1 / 1', borderRadius: edge ? 8 : (inR ? 3 : 8), fontSize: 11, cursor: 'pointer', border: 'none',
              fontWeight: edge ? 800 : (iso === today ? 700 : 500), fontVariantNumeric: 'tabular-nums',
              background: edge ? '#6366f1' : (inR ? 'rgba(99,102,241,0.16)' : 'transparent'),
              color: edge ? '#fff' : (inR ? '#a5b4fc' : (iso === today ? '#818cf8' : tp(dark))),
              outline: iso === today && !edge ? '1px dashed rgba(99,102,241,0.5)' : 'none', transition: 'background .12s',
            }}>{d.getDate()}</button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ value, dark, ar, onApply }: {
  value: DateRangeValue; dark: boolean; ar: boolean;
  onApply: (v: DateRangeValue) => void;
}) {
  const L = (en: string, arv: string) => (ar ? arv : en);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /* draft state (committed on Apply) */
  const [presetId, setPresetId] = useState<string>(value.rolling?.preset ?? 'custom');
  const [from, setFrom] = useState(value.dateFrom);
  const [to, setTo] = useState(value.dateTo);
  const [tFrom, setTFrom] = useState(value.timeFrom ?? '00:00');
  const [tTo, setTTo] = useState(value.timeTo ?? '23:59');
  const [rolling, setRolling] = useState(!!value.rolling);
  const [hover, setHover] = useState<string | null>(null);
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const [view, setView] = useState(() => { const d = new Date(value.dateFrom + 'T00:00:00'); return isNaN(+d) ? new Date() : new Date(d.getFullYear(), d.getMonth(), 1); });

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

  useEffect(() => {
    if (!open) return;
    setPresetId(value.rolling?.preset ?? 'custom'); setFrom(value.dateFrom); setTo(value.dateTo);
    setTFrom(value.timeFrom ?? '00:00'); setTTo(value.timeTo ?? '23:59'); setRolling(!!value.rolling); setPicking('start');
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]); // eslint-disable-line

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presetById(id);
    if (p) { const [f, t] = p.range(); setFrom(f); setTo(t); setView(new Date(new Date(f + 'T00:00:00').getFullYear(), new Date(f + 'T00:00:00').getMonth(), 1)); }
    if (id === 'custom') setRolling(false);
  };
  const pick = (iso: string) => {
    setPresetId('custom'); setRolling(false);
    if (picking === 'start') { setFrom(iso); setTo(iso); setPicking('end'); }
    else { if (iso >= from) setTo(iso); else { setTo(from); setFrom(iso); } setPicking('start'); }
  };
  const lo = picking === 'end' && hover ? (hover < from ? hover : from) : from;
  const hi = picking === 'end' && hover ? (hover >= from ? hover : from) : to;

  const commit = () => {
    onApply({ dateFrom: from, dateTo: to, timeFrom: tFrom, timeTo: tTo, rolling: rolling && presetId !== 'custom' ? { preset: presetId } : null });
    setOpen(false);
  };

  const activePreset = presetById(value.rolling?.preset ?? '');
  const pillLabel = activePreset
    ? `${ar ? activePreset.ar : activePreset.en} · ${value.dateFrom} → ${value.dateTo}`
    : `${value.dateFrom} → ${value.dateTo}`;

  const selStyle: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 8, fontSize: 11.5, outline: 'none',
    background: dark ? 'rgba(255,255,255,0.05)' : '#fff', border: `1px solid ${border}`, color: tp(dark),
  };
  const nextView = new Date(view.getFullYear(), view.getMonth() + 1, 1);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {/* the prominent pill */}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 22, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        background: dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)',
        border: `1px solid ${open ? '#6366f1' : 'rgba(99,102,241,0.35)'}`, color: dark ? '#c7d2fe' : '#4338ca',
      }}>
        <CalendarDays size={14} />
        {pillLabel}
        {value.rolling && <RefreshCw size={11} style={{ opacity: .8 }} />}
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 65, marginTop: 6, insetInlineStart: 0, width: 720, maxWidth: '94vw',
          borderRadius: 16, overflow: 'hidden', background: dark ? '#0e1326' : '#fff',
          border: `1px solid ${border}`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexWrap: 'wrap',
        }}>
          {/* preset rail */}
          <div style={{ width: 168, flexShrink: 0, padding: 10, borderInlineEnd: `1px solid ${border}`, maxHeight: 380, overflowY: 'auto' }}>
            {[...RANGE_PRESETS, { id: 'custom', en: 'Custom Range', ar: 'نطاق مخصّص', range: null as any }].map(p => {
              const active = presetId === p.id;
              return (
                <button key={p.id} onClick={() => applyPreset(p.id)} style={{
                  display: 'block', width: '100%', textAlign: 'start', padding: '7px 10px', borderRadius: 8, marginBottom: 1,
                  border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500,
                  background: active ? 'rgba(99,102,241,0.15)' : 'transparent', color: active ? '#818cf8' : tp(dark),
                }}>{ar ? p.ar : p.en}</button>
              );
            })}
          </div>

          {/* calendars + times */}
          <div style={{ flex: 1, minWidth: 320, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, position: 'relative', justifyContent: 'center' }}>
              <button onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1))} style={{ position: 'absolute', insetInlineStart: 0, top: 0, width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', border: `1px solid ${border}`, background: 'transparent', color: ts(dark), cursor: 'pointer' }}>
                {ar ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
              <MonthGrid view={view} lo={lo} hi={hi} dark={dark} ar={ar} onPick={pick} onHover={setHover} />
              <MonthGrid view={nextView} lo={lo} hi={hi} dark={dark} ar={ar} onPick={pick} onHover={setHover} />
              <button onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1))} style={{ position: 'absolute', insetInlineEnd: 0, top: 0, width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', border: `1px solid ${border}`, background: 'transparent', color: ts(dark), cursor: 'pointer' }}>
                {ar ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>

            {/* start/end date + time row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
              {([['start', from, setFrom, tFrom, setTFrom], ['end', to, setTo, tTo, setTTo]] as const).map(([which, d, setD, t, setT]) => (
                <div key={which} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: ts(dark) }}>
                    {which === 'start' ? L('Start', 'البداية') : L('End', 'النهاية')}
                  </span>
                  <input type="date" value={d} onChange={e => { setD(e.target.value); setPresetId('custom'); setRolling(false); }} style={selStyle} />
                  <Clock size={11} style={{ color: ts(dark) }} />
                  <select value={t} onChange={e => setT(e.target.value)} style={selStyle}>
                    {TIME_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* rolling + timezone + actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: presetId === 'custom' ? 'not-allowed' : 'pointer', opacity: presetId === 'custom' ? .45 : 1 }}>
                <input type="checkbox" checked={rolling} disabled={presetId === 'custom'} onChange={e => setRolling(e.target.checked)} style={{ accentColor: '#6366f1' }} />
                <span style={{ fontSize: 11, color: tp(dark), fontWeight: 600 }}>{L('Rolling range', 'نطاق متحرك')}</span>
                <span style={{ fontSize: 10, color: ts(dark) }}>{L('(preset re-evaluated on each run)', '(يُعاد احتساب النطاق عند كل تشغيل)')}</span>
              </label>
              <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: ts(dark) }}>
                <Globe size={11} /> {L('Timezone', 'المنطقة الزمنية')}: {tz}
              </span>
              <NxBtn variant="ghost" size="sm" dark={dark} onClick={() => setOpen(false)}>{L('Cancel', 'إلغاء')}</NxBtn>
              <NxBtn size="sm" color="#6366f1" dark={dark} onClick={commit}>{L('Apply', 'تطبيق')}</NxBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
