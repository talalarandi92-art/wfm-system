import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, UserSearch, Search, ShieldCheck, Clock, TimerReset, Timer, Coffee, UserX,
  Building2, CalendarDays, ListChecks, Briefcase, ChevronDown, Wrench, FileSpreadsheet, LayoutList, Table2, XCircle, GitCompareArrows,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const dur = (m:number)=>{ if(!m) return '0'; const h=Math.floor(m/60),mm=m%60; return h?`${h}h${mm?` ${mm}m`:''}`:`${mm}m`; };
const adhC = (v:number)=> v==null?'#64748b':v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';
const scoreColor = (v:number)=> v>=85?'#22c55e':v>=70?'#06b6d4':v>=55?'#f59e0b':'#f43f5e';
const BAND_ORDER = ['On time','Late 1-5','Late 6-15','Late 16-20','Late 21-29','Late 30-59','Late 60+','No show'];
const BAND_COLOR: Record<string,string> = { 'On time':'#22c55e','Late 1-5':'#84cc16','Late 6-15':'#f59e0b','Late 16-20':'#f97316','Late 21-29':'#ef4444','Late 30-59':'#dc2626','Late 60+':'#991b1b','No show':'#7f1d1d' };
const CAT_COLOR: Record<string,string> = { Morning:'#22c55e', Night:'#06b6d4', Evening:'#f59e0b', Midnight:'#8b5cf6' };
const tm = (m:number|null)=> m==null?'—':`${String(Math.floor((((m%1440)+1440)%1440)/60)).padStart(2,'0')}:${String(((m%60)+60)%60).padStart(2,'0')}`;

