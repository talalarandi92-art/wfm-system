import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, Table2, LayoutList, Play, CalendarDays, Search, Wrench, Zap, Save, Bookmark, X } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

type Cat = { key: string; label: string };
const DEFAULT_FIELDS = ['date','agent','function','teamLeader','shiftCode','sysLogin','sysLogout','lateMin','otBefore','otAfter','attendanceStatus'];
const DEFAULT_KPIS = ['scheduledDays','workedDays','sickDays','absenceDays','lateMin','otMin','conformance'];

// The 36 spec reports as one-click presets. Each sets mode + fields/KPIs + groupBy + filters.
type Preset = { id:string; ar:string; en:string; grp:string; mode:'detail'|'summary'; fields?:string[]; kpis?:string[]; groupBy?:string; filters?:Record<string,string> };
const PRESETS: Preset[] = [
  // Attendance
  { id:'att-d', ar:'الحضور — يومي', en:'Attendance — Daily', grp:'Attendance', mode:'detail', fields:['date','agent','function','teamLeader','shiftCode','attendanceStatus','sysLogin','sysLogout','lateMin','otAfter','conformance'] },
  { id:'att-w', ar:'الحضور — أسبوعي', en:'Attendance — Weekly', grp:'Attendance', mode:'summary', groupBy:'week', kpis:['scheduledDays','workedDays','sickDays','absenceDays','lateDays','conformance'] },
  { id:'att-m', ar:'الحضور — شهري', en:'Attendance — Monthly', grp:'Attendance', mode:'summary', groupBy:'month', kpis:['scheduledDays','workedDays','sickDays','absenceDays','lateDays','conformance'] },
  // Tardiness
  { id:'tar-d', ar:'التأخير — يومي', en:'Tardiness — Daily', grp:'Tardiness', mode:'summary', groupBy:'date', kpis:['lateDays','lateMin','avgLate','earlyMin'], filters:{ onlyTardiness:'1' } },
  { id:'tar-w', ar:'التأخير — أسبوعي', en:'Tardiness — Weekly', grp:'Tardiness', mode:'summary', groupBy:'week', kpis:['lateDays','lateMin','avgLate','earlyMin'], filters:{ onlyTardiness:'1' } },
  { id:'tar-m', ar:'التأخير — شهري', en:'Tardiness — Monthly', grp:'Tardiness', mode:'summary', groupBy:'month', kpis:['lateDays','lateMin','avgLate','earlyMin'], filters:{ onlyTardiness:'1' } },
  { id:'tar-band', ar:'التأخير — حسب الفئة', en:'Tardiness — by Band', grp:'Tardiness', mode:'summary', groupBy:'lateCategory', kpis:['scheduledDays','agents'], filters:{ onlyTardiness:'1' } },
  // Overtime
  { id:'ot-d', ar:'OT — يومي', en:'Overtime — Daily', grp:'Overtime', mode:'summary', groupBy:'date', kpis:['otMin','otBefore','otAfter','offdayOt','holidayOt'] },
  { id:'ot-w', ar:'OT — أسبوعي', en:'Overtime — Weekly', grp:'Overtime', mode:'summary', groupBy:'week', kpis:['otMin','otBefore','otAfter','offdayOt','holidayOt'] },
  { id:'ot-m', ar:'OT — شهري', en:'Overtime — Monthly', grp:'Overtime', mode:'summary', groupBy:'month', kpis:['otMin','otBefore','otAfter','offdayOt','holidayOt'] },
  { id:'ot-shift', ar:'OT — حسب الشفت', en:'Overtime — by Shift', grp:'Overtime', mode:'summary', groupBy:'shift', kpis:['otMin','otBefore','otAfter'] },
  { id:'ot-agent', ar:'OT — حسب الموظف', en:'Overtime — by Agent', grp:'Overtime', mode:'summary', groupBy:'agent', kpis:['otMin','otBefore','otAfter','offdayOt','holidayOt'] },
  { id:'ot-fn', ar:'OT — حسب الفنكشن', en:'Overtime — by Function', grp:'Overtime', mode:'summary', groupBy:'function', kpis:['otMin','otBefore','otAfter'] },
  { id:'ot-tl', ar:'OT — حسب التيم ليدر', en:'Overtime — by Team Leader', grp:'Overtime', mode:'summary', groupBy:'teamLeader', kpis:['otMin','otBefore','otAfter'] },
  { id:'ot-grp', ar:'OT — حسب الجروب', en:'Overtime — by Group', grp:'Overtime', mode:'summary', groupBy:'group', kpis:['otMin','otBefore','otAfter'] },
  // HR Matrix
  { id:'hr-d', ar:'HR Matrix — يومي', en:'HR Matrix — Daily', grp:'HR Matrix', mode:'summary', groupBy:'date', kpis:['workedDays','sickDays','absenceDays','leaveDays','offDays'] },
  { id:'hr-w', ar:'HR Matrix — أسبوعي', en:'HR Matrix — Weekly', grp:'HR Matrix', mode:'summary', groupBy:'week', kpis:['workedDays','sickDays','absenceDays','leaveDays','offDays'] },
  { id:'hr-m', ar:'HR Matrix — شهري', en:'HR Matrix — Monthly', grp:'HR Matrix', mode:'summary', groupBy:'month', kpis:['workedDays','sickDays','absenceDays','leaveDays','offDays'] },
  { id:'hr-agent', ar:'HR Matrix — حسب الموظف', en:'HR Matrix — by Agent', grp:'HR Matrix', mode:'summary', groupBy:'agent', kpis:['workedDays','sickDays','absenceDays','lateMin','conformance'] },
  { id:'hr-fn', ar:'HR Matrix — حسب الفنكشن', en:'HR Matrix — by Function', grp:'HR Matrix', mode:'summary', groupBy:'function', kpis:['workedDays','sickDays','absenceDays','conformance'] },
  { id:'hr-tl', ar:'HR Matrix — حسب التيم ليدر', en:'HR Matrix — by Team Leader', grp:'HR Matrix', mode:'summary', groupBy:'teamLeader', kpis:['workedDays','sickDays','absenceDays','conformance'] },
  { id:'hr-grp', ar:'HR Matrix — حسب الجروب', en:'HR Matrix — by Group', grp:'HR Matrix', mode:'summary', groupBy:'group', kpis:['workedDays','sickDays','absenceDays','conformance'] },
  // Leave / WFH / permission / comp
  { id:'sick', ar:'الإجازات المرضية', en:'Sick Leave', grp:'Leave & Status', mode:'detail', fields:['date','agent','function','teamLeader','originalShift','attendanceStatus'], filters:{ sick:'1' } },
  { id:'absence', ar:'الغياب', en:'Absence', grp:'Leave & Status', mode:'detail', fields:['date','agent','function','teamLeader','originalShift','attendanceStatus'], filters:{ absent:'1' } },
  { id:'wfh', ar:'العمل من المنزل', en:'WFH', grp:'Leave & Status', mode:'detail', fields:['date','agent','function','shiftCode','sysLogin','sysLogout','conformance'], filters:{ wfh:'1' } },
  { id:'perm', ar:'الاستئذانات', en:'Permissions', grp:'Leave & Status', mode:'detail', fields:['date','agent','function','permission','permissionDuration','shiftCode'], filters:{ permission:'1' } },
  { id:'comp', ar:'أيام COMP', en:'COMP', grp:'Leave & Status', mode:'detail', fields:['date','agent','function','shiftCode','attendanceStatus'], filters:{ comp:'1' } },
  // Shift distribution
  { id:'shiftdist', ar:'توزيع الشفتات', en:'Shift Distribution', grp:'Shift', mode:'summary', groupBy:'shift', kpis:['scheduledDays','agents','workedDays'] },
  { id:'shiftrate', ar:'توزيع الشفتات حسب الموظف', en:'Shift Distribution by Agent', grp:'Shift', mode:'summary', groupBy:'agent', kpis:['scheduledDays','workedDays','otMin','conformance'] },
  // Conformance
  { id:'conf-fn', ar:'الكونفورمانس حسب الفنكشن', en:'Conformance by Function', grp:'Conformance', mode:'summary', groupBy:'function', kpis:['conformance','workedDays','lateMin','missingSystem'] },
  { id:'conf-tl', ar:'الكونفورمانس حسب التيم ليدر', en:'Conformance by Team Leader', grp:'Conformance', mode:'summary', groupBy:'teamLeader', kpis:['conformance','workedDays','lateMin','mismatch'] },
  // Data quality
  { id:'dq', ar:'تقرير جودة البيانات', en:'Data Quality', grp:'Quality', mode:'detail', fields:['date','agent','function','shiftCode','attendanceStatus','dataQuality'] },
  { id:'misspunch', ar:'بصمة ناقصة', en:'Missing Punch', grp:'Quality', mode:'detail', fields:['date','agent','function','shiftCode','sysLogin','sysLogout'], filters:{ dataQuality:'missing-punch' } },
];

