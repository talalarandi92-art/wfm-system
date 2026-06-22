import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, ShieldCheck, Clock, Timer, Coffee, UserX, ListChecks, Building2,
  Wrench, GitCompareArrows, BarChart4, UserSearch, FileSpreadsheet, Table2, AlertTriangle, CalendarDays, Award, ClipboardCheck, Sparkles, ChevronRight,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=>{ if(!m) return '0'; const h=Math.floor(m/60),mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';

/** Executive WFM Overview — the command-center landing for the roster suite.
 *  Headline KPIs + data-quality health + top rankings + quick-access tiles. */
export default function WfmOverviewPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [dash, setDash] = useState<any>(null); const [integ, setInteg] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<{a?:string;b?:string}>({});
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [insights, setInsights] = useState<any[]>([]);

  useEffect(() => {
    apiClient.get('/attendance-recon/roster-v2/integrity').then((r:any)=>setInteg(r.data)).catch(()=>{});
  }, []);
  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams(); if (from) q.set('from',from); if (to) q.set('to',to);
    apiClient.get(`/attendance-recon/roster-dashboard?${q}`).then((r:any)=>{ setDash(r.data); if(r.data.range){ setRange(r.data.range); if(!from)setFrom(r.data.from); if(!to)setTo(r.data.to); } })
      .catch(()=>setDash(null)).finally(()=>setLoading(false));
    apiClient.get(`/attendance-recon/roster-v2/insights?${q}`).then((r:any)=>setInsights(r.data.insights||[])).catch(()=>setInsights([]));
  }, [from, to]);

  const s = dash?.summary; const h = integ?.headline;
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const flaggedTLs = (integ?.teamLeaders||[]).filter((t:any)=>!t.verified);

  const kpis = s ? [
    { ic:Users, l:ar?'موظفون نشطون':'Active agents', v:s.agents, c:'#6366f1' },
    { ic:ShieldCheck, l:ar?'كونفورمانس':'Conformance', v:s.conformance!=null?s.conformance+'%':'—', c:adhC(s.conformance) },
    { ic:Clock, l:ar?'أيام تأخير':'Late days', v:s.late_days, sub:dur(s.late_min), c:'#f59e0b' },
    { ic:Timer, l:ar?'OT بعد':'OT after', v:dur(s.ot_after), c:'#10b981' },
    { ic:Coffee, l:ar?'سيك':'Sick', v:s.sick, c:'#f59e0b' },
    { ic:UserX, l:ar?'غياب':'Absent', v:s.absent, c:'#f43f5e' },
    { ic:ListChecks, l:ar?'استئذانات':'Permissions', v:s.permissions, c:'#8b5cf6' },
    { ic:Building2, l:'WFH', v:s.wfh, c:'#06b6d4' },
  ] : [];

  const TILES: { ic:any; ar:string; en:string; to:string; c:string }[] = [
    { ic:LayoutDashboard, ar:'الداشبورد التفصيلي', en:'Analytics Dashboard', to:'/roster-dashboard', c:'#6366f1' },
    { ic:LayoutDashboard, ar:'باني الداشبورد', en:'Dashboard Builder', to:'/dashboard-builder', c:'#8b5cf6' },
    { ic:Wrench, ar:'منشئ التقارير', en:'Report Builder', to:'/report-builder', c:'#a78bfa' },
    { ic:BarChart4, ar:'الهيدكاونت بالفترات', en:'Interval Headcount', to:'/interval-headcount', c:'#06b6d4' },
    { ic:UserSearch, ar:'ملف الموظف 360', en:'Agent 360', to:'/agent-360', c:'#c4b5fd' },
    { ic:Users, ar:'ملف الفريق 360', en:'Team 360', to:'/team-360', c:'#67e8f9' },
    { ic:Award, ar:'لوحة الترتيب', en:'Leaderboard', to:'/agent-scores', c:'#fbbf24' },
    { ic:ClipboardCheck, ar:'لوحة السكور كارد', en:'Scorecard Board', to:'/scorecard-board', c:'#f59e0b' },
    { ic:GitCompareArrows, ar:'الاتجاهات', en:'Trends', to:'/trends', c:'#34d399' },
    { ic:GitCompareArrows, ar:'سجل تغييرات الجدول', en:'Change Log', to:'/schedule-change-log', c:'#818cf8' },
    { ic:ShieldCheck, ar:'جودة البيانات', en:'Data Quality', to:'/data-quality', c:'#fbbf24' },
    { ic:ClipboardCheck, ar:'تدقيق النظام', en:'System Audit', to:'/system-audit', c:'#94a3b8' },
    { ic:Table2, ar:'الروستر', en:'Roster', to:'/roster', c:'#22c55e' },
  ];

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#06b6d4)' }}><LayoutDashboard size={22} className="text-white"/></div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-xl font-bold text-white">{ar?'نظرة WFM التنفيذية':'Executive WFM Overview'}</h1>
          <p className="text-xs text-slate-500">{ar?'مركز القيادة — مؤشرات، صحة البيانات، الترتيب، ووصول سريع لكل الأدوات':'Command center — KPIs, data health, rankings & quick access to every tool'}</p></div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} min={range.a} max={range.b} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} min={range.a} max={range.b} className={inputCls}/></div>
      </div>

      {/* data-quality health strip */}
      {h && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl" style={{ background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.18)' }}>
          <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-300"><ShieldCheck size={15}/>{ar?'صحة البيانات':'Data health'}</span>
          <span className="text-[11px] text-slate-300">{ar?'أشخاص فعليون':'Real people'}: <b className="text-white">{h.persons}</b> <span className="text-slate-500">({h.raw_ids} {ar?'رقم خام، دُمج':'raw IDs, merged'} {h.aliases})</span></span>
          <span className="text-[11px] text-slate-300">{ar?'غير نشطين':'Inactive'}: <b className="text-white">{h.inactive_persons}</b></span>
          <span className="text-[11px] text-slate-300">{ar?'أيتام':'Orphans'}: <b className="text-white">{integ.orphans?.length||0}</b></span>
          {flaggedTLs.length>0 && <span className="text-[11px] text-amber-300 flex items-center gap-1"><AlertTriangle size={12}/>{ar?'تيم ليدرز للمراجعة':'TLs to review'}: {flaggedTLs.map((t:any)=>`${t.name} (${t.status})`).join(', ')}</span>}
          <button onClick={()=>nav('/data-quality')} className="ms-auto text-[11px] text-emerald-300 px-2.5 py-1 rounded-lg" style={{ background:'rgba(34,197,94,0.12)' }}>{ar?'التفاصيل':'Details →'}</button>
        </div>
      )}

      {/* auto-prioritized WFM insights */}
      {insights.length>0 && (
        <div className="rounded-2xl p-4" style={{ background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.2)' }}>
          <div className="flex items-center gap-2 mb-3"><Sparkles size={15} className="text-violet-300"/><h3 className="text-sm font-bold text-white">{ar?'رؤى وتنبيهات WFM':'WFM Insights'}</h3>
            <span className="text-[10px] text-slate-500">{ar?'مرتّبة حسب الأهمية — اضغط للتفاصيل':'auto-prioritized — click to drill in'}</span></div>
          <div className="grid md:grid-cols-2 gap-2">
            {insights.map((x:any,i:number)=>{ const c={critical:'#f43f5e',warning:'#f59e0b',info:'#06b6d4'}[x.severity as string]||'#64748b';
              return (
                <button key={i} onClick={()=>x.link&&nav(x.link)} className="flex items-start gap-2.5 p-2.5 rounded-xl text-start hover:bg-white/[0.03]" style={{ background:`${c}11`, border:`1px solid ${c}33` }}>
                  <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background:c }}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-slate-100">{x.title}</p>
                    <p className="text-[10px] text-slate-400 truncate">{x.detail}</p>
                  </div>
                  {x.link && <ChevronRight size={14} className="text-slate-600 flex-shrink-0 mt-0.5"/>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500 py-6 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}

      {!loading && s && (<>
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {kpis.map((x,i)=>(
            <div key={i} className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={18}/></div>
              <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{x.l}</p>
                <p className="text-xl font-bold text-white leading-tight">{typeof x.v==='number'?x.v.toLocaleString():x.v}</p>{x.sub&&<p className="text-[9px] text-slate-500">{x.sub}</p>}</div>
            </div>
          ))}
        </div>

        {/* tiles + top rankings */}
        <div className="grid lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TILES.map((tl,i)=>(
              <button key={i} onClick={()=>nav(tl.to)} className="flex flex-col items-start gap-2 p-3 rounded-xl text-start hover:scale-[1.02] transition-transform" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background:`${tl.c}22`, color:tl.c }}><tl.ic size={17}/></div>
                <span className="text-[11px] font-semibold text-slate-200 leading-tight">{ar?tl.ar:tl.en}</span>
              </button>
            ))}
          </div>
          {/* top late + lowest conformance mini-boards */}
          <div className="space-y-3">
            {([['mostLate',ar?'الأكثر تأخيراً':'Most late','#f59e0b',(v:any)=>dur(v)],['lowestConformance',ar?'الأقل كونفورمانس':'Lowest conformance','#f43f5e',(v:any)=>`${v}%`]] as [string,string,string,(v:any)=>string][]).map(([key,title,col,fmt])=>(
              <div key={key} className="rounded-2xl p-3" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-1.5 mb-2"><Award size={12} style={{ color:col }}/><h3 className="text-[11px] font-bold text-white">{title}</h3></div>
                {(dash.rankings?.[key]||[]).slice(0,5).map((a:any,i:number)=>(
                  <div key={i} className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-slate-600 w-3">{i+1}</span>
                    <span className="flex-1 text-[11px] text-slate-200 truncate">{a.name}</span>
                    <span className="text-[11px] font-bold" style={{ color:col }}>{fmt(a.v)}</span>
                  </div>
                ))}
                {(!dash.rankings?.[key]||!dash.rankings[key].length)&&<p className="text-[11px] text-slate-600">—</p>}
              </div>
            ))}
          </div>
        </div>

        {/* exports */}
        <div className="flex flex-wrap gap-2">
          <button onClick={async()=>{ const q=new URLSearchParams(); if(from)q.set('from',from); if(to)q.set('to',to); try{ const r:any=await apiClient.get(`/attendance-recon/roster-v2/executive-export?${q}`,{ responseType:'blob' }); const u=URL.createObjectURL(r.data); const a=document.createElement('a'); a.href=u; a.download='WFM_Executive_Summary.xlsx'; a.click(); URL.revokeObjectURL(u);}catch{} }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={{ background:'linear-gradient(135deg,#6366f1,#22c55e)', color:'#fff' }}><FileSpreadsheet size={14}/>{ar?'الملخّص التنفيذي (للإدارة)':'Executive Summary (for management)'}</button>
          <button onClick={async()=>{ try{ const r:any=await apiClient.get('/attendance-recon/roster-v2/master-export',{ responseType:'blob' }); const u=URL.createObjectURL(r.data); const a=document.createElement('a'); a.href=u; a.download='WFM_Master.xlsx'; a.click(); URL.revokeObjectURL(u);}catch{} }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e' }}><FileSpreadsheet size={14}/>{ar?'الماستر (11 شيت)':'Master (11 sheets)'}</button>
          <button onClick={()=>nav('/report-builder')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background:'rgba(99,102,241,0.15)', color:'#a5b4fc' }}><Wrench size={14}/>{ar?'36 تقرير جاهز':'36 ready reports'}</button>
        </div>
      </>)}
    </div>
  );
}
