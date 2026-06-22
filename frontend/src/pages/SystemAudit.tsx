import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, Layers, Code2, Workflow, Database, AlertTriangle, History, CheckCircle2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const stC = (s:string)=> s==='Pass'?'#4ade80':s==='Warning'?'#fbbf24':s==='Fail'?'#f87171':'#94a3b8';

/** System Audit — page/code/assistant governance tables + live health signals. */
export default function SystemAuditPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { apiClient.get('/attendance-recon/roster-v2/system-audit').then((r:any)=>setD(r.data)).catch(()=>setD(null)).finally(()=>setLoading(false)); }, []);
  const panel = { background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' } as const;

  const Badge = ({s}:{s:string}) => <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background:`${stC(s)}22`, color:stC(s) }}>{s}</span>;

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3">
        <button onClick={()=>nav('/wfm-overview')} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} className="text-white"/></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#334155,#6366f1)' }}><ClipboardCheck size={20} className="text-white"/></div>
        <div><h1 className="text-lg font-bold text-white">{ar?'تدقيق النظام':'System Audit'}</h1>
          <p className="text-xs text-slate-500">{ar?'تدقيق الصفحات/الكود/المساعدين + إشارات حيّة (مايجريشن، صحة البيانات، سجل التغييرات)':'Page/code/assistant audit + live signals (migrations, data health, change trail)'}</p></div>
      </div>

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !d && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {!loading && d && (<>
        {/* live health */}
        {d.health && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { ic:Database, l:ar?'صفوف الروستر':'Roster rows', v:(d.health.rows||0).toLocaleString(), c:'#06b6d4' },
              { ic:CheckCircle2, l:ar?'أشخاص':'People', v:d.health.people, c:'#22c55e' },
              { ic:History, l:ar?'الفترة':'Span', v:`${d.health.mn} → ${d.health.mx}`, c:'#8b5cf6' },
              { ic:AlertTriangle, l:ar?'صفوف بملاحظة جودة':'Flagged rows', v:(d.health.flagged||0).toLocaleString(), c:'#f59e0b' },
            ].map((x,i)=>(
              <div key={i} className="flex items-center gap-2.5 p-3 rounded-xl" style={panel}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={16}/></div>
                <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold truncate">{x.l}</p><p className="text-sm font-bold text-white truncate">{x.v}</p></div>
              </div>
            ))}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-3">
          {/* page/module audit */}
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-3"><Layers size={15} className="text-indigo-400"/><h3 className="text-sm font-bold text-white">{ar?'تدقيق الصفحات/الموديولات':'Page / Module Audit'}</h3></div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">{(d.pages||[]).map((r:any,i:number)=>(
              <div key={i} className="flex items-start justify-between gap-2 text-[11px] py-1 border-b border-white/5">
                <div className="min-w-0"><p className="text-slate-200 font-medium">{r.name}</p><p className="text-[10px] text-slate-500 truncate">{r.purpose}</p></div>
                <Badge s={r.status}/>
              </div>
            ))}</div>
          </div>
          {/* code audit */}
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-3"><Code2 size={15} className="text-emerald-400"/><h3 className="text-sm font-bold text-white">{ar?'تدقيق الكود':'Code Audit'}</h3></div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">{(d.code||[]).map((r:any,i:number)=>(
              <div key={i} className="flex items-start justify-between gap-2 text-[11px] py-1 border-b border-white/5">
                <div className="min-w-0"><p className="text-slate-200 font-mono">{r.component}</p><p className="text-[10px] text-slate-500 truncate">{r.code_type} · {r.notes}</p></div>
                <Badge s={r.status}/>
              </div>
            ))}</div>
          </div>
        </div>

        {/* assistant workflow */}
        <div className="rounded-2xl p-4" style={panel}>
          <div className="flex items-center gap-2 mb-3"><Workflow size={15} className="text-cyan-400"/><h3 className="text-sm font-bold text-white">{ar?'تدقيق سير عمل المساعدين (خط البيانات)':'Assistant Workflow Audit (data pipeline)'}</h3></div>
          <div className="flex flex-wrap items-stretch gap-2">
            {(d.assistants||[]).map((r:any,i:number)=>(
              <div key={i} className="flex-1 min-w-[150px] p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-slate-500">#{r.step_no}</span><Badge s={r.status}/></div>
                <p className="text-xs font-bold text-white">{r.assistant}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{r.responsibility}</p>
                <p className="text-[9px] text-slate-600 mt-1">{r.input} → {r.output}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {/* migrations */}
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-3"><Database size={15} className="text-violet-400"/><h3 className="text-sm font-bold text-white">{ar?'آخر المايجريشن المطبّقة':'Latest applied migrations'}</h3></div>
            <div className="flex flex-wrap gap-1.5">{(d.migrations||[]).map((m:string,i:number)=>(
              <span key={i} className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-300" style={{ background:'rgba(255,255,255,0.05)' }}>{m.replace('.sql','')}</span>
            ))}</div>
          </div>
          {/* data-quality flags */}
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle size={15} className="text-amber-400"/><h3 className="text-sm font-bold text-white">{ar?'ملاحظات جودة البيانات':'Data-quality flags'}</h3></div>
            <div className="space-y-1 max-h-44 overflow-y-auto">{(d.dataQuality||[]).map((r:any,i:number)=>(
              <div key={i} className="flex items-center justify-between text-[11px] py-0.5"><span className="text-slate-300">{r.issue}</span><span className="text-amber-300 font-semibold">{r.n}</span></div>
            ))}{(!d.dataQuality||!d.dataQuality.length)&&<p className="text-[11px] text-emerald-400">{ar?'لا ملاحظات':'No flags'} ✓</p>}</div>
          </div>
        </div>

        {/* recent schedule changes audit trail */}
        {d.recentChanges?.length>0 && (
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-3"><History size={15} className="text-indigo-400"/><h3 className="text-sm font-bold text-white">{ar?'آخر تغييرات الجدول':'Recent schedule changes'}</h3></div>
            <div className="space-y-1">{d.recentChanges.map((r:any,i:number)=>(
              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5 border-b border-white/5" style={{ opacity:r.reverted?0.5:1 }}>
                <span className="text-slate-500">{r.date}</span><span className="px-1.5 rounded text-[9px]" style={{ background:'rgba(99,102,241,0.18)', color:'#a5b4fc' }}>{r.change_type}</span>
                <span className="text-slate-200">{r.person_name}</span><span className="text-slate-400 font-mono">{r.old_shift}→{r.new_shift}</span>
                {r.reverted && <span className="text-rose-400 text-[10px]">{ar?'متراجَع':'reverted'}</span>}
              </div>
            ))}</div>
          </div>
        )}
      </>)}
    </div>
  );
}
