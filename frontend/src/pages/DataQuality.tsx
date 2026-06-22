import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, Users, Copy, UserX, AlertTriangle, GitMerge, Clock3, CheckCircle2, Layers,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

/** Data Quality & Inactive/Duplicate Employee Audit — the integrity proof.
 *  Surfaces the canonical-identity collapse (old↔new intern IDs), inactive/
 *  superseded ids, roster orphans, function-column pollution, the configurable
 *  role-working-hours lookup, and the team-leader verification audit. */
export default function DataQualityPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/attendance-recon/roster-v2/integrity').then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
  }, []);

  const h = d?.headline;
  const card = (ic:any, label:string, v:any, sub:string, c:string) => (
    <div className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${c}22`, color:c }}>{ic}</div>
      <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold tracking-wide truncate">{label}</p>
        <p className="text-xl font-bold text-white leading-tight">{v}</p><p className="text-[9px] text-slate-500 truncate">{sub}</p></div>
    </div>
  );
  const panel = 'rounded-2xl p-4';
  const panelStyle = { background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' } as const;

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3">
        <button onClick={()=>nav('/roster-dashboard')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#f59e0b,#ef4444)' }}><ShieldCheck size={20} className="text-white"/></div>
        <div className="flex-1"><h1 className="text-lg font-bold text-white">{ar?'جودة البيانات وتدقيق الموظفين':'Data Quality & Employee Audit'}</h1>
          <p className="text-xs text-slate-500">{ar?'هوية موحّدة · تكرارات · غير نشطين · أيتام · تلوّث الفنكشن · ساعات الأدوار · تدقيق التيم ليدرز':'Canonical identity · duplicates · inactive · orphans · function pollution · role hours · team-leader audit'}</p></div>
        <button onClick={async()=>{ try { const r:any=await apiClient.get('/attendance-recon/roster-v2/master-export',{ responseType:'blob' }); const u=URL.createObjectURL(r.data); const a=document.createElement('a'); a.href=u; a.download='WFM_Master.xlsx'; a.click(); URL.revokeObjectURL(u); } catch { /* */ } }}
          className="text-[11px] text-emerald-300 px-3 py-2 rounded-xl flex items-center gap-1.5" style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.25)' }}>
          <Layers size={14}/>{ar?'تصدير الماستر (Excel)':'Master Excel'}</button>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && (<>
        {/* headline */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {card(<Users size={18}/>, ar?'أرقام خام':'Raw IDs', h.raw_ids, ar?'في المصدر':'in source', '#64748b')}
          {card(<CheckCircle2 size={18}/>, ar?'أشخاص فعليين':'Real people', h.persons, ar?'بعد التوحيد':'after merge', '#22c55e')}
          {card(<GitMerge size={18}/>, ar?'أرقام مدمجة':'IDs collapsed', h.aliases, ar?'قديم↔جديد':'old↔new', '#6366f1')}
          {card(<UserX size={18}/>, ar?'أشخاص غير نشطين':'Inactive people', h.inactive_persons, ar?'مستبعدون افتراضياً':'excluded by default', '#f59e0b')}
          {card(<AlertTriangle size={18}/>, ar?'أيتام':'Orphans', d.orphans?.length||0, ar?'بدون ماستر':'no master row', '#ef4444')}
          {card(<Layers size={18}/>, ar?'صفوف الروستر':'Roster rows', (h.roster_rows||0).toLocaleString(), `${h.unstamped} ${ar?'بدون هوية':'unstamped'}`, '#06b6d4')}
        </div>

        {/* Team-leader verification */}
        <div className={panel} style={panelStyle}>
          <div className="flex items-center gap-2 mb-3"><Users size={15} className="text-amber-400"/><h3 className="text-sm font-bold text-white">{ar?'تدقيق التيم ليدرز':'Team-Leader Verification'}</h3>
            <span className="text-[10px] text-slate-500">{ar?'الليبل اللي ما ينطبق على موظف تيم ليدر نشط = يحتاج تأكيد (ربما ترك العمل)':'a label not matching an active team-leader employee = verify (may have left)'}</span></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(d.teamLeaders||[]).map((t:any,i:number)=>{
              const S:Record<string,[string,string,string]> = {
                current:[ar?'حالي ✓':'Current ✓','#4ade80','rgba(34,197,94,'],
                director:[ar?'مدير':'Director','#60a5fa','rgba(59,130,246,'],
                left:[ar?'ترك العمل':'Left','#f87171','rgba(239,68,68,'],
                unverified:[ar?'غير مؤكد':'Unverified','#fbbf24','rgba(245,158,11,'],
              };
              const [label,col,rgb] = S[t.status] || S[t.verified?'current':'unverified'];
              return (
                <div key={i} className="flex items-center justify-between gap-2 p-2.5 rounded-xl" style={{ background:`${rgb}0.08)`, border:`1px solid ${rgb}0.28)` }}>
                  <div className="min-w-0"><p className="text-xs font-semibold text-white truncate">{t.name}</p>
                    <p className="text-[10px] text-slate-400">{t.reports} {ar?'تابع':'reports'} · {ar?'آخر':'last'} {t.last_seen}</p></div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background:`${rgb}0.2)`, color:col }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Duplicate Agent Audit */}
        <div className={panel} style={panelStyle}>
          <div className="flex items-center gap-2 mb-3"><Copy size={15} className="text-indigo-400"/><h3 className="text-sm font-bold text-white">{ar?'تدقيق التكرارات (نفس الشخص بأكثر من رقم)':'Duplicate Agent Audit (same person, multiple IDs)'}</h3>
            <span className="text-[10px] text-slate-500">{d.duplicates?.length} {ar?'حالة دمج':'merged'}</span></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="text-slate-500 text-start">
              <th className="text-start font-semibold pb-1.5">{ar?'الرقم المعتمد':'Canonical'}</th>
              <th className="text-start font-semibold pb-1.5">{ar?'الاسم':'Name'}</th>
              <th className="text-start font-semibold pb-1.5">{ar?'كل الأرقام':'All IDs'}</th>
            </tr></thead>
            <tbody>{(d.duplicates||[]).map((r:any,i:number)=>(
              <tr key={i} className="border-t border-white/5">
                <td className="py-1.5 text-emerald-300 font-mono">{r.person_no}</td>
                <td className="py-1.5 text-slate-200">{r.clean_name}</td>
                <td className="py-1.5">
                  <div className="flex flex-wrap gap-1">{(r.ids||[]).map((x:any,j:number)=>(
                    <span key={j} className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ background:x.is_canonical?'rgba(34,197,94,0.15)':'rgba(255,255,255,0.06)', color:x.is_canonical?'#4ade80':x.status==='active'?'#cbd5e1':'#f87171' }}
                      title={x.is_canonical?'canonical':x.status}>{x.employee_no}{x.status!=='active'?` (${x.status})`:''}</span>
                  ))}</div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {/* Inactive / superseded */}
          <div className={panel} style={panelStyle}>
            <div className="flex items-center gap-2 mb-3"><UserX size={15} className="text-amber-400"/><h3 className="text-sm font-bold text-white">{ar?'أرقام غير نشطة / مستبدلة':'Inactive / Superseded IDs'}</h3></div>
            <div className="space-y-1 max-h-72 overflow-y-auto">{(d.inactiveIds||[]).map((r:any,i:number)=>(
              <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b border-white/5">
                <span className="text-slate-300">{r.clean_name}</span>
                <span className="text-slate-500 font-mono">{r.employee_no}{r.alias_of?` → ${r.alias_of}`:''} <span className="text-amber-400/80">{r.status}</span></span>
              </div>
            ))}{(!d.inactiveIds||!d.inactiveIds.length)&&<p className="text-[11px] text-slate-600">—</p>}</div>
          </div>

          {/* Role working hours lookup */}
          <div className={panel} style={panelStyle}>
            <div className="flex items-center gap-2 mb-3"><Clock3 size={15} className="text-cyan-400"/><h3 className="text-sm font-bold text-white">{ar?'ساعات العمل حسب الدور (قابلة للضبط)':'Role Working-Hours Lookup'}</h3></div>
            <table className="w-full text-[11px]">
              <thead><tr className="text-slate-500">
                <th className="text-start font-semibold pb-1">{ar?'الدور':'Role'}</th>
                <th className="text-center font-semibold pb-1">{ar?'ساعات':'Hrs'}</th>
                <th className="text-center font-semibold pb-1">{ar?'تأخير':'Tardy'}</th>
                <th className="text-center font-semibold pb-1">OT</th>
                <th className="text-center font-semibold pb-1">{ar?'كونف.':'Adh.'}</th>
              </tr></thead>
              <tbody>{(d.roleHours||[]).map((r:any,i:number)=>(
                <tr key={i} className="border-t border-white/5">
                  <td className="py-1 text-slate-200">{r.role_category}</td>
                  <td className="py-1 text-center text-white font-semibold">{Number(r.default_hours)}h</td>
                  {['include_tardiness','include_overtime','include_adherence'].map(k=>(
                    <td key={k} className="py-1 text-center">{r[k]
                      ? <CheckCircle2 size={12} className="inline text-emerald-400"/>
                      : <span className="text-slate-600">—</span>}</td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
            <p className="text-[10px] text-slate-500 mt-2">{ar?'RTA / كاستمر كير / Resolution / تيم ليدر = 8 ساعات، مستبعدون من حساب التأخير افتراضياً (سجلات فقط).':'RTA / Customer Care / Resolution / Team Leader = 8h, excluded from default tardiness (records only).'}</p>
          </div>
        </div>

        {/* function pollution + orphans */}
        <div className="grid lg:grid-cols-2 gap-3">
          <div className={panel} style={panelStyle}>
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={15} className="text-rose-400"/><h3 className="text-sm font-bold text-white">{ar?'تلوّث عمود الفنكشن':'Function-Column Pollution'}</h3></div>
            <p className="text-[11px] text-slate-400">{ar?'عمود الفنكشن في المصدر كان يحمل كود شفت/إجازة في كثير من الصفوف. تم اشتقاق الفنكشن الحقيقي من ماستر الموظفين (role_function).':'The source function column held a shift/leave code in many rows. The real function is now derived from the employee master (role_function).'}</p>
            <div className="flex gap-4 mt-2 text-[11px]">
              <span className="text-slate-300">{ar?'صفوف':'Rows'}: <b className="text-white">{(d.pollution?.rows||0).toLocaleString()}</b></span>
              <span className="text-rose-300">{ar?'كانت ملوّثة':'Were mismatched'}: <b>{(d.pollution?.mismatched||0).toLocaleString()}</b></span>
              <span className="text-amber-300">{ar?'بدون فنكشن نظيف':'No clean fn'}: <b>{d.pollution?.no_clean_function||0}</b></span>
            </div>
          </div>
          <div className={panel} style={panelStyle}>
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={15} className="text-amber-400"/><h3 className="text-sm font-bold text-white">{ar?'أرقام أيتام (بدون ماستر)':'Orphan IDs (no master row)'}</h3></div>
            <div className="flex flex-wrap gap-1.5">{(d.orphans||[]).map((o:any,i:number)=>(
              <span key={i} className="px-2 py-1 rounded-lg text-[11px] text-slate-200" style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)' }}>{o.name} <span className="font-mono text-slate-500">{o.employee_no}</span></span>
            ))}{(!d.orphans||!d.orphans.length)&&<p className="text-[11px] text-emerald-400">{ar?'لا يوجد':'None'} ✓</p>}</div>
          </div>
        </div>
      </>)}
    </div>
  );
}