export default function ReportBuilderPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [mode, setMode] = useState<'detail'|'summary'>('detail');
  const [from, setFrom] = useState('2026-01-01'); const [to, setTo] = useState('2026-06-30');
  const [filters, setFilters] = useState<Record<string,string>>({ search:'' });
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [kpis, setKpis] = useState<string[]>(DEFAULT_KPIS);
  const [groupBy, setGroupBy] = useState('teamLeader');
  const [catalog, setCatalog] = useState<{ fields:Cat[]; kpis:Cat[]; groups:Cat[] }|null>(null);
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(false);

  const qs = useCallback(() => {
    const p = new URLSearchParams({ from, to });
    Object.entries(filters).forEach(([k,v]) => { if (v) p.set(k, v); });
    if (mode === 'summary') { p.set('groupBy', groupBy); p.set('kpis', kpis.join(',')); }
    else p.set('fields', fields.join(','));
    return p.toString();
  }, [mode, from, to, filters, fields, kpis, groupBy]);

  const run = useCallback(() => {
    setLoading(true);
    apiClient.get(`/attendance-recon/report-builder?${qs()}`).then((r:any)=>{ setData(r.data); if(r.data.catalog) setCatalog(r.data.catalog); })
      .catch(()=>setData(null)).finally(()=>setLoading(false));
  }, [qs]);
  useEffect(() => { run(); }, []); // eslint-disable-line
  useEffect(() => { const t=setTimeout(run, 350); return ()=>clearTimeout(t); }, [mode, from, to, filters, groupBy]); // eslint-disable-line

  const exportXlsx = async () => {
    try { const r:any = await apiClient.get(`/attendance-recon/report-builder?${qs()}&format=xlsx`, { responseType:'blob' });
      const a=document.createElement('a'); a.href=URL.createObjectURL(r.data); a.download='custom-report.xlsx'; a.click(); } catch {/*­*/}
  };
  const toggle = (arr:string[], setArr:(v:string[])=>void, k:string) => setArr(arr.includes(k)?arr.filter(x=>x!==k):[...arr,k]);
  const setFilt = (k:string,v:string) => setFilters(p=>({ ...p, [k]:v }));
  const applyPreset = (p:Preset) => {
    setMode(p.mode);
    if (p.fields) setFields(p.fields);
    if (p.groupBy) setGroupBy(p.groupBy);
    if (p.kpis) setKpis(p.kpis);
    setFilters({ search:'', ...(p.filters||{}) });   // clean slate + preset filters (triggers the debounced run)
  };
  const PRESET_GROUPS = [...new Set(PRESETS.map(p=>p.grp))];
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';

  // user-saved report presets (localStorage) — "build a report your way and keep it"
  const [views, setViews] = useState<Record<string,any>>(() => { try { return JSON.parse(localStorage.getItem('wfm.reportViews')||'{}'); } catch { return {}; } });
  const persistViews = (v:Record<string,any>) => { setViews(v); localStorage.setItem('wfm.reportViews', JSON.stringify(v)); };
  const saveView = () => { const name = window.prompt(ar?'اسم الريبورت:':'Report name:'); if (!name) return;
    persistViews({ ...views, [name]: { mode, from, to, filters, fields, kpis, groupBy } }); };
  const loadView = (name:string) => { const v = views[name]; if (!v) return;
    setMode(v.mode); setFrom(v.from); setTo(v.to); setFields(v.fields||DEFAULT_FIELDS); setKpis(v.kpis||DEFAULT_KPIS); setGroupBy(v.groupBy||'teamLeader'); setFilters(v.filters||{ search:'' }); };
  const delView = (name:string) => { const v = { ...views }; delete v[name]; persistViews(v); };

  const FILTERS: [string,string,string][] = [['function',ar?'الفنكشن':'Function','function_name'],['teamLeader',ar?'التيم ليدر':'Team leader','team_manager'],['group',ar?'الجروب':'Group','team_group'],['shift',ar?'الشفت':'Shift','shift_code'],['attendanceStatus',ar?'الحالة':'Status','attendance_status'],['lateCategory',ar?'فئة التأخير':'Late cat','late_category']];

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}><Wrench size={19} className="text-white"/></div>
        <div className="flex-1"><h1 className="text-lg font-bold text-white">{ar?'منشئ التقارير المخصّصة':'Custom Report Builder'}</h1>
          <p className="text-xs text-slate-500">{ar?'اختر الأعمدة أو الـKPIs، فلتر، جمّع، وصدّر Excel':'Pick fields or KPIs, filter, group, export Excel'}</p></div>
        <button onClick={saveView} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background:'rgba(99,102,241,0.18)', color:'#a5b4fc' }}><Save size={14}/>{ar?'احفظ':'Save'}</button>
        <button onClick={exportXlsx} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background:'rgba(34,197,94,0.18)', color:'#22c55e' }}><FileSpreadsheet size={14}/>{ar?'تصدير Excel':'Export Excel'}</button>
      </div>

      {/* my saved reports */}
      {Object.keys(views).length>0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] px-1">
          <span className="text-slate-500 flex items-center gap-1"><Bookmark size={12}/>{ar?'ريبوراتي:':'My reports:'}</span>
          {Object.keys(views).map(n=>(
            <span key={n} className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-200" style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.25)' }}>
              <button onClick={()=>loadView(n)}>{n}</button>
              <button onClick={()=>delView(n)} className="text-slate-500 hover:text-rose-400"><X size={11}/></button>
            </span>
          ))}
        </div>
      )}

      {/* quick reports — the 36 spec reports as one-click presets */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.18)' }}>
        <span className="text-[11px] text-indigo-300 font-bold flex items-center gap-1"><Zap size={13}/>{ar?'تقارير جاهزة':'Quick reports'}</span>
        <select onChange={e=>{ const p=PRESETS.find(x=>x.id===e.target.value); if(p) applyPreset(p); e.target.value=''; }} defaultValue="" className={`${inputCls} min-w-[220px]`}>
          <option value="">{ar?`اختر من ${PRESETS.length} تقريراً جاهزاً…`:`Pick from ${PRESETS.length} ready reports…`}</option>
          {PRESET_GROUPS.map(g=>(
            <optgroup key={g} label={g}>
              {PRESETS.filter(p=>p.grp===g).map(p=><option key={p.id} value={p.id}>{ar?p.ar:p.en}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-[10px] text-slate-500">{ar?'يضبط الأعمدة/الـKPIs/الفلاتر تلقائياً — عدّل بعدها كما تحب':'sets fields/KPIs/filters automatically — tweak afterwards'}</span>
      </div>

      {/* mode + filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button onClick={()=>setMode('detail')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" style={mode==='detail'?{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }:{ color:'#94a3b8' }}><LayoutList size={13}/>{ar?'تفصيلي':'Detail'}</button>
          <button onClick={()=>setMode('summary')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" style={mode==='summary'?{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }:{ color:'#94a3b8' }}><Table2 size={13}/>{ar?'ملخّص':'Summary'}</button>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14}/>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls}/><span className="text-xs">→</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inputCls}/></div>
        <div className="flex items-center gap-1.5"><Search size={14} className="text-slate-400"/>
          <input value={filters.search||''} onChange={e=>setFilt('search',e.target.value)} onKeyDown={e=>e.key==='Enter'&&run()} placeholder={ar?'بحث':'Search'} className={inputCls}/></div>
        {FILTERS.map(([k,label])=>(
          <input key={k} value={filters[k]||''} onChange={e=>setFilt(k,e.target.value)} placeholder={label} className={`${inputCls} w-28`} list={`dl-${k}`}/>
        ))}
        {mode==='summary' && (
          <select value={groupBy} onChange={e=>setGroupBy(e.target.value)} className={inputCls}>
            {(catalog?.groups||[]).map(g=><option key={g.key} value={g.key}>{ar?'جمّع: ':'Group: '}{g.label}</option>)}
          </select>
        )}
        <button onClick={run} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ms-auto" style={{ background:'rgba(99,102,241,0.2)', color:'#a5b4fc' }}><Play size={12}/>{ar?'تشغيل':'Run'}</button>
      </div>

      {/* field / kpi picker */}
      {catalog && (
        <div className="p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">{mode==='detail'?(ar?'اختر الأعمدة':'Select fields'):(ar?'اختر الـKPIs':'Select KPIs')}</p>
          <div className="flex flex-wrap gap-1.5">
            {(mode==='detail'?catalog.fields:catalog.kpis).map(c=>{ const sel=(mode==='detail'?fields:kpis).includes(c.key);
              return <button key={c.key} onClick={()=>{ mode==='detail'?toggle(fields,setFields,c.key):toggle(kpis,setKpis,c.key); }}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
                style={sel?{ background:'rgba(99,102,241,0.25)', color:'#c7d2fe', border:'1px solid rgba(99,102,241,0.5)' }:{ background:'rgba(255,255,255,0.04)', color:'#94a3b8', border:'1px solid rgba(255,255,255,0.08)' }}>{c.label}</button>;
            })}
          </div>
        </div>
      )}

      {/* results */}
      {loading && <p className="text-sm text-slate-500 py-6 text-center">{ar?'جارٍ التشغيل…':'Running…'}</p>}
      {!loading && data && (
        <div className="rounded-2xl overflow-auto" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', maxHeight:'62vh' }}>
          <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-white/5">{data.count} {ar?'صف':'rows'} · {data.from} → {data.to} · {data.mode}</div>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10" style={{ background:'#11162a' }}>
              <tr className="text-slate-400">{(data.columns||[]).map((c:any,i:number)=><th key={c.key} className={`px-3 py-2 font-semibold whitespace-nowrap ${i===0?'text-start':'text-center'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {(data.rows||[]).slice(0,500).map((r:any,ri:number)=>(
                <tr key={ri} className="border-t border-white/5 hover:bg-white/[0.03]">
                  {(data.columns||[]).map((c:any,ci:number)=><td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${ci===0?'text-start text-white font-medium':'text-center text-slate-300'}`}>{r[c.key]??'—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {(data.rows||[]).length>500 && <div className="px-3 py-2 text-[11px] text-slate-500">{ar?`عرض أول 500 — صدّر Excel للكل (${data.count})`:`Showing first 500 — export Excel for all (${data.count})`}</div>}
        </div>
      )}
    </div>
  );
}
