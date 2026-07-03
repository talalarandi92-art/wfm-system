import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart4, CalendarDays, TrendingUp, Users } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { fmtLocalDate } from '@/utils/format';

const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';
const RISK_C: Record<string,string> = { ok:'#4ade80', watch:'#fbbf24', critical:'#f87171', 'n/a':'#64748b' };

/** Interval Headcount — half-hourly staffing curve for a date, by function.
 *  Scheduled vs present per interval (cross-midnight aware on the backend). */
export default function IntervalHeadcountPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [date, setDate] = useState(() => fmtLocalDate(new Date()));
  const [fn, setFn] = useState('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [imp, setImp] = useState<any>(null);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ date }); if (fn) q.set('function', fn);
    apiClient.get(`/attendance-recon/roster-v2/interval-headcount?${q}`).then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
    apiClient.get(`/attendance-recon/roster-v2/coverage-impact?date=${date}`).then((r:any)=>setImp(r.data)).catch(()=>setImp(null));
  }, [date, fn]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs outline-none focus:border-indigo-400';
  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const ints = d?.intervals || [];
  const maxV = Math.max(...ints.map((x:any)=>x.scheduledTotal), 1);

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'var(--surface-2)' }}><ArrowLeft size={16} style={{ color:'var(--text-1)' }}/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#06b6d4,#6366f1)' }}><BarChart4 size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-lg font-bold" style={{ color:'var(--text-1)' }}>{ar?'الهيدكاونت بالفترات':'Interval Headcount'}</h1>
          <p className="text-xs" style={{ color:'var(--text-3)' }}>{ar?'منحنى التغطية نصف-ساعي حسب الفنكشن — مجدول مقابل حاضر (مع شفتات منتصف الليل)':'Half-hourly coverage by function — scheduled vs present (cross-midnight aware)'}</p></div>
        <div className="flex items-center gap-1.5" style={{ color:'var(--text-2)' }}><CalendarDays size={14}/>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className={inputCls} style={inputStyle}/></div>
        <select value={fn} onChange={e=>setFn(e.target.value)} className={inputCls} style={inputStyle}>
          <option value="">{ar?'كل الفنكشن':'All functions'}</option>
          {(d?.functions||[]).map((f:string)=><option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm py-8 text-center" style={{ color:'var(--text-3)' }}>{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { ic:TrendingUp, l:ar?'ذروة التغطية':'Peak coverage', v:`${d.peak?.headcount||0} @ ${d.peak?.t||'—'}`, c:'#06b6d4' },
            { ic:Users, l:ar?'فنكشن':'Functions', v:d.functions?.length||0, c:'#6366f1' },
            { ic:CalendarDays, l:ar?'التاريخ':'Date', v:d.date, c:'#8b5cf6' },
            { ic:BarChart4, l:ar?'الفترة':'Step', v:`${d.step}m`, c:'#22c55e' },
          ].map((x,i)=>(
            <div key={i} className="flex items-center gap-2.5 p-3 rounded-xl" style={panel}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={16}/></div>
              <div className="min-w-0"><p className="text-[9px] uppercase font-semibold truncate" style={{ color:'var(--text-3)' }}>{x.l}</p><p className="text-base font-bold truncate" style={{ color:'var(--text-1)' }}>{x.v}</p></div>
            </div>
          ))}
        </div>

        {/* staffing curve: scheduled (bar) vs present (overlay) per interval */}
        <div className="rounded-2xl p-4" style={panel}>
          <div className="flex items-center gap-3 mb-3 text-[11px]" style={{ color:'var(--text-2)' }}>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm inline-block" style={{ background:'#6366f1aa' }}/>{ar?'مجدول':'Scheduled'}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm inline-block" style={{ background:'#22c55e' }}/>{ar?'حاضر':'Present'}</span>
          </div>
          <div className="flex items-end gap-[2px] h-56 overflow-x-auto pb-1">
            {ints.map((x:any,i:number)=>(
              <div key={i} className="flex flex-col items-center justify-end flex-1 min-w-[10px] group relative" style={{ height:'100%' }}>
                <div className="w-full rounded-t-sm relative flex items-end justify-center" style={{ height:`${Math.max(2,100*x.scheduledTotal/maxV)}%`, background:'#6366f1aa' }}>
                  <div className="absolute bottom-0 w-full rounded-t-sm" style={{ height:`${x.scheduledTotal?Math.min(100,100*x.presentTotal/x.scheduledTotal):0}%`, background:'#22c55e' }}/>
                </div>
                {i%4===0 && <span className="text-[8px] mt-1 rotate-0 whitespace-nowrap" style={{ color:'var(--text-3)' }}>{x.t}</span>}
                <div className="hidden group-hover:block absolute bottom-full mb-1 z-10 px-2 py-1 rounded-lg text-[10px] whitespace-nowrap" style={{ background:'var(--surface-2)', border:'1px solid var(--border)', color:'var(--text-1)' }}>
                  {x.t} · {ar?'مجدول':'sched'} {x.scheduledTotal} · {ar?'حاضر':'present'} {x.presentTotal}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* per-function permission/leave coverage impact for the date */}
        {imp?.rows?.length>0 && (
          <div className="rounded-2xl p-4" style={panel}>
            <h3 className="text-sm font-bold mb-1" style={{ color:'var(--text-1)' }}>{ar?'أثر الاستئذان/الإجازة على التغطية':'Permission / Leave Coverage Impact'}</h3>
            <p className="text-[10px] mb-3" style={{ color:'var(--text-3)' }}>{ar?'مجدول للعمل مقابل ما يأخذه الاستئذان/السيك/الغياب/عدم الدخول — بدقة اليوم':'Planned-to-work vs what permission/sick/absent/no-show take away — day granularity'}</p>
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr style={{ color:'var(--text-3)' }}>
                {[ar?'الفنكشن':'Function',ar?'مجدول':'Planned',ar?'اشتغل':'Worked',ar?'حاضر':'Present',ar?'استئذان':'Perm',ar?'سيك':'Sick',ar?'غياب':'Absent',ar?'لم يدخل':'No-show',ar?'تغطية%':'Cov%',ar?'الخطر':'Risk'].map((h,i)=><th key={i} className={`pb-1.5 font-semibold ${i===0?'text-start':'text-center'}`}>{h}</th>)}
              </tr></thead>
              <tbody>{imp.rows.map((r:any,i:number)=>{ const rc=RISK_C[r.risk]||'#64748b';
                return (
                  <tr key={i} style={{ borderTop:'1px solid var(--border)' }}>
                    <td className="py-1" style={{ color:'var(--text-1)' }}>{r.fn}</td>
                    <td className="py-1 text-center font-semibold" style={{ color:'var(--text-1)' }}>{r.planned}</td>
                    <td className="py-1 text-center" style={{ color:'var(--text-2)' }}>{r.worked}</td>
                    <td className="py-1 text-center text-emerald-300">{r.present}</td>
                    <td className="py-1 text-center" style={{ color:r.on_permission?'#c4b5fd':'#475569' }}>{r.on_permission||'·'}</td>
                    <td className="py-1 text-center" style={{ color:r.sick?'#fbbf24':'#475569' }}>{r.sick||'·'}</td>
                    <td className="py-1 text-center" style={{ color:r.absent?'#f87171':'#475569' }}>{r.absent||'·'}</td>
                    <td className="py-1 text-center" style={{ color:r.noShow?'#f97316':'#475569' }}>{r.noShow||'·'}</td>
                    <td className="py-1 text-center font-bold" style={{ color:rc }}>{r.coverage!=null?r.coverage+'%':'—'}</td>
                    <td className="py-1 text-center"><span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background:`${rc}22`, color:rc }}>{r.risk}</span></td>
                  </tr>
                );
              })}
              {imp.totals && <tr className="font-bold" style={{ borderTop:'2px solid var(--border)' }}>
                <td className="py-1" style={{ color:'var(--text-1)' }}>{ar?'الإجمالي':'Total'}</td>
                <td className="py-1 text-center" style={{ color:'var(--text-1)' }}>{imp.totals.planned}</td><td className="py-1 text-center" style={{ color:'var(--text-2)' }}>{imp.totals.worked}</td>
                <td className="py-1 text-center text-emerald-300">{imp.totals.present}</td><td className="py-1 text-center text-violet-300">{imp.totals.on_permission}</td>
                <td className="py-1 text-center text-amber-300">{imp.totals.sick}</td><td className="py-1 text-center text-rose-300">{imp.totals.absent}</td>
                <td className="py-1 text-center text-orange-300">{imp.totals.noShow}</td>
                <td className="py-1 text-center" style={{ color:adhC(imp.totals.coverage) }}>{imp.totals.coverage!=null?imp.totals.coverage+'%':'—'}</td><td/>
              </tr>}
              </tbody>
            </table></div>
          </div>
        )}

        {/* table by interval × function (scheduled) */}
        <div className="rounded-2xl overflow-auto" style={{ ...panel, maxHeight:'50vh' }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0" style={{ background:'var(--surface-2)' }}>
              <tr style={{ color:'var(--text-2)' }}><th className="px-2 py-2 text-start font-semibold">{ar?'الفترة':'Interval'}</th>
                {(d.functions||[]).map((f:string)=><th key={f} className="px-2 py-2 text-center font-semibold whitespace-nowrap">{f}</th>)}
                <th className="px-2 py-2 text-center font-semibold">{ar?'إجمالي':'Total'}</th></tr>
            </thead>
            <tbody>
              {ints.filter((x:any)=>x.scheduledTotal>0).map((x:any,i:number)=>(
                <tr key={i} className="hover:bg-white/[0.03]" style={{ borderTop:'1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color:'var(--text-2)' }}>{x.t}</td>
                  {(d.functions||[]).map((f:string)=>{ const s=x.scheduled[f]||0, pr=x.present[f]||0;
                    return <td key={f} className="px-2 py-1 text-center" style={{ color:s?'var(--text-1)':'var(--text-3)' }}>{s?`${s}${pr<s?` (${pr})`:''}`:'·'}</td>;
                  })}
                  <td className="px-2 py-1 text-center font-bold" style={{ color:'var(--text-1)' }}>{x.scheduledTotal}<span className="text-emerald-400 font-normal"> / {x.presentTotal}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px]" style={{ color:'var(--text-3)' }}>{ar?'القيمة = مجدول (حاضر) — الحاضر بالأخضر. الفترات الفارغة (لا أحد مجدول) مخفية.':'Cell = scheduled (present) — present in green. Empty intervals (nobody scheduled) hidden.'}</p>
      </>)}
    </div>
  );
}
