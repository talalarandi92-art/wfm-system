import { useState, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle,
  AlertTriangle, ChevronRight, ChevronDown, Loader2,
  RefreshCw, Database, Eye, ArrowRight, Clock, Info,
  Calendar, Users, Zap,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'timing' | 'shifts';
type FilterMode = 'all' | 'valid' | 'error' | 'warning';

interface BatchSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  globalErrors: string[];
  sheetNames: string[];
}

interface PreviewRow {
  id: string;
  rowNumber: number;
  status: 'valid' | 'error' | 'warning';
  errors: string[] | null;
  warnings: string[] | null;
  data: Record<string, any>;
}

interface PreviewResult {
  batch: {
    id: string;
    importType: string;
    filename: string;
    status: string;
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
  };
  rows: PreviewRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

// ─── Import type metadata ─────────────────────────────────────────────────────

const TYPE_META: Record<ImportType, {
  en: string; ar: string;
  desc_en: string; desc_ar: string;
  step_en: string; step_ar: string;
  tip_en: string; tip_ar: string;
  icon: React.ReactNode;
}> = {
  timing: {
    en: 'Timing Sheet',
    ar: 'جدول التوقيتات',
    desc_en: 'Import shift code dictionary',
    desc_ar: 'استيراد قاموس رموز الشيفتات',
    step_en: 'Step 1 — do this FIRST',
    step_ar: 'الخطوة ١ — أول شيء يُعمل',
    tip_en: 'Reads each shift code (M, B, C, N, EE, MD, MN…) from the Timing sheet and stores its start time, end time, working hours, cross-midnight flag, WFH flag, and Ramadan variant. Only needs to be done once — or when new shift codes are added.',
    tip_ar: 'يقرأ كل كود شيفت (M, B, C, N, EE, MD, MN…) من ورقة Timing ويحفظ: وقت البداية والنهاية، ساعات العمل، تجاوز منتصف الليل، WFH، ورمضان. يُعمل مرة وحدة فقط أو عند إضافة كودات جديدة.',
    icon: <Clock size={20} className="text-blue-500" />,
  },
  shifts: {
    en: 'Attendance',
    ar: 'بيانات الحضور',
    desc_en: 'Import daily attendance records',
    desc_ar: 'استيراد سجلات الحضور اليومية',
    step_en: 'Step 2 — do after Timing',
    step_ar: 'الخطوة ٢ — بعد التوقيتات',
    tip_en: 'Reads the daily shifts sheet and imports: which employee, on which date, assigned what shift, actual punch-in/out, system login/logout, late minutes, OT, permissions. Creates employees automatically if not found. Feeds the schedule grid, attendance dashboard, and agent metrics.',
    tip_ar: 'يقرأ شيت الشيفتات اليومية ويستورد: أي موظف، في أي تاريخ، على أي شيفت، البصمة الفعلية، دخول النظام، دقائق التأخير، الأوفر تايم، الإذن. يُنشئ الموظفين تلقائياً إذا غير موجودين. يغذي جدول الشيفت ولوحة الحضور ومقاييس الوكلاء.',
    icon: <Calendar size={20} className="text-emerald-500" />,
  },
};

// ─── Status colors ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  valid:   'text-emerald-600 dark:text-emerald-400',
  error:   'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
};

const STATUS_BG: Record<string, string> = {
  valid:   'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  error:   'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
};

// ─── Concordance status config ────────────────────────────────────────────────

