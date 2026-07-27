import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, CalendarDays, GitCompareArrows } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=> m?`${Math.round(m/60)}h`:'0';
const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';

/** Trends — center-wide weekly/monthly KPI movement with small-multiple charts. */
export default function TrendsPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [f, setF] = useState({ from:'', to:'', function:'', teamLeader:'', interval:'month' });
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams(); Object.entries(f).forEach(([k,v])=>{ if(v) q.set(k,v); });
    apiClient.get(`/attendance-recon/roster-v2/trends?${q}`).then((r:any)=>{ setD(r.data); if(!f.from) setF(p=>({...p, from:r.data.from, to:r.data.to})); })
      .catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [f]);
  useEffect(() => { const t=setTimeout(load,250); return ()=>clearTimeout(t); }, [load]);
  const set = (k:string,v:string)=>setF(p=>({ ...p, [k]:v }));

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const pts = d?.points || [];

  /* A small bar-series chart. `get` may return null — a period the metric was NOT
     measured in (no roster rows yet, a future week). Those periods are drawn as an
     empty slot with "—", never as a zero bar: `Number(p.conf)||0` used to paint a
     full-height RED column reading "0% conformance" for a week nobody had worked
     yet. An unmeasured period must look unmeasured. */
  const Chart = ({ title, get, fmt, colorFn, unit }: { title:string; get:(p:any)=>number|null; fmt:(v:number)=>string; colorFn?:(v:number)=>string; unit?:string }) => {
    const vals = pts.map(get).filter((v:number|null)=>v!=null) as number[];
    const max = Math.max(...vals, 1);
    const gaps = pts.length - vals.length;
    return (
      <div className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <h3 className="text-xs font-bold text-white mb-3">{title}{unit?<span className="text-slate-500 font-normal"> ({unit})</span>:''}
          {gaps>0 && <span className="text-slate-500 font-normal"> · {gaps} {ar?'فترة بلا قياس':gaps===1?'period not measured':'periods not measured'}</span>}</h3>
        <div className="flex items-end gap-2 h-32">
          {pts.map((p:any,i:number)=>{ const v=get(p); const c=v==null?'#475569':colorFn?colorFn(v):'#6366f1';
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <span className="text-[9px] mb-0.5" style={{ color:c }}>{v==null?'—':fmt(v)}</span>
                {v==null
                  ? <div className="w-full" style={{ height:'3px', borderTop:'1px dashed #475569' }}/>
                  : <div className="w-full rounded-t" style={{ height:`${Math.max(2,100*v/max)}%`, background:c, minHeight:'2px' }}/>}
                <span className="text-[8px] text-slate-500 mt-1 whitespace-nowrap">{p.label}</span>
                <div className="hidden group-hover:block absolute bottom-full mb-1 px-2 py-1 rounded text-[10px] whitespace-nowrap z-10" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)', color:'#e2e8f0' }}>{p.label}: {v==null?(ar?'ما فيه قياس لهالفترة':'not measured'):`${fmt(v)} · ${p.agents} ${ar?'موظف':'agents'}`}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/wfm-overview')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#22c55e)' }}><TrendingUp size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[180px]"><h1 className="text-lg font-bold text-white">{ar?'الاتجاهات عبر الزمن':'Trends Over Time'}</h1>
          <p className="text-xs text-slate-500">{ar?'حركة المؤشرات أسبوعياً/شهرياً للسنتر — كونفورمانس، تأخير، OT، غياب':'center-wide weekly/monthly movement — conformance, late, OT, absence'}</p></div>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {[['week',ar?'أسبوعي':'Weekly'],['month',ar?'شهري':'Monthly']].map(([k,l])=>(
            <button key={k} onClick={()=>set('interval',k)} className="px-3 py-1.5 text-xs font-semibold" style={f.interval===k?{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff'}:{color:'#94a3b8'}}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={f.from} onChange={e=>set('from',e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={f.to} onChange={e=>set('to',e.target.value)} className={inputCls}/></div>
        <select value={f.function} onChange={e=>set('function',e.target.value)} className={inputCls}><option value="">{ar?'كل الفنكشن':'All functions'}</option>{(d?.filterOptions?.functions||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
        <select value={f.teamLeader} onChange={e=>set('teamLeader',e.target.value)} className={inputCls}><option value="">{ar?'كل التيم ليدرز':'All TLs'}</option>{(d?.filterOptions?.teamLeaders||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
      </div>

      {/* progress verdict — works for the whole centre, or the filtered function / team leader */}
      {!loading && pts.length>1 && (() => {
        const cp = pts.filter((p:any)=>p.conf!=null); if (cp.length<2) return null;
        const ch = Math.round((Number(cp[cp.length-1].conf)-Number(cp[0].conf))*10)/10;
        const dir = ch>2?'up':ch<-2?'down':'flat';
        const OVC:Record<string,[string,string]> = { up:['#22c55e', ar?'في تحسّن ↑':'Improving ↑'], down:['#f43f5e', ar?'في تراجع ↓':'Declining ↓'], flat:['#06b6d4', ar?'مستقر':'Stable'] };
        const [c,l] = OVC[dir]; const scope = f.function || f.teamLeader || (ar?'السنتر كامل':'whole centre');
        return (
          <div className="flex items-center gap-3 p-3 rounded-2xl flex-wrap" style={{ background:`${c}10`, border:`1px solid ${c}33` }}>
            <GitCompareArrows size={16} style={{ color:c }}/>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background:`${c}22`, color:c }}>{l}</span>
            <span className="text-xs text-slate-300"><b>{scope}</b> — {ar?'الكونفورمانس':'conformance'} {cp[0].conf}% → {cp[cp.length-1].conf}% <b style={{ color:ch>=0?'#4ade80':'#f87171' }}>({ch>=0?'+':''}{ch})</b></span>
            <span className="text-[10px] text-slate-500">{ar?'من أول فترة لآخر فترة':'first → last period'}</span>
          </div>
        );
      })()}

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && (!d || !pts.length) && <p className="text-sm text-slate-500 py-8 text-center">{ar?'لا بيانات':'No data'}</p>}

      {!loading && pts.length>0 && (<>
        <div className="grid md:grid-cols-2 gap-3">
          <Chart title={ar?'الكونفورمانس':'Conformance'} unit="%" get={(p)=>p.conf==null?null:Number(p.conf)} fmt={(v)=>`${v}%`} colorFn={adhC}/>
          <Chart title={ar?'الأوفر تايم':'Overtime'} unit={ar?'ساعة':'hrs'} get={(p)=>p.otmin??null} fmt={dur} colorFn={()=>'#10b981'}/>
          <Chart title={ar?'أيام التأخير':'Late days'} get={(p)=>p.latedays??null} fmt={(v)=>`${v}`} colorFn={()=>'#f59e0b'}/>
          <Chart title={ar?'الغياب':'Absence'} get={(p)=>p.absent??null} fmt={(v)=>`${v}`} colorFn={()=>'#f43f5e'}/>
        </div>

        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <table className="w-full text-[11px]">
            <thead style={{ background:'#11162a' }}><tr className="text-slate-400">
              {[ar?'الفترة':'Period',ar?'من':'From',ar?'موظفون':'Agents',ar?'عمل':'Worked',ar?'كونف%':'Conf%',ar?'تأخير(يوم)':'Late(d)',ar?'تأخير(د)':'Late(m)',ar?'OT':'OT',ar?'سيك':'Sick',ar?'غياب':'Absent'].map((h,i)=><th key={i} className={`px-2 py-2 font-semibold whitespace-nowrap ${i===0?'text-start':'text-center'}`}>{h}</th>)}
            </tr></thead>
            <tbody>{pts.map((p:any,i:number)=>(
              <tr key={i} className="border-t border-white/5">
                <td className="px-2 py-1.5 text-white font-medium">{p.label}</td>
                <td className="px-2 py-1.5 text-center text-slate-500">{p.start}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{p.agents}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{p.worked}</td>
                <td className="px-2 py-1.5 text-center font-semibold" style={{ color:adhC(Number(p.conf)) }}>{p.conf!=null?p.conf+'%':'—'}</td>
                <td className="px-2 py-1.5 text-center text-amber-300">{p.latedays}</td>
                <td className="px-2 py-1.5 text-center text-slate-400">{p.latemin}</td>
                <td className="px-2 py-1.5 text-center text-emerald-300">{dur(p.otmin)}</td>
                <td className="px-2 py-1.5 text-center text-amber-300">{p.sick}</td>
                <td className="px-2 py-1.5 text-center text-rose-300">{p.absent}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500">{ar?'ملاحظة: الأسابيع بعد تاريخ اليوم تظهر بكونفورمانس منخفض/فارغ لأنها مجدولة بلا حضور فعلي بعد.':'Note: weeks after today read low/empty conformance — scheduled but no actuals yet.'}</p>
      </>)}
    </div>
  );
}
