import { useEffect, useState, useCallback, useMemo } from 'react';
import { Clock, Users, TrendingDown, TrendingUp, Timer, Activity, ShieldCheck, FileSpreadsheet, LayoutDashboard, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile } from '@/components/dazzle';
import { DateRangeBar } from '@/components/DateRangeBar';

/** Hourly analytics (0-23) per function over the approved roster (roster_days):
 *  coverage (scheduled/working/%), permissions, shrinkage (count + %), tardiness,
 *  and OT (before/after) per hour — with a TOTAL row. Theme-aware. */
export default function HourlyAnalyticsPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [f, setF] = useState({ from: '', to: '', function: '', agent: '' });
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const nav = useNavigate();
  const [exporting, setExporting] = useState(false);
  // table dimension: headcount cascade vs duration (hours/minutes). Director 2026-07-03.
  const [tmode, setTmode] = useState<'hc' | 'hrs'>('hc');

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/hourly?${qs}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const exportXlsx = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
      qs.set('format', 'xlsx');
      const r: any = await apiClient.get(`/attendance-recon/roster-v2/hourly?${qs}`, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data);
      a.download = `hourly-analytics_${d?.from || ''}_${d?.to || ''}.xlsx`; a.click();
    } finally { setExporting(false); }
  };

  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;

  // the dataset to show: a single function or All (agent mode groups per person — show the total)
  const view = useMemo(() => {
    if (!d) return null;
    if (!f.agent && f.function) { const fn = d.byFunction.find((x: any) => x.fn === f.function); return fn || d.all; }
    return d.all;
  }, [d, f.function, f.agent]);
  // sick / absence / leave split behind the shrinkage number (backend per-hour fields)
  const shrinkSplit = useMemo(() => {
    if (!view) return null;
    const s = view.hours.reduce((a: any, h: any) => ({ sick: a.sick + (h.sick || 0), absent: a.absent + (h.absent || 0), leave: a.leave + (h.onLeave || 0) }), { sick: 0, absent: 0, leave: 0 });
    return s;
  }, [view]);

  const maxWork = useMemo(() => view ? Math.max(...view.hours.map((h: any) => h.effective), 1) : 1, [view]);
  // demand-driven coverage analysis (from the observed hourly pattern on roster_days):
  // open hours whose effective HC falls below 60% of the function's peak demand = under-covered.
  const recCat = (h: number) => h >= 5 && h < 11 ? (ar ? 'صباحي (M/B)' : 'morning (M/B)') : h >= 11 && h < 16 ? (ar ? 'مسائي (C/E)' : 'evening (C/E)') : h >= 16 && h < 22 ? (ar ? 'نايت (N)' : 'night (N)') : (ar ? 'ميدنايت (MD/MN)' : 'midnight (MD/MN)');
  const coverage = useMemo(() => {
    if (!view) return null;
    const open = view.hours.filter((h: any) => h.scheduled > 0);
    const peak = Math.max(...open.map((h: any) => h.effective), 1);
    const thin = open.filter((h: any) => h.effective < peak * 0.6)
      .map((h: any) => ({ hour: h.hour, eff: h.avgEffective, pct: Math.round(100 * h.effective / peak), rec: recCat(h.hour) }))
      .sort((a: any, b: any) => a.pct - b.pct);
    return { peakHour: view.peakHour, peakEff: view.hours[view.peakHour ?? 0]?.avgEffective, thin };
  }, [view, ar]);
  const covColor = (v: number) => v >= 90 ? '#22c55e' : v >= 75 ? '#f59e0b' : '#ef4444';
  const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;

  return (
    <div className="space-y-4 page-enter">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', boxShadow: '0 6px 18px rgba(14,165,233,0.35)' }}><Clock size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'التحليلات بالساعة' : 'Hourly Analytics'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'التغطية والاستئذانات والشرينكج والتأخير والأوفر تايم لكل ساعة ولكل فنكشن — عدد و% مع توتال (من الجدول المعتمد)' : 'coverage, permissions, shrinkage, tardiness & OT per hour per function — count & % with a total (approved roster)'}</p>
        </div>
        <DateRangeBar from={f.from || d?.from || ''} to={f.to || d?.to || ''} onChange={(from: string, to: string) => setF(p => ({ ...p, from, to }))} />
        <select value={f.function} onChange={e => set('function', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle}>
          <option value="">{ar ? 'كل الفنكشن' : 'All functions'}</option>{(d?.functions || []).map((x: string) => <option key={x} value={x}>{x}</option>)}</select>
        <input value={f.agent} onChange={e => set('agent', e.target.value)} placeholder={ar ? 'موظف: رقم / اسم / يوزر' : 'Agent: ID / name / user'}
          className="px-2.5 py-1.5 rounded-lg text-xs outline-none w-40" style={inputStyle} />
        <button onClick={exportXlsx} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
          <FileSpreadsheet size={13} />{exporting ? (ar ? 'جارٍ…' : '…') : (ar ? 'تصدير Excel' : 'Export Excel')}</button>
        <button onClick={() => nav('/dashboard-builder')} title={ar ? 'ابنِ داشبورد بمقاييس الساعة (البعد: ساعة بداية الشيفت)' : 'Build a dashboard with hourly metrics (dim: shift start hour)'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
          <LayoutDashboard size={13} />{ar ? 'داشبورد' : 'Dashboard'}</button>
      </div>
      {f.agent && d?.functions?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]" style={{ color: 'var(--text-3)' }}>
          {ar ? 'مطابقات:' : 'matches:'} {d.functions.slice(0, 8).map((g: string, i: number) => <span key={i} className="px-2 py-0.5 rounded-lg font-semibold" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>{g}</span>)}
        </div>
      )}

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ التحليل بالساعة…' : 'Computing hourly…'}</p>}
      {!loading && view && (<>
        {/* summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <StatTile icon={Activity} label={ar ? 'ساعة الذروة' : 'Peak hour'} value={hh(view.peakHour ?? 0)} sub={`${view.hours[view.peakHour ?? 0]?.effective?.toLocaleString?.() || 0} ${ar ? 'فعلي' : 'effective'}`} color="#0ea5e9" delay={0} trend={view.hours.map((h: any) => h.effective)} />
          <StatTile icon={Users} label={ar ? 'التغطية الفعلية' : 'Coverage (eff.)'} num={view.total.coveragePct} suffix="%" sub={ar ? 'فعلي/مجدول (مع OT)' : 'effective/scheduled'} color={covColor(view.total.coveragePct)} delay={60} trend={view.hours.map((h: any) => h.coveragePct)} />
          <StatTile icon={ShieldCheck} label={ar ? 'كونفورمانس' : 'Conformance'} num={view.total.conformance ?? 0} suffix="%" sub={ar ? 'لكل انتيرفال' : 'per interval'} color={covColor(view.total.conformance ?? 0)} delay={120} trend={view.hours.map((h: any) => h.conformance)} />
          <StatTile icon={TrendingUp} label={ar ? 'OT قبل الدوام' : 'OT before'} num={view.total.otBeforeHours} suffix={ar ? 'س' : 'h'} sub={`${view.total.otBeforePct}% ${ar ? 'من OT' : 'of OT'}`} color="#a78bfa" delay={180} trend={view.hours.map((h: any) => h.otBeforeHc)} />
          <StatTile icon={Timer} label={ar ? 'OT بعد الدوام' : 'OT after'} num={view.total.otAfterHours} suffix={ar ? 'س' : 'h'} sub={`${view.total.otAfterPct}% ${ar ? 'من OT' : 'of OT'}`} color="#8b5cf6" delay={240} trend={view.hours.map((h: any) => h.otAfterHc)} />
          <StatTile icon={TrendingDown} label={ar ? 'الشرينكج' : 'Shrinkage'} num={view.total.shrinkagePct} suffix="%" sub={shrinkSplit ? (ar ? `مرض ${shrinkSplit.sick} · غياب ${shrinkSplit.absent} · إجازة ${shrinkSplit.leave}` : `sick ${shrinkSplit.sick} · absent ${shrinkSplit.absent} · leave ${shrinkSplit.leave}`) : `${view.total.shrinkage.toLocaleString()} ${ar ? 'حالة' : 'cases'}`} color="#f43f5e" delay={300} trend={view.hours.map((h: any) => h.shrinkagePct)} />
        </div>

        {/* hourly EFFECTIVE-headcount curve (working + OT − late/early) */}
        <div className="rounded-2xl p-4" style={panel}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'منحنى الهيدكاونت الفعلي بالساعة' : 'Effective headcount by hour'} <span className="text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>· {d.days} {ar ? 'يوم' : 'days'} · {ar ? 'مداوم + OT − تأخير/خروج مبكر' : 'working + OT − late/early'}{f.function ? ` · ${f.function}` : ''}</span></h3>
          <div className="flex items-end gap-1 h-32">
            {view.hours.map((h: any) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${hh(h.hour)} · ${ar ? 'فعلي' : 'effective'} ${h.avgEffective}/${ar ? 'يوم' : 'day'} · ${ar ? 'مداوم' : 'working'} ${h.avgWorking} · ${ar ? 'تغطية' : 'cov'} ${h.coveragePct}%`}>
                <div className="w-full rounded-t" style={{ height: `${Math.round(100 * h.effective / maxWork)}%`, minHeight: h.effective ? 2 : 0, background: h.hour === view.peakHour ? 'linear-gradient(180deg,#0ea5e9,#6366f1)' : `${covColor(h.coveragePct)}`, opacity: h.hour === view.peakHour ? 1 : 0.55 }} />
                <span className="text-[8px] mt-0.5" style={{ color: 'var(--text-3)' }}>{h.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* dimension toggle — headcount cascade vs hours/minutes (fewer columns → less scroll) */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-xl p-1" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            {(([['hc', ar ? 'عدد' : 'Headcount'], ['hrs', ar ? 'ساعات/دقائق' : 'Hours/mins']]) as [('hc' | 'hrs'), string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTmode(k)} className="px-3.5 py-1 rounded-lg text-[11px] font-semibold" style={{ background: tmode === k ? 'linear-gradient(135deg,#0ea5e9,#6366f1)' : 'transparent', color: tmode === k ? '#fff' : 'var(--text-2)', boxShadow: tmode === k ? '0 2px 8px rgba(99,102,241,0.3)' : 'none' }}>{l}</button>
            ))}
          </div>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{tmode === 'hc' ? (ar ? 'كم موظف على المقعد كل ساعة' : 'how many agents on seat each hour') : (ar ? 'OT قبل/بعد بالساعات · تأخير/خروج بالدقائق · إجمالي ساعات العمل' : 'OT before/after in hours · tardy/early in minutes · total working hours')}</span>
        </div>

        {/* the hourly table with TOTAL row */}
        {tmode === 'hc' && (
        <div className="rounded-2xl overflow-auto" style={panel}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-2)' }}>
            {/* group band — the related columns live TOGETHER (actual cascade · shrinkage & lost · plan · KPIs) */}
            <tr>
              <th style={{ background: 'var(--surface-2)' }} />
              <th colSpan={11} className="px-2 py-1 text-center font-bold" style={{ color: '#818cf8', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', background: 'rgba(99,102,241,0.08)', borderBottom: '1px solid rgba(99,102,241,0.25)' }}>{ar ? 'الهيدكاونت الفعلي — المتسلسلة (متوسط/يوم)' : 'Actual headcount — cascade (avg/day)'}</th>
              <th colSpan={5} className="px-2 py-1 text-center font-bold" style={{ color: '#fb7185', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', background: 'rgba(244,63,94,0.07)', borderBottom: '1px solid rgba(244,63,94,0.25)' }}>{ar ? 'الشرينكج والضائع (إجمالي المدى)' : 'Shrinkage & lost (period total)'}</th>
              <th colSpan={2} className="px-2 py-1 text-center font-bold" style={{ color: '#38bdf8', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', background: 'rgba(14,165,233,0.08)', borderBottom: '1px solid rgba(14,165,233,0.3)' }}>{ar ? 'خطة الجدول (جينيريت + ريكوستات)' : 'Schedule plan (generate + requests)'}</th>
              <th colSpan={4} className="px-2 py-1 text-center font-bold" style={{ color: 'var(--text-3)', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', background: 'var(--surface-2)' }}>{ar ? 'مؤشرات' : 'KPIs'}</th>
            </tr>
            <tr>
              {([[ar ? 'الساعة' : 'Hour', 0], [ar ? 'مجدول' : 'Sched', 0], [ar ? 'مداوم' : 'Working', 0], [ar ? '+OT قبل' : '+OT bef', 0], [ar ? '+OT بعد' : '+OT aft', 0], [ar ? '= بعد OT' : '= after OT', 1], [ar ? '−إذن تأخير' : '−Perm late', 0], [ar ? '−إذن مبكر' : '−Perm early', 0], [ar ? '= بعد الإذن' : '= after perm', 1], [ar ? '−تارديشن' : '−Tardy', 0], [ar ? '−خروج مبكر' : '−Early', 0], [ar ? '= الفعلي' : '= Effective', 2], [ar ? 'مرض' : 'Sick', 0], [ar ? 'غياب' : 'Abs', 0], [ar ? 'إجازة' : 'Leave', 0], [ar ? 'شرينكج' : 'Shrink', 1], [ar ? 'ساعات ضائعة' : 'Lost hrs', 1], [ar ? 'خطة HC' : 'Plan HC', 1], [ar ? 'خطة −ريكوستات' : 'Plan −req', 1], [ar ? 'تغطية %' : 'Cov %', 0], [ar ? 'كونف %' : 'Conf %', 0], [ar ? 'ساعات OT' : 'OT hrs', 0], [ar ? 'ساعات إذن' : 'Perm hrs', 0]] as [string, number][]).map(([hd, cp], i) => (
                <th key={i} className={`px-2 py-2 font-semibold whitespace-nowrap ${i === 0 ? 'text-start sticky start-0 z-20' : 'text-center'}`} style={{ color: cp ? 'var(--text-1)' : 'var(--text-3)', fontSize: 10, letterSpacing: '.02em', textTransform: 'uppercase', background: i === 0 ? 'var(--surface-2)' : (cp ? 'rgba(99,102,241,0.08)' : undefined) }}>{hd}</th>
              ))}
            </tr></thead>
            <tbody>
              {view.hours.map((h: any) => {
                const cp = (v: any, color = 'var(--text-1)') => <td className="px-2 py-1.5 text-center font-bold" style={{ color, background: 'rgba(99,102,241,0.06)' }}>{v}</td>;
                return (
                <tr key={h.hour} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors" style={{ borderTop: '1px solid var(--border)', opacity: h.scheduled ? 1 : 0.4 }}>
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap sticky start-0 z-10" style={{ color: h.hour === view.peakHour ? '#0ea5e9' : 'var(--text-1)', background: 'var(--surface)' }}>{hh(h.hour)}{h.hour === view.peakHour && <span className="text-[9px]"> ★</span>}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{h.avgScheduled}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{h.avgWorking}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.avgOtBeforeHc ? '#a78bfa' : 'var(--text-3)' }}>{h.avgOtBeforeHc ? `+${h.avgOtBeforeHc}` : ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.avgOtAfterHc ? '#8b5cf6' : 'var(--text-3)' }}>{h.avgOtAfterHc ? `+${h.avgOtAfterHc}` : ''}</td>
                  {cp(h.avgHcWithOt)}
                  <td className="px-2 py-1.5 text-center" style={{ color: h.avgPermLate ? '#0ea5e9' : 'var(--text-3)' }}>{h.avgPermLate ? `−${h.avgPermLate}` : ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.avgPermEarly ? '#0ea5e9' : 'var(--text-3)' }}>{h.avgPermEarly ? `−${h.avgPermEarly}` : ''}</td>
                  {cp(h.avgHcAfterPerm)}
                  <td className="px-2 py-1.5 text-center" style={{ color: h.avgTardiness ? '#fb923c' : 'var(--text-3)' }}>{h.avgTardiness ? `−${h.avgTardiness}` : ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.avgEarlyOut ? '#f43f5e' : 'var(--text-3)' }}>{h.avgEarlyOut ? `−${h.avgEarlyOut}` : ''}</td>
                  {cp(h.avgEffective)}
                  <td className="px-2 py-1.5 text-center" style={{ color: h.sick ? '#f43f5e' : 'var(--text-3)' }}>{h.sick || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.absent ? '#ef4444' : 'var(--text-3)' }}>{h.absent || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.onLeave ? '#8b5cf6' : 'var(--text-3)' }}>{h.onLeave || ''}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: h.shrinkage ? '#f43f5e' : 'var(--text-3)', background: 'rgba(244,63,94,0.06)' }}>{h.shrinkage ? `${h.shrinkage} · ${h.shrinkagePct}%` : ''}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: h.lostHours ? '#f43f5e' : 'var(--text-3)', background: 'rgba(244,63,94,0.06)' }}
                    title={ar ? `ساعات ضائعة = غياب/مرض مجدول (${h.shrinkage || 0} شخص·ساعة، مثلاً ذيل شفت مساء يعبر منتصف الليل) + تأخير/خروج/إذن (${((h.tardyMin || 0) + (h.earlyMin || 0) + (h.permLateMin || 0) + (h.permEarlyMin || 0))}د)` : `lost = scheduled absence/sick (${h.shrinkage || 0} person·hr, incl. cross-midnight evening tails) + tardy/early/perm (${((h.tardyMin || 0) + (h.earlyMin || 0) + (h.permLateMin || 0) + (h.permEarlyMin || 0))}m)`}>{h.lostHours ? h.lostHours.toLocaleString() : ''}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: h.plan ? '#0ea5e9' : 'var(--text-3)', background: 'rgba(14,165,233,0.07)' }}>{h.avgPlan || ''}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: h.planAfterReq ? '#0284c7' : 'var(--text-3)', background: 'rgba(14,165,233,0.07)' }}>{h.avgPlanAfterReq || ''}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: covColor(h.coveragePct) }}>{h.scheduled ? `${h.coveragePct}%` : '—'}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.conformance != null ? covColor(h.conformance) : 'var(--text-3)' }}>{h.conformance != null ? `${h.conformance}%` : '—'}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.otHours ? '#8b5cf6' : 'var(--text-3)' }}>{h.otHours ? h.otHours.toLocaleString() : ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: h.permHours ? '#0ea5e9' : 'var(--text-3)' }}>{h.permHours ? h.permHours.toLocaleString() : ''}</td>
                </tr>
              );})}
              {/* TOTAL row */}
              <tr style={{ borderTop: '2px solid var(--border-strong, var(--border))', background: 'var(--surface-2)' }}>
                <td className="px-2 py-2 font-bold sticky start-0 z-10" style={{ color: 'var(--text-1)', background: 'var(--surface-2)' }}>{ar ? 'الإجمالي' : 'TOTAL'}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: 'var(--text-2)' }}>{view.total.scheduled.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: 'var(--text-2)' }}>{view.total.working.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#a78bfa' }}>+{view.total.otBeforeHc.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#8b5cf6' }}>+{view.total.otAfterHc.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: 'var(--text-1)', background: 'rgba(99,102,241,0.1)' }}>{view.total.hcWithOt.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#0ea5e9' }}>−{view.total.permLate.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#0ea5e9' }}>−{view.total.permEarly.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: 'var(--text-1)', background: 'rgba(99,102,241,0.1)' }}>{view.total.hcAfterPerm.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#fb923c' }}>−{view.total.tardiness.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#f43f5e' }}>−{view.total.earlyOut.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: 'var(--text-1)', background: 'rgba(99,102,241,0.1)' }}>{view.total.effective.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#f43f5e' }}>{(view.total.sick ?? 0).toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#ef4444' }}>{(view.total.absent ?? 0).toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#8b5cf6' }}>{(view.total.onLeave ?? 0).toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}>{view.total.shrinkage.toLocaleString()} · {view.total.shrinkagePct}%</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}>{(view.total.lostHours ?? 0).toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#0ea5e9', background: 'rgba(14,165,233,0.08)' }}>{(view.total.plan ?? 0).toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#0284c7', background: 'rgba(14,165,233,0.08)' }}>{(view.total.planAfterReq ?? 0).toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: covColor(view.total.coveragePct) }}>{view.total.coveragePct}%</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: view.total.conformance != null ? covColor(view.total.conformance) : 'var(--text-3)' }}>{view.total.conformance != null ? `${view.total.conformance}%` : '—'}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#8b5cf6' }}>{view.total.otHours.toLocaleString()}</td>
                <td className="px-2 py-2 text-center font-bold" style={{ color: '#0ea5e9' }}>{view.total.permHours.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        )}

        {/* HOURS / MINUTES table — the duration dimension (Director 2026-07-03) */}
        {tmode === 'hrs' && (() => {
          const t = view.total;
          const H = (v: number) => v ? `${(+v).toLocaleString()}` : '';        // hours cell (already /60 on the server)
          const M = (v: number) => v ? `${(+v).toLocaleString()}` : '';        // minutes cell
          const cols: { key: string; label: string; unit: 'h' | 'm'; color: string; band: number }[] = [
            { key: 'workedHrs',    label: ar ? 'ساعات عمل' : 'Working',      unit: 'h', color: 'var(--text-1)', band: 0 },
            { key: 'otBeforeHrs',  label: ar ? 'OT قبل' : 'OT before',      unit: 'h', color: '#a78bfa', band: 1 },
            { key: 'otAfterHrs',   label: ar ? 'OT بعد' : 'OT after',       unit: 'h', color: '#8b5cf6', band: 1 },
            { key: 'otHours',      label: ar ? 'إجمالي OT' : 'Total OT',    unit: 'h', color: '#7c3aed', band: 1 },
            { key: 'tardyMin',     label: ar ? 'تأخير' : 'Tardy',           unit: 'm', color: '#fb923c', band: 2 },
            { key: 'earlyMin',     label: ar ? 'خروج مبكر' : 'Early out',   unit: 'm', color: '#f43f5e', band: 2 },
            { key: 'permLateMin',  label: ar ? 'إذن تأخير' : 'Perm late',   unit: 'm', color: '#0ea5e9', band: 3 },
            { key: 'permEarlyMin', label: ar ? 'إذن مبكر' : 'Perm early',   unit: 'm', color: '#0284c7', band: 3 },
            { key: 'lostHours',    label: ar ? 'ساعات ضائعة' : 'Lost hrs',  unit: 'h', color: '#f43f5e', band: 4 },
          ];
          const bandColor = ['transparent', 'rgba(139,92,246,0.06)', 'rgba(251,146,60,0.06)', 'rgba(14,165,233,0.06)', 'rgba(244,63,94,0.06)'];
          return (
          <div className="rounded-2xl overflow-auto" style={panel}>
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-2)' }}>
                <tr>
                  <th style={{ background: 'var(--surface-2)' }} />
                  <th className="px-2 py-1 text-center font-bold" style={{ color: 'var(--text-3)', fontSize: 9, textTransform: 'uppercase' }}>{ar ? 'عمل' : 'Work'}</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-bold" style={{ color: '#8b5cf6', fontSize: 9, textTransform: 'uppercase', background: 'rgba(139,92,246,0.08)' }}>{ar ? 'أوفر تايم (ساعات)' : 'Overtime (hours)'}</th>
                  <th colSpan={2} className="px-2 py-1 text-center font-bold" style={{ color: '#fb7185', fontSize: 9, textTransform: 'uppercase', background: 'rgba(251,146,60,0.08)' }}>{ar ? 'تأخير/خروج (دقائق)' : 'Tardy/early (mins)'}</th>
                  <th colSpan={2} className="px-2 py-1 text-center font-bold" style={{ color: '#38bdf8', fontSize: 9, textTransform: 'uppercase', background: 'rgba(14,165,233,0.08)' }}>{ar ? 'استئذانات (دقائق)' : 'Permissions (mins)'}</th>
                  <th className="px-2 py-1 text-center font-bold" style={{ color: '#f43f5e', fontSize: 9, textTransform: 'uppercase', background: 'rgba(244,63,94,0.08)' }}>{ar ? 'ضائع' : 'Lost'}</th>
                </tr>
                <tr>
                  <th className="px-2 py-2 font-semibold text-start sticky start-0" style={{ color: 'var(--text-1)', fontSize: 10, textTransform: 'uppercase', background: 'var(--surface-2)' }}>{ar ? 'الساعة' : 'Hour'}</th>
                  {cols.map(c => <th key={c.key} className="px-2 py-2 font-semibold text-center whitespace-nowrap" style={{ color: 'var(--text-2)', fontSize: 10, textTransform: 'uppercase', background: bandColor[c.band] }}>{c.label}<span style={{ color: 'var(--text-3)', fontSize: 8 }}> {c.unit === 'h' ? (ar ? 'س' : 'h') : (ar ? 'د' : 'm')}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {view.hours.map((h: any) => (
                  <tr key={h.hour} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" style={{ borderTop: '1px solid var(--border)', opacity: (h.workedHrs || h.otHours || h.tardyMin || h.earlyMin) ? 1 : 0.4 }}>
                    <td className="px-2 py-1.5 font-semibold sticky start-0 whitespace-nowrap" style={{ color: h.hour === view.peakHour ? '#0ea5e9' : 'var(--text-1)', background: 'var(--surface)' }}>{hh(h.hour)}{h.hour === view.peakHour && <span className="text-[9px]"> ★</span>}</td>
                    {cols.map(c => <td key={c.key} className="px-2 py-1.5 text-center" style={{ color: h[c.key] ? c.color : 'var(--text-3)', background: bandColor[c.band], fontWeight: h[c.key] ? 600 : 400 }}
                      title={c.key === 'lostHours' ? (ar ? `ساعات ضائعة = غياب/مرض مجدول (${h.shrinkage || 0} شخص·ساعة) + تأخير/خروج/إذن (${((h.tardyMin || 0) + (h.earlyMin || 0) + (h.permLateMin || 0) + (h.permEarlyMin || 0))}د)` : `lost = scheduled absence/sick (${h.shrinkage || 0} person·hr) + tardy/early/perm (${((h.tardyMin || 0) + (h.earlyMin || 0) + (h.permLateMin || 0) + (h.permEarlyMin || 0))}m)`) : undefined}>{c.unit === 'h' ? H(h[c.key]) : M(h[c.key])}</td>)}
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface-2)' }}>
                  <td className="px-2 py-2 font-bold sticky start-0" style={{ color: 'var(--text-1)', background: 'var(--surface-2)' }}>{ar ? 'الإجمالي' : 'TOTAL'}</td>
                  {cols.map(c => <td key={c.key} className="px-2 py-2 text-center font-bold" style={{ color: c.color, background: bandColor[c.band] }}>{c.unit === 'h' ? `${(+(t[c.key] || 0)).toLocaleString()}${ar ? 'س' : 'h'}` : `${(+(t[c.key] || 0)).toLocaleString()}${ar ? 'د' : 'm'}`}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          );
        })()}

        {/* OT REALITY strip — TRUE_OT (regular + OFF-day + holiday). The honest "كم ساعة OT":
            the per-hour OT-before/after split can read 0 in a not-yet-rebuilt month, but the real
            OT still lives in the off-day/holiday buckets and is shown here. */}
        {(() => {
          const t = view.total; const has = (t.otTrueHrs ?? 0) > 0 || (t.otBeforeHrs ?? 0) > 0 || (t.otAfterHrs ?? 0) > 0;
          const chip = (label: string, val: number, color: string) => (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-2)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />{label}
              <b className="tabular-nums" style={{ color: 'var(--text-1)' }}>{(+val || 0).toLocaleString()}{ar ? 'س' : 'h'}</b>
            </span>
          );
          return (
          <div className="rounded-2xl p-3 flex flex-wrap items-center gap-x-5 gap-y-1.5" style={panel}>
            <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}><Flame size={14} style={{ color: '#f97316' }} />{ar ? 'أوفر تايم الحقيقي' : 'Real overtime (TRUE_OT)'}</span>
            {chip(ar ? 'عادي' : 'Regular', t.otRegHrs ?? 0, '#f59e0b')}
            {chip(ar ? 'يوم إجازة' : 'Off-day', t.otOffdayHrs ?? 0, '#f97316')}
            {chip(ar ? 'عطلة رسمية' : 'Holiday', t.otHolidayHrs ?? 0, '#ef4444')}
            <span className="flex items-center gap-1 text-[12px] font-bold" style={{ color: '#f97316' }}>= {ar ? 'الإجمالي' : 'Total'} {(t.otTrueHrs ?? 0).toLocaleString()}{ar ? 'س' : 'h'}</span>
            <span className="text-[10px] mx-1" style={{ color: 'var(--text-3)' }}>·</span>
            {chip(ar ? 'قبل الشفت' : 'Before shift', t.otBeforeHrs ?? 0, '#a78bfa')}
            {chip(ar ? 'بعد الشفت' : 'After shift', t.otAfterHrs ?? 0, '#8b5cf6')}
            <span className="text-[10px] w-full" style={{ color: 'var(--text-3)' }}>
              {ar ? '★ «قبل/بعد الشفت» هو التوزيع داخل اليوم من محرّك المصالحة (قد يكون 0 لشهر لم يُعَد بناؤه بعد)؛ أوفرتايم يوم الإجازة/العطلة يُحتسب للشِفت كامل ولا يُوزّع بالساعة — لذلك أعمدة OT بالساعة قد تكون فارغة بينما الإجمالي الحقيقي هنا.' : '★ "Before/after shift" is the within-day split from the reconciliation engine (can be 0 for a month not yet rebuilt); off-day/holiday OT is whole-shift and not hour-placed — so the per-hour OT columns can be empty while the real total shows here.'}
            </span>
          </div>
          );
        })()}
        {/* Demand-driven coverage recommendation */}
        {coverage && (
          <div className="rounded-2xl p-4 glow-border-soft" style={{ background: 'var(--surface)', border: '1px solid #0ea5e9' }}>
            <div className="flex items-center gap-2 mb-1"><Activity size={16} style={{ color: '#0ea5e9' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? '✦ التغطية حسب الاحتياج — توصية' : '✦ Demand-driven coverage — recommendation'}</h3></div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? `الذروة الساعة ${hh(coverage.peakHour ?? 0)} (~${coverage.peakEff} فعلي/يوم). الساعات المفتوحة تحت 60% من الذروة = ناقصة تغطية، نوصي نقوّيها.` : `peak at ${hh(coverage.peakHour ?? 0)} (~${coverage.peakEff} effective/day). Open hours below 60% of peak = under-covered; recommend reinforcing.`}{f.function ? ` · ${f.function}` : ''}</p>
            {coverage.thin.length === 0 ? (
              <p className="text-[11px]" style={{ color: '#22c55e' }}>{ar ? 'كل الساعات المفتوحة مغطّاة جيداً (≥60% من الذروة) 🎉' : 'all open hours are well-covered (≥60% of peak) 🎉'}</p>
            ) : (
              <div className="space-y-1.5">
                {coverage.thin.map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                    <span className="font-semibold w-14" style={{ color: t.pct < 40 ? '#ef4444' : '#f59e0b' }}>{hh(t.hour)}</span>
                    <div className="flex-1 h-2.5 rounded-full overflow-hidden min-w-[80px]" style={{ background: 'var(--surface-2)' }}><div style={{ width: `${t.pct}%`, height: '100%', background: t.pct < 40 ? '#ef4444' : '#f59e0b' }} /></div>
                    <span className="w-12 text-end" style={{ color: 'var(--text-3)' }}>{t.pct}%</span>
                    <span className="w-16 text-end" style={{ color: 'var(--text-2)' }}>~{t.eff}/{ar ? 'يوم' : 'd'}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'rgba(14,165,233,0.12)', color: '#0ea5e9' }}>{ar ? 'زِد' : 'add'} {t.rec}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] mt-3" style={{ color: 'var(--text-3)' }}>{ar ? 'الاحتياج هنا من نمط التغطية الفعلي بالروستر (مؤشّر). التوليد الكامل حسب حجم التواصل يمرّ عبر موديول الكاباسيتي/التنبؤ + المولّد الموجود.' : 'Demand here is from the observed roster coverage pattern (a signal). Full volume-based generation routes through the Capacity/Forecast module + the existing generator.'}</p>
          </div>
        )}
        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ar ? 'سلسلة الهيدكاونت (متوسط يومي بالساعة): مداوم → +OT (قبل/بعد) = الهيدكاونت بعد الأوفر تايم → −إذن-تأخير/إذن-مبكر = بعد الإذن → −تارديشن/خروج-مبكر = الفعلي. الأعمدة المظلّلة هي نقاط التوقّف (كم صار الهيدكاونت بعد كل خطوة). التغطية% = الفعلي/المجدول. تارديشن/خروج-مبكر = بدون إذن · إذن-تأخير/مبكر = معتمد. الكونفورمانس متوسط لمن يغطّي الساعة. تأخير/مبكر محدود 1-240د (الأمهات مستثنيات من المبكر). عابر منتصف الليل محسوب. المصدر: roster_days.' : 'Headcount cascade (avg per day at that hour): working → +OT (before/after) = HC after overtime → −perm-late/perm-early = after permission → −tardiness/early-out = effective. The shaded columns are the checkpoints (what the headcount became after each step). Coverage% = effective/scheduled. Tardiness/Early-out = unauthorized · Perm-late/early = approved. Conformance = avg for whoever covers the hour. Late/early capped 1-240min (mothers excluded from early). Cross-midnight aware. Source: roster_days.'}</p>
      </>)}
      {!loading && !view && <p className="text-sm py-8 text-center" style={{ color: '#f43f5e' }}>{ar ? 'تعذّر التحميل' : 'Failed to load'}</p>}
    </div>
  );
}
