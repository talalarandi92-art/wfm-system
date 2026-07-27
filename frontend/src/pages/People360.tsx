import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import {
  Search, Users, Building2, Download, ChevronDown, ChevronRight, X,
  CalendarDays, Activity, Award, Coffee, Clock, Phone, ShieldCheck, ChevronLeft,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { fmtLocalDate } from '@/utils/format';
import { useUiStore } from '@/store/ui.store';
import { Kpi360Card, agent360Url, confColor as cf, Open360Link } from '@/components/agent360/shared';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const hms = (s: number | null) => s == null ? '—' : (s >= 60 ? `${Math.floor(s/60)}m ${Math.round(s%60)}s` : `${Math.round(s)}s`);
const n0 = (v: any) => v == null ? '—' : Number(v).toLocaleString();
const pct = (v: any) => v == null ? '—' : `${v}%`;
const sc = (v: number | null) => v == null ? '#64748b' : v>=90?'#22c55e':v>=75?'#06b6d4':v>=60?'#f59e0b':'#f43f5e';
const fc = (v: number | null) => v == null ? '#64748b' : v>=70?'#22c55e':v>=60?'#f59e0b':'#f43f5e';
/* These were the literals '2026-06-30' and '2026-06-01', wired straight into the
   page's opening state, every request it makes, and the export filename — so the
   page always opened on June 2026 no matter what the date actually was. Computed
   locally (never toISOString, which names the wrong day in Kuwait +03:00). */
const monthStart = () => { const d = new Date(); return fmtLocalDate(new Date(d.getFullYear(), d.getMonth(), 1)); };
const todayLocal = () => fmtLocalDate(new Date());
const PER = 20;

interface Row {
  id: string; employee_no: string; name: string; function_name: string; employment_type: string; gender: string;
  working_days: number; office_days: number; wfh_days: number; sick_days: number; leave_days: number;
  absence_days: number; off_days: number; comp_days: number; late_count: number; late_minutes: number;
  early_count: number; missing_punch: number; missing_system: number; ot_hours: number;
  clean_punch_pct: number | null; calls: number; aht_sec: number | null; occupancy: number | null;
  break_pct: number | null; staffed_h: number | null; avg_net: number | null; sc_months: number | null;
  fcr_pct: number | null; fcr_total: number | null;
}

/* small colored pill */
function Pill({ v, color, suffix = '' }: { v: any; color: string; suffix?: string }) {
  if (v == null || v === '') return <span className="text-slate-600">—</span>;
  return <span className="px-2 py-0.5 rounded-md text-xs font-bold" style={{ background:`${color}1f`, color }}>{v}{suffix}</span>;
}

export default function People360Page() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [view, setView] = useState<'people' | 'functions'>('people');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayLocal);
  const [functionId, setFunctionId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('working_days');
  const [functions, setFunctions] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [page, setPage] = useState(0);

  useEffect(() => { apiClient.get('/employees/meta/functions').then(r => setFunctions(r.data || [])).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true); setOpenId(null); setDetail(null); setPage(0);
    const url = view === 'people'
      ? `/ops-analytics/people?from=${from}&to=${to}&limit=500${functionId?`&functionId=${functionId}`:''}${search?`&search=${encodeURIComponent(search)}`:''}&sort=${sort}`
      : `/ops-analytics/functions-360?from=${from}&to=${to}`;
    apiClient.get(url).then(r => setData(r.data)).catch(() => setData({ error: true })).finally(() => setLoading(false));
  }, [view, from, to, functionId, search, sort]);

  useEffect(() => { load(); }, [view, from, to, functionId, sort]); // eslint-disable-line

  const openDetail = (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setDetail(null);
    apiClient.get(`/ops-analytics/people/${id}?from=${from}&to=${to}`).then(r => setDetail(r.data)).catch(() => setDetail({ error: true }));
  };

  const qsFilters = () => `from=${from}&to=${to}${functionId?`&functionId=${functionId}`:''}${search?`&search=${encodeURIComponent(search)}`:''}&sort=${sort}`;
  const exportXlsx = async () => {
    try { const r = await apiClient.get(`/ops-analytics/people/export?${qsFilters()}`, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `people-360_${from}_${to}.xlsx`; a.click(); } catch { /* */ }
  };

  /* summary band computed from the loaded rows */
  const summary = useMemo(() => {
    const rows: Row[] = data?.rows || [];
    if (!rows.length) return null;
    const sum = (k: keyof Row) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const avg = (k: keyof Row) => { const v = rows.filter(r => r[k] != null); return v.length ? Math.round(v.reduce((s, r) => s + Number(r[k]), 0) / v.length) : null; };
    const avg1 = (k: keyof Row) => { const v = rows.filter(r => r[k] != null); return v.length ? Math.round(v.reduce((s, r) => s + Number(r[k]), 0) / v.length * 10) / 10 : null; };
    return { count: data.total, sick: sum('sick_days'), absence: sum('absence_days'), late: sum('late_count'),
      ot: Math.round(sum('ot_hours')), conf: avg1('clean_punch_pct'), aht: avg('aht_sec'), score: avg1('avg_net') };
  }, [data]);

  const pageRows: Row[] = useMemo(() => (data?.rows || []).slice(page*PER, page*PER+PER), [data, page]);
  const pageCount = Math.ceil((data?.rows?.length || 0) / PER);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';

  return (
    <div className="space-y-4 r5t">
      {/* R5: light-theme-only remap of dark-only Tailwind neutrals (dark/glass untouched) */}
      <style>{`
        .theme-light .r5t .text-white{color:var(--text-1)}
        .theme-light .r5t .text-slate-100,.theme-light .r5t .text-slate-200{color:#1e293b}
        .theme-light .r5t .text-slate-300{color:#334155}
        .theme-light .r5t .text-slate-400{color:#475569}
        .theme-light .r5t .text-slate-500{color:#64748b}
        .theme-light .r5t .text-slate-600{color:#94a3b8}
        .theme-light .r5t [class*="hover:text-white"]:hover{color:var(--text-1)}
        .theme-light .r5t [class*="border-white/"]{border-color:var(--border)}
        .theme-light .r5t :not([class*="hover:"])[class*="bg-white/"]{background-color:var(--surface-2)}
        .theme-light .r5t [class*="hover:bg-white/"]:hover{background-color:var(--chip-bg)}
        .theme-light .r5t input::placeholder,.theme-light .r5t textarea::placeholder{color:#94a3b8}
      `}</style>
      {/* ── filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background:'var(--surface)', border:'1px solid var(--border)' }}>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {([['people',Users,ar?'الموظفين':'Employees'],['functions',Building2,ar?'الفنكشن':'Functions']] as const).map(([k,Ic,lbl]) => (
            <button key={k} onClick={() => setView(k as any)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              style={view===k?{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }:{ color:'#94a3b8' }}><Ic size={13} />{lbl}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14} />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          <span className="text-xs">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>
        {view === 'people' && <>
          <select value={functionId} onChange={e => setFunctionId(e.target.value)} className={inputCls}>
            <option value="">{ar?'كل الفنكشن':'All functions'}</option>
            {functions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5 flex-1 min-w-[150px]">
            <Search size={14} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key==='Enter'&&load()}
              placeholder={ar?'بحث بالاسم أو الرقم…':'Name or employee no…'} className={`${inputCls} flex-1`} />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} className={inputCls}>
            <option value="working_days">{ar?'أيام العمل':'Work days'}</option>
            <option value="sick">{ar?'الأكثر سيك':'Most sick'}</option>
            <option value="absence">{ar?'الأكثر غياب':'Most absence'}</option>
            <option value="late">{ar?'الأكثر تأخير':'Most late'}</option>
            <option value="ot">{ar?'الأكثر OT':'Most OT'}</option>
            <option value="calls">{ar?'الأكثر مكالمات':'Most calls'}</option>
            <option value="conformance">{ar?'الأعلى كونفورمانس':'Top conformance'}</option>
            <option value="score">{ar?'الأعلى سكور':'Top score'}</option>
          </select>
          <button onClick={exportXlsx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background:'rgba(34,197,94,0.18)', color:'#22c55e' }}><Download size={13} />Excel</button>
        </>}
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {data?.error && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {/* ── EMPLOYEES ── */}
      {!loading && view === 'people' && data?.rows && (<>
        {/* summary band */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {[
              { ic: Users,      l: ar?'موظفين':'Employees', v: summary.count, c:'#6366f1' },
              { ic: ShieldCheck,l: ar?'بصمة نظيفة':'Clean punch', v: summary.conf!=null?summary.conf+'%':'—', c: cf(summary.conf) },
              { ic: Award,      l: ar?'سكور':'Score', v: summary.score ?? '—', c: sc(summary.score) },
              { ic: Activity,   l: 'AHT', v: hms(summary.aht), c:'#06b6d4' },
              { ic: Coffee,     l: ar?'سيك':'Sick', v: summary.sick, c:'#f59e0b' },
              { ic: X,          l: ar?'غياب':'Absence', v: summary.absence, c:'#f43f5e' },
              { ic: Clock,      l: ar?'تأخير':'Late', v: summary.late, c:'#f59e0b' },
              { ic: Clock,      l: ar?'OT س':'OT h', v: summary.ot, c:'#10b981' },
            ].map((x,i) => (
              <Kpi360Card key={i} icon={x.ic} label={x.l} value={x.v} color={x.c} small />
            ))}
          </div>
        )}

        {/* compact table (essential cols only — no horizontal scroll) */}
        <div className="rounded-2xl overflow-hidden" style={{ background:'var(--surface)', border:'1px solid var(--border)' }}>
          <table className="w-full text-xs" style={{ tableLayout:'fixed' }}>
            <colgroup><col style={{width:'30%'}}/><col/><col/><col/><col/><col/><col/><col/></colgroup>
            <thead style={{ background:'var(--surface-2)' }}>
              <tr className="text-slate-400">
                <th className="text-start px-4 py-2.5 font-semibold">{ar?'الموظف':'Employee'}</th>
                {[ar?'أيام':'Days', ar?'سيك':'Sick', ar?'تأخير':'Late', 'OT', 'AHT', ar?'كونف':'Conf', ar?'سكور':'Score'].map((h,i) =>
                  <th key={i} className="px-2 py-2.5 font-semibold text-center">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r: Row) => (
                <Fragment key={r.id}>
                  <tr onClick={() => openDetail(r.id)} className="cursor-pointer hover:bg-white/[0.04] border-t border-white/5 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {openId===r.id ? <ChevronDown size={14} className="text-indigo-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-600 flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-white font-semibold leading-tight truncate">{r.name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{r.employee_no} · {r.function_name||'—'}</p>
                        </div>
                        {r.employee_no && <span className="ms-auto flex-shrink-0"><Open360Link to={agent360Url(r.employee_no)} ar={ar} title={ar?'افتح ملف الموظف 360 (سكوركارد)':'Open Agent 360 profile (Scorecard hub)'} /></span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center text-slate-200 font-semibold">{r.working_days}</td>
                    <td className="px-2 py-2.5 text-center"><Pill v={r.sick_days||null} color="#f59e0b" /></td>
                    <td className="px-2 py-2.5 text-center"><Pill v={r.late_count||null} color="#f59e0b" /></td>
                    <td className="px-2 py-2.5 text-center text-slate-300">{r.ot_hours?Number(r.ot_hours).toFixed(1):'—'}</td>
                    <td className="px-2 py-2.5 text-center text-slate-300">{hms(r.aht_sec)}</td>
                    <td className="px-2 py-2.5 text-center"><Pill v={r.clean_punch_pct} color={cf(r.clean_punch_pct)} suffix="%" /></td>
                    <td className="px-2 py-2.5 text-center"><Pill v={r.avg_net} color={sc(r.avg_net)} /></td>
                  </tr>
                  {openId === r.id && (
                    <tr><td colSpan={8} className="px-4 pb-4" style={{ background:'rgba(99,102,241,0.05)' }}>
                      {!detail && <p className="text-xs text-slate-500 py-3">{ar?'جارٍ تحميل التفاصيل…':'Loading…'}</p>}
                      {detail && !detail.error && <DetailPanel d={detail} r={r} ar={ar} />}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] text-slate-500">{ar?`عرض ${page*PER+1}–${Math.min((page+1)*PER, data.rows.length)} من ${data.total}`:`${page*PER+1}–${Math.min((page+1)*PER, data.rows.length)} of ${data.total}`}</p>
            <div className="flex items-center gap-1">
              <button disabled={page===0} onClick={() => { setPage(p=>p-1); setOpenId(null); }} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background:'var(--chip-bg)' }}><ChevronLeft size={14} className="text-white" /></button>
              <span className="text-xs text-slate-300 px-2 font-semibold">{page+1} / {pageCount}</span>
              <button disabled={page>=pageCount-1} onClick={() => { setPage(p=>p+1); setOpenId(null); }} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background:'var(--chip-bg)' }}><ChevronRight size={14} className="text-white" /></button>
            </div>
          </div>
        )}
      </>)}

      {/* ── FUNCTIONS ── */}
      {!loading && view === 'functions' && data?.functions && (
        <div className="rounded-2xl overflow-hidden" style={{ background:'var(--surface)', border:'1px solid var(--border)' }}>
          <table className="w-full text-xs">
            <thead style={{ background:'var(--surface-2)' }}>
              <tr className="text-slate-400">
                {[ar?'الفنكشن':'Function', ar?'موظفين':'Emp', ar?'أيام':'Days', ar?'سيك':'Sick', ar?'غياب':'Abs', ar?'تأخير':'Late', 'OT', ar?'مكالمات':'Calls', 'AHT', ar?'إشغال':'Occ', ar?'كونف':'Conf', ar?'سكور':'Score'].map((h,i) =>
                  <th key={i} className={`px-2.5 py-2.5 font-semibold ${i===0?'text-start':'text-center'}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.functions.map((f: any) => (
                <tr key={f.function_name} className="border-t border-white/5 hover:bg-white/[0.04]">
                  <td className="px-2.5 py-2.5 text-white font-semibold">{f.function_name}</td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{f.employees}</td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{n0(f.working_days)}</td>
                  <td className="px-2.5 py-2.5 text-center"><Pill v={f.sick_days||null} color="#f59e0b" /></td>
                  <td className="px-2.5 py-2.5 text-center"><Pill v={f.absence_days||null} color="#f43f5e" /></td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{f.late_count}</td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{f.ot_hours?Number(f.ot_hours).toFixed(0):'—'}</td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{n0(f.calls)}</td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{hms(f.aht_sec)}</td>
                  <td className="px-2.5 py-2.5 text-center text-slate-300">{pct(f.occupancy)}</td>
                  <td className="px-2.5 py-2.5 text-center"><Pill v={f.clean_punch_pct} color={cf(f.clean_punch_pct)} suffix="%" /></td>
                  <td className="px-2.5 py-2.5 text-center"><Pill v={f.avg_net} color={sc(f.avg_net)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── per-employee detail panel (ALL metrics live here — no wide table needed) ─ */
function DetailPanel({ d, r, ar }: { d: any; r: Row; ar: boolean }) {
  const grp = (title: string, items: [string, any, string?][]) => (
    <div>
      <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1.5">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {items.map(([l, v, c], i) => (
          <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg" style={{ background:'var(--chip-bg)' }}>
            <span className="text-[10px] text-slate-400">{l}</span>
            <span className="text-xs font-bold" style={{ color: c || 'var(--text-1)' }}>{v == null || v === '' ? '—' : v}</span>
          </div>
        ))}
      </div>
    </div>
  );
  const MK: Record<string,{ar:string;c:string}> = {
    present:{ar:'حضور',c:'#22c55e'}, sick:{ar:'سيك',c:'#f59e0b'}, leave:{ar:'إجازة',c:'#06b6d4'},
    absent:{ar:'غياب',c:'#f43f5e'}, off:{ar:'أوف',c:'#475569'}, holiday:{ar:'عطلة',c:'#8b5cf6'}, comp:{ar:'تعويضي',c:'#10b981'} };

  return (
    <div className="space-y-3.5 pt-3">
      <div className="grid md:grid-cols-3 gap-4">
        {grp(ar?'الحضور':'Attendance', [
          [ar?'أيام عمل':'Work days', r.working_days, 'var(--text-1)'], [ar?'مكتب':'Office', r.office_days], [ar?'WFH':'WFH', r.wfh_days],
          [ar?'سيك':'Sick', r.sick_days, r.sick_days?'#f59e0b':''], [ar?'إجازة':'Leave', r.leave_days], [ar?'غياب':'Absence', r.absence_days, r.absence_days?'#f43f5e':''],
          [ar?'أوف':'Off', r.off_days], [ar?'تعويضي':'Comp', r.comp_days], [ar?'بصمة نظيفة':'Clean punch', pct(r.clean_punch_pct), cf(r.clean_punch_pct)],
        ])}
        {grp(ar?'الالتزام':'Punctuality', [
          [ar?'تأخير':'Late', r.late_count, r.late_count?'#f59e0b':''], [ar?'دقائق تأخير':'Late min', r.late_minutes],
          [ar?'خروج مبكر':'Early out', r.early_count], [ar?'بصمة ناقصة':'Miss punch', r.missing_punch], [ar?'سيستم ناقص':'Miss system', r.missing_system],
          [ar?'OT ساعات':'OT hours', r.ot_hours?Number(r.ot_hours).toFixed(1):0, '#10b981'],
        ])}
        {grp(ar?'الإنتاجية والجودة':'Productivity & Quality', [
          [ar?'مكالمات':'Calls', n0(r.calls)], ['AHT', hms(r.aht_sec), '#06b6d4'], [ar?'إشغال':'Occupancy', pct(r.occupancy)],
          [ar?'بريك':'Break', pct(r.break_pct)], ['FCR', pct(r.fcr_pct), fc(r.fcr_pct)], [ar?'سكور':'Score', r.avg_net ?? '—', sc(r.avg_net)],
        ])}
      </div>

      {/* daily productivity mini chart */}
      {(d.prodTrend||[]).length>0 && (() => {
        const tr = d.prodTrend; const maxC = Math.max(...tr.map((x:any)=>x.calls),1), maxA = Math.max(...tr.map((x:any)=>x.aht_sec),1);
        const W=560,H=70,n=tr.length,bw=Math.max(2,Math.min(16,W/n-2));
        const pts = tr.map((x:any,i:number)=>`${(i+0.5)*(W/n)},${H-(x.aht_sec/maxA)*H}`).join(' ');
        return (<div>
          <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{ar?'الإنتاجية اليومية — مكالمات/AHT':'Daily — calls (bars) & AHT (line)'}</p>
          <svg viewBox={`0 0 ${W} ${H+4}`} className="w-full" style={{ maxHeight:88 }}>
            {tr.map((x:any,i:number)=>{const h=(x.calls/maxC)*H;return <rect key={i} x={(i+0.5)*(W/n)-bw/2} y={H-h} width={bw} height={h} rx={1.5} fill="#6366f1aa"><title>{`${x.date}: ${x.calls} calls · AHT ${hms(x.aht_sec)}`}</title></rect>;})}
            <polyline points={pts} fill="none" stroke="#06b6d4" strokeWidth={1.5} />
          </svg>
        </div>);
      })()}

      {/* score trend */}
      {(d.scoreTrend||[]).length>0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{ar?'اتجاه السكور':'Score trend'}</p>
          <div className="flex items-end gap-1 h-14">
            {d.scoreTrend.map((m:any,i:number)=>(
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${m.year}-${m.month}: ${m.avg_net}`}>
                <div className="w-full rounded-t" style={{ height:`${Math.max(4,Math.min(100,(m.avg_net/130)*100))}%`, background: sc(m.avg_net) }} />
                <span className="text-[8px] text-slate-600">{m.month}</span>
              </div>))}
          </div>
        </div>
      )}

      {/* daily attendance strip */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{ar?'الحضور اليومي':'Daily attendance'}</p>
        <div className="flex flex-wrap gap-1">
          {(d.daily||[]).map((day:any,i:number)=>{const m=MK[day.marker]||{ar:day.marker,c:'#334155'};const late=day.late>0;
            return <div key={i} title={`${day.date} · ${day.marker}${late?` · late ${day.late}m`:''}${day.ot?` · OT ${day.ot}m`:''}`}
              className="w-6 h-6 rounded flex items-center justify-center text-[8px] font-bold" style={{ background:`${m.c}33`, color:m.c, border:late?'1px solid #f59e0b':'1px solid transparent' }}>{Number(day.date.slice(8,10))}</div>;})}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">{Object.entries(MK).map(([k,v])=><span key={k} className="flex items-center gap-1 text-[9px] text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background:v.c }} />{ar?v.ar:k}</span>)}</div>
      </div>
    </div>
  );
}
