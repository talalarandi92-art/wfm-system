import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, CalendarDays, ShieldCheck, Clock, LogOut, TimerReset, Timer, Coffee, UserX,
  ArrowLeft, Search, Building2, ListChecks, TrendingUp, Award,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m: number) => { if (!m) return '0'; const h=Math.floor(m/60), mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const adhC = (v: number) => v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';

export default function RosterDashboardPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [f, setF] = useState({ from:'2026-06-01', to:'2026-06-20', functionName:'', shift:'', teamManager:'', team:'', presence:'', day:'', search:'' });
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams(Object.entries(f).filter(([,v])=>v) as any); q.set('limit','10');
    apiClient.get(`/attendance-recon/roster-dashboard?${q}`).then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const s = d?.summary; const opt = d?.filterOptions;
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';

  const kpis = useMemo(() => s ? [
    { ic: Users, l: ar?'موظفين':'Agents', v: s.agents, sub: `${s.days} ${ar?'يوم':'days'}`, c:'#6366f1' },
    { ic: ShieldCheck, l: ar?'كونفورمانس':'Conformance', v: s.conformance!=null?s.conformance+'%':'—', c: adhC(s.conformance) },
    { ic: Clock, l: ar?'تأخير سيستم':'Late', v: s.late_days, sub: dur(s.late_min), c:'#f59e0b' },
    { ic: LogOut, l: ar?'خروج مبكر':'Early out', v: s.early_days, sub: dur(s.early_min), c:'#f59e0b' },
    { ic: TimerReset, l: ar?'OT قبل الشفت':'OT before', v: dur(s.ot_before), c:'#10b981' },
    { ic: Timer, l: ar?'OT بعد الشفت':'OT after', v: dur(s.ot_after), c:'#10b981' },
    { ic: Coffee, l: ar?'سيك':'Sick', v: s.sick, c:'#f59e0b' },
    { ic: UserX, l: ar?'غياب':'Absent', v: s.absent, c:'#f43f5e' },
    { ic: ListChecks, l: ar?'استئذانات':'Permissions', v: s.permissions, c:'#8b5cf6' },
    { ic: Building2, l: ar?'مكتب':'Office', v: s.office, c:'#22c55e' },
    { ic: Building2, l: 'WFH', v: s.wfh, c:'#06b6d4' },
    { ic: CalendarDays, l: ar?'أوف':'Off', v: s.off, c:'#64748b' },
  ] : [], [s, ar]);

  const RANKS: { key: string; ar: string; en: string; fmt: (v:any)=>string; color: string }[] = [
    { key:'mostLate', ar:'الأكثر تأخيراً', en:'Most late', fmt:dur, color:'#f59e0b' },
    { key:'mostEarly', ar:'الأكثر خروجاً مبكراً', en:'Most early out', fmt:dur, color:'#f59e0b' },
    { key:'otAfter', ar:'الأكثر OT بعد الشفت', en:'Most OT after', fmt:dur, color:'#10b981' },
    { key:'otBefore', ar:'الأكثر OT قبل الشفت', en:'Most OT before', fmt:dur, color:'#10b981' },
    { key:'lowestConformance', ar:'الأقل كونفورمانس', en:'Lowest conformance', fmt:(v)=>`${v}%`, color:'#f43f5e' },
    { key:'mostAbsent', ar:'الأكثر غياباً', en:'Most absent', fmt:(v)=>`${v}`, color:'#f43f5e' },
    { key:'mostSick', ar:'الأكثر سيك', en:'Most sick', fmt:(v)=>`${v}`, color:'#f59e0b' },
    { key:'mostPermissions', ar:'الأكثر استئذاناً', en:'Most permissions', fmt:(v)=>`${v}`, color:'#8b5cf6' },
  ];

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}><TrendingUp size={20} className="text-white"/></div>
        <div><h1 className="text-lg font-bold text-white">{ar?'داشبورد الروستر التفصيلي':'Roster Analytics Dashboard'}</h1>
          <p className="text-xs text-slate-500">{ar?'ديناميكي بالكامل — فلتر بالتاريخ/الفنكشن/الشفت/التيم ليدر/الجروب/اليوم':'Fully dynamic — filter by date / function / shift / team leader / group / day'}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={f.from} onChange={e=>set('from',e.target.value)} className={inputCls}/>
          <span className="text-xs">→</span>
          <input type="date" value={f.to} onChange={e=>set('to',e.target.value)} className={inputCls}/>
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-[140px]"><Search size={14} className="text-slate-400"/>
          <input value={f.search} onChange={e=>set('search',e.target.value)} placeholder={ar?'بحث بالاسم/الرقم':'Name / no'} className={`${inputCls} flex-1`}/></div>
        {([['functionName','functions',ar?'كل الفنكشن':'All functions'],['shift','shifts',ar?'كل الشفتات':'All shifts'],['teamManager','teamManagers',ar?'كل التيم ليدرز':'All team leaders'],['team','teams',ar?'كل الجروبات':'All teams'],['day','days',ar?'كل الأيام':'All days']] as [string,string,string][]).map(([k,o,label])=>(
          <select key={k} value={(f as any)[k]} onChange={e=>set(k,e.target.value)} className={inputCls}>
            <option value="">{label}</option>
            {(opt?.[o]||[]).map((v:string)=><option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        <select value={f.presence} onChange={e=>set('presence',e.target.value)} className={inputCls}>
          <option value="">{ar?'كل الحالات':'All presence'}</option>
          {['office','wfh','off','leave','absent','sick'].map(v=><option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {kpis.map((x,i)=>(
            <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={16}/></div>
              <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold tracking-wide truncate">{x.l}</p>
                <p className="text-lg font-bold text-white leading-tight">{typeof x.v==='number'?x.v.toLocaleString():x.v}</p>
                {x.sub && <p className="text-[9px] text-slate-500">{x.sub}</p>}</div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {RANKS.map(rk => { const list = d.rankings?.[rk.key] || [];
            return (
              <div key={rk.key} className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-1.5 mb-2.5"><Award size={13} style={{ color:rk.color }}/><h3 className="text-xs font-bold text-white">{ar?rk.ar:rk.en}</h3></div>
                <div className="space-y-1.5">
                  {list.length===0 && <p className="text-[11px] text-slate-600">—</p>}
                  {list.slice(0,8).map((a:any,i:number)=>(
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-600 w-3">{i+1}</span>
                      <div className="flex-1 min-w-0"><p className="text-[11px] text-slate-200 font-medium truncate">{a.name}</p>
                        <p className="text-[9px] text-slate-500 truncate">{a.function_name||'—'}{a.team_manager?` · ${a.team_manager}`:''}</p></div>
                      <span className="text-[11px] font-bold flex-shrink-0" style={{ color:rk.color }}>{rk.fmt(a.v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {([['byShift',ar?'حسب الشفت':'By shift'],['byFunction',ar?'حسب الفنكشن':'By function'],['byTeamManager',ar?'حسب التيم ليدر':'By team leader']] as [string,string][]).map(([key,title])=>{
            const list = d.distributions?.[key] || []; const max = Math.max(...list.map((x:any)=>x.n),1);
            return (
              <div key={key} className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                <h3 className="text-xs font-bold text-white mb-2.5">{title}</h3>
                <div className="space-y-1.5">
                  {list.slice(0,12).map((x:any,i:number)=>(
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 truncate text-slate-300" title={x.k}>{x.k}</span>
                      <div className="flex-1 h-3.5 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.04)' }}>
                        <div className="h-full rounded" style={{ width:`${Math.max(4,100*x.n/max)}%`, background:'linear-gradient(90deg,#6366f1cc,#8b5cf677)' }}/></div>
                      <span className="text-slate-200 font-semibold w-8 text-end">{x.n}</span>
                      <span className="w-12 text-end" style={{ color:adhC(x.conformance) }}>{x.conformance!=null?x.conformance+'%':'—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </>)}
    </div>
  );
}
