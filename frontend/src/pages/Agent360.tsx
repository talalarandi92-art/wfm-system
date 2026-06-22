import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, UserSearch, Search, ShieldCheck, Clock, TimerReset, Timer, Coffee, UserX,
  Building2, CalendarDays, ListChecks, Briefcase,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=>{ if(!m) return '0'; const h=Math.floor(m/60),mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';
const BAND_ORDER = ['On time','Late 1-5','Late 6-15','Late 16-20','Late 21-29','Late 30-59','Late 60+','No show'];
const BAND_COLOR: Record<string,string> = { 'On time':'#22c55e','Late 1-5':'#84cc16','Late 6-15':'#f59e0b','Late 16-20':'#f97316','Late 21-29':'#ef4444','Late 30-59':'#dc2626','Late 60+':'#991b1b','No show':'#7f1d1d' };
const CAT_COLOR: Record<string,string> = { Morning:'#22c55e', Night:'#06b6d4', Evening:'#f59e0b', Midnight:'#8b5cf6' };
const tm = (m:number|null)=> m==null?'—':`${String(Math.floor((((m%1440)+1440)%1440)/60)).padStart(2,'0')}:${String(((m%60)+60)%60).padStart(2,'0')}`;

export default function Agent360Page() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [people, setPeople] = useState<any[]>([]);
  const [person, setPerson] = useState('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');

  useEffect(() => { apiClient.get('/attendance-recon/roster-v2/employee-master').then((r:any)=>{ setPeople(r.data.rows||[]); if(r.data.rows?.[0]) setPerson(r.data.rows[0].person_no); }).catch(()=>{}); }, []);

  const load = useCallback(() => {
    if (!person) return; setLoading(true); setErr('');
    apiClient.get(`/attendance-recon/roster-v2/agent-360?person=${encodeURIComponent(person)}`)
      .then((r:any)=>setD(r.data)).catch((e:any)=>{ setD(null); setErr(e?.response?.data?.message||'Failed'); }).finally(()=>setLoading(false));
  }, [person]);
  useEffect(() => { const t=setTimeout(load,200); return ()=>clearTimeout(t); }, [load]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const s = d?.summary; const e = d?.employee;
  const bandsMax = Math.max(...(d?.tardinessBands||[]).map((x:any)=>x.n), 1);
  const srMax = Math.max(...Object.values(d?.shiftRate||{}).map(Number).filter(v=>v), 1);
  const monMax = Math.max(...(d?.byMonth||[]).map((x:any)=>x.worked), 1);

  const kpis = s ? [
    { ic:Briefcase, l:ar?'أيام عمل':'Worked', v:s.workedDays, sub:`${s.officeDays} ${ar?'مكتب':'office'} · ${s.wfhDays} WFH`, c:'#6366f1' },
    { ic:ShieldCheck, l:ar?'كونفورمانس':'Conformance', v:s.conformance!=null?s.conformance+'%':'—', c:adhC(s.conformance) },
    { ic:Clock, l:ar?'تأخير':'Late', v:s.lateDays, sub:dur(s.totalLateMin), c:'#f59e0b' },
    { ic:TimerReset, l:ar?'OT قبل':'OT before', v:dur(s.otBefore), c:'#10b981' },
    { ic:Timer, l:ar?'OT بعد':'OT after', v:dur(s.otAfter), c:'#10b981' },
    { ic:Coffee, l:ar?'سيك':'Sick', v:s.sickDays, c:'#f59e0b' },
    { ic:UserX, l:ar?'غياب':'Absent', v:s.absenceDays, c:'#f43f5e' },
    { ic:CalendarDays, l:ar?'إجازة':'Leave', v:s.leaveDays, c:'#a78bfa' },
    { ic:Building2, l:ar?'أوف':'OFF', v:s.offDays, c:'#64748b' },
    { ic:ListChecks, l:ar?'استئذان':'Permissions', v:s.permissions, c:'#8b5cf6' },
    { ic:Clock, l:ar?'بصمة ناقصة':'Miss punch', v:s.missingPunch, c:'#f97316' },
    { ic:Clock, l:ar?'سيستم ناقص':'Miss system', v:s.missingSystem, c:'#f97316' },
  ] : [];

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#8b5cf6,#6366f1)' }}><UserSearch size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[180px]"><h1 className="text-lg font-bold text-white">{ar?'ملف الموظف 360':'Agent 360 Profile'}</h1>
          <p className="text-xs text-slate-500">{ar?'صورة كاملة لأداء وحضور الموظف من الماستر النظيف':'A complete attendance & performance picture from the clean master'}</p></div>
        <div className="flex items-center gap-1.5"><Search size={14} className="text-slate-400"/>
          <select value={person} onChange={e=>setPerson(e.target.value)} className={`${inputCls} min-w-[220px]`}>
            {people.map(p=><option key={p.person_no} value={p.person_no}>{p.clean_name} · {p.role_category}</option>)}
          </select></div>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {err && <p className="text-sm text-rose-400 py-8 text-center">{err}</p>}

      {!loading && d && e && (<>
        {/* identity band */}
        <div className="rounded-2xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <div><p className="text-base font-bold text-white">{e.clean_name}</p><p className="text-[11px] text-slate-500 font-mono">#{e.person_no}</p></div>
          {[[ar?'الفنكشن':'Function',e.function_name],[ar?'الدور':'Role',`${e.role_category} · ${Number(e.expected_hours)}h`],[ar?'التيم ليدر':'Team leader',e.team_leader],[ar?'الجروب':'Group',e.team_group],[ar?'النوع':'Gender',e.gender],[ar?'الحالة':'Status',e.is_active?(ar?'نشط':'Active'):(ar?'غير نشط':'Inactive')]].map(([l,v]:any,i)=>(
            <div key={i}><p className="text-[9px] text-slate-500 uppercase font-semibold">{l}</p><p className="text-xs text-slate-200">{v||'—'}</p></div>
          ))}
          {!e.include_tardiness && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background:'rgba(245,158,11,0.18)', color:'#fbbf24' }}>{ar?'مستثنى من حساب التأخير (8 ساعات)':'excluded from tardiness KPI (8h)'}</span>}
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {kpis.map((x,i)=>(
            <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={16}/></div>
              <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{x.l}</p>
                <p className="text-lg font-bold text-white leading-tight">{typeof x.v==='number'?x.v.toLocaleString():x.v}</p>{x.sub&&<p className="text-[9px] text-slate-500 truncate">{x.sub}</p>}</div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-3">
          {/* tardiness bands */}
          <div className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-xs font-bold text-white mb-2.5">{ar?'فئات التأخير':'Tardiness bands'}</h3>
            {BAND_ORDER.filter(b=>(d.tardinessBands||[]).some((x:any)=>x.band===b)).map(b=>{ const n=(d.tardinessBands.find((x:any)=>x.band===b)||{}).n||0;
              return (
                <div key={b} className="flex items-center gap-2 text-[11px] mb-1">
                  <span className="w-16 text-slate-400">{b}</span>
                  <div className="flex-1 h-3 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.04)' }}><div className="h-full rounded" style={{ width:`${100*n/bandsMax}%`, background:BAND_COLOR[b] }}/></div>
                  <span className="w-6 text-end font-semibold text-slate-200">{n}</span>
                </div>
              );
            })}
          </div>

          {/* shift-rate */}
          <div className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-xs font-bold text-white mb-2.5">{ar?'توزيع الشفتات':'Shift-rate distribution'}</h3>
            {['Morning','Night','Evening','Midnight'].map(c=>{ const n=d.shiftRate?.[c]||0; const tot=Object.values(d.shiftRate||{}).map(Number).reduce((a:number,b:number)=>a+b,0)||1;
              return (
                <div key={c} className="flex items-center gap-2 text-[11px] mb-1">
                  <span className="w-16 text-slate-400">{c}</span>
                  <div className="flex-1 h-3 rounded overflow-hidden" style={{ background:'rgba(255,255,255,0.04)' }}><div className="h-full rounded" style={{ width:`${100*n/srMax}%`, background:CAT_COLOR[c] }}/></div>
                  <span className="w-14 text-end font-semibold text-slate-200">{n} <span className="text-slate-500">({Math.round(100*n/tot)}%)</span></span>
                </div>
              );
            })}
          </div>

          {/* monthly trend */}
          <div className="rounded-2xl p-3.5" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-xs font-bold text-white mb-2.5">{ar?'الاتجاه الشهري':'Monthly trend'}</h3>
            <div className="flex items-end gap-2 h-28">
              {(d.byMonth||[]).map((m:any,i:number)=>(
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <div className="w-full rounded-t" style={{ height:`${Math.max(4,100*m.worked/monMax)}%`, background:adhC(m.conformance) }}/>
                  <span className="text-[8px] text-slate-500 mt-1">{(m.month||'').slice(0,3)}</span>
                  <div className="hidden group-hover:block absolute bottom-full mb-1 px-2 py-1 rounded text-[10px] whitespace-nowrap z-10" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)', color:'#e2e8f0' }}>{m.month}: {m.worked}d · {m.conformance}% · OT {dur(m.otMin)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* recent days */}
        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'44vh' }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0" style={{ background:'#11162a' }}><tr className="text-slate-400">
              {[ar?'التاريخ':'Date',ar?'اليوم':'Day',ar?'الشفت':'Shift',ar?'الحالة':'Status',ar?'دخول':'In',ar?'خروج':'Out',ar?'تأخير':'Late',ar?'OT قبل':'OTb',ar?'OT بعد':'OTa',ar?'كونف.':'Conf'].map((h,i)=><th key={i} className="px-2 py-2 font-semibold text-start whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>{(d.recent||[]).map((r:any,i:number)=>(
              <tr key={i} className="border-t border-white/5">
                <td className="px-2 py-1 text-slate-300">{r.date}</td><td className="px-2 py-1 text-slate-500">{r.day_name?.slice(0,3)}</td>
                <td className="px-2 py-1 text-slate-200 font-mono">{r.shift_code||'—'}</td>
                <td className="px-2 py-1 text-slate-300">{r.attendance_status||r.presence}</td>
                <td className="px-2 py-1 text-slate-400 font-mono">{tm(r.sys_login_min)}</td><td className="px-2 py-1 text-slate-400 font-mono">{tm(r.sys_logout_min)}</td>
                <td className="px-2 py-1" style={{ color:r.sys_late_min>0?'#f59e0b':'#475569' }}>{r.sys_late_min>0?`${r.sys_late_min}m`:'·'}</td>
                <td className="px-2 py-1 text-emerald-400/80">{r.ot_before_min>0?dur(r.ot_before_min):'·'}</td>
                <td className="px-2 py-1 text-emerald-400/80">{r.ot_after_min>0?dur(r.ot_after_min):'·'}</td>
                <td className="px-2 py-1 font-semibold" style={{ color:adhC(r.adherence_pct) }}>{r.adherence_pct!=null?r.adherence_pct+'%':'—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
