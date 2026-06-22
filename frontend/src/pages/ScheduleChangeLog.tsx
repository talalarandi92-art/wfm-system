import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Repeat, Pencil, History, Undo2, ArrowRight, CalendarDays, GitCompareArrows } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const SHIFTS = ['M','B','C','N','E','EE20','MD','MN','M20','B20','C20','N20','M7','B7','C7','N7','OFF','H','L','COMP'];
const CAT_COLORS: Record<string,string> = { Morning:'#22c55e', Night:'#06b6d4', Evening:'#f59e0b', Midnight:'#8b5cf6', Other:'#64748b' };

/** Searchable agent picker (type to filter 141 people, click to select). */
function PersonPicker({ value, onChange, people, placeholder }: { value:string; onChange:(v:string)=>void; people:any[]; placeholder:string }) {
  const [q,setQ] = useState(''); const [open,setOpen] = useState(false);
  const sel = people.find((p:any)=>p.person_no===value);
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400 min-w-[200px]';
  const filtered = people.filter((p:any)=>{ const t=q.toLowerCase().trim(); return !t || p.clean_name.toLowerCase().includes(t) || String(p.person_no).includes(t) || (p.role_category||'').toLowerCase().includes(t); });
  return (
    <div className="relative" onBlur={()=>setTimeout(()=>setOpen(false),150)}>
      <input value={open?q:(sel?`${sel.clean_name} · ${sel.role_category}`:'')} placeholder={placeholder}
        onChange={e=>{ setQ(e.target.value); setOpen(true); }} onFocus={()=>{ setQ(''); setOpen(true); }} className={cls}/>
      {open && (
        <div className="absolute z-50 mt-1 w-[280px] max-h-72 overflow-auto rounded-xl shadow-2xl" style={{ background:'#11162a', border:'1px solid rgba(255,255,255,0.15)' }}>
          {filtered.slice(0,150).map((p:any)=>(
            <button key={p.person_no} type="button" onMouseDown={()=>{ onChange(p.person_no); setOpen(false); setQ(''); }}
              className="w-full text-start px-3 py-1.5 text-xs hover:bg-white/10 flex justify-between gap-2" style={{ color:p.person_no===value?'#a5b4fc':'#cbd5e1' }}>
              <span className="truncate">{p.clean_name}</span><span className="text-slate-500 text-[10px] flex-shrink-0">{p.role_category} · #{p.person_no}</span>
            </button>
          ))}
          {filtered.length===0 && <p className="px-3 py-2 text-xs text-slate-500">No matches</p>}
        </div>
      )}
    </div>
  );
}

/** Schedule Change Log — DIRECT operational roster shift edit / swap over
 *  roster_days, with before/after shift-rate impact, full history and one-click
 *  revert. (Distinct from the request-approval flow on /schedule-changes.) */
