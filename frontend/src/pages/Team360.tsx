import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, ShieldCheck, Clock, Timer, Coffee, UserX, ListChecks, CalendarDays, Briefcase, UserSearch,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=>{ if(!m) return '0'; const h=Math.floor(m/60),mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';

/** Team 360 — a team-leader's whole team WFM card: aggregate KPIs + per-agent
 *  breakdown + shift distribution. */
export default function Team360Page() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [tl, setTl] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true); const [sort, setSort] = useState('conformance');

  const load = useCallback(() => {
    setLoading(true);
    const qp = new URLSearchParams(); if (tl) qp.set('teamLeader',tl); if (from) qp.set('from',from); if (to) qp.set('to',to);
    apiClient.get(`/attendance-recon/roster-v2/team-360?${qp}`).then((r:any)=>{ setD(r.data); if(!tl) setTl(r.data.teamLeader); if(!from) setFrom(r.data.from); if(!to) setTo(r.data.to); })
      .catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [tl, from, to]);
  useEffect(() => { const t=setTimeout(load,200); return ()=>clearTimeout(t); }, [load]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const s = d?.summary;
  const agents = [...(d?.agents||[])].sort((a:any,b:any)=>{
    if (sort==='conformance') return (a.conformance??999)-(b.conformance??999);
    if (sort==='late') return b.lateMin-a.lateMin; if (sort==='ot') return b.otMin-a.otMin;
    if (sort==='worked') return b.worked-a.worked; return (a.name||'').localeCompare(b.name||'');
  });
  const shMax = Math.max(...(d?.byShift||[]).map((x:any)=>x.n),1);

  const kpis = s ? [
    { ic:Users, l:ar?'موظفون':'Agents', v:s.agents, c:'#6366f1' },
    { ic:Briefcase, l:ar?'أيام عمل':'Worked', v:s.workeddays, c:'#22c55e' },
    { ic:ShieldCheck, l:ar?'كونفورمانس':'Conformance', v:s.conformance!=null?s.conformance+'%':'—', c:adhC(s.conformance) },
    { ic:Clock, l:ar?'أيام تأخير':'Late days', v:s.latedays, sub:dur(s.latemin), c:'#f59e0b' },
    { ic:Timer, l:ar?'OT (بعد)':'OT after', v:dur(s.otafter), c:'#10b981' },
    { ic:Coffee, l:ar?'سيك':'Sick', v:s.sick, c:'#f59e0b' },
    { ic:UserX, l:ar?'غياب':'Absent', v:s.absent, c:'#f43f5e' },
    { ic:ListChecks, l:ar?'استئذانات':'Permissions', v:s.permissions, c:'#8b5cf6' },
  ] : [];

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/wfm-overview')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#06b6d4,#8b5cf6)' }}><Users size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[180px]"><h1 className="text-lg font-bold text-white">{ar?'ملف الفريق 360':'Team 360'}</h1>
          <p className="text-xs text-slate-500">{ar?'أداء فريق التيم ليدر كامل — تجميعي + لكل موظف':'A whole team-leader’s team — aggregate + per agent'}</p></div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inputCls}/></div>
        <select value={tl} onChange={e=>setTl(e.target.value)} className={`${inputCls} min-w-[160px]`}>
          {(d?.teamLeaders||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && s && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {kpis.map((x,i)=>(
            <div key={i} className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={18}/></div>
              <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{x.l}</p>
                <p className="text-xl font-bold text-white leading-tight">{typeof x.v==='number'?x.v.toLocaleString():x.v}</p>{x.sub&&<p className="text-[9px] text-slate-500">{x.sub}</p>}</div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-3">
          {/* per-agent breakdown */}
          <div className="lg:col-span-2 rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-2 mb-3"><Users size={14} className="text-indigo-400"/><h3 className="text-sm font-bold text-white">{ar?'تفصيل الفريق (لكل موظف)':'Team breakdown (per agent)'}</h3>
              <select value={sort} onChange={e=>setSort(e.target.value)} className={`${inputCls} ms-auto`}>
                {[['conformance',ar?'الأقل كونفورمانس':'Lowest conf'],['late',ar?'الأكثر تأخيراً':'Most late'],['ot',ar?'الأكثر OT':'Most OT'],['worked',ar?'الأكثر عملاً':'Most worked'],['name',ar?'الاسم':'Name']].map(([k,l])=><option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="text-slate-500">{[ar?'الموظف':'Agent',ar?'الدور':'Role',ar?'عمل':'Worked',ar?'تأخير':'Late',ar?'OT':'OT',ar?'سيك':'Sick',ar?'غياب':'Abs',ar?'كونف%':'Conf%'].map((h,i)=><th key={i} className={`pb-1.5 font-semibold ${i===0?'text-start':'text-center'}`}>{h}</th>)}</tr></thead>
              <tbody>{agents.map((a:any,i:number)=>(
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={()=>nav('/agent-360')}>
                  <td className="py-1 text-slate-200">{a.name}</td>
                  <td className="py-1 text-center text-slate-400">{a.role}</td>
                  <td className="py-1 text-center text-slate-300">{a.worked}</td>
                  <td className="py-1 text-center" style={{ color:a.lateMin>0?'#f59e0b':'#475569' }}>{a.lateDays?`${a.lateDays} (${dur(a.lateMin)})`:'·'}</td>
                  <td className="py-1 text-center text-emerald-300">{a.otMin?dur(a.otMin):'·'}</td>
                  <td className="py-1 text-center" style={{ color:a.sick?'#fbbf24':'#475569' }}>{a.sick||'·'}</td>
                  <td className="py-1 text-center" style={{ color:a.absent?'#f87171':'#475569' }}>{a.absent||'·'}</td>
                  <td className="py-1 text-center font-bold" style={{ color:adhC(a.conformance) }}>{a.conformance!=null?a.conformance+'%':'—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
          {/* shift distribution */}
          <div className="rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-sm font-bold text-white mb-3">{ar?'توزيع شفتات الفريق':'Team shift distribution'}</h3>
            {(d.byShift||[]).slice(0,14).map((x:any,i:number)=>(
              <div key={i} className="flex items-center gap-2 text-[11px] mb-1">
                <span className="w-16 text-slate-300 font-mono">{x.k||'—'}</span>
                <div className="flex-1 h-3 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.04)' }}><div className="h-full rounded" style={{ width:`${100*x.n/shMax}%`, background:'linear-gradient(90deg,#6366f1cc,#8b5cf677)' }}/></div>
                <span className="w-8 text-end text-slate-200 font-semibold">{x.n}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-slate-500 flex items-center gap-1"><UserSearch size={11}/>{ar?'اضغط أي موظف لفتح ملفه 360':'click any agent to open their 360 profile'}</p>
      </>)}
    </div>
  );
}
