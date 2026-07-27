import { useEffect, useState, useCallback } from 'react';
import { Wand2, CalendarDays, Users, Layers, CheckCircle2, AlertTriangle, Clock, Save, Download, Rocket, Undo2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile } from '@/components/dazzle';
import { shiftColor } from '@/utils/shift-colors';

/** Demand-driven shift-mix generator: measures the hourly need per function (from the approved
 *  roster_days) and greedy set-covers the function's real shift windows to cover every hour,
 *  then checks active-staff sufficiency. The "build a schedule that covers all hours" core. */
export default function ScheduleDemandPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [f, setF] = useState({ from: '', to: '', function: '' });
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState<any>(null); const [wkLoading, setWkLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setWeek(null);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/generate?${qs}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const [saved, setSaved] = useState<any>(null); const [saving, setSaving] = useState(false);
  const genWeek = () => {
    setWkLoading(true); setSaved(null);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); }); if (d?.function && !f.function) qs.set('function', d.function);
    apiClient.get(`/attendance-recon/roster-v2/generate-week?${qs}`).then((r: any) => setWeek(r.data)).catch(() => setWeek(null)).finally(() => setWkLoading(false));
  };
  const saveDraft = () => {
    setSaving(true);
    apiClient.post(`/attendance-recon/roster-v2/generate-week/save`, { function: f.function || d?.function, from: f.from || undefined, to: f.to || undefined })
      .then((r: any) => setSaved(r.data)).catch(() => setSaved(null)).finally(() => setSaving(false));
  };
  // PUBLISH into the live grid — non-overwriting, into the first empty future week (backend picks it).
  const [pub, setPub] = useState<any>(null); const [publishing, setPublishing] = useState(false); const [confirmPub, setConfirmPub] = useState(false);
  const publish = () => {
    setPublishing(true);
    apiClient.post(`/attendance-recon/roster-v2/publish`, { function: f.function || d?.function, from: f.from || undefined, to: f.to || undefined })
      .then((r: any) => { setPub(r.data); setConfirmPub(false); }).catch(() => setPub({ error: true })).finally(() => setPublishing(false));
  };
  const unpublish = () => {
    if (!pub?.weekStart) return;
    setPublishing(true);
    apiClient.post(`/attendance-recon/roster-v2/unpublish`, { weekStart: pub.weekStart })
      .then((r: any) => setPub((p: any) => ({ ...p, undone: true, deleted: r.data.deleted }))).catch(() => {}).finally(() => setPublishing(false));
  };
  const exportGrid = () => {
    if (!saved) return;
    const head = [ar ? 'الموظف' : 'Employee', ...saved.days].join(',');
    const lines = saved.grid.map((g: any) => [g.name, ...g.days].join(','));
    const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `roster_${saved.function}_${saved.weekStart}.csv`; a.click(); URL.revokeObjectURL(u);
  };
  const catColor = (c: string) => c === 'midnight' ? '#ef4444' : c === 'night' ? '#a78bfa' : c === 'day' ? '#0ea5e9' : 'var(--text-3)';
  /* `N` was #a78bfa here and #8b5cf6 in the rotation grid — the same shift code in
     two violets. shiftColor() is the one source. Midnight stays red on THIS screen
     deliberately: here it marks a demand risk, not the shift's identity colour. */
  const cellColor = (code: string) => code === 'OFF' ? 'var(--text-3)' : /^(MD|MN)/.test(code) ? '#ef4444' : shiftColor(code, '#0ea5e9');

  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;
  const maxDem = d ? Math.max(...d.demand, ...d.coverageByHour.map((c: any) => c.covered), 1) : 1;

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#0ea5e9)', boxShadow: '0 6px 18px rgba(99,102,241,0.35)' }}><Wand2 size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'مولّد الجدول حسب الاحتياج' : 'Demand-driven Schedule'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'نقيس الاحتياج لكل ساعة من الروستر المعتمد ونبني مزيج شفتات يغطّي كل الأوقات + نفحص كفاية الموظفين' : 'measure the hourly need from the approved roster, build a shift mix that covers every hour + check staff sufficiency'}</p>
        </div>
        <div className="flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}><CalendarDays size={14} />
          <input type="date" value={f.from} onChange={e => set('from', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle} /><span className="text-xs">→</span>
          <input type="date" value={f.to} onChange={e => set('to', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle} /></div>
        <select value={f.function} onChange={e => set('function', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle}>
          <option value="">{ar ? 'الأكثر ازدحاماً' : 'Busiest function'}</option>{(d?.functions || []).map((x: string) => <option key={x} value={x}>{x}</option>)}</select>
      </div>

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ التوليد…' : 'Generating…'}</p>}
      {!loading && d && (<>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <StatTile icon={Layers} label={ar ? 'الفنكشن' : 'Function'} value={d.function || '—'} sub={`${d.days} ${ar ? 'يوم' : 'days'}`} color="#6366f1" delay={0} />
          <StatTile icon={Clock} label={ar ? 'شفتات/يوم' : 'Shifts/day'} num={d.staffing.shiftsPerDay} sub={ar ? 'لتغطية الاحتياج' : 'to cover demand'} color="#0ea5e9" delay={60} />
          <StatTile icon={Users} label={ar ? 'الموظفون الفعّالون' : 'Active staff'} num={d.staffing.activeStaff} sub={`${ar ? 'يلزم مع OFF' : 'need w/ OFF'} ${d.staffing.needWithOff}`} color={d.staffing.enough ? '#22c55e' : '#ef4444'} delay={120} />
          <StatTile icon={d.verdict.coversAllHours ? CheckCircle2 : AlertTriangle} label={ar ? 'تغطية كل الساعات' : 'Covers all hours'} value={d.verdict.coversAllHours ? (ar ? 'نعم ✓' : 'Yes ✓') : (ar ? 'لا' : 'No')} sub={d.verdict.coversAllHours ? (ar ? 'بدون فجوات' : 'no gaps') : `${d.verdict.shortHours.length} ${ar ? 'ساعة ناقصة' : 'short hrs'}`} color={d.verdict.coversAllHours ? '#22c55e' : '#ef4444'} delay={180} />
          <StatTile icon={Users} label={ar ? 'كفاية الطاقم' : 'Staff sufficiency'} value={d.staffing.enough ? (ar ? 'كافٍ ✓' : 'Enough ✓') : (ar ? 'نقص' : 'Short')} sub={d.staffing.enough ? '' : `${d.staffing.needWithOff - d.staffing.activeStaff} ${ar ? 'ناقص' : 'short'}`} color={d.staffing.enough ? '#22c55e' : '#ef4444'} delay={240} />
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {/* demand vs covered curve */}
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'منحنى الاحتياج مقابل التغطية' : 'Demand vs coverage by hour'}</h3>
              {d.basis && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold" title={d.basis}
                  style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                  <AlertTriangle size={10} />
                  {/replicat|يحاكي/i.test(d.basis)
                    ? (ar ? 'المصدر: يحاكي الجدول الحالي' : 'Basis: replicates the current schedule')
                    : d.basis}
                </span>
              )}
            </div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'الرمادي = الاحتياج · الأزرق = ما يغطّيه المزيج المقترح' : 'grey = demand · blue = what the proposed mix covers'}</p>
            <div className="flex items-end gap-1 h-36">
              {d.coverageByHour.map((c: any) => (
                <div key={c.hour} className="flex-1 flex flex-col items-center justify-end h-full relative" title={`${hh(c.hour)} · ${ar ? 'احتياج' : 'demand'} ${c.demand} · ${ar ? 'تغطية' : 'covered'} ${c.covered}${c.gap < 0 ? ` · ${ar ? 'نقص' : 'gap'} ${c.gap}` : ''}`}>
                  <div className="w-full rounded-t" style={{ height: `${Math.round(100 * c.covered / maxDem)}%`, minHeight: c.covered ? 2 : 0, background: c.gap < 0 ? '#ef4444' : 'linear-gradient(180deg,#0ea5e9,#6366f1)' }} />
                  <div className="w-full" style={{ height: `${Math.round(100 * Math.max(0, c.demand - c.covered) / maxDem)}%`, background: 'var(--text-3)', opacity: 0.4 }} />
                  <span className="text-[8px] mt-0.5" style={{ color: 'var(--text-3)' }}>{c.hour}</span>
                </div>
              ))}
            </div>
          </div>
          {/* recommended mix */}
          <div className="rounded-2xl p-4" style={panel}>
            <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>{ar ? 'مزيج الشفتات المقترح' : 'Recommended shift mix'}</h3>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'set-cover على شفتات الفنكشن الحقيقية لتغطية المنحنى' : 'set-cover over the function\'s real shifts to cover the curve'}</p>
            <div className="space-y-1.5">
              {d.shiftMix.map((m: any, i: number) => {
                const mx = d.shiftMix[0]?.count || 1;
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-16 font-bold" style={{ color: 'var(--text-1)' }}>{m.code}</span>
                    <span className="w-24 text-[10px]" style={{ color: 'var(--text-3)' }}>{m.start}–{m.end}</span>
                    <div className="flex-1 h-3.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}><div style={{ width: `${Math.round(100 * m.count / mx)}%`, height: '100%', background: 'linear-gradient(90deg,#6366f1,#0ea5e9)' }} /></div>
                    <span className="w-10 text-end font-bold" style={{ color: '#0ea5e9' }}>×{m.count}</span>
                  </div>
                );
              })}
              <div className="mt-2 pt-2 flex justify-between text-[11px]" style={{ borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-2)' }}>{ar ? 'إجمالي الشفتات/يوم' : 'Total shifts/day'}</span>
                <span className="font-bold" style={{ color: 'var(--text-1)' }}>{d.staffing.shiftsPerDay}</span>
              </div>
            </div>
          </div>
        </div>

        {/* short hours (if any) */}
        {d.verdict.shortHours.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={15} className="text-red-400" /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'ساعات ما زالت ناقصة التغطية' : 'Hours still under-covered'}</h3></div>
            <div className="flex flex-wrap gap-2">
              {d.verdict.shortHours.map((c: any, i: number) => (
                <span key={i} className="px-2 py-1 rounded-lg text-[11px] font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{hh(c.hour)} · {ar ? 'نقص' : 'gap'} {c.gap} ({ar ? 'احتياج' : 'need'} {c.demand}, {ar ? 'مغطّى' : 'have'} {c.covered})</span>
              ))}
            </div>
          </div>
        )}

        {/* generate weekly per-employee roster */}
        <div className="rounded-2xl p-4 glow-border-soft" style={{ background: 'var(--surface)', border: '1px solid #6366f1' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex items-center gap-2"><Wand2 size={16} style={{ color: '#818cf8' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الجدول الأسبوعي لكل موظف' : 'Per-employee weekly roster'}</h3></div>
            <button onClick={genWeek} disabled={wkLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#6366f1,#0ea5e9)', boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}><Wand2 size={13} />{wkLoading ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'ولّد الجدول الأسبوعي' : 'Generate weekly roster')}</button>
          </div>
          <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'إسناد شفت الأسبوع + يوم OFF لكل موظف: البنات بدون ميدنايت، النايت للأقل تحميلاً (تدوير عادل)، التدوير الأسبوعي يضمن راحة ≥10 ساعات. اقتراح للمراجعة قبل النشر بالجدول.' : 'each employee gets a weekly shift + OFF day: females no midnight, night to the least-loaded (fair rotation), weekly rotation guarantees ≥10h rest. A proposal to review before publishing to the schedule.'}</p>
          {week && (<>
            {/* ── ROSTER HEALTH CHECK — the coverage proof BEFORE publish (never publish blind) ── */}
            {week.health && (
              <div className="rounded-2xl p-3.5 mb-3" style={{ background: week.health.acceptable ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${week.health.acceptable ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}` }}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {week.health.acceptable ? <CheckCircle2 size={16} style={{ color: '#22c55e' }} /> : <AlertTriangle size={16} style={{ color: '#ef4444' }} />}
                  <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'فحص صحة الجدول' : 'Roster Health Check'}</h4>
                  <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold" style={{ background: week.health.acceptable ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: week.health.acceptable ? '#22c55e' : '#ef4444' }}>{week.health.verdictText}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }} title={week.health.basis}>{ar ? `انكماش متوقع ${week.health.projectedShrinkagePct}%` : `projected shrinkage ${week.health.projectedShrinkagePct}%`}</span>
                </div>
                {/* totals strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3 text-center">
                  {[
                    [ar ? 'ساعات مطلوبة' : 'Required hrs', week.health.totals.requiredHrs, 'var(--text-1)'],
                    [ar ? 'مجدولة' : 'Scheduled', week.health.totals.scheduledHrs, '#0ea5e9'],
                    [ar ? 'فعلية متوقعة' : 'Effective', week.health.totals.effectiveHrs, '#818cf8'],
                    [ar ? 'نقص' : 'Shortage', week.health.totals.shortageHrs, week.health.totals.shortageHrs > 0 ? '#ef4444' : '#22c55e'],
                    [ar ? 'فائض' : 'Surplus', week.health.totals.surplusHrs, '#f59e0b'],
                    [ar ? 'التغطية' : 'Coverage', week.health.totals.coveragePct + '%', week.health.totals.coveragePct >= 95 ? '#22c55e' : '#ef4444'],
                    [ar ? 'الويكند خ/ج' : 'Thu/Fri', `${week.health.totals.weekend.thu}/${week.health.totals.weekend.fri}%`, Math.min(week.health.totals.weekend.thu, week.health.totals.weekend.fri) >= 95 ? '#22c55e' : '#f59e0b'],
                  ].map(([l, v, c]: any, i: number) => (
                    <div key={i} className="rounded-xl px-2 py-1.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div className="text-[9px] uppercase" style={{ color: 'var(--text-3)' }}>{l}</div>
                      <div className="text-[13px] font-bold" style={{ color: c }}>{v}</div>
                    </div>
                  ))}
                </div>
                {/* 7-day × 24-hour heat grid — click a cell for the numbers */}
                <div className="overflow-x-auto">
                  <table className="text-[9px]" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
                    <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} style={{ color: 'var(--text-3)', minWidth: 18 }}>{h}</th>)}<th style={{ color: 'var(--text-3)' }}>{ar ? 'تغطية' : 'cov'}</th></tr></thead>
                    <tbody>
                      {week.health.days.map((dRow: any, di: number) => (
                        <tr key={di}>
                          <td className="pe-1 font-bold" style={{ color: di >= 5 ? '#f59e0b' : 'var(--text-2)' }}>{dRow.day}</td>
                          {dRow.hours.map((c: any) => (
                            <td key={c.hour} title={`${dRow.day} ${String(c.hour).padStart(2, '0')}:00 · ${ar ? 'مطلوب' : 'req'} ${c.required} · ${ar ? 'مجدول' : 'sched'} ${c.scheduled} · ${ar ? 'فعلي' : 'eff'} ${c.effective} · ${ar ? 'فرق' : 'gap'} ${c.gap}`}
                              className="rounded" style={{ width: 18, height: 16, cursor: 'default',
                                background: c.status === 'red' ? '#ef4444' : c.status === 'yellow' ? '#f59e0b' : c.status === 'green' ? '#22c55e' : c.status === 'blue' ? '#6366f1' : 'var(--surface-2)',
                                opacity: c.status === 'grey' ? 0.35 : 0.9 }} />
                          ))}
                          <td className="ps-1 font-bold" style={{ color: dRow.red > 0 ? '#ef4444' : dRow.coveragePct >= 95 ? '#22c55e' : '#f59e0b' }}>{dRow.coveragePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[9px]" style={{ color: 'var(--text-3)' }}>
                  {[['#22c55e', ar ? 'جيد' : 'good'], ['#f59e0b', ar ? 'تحذير' : 'warning'], ['#ef4444', ar ? 'نقص حرج' : 'critical'], ['#6366f1', ar ? 'فوق الاحتياج/OT' : 'above demand/OT'], ['var(--surface-2)', ar ? 'لا احتياج' : 'no demand']].map(([c, l], i) => (
                    <span key={i} className="inline-flex items-center gap-1"><span className="inline-block rounded" style={{ width: 10, height: 10, background: c as string }} />{l}</span>
                  ))}
                </div>
                {/* recommended actions */}
                <div className="mt-2 space-y-1">
                  {week.health.recommendations.map((r: string, i: number) => (
                    <div key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: /^RED/.test(r) ? '#ef4444' : 'var(--text-2)' }}>
                      <span style={{ color: 'var(--text-3)' }}>•</span>{r}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {week.warnings?.length > 0 && (
              <div className="rounded-xl p-2.5 mb-3 text-[11px]" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>
                <AlertTriangle size={12} className="inline mb-0.5 me-1" />{ar ? 'ملاحظات:' : 'Notes:'} {week.warnings.join(' · ')}
              </div>
            )}
            {/* groups summary */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
              {week.groups.map((g: any, i: number) => (
                <div key={i} className="p-2.5 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between text-[11px]"><span className="font-bold" style={{ color: catColor(g.category) }}>{g.code} <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{g.category}</span></span><span style={{ color: g.coversEveryDay ? '#22c55e' : '#ef4444' }}>{g.coversEveryDay ? (ar ? 'يغطّي كل يوم ✓' : 'covers all ✓') : (ar ? 'نقص' : 'short')}</span></div>
                  <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{g.assigned} {ar ? 'موظف' : 'staff'} · {g.perDay}/{ar ? 'يوم' : 'day'}{g.femaleNight > 0 ? ` · ${g.femaleNight} ${ar ? 'بنت نايت ⚑' : 'F night ⚑'}` : ''}</div>
                </div>
              ))}
            </div>
            {/* per-employee list */}
            <div className="rounded-xl overflow-auto" style={{ border: '1px solid var(--border)', maxHeight: 360 }}>
              <table className="w-full text-[11px]">
                <thead style={{ background: 'var(--surface-2)' }}><tr>{[ar ? 'الموظف' : 'Employee', ar ? 'الشفت' : 'Shift', ar ? 'النوع' : 'Type', ar ? 'يوم OFF' : 'OFF day', ar ? 'تحميل نايت سابق' : 'Prior night%'].map((h, i) => <th key={i} className={`px-2 py-1.5 ${i === 0 ? 'text-start' : 'text-center'}`} style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                <tbody>{week.assignments.map((a: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-1)' }}>{a.name}</td>
                    <td className="px-2 py-1.5 text-center font-bold" style={{ color: catColor(a.category) }}>{a.code}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-3)' }}>{a.category}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{a.off}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: a.nightLoadPct >= 60 ? '#ef4444' : 'var(--text-3)' }}>{a.nightLoadPct}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-[9px] mt-2" style={{ color: 'var(--text-3)' }}>{ar ? `${week.staffing.peopleNeeded} مطلوب · ${week.staffing.activeStaff} متاح · ${week.staffing.spares} احتياطي.` : `${week.staffing.peopleNeeded} needed · ${week.staffing.activeStaff} available · ${week.staffing.spares} spare.`}</p>
            {/* SAVE as a reviewable draft → renders the full 7-day grid */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button onClick={saveDraft} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}><Save size={13} />{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'احفظ مسوّدة الأسبوع' : 'Save weekly draft')}</button>
              {saved && <button onClick={exportGrid} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}><Download size={13} />CSV</button>}
              {saved && <span className="text-[11px]" style={{ color: '#22c55e' }}>✓ {ar ? 'محفوظة' : 'saved'} · {saved.weekStart}</span>}
            </div>
          </>)}

          {/* the saved 7-day week grid (employee × Sat→Fri) */}
          {saved && (
            <div className="mt-3 rounded-xl overflow-auto" style={{ border: '1px solid var(--border)', maxHeight: 420 }}>
              <table className="w-full text-[11px]">
                <thead style={{ background: 'var(--surface-2)' }}><tr>
                  <th className="px-2 py-1.5 text-start sticky start-0" style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', background: 'var(--surface-2)' }}>{ar ? 'الموظف' : 'Employee'}</th>
                  {saved.days.map((dn: string, i: number) => <th key={i} className="px-2 py-1.5 text-center" style={{ color: i >= 5 ? '#f59e0b' : 'var(--text-3)', fontSize: 10 }}>{dn}</th>)}
                </tr></thead>
                <tbody>{saved.grid.map((g: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-1 whitespace-nowrap sticky start-0" style={{ color: 'var(--text-1)', background: 'var(--surface)' }}>{g.name}</td>
                    {g.days.map((code: string, di: number) => (
                      <td key={di} className="px-1.5 py-1 text-center font-semibold" style={{ color: code === 'OFF' ? 'var(--text-3)' : '#fff', background: code === 'OFF' ? 'transparent' : cellColor(code) + '22' }}>
                        <span style={{ color: cellColor(code) }}>{code}</span>
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* PUBLISH into the live grid — confirm-gated, non-overwriting, reversible */}
          {saved && (
            <div className="mt-4 pt-3" style={{ borderTop: '1px dashed var(--border)' }}>
              <div className="flex items-center gap-2 mb-1"><Rocket size={15} style={{ color: '#f59e0b' }} /><h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'النشر للجدول الحيّ' : 'Publish to the live grid'}</h4></div>
              <p className="text-[10px] mb-2" style={{ color: 'var(--text-3)' }}>{ar ? 'يُكتب الجدول في أول أسبوع فارغ بعد آخر بيانات موجودة — لا يستبدل أي خلية مجدولة مسبقاً (ON CONFLICT DO NOTHING)، ويوسم الصفوف ليمكن التراجع عنها بالكامل.' : 'writes into the first empty week after the latest existing data — never overwrites a pre-scheduled cell (ON CONFLICT DO NOTHING) — and tags the rows so the publish can be fully undone.'}</p>
              {!confirmPub && !pub && (
                <button onClick={() => setConfirmPub(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#f59e0b,#ea580c)', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }}><Rocket size={13} />{ar ? 'انشر للجدول الحيّ' : 'Publish to live grid'}</button>
              )}
              {confirmPub && !pub && (
                <div className="rounded-xl p-3 flex items-center gap-2 flex-wrap" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <span className="text-[11px] flex-1 min-w-[200px]" style={{ color: 'var(--text-2)' }}>{ar ? 'تأكيد النشر؟ سيُكتب في أول أسبوع فارغ، بدون استبدال أي شيء قائم.' : 'Confirm publish? It writes into the first empty week, overwriting nothing.'}</span>
                  <button onClick={publish} disabled={publishing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#f59e0b,#ea580c)' }}><Rocket size={13} />{publishing ? (ar ? 'جارٍ النشر…' : 'Publishing…') : (ar ? 'نعم، انشر' : 'Yes, publish')}</button>
                  <button onClick={() => setConfirmPub(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>{ar ? 'إلغاء' : 'Cancel'}</button>
                </div>
              )}
              {pub && !pub.error && (
                <div className="rounded-xl p-3" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div className="text-[12px] font-semibold" style={{ color: '#22c55e' }}>
                    {pub.undone
                      ? (ar ? `↩ تم التراجع — حُذفت ${pub.deleted} خلية` : `↩ Reverted — ${pub.deleted} cells removed`)
                      : (ar ? `✓ نُشر ${pub.written} خلية في أسبوع ${pub.weekStart}` : `✓ Published ${pub.written} cells into week ${pub.weekStart}`)}
                    {!pub.undone && pub.skipped > 0 ? ` · ${pub.skipped} ${ar ? 'موجودة مسبقاً (محفوظة)' : 'pre-existing (kept)'}` : ''}
                  </div>
                  {!pub.undone && <button onClick={unpublish} disabled={publishing} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}><Undo2 size={13} />{publishing ? (ar ? 'جارٍ…' : '…') : (ar ? 'تراجع عن النشر' : 'Undo publish')}</button>}
                </div>
              )}
              {pub?.error && <p className="text-[11px]" style={{ color: '#ef4444' }}>{ar ? 'تعذّر النشر' : 'Publish failed'}</p>}
            </div>
          )}
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ar ? 'الاحتياج = متوسط الهيدكاونت المجدول لكل ساعة بالروستر المعتمد (نمط حقيقي). الشفتات بأوقاتها الفعلية من بيانات الفنكشن. المزيج بـset-cover جشع يغطّي كل ساعة عليها احتياج. كفاية الطاقم = الموظفون الفعّالون ≥ الشفتات×7/6 (يوم راحة). الخطوة الأخيرة (إسناد كل موظف ليوم/شفت مع الراحة والتدوير وقاعدة البنات) عبر محرّك الإسناد الموجود.' : 'Demand = avg scheduled headcount per hour from the approved roster (real pattern). Shifts use their actual windows from the function\'s data. The mix is a greedy set-cover meeting every hour with demand. Staff sufficiency = active staff ≥ shifts×7/6 (one OFF/week). Final per-employee day/shift assignment (with rest, rotation, female rule) routes through the existing assignment engine.'}</p>
      </>)}
      {!loading && !d && <p className="text-sm py-8 text-center" style={{ color: '#f43f5e' }}>{ar ? 'تعذّر التوليد' : 'Failed to generate'}</p>}
    </div>
  );
}
