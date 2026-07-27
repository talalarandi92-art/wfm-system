import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Loader2, FileText, Clock, AlertTriangle, Zap, GraduationCap,
  Megaphone, Users, TrendingUp, CheckCircle2, XCircle, ArrowRight,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { Donut, BarRow, Gauge } from '@/components/dazzle';
import { Kpi, KpiRow, KpiSource } from '@/components/kpi';

interface Bundle {
  period: { from: string; to: string; attendanceDate: string };
  requests: { total: number | null; approved: number; rejected: number; pending: number; escalated: number; overdue: number; urgent: number; avgDecisionHours: number | null };
  attendance: { present: number; absent: number; late: number; earlyOut: number; missingPunch: number };
  coaching: { high: number; medium: number; low: number };
  campaignsActive: number | null;
  otHours: number | null;
  byType: { name: string; count: number }[];
  byFunction: { name: string; late: number; absent: number; present: number }[];
}
type Role = 'exec' | 'wfm' | 'tl' | 'agent';

const ROLES: { id: Role; ar: string; en: string }[] = [
  { id: 'exec', ar: 'تنفيذي', en: 'Executive' },
  { id: 'wfm',  ar: 'WFM / RTA', en: 'WFM / RTA' },
  { id: 'tl',   ar: 'قائد فريق', en: 'Team Leader' },
  { id: 'agent', ar: 'موظف', en: 'Agent' },
];

