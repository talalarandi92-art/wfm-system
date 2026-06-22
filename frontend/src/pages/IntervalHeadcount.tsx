import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart4, CalendarDays, TrendingUp, Users } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

/** Interval Headcount — half-hourly staffing curve for a date, by function.
 *  Scheduled vs present per interval (cross-midnight aware on the backend). */
export default function IntervalHeadcountPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [date, setDate] = useState('2026-06-15');
  const [fn, setFn] = useState('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ date }); if (fn) q.set('function', fn);
    apiClient.get(`/attendance-recon/roster-v2/interval-headcount?${q}`).then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [date, fn]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const ints = d?.intervals || [];
  const maxV = Math.max(...ints.map((x:any)=>x.scheduledTotal), 1);

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#06b6d4,#6366f1)' }}><BarChart4 size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-lg font-bold text-white">{ar?'الهيدكاونت بالفترات':'Interval Headcount'}</h1>
          <p className="text-xs text-slate-500">{ar?'منحنى التغطية نصف-ساعي حسب الفنكشن — مجدول مقابل حاضر (مع شفتات منتصف الليل)':'Half-hourly coverage by function — scheduled vs present (cross-midnight aware)'}</p></div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className={inputCls}/></div>
        <select value={fn} onChange={e=>setFn(e.target.value)} className={inputCls}>
          <option value="">{ar?'كل الفنكشن':'All functions'}</option>
          {(d?.functions||[]).map((f:string)=><option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { ic:TrendingUp, l:ar?'ذروة التغطية':'Peak coverage', v:`${d.peak?.headcount||0} @ ${d.peak?.t||'—'}`, c:'#06b6d4' },
            { ic:Users, l:ar?'فنكشن':'Functions', v:d.functions?.length||0, c:'#6366f1' },
            { ic:CalendarDays, l:ar?'التاريخ':'Date', v:d.date, c:'#8b5cf6' },
            { ic:BarChart4, l:ar?'الفترة':'Step', v:`${d.step}m`, c:'#22c55e' },
          ].map((x,i)=>(
            <div key={i} className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={16}/></div>
              <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{x.l}</p><p className="text-base font-bold text-white truncate">{x.v}</p></div>
            </div>
          ))}
        </div>

        {/* staffing curve: scheduled (bar) vs present (overlay) per interval */}
        <div className="rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3 mb-3 text-[11px]">
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm inline-block" style={{ background:'#6366f1aa' }}/>{ar?'مجدول':'Scheduled'}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm inline-block" style={{ background:'#22c55e' }}/>{ar?'حاضر':'Present'}</span>
          </div>
          <div className="flex items-end gap-[2px] h-56 overflow-x-auto pb-1">
            {ints.map((x:any,i:number)=>(
              <div key={i} className="flex flex-col items-center justify-end flex-1 min-w-[10px] group relative" style={{ height:'100%' }}>
                <div className="w-full rounded-t-sm relative flex items-end justify-center" style={{ height:`${Math.max(2,100*x.scheduledTotal/maxV)}%`, background:'#6366f1aa' }}>
                  <div className="absolute bottom-0 w-full rounded-t-sm" style={{ height:`${x.scheduledTotal?Math.min(100,100*x.presentTotal/x.scheduledTotal):0}%`, background:'#22c55e' }}/>
                </div>
                {i%4===0 && <span className="text-[8px] text-slate-600 mt-1 rotate-0 whitespace-nowrap">{x.t}</span>}
                <div className="hidden group-hover:block absolute bottom-full mb-1 z-10 px-2 py-1 rounded-lg text-[10px] whitespace-nowrap" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)', color:'#e2e8f0' }}>
                  {x.t} · {ar?'مجدول':'sched'} {x.scheduledTotal} · {ar?'حاضر':'present'} {x.presentTotal}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* table by interval × function (scheduled) */}
        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'50vh' }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0" style={{ background:'#11162a' }}>
              <tr className="text-slate-400"><th className="px-2 py-2 text-start font-semibold">{ar?'الفترة':'Interval'}</th>
                {(d.functions||[]).map((f:string)=><th key={f} className="px-2 py-2 text-center font-semibold whitespace-nowrap">{f}</th>)}
                <th className="px-2 py-2 text-center font-semibold">{ar?'إجمالي':'Total'}</th></tr>
            </thead>
            <tbody>
              {ints.filter((x:any)=>x.scheduledTotal>0).map((x:any,i:number)=>(
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-2 py-1 text-slate-300 font-mono">{x.t}</td>
                  {(d.functions||[]).map((f:string)=>{ const s=x.scheduled[f]||0, pr=x.present[f]||0;
                    return <td key={f} className="px-2 py-1 text-center" style={{ color:s?'#cbd5e1':'#475569' }}>{s?`${s}${pr<s?` (${pr})`:''}`:'·'}</td>;
                  })}
                  <td className="px-2 py-1 text-center font-bold text-white">{x.scheduledTotal}<span className="text-emerald-400 font-normal"> / {x.presentTotal}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500">{ar?'القيمة = مجدول (حاضر) — الحاضر بالأخضر. الفترات الفارغة (لا أحد مجدول) مخفية.':'Cell = scheduled (present) — present in green. Empty intervals (nobody scheduled) hidden.'}</p>
      </>)}
    </div>
  );
}
