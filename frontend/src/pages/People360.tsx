import { useState, useEffect, useCallback } from 'react';
import {
  Search, Users, Building2, Download, ChevronDown, ChevronRight, X,
  CalendarDays, Activity, Award, Coffee, Clock,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const hms = (s: number | null) => s == null ? '—' : `${Math.floor(s/60)}m ${Math.round(s%60)}s`;
const n0 = (v: any) => v == null ? '—' : Number(v).toLocaleString();
const pct = (v: any) => v == null ? '—' : `${v}%`;
const cf = (v: number | null) => v == null ? '#64748b' : v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';
const todayISO = '2026-06-30';
const firstOfMonth = '2026-05-01';

interface Row {
  id: string; employee_no: string; name: string; function_name: string; employment_type: string; gender: string;
  working_days: number; office_days: number; wfh_days: number; sick_days: number; leave_days: number;
  absence_days: number; off_days: number; comp_days: number; late_count: number; late_minutes: number;
  early_count: number; missing_punch: number; missing_system: number; ot_hours: number;
  conformance_pct: number | null; calls: number; aht_sec: number | null; occupancy: number | null;
  break_pct: number | null; staffed_h: number | null; avg_net: number | null; sc_months: number | null;
}

/* ─── column defs for the employee table ──────────────────────────────────── */
const COLS: { key: keyof Row; ar: string; en: string; fmt?: (v: any, r: Row) => any; color?: (r: Row) => string }[] = [
  { key: 'working_days', ar: 'أيام عمل', en: 'Work days' },
  { key: 'office_days',  ar: 'مكتب',     en: 'Office' },
  { key: 'wfh_days',     ar: 'WFH',      en: 'WFH' },
  { key: 'sick_days',    ar: 'سيك',      en: 'Sick',   color: r => r.sick_days>0?'#f59e0b':'' },
  { key: 'leave_days',   ar: 'إجازة',    en: 'Leave' },
  { key: 'absence_days', ar: 'غياب',     en: 'Absence', color: r => r.absence_days>0?'#f43f5e':'' },
  { key: 'off_days',     ar: 'أوف',      en: 'Off' },
  { key: 'late_count',   ar: 'تأخير',    en: 'Late',   color: r => r.late_count>0?'#f59e0b':'' },
  { key: 'early_count',  ar: 'خروج مبكر',en: 'Early' },
  { key: 'missing_punch',ar: 'بصمة ناقصة',en: 'Miss P' },
  { key: 'ot_hours',     ar: 'OT س',     en: 'OT h',   fmt: v => v?Number(v).toFixed(1):'—' },
  { key: 'calls',        ar: 'مكالمات',  en: 'Calls' },
  { key: 'aht_sec',      ar: 'AHT',      en: 'AHT',    fmt: v => hms(v) },
  { key: 'occupancy',    ar: 'إشغال',    en: 'Occ',    fmt: v => pct(v) },
  { key: 'conformance_pct', ar: 'كونفورمانس', en: 'Conf', fmt: v => pct(v), color: r => cf(r.conformance_pct) },
  { key: 'avg_net',      ar: 'سكور',     en: 'Score',  color: r => r.avg_net==null?'':cf(r.avg_net>=90?96:r.avg_net>=75?88:r.avg_net>=60?72:50) },
];

export default function People360Page() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [view, setView] = useState<'people' | 'functions'>('people');
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayISO);
  const [functionId, setFunctionId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('working_days');
  const [functions, setFunctions] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => { apiClient.get('/employees/meta/functions').then(r => setFunctions(r.data || [])).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true); setOpenId(null); setDetail(null);
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

  const exportCsv = () => {
    const rows: Row[] = data?.rows || [];
    if (!rows.length) return;
    const head = ['Employee No','Name','Function', ...COLS.map(c => c.en)];
    const lines = rows.map(r => [r.employee_no, `"${r.name}"`, `"${r.function_name||''}"`, ...COLS.map(c => r[c.key] ?? '')].join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `people-360_${from}_${to}.csv`; a.click();
  };

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';

  return (
    <div className="space-y-4">
      {/* ── filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button onClick={() => setView('people')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={view==='people'?{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }:{ color:'#94a3b8' }}>
            <Users size={13} />{ar?'الموظفين':'Employees'}</button>
          <button onClick={() => setView('functions')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={view==='functions'?{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }:{ color:'#94a3b8' }}>
            <Building2 size={13} />{ar?'الفنكشن':'Functions'}</button>
        </div>

        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14} />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          <span className="text-xs">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>

        {view === 'people' && (
          <>
            <select value={functionId} onChange={e => setFunctionId(e.target.value)} className={inputCls}>
              <option value="">{ar?'كل الفنكشن':'All functions'}</option>
              {functions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
              <Search size={14} className="text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key==='Enter'&&load()}
                placeholder={ar?'بحث بالاسم أو الرقم الوظيفي…':'Name or employee no…'} className={`${inputCls} flex-1`} />
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)} className={inputCls}>
              <option value="working_days">{ar?'ترتيب: أيام العمل':'Sort: Work days'}</option>
              <option value="sick">{ar?'الأكثر سيك':'Most sick'}</option>
              <option value="absence">{ar?'الأكثر غياب':'Most absence'}</option>
              <option value="late">{ar?'الأكثر تأخير':'Most late'}</option>
              <option value="ot">{ar?'الأكثر OT':'Most OT'}</option>
              <option value="calls">{ar?'الأكثر مكالمات':'Most calls'}</option>
              <option value="conformance">{ar?'الأعلى كونفورمانس':'Top conformance'}</option>
              <option value="score">{ar?'الأعلى سكور':'Top score'}</option>
            </select>
          </>
        )}
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background:'rgba(34,197,94,0.18)', color:'#22c55e' }}>
          <Download size={13} />CSV</button>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {data?.error && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {/* ── EMPLOYEES TABLE ── */}
      {!loading && view === 'people' && data?.rows && (
        <>
          <p className="text-xs text-slate-500">{ar?`${data.total} موظف · الفترة ${data.from} → ${data.to}`:`${data.total} employees · ${data.from} → ${data.to}`}</p>
          <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'68vh' }}>
            <table className="w-full text-xs" style={{ borderCollapse:'separate', borderSpacing:0 }}>
              <thead className="sticky top-0 z-10" style={{ background:'#11162a' }}>
                <tr className="text-slate-400">
                  <th className="text-start px-3 py-2 font-semibold">{ar?'الموظف':'Employee'}</th>
                  {COLS.map(c => <th key={String(c.key)} className="px-2 py-2 font-semibold text-center whitespace-nowrap">{ar?c.ar:c.en}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: Row) => (
                  <>
                    <tr key={r.id} onClick={() => openDetail(r.id)} className="cursor-pointer hover:bg-white/5 border-t border-white/5">
                      <td className="px-3 py-2 min-w-[180px]">
                        <div className="flex items-center gap-1.5">
                          {openId===r.id ? <ChevronDown size={13} className="text-indigo-400" /> : <ChevronRight size={13} className="text-slate-600" />}
                          <div>
                            <p className="text-white font-semibold leading-tight">{r.name}</p>
                            <p className="text-[10px] text-slate-500">{r.employee_no} · {r.function_name||'—'}</p>
                          </div>
                        </div>
                      </td>
                      {COLS.map(c => {
                        const raw = r[c.key]; const val = c.fmt ? c.fmt(raw, r) : (raw ?? '—');
                        const col = c.color?.(r);
                        return <td key={String(c.key)} className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ color: col || '#e2e8f0' }}>{val === '' || val == null ? '—' : (typeof val==='number'?n0(val):val)}</td>;
                      })}
                    </tr>
                    {openId === r.id && (
                      <tr><td colSpan={COLS.length+1} className="px-3 pb-3" style={{ background:'rgba(99,102,241,0.04)' }}>
                        {!detail && <p className="text-xs text-slate-500 py-3">{ar?'جارٍ تحميل التفاصيل…':'Loading detail…'}</p>}
                        {detail && !detail.error && <DetailPanel d={detail} ar={ar} />}
                      </td></tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── FUNCTIONS TABLE ── */}
      {!loading && view === 'functions' && data?.functions && (
        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'72vh' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background:'#11162a' }}>
              <tr className="text-slate-400">
                {[ar?'الفنكشن':'Function', ar?'موظفين':'Emp', ar?'أيام عمل':'Work d', ar?'سيك':'Sick', ar?'إجازة':'Leave', ar?'غياب':'Absence', ar?'تأخير':'Late', 'OT', ar?'مكالمات':'Calls', 'AHT', ar?'إشغال':'Occ', ar?'كونفورمانس':'Conf', ar?'سكور':'Score'].map((h,i) =>
                  <th key={i} className={`px-2.5 py-2 font-semibold ${i===0?'text-start':'text-center'} whitespace-nowrap`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.functions.map((f: any) => (
                <tr key={f.function_name} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-2.5 py-2 text-white font-semibold">{f.function_name}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{f.employees}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{n0(f.working_days)}</td>
                  <td className="px-2.5 py-2 text-center font-semibold" style={{ color: f.sick_days>0?'#f59e0b':'#e2e8f0' }}>{f.sick_days}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{f.leave_days}</td>
                  <td className="px-2.5 py-2 text-center font-semibold" style={{ color: f.absence_days>0?'#f43f5e':'#e2e8f0' }}>{f.absence_days}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{f.late_count}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{f.ot_hours?Number(f.ot_hours).toFixed(0):'—'}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{n0(f.calls)}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{hms(f.aht_sec)}</td>
                  <td className="px-2.5 py-2 text-center text-slate-300">{pct(f.occupancy)}</td>
                  <td className="px-2.5 py-2 text-center font-semibold" style={{ color: cf(f.conformance_pct) }}>{pct(f.conformance_pct)}</td>
                  <td className="px-2.5 py-2 text-center text-white font-bold">{f.avg_net ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── per-employee detail panel ───────────────────────────────────────────── */
function DetailPanel({ d, ar }: { d: any; ar: boolean }) {
  const s = d.summary || {};
  const MK: Record<string,{ar:string;c:string}> = {
    present:{ar:'حضور',c:'#22c55e'}, sick:{ar:'سيك',c:'#f59e0b'}, leave:{ar:'إجازة',c:'#06b6d4'},
    absent:{ar:'غياب',c:'#f43f5e'}, off:{ar:'أوف',c:'#475569'}, holiday:{ar:'عطلة',c:'#8b5cf6'}, comp:{ar:'تعويضي',c:'#10b981'} };
  const stat = [
    { ic: CalendarDays, l: ar?'أيام عمل':'Work days', v: s.working_days, c:'#6366f1' },
    { ic: Coffee, l: ar?'سيك':'Sick', v: s.sick_days, c:'#f59e0b' },
    { ic: Coffee, l: ar?'إجازة':'Leave', v: s.leave_days, c:'#06b6d4' },
    { ic: X, l: ar?'غياب':'Absence', v: s.absence_days, c:'#f43f5e' },
    { ic: Clock, l: ar?'تأخير':'Late', v: s.late_count, c:'#f59e0b' },
    { ic: Clock, l: 'OT h', v: s.ot_hours, c:'#10b981' },
    { ic: Activity, l: ar?'مكالمات':'Calls', v: s.calls, c:'#6366f1' },
    { ic: Activity, l: 'AHT', v: hms(s.aht_sec), c:'#06b6d4' },
    { ic: Activity, l: ar?'إشغال':'Occ', v: pct(s.occupancy), c:'#22c55e' },
    { ic: Award, l: ar?'سكور':'Score', v: s.avg_net ?? '—', c:'#8b5cf6' },
  ];
  return (
    <div className="space-y-3 pt-3">
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        {stat.map((x,i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.04)' }}>
            <x.ic size={14} style={{ color:x.c }} />
            <div><p className="text-[9px] text-slate-500 uppercase">{x.l}</p><p className="text-sm font-bold text-white leading-none">{typeof x.v==='number'?n0(x.v):x.v}</p></div>
          </div>
        ))}
      </div>

      {/* score trend */}
      {(d.scoreTrend||[]).length>0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{ar?'اتجاه السكور (نقاط شهرية)':'Score trend (monthly net points)'}</p>
          <div className="flex items-end gap-1 h-16">
            {d.scoreTrend.map((m:any,i:number) => {
              const h = Math.max(4, Math.min(100, (m.avg_net/130)*100));
              return <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${m.year}-${m.month}: ${m.avg_net}`}>
                <div className="w-full rounded-t" style={{ height:`${h}%`, background: cf(m.avg_net>=90?96:m.avg_net>=75?88:72) }} />
                <span className="text-[8px] text-slate-600">{m.month}</span>
              </div>;
            })}
          </div>
        </div>
      )}

      {/* daily attendance strip */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{ar?'الحضور اليومي':'Daily attendance'}</p>
        <div className="flex flex-wrap gap-1">
          {(d.daily||[]).map((day:any,i:number) => {
            const m = MK[day.marker] || { ar:day.marker, c:'#334155' };
            const late = day.late>0;
            return <div key={i} title={`${day.date} · ${day.marker}${late?` · late ${day.late}m`:''}${day.ot?` · OT ${day.ot}m`:''}`}
              className="w-6 h-6 rounded flex items-center justify-center text-[8px] font-bold"
              style={{ background:`${m.c}33`, color:m.c, border: late?'1px solid #f59e0b':'1px solid transparent' }}>
              {Number(day.date.slice(8,10))}
            </div>;
          })}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(MK).map(([k,v]) => <span key={k} className="flex items-center gap-1 text-[9px] text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background:v.c }} />{ar?v.ar:k}</span>)}
        </div>
      </div>
    </div>
  );
}
