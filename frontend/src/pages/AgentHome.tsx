import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock, Clock, TrendingUp, Home, Building2, FileText,
  Bell, Award, MessageCircle, ChevronLeft, CheckCircle2, XCircle,
  AlertCircle, Hourglass, CalendarDays, Plane, Activity, Repeat, Zap,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { conformanceGrade } from '@/utils/format';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface AttSummary {
  present_days: number; absent_days: number; sick_days: number; leave_days: number;
  holiday_days: number; off_days: number; wfh_days: number; office_days: number;
  late_punch_count: number; total_late_punch_min: number;
  total_ot_min: number; ot_days: number; missing_punch: number; missing_system: number;
}
interface RecentDay {
  attendance_date: string; attendance_marker: string; is_wfh: boolean;
  punch_late_minutes: number; ot_minutes: number; is_missing_punch: boolean; shift_code: string | null;
}
interface MyRequest { id: string; type: string; status: string; submitted_at: string; notes?: string }
interface MyNotif { id: string; type: string; title: string; titleAr?: string; body: string; bodyAr?: string; isRead: boolean; createdAt: string }
interface ShiftRate {
  working: number; morning: number; evening: number; night: number; midnight: number;
  morningPct: number; eveningPct: number; nightPct: number; midnightPct: number;
  offDays: number; leaveDays: number;
}
interface Adherence { days: number; avgAdherence: number | null; avgConformance: number | null; recent: any[] }
interface Score { periodName: string; netPoints: number | null; functionRank: number | null; functionName: string; qualityPct: number | null; fcrPct: number | null }
interface Overview { linked: boolean; shiftRate: ShiftRate | null; adherence: Adherence | null; score: Score | null; schedule: any[] }
interface AttDetailDay {
  date: string; marker: string; isWfh: boolean; shiftCode: string | null;
  scheduledStart: string | null; scheduledEnd: string | null;
  punchIn: string | null; punchOut: string | null; systemLogin: string | null; systemLogout: string | null;
  punchLate: number; systemLate: number; punchEarlyOut: number; systemEarlyOut: number; ot: number;
  missingPunch: boolean; missingSystem: boolean; absenceReason: string | null;
  latePermitted?: boolean; earlyPermitted?: boolean; lateIsTardy?: boolean; earlyIsTardy?: boolean;
}
interface AttSummary2 {
  tardyLateCount: number; tardyLateMinutes: number; permittedLateCount: number;
  tardyEarlyCount: number; tardyEarlyMinutes: number; permittedEarlyCount: number;
  conformingDays?: number; conformancePct?: number | null;
}
interface LeaveLine { leaveType: string; entitlement: number; taken: number; pending: number; remaining: number }
interface PermInfo { total: number; approved: number; pending: number; items: any[] }
interface MyAttendance {
  linked: boolean;
  monthly: AttSummary2 | null;
  ytd: AttSummary2 | null;
  recent: AttDetailDay[];
  permissions: PermInfo | null;
  leaveBalance: LeaveLine[];
  ops: { hasContactData: boolean; contacts: number; activeDays: number; surveys: number; positive: number; negative: number; telephony: { available: boolean; note: string } } | null;
}
const LEAVE_AR: Record<string, string> = {
  annual: 'إجازة سنوية', sick: 'إجازة مرضية', emergency: 'إجازة طارئة',
  death: 'إجازة وفاة', comp_off: 'يوم تعويضي', annual_leave: 'إجازة سنوية', sick_leave: 'إجازة مرضية',
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fmtDT = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

const MARKER_AR: Record<string, string> = {
  present: 'حاضر', absent: 'غياب', sick: 'مرضي', leave: 'إجازة',
  holiday: 'عطلة', off: 'راحة', wfh: 'عن بُعد',
};
const MARKER_COLOR: Record<string, string> = {
  present: '#22c55e', absent: '#ef4444', sick: '#f59e0b', leave: '#6366f1',
  holiday: '#06b6d4', off: '#64748b', wfh: '#a855f7',
};
const STATUS_META: Record<string, { ar: string; en: string; color: string; icon: any }> = {
  pending:      { ar: 'قيد الموافقة', en: 'Pending',  color: '#f59e0b', icon: Hourglass },
  peer_pending: { ar: 'بانتظار الزميل', en: 'Peer',   color: '#a855f7', icon: Hourglass },
  approved:     { ar: 'موافق عليه', en: 'Approved',    color: '#22c55e', icon: CheckCircle2 },
  rejected:     { ar: 'مرفوض', en: 'Rejected',        color: '#ef4444', icon: XCircle },
  cancelled:    { ar: 'ملغي', en: 'Cancelled',        color: '#64748b', icon: XCircle },
};
const REQ_TYPE_AR: Record<string, string> = {
  permission: 'استئذان', annual_leave: 'إجازة سنوية', sick_leave: 'إجازة مرضية',
  shift_swap: 'تبديل وردية', off_swap: 'تبديل راحة', overtime: 'وقت إضافي',
  death_leave: 'إجازة وفاة', comp_off: 'يوم تعويضي', wfh: 'عمل عن بُعد', break_request: 'بريك',
};

/* ─── Stat tile ─────────────────────────────────────────────────────────── */
function Stat({ icon: Icon, label, value, sub, color = '#6366f1' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="p-3.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}22`, color }}>
          <Icon size={14} />
        </div>
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white leading-none">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

/* ─── Main ──────────────────────────────────────────────────────────────── */
export default function AgentHome() {
  const { lang } = useUiStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const ar = lang === 'ar';

  const employeeId = user?.employeeId ?? null;
  const displayName = user?.employee?.fullName || `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || '';
  const firstName = displayName.split(' ')[0];

  const [summary, setSummary]     = useState<AttSummary | null>(null);
  const [recent, setRecent]       = useState<RecentDay[]>([]);
  const [requests, setRequests]   = useState<MyRequest[]>([]);
  const [notifs, setNotifs]       = useState<MyNotif[]>([]);
  const [overview, setOverview]   = useState<Overview | null>(null);
  const [myAtt, setMyAtt]         = useState<MyAttendance | null>(null);
  const [livePerf, setLivePerf]   = useState<any>(null);
  const [otPending, setOtPending] = useState<any[]>([]);
  const [otBusy, setOtBusy]       = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const loadOt = () => apiClient.get('/attendance-recon/roster-v2/my-ot-pending').then((r: any) => setOtPending(r.data?.requests || [])).catch(() => setOtPending([]));
  const decideOt = async (id: string, accept: boolean) => {
    let reason: string | undefined;
    if (!accept) { const r = window.prompt(ar ? 'سبب الاعتذار (اختياري):' : 'Reason for declining (optional):'); if (r === null) return; reason = r || undefined; }
    setOtBusy(id);
    try { await apiClient.post('/attendance-recon/roster-v2/ot-ack', { requestId: id, accept, reason }); await loadOt(); } finally { setOtBusy(null); }
  };

  useEffect(() => {
    const calls: Promise<any>[] = [
      employeeId ? apiClient.get(`/attendance/agent/${employeeId}?period=month`) : Promise.resolve({ data: null }),
      employeeId ? apiClient.get(`/requests?employeeId=${employeeId}`) : Promise.resolve({ data: [] }),
      apiClient.get('/notifications').catch(() => ({ data: [] })),
      apiClient.get('/me/overview').catch(() => ({ data: null })),
      apiClient.get('/me/attendance').catch(() => ({ data: null })),
      apiClient.get('/me/live-performance').catch(() => ({ data: null })),
    ];
    Promise.all(calls).then(([att, reqs, nts, ov, mine, lp]: any[]) => {
      if (att?.data) { setSummary(att.data.summary); setRecent(att.data.recentDays ?? []); }
      setRequests(Array.isArray(reqs?.data) ? reqs.data.slice(0, 5) : (reqs?.data?.data ?? []).slice(0, 5));
      setNotifs((Array.isArray(nts?.data) ? nts.data : []).slice(0, 5));
      setOverview(ov?.data ?? null);
      setMyAtt(mine?.data ?? null);
      setLivePerf(lp?.data ?? null);
    }).catch(() => {}).finally(() => setLoading(false));
    loadOt();
  }, [employeeId]);

  // Refresh live performance every 30s (own live status + today's stats).
  useEffect(() => {
    const t = setInterval(() => { apiClient.get('/me/live-performance').then(r => setLivePerf(r.data)).catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (ar) return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء الخير' : 'مساء الخير';
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();

  const todayRow = recent.find(r => r.attendance_date === todayISO());
  const lateHrs = summary ? Math.floor(summary.total_late_punch_min / 60) : 0;
  const lateMins = summary ? summary.total_late_punch_min % 60 : 0;
  const otHrs = summary ? (summary.total_ot_min / 60).toFixed(1) : '0';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const noLink = !employeeId;

  return (
    <div className="space-y-4 max-w-5xl">
      {/* ── Greeting header ── */}
      <div className="p-5 rounded-2xl flex items-center justify-between flex-wrap gap-3"
        style={{ background: 'linear-gradient(135deg, rgba(67,56,202,0.25), rgba(99,102,241,0.1))', border: '1px solid rgba(99,102,241,0.2)' }}>
        <div>
          <p className="text-sm text-indigo-300">{greeting} 👋</p>
          <h1 className="text-2xl font-bold text-white mt-0.5">{firstName || (ar ? 'مرحباً' : 'Welcome')}</h1>
          <p className="text-xs text-slate-400 mt-1">
            {user?.employee?.functionName && <span>{user.employee.functionName} · </span>}
            {user?.employee?.employeeNo && <span>#{user.employee.employeeNo} · </span>}
            {new Date().toLocaleDateString(ar ? 'ar-KW' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {/* Today's shift */}
        <div className="px-4 py-3 rounded-xl text-center min-w-[140px]"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{ar ? 'ورديتي اليوم' : "Today's shift"}</p>
          {todayRow ? (
            <>
              <p className="text-xl font-bold" style={{ color: MARKER_COLOR[todayRow.attendance_marker] ?? '#fff' }}>
                {todayRow.shift_code || (ar ? (MARKER_AR[todayRow.attendance_marker] ?? todayRow.attendance_marker) : todayRow.attendance_marker)}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">{ar ? (MARKER_AR[todayRow.attendance_marker] ?? '') : todayRow.attendance_marker}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-1">{ar ? 'لا توجد بيانات' : 'No data'}</p>
          )}
        </div>
      </div>

      {noLink && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs text-amber-300"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <AlertCircle size={14} /> {ar ? 'حسابك غير مرتبط بسجل موظف — تواصل مع المشرف لعرض بيانات الحضور.' : 'Your account is not linked to an employee record — contact your supervisor.'}
        </div>
      )}

      {/* ── MY LIVE PERFORMANCE (own Sprinklr stats, live) ── */}
      {(() => {
        const stC: Record<string, string> = { available: '#22c55e', idle: '#84cc16', busy: '#f59e0b', break: '#a855f7', away: '#a855f7', offline: '#64748b', unknown: '#64748b' };
        const stL: Record<string, { ar: string; en: string }> = { available: { ar: 'متاح', en: 'Available' }, idle: { ar: 'خامل', en: 'Idle' }, busy: { ar: 'مشغول', en: 'Busy' }, break: { ar: 'بريك', en: 'Break' }, away: { ar: 'بعيد', en: 'Away' }, offline: { ar: 'غير متصل', en: 'Offline' }, unknown: { ar: '—', en: '—' } };
        const fM = (m: number | null | undefined) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
        const fS = (s: number | null | undefined) => (s == null || s <= 0 ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
        const fSince = (s: number | null | undefined) => (s == null ? '' : s < 60 ? `${s}${ar ? 'ث' : 's'}` : s < 3600 ? `${Math.floor(s / 60)}${ar ? 'د' : 'm'}` : `${Math.floor(s / 3600)}${ar ? 'س' : 'h'} ${Math.floor((s % 3600) / 60)}${ar ? 'د' : 'm'}`);
        const fClock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(ar ? 'ar-KW' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuwait' }) : '—');
        if (!livePerf) return null;
        if (!livePerf.linked) {
          return (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-sm font-bold text-white mb-1">{ar ? '⚡ أدائي اللحظي' : '⚡ My Live Performance'}</p>
              <p className="text-xs text-slate-500">{ar ? 'حسابك غير مربوط بحساب سبرينكلر بعد — سيظهر أداؤك اللحظي تلقائياً بمجرد الربط.' : 'Your account is not linked to a Sprinklr agent yet — your live performance will appear automatically once linked.'}</p>
            </div>
          );
        }
        const d = livePerf.daily; const lv = livePerf.live; const m = stC[lv?.status] || '#64748b';
        const tl = (livePerf.timeline ?? []) as { status: string; duration_sec: number }[];
        const tlTotal = tl.reduce((s, x) => s + (x.duration_sec || 0), 0) || 1;
        return (
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <p className="text-sm font-bold text-white">{ar ? '⚡ أدائي اللحظي' : '⚡ My Live Performance'}{d?.stat_date ? <span className="text-[11px] text-slate-500 font-normal"> · {d.stat_date}</span> : null}</p>
              {lv && (
                <span className="flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-bold" style={{ background: `${m}1a`, border: `1px solid ${m}40`, color: m }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: m, boxShadow: `0 0 8px ${m}` }} />
                  {ar ? (stL[lv.status]?.ar ?? lv.status) : (stL[lv.status]?.en ?? lv.status)}{lv.seconds != null ? ` · ${fSince(lv.seconds)}` : ''}
                </span>
              )}
            </div>
            {d ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {[
                    { l: ar ? 'كونتاكت' : 'Contacts', v: d.contacts_received ?? '—', c: '#22c55e' },
                    { l: 'AHT', v: fS(d.aht_seconds), c: '#818cf8' },
                    { l: ar ? 'الإشغال' : 'Utilization', v: d.utilizationPct != null ? `${d.utilizationPct}%` : '—', c: '#f59e0b' },
                    { l: ar ? 'زمن أول رد' : 'First Response', v: fS(d.avg_response_seconds), c: '#06b6d4' },
                  ].map(k => (
                    <div key={k.l} className="rounded-xl p-2.5" style={{ background: 'rgba(0,0,0,0.2)' }}>
                      <div className="text-lg font-bold tabular-nums" style={{ color: k.c }}>{k.v}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{k.l}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-2">
                  {[
                    { l: ar ? 'عمل' : 'Working', v: fM(d.total_working_minutes), c: '#e2e8f0' },
                    { l: ar ? 'مشغول' : 'Busy', v: fM(d.busy_minutes), c: '#818cf8' },
                    { l: ar ? 'خامل' : 'Idle', v: fM(d.idle_no_case_minutes), c: '#f59e0b' },
                    { l: ar ? 'هولد' : 'Hold', v: fM(d.idle_with_case_minutes), c: '#22d3ee' },
                    { l: ar ? 'بريك' : 'Break', v: fM(d.break_minutes), c: '#a855f7' },
                    { l: ar ? 'أول دخول' : 'Login', v: fClock(d.first_login), c: '#86efac' },
                  ].map(k => (
                    <div key={k.l} className="text-center">
                      <div className="text-sm font-bold tabular-nums" style={{ color: k.c }}>{k.v}</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{k.l}</div>
                    </div>
                  ))}
                </div>
                {tl.length > 0 && (
                  <div className="flex h-2.5 rounded-full overflow-hidden mt-2" title={ar ? 'خط حالاتي اليوم' : 'My status timeline today'}>
                    {tl.map((x, i) => <span key={i} style={{ width: `${(x.duration_sec / tlTotal) * 100}%`, background: stC[x.status] || '#475569' }} />)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">{ar ? 'لا توجد إحصائيات اليوم بعد — تظهر مع تدفّق البيانات.' : 'No stats yet today — they appear as data flows.'}</p>
            )}
          </div>
        );
      })()}

      {/* ── This-month metrics ── */}
      {summary && (
        <div>
          <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Activity size={15} className="text-indigo-400" /> {ar ? 'ملخص هذا الشهر' : 'This Month'}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={CheckCircle2} label={ar ? 'أيام الحضور' : 'Present'} value={summary.present_days} color="#22c55e" />
            <Stat icon={Clock} label={ar ? 'تأخيرات' : 'Late'} value={summary.late_punch_count}
              sub={summary.total_late_punch_min > 0 ? (ar ? `${lateHrs}س ${lateMins}د إجمالي` : `${lateHrs}h ${lateMins}m total`) : undefined} color="#f59e0b" />
            <Stat icon={TrendingUp} label={ar ? 'وقت إضافي' : 'Overtime'} value={`${otHrs}${ar ? 'س' : 'h'}`} sub={`${summary.ot_days} ${ar ? 'يوم' : 'days'}`} color="#06b6d4" />
            <Stat icon={Home} label={ar ? 'عن بُعد / مكتب' : 'WFH / Office'} value={`${summary.wfh_days}/${summary.office_days}`} color="#a855f7" />
            <Stat icon={Plane} label={ar ? 'إجازات' : 'Leave'} value={summary.leave_days} color="#6366f1" />
            <Stat icon={AlertCircle} label={ar ? 'غياب' : 'Absent'} value={summary.absent_days} color="#ef4444" />
            <Stat icon={CalendarDays} label={ar ? 'مرضي' : 'Sick'} value={summary.sick_days} color="#f59e0b" />
            <Stat icon={Building2} label={ar ? 'بصمة ناقصة' : 'Missing Punch'} value={summary.missing_punch} color="#ef4444" />
          </div>
        </div>
      )}

      {/* ── My shift distribution + adherence + score ── */}
      {overview?.linked && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Shift distribution (my rotation) */}
          <div className="lg:col-span-1 p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Activity size={15} className="text-purple-400" /> {ar ? 'توزيع ورديّاتي (السنة)' : 'My Shift Mix (YTD)'}
            </h2>
            {overview.shiftRate && overview.shiftRate.working > 0 ? (
              <div className="space-y-2">
                {[
                  { label: ar ? 'صباحي' : 'Morning', v: overview.shiftRate.morning, p: overview.shiftRate.morningPct, c: '#f59e0b' },
                  { label: ar ? 'مسائي' : 'Evening', v: overview.shiftRate.evening, p: overview.shiftRate.eveningPct, c: '#6366f1' },
                  { label: ar ? 'ليلي' : 'Night', v: overview.shiftRate.night, p: overview.shiftRate.nightPct, c: '#8b5cf6' },
                  { label: ar ? 'منتصف الليل' : 'Midnight', v: overview.shiftRate.midnight, p: overview.shiftRate.midnightPct, c: '#ec4899' },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 w-20 flex-shrink-0">{s.label}</span>
                    <div className="flex-1 h-4 rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="h-full rounded-md" style={{ width: `${Math.max(s.p, 2)}%`, background: s.c }} />
                    </div>
                    <span className="text-[10px] font-bold text-white w-14 text-end">{s.v} · {s.p}%</span>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-1 text-[10px] text-slate-500">
                  <span>{ar ? 'أيام عمل:' : 'Worked:'} <b className="text-white">{overview.shiftRate.working}</b></span>
                  <span>{ar ? 'راحات:' : 'Off:'} <b className="text-white">{overview.shiftRate.offDays}</b></span>
                  <span>{ar ? 'إجازات:' : 'Leave:'} <b className="text-white">{overview.shiftRate.leaveDays}</b></span>
                </div>
              </div>
            ) : <p className="text-xs text-slate-600 text-center py-4">{ar ? 'لا بيانات' : 'No data'}</p>}
          </div>

          {/* Adherence (التزام) */}
          <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <CheckCircle2 size={15} className="text-emerald-400" /> {ar ? 'التزامي (30 يوم)' : 'My Adherence (30d)'}
            </h2>
            {overview.adherence && overview.adherence.days > 0 ? (
              <div className="space-y-2">
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-3xl font-bold" style={{ color: (overview.adherence.avgAdherence ?? 0) >= 90 ? '#22c55e' : (overview.adherence.avgAdherence ?? 0) >= 75 ? '#f59e0b' : '#ef4444' }}>
                      {overview.adherence.avgAdherence ?? '—'}<span className="text-base">%</span>
                    </p>
                    <p className="text-[10px] text-slate-500">{ar ? 'الالتزام' : 'Adherence'}</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-slate-300">{overview.adherence.avgConformance ?? '—'}<span className="text-sm">%</span></p>
                    <p className="text-[10px] text-slate-500">{ar ? 'المطابقة' : 'Conformance'}</p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600">{ar ? `على مدى ${overview.adherence.days} يوم` : `over ${overview.adherence.days} days`}</p>
              </div>
            ) : <p className="text-xs text-slate-600 text-center py-4">{ar ? 'لا توجد بيانات التزام بعد' : 'No adherence data yet'}</p>}
          </div>

          {/* Score (سكور) */}
          <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Award size={15} className="text-amber-400" /> {ar ? 'تقييمي' : 'My Score'}
              </h2>
              <button onClick={() => navigate('/scorecard')} className="text-[10px] text-indigo-400 hover:underline">{ar ? 'التفاصيل' : 'Details'}</button>
            </div>
            {overview.score ? (
              <div className="space-y-1.5">
                <div className="flex items-end gap-3">
                  <p className="text-3xl font-bold text-white">{overview.score.netPoints ?? '—'}</p>
                  <p className="text-[10px] text-slate-500 mb-1.5">{ar ? 'نقطة' : 'pts'}</p>
                  {overview.score.functionRank && (
                    <span className="ms-auto text-[11px] font-bold text-amber-300 px-2 py-1 rounded-lg" style={{ background: 'rgba(245,158,11,0.15)' }}>
                      #{overview.score.functionRank} {ar ? 'في' : 'in'} {overview.score.functionName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500">
                  {overview.score.qualityPct !== null && <span>{ar ? 'جودة' : 'Quality'}: <b className="text-white">{overview.score.qualityPct}%</b></span>}
                  {overview.score.fcrPct !== null && <span>FCR: <b className="text-white">{overview.score.fcrPct}%</b></span>}
                </div>
                <p className="text-[10px] text-slate-600">{overview.score.periodName}</p>
              </div>
            ) : <p className="text-xs text-slate-600 text-center py-4">{ar ? 'لا يوجد تقييم منشور بعد' : 'No published score yet'}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Recent attendance ── */}
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <CalendarClock size={15} className="text-indigo-400" /> {ar ? 'جدولي' : 'My Schedule'}
            </h2>
            <button onClick={() => navigate('/attendance')} className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5">
              {ar ? 'الكل' : 'All'} <ChevronLeft size={11} className={ar ? '' : 'rotate-180'} />
            </button>
          </div>
          <div className="space-y-1">
            {recent.slice(0, 8).map((r, i) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-2 rounded-lg group/row" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] text-slate-500 w-12">{fmtD(r.attendance_date)}</span>
                  <span className="text-xs font-bold text-white w-12">{r.shift_code || '—'}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${MARKER_COLOR[r.attendance_marker] ?? '#64748b'}22`, color: MARKER_COLOR[r.attendance_marker] ?? '#94a3b8' }}>
                    {ar ? (MARKER_AR[r.attendance_marker] ?? r.attendance_marker) : r.attendance_marker}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {r.punch_late_minutes > 0 && <span className="text-[9px] text-amber-400">+{r.punch_late_minutes}{ar ? 'د' : 'm'}</span>}
                  {r.ot_minutes > 0 && <span className="text-[9px] text-cyan-400">OT {Math.round(r.ot_minutes / 60 * 10) / 10}h</span>}
                  {r.is_wfh && <Home size={10} className="text-purple-400" />}
                  {/* Request a change for this day — opens the request form pre-dated. Agents never edit directly. */}
                  <button
                    onClick={() => navigate(`/requests?tab=submit&date=${r.attendance_date}`)}
                    title={ar ? 'اطلب تغيير لهذا اليوم' : 'Request a change for this day'}
                    className="opacity-0 group-hover/row:opacity-100 transition-all flex items-center gap-1 text-[9px] font-semibold text-indigo-300 px-1.5 py-0.5 rounded-md"
                    style={{ background: 'rgba(99,102,241,0.15)' }}>
                    <Repeat size={9} /> {ar ? 'تغيير' : 'Change'}
                  </button>
                </div>
              </div>
            ))}
            {recent.length === 0 && <p className="text-xs text-slate-600 text-center py-6">{ar ? 'لا توجد بيانات حضور' : 'No attendance data'}</p>}
          </div>
        </div>

        {/* ── OT requests awaiting my acknowledgement ── */}
        {otPending.length > 0 && (
          <div className="p-4 rounded-2xl" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.35)' }}>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Zap size={15} style={{ color: '#a78bfa' }} /> {ar ? 'طلبات أوفر تايم بانتظار إقرارك' : 'Overtime awaiting your acknowledgement'}
              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold" style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}>{otPending.length}</span>
            </h2>
            <div className="space-y-2">
              {otPending.map((o: any) => (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-white">{o.d} · {o.start}–{o.end} <span className="text-slate-400">({o.dur} {ar ? 'دقيقة' : 'min'})</span></div>
                    <div className="text-[10px] text-slate-400">{o.function ? o.function + ' · ' : ''}{ar ? 'طلب من الإدارة لتغطية نقص' : 'requested by management to cover a gap'}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button disabled={otBusy === o.id} onClick={() => decideOt(o.id, true)} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>{ar ? 'أوافق' : 'Accept'}</button>
                    <button disabled={otBusy === o.id} onClick={() => decideOt(o.id, false)} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(244,63,94,0.15)', color: '#fb7185' }}>{ar ? 'أعتذر' : 'Decline'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── My requests ── */}
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText size={15} className="text-indigo-400" /> {ar ? 'طلباتي' : 'My Requests'}
            </h2>
            <button onClick={() => navigate('/requests')}
              className="text-[10px] font-bold text-white px-2.5 py-1 rounded-lg" style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
              + {ar ? 'طلب جديد' : 'New'}
            </button>
          </div>
          <div className="space-y-1">
            {requests.map(r => {
              const st = STATUS_META[r.status] ?? STATUS_META.pending;
              return (
                <div key={r.id} className="flex items-center justify-between px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">{ar ? (REQ_TYPE_AR[r.type] ?? r.type) : r.type}</p>
                    <p className="text-[9px] text-slate-600">{r.submitted_at ? fmtD(r.submitted_at) : ''}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0" style={{ background: `${st.color}22`, color: st.color }}>
                    <st.icon size={10} /> {ar ? st.ar : st.en}
                  </span>
                </div>
              );
            })}
            {requests.length === 0 && <p className="text-xs text-slate-600 text-center py-6">{ar ? 'لا توجد طلبات' : 'No requests yet'}</p>}
          </div>
        </div>
      </div>

      {/* ── Leave balance + Permissions (self only) ── */}
      {myAtt?.linked && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Leave balance */}
          <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Plane size={15} className="text-indigo-400" /> {ar ? 'رصيد إجازاتي' : 'My Leave Balance'}
            </h2>
            {myAtt.leaveBalance.length > 0 ? (
              <div className="space-y-2">
                {myAtt.leaveBalance.map(l => (
                  <div key={l.leaveType} className="flex items-center justify-between px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <span className="text-xs text-slate-200">{ar ? (LEAVE_AR[l.leaveType] ?? l.leaveType) : l.leaveType.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-slate-500">{ar ? 'مستحق' : 'Entitled'} <b className="text-white">{l.entitlement}</b></span>
                      <span className="text-amber-400">{ar ? 'مأخوذ' : 'Taken'} <b>{l.taken}</b></span>
                      {l.pending > 0 && <span className="text-purple-400">{ar ? 'معلّق' : 'Pending'} <b>{l.pending}</b></span>}
                      <span className="font-bold px-2 py-0.5 rounded-md" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                        {ar ? 'متبقٍ' : 'Left'} {l.remaining}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 text-center py-4">
                {ar ? 'لم تُحمَّل استحقاقات الإجازات بعد' : 'No leave entitlements loaded yet'}
              </p>
            )}
          </div>

          {/* Permissions this year + own ops contacts */}
          <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <Clock size={15} className="text-amber-400" /> {ar ? 'استئذاناتي (السنة)' : 'My Permissions (YTD)'}
            </h2>
            {myAtt.permissions ? (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <p className="text-xl font-bold text-white">{myAtt.permissions.total}</p>
                  <p className="text-[9px] text-slate-500">{ar ? 'الإجمالي' : 'Total'}</p>
                </div>
                <div className="text-center px-2 py-2 rounded-lg" style={{ background: 'rgba(34,197,94,0.08)' }}>
                  <p className="text-xl font-bold" style={{ color: '#22c55e' }}>{myAtt.permissions.approved}</p>
                  <p className="text-[9px] text-slate-500">{ar ? 'موافق' : 'Approved'}</p>
                </div>
                <div className="text-center px-2 py-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)' }}>
                  <p className="text-xl font-bold" style={{ color: '#f59e0b' }}>{myAtt.permissions.pending}</p>
                  <p className="text-[9px] text-slate-500">{ar ? 'معلّق' : 'Pending'}</p>
                </div>
              </div>
            ) : <p className="text-xs text-slate-600 text-center py-2">{ar ? 'لا استئذانات' : 'No permissions'}</p>}
            {/* Own operational contacts (Sprinklr) — honest about telephony */}
            {myAtt.ops && (
              <div className="pt-2 border-t border-white/5">
                {myAtt.ops.hasContactData ? (
                  <div className="flex items-center gap-3 text-[10px] text-slate-400">
                    <span>{ar ? 'تواصلاتي (الشهر)' : 'My contacts (mo)'}: <b className="text-white">{myAtt.ops.contacts}</b></span>
                    <span className="text-emerald-400">+{myAtt.ops.positive}</span>
                    <span className="text-red-400">−{myAtt.ops.negative}</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-600">{ar ? 'AHT / ACW / Hold / Idle — بانتظار تكامل Ameyo' : myAtt.ops.telephony.note}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tardiness vs authorized permission (this month) ── */}
      {myAtt?.linked && myAtt.monthly && (
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertCircle size={15} className="text-red-400" /> {ar ? 'التأخير مقابل الاستئذان (هذا الشهر)' : 'Tardiness vs Permission (this month)'}
            </h2>
            {myAtt.monthly.conformancePct != null && (() => {
              const g = conformanceGrade(myAtt.monthly.conformancePct);
              return (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background: `${g.color}1a`, border: `1px solid ${g.color}40` }}>
                  <span className="text-[10px] text-slate-400">{ar ? 'سكور الكونفورمانس' : 'Conformance score'}</span>
                  <span className="text-lg font-bold" style={{ color: g.color }}>{myAtt.monthly.conformancePct}%</span>
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: g.color, color: '#0a0f1e' }}>{g.grade}</span>
                  <span className="text-[10px]" style={{ color: g.color }}>{ar ? g.ar : g.en}</span>
                </div>
              );
            })()}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center px-2 py-2.5 rounded-xl" style={{ background: 'rgba(248,113,113,0.08)' }}>
              <p className="text-xl font-bold" style={{ color: '#f87171' }}>{myAtt.monthly.tardyLateCount}</p>
              <p className="text-[9px] text-slate-500">{ar ? 'تأخير دخول (غير مصرّح)' : 'Late-in (tardy)'}</p>
              {myAtt.monthly.tardyLateMinutes > 0 && <p className="text-[9px] text-red-300">{myAtt.monthly.tardyLateMinutes}{ar ? ' دقيقة' : ' min'}</p>}
            </div>
            <div className="text-center px-2 py-2.5 rounded-xl" style={{ background: 'rgba(34,197,94,0.08)' }}>
              <p className="text-xl font-bold" style={{ color: '#22c55e' }}>{myAtt.monthly.permittedLateCount}</p>
              <p className="text-[9px] text-slate-500">{ar ? 'تأخير باستئذان' : 'Late-in (permitted)'}</p>
            </div>
            <div className="text-center px-2 py-2.5 rounded-xl" style={{ background: 'rgba(248,113,113,0.08)' }}>
              <p className="text-xl font-bold" style={{ color: '#f87171' }}>{myAtt.monthly.tardyEarlyCount}</p>
              <p className="text-[9px] text-slate-500">{ar ? 'خروج مبكر (غير مصرّح)' : 'Early-out (tardy)'}</p>
              {myAtt.monthly.tardyEarlyMinutes > 0 && <p className="text-[9px] text-red-300">{myAtt.monthly.tardyEarlyMinutes}{ar ? ' دقيقة' : ' min'}</p>}
            </div>
            <div className="text-center px-2 py-2.5 rounded-xl" style={{ background: 'rgba(34,197,94,0.08)' }}>
              <p className="text-xl font-bold" style={{ color: '#22c55e' }}>{myAtt.monthly.permittedEarlyCount}</p>
              <p className="text-[9px] text-slate-500">{ar ? 'خروج مبكر باستئذان' : 'Early-out (permitted)'}</p>
            </div>
          </div>
          <p className="text-[10px] mt-2" style={{ color: '#475569' }}>
            {ar ? 'التأخير = دخول متأخر أو خروج/إغلاق سيستم مبكر بدون استئذان معتمد لنفس اليوم.'
                : 'Tardiness = late arrival or early departure/system-close without an approved permission that day.'}
          </p>
        </div>
      )}

      {/* ── Punch & system times (detailed, self only) ── */}
      {myAtt?.linked && myAtt.recent.length > 0 && (
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
            <Clock size={15} className="text-cyan-400" /> {ar ? 'بصمتي والسيستم (تفصيلي)' : 'My Punch & System Log'}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 text-[9px] uppercase">
                  <th className="text-start font-semibold py-1.5 px-2">{ar ? 'التاريخ' : 'Date'}</th>
                  <th className="text-start font-semibold py-1.5 px-2">{ar ? 'وردية' : 'Shift'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">{ar ? 'بصمة دخول' : 'Punch In'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">{ar ? 'بصمة خروج' : 'Punch Out'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">{ar ? 'فتح سيستم' : 'Sys Open'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">{ar ? 'إغلاق سيستم' : 'Sys Close'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">{ar ? 'تأخير' : 'Late'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">{ar ? 'خروج مبكر' : 'Early'}</th>
                  <th className="text-center font-semibold py-1.5 px-2">OT</th>
                </tr>
              </thead>
              <tbody>
                {myAtt.recent.slice(0, 14).map((d, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-1.5 px-2 text-slate-300">{fmtD(d.date)}</td>
                    <td className="py-1.5 px-2 font-bold" style={{ color: MARKER_COLOR[d.marker] ?? '#fff' }}>{d.shiftCode || (ar ? (MARKER_AR[d.marker] ?? d.marker) : d.marker)}</td>
                    <td className="py-1.5 px-2 text-center text-white">{d.punchIn ?? (d.missingPunch ? <span className="text-red-400">{ar ? 'ناقص' : 'miss'}</span> : '—')}</td>
                    <td className="py-1.5 px-2 text-center text-white">{d.punchOut ?? '—'}</td>
                    <td className="py-1.5 px-2 text-center text-slate-300">{d.systemLogin ?? (d.missingSystem ? <span className="text-red-400">{ar ? 'ناقص' : 'miss'}</span> : '—')}</td>
                    <td className="py-1.5 px-2 text-center text-slate-300">{d.systemLogout ?? '—'}</td>
                    <td className="py-1.5 px-2 text-center">
                      {d.punchLate > 0 ? (
                        <span className="inline-flex items-center gap-1" style={{ color: d.lateIsTardy ? '#f87171' : '#22c55e' }}>
                          {d.punchLate}{ar ? 'د' : 'm'}
                          <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: d.lateIsTardy ? 'rgba(248,113,113,0.15)' : 'rgba(34,197,94,0.15)' }}>
                            {d.lateIsTardy ? (ar ? 'تأخير' : 'tardy') : (ar ? 'استئذان' : 'permit')}
                          </span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {(d.punchEarlyOut > 0 || d.systemEarlyOut > 0) ? (
                        <span className="inline-flex items-center gap-1" style={{ color: d.earlyIsTardy ? '#f87171' : '#22c55e' }}>
                          {Math.max(d.punchEarlyOut, d.systemEarlyOut)}{ar ? 'د' : 'm'}
                          <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: d.earlyIsTardy ? 'rgba(248,113,113,0.15)' : 'rgba(34,197,94,0.15)' }}>
                            {d.earlyIsTardy ? (ar ? 'تأخير' : 'tardy') : (ar ? 'استئذان' : 'permit')}
                          </span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-center">{d.ot > 0 ? <span className="text-cyan-400">{Math.round(d.ot / 60 * 10) / 10}h</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: FileText, label: ar ? 'طلب جديد' : 'New Request', to: '/requests', color: '#6366f1' },
          { icon: CalendarClock, label: ar ? 'جدولي' : 'My Schedule', to: '/schedule', color: '#06b6d4' },
          { icon: Award, label: ar ? 'تقييمي' : 'My Scorecard', to: '/scorecard', color: '#f59e0b' },
          { icon: MessageCircle, label: ar ? 'الشات' : 'Chat', to: '/chat', color: '#22c55e' },
        ].map(a => (
          <button key={a.to} onClick={() => navigate(a.to)}
            className="flex items-center gap-2.5 p-3.5 rounded-2xl transition-all hover:bg-white/[0.06]"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${a.color}22`, color: a.color }}>
              <a.icon size={17} />
            </div>
            <span className="text-xs font-semibold text-slate-200">{a.label}</span>
          </button>
        ))}
      </div>

      {/* ── Notifications ── */}
      {notifs.length > 0 && (
        <div className="p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
            <Bell size={15} className="text-indigo-400" /> {ar ? 'الإشعارات' : 'Notifications'}
          </h2>
          <div className="space-y-1">
            {notifs.map(n => (
              <div key={n.id} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg"
                style={{ background: n.isRead ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.08)' }}>
                {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white truncate">{ar ? (n.titleAr || n.title) : (n.title || n.titleAr)}</p>
                  {(n.body || n.bodyAr) && <p className="text-[10px] text-slate-500 truncate">{ar ? (n.bodyAr || n.body) : (n.body || n.bodyAr)}</p>}
                </div>
                <span className="text-[9px] text-slate-600 flex-shrink-0">{fmtDT(n.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
