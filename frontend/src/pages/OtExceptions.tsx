import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, CalendarDays, Download, Sparkles, AlertTriangle, Coffee, UserX, TimerReset, CalendarClock, CheckCircle2, XCircle, CalendarOff } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile, Donut, BarRow, useCountUp } from '@/components/dazzle';
import { DateRangeBar } from '@/components/DateRangeBar';

/** tiny inline count-up number */
function CountVal({ n }: { n: number }) { return <>{useCountUp(n, 900, true).toLocaleString()}</>; }

/** OT & Exceptions — the "stories" in the roster: overtime (regular / off-day /
 *  public-holiday split, with the holiday % the HR/payroll team asks for), tardiness
 *  & early-out WITHOUT an approved permission, permissions (by type / shift / day),
 *  and absences — sliced by agent / function / hours. Source: approved schedule
 *  (roster_days). OT buckets are disjoint (regular vs off-day vs holiday).
 *  Theme-aware (Dark / Light / Aurora-Glass) via CSS vars + the dazzle kit. */
export default function OtExceptionsPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [f, setF] = useState({ from: '2026-01-01', to: '2026-06-30', function: '', teamLeader: '' });
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'agents' | 'functions' | 'permissions' | 'absence' | 'review' | 'offworked'>('agents');
  const [review, setReview] = useState<any>(null);
  const [acting, setActing] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState('otHrs'); const [dir, setDir] = useState(-1);
  const [q, setQ] = useState('');
  const h = ar ? 'س' : 'h';

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/ot-exceptions?${qs}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [f]);
  const loadReview = useCallback(() => {
    const qs = new URLSearchParams(); if (f.from) qs.set('from', f.from); if (f.to) qs.set('to', f.to);
    if (f.function) qs.set('function', f.function); if (f.teamLeader) qs.set('teamLeader', f.teamLeader);
    apiClient.get(`/attendance-recon/roster-v2/ot-review?${qs}`).then((r: any) => setReview(r.data)).catch(() => setReview(null));
  }, [f]);
  useEffect(() => { const t = setTimeout(() => { load(); loadReview(); }, 250); return () => clearTimeout(t); }, [load, loadReview]);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const actReview = (id: number, action: 'acknowledge' | 'ignore') => {
    setActing(id);
    apiClient.post(`/attendance-recon/roster-v2/ot-review/${id}/${action}`, {})
      .then(() => { loadReview(); load(); })
      .finally(() => setActing(null));
  };
  // minutes-of-day → "HH:MM" (evidence times), handles cross-midnight (>1440)
  const hm = (m: number | null | undefined) => { if (m == null) return '—'; const v = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  // person_no set with a pending before/after-OT review → badge next to the name
  const pendingSet = useMemo(() => new Set<string>((d?.otReview?.pendingPersons || []).map(String)), [d]);

  const exportXlsx = () => {
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/ot-exceptions/export?${qs}`, { responseType: 'blob' }).then((r: any) => {
      const url = URL.createObjectURL(new Blob([r.data])); const a = document.createElement('a');
      a.href = url; a.download = `OT_Exceptions_${f.from}_${f.to}.xlsx`; a.click(); URL.revokeObjectURL(url);
    });
  };

  // theme-aware inputs/cards
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs outline-none';
  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;

  const agents = useMemo(() => {
    let a = (d?.byAgent || []).slice();
    if (q.trim()) { const s = q.toLowerCase(); a = a.filter((r: any) => (r.name || '').toLowerCase().includes(s) || (r.fn || '').toLowerCase().includes(s)); }
    a.sort((x: any, y: any) => (Number(y[sortKey] ?? 0) - Number(x[sortKey] ?? 0)) * (dir < 0 ? 1 : -1));
    return a;
  }, [d, q, sortKey, dir]);
  const sortBy = (k: string) => { if (k === sortKey) setDir(-dir); else { setSortKey(k); setDir(-1); } };
  const arrow = (k: string) => sortKey === k ? (dir < 0 ? ' ↓' : ' ↑') : '';

  const O = d?.ot;
  const tabBtn = (k: any, label: string) => (
    <button onClick={() => setTab(k)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
      style={tab === k ? { background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#fff', boxShadow: '0 4px 14px rgba(239,68,68,0.35)' } : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>{label}</button>
  );
  const miniList = (title: string, rows: any[], color: string, fmt?: (r: any) => string) => {
    const mx = Math.max(...rows.map((r: any) => r.n), 1);
    return (
      <div className="rounded-2xl p-4" style={panel}>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{title}</h3>
        {rows.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'لا يوجد' : 'None'}</p>}
        <div className="space-y-2">
          {rows.map((r: any, i: number) => (
            <BarRow key={i} label={fmt ? fmt(r) : r.k} value={r.n} max={mx} color={color} delay={i * 40} />
          ))}
        </div>
      </div>
    );
  };

  // table helpers (theme-aware)
  const Th = ({ k, label, al = 'center', sortable = false }: any) => (
    <th onClick={sortable ? () => sortBy(k) : undefined}
      className={`px-2 py-2 font-semibold whitespace-nowrap ${al === 'start' ? 'text-start' : 'text-center'} ${sortable ? 'cursor-pointer' : ''}`}
      style={{ color: 'var(--text-3)', fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase' }}>
      {label}{sortable ? arrow(k) : ''}
    </th>
  );

  return (
    <div className="space-y-4 page-enter">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => nav('/roster')} className="p-2 rounded-xl transition-colors" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}><ArrowLeft size={16} style={{ color: 'var(--text-1)' }} /></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', boxShadow: '0 6px 18px rgba(239,68,68,0.35)' }}><Clock size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الأوفر تايم والاستثناءات' : 'OT & Exceptions'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'أوفر تايم (عادي/يوم OFF/عطلة رسمية + النسبة)، تأخير وخروج مبكر بدون استئذان، الاستئذانات، الغيابات — بالاسم/الفنكشن/الساعات' : 'overtime (regular / off-day / public-holiday + %), late & early-out without permission, permissions, absences — by name / function / hours'}</p>
        </div>
        <DateRangeBar from={f.from} to={f.to} onChange={(a, b) => setF(x => ({ ...x, from: a, to: b }))} />
        <select value={f.function} onChange={e => set('function', e.target.value)} className={inputCls} style={inputStyle}><option value="">{ar ? 'كل الفنكشن' : 'All functions'}</option>{(d?.filterOptions?.functions || []).map((x: string) => <option key={x} value={x}>{x}</option>)}</select>
        <select value={f.teamLeader} onChange={e => set('teamLeader', e.target.value)} className={inputCls} style={inputStyle}><option value="">{ar ? 'كل التيم ليدرز' : 'All TLs'}</option>{(d?.filterOptions?.teamLeaders || []).map((x: string) => <option key={x} value={x}>{x}</option>)}</select>
        <button onClick={exportXlsx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}><Download size={13} />{ar ? 'إكسل' : 'Excel'}</button>
      </div>

      {/* pending-review chip (Director decision 2) */}
      {(d?.otReview?.pending > 0 || d?.offWorked?.days > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {d?.otReview?.pending > 0 && (
            <button onClick={() => setTab('review')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b' }}>
              <AlertTriangle size={13} />{d.otReview.pending} {ar ? 'مراجعة أوفر تايم معلّقة (قبل/بعد الشفت)' : 'pending OT reviews (before/after shift)'}
            </button>
          )}
          {d?.offWorked?.days > 0 && (
            <button onClick={() => setTab('offworked')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.4)', color: '#a855f7' }}>
              <CalendarOff size={13} />{d.offWorked.days} {ar ? 'يوم OFF اشتغل فيه — مراجعة HR' : 'OFF-day worked — HR review'}
            </button>
          )}
        </div>
      )}

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ التحليل…' : 'Analyzing…'}</p>}
      {!loading && O && (<>
        {/* KPI tiles — count-up */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
          <StatTile icon={Clock}        label={ar ? 'إجمالي OT' : 'Total OT'}        num={O.totalHrs}   suffix={h} sub={`${O.days.toLocaleString()} ${ar ? 'يوم' : 'days'} · ${O.agents} ${ar ? 'موظف' : 'agents'}`} color="#f59e0b" delay={0} />
          <StatTile icon={Sparkles}     label={ar ? 'OT عطلة رسمية' : 'Holiday OT'}   num={O.holidayPct} suffix="%" sub={`${O.holidayHrs}${h} ${ar ? 'من الإجمالي' : 'of total'}`} color="#ef4444" delay={60} />
          <StatTile icon={TimerReset}   label={ar ? 'OT يوم OFF' : 'Off-day OT'}      num={O.offdayHrs}  suffix={h} sub={ar ? 'بأيام الراحة' : 'on rest days'} color="#a78bfa" delay={120} />
          <StatTile icon={Clock}        label={ar ? 'OT عادي' : 'Regular OT'}         num={O.regularHrs} suffix={h} sub={`${ar ? 'قبل' : 'before'} ${O.beforeShiftHrs} · ${ar ? 'بعد' : 'after'} ${O.afterShiftHrs}`} color="#22d3ee" delay={180} />
          <StatTile icon={AlertTriangle} label={ar ? 'تأخير بدون إذن' : 'Late (no perm)'} num={d.tardiness.lateDays} sub={`${d.tardiness.lateHrs}${h} · ${d.tardiness.lateExcused} ${ar ? 'بإذن' : 'excused'}`} color="#fb923c" delay={240} />
          <StatTile icon={CalendarClock} label={ar ? 'خروج مبكر بدون إذن' : 'Early (no perm)'} num={d.tardiness.earlyDays} sub={`${d.tardiness.earlyHrs}${h} · ${d.tardiness.earlyExcused} ${ar ? 'بإذن' : 'excused'}`} color="#f43f5e" delay={300} />
          <StatTile icon={Coffee}       label={ar ? 'استئذانات' : 'Permissions'}      num={d.permissions.count} sub={`${d.permissions.hrs.toLocaleString()}${h} · ${ar ? 'متوسط' : 'avg'} ${d.permissions.avgHrs}${h}`} color="#22c55e" delay={360} />
        </div>

        <div className="grid lg:grid-cols-3 gap-3">
          {/* OT split donut */}
          <div className="rounded-2xl p-4 glow-border-soft" style={panel}>
            <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>{ar ? 'توزيع الأوفر تايم' : 'Overtime split'}</h3>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'دلوهات منفصلة: عادي بيوم العمل، بيوم الراحة، بالعطلة الرسمية' : 'disjoint buckets: regular workday, off-day, public-holiday'}</p>
            <Donut
              centerNum={O.totalHrs} centerSuffix={h} centerLabel={ar ? 'إجمالي' : 'total'}
              segments={[
                { label: ar ? 'عادي' : 'Regular', value: O.regularHrs, color: '#22d3ee' },
                { label: ar ? 'يوم OFF' : 'Off-day', value: O.offdayHrs, color: '#a78bfa' },
                { label: ar ? 'عطلة رسمية' : 'Holiday', value: O.holidayHrs, color: '#ef4444' },
              ]}
            />
            <div className="mt-3 pt-2.5 flex justify-between text-[11px]" style={{ borderTop: '1px solid var(--border)' }}><span style={{ color: 'var(--text-2)' }}>{ar ? 'OT غير العطلة' : 'Non-holiday OT'}</span><span className="font-semibold" style={{ color: '#22d3ee' }}>{O.nonHolidayHrs.toLocaleString()}{h} ({O.nonHolidayPct}%)</span></div>
          </div>
          {/* permissions by type + shift */}
          {miniList(ar ? 'الاستئذانات حسب النوع' : 'Permissions by type', d.permissions.byType, '#22c55e')}
          {miniList(ar ? 'أكثر شفت فيه استئذانات' : 'Most permissions by shift', d.permissions.byShift, '#0ea5e9')}
        </div>

        {/* tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {tabBtn('agents', ar ? 'بالموظف' : 'By agent')}
          {tabBtn('functions', ar ? 'بالفنكشن' : 'By function')}
          {tabBtn('permissions', ar ? 'أيام الاستئذانات' : 'Permission days')}
          {tabBtn('absence', ar ? 'الغيابات' : 'Absences')}
          {tabBtn('review', `${ar ? 'مراجعة OT' : 'OT review'}${d?.otReview?.pending ? ' (' + d.otReview.pending + ')' : ''}`)}
          {tabBtn('offworked', `${ar ? 'OFF اشتغل' : 'OFF worked'}${d?.offWorked?.days ? ' (' + d.offWorked.days + ')' : ''}`)}
          {tab === 'agents' && <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث بالاسم/الفنكشن…' : 'search name/function…'} className={`${inputCls} ml-auto w-48`} style={inputStyle} />}
        </div>

        {tab === 'agents' && (
          <div className="rounded-2xl overflow-auto" style={panel}>
            <table className="w-full text-[11px]">
              <thead style={{ background: 'var(--surface-2)' }}><tr>
                {[['name', ar ? 'الموظف' : 'Employee', 'start'], ['fn', ar ? 'الفنكشن' : 'Function', 'start'], ['otHrs', ar ? 'OT (س)' : 'OT (h)'], ['offOtHrs', ar ? 'OT OFF' : 'Off-day'], ['holOtHrs', ar ? 'OT عطلة' : 'Holiday'], ['otDays', ar ? 'أيام OT' : 'OT days'], ['otPctOfWork', ar ? '% من العمل' : '% of work'], ['lateDays', ar ? 'تأخير' : 'Late'], ['earlyDays', ar ? 'مبكر' : 'Early'], ['absentDays', ar ? 'غياب' : 'Absent'], ['perms', ar ? 'إذن' : 'Perm']].map(([k, label, al]: any) => (
                  <Th key={k} k={k} label={label} al={al} sortable />
                ))}
              </tr></thead>
              <tbody>{agents.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors" style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-1)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      {pendingSet.has(String(r.person_no)) && (
                        <button onClick={() => setTab('review')} title={ar ? 'مراجعة أوفر تايم قبل/بعد الشفت معلّقة' : 'pending before/after-shift OT review'}>
                          <AlertTriangle size={12} style={{ color: '#f59e0b' }} />
                        </button>
                      )}
                      {r.name || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{r.fn || '—'}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: '#f59e0b' }}>{r.otHrs.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.offOtHrs > 0 ? '#a78bfa' : 'var(--text-3)' }}>{r.offOtHrs || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.holOtHrs > 0 ? '#f87171' : 'var(--text-3)' }}>{r.holOtHrs || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{r.otDays}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{r.otPctOfWork}%</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.lateDays > 0 ? '#fb923c' : 'var(--text-3)' }}>{r.lateDays || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.earlyDays > 0 ? '#f43f5e' : 'var(--text-3)' }}>{r.earlyDays || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.absentDays > 0 ? '#ef4444' : 'var(--text-3)' }}>{r.absentDays || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.perms > 0 ? '#34d399' : 'var(--text-3)' }}>{r.perms || ''}</td>
                </tr>
              ))}</tbody>
            </table>
            {agents.length === 0 && <p className="text-[11px] p-4 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'لا نتائج' : 'No results'}</p>}
          </div>
        )}

        {tab === 'functions' && (
          <div className="rounded-2xl overflow-auto" style={panel}>
            <table className="w-full text-[11px]">
              <thead style={{ background: 'var(--surface-2)' }}><tr>
                {[ar ? 'الفنكشن' : 'Function', ar ? 'موظفون' : 'People', ar ? 'OT (س)' : 'OT (h)', ar ? 'OT يوم OFF' : 'Off-day OT', ar ? 'OT عطلة' : 'Holiday OT', ar ? 'أيام OT' : 'OT days', ar ? 'تأخير' : 'Late', ar ? 'مبكر' : 'Early', ar ? 'غياب' : 'Absent', ar ? 'إذن' : 'Perm'].map((label, i) => <Th key={i} label={label} al={i === 0 ? 'start' : 'center'} />)}
              </tr></thead>
              <tbody>{(d.byFunction || []).map((r: any, i: number) => (
                <tr key={i} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors" style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{r.fn || '—'}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{r.people}</td>
                  <td className="px-2 py-1.5 text-center font-semibold" style={{ color: '#f59e0b' }}>{r.otHrs.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.offOtHrs > 0 ? '#a78bfa' : 'var(--text-3)' }}>{r.offOtHrs || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.holOtHrs > 0 ? '#f87171' : 'var(--text-3)' }}>{r.holOtHrs || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{r.otDays}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.lateDays > 0 ? '#fb923c' : 'var(--text-3)' }}>{r.lateDays || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.earlyDays > 0 ? '#f43f5e' : 'var(--text-3)' }}>{r.earlyDays || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.absentDays > 0 ? '#ef4444' : 'var(--text-3)' }}>{r.absentDays || ''}</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: r.perms > 0 ? '#34d399' : 'var(--text-3)' }}>{r.perms || ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {tab === 'permissions' && (
          <div className="grid lg:grid-cols-2 gap-3">
            {miniList(ar ? 'أكثر أيام فيها استئذانات' : 'Top days by permissions', d.permissions.byDate, '#22c55e')}
            {miniList(ar ? 'الاستئذانات حسب النوع' : 'Permissions by type', d.permissions.byType, '#10b981')}
          </div>
        )}

        {tab === 'absence' && (
          <div className="grid lg:grid-cols-2 gap-3">
            {miniList(ar ? 'أكثر أيام فيها غيابات' : 'Top days by absence', d.absence.byDate, '#ef4444')}
            <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(239,68,68,0.12)' }}><UserX size={26} className="text-red-400" /></div>
              <div><p className="text-2xl font-bold leading-none" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}><CountVal n={d.absence.days} /></p><p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>{ar ? 'إجمالي أيام الغياب بالفترة' : 'total absence days in period'}</p></div>
            </div>
          </div>
        )}

        {tab === 'review' && (
          <div className="rounded-2xl overflow-hidden" style={panel}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'مراجعة أوفر تايم قبل/بعد الشفت' : 'Before/after-shift OT review'}</h3>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{ar ? 'فترة محجوزة/غير مؤكدة — اعتمد (يُحسب أوفر تايم) أو تجاهل (فتح بدري فقط). لا يُدفع حتى تُعتمد.' : 'reserved / uncertain period — Acknowledge (counts as OT) or Ignore (just opened early). Not paid until acknowledged.'}</p>
              {review?.counts && <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>{ar ? 'معلّق' : 'Pending'}: <b style={{ color: '#f59e0b' }}>{review.counts.pending}</b> · {ar ? 'معتمد' : 'Acknowledged'}: <b style={{ color: '#22c55e' }}>{review.counts.acknowledged}</b> · {ar ? 'متجاهَل' : 'Ignored'}: <b style={{ color: 'var(--text-3)' }}>{review.counts.ignored}</b></p>}
            </div>
            <div className="overflow-auto">
              <table className="w-full text-[11px]">
                <thead style={{ background: 'var(--surface-2)' }}><tr>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'الفنكشن' : 'Function', ar ? 'التاريخ' : 'Date', ar ? 'النوع' : 'Type', ar ? 'الدقائق' : 'Minutes', ar ? 'الشفت' : 'Shift', ar ? 'دخول/خروج النظام' : 'System in/out', ar ? 'الحالة' : 'Status', ''].map((l, i) => <Th key={i} label={l} al={i === 0 ? 'start' : 'center'} />)}
                </tr></thead>
                <tbody>{(review?.items || []).map((r: any) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{r.name || r.personNo}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-center" style={{ color: 'var(--text-2)' }}>{r.fn || '—'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{r.date}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: r.kind === 'before' ? '#22d3ee' : '#a78bfa' }}>{r.kind === 'before' ? (ar ? 'قبل' : 'before') : (ar ? 'بعد' : 'after')}</td>
                    <td className="px-2 py-1.5 text-center font-semibold" style={{ color: '#f59e0b' }}>{r.minutes}m</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{r.shiftCode || '—'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{hm(r.sysLogin)} → {hm(r.sysLogout)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={r.status === 'pending' ? { background: 'rgba(245,158,11,0.14)', color: '#f59e0b' } : r.status === 'acknowledged' ? { background: 'rgba(34,197,94,0.14)', color: '#22c55e' } : { background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                        {r.status === 'pending' ? (ar ? 'معلّق' : 'pending') : r.status === 'acknowledged' ? (ar ? 'معتمد' : 'acknowledged') : (ar ? 'متجاهَل' : 'ignored')}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      {r.status === 'pending' ? (
                        <span className="inline-flex gap-1.5">
                          <button disabled={acting === r.id} onClick={() => actReview(r.id, 'acknowledge')} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}><CheckCircle2 size={12} />{ar ? 'اعتماد' : 'Acknowledge'}</button>
                          <button disabled={acting === r.id} onClick={() => actReview(r.id, 'ignore')} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-50" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}><XCircle size={12} />{ar ? 'تجاهل' : 'Ignore'}</button>
                        </span>
                      ) : <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{r.reviewedBy || ''}</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              {(!review || (review.items || []).length === 0) && <p className="text-[11px] p-4 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'لا يوجد مراجعات' : 'No reviews'}</p>}
            </div>
          </div>
        )}

        {tab === 'offworked' && (
          <div className="rounded-2xl overflow-hidden" style={panel}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'يوم OFF اشتغل فيه — مراجعة HR' : 'OFF-day worked — HR review'}</h3>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{ar ? 'ضل يوم OFF؛ الساعات ظاهرة للـHR للتوضيح ولا تُدفع أوفر تايم تلقائياً حتى المراجعة.' : 'stays an OFF day; hours are surfaced to HR for clarification and are NOT auto-paid as off-day OT until reviewed.'}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>{d.offWorked.days} {ar ? 'يوم' : 'days'} · {d.offWorked.hrs}{h} · {d.offWorked.agents} {ar ? 'موظف' : 'agents'}</p>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-[11px]">
                <thead style={{ background: 'var(--surface-2)' }}><tr>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'الفنكشن' : 'Function', ar ? 'التاريخ' : 'Date', ar ? 'الكود' : 'Code', ar ? 'ساعات (غير مدفوعة)' : 'Hrs (not paid)', ar ? 'دخول/خروج النظام' : 'System in/out'].map((l, i) => <Th key={i} label={l} al={i === 0 ? 'start' : 'center'} />)}
                </tr></thead>
                <tbody>{(d.offWorked.rows || []).map((r: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{r.name || r.person_no}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{r.fn || '—'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{r.date}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{r.shiftCode || 'OFF'}</td>
                    <td className="px-2 py-1.5 text-center font-semibold" style={{ color: '#a855f7' }}>{r.hrs}{h}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{hm(r.sysLogin)} → {hm(r.sysLogout)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {(d.offWorked.rows || []).length === 0 && <p className="text-[11px] p-4 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'لا يوجد' : 'None'}</p>}
            </div>
          </div>
        )}

        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ar ? `الأوفر تايم دلوهات منفصلة (لا تتداخل): عادي بيوم العمل + يوم الراحة (OFF) + العطلة الرسمية = الإجمالي. التأخير/الخروج المبكر بدون إذن فقط (المعتمد بإذن مستثنى)، ومحدود بسقف ٤ ساعات — ${d.tardiness.excludedDq.toLocaleString()} يوم تجاوز السقف (بليد شفتات منتصف الليل) استُبعد كـ"جودة بيانات" حتى ما نظلم أحد. المصدر: الجدول المعتمد (roster_days).` : `OT is split into disjoint buckets (no overlap): regular workday + off-day + public-holiday = total. Late / early-out EXCLUDE days covered by an approved permission and are capped at 4h — ${d.tardiness.excludedDq.toLocaleString()} day(s) above the cap (cross-midnight shift bleed) are set aside as "data quality" so no one is wrongly flagged. Source: approved schedule (roster_days).`}</p>
      </>)}
    </div>
  );
}
