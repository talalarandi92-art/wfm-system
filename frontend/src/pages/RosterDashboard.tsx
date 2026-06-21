import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Users, Clock, LogOut, UserX, Activity, ShieldCheck, AlertTriangle, TrendingUp, CalendarDays, Loader2, ArrowLeft, Search, Award, Gift, LayoutGrid, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { conformanceGrade } from '@/utils/format';

const WD_AR: Record<string, string> = { Sat: 'السبت', Sun: 'الأحد', Mon: 'الإثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة' };
const fmt = (n: number) => (n ?? 0).toLocaleString();

export default function RosterDashboardPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [tardy, setTardy] = useState<any>(null);
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
    // Permission-aware tardiness/conformance (DB-based, independent of recon files).
    const tp2 = new URLSearchParams({ period: 'custom' });
    if (from) tp2.set('from', from); if (to) tp2.set('to', to);
    apiClient.get(`/attendance/tardiness?${tp2}`).then((r: any) => setTardy(r.data)).catch(() => setTardy(null));
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

          {/* PERMISSION DETAILS */}
          <PermissionsDetail ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} />

          {/* HALF-HOURLY HEADCOUNT */}
          <HeadcountSection ar={ar} dark={dark} card={card} txt={txt} sub={sub} funcs={funcs} defaultDate={to} />

          {/* OVERTIME — detailed */}
          <OvertimeDetail ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />

          {/* DETAILED METRICS (late / early / absence / conformance / sick) */}
          <MetricPanel metric="late" title={ar ? 'التأخير — تفصيل' : 'Late — detailed'} icon={Clock} color="#f97316" ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />
          <MetricPanel metric="early" title={ar ? 'الخروج المبكر — تفصيل' : 'Early-out — detailed'} icon={LogOut} color="#eab308" ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />
          <MetricPanel metric="absence" title={ar ? 'الغياب — تفصيل' : 'Absence — detailed'} icon={UserX} color="#ef4444" ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />
          <MetricPanel metric="conformance" title={ar ? 'التوافق — تفصيل' : 'Conformance — detailed'} icon={ShieldCheck} color="#22c55e" ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />
          <MetricPanel metric="sick" title={ar ? 'الإجازات المرضية — تفصيل' : 'Sick leave — detailed'} icon={Activity} color="#0ea5e9" ar={ar} dark={dark} card={card} txt={txt} sub={sub} line={line} from={from} to={to} funcs={funcs} />

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
            <Panel title={ar ? 'الأكثر تأخيراً (بدون إذن)' : 'Most late (no permission)'} icon={Clock} color="#f97316"><TopList rows={d.topLate} valueKey="lateHours" suffix={ar ? ' س' : 'h'} sub={(e: any) => `${e.lateDays} ${ar ? 'يوم' : 'd'}`} color="#f97316" dark={dark} txt={txt} subc={sub} /></Panel>
            <Panel title={ar ? 'الأكثر خروج مبكر (بدون إذن)' : 'Most early-out (no permission)'} icon={LogOut} color="#eab308"><TopList rows={d.topEarly} valueKey="earlyMin" suffix="m" sub={(e: any) => `${e.earlyDays} ${ar ? 'يوم' : 'd'}`} color="#eab308" dark={dark} txt={txt} subc={sub} /></Panel>
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

      {/* Permission-aware tardiness & conformance per employee (DB-based) */}
      {tardy?.employees?.length > 0 && (
        <div style={{ ...card, padding: 16, marginTop: 16 }}>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={15} style={{ color: '#22c55e' }} />
            <p className="text-sm font-bold" style={{ color: txt }}>{ar ? 'التأخير والكونفورمانس لكل موظف (مراعي للاستئذان)' : 'Tardiness & conformance per employee (permission-aware)'}</p>
            {tardy.totals?.conformancePct != null && (
              <span className="text-xs font-bold ms-auto px-2 py-0.5 rounded" style={{ background: '#22c55e22', color: '#22c55e' }}>
                {ar ? 'كونفورمانس عام' : 'Overall'}: {tardy.totals.conformancePct}%
              </span>
            )}
          </div>
          <p className="text-[10px] mb-3" style={{ color: sub }}>{ar ? 'فقط التأخير غير المصرّح (بلا استئذان معتمد) يخفّض الكونفورمانس.' : 'Only unauthorized tardiness (no approved permission) lowers conformance.'}</p>
          <div style={{ overflowX: 'auto', maxHeight: 420 }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${line}`, color: sub }}>
                <th className="text-start py-2">{ar ? 'الموظف' : 'Employee'}</th>
                <th className="text-start">{ar ? 'القسم' : 'Function'}</th>
                <th className="text-center">{ar ? 'أيام' : 'Days'}</th>
                <th className="text-center">{ar ? 'تأخير' : 'Tardy'}</th>
                <th className="text-center">{ar ? 'باستئذان' : 'Permit'}</th>
                <th className="text-center">{ar ? 'كونفورمانس' : 'Conformance'}</th>
              </tr></thead>
              <tbody>
                {tardy.employees.map((e: any) => (
                  <tr key={e.employeeId} style={{ borderBottom: `1px solid ${line}` }}>
                    <td className="py-1.5" style={{ color: txt }}>{e.name || '—'} <span style={{ color: sub }}>#{e.employeeNo}</span></td>
                    <td style={{ color: sub }}>{e.functionName ?? '—'}</td>
                    <td className="text-center" style={{ color: txt }}>{e.workingDays}</td>
                    <td className="text-center" style={{ color: (e.tardyLate + e.tardyEarly) > 0 ? '#ef4444' : sub }}>{(e.tardyLate + e.tardyEarly) || '—'}</td>
                    <td className="text-center" style={{ color: (e.permittedLate + e.permittedEarly) > 0 ? '#22c55e' : sub }}>{(e.permittedLate + e.permittedEarly) || '—'}</td>
                    <td className="text-center"><Cbadge v={e.conformancePct ?? 100} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  function Cbadge({ v }: { v: number }) {
    const g = conformanceGrade(v);
    return <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: g.color + '22', color: g.color }}>{v}% <span style={{ fontSize: 9, opacity: 0.85 }}>{g.grade}</span></span>;
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

/* ───────── Generic detailed metric panel (late/early/absence/conformance/sick) ───────── */
function MetricPanel({ metric, title, icon: Icon, color, ar, dark, card, txt, sub, line, from, to, funcs }: any) {
  const [q, setQ] = useState('');
  const [fn, setFn] = useState('');
  const [mFrom, setMFrom] = useState(from);
  const [mTo, setMTo] = useState(to);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setMFrom(from); setMTo(to); }, [from, to]);
  const load = useCallback(() => {
    setBusy(true);
    const p = new URLSearchParams({ metric }); if (mFrom) p.set('from', mFrom); if (mTo) p.set('to', mTo); if (fn) p.set('func', fn); if (q.trim()) p.set('q', q.trim());
    apiClient.get(`/attendance-recon/metric?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setBusy(false));
  }, [metric, mFrom, mTo, fn, q]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const unit = metric === 'late' || metric === 'early' ? (ar ? 'د' : 'm') : metric === 'conformance' ? '%' : '';
  const fnUnit = metric === 'late' || metric === 'early' ? 'h' : metric === 'conformance' ? '%' : (ar ? ' يوم' : 'd');
  const maxFn = data ? Math.max(1, ...data.byFunction.map((f: any) => Math.abs(f.value))) : 1;
  const maxMo = data ? Math.max(1, ...data.byMonth.map((m: any) => Math.abs(m.value))) : 1;
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2"><Icon size={16} style={{ color }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{title}</h3><ChevronRight size={14} style={{ color: sub, transform: open ? 'rotate(90deg)' : 'none' }} /></button>
        {open && (
          <div className="flex items-center gap-2 flex-wrap">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'اسم/رقم/إيميل…' : 'name/ID/email…'} className="w-36 px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
            <select value={fn} onChange={e => setFn(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: txt }}>
              <option value="" style={{ background: '#0f1527' }}>{ar ? 'كل الفنكشن' : 'All functions'}</option>
              {(funcs || []).map((f: string) => <option key={f} value={f} style={{ background: '#0f1527' }}>{f}</option>)}
            </select>
            <input type="date" value={mFrom} onChange={e => setMFrom(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
            <span style={{ color: sub }}>→</span>
            <input type="date" value={mTo} onChange={e => setMTo(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          </div>
        )}
      </div>
      {!open && <p className="text-[11px]" style={{ color: sub }}>{ar ? 'اضغط للتوسيع — ملخص · حسب الفنكشن · شهري · أعلى الموظفين · جدول مفصّل' : 'Click to expand — summary · by function · monthly · top employees · detail table'}</p>}
      {open && busy && <Loader2 size={18} className="animate-spin" style={{ color }} />}
      {open && data && (
        <div className="space-y-4">
          {/* summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {data.summary.map((k: any) => (
              <div key={k.label} className="rounded-lg px-3 py-2" style={{ background: (k.color as string) + '14' }}><p className="text-[10px]" style={{ color: sub }}>{ar ? k.labelAr : k.label}</p><p className="text-base font-bold" style={{ color: k.color }}>{k.value}</p></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div><p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? 'حسب الفنكشن' : 'By function'}{data.avgMode ? (ar ? ' (الأقل أولاً)' : ' (lowest first)') : ''}</p>
              {data.byFunction.slice(0, 10).map((f: any) => (
                <div key={f.func} className="flex items-center gap-2 mb-1.5">
                  <div className="text-[11px] w-28 shrink-0 truncate text-right" style={{ color: sub }} title={f.func}>{f.func}</div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                    <div className="h-full rounded-md flex items-center justify-end px-1.5" style={{ width: `${Math.max(4, (Math.abs(f.value) / maxFn) * 100)}%`, background: color }}><span className="text-[10px] font-bold text-white">{f.value}{fnUnit}</span></div>
                  </div>
                  <span className="text-[9px] w-9" style={{ color: sub }}>{f.people}{ar ? 'ف' : 'p'}</span>
                </div>
              ))}
            </div>
            <div><p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? 'الاتجاه الشهري' : 'Monthly trend'}</p>
              {data.byMonth.map((m: any) => (
                <div key={m.month} className="flex items-center gap-2 mb-1.5">
                  <div className="text-[11px] w-16 shrink-0" style={{ color: sub }}>{m.month}</div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                    <div className="h-full rounded-md flex items-center justify-end px-1.5" style={{ width: `${Math.max(4, (Math.abs(m.value) / maxMo) * 100)}%`, background: color }}><span className="text-[10px] font-bold text-white">{m.value}{fnUnit}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* top employees */}
          <div><p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{data.avgMode ? (ar ? 'أدنى الموظفين توافقاً' : 'Lowest-conformance employees') : (ar ? 'أعلى الموظفين' : 'Top employees')}</p>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-[11px]" style={{ color: txt }}>
                <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'الموظف' : 'Employee', ar ? 'الفنكشن' : 'Func', ar ? 'القيمة' : 'Value', ar ? 'أيام' : 'Days'].map((h, i) => <th key={h} className={`py-1.5 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
                <tbody>{data.top.map((e: any) => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${line}` }}>
                    <td className="py-1.5 text-start whitespace-nowrap font-semibold">{e.name} <span style={{ color: sub }}>#{e.id}</span></td>
                    <td className="text-center" style={{ color: sub }}>{e.func}</td>
                    <td className="text-center font-bold" style={{ color }}>{e.value}{fnUnit}</td>
                    <td className="text-center">{e.days}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          {/* detail rows */}
          <div><p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? `التفصيل (${data.rows.length})` : `Detail (${data.rows.length})`}</p>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-[11px]" style={{ color: txt }}>
                <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">
                  <th className="py-1.5 text-center">{ar ? 'اليوم' : 'Date'}</th>
                  <th className="py-1.5 text-start">{ar ? 'الموظف' : 'Employee'}</th>
                  <th className="py-1.5 text-center">{ar ? 'وردية' : 'Shift'}</th>
                  <th className="py-1.5 text-center">{ar ? 'وقت الشفت' : 'Shift hrs'}</th>
                  {(metric === 'late' || metric === 'early') && <><th className="py-1.5 text-center">{ar ? 'الدقائق' : 'Minutes'}</th><th className="py-1.5 text-center">{metric === 'late' ? (ar ? 'دخول' : 'In') : (ar ? 'خروج' : 'Out')}</th>{metric === 'late' && <th className="py-1.5 text-center">{ar ? 'خصم؟' : 'Deduct'}</th>}</>}
                  {metric === 'conformance' && <><th className="py-1.5 text-center">{ar ? 'التوافق' : 'Conf'}</th><th className="py-1.5 text-center">{ar ? 'دخول→خروج' : 'In→Out'}</th></>}
                  {(metric === 'absence' || metric === 'sick') && <th className="py-1.5 text-center">{ar ? 'النوع' : 'Type'}</th>}
                </tr></thead>
                <tbody>{data.rows.map((r: any, i: number) => (
                  <tr key={i} style={{ borderTop: `1px solid ${line}` }}>
                    <td className="text-center whitespace-nowrap">{r.date}</td>
                    <td className="py-1.5 text-start whitespace-nowrap">{r.name} <span style={{ color: sub }}>#{r.employeeId}</span></td>
                    <td className="text-center font-semibold">{r.shiftCode || '—'}</td>
                    <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.shiftStart ? `${r.shiftStart}–${r.shiftEnd}` : 'OFF'}</td>
                    {(metric === 'late' || metric === 'early') && <><td className="text-center font-bold" style={{ color }}>{r.minutes}{unit}</td><td className="text-center whitespace-nowrap" style={{ color: sub }}>{(metric === 'late' ? r.inAt : r.outAt) || '—'}</td>{metric === 'late' && <td className="text-center">{r.deduction ? '⚠' : '—'}</td>}</>}
                    {metric === 'conformance' && <><td className="text-center font-bold" style={{ color: r.conformance >= 85 ? '#22c55e' : r.conformance >= 70 ? '#f59e0b' : '#ef4444' }}>{r.conformance}%</td><td className="text-center whitespace-nowrap" style={{ color: sub }}>{(r.inAt || '—')}→{(r.outAt || '—')}</td></>}
                    {(metric === 'absence' || metric === 'sick') && <td className="text-center" style={{ color: sub }}>{r.dayType || r.presence}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Overtime — detailed ───────── */
function OvertimeDetail({ ar, dark, card, txt, sub, line, from, to, funcs }: any) {
  const [q, setQ] = useState('');
  const [fn, setFn] = useState('');
  const [oFrom, setOFrom] = useState(from);
  const [oTo, setOTo] = useState(to);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOFrom(from); setOTo(to); }, [from, to]);
  const load = useCallback(() => {
    setBusy(true);
    const p = new URLSearchParams(); if (oFrom) p.set('from', oFrom); if (oTo) p.set('to', oTo); if (fn) p.set('func', fn); if (q.trim()) p.set('q', q.trim());
    apiClient.get(`/attendance-recon/overtime?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setBusy(false));
  }, [oFrom, oTo, fn, q]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const capColor = (s: string) => s === 'EXCEEDED' ? '#ef4444' : s === 'APPROACHING' ? '#f59e0b' : '#22c55e';
  const posBadge = (pos: string) => {
    const m: any = { after: ['#06b6d4', ar ? 'بعد' : 'after'], before: ['#a855f7', ar ? 'قبل' : 'before'], holiday: ['#a855f7', ar ? 'عيد/عطلة' : 'holiday'], 'off-day': ['#64748b', ar ? 'يوم OFF' : 'off-day'] };
    const [c, t] = m[pos] || ['#64748b', pos];
    return <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: c + '22', color: c }}>{t}</span>;
  };
  const s = data?.summary;
  const maxFn = data ? Math.max(1, ...data.byFunction.map((f: any) => f.hours)) : 1;
  const maxMo = data ? Math.max(1, ...data.byMonth.map((m: any) => m.hours)) : 1;
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2"><Activity size={16} style={{ color: '#06b6d4' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? 'الأوفرتايم — تفصيل موسّع' : 'Overtime — detailed'}</h3><ChevronRight size={14} style={{ color: sub, transform: open ? 'rotate(90deg)' : 'none' }} /></button>
        {open && (
          <div className="flex items-center gap-2 flex-wrap">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'اسم/رقم/إيميل…' : 'name/ID/email…'} className="w-36 px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
            <select value={fn} onChange={e => setFn(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: txt }}>
              <option value="" style={{ background: '#0f1527' }}>{ar ? 'كل الفنكشن' : 'All functions'}</option>
              {(funcs || []).map((f: string) => <option key={f} value={f} style={{ background: '#0f1527' }}>{f}</option>)}
            </select>
            <input type="date" value={oFrom} onChange={e => setOFrom(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
            <span style={{ color: sub }}>→</span>
            <input type="date" value={oTo} onChange={e => setOTo(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          </div>
        )}
      </div>
      {!open && <p className="text-[11px]" style={{ color: sub }}>{ar ? 'اضغط للتوسيع — قبل/بعد الشفت · عيد/OFF · حسب الفنكشن · اتجاه شهري · أعلى الموظفين · سقف 180 ساعة · جدول مفصّل' : 'Click to expand — before/after · holiday/off · by function · monthly trend · top employees · 180h cap · detail table'}</p>}
      {open && busy && <Loader2 size={18} className="animate-spin" style={{ color: '#06b6d4' }} />}
      {open && data && s && (
        <div className="space-y-4">
          {/* summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[[ar ? 'إجمالي' : 'Total', s.totalHours + 'h', '#06b6d4'], [ar ? 'قبل الشفت' : 'Before', s.beforeHours + 'h', '#a855f7'], [ar ? 'بعد الشفت' : 'After', s.afterHours + 'h', '#06b6d4'], [ar ? 'عيد/عطلة' : 'Holiday', s.holidayHours + 'h', '#a855f7'], [ar ? 'يوم OFF' : 'Off-day', s.offHours + 'h', '#64748b'], [ar ? 'موظفين' : 'People', s.people, '#6366f1'], [ar ? 'متوسط/فرد' : 'Avg/person', s.avgPerPerson + 'h', '#22c55e']].map(([l, v, c]: any) => (
              <div key={l} className="rounded-lg px-3 py-2" style={{ background: (c as string) + '14' }}><p className="text-[10px]" style={{ color: sub }}>{l}</p><p className="text-base font-bold" style={{ color: c }}>{v}</p></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* by function */}
            <div><p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? 'حسب الفنكشن' : 'By function'}</p>
              {data.byFunction.slice(0, 10).map((f: any) => (
                <div key={f.func} className="flex items-center gap-2 mb-1.5">
                  <div className="text-[11px] w-28 shrink-0 truncate text-right" style={{ color: sub }} title={f.func}>{f.func}</div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                    <div className="h-full rounded-md flex items-center justify-end px-1.5" style={{ width: `${Math.max(4, (f.hours / maxFn) * 100)}%`, background: '#06b6d4' }}><span className="text-[10px] font-bold text-white">{f.hours}h</span></div>
                  </div>
                  <span className="text-[9px] w-10" style={{ color: sub }}>{f.people}{ar ? ' ف' : 'p'}</span>
                </div>
              ))}
            </div>
            {/* by month */}
            <div><p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? 'الاتجاه الشهري' : 'Monthly trend'}</p>
              {data.byMonth.map((m: any) => (
                <div key={m.month} className="flex items-center gap-2 mb-1.5">
                  <div className="text-[11px] w-16 shrink-0" style={{ color: sub }}>{m.month}</div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                    <div className="h-full rounded-md flex items-center justify-end px-1.5" style={{ width: `${Math.max(4, (m.hours / maxMo) * 100)}%`, background: '#22c55e' }}><span className="text-[10px] font-bold text-white">{m.hours}h</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* top employees with 180h cap */}
          <div>
            <p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? 'أعلى الموظفين أوفرتايم (مع سقف 180 ساعة/سنة)' : 'Top OT employees (with 180h/yr cap)'}</p>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-[11px]" style={{ color: txt }}>
                <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'الموظف' : 'Employee', ar ? 'الفنكشن' : 'Func', ar ? 'إجمالي' : 'Total', ar ? 'قبل' : 'Before', ar ? 'بعد' : 'After', ar ? 'عيد' : 'Holiday', ar ? 'أيام' : 'Days', ar ? 'سنوي (سقف 180)' : 'YTD (cap 180)'].map((h, i) => <th key={h} className={`py-1.5 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
                <tbody>{data.topEmployees.map((e: any) => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${line}` }}>
                    <td className="py-1.5 text-start whitespace-nowrap font-semibold">{e.name} <span style={{ color: sub }}>#{e.id}</span></td>
                    <td className="text-center" style={{ color: sub }}>{e.func}</td>
                    <td className="text-center font-bold" style={{ color: '#06b6d4' }}>{e.hours}h</td>
                    <td className="text-center" style={{ color: sub }}>{e.beforeHours}h</td>
                    <td className="text-center" style={{ color: sub }}>{e.afterHours}h</td>
                    <td className="text-center" style={{ color: sub }}>{e.holidayHours}h</td>
                    <td className="text-center">{e.days}</td>
                    <td className="text-center"><span className="px-1.5 py-0.5 rounded font-bold" style={{ background: capColor(e.capStatus) + '22', color: capColor(e.capStatus) }}>{e.ytdHours}h</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          {/* detail rows */}
          <div>
            <p className="text-[11px] font-semibold mb-2" style={{ color: sub }}>{ar ? `كل أيام الأوفرتايم (${data.rows.length})` : `All OT days (${data.rows.length})`}</p>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-[11px]" style={{ color: txt }}>
                <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'اليوم' : 'Date', ar ? 'الموظف' : 'Employee', ar ? 'وردية' : 'Shift', ar ? 'وقت الشفت' : 'Shift hours', 'OT', ar ? 'الموقع' : 'When', ar ? 'فترة OT' : 'OT window', ar ? 'ملاحظات' : 'Flags'].map((h, i) => <th key={h} className={`py-1.5 ${i === 1 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
                <tbody>{data.rows.map((r: any, i: number) => (
                  <tr key={i} style={{ borderTop: `1px solid ${line}` }}>
                    <td className="text-center whitespace-nowrap">{r.date}</td>
                    <td className="py-1.5 text-start whitespace-nowrap">{r.name} <span style={{ color: sub }}>#{r.employeeId}</span></td>
                    <td className="text-center font-semibold">{r.shiftCode || '—'}</td>
                    <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.shiftStart ? `${r.shiftStart}–${r.shiftEnd}` : (r.position === 'holiday' ? (ar ? 'عيد' : 'Holiday') : 'OFF')}</td>
                    <td className="text-center font-bold" style={{ color: '#06b6d4' }}>{r.otHours}h</td>
                    <td className="text-center">{posBadge(r.position)}</td>
                    <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.otFrom ? `${r.otFrom} → ${r.otTo}` : '—'}</td>
                    <td className="text-center" style={{ color: sub }}>{(r.flags || []).join(', ') || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 5h+ OT bonus ───────── */
function OtBonus({ ar, dark, card, txt, sub, line, from, to }: any) {
  const [minH, setMinH] = useState(5);
  const [bFrom, setBFrom] = useState(from);
  const [bTo, setBTo] = useState(to);
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  // follow the dashboard range unless the user overrides it here
  useEffect(() => { setBFrom(from); setBTo(to); }, [from, to]);
  const load = useCallback(() => {
    setBusy(true);
    const p = new URLSearchParams({ minHours: String(minH) });
    if (bFrom) p.set('from', bFrom); if (bTo) p.set('to', bTo); if (q.trim()) p.set('q', q.trim());
    apiClient.get(`/attendance-recon/ot-bonus?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setBusy(false));
  }, [bFrom, bTo, minH, q]);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2"><Gift size={16} style={{ color: '#f43f5e' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? `قائمة المكافأة — أوفر تايم ≥ ${minH} ساعات بيوم واحد` : `Bonus list — ≥ ${minH}h OT in a single day`}</h3></div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'اسم/رقم/إيميل…' : 'name/ID/email…'} className="w-36 px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <input type="date" value={bFrom} onChange={e => setBFrom(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <span style={{ color: sub }}>→</span>
          <input type="date" value={bTo} onChange={e => setBTo(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          <span className="text-[11px]" style={{ color: sub }}>{ar ? 'الحد:' : 'Min:'}</span>
          <input type="number" min={1} max={12} step={0.5} value={minH} onChange={e => setMinH(parseFloat(e.target.value) || 5)} className="w-14 px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
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
                  <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.shiftStart ? `${r.shiftStart}–${r.shiftEnd}` : (r.position === 'holiday' ? (ar ? 'عيد/عطلة' : 'Holiday') : 'OFF')}</td>
                  <td className="text-center font-bold" style={{ color: '#f43f5e' }}>{r.otHours}h</td>
                  <td className="text-center"><span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: r.position === 'holiday' ? '#a855f722' : '#06b6d422', color: r.position === 'holiday' ? '#a855f7' : '#06b6d4' }}>{r.position === 'after' ? (ar ? 'بعد' : 'after') : r.position === 'before' ? (ar ? 'قبل' : 'before') : r.position === 'holiday' ? (ar ? 'عيد/عطلة' : 'holiday') : (ar ? 'يوم OFF' : 'off-day')}</span></td>
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

/* ───────── Permission details ───────── */
function PermissionsDetail({ ar, dark, card, txt, sub, line, from, to }: any) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pFrom, setPFrom] = useState(from);
  const [pTo, setPTo] = useState(to);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setPFrom(from); setPTo(to); }, [from, to]);
  const load = useCallback(() => {
    setBusy(true);
    const p = new URLSearchParams(); if (pFrom) p.set('from', pFrom); if (pTo) p.set('to', pTo); if (q.trim()) p.set('q', q.trim()); if (status) p.set('status', status);
    apiClient.get(`/attendance-recon/permissions-detail?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setBusy(false));
  }, [pFrom, pTo, q, status]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const stColor = (s: string) => /approv/i.test(s) ? '#22c55e' : /refus|reject/i.test(s) ? '#ef4444' : '#f59e0b';
  return (
    <div style={{ ...card, padding: 16 }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2"><CalendarDays size={16} style={{ color: '#a855f7' }} /><h3 className="text-sm font-bold" style={{ color: txt }}>{ar ? 'تفاصيل الاستئذانات' : 'Permission details'}</h3><ChevronRight size={14} style={{ color: sub, transform: open ? 'rotate(90deg)' : 'none' }} /></button>
        {open && (
          <div className="flex items-center gap-2 flex-wrap">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'اسم/رقم/إيميل…' : 'name/ID/email…'} className="w-36 px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
            <select value={status} onChange={e => setStatus(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: txt }}>
              <option value="" style={{ background: '#0f1527' }}>{ar ? 'كل الحالات' : 'All status'}</option>
              <option value="approv" style={{ background: '#0f1527' }}>{ar ? 'معتمد' : 'Approved'}</option>
              <option value="refus" style={{ background: '#0f1527' }}>{ar ? 'مرفوض' : 'Refused'}</option>
              <option value="pend" style={{ background: '#0f1527' }}>{ar ? 'معلّق' : 'Pending'}</option>
            </select>
            <input type="date" value={pFrom} onChange={e => setPFrom(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
            <span style={{ color: sub }}>→</span>
            <input type="date" value={pTo} onChange={e => setPTo(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ ...card, color: txt }} />
          </div>
        )}
      </div>
      {!open && <p className="text-[11px]" style={{ color: sub }}>{ar ? 'اضغط للعرض — كل استئذان: مين/متى/النوع/من-إلى/الحالة' : 'Click to expand — every permission: who/when/type/window/status'}</p>}
      {open && busy && <Loader2 size={18} className="animate-spin" style={{ color: '#a855f7' }} />}
      {open && data && (
        <>
          <div className="flex gap-2 flex-wrap mb-3">
            {[[ar ? 'إجمالي' : 'Total', data.counts.total, '#a855f7'], [ar ? 'معتمد' : 'Approved', data.counts.approved, '#22c55e'], [ar ? 'مرفوض' : 'Refused', data.counts.refused, '#ef4444'], [ar ? 'معلّق' : 'Pending', data.counts.pending, '#f59e0b']].map(([l, v, c]: any) => (
              <div key={l} className="rounded-lg px-3 py-1.5" style={{ background: c + '14' }}><span className="text-[10px]" style={{ color: sub }}>{l}: </span><span className="text-sm font-bold" style={{ color: c }}>{fmt(v)}</span></div>
            ))}
            {data.byType.map((t: any) => <div key={t.type} className="rounded-lg px-2.5 py-1.5" style={{ background: '#a855f714' }}><span className="text-[10px]" style={{ color: sub }}>{t.type}: </span><span className="text-xs font-bold" style={{ color: '#a855f7' }}>{t.count}</span></div>)}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]" style={{ color: txt }}>
              <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'اليوم' : 'Date', ar ? 'الموظف' : 'Employee', ar ? 'النوع' : 'Type', ar ? 'من → إلى' : 'From → To', ar ? 'الحالة' : 'Status', ar ? 'غطّى؟' : 'Covered'].map((h, i) => <th key={h} className={`py-1.5 ${i === 1 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
              <tbody>{data.rows.map((r: any, i: number) => (
                <tr key={i} style={{ borderTop: `1px solid ${line}` }}>
                  <td className="text-center whitespace-nowrap">{r.date}</td>
                  <td className="py-1.5 text-start whitespace-nowrap">{r.name} <span style={{ color: sub }}>#{r.employeeId}</span></td>
                  <td className="text-center">{r.type}</td>
                  <td className="text-center whitespace-nowrap" style={{ color: sub }}>{r.from || r.to ? `${r.from || '?'} → ${r.to || '?'}` : '—'}</td>
                  <td className="text-center"><span className="px-1.5 py-0.5 rounded font-bold" style={{ background: stColor(r.status) + '22', color: stColor(r.status) }}>{r.status}</span></td>
                  <td className="text-center">{r.covered ? '✓' : '—'}</td>
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
  // Default to a populated recent date (today) rather than the range-end, which may be
  // in the future (no actual attendance yet → empty headcount).
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today <= (defaultDate || today) ? today : defaultDate);
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
          {/* explicit table: scheduled vs ACTUAL (with OT) per half hour — shows how OT raises the headcount */}
          <div className="overflow-x-auto mt-3 max-h-72 overflow-y-auto">
            <table className="w-full text-[11px]" style={{ color: txt }}>
              <thead className="sticky top-0" style={{ background: dark ? '#0f1527' : '#fff' }}><tr style={{ color: sub }} className="text-[9px] uppercase">{[ar ? 'الساعة' : 'Time', ar ? 'مجدول' : 'Scheduled', ar ? 'فعلي (مع OT)' : 'Actual (w/ OT)', ar ? 'منهم OT' : 'in OT', ar ? 'نقص' : 'Gap'].map((h, i) => <th key={h} className={`py-1 ${i === 0 ? 'text-start' : 'text-center'}`}>{h}</th>)}</tr></thead>
              <tbody>{f.buckets.filter((b: any) => b.scheduled > 0 || b.present > 0).map((b: any) => (
                <tr key={b.t} style={{ borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` }}>
                  <td className="py-1 text-start whitespace-nowrap">{b.t}</td>
                  <td className="text-center">{b.scheduled}</td>
                  <td className="text-center font-bold" style={{ color: b.present > b.scheduled ? '#06b6d4' : txt }}>{b.present}{b.present > b.scheduled ? ` (+${b.present - b.scheduled})` : ''}</td>
                  <td className="text-center" style={{ color: b.inOt ? '#06b6d4' : sub }}>{b.inOt || '—'}</td>
                  <td className="text-center" style={{ color: b.shrinkage ? '#ef4444' : sub }}>{b.shrinkage || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
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
