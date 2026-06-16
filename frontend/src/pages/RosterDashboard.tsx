import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Users, Clock, LogOut, UserX, Activity, ShieldCheck, AlertTriangle, TrendingUp, CalendarDays, Loader2, ArrowLeft, Search, Award, Gift, LayoutGrid, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

const WD_AR: Record<string, string> = { Sat: 'السبت', Sun: 'الأحد', Mon: 'الإثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة' };
const fmt = (n: number) => (n ?? 0).toLocaleString();

export default function RosterDashboardPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState('2026-06-30');
  const [func, setFunc] = useState('');
  const [support, setSupport] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (from) p.set('from', from); if (to) p.set('to', to); if (func) p.set('func', func); if (support) p.set('support', '1');
    apiClient.get(`/attendance-recon/dashboard?${p}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [from, to, func, support]);
  useEffect(() => { load(); }, [load]);

  const card: React.CSSProperties = { background: dark ? '#0f1527' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, borderRadius: 16 };
  const txt = dark ? '#fff' : '#0f172a';
  const sub = '#94a3b8';
  const line = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

  const Metric = ({ icon: Icon, label, value, color, hint }: any) => (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: color + '1a' }}><Icon size={16} style={{ color }} /></div>
        <div className="min-w-0"><p className="text-[10px]" style={{ color: sub }}>{label}</p><p className="text-xl font-bold truncate" style={{ color: txt }}>{value}</p></div>
      </div>
      {hint && <p className="text-[10px] mt-1.5" style={{ color: sub }}>{hint}</p>}
    </div>
  );
  const Bar = ({ label, value, max, color, suffix }: any) => (
    <div className="flex items-center gap-2 mb-1.5">
      <div className="text-[11px] w-28 shrink-0 truncate text-right" style={{ color: sub }} title={label}>{label}</div>
      <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
        <div className="h-full rounded-md flex items-center justify-end px-1.5" style={{ width: `${max > 0 ? Math.max(4, (value / max) * 100) : 0}%`, background: color, transition: 'width .5s' }}>
          <span className="text-[10px] font-bold text-white">{fmt(value)}{suffix || ''}</span>
        </div>
      </div>
    </div>
  );
  const Panel = ({ title, icon: Icon, color, children, note, right }: any) => (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2"><Icon size={16} style={{ color }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{title}</h3></div>
        {right}
      </div>
      {note && <p className="text-[10px] mb-2" style={{ color: sub }}>{note}</p>}
      {children}
    </div>
  );

  const funcs = d?.byFunction?.map((f: any) => f.func) || [];

  return (
    <div className="page-enter space-y-4">
      {/* header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/roster')} className="w-9 h-9 rounded-lg flex items-center justify-center" style={card} title={ar ? 'رجوع للروستر' : 'Back to roster'}><ArrowLeft size={16} style={{ color: txt }} /></button>
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)' }}><BarChart3 size={22} className="text-white" /></div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: txt }}>{ar ? 'لوحة تحليل الروستر' : 'Roster Analytics Dashboard'}</h1>
            <p className="text-xs" style={{ color: sub }}>{ar ? 'تقييم أداء · التزام · أوفر تايم · هيدكاونت نصف ساعة — كله من نفس بيانات الروستر' : 'Performance · commitment · overtime · half-hour headcount — all from the same roster data'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2.5 py-2 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <span style={{ color: sub }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2.5 py-2 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <select value={func} onChange={e => setFunc(e.target.value)} className="px-3 py-2 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: txt }}>
            <option value="" style={{ background: '#0f1527' }}>{ar ? 'كل الفنكشن' : 'All functions'}</option>
            {funcs.map((f: string) => <option key={f} value={f} style={{ background: '#0f1527' }}>{f}</option>)}
          </select>
          <button onClick={() => setSupport(s => !s)} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ ...card, color: support ? '#a855f7' : sub, borderColor: support ? '#a855f7' : undefined }} title={ar ? 'تضمين أدوار الدعم/الإدارة (RTA, Team Leader, Customer Care, Support, Specialist)' : 'Include support/management roles'}>
            {support ? '✓ ' : ''}{ar ? 'أدوار الدعم' : 'Support roles'}
          </button>
        </div>
      </div>

      {/* EMPLOYEE EVALUATION (search + drill) — top, it's what the manager needs */}
      <EmployeeEval ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />

      {loading && <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin" style={{ color: '#6366f1' }} /></div>}

      {!loading && d && (() => {
        const k = d.kpis;
        const maxShiftAbs = Math.max(1, ...d.byShift.map((s: any) => s.absences));
        const maxShiftLate = Math.max(1, ...d.byShift.map((s: any) => s.lateDays));
        const maxAbsWd = Math.max(1, ...d.absencesByWeekday.map((w: any) => w.count));
        const maxLateWd = Math.max(1, ...d.lateByWeekday.map((w: any) => w.count));
        return (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <Metric icon={Users} label={ar ? 'الموظفين' : 'Employees'} value={fmt(k.employees)} color="#6366f1" hint={`${fmt(k.workedDays)} ${ar ? 'يوم عمل' : 'worked days'}`} />
            <Metric icon={ShieldCheck} label={ar ? 'متوسط التوافق' : 'Avg conformance'} value={`${k.avgConformance}%`} color={k.avgConformance >= 85 ? '#22c55e' : k.avgConformance >= 70 ? '#f59e0b' : '#ef4444'} />
            <Metric icon={Clock} label={ar ? 'تأخير (بدون إذن)' : 'Late (no perm)'} value={fmt(k.lateDays)} color="#f97316" hint={`${ar ? 'بإذن' : 'excused'} ${fmt(k.lateExcusedDays)} · ${fmt(k.deductionDays)} ${ar ? 'خصم' : 'deduct'}`} />
            <Metric icon={LogOut} label={ar ? 'خروج مبكر (بدون إذن)' : 'Early (no perm)'} value={fmt(k.earlyDays)} color="#eab308" hint={`${ar ? 'بإذن' : 'excused'} ${fmt(k.earlyExcusedDays)}`} />
            <Metric icon={UserX} label={ar ? 'الغياب' : 'Absences'} value={fmt(k.absences)} color="#ef4444" hint={`${fmt(k.sickDays)} ${ar ? 'مرضي' : 'sick'}`} />
            <Metric icon={Activity} label={ar ? 'أوفر تايم' : 'Overtime'} value={`${fmt(k.otHours)}${ar ? 'س' : 'h'}`} color="#06b6d4" hint={`${ar ? 'قبل' : 'before'} ${fmt(k.otBeforeHours)} · ${ar ? 'بعد' : 'after'} ${fmt(k.otAfterHours)}`} />
          </div>

          {/* permissions */}
          <div style={{ ...card, padding: 16 }}>
            <div className="flex items-center gap-2 mb-3"><CalendarDays size={16} style={{ color: '#a855f7' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? 'الاستئذانات' : 'Permissions'}</h3></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
              {[[ar ? 'إجمالي' : 'Total', k.permissions.total, '#a855f7'], [ar ? 'معتمد' : 'Approved', k.permissions.approved, '#22c55e'], [ar ? 'مرفوض' : 'Refused', k.permissions.refused, '#ef4444'], [ar ? 'معلّق' : 'Pending', k.permissions.pending, '#f59e0b']].map(([l, v, c]: any) => (
                <div key={l} className="rounded-lg px-3 py-2" style={{ background: c + '14' }}><p className="text-[10px]" style={{ color: sub }}>{l}</p><p className="text-lg font-bold" style={{ color: c }}>{fmt(v)}</p></div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">{d.permissionsByType.map((p: any) => <span key={p.type} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: '#a855f714', color: '#a855f7' }}>{p.type}: {fmt(p.count)}</span>)}</div>
          </div>

          {/* HALF-HOURLY HEADCOUNT */}
          <HeadcountSection ar={ar} dark={dark} card={card} txt={txt} sub={sub} funcs={funcs} defaultDate={to} />

          {/* 5h+ OT BONUS */}
          <OtBonus ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} />

          {/* shift absences + late */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title={ar ? 'الغياب حسب الوردية' : 'Absences by shift'} icon={UserX} color="#ef4444" note={ar ? 'أي وردية فيها غيابات أكثر' : 'Which shift has the most absences'}>
              {d.byShift.filter((s: any) => s.absences > 0).slice(0, 10).map((s: any) => <Bar key={s.code} label={s.code} value={s.absences} max={maxShiftAbs} color="#ef4444" />)}
            </Panel>
            <Panel title={ar ? 'التأخير حسب الوردية' : 'Late days by shift'} icon={Clock} color="#f97316" note={ar ? 'أي وردية فيها تأخير أكثر' : 'Which shift has the most lateness'}>
              {d.byShift.filter((s: any) => s.lateDays > 0).slice(0, 10).map((s: any) => <Bar key={s.code} label={s.code} value={s.lateDays} max={maxShiftLate} color="#f97316" />)}
            </Panel>
          </div>

          {/* weekday */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title={ar ? 'الغياب حسب اليوم' : 'Absences by weekday'} icon={CalendarDays} color="#ef4444" note={ar ? 'الأسبوع يبدأ السبت' : 'Week starts Saturday'}>
              {d.absencesByWeekday.map((w: any) => <Bar key={w.day} label={ar ? WD_AR[w.day] : w.day} value={w.count} max={maxAbsWd} color="#ef4444" />)}
            </Panel>
            <Panel title={ar ? 'التأخير حسب اليوم' : 'Late by weekday'} icon={CalendarDays} color="#f97316">
              {d.lateByWeekday.map((w: any) => <Bar key={w.day} label={ar ? WD_AR[w.day] : w.day} value={w.count} max={maxLateWd} color="#f97316" />)}
            </Panel>
          </div>

          {/* by function table */}
          <Panel title={ar ? 'التفصيل حسب الفنكشن' : 'Breakdown by function'} icon={Users} color="#6366f1">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ color: txt }}>
                <thead><tr style={{ color: sub }} className="text-[10px] uppercase">
                  {[ar ? 'الفنكشن' : 'Function', ar ? 'موظفين' : 'Emp', ar ? 'أيام' : 'Days', ar ? 'تأخير' : 'Late', ar ? 'خروج' : 'Early', ar ? 'غياب' : 'Absent', ar ? 'مرضي' : 'Sick', 'OT(h)', ar ? 'توافق' : 'Conf'].map((h, i) => <th key={h} className={`py-2 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.byFunction.map((f: any) => (
                    <tr key={f.func} style={{ borderTop: `1px solid ${line}` }}>
                      <td className="py-2 font-semibold text-start">{f.func}</td>
                      <td className="text-center">{fmt(f.employees)}</td>
                      <td className="text-center">{fmt(f.days)}</td>
                      <td className="text-center" style={{ color: f.lateDays ? '#f97316' : sub }}>{fmt(f.lateDays)}</td>
                      <td className="text-center" style={{ color: f.earlyDays ? '#eab308' : sub }}>{fmt(f.earlyDays)}</td>
                      <td className="text-center" style={{ color: f.absences ? '#ef4444' : sub }}>{fmt(f.absences)}</td>
                      <td className="text-center" style={{ color: sub }}>{fmt(f.sickDays)}</td>
                      <td className="text-center" style={{ color: '#06b6d4' }}>{fmt(f.otHours)}</td>
                      <td className="text-center"><Cbadge v={f.avgConformance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* top employees */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            <Panel title={ar ? 'الأكثر تأخيراً' : 'Most late'} icon={Clock} color="#f97316"><TopList rows={d.topLate} valueKey="lateHours" suffix={ar ? ' س' : 'h'} sub={(e: any) => `${e.lateDays} ${ar ? 'يوم' : 'd'}`} color="#f97316" dark={dark} txt={txt} subc={sub} /></Panel>
            <Panel title={ar ? 'الأكثر خروج مبكر' : 'Most early-out'} icon={LogOut} color="#eab308"><TopList rows={d.topEarly} valueKey="earlyMin" suffix="m" sub={(e: any) => `${e.earlyDays} ${ar ? 'يوم' : 'd'}`} color="#eab308" dark={dark} txt={txt} subc={sub} /></Panel>
            <Panel title={ar ? 'الأكثر غياباً' : 'Most absent'} icon={UserX} color="#ef4444"><TopList rows={d.topAbsent} valueKey="absences" suffix="" sub={(e: any) => `${e.worked} ${ar ? 'دوام' : 'wk'}`} color="#ef4444" dark={dark} txt={txt} subc={sub} /></Panel>
            <Panel title={ar ? 'الأكثر أوفر تايم' : 'Most overtime'} icon={Activity} color="#06b6d4"><TopList rows={d.topOt} valueKey="otHours" suffix={ar ? ' س' : 'h'} sub={() => ''} color="#06b6d4" dark={dark} txt={txt} subc={sub} /></Panel>
          </div>

          {/* trend */}
          <Panel title={ar ? 'الاتجاه الشهري' : 'Monthly trend'} icon={TrendingUp} color="#22c55e">
            <div className="overflow-x-auto"><table className="w-full text-xs" style={{ color: txt }}>
              <thead><tr style={{ color: sub }} className="text-[10px] uppercase">{[ar ? 'الشهر' : 'Month', ar ? 'أيام عمل' : 'Worked', ar ? 'غياب' : 'Absent', ar ? 'تأخير(س)' : 'Late(h)', 'OT(h)', ar ? 'توافق' : 'Conf'].map((h, i) => <th key={h} className={`py-2 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
              <tbody>{d.trend.map((t: any) => (
                <tr key={t.month} style={{ borderTop: `1px solid ${line}` }}>
                  <td className="py-2 font-semibold text-start">{t.month}</td>
                  <td className="text-center">{fmt(t.workedDays)}</td>
                  <td className="text-center" style={{ color: t.absences ? '#ef4444' : sub }}>{fmt(t.absences)}</td>
                  <td className="text-center" style={{ color: '#f97316' }}>{fmt(t.lateHours)}</td>
                  <td className="text-center" style={{ color: '#06b6d4' }}>{fmt(t.otHours)}</td>
                  <td className="text-center"><Cbadge v={t.avgConformance} /></td>
                </tr>
              ))}</tbody>
            </table></div>
            {d.trend.some((t: any) => t.avgConformance < 65) && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg" style={{ background: '#f59e0b14' }}>
                <AlertTriangle size={14} style={{ color: '#f59e0b' }} className="mt-0.5 shrink-0" />
                <p className="text-[11px]" style={{ color: dark ? '#fde68a' : '#92400e' }}>{ar ? 'انخفاض حاد بالتوافق غالباً = نقص بيانات السيستم لذاك الشهر (مثلاً Sprinklr غير مرفوع) — ارفع البيانات الناقصة ليتصحّح.' : 'A sharp conformance drop usually means missing system data that month (e.g. Sprinklr not uploaded) — upload it to correct.'}</p>
              </div>
            )}
          </Panel>
        </>
        );
      })()}
    </div>
  );

  function Cbadge({ v }: { v: number }) {
    const c = v >= 85 ? '#22c55e' : v >= 70 ? '#f59e0b' : '#ef4444';
    return <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: c + '22', color: c }}>{v}%</span>;
  }
}

/* ───────── Employee evaluation (search / by-function + drill) ───────── */
function EmployeeEval({ ar, dark, card, txt, sub, line, from, to, funcs }: any) {
  const [q, setQ] = useState('');
  const [fn, setFn] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const ratingColor = (r: string) => r === 'Good' ? '#22c55e' : r === 'Average' ? '#f59e0b' : '#ef4444';
  const ratingAr = (r: string) => r === 'Good' ? 'جيد' : r === 'Average' ? 'متوسط' : 'ضعيف';
  const run = async (qq: string, ff: string) => {
    if (!qq.trim() && !ff) return; setBusy(true);
    try {
      const p = new URLSearchParams({ from, to }); if (qq.trim()) p.set('q', qq.trim()); if (ff) p.set('func', ff);
      const r: any = await apiClient.get(`/attendance-recon/employee?${p}`); setRes(r.data);
    } catch { setRes({ matched: 0, employees: [] }); } finally { setBusy(false); }
  };
  const drill = (id: string) => { setQ(id); setFn(''); run(id, ''); };
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center gap-2 mb-3"><Award size={16} style={{ color: '#6366f1' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? 'تقييم الموظفين (للقرار: يضل / يمشي)' : 'Employee evaluation (keep / let-go)'}</h3></div>
      <p className="text-[11px] mb-2" style={{ color: sub }}>{ar ? `ابحث بالاسم/الرقم/الإيميل، أو اختر فنكشن لتقييم الكل دفعة — للفترة ${from} → ${to}` : `Search by name/ID/email, or pick a function to rate everyone at once — over ${from} → ${to}`}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[220px]" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${line}` }}>
          <Search size={14} style={{ color: sub }} />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run(q, '')} placeholder={ar ? 'مثال: 13439 أو Ali أو a.hamed@…' : 'e.g. 13439 / Ali / a.hamed@…'} className="bg-transparent text-sm outline-none flex-1" style={{ color: txt }} />
        </div>
        <span className="text-[11px]" style={{ color: sub }}>{ar ? 'أو' : 'or'}</span>
        <select value={fn} onChange={e => { setFn(e.target.value); setQ(''); if (e.target.value) run('', e.target.value); }} className="px-3 py-2 rounded-lg text-xs outline-none cursor-pointer min-w-[150px]" style={{ ...card, color: txt }}>
          <option value="" style={{ background: '#0f1527' }}>{ar ? 'فنكشن…' : 'Function…'}</option>
          {(funcs || []).map((f: string) => <option key={f} value={f} style={{ background: '#0f1527' }}>{f}</option>)}
        </select>
        <button onClick={() => run(q, fn)} disabled={busy} className="px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>{busy ? <Loader2 size={14} className="animate-spin" /> : (ar ? 'تقييم' : 'Evaluate')}</button>
      </div>
      {res && res.matched === 0 && <p className="text-xs mt-3" style={{ color: sub }}>{ar ? 'لا يوجد موظف مطابق في هذه الفترة.' : 'No matching employee in this range.'}</p>}
      {/* LIST MODE: ranked table for a whole function */}
      {res?.mode === 'list' && (
        <div className="overflow-x-auto mt-3 max-h-[28rem] overflow-y-auto">
          <p className="text-[11px] mb-2" style={{ color: sub }}>{ar ? `${res.matched} موظف — مرتّبين بالأداء (اضغط على اسم للتفاصيل)` : `${res.matched} employees — ranked by score (click a name for detail)`}</p>
          <table className="w-full text-xs" style={{ color: txt }}>
            <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[10px] uppercase">{[ar ? 'الموظف' : 'Employee', ar ? 'تقييم' : 'Rating', ar ? 'سكور' : 'Score', ar ? 'توافق' : 'Conf', ar ? 'غياب' : 'Absent', ar ? 'تأخير' : 'Late', 'OT%', 'OT(h)'].map((h, i) => <th key={h} className={`py-2 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
            <tbody>{res.employees.map((e: any) => (
              <tr key={e.employeeId} style={{ borderTop: `1px solid ${line}` }} className="cursor-pointer hover:opacity-80" onClick={() => drill(e.employeeId)}>
                <td className="py-2 text-start"><span className="font-semibold" style={{ color: '#6366f1' }}>{e.name}</span> <span style={{ color: sub }}>#{e.employeeId}</span></td>
                <td className="text-center"><span className="px-1.5 py-0.5 rounded font-bold" style={{ background: ratingColor(e.rating) + '22', color: ratingColor(e.rating) }}>{ar ? ratingAr(e.rating) : e.rating}</span></td>
                <td className="text-center font-bold">{e.score}</td>
                <td className="text-center">{e.stats.avgConformance}%</td>
                <td className="text-center" style={{ color: e.stats.absentDays ? '#ef4444' : sub }}>{e.stats.absentDays}</td>
                <td className="text-center" style={{ color: e.stats.lateDays ? '#f97316' : sub }}>{e.stats.lateDays}</td>
                <td className="text-center" style={{ color: '#06b6d4' }}>{e.stats.otPercent}%</td>
                <td className="text-center" style={{ color: '#06b6d4' }}>{e.stats.otHours}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {/* SINGLE / DRILL MODE */}
      {res?.mode !== 'list' && res?.employees?.map((e: any) => (
        <div key={e.employeeId} className="mt-4 rounded-xl p-4" style={{ border: `1px solid ${line}` }}>
          <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div>
              <p className="text-base font-bold" style={{ color: txt }}>{e.name} <span className="text-xs font-normal" style={{ color: sub }}>#{e.employeeId}</span></p>
              <p className="text-[11px]" style={{ color: sub }}>{e.func}{e.teamManager ? ` · ${ar ? 'المدير' : 'Mgr'}: ${e.teamManager}` : ''}{e.email ? ` · ${e.email}` : ''}</p>
            </div>
            <div className="text-center rounded-xl px-4 py-2" style={{ background: ratingColor(e.rating) + '1a' }}>
              <p className="text-2xl font-extrabold" style={{ color: ratingColor(e.rating) }}>{e.score}</p>
              <p className="text-[11px] font-bold" style={{ color: ratingColor(e.rating) }}>{ar ? ratingAr(e.rating) : e.rating}</p>
            </div>
          </div>
          {/* component bars */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[[ar ? 'التوافق' : 'Conformance', e.components.conformance], [ar ? 'الحضور' : 'Attendance', e.components.attendanceScore], [ar ? 'الالتزام بالوقت' : 'Punctuality', e.components.punctualityScore], [ar ? 'عدم الخروج مبكراً' : 'No early-out', e.components.earlyScore]].map(([l, v]: any) => (
              <div key={l}>
                <div className="flex justify-between text-[10px] mb-0.5"><span style={{ color: sub }}>{l}</span><span style={{ color: txt }}>{v}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}><div className="h-full" style={{ width: `${v}%`, background: v >= 80 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444' }} /></div>
              </div>
            ))}
          </div>
          {/* stats grid */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3 text-center">
            {[[ar ? 'أيام مجدولة' : 'Scheduled', e.stats.scheduledDays], [ar ? 'حضر' : 'Worked', e.stats.workedDays], [ar ? 'غياب' : 'Absent', e.stats.absentDays, '#ef4444'], [ar ? 'تأخير' : 'Late', e.stats.lateDays, '#f97316'], [ar ? 'خروج مبكر' : 'Early', e.stats.earlyDays, '#eab308'], [ar ? 'نسبة الغياب' : 'Absence %', e.stats.absenceRate + '%', '#ef4444']].map(([l, v, c]: any, i: number) => (
              <div key={i} className="rounded-lg py-1.5" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}><p className="text-sm font-bold" style={{ color: c || txt }}>{v}</p><p className="text-[9px]" style={{ color: sub }}>{l}</p></div>
            ))}
          </div>
          {/* OT block */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[[ar ? 'أوفر تايم' : 'OT hours', e.stats.otHours + 'h', '#06b6d4'], [ar ? 'نسبة الأوفر تايم' : 'OT % of worked', e.stats.otPercent + '%', '#06b6d4'], [ar ? 'OT قبل الشفت' : 'OT before', e.stats.otBeforeHours + 'h', '#a855f7'], [ar ? 'OT بعد الشفت' : 'OT after', e.stats.otAfterHours + 'h', '#a855f7']].map(([l, v, c]: any, i: number) => (
              <div key={i} className="rounded-lg px-3 py-2" style={{ background: (c as string) + '14' }}><p className="text-[10px]" style={{ color: sub }}>{l}</p><p className="text-base font-bold" style={{ color: c }}>{v}</p></div>
            ))}
          </div>
          {/* per-day table */}
          <details>
            <summary className="text-[11px] cursor-pointer font-semibold flex items-center gap-1" style={{ color: '#6366f1' }}><ChevronRight size={12} /> {ar ? `التفصيل اليومي (${e.days.length} يوم)` : `Daily detail (${e.days.length} days)`}</summary>
            <div className="overflow-x-auto mt-2 max-h-80 overflow-y-auto">
              <table className="w-full text-[11px]" style={{ color: txt }}>
                <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'اليوم' : 'Date', ar ? 'وردية' : 'Shift', ar ? 'دخول' : 'In', ar ? 'خروج' : 'Out', ar ? 'تأخير' : 'Late', ar ? 'مبكر' : 'Early', ar ? 'توافق' : 'Conf', 'OT', ar ? 'فترة OT' : 'OT window'].map((h, i) => <th key={h} className={`py-1.5 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
                <tbody>{e.days.map((dd: any) => (
                  <tr key={dd.date} style={{ borderTop: `1px solid ${line}` }}>
                    <td className="py-1 text-start whitespace-nowrap">{dd.date}</td>
                    <td className="text-center">{dd.shiftCode || '—'}</td>
                    <td className="text-center whitespace-nowrap">{dd.inAt || '—'}</td>
                    <td className="text-center whitespace-nowrap">{dd.outAt || '—'}</td>
                    <td className="text-center" style={{ color: dd.lateMin ? '#f97316' : sub }}>{dd.lateMin || '—'}</td>
                    <td className="text-center" style={{ color: dd.earlyMin ? '#eab308' : sub }}>{dd.earlyMin || '—'}</td>
                    <td className="text-center">{dd.conformance}%</td>
                    <td className="text-center" style={{ color: dd.otMin ? '#06b6d4' : sub }}>{dd.otMin ? (Math.round(dd.otMin / 6) / 10) + 'h' : '—'}</td>
                    <td className="text-center whitespace-nowrap" style={{ color: sub }}>{dd.otFrom ? `${dd.otFrom}→${dd.otTo}` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

/* ───────── 5h+ OT bonus ───────── */
function OtBonus({ ar, dark, card, txt, sub, line, from, to }: any) {
  const [minH, setMinH] = useState(5);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    apiClient.get(`/attendance-recon/ot-bonus?from=${from}&to=${to}&minHours=${minH}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setBusy(false));
  }, [from, to, minH]);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2"><Gift size={16} style={{ color: '#f43f5e' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? `قائمة المكافأة — أوفر تايم ≥ ${minH} ساعات بيوم واحد` : `Bonus list — ≥ ${minH}h OT in a single day`}</h3></div>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: sub }}>{ar ? 'الحد:' : 'Min:'}</span>
          <input type="number" min={1} max={12} step={0.5} value={minH} onChange={e => setMinH(parseFloat(e.target.value) || 5)} className="w-16 px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <span className="text-[11px]" style={{ color: sub }}>{ar ? 'ساعة' : 'h'}</span>
        </div>
      </div>
      {busy && <Loader2 size={20} className="animate-spin" style={{ color: '#f43f5e' }} />}
      {data && (
        <>
          <div className="flex gap-2 flex-wrap mb-3">
            {[[ar ? 'أيام مؤهلة' : 'Qualifying days', data.count], [ar ? 'موظفين' : 'People', data.people], [ar ? 'إجمالي ساعات OT' : 'Total OT hrs', data.totalHours]].map(([l, v]: any) => (
              <div key={l} className="rounded-lg px-3 py-1.5" style={{ background: '#f43f5e14' }}><span className="text-[10px]" style={{ color: sub }}>{l}: </span><span className="text-sm font-bold" style={{ color: '#f43f5e' }}>{fmt(v)}</span></div>
            ))}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]" style={{ color: txt }}>
              <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'الموظف' : 'Employee', 'ID', ar ? 'اليوم' : 'Date', ar ? 'وردية' : 'Shift', ar ? 'وقت الشفت' : 'Shift hours', 'OT', ar ? 'الموقع' : 'When', ar ? 'فترة OT' : 'OT window'].map((h, i) => <th key={h} className={`py-1.5 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
              <tbody>{data.rows.map((r: any, i: number) => (
                <tr key={i} style={{ borderTop: `1px solid ${line}` }}>
                  <td className="py-1.5 text-start font-semibold whitespace-nowrap">{r.name}</td>
                  <td className="text-center" style={{ color: sub }}>{r.employeeId}</td>
                  <td className="text-center whitespace-nowrap">{r.date}</td>
                  <td className="text-center font-semibold">{r.shiftCode || '—'}</td>
                  <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.shiftStart ? `${r.shiftStart}–${r.shiftEnd}` : (ar ? 'OFF' : 'OFF')}</td>
                  <td className="text-center font-bold" style={{ color: '#f43f5e' }}>{r.otHours}h</td>
                  <td className="text-center"><span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: '#06b6d422', color: '#06b6d4' }}>{r.position === 'after' ? (ar ? 'بعد' : 'after') : r.position === 'before' ? (ar ? 'قبل' : 'before') : (ar ? 'يوم OFF' : 'off-day')}</span></td>
                  <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.otFrom ? `${r.otFrom} → ${r.otTo}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────── Half-hourly headcount ───────── */
function HeadcountSection({ ar, dark, card, txt, sub, funcs, defaultDate }: any) {
  const [date, setDate] = useState(defaultDate || '2026-06-15');
  const [fn, setFn] = useState(funcs[0] || '');
  const [agent, setAgent] = useState('');
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!fn && funcs.length) setFn(funcs[0]); }, [funcs, fn]);
  const load = useCallback(() => {
    if (!date) return; setBusy(true);
    const p = new URLSearchParams({ date }); if (fn) p.set('func', fn); if (agent.trim()) p.set('q', agent.trim());
    apiClient.get(`/attendance-recon/coverage-intervals?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setBusy(false));
  }, [date, fn, agent]);
  useEffect(() => { load(); }, [load]);
  const f = data?.functions?.[0];
  const maxH = f ? Math.max(1, ...f.buckets.map((b: any) => Math.max(b.scheduled, b.present))) : 1;
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2"><LayoutGrid size={16} style={{ color: '#0ea5e9' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? 'الهيدكاونت كل نصف ساعة' : 'Half-hourly headcount'}</h3></div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <select value={fn} onChange={e => setFn(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: txt }}>
            {funcs.map((x: string) => <option key={x} value={x} style={{ background: '#0f1527' }}>{x}</option>)}
          </select>
          <input value={agent} onChange={e => setAgent(e.target.value)} placeholder={ar ? 'موظف (اسم/رقم)…' : 'agent (name/ID)…'} className="px-3 py-1.5 rounded-lg text-xs outline-none w-40" style={{ ...card, color: txt }} />
        </div>
      </div>
      <div className="flex items-center gap-3 mb-2 text-[10px]" style={{ color: sub }}>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#22c55e' }} /> {ar ? 'حاضر' : 'Present'}</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#ef4444' }} /> {ar ? 'نقص (شرينكيج)' : 'Shrinkage'}</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#06b6d4' }} /> {ar ? 'أوفر تايم' : 'In OT'}</span>
        <span style={{ color: '#94a3b8' }}>{ar ? '— الخط = المجدول' : '— line = scheduled'}</span>
      </div>
      {busy && <Loader2 size={20} className="animate-spin" style={{ color: '#0ea5e9' }} />}
      {f && (
        <>
          <div className="overflow-x-auto pb-2">
            <div className="flex items-end gap-[2px]" style={{ height: 140, minWidth: 720 }}>
              {f.buckets.map((b: any, i: number) => {
                const h = (v: number) => `${(v / maxH) * 120}px`;
                return (
                  <div key={i} className="flex flex-col justify-end items-center" style={{ width: 14, height: 130 }} title={`${b.t} — ${ar ? 'مجدول' : 'sched'}:${b.scheduled} ${ar ? 'حاضر' : 'present'}:${b.present} ${ar ? 'نقص' : 'shrink'}:${b.shrinkage} OT:${b.inOt}`}>
                    <div className="w-full flex flex-col justify-end relative" style={{ height: 120 }}>
                      {b.shrinkage > 0 && <div style={{ height: h(b.shrinkage), background: '#ef4444', borderRadius: '2px 2px 0 0' }} />}
                      <div style={{ height: h(b.present), background: '#22c55e' }} />
                      {b.inOt > 0 && <div className="absolute left-0 right-0" style={{ bottom: 0, height: h(b.inOt), background: '#06b6d4', opacity: 0.55 }} />}
                      {/* scheduled marker line */}
                      <div className="absolute left-0 right-0" style={{ bottom: h(b.scheduled), borderTop: '2px solid #94a3b8' }} />
                    </div>
                    {i % 4 === 0 && <span className="text-[8px] mt-1" style={{ color: sub }}>{b.t}</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] mt-2" style={{ color: sub }}>{ar ? `${f.func} · ${f.employees} موظف · ذروة المجدول ${f.peakScheduled} · أوفرتايم ${f.otHours}س (${f.otPeople} موظف)` : `${f.func} · ${f.employees} staff · peak scheduled ${f.peakScheduled} · overtime ${f.otHours}h (${f.otPeople} ppl)`}</p>
        </>
      )}
      {data && !f && <p className="text-xs" style={{ color: sub }}>{ar ? 'لا بيانات لهذا اليوم/الفنكشن' : 'No data for this date/function'}</p>}
    </div>
  );
}

function TopList({ rows, valueKey, suffix, sub, color, dark, txt, subc }: any) {
  if (!rows?.length) return <p className="text-[11px]" style={{ color: subc }}>—</p>;
  const max = Math.max(1, ...rows.map((r: any) => r[valueKey]));
  return (
    <div className="space-y-1.5">
      {rows.map((e: any, i: number) => (
        <div key={e.id} className="flex items-center gap-2">
          <span className="text-[10px] w-4 shrink-0" style={{ color: subc }}>{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold truncate" style={{ color: txt }} title={e.name}>{e.name}</span>
              <span className="text-[11px] font-bold shrink-0" style={{ color }}>{fmt(e[valueKey])}{suffix}</span>
            </div>
            <div className="h-1 rounded-full mt-0.5 overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
              <div className="h-full rounded-full" style={{ width: `${(e[valueKey] / max) * 100}%`, background: color }} />
            </div>
            <span className="text-[9px]" style={{ color: subc }}>{e.func}{sub(e) ? ` · ${sub(e)}` : ''}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
