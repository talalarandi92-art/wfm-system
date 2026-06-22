import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarRange, CalendarDays, Users, Coffee, Home, AlertTriangle, Clock, TrendingDown, Lock } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const CAT_COLOR: Record<string,string> = { Morning:'#38bdf8', Night:'#a78bfa', Evening:'#fb923c', Midnight:'#818cf8', Other:'#94a3b8' };

/** Schedule Analysis — the consolidated dashboard over the APPROVED schedule
 *  (roster_days): shrinkage, shift-rate, OFF/leave/weekend-OFF %, hourly headcount,
 *  permission hours — by function/team/period. The foundation everything builds on. */
export default function ScheduleAnalysisPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [f, setF] = useState({ from:'2026-01-01', to:'2026-06-19', function:'', teamLeader:'' });
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [lock, setLock] = useState<any>(null);

  useEffect(() => { apiClient.get('/attendance-recon/roster-v2/schedule-lock').then((r:any)=>setLock(r.data)).catch(()=>{}); }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams(); Object.entries(f).forEach(([k,v])=>{ if(v) q.set(k,v); });
    apiClient.get(`/attendance-recon/roster-v2/schedule-analysis?${q}`).then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [f]);
  useEffect(() => { const t=setTimeout(load,250); return ()=>clearTimeout(t); }, [load]);
  const set = (k:string,v:string)=>setF(p=>({ ...p, [k]:v }));

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const S = d?.summary;
  const tile = (icon:any, label:string, val:any, sub:string, c:string) => (
    <div className="flex items-center gap-2.5 p-3 rounded-xl lift sheen" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${c}22`, color:c }}>{icon}</div>
      <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{label}</p>
        <p className="text-lg font-bold text-white leading-none num-pop">{val}</p>{sub&&<p className="text-[9px] text-slate-500 truncate">{sub}</p>}</div>
    </div>
  );
  const hMax = Math.max(...(d?.hourly||[]).map((h:any)=>h.avgHC), 1);
  const srTotal = S ? (d.shiftRate.Morning+d.shiftRate.Night+d.shiftRate.Evening+d.shiftRate.Midnight+d.shiftRate.Other)||1 : 1;

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#06b6d4)' }}><CalendarRange size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-lg font-bold text-white">{ar?'تحليل الجدول':'Schedule Analysis'}</h1>
          <p className="text-xs text-slate-500">{ar?'كل تحليلات الجدول المعتمد بمكان واحد — شرينكيج، شيفت-ريت، OFF/إجازات، ويك-إند OFF، هيدكاونت بالساعات، استئذانات':'all approved-schedule analytics in one place — shrinkage, shift-rate, OFF/leave, weekend-OFF, hourly headcount, permissions'}</p></div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={f.from} onChange={e=>set('from',e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={f.to} onChange={e=>set('to',e.target.value)} className={inputCls}/></div>
        <select value={f.function} onChange={e=>set('function',e.target.value)} className={inputCls}><option value="">{ar?'كل الفنكشن':'All functions'}</option>{(d?.filterOptions?.functions||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
        <select value={f.teamLeader} onChange={e=>set('teamLeader',e.target.value)} className={inputCls}><option value="">{ar?'كل التيم ليدرز':'All TLs'}</option>{(d?.filterOptions?.teamLeaders||[]).map((x:string)=><option key={x} value={x}>{x}</option>)}</select>
      </div>

      {lock?.lock && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl text-[11px]" style={{ background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.22)', color:'#4ade80' }}>
          <Lock size={13} className="flex-shrink-0"/>
          <span><b>{ar?'الجدول المعتمد مقفول':'Approved schedule locked'}</b> {lock.lock.from} → {lock.lock.to} — {ar?'التعديل اليدوي مرفوض؛ التغيير الوحيد عبر إعادة الأبلود':'manual edits blocked; the only change is a re-upload'}{lock.canOverride?(ar?' (إنت مشرف تقدر تعدّل مع أوديت)':' (you are a supervisor — may edit with audit)'):''}.</span>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحليل…':'Analyzing…'}</p>}
      {!loading && S && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 stagger-grid">
          {tile(<Users size={16}/>, ar?'موظفون':'People', S.people, `${S.days} ${ar?'يوم':'days'} · ${S.scheduled.toLocaleString()} ${ar?'مجدول':'sched'}`, '#06b6d4')}
          {tile(<TrendingDown size={16}/>, ar?'الشرينكيج':'Shrinkage', `${S.shrinkagePct}%`, `${S.lostHrs.toLocaleString()}${ar?'س':'h'} ${ar?'مفقودة':'lost'}`, '#f43f5e')}
          {tile(<CalendarDays size={16}/>, ar?'OFF':'OFF', `${S.offPct}%`, `${S.off.toLocaleString()} ${ar?'يوم':'days'}`, '#94a3b8')}
          {tile(<Home size={16}/>, 'WFH', `${S.wfhPct}%`, `${S.wfh.toLocaleString()} / ${S.worked.toLocaleString()}`, '#0ea5e9')}
          {tile(<CalendarRange size={16}/>, ar?'ويك-إند OFF':'Weekend-OFF', `${S.weekendOffPct}%`, `${S.weekendOff.toLocaleString()} ${ar?'من الـOFF':'of OFFs'}`, '#8b5cf6')}
          {tile(<Coffee size={16}/>, ar?'استئذانات':'Permissions', `${S.permissionHrs.toLocaleString()}${ar?'س':'h'}`, `${S.permissions.toLocaleString()} ${ar?'استئذان':'perms'}`, '#22c55e')}
          {tile(<AlertTriangle size={16}/>, ar?'الإجازات':'Leave', `${S.leavePct}%`, `${S.leave.toLocaleString()} ${ar?'يوم':'days'}`, '#a855f7')}
          {tile(<AlertTriangle size={16}/>, ar?'سيك':'Sick', `${S.sickPct}%`, `${S.sick.toLocaleString()} ${ar?'يوم':'days'}`, '#f59e0b')}
          {tile(<AlertTriangle size={16}/>, ar?'غياب':'Absence', `${S.absentPct}%`, `${S.absent.toLocaleString()} ${ar?'يوم':'days'}`, '#ef4444')}
          {tile(<CalendarDays size={16}/>, ar?'حضور':'Worked', S.worked.toLocaleString(), `${ar?'مكتب':'office'} ${S.office.toLocaleString()} · WFH ${S.wfh.toLocaleString()}`, '#10b981')}
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {/* shift-rate distribution */}
          <div className="rounded-2xl p-4 glow-border-soft" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-sm font-bold text-white mb-3">{ar?'توزيع الشيفتات (Shift-rate)':'Shift-rate distribution'}</h3>
            {['Morning','Night','Evening','Midnight','Other'].map(k=>{ const n=d.shiftRate[k]||0; const pc=d.shiftRatePct[k]||0;
              return (
                <div key={k} className="flex items-center gap-2 text-[11px] mb-2">
                  <span className="w-16 text-slate-400">{k}</span>
                  <div className="flex-1 h-3.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,0.05)' }}><div className="h-full rounded-full" style={{ width:`${Math.round(100*n/srTotal)}%`, background:CAT_COLOR[k] }}/></div>
                  <span className="w-24 text-end font-semibold" style={{ color:CAT_COLOR[k] }}>{n.toLocaleString()} ({pc}%)</span>
                </div>
              );
            })}
          </div>
          {/* hourly headcount */}
          <div className="rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-sm font-bold text-white mb-1">{ar?'الهيدكاونت بالساعات (متوسط متزامن)':'Hourly headcount (avg concurrent)'}</h3>
            <p className="text-[10px] text-slate-500 mb-3">{ar?'متوسط عدد المجدولين المتواجدين بكل ساعة على مدى الفترة':'avg scheduled staff present each clock-hour across the period'}</p>
            <div className="flex items-end gap-0.5 h-28">
              {(d.hourly||[]).map((h:any)=>(
                <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <div className="w-full rounded-t" style={{ height:`${Math.max(2,100*h.avgHC/hMax)}%`, background:'linear-gradient(180deg,#22d3ee,#6366f1)', minHeight:'2px' }}/>
                  {h.hour%3===0 && <span className="text-[7px] text-slate-500 mt-0.5">{h.hour}</span>}
                  <div className="hidden group-hover:block absolute bottom-full mb-1 px-1.5 py-0.5 rounded text-[9px] whitespace-nowrap z-10" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)', color:'#e2e8f0' }}>{String(h.hour).padStart(2,'0')}:00 · {h.avgHC}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* by function */}
        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <table className="w-full text-[11px]">
            <thead style={{ background:'#11162a' }}><tr className="text-slate-400">
              {[ar?'الفنكشن':'Function',ar?'موظفون':'People',ar?'مجدول':'Scheduled',ar?'حضور':'Worked',ar?'حضور%':'Worked%',ar?'OFF':'OFF',ar?'OFF%':'OFF%',ar?'ويك-إند OFF':'Weekend-OFF',ar?'مفقود (إجازة/سيك/غياب)':'Lost',ar?'مفقود%':'Lost%'].map((h,i)=><th key={i} className={`px-2 py-2 font-semibold whitespace-nowrap ${i===0?'text-start':'text-center'}`}>{h}</th>)}
            </tr></thead>
            <tbody>{(d.byFunction||[]).map((r:any,i:number)=>(
              <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">{r.fn||'—'}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{r.people}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{r.scheduled.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center text-emerald-300">{r.worked.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{r.workedPct}%</td>
                <td className="px-2 py-1.5 text-center text-slate-400">{r.off.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center text-slate-300">{r.offPct}%</td>
                <td className="px-2 py-1.5 text-center" style={{ color:'#a78bfa' }}>{r.weekendOff.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center text-rose-300/80">{r.lost.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center font-semibold" style={{ color:r.lostPct>20?'#f87171':'#cbd5e1' }}>{r.lostPct}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500">{ar?'الشرينكيج = ساعات مفقودة (إجازة/سيك/غياب/عطلة + استئذانات) ÷ الساعات القابلة للجدولة. ويك-إند OFF% = حصة الـOFF الواقعة جمعة/سبت من إجمالي الـOFF. المصدر: الجدول المعتمد (roster_days).':'Shrinkage = lost hrs (leave/sick/absent/holiday + permissions) ÷ schedulable hrs. Weekend-OFF% = share of OFFs landing Fri/Sat. Source: approved schedule (roster_days).'}</p>
      </>)}
    </div>
  );
}