export default function Agent360Page() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [people, setPeople] = useState<any[]>([]);
  const [person, setPerson] = useState('');
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const [score, setScore] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [prog, setProg] = useState<any>(null);
  // compare-with (second agent)
  const [person2, setPerson2] = useState(''); const [q2, setQ2] = useState(''); const [open2, setOpen2] = useState(false); const [d2, setD2] = useState<any>(null);

  useEffect(() => { apiClient.get('/attendance-recon/roster-v2/employee-master').then((r:any)=>{ setPeople(r.data.rows||[]); if(r.data.rows?.[0]) setPerson(r.data.rows[0].person_no); }).catch(()=>{}); }, []);

  const load = useCallback(() => {
    if (!person) return; setLoading(true); setErr('');
    const qp = new URLSearchParams({ person }); if (from) qp.set('from',from); if (to) qp.set('to',to);
    apiClient.get(`/attendance-recon/roster-v2/agent-360?${qp}`)
      .then((r:any)=>{ setD(r.data); if(!from) setFrom(r.data.from); if(!to) setTo(r.data.to); })
      .catch((e:any)=>{ setD(null); setErr(e?.response?.data?.message||'Failed'); }).finally(()=>setLoading(false));
    const sq = new URLSearchParams({ person, includeExcludedRoles:'1' }); if (from) sq.set('from',from); if (to) sq.set('to',to);
    apiClient.get(`/attendance-recon/roster-v2/agent-scores?${sq}`).then((r:any)=>setScore(r.data.agents?.[0]||null)).catch(()=>setScore(null));
    const pq = new URLSearchParams({ person }); if (from) pq.set('from',from); if (to) pq.set('to',to);
    apiClient.get(`/attendance-recon/roster-v2/agent-performance?${pq}`).then((r:any)=>setPerf(r.data)).catch(()=>setPerf(null));
    apiClient.get(`/attendance-recon/roster-v2/agent-progress?${pq}`).then((r:any)=>setProg(r.data)).catch(()=>setProg(null));
  }, [person, from, to]);
  useEffect(() => { const t=setTimeout(load,200); return ()=>clearTimeout(t); }, [load]);

  // second agent for side-by-side compare
  useEffect(() => {
    if (!person2) { setD2(null); return; }
    const qp = new URLSearchParams({ person: person2 }); if (from) qp.set('from',from); if (to) qp.set('to',to);
    const t = setTimeout(()=>apiClient.get(`/attendance-recon/roster-v2/agent-360?${qp}`).then((r:any)=>setD2(r.data)).catch(()=>setD2(null)), 200);
    return ()=>clearTimeout(t);
  }, [person2, from, to]);

  // ── per-agent custom report (inline mini report-builder scoped to this agent) ──
  const SC_KPIS: [string,string][] = [['netPoints','Net Points'],['scQuality','Quality (pts)'],['scAht','AHT (pts)'],['scFcr','FCR (pts)'],['scProductivity','Productivity (pts)'],['scCtr','CTR (pts)'],['scQuiz','Quiz (pts)'],['scPrr','PRR (pts)'],['scRes','RES %'],['scResponseTime','Resp Time (pts)'],['scMistakes','Mistakes (pts)'],['scIncidents','Incidents (pts)'],['scAttendance','Attendance (pts)']];
  const RFIELDS: [string,string][] = [['date','Date'],['day','Day'],['week','Week'],['month','Month'],['shiftCode','Shift'],['originalShift','Orig Shift'],['attendanceStatus','Status'],['hrStatus','HR Code'],['sysLogin','Sys In'],['sysLogout','Sys Out'],['workedMin','Worked'],['lateMin','Late'],['lateCategory','Late Band'],['earlyMin','Early'],['otBefore','OT Before'],['otAfter','OT After'],['otTotal','OT Total'],['conformance','Conf %'],['permission','Permission'],['dataQuality','Data Quality'], ...SC_KPIS];
  const RKPIS: [string,string][] = [['scheduledDays','Scheduled'],['workedDays','Worked'],['officeDays','Office'],['wfhDays','WFH'],['sickDays','Sick'],['absenceDays','Absence'],['lateDays','Late days'],['lateMin','Late min'],['earlyMin','Early min'],['otMin','OT'],['otBefore','OT before'],['otAfter','OT after'],['conformance','Conf %'],['permissionCount','Permissions'], ...SC_KPIS];
  const RGROUPS: [string,string][] = [['month','Month'],['week','Week'],['day','Day'],['shift','Shift'],['status','Status'],['lateCategory','Late band']];
  const [rOpen, setROpen] = useState(false);
  const [rpt, setRpt] = useState<{ mode:'detail'|'summary'; fields:string[]; kpis:string[]; group:string }>({ mode:'detail', fields:['date','day','shiftCode','attendanceStatus','sysLogin','sysLogout','lateMin','otBefore','otAfter','conformance'], kpis:['scheduledDays','workedDays','lateMin','otMin','conformance'], group:'month' });
  const [rData, setRData] = useState<any>(null);
  const rQs = () => { const qp=new URLSearchParams({ person, from, to }); if(rpt.mode==='summary'){ qp.set('groupBy',rpt.group); qp.set('kpis',rpt.kpis.join(',')); } else qp.set('fields',rpt.fields.join(',')); return qp; };
  const runRpt = useCallback(() => { if(!person) return; apiClient.get(`/attendance-recon/report-builder?${rQs()}`).then((r:any)=>setRData(r.data)).catch(()=>setRData(null)); }, [person, from, to, rpt]);
  useEffect(() => { if(rOpen){ const t=setTimeout(runRpt,250); return ()=>clearTimeout(t); } }, [rOpen, runRpt]);
  const exportRpt = async () => { const qp=rQs(); qp.set('format','xlsx'); try{ const r:any=await apiClient.get(`/attendance-recon/report-builder?${qp}`,{responseType:'blob'}); const u=URL.createObjectURL(r.data); const a=document.createElement('a'); a.href=u; a.download=`agent_${person}_report.xlsx`; a.click(); URL.revokeObjectURL(u);}catch{} };
  const toggleR = (key:'fields'|'kpis', k:string) => setRpt(p=>({ ...p, [key]: p[key].includes(k)?p[key].filter(x=>x!==k):[...p[key],k] }));

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
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inputCls}/></div>
        <div className="relative" onBlur={()=>setTimeout(()=>setOpen(false),150)}>
          <div className="flex items-center gap-1.5"><Search size={14} className="text-slate-400"/>
            <input
              value={open ? q : (e ? `${e.clean_name} · ${e.role_category}` : (ar?'ابحث عن موظف…':'Search agent…'))}
              onChange={ev=>{ setQ(ev.target.value); setOpen(true); }}
              onFocus={()=>{ setQ(''); setOpen(true); }}
              placeholder={ar?'ابحث بالاسم/الرقم…':'Search name / no…'}
              className={`${inputCls} min-w-[240px]`} />
            <ChevronDown size={14} className="text-slate-500 -ms-6 pointer-events-none" />
          </div>
          {open && (
            <div className="absolute z-50 mt-1 end-0 w-[300px] max-h-80 overflow-auto rounded-xl shadow-2xl" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)' }}>
              {people.filter((p:any)=>{ const t=q.toLowerCase().trim(); return !t || p.clean_name.toLowerCase().includes(t) || String(p.person_no).includes(t) || (p.role_category||'').toLowerCase().includes(t); }).slice(0,150).map((p:any)=>(
                <button key={p.person_no} onMouseDown={()=>{ setPerson(p.person_no); setOpen(false); setQ(''); }}
                  className="w-full text-start px-3 py-1.5 text-xs hover:bg-white/10 flex items-center justify-between gap-2"
                  style={{ color: p.person_no===person?'#a5b4fc':'#cbd5e1', background: p.person_no===person?'rgba(99,102,241,0.12)':'transparent' }}>
                  <span className="truncate">{p.clean_name}</span>
                  <span className="text-slate-500 text-[10px] flex-shrink-0">{p.role_category} · #{p.person_no}</span>
                </button>
              ))}
              {people.filter((p:any)=>{ const t=q.toLowerCase().trim(); return !t || p.clean_name.toLowerCase().includes(t) || String(p.person_no).includes(t); }).length===0 && <p className="px-3 py-2 text-xs text-slate-500">{ar?'لا نتائج':'No matches'}</p>}
            </div>
          )}
        </div>
        {/* compare-with a second agent */}
        <div className="relative" onBlur={()=>setTimeout(()=>setOpen2(false),150)}>
          <input
            value={open2 ? q2 : (d2?.employee ? `↔ ${d2.employee.clean_name}` : '')}
            onChange={ev=>{ setQ2(ev.target.value); setOpen2(true); }} onFocus={()=>{ setQ2(''); setOpen2(true); }}
            placeholder={ar?'＋ قارن مع…':'＋ Compare…'} className={`${inputCls} min-w-[150px]`} />
          {person2 && !open2 && <button onMouseDown={()=>{ setPerson2(''); setD2(null); }} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-rose-400"><XCircle size={13}/></button>}
          {open2 && (
            <div className="absolute z-50 mt-1 end-0 w-[300px] max-h-80 overflow-auto rounded-xl shadow-2xl" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)' }}>
              {people.filter((p:any)=>{ const t=q2.toLowerCase().trim(); return p.person_no!==person && (!t || p.clean_name.toLowerCase().includes(t) || String(p.person_no).includes(t) || (p.role_category||'').toLowerCase().includes(t)); }).slice(0,150).map((p:any)=>(
                <button key={p.person_no} onMouseDown={()=>{ setPerson2(p.person_no); setOpen2(false); setQ2(''); }}
                  className="w-full text-start px-3 py-1.5 text-xs hover:bg-white/10 flex items-center justify-between gap-2" style={{ color: p.person_no===person2?'#67e8f9':'#cbd5e1' }}>
                  <span className="truncate">{p.clean_name}</span><span className="text-slate-500 text-[10px]">{p.role_category} · #{p.person_no}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
          {score && (
            <button onClick={()=>nav('/agent-scores')} className="ms-auto flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background:`${scoreColor(score.score)}18`, border:`1px solid ${scoreColor(score.score)}40` }} title={ar?'سكور الحضور والالتزام':'Attendance & adherence score'}>
              <div className="text-end"><p className="text-[8px] text-slate-400 uppercase font-semibold">{ar?'سكور الالتزام':'Adherence'}</p>
                <p className="text-lg font-bold leading-none" style={{ color:scoreColor(score.score) }}>{score.score}<span className="text-[10px] text-slate-500">/100</span></p></div>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background:`${scoreColor(score.score)}22`, color:scoreColor(score.score) }}>{score.grade}</span>
            </button>
          )}
        </div>

        {/* side-by-side comparison with a second agent */}
        {d2?.summary && (
          <div className="rounded-2xl p-4" style={{ background:'rgba(6,182,212,0.06)', border:'1px solid rgba(6,182,212,0.2)' }}>
            <div className="flex items-center gap-2 mb-3"><GitCompareArrows size={15} className="text-cyan-300"/><h3 className="text-sm font-bold text-white">{ar?'مقارنة':'Compare'}</h3>
              <span className="text-[11px]"><span style={{ color:'#a5b4fc' }}>{e?.clean_name}</span> <span className="text-slate-600">↔</span> <span style={{ color:'#67e8f9' }}>{d2.employee?.clean_name}</span></span></div>
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="text-slate-500"><th className="text-start pb-1.5 font-semibold">{ar?'المقياس':'Metric'}</th>
                <th className="text-center pb-1.5 font-semibold" style={{ color:'#a5b4fc' }}>{e?.clean_name}</th>
                <th className="text-center pb-1.5 font-semibold" style={{ color:'#67e8f9' }}>{d2.employee?.clean_name}</th></tr></thead>
              <tbody>{([['workedDays','أيام عمل','Worked',true],['conformance','كونفورمانس','Conformance',true],['lateDays','أيام تأخير','Late days',false],['totalLateMin','دقائق تأخير','Late min',false],['otBefore','OT قبل','OT before',true],['otAfter','OT بعد','OT after',true],['sickDays','سيك','Sick',false],['absenceDays','غياب','Absent',false],['permissions','استئذانات','Permissions',false],['missingPunch','بصمة ناقصة','Missing punch',false],['missingSystem','سيستم ناقص','Missing system',false]] as [string,string,string,boolean][]).map(([k,la,le,hib],i)=>{
                const v1=Number(s?.[k]??0), v2=Number(d2.summary?.[k]??0); const eq=v1===v2; const w1=hib?v1>v2:v1<v2;
                const fmt=(v:number)=> k==='conformance'?`${v}%`:(/Min$/.test(k)||k==='otBefore'||k==='otAfter')?dur(v):v.toLocaleString();
                const col=(win:boolean)=> eq?'#cbd5e1':win?'#4ade80':'#f87171';
                return (<tr key={i} className="border-t border-white/5">
                  <td className="py-1 text-slate-300">{ar?la:le}</td>
                  <td className="py-1 text-center font-bold" style={{ color:col(w1) }}>{fmt(v1)}</td>
                  <td className="py-1 text-center font-bold" style={{ color:col(!w1&&!eq) }}>{fmt(v2)}</td>
                </tr>);
              })}</tbody>
            </table></div>
          </div>
        )}

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

        {/* Performance & Productivity — official scorecard Net Points + Ameyo AHT/occupancy */}
        {perf && (perf.scorecardMonths>0 || perf.productivity?.hasData) && (
          <div className="rounded-2xl p-4" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)' }}>
            <div className="flex items-center gap-2 mb-3"><Briefcase size={15} className="text-amber-300"/><h3 className="text-sm font-bold text-white">{ar?'الأداء والإنتاجية':'Performance & Productivity'}</h3>
              <span className="text-[10px] text-slate-500">{ar?'سكور كارد رسمي (Net Points) + إنتاجية أميو (AHT)':'official scorecard (Net Points) + Ameyo productivity (AHT)'}</span></div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              {[
                { l:ar?'Net Points (آخر)':'Net Points (latest)', v:perf.latestNet??'—', sub:`${perf.scorecardMonths} ${ar?'شهر':'mo'}`, c:'#fbbf24' },
                { l:'AHT', v:perf.productivity.ahtSec!=null?`${Math.floor(perf.productivity.ahtSec/60)}:${String(perf.productivity.ahtSec%60).padStart(2,'0')}`:'—', sub:ar?'دقيقة:ثانية':'mm:ss', c:'#06b6d4' },
                { l:ar?'الإشغال':'Occupancy', v:perf.productivity.occupancy!=null?perf.productivity.occupancy+'%':'—', c:'#8b5cf6' },
                { l:ar?'مكالمات':'Calls', v:(perf.productivity.calls||0).toLocaleString(), sub:`${perf.productivity.days} ${ar?'يوم':'days'}`, c:'#22c55e' },
                { l:'FCR', v:perf.fcr?.pct!=null?perf.fcr.pct+'%':'—', c:'#34d399' },
              ].map((x,i)=>(
                <div key={i} className="p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{x.l}</p>
                  <p className="text-lg font-bold leading-tight" style={{ color:x.c }}>{x.v}</p>{x.sub&&<p className="text-[9px] text-slate-500">{x.sub}</p>}</div>
              ))}
            </div>
            {perf.scorecard?.length>0 && (
              <div><p className="text-[10px] text-slate-500 mb-1">{ar?'اتجاه Net Points الشهري':'Monthly Net Points trend'}</p>
                <div className="flex items-end gap-2 h-20">
                  {perf.scorecard.map((m:any,i:number)=>{ const max=Math.max(...perf.scorecard.map((x:any)=>Number(x.net)||0),1); const v=Number(m.net)||0; const col=v>=100?'#22c55e':v>=80?'#06b6d4':v>=60?'#f59e0b':'#f43f5e';
                    return (<div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                      <span className="text-[8px] mb-0.5" style={{ color:col }}>{v}</span>
                      <div className="w-full rounded-t" style={{ height:`${Math.max(4,100*v/max)}%`, background:col }}/>
                      <span className="text-[8px] text-slate-500 mt-0.5">{m.year%100}/{m.month}</span>
                    </div>);
                  })}
                </div>
              </div>
            )}
            {/* detailed scorecard KPI breakdown (Quality/AHT/FCR/Productivity/CTR/Quiz/PRR/...) */}
            {perf.scorecardDetail?.kpis?.length>0 && (
              <div className="mt-3">
                <p className="text-[10px] text-slate-500 mb-2">{ar?`تفصيل الـKPIs (سكور كارد · ${perf.scorecardDetail.weeks} أسابيع · ترتيب #${perf.scorecardDetail.rank??'—'})`:`Scorecard KPI breakdown (${perf.scorecardDetail.weeks} weeks · rank #${perf.scorecardDetail.rank??'—'})`}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {perf.scorecardDetail.kpis.map((k:any,i:number)=>(
                    <div key={i} className="p-2 rounded-lg" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[10px] text-slate-400 font-semibold truncate">{k.label}</p>
                      <p className="text-base font-bold text-white leading-tight">{k.score}<span className="text-[9px] text-slate-500"> {ar?'نقطة':'pts'}</span></p>
                      <p className="text-[9px] text-slate-500">{k.actual==null?'' : k.unit==='pct'?`${Math.round(k.actual*1000)/10}%` : k.unit==='min'?`${Math.floor(k.actual)}:${String(Math.round((k.actual-Math.floor(k.actual))*60)).padStart(2,'0')}` : `${k.actual}`}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Progress over time — did this agent improve or decline? */}
        {prog?.months?.length>1 && (() => {
          const v = prog.verdict; const OVC:Record<string,[string,string]> = { improving:['#22c55e', ar?'في تحسّن ↑':'Improving ↑'], declining:['#f43f5e', ar?'في تراجع ↓':'Declining ↓'], mixed:['#f59e0b', ar?'متفاوت':'Mixed'], stable:['#06b6d4', ar?'مستقر':'Stable'] };
          const [oc,ol] = OVC[v.overall]||OVC.stable;
          const arrow = (dd:number|null, goodUp=true) => dd==null ? <span className="text-slate-600">·</span> : (()=>{ const good = goodUp ? dd>0 : dd<0; const c = dd===0?'#64748b':good?'#4ade80':'#f87171'; return <span style={{ color:c }}>{dd>0?'▲':dd<0?'▼':'•'} {Math.abs(dd)}</span>; })();
          return (
            <div className="rounded-2xl p-4" style={{ background:`${oc}10`, border:`1px solid ${oc}33` }}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <GitCompareArrows size={15} style={{ color:oc }}/><h3 className="text-sm font-bold text-white">{ar?'التحسّن عبر الزمن':'Progress over time'}</h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background:`${oc}22`, color:oc }}>{ol}</span>
                {v.conformance && <span className="text-[11px] text-slate-300">{ar?'الكونفورمانس':'Conformance'}: {v.conformance.first}% → {v.conformance.last}% <b style={{ color:v.conformance.change>=0?'#4ade80':'#f87171' }}>({v.conformance.change>=0?'+':''}{v.conformance.change})</b></span>}
                {v.net && <span className="text-[11px] text-slate-300">Net: {v.net.first} → {v.net.last} <b style={{ color:v.net.change>=0?'#4ade80':'#f87171' }}>({v.net.change>=0?'+':''}{v.net.change})</b></span>}
              </div>
              <div className="overflow-x-auto"><table className="w-full text-[11px]">
                <thead><tr className="text-slate-500">{[ar?'الشهر':'Month',ar?'كونف%':'Conf%','Δ','Net','Δ',ar?'تأخير':'Late',ar?'غياب':'Abs','OT'].map((h,i)=><th key={i} className={`pb-1.5 font-semibold ${i===0?'text-start':'text-center'}`}>{h}</th>)}</tr></thead>
                <tbody>{prog.months.map((m:any,i:number)=>(
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-1 text-slate-200">{m.label}</td>
                    <td className="py-1 text-center font-semibold" style={{ color:adhC(m.conf) }}>{m.conf??'—'}</td>
                    <td className="py-1 text-center">{m.d?arrow(m.d.conf,true):''}</td>
                    <td className="py-1 text-center text-slate-300">{m.net??'—'}</td>
                    <td className="py-1 text-center">{m.d?arrow(m.d.net,true):''}</td>
                    <td className="py-1 text-center" style={{ color:m.lateDays?'#f59e0b':'#475569' }}>{m.lateDays||'·'}</td>
                    <td className="py-1 text-center" style={{ color:m.absent?'#f87171':'#475569' }}>{m.absent||'·'}</td>
                    <td className="py-1 text-center text-emerald-300/80">{m.otMin?dur(m.otMin):'·'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <p className="text-[10px] text-slate-500 mt-2">{ar?'▲/▼ مقارنة بالشهر السابق (أخضر = أفضل). Net فارغ بعد آخر شهر سكور كارد.':'▲/▼ vs previous month (green = better). Net blank after the last scorecard month.'}</p>
            </div>
          );
        })()}

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

        {/* ── Custom report for THIS agent (على كيفك) ── */}
        <div className="rounded-2xl p-4" style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.18)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <Wrench size={15} className="text-indigo-300"/>
            <h3 className="text-sm font-bold text-white">{ar?'ريبورت مخصّص لهذا الموظف':'Custom report for this agent'}</h3>
            <span className="text-[10px] text-slate-500">{ar?'اختر الأعمدة أو الـKPIs، ضمن نطاق التاريخ، وصدّر Excel':'pick fields or KPIs within the date range, export Excel'}</span>
            <button onClick={()=>setROpen(o=>!o)} className="ms-auto text-[11px] text-indigo-300 px-2.5 py-1 rounded-lg" style={{ background:'rgba(99,102,241,0.15)' }}>{rOpen?(ar?'إخفاء':'Hide'):(ar?'افتح المُنشئ':'Open builder')}</button>
          </div>

          {rOpen && (<div className="mt-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                <button onClick={()=>setRpt(p=>({...p,mode:'detail'}))} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" style={rpt.mode==='detail'?{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff'}:{color:'#94a3b8'}}><LayoutList size={13}/>{ar?'تفصيلي':'Detail'}</button>
                <button onClick={()=>setRpt(p=>({...p,mode:'summary'}))} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" style={rpt.mode==='summary'?{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff'}:{color:'#94a3b8'}}><Table2 size={13}/>{ar?'ملخّص':'Summary'}</button>
              </div>
              {rpt.mode==='summary' && (
                <select value={rpt.group} onChange={ev=>setRpt(p=>({...p,group:ev.target.value}))} className={inputCls}>
                  {RGROUPS.map(([k,l])=><option key={k} value={k}>{ar?'جمّع: ':'Group: '}{l}</option>)}
                </select>
              )}
              <button onClick={exportRpt} className="ms-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background:'rgba(34,197,94,0.18)', color:'#22c55e' }}><FileSpreadsheet size={13}/>{ar?'تصدير Excel':'Export Excel'}</button>
            </div>
            {/* chips */}
            <div className="flex flex-wrap gap-1.5">
              {(rpt.mode==='detail'?RFIELDS:RKPIS).map(([k,l])=>{ const sel=(rpt.mode==='detail'?rpt.fields:rpt.kpis).includes(k);
                return <button key={k} onClick={()=>toggleR(rpt.mode==='detail'?'fields':'kpis',k)} className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
                  style={sel?{background:'rgba(99,102,241,0.25)',color:'#c7d2fe',border:'1px solid rgba(99,102,241,0.5)'}:{background:'rgba(255,255,255,0.04)',color:'#94a3b8',border:'1px solid rgba(255,255,255,0.08)'}}>{l}</button>;
              })}
            </div>
            {/* preview */}
            {rData && (
              <div className="rounded-xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'40vh' }}>
                <div className="px-3 py-1.5 text-[10px] text-slate-500 border-b border-white/5">{rData.count} {ar?'صف':'rows'} · {rData.from} → {rData.to}</div>
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0" style={{ background:'#11162a' }}><tr className="text-slate-400">{(rData.columns||[]).map((c:any,i:number)=><th key={c.key} className={`px-2 py-1.5 font-semibold whitespace-nowrap ${i===0?'text-start':'text-center'}`}>{c.label}</th>)}</tr></thead>
                  <tbody>{(rData.rows||[]).slice(0,200).map((row:any,ri:number)=>(
                    <tr key={ri} className="border-t border-white/5">{(rData.columns||[]).map((c:any,ci:number)=><td key={c.key} className={`px-2 py-1 whitespace-nowrap ${ci===0?'text-start text-white':'text-center text-slate-300'}`}>{row[c.key]??'—'}</td>)}</tr>
                  ))}</tbody>
                </table>
                {(rData.rows||[]).length>200 && <div className="px-3 py-1.5 text-[10px] text-slate-500">{ar?`أول 200 — صدّر Excel للكل (${rData.count})`:`First 200 — export Excel for all (${rData.count})`}</div>}
              </div>
            )}
          </div>)}
        </div>
      </>)}
    </div>
  );
}