export default function ControlDashboardsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role>('exec');
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Bundle>('/control-dashboard'); setData(data); }
    catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Provenance (Director's rule: every number → where it came from + drill) ──
  // All tiles read the ONE bundle endpoint; per-tile `table`/`definition` reflect
  // what the controller SQL actually computes (backend/src/modules/control-dashboard).
  const EP = 'GET /api/v1/control-dashboard';
  const reqPeriod = data ? `${data.period.from} → ${data.period.to}` : undefined;
  const attPeriod = data ? `${data.period.attendanceDate} (${ar ? 'آخر يوم حضور' : 'latest attendance date'})` : undefined;
  const src = (table: string, definition: string, definitionAr: string, period?: string): KpiSource =>
    ({ endpoint: EP, table, definition, definitionAr, period });

  const FnTable = () => (
    <div className="rounded-2xl overflow-x-auto mt-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
            {[ar ? 'القسم' : 'Function', ar ? 'حاضر' : 'Present', ar ? 'متأخر' : 'Late', ar ? 'غائب' : 'Absent'].map((h, i) => (
              <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-4 py-2.5" style={{ color: '#475569' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data?.byFunction ?? []).map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td className="px-4 py-2 text-xs" style={{ color: '#cbd5e1' }}>{r.name}</td>
              <td className="px-4 py-2 text-xs tabular-nums" style={{ color: '#22c55e' }}>{r.present}</td>
              <td className="px-4 py-2 text-xs tabular-nums" style={{ color: r.late > 0 ? '#fb923c' : '#475569' }}>{r.late}</td>
              <td className="px-4 py-2 text-xs tabular-nums" style={{ color: r.absent > 0 ? '#f87171' : '#475569' }}>{r.absent}</td>
            </tr>
          ))}
          {(!data?.byFunction || data.byFunction.length === 0) && (
            <tr><td colSpan={4} className="text-center py-8 text-xs" style={{ color: '#475569' }}>{ar ? 'لا توجد بيانات حضور' : 'No attendance data'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const d = data;

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.22)' }}>
            <LayoutDashboard size={18} style={{ color: '#818cf8' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'لوحات التحكّم' : 'Control Dashboards'}</h1>
            {d && <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'حضور' : 'Attendance'}: {d.period.attendanceDate} · {ar ? 'الطلبات' : 'Requests'}: {d.period.from} → {d.period.to}</p>}
          </div>
        </div>
        <div className="flex rounded-xl overflow-hidden flex-wrap" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setRole(r.id)} className="px-3 py-1.5 text-xs font-medium"
              style={{ background: role === r.id ? 'rgba(99,102,241,0.2)' : 'transparent', color: role === r.id ? '#818cf8' : '#64748b' }}>
              {ar ? r.ar : r.en}
            </button>
          ))}
        </div>
      </div>

      {loading || !d ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : (
        <>
          {/* EXECUTIVE */}
          {role === 'exec' && (
            <>
              <KpiRow>
                <Kpi label={ar ? 'إجمالي الطلبات' : 'Total requests'} value={d.requests.total} accent="#818cf8" icon={<FileText size={15} />} drill="/requests"
                  source={src('requests', 'COUNT(*) of requests submitted in the period (all statuses)', 'عدد الطلبات المقدَّمة خلال الفترة (كل الحالات)', reqPeriod)} />
                <Kpi label={ar ? 'موافق عليها' : 'Approved'} value={d.requests.approved} accent="#22c55e" icon={<CheckCircle2 size={15} />} drill="/requests"
                  source={src('requests', "Requests submitted in the period with status = 'approved'", "الطلبات المقدَّمة خلال الفترة بحالة 'approved'", reqPeriod)} />
                <Kpi label={ar ? 'مرفوضة' : 'Rejected'} value={d.requests.rejected} accent="#f87171" icon={<XCircle size={15} />} drill="/requests"
                  source={src('requests', "Requests submitted in the period with status = 'rejected'", "الطلبات المقدَّمة خلال الفترة بحالة 'rejected'", reqPeriod)} />
                <Kpi label={ar ? 'متوسط زمن القرار' : 'Avg decision'} value={d.requests.avgDecisionHours != null ? `${d.requests.avgDecisionHours}h` : '—'} accent="#38bdf8" icon={<Clock size={15} />} drill="/requests"
                  source={src('requests', 'AVG hours from submitted_at to first decision timestamp (approved L1/L2 or rejected), decided requests only', 'متوسط الساعات من التقديم حتى أول قرار (موافقة L1/L2 أو رفض) — للطلبات المبتوت فيها فقط', reqPeriod)} />
                <Kpi label={ar ? 'متأخرة عن SLA' : 'SLA overdue'} value={d.requests.overdue} accent="#fb923c" icon={<AlertTriangle size={15} />} drill="/requests" sub={d.requests.escalated ? `${d.requests.escalated} ${ar ? 'مُصعّد' : 'escalated'}` : undefined}
                  source={src('requests', 'Still-pending requests (pending / peer_pending) whose sla_due_at is already past', 'طلبات ما زالت معلّقة وتجاوز موعد sla_due_at الخاص بها', reqPeriod)} />
                <Kpi label={ar ? 'إضافي (ساعات)' : 'Overtime (h)'} value={d.otHours} accent="#22d3ee" icon={<Zap size={15} />} drill="/roster?tab=ot"
                  source={src('roster_days', 'TRUE_OT (ot + offday_ot + holiday_ot) / 60 over roster_days for the period — payable only (is_active, excludes supervisory record-only). Same definition as every other OT surface.', 'TRUE_OT (عادي + أوف + عطلة) ÷ 60 من roster_days خلال الفترة — المستحق فقط (is_active، بدون أوفرتايم المشرفين المسجَّل غير المدفوع). نفس تعريف كل شاشات الأوفرتايم.', reqPeriod)} />
                <Kpi label={ar ? 'حملات نشطة' : 'Active campaigns'} value={d.campaignsActive} accent="#f59e0b" icon={<Megaphone size={15} />} drill="/schedule?tab=campaigns"
                  source={src('campaigns', 'COUNT of campaigns with is_active = TRUE and today between start_date and end_date', 'عدد الحملات المفعّلة التي يقع اليوم ضمن مدتها', ar ? 'اليوم' : 'today')} />
                <Kpi label={ar ? 'كوتشينج (عالية)' : 'Coaching (high)'} value={d.coaching.high} accent="#a855f7" icon={<GraduationCap size={15} />} drill="/scorecard?tab=coaching" sub={`${d.coaching.medium + d.coaching.low} ${ar ? 'أخرى' : 'others'}`}
                  source={src('coaching_flags', "Open coaching flags with severity = 'high' (medium + low shown in subtitle)", "أعلام الكوتشينج المفتوحة بخطورة 'high' (وتظهر medium+low في السطر الفرعي)", ar ? 'المفتوحة حالياً' : 'currently open')} />
              </KpiRow>
              <div className="mt-4 grid lg:grid-cols-3 gap-3">
                {/* approval-rate gauge */}
                {(() => {
                  /* No requests in the period is NOT a 0% approval rate. This
                     rendered a red 0% dial captioned "0 / 0 approved" on the
                     executive tab — an absence presented as a catastrophic
                     measurement. */
                  const total = d.requests.total;
                  const rate = total != null && total > 0 ? Math.round((d.requests.approved / total) * 100) : null;
                  const gc = rate == null ? '#64748b' : rate >= 90 ? '#22c55e' : rate >= 75 ? '#06b6d4' : rate >= 50 ? '#f59e0b' : '#ef4444';
                  return (
                    <div className="rounded-2xl p-4 flex flex-col items-center justify-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-xs font-bold mb-2 self-start" style={{ color: tp(dark) }}>{ar ? 'معدّل الموافقة' : 'Approval rate'}</div>
                      {rate == null ? (
                        <div className="flex flex-col items-center justify-center" style={{ height: 150 }}>
                          <div className="text-2xl font-bold" style={{ color: '#64748b' }}>—</div>
                          <div className="text-[11px] mt-1" style={{ color: tsColor(dark) }}>
                            {total === 0 ? (ar ? 'لا توجد طلبات في الفترة' : 'no requests in period')
                                         : (ar ? 'البيانات غير متاحة' : 'data unavailable')}
                          </div>
                        </div>
                      ) : (
                        <Gauge value={rate} label={`${d.requests.approved}/${total} ${ar ? 'موافقة' : 'approved'}`} color={gc} size={150} />
                      )}
                    </div>
                  );
                })()}
                {/* request-status composition donut */}
                <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-xs font-bold mb-3" style={{ color: tp(dark) }}>{ar ? 'حالة الطلبات' : 'Request status'}</div>
                  {(() => {
                    const segs = [
                      { label: ar ? 'موافق عليها' : 'Approved', value: d.requests.approved, color: '#22c55e' },
                      { label: ar ? 'مرفوضة' : 'Rejected', value: d.requests.rejected, color: '#f87171' },
                      { label: ar ? 'قيد الموافقة' : 'Pending', value: d.requests.pending, color: '#fbbf24' },
                    ];
                    const reqTotal = d.requests.total ?? 0;
                    const other = Math.max(0, reqTotal - segs.reduce((a, c) => a + c.value, 0));
                    if (other > 0) segs.push({ label: ar ? 'أخرى' : 'Other', value: other, color: '#64748b' });
                    return <Donut segments={segs} centerNum={reqTotal} centerLabel={ar ? 'طلب' : 'requests'} />;
                  })()}
                </div>
                {/* requests by type — animated bars */}
                {d.byType.length > 0 && (() => {
                  const maxType = Math.max(...d.byType.map(x => x.count), 1);
                  return (
                    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-xs font-bold mb-3" style={{ color: tp(dark) }}>{ar ? 'الطلبات حسب النوع' : 'Requests by type'}</div>
                      <div className="space-y-2">
                        {d.byType.map((t, i) => (
                          <BarRow key={t.name} label={t.name} value={t.count} max={maxType} color="#818cf8" delay={i * 40} />
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}

          {/* WFM / RTA */}
          {role === 'wfm' && (
            <>
              <KpiRow>
                <Kpi label={ar ? 'قيد الموافقة' : 'Pending'} value={d.requests.pending} accent="#fbbf24" icon={<Clock size={15} />} drill="/requests"
                  source={src('requests', "Requests submitted in the period with status IN ('pending','peer_pending')", "الطلبات المقدَّمة خلال الفترة بحالة 'pending' أو 'peer_pending'", reqPeriod)} />
                <Kpi label={ar ? 'متأخرة عن SLA' : 'SLA overdue'} value={d.requests.overdue} accent="#f87171" icon={<AlertTriangle size={15} />} drill="/requests"
                  source={src('requests', 'Still-pending requests (pending / peer_pending) whose sla_due_at is already past', 'طلبات ما زالت معلّقة وتجاوز موعد sla_due_at الخاص بها', reqPeriod)} />
                <Kpi label={ar ? 'مُصعّدة' : 'Escalated'} value={d.requests.escalated} accent="#fb923c" icon={<TrendingUp size={15} />} drill="/requests"
                  source={src('requests', 'Requests submitted in the period with escalated_at set (auto SLA escalation or manual)', 'الطلبات المقدَّمة خلال الفترة التي سُجّل لها escalated_at (تصعيد SLA تلقائي أو يدوي)', reqPeriod)} />
                <Kpi label={ar ? 'عاجلة' : 'Urgent'} value={d.requests.urgent} accent="#ef4444" icon={<Zap size={15} />} drill="/requests"
                  source={src('requests', 'Requests submitted in the period flagged is_urgent = TRUE', 'الطلبات المقدَّمة خلال الفترة الموسومة is_urgent', reqPeriod)} />
                <Kpi label={ar ? 'متأخرون اليوم' : 'Late today'} value={d.attendance.late} accent="#fb923c" icon={<Clock size={15} />} drill="/attendance?tab=dashboard"
                  source={src('attendance_records', 'Records on the latest attendance date with punch_late_minutes > 0 (any punch lateness — NOT the credited 7..240-min tardiness definition; drill for that)', 'سجلات آخر يوم حضور حيث punch_late_minutes > 0 (أي تأخير بصمة — ليس تعريف التأخير المعتمد 7..240 دقيقة؛ افتح التفصيل له)', attPeriod)} />
                <Kpi label={ar ? 'خروج مبكر' : 'Early out'} value={d.attendance.earlyOut} accent="#f59e0b" icon={<AlertTriangle size={15} />} drill="/attendance?tab=dashboard"
                  source={src('attendance_records', 'Records on the latest attendance date with punch_early_out_minutes > 0', 'سجلات آخر يوم حضور حيث punch_early_out_minutes > 0', attPeriod)} />
                <Kpi label={ar ? 'بصمات ناقصة' : 'Missing punch'} value={d.attendance.missingPunch} accent="#a855f7" icon={<AlertTriangle size={15} />} drill="/attendance?tab=dashboard"
                  source={src('attendance_records', 'Records on the latest attendance date flagged is_missing_punch = TRUE', 'سجلات آخر يوم حضور الموسومة is_missing_punch', attPeriod)} />
                <Kpi label={ar ? 'إضافي (ساعات)' : 'OT (h)'} value={d.otHours} accent="#22d3ee" icon={<Zap size={15} />} drill="/roster?tab=ot"
                  source={src('roster_days', 'TRUE_OT (ot + offday_ot + holiday_ot) / 60 over roster_days for the period — payable only (is_active, excludes supervisory record-only). Same definition as every other OT surface.', 'TRUE_OT (عادي + أوف + عطلة) ÷ 60 من roster_days خلال الفترة — المستحق فقط (is_active، بدون أوفرتايم المشرفين المسجَّل غير المدفوع). نفس تعريف كل شاشات الأوفرتايم.', reqPeriod)} />
              </KpiRow>
              <FnTable />
            </>
          )}

          {/* TEAM LEADER */}
          {role === 'tl' && (
            <>
              <KpiRow>
                <Kpi label={ar ? 'حاضرون' : 'Present'} value={d.attendance.present} accent="#22c55e" icon={<Users size={15} />} drill="/attendance?tab=dashboard"
                  source={src('attendance_records', "Records on the latest attendance date with attendance_marker = 'present'", "سجلات آخر يوم حضور بعلامة 'present'", attPeriod)} />
                <Kpi label={ar ? 'متأخرون' : 'Late'} value={d.attendance.late} accent="#fb923c" icon={<Clock size={15} />} drill="/attendance?tab=dashboard"
                  source={src('attendance_records', 'Records on the latest attendance date with punch_late_minutes > 0 (any punch lateness — NOT the credited 7..240-min tardiness definition; drill for that)', 'سجلات آخر يوم حضور حيث punch_late_minutes > 0 (أي تأخير بصمة — ليس تعريف التأخير المعتمد 7..240 دقيقة؛ افتح التفصيل له)', attPeriod)} />
                <Kpi label={ar ? 'غائبون' : 'Absent'} value={d.attendance.absent} accent="#f87171" icon={<XCircle size={15} />} drill="/attendance?tab=dashboard"
                  source={src('attendance_records', "Records on the latest attendance date with attendance_marker = 'absent'", "سجلات آخر يوم حضور بعلامة 'absent'", attPeriod)} />
                <Kpi label={ar ? 'كوتشينج مفتوح' : 'Open coaching'} value={d.coaching.high + d.coaching.medium + d.coaching.low} accent="#a855f7" icon={<GraduationCap size={15} />} drill="/scorecard?tab=coaching" sub={`${d.coaching.high} ${ar ? 'عالية' : 'high'}`}
                  source={src('coaching_flags', "All open coaching flags (high + medium + low severity), computed client-side from the per-severity counts", 'كل أعلام الكوتشينج المفتوحة (high + medium + low) — مجموع محسوب في الواجهة من العدّادات حسب الخطورة', ar ? 'المفتوحة حالياً' : 'currently open')} />
              </KpiRow>
              <FnTable />
            </>
          )}

          {/* AGENT */}
          {role === 'agent' && (
            <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: '#475569' }} />
              <p className="text-sm mb-1" style={{ color: tp(dark) }}>{ar ? 'العرض الشخصي للموظف' : 'Agent personal view'}</p>
              <p className="text-xs mb-4" style={{ color: tsColor(dark) }}>{ar ? 'جدولك وطلباتك وحضورك في صفحتك الشخصية' : 'Your schedule, requests & attendance are in your workspace'}</p>
              <button onClick={() => navigate('/my')} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}>
                {ar ? 'صفحتي' : 'My Workspace'} <ArrowRight size={13} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
