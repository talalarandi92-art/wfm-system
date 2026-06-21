import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import {
  Users, Search, Download, Home, Building2, UserX, CalendarOff, ArrowRight,
  ChevronRight, ChevronDown, ChevronLeft, CalendarDays, Clock, ShieldCheck, Plane, AlertTriangle, LogOut,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

interface Row {
  employee_no: string; name: string; function_name: string; date: string; day_name: string;
  status: string; presence: 'office'|'wfh'|'absent'|'leave'|'off'|'holiday'|'present';
  punch_in_min: number|null; punch_out_min: number|null; sys_login_min: number|null; sys_logout_min: number|null;
  login_src: string|null; late_min: number; early_min: number; ot_min: number;
  permission: string|null; comp_off: string|null; sick: string|null; conforming: boolean|null;
  shift_code: string|null; shift_start_min: number|null; shift_end_min: number|null;
  sys_late_min: number; sys_early_min: number; adherence_pct: number|null; mismatch: string|null;
}
interface Resp { from: string; to: string; total: number; limit: number; offset: number; summary: any; rows: Row[]; }

const hhmm = (m: number | null | undefined) => { if (m == null) return '—'; const t=((m%1440)+1440)%1440; let h=Math.floor(t/60); const mm=t%60; const ap=h<12?'AM':'PM'; h=h%12||12; return `${h}:${String(mm).padStart(2,'0')} ${ap}`; };
const dur = (m: number) => { if (!m || m<=0) return '—'; const h=Math.floor(m/60), mm=m%60; return h?`${h}h ${mm}m`:`${mm}m`; };
const adhColor = (v: number | null) => v == null ? '#64748b' : v>=95?'#22c55e':v>=85?'#06b6d4':v>=70?'#f59e0b':'#f43f5e';
const PRES: Record<string,{ar:string;en:string;c:string}> = {
  office:{ar:'مكتب',en:'Office',c:'#22c55e'}, wfh:{ar:'WFH',en:'WFH',c:'#06b6d4'}, off:{ar:'أوف',en:'Off',c:'#64748b'},
  leave:{ar:'إجازة',en:'Leave',c:'#8b5cf6'}, absent:{ar:'غياب',en:'Absent',c:'#f43f5e'}, holiday:{ar:'عطلة',en:'Holiday',c:'#a855f7'}, present:{ar:'حاضر',en:'Present',c:'#22c55e'},
};
const PER = 40;

/* "in → out" pair cell */
function Pair({ a, b, color = '#cbd5e1' }: { a: number|null; b: number|null; color?: string }) {
  if (a == null && b == null) return <span className="text-slate-600">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ color }}>
      <span className="font-medium">{hhmm(a)}</span>
      <ArrowRight size={11} className="text-slate-500" />
      <span className="font-medium">{hhmm(b)}</span>
    </span>
  );
}