const CONC: Record<string, { bg: string; text: string; label: string; label_ar: string }> = {
  on_time:         { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', label: '✓ On time',     label_ar: '✓ في الوقت'       },
  late:            { bg: 'bg-amber-100 dark:bg-amber-900/40',    text: 'text-amber-700 dark:text-amber-300',    label: '⏱ Late',         label_ar: '⏱ متأخر'          },
  early_out:       { bg: 'bg-orange-100 dark:bg-orange-900/40',  text: 'text-orange-700 dark:text-orange-300',  label: '← Early out',    label_ar: '← خرج مبكراً'      },
  incomplete:      { bg: 'bg-yellow-100 dark:bg-yellow-900/40',  text: 'text-yellow-700 dark:text-yellow-300',  label: '⚡ Incomplete',   label_ar: '⚡ ناقص ساعات'     },
  no_show:         { bg: 'bg-red-100 dark:bg-red-900/40',        text: 'text-red-700 dark:text-red-300',        label: '✗ No show',      label_ar: '✗ غياب'           },
  missing_punch:   { bg: 'bg-red-100 dark:bg-red-900/40',        text: 'text-red-700 dark:text-red-300',        label: '? No punch',     label_ar: '? بدون بصمة'      },
  wfh_ok:          { bg: 'bg-sky-100 dark:bg-sky-900/40',        text: 'text-sky-700 dark:text-sky-300',        label: '🏠 WFH ✓',        label_ar: '🏠 بيت ✓'          },
  wfh_unverified:  { bg: 'bg-amber-100 dark:bg-amber-900/40',    text: 'text-amber-700 dark:text-amber-300',    label: '🏠 WFH ?',        label_ar: '🏠 بيت ؟'          },
  leave:           { bg: 'bg-violet-100 dark:bg-violet-900/40',  text: 'text-violet-700 dark:text-violet-300',  label: 'L Leave',        label_ar: 'إجازة'            },
  off:             { bg: 'bg-slate-100 dark:bg-slate-900/40',    text: 'text-slate-500 dark:text-slate-400',    label: '○ OFF',          label_ar: '○ إجازة أسبوعية'  },
  holiday:         { bg: 'bg-cyan-100 dark:bg-cyan-900/40',      text: 'text-cyan-700 dark:text-cyan-300',      label: 'H Holiday',      label_ar: 'H عطلة رسمية'     },
  sick:            { bg: 'bg-rose-100 dark:bg-rose-900/40',      text: 'text-rose-700 dark:text-rose-300',      label: 'SL Sick',        label_ar: 'SL مرضية'         },
  absent:          { bg: 'bg-red-200 dark:bg-red-900/50',        text: 'text-red-800 dark:text-red-200',        label: 'A Absent',       label_ar: 'A غياب بلا إذن'   },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "07:00" → "7am" | "16:00" → "4pm" | "13:30" → "1:30pm" */
function fmt12(t: string | null | undefined): string {
  if (!t) return '—';
  const parts = t.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

/** ISO datetime → "7:23am" */
function fmtDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
  } catch {
    return iso.slice(11, 16) || '—';
  }
}

/** "2025-01-15" → "Jan 15" */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

function minToHM(min: number): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

// ─── Attendance columns definition ────────────────────────────────────────────

interface ColDef {
  key: string;
  header_en: string;
  header_ar: string;
  render: (data: Record<string, any>, ar: boolean) => React.ReactNode;
  width?: string;
}

const ATTENDANCE_COLS: ColDef[] = [
  {
    key: 'attendanceDate',
    header_en: 'Date',
    header_ar: 'التاريخ',
    width: 'w-20',
    render: (d) => (
      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {fmtDate(d.attendanceDate)}
        {d.attendanceDate && (
          <span className="block text-gray-400 text-[10px]">
            {new Date(d.attendanceDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'employeeNo',
    header_en: 'Emp #',
    header_ar: 'الرقم',
    width: 'w-20',
    render: (d) => (
      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{d.employeeNo ?? '—'}</span>
    ),
  },
  {
    key: 'employeeName',
    header_en: 'Name',
    header_ar: 'الاسم',
    width: 'w-36',
    render: (d) => (
      <div>
        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate max-w-32">
          {d.employeeName ?? '—'}
        </p>
        {d.userId && (
          <p className="text-[10px] text-gray-400 font-mono">{d.userId}</p>
        )}
      </div>
    ),
  },
  {
    key: 'teamName',
    header_en: 'Team',
    header_ar: 'الفريق',
    width: 'w-28',
    render: (d) => (
      <div>
        <p className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-24">
          {d.teamName ?? d.functionName ?? '—'}
        </p>
        {d.teamManager && (
          <p className="text-[10px] text-gray-400 truncate max-w-24" title={d.teamManager}>
            ▸ {d.teamManager.split(' ')[0]}
          </p>
        )}
      </div>
    ),
  },
  {
    key: 'shiftCode',
    header_en: 'Shift',
    header_ar: 'الشيفت',
    width: 'w-28',
    render: (d) => {
      if (!d.shiftCode) return <span className="text-gray-300 dark:text-gray-600">—</span>;
      return (
        <div>
          <span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-100">
            {d.shiftCode}
          </span>
          {d.scheduledStart && d.scheduledEnd && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {fmt12(d.scheduledStart)} → {fmt12(d.scheduledEnd)}
            </p>
          )}
          {d.totalScheduledMinutes > 0 && (
            <p className="text-[10px] text-gray-400">
              {minToHM(d.totalScheduledMinutes)}
            </p>
          )}
        </div>
      );
    },
  },
  {
    key: 'punchIn',
    header_en: 'Punch',
    header_ar: 'البصمة',
    width: 'w-28',
    render: (d) => {
      if (!d.punchIn && !d.systemLogin) {
        if (['off','leave','holiday','sick','absent'].includes(d.concordanceStatus)) {
          return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>;
        }
        return <span className="text-red-400 text-xs">No data</span>;
      }
      return (
        <div className="space-y-0.5">
          {d.punchIn ? (
            <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
              <span className="text-[10px] text-gray-400">P: </span>
              <span className={d.punchLateMinutes > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                {fmtDt(d.punchIn)}
              </span>
              {d.punchOut && <> → {fmtDt(d.punchOut)}</>}
            </p>
          ) : null}
          {d.systemLogin ? (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
              <span className="text-gray-400">S: </span>
              <span className={d.systemLateMinutes > 0 ? 'text-amber-500' : ''}>
                {fmtDt(d.systemLogin)}
              </span>
              {d.systemLogout && <> → {fmtDt(d.systemLogout)}</>}
            </p>
          ) : null}
          {d.totalActualMinutes > 0 && (
            <p className={`text-[10px] ${d.hoursShortfall > 30 ? 'text-orange-500' : 'text-gray-400'}`}>
              ={minToHM(d.totalActualMinutes)}
              {d.hoursShortfall > 30 && ` (−${minToHM(d.hoursShortfall)})`}
            </p>
          )}
        </div>
      );
    },
  },
  {
    key: 'late',
    header_en: 'Late ⏱',
    header_ar: 'التأخير',
    width: 'w-24',
    render: (d) => {
      const pLate = d.punchLateMinutes ?? 0;
      const sLate = d.systemLateMinutes ?? 0;
      if (!pLate && !sLate) return <span className="text-gray-300 dark:text-gray-600">—</span>;
      return (
        <div className="space-y-0.5">
          {pLate > 0 && (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              P: +{pLate}m
            </p>
          )}
          {sLate > 0 && (
            <p className="text-xs text-amber-500 dark:text-amber-500">
              S: +{sLate}m
            </p>
          )}
          {d.isUncompensatedLate && (
            <p className="text-[10px] text-red-500 font-medium">↑ uncompensated</p>
          )}
        </div>
      );
    },
  },
  {
    key: 'permissionType',
    header_en: 'Permission',
    header_ar: 'الإذن',
    width: 'w-28',
    render: (d) => {
      if (!d.permissionType && !d.permissionDuration) {
        return <span className="text-gray-300 dark:text-gray-600">—</span>;
      }
      return (
        <div>
          {d.permissionType && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
              {d.permissionType}
            </span>
          )}
          {d.permissionDuration > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5">{minToHM(d.permissionDuration)}</p>
          )}
          {d.permissionStatus && (
            <p className="text-[10px] text-gray-400">{d.permissionStatus}</p>
          )}
        </div>
      );
    },
  },
  {
    key: 'concordanceStatus',
    header_en: 'Status',
    header_ar: 'المطابقة',
    width: 'w-32',
    render: (d, ar) => {
      const st = d.concordanceStatus ?? 'n_a';
      const cfg = CONC[st] ?? CONC['on_time'];
      const lateMin = d.punchLateMinutes ?? 0;
      const sLateMin = d.systemLateMinutes ?? 0;
      const shortfall = d.hoursShortfall ?? 0;
      return (
        <div className="space-y-0.5">
          <span className={`
            inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold
            ${cfg.bg} ${cfg.text}
          `}>
            {ar ? cfg.label_ar : cfg.label}
          </span>
          {lateMin > 0 && st === 'late' && (
            <p className="text-[10px] text-amber-600">+{lateMin}m punch{sLateMin > 0 ? ` / +${sLateMin}m sys` : ''}</p>
          )}
          {shortfall > 0 && st === 'incomplete' && (
            <p className="text-[10px] text-yellow-600">−{minToHM(shortfall)}</p>
          )}
          {d.otMinutes > 0 && (
            <p className="text-[10px] text-blue-500">OT +{minToHM(d.otMinutes)}</p>
          )}
        </div>
      );
    },
  },
];

// ─── Timing columns definition ────────────────────────────────────────────────

const TIMING_COLS: ColDef[] = [
  {
    key: 'code',
    header_en: 'Code',
    header_ar: 'الكود',
    width: 'w-20',
    render: (d) => (
      <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">{d.code ?? '—'}</span>
    ),
  },
  {
    key: 'description',
    header_en: 'Description',
    header_ar: 'الوصف',
    width: 'w-40',
    render: (d) => (
      <span className="text-xs text-gray-600 dark:text-gray-300">{d.description ?? '—'}</span>
    ),
  },
  {
    key: 'startTime',
    header_en: 'Start → End',
    header_ar: 'البداية ← النهاية',
    width: 'w-32',
    render: (d) => (
      <span className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {d.startTime ? fmt12(d.startTime) : '—'}
        {d.endTime ? <> → {fmt12(d.endTime)}</> : ''}
        {d.startTime2 && d.endTime2 && (
          <span className="block text-gray-400 text-[10px]">
            {fmt12(d.startTime2)} → {fmt12(d.endTime2)}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'workingHours',
    header_en: 'Hours',
    header_ar: 'الساعات',
    width: 'w-16',
    render: (d) => (
      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
        {d.workingHours ? `${d.workingHours}h` : '—'}
      </span>
    ),
  },
  {
    key: 'flags',
    header_en: 'Type',
    header_ar: 'النوع',
    width: 'w-48',
    render: (d) => (
      <div className="flex flex-wrap gap-1">
        {d.isSupervisorShift && <Tag color="blue">Supervisor</Tag>}
        {d.isWfh            && <Tag color="sky">WFH</Tag>}
        {d.isRamadan        && <Tag color="violet">Ramadan</Tag>}
        {d.isSplitShift     && <Tag color="orange">Split</Tag>}
        {d.isCrossMidnight  && <Tag color="indigo">×Midnight</Tag>}
        {d.isLeaveCode      && <Tag color="violet">Leave</Tag>}
        {d.isAbsenceCode    && <Tag color="red">Absence</Tag>}
        {!d.isWorkingShift  && <Tag color="slate">Non-working</Tag>}
      </div>
    ),
  },
];

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    blue:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    sky:    'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    violet: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
    orange: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    indigo: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
    red:    'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    slate:  'bg-slate-100 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[color] ?? colors.slate}`}>
      {children}
    </span>
  );
}

// ─── Expanded row detail ──────────────────────────────────────────────────────

function AttendanceDetail({ data }: { data: Record<string, any> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <FieldGroup title="Employee">
        <Field k="Employee No" v={data.employeeNo} />
        <Field k="Name" v={data.employeeName} />
        <Field k="User ID" v={data.userId} />
        <Field k="Email" v={data.email} />
        <Field k="Gender" v={data.gender} />
        <Field k="Emp. Type" v={data.employmentType} />
      </FieldGroup>
      <FieldGroup title="Shift & Schedule">
        <Field k="Date" v={data.attendanceDate} />
        <Field k="Shift Code" v={data.shiftCode} mono />
        <Field k="Shift Label" v={data.shiftLabel} />
        <Field k="Sched Start" v={data.scheduledStart ? fmt12(data.scheduledStart) : null} />
        <Field k="Sched End" v={data.scheduledEnd ? fmt12(data.scheduledEnd) : null} />
        <Field k="Sched Hours" v={data.totalScheduledMinutes ? minToHM(data.totalScheduledMinutes) : null} />
        {data.scheduledStart2 && <Field k="Split Start" v={fmt12(data.scheduledStart2)} />}
        {data.scheduledEnd2   && <Field k="Split End"   v={fmt12(data.scheduledEnd2)} />}
      </FieldGroup>
      <FieldGroup title="Attendance & Timing">
        <Field k="Punch In"    v={data.punchIn    ? fmtDt(data.punchIn)    : null} />
        <Field k="Punch Out"   v={data.punchOut   ? fmtDt(data.punchOut)   : null} />
        <Field k="Sys Login"   v={data.systemLogin  ? fmtDt(data.systemLogin)  : null} />
        <Field k="Sys Logout"  v={data.systemLogout ? fmtDt(data.systemLogout) : null} />
        <Field k="Actual Hours" v={data.totalActualMinutes ? minToHM(data.totalActualMinutes) : null} />
        <Field k="Shortfall"   v={data.hoursShortfall > 0 ? minToHM(data.hoursShortfall) : null} highlight={data.hoursShortfall > 30} />
      </FieldGroup>
      <FieldGroup title="Late / OT / Permission">
        <Field k="Punch Late"   v={data.punchLateMinutes      > 0 ? `+${data.punchLateMinutes}m`     : null} highlight={data.punchLateMinutes > 0} />
        <Field k="Punch Early"  v={data.punchEarlyOutMinutes  > 0 ? `−${data.punchEarlyOutMinutes}m` : null} />
        <Field k="Sys Late"     v={data.systemLateMinutes     > 0 ? `+${data.systemLateMinutes}m`    : null} highlight={data.systemLateMinutes > 0} />
        <Field k="Sys Early"    v={data.systemEarlyOutMinutes > 0 ? `−${data.systemEarlyOutMinutes}m` : null} />
        <Field k="OT"           v={data.otMinutes > 0 ? `+${data.otMinutes}m` : null} />
        <Field k="Permission"   v={data.permissionType} />
        <Field k="Perm. Dur."   v={data.permissionDuration > 0 ? minToHM(data.permissionDuration) : null} />
        <Field k="Perm. Status" v={data.permissionStatus} />
      </FieldGroup>
      <FieldGroup title="Flags">
        <FlagRow k="WFH"               v={data.isWfh} />
        <FlagRow k="Missing Punch"     v={data.isMissingPunch} />
        <FlagRow k="Missing System"    v={data.isMissingSystem} />
        <FlagRow k="No-show"           v={data.isNoShow} danger />
        <FlagRow k="Uncompensated Late" v={data.isUncompensatedLate} danger />
        <Field k="Location" v={data.location} />
        <Field k="Notes" v={data.notes} />
      </FieldGroup>
      <FieldGroup title="Team">
        <Field k="Function"     v={data.functionName} />
        <Field k="Team"         v={data.teamName} />
        <Field k="Team Manager" v={data.teamManager} />
      </FieldGroup>
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">{title}</p>
      {children}
    </div>
  );
}

function Field({ k, v, mono, highlight }: { k: string; v?: any; mono?: boolean; highlight?: boolean }) {
  if (v == null || v === '' || v === false) return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400 flex-shrink-0">{k}</span>
      <span className={`text-end truncate ${mono ? 'font-mono' : ''} ${highlight ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
        {String(v)}
      </span>
    </div>
  );
}

function FlagRow({ k, v, danger }: { k: string; v?: boolean; danger?: boolean }) {
  if (!v) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${danger ? 'bg-red-500' : 'bg-blue-400'}`} />
      <span className={`text-xs ${danger ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>{k}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ImportPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importType, setImportType] = useState<ImportType>('timing');
  const [sheetName, setSheetName] = useState('');
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<any | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }, []);

  const acceptFile = async (f: File) => {
    setFile(f);
    setError(null);
    setAvailableSheets([]);
    setSheetName('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await apiClient.post('/imports/sheets', fd);
      const sheets: string[] = data.sheetNames ?? [];
      setAvailableSheets(sheets);
      if (importType === 'timing') {
        const auto = sheets.find(s => /timing|توقيت/i.test(s)) ?? '';
        if (auto) setSheetName(auto);
      } else {
        const auto = sheets.find(s => /shift|attendance|حضور/i.test(s)) ?? '';
        if (auto) setSheetName(auto);
      }
    } catch {
      // non-critical
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.get('/auth/me').catch(async () => {
        const rt = localStorage.getItem('refresh_token');
        if (rt) {
          const { data: tokens } = await apiClient.post('/auth/refresh', { refreshToken: rt });
          localStorage.setItem('access_token',  tokens.accessToken);
          localStorage.setItem('refresh_token', tokens.refreshToken);
        }
      });

      const fd = new FormData();
      fd.append('file', file);
      const params = new URLSearchParams({ type: importType });
      if (sheetName) params.set('sheet', sheetName);

      const { data } = await apiClient.post(`/imports/upload?${params}`, fd);
      setBatchId(data.batchId);
      setSummary(data.summary);
      setStep(2);
      await loadPreview(data.batchId, 1, 'all');
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message ?? 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (bid: string, page: number, filter: FilterMode) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(
        `/imports/${bid}/preview?page=${page}&limit=50&filter=${filter}`,
      );
      setPreview(data);
      setPreviewPage(page);
      setFilterMode(filter);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async (skipErrors = false) => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/imports/${batchId}/commit`, { skipErrors });
      setCommitResult(data);
      setStep(3);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Commit failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(1); setFile(null); setBatchId(null); setSummary(null);
    setPreview(null); setCommitResult(null); setError(null);
    setAvailableSheets([]); setSheetName('');
  };

  // ── Derive effective import type ─────────────────────────────────────────
  // Priority: loaded batch type from API > React form state
  // batch.importType from DB is 'timing_sheet' or 'shifts_sheet'
  const batchDbType = preview?.batch?.importType ?? '';
  const isAttendanceBatch =
    batchDbType.includes('shift') ||     // 'shifts_sheet'
    batchDbType === 'shifts' ||
    (!batchDbType && importType === 'shifts'); // fallback to form state

  const cols = isAttendanceBatch ? ATTENDANCE_COLS : TIMING_COLS;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={ar ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Database size={24} className="text-blue-600" />
            {ar ? 'استيراد البيانات' : 'Data Import'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {ar
              ? 'استيراد جدول التوقيتات أولاً، ثم بيانات الحضور'
              : 'Import Timing sheet first, then Attendance data'}
          </p>
        </div>
        {step > 1 && (
          <button onClick={reset} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} /> {ar ? 'استيراد جديد' : 'New Import'}
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1, en: 'Upload',  ar: 'رفع الملف' },
          { n: 2, en: 'Preview', ar: 'مراجعة'   },
          { n: 3, en: 'Done',    ar: 'اكتمل'    },
        ].map(({ n, en, ar: arLabel }, idx) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`
              w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs
              ${step === n ? 'bg-blue-600 text-white' :
                step > n  ? 'bg-emerald-500 text-white' :
                             'bg-gray-100 dark:bg-gray-800 text-gray-400'}
            `}>
              {step > n ? <CheckCircle2 size={14} /> : n}
            </div>
            <span className={step === n ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-400'}>
              {ar ? arLabel : en}
            </span>
            {idx < 2 && <ArrowRight size={14} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Upload ──────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Import type selection */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {ar ? 'نوع الاستيراد' : 'Import Type'}
            </h2>

            {/* Type cards */}
            <div className="space-y-3">
              {(Object.keys(TYPE_META) as ImportType[]).map(type => {
                const m = TYPE_META[type];
                const selected = importType === type;
                return (
                  <label
                    key={type}
                    className={`
                      flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all
                      ${selected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'}
                    `}
                  >
                    <input
                      type="radio" name="importType" value={type}
                      checked={selected}
                      onChange={() => { setImportType(type); setSheetName(''); }}
                      className="mt-1 accent-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {m.icon}
                        <p className="font-semibold text-sm text-gray-900 dark:text-white">
                          {ar ? m.ar : m.en}
                        </p>
                        <span className={`
                          text-[10px] px-1.5 py-0.5 rounded-full font-semibold
                          ${type === 'timing'
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}
                        `}>
                          {ar ? m.step_ar : m.step_en}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {ar ? m.desc_ar : m.desc_en}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Tip box */}
            <div>
              <button
                onClick={() => setShowTip(v => !v)}
                className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Info size={12} /> {ar ? 'ما الفرق بين الاثنين؟' : 'What is the difference?'}
                {showTip ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {showTip && (
                <div className="mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-3">
                  {(Object.keys(TYPE_META) as ImportType[]).map(type => (
                    <div key={type}>
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1">
                        {TYPE_META[type].icon} {ar ? TYPE_META[type].ar : TYPE_META[type].en}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                        {ar ? TYPE_META[type].tip_ar : TYPE_META[type].tip_en}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sheet selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {ar ? 'ورقة العمل' : 'Worksheet'}
                {availableSheets.length > 0 && (
                  <span className="ms-1 text-blue-500">({availableSheets.length} sheets)</span>
                )}
              </label>
              {availableSheets.length > 0 ? (
                <>
                  <select
                    value={sheetName}
                    onChange={e => setSheetName(e.target.value)}
                    className="input-field text-sm w-full"
                  >
                    <option value="">{ar ? '— تلقائي —' : '— Auto detect —'}</option>
                    {availableSheets.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {availableSheets.map(s => (
                      <button
                        key={s} type="button" onClick={() => setSheetName(s)}
                        className={`
                          text-xs px-2 py-0.5 rounded-full border transition-colors
                          ${sheetName === s
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-400 hover:text-blue-600'}
                        `}
                      >{s}</button>
                    ))}
                  </div>
                </>
              ) : (
                <input
                  type="text" value={sheetName}
                  onChange={e => setSheetName(e.target.value)}
                  placeholder={ar ? 'مثال: Timing' : 'e.g. Timing'}
                  className="input-field text-sm w-full"
                />
              )}
            </div>
          </div>

          {/* File drop zone */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {ar ? 'رفع ملف Excel' : 'Upload Excel File'}
            </h2>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                ${dragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : file
                  ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'}
              `}
            >
              <input
                ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls"
                onChange={e => e.target.files?.[0] && acceptFile(e.target.files[0])}
              />
              {file ? (
                <div className="space-y-2">
                  <FileSpreadsheet size={36} className="mx-auto text-emerald-500" />
                  <p className="font-medium text-emerald-700 dark:text-emerald-300 text-sm">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  {availableSheets.length > 0 && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      {availableSheets.length} sheets: {availableSheets.slice(0, 4).join(', ')}{availableSheets.length > 4 ? '…' : ''}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload size={36} className="mx-auto text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {ar ? 'اسحب الملف هنا أو انقر للاختيار' : 'Drag & drop or click to select'}
                  </p>
                  <p className="text-xs text-gray-400">.xlsx / .xls — max 50 MB</p>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <button
              onClick={handleUpload} disabled={!file || loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> {ar ? 'جاري التحليل…' : 'Parsing…'}</>
                : <><Eye size={16} /> {ar ? 'تحليل ومعاينة' : 'Parse & Preview'}</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview ─────────────────────────────────────────────────── */}
      {step === 2 && summary && preview && (
        <div className="space-y-4">

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: ar ? 'إجمالي' : 'Total',    val: summary.totalRows,   color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-800' },
              { label: ar ? 'صحيح'  : 'Valid',    val: summary.validRows,   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
              { label: ar ? 'خطأ'   : 'Errors',   val: summary.errorRows,   color: 'text-red-700 dark:text-red-300',     bg: 'bg-red-50 dark:bg-red-900/20' },
              { label: ar ? 'تحذير' : 'Warnings', val: summary.warningRows, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/20' },
            ].map(({ label, val, color, bg }) => (
              <div key={label} className={`card p-4 ${bg}`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          {/* Concordance legend (attendance only) */}
          {isAttendanceBatch && (
            <div className="card p-3 flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-400 font-medium me-1">
                {ar ? 'مفتاح المطابقة:' : 'Concordance:'}
              </span>
              {Object.entries(CONC).slice(0, 8).map(([k, v]) => (
                <span key={k} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${v.bg} ${v.text}`}>
                  {ar ? v.label_ar : v.label}
                </span>
              ))}
            </div>
          )}

          {/* Global errors */}
          {summary.globalErrors?.length > 0 && (
            <div className="card p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2 flex items-center gap-2">
                <XCircle size={14} /> {ar ? 'أخطاء المحلل' : 'Parser Errors'}
              </p>
              {summary.globalErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
              ))}
            </div>
          )}

          {/* Filter + Table */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1">
                {(['all', 'valid', 'error', 'warning'] as FilterMode[]).map(f => (
                  <button
                    key={f}
                    onClick={() => batchId && loadPreview(batchId, 1, f)}
                    className={`
                      px-3 py-1 rounded-full text-xs font-medium transition-colors
                      ${filterMode === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}
                    `}
                  >
                    {f === 'all'     ? (ar ? 'الكل'  : 'All')      :
                     f === 'valid'   ? (ar ? 'صحيح'  : 'Valid')    :
                     f === 'error'   ? (ar ? 'خطأ'   : 'Errors')   :
                                        (ar ? 'تحذير' : 'Warnings')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {isAttendanceBatch && (
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <Users size={12} />
                    <span>{ar ? 'انقر للتفاصيل' : 'Click row for details'}</span>
                  </div>
                )}
                <p className="text-xs text-gray-400">{preview.pagination.total} {ar ? 'صف' : 'rows'}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-3 py-2 text-start w-10">#</th>
                    <th className="px-3 py-2 text-start w-20">{ar ? 'الحالة' : 'Status'}</th>
                    {cols.map(c => (
                      <th key={c.key} className={`px-3 py-2 text-start ${c.width ?? ''}`}>
                        {ar ? c.header_ar : c.header_en}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-start w-20">{ar ? 'تنبيهات' : 'Alerts'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {preview.rows.map(row => {
                    const isExpanded = expandedRow === row.id;
                    const isAttendance = isAttendanceBatch; // derived from batch type, not form state

                    return (
                      <>
                        <tr
                          key={row.id}
                          className={`
                            transition-colors
                            ${isAttendance ? 'cursor-pointer' : ''}
                            ${row.status === 'error'   ? 'bg-red-50/40 dark:bg-red-900/10' :
                              row.status === 'warning' ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}
                            ${isExpanded ? 'bg-blue-50/30 dark:bg-blue-900/10' :
                              isAttendance ? 'hover:bg-gray-50 dark:hover:bg-gray-800/30' : ''}
                          `}
                          onClick={() => isAttendance && setExpandedRow(isExpanded ? null : row.id)}
                        >
                          <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">{row.rowNumber}</td>
                          <td className="px-3 py-2">
                            <span className={`
                              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                              ${STATUS_COLOR[row.status]}
                            `}>
                              {row.status === 'valid'   && <CheckCircle2  size={9} />}
                              {row.status === 'error'   && <XCircle       size={9} />}
                              {row.status === 'warning' && <AlertTriangle size={9} />}
                              {row.status}
                            </span>
                          </td>
                          {cols.map(c => (
                            <td key={c.key} className="px-3 py-2 align-top">
                              {c.render(row.data, ar)}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {(row.errors?.length || row.warnings?.length) ? (
                              <button className={`text-[10px] ${STATUS_COLOR[row.status]} flex items-center gap-1`}>
                                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                {row.errors?.length ? <span className="text-red-500">{row.errors.length}E</span> : null}
                                {row.warnings?.length ? <span className="text-amber-500">{row.warnings.length}W</span> : null}
                              </button>
                            ) : (
                              row.data.isNoShow ? (
                                <span className="text-[10px] text-red-500 flex items-center gap-1">
                                  <Zap size={9} /> no-show
                                </span>
                              ) : null
                            )}
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && isAttendance && (
                          <tr key={`${row.id}-detail`} className="bg-blue-50/20 dark:bg-blue-900/5">
                            <td colSpan={cols.length + 3} className="px-4 pb-4 pt-2">
                              {/* Errors / Warnings */}
                              {((row.errors?.length ?? 0) > 0 || (row.warnings?.length ?? 0) > 0) && (
                                <div className={`rounded-lg border p-3 mb-3 ${STATUS_BG[row.status]}`}>
                                  {row.errors?.map((e, i) => (
                                    <p key={i} className="text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
                                      <XCircle size={10} /> {e}
                                    </p>
                                  ))}
                                  {row.warnings?.map((w, i) => (
                                    <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                      <AlertTriangle size={10} /> {w}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {/* Full detail */}
                              <div className="card p-3 bg-white dark:bg-gray-900">
                                <AttendanceDetail data={row.data} />
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Timing import expanded (simpler) */}
                        {isExpanded && !isAttendance && (
                          <tr key={`${row.id}-detail`}>
                            <td colSpan={cols.length + 3} className="px-4 pb-3">
                              <div className={`rounded-lg border p-3 ${STATUS_BG[row.status]}`}>
                                {row.errors?.map((e, i) => (
                                  <p key={i} className="text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
                                    <XCircle size={10} /> {e}
                                  </p>
                                ))}
                                {row.warnings?.map((w, i) => (
                                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                    <AlertTriangle size={10} /> {w}
                                  </p>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {preview.pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  disabled={previewPage <= 1 || loading}
                  onClick={() => batchId && loadPreview(batchId, previewPage - 1, filterMode)}
                  className="btn-secondary text-xs py-1 px-3"
                >
                  {ar ? 'السابق' : 'Previous'}
                </button>
                <p className="text-xs text-gray-500">
                  {ar ? `صفحة ${previewPage} من ${preview.pagination.pages}` : `Page ${previewPage} of ${preview.pagination.pages}`}
                </p>
                <button
                  disabled={previewPage >= preview.pagination.pages || loading}
                  onClick={() => batchId && loadPreview(batchId, previewPage + 1, filterMode)}
                  className="btn-secondary text-xs py-1 px-3"
                >
                  {ar ? 'التالي' : 'Next'}
                </button>
              </div>
            )}
          </div>

          {/* Commit actions */}
          <div className="card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">
                {ar ? 'جاهز للاستيراد؟' : 'Ready to commit?'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {summary.errorRows > 0
                  ? (ar
                      ? `يوجد ${summary.errorRows} صف به أخطاء. يمكنك تجاهلها واستيراد الصحيحة فقط.`
                      : `${summary.errorRows} rows have errors. You can skip them and commit valid rows only.`)
                  : (ar ? 'كل الصفوف صحيحة وجاهزة.' : 'All rows are valid and ready.')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {summary.errorRows > 0 && (
                <button
                  onClick={() => handleCommit(true)} disabled={loading}
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                  {ar ? 'استيراد الصحيحة فقط' : 'Commit valid only'}
                </button>
              )}
              <button
                onClick={() => handleCommit(false)}
                disabled={loading || summary.errorRows > 0}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                {ar ? 'استيراد الكل' : 'Commit all'}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Done ───────────────────────────────────────────────────── */}
      {step === 3 && commitResult && (
        <div className="card p-8 text-center space-y-4 max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {ar ? 'تم الاستيراد بنجاح' : 'Import Complete'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {ar
              ? `تم استيراد ${commitResult.committed} صف بنجاح. تم تجاهل ${commitResult.skipped} صف.`
              : `${commitResult.committed} rows committed. ${commitResult.skipped} rows skipped.`}
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="card p-3 bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-xs text-gray-500">{ar ? 'مستورد' : 'Committed'}</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{commitResult.committed}</p>
            </div>
            <div className="card p-3 bg-gray-50 dark:bg-gray-800">
              <p className="text-xs text-gray-500">{ar ? 'تجاهل' : 'Skipped'}</p>
              <p className="text-2xl font-bold text-gray-400">{commitResult.skipped}</p>
            </div>
          </div>
          <button onClick={reset} className="btn-primary w-full mt-2">
            {ar ? 'استيراد آخر' : 'Import Another File'}
          </button>
        </div>
      )}
    </div>
  );
}
