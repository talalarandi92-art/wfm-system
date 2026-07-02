import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Search, Download, Home, Building2, UserX, ArrowRight, Upload, BarChart3,
  ChevronRight, ChevronDown, ChevronLeft, CalendarDays, Clock, ShieldCheck, AlertTriangle,
  LogOut, FileSpreadsheet, UserCog, StickyNote, Timer, Wrench, LayoutDashboard, GitCompareArrows, BarChart4, UserSearch, Flame,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile, Donut, Gauge, BarRow, Sparkline, useReducedMotion } from '@/components/dazzle';

interface Row {
  employee_no: string; name: string; function_name: string; date: string; day_name: string;
  status: string; presence: 'office'|'wfh'|'absent'|'leave'|'off'|'holiday'|'present';
  punch_in_min: number|null; punch_out_min: number|null; sys_login_min: number|null; sys_logout_min: number|null;
  login_src: string|null; late_min: number; early_min: number; ot_min: number;
  offday_ot_min?: number|null; holiday_ot_min?: number|null; total_ot?: number|null; data_quality?: string|null;
  permission: string|null; permission_type?: string|null; permission_duration?: string|null; comp_off: string|null; sick: string|null; conforming: boolean|null;
  shift_code: string|null; shift_start_min: number|null; shift_end_min: number|null;
  attendance_code?: string|null; hr_code?: string|null; shift_category?: string|null; daily_note?: string|null;
  username?: string|null; total_work_sys_min?: number|null; sys_login2_min?: number|null; sys_logout2_min?: number|null;
  sys_late_min: number; sys_early_min: number; adherence_pct: number|null; mismatch: string|null;
  team_manager: string|null; team_group: string|null; gender: string|null; worked_min: number|null; note: string|null;
}
interface OtFn { fn: string; ot_h: number; offday_h: number; ot_days: number; }
interface Resp { from: string; to: string; total: number; limit: number; offset: number; summary: any; range?: { a: string|null; b: string|null }; otByFunction?: OtFn[]; dailyTrend?: { date: string; conformance: number|null; present: number }[]; shiftCodes?: string[]; rows: Row[]; }

const hhmm = (m: number | null | undefined) => { if (m == null) return '—'; const t=((m%1440)+1440)%1440; let h=Math.floor(t/60); const mm=t%60; const ap=h<12?'AM':'PM'; h=h%12||12; return `${h}:${String(mm).padStart(2,'0')} ${ap}`; };
const dur = (m: number | null) => { if (!m || m<=0) return '—'; const h=Math.floor(m/60), mm=m%60; return h?`${h}h ${mm}m`:`${mm}m`; };
// total span between an in and out, cross-midnight aware (out < in ⇒ next day)
const span = (a: number|null|undefined, b: number|null|undefined): number|null => { if (a==null||b==null) return null; let d=b-a; if (d<0) d+=1440; return d; };
// friendly status label from the code/category (canonical §3 map) — bilingual
const NW_LABEL: Record<string,{en:string;ar:string}> = {
  H:{en:'Official Holiday',ar:'عطلة رسمية'}, L:{en:'Annual Leave',ar:'إجازة سنوية'}, AL:{en:'Annual Leave',ar:'إجازة سنوية'},
  SL:{en:'Sick Leave',ar:'إجازة مرضية'}, S:{en:'Sick Leave',ar:'إجازة مرضية'}, A:{en:'Absent',ar:'غياب'},
  DL:{en:'Death Leave',ar:'إجازة وفاة'}, UPL:{en:'Unpaid Leave',ar:'إجازة بدون راتب'}, COMP:{en:'Comp Day',ar:'يوم بدل'},
  OFF:{en:'Day Off',ar:'يوم راحة'}, RES:{en:'Resignation',ar:'استقالة'}, TER:{en:'Termination',ar:'إنهاء خدمة'}, TRANSFER:{en:'Transfer',ar:'نقل'},
};
const statusLabel = (r: Row): { en: string; ar: string } | null => {
  const hr = String(r.hr_code || '').toUpperCase().trim();              // authoritative marker (e.g. annual-leave-on-holiday → 'H')
  const code = String(r.shift_code || r.attendance_code || r.hr_code || '').toUpperCase().trim();
  const base = code.replace(/^WFH[-_]?/, '').replace(/[-_]?WFH$/, '');
  const cat = String(r.shift_category || '').toLowerCase();
  // non-working state comes from hr_code first (so an L overridden to H by the holiday rule reads as Holiday)
  if (hr && NW_LABEL[hr]) return NW_LABEL[hr];
  if (r.sick) return NW_LABEL.SL;
  // working shift → category (shift_code keeps the category even when hr_code='WFH')
  if (['MD','MN','MDR','MNR'].includes(base) || cat==='midnight') return { en:'Midnight Shift', ar:'دوام منتصف الليل' };
  if (['N','N20'].includes(base) || cat==='night') return { en:'Night Shift', ar:'دوام ليلي' };
  if (['E','EE20','E20'].includes(base) || cat==='evening') return { en:'Evening Shift', ar:'دوام مسائي' };
  if (['M','AM','B','C','M20','B20','C20','M7-3','B7','C7'].includes(base) || cat==='morning' || cat==='day') return { en:'Morning Shift', ar:'دوام صباحي' };
  if (NW_LABEL[base]) return NW_LABEL[base];
  if (r.presence==='off') return NW_LABEL.OFF;
  if (r.presence==='absent') return NW_LABEL.A;
  if (r.presence==='holiday' || /holiday/i.test(r.status||'')) return NW_LABEL.H;
  return null;
};
// derive the weekday from the date itself, so the day name is ALWAYS shown even when the DB column is null
const DOW_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const dayAbbr = (d?: string | null) => { if (!d) return ''; const dt = new Date(d + 'T00:00:00Z'); return isNaN(+dt) ? '' : DOW_ABBR[dt.getUTCDay()]; };
const dayFull = (d?: string | null) => { if (!d) return ''; const dt = new Date(d + 'T00:00:00Z'); return isNaN(+dt) ? '' : DOW_FULL[dt.getUTCDay()]; };
const adhColor = (v: number | null) => v == null ? '#64748b' : v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';
const PRES: Record<string,{ar:string;en:string;c:string}> = {
  office:{ar:'مكتب',en:'Office',c:'#22c55e'}, wfh:{ar:'WFH',en:'WFH',c:'#06b6d4'}, off:{ar:'أوف',en:'Off',c:'#64748b'},
  leave:{ar:'إجازة',en:'Leave',c:'#8b5cf6'}, sick:{ar:'سيك',en:'Sick',c:'#f59e0b'}, absent:{ar:'غياب',en:'Absent',c:'#f43f5e'}, holiday:{ar:'عطلة',en:'Holiday',c:'#a855f7'}, present:{ar:'حاضر',en:'Present',c:'#22c55e'},
};
const PER = 40;

