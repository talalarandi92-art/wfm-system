import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, LayoutDashboard, Save, RotateCcw, Download, Plus, X, CalendarDays, Search,
  Users, ShieldCheck, Clock, LogOut, TimerReset, Timer, Coffee, UserX, ListChecks, Building2, BarChart3,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=>{ if(!m) return '0'; const h=Math.floor(m/60),mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';

// KPI cards available from the /roster-dashboard summary
const KPI_CARDS: { key:string; ar:string; en:string; ic:any; c:string; fmt?:(v:any)=>string; sub?:(s:any)=>string }[] = [
  { key:'agents', ar:'موظفين', en:'Agents', ic:Users, c:'#6366f1' },
  { key:'conformance', ar:'كونفورمانس', en:'Conformance', ic:ShieldCheck, c:'#06b6d4', fmt:(v)=>v!=null?v+'%':'—' },
  { key:'late_days', ar:'أيام تأخير', en:'Late days', ic:Clock, c:'#f59e0b', sub:(s)=>dur(s.late_min) },
  { key:'early_days', ar:'خروج مبكر', en:'Early out', ic:LogOut, c:'#f59e0b', sub:(s)=>dur(s.early_min) },
  { key:'ot_before', ar:'OT قبل', en:'OT before', ic:TimerReset, c:'#10b981', fmt:dur },
  { key:'ot_after', ar:'OT بعد', en:'OT after', ic:Timer, c:'#10b981', fmt:dur },
  { key:'sick', ar:'سيك', en:'Sick', ic:Coffee, c:'#f59e0b' },
  { key:'absent', ar:'غياب', en:'Absent', ic:UserX, c:'#f43f5e' },
  { key:'permissions', ar:'استئذانات', en:'Permissions', ic:ListChecks, c:'#8b5cf6' },
  { key:'office', ar:'مكتب', en:'Office', ic:Building2, c:'#22c55e' },
  { key:'wfh', ar:'WFH', en:'WFH', ic:Building2, c:'#06b6d4' },
  { key:'worked', ar:'أيام عمل', en:'Worked', ic:CalendarDays, c:'#6366f1' },
];
const DIMS: { key:string; ar:string; en:string }[] = [
  { key:'role', ar:'الدور', en:'Role' }, { key:'function', ar:'الفنكشن', en:'Function' }, { key:'shift', ar:'الشفت', en:'Shift' },
  { key:'teamLeader', ar:'التيم ليدر', en:'Team Leader' }, { key:'group', ar:'الجروب', en:'Group' }, { key:'day', ar:'اليوم', en:'Day' },
  { key:'week', ar:'الأسبوع', en:'Week' }, { key:'month', ar:'الشهر', en:'Month' }, { key:'status', ar:'الحالة', en:'Status' }, { key:'lateCategory', ar:'فئة التأخير', en:'Late band' },
];
const METRICS: { key:string; ar:string; en:string; time?:boolean; pct?:boolean }[] = [
  { key:'scheduledDays', ar:'أيام مجدولة', en:'Scheduled' }, { key:'workedDays', ar:'أيام عمل', en:'Worked' },
  { key:'lateMin', ar:'دقائق تأخير', en:'Late min', time:true }, { key:'otMin', ar:'OT', en:'OT min', time:true },
  { key:'otBefore', ar:'OT قبل', en:'OT before', time:true }, { key:'otAfter', ar:'OT بعد', en:'OT after', time:true },
  { key:'conformance', ar:'كونفورمانس', en:'Conformance', pct:true }, { key:'absenceDays', ar:'غياب', en:'Absence' },
  { key:'sickDays', ar:'سيك', en:'Sick' }, { key:'permissionCount', ar:'استئذانات', en:'Permissions' }, { key:'agents', ar:'موظفين', en:'Agents' },
];

type ChartCfg = { dim:string; metric:string };
const DEFAULT = {
  cards: ['agents','conformance','late_days','ot_after','sick','absent'],
  charts: [{ dim:'role', metric:'scheduledDays' }, { dim:'shift', metric:'otMin' }, { dim:'teamLeader', metric:'conformance' }] as ChartCfg[],
};

export default function DashboardBuilderPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [f, setF] = useState({ from:'2026-06-01', to:'2026-06-29', function:'', role:'', shift:'', teamLeader:'', group:'', presence:'', search:'' });
  const [tog, setTog] = useState({ includeInactive:false, includeExcludedRoles:false });
  const [cards, setCards] = useState<string[]>(DEFAULT.cards);
  const [charts, setCharts] = useState<ChartCfg[]>(DEFAULT.charts);
  const [summary, setSummary] = useState<any>(null); const [opt, setOpt] = useState<any>(null);
  const [chartData, setChartData] = useState<Record<string, any[]>>({});
  const [views, setViews] = useState<Record<string, any>>(() => { try { return JSON.parse(localStorage.getItem('wfm.dashViews')||'{}'); } catch { return {}; } });
  const [picker, setPicker] = useState(false);

  const baseQ = useCallback(() => {
    const q = new URLSearchParams();
    q.set('from', f.from); q.set('to', f.to);
    for (const k of ['function','role','shift','teamLeader','group','search'] as const) if ((f as any)[k]) q.set(k, (f as any)[k]);
    if (f.presence) q.set('presence', f.presence);
    if (tog.includeInactive) q.set('includeInactive','1');
    return q;
  }, [f, tog]);

  // summary + filter options from the roster dashboard
  const loadSummary = useCallback(() => {
    const q = new URLSearchParams();
    q.set('from', f.from); q.set('to', f.to);
    if (f.function) q.set('functionName', f.function);
    for (const k of ['role','shift','presence','search'] as const) if ((f as any)[k]) q.set(k, (f as any)[k]);
    if (f.teamLeader) q.set('teamManager', f.teamLeader);
    if (f.group) q.set('team', f.group);
    if (tog.includeInactive) q.set('includeInactive','1');
    if (tog.includeExcludedRoles) q.set('includeExcludedRoles','1');
    apiClient.get(`/attendance-recon/roster-dashboard?${q}`).then((r:any)=>{ setSummary(r.data.summary); setOpt(r.data.filterOptions); }).catch(()=>setSummary(null));
  }, [f, tog]);

  // each chart panel = a report-builder summary call (groupBy dim + one metric)
  const loadCharts = useCallback(() => {
    charts.forEach((ch, idx) => {
      const q = baseQ(); q.set('groupBy', ch.dim); q.set('kpis', ch.metric);
      if (tog.includeExcludedRoles) q.set('includeExcludedRoles','1');
      apiClient.get(`/attendance-recon/report-builder?${q}`).then((r:any)=>{
        setChartData(prev => ({ ...prev, [idx]: r.data.rows || [] }));
      }).catch(()=>setChartData(prev=>({ ...prev, [idx]: [] })));
    });
  }, [charts, baseQ, tog]);

  useEffect(() => { const t = setTimeout(()=>{ loadSummary(); loadCharts(); }, 300); return ()=>clearTimeout(t); }, [loadSummary, loadCharts]);

  const set = (k:string,v:string)=>setF(p=>({ ...p, [k]:v }));
  const toggleCard = (k:string)=>setCards(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k]);
  const addChart = ()=>setCharts(p=>[...p, { dim:'function', metric:'workedDays' }]);
  const setChart = (i:number, patch:Partial<ChartCfg>)=>setCharts(p=>p.map((c,j)=>j===i?{ ...c, ...patch }:c));
  const rmChart = (i:number)=>{ setCharts(p=>p.filter((_,j)=>j!==i)); setChartData(p=>{ const n={...p}; delete n[i]; return n; }); };

  const saveView = () => {
    const name = window.prompt(ar?'اسم العرض:':'View name:'); if (!name) return;
    const v = { ...views, [name]: { f, tog, cards, charts } };
    setViews(v); localStorage.setItem('wfm.dashViews', JSON.stringify(v));
  };
  const loadView = (name:string) => { const v = views[name]; if (!v) return; setF(v.f); setTog(v.tog); setCards(v.cards); setCharts(v.charts); };
  const reset = () => { setF({ from:'2026-06-01', to:'2026-06-29', function:'', role:'', shift:'', teamLeader:'', group:'', presence:'', search:'' }); setTog({ includeInactive:false, includeExcludedRoles:false }); setCards(DEFAULT.cards); setCharts(DEFAULT.charts); };
  const exportXlsx = async () => {
    const q = baseQ();
    if (tog.includeExcludedRoles) q.set('includeExcludedRoles','1');
    q.set('format','xlsx'); q.set('fields','date,agent,role,function,teamLeader,shiftCode,attendanceStatus,lateMin,otBefore,otAfter,conformance');
    try {
      const r:any = await apiClient.get(`/attendance-recon/report-builder?${q}`, { responseType:'blob' });
      const u=URL.createObjectURL(r.data); const a=document.createElement('a'); a.href=u; a.download='custom-dashboard.xlsx'; a.click(); URL.revokeObjectURL(u);
    } catch { /* */ }
  };

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const activeCards = useMemo(()=>KPI_CARDS.filter(c=>cards.includes(c.key)), [cards]);

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/roster-dashboard')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}><LayoutDashboard size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-lg font-bold text-white">{ar?'باني الداشبورد المخصّص':'Custom Dashboard Builder'}</h1>
          <p className="text-xs text-slate-500">{ar?'اختر الكروت والرسوم والفلاتر — احفظ عرضك — صدّر':'Choose KPI cards, charts & filters — save your view — export'}</p></div>
        <div className="flex items-center gap-1.5">
          <button onClick={saveView} className="text-[11px] text-emerald-300 px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.25)' }}><Save size={13}/>{ar?'احفظ':'Save'}</button>
          <button onClick={exportXlsx} className="text-[11px] text-indigo-300 px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.25)' }}><Download size={13}/>Excel</button>
          <button onClick={reset} className="text-[11px] text-slate-300 px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)' }}><RotateCcw size={13}/>{ar?'تصفير':'Reset'}</button>
        </div>
      </div>

      {/* saved views */}
      {Object.keys(views).length>0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-slate-500">{ar?'عروض محفوظة:':'Saved views:'}</span>
          {Object.keys(views).map(n=>(
            <span key={n} className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-200" style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)' }}>
              <button onClick={()=>loadView(n)}>{n}</button>
              <button onClick={()=>{ const v={...views}; delete v[n]; setViews(v); localStorage.setItem('wfm.dashViews', JSON.stringify(v)); }} className="text-slate-500 hover:text-rose-400"><X size={11}/></button>
            </span>
          ))}
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={f.from} onChange={e=>set('from',e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={f.to} onChange={e=>set('to',e.target.value)} className={inputCls}/></div>
        <div className="flex items-center gap-1.5 flex-1 min-w-[140px]"><Search size={14} className="text-slate-400"/>
          <input value={f.search} onChange={e=>set('search',e.target.value)} placeholder={ar?'بحث':'Search'} className={`${inputCls} flex-1`}/></div>
        {([['function','functions',ar?'كل الفنكشن':'All functions'],['role','roles',ar?'كل الأدوار':'All roles'],['shift','shifts',ar?'كل الشفتات':'All shifts'],['teamLeader','teamManagers',ar?'كل التيم ليدرز':'All TLs'],['group','teams',ar?'كل الجروبات':'All groups']] as [string,string,string][]).map(([k,o,label])=>(
          <select key={k} value={(f as any)[k]} onChange={e=>set(k,e.target.value)} className={inputCls}>
            <option value="">{label}</option>{(opt?.[o]||[]).map((v:string)=><option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        {([['includeInactive',ar?'+ غير النشطين':'+ Inactive'],['includeExcludedRoles',ar?'+ أدوار 8 ساعات':'+ 8h roles']] as [string,string][]).map(([k,label])=>(
          <label key={k} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none px-2 py-1 rounded-lg" style={{ background:(tog as any)[k]?'rgba(99,102,241,0.18)':'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
            <input type="checkbox" checked={(tog as any)[k]} onChange={e=>setTog(p=>({ ...p, [k]:e.target.checked }))} className="accent-indigo-500"/>{label}
          </label>
        ))}
      </div>

      {/* KPI card picker */}
      <div className="rounded-2xl p-3" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <button onClick={()=>setPicker(p=>!p)} className="text-[11px] text-slate-400 flex items-center gap-1 mb-2"><Plus size={12}/>{ar?'اختر كروت المؤشرات':'Choose KPI cards'} ({cards.length})</button>
        {picker && <div className="flex flex-wrap gap-1.5 mb-2">{KPI_CARDS.map(c=>(
          <button key={c.key} onClick={()=>toggleCard(c.key)} className="px-2 py-1 rounded-lg text-[11px]" style={{ background:cards.includes(c.key)?`${c.c}22`:'rgba(255,255,255,0.04)', color:cards.includes(c.key)?c.c:'#94a3b8', border:`1px solid ${cards.includes(c.key)?c.c+'55':'rgba(255,255,255,0.08)'}` }}>{ar?c.ar:c.en}</button>
        ))}</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {activeCards.map(c=>{ const raw = summary?.[c.key]; const v = c.fmt?c.fmt(raw):(typeof raw==='number'?raw.toLocaleString():raw??'—');
            return (
              <div key={c.key} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${c.c}22`, color:c.c }}><c.ic size={16}/></div>
                <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold tracking-wide truncate">{ar?c.ar:c.en}</p>
                  <p className="text-lg font-bold text-white leading-tight">{v}</p>{c.sub&&summary&&<p className="text-[9px] text-slate-500">{c.sub(summary)}</p>}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* custom charts */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {charts.map((ch, i) => {
          const rows = chartData[i] || []; const met = METRICS.find(m=>m.key===ch.metric);
          const vals = rows.map((r:any)=>Number(r[ch.metric])||0); const max = Math.max(...vals, 1);
          const fmt = (v:number)=> met?.time ? dur(v) : met?.pct ? `${v}%` : v.toLocaleString();
          return (
            <div key={i} className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-1.5 mb-2.5">
                <BarChart3 size={13} className="text-indigo-400"/>
                <select value={ch.dim} onChange={e=>setChart(i,{ dim:e.target.value })} className="bg-transparent text-xs font-bold text-white outline-none">
                  {DIMS.map(dm=><option key={dm.key} value={dm.key} className="bg-slate-800">{ar?dm.ar:dm.en}</option>)}
                </select>
                <span className="text-slate-600 text-xs">·</span>
                <select value={ch.metric} onChange={e=>setChart(i,{ metric:e.target.value })} className="bg-transparent text-[11px] text-slate-300 outline-none flex-1">
                  {METRICS.map(m=><option key={m.key} value={m.key} className="bg-slate-800">{ar?m.ar:m.en}</option>)}
                </select>
                <button onClick={()=>rmChart(i)} className="text-slate-600 hover:text-rose-400"><X size={13}/></button>
              </div>
              <div className="space-y-1.5">
                {rows.length===0 && <p className="text-[11px] text-slate-600">—</p>}
                {rows.slice(0,12).map((r:any,j:number)=>{ const v=Number(r[ch.metric])||0;
                  return (
                    <div key={j} className="flex items-center gap-2 text-[11px] cursor-pointer hover:opacity-90"
                      onClick={()=>{ const dimMap:Record<string,string>={ role:'role', function:'function', shift:'shift', teamLeader:'teamLeader', group:'group' }; if (dimMap[ch.dim]) set(dimMap[ch.dim], r.group); }}>
                      <span className="w-24 truncate text-slate-300" title={r.group}>{r.group??'—'}</span>
                      <div className="flex-1 h-3.5 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.04)' }}>
                        <div className="h-full rounded" style={{ width:`${Math.max(4,100*v/max)}%`, background: met?.pct?`linear-gradient(90deg,${adhC(v)}cc,${adhC(v)}55)`:'linear-gradient(90deg,#6366f1cc,#8b5cf677)' }}/></div>
                      <span className="font-semibold w-14 text-end" style={{ color: met?.pct?adhC(v):'#e2e8f0' }}>{fmt(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <button onClick={addChart} className="rounded-2xl p-3.5 flex items-center justify-center gap-2 text-slate-400 hover:text-white min-h-[120px]" style={{ background:'rgba(255,255,255,0.02)', border:'1px dashed rgba(255,255,255,0.15)' }}>
          <Plus size={16}/>{ar?'أضف رسم':'Add chart'}</button>
      </div>
    </div>
  );
}
