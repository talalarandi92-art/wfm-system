import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText, Plus, CheckCircle2, XCircle, Clock, AlertTriangle,
  Users, Calendar, ChevronDown, ChevronUp, Search, RefreshCw,
  ArrowLeftRight, Plane, Stethoscope, Heart, Gift, Home, UserCheck,
  X, Check, AlertCircle, Send, Loader2, Shield, Timer, TrendingUp,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/api/client';
import type { LinkedEmployee } from '@/types/auth.types';
import { useInjectDsStyles } from '@/components/ds';
import { fmtDate, fmtDateShort, fmtTime, fmtDuration, fixEncoding } from '@/utils/format';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Stats {
  pending: number;
  peer_pending: number;
  approved_week: number;
  rejected_week: number;
  overdue: number;
}

interface UnifiedRequest {
  id: string;
  type: string;
  typeNameAr: string;
  status: string;
  isUrgent?: boolean;
  slaDueAt?: string;
  requesterName: string;
  requesterEmployeeNo: string;
  requesterFunction: string;
  submittedAt: string;
  notes?: string;
  // Permission
  permissionDate?: string;
  permissionStart?: string;
  permissionEnd?: string;
  permissionDuration?: number;
  permissionType?: string;
  permissionReason?: string;
  // Swap
  swapType?: string;
  requesterDate?: string;
  requesterShift?: string;
  targetName?: string;
  targetDate?: string;
  targetShift?: string;
  peerAcceptedAt?: string;
  peerRejectedAt?: string;
  peerRejectionReason?: string;
  coverageCheckPassed?: boolean;
  restCheckPassed?: boolean;
  genderCheckPassed?: boolean;
  // Leave
  leaveType?: string;
  leaveStart?: string;
  leaveEnd?: string;
  leaveDays?: number;
  isHalfDay?: boolean;
  medicalCertRequired?: boolean;
  attachmentSubmitted?: boolean;
  // Approval
  approvedL1At?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

interface Employee {
  id: string;
  employee_no: string;
  full_name: string;
  gender: string;
  function_name: string;
  function_id: string;
  team_name?: string;
}

interface SwapCandidate extends Employee {
  scheduled_start: string;
  scheduled_end: string;
  shift_code?: string;
  same_function: boolean;
}

/** Map the auth-linked employee (camelCase API shape) to the page's Employee shape */
function linkedToEmployee(e: LinkedEmployee | null | undefined): Employee | null {
  if (!e) return null;
  return {
    id: e.id,
    employee_no: e.employeeNo,
    full_name: e.fullName,
    gender: e.gender,
    function_id: e.functionId ?? '',
    function_name: e.functionName ?? '',
  };
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const REQUEST_TYPES: Array<{
  code: string; labelAr: string; labelEn: string; icon: any; color: string;
  descAr: string; descEn: string; peer?: boolean;
}> = [
  { code: 'shift_swap',   labelAr: 'تبادل شيفت',    labelEn: 'Shift Swap',    icon: ArrowLeftRight, color: '#6366f1', descAr: 'تبادل وردية مع زميل',            descEn: 'Swap a shift with a colleague',       peer: true },
  { code: 'off_swap',     labelAr: 'تبادل أوف',      labelEn: 'Day Off Swap',  icon: ArrowLeftRight, color: '#8b5cf6', descAr: 'تبادل يوم إجازة مع زميل',         descEn: 'Swap a day off with a colleague',     peer: true },
  { code: 'annual_leave', labelAr: 'إجازة سنوية',   labelEn: 'Annual Leave',  icon: Plane,          color: '#0ea5e9', descAr: 'إجازة سنوية مدفوعة الأجر',       descEn: 'Paid annual leave',                              },
  { code: 'sick_leave',   labelAr: 'إجازة مرضية',   labelEn: 'Sick Leave',    icon: Stethoscope,    color: '#f59e0b', descAr: 'إجازة مرضية مع تقرير طبي',       descEn: 'Sick leave with medical certificate',            },
  { code: 'death_leave',  labelAr: 'إجازة وفاة',    labelEn: 'Bereavement',   icon: Heart,          color: '#64748b', descAr: 'إجازة الوفاة (3 أيام)',           descEn: 'Bereavement leave (3 days)',                     },
  { code: 'comp_off',     labelAr: 'يوم تعويضي',    labelEn: 'Comp Day',      icon: Gift,           color: '#10b981', descAr: 'استخدام يوم تعويضي',             descEn: 'Use a compensatory day off',                     },
  { code: 'wfh',          labelAr: 'عمل من المنزل', labelEn: 'Work From Home', icon: Home,          color: '#06b6d4', descAr: 'طلب العمل من المنزل',            descEn: 'Request to work from home',                      },
  { code: 'permission',   labelAr: 'استئذان',        labelEn: 'Permission',    icon: UserCheck,      color: '#ec4899', descAr: 'استئذان مبكر أو متأخر',           descEn: 'Early leave or late arrival',                    },
  { code: 'overtime',     labelAr: 'أوفر تايم',      labelEn: 'Overtime',      icon: Timer,          color: '#f97316', descAr: 'طلب ساعات إضافية',               descEn: 'Request overtime hours',                         },
];

const STATUS_CONFIG: Record<string, { ar: string; en: string; color: string; bg: string; icon: any }> = {
  pending:      { ar: 'قيد الانتظار',  en: 'Pending',        color: '#f59e0b', bg: 'rgba(245,158,11,.12)', icon: Clock },
  peer_pending: { ar: 'انتظار الزميل', en: 'Awaiting Peer',  color: '#8b5cf6', bg: 'rgba(139,92,246,.12)', icon: Users },
  approved:     { ar: 'موافق عليه',    en: 'Approved',       color: '#10b981', bg: 'rgba(16,185,129,.12)', icon: CheckCircle2 },
  rejected:     { ar: 'مرفوض',         en: 'Rejected',       color: '#ef4444', bg: 'rgba(239,68,68,.12)',  icon: XCircle },
  cancelled:    { ar: 'ملغى',          en: 'Cancelled',      color: '#64748b', bg: 'rgba(100,116,139,.12)', icon: X },
};

// fmt / fmtTime are now locale-aware — imported from @/utils/format
// Kept as thin wrappers so all existing call-sites continue to work
function fmt(d?: string, ar?: boolean) { return fmtDate(d, ar); }

/* ─── Stat Card ──────────────────────────────────────────────────────────── */
function StatCard({ label, value, icon: Icon, color, bg }: {
  label: string; value: number; icon: any; color: string; bg: string;
}) {
  return (
    <div className="card-stat rounded-2xl p-4 flex items-center gap-3 transition-all duration-200 hover:-translate-y-0.5 cursor-default"
      style={{ background: bg, border: `1px solid ${color}20` }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200"
        style={{ background: `${color}20` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-bold anim-countUp" style={{ color }}>{value}</div>
        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ─── Status Badge ───────────────────────────────────────────────────────── */
function StatusBadge({ status, ar }: { status: string; ar?: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
      <Icon size={11} />
      {ar ? cfg.ar : cfg.en}
    </span>
  );
}

/* ─── Type Badge ─────────────────────────────────────────────────────────── */
function TypeBadge({ type, ar }: { type: string; ar?: boolean }) {
  const cfg = REQUEST_TYPES.find(r => r.code === type);
  if (!cfg) return <span className="text-xs text-slate-400">{type}</span>;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-all duration-150"
      style={{ background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}25` }}>
      <Icon size={10} />
      {ar ? cfg.labelAr : cfg.labelEn}
    </span>
  );
}

/* ─── HC Impact Panel ────────────────────────────────────────────────────── */
interface HcDateRow {
  date: string;
  scheduledHc: number;
  afterApproval: number;
  requesterScheduled?: boolean;
  requiredHc: number;
  gap: number;
  risk: 'ok' | 'warning' | 'critical';
}
interface HcImpactData {
  type: string;
  functionName?: string;
  requesterName?: string;
  dates?: HcDateRow[];
  summary?: string;
  summaryAr?: string;
  overallRisk?: 'ok' | 'warning' | 'critical';
  // Permission-specific
  permissionDate?: string;
  permissionTime?: string;
  durationMinutes?: number;
  scheduledHcOnDate?: number;
  afterApproval?: number;
  requesterScheduled?: boolean;
  requesterNotScheduledDays?: number;
  requesterShift?: string | null;
  hourly?: Array<{
    hour: number;
    label: string;
    scheduled: number;
    afterApproval: number;
    requesterWorking: boolean;
    gap: number;
    risk: 'ok' | 'warning' | 'critical';
  }>;
  risk?: string;
  // Swap-specific
  targetName?: string;
  swapNote?: string;
  validationSummary?: { restCheckPassed: boolean; genderCheckPassed: boolean; coverageCheckPassed: boolean };
}

const RISK_STYLE: Record<string, { color: string; bg: string; ar: string; en: string }> = {
  ok:       { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  ar: 'آمن',    en: 'Safe'     },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  ar: 'تحذير',  en: 'Warning'  },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   ar: 'حرج',    en: 'Critical' },
};

function HcImpactPanel({ requestId, dark, ar = true }: { requestId: string; dark: boolean; ar?: boolean }) {
  const [data, setData] = useState<HcImpactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    if (loaded) return;
    setLoading(true);
    apiClient.get(`/requests/${requestId}/hc-impact`)
      .then(r => { setData(r.data); setLoaded(true); })
      .catch(() => setLoaded(true))
      .finally(() => setLoading(false));
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
      <Loader2 size={12} className="animate-spin" />
      {ar ? 'جاري حساب تأثير الهيدكاونت...' : 'Calculating HC impact...'}
    </div>
  );

  if (!loaded) return (
    <button onClick={load}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition-all hover:brightness-110 active:scale-95"
      style={{ background: 'rgba(99,102,241,0.08)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
      <Users size={12} /> {ar ? 'عرض تأثير الهيدكاونت' : 'View HC Impact'}
    </button>
  );

  if (!data) return null;

  const riskStyle = RISK_STYLE[data.overallRisk ?? data.risk ?? 'ok'];

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${riskStyle.color}25`, background: riskStyle.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Users size={13} style={{ color: riskStyle.color }} />
          <span className="text-xs font-semibold" style={{ color: riskStyle.color }}>
            {ar ? 'تأثير الهيدكاونت' : 'HC Impact'} — {data.functionName ?? ''}
          </span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
          style={{ background: riskStyle.bg, color: riskStyle.color, border: `1px solid ${riskStyle.color}40` }}>
          {ar ? riskStyle.ar : riskStyle.en}
        </span>
      </div>

      {/* Summary */}
      {data.summary && (
        <div className="px-3 pb-2 text-xs text-slate-400">
          {fixEncoding(ar ? (data.summaryAr ?? data.summary) : (data.summary ?? data.summaryAr))}
        </div>
      )}

      {/* Leave: date grid */}
      {data.dates && data.dates.length > 0 && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-5 gap-1 text-[10px] text-slate-500 mb-1.5 px-1">
            <div>{ar ? 'التاريخ' : 'Date'}</div>
            <div className="text-center">{ar ? 'مجدول' : 'Sched.'}</div>
            <div className="text-center">{ar ? 'بعد الموافقة' : 'After Appr.'}</div>
            <div className="text-center">{ar ? 'المطلوب' : 'Required'}</div>
            <div className="text-center">{ar ? 'الفجوة' : 'Gap'}</div>
          </div>
          {data.dates.map((d, i) => {
            const rs = RISK_STYLE[d.risk] ?? RISK_STYLE.ok;
            const notScheduled = d.requesterScheduled === false;
            const delta = d.scheduledHc - d.afterApproval;
            return (
              <div key={i} className="rounded-lg px-1 py-1.5 mb-0.5"
                style={{ background: d.risk !== 'ok' ? rs.bg : 'transparent' }}>
                <div className="grid grid-cols-5 gap-1 text-xs">
                  <div className="text-slate-400 font-mono text-[10px]">
                    {fmtDateShort(d.date)}
                  </div>
                  <div className="text-center font-semibold text-slate-700 dark:text-slate-300">{d.scheduledHc}</div>
                  <div className="text-center font-bold" style={{ color: delta > 0 ? '#f87171' : '#94a3b8' }}>
                    {d.afterApproval}
                    {delta > 0 && <span className="text-[9px] ms-1 opacity-80">(-{delta})</span>}
                  </div>
                  <div className="text-center text-slate-500">{d.requiredHc}</div>
                  <div className="text-center">
                    {d.gap > 0
                      ? <span className="font-bold" style={{ color: rs.color }}>-{d.gap}</span>
                      : <span className="text-emerald-500">✓</span>}
                  </div>
                </div>
                {notScheduled && (
                  <div className="text-[9px] text-amber-400/90 mt-0.5 px-1">
                    {ar ? '⚠ غير مجدول للعمل هذا اليوم — العدد لن يتغير بالموافقة' : '⚠ Not scheduled this day — count won\'t change on approval'}
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-2 flex gap-3 text-[10px] text-slate-500 px-1">
            <span><span className="text-emerald-400">✓</span> = {ar ? 'تغطية كافية' : 'Sufficient coverage'}</span>
            <span><span className="text-amber-400">{ar ? 'تحذير' : 'Warn'}</span> = {ar ? 'قريب من الحد' : 'Near threshold'}</span>
            <span><span className="text-red-400">{ar ? 'حرج' : 'Crit'}</span> = {ar ? 'أقل من المطلوب' : 'Below required'}</span>
          </div>
        </div>
      )}

      {/* Permission: not-scheduled warning */}
      {data.type === 'permission' && data.requesterScheduled === false && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-[11px] font-medium text-amber-400"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          {ar ? '⚠️ الموظف غير مجدول للعمل في هذا اليوم — تحقق من تاريخ الاستئذان' : '⚠️ Employee not scheduled this day — verify the permission date'}
        </div>
      )}

      {/* Permission: hourly breakdown */}
      {data.type === 'permission' && (
        <div className="px-3 pb-3 space-y-2">
          {/* Context row */}
          <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-400">
            {data.permissionTime && <span>{ar ? 'وقت الاستئذان:' : 'Time:'} <span className="font-bold text-slate-700 dark:text-slate-300">
              {data.permissionTime.replace(/(\d{1,2}):(\d{2})/g, (_, hh, mm) => {
                const hr = parseInt(hh, 10);
                const isPm = hr >= 12;
                const h12 = hr % 12 === 0 ? 12 : hr % 12;
                return `${h12}:${mm} ${ar ? (isPm ? 'م' : 'ص') : (isPm ? 'PM' : 'AM')}`;
              })}
            </span></span>}
            {data.durationMinutes !== undefined && <span>{ar ? 'المدة:' : 'Duration:'} <span className="font-bold text-slate-700 dark:text-slate-300">{fmtDuration(data.durationMinutes, ar)}</span></span>}
            {data.requesterShift && <span>{ar ? 'شفت الموظف:' : 'Shift:'} <span className="font-bold text-slate-700 dark:text-slate-300">{data.requesterShift}</span></span>}
          </div>

          {/* Hour-by-hour table */}
          {data.hourly && data.hourly.length > 0 && (
            <div>
              <div className="grid grid-cols-4 gap-1 text-[10px] text-slate-500 mb-1 px-1">
                <div>{ar ? 'الساعة' : 'Hour'}</div>
                <div className="text-center">{ar ? 'موجود' : 'Present'}</div>
                <div className="text-center">{ar ? 'بعد الموافقة' : 'After Appr.'}</div>
                <div className="text-center">{ar ? 'الحالة' : 'Status'}</div>
              </div>
              {data.hourly.map((h, i) => {
                const rs = RISK_STYLE[h.risk] ?? RISK_STYLE.ok;
                const delta = h.scheduled - h.afterApproval;
                return (
                  <div key={i} className="grid grid-cols-4 gap-1 rounded-lg px-1 py-1.5 mb-0.5 text-xs items-center"
                    style={{ background: h.risk !== 'ok' ? rs.bg : dark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)' }}>
                    <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                      {h.label?.replace(/(\d{1,2}):(\d{2})/g, (_, hh, mm) => {
                        const hr = parseInt(hh, 10);
                        const isPm = hr >= 12;
                        const h12 = hr % 12 === 0 ? 12 : hr % 12;
                        const ampm = ar ? (isPm ? 'م' : 'ص') : (isPm ? 'PM' : 'AM');
                        return `${h12}:${mm} ${ampm}`;
                      }) ?? h.label}
                      {!h.requesterWorking && (
                        <span className="block text-[8px] text-slate-500">{ar ? 'خارج شفت الموظف' : 'Outside shift'}</span>
                      )}
                    </div>
                    <div className="text-center font-semibold text-slate-700 dark:text-slate-300">{h.scheduled}</div>
                    <div className="text-center font-bold" style={{ color: delta > 0 ? rs.color : '#94a3b8' }}>
                      {h.afterApproval}
                      {delta > 0 && <span className="text-[9px] ms-1 opacity-80">(-{delta})</span>}
                    </div>
                    <div className="text-center">
                      {h.risk === 'ok'
                        ? <span className="text-emerald-500">✓</span>
                        : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: rs.bg, color: rs.color }}>
                            {h.risk === 'critical' ? (ar ? 'حرج' : 'Crit') : (ar ? 'تحذير' : 'Warn')}
                          </span>}
                    </div>
                  </div>
                );
              })}
              <div className="mt-1.5 text-[9px] text-slate-500 px-1">
                {ar
                  ? '"موجود" = عدد موظفي الفانكشن الذين يغطي شفتهم هذه الساعة فعلياً (شامل الشفتات العابرة لمنتصف الليل)'
                  : '"Present" = number of function staff whose shift covers this hour (including cross-midnight shifts)'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Swap: validation summary */}
      {data.swapNote && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-xs text-slate-400">{data.swapNote}</div>
          {data.validationSummary && (
            <div className="flex gap-4">
              <ValidationBadge passed={data.validationSummary.restCheckPassed} labelAr="قاعدة الراحة" labelEn="Rest Rule" ar={ar} />
              <ValidationBadge passed={data.validationSummary.genderCheckPassed} labelAr="قاعدة الجنس" labelEn="Gender Rule" ar={ar} />
              <ValidationBadge passed={data.validationSummary.coverageCheckPassed} labelAr="التغطية" labelEn="Coverage" ar={ar} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Validation Check ───────────────────────────────────────────────────── */
function ValidationBadge({ passed, labelAr, labelEn, ar }: { passed?: boolean; labelAr: string; labelEn: string; ar: boolean }) {
  if (passed === undefined) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {passed
        ? <CheckCircle2 size={13} className="text-emerald-400" />
        : <XCircle size={13} className="text-red-400" />}
      <span className={passed ? 'text-emerald-400' : 'text-red-400'}>{ar ? labelAr : labelEn}</span>
    </div>
  );
}

/* ─── Request Card ───────────────────────────────────────────────────────── */
function RequestCard({
  req, dark, onApprove, onReject, onPeerAccept, onPeerReject,
  currentEmployeeId, refetch,
}: {
  req: UnifiedRequest; dark: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onPeerAccept: (id: string, empId: string) => void;
  onPeerReject: (id: string, empId: string, reason: string) => void;
  currentEmployeeId?: string;
  refetch: () => void;
}) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [expanded, setExpanded] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [peerRejectReason, setPeerRejectReason] = useState('');
  const [showPeerReject, setShowPeerReject] = useState(false);

  const cardBg = dark ? 'rgba(15,21,40,0.7)' : 'rgba(255,255,255,0.85)';
  const borderColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  const isSwap = req.type === 'shift_swap' || req.type === 'off_swap';
  const isPeerPending = req.status === 'peer_pending';
  const isPending = req.status === 'pending';
  const isMine = currentEmployeeId && req.swapType !== undefined
    && req.status === 'peer_pending'; // simplified — in real app compare target_employee_id

  return (
    <div className="rounded-2xl overflow-hidden transition-all duration-200"
      style={{ background: cardBg, border: `1px solid ${borderColor}`, boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.06)' }}>

      {/* Header row */}
      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={req.type} ar={ar} />
            <StatusBadge status={req.status} ar={ar} />
            {req.isUrgent && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/25 font-bold">{ar ? 'عاجل' : 'Urgent'}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-900'}`}>{fixEncoding(req.requesterName)}</span>
            <span className="text-xs text-slate-500">#{req.requesterEmployeeNo}</span>
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs text-slate-400">{fixEncoding(req.requesterFunction)}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{fmt(req.submittedAt)}</div>
        </div>

        {/* Right side summary */}
        <div className="text-right flex-shrink-0 hidden sm:block">
          {isSwap && req.requesterDate && (
            <div className="text-xs text-slate-400">
              {fmt(req.requesterDate)} ↔ {fmt(req.targetDate)}
            </div>
          )}
          {(req.leaveStart || req.leaveEnd) && (
            <div className="text-xs text-slate-400">
              {fmt(req.leaveStart)} → {fmt(req.leaveEnd)}
              {req.leaveDays && <span className="ms-1 text-indigo-400">({req.leaveDays} {ar ? 'أيام' : 'days'})</span>}
            </div>
          )}
          {req.permissionDate && (
            <div className="text-xs text-slate-400">
              {fmt(req.permissionDate, ar)} {fmtTime(req.permissionStart, ar)} - {fmtTime(req.permissionEnd, ar)}
            </div>
          )}
        </div>

        {expanded ? <ChevronUp size={16} className="text-slate-500 flex-shrink-0" />
                  : <ChevronDown size={16} className="text-slate-500 flex-shrink-0" />}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-4 py-4 space-y-4"
          style={{ borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>

          {/* Swap details */}
          {isSwap && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div className="text-xs text-indigo-400 font-medium mb-1">{ar ? 'الموظف الطالب' : 'Requester'}</div>
                <div className={`text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-900'}`}>{fixEncoding(req.requesterName)}</div>
                <div className="text-xs text-slate-400">{fmt(req.requesterDate, ar)}</div>
                {req.requesterShift && <div className="mt-1 text-xs px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 inline-block">{req.requesterShift}</div>}
              </div>
              <div className="rounded-xl p-3" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)' }}>
                <div className="text-xs text-purple-400 font-medium mb-1">{ar ? 'الموظف الثاني' : 'Target'}</div>
                <div className={`text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-900'}`}>{fixEncoding(req.targetName ?? '—')}</div>
                <div className="text-xs text-slate-400">{fmt(req.targetDate)}</div>
                {req.targetShift && <div className="mt-1 text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 inline-block">{req.targetShift}</div>}
              </div>
            </div>
          )}

          {/* Swap validation */}
          {isSwap && (
            <div className="flex flex-wrap gap-4">
              <ValidationBadge passed={req.restCheckPassed} labelAr="قاعدة الراحة 10س" labelEn="10h Rest Rule" ar={ar} />
              <ValidationBadge passed={req.genderCheckPassed} labelAr="قاعدة الجنس" labelEn="Gender Rule" ar={ar} />
              <ValidationBadge passed={req.coverageCheckPassed} labelAr="التغطية" labelEn="Coverage" ar={ar} />
            </div>
          )}

          {/* Peer flow status */}
          {isSwap && (
            <div className="text-xs text-slate-400">
              {req.peerAcceptedAt && <span className="text-emerald-400">✓ {ar ? `وافق الزميل ${fmt(req.peerAcceptedAt, ar)}` : `Peer accepted ${fmt(req.peerAcceptedAt, ar)}`}</span>}
              {req.peerRejectedAt && <span className="text-red-400">✗ {ar ? `رفض الزميل ${fmt(req.peerRejectedAt, ar)} — ${fixEncoding(req.peerRejectionReason)}` : `Peer rejected ${fmt(req.peerRejectedAt, ar)} — ${fixEncoding(req.peerRejectionReason)}`}</span>}
              {!req.peerAcceptedAt && !req.peerRejectedAt && isPeerPending && (
                <span className="text-amber-400">⏳ {ar ? `بانتظار موافقة ${fixEncoding(req.targetName)}` : `Awaiting ${fixEncoding(req.targetName)}'s approval`}</span>
              )}
            </div>
          )}

          {/* Leave details */}
          {req.leaveStart && (
            <div className="flex gap-4 text-xs">
              <div><span className="text-slate-500">{ar ? 'من:' : 'From:'}</span> <span className="text-slate-800 dark:text-slate-200">{fmt(req.leaveStart)}</span></div>
              <div><span className="text-slate-500">{ar ? 'إلى:' : 'To:'}</span> <span className="text-slate-800 dark:text-slate-200">{fmt(req.leaveEnd)}</span></div>
              <div><span className="text-slate-500">{ar ? 'المدة:' : 'Duration:'}</span> <span className="text-indigo-300">{req.leaveDays} {ar ? 'يوم' : 'd'}</span></div>
              {req.isHalfDay && <div className="text-amber-400">{ar ? 'نصف يوم' : 'Half day'}</div>}
              {req.medicalCertRequired && (
                <div className={req.attachmentSubmitted ? 'text-emerald-400' : 'text-red-400'}>
                  {req.attachmentSubmitted ? (ar ? '✓ تقرير طبي مرفق' : '✓ Medical cert attached') : (ar ? '⚠ تقرير طبي مطلوب' : '⚠ Medical cert required')}
                </div>
              )}
            </div>
          )}

          {/* Permission details */}
          {req.permissionDate && (
            <div className="space-y-1.5">
              <div className="flex gap-4 text-xs flex-wrap">
                <div><span className="text-slate-500">{ar ? 'التاريخ:' : 'Date:'}</span> <span className="text-slate-800 dark:text-slate-200">{fmt(req.permissionDate, ar)}</span></div>
                <div><span className="text-slate-500">{ar ? 'من:' : 'From:'}</span> <span className="text-slate-800 dark:text-slate-200">{fmtTime(req.permissionStart, ar)}</span></div>
                <div><span className="text-slate-500">{ar ? 'إلى:' : 'To:'}</span> <span className="text-slate-800 dark:text-slate-200">{fmtTime(req.permissionEnd, ar)}</span></div>
                <div><span className="text-slate-500">{ar ? 'المدة:' : 'Duration:'}</span> <span className="text-indigo-300">{fmtDuration(req.permissionDuration, ar)}</span></div>
              </div>
              {req.permissionType && (() => {
                const PERM_TYPE_LABELS: Record<string, { ar: string; en: string; color: string }> = {
                  late_in:             { ar: 'تأخير دخول',  en: 'Late In',       color: '#f59e0b' },
                  early_out:           { ar: 'خروج مبكر',   en: 'Early Out',     color: '#ef4444' },
                  temp_out:            { ar: 'خروج مؤقت',   en: 'Temp Out',      color: '#6366f1' },
                  return_during_shift: { ar: 'رجوع للوردية', en: 'Return',        color: '#10b981' },
                };
                const cfg = PERM_TYPE_LABELS[req.permissionType] ?? { ar: req.permissionType, en: req.permissionType, color: '#94a3b8' };
                return (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-medium"
                    style={{ background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
                    {ar ? cfg.ar : cfg.en}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Notes */}
          {req.notes && (
            <div className="text-xs text-slate-400 italic">"{fixEncoding(req.notes)}"</div>
          )}

          {/* HC Impact Panel — lazy loaded on expand */}
          <HcImpactPanel requestId={req.id} dark={dark} ar={ar} />

          {/* Rejection reason */}
          {req.status === 'rejected' && req.rejectionReason && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
              {ar ? 'سبب الرفض:' : 'Rejection reason:'} {req.rejectionReason}
            </div>
          )}

          {/* Action buttons */}
          {(isPending || isPeerPending) && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {/* WFM can approve pending requests */}
              {isPending && (
                <>
                  <button
                    onClick={() => onApprove(req.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                    style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <Check size={13} /> {ar ? 'موافقة' : 'Approve'}
                  </button>
                  {!showReject ? (
                    <button
                      onClick={() => setShowReject(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <X size={13} /> {ar ? 'رفض' : 'Reject'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 w-full">
                      <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder={ar ? 'سبب الرفض...' : 'Rejection reason...'}
                        className="flex-1 bg-transparent border rounded-xl px-3 py-1.5 text-xs outline-none"
                        style={{ borderColor: 'rgba(239,68,68,0.3)', color: dark ? '#f1f5f9' : '#1e293b' }}
                        autoFocus
                      />
                      <button
                        onClick={() => { onReject(req.id, rejectReason || (ar ? 'مرفوض' : 'Rejected')); setShowReject(false); }}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium"
                        style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                        {ar ? 'تأكيد الرفض' : 'Confirm'}
                      </button>
                      <button onClick={() => setShowReject(false)} className="text-slate-500 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                    </div>
                  )}
                </>
              )}

              {/* Peer acceptance panel — shown when status is peer_pending */}
              {isPeerPending && isSwap && (
                <div className="w-full rounded-xl p-3" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <div className="text-xs text-purple-400 font-medium mb-2">🔄 {ar ? 'هذا الطلب يستلزم موافقتك كالموظف الثاني' : 'This swap requires your acceptance as the target employee'}</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onPeerAccept(req.id, '')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
                      style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}>
                      <Check size={13} /> {ar ? 'أوافق على التبادل' : 'Accept Swap'}
                    </button>
                    {!showPeerReject ? (
                      <button
                        onClick={() => setShowPeerReject(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <X size={13} /> {ar ? 'أرفض التبادل' : 'Reject Swap'}
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          value={peerRejectReason}
                          onChange={e => setPeerRejectReason(e.target.value)}
                          placeholder={ar ? 'سبب الرفض...' : 'Reason...'}
                          className="flex-1 bg-transparent border rounded-xl px-3 py-1.5 text-xs outline-none"
                          style={{ borderColor: 'rgba(239,68,68,0.3)', color: dark ? '#f1f5f9' : '#1e293b' }}
                          autoFocus
                        />
                        <button
                          onClick={() => { onPeerReject(req.id, '', peerRejectReason || (ar ? 'رفض الموظف' : 'Rejected')); setShowPeerReject(false); }}
                          className="px-3 py-1.5 rounded-xl text-xs"
                          style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                          {ar ? 'تأكيد' : 'Confirm'}
                        </button>
                        <button onClick={() => setShowPeerReject(false)} className="text-slate-500 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Submit Form ─────────────────────────────────────────────────────────── */
function SubmitForm({ dark, onSuccess }: { dark: boolean; onSuccess: () => void }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  // Account linked to an employee record → that employee, always (no picking)
  const authLinked = linkedToEmployee(useAuthStore(s => s.user?.employee));
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  // Priority: account-linked employee > remembered choice (shared with "طلباتي" tab)
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(() => {
    if (authLinked) return authLinked;
    try { return JSON.parse(localStorage.getItem('wfm_my_employee') ?? 'null'); } catch { return null; }
  });

  // When /auth/me rehydrates after a page refresh, adopt the linked employee
  useEffect(() => {
    if (authLinked && selectedEmp?.id !== authLinked.id) setSelectedEmp(authLinked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLinked?.id]);

  const pickEmployee = (emp: Employee) => {
    setSelectedEmp(emp);
    setEmpSearch('');
    localStorage.setItem('wfm_my_employee', JSON.stringify(emp));
  };
  const [form, setForm] = useState<Record<string, string>>({});
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SwapCandidate | null>(null);
  const [targetDate, setTargetDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [weeklyUsage, setWeeklyUsage] = useState<{ used: number; remaining: number; max: number; weekStart: string; weekEnd: string } | null>(null);

  // Load employees
  useEffect(() => {
    const timer = setTimeout(() => {
      apiClient.get('/requests/employees', { params: { search: empSearch || undefined } })
        .then(r => setEmployees(r.data))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [empSearch]);

  const selectedTypeCfg = REQUEST_TYPES.find(t => t.code === selectedType);
  const isSwapType = selectedType === 'shift_swap' || selectedType === 'off_swap';
  const isLeaveType = ['annual_leave','sick_leave','death_leave','comp_off','wfh'].includes(selectedType ?? '');

  // Load weekly permission quota when employee or permission date changes
  useEffect(() => {
    if (selectedType !== 'permission' || !selectedEmp) { setWeeklyUsage(null); return; }
    const date = form.permissionDate || new Date().toISOString().slice(0, 10);
    apiClient.get('/permission-requests/weekly-usage', {
      params: { employeeId: selectedEmp.id, date },
    }).then(r => setWeeklyUsage(r.data))
      .catch(() => setWeeklyUsage(null));
  }, [selectedType, selectedEmp, form.permissionDate]);

  // When requester + date changes for swaps, fetch candidates
  useEffect(() => {
    if (!isSwapType || !selectedEmp || !form.requesterDate) return;
    setLoadingCandidates(true);
    apiClient.get('/requests/swap-candidates', {
      params: { employeeId: selectedEmp.id, date: form.requesterDate },
    }).then(r => setSwapCandidates(r.data))
      .catch(() => {})
      .finally(() => setLoadingCandidates(false));
  }, [isSwapType, selectedEmp, form.requesterDate]);

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    if (!selectedEmp) { setError(ar ? 'اختر الموظف' : 'Select an employee'); return; }
    if (!selectedType) { setError(ar ? 'اختر نوع الطلب' : 'Select request type'); return; }

    setLoading(true);
    try {
      if (isSwapType) {
        if (!selectedTarget) { setError(ar ? 'اختر الموظف الثاني للتبادل' : 'Select the target employee'); setLoading(false); return; }
        if (!form.requesterDate) { setError(ar ? 'اختر تاريخ شيفت الموظف الأول' : 'Select requester shift date'); setLoading(false); return; }
        const tDate = targetDate || form.requesterDate;
        const res = await apiClient.post('/requests/shift-swap', {
          requesterEmployeeId: selectedEmp.id,
          requesterDate: form.requesterDate,
          targetEmployeeId: selectedTarget.id,
          targetDate: tDate,
          swapType: selectedType === 'off_swap' ? 'off' : 'shift',
          notes: form.notes,
        });
        setSuccess(res.data.message ?? (ar ? 'تم إرسال طلب التبادل' : 'Swap request submitted'));
      } else if (isLeaveType) {
        if (!form.startDate || !form.endDate) { setError(ar ? 'اختر تاريخ البداية والنهاية' : 'Select start and end dates'); setLoading(false); return; }
        const res = await apiClient.post('/requests/leave', {
          employeeId: selectedEmp.id,
          leaveType: selectedType,
          startDate: form.startDate,
          endDate: form.endDate,
          isHalfDay: form.isHalfDay === 'true',
          notes: form.notes,
        });
        setSuccess(res.data.message ?? (ar ? 'تم تقديم الطلب بنجاح' : 'Request submitted'));
      } else if (selectedType === 'permission') {
        if (!form.permissionDate || !form.startTime || !form.endTime) {
          setError(ar ? 'اكمل بيانات الاستئذان (التاريخ، من، إلى)' : 'Fill in date, from and to times'); setLoading(false); return;
        }
        if (!form.permissionType) {
          setError(ar ? 'اختر نوع الاستئذان' : 'Select permission type'); setLoading(false); return;
        }
        const sM = form.startTime.split(':').map(Number);
        const eM = form.endTime.split(':').map(Number);
        const durMins = (eM[0] * 60 + eM[1]) - (sM[0] * 60 + sM[1]);
        if (durMins < 30) {
          setError(ar ? `المدة المدخلة ${durMins} دقيقة — الحد الأدنى 30 دقيقة` : `Duration ${durMins} min — minimum is 30 min`); setLoading(false); return;
        }
        if (durMins > 180) {
          setError(ar ? `المدة المدخلة ${durMins} دقيقة — الحد الأقصى 180 دقيقة (3 ساعات)` : `Duration ${durMins} min — maximum is 180 min (3 hrs)`); setLoading(false); return;
        }
        await apiClient.post('/permission-requests', {
          employeeId: selectedEmp.id,
          permissionDate: form.permissionDate,
          startTime: form.startTime,
          endTime: form.endTime,
          permissionType: form.permissionType,
          reason: form.reason ?? '',
          isUrgent: false,
        });
        setSuccess(ar ? 'تم تقديم طلب الاستئذان بنجاح' : 'Permission request submitted');
      } else if (selectedType === 'overtime') {
        if (!form.startDate || !form.otStartTime || !form.otEndTime) {
          setError(ar ? 'اختر التاريخ ووقت البداية والنهاية' : 'Select date, start time and end time'); setLoading(false); return;
        }
        const [sh, sm] = form.otStartTime.split(':').map(Number);
        const [eh, em] = form.otEndTime.split(':').map(Number);
        let diffMins = (eh * 60 + em) - (sh * 60 + sm);
        if (diffMins < 0) diffMins += 24 * 60;
        const hrs = Math.round(diffMins / 60 * 10) / 10;
        if (hrs < 0.5) {
          setError(ar ? 'الحد الأدنى للأوفر تايم 30 دقيقة' : 'Minimum OT is 30 minutes'); setLoading(false); return;
        }
        const res = await apiClient.post('/requests/overtime', {
          employeeId: selectedEmp.id,
          otDate: form.startDate,
          startTime: form.otStartTime,
          endTime: form.otEndTime,
          hours: hrs,
          reason: form.reason ?? '',
          notes: form.notes ?? '',
        });
        setSuccess(res.data?.message ?? (ar ? 'تم تقديم طلب الأوفر تايم بنجاح' : 'Overtime request submitted'));
      }

      // Reset
      setTimeout(() => {
        setSuccess('');
        setSelectedType(null);
        setSelectedEmp(null);
        setEmpSearch('');
        setForm({});
        setSelectedTarget(null);
        setTargetDate('');
        onSuccess();
      }, 2000);
    } catch (e: any) {
      setError(e.response?.data?.message ?? (ar ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 12,
    padding: '8px 12px',
    fontSize: 13,
    color: dark ? '#f1f5f9' : '#1e293b',
    outline: 'none',
    width: '100%',
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'block' };

  return (
    <div className="space-y-5">
      {/* Step 1: Select type */}
      <div>
        <div className="text-xs font-medium text-slate-400 mb-3">{ar ? 'نوع الطلب' : 'Request Type'}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {REQUEST_TYPES.map(t => {
            const Icon = t.icon;
            const active = selectedType === t.code;
            return (
              <button key={t.code}
                onClick={() => { setSelectedType(t.code); setForm({}); setSelectedEmp(null); setSelectedTarget(null); }}
                className="rounded-xl p-3 text-start transition-all duration-150"
                style={{
                  background: active ? `${t.color}15` : dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: active ? `1.5px solid ${t.color}50` : `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
                  boxShadow: active ? `0 0 12px ${t.color}20` : 'none',
                }}>
                <Icon size={16} style={{ color: t.color }} className="mb-1.5" />
                <div className="text-xs font-semibold" style={{ color: active ? t.color : undefined }}>{ar ? t.labelAr : t.labelEn}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{ar ? t.descAr : t.descEn}</div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedType && (
        <>
          {/* Step 2: Employee — remembered automatically, change only when needed */}
          <div>
            <label style={labelStyle}>{ar ? 'الموظف' : 'Employee'}</label>

            {selectedEmp ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.22)' }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
                    {selectedEmp.full_name[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: dark ? '#e2e8f0' : '#1e293b' }}>
                      {selectedEmp.full_name}
                    </div>
                    <div className="text-[10px] text-slate-500">#{selectedEmp.employee_no} · {selectedEmp.function_name}</div>
                  </div>
                </div>
                {authLinked ? (
                  <span
                    className="text-[10px] px-2 py-1 rounded-lg flex-shrink-0 flex items-center gap-1"
                    style={{ color: '#34d399', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
                    <Shield size={10} /> {ar ? 'حسابك' : 'Your account'}
                  </span>
                ) : (
                  <button
                    onClick={() => { setSelectedEmp(null); setEmpSearch(''); }}
                    className="text-[11px] px-2.5 py-1 rounded-lg flex-shrink-0 transition-colors hover:bg-white/5"
                    style={{ color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
                    {ar ? 'تغيير' : 'Change'}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={empSearch}
                    onChange={e => setEmpSearch(e.target.value)}
                    placeholder={ar ? 'ابحث عن موظف...' : 'Search employee...'}
                    autoFocus
                    style={{ ...inputStyle, paddingInlineStart: 32 }}
                  />
                </div>
                {/* Dropdown */}
                {(empSearch || employees.length > 0) && (
                  <div className="mt-1 rounded-xl overflow-hidden max-h-48 overflow-y-auto"
                    style={{ background: dark ? '#0f1527' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                    {employees.slice(0, 10).map(e => (
                      <button key={e.id}
                        onClick={() => pickEmployee(e)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center text-xs font-bold text-indigo-500 dark:text-indigo-400 flex-shrink-0">
                          {e.full_name[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{e.full_name}</div>
                          <div className="text-[10px] text-slate-500">{e.employee_no} · {e.function_name}</div>
                        </div>
                      </button>
                    ))}
                    {employees.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">{ar ? 'لا نتائج' : 'No results'}</div>}
                  </div>
                )}
                <div className="text-[10px] text-slate-500 mt-1.5">
                  {ar ? 'سيتم حفظ اختيارك — لن تحتاج لاختياره مرة أخرى في الطلبات القادمة' : 'Your selection is saved — no need to re-select next time'}
                </div>
              </>
            )}
          </div>

          {/* Swap form */}
          {isSwapType && selectedEmp && (
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>{ar ? `تاريخ شيفت ${selectedEmp.full_name}` : `${selectedEmp.full_name}'s shift date`}</label>
                <input type="date" value={form.requesterDate ?? ''} onChange={e => setForm(f => ({ ...f, requesterDate: e.target.value }))} style={inputStyle} />
              </div>

              {form.requesterDate && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span style={labelStyle} className="mb-0">{ar ? 'اختر الموظف الثاني للتبادل' : 'Select target employee'}</span>
                      {loadingCandidates && <Loader2 size={12} className="text-indigo-400 animate-spin" />}
                    </div>
                    {swapCandidates.length > 0 ? (
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {swapCandidates.map(c => (
                          <button key={c.id}
                            onClick={() => { setSelectedTarget(c); setTargetDate(form.requesterDate ?? ''); }}
                            className="w-full flex items-center gap-3 rounded-xl px-3 py-2 text-start transition-all"
                            style={{
                              background: selectedTarget?.id === c.id ? 'rgba(99,102,241,0.12)' : dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                              border: selectedTarget?.id === c.id ? '1px solid rgba(99,102,241,0.3)' : `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                            }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                              style={{ background: c.same_function ? 'rgba(99,102,241,0.2)' : 'rgba(100,116,139,0.2)', color: c.same_function ? '#818cf8' : '#94a3b8' }}>
                              {c.full_name[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-slate-800 dark:text-slate-200">{c.full_name}</div>
                              <div className="text-[10px] text-slate-500">{c.function_name} {c.same_function && <span className="text-indigo-400">· {ar ? 'نفس الفانكشن' : 'Same function'}</span>}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              {c.shift_code
                                ? <span className="text-xs px-2 py-0.5 rounded-lg bg-slate-700 text-slate-300">{c.shift_code}</span>
                                : <span className="text-[10px] text-slate-500">{fmtTime(c.scheduled_start, ar)} - {fmtTime(c.scheduled_end, ar)}</span>
                              }
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      !loadingCandidates && (
                        <div className="rounded-xl p-3 text-xs text-slate-400 text-center"
                          style={{
                            background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
                            border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)',
                          }}>
                          {ar ? 'لا يوجد موظفون لديهم شيفت في هذا التاريخ' : 'No employees scheduled on this date'}
                        </div>
                      )
                    )}
                  </div>

                  {selectedTarget && selectedType === 'shift_swap' && (
                    <div>
                      <label style={labelStyle}>{ar ? `تاريخ شيفت ${selectedTarget.full_name} (اتركه نفس التاريخ أو عدّله)` : `${selectedTarget.full_name}'s shift date (keep same or change)`}</label>
                      <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} style={inputStyle} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Leave form */}
          {isLeaveType && selectedEmp && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>{ar ? 'من تاريخ' : 'From date'}</label>
                  <input type="date" value={form.startDate ?? ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{ar ? 'إلى تاريخ' : 'To date'}</label>
                  <input type="date" value={form.endDate ?? ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              {selectedType === 'sick_leave' && (
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <AlertCircle size={14} className="text-amber-400" />
                  <span className="text-xs text-amber-400">{ar ? 'يجب إرفاق تقرير طبي للإجازات المرضية' : 'A medical certificate is required for sick leave'}</span>
                </div>
              )}
              {selectedType === 'death_leave' && (
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)' }}>
                  <AlertCircle size={14} className="text-slate-400" />
                  <span className="text-xs text-slate-400">{ar ? 'إجازة الوفاة 3 أيام كحد أقصى وتبدأ من يوم الوفاة' : 'Bereavement leave is max 3 days starting from date of death'}</span>
                </div>
              )}
              {selectedType !== 'death_leave' && selectedType !== 'comp_off' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isHalfDay === 'true'}
                    onChange={e => setForm(f => ({ ...f, isHalfDay: e.target.checked ? 'true' : 'false' }))}
                    className="rounded" />
                  <span className="text-xs text-slate-400">{ar ? 'نصف يوم' : 'Half day'}</span>
                </label>
              )}
            </div>
          )}

          {/* Permission form */}
          {selectedType === 'permission' && selectedEmp && (
            <div className="space-y-3">

              {/* Weekly quota banner */}
              {weeklyUsage && (
                <div className="rounded-xl p-3 flex items-center justify-between"
                  style={{
                    background: weeklyUsage.remaining === 0 ? 'rgba(239,68,68,0.08)' : weeklyUsage.remaining === 1 ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.06)',
                    border: `1px solid ${weeklyUsage.remaining === 0 ? 'rgba(239,68,68,0.25)' : weeklyUsage.remaining === 1 ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.2)'}`,
                  }}>
                  <div className="flex items-center gap-2">
                    <Shield size={14} style={{ color: weeklyUsage.remaining === 0 ? '#ef4444' : weeklyUsage.remaining === 1 ? '#f59e0b' : '#10b981' }} />
                    <span className="text-xs font-medium" style={{ color: weeklyUsage.remaining === 0 ? '#fca5a5' : weeklyUsage.remaining === 1 ? '#fcd34d' : '#6ee7b7' }}>
                      {weeklyUsage.remaining === 0
                        ? (ar ? 'تجاوزت الحد الأقصى للأسبوع' : 'Weekly limit reached')
                        : (ar ? `متبقي ${weeklyUsage.remaining} استئذان هذا الأسبوع` : `${weeklyUsage.remaining} permission(s) remaining this week`)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: weeklyUsage.max }).map((_, i) => (
                      <div key={i} className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold"
                        style={{
                          background: i < weeklyUsage.used ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.1)',
                          color: i < weeklyUsage.used ? '#f87171' : '#6ee7b7',
                          border: `1px solid ${i < weeklyUsage.used ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.2)'}`,
                        }}>
                        {i < weeklyUsage.used ? '✓' : '○'}
                      </div>
                    ))}
                    <span className="text-[10px] text-slate-500 ms-1">{weeklyUsage.weekStart} – {weeklyUsage.weekEnd}</span>
                  </div>
                </div>
              )}

              {/* Permission type selector */}
              <div>
                <label style={labelStyle}>{ar ? 'نوع الاستئذان *' : 'Permission Type *'}</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { code: 'late_in',             labelAr: 'تأخير دخول',  labelEn: 'Late In',    icon: '🕐', color: '#f59e0b' },
                    { code: 'early_out',            labelAr: 'خروج مبكر',   labelEn: 'Early Out',  icon: '🚪', color: '#ef4444' },
                    { code: 'temp_out',             labelAr: 'خروج مؤقت',   labelEn: 'Temp Out',   icon: '↩️', color: '#6366f1' },
                    { code: 'return_during_shift',  labelAr: 'رجوع للوردية', labelEn: 'Return',    icon: '🔄', color: '#10b981' },
                  ] as const).map(pt => {
                    const active = form.permissionType === pt.code;
                    return (
                      <button key={pt.code}
                        onClick={() => setForm(f => ({ ...f, permissionType: pt.code }))}
                        className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-start transition-all"
                        style={{
                          background: active ? `${pt.color}15` : dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                          border: active ? `1.5px solid ${pt.color}50` : `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
                          boxShadow: active ? `0 0 10px ${pt.color}18` : 'none',
                        }}>
                        <span className="text-base leading-none">{pt.icon}</span>
                        <span className="text-xs font-medium" style={{ color: active ? pt.color : undefined }}>{ar ? pt.labelAr : pt.labelEn}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={labelStyle}>{ar ? 'تاريخ الاستئذان' : 'Permission Date'}</label>
                <input type="date" value={form.permissionDate ?? ''} onChange={e => setForm(f => ({ ...f, permissionDate: e.target.value }))} style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>{ar ? 'من الساعة' : 'From time'}</label>
                  <input type="time" value={form.startTime ?? ''} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{ar ? 'إلى الساعة' : 'To time'}</label>
                  <input type="time" value={form.endTime ?? ''} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} style={inputStyle} />
                </div>
              </div>

              {/* Live duration feedback */}
              {form.startTime && form.endTime && (() => {
                const sM = form.startTime.split(':').map(Number);
                const eM = form.endTime.split(':').map(Number);
                const dur = (eM[0] * 60 + eM[1]) - (sM[0] * 60 + sM[1]);
                if (isNaN(dur) || dur <= 0) return null;
                const tooShort = dur < 30;
                const tooLong  = dur > 180;
                const color    = tooShort || tooLong ? '#ef4444' : '#10b981';
                const durLabel = fmtDuration(dur, ar);
                return (
                  <div className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg"
                    style={{ background: tooShort || tooLong ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.07)', color }}>
                    <Timer size={12} />
                    <span>{ar ? 'المدة:' : 'Duration:'} {durLabel}</span>
                    {tooShort && <span> — {ar ? 'الحد الأدنى 30 دقيقة' : 'min 30 min'}</span>}
                    {tooLong  && <span> — {ar ? 'الحد الأقصى 3 ساعات' : 'max 3 hrs'}</span>}
                    {!tooShort && !tooLong && <span className="text-emerald-400"> ✓</span>}
                  </div>
                );
              })()}

              <div>
                <label style={labelStyle}>{ar ? 'سبب الاستئذان' : 'Reason'}</label>
                <input value={form.reason ?? ''} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder={ar ? 'السبب...' : 'Reason...'} style={inputStyle} />
              </div>
            </div>
          )}

          {/* Overtime form */}
          {selectedType === 'overtime' && selectedEmp && (
            <div className="space-y-3">
              {/* OT section header */}
              <div className="flex items-center gap-2 pb-1" style={{ borderBottom:`1px solid ${dark?'rgba(249,115,22,0.2)':'rgba(249,115,22,0.15)'}` }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:'rgba(249,115,22,0.12)' }}>
                  <Timer size={14} style={{ color:'#fb923c' }} />
                </div>
                <span className="text-xs font-semibold" style={{ color:'#fb923c' }}>
                  {ar ? 'تفاصيل الأوفر تايم' : 'Overtime Details'}
                </span>
              </div>

              {/* Date */}
              <div>
                <label style={labelStyle}>{ar ? 'تاريخ الأوفر تايم' : 'OT Date'}</label>
                <input type="date" value={form.startDate ?? ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
              </div>

              {/* From / To */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>{ar ? 'من وقت' : 'From'}</label>
                  <input type="time" value={form.otStartTime ?? ''} onChange={e => setForm(f => ({ ...f, otStartTime: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{ar ? 'إلى وقت' : 'To'}</label>
                  <input type="time" value={form.otEndTime ?? ''} onChange={e => setForm(f => ({ ...f, otEndTime: e.target.value }))} style={inputStyle} />
                </div>
              </div>

              {/* Auto-calculated total + punch comparison */}
              {(() => {
                const calcMins = (s: string, e: string) => {
                  if (!s || !e) return null;
                  const [sh, sm] = s.split(':').map(Number);
                  const [eh, em] = e.split(':').map(Number);
                  let diff = (eh * 60 + em) - (sh * 60 + sm);
                  if (diff < 0) diff += 24 * 60; // cross-midnight
                  return diff;
                };
                const otMins = calcMins(form.otStartTime ?? '', form.otEndTime ?? '');
                const emp = selectedEmp as any;
                const punchMins = calcMins(emp.punchIn ?? emp.punch_in ?? '', emp.punchOut ?? emp.punch_out ?? '');
                const sysMins   = calcMins(emp.loginSystem ?? emp.login_system ?? '', emp.logoutSystem ?? emp.logout_system ?? '');
                const fmt = (m: number) => `${Math.floor(m/60)}h ${m%60 > 0 ? (m%60)+'m' : ''}`.trim();
                const fmtAr = (m: number) => `${Math.floor(m/60)} س ${m%60 > 0 ? (m%60)+' د' : ''}`.trim();
                if (otMins === null) return null;
                const otH = Math.floor(otMins / 60);
                const otM = otMins % 60;
                const statusColor = otMins <= 120 ? '#22c55e' : otMins <= 240 ? '#f59e0b' : '#ef4444';
                const statusLabel = otMins <= 120
                  ? (ar ? 'معتدل' : 'Moderate')
                  : otMins <= 240 ? (ar ? 'طويل' : 'Long')
                  : (ar ? 'مرتفع جداً' : 'Very High');
                return (
                  <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid rgba(249,115,22,0.25)` }}>
                    {/* Header */}
                    <div className="px-4 py-2.5 flex items-center justify-between" style={{ background:'rgba(249,115,22,0.1)' }}>
                      <div className="flex items-center gap-2">
                        <Timer size={13} style={{ color:'#fb923c' }} />
                        <span className="text-xs font-semibold" style={{ color:'#fb923c' }}>
                          {ar ? 'ملخص الأوفر تايم' : 'OT Summary'}
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: statusColor+'22', color: statusColor, border:`1px solid ${statusColor}44` }}>
                        {statusLabel}
                      </span>
                    </div>
                    {/* Big total */}
                    <div className="px-4 py-3 flex items-center justify-between" style={{ background: dark ? 'rgba(249,115,22,0.04)' : 'rgba(249,115,22,0.03)' }}>
                      <span className="text-xs" style={{ color:'#64748b' }}>{ar ? 'الإجمالي' : 'Total'}</span>
                      <div className="flex items-baseline gap-1">
                        {otH > 0 && <><span className="text-2xl font-black" style={{ color:'#fb923c' }}>{otH}</span><span className="text-xs font-bold" style={{ color:'#94a3b8' }}>{ar ? 'س' : 'h'}</span></>}
                        {otM > 0 && <><span className="text-2xl font-black" style={{ color:'#fb923c' }}>{otM}</span><span className="text-xs font-bold" style={{ color:'#94a3b8' }}>{ar ? 'د' : 'm'}</span></>}
                      </div>
                    </div>
                    {/* Comparison rows */}
                    {(sysMins !== null || punchMins !== null) && (
                      <div className="px-4 pb-3 pt-1 space-y-2" style={{ borderTop:`1px solid rgba(249,115,22,0.12)`, background: dark ? 'rgba(249,115,22,0.04)' : 'rgba(249,115,22,0.03)' }}>
                        {sysMins !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-[11px]" style={{ color:'#64748b' }}>{ar ? 'السيستم' : 'System'}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold" style={{ color:'#38bdf8' }}>{ar ? fmtAr(sysMins) : fmt(sysMins)}</span>
                              {(() => {
                                const diff = otMins - sysMins;
                                const isOver = diff > 0;
                                return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: isOver ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.12)', color: isOver ? '#f87171' : '#4ade80' }}>
                                  {isOver ? '+' : '-'}{fmt(Math.abs(diff))}
                                </span>;
                              })()}
                            </div>
                          </div>
                        )}
                        {punchMins !== null && (
                          <div className="flex items-center justify-between">
                            <span className="text-[11px]" style={{ color:'#64748b' }}>{ar ? 'البصمة' : 'Punch'}</span>
                            <span className="text-xs font-semibold" style={{ color:'#a78bfa' }}>{ar ? fmtAr(punchMins) : fmt(punchMins)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <label style={labelStyle}>{ar ? 'سبب الأوفر تايم' : 'OT Reason'}</label>
                <input value={form.reason ?? ''} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder={ar ? 'السبب أو المهمة...' : 'Reason or task...'} style={inputStyle} />
              </div>
            </div>
          )}

          {/* Notes (all types) */}
          {selectedEmp && (
            <div>
              <label style={labelStyle}>{ar ? 'ملاحظات إضافية (اختياري)' : 'Additional notes (optional)'}</label>
              <input value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={ar ? 'ملاحظات...' : 'Notes...'} style={inputStyle} />
            </div>
          )}

          {/* Error/success */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7' }}>
              <CheckCircle2 size={14} /> {success}
            </div>
          )}

          {/* Submit */}
          {selectedEmp && (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
              style={{ background: selectedTypeCfg ? `linear-gradient(135deg, ${selectedTypeCfg.color}, ${selectedTypeCfg.color}cc)` : '#6366f1', color: '#fff', opacity: loading ? 0.6 : 1 }}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {loading ? (ar ? 'جاري الإرسال...' : 'Submitting...') : (ar ? 'تقديم الطلب' : 'Submit Request')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
/* ─── My Requests Tab ────────────────────────────────────────────────────── */
function MyRequests({ dark, showToast }: { dark: boolean; showToast: (msg: string, ok: boolean) => void }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(() => {
    try { return JSON.parse(localStorage.getItem('wfm_my_employee') ?? 'null'); } catch { return null; }
  });
  const [requests, setRequests] = useState<UnifiedRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const borderColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  // Search employees (debounced)
  useEffect(() => {
    if (!showPicker) return;
    const timer = setTimeout(() => {
      apiClient.get('/requests/employees', { params: { search: empSearch || undefined } })
        .then(r => setEmployees(r.data))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [empSearch, showPicker]);

  const fetchMine = useCallback(() => {
    if (!selectedEmp) { setRequests([]); return; }
    setLoading(true);
    const params: any = { employeeId: selectedEmp.id, limit: 50 };
    if (statusFilter) params.status = statusFilter;
    apiClient.get('/requests', { params })
      .then(r => setRequests(r.data.data ?? []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [selectedEmp, statusFilter]);

  useEffect(() => { fetchMine(); }, [fetchMine]);

  const pickEmployee = (emp: Employee) => {
    setSelectedEmp(emp);
    localStorage.setItem('wfm_my_employee', JSON.stringify(emp));
    setShowPicker(false);
    setEmpSearch('');
  };

  const handleCancel = async (id: string) => {
    if (!selectedEmp) return;
    setCancelling(id);
    try {
      await apiClient.patch(`/requests/${id}/cancel`, { employeeId: selectedEmp.id });
      showToast(ar ? 'تم إلغاء الطلب' : 'Request cancelled', true);
      setConfirmCancel(null);
      fetchMine();
    } catch (e: any) {
      showToast(e.response?.data?.message ?? (ar ? 'تعذر إلغاء الطلب' : 'Failed to cancel'), false);
    } finally {
      setCancelling(null);
    }
  };

  /** Compact summary line per request type */
  const reqSummary = (r: UnifiedRequest): string => {
    if (r.type === 'permission')
      return `${fmt(r.permissionDate, ar)} · ${fmtTime(r.permissionStart, ar)}–${fmtTime(r.permissionEnd, ar)} (${fmtDuration(r.permissionDuration, ar)})`;
    if (r.type === 'shift_swap' || r.type === 'off_swap')
      return `${fmt(r.requesterDate, ar)} ${ar ? 'مع' : 'with'} ${r.targetName ?? '—'}${r.targetDate && r.targetDate !== r.requesterDate ? ` (${fmt(r.targetDate, ar)})` : ''}`;
    if (r.leaveStart)
      return `${fmt(r.leaveStart, ar)} → ${fmt(r.leaveEnd, ar)} (${r.leaveDays ?? '—'} ${ar ? 'يوم' : 'd'})`;
    return fmt(r.submittedAt, ar);
  };

  return (
    <div className="space-y-4">
      {/* Employee selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-500">{ar ? 'الموظف:' : 'Employee:'}</span>
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all"
            style={{
              background: selectedEmp ? 'rgba(99,102,241,0.1)' : (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
              border: `1px solid ${selectedEmp ? 'rgba(99,102,241,0.3)' : borderColor}`,
              color: selectedEmp ? '#a5b4fc' : '#94a3b8',
            }}
          >
            <Users size={14} />
            {selectedEmp
              ? <span className="font-semibold">{selectedEmp.full_name} <span className="opacity-60 font-normal">#{selectedEmp.employee_no}</span></span>
              : (ar ? 'اختر الموظف لعرض طلباته' : 'Select employee to view requests')}
            <ChevronDown size={13} style={{ transform: showPicker ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
          </button>

          {/* Dropdown */}
          {showPicker && (
            <div
              className="absolute top-full mt-1 start-0 z-30 rounded-xl overflow-hidden w-80"
              style={{
                background: dark ? '#0f1626' : '#fff',
                border: `1px solid ${borderColor}`,
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
              }}
            >
              <input
                type="text"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                placeholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي...' : 'Search by name or ID...'}
                autoFocus
                className="w-full px-3 py-2.5 text-sm outline-none"
                style={{ background: 'transparent', borderBottom: `1px solid ${borderColor}`, color: dark ? '#f1f5f9' : '#0f172a' }}
              />
              <div className="max-h-64 overflow-y-auto">
                {employees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => pickEmployee(emp)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-indigo-500/10 transition-colors text-start"
                  >
                    <div>
                      <span className="font-semibold" style={{ color: dark ? '#e2e8f0' : '#1e293b' }}>{emp.full_name}</span>
                      <span className="text-slate-500 ms-2">#{emp.employee_no}</span>
                    </div>
                    <span className="text-slate-500 text-[10px]">{emp.function_name}</span>
                  </button>
                ))}
                {employees.length === 0 && (
                  <div className="px-3 py-4 text-xs text-slate-500 text-center">{ar ? 'لا نتائج' : 'No results'}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Status filter */}
        {selectedEmp && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs rounded-xl px-3 py-2 outline-none ms-auto"
            style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: `1px solid ${borderColor}`, color: dark ? '#94a3b8' : '#475569' }}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            <option value="pending">{ar ? 'معلق' : 'Pending'}</option>
            <option value="peer_pending">{ar ? 'انتظار الزميل' : 'Awaiting Peer'}</option>
            <option value="approved">{ar ? 'موافق' : 'Approved'}</option>
            <option value="rejected">{ar ? 'مرفوض' : 'Rejected'}</option>
            <option value="cancelled">{ar ? 'ملغى' : 'Cancelled'}</option>
          </select>
        )}
      </div>

      {/* No employee selected */}
      {!selectedEmp && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
          <Users size={32} className="opacity-30" />
          <div className="text-sm">{ar ? 'اختر الموظف من الأعلى لعرض طلباته' : 'Select an employee above to view their requests'}</div>
          <div className="text-[11px] opacity-60">{ar ? 'سيتم حفظ اختيارك تلقائياً' : 'Your selection will be remembered'}</div>
        </div>
      )}

      {/* Loading */}
      {selectedEmp && loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> {ar ? 'جاري التحميل...' : 'Loading...'}
        </div>
      )}

      {/* Empty */}
      {selectedEmp && !loading && requests.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
          <FileText size={32} className="opacity-30" />
          <div className="text-sm">{ar ? 'لا توجد طلبات لهذا الموظف' : 'No requests found for this employee'}</div>
        </div>
      )}

      {/* Requests list */}
      {selectedEmp && !loading && requests.map(req => {
        const canCancel = ['pending', 'peer_pending'].includes(req.status);
        const isConfirming = confirmCancel === req.id;
        return (
          <div key={req.id} className="rounded-2xl p-4 space-y-2.5"
            style={{ background: dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)', border: `1px solid ${borderColor}` }}>
            {/* Top row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <TypeBadge type={req.type} ar={ar} />
                <StatusBadge status={req.status} ar={ar} />
                {req.isUrgent && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>{ar ? 'عاجل' : 'Urgent'}</span>
                )}
              </div>
              <span className="text-[10px] text-slate-500">{ar ? `قُدّم ${fmt(req.submittedAt)}` : fmt(req.submittedAt)}</span>
            </div>

            {/* Summary */}
            <div className="text-sm font-medium" style={{ color: dark ? '#e2e8f0' : '#1e293b' }}>
              {reqSummary(req)}
            </div>

            {req.notes && <div className="text-xs text-slate-400">"{req.notes}"</div>}

            {/* Rejection reason */}
            {req.status === 'rejected' && req.rejectionReason && (
              <div className="text-xs px-3 py-2 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.07)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
                {ar ? 'سبب الرفض:' : 'Reason:'} {req.rejectionReason}
              </div>
            )}

            {/* Cancel action */}
            {canCancel && (
              <div className="flex items-center gap-2 pt-1">
                {!isConfirming ? (
                  <button
                    onClick={() => setConfirmCancel(req.id)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition-all"
                    style={{ background: 'rgba(239,68,68,0.07)', color: '#f87171', border: '1px solid rgba(239,68,68,0.18)' }}
                  >
                    <X size={12} /> {ar ? 'إلغاء الطلب' : 'Cancel Request'}
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-slate-400">{ar ? 'تأكيد الإلغاء؟' : 'Confirm cancel?'}</span>
                    <button
                      onClick={() => handleCancel(req.id)}
                      disabled={cancelling === req.id}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl font-semibold"
                      style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                    >
                      {cancelling === req.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      {ar ? 'نعم، إلغاء' : 'Yes, cancel'}
                    </button>
                    <button onClick={() => setConfirmCancel(null)} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">{ar ? 'تراجع' : 'Back'}</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function RequestsPage() {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();
  const [activeTab, setActiveTab] = useState<'approvals' | 'submit' | 'mine'>('approvals');
  const [requests, setRequests] = useState<UnifiedRequest[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, peer_pending: 0, approved_week: 0, rejected_week: 0, overdue: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const currentUser = useAuthStore(s => s.user);
  const approverId = currentUser?.id ?? '';

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchStats = useCallback(() => {
    apiClient.get('/requests/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);

  const fetchRequests = useCallback(() => {
    setLoading(true);
    const params: any = { limit: 50 };
    if (filterStatus) params.status = filterStatus;
    if (filterType)   params.type   = filterType;
    apiClient.get('/requests', { params })
      .then(r => { setRequests(r.data.data ?? []); setTotal(r.data.total ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStatus, filterType]);

  useEffect(() => { fetchStats(); fetchRequests(); }, [fetchStats, fetchRequests]);

  const handleApprove = async (id: string) => {
    try {
      await apiClient.patch(`/requests/${id}/approve`, { approverId });
      showToast(ar ? 'تمت الموافقة على الطلب ✓' : 'Request approved ✓', true);
      fetchRequests(); fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message ?? (ar ? 'خطأ في الموافقة' : 'Approval error'), false);
    }
  };

  const handleReject = async (id: string, reason: string) => {
    try {
      await apiClient.patch(`/requests/${id}/reject`, { approverId, reason });
      showToast(ar ? 'تم رفض الطلب' : 'Request rejected', true);
      fetchRequests(); fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message ?? (ar ? 'خطأ في الرفض' : 'Rejection error'), false);
    }
  };

  const handlePeerAccept = async (id: string, _empId: string) => {
    try {
      const myEmpId = currentUser?.employeeId ?? currentUser?.employee?.id ?? '';
      await apiClient.patch(`/requests/${id}/peer-accept`, { targetEmployeeId: myEmpId });
      showToast(ar ? 'وافقت على التبادل ✓' : 'Swap accepted ✓', true);
      fetchRequests(); fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message ?? (ar ? 'خطأ' : 'Error'), false);
    }
  };

  const handlePeerReject = async (id: string, _empId: string, reason: string) => {
    try {
      const myEmpId = currentUser?.employeeId ?? currentUser?.employee?.id ?? '';
      await apiClient.patch(`/requests/${id}/peer-reject`, { targetEmployeeId: myEmpId, reason });
      showToast(ar ? 'تم رفض التبادل' : 'Swap rejected', true);
      fetchRequests(); fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message ?? (ar ? 'خطأ' : 'Error'), false);
    }
  };

  const cardBg = dark ? 'rgba(11,16,31,0.8)' : 'rgba(255,255,255,0.9)';
  const borderColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  const TABS = [
    { key: 'approvals', labelAr: 'الموافقات', labelEn: 'Approvals',    count: stats.pending + stats.peer_pending },
    { key: 'submit',    labelAr: 'تقديم طلب', labelEn: 'New Request',  count: null },
    { key: 'mine',      labelAr: 'طلباتي',    labelEn: 'My Requests',  count: null },
  ] as const;

  return (
    <div className="space-y-5 pb-10">
      {/* Toast */}
      {toast && createPortal(
        <div className="fixed top-5 inset-x-0 flex justify-center z-[9999] pointer-events-none">
          <div className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-medium pointer-events-auto anim-scaleIn"
            style={{
              background: toast.ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: toast.ok ? '#6ee7b7' : '#fca5a5',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}>
            {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {toast.msg}
          </div>
        </div>,
        document.body,
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 stagger-grid">
        <StatCard label={ar ? 'طلبات معلقة' : 'Pending'} value={stats.pending} icon={Clock} color="#f59e0b" bg="rgba(245,158,11,0.06)" />
        <StatCard label={ar ? 'بانتظار الزميل' : 'Awaiting Peer'} value={stats.peer_pending} icon={Users} color="#8b5cf6" bg="rgba(139,92,246,0.06)" />
        <StatCard label={ar ? 'موافق هذا الأسبوع' : 'Approved (week)'} value={stats.approved_week} icon={CheckCircle2} color="#10b981" bg="rgba(16,185,129,0.06)" />
        <StatCard label={ar ? 'مرفوض هذا الأسبوع' : 'Rejected (week)'} value={stats.rejected_week} icon={XCircle} color="#ef4444" bg="rgba(239,68,68,0.06)" />
        <StatCard label={ar ? 'متأخر عن SLA' : 'SLA Overdue'} value={stats.overdue} icon={AlertTriangle} color="#f97316" bg="rgba(249,115,22,0.06)" />
      </div>

      {/* Main card */}
      <div className="rounded-2xl overflow-hidden" style={{ background: cardBg, border: `1px solid ${borderColor}`, boxShadow: dark ? '0 8px 32px rgba(0,0,0,0.4)' : '0 2px 16px rgba(0,0,0,0.06)' }}>

        {/* Tabs */}
        <div className="flex items-center gap-0 px-4 pt-3 border-b" style={{ borderColor }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className="relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 rounded-t-lg"
              style={{ color: activeTab === t.key ? '#818cf8' : '#94a3b8' }}>
              {ar ? t.labelAr : t.labelEn}
              {t.count !== null && t.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                  {t.count}
                </span>
              )}
              {activeTab === t.key && (
                <div className="absolute bottom-0 inset-x-0 h-0.5 rounded-t" style={{ background: '#6366f1' }} />
              )}
            </button>
          ))}
          <div className="ms-auto flex items-center gap-2 pb-2">
            <button onClick={() => { fetchRequests(); fetchStats(); }}
              className="p-1.5 rounded-lg hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">
              <RefreshCw size={14} className="text-slate-500" />
            </button>
          </div>
        </div>

        <div className="p-5">
          {/* Approvals tab */}
          {activeTab === 'approvals' && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="text-xs rounded-xl px-3 py-1.5 outline-none"
                  style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: `1px solid ${borderColor}`, color: dark ? '#94a3b8' : '#475569' }}>
                  <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
                  <option value="pending">{ar ? 'معلق' : 'Pending'}</option>
                  <option value="peer_pending">{ar ? 'انتظار الزميل' : 'Awaiting Peer'}</option>
                  <option value="approved">{ar ? 'موافق' : 'Approved'}</option>
                  <option value="rejected">{ar ? 'مرفوض' : 'Rejected'}</option>
                </select>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  className="text-xs rounded-xl px-3 py-1.5 outline-none"
                  style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: `1px solid ${borderColor}`, color: dark ? '#94a3b8' : '#475569' }}>
                  <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
                  {REQUEST_TYPES.map(t => <option key={t.code} value={t.code}>{ar ? t.labelAr : t.labelEn}</option>)}
                </select>
                <span className="text-xs text-slate-500">{total} {ar ? 'طلب' : 'requests'}</span>
              </div>

              {/* List */}
              {loading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
                  <Loader2 size={18} className="animate-spin" /> {ar ? 'جاري التحميل...' : 'Loading...'}
                </div>
              ) : requests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
                  <FileText size={32} className="opacity-30" />
                  <div className="text-sm">{ar ? 'لا توجد طلبات' : 'No requests found'}</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {requests.map(req => (
                    <RequestCard
                      key={req.id}
                      req={req}
                      dark={dark}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      onPeerAccept={handlePeerAccept}
                      onPeerReject={handlePeerReject}
                      refetch={fetchRequests}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Submit tab */}
          {activeTab === 'submit' && (
            <SubmitForm dark={dark} onSuccess={() => { setActiveTab('approvals'); fetchRequests(); fetchStats(); }} />
          )}

          {/* My requests tab */}
          {activeTab === 'mine' && (
            <MyRequests dark={dark} showToast={showToast} />
          )}
        </div>
      </div>
    </div>
  );
}