/* ── Month heatmap — a calendar grid coloured by daily conformance, sized by present count ── */
function HeatCell({ d, color, maxPres, ar, reduced, delay, onPick }: {
  d: { date: string; conformance: number | null; present: number };
  color: string; maxPres: number; ar: boolean; reduced: boolean; delay: number; onPick: (from: string, to: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const [rdy, setRdy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRdy(true), reduced ? 0 : delay); return () => clearTimeout(t); }, [delay, reduced]);
  const day = Number(d.date.slice(8, 10));
  const presPct = Math.round(100 * (d.present || 0) / maxPres);
  const conf = d.conformance;
  return (
    <div onClick={() => onPick(d.date, d.date)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      title={`${d.date} · ${ar ? 'كونفورمانس' : 'conformance'} ${conf ?? '—'}% · ${ar ? 'حاضر' : 'present'} ${d.present}`}
      style={{
        position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, cursor: 'pointer', minHeight: 42,
        background: `${color}${hov ? '3a' : '1f'}`, border: `1px solid ${color}${hov ? '99' : '44'}`,
        opacity: rdy ? 1 : 0, transform: hov ? 'translateY(-3px) scale(1.05)' : (rdy ? 'none' : 'scale(.85)'),
        boxShadow: hov ? `0 10px 22px ${color}44` : 'none',
        transition: 'opacity .35s ease, transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, background .2s, border-color .2s',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 5px', overflow: 'hidden',
      }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{day}</span>
      <div>
        <div style={{ fontSize: 9, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{conf != null ? conf + '%' : '—'}</div>
        <div style={{ height: 3, borderRadius: 2, marginTop: 2, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: rdy ? `${presPct}%` : '0%', background: color, borderRadius: 2, transition: reduced ? 'none' : 'width .8s cubic-bezier(.4,0,.2,1)' }} />
        </div>
      </div>
    </div>
  );
}
function MonthHeatmap({ trend, ar, onPick }: {
  trend: { date: string; conformance: number | null; present: number }[]; ar: boolean; onPick: (from: string, to: string) => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('roster_heatmap_open') !== '0'; } catch { return true; } });
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem('roster_heatmap_open', n ? '1' : '0'); } catch { /* */ } return n; });
  const days = (trend || []).filter(d => d.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 3) return null;
  const colOf = (iso: string) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 1) % 7; // Sat=0 … Fri=6 (WFM week starts Sat)
  const maxPres = Math.max(1, ...days.map(d => d.present || 0));
  const heat = (v: number | null) => v == null ? '#64748b' : v >= 95 ? '#22c55e' : v >= 85 ? '#06b6d4' : v >= 70 ? '#f59e0b' : '#f43f5e';
  const cells: (typeof days[0] | null)[] = [];
  for (let i = 0; i < colOf(days[0].date); i++) cells.push(null);
  for (const d of days) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (typeof days[0] | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const HEAD = ar ? ['سبت', 'أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع'] : ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const withConf = days.filter(d => d.conformance != null);
  const avg = withConf.length ? Math.round(withConf.reduce((a, d) => a + (d.conformance || 0), 0) / withConf.length) : 0;
  const best = withConf.slice().sort((a, b) => (b.conformance || 0) - (a.conformance || 0))[0];
  const worst = withConf.slice().sort((a, b) => (a.conformance || 0) - (b.conformance || 0))[0];
  return (
    <div className="rounded-2xl p-4 relative overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="absolute -top-12 -inline-end-10 w-44 h-44 rounded-full" style={{ background: '#6366f1', opacity: 0.08, filter: 'blur(46px)', pointerEvents: 'none' }} />
      <div onClick={toggle} title={ar ? 'اضغط للطي أو الفتح' : 'click to collapse / expand'}
        className="flex items-center justify-between flex-wrap gap-2 relative" style={{ cursor: 'pointer', marginBottom: open ? 12 : 0, transition: 'margin .3s ease' }}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}><CalendarDays size={17} className="text-white" /></div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'خريطة الشهر — الكونفورمانس اليومي' : 'Month heatmap — daily conformance'}</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{open ? (ar ? 'كل خانة يوم · اللون = الكونفورمانس · الشريط = الحضور · اضغط لفلترة اليوم' : 'each cell = a day · colour = conformance · bar = present · click a day to filter') : (ar ? 'مطويّة — اضغط للفتح' : 'collapsed — click to expand')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-end">
            <div className="text-2xl font-extrabold leading-none" style={{ color: heat(avg), fontVariantNumeric: 'tabular-nums' }}>{avg}%</div>
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ar ? 'متوسط الفترة' : 'period avg'}</div>
          </div>
          <div style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-2)', flexShrink: 0, transition: 'transform .3s ease', transform: open ? 'rotate(0deg)' : (ar ? 'rotate(90deg)' : 'rotate(-90deg)') }}>
            <ChevronDown size={16} />
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: reduced ? 'none' : 'grid-template-rows .35s ease, opacity .3s ease', opacity: open ? 1 : 0, overflow: 'hidden' }}>
       <div style={{ minHeight: 0, overflow: 'hidden' }}>
      <div className="grid gap-1.5 mb-1.5" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>
        {HEAD.map((h, i) => <div key={i} className="text-center" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{h}</div>)}
      </div>
      <div className="space-y-1.5">
        {weeks.map((w, wi) => (
          <div key={wi} className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>
            {w.map((d, di) => d == null
              ? <div key={di} style={{ aspectRatio: '1 / 1', minHeight: 42 }} />
              : <HeatCell key={di} d={d} color={heat(d.conformance)} maxPres={maxPres} ar={ar} reduced={reduced} delay={(wi * 7 + di) * 16} onPick={onPick} />)}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {([['≥95', '#22c55e'], ['85–94', '#06b6d4'], ['70–84', '#f59e0b'], ['<70', '#f43f5e']] as [string, string][]).map(([lab, c], i) => (
            <span key={i} className="flex items-center gap-1" style={{ fontSize: 10, color: 'var(--text-3)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{lab}%</span>
          ))}
        </div>
        {best && worst && (
          <div className="flex items-center gap-3" style={{ fontSize: 10.5 }}>
            <span style={{ color: 'var(--text-3)' }}>{ar ? 'أفضل' : 'best'} <b style={{ color: '#22c55e' }}>{best.date.slice(5)} · {best.conformance}%</b></span>
            <span style={{ color: 'var(--text-3)' }}>{ar ? 'أضعف' : 'worst'} <b style={{ color: '#f43f5e' }}>{worst.date.slice(5)} · {worst.conformance}%</b></span>
          </div>
        )}
      </div>
       </div>
      </div>
    </div>
  );
}

/* ── Single-calendar date-range picker — pick start THEN end in one popup, with range highlight ── */
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
  const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export default function RosterPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const nav = useNavigate();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [presence, setPresence] = useState('');
  const [shift, setShift] = useState('');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-06-30');
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true); setOpenKey(null);
    const p = new URLSearchParams({ from, to, sort, limit: String(PER), offset: String(page*PER) });
    if (q) p.set('q', q); if (presence) p.set('presence', presence); if (shift) p.set('shift', shift);
    apiClient.get(`/attendance-recon/roster-v2?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [q, presence, shift, from, to, sort, page]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [q, presence, shift, from, to, sort]);

  const editNote = async (r: Row) => {
    const note = window.prompt(ar ? `ملاحظة المدير لـ ${r.name} (${r.date}):` : `Manager note — ${r.name} (${r.date}):`, r.note || '');
    if (note === null) return;
    try {
      await apiClient.put('/attendance-recon/roster-v2/note', { employeeNo: r.employee_no, date: r.date, note });
      setData(d => d ? { ...d, rows: d.rows.map(x => (x.employee_no===r.employee_no && x.date===r.date) ? { ...x, note } : x) } : d);
    } catch { /* */ }
  };

  const dl = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
  const [exporting, setExporting] = useState(false);
  const exportCSV = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // fetch the FULL filtered range (every matching day across from→to), not just the visible page
      const p = new URLSearchParams({ from, to, sort, limit: '50000', offset: '0' });
      if (q) p.set('q', q); if (presence) p.set('presence', presence); if (shift) p.set('shift', shift);
      let rows: Row[] = data?.rows || [];
      try { const r: any = await apiClient.get(`/attendance-recon/roster-v2?${p}`); if (r.data?.rows) rows = r.data.rows; } catch { /* fall back to current page */ }
      const h = ['Date','Day','Emp No','Name','Function','Team','Team Mgr','Gender','Presence','Shift','Shift Start','Shift End','Punch In','Punch Out','Sys Login','Sys Logout','Src','Worked(min)','Sys Late(min)','Early Out(min)','OT(min)','Adherence%','Mismatch','Permission','Comp Off','Sick','Note'];
      const csvRows = rows.map(r => [r.date, r.day_name || dayFull(r.date), r.employee_no, r.name, r.function_name, r.team_group, r.team_manager, r.gender, r.presence, r.shift_code, hhmm(r.shift_start_min), hhmm(r.shift_end_min), hhmm(r.punch_in_min), hhmm(r.punch_out_min), hhmm(r.sys_login_min), hhmm(r.sys_logout_min), r.login_src, r.worked_min, r.sys_late_min, r.sys_early_min, r.ot_min, r.adherence_pct, r.mismatch, r.permission, r.comp_off, r.sick, r.note]);
      dl(new Blob(['﻿'+[h,...csvRows].map(rr=>rr.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'}), `roster_${from}_${to}.csv`);
    } finally { setExporting(false); }
  };
  const hrMatrix = async () => {
    try { const r: any = await apiClient.get(`/attendance-recon/roster-v2/hr-matrix?from=${from}&to=${to}`, { responseType: 'blob' }); dl(r.data, `hr-matrix_${from}_${to}.csv`); } catch { /* */ }
  };
  // Upload = run the CORRECTED engine from inside the system. Files (CC Schedule / Odoo /
  // Permissions / Ameyo / Sprinklr) replace the engine inputs, then foundation→engine→ingest
  // rebuilds roster_days. Every rule lives in the engine, so each rebuild re-applies them all.
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    if (!confirm(ar
      ? 'تشغيل المحرّك المصحّح وإعادة بناء الروستر من هذه الملفات؟\nيطبّق كل القواعد المتفق عليها (عطلة/سيك/غياب/أوفر تايم...) وقابل للتراجع.'
      : 'Run the corrected engine and rebuild the roster from these files?\nRe-applies every agreed rule (holiday/sick/absence/OT…) and is reversible.')) { if (e.target) e.target.value = ''; return; }
    const fd = new FormData(); Array.from(files).forEach(f => fd.append('files', f));
    setUploading(true);
    try {
      const r: any = await apiClient.post('/attendance-recon/recon-refresh', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 });
      const d = r.data || {};
      if (d.ok) {
        const rs = d.roster || {};
        alert((ar ? '✓ تمت إعادة البناء بالمحرّك المصحّح\n' : '✓ Rebuilt with the corrected engine\n')
          + (rs.rows ? `${rs.rows} ${ar ? 'صف' : 'rows'} · ${rs.people} ${ar ? 'موظف' : 'people'} · ${rs.from}→${rs.to} · OT ${rs.ot_hours}h` : '')
          + (d.saved?.length ? `\n${ar ? 'ملفات محدّثة:' : 'Updated:'} ${d.saved.map((s: any) => s.role).join(', ')}` : '')
          + (d.unmatched?.length ? `\n${ar ? '⚠ غير معروفة:' : '⚠ Unmatched:'} ${d.unmatched.join(', ')}` : ''));
        load();
      } else {
        alert((ar ? 'فشلت إعادة البناء:\n' : 'Rebuild failed:\n') + (d.error || '') + '\n' + (d.log || ''));
      }
    } catch { alert(ar ? 'فشل الرفع/البناء' : 'Upload/rebuild failed'); }
    finally { setUploading(false); if (e.target) e.target.value = ''; }
  };

  const s = data?.summary;
  const pageCount = Math.ceil((data?.total || 0) / PER);
  const conf = s && s.conformance_pct != null ? Number(s.conformance_pct) : null;
  const cards = useMemo(() => s ? [
    { ic: CalendarDays, l: ar?'أيام':'Days', num: s.days as number|null, suffix:'', c:'#6366f1', to: undefined as string|undefined },
    { ic: ShieldCheck, l: ar?'كونفورمانس':'Conformance', num: conf, suffix:'%', c: adhColor(conf), to: undefined },
    { ic: Timer, l: ar?'ساعات عمل':'Worked hrs', num: s.worked_hours as number|null, suffix:'', c:'#10b981', to: undefined },
    { ic: Flame, l: ar?'أوفر تايم':'Overtime', num: s.ot_hours as number|null, suffix: ar?'س':'h', c:'#f97316', to:'/ot-exceptions' },
    { ic: Clock, l: ar?'تأخير سيستم':'Sys late', num: s.late_days as number|null, suffix:'', c:'#f59e0b', to: undefined },
    { ic: LogOut, l: ar?'خروج مبكر':'Early out', num: s.early_days as number|null, suffix:'', c:'#f59e0b', to: undefined },
    { ic: AlertTriangle, l: ar?'عدم تطابق':'Mismatch', num: s.mismatches as number|null, suffix:'', c:'#f43f5e', to:'/data-quality' },
    { ic: Building2, l: ar?'مكتب':'Office', num: s.office as number|null, suffix:'', c:'#22c55e', to: undefined },
    { ic: Home, l: 'WFH', num: s.wfh as number|null, suffix:'', c:'#06b6d4', to: undefined },
  ] : [], [s, ar, conf]);
  // presence composition for the donut — segments sum to days exactly (uncategorized → Other)
  const presSegs = useMemo(() => {
    if (!s) return [];
    const segs = [
      { label: ar?'مكتب':'Office',  value: s.office||0, color:'#22c55e' },
      { label: 'WFH',               value: s.wfh||0,    color:'#06b6d4' },
      { label: ar?'أوف':'Off',      value: s.off||0,    color:'#64748b' },
      { label: ar?'إجازة':'Leave',  value: s.leave||0,  color:'#8b5cf6' },
      { label: ar?'غياب':'Absent',  value: s.absent||0, color:'#f43f5e' },
    ];
    const other = Math.max(0, (s.days||0) - segs.reduce((a,c)=>a+c.value,0));
    if (other > 0) segs.push({ label: ar?'أخرى/عطلة':'Other/Holiday', value: other, color:'#475569' });
    return segs;
  }, [s, ar]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs outline-none focus:border-indigo-400';
  const inputStyle = { color: 'var(--text-1)', background: 'var(--surface-2)', border: '1px solid var(--border)' } as React.CSSProperties;
  const presColor = (p: string) => PRES[p]?.c || '#64748b';
  const btn = (extra: string) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${extra}`;

  // quick date presets — pick a whole range in ONE click (relative to today), no more two-input juggling
  const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // WFM week starts SATURDAY → the Saturday on/before a given date
  const satOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 1) % 7)); return x; };
  const datePresets: { k: string; l: string; r: () => [string, string] }[] = [
    { k: 'today', l: ar ? 'اليوم' : 'Today', r: () => { const s = fmtD(new Date()); return [s, s]; } },
    { k: 'yesterday', l: ar ? 'أمس' : 'Yesterday', r: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = fmtD(d); return [s, s]; } },
    { k: 'thisWeek', l: ar ? 'هذا الأسبوع' : 'This week', r: () => { const s = satOf(new Date()); const e = new Date(s); e.setDate(e.getDate() + 6); return [fmtD(s), fmtD(e)]; } },
    { k: 'lastWeek', l: ar ? 'الأسبوع الماضي' : 'Last week', r: () => { const s = satOf(new Date()); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return [fmtD(s), fmtD(e)]; } },
    { k: 'last7', l: ar ? 'آخر ٧ أيام' : 'Last 7 days', r: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 6); return [fmtD(s), fmtD(e)]; } },
    { k: 'last30', l: ar ? 'آخر ٣٠ يوم' : 'Last 30 days', r: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 29); return [fmtD(s), fmtD(e)]; } },
    { k: 'thisMonth', l: ar ? 'هذا الشهر' : 'This month', r: () => { const n = new Date(); return [fmtD(new Date(n.getFullYear(), n.getMonth(), 1)), fmtD(new Date(n.getFullYear(), n.getMonth() + 1, 0))]; } },
    { k: 'lastMonth', l: ar ? 'الشهر الماضي' : 'Last month', r: () => { const n = new Date(); return [fmtD(new Date(n.getFullYear(), n.getMonth() - 1, 1)), fmtD(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
    { k: 'all', l: ar ? 'الكل' : 'All', r: () => [data?.range?.a || from, data?.range?.b || to] },
  ];
  const activePreset = datePresets.find(p => { const [f, t] = p.r(); return f === from && t === to; })?.k;
  const applyPreset = (p: { r: () => [string, string] }) => { const [f, t] = p.r(); setFrom(f); setTo(t); };

  return (
    <div className="space-y-4 page-enter">
      {/* header + actions — gradient hero band, theme-safe */}
      <div className="rounded-3xl p-4 relative overflow-hidden flex items-center justify-between flex-wrap gap-3" style={{ background:'linear-gradient(135deg, rgba(99,102,241,0.13), rgba(139,92,246,0.06) 55%, transparent)', border:'1px solid var(--border)' }}>
        <div className="absolute -top-10 -inline-end-8 w-44 h-44 rounded-full" style={{ background:'#6366f1', opacity:0.12, filter:'blur(48px)', pointerEvents:'none' }} />
        <div className="flex items-center gap-3 relative">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 8px 22px rgba(99,102,241,0.4)' }}><Users size={22} className="text-white" /></div>
          <div>
            <h1 className="text-lg font-bold" style={{ color:'var(--text-1)' }}>{ar?'الروستر — الدمج والتسوية':'Roster — Shifts & Reconciliation'}</h1>
            <p className="text-xs" style={{ color:'var(--text-3)' }}>{ar?'بصمة أودو + Ameyo + Sprinklr مدموجة، مقابل الشفت المجدوَل':'Odoo punch + Ameyo + Sprinklr combined, vs the scheduled shift'}</p>
            {(() => { const tr = (data?.dailyTrend||[]).map(d=>d.conformance).filter((v):v is number => v!=null); return tr.length>=2 ? (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color:'var(--text-3)' }}>{ar?'اتجاه الكونفورمانس':'Conformance trend'}</span>
                <div className="w-32 sm:w-44"><Sparkline data={tr} color={adhColor(conf)} height={24} /></div>
                {conf!=null && <span className="text-xs font-bold" style={{ color: adhColor(conf) }}>{conf}%</span>}
              </div>
            ) : null; })()}
          </div>
        </div>
        {/* (2026-07-02) trimmed: the sibling report pages are now TABS of the Roster hub —
            only cross-hub jumps + actions stay here. */}
        <div className="flex items-center gap-2 relative">
          <button onClick={() => nav('/wfm-overview')} className={btn('text-white')} style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(6,182,212,0.3))', color:'#c7d2fe' }}><LayoutDashboard size={13} />{ar?'النظرة التنفيذية':'Overview'}</button>
          <button onClick={() => nav('/capacity?tab=intervals')} className={btn('')} style={{ background:'rgba(6,182,212,0.16)', color:'#67e8f9' }}><BarChart4 size={13} />{ar?'هيدكاونت بالفترات':'Intervals'}</button>
          <button onClick={() => nav('/scorecard?tab=agent360')} className={btn('')} style={{ background:'rgba(139,92,246,0.18)', color:'#c4b5fd' }}><UserSearch size={13} />{ar?'ملف 360':'Agent 360'}</button>
          <button onClick={hrMatrix} className={btn('')} style={{ background:'rgba(139,92,246,0.18)', color:'#c4b5fd' }}><FileSpreadsheet size={13} />HR Matrix</button>
          <button onClick={() => fileRef.current?.click()} title={ar?'ارفع ملفات الشهر (CC Schedule / أودو / استئذانات / Ameyo / Sprinklr) → يشتغل المحرّك المصحّح ويعيد بناء الروستر بكل القواعد المتفق عليها':'Upload the month sources (CC Schedule / Odoo / Permissions / Ameyo / Sprinklr) → runs the corrected engine and rebuilds the roster with every agreed rule'} className={btn('')} style={{ background:'rgba(16,185,129,0.16)', color:'#34d399' }}><Upload size={13} />{uploading?(ar?'جارٍ البناء…':'Rebuilding…'):(ar?'رفع وإعادة بناء':'Upload & Rebuild')}</button>
          <input ref={fileRef} type="file" multiple hidden onChange={onUpload} accept=".xlsx,.xls,.xlsm,.csv" />
          <button onClick={exportCSV} disabled={exporting} title={ar?'تصدير كامل النطاق المحدّد (كل الأيام، مش الصفحة فقط)':'Export the full selected range (all days, not just this page)'} className={btn('')} style={{ background:'rgba(34,197,94,0.18)', color:'#22c55e' }}><Download size={13} />{exporting?(ar?'جارٍ…':'Exporting…'):(ar?'تصدير الكل':'Export all')}</button>
        </div>
      </div>

      {/* filters */}
      <div className="p-3 rounded-2xl space-y-2.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        {/* quick date presets — ONE click sets the whole range (no more picking two inputs) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide me-1" style={{ color:'var(--text-3)' }}>{ar?'اختصار سريع':'Quick range'}</span>
          {datePresets.map(p => { const on = activePreset===p.k; return (
            <button key={p.k} onClick={()=>applyPreset(p)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style={{ background: on?'#6366f1':'var(--surface-2)', color: on?'#fff':'var(--text-2)', border:`1px solid ${on?'#6366f1':'var(--border)'}`, boxShadow: on?'0 4px 12px rgba(99,102,241,0.35)':'none', transition:'all .15s' }}>{p.l}</button>
          ); })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <RangeCalendar from={from} to={to} ar={ar} onApply={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <Search size={14} className="text-slate-400" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder={ar?'بحث بالاسم أو الرقم أو اليوزر…':'Name, employee no, or User ID…'} className={`${inputCls} flex-1`} style={inputStyle} />
        </div>
        <select value={presence} onChange={e=>setPresence(e.target.value)} className={inputCls} style={inputStyle}>
          <option value="">{ar?'كل الحالات':'All presence'}</option>
          {Object.entries(PRES).filter(([k])=>['office','wfh','off','leave','sick','absent','holiday'].includes(k)).map(([k,v])=><option key={k} value={k}>{ar?v.ar:v.en}</option>)}
        </select>
        <select value={shift} onChange={e=>setShift(e.target.value)} className={inputCls} style={inputStyle} title={ar?'فلترة بالشفت':'Filter by shift'}>
          <option value="">{ar?'كل الشفتات':'All shifts'}</option>
          {(data?.shiftCodes||[]).map(sc=><option key={sc} value={sc}>{sc}</option>)}
        </select>
        <select value={sort} onChange={e=>setSort(e.target.value)} className={inputCls} style={inputStyle}>
          <option value="date_desc">{ar?'الأحدث':'Newest'}</option>
          <option value="date_asc">{ar?'الأقدم':'Oldest'}</option>
          <option value="name">{ar?'الاسم':'Name'}</option>
          <option value="adherence">{ar?'الأقل كونفورمانس':'Lowest conformance'}</option>
          <option value="late">{ar?'الأكثر تأخير':'Most late'}</option>
          <option value="early">{ar?'الأكثر خروج مبكر':'Most early out'}</option>
          <option value="mismatch">{ar?'عدم التطابق أولاً':'Mismatches first'}</option>
          <option value="ot">{ar?'الأكثر OT':'Most OT'}</option>
        </select>
        </div>
      </div>

      {/* summary band — animated count-up KPI tiles */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-2">
          {cards.map((x,i)=> x.num==null
            ? <StatTile key={i} icon={x.ic} label={x.l} value="—" color={x.c} delay={i*55} onClick={x.to?()=>nav(x.to!):undefined} />
            : <StatTile key={i} icon={x.ic} label={x.l} num={x.num} suffix={x.suffix} color={x.c} delay={i*55} onClick={x.to?()=>nav(x.to!):undefined} />
          )}
        </div>
      )}

      {/* ── hero gauges ── */}
      {s && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { v: conf || 0, l: ar ? 'الكونفورمانس' : 'Conformance', c: adhColor(conf), sub: ar ? 'التزام الفترة' : 'period adherence' },
            { v: (s.office + s.wfh) > 0 ? Math.round(100 * s.office / (s.office + s.wfh)) : 0, l: ar ? 'حصة المكتب' : 'Office share', c: '#22c55e', sub: ar ? `مقابل WFH (${s.wfh||0})` : `vs WFH (${s.wfh||0})` },
            { v: (s.days || 0) > 0 ? Math.round(100 * (s.ot_days || 0) / s.days) : 0, l: ar ? 'أيام فيها OT' : 'Days with OT', c: '#f97316', sub: ar ? 'كثافة الأوفر' : 'OT intensity' },
          ].map((g, i) => (
            <div key={i} className="rounded-2xl p-3 flex items-center justify-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Gauge value={g.v} label={g.l} color={g.c} size={132} sub={g.sub} />
            </div>
          ))}
        </div>
      )}

      {/* ── OT spotlight + presence composition ── */}
      {s && (
        <div className="grid lg:grid-cols-3 gap-3">
          {/* OT SPOTLIGHT — the headline this month: regular vs off-day vs holiday + heavy teams */}
          {(s.ot_hours || 0) > 0 && (() => {
            const reg = s.regular_ot_hours || 0, offd = s.offday_ot_hours || 0, hol = s.holiday_ot_hours || 0;
            const tot = Math.max(1, reg + offd + hol);
            const segs = [
              { l: ar ? 'عادي' : 'Regular', v: reg, c: '#f59e0b' },
              { l: ar ? 'يوم أوف' : 'Off-day', v: offd, c: '#06b6d4' },
              { l: ar ? 'عطلة' : 'Holiday', v: hol, c: '#a855f7' },
            ];
            const fns = (data?.otByFunction || []).filter(f => f.ot_h > 0);
            const maxFn = Math.max(1, ...fns.map(f => f.ot_h));
            return (
              <div className="lg:col-span-2 rounded-2xl p-4 relative overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="absolute -top-12 -inline-end-10 w-44 h-44 rounded-full" style={{ background: '#f59e0b', opacity: 0.10, filter: 'blur(46px)', pointerEvents: 'none' }} />
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3 relative">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f59e0b,#f97316)' }}><Clock size={17} className="text-white" /></div>
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الأوفر تايم — تحت المجهر' : 'Overtime spotlight'}</h3>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'عادي · يوم أوف · عطلة — والفِرَق الأكثر' : 'regular · off-day · holiday — and the heaviest teams'}</p>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-2xl font-extrabold leading-none" style={{ color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{(s.ot_hours || 0).toLocaleString()}<span className="text-sm font-bold">{ar ? 'س' : 'h'}</span></div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ar ? `${s.ot_days || 0} يوم فيه OT` : `${s.ot_days || 0} OT shifts`}</div>
                  </div>
                </div>
                {/* 3-segment OT bar */}
                <div className="flex w-full h-3 rounded-full overflow-hidden mb-2" style={{ background: 'var(--surface-2)' }}>
                  {segs.map((sg, i) => sg.v > 0 && <div key={i} title={`${sg.l}: ${sg.v}h`} style={{ width: `${100 * sg.v / tot}%`, background: sg.c }} />)}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                  {segs.map((sg, i) => (
                    <span key={i} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
                      <span className="w-2 h-2 rounded-sm" style={{ background: sg.c }} />{sg.l} <b style={{ color: 'var(--text-1)' }}>{sg.v}{ar ? 'س' : 'h'}</b>
                    </span>
                  ))}
                </div>
                {/* off-day OT callout */}
                {(s.offday_ot_days || 0) > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3" style={{ background: 'rgba(6,182,212,0.10)', border: '1px solid rgba(6,182,212,0.25)' }}>
                    <Home size={14} style={{ color: '#06b6d4', flexShrink: 0 }} />
                    <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                      <b style={{ color: '#06b6d4' }}>{s.offday_ot_days} {ar ? 'يوم أوف' : 'off-day shifts'}</b> · {s.offday_ot_hours || 0}{ar ? 'س' : 'h'} — {ar ? 'موظفون كانوا في إجازة أسبوعية وفتحوا أوفر تايم' : 'staff who were OFF and opened overtime'}
                    </p>
                  </div>
                )}
                {/* top OT functions */}
                <div className="space-y-1.5">
                  {fns.slice(0, 6).map((f, i) => {
                    const refund = /refund/i.test(f.fn);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-28 truncate text-[11px] flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                          {f.fn}{refund && <span className="px-1 rounded text-[8px] font-bold" style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>{ar ? 'بؤرة' : 'HOT'}</span>}
                        </span>
                        <div className="flex-1"><BarRow label="" value={f.ot_h} max={maxFn} color={refund ? '#f97316' : '#f59e0b'} suffix={ar ? 'س' : 'h'} delay={i * 50} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {/* presence donut */}
          {presSegs.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'تركيبة الحضور' : 'Presence composition'}</h3>
              <Donut segments={presSegs} centerNum={s.days || 0} centerLabel={ar ? 'يوم' : 'days'} size={150} />
            </div>
          )}
        </div>
      )}

      {/* ── month heatmap — see the whole period at a glance; click a day to filter ── */}
      {data?.dailyTrend && data.dailyTrend.length >= 3 && (
        <MonthHeatmap trend={data.dailyTrend} ar={ar} onPick={(f, t) => { setFrom(f); setTo(t); }} />
      )}

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !data && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {/* compact table — sticky header */}
      {!loading && data && (<>
        <div className="rounded-2xl" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <table className="w-full text-xs" style={{ tableLayout:'fixed' }}>
            <colgroup><col style={{width:'11%'}}/><col style={{width:'24%'}}/><col style={{width:'11%'}}/><col style={{width:'12%'}}/><col style={{width:'18%'}}/><col style={{width:'18%'}}/><col style={{width:'6%'}}/></colgroup>
            <thead className="sticky top-0 z-20" style={{ background:'var(--surface-2)', boxShadow:'0 1px 0 var(--border)' }}>
              <tr className="text-slate-400">
                <th className="text-start px-4 py-2.5 font-semibold rounded-tl-2xl">{ar?'التاريخ':'Date'}</th>
                <th className="text-start px-2 py-2.5 font-semibold">{ar?'الموظف':'Agent'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'الحالة':'Status'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'الشفت':'Shift'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'بصمة (د→خ)':'Punch'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'سيستم (د→خ)':'System'}</th>
                <th className="px-2 py-2.5 font-semibold text-center rounded-tr-2xl">{ar?'كونف':'Conf'}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, idx) => { const key = `${r.employee_no}|${r.date}`; const pc = presColor(r.presence); const lightRow = idx % 2 === 0;
                return (
                <Fragment key={key}>
                  <tr onClick={()=>setOpenKey(openKey===key?null:key)} className={`cursor-pointer border-t border-white/5 transition-colors ${lightRow?'zrow-light':'zrow-dark'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {openKey===key ? <ChevronDown size={13} className="text-indigo-400 flex-shrink-0"/> : <ChevronRight size={13} className="text-slate-600 flex-shrink-0"/>}
                        <div><p className="text-slate-200 font-semibold leading-tight">{r.date.slice(5)}</p><p className="text-[9px] text-slate-500">{(r.day_name && r.day_name.slice(0,3)) || dayAbbr(r.date)}</p></div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 min-w-0"><p className="text-white font-semibold truncate leading-tight">{r.name}</p><p className="text-[10px] text-slate-500 truncate">{r.employee_no}{r.username?<> · <span className="text-indigo-300/80 font-medium">{r.username}</span></>:''} · {r.function_name||'—'}{r.team_group?` · ${r.team_group}`:''}</p></td>
                    <td className="px-2 py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ background:`${pc}1f`, color:pc }}>{ar?PRES[r.presence]?.ar:PRES[r.presence]?.en||r.presence}</span>
                      {r.mismatch && <span className="ms-1" title={r.mismatch}><AlertTriangle size={11} className="inline text-rose-400" /></span>}
                      {!r.mismatch && r.data_quality && <span className="ms-1" title={r.data_quality}><AlertTriangle size={11} className="inline text-amber-400" /></span>}
                      {r.note && <span className="ms-1" title={r.note}><StickyNote size={11} className="inline text-amber-400" /></span>}
                    </td>
                    <td className="px-2 py-2.5 text-center text-slate-400 whitespace-nowrap">{r.shift_code?<span><span className="text-slate-200 font-semibold">{r.shift_code}</span> <span className="text-[10px]">{r.shift_start_min!=null?`${hhmm(r.shift_start_min)}-${hhmm(r.shift_end_min)}`:''}</span></span>:'—'}</td>
                    <td className="px-2 py-2.5 text-center whitespace-nowrap text-slate-300">{r.punch_in_min!=null?<span className="inline-flex items-center gap-1">{hhmm(r.punch_in_min)}<ArrowRight size={10} className="text-slate-500"/>{hhmm(r.punch_out_min)}</span>:'—'}</td>
                    <td className="px-2 py-2.5 text-center whitespace-nowrap" style={{ color: r.sys_late_min>0||r.sys_early_min>0?'#f59e0b':'#cbd5e1' }}>{r.sys_login_min!=null?<span className="inline-flex items-center gap-1">{hhmm(r.sys_login_min)}<ArrowRight size={10} className="text-slate-500"/>{hhmm(r.sys_logout_min)}</span>:<span className="text-slate-600">—</span>}</td>
                    <td className="px-2 py-2.5 text-center">{r.adherence_pct!=null?(
                      <div className="inline-flex flex-col items-stretch gap-1" style={{ minWidth:48 }}>
                        <span className="px-1.5 py-0.5 rounded font-bold text-[11px] text-center" style={{ background:`${adhColor(r.adherence_pct)}1f`, color:adhColor(r.adherence_pct) }}>{r.adherence_pct}%</span>
                        <div style={{ height:3, borderRadius:2, background:'var(--surface-2)', overflow:'hidden' }}><div style={{ height:'100%', width:`${Math.max(0,Math.min(100,r.adherence_pct))}%`, background:adhColor(r.adherence_pct), borderRadius:2 }} /></div>
                      </div>
                    ):<span className="text-slate-600">—</span>}</td>
                  </tr>
                  {openKey===key && (
                    <tr><td colSpan={7} className={`px-4 pb-3.5 ${lightRow?'zdet-on-light':'zdet-on-dark'}`} style={{ boxShadow:'inset 0 2px 0 rgba(99,102,241,0.5)' }}>
                      <div className="pt-3 space-y-2.5">
                        {/* identity row */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                          {(() => { const sl = statusLabel(r); return sl ? <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background:'rgba(99,102,241,0.16)', color:'#a5b4fc' }}>{ar?sl.ar:sl.en}</span> : null; })()}
                          {r.username && <span className="flex items-center gap-1"><UserCog size={12} className="text-indigo-400/70"/>{ar?'يوزر: ':'User ID: '}<span className="text-indigo-300 font-semibold">{r.username}</span></span>}
                          <span className="flex items-center gap-1"><UserCog size={12} className="text-slate-500"/>{ar?'المدير: ':'Team Mgr: '}<span className="text-slate-200 font-semibold">{r.team_manager||'—'}</span></span>
                          <span>{ar?'الفريق: ':'Team: '}<span className="text-slate-200 font-semibold">{r.team_group||'—'}</span></span>
                          <span>{ar?'الجنس: ':'Gender: '}<span className="text-slate-200 font-semibold">{r.gender||'—'}</span></span>
                          <span className="flex items-center gap-1"><Timer size={12} className="text-emerald-500"/>{ar?'ساعات العمل: ':'Worked: '}<span className="text-emerald-300 font-bold">{dur(r.worked_min)}</span></span>
                          <button onClick={()=>editNote(r)} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ms-auto" style={{ background:'rgba(245,158,11,0.15)', color:'#fbbf24' }}><StickyNote size={11}/>{r.note?(ar?'تعديل ملاحظة':'Edit note'):(ar?'إضافة ملاحظة':'Add note')}</button>
                        </div>
                        {/* time cards — each with its TOTAL hours (Σ) + system's 2nd session */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {([
                            { l: ar?'الشفت المجدوَل':'Scheduled shift', tag: r.shift_code, a: r.shift_start_min, b: r.shift_end_min, c:'#8b5cf6', total: span(r.shift_start_min, r.shift_end_min), s2a: null as number|null, s2b: null as number|null },
                            { l: ar?'البصمة':'Punch', tag: null as string|null, a: r.punch_in_min, b: r.punch_out_min, c:'#22c55e', total: span(r.punch_in_min, r.punch_out_min), s2a: null as number|null, s2b: null as number|null },
                            { l: ar?'السيستم':'System', tag: r.login_src, a: r.sys_login_min, b: r.sys_logout_min, c:'#06b6d4', total: (r.total_work_sys_min ?? span(r.sys_login_min, r.sys_logout_min)), s2a: r.sys_login2_min ?? null, s2b: r.sys_logout2_min ?? null },
                          ]).map((card,i)=>(
                            <div key={i} className="px-3 py-2 rounded-xl" style={{ background:'rgba(255,255,255,0.04)' }}>
                              <div className="flex items-center justify-between mb-0.5 gap-2">
                                <p className="text-[10px] text-slate-500 uppercase font-semibold truncate">{card.l}{card.tag?` · ${card.tag}`:''}</p>
                                {card.total!=null && card.total>0 && <span className="text-[10px] font-bold whitespace-nowrap" style={{ color:card.c }}>Σ {dur(card.total)}</span>}
                              </div>
                              <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color:card.c }}><span>{hhmm(card.a)}</span><ArrowRight size={13} className="text-slate-500" /><span>{hhmm(card.b)}</span></div>
                              {card.s2a!=null && <div className="flex items-center gap-1.5 text-[11px] font-semibold mt-0.5 opacity-80" style={{ color:card.c }}><span className="text-[9px] text-slate-500">{ar?'جلسة٢':'2nd'}</span><span>{hhmm(card.s2a)}</span><ArrowRight size={11} className="text-slate-500" /><span>{hhmm(card.s2b)}</span></div>}
                            </div>
                          ))}
                        </div>
                        {/* metrics */}
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                          {([
                            [ar?'كونفورمانس':'Conformance', r.adherence_pct!=null?r.adherence_pct+'%':'—', adhColor(r.adherence_pct)],
                            [ar?'ساعات العمل':'Worked', dur(r.worked_min), '#10b981'],
                            [ar?'تأخير سيستم':'Sys late', dur(r.sys_late_min), r.sys_late_min>0?'#f59e0b':'#64748b'],
                            [ar?'خروج مبكر':'Early out', dur(r.sys_early_min), r.sys_early_min>0?'#f59e0b':'#64748b'],
            [(r.holiday_ot_min||0)>0?(ar?'OT عطلة':'OT (holiday)'):(r.offday_ot_min||0)>0?(ar?'OT يوم OFF':'OT (off-day)'):'OT', dur(r.total_ot!=null?r.total_ot:r.ot_min), ((r.total_ot??r.ot_min)||0)>0?'#10b981':'#64748b'],
                            [ar?'تأخير بصمة':'Punch late', dur(r.late_min), r.late_min>0?'#f59e0b':'#64748b'],
                          ] as [string,any,string][]).map(([l,v,c],i)=>(
                            <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg" style={{ background:'rgba(255,255,255,0.04)' }}>
                              <span className="text-[10px] text-slate-400">{l}</span><span className="text-[11px] font-bold" style={{ color:c }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        {r.mismatch && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(244,63,94,0.12)', color:'#f87171' }}>
                            <AlertTriangle size={13} />
                            {r.mismatch==='no-system' ? (ar?'بصمة بدون تسجيل سيستم':'Punched but no system login')
                              : r.mismatch==='no-punch' ? (ar?'سيستم بدون بصمة':'System login but no punch')
                              : (ar?'فرق كبير بين البصمة والسيستم (>30 د)':'Punch vs system differ by >30 min')}
                          </div>
                        )}
                        {(() => { const M: Record<string,string> = {
                          'stray-session-no-shift-match': ar?'⚠ جلسة السيستم لا تطابق الشفت المجدول — تُعامل كأنه ما داوم، يرجى التحقق من الجدول':'System session does not match the scheduled shift — treated as no-work, verify the schedule',
                          'persistent-session-capped': ar?'الجلسة بقيت مفتوحة بعد نهاية الشفت — احتُسبت ساعات الشفت لا الجلسة المفتوحة':'System session left open past shift end — counted the shift, not the open session',
                          'tardiness-bleed': ar?'قراءة تأخير/خروج عبر منتصف الليل (>4س) استُبعدت كبليد':'Cross-midnight tardiness reading (>4h) excluded as bleed' };
                          const msg = r.data_quality ? (M[r.data_quality] || r.data_quality) : null;
                          return msg ? (<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(245,158,11,0.12)', color:'#fbbf24' }}><AlertTriangle size={13} />{msg}</div>) : null; })()}
                        {r.permission && (r.sys_late_min>0 || r.sys_early_min>0) && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(168,85,247,0.12)', color:'#c084fc' }}>
                            <AlertTriangle size={13} />
                            {ar?`تنبيه: ${r.sys_late_min>0?'تأخير '+dur(r.sys_late_min):''}${r.sys_early_min>0?' خروج مبكر '+dur(r.sys_early_min):''} معوّض بإذن — مُعفى لكنه مسجّل`
                               :`Note: ${r.sys_late_min>0?'late '+dur(r.sys_late_min):''}${r.sys_early_min>0?' early-out '+dur(r.sys_early_min):''} covered by permission — excused but on record`}
                          </div>
                        )}
                        {(r.permission || r.comp_off || r.sick || r.status || r.note) && (
                          <div className="space-y-1.5">
                            {(() => { const sl = statusLabel(r); if (!sl && !r.status) return null;
                              // genuine conflict ONLY = a leave/off code on a day that's an official holiday
                              // (e.g. coded L but it's Hijri New Year). Working a holiday ("Morning Shift · Holiday (worked)") is NOT a conflict.
                              const isLeaveOff = !!sl && /Leave|Day Off|Absent|Comp/i.test(sl.en);
                              const rawDiffers = !!(isLeaveOff && r.status && /holiday/i.test(r.status));
                              return (<div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(255,255,255,0.04)' }}>
                                <span className="text-slate-500">{ar?'الحالة: ':'Status: '}</span>
                                {sl && <span className="font-bold text-indigo-200">{ar?sl.ar:sl.en}</span>}
                                {r.status && <span className="text-slate-400">{sl?'  ·  ':''}{r.status}</span>}
                                {rawDiffers && <span className="ms-1" title={ar?'الكود لا يطابق الحالة المكتوبة — راجِع':'Code vs written status differ — review'}><AlertTriangle size={11} className="inline text-amber-400" /></span>}
                              </div>); })()}
                            {r.daily_note && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(16,185,129,0.10)' }}><span className="text-emerald-300/80 font-semibold">{ar?'ملاحظة: ':'Note: '}</span><span className="text-slate-300">{r.daily_note}</span></div>}
                            {r.permission && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(99,102,241,0.12)' }}><span className="text-indigo-300 font-semibold">{ar?'استئذان: ':'Permission: '}</span><span className="text-slate-200">{[r.permission_type, r.permission_duration, r.permission].filter(Boolean).join(' · ')}</span></div>}
                            {r.comp_off && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(16,185,129,0.12)' }}><span className="text-emerald-300 font-semibold">{ar?'كومب أوف: ':'Comp off: '}</span><span className="text-slate-200">{r.comp_off}</span></div>}
                            {r.sick && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(245,158,11,0.12)' }}><span className="text-amber-300 font-semibold">{ar?'سيك: ':'Sick: '}</span><span className="text-slate-200">{r.sick}</span></div>}
                            {r.note && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(245,158,11,0.16)' }}><span className="text-amber-300 font-semibold">{ar?'ملاحظة المدير: ':'Manager note: '}</span><span className="text-slate-100">{r.note}</span></div>}
                          </div>
                        )}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );})}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] text-slate-500">{ar?`عرض ${page*PER+1}–${Math.min((page+1)*PER, data.total)} من ${data.total}`:`${page*PER+1}–${Math.min((page+1)*PER, data.total)} of ${data.total}`}</p>
            <div className="flex items-center gap-1">
              <button disabled={page===0} onClick={()=>setPage(p=>p-1)} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background:'rgba(255,255,255,0.05)' }}><ChevronLeft size={14} className="text-white"/></button>
              <span className="text-xs text-slate-300 px-2 font-semibold">{page+1} / {pageCount}</span>
              <button disabled={page>=pageCount-1} onClick={()=>setPage(p=>p+1)} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background:'rgba(255,255,255,0.05)' }}><ChevronRight size={14} className="text-white"/></button>
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}
