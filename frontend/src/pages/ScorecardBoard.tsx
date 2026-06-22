import { useEffect, useState, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Search, ChevronDown, ChevronRight, Trophy } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

// score-vs-max colour
const sc = (v:number|null, max:number|null) => { if (v==null||!max) return '#475569'; const r=v/max; return r>=0.9?'#22c55e':r>=0.7?'#06b6d4':r>=0.5?'#f59e0b':'#f43f5e'; };
const netC = (v:number) => v>=100?'#22c55e':v>=80?'#06b6d4':v>=60?'#f59e0b':'#f43f5e';

/** Scorecard Board — the official scorecard at its real grain: one row per agent
 *  (avg of their weeks) with every KPI, expandable to the weekly W1–W5 detail. */
export default function ScorecardBoardPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [fn, setFn] = useState(''); const [tl, setTl] = useState(''); const [search, setSearch] = useState('');
  const [sort, setSort] = useState('net');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState<string>(''); const [weeks, setWeeks] = useState<Record<string,any>>({});

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams(); if (fn) q.set('function',fn); if (tl) q.set('teamLeader',tl);
    apiClient.get(`/attendance-recon/roster-v2/scorecard?${q}`).then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [fn, tl]);
  useEffect(() => { const t=setTimeout(load,200); return ()=>clearTimeout(t); }, [load]);

  const toggle = (pn:string) => {
    if (openRow===pn) { setOpenRow(''); return; } setOpenRow(pn);
    if (!weeks[pn]) apiClient.get(`/attendance-recon/roster-v2/scorecard?person=${pn}`).then((r:any)=>setWeeks(w=>({ ...w, [pn]:r.data.weeks||[] }))).catch(()=>{});
  };

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const kpis = d?.kpiMeta || [];
  const agents = (d?.agents||[]).filter((a:any)=>{ const s=search.toLowerCase().trim(); return !s || a.name?.toLowerCase().includes(s) || String(a.person_no).includes(s); })
    .sort((a:any,b:any)=> sort==='net' ? (Number(b.net||0)-Number(a.net||0)) : sort==='name' ? (a.name||'').localeCompare(b.name||'') : (Number(b[sort]||0)-Number(a[sort]||0)));

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/wfm-overview')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#f59e0b,#8b5cf6)' }}><ClipboardList size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[180px]"><h1 className="text-lg font-bold text-white">{ar?'لوحة السكور كارد':'Scorecard Board'}</h1>
          <p className="text-xs text-slate-500">{ar?'السكور كارد الرسمي على مستواه الحقيقي — لكل موظف (متوسط الأسابيع) + تفصيل أسبوعي':'the official scorecard at its true grain — per agent (avg of weeks) + weekly drill'}</p></div>
        <div className="flex items-center gap-1.5"><Search size={14} className="text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={ar?'بحث':'Search'} className={inputCls}/></div>
        <select value={fn} onChange={e=>setFn(e.target.value)} className={inputCls}><option value="">{ar?'كل الفنكشن':'All functions'}</option>{(d?.filterOptions?.functions||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
        <select value={tl} onChange={e=>setTl(e.target.value)} className={inputCls}><option value="">{ar?'كل التيم ليدرز':'All TLs'}</option>{(d?.filterOptions?.teamLeaders||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && (!d || !agents.length) && <p className="text-sm text-slate-500 py-8 text-center">{ar?'لا بيانات سكور كارد':'No scorecard data'}</p>}

      {!loading && agents.length>0 && (<>
        <div className="flex flex-wrap items-center gap-4 p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2"><Trophy size={16} className="text-amber-400"/><span className="text-[10px] text-slate-500 uppercase font-semibold">{ar?'متوسط Net':'Avg Net'}</span><span className="text-2xl font-bold" style={{ color:netC(d.avgNet) }}>{d.avgNet}</span></div>
          <span className="text-[11px] text-slate-400">{agents.length} {ar?'موظف عندهم سكور كارد':'agents with scorecard'}</span>
          <div className="flex items-center gap-2 ms-auto text-[11px] text-slate-400">{ar?'رتّب:':'Sort:'}
            <select value={sort} onChange={e=>setSort(e.target.value)} className={inputCls}>
              <option value="net">Net Points</option><option value="name">{ar?'الاسم':'Name'}</option>
              {kpis.map((k:any)=><option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'70vh' }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10" style={{ background:'#11162a' }}>
              <tr className="text-slate-400">
                <th className="px-2 py-2 text-start font-semibold">#</th><th className="px-2 py-2 text-start font-semibold">{ar?'الموظف':'Agent'}</th>
                <th className="px-2 py-2 text-start font-semibold">{ar?'الفنكشن':'Function'}</th>
                {kpis.map((k:any)=><th key={k.key} className="px-2 py-2 text-center font-semibold whitespace-nowrap" title={k.max!=null?`max ${k.max}`:''}>{k.label}{k.max!=null?<span className="text-slate-600"> /{k.max}</span>:''}</th>)}
                <th className="px-2 py-2 text-center font-semibold">Net</th><th className="px-2 py-2 text-center font-semibold">{ar?'ترتيب':'Rank'}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a:any,i:number)=>(
                <Fragment key={a.person_no}>
                  <tr className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={()=>toggle(a.person_no)}>
                    <td className="px-2 py-1.5 text-center text-slate-500">{i+1}</td>
                    <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">{openRow===a.person_no?<ChevronDown size={11} className="inline me-1"/>:<ChevronRight size={11} className="inline me-1 text-slate-600"/>}{a.name} <span className="text-[9px] text-slate-500">({a.weeks}w)</span></td>
                    <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{a.fn}</td>
                    {kpis.map((k:any)=>{ const v=a[k.key]==null?null:Number(a[k.key]); return <td key={k.key} className="px-2 py-1.5 text-center font-semibold" style={{ color:sc(v,k.max) }}>{v==null?'—':v}</td>; })}
                    <td className="px-2 py-1.5 text-center font-bold" style={{ color:netC(Number(a.net)) }}>{a.net}</td>
                    <td className="px-2 py-1.5 text-center text-slate-300">{a.rank!=null?`#${a.rank}`:'—'}</td>
                  </tr>
                  {openRow===a.person_no && (
                    <tr><td colSpan={kpis.length+5} className="px-3 py-2" style={{ background:'rgba(99,102,241,0.05)' }}>
                      <p className="text-[10px] text-slate-400 mb-1">{ar?'التفصيل الأسبوعي':'Weekly breakdown'}</p>
                      {!weeks[a.person_no] ? <p className="text-[10px] text-slate-500">…</p> : (
                        <table className="w-full text-[10px]"><thead><tr className="text-slate-500"><th className="text-start">{ar?'الأسبوع':'Week'}</th>{kpis.map((k:any)=><th key={k.key} className="text-center">{k.label}</th>)}<th className="text-center">Net</th></tr></thead>
                          <tbody>{weeks[a.person_no].map((wk:any,j:number)=>(
                            <tr key={j} className="border-t border-white/5">
                              <td className="py-0.5 text-slate-300 font-mono">{wk.week_label}</td>
                              {kpis.map((k:any)=>{ const v=wk[k.key]==null?null:Number(wk[k.key]); return <td key={k.key} className="py-0.5 text-center" style={{ color:sc(v,k.max) }}>{v==null?'·':v}</td>; })}
                              <td className="py-0.5 text-center font-bold" style={{ color:netC(Number(wk.net)) }}>{wk.net}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500">{ar?'الألوان حسب النقطة/السقف (أخضر≥90%). اضغط أي موظف للتفصيل الأسبوعي. مايو 2026.':'colours = score/max (green≥90%). Click an agent for the weekly breakdown. May 2026.'}</p>
      </>)}
    </div>
  );
}