export default function ScheduleChangeLogPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [mode, setMode] = useState<'edit'|'swap'>('edit');
  const [people, setPeople] = useState<any[]>([]);
  const [form, setForm] = useState({ personNo:'', personB:'', date:'2026-06-01', newShift:'C', reason:'' });
  const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [log, setLog] = useState<any[]>([]);

  const loadLog = useCallback(() => {
    apiClient.get('/attendance-recon/roster-v2/schedule-changes?limit=50').then((r:any)=>setLog(r.data.rows||[])).catch(()=>setLog([]));
  }, []);
  useEffect(() => {
    apiClient.get('/attendance-recon/roster-v2/employee-master').then((r:any)=>setPeople(r.data.rows||[])).catch(()=>setPeople([]));
    loadLog();
  }, [loadLog]);

  const set = (k:string,v:string)=>setForm(p=>({ ...p, [k]:v }));
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';

  const apply = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      if (mode === 'edit') {
        if (!form.personNo || !form.date || !form.newShift) { setErr(ar?'اختر الموظف والتاريخ والشفت':'Pick person, date and shift'); setBusy(false); return; }
        const r:any = await apiClient.post('/attendance-recon/roster-v2/schedule-change', { personNo:form.personNo, date:form.date, newShift:form.newShift, reason:form.reason });
        setResult({ mode:'edit', ...r.data });
      } else {
        if (!form.personNo || !form.personB || !form.date) { setErr(ar?'اختر الموظفَين والتاريخ':'Pick both people and the date'); setBusy(false); return; }
        const r:any = await apiClient.post('/attendance-recon/roster-v2/schedule-swap', { personA:form.personNo, personB:form.personB, date:form.date, reason:form.reason });
        setResult({ mode:'swap', ...r.data });
      }
      loadLog();
    } catch (e:any) { setErr(e?.response?.data?.message || (ar?'فشل التطبيق':'Failed')); }
    setBusy(false);
  };
  const revert = async (id:number) => { try { await apiClient.post(`/attendance-recon/roster-v2/schedule-change/${id}/revert`, {}); loadLog(); } catch { /* */ } };

  const RateBars = ({ before, after, title }: { before:any; after:any; title:string }) => {
    const cats = ['Morning','Night','Evening','Midnight']; const max = Math.max(...cats.flatMap(c=>[before?.[c]||0, after?.[c]||0]),1);
    return (
      <div className="rounded-xl p-3" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-[11px] font-bold text-white mb-2">{title}</p>
        {cats.map(c=>{ const b=before?.[c]||0, a=after?.[c]||0, d=a-b;
          return (
            <div key={c} className="flex items-center gap-2 text-[10px] mb-1">
              <span className="w-16 text-slate-400">{c}</span>
              <div className="flex-1 flex items-center gap-1">
                <div className="flex-1 h-2.5 rounded" style={{ background:'rgba(255,255,255,0.05)' }}><div className="h-full rounded" style={{ width:`${100*b/max}%`, background:CAT_COLORS[c]+'77' }}/></div>
                <ArrowRight size={9} className="text-slate-600"/>
                <div className="flex-1 h-2.5 rounded" style={{ background:'rgba(255,255,255,0.05)' }}><div className="h-full rounded" style={{ width:`${100*a/max}%`, background:CAT_COLORS[c] }}/></div>
              </div>
              <span className="w-14 text-end font-semibold" style={{ color: d===0?'#64748b':d>0?'#4ade80':'#f87171' }}>{b}→{a}{d!==0?` (${d>0?'+':''}${d})`:''}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3">
        <button onClick={()=>nav('/roster')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}><GitCompareArrows size={20} className="text-white"/></div>
        <div><h1 className="text-lg font-bold text-white">{ar?'سجل تغييرات الجدول':'Schedule Change Log'}</h1>
          <p className="text-xs text-slate-500">{ar?'تعديل/تبديل شفت مباشر مع أثر قبل/بعد على توزيع الشفتات + تاريخ كامل + تراجع':'Direct shift edit/swap with before/after shift-rate impact + full history + revert'}</p></div>
      </div>

      {/* form */}
      <div className="rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2 mb-3">
          {([['edit',Pencil,ar?'تعديل شفت':'Edit shift'],['swap',Repeat,ar?'تبديل بين اثنين':'Swap two']] as [any,any,string][]).map(([m,Ic,label])=>(
            <button key={m} onClick={()=>{ setMode(m); setResult(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background:mode===m?'rgba(99,102,241,0.25)':'rgba(255,255,255,0.04)', color:mode===m?'#a5b4fc':'#94a3b8', border:`1px solid ${mode===m?'rgba(99,102,241,0.4)':'rgba(255,255,255,0.08)'}` }}>
              <Ic size={13}/>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="text-[10px] text-slate-500 block mb-1">{ar?'الموظف':'Person'}{mode==='swap'?' A':''}</label>
            <PersonPicker value={form.personNo} onChange={v=>set('personNo',v)} people={people} placeholder={ar?'ابحث عن موظف…':'Search agent…'}/></div>
          {mode==='swap' && <div><label className="text-[10px] text-slate-500 block mb-1">{ar?'الموظف B':'Person B'}</label>
            <PersonPicker value={form.personB} onChange={v=>set('personB',v)} people={people} placeholder={ar?'ابحث عن موظف…':'Search agent…'}/></div>}
          <div><label className="text-[10px] text-slate-500 block mb-1"><CalendarDays size={11} className="inline"/> {ar?'التاريخ':'Date'}</label>
            <input type="date" value={form.date} onChange={e=>set('date',e.target.value)} className={inputCls}/></div>
          {mode==='edit' && <div><label className="text-[10px] text-slate-500 block mb-1">{ar?'الشفت الجديد':'New shift'}</label>
            <select value={form.newShift} onChange={e=>set('newShift',e.target.value)} className={inputCls}>{SHIFTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>}
          <div className="flex-1 min-w-[120px]"><label className="text-[10px] text-slate-500 block mb-1">{ar?'السبب':'Reason'}</label>
            <input value={form.reason} onChange={e=>set('reason',e.target.value)} placeholder={ar?'اختياري':'optional'} className={`${inputCls} w-full`}/></div>
          <button onClick={apply} disabled={busy} className="px-4 py-2 rounded-lg text-xs font-bold text-white" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', opacity:busy?0.6:1 }}>
            {busy?'…':(mode==='edit'?(ar?'طبّق التغيير':'Apply change'):(ar?'بدّل':'Swap'))}</button>
        </div>
        {err && <p className="text-[11px] text-rose-400 mt-2">{err}</p>}
      </div>

      {/* impact preview */}
      {result && (
        <div className="rounded-2xl p-4" style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.2)' }}>
          <p className="text-xs font-bold text-emerald-300 mb-3">{ar?'الأثر — قبل / بعد':'Impact — before / after'} {result.mode==='edit'?`(${result.oldShift} → ${result.newShift})`:''}</p>
          {result.mode==='edit'
            ? <RateBars before={result.impact?.shiftRate?.before} after={result.impact?.shiftRate?.after} title={ar?'توزيع شفتات الموظف YTD':'Person shift-rate (YTD)'}/>
            : <div className="grid md:grid-cols-2 gap-3">
                <RateBars before={result.impact?.A?.before} after={result.impact?.A?.after} title={`A · ${Object.keys(result.swapped||{})[0]||''}`}/>
                <RateBars before={result.impact?.B?.before} after={result.impact?.B?.after} title={`B · ${Object.keys(result.swapped||{})[1]||''}`}/>
              </div>}
        </div>
      )}

      {/* history */}
      <div className="rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2 mb-3"><History size={15} className="text-indigo-400"/><h3 className="text-sm font-bold text-white">{ar?'سجل التغييرات':'Change history'}</h3><span className="text-[10px] text-slate-500">{log.length}</span></div>
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead><tr className="text-slate-500">
            {[ar?'التاريخ':'Date',ar?'النوع':'Type',ar?'الموظف':'Person',ar?'من→إلى':'From→To',ar?'السبب':'Reason',ar?'الحالة':'Status',''].map((h,i)=><th key={i} className="text-start font-semibold pb-1.5">{h}</th>)}
          </tr></thead>
          <tbody>{log.map((r:any)=>(
            <tr key={r.id} className="border-t border-white/5" style={{ opacity:r.reverted?0.5:1 }}>
              <td className="py-1.5 text-slate-300">{r.date}</td>
              <td className="py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background:r.change_type==='swap'?'rgba(139,92,246,0.18)':'rgba(99,102,241,0.18)', color:r.change_type==='swap'?'#c4b5fd':'#a5b4fc' }}>{r.change_type}</span></td>
              <td className="py-1.5 text-slate-200">{r.person_name}{r.person_b_name?` ⇄ ${r.person_b_name}`:''}</td>
              <td className="py-1.5 text-slate-300 font-mono">{r.old_shift}→{r.new_shift}{r.change_type==='swap'?` / ${r.old_shift_b}→${r.new_shift_b}`:''}</td>
              <td className="py-1.5 text-slate-500">{r.reason||'—'}</td>
              <td className="py-1.5"><span style={{ color:r.reverted?'#f87171':'#4ade80' }}>{r.reverted?(ar?'متراجَع':'reverted'):(ar?'مطبّق':'applied')}</span></td>
              <td className="py-1.5 text-end">{!r.reverted && <button onClick={()=>revert(r.id)} className="text-[10px] text-amber-300 px-2 py-0.5 rounded flex items-center gap-1" style={{ background:'rgba(245,158,11,0.12)' }}><Undo2 size={11}/>{ar?'تراجع':'Revert'}</button>}</td>
            </tr>
          ))}{log.length===0 && <tr><td colSpan={7} className="py-3 text-center text-slate-600">{ar?'لا تغييرات بعد':'No changes yet'}</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  );
}
