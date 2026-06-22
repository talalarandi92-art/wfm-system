import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trophy, CalendarDays, Search, Medal, Info } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=>{ if(!m) return '0'; const h=Math.floor(m/60),mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const GRADE_C: Record<string,string> = { A:'#22c55e', B:'#06b6d4', C:'#f59e0b', D:'#f43f5e' };
const scoreC = (v:number)=> v>=85?'#22c55e':v>=70?'#06b6d4':v>=55?'#f59e0b':'#f43f5e';

/** Attendance & Adherence leaderboard — composite score (0-100, grade A-D) per agent.
 *  NOT the official performance scorecard (AHT/quality/quiz) — attendance/adherence only. */
export default function AgentScoresPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [incRoles, setIncRoles] = useState(false); const [search, setSearch] = useState('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams(); if (from) q.set('from',from); if (to) q.set('to',to); if (incRoles) q.set('includeExcludedRoles','1');
    apiClient.get(`/attendance-recon/roster-v2/agent-scores?${q}`).then((r:any)=>{ setD(r.data); if(!from) setFrom(r.data.from); if(!to) setTo(r.data.to); })
      .catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [from, to, incRoles]);
  useEffect(() => { const t=setTimeout(load,200); return ()=>clearTimeout(t); }, [load]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const agents = (d?.agents||[]).filter((a:any)=>{ const s=search.toLowerCase().trim(); return !s || a.name?.toLowerCase().includes(s) || String(a.person_no).includes(s); });
  const dist = d?.distribution||{}; const distTotal = Object.values(dist).reduce((x:number,y:any)=>x+Number(y),0)||1;

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/wfm-overview')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#f59e0b,#22c55e)' }}><Trophy size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[180px]"><h1 className="text-lg font-bold text-white">{ar?'لوحة ترتيب الحضور والالتزام':'Attendance & Adherence Leaderboard'}</h1>
          <p className="text-xs text-slate-500">{ar?'درجة مركّبة لكل موظف — حضور + كونفورمانس + التزام (ليست السكور كارد الرسمي)':'composite per-agent score — attendance + conformance + punctuality (not the official scorecard)'}</p></div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inputCls}/></div>
        <div className="flex items-center gap-1.5"><Search size={14} className="text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={ar?'بحث':'Search'} className={inputCls}/></div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer px-2 py-1 rounded-lg" style={{ background:incRoles?'rgba(99,102,241,0.18)':'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
          <input type="checkbox" checked={incRoles} onChange={e=>setIncRoles(e.target.checked)} className="accent-indigo-500"/>{ar?'+ أدوار 8 ساعات':'+ 8h roles'}</label>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && (<>
        {/* summary: average + grade distribution */}
        <div className="flex flex-wrap items-center gap-4 p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 uppercase font-semibold">{ar?'متوسط':'Average'}</span>
            <span className="text-2xl font-bold" style={{ color:scoreC(d.average) }}>{d.average}</span></div>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            {['A','B','C','D'].map(g=>(
              <div key={g} className="flex items-center gap-1.5">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold" style={{ background:`${GRADE_C[g]}22`, color:GRADE_C[g] }}>{g}</span>
                <span className="text-xs text-slate-300 font-semibold">{dist[g]||0}</span>
                <div className="w-20 h-2 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.05)' }}><div className="h-full rounded" style={{ width:`${100*(dist[g]||0)/distTotal}%`, background:GRADE_C[g] }}/></div>
              </div>
            ))}
          </div>
          <span className="text-[10px] text-slate-500 flex items-center gap-1"><Info size={11}/>{d.formula}</span>
        </div>

        {/* ranked list */}
        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'66vh' }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0" style={{ background:'#11162a' }}><tr className="text-slate-400">
              {['#',ar?'الموظف':'Agent',ar?'الدور':'Role',ar?'التيم ليدر':'TL',ar?'عمل':'Worked',ar?'كونف%':'Conf%',ar?'تأخير':'Late',ar?'غياب':'Abs',ar?'الدرجة':'Score',''].map((h,i)=><th key={i} className={`px-2 py-2 font-semibold whitespace-nowrap ${i<=1?'text-start':'text-center'}`}>{h}</th>)}
            </tr></thead>
            <tbody>{agents.map((a:any)=>(
              <tr key={a.person_no} className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={()=>nav('/agent-360')}>
                <td className="px-2 py-1.5 text-center font-bold" style={{ color:a.rank<=3?'#fbbf24':'#64748b' }}>{a.rank<=3?<Medal size={13} className="inline"/>:''}{a.rank}</td>
                <td className="px-2 py-1.5 text-white font-medium">{a.name}</td>
                <td className="px-2 py-1.5 text-slate-400">{a.role}</td>
                <td className="px-2 py-1.5 text-slate-500">{a.tl||'—'}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{a.worked}</td>
                <td className="px-2 py-1.5 text-center" style={{ color:scoreC(a.conf) }}>{a.conf}</td>
                <td className="px-2 py-1.5 text-center" style={{ color:a.lateDays?'#f59e0b':'#475569' }}>{a.lateDays||'·'}</td>
                <td className="px-2 py-1.5 text-center" style={{ color:a.absent?'#f87171':'#475569' }}>{a.absent||'·'}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5 justify-center"><div className="w-16 h-2 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.06)' }}><div className="h-full rounded" style={{ width:`${a.score}%`, background:scoreC(a.score) }}/></div>
                    <span className="font-bold w-6 text-end" style={{ color:scoreC(a.score) }}>{a.score}</span></div>
                </td>
                <td className="px-2 py-1.5 text-center"><span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background:`${GRADE_C[a.grade]}22`, color:GRADE_C[a.grade] }}>{a.grade}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