export default function RosterPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [presence, setPresence] = useState('');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-06-20');
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setOpenKey(null);
    const p = new URLSearchParams({ from, to, sort, limit: String(PER), offset: String(page*PER) });
    if (q) p.set('q', q); if (presence) p.set('presence', presence);
    apiClient.get(`/attendance-recon/roster-v2?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [q, presence, from, to, sort, page]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [q, presence, from, to, sort]);

  const exportCSV = () => {
    if (!data) return;
    const h = ['Date','Day','Emp No','Name','Function','Presence','Shift','Shift Start','Shift End','Punch In','Punch Out','Sys Login','Sys Logout','Src','Sys Late(min)','Early Out(min)','OT(min)','Adherence%','Mismatch','Permission','Comp Off','Sick'];
    const rows = data.rows.map(r => [r.date, r.day_name, r.employee_no, r.name, r.function_name, r.presence, r.shift_code, hhmm(r.shift_start_min), hhmm(r.shift_end_min), hhmm(r.punch_in_min), hhmm(r.punch_out_min), hhmm(r.sys_login_min), hhmm(r.sys_logout_min), r.login_src, r.sys_late_min, r.sys_early_min, r.ot_min, r.adherence_pct, r.mismatch, r.permission, r.comp_off, r.sick]);
    const csv = '﻿' + [h, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download = `roster_${from}_${to}.csv`; a.click();
  };

  const s = data?.summary;
  const pageCount = Math.ceil((data?.total || 0) / PER);
  const cards = useMemo(() => s ? [
    { ic: CalendarDays, l: ar?'أيام':'Days', v: s.days, c:'#6366f1' },
    { ic: ShieldCheck, l: ar?'كونفورمانس':'Conformance', v: s.conformance_pct!=null?s.conformance_pct+'%':'—', c: adhColor(s.conformance_pct) },
    { ic: Clock, l: ar?'تأخير سيستم':'Sys late', v: s.late_days, c:'#f59e0b' },
    { ic: LogOut, l: ar?'خروج مبكر':'Early out', v: s.early_days, c:'#f59e0b' },
    { ic: AlertTriangle, l: ar?'عدم تطابق':'Mismatch', v: s.mismatches, c:'#f43f5e' },
    { ic: Building2, l: ar?'مكتب':'Office', v: s.office, c:'#22c55e' },
    { ic: Home, l: 'WFH', v: s.wfh, c:'#06b6d4' },
    { ic: UserX, l: ar?'غياب':'Absent', v: s.absent, c:'#f43f5e' },
  ] : [], [s, ar]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 outline-none focus:border-indigo-400';
  const presColor = (p: string) => PRES[p]?.c || '#64748b';

  return (
    <div className="space-y-4 page-enter">
      {/* header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}><Users size={22} className="text-white" /></div>
        <div>
          <h1 className="text-lg font-bold text-white">{ar?'الروستر — الدمج والتسوية':'Roster — Shifts & Reconciliation'}</h1>
          <p className="text-xs text-slate-500">{ar?'بصمة أودو + Ameyo + Sprinklr مدموجة، مقابل الشفت المجدوَل':'Odoo punch + Ameyo + Sprinklr combined, vs the scheduled shift'}</p>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-1.5 text-slate-400"><CalendarDays size={14} />
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls} />
          <span className="text-xs">→</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <Search size={14} className="text-slate-400" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder={ar?'بحث بالاسم أو الرقم…':'Name or employee no…'} className={`${inputCls} flex-1`} />
        </div>
        <select value={presence} onChange={e=>setPresence(e.target.value)} className={inputCls}>
          <option value="">{ar?'كل الحالات':'All presence'}</option>
          {Object.entries(PRES).filter(([k])=>['office','wfh','off','leave','absent'].includes(k)).map(([k,v])=><option key={k} value={k}>{ar?v.ar:v.en}</option>)}
        </select>
        <select value={sort} onChange={e=>setSort(e.target.value)} className={inputCls}>
          <option value="date_desc">{ar?'الأحدث':'Newest'}</option>
          <option value="date_asc">{ar?'الأقدم':'Oldest'}</option>
          <option value="name">{ar?'الاسم':'Name'}</option>
          <option value="adherence">{ar?'الأقل كونفورمانس':'Lowest conformance'}</option>
          <option value="late">{ar?'الأكثر تأخير':'Most late'}</option>
          <option value="early">{ar?'الأكثر خروج مبكر':'Most early out'}</option>
          <option value="mismatch">{ar?'عدم التطابق أولاً':'Mismatches first'}</option>
          <option value="ot">{ar?'الأكثر OT':'Most OT'}</option>
        </select>
        <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background:'rgba(34,197,94,0.18)', color:'#22c55e' }}><Download size={13} />CSV</button>
      </div>

      {/* summary band */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {cards.map((x,i)=>(
            <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${x.c}22`, color:x.c }}><x.ic size={15} /></div>
              <div className="min-w-0"><p className="text-[9px] text-slate-500 uppercase font-semibold tracking-wide truncate">{x.l}</p><p className="text-base font-bold text-white leading-tight">{typeof x.v==='number'?x.v.toLocaleString():x.v}</p></div>
            </div>
          ))}
        </div>
      )}

      {loading && <p className="text-sm text-slate-500 py-8 text-center">{ar?'جارٍ التحميل…':'Loading…'}</p>}
      {!loading && !data && <p className="text-sm text-rose-400 py-8 text-center">{ar?'تعذّر التحميل':'Failed to load'}</p>}

      {/* compact table */}
      {!loading && data && (<>
        <div className="rounded-2xl overflow-hidden" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <table className="w-full text-xs" style={{ tableLayout:'fixed' }}>
            <colgroup><col style={{width:'11%'}}/><col style={{width:'24%'}}/><col style={{width:'11%'}}/><col style={{width:'12%'}}/><col style={{width:'18%'}}/><col style={{width:'18%'}}/><col style={{width:'6%'}}/></colgroup>
            <thead style={{ background:'#11162a' }}>
              <tr className="text-slate-400">
                <th className="text-start px-4 py-2.5 font-semibold">{ar?'التاريخ':'Date'}</th>
                <th className="text-start px-2 py-2.5 font-semibold">{ar?'الموظف':'Agent'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'الحالة':'Status'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'الشفت':'Shift'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'بصمة (د→خ)':'Punch'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'سيستم (د→خ)':'System'}</th>
                <th className="px-2 py-2.5 font-semibold text-center">{ar?'كونف':'Conf'}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => { const key = `${r.employee_no}|${r.date}`; const pc = presColor(r.presence);
                return (
                <Fragment key={key}>
                  <tr onClick={()=>setOpenKey(openKey===key?null:key)} className="cursor-pointer hover:bg-white/[0.04] border-t border-white/5 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {openKey===key ? <ChevronDown size={13} className="text-indigo-400 flex-shrink-0"/> : <ChevronRight size={13} className="text-slate-600 flex-shrink-0"/>}
                        <div><p className="text-slate-200 font-semibold leading-tight">{r.date.slice(5)}</p><p className="text-[9px] text-slate-500">{r.day_name?.slice(0,3)}</p></div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 min-w-0"><p className="text-white font-semibold truncate leading-tight">{r.name}</p><p className="text-[10px] text-slate-500 truncate">{r.employee_no} · {r.function_name||'—'}</p></td>
                    <td className="px-2 py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ background:`${pc}1f`, color:pc }}>{ar?PRES[r.presence]?.ar:PRES[r.presence]?.en||r.presence}</span>
                      {r.mismatch && <span className="ms-1" title={r.mismatch}><AlertTriangle size={11} className="inline text-rose-400" /></span>}
                    </td>
                    <td className="px-2 py-2.5 text-center text-slate-400 whitespace-nowrap">{r.shift_code?<span><span className="text-slate-200 font-semibold">{r.shift_code}</span> <span className="text-[10px]">{r.shift_start_min!=null?`${hhmm(r.shift_start_min)}-${hhmm(r.shift_end_min)}`:''}</span></span>:'—'}</td>
                    <td className="px-2 py-2.5 text-center"><Pair a={r.punch_in_min} b={r.punch_out_min} /></td>
                    <td className="px-2 py-2.5 text-center"><Pair a={r.sys_login_min} b={r.sys_logout_min} color={r.sys_late_min>0||r.sys_early_min>0?'#f59e0b':'#cbd5e1'} /></td>
                    <td className="px-2 py-2.5 text-center">{r.adherence_pct!=null?<span className="px-1.5 py-0.5 rounded font-bold text-[11px]" style={{ background:`${adhColor(r.adherence_pct)}1f`, color:adhColor(r.adherence_pct) }}>{r.adherence_pct}%</span>:<span className="text-slate-600">—</span>}</td>
                  </tr>
                  {openKey===key && (
                    <tr><td colSpan={7} className="px-4 pb-3.5" style={{ background:'rgba(99,102,241,0.05)' }}>
                      <div className="pt-3 space-y-2.5">
                        {/* time row: shift / punch / system as in→out pairs */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {([
                            [ar?'الشفت المجدوَل':'Scheduled shift', r.shift_code, r.shift_start_min, r.shift_end_min, '#8b5cf6'],
                            [ar?'البصمة':'Punch', null, r.punch_in_min, r.punch_out_min, '#22c55e'],
                            [ar?'السيستم':'System', r.login_src, r.sys_login_min, r.sys_logout_min, '#06b6d4'],
                          ] as [string,any,number|null,number|null,string][]).map(([l,tag,a,b,c],i)=>(
                            <div key={i} className="px-3 py-2 rounded-xl" style={{ background:'rgba(255,255,255,0.04)' }}>
                              <p className="text-[10px] text-slate-500 uppercase font-semibold mb-0.5">{l}{tag?` · ${tag}`:''}</p>
                              <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color:c }}><span>{hhmm(a)}</span><ArrowRight size={13} className="text-slate-500" /><span>{hhmm(b)}</span></div>
                            </div>
                          ))}
                        </div>
                        {/* metrics row */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                          {([
                            [ar?'كونفورمانس':'Conformance', r.adherence_pct!=null?r.adherence_pct+'%':'—', adhColor(r.adherence_pct)],
                            [ar?'تأخير سيستم':'Sys late', dur(r.sys_late_min), r.sys_late_min>0?'#f59e0b':'#64748b'],
                            [ar?'خروج مبكر':'Early out', dur(r.sys_early_min), r.sys_early_min>0?'#f59e0b':'#64748b'],
                            ['OT', dur(r.ot_min), r.ot_min>0?'#10b981':'#64748b'],
                            [ar?'تأخير بصمة':'Punch late', dur(r.late_min), r.late_min>0?'#f59e0b':'#64748b'],
                          ] as [string,any,string][]).map(([l,v,c],i)=>(
                            <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg" style={{ background:'rgba(255,255,255,0.04)' }}>
                              <span className="text-[10px] text-slate-400">{l}</span><span className="text-[11px] font-bold" style={{ color:c }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        {/* mismatch banner */}
                        {r.mismatch && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(244,63,94,0.12)', color:'#f87171' }}>
                            <AlertTriangle size={13} />
                            {r.mismatch==='no-system' ? (ar?'بصمة بدون تسجيل سيستم':'Punched but no system login')
                              : r.mismatch==='no-punch' ? (ar?'سيستم بدون بصمة':'System login but no punch')
                              : (ar?'فرق كبير بين البصمة والسيستم (>30 د)':'Punch vs system differ by >30 min')}
                          </div>
                        )}
                        {/* full-width permission / comp / sick (no truncation) */}
                        {(r.permission || r.comp_off || r.sick || r.status) && (
                          <div className="space-y-1.5">
                            {r.status && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(255,255,255,0.04)' }}><span className="text-slate-500">{ar?'الحالة الأصلية: ':'Raw status: '}</span><span className="text-slate-200 font-semibold">{r.status}</span></div>}
                            {r.permission && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(99,102,241,0.12)' }}><span className="text-indigo-300 font-semibold">{ar?'استئذان: ':'Permission: '}</span><span className="text-slate-200">{r.permission}</span></div>}
                            {r.comp_off && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(16,185,129,0.12)' }}><span className="text-emerald-300 font-semibold">{ar?'كومب أوف: ':'Comp off: '}</span><span className="text-slate-200">{r.comp_off}</span></div>}
                            {r.sick && <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background:'rgba(245,158,11,0.12)' }}><span className="text-amber-300 font-semibold">{ar?'سيك: ':'Sick: '}</span><span className="text-slate-200">{r.sick}</span></div>}
                          </div>
                        )}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );})}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] text-slate-500">{ar?`عرض ${page*PER+1}–${Math.min((page+1)*PER, data.total)} من ${data.total}`:`${page*PER+1}–${Math.min((page+1)*PER, data.total)} of ${data.total}`}</p>
            <div className="flex items-center gap-1">
              <button disabled={page===0} onClick={()=>setPage(p=>p-1)} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background:'rgba(255,255,255,0.05)' }}><ChevronLeft size={14} className="text-white"/></button>
              <span className="text-xs text-slate-300 px-2 font-semibold">{page+1} / {pageCount}</span>
              <button disabled={page>=pageCount-1} onClick={()=>setPage(p=>p+1)} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background:'rgba(255,255,255,0.05)' }}><ChevronRight size={14} className="text-white"/></button>
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}
