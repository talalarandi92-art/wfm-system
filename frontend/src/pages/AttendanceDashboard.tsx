import { useState, useEffect, useCallback } from 'react';
import {
  Users, Clock, TrendingUp, Home, Building2,
  AlertTriangle, CheckCircle2, XCircle, BarChart3,
  RefreshCw, Loader2,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { card as cardStyle, tp, ts, useInjectDsStyles } from '@/components/ds';
import { conformanceGrade } from '@/utils/format';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month' | 'custom';

interface Summary {
  period: { from: string; to: string };
  total_records: number;
  present_days: number;
  absent_days: number;
  sick_days: number;
  leave_days: number;
  holiday_days: number;
  off_days: number;
  wfh_present: number;
  office_present: number;
  late_punch_count: number;
  late_system_count: number;
  total_late_punch_min: number;
  total_late_system_min: number;
  total_ot_min: number;
  ot_count: number;
  missing_punch_count: number;
  missing_system_count: number;
  total_employees: number;
}

interface TopLateRow {
  employee_no: string;
  full_name: string;
  function_name: string;
  late_count: number;
  total_late_minutes: number;
  avg_late_minutes: number;
  present_days: number;
}

interface FunctionRow {
  function_name: string;
  present_days: number;
  wfh_days: number;
  office_days?: number;
  absent_days: number;
  sick_days: number;
  late_count: number;
  total_late_minutes: number;
  total_ot_minutes: number;
  missing_punch: number;
  employee_count: number;
  attendance_pct: number;
}

interface MarkerRow {
  attendance_marker: string;
  count: number;
  percentage: number;
}
interface TardyEmp {
  employeeId: string; employeeNo: string; name: string; functionName: string | null;
  workingDays: number; tardyLate: number; tardyLateMinutes: number; permittedLate: number;
  tardyEarly: number; tardyEarlyMinutes: number; permittedEarly: number;
  conformingDays: number; conformancePct: number | null;
}
interface TardyData {
  totals: { employees: number; workingDays: number; tardyLate: number; permittedLate: number; tardyEarly: number; permittedEarly: number; conformancePct: number | null };
  employees: TardyEmp[];
}
interface ByHourRow { hour: number; shiftCode: string | null; scheduled: number; present: number; tardyLate: number; tardyEarly: number }
interface AttritionYear { year: number; resignations: number; terminations: number; leavers: number; headcount: number | null; attritionPct: number | null }
interface AttritionLeaver { employeeNo: string; name: string; functionName: string | null; type: string; leaveDate: string; lastWorkingDay: string | null; year: number }
interface AttritionData { byYear: AttritionYear[]; leavers: AttritionLeaver[] }

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtMins = (m: number) => {
  if (!m) return '0m';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
};

const MARKER_COLOR: Record<string, string> = {
  present: '#10b981',
  absent:  '#ef4444',
  sick:    '#f97316',
  leave:   '#60a5fa',
  holiday: '#a78bfa',
  off:     '#94a3b8',
  comp:    '#14b8a6',
  unknown: '#94a3b8',
};

const MARKER_LABEL: Record<string, { ar: string; en: string }> = {
  present: { ar: 'حاضر',    en: 'Present'  },
  absent:  { ar: 'غائب',    en: 'Absent'   },
  sick:    { ar: 'مريض',    en: 'Sick'     },
  leave:   { ar: 'إجازة',   en: 'Leave'    },
  holiday: { ar: 'عطلة',    en: 'Holiday'  },
  off:     { ar: 'يوم راحة', en: 'OFF'     },
  comp:    { ar: 'إجازة تعويضية', en: 'Comp' },
  unknown: { ar: 'غير محدد', en: 'Unknown' },
};

const PERIOD_LABELS: Record<Period, { ar: string; en: string }> = {
  today:  { ar: 'اليوم',    en: 'Today'       },
  week:   { ar: 'هذا الأسبوع', en: 'This Week' },
  month:  { ar: 'هذا الشهر', en: 'This Month' },
  custom: { ar: 'مخصص',     en: 'Custom'      },
};

// ── Summary Card ──────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color, loading, dark,
}: {
  label: string; value: string | number; sub?: string;
  icon: any; color: string; loading?: boolean; dark: boolean;
}) {
  return (
    <div style={{ ...cardStyle(dark), padding: 20, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ padding: 12, borderRadius: 14, background: `${color}18`, flexShrink: 0 }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: ts(dark), fontSize: 11, marginBottom: 2 }}>{label}</p>
        {loading
          ? <div style={{ height: 28, width: 64, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)', borderRadius: 6, marginTop: 4 }} />
          : <p style={{ color: tp(dark), fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{value}</p>
        }
        {sub && !loading && (
          <p style={{ color: ts(dark), fontSize: 11, marginTop: 2 }}>{sub}</p>
        )}
      </div>
    </div>
  );
}

// Compact metric box for the tardiness totals row.
function StatBox({ label, value, color, dark }: {
  label: string; value: string | number; color: string; dark: boolean; tp?: any; ts?: any;
}) {
  return (
    <div style={{ ...cardStyle(dark), padding: 14 }}>
      <p style={{ color: ts(dark), fontSize: 10, marginBottom: 4 }}>{label}</p>
      <p style={{ color, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AttendanceDashboard() {
  useInjectDsStyles();
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';

  const [period, setPeriod] = useState<Period>('month');
  const [activeTab, setActiveTab] = useState<'overview' | 'late' | 'function' | 'wfh' | 'missing' | 'tardiness' | 'attrition'>('overview');

  const [summary,   setSummary]   = useState<Summary | null>(null);
  const [topLate,   setTopLate]   = useState<TopLateRow[]>([]);
  const [byFunc,    setByFunc]    = useState<FunctionRow[]>([]);
  const [markers,   setMarkers]   = useState<MarkerRow[]>([]);
  const [tardy,     setTardy]     = useState<TardyData | null>(null);
  const [byHour,    setByHour]    = useState<ByHourRow[]>([]);
  const [attrition, setAttrition] = useState<AttritionData | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const surface = dark ? 'rgba(255,255,255,0.03)' : '#fff';
  const border  = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const rowHover = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const divider  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const theadBg  = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, lateRes, funcRes, markRes, tardyRes, byHourRes, attrRes] = await Promise.all([
        apiClient.get(`/attendance/summary?period=${p}`),
        apiClient.get(`/attendance/top-late?period=${p}&limit=15`),
        apiClient.get(`/attendance/by-function?period=${p}`),
        apiClient.get(`/attendance/markers?period=${p}`),
        apiClient.get(`/attendance/tardiness?period=${p}`).catch(() => ({ data: null })),
        apiClient.get(`/attendance/tardiness/by-hour?period=${p}`).catch(() => ({ data: { rows: [] } })),
        apiClient.get(`/attendance/attrition`).catch(() => ({ data: null })),
      ]);
      setSummary(sumRes.data);
      setTopLate(lateRes.data);
      setByFunc(funcRes.data);
      setMarkers(markRes.data);
      setTardy(tardyRes.data);
      setByHour(byHourRes.data?.rows ?? []);
      setAttrition(attrRes.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (ar ? 'فشل تحميل البيانات' : 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const s = summary;
  const attendancePct = s
    ? Math.round(100 * s.present_days / Math.max(s.present_days + s.absent_days, 1))
    : 0;
  const wfhPct = s
    ? Math.round(100 * s.wfh_present / Math.max(s.present_days, 1))
    : 0;

  const thStyle: React.CSSProperties = {
    padding: '10px 16px', textAlign: 'start', fontSize: 10,
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: ts(dark), background: theadBg,
    borderBottom: `1px solid ${divider}`,
  };
  const thCenter: React.CSSProperties = { ...thStyle, textAlign: 'center' };
  const tdStyle: React.CSSProperties = {
    padding: '11px 16px', fontSize: 12, color: tp(dark),
    borderBottom: `1px solid ${divider}`,
  };
  const tdCenter: React.CSSProperties = { ...tdStyle, textAlign: 'center' };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }} dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', flexShrink: 0 }}>
            <BarChart3 size={18} style={{ color: '#818cf8' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: tp(dark) }}>
              {ar ? 'لوحة الحضور والانصراف' : 'Attendance Dashboard'}
            </h1>
            {s && (
              <p style={{ fontSize: 12, color: ts(dark), marginTop: 2 }}>
                {s.period.from} — {s.period.to}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Period selector */}
          <div style={{ display: 'flex', background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 12, padding: 4, gap: 4 }}>
            {(Object.keys(PERIOD_LABELS) as Period[]).filter(p => p !== 'custom').map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 500,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: period === p ? (dark ? 'rgba(255,255,255,0.1)' : '#fff') : 'transparent',
                  color: period === p ? '#818cf8' : ts(dark),
                  boxShadow: period === p ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}>
                {ar ? PERIOD_LABELS[p].ar : PERIOD_LABELS[p].en}
              </button>
            ))}
          </div>

          <button onClick={() => load(period)} disabled={loading}
            style={{ padding: 8, borderRadius: 10, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={14} style={{ color: ts(dark), animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
          <XCircle size={15} /> {error}
        </div>
      )}

      {/* ── Summary Cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}
        className="att-grid">
        <StatCard label={ar ? 'إجمالي الموظفين' : 'Total Employees'} value={s?.total_employees ?? '—'} icon={Users} color="#818cf8" loading={loading} dark={dark} />
        <StatCard label={ar ? 'أيام الحضور' : 'Present Days'} value={s?.present_days ?? '—'} sub={`${attendancePct}% ${ar ? 'نسبة الحضور' : 'attendance rate'}`} icon={CheckCircle2} color="#10b981" loading={loading} dark={dark} />
        <StatCard label={ar ? 'أيام الغياب' : 'Absent Days'} value={s?.absent_days ?? '—'} icon={XCircle} color="#ef4444" loading={loading} dark={dark} />
        <StatCard label={ar ? 'يوم إجازة مرضية' : 'Sick Days'} value={s?.sick_days ?? '—'} icon={AlertTriangle} color="#f97316" loading={loading} dark={dark} />
        <StatCard label={ar ? 'تأخير (بصمة)' : 'Late (Punch)'} value={s?.late_punch_count ?? '—'} sub={s ? fmtMins(s.total_late_punch_min) + ' total' : ''} icon={Clock} color="#f59e0b" loading={loading} dark={dark} />
        <StatCard label={ar ? 'تأخير (سيستم)' : 'Late (System)'} value={s?.late_system_count ?? '—'} sub={s ? fmtMins(s.total_late_system_min) + ' total' : ''} icon={Clock} color="#eab308" loading={loading} dark={dark} />
        <StatCard label={ar ? 'من البيت' : 'WFH Days'} value={s?.wfh_present ?? '—'} sub={`${wfhPct}% ${ar ? 'من الحضور' : 'of present'}`} icon={Home} color="#6366f1" loading={loading} dark={dark} />
        <StatCard label={ar ? 'ساعات إضافية' : 'OT Hours'} value={s ? fmtMins(s.total_ot_min) : '—'} sub={s ? `${s.ot_count} ${ar ? 'يوم' : 'days'}` : ''} icon={TrendingUp} color="#a78bfa" loading={loading} dark={dark} />
      </div>

      {/* ── Markers Distribution ─────────────────────────────────────────── */}
      {markers.length > 0 && (
        <div style={{ ...cardStyle(dark), padding: 20, marginBottom: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: tp(dark), marginBottom: 12 }}>
            {ar ? 'توزيع أيام الحضور' : 'Attendance Distribution'}
          </h2>
          <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', gap: 2, marginBottom: 12 }}>
            {markers.map(m => (
              <div key={m.attendance_marker}
                title={`${MARKER_LABEL[m.attendance_marker]?.[ar ? 'ar' : 'en'] ?? m.attendance_marker}: ${m.count}`}
                style={{ width: `${m.percentage}%`, background: MARKER_COLOR[m.attendance_marker] ?? '#94a3b8', transition: 'all 0.3s' }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {markers.map(m => (
              <div key={m.attendance_marker} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: MARKER_COLOR[m.attendance_marker] ?? '#94a3b8', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: tp(dark), fontWeight: 500 }}>
                  {MARKER_LABEL[m.attendance_marker]?.[ar ? 'ar' : 'en'] ?? m.attendance_marker}
                </span>
                <span style={{ fontSize: 11, color: ts(dark) }}>{m.count} ({m.percentage}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${divider}`, gap: 4, marginBottom: 16 }}>
        {[
          { key: 'overview',   en: 'By Function',   ar: 'حسب القسم'      },
          { key: 'late',       en: 'Top Late',       ar: 'الأكثر تأخراً'  },
          { key: 'tardiness',  en: 'Tardiness & Conformance', ar: 'التأخير والكونفورمانس' },
          { key: 'attrition',  en: 'Attrition',      ar: 'الاتريشن' },
          { key: 'wfh',        en: 'WFH vs Office',  ar: 'بيت / مكتب'   },
          { key: 'missing',    en: 'Missing Punch',  ar: 'بصمة ناقصة' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: 'none', background: 'transparent',
              borderBottom: activeTab === tab.key ? '2px solid #818cf8' : '2px solid transparent',
              color: activeTab === tab.key ? '#818cf8' : ts(dark),
              transition: 'all 0.15s', marginBottom: -1,
            }}>
            {ar ? tab.ar : tab.en}
          </button>
        ))}
      </div>

      {/* ── Tab: By Function ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>{ar ? 'القسم' : 'Function'}</th>
                <th style={thCenter}>{ar ? 'موظفين' : 'Staff'}</th>
                <th style={thCenter}>{ar ? 'حضور %' : 'Att %'}</th>
                <th style={thCenter}>{ar ? 'حاضر' : 'Present'}</th>
                <th style={thCenter}>{ar ? 'بيت' : 'WFH'}</th>
                <th style={thCenter}>{ar ? 'غياب' : 'Absent'}</th>
                <th style={thCenter}>{ar ? 'مرضي' : 'Sick'}</th>
                <th style={thCenter}>{ar ? 'تأخير' : 'Late'}</th>
                <th style={thCenter}>OT</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} style={tdStyle}>
                          <div style={{ height: 14, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 4 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : byFunc.map(fn => (
                    <tr key={fn.function_name}
                      onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{fn.function_name}</td>
                      <td style={{ ...tdCenter, color: ts(dark) }}>{fn.employee_count}</td>
                      <td style={tdCenter}>
                        <span style={{ fontWeight: 600, color: fn.attendance_pct >= 90 ? '#10b981' : fn.attendance_pct >= 75 ? '#f59e0b' : '#ef4444' }}>
                          {fn.attendance_pct ?? 0}%
                        </span>
                      </td>
                      <td style={{ ...tdCenter, color: '#10b981', fontWeight: 600 }}>{fn.present_days}</td>
                      <td style={{ ...tdCenter, color: '#6366f1', fontWeight: 600 }}>{fn.wfh_days}</td>
                      <td style={{ ...tdCenter, color: '#ef4444' }}>{fn.absent_days}</td>
                      <td style={{ ...tdCenter, color: '#f97316' }}>{fn.sick_days}</td>
                      <td style={tdCenter}>
                        <span style={{ color: '#f59e0b' }}>{fn.late_count}</span>
                        {fn.total_late_minutes > 0 && (
                          <span style={{ fontSize: 10, color: ts(dark), marginInlineStart: 4 }}>({fmtMins(fn.total_late_minutes)})</span>
                        )}
                      </td>
                      <td style={{ ...tdCenter, color: '#a78bfa' }}>
                        {fn.total_ot_minutes > 0 ? fmtMins(fn.total_ot_minutes) : '—'}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab: Top Late ─────────────────────────────────────────────────── */}
      {activeTab === 'late' && (
        <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>
              {ar ? 'أعلى 15 موظف تأخراً' : 'Top 15 Late Employees'}
            </h3>
            <span style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'مرتب حسب مجموع دقائق التأخير' : 'Sorted by total late minutes'}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 32 }}>#</th>
                <th style={thStyle}>{ar ? 'الموظف' : 'Employee'}</th>
                <th style={thStyle}>{ar ? 'القسم' : 'Function'}</th>
                <th style={thCenter}>{ar ? 'مرات التأخير' : 'Late Count'}</th>
                <th style={thCenter}>{ar ? 'مجموع الدقائق' : 'Total Mins'}</th>
                <th style={thCenter}>{ar ? 'متوسط' : 'Avg'}</th>
                <th style={thCenter}>{ar ? 'أيام حضور' : 'Present'}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} style={tdStyle}>
                          <div style={{ height: 14, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 4 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : topLate.map((emp, idx) => (
                    <tr key={emp.employee_no}
                      onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, color: ts(dark), fontFamily: 'monospace', fontSize: 11 }}>{idx + 1}</td>
                      <td style={tdStyle}>
                        <p style={{ fontWeight: 600, color: tp(dark) }}>{emp.full_name}</p>
                        <p style={{ fontSize: 11, color: ts(dark) }}>#{emp.employee_no}</p>
                      </td>
                      <td style={{ ...tdStyle, color: ts(dark), fontSize: 11 }}>{emp.function_name}</td>
                      <td style={tdCenter}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 700, fontSize: 13 }}>
                          {emp.late_count}
                        </span>
                      </td>
                      <td style={{ ...tdCenter, color: '#f59e0b', fontWeight: 600 }}>{fmtMins(emp.total_late_minutes)}</td>
                      <td style={{ ...tdCenter, color: ts(dark), fontSize: 11 }}>{fmtMins(emp.avg_late_minutes)}</td>
                      <td style={{ ...tdCenter, color: ts(dark), fontSize: 11 }}>{emp.present_days}</td>
                    </tr>
                  ))
              }
              {!loading && topLate.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', padding: 32, color: ts(dark) }}>
                    {ar ? 'لا يوجد تأخير في هذه الفترة' : 'No late records in this period'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab: WFH vs Office ───────────────────────────────────────────── */}
      {activeTab === 'wfh' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {s && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { icon: Home,      color: '#6366f1', value: s.wfh_present,    label: ar ? 'أيام من البيت' : 'WFH Days',    sub: `${wfhPct}% ${ar ? 'من الحضور' : 'of present'}` },
                { icon: Building2, color: '#3b82f6', value: s.office_present,  label: ar ? 'أيام في المكتب' : 'Office Days', sub: `${100 - wfhPct}% ${ar ? 'من الحضور' : 'of present'}` },
                { icon: Users,     color: '#10b981', value: s.present_days,    label: ar ? 'إجمالي الحضور' : 'Total Present', sub: '' },
              ].map(({ icon: Icon, color, value, label, sub }) => (
                <div key={label} style={{ ...cardStyle(dark), padding: 20, textAlign: 'center' }}>
                  <Icon size={26} style={{ color, display: 'block', margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 28, fontWeight: 700, color }}>{value}</p>
                  <p style={{ fontSize: 12, color: ts(dark), marginTop: 4 }}>{label}</p>
                  {sub && <p style={{ fontSize: 11, color: ts(dark), opacity: 0.7 }}>{sub}</p>}
                </div>
              ))}
            </div>
          )}
          <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}` }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>
                {ar ? 'توزيع البيت / المكتب حسب القسم' : 'WFH vs Office by Function'}
              </h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{ar ? 'القسم' : 'Function'}</th>
                  <th style={thCenter}>{ar ? 'بيت' : 'WFH'}</th>
                  <th style={thCenter}>{ar ? 'مكتب' : 'Office'}</th>
                  <th style={thCenter}>WFH %</th>
                  <th style={{ ...thCenter, minWidth: 120 }}>{ar ? 'النسبة' : 'Ratio'}</th>
                </tr>
              </thead>
              <tbody>
                {byFunc.map(fn => {
                  const wfhP = fn.present_days > 0 ? Math.round(100 * (fn.wfh_days ?? 0) / fn.present_days) : 0;
                  return (
                    <tr key={fn.function_name}
                      onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{fn.function_name}</td>
                      <td style={{ ...tdCenter, color: '#6366f1', fontWeight: 600 }}>{fn.wfh_days}</td>
                      <td style={{ ...tdCenter, color: '#3b82f6', fontWeight: 600 }}>{fn.present_days - fn.wfh_days}</td>
                      <td style={{ ...tdCenter, color: ts(dark) }}>{wfhP}%</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                          <div style={{ width: `${wfhP}%`, background: '#6366f1', borderRadius: 4 }} />
                          <div style={{ width: `${100 - wfhP}%`, background: '#93c5fd', borderRadius: 4 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Missing Punch ───────────────────────────────────────────── */}
      {activeTab === 'missing' && (
        <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={15} style={{ color: '#f59e0b' }} />
            <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>
              {ar ? 'أعلى الموظفين غياباً عن البصمة' : 'Top Missing Punch Employees'}
            </h3>
          </div>
          <MissingTable period={period} ar={ar} dark={dark} divider={divider} tp={tp} ts={ts} rowHover={rowHover} thStyle={thStyle} thCenter={thCenter} tdStyle={tdStyle} tdCenter={tdCenter} />
        </div>
      )}

      {/* ── Attrition (by year) ──────────────────────────────────────────── */}
      {activeTab === 'attrition' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={15} style={{ color: '#f87171' }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>{ar ? 'الاتريشن حسب السنة' : 'Attrition by year'}</h3>
              <span style={{ fontSize: 11, color: ts(dark), marginInlineStart: 'auto' }}>{ar ? 'RES = استقالة · TER = ترمنيشن · النسبة = المغادرون ÷ الهيدكاونت' : 'RES = resignation · TER = termination · rate = leavers ÷ headcount'}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: theadBg }}>
                <tr>
                  <th style={thStyle}>{ar ? 'السنة' : 'Year'}</th>
                  <th style={thCenter}>{ar ? 'استقالة' : 'Resignations'}</th>
                  <th style={thCenter}>{ar ? 'ترمنيشن' : 'Terminations'}</th>
                  <th style={thCenter}>{ar ? 'إجمالي المغادرين' : 'Leavers'}</th>
                  <th style={thCenter}>{ar ? 'الهيدكاونت' : 'Headcount'}</th>
                  <th style={thCenter}>{ar ? 'نسبة الاتريشن' : 'Attrition %'}</th>
                </tr>
              </thead>
              <tbody>
                {(attrition?.byYear ?? []).map(y => (
                  <tr key={y.year} style={{ borderTop: `1px solid ${divider}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{y.year}</td>
                    <td style={tdCenter}>{y.resignations}</td>
                    <td style={{ ...tdCenter, color: y.terminations > 0 ? '#f87171' : ts(dark) }}>{y.terminations}</td>
                    <td style={{ ...tdCenter, fontWeight: 700 }}>{y.leavers}</td>
                    <td style={tdCenter}>{y.headcount ?? '—'}</td>
                    <td style={{ ...tdCenter, fontWeight: 700, color: (y.attritionPct ?? 0) >= 15 ? '#f87171' : (y.attritionPct ?? 0) >= 8 ? '#f59e0b' : '#22c55e' }}>{y.attritionPct ?? '—'}%</td>
                  </tr>
                ))}
                {(!attrition || attrition.byYear.length === 0) && <tr><td colSpan={6} style={{ ...tdCenter, padding: 24, color: ts(dark) }}>{ar ? 'لا بيانات اتريشن' : 'No attrition data'}</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}` }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>{ar ? 'المغادرون (آخر يوم عمل + النوع)' : 'Leavers (last working day + type)'}</h3>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 420 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: theadBg, position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={thStyle}>{ar ? 'الموظف' : 'Employee'}</th>
                    <th style={thStyle}>{ar ? 'القسم' : 'Function'}</th>
                    <th style={thStyle}>{ar ? 'النوع' : 'Type'}</th>
                    <th style={thStyle}>{ar ? 'آخر يوم عمل' : 'Last working day'}</th>
                    <th style={thStyle}>{ar ? 'تاريخ المغادرة' : 'Leave date'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(attrition?.leavers ?? []).map((l, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${divider}` }}>
                      <td style={tdStyle}>{l.name} <span style={{ color: ts(dark), fontSize: 10 }}>#{l.employeeNo}</span></td>
                      <td style={tdStyle}>{l.functionName ?? '—'}</td>
                      <td style={{ ...tdStyle, color: l.type === 'termination' ? '#f87171' : '#f59e0b', fontWeight: 600 }}>{l.type === 'termination' ? (ar ? 'ترمنيشن' : 'Termination') : (ar ? 'استقالة' : 'Resignation')}</td>
                      <td style={tdStyle}>{l.lastWorkingDay ?? '—'}</td>
                      <td style={tdStyle}>{l.leaveDate}</td>
                    </tr>
                  ))}
                  {(!attrition || attrition.leavers.length === 0) && <tr><td colSpan={5} style={{ ...tdCenter, padding: 24, color: ts(dark) }}>{ar ? 'لا مغادرين' : 'No leavers'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tardiness & Conformance ──────────────────────────────────────── */}
      {activeTab === 'tardiness' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Totals */}
          {tardy?.totals && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
              <StatBox label={`${ar ? 'سكور الكونفورمانس' : 'Conformance Score'} · ${conformanceGrade(tardy.totals.conformancePct).grade}`} value={`${tardy.totals.conformancePct ?? '—'}%`} color={conformanceGrade(tardy.totals.conformancePct).color} dark={dark} tp={tp} ts={ts} />
              <StatBox label={ar ? 'تأخير دخول (غير مصرّح)' : 'Late-in (tardy)'} value={tardy.totals.tardyLate} color="#f87171" dark={dark} tp={tp} ts={ts} />
              <StatBox label={ar ? 'تأخير باستئذان' : 'Late-in (permitted)'} value={tardy.totals.permittedLate} color="#22c55e" dark={dark} tp={tp} ts={ts} />
              <StatBox label={ar ? 'خروج مبكر (غير مصرّح)' : 'Early-out (tardy)'} value={tardy.totals.tardyEarly} color="#f87171" dark={dark} tp={tp} ts={ts} />
              <StatBox label={ar ? 'خروج مبكر باستئذان' : 'Early-out (permitted)'} value={tardy.totals.permittedEarly} color="#22c55e" dark={dark} tp={tp} ts={ts} />
            </div>
          )}

          {/* Per-employee table */}
          <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={15} style={{ color: '#f87171' }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>
                {ar ? 'التأخير لكل موظف + الكونفورمانس' : 'Per-employee tardiness + conformance'}
              </h3>
              <span style={{ fontSize: 11, color: ts(dark), marginInlineStart: 'auto' }}>{ar ? 'التأخير غير المصرّح فقط يخفّض الكونفورمانس' : 'Only unauthorized tardiness lowers conformance'}</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 460 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: theadBg, position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={thStyle}>{ar ? 'الموظف' : 'Employee'}</th>
                    <th style={thStyle}>{ar ? 'القسم' : 'Function'}</th>
                    <th style={thCenter}>{ar ? 'أيام عمل' : 'Days'}</th>
                    <th style={thCenter}>{ar ? 'تأخير' : 'Tardy late'}</th>
                    <th style={thCenter}>{ar ? 'باستئذان' : 'Permit late'}</th>
                    <th style={thCenter}>{ar ? 'خروج مبكر' : 'Tardy early'}</th>
                    <th style={thCenter}>{ar ? 'باستئذان' : 'Permit early'}</th>
                    <th style={thCenter}>{ar ? 'كونفورمانس' : 'Conformance'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tardy?.employees ?? []).map(e => (
                    <tr key={e.employeeId} style={{ borderTop: `1px solid ${divider}` }}>
                      <td style={tdStyle}>{e.name || '—'} <span style={{ color: ts(dark), fontSize: 10 }}>#{e.employeeNo}</span></td>
                      <td style={tdStyle}>{e.functionName ?? '—'}</td>
                      <td style={tdCenter}>{e.workingDays}</td>
                      <td style={{ ...tdCenter, color: e.tardyLate > 0 ? '#f87171' : ts(dark) }}>{e.tardyLate || '—'}</td>
                      <td style={{ ...tdCenter, color: e.permittedLate > 0 ? '#22c55e' : ts(dark) }}>{e.permittedLate || '—'}</td>
                      <td style={{ ...tdCenter, color: e.tardyEarly > 0 ? '#f87171' : ts(dark) }}>{e.tardyEarly || '—'}</td>
                      <td style={{ ...tdCenter, color: e.permittedEarly > 0 ? '#22c55e' : ts(dark) }}>{e.permittedEarly || '—'}</td>
                      <td style={{ ...tdCenter, fontWeight: 700, color: conformanceGrade(e.conformancePct).color }}>{e.conformancePct ?? '—'}% <span style={{ fontSize: 10, opacity: 0.85 }}>{conformanceGrade(e.conformancePct).grade}</span></td>
                    </tr>
                  ))}
                  {(!tardy || tardy.employees.length === 0) && (
                    <tr><td colSpan={8} style={{ ...tdCenter, padding: 24, color: ts(dark) }}>{ar ? 'لا بيانات' : 'No data'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* By hour (HC tracker) */}
          <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={15} style={{ color: '#818cf8' }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>
                {ar ? 'حسب ساعة بداية الشفت — مجدول / حاضر / متأخر' : 'By shift-start hour — scheduled / present / tardy'}
              </h3>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: theadBg, position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={thStyle}>{ar ? 'الساعة' : 'Hour'}</th>
                    <th style={thStyle}>{ar ? 'الشفت' : 'Shift'}</th>
                    <th style={thCenter}>{ar ? 'مجدول' : 'Scheduled'}</th>
                    <th style={thCenter}>{ar ? 'حاضر' : 'Present'}</th>
                    <th style={thCenter}>{ar ? 'تأخير دخول' : 'Tardy late'}</th>
                    <th style={thCenter}>{ar ? 'خروج مبكر' : 'Tardy early'}</th>
                  </tr>
                </thead>
                <tbody>
                  {byHour.map((h, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${divider}` }}>
                      <td style={tdStyle}>{String(h.hour).padStart(2, '0')}:00</td>
                      <td style={tdStyle}>{h.shiftCode ?? '—'}</td>
                      <td style={tdCenter}>{h.scheduled}</td>
                      <td style={tdCenter}>{h.present}</td>
                      <td style={{ ...tdCenter, color: h.tardyLate > 0 ? '#f87171' : ts(dark) }}>{h.tardyLate || '—'}</td>
                      <td style={{ ...tdCenter, color: h.tardyEarly > 0 ? '#f87171' : ts(dark) }}>{h.tardyEarly || '—'}</td>
                    </tr>
                  ))}
                  {byHour.length === 0 && <tr><td colSpan={6} style={{ ...tdCenter, padding: 24, color: ts(dark) }}>{ar ? 'لا بيانات' : 'No data'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Missing Table ─────────────────────────────────────────────────────────────

function MissingTable({
  period, ar, dark, divider, tp: tpFn, ts: tsFn, rowHover, thStyle, thCenter, tdStyle, tdCenter,
}: {
  period: Period; ar: boolean; dark: boolean; divider: string;
  tp: (d: boolean) => string; ts: (d: boolean) => string;
  rowHover: string; thStyle: any; thCenter: any; tdStyle: any; tdCenter: any;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiClient.get(`/attendance/missing-ranking?period=${period}&type=punch&limit=20`)
      .then(r => setRows(r.data))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: tsFn(dark), gap: 8 }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
      {ar ? 'جاري التحميل…' : 'Loading…'}
    </div>
  );

  if (!rows.length) return (
    <p style={{ textAlign: 'center', padding: 32, color: tsFn(dark), fontSize: 13 }}>
      {ar ? 'لا توجد سجلات بصمة ناقصة' : 'No missing punch records'}
    </p>
  );

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, width: 32 }}>#</th>
          <th style={thStyle}>{ar ? 'الموظف' : 'Employee'}</th>
          <th style={thStyle}>{ar ? 'القسم' : 'Function'}</th>
          <th style={thCenter}>{ar ? 'مرات' : 'Count'}</th>
          <th style={thCenter}>{ar ? 'أيام حضور' : 'Present Days'}</th>
          <th style={thCenter}>{ar ? 'نسبة' : 'Rate %'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.employee_no}
            onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <td style={{ ...tdStyle, color: tsFn(dark), fontSize: 11 }}>{i + 1}</td>
            <td style={tdStyle}>
              <p style={{ fontWeight: 600, color: tpFn(dark) }}>{r.full_name}</p>
              <p style={{ fontSize: 11, color: tsFn(dark) }}>#{r.employee_no}</p>
            </td>
            <td style={{ ...tdStyle, color: tsFn(dark), fontSize: 11 }}>{r.function_name}</td>
            <td style={tdCenter}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700, fontSize: 12 }}>
                {r.missing_count}
              </span>
            </td>
            <td style={{ ...tdCenter, color: tsFn(dark), fontSize: 11 }}>{r.present_days}</td>
            <td style={tdCenter}>
              <span style={{ fontSize: 11, fontWeight: 600, color: r.missing_pct >= 50 ? '#ef4444' : r.missing_pct >= 25 ? '#f59e0b' : tsFn(dark) }}>
                {r.missing_pct}%
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
