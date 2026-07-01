import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, CalendarDays, Download, Play, ShieldAlert, CheckCircle2, AlertTriangle, Users } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { DateRangeBar } from '@/components/DateRangeBar';

/** WFH HR Action Report — who worked from home late / short, conservatively.
 *  Backend: roster-v2/wfh-hr-report (+ /export). Accuracy-critical: weak evidence
 *  → Data Quality, never HR. Cross-midnight night shifts go to Data Quality for
 *  raw-file validation; mothers measured on a 7h window. */
export default function WfhHrReportPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [from, setFrom] = useState('2026-05-01');
  const [to, setTo] = useState('2026-06-20');
  const [inc, setInc] = useState(false);
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'hr'|'audit'|'excluded'|'dq'|'agent'|'tl'|'function'|'date'>('hr');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ from, to }); if (inc) q.set('includeExcludedRoles','1');
    apiClient.get(`/attendance-recon/roster-v2/wfh-hr-report?${q}`).then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false));
  }, [from, to, inc]);
  useEffect(() => { const t=setTimeout(load, 250); return ()=>clearTimeout(t); }, [load]);

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ from, to }); if (inc) q.set('includeExcludedRoles','1');
      const r:any = await apiClient.get(`/attendance-recon/roster-v2/wfh-hr-report/export?${q}`, { responseType:'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href=url; a.download=`WFH_HR_Report_${from}_${to}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const T = d?.totals;
  const rowCols: [string,string][] = [
    ['day',ar?'اليوم':'Day'],['date',ar?'التاريخ':'Date'],['name',ar?'الموظف':'Employee'],['employeeNo',ar?'الرقم':'ID'],
    ['function',ar?'الفنكشن':'Function'],['role',ar?'الدور':'Role'],['teamLeader',ar?'التيم ليدر':'Team leader'],['shiftCode',ar?'الشفت':'Shift'],
    ['schedStart',ar?'بداية':'Start'],['schedEnd',ar?'نهاية':'End'],['source',ar?'المصدر':'Source'],['loginTime',ar?'لوج إن':'Login'],['logoutTime',ar?'لوج آوت':'Logout'],
    ['lateLogin',ar?'تأخير':'Late'],['earlyLogout',ar?'خروج مبكر':'Early out'],['systemSpan',ar?'ساعات السيستم':'Sys hours'],['requiredNet',ar?'المطلوب صافي':'Req net'],
    ['shortage',ar?'النقص':'Shortage'],['permission',ar?'استئذان':'Permission'],['comp','COMP'],['reason',ar?'السبب':'Reason'],
  ];
  const rows = tab==='hr'?d?.action : tab==='audit'?d?.rows : tab==='excluded'?d?.excludedValid : tab==='dq'?d?.dataQuality : null;
  const summary = tab==='agent'?d?.summaryByAgent : tab==='tl'?d?.summaryByTeamLeader : tab==='function'?d?.summaryByFunction : tab==='date'?d?.summaryByDate : null;

  const tile = (icon:any, label:string, val:any, c:string) => (
    <div className="flex items-center gap-2.5 p-3 rounded-xl lift" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${c}22`, color:c }}>{icon}</div>
      <div><p className="text-[9px] text-slate-500 uppercase font-semibold">{label}</p><p className="text-xl font-bold text-white leading-none num-pop">{val ?? '—'}</p></div>
    </div>
  );

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#0ea5e9,#6366f1)' }}><Home size={20} className="text-white"/></div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-lg font-bold text-white">{ar?'تقرير HR للعمل من المنزل':'WFH — HR Action Report'}</h1>
          <p className="text-xs text-slate-500">{ar?'مين داوم من البيت وتأخّر/سكّر بدري بدون استئذان — متحفّظ: الأدلة الضعيفة تروح جودة البيانات مش HR':'who worked from home late/short with no permission — conservative: weak evidence → Data Quality, never HR'}</p></div>
        <DateRangeBar from={from} to={to} onChange={(a,b)=>{setFrom(a);setTo(b);}} />
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none"><input type="checkbox" checked={inc} onChange={e=>setInc(e.target.checked)} className="accent-indigo-500"/>{ar?'تضمين الأدوار المستثناة':'Include excluded roles'}</label>
        <button onClick={load} className="btn-secondary text-xs"><Play size={13}/>{ar?'تشغيل':'Run'}</button>
        <button onClick={exportXlsx} disabled={busy||!d} className="btn-primary text-xs">{busy?'…':<><Download size={13}/>Excel</>}</button>
      </div>

      {/* accuracy banner */}
      <div className="flex items-start gap-2 p-3 rounded-2xl text-[11px]" style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.22)', color:'#fbbf24' }}>
        <ShieldAlert size={14} className="flex-shrink-0 mt-0.5"/>
        <span>{ar?'هذا التقرير فيه أكشن على موظفين. الاستئذان/COMP من قاعدة البيانات — دقّقها مقابل ملفات أودو قبل الإرسال النهائي. ورديات منتصف الليل (MD/MN) تروح «جودة البيانات» للتدقيق من الملفات الخام (الجلسة مقسّمة عبر يومين). الأمهات تُقاس على 7 ساعات.':'This report drives HR action. Permission/COMP come from the DB — validate vs Odoo files before final submission. Cross-midnight (MD/MN) go to Data Quality for raw-file validation (overnight session is split across days). Mothers measured on a 7h window.'}</span>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ الحساب…':'Computing…'}</p>}
      {!loading && d && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 stagger-grid">
          {tile(<Users size={16}/>, ar?'سجلات WFH':'WFH records', T?.wfhRecords, '#06b6d4')}
          {tile(<ShieldAlert size={16}/>, ar?'يروح HR':'HR action', T?.hrAction, '#f43f5e')}
          {tile(<CheckCircle2 size={16}/>, ar?'مستثنى صحيح':'Excluded valid', T?.excludedValid, '#22c55e')}
          {tile(<AlertTriangle size={16}/>, ar?'جودة بيانات':'Data quality', T?.dataQuality, '#f59e0b')}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {([['hr',ar?'يروح HR':'HR Action',T?.hrAction],['audit',ar?'كل السجلات':'Audit All',T?.wfhRecords],['excluded',ar?'مستثنى':'Excluded',T?.excludedValid],['dq',ar?'جودة بيانات':'Data Quality',T?.dataQuality],['agent',ar?'حسب الموظف':'By Agent',''],['tl',ar?'حسب التيم ليدر':'By TL',''],['function',ar?'حسب الفنكشن':'By Function',''],['date',ar?'حسب التاريخ':'By Date','']] as [string,string,any][]).map(([k,l,n])=>(
            <button key={k} onClick={()=>setTab(k as any)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
              style={tab===k?{background:'linear-gradient(135deg,#6366f1,#06b6d4)',color:'#fff'}:{background:'rgba(255,255,255,0.05)',color:'#94a3b8',border:'1px solid rgba(255,255,255,0.08)'}}>{l}{n!==''&&n!=null?` (${n})`:''}</button>
          ))}
        </div>

        {rows && (
          <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'62vh' }}>
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10" style={{ background:'#11162a' }}><tr className="text-slate-400">{rowCols.map(([,l],i)=><th key={i} className={`px-2 py-2 font-semibold whitespace-nowrap ${i<2?'text-start':'text-center'}`}>{l}</th>)}</tr></thead>
              <tbody>{rows.length===0 ? <tr><td colSpan={rowCols.length} className="text-center text-slate-500 py-8">{ar?'لا سجلات':'No records'}</td></tr> :
                rows.map((r:any,i:number)=>(
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">
                  {rowCols.map(([k],j)=>(
                    <td key={j} className={`px-2 py-1.5 whitespace-nowrap ${j<2?'text-start text-slate-300':'text-center'} ${k==='name'?'text-white font-medium':''} ${k==='shortage'&&r.bucket==='hr_action'?'text-rose-300 font-bold':''} ${k==='reason'?'text-start text-slate-400':''}`}
                      style={k==='reason'?{maxWidth:280,whiteSpace:'normal'}:undefined}>
                      {k==='mother'&&r[k]?'👩':String(r[k]??'')}{k==='name'&&r.mother?<span className="ms-1 text-[9px] text-pink-300">7h</span>:''}
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {summary && (
          <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'62vh' }}>
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10" style={{ background:'#11162a' }}><tr className="text-slate-400">
                {[ar?'الاسم':'Name',ar?'إجمالي':'Total',ar?'يروح HR':'HR action',ar?'مستثنى':'Excluded',ar?'جودة بيانات':'Data quality'].map((h,i)=><th key={i} className={`px-3 py-2 font-semibold ${i===0?'text-start':'text-center'}`}>{h}</th>)}
              </tr></thead>
              <tbody>{summary.map((g:any,i:number)=>(
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 text-white font-medium">{g.key}</td>
                  <td className="px-3 py-1.5 text-center text-slate-300">{g.total}</td>
                  <td className="px-3 py-1.5 text-center font-bold" style={{ color:g.hr?'#f87171':'#475569' }}>{g.hr||'·'}</td>
                  <td className="px-3 py-1.5 text-center text-emerald-300/80">{g.excluded||'·'}</td>
                  <td className="px-3 py-1.5 text-center text-amber-300/80">{g.dq||'·'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {/* final summary */}
        {T && (
          <div className="rounded-2xl p-4 text-[11px] space-y-2" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs font-bold text-white">{ar?'ملخّص نهائي':'Final summary'}</p>
            <p className="text-slate-400">{ar?'سبب الاستثناء:':'Excluded by reason:'} {Object.entries(T.byReason).map(([k,v]:any)=>`${k}: ${v}`).join(' · ')}</p>
            <p className="text-slate-400">{ar?'أكثر الموظفين (HR):':'Top agents (HR):'} {(T.topAgents||[]).map((a:any)=>`${a.key} (${a.hr})`).join(' · ')||'—'}</p>
            <p className="text-slate-400">{ar?'أكثر التواريخ (HR):':'Top dates (HR):'} {(T.topDates||[]).map((a:any)=>`${a.key} (${a.hr})`).join(' · ')||'—'}</p>
          </div>
        )}
      </>)}
    </div>
  );
}
