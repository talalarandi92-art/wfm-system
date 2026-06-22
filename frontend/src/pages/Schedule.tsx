import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar, ChevronLeft, ChevronRight, Users,
  Filter, RefreshCw, Eye,
  CheckCircle2, AlertCircle, Clock, Home,
  X, Info, TrendingUp, Loader2,
  Pencil, Save, History, ChevronDown, BarChart2,
  ArrowRight, ShieldAlert, ShieldCheck, GitBranch,
  Building2, BadgeCheck, Lock, Unlock, Send, RotateCcw,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { fmtLocalDate, weekStartSat } from '@/utils/format';
import { useUiStore } from '@/store/ui.store';
import { useInjectDsStyles } from '@/components/ds';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DayEntry {
  marker: string;
  start: string | null;
  end: string | null;
  isWfh: boolean;
  punchIn: string | null;
  lateMinutes: number;
  otMinutes: number;
  code: string;
  category: string;
  color: string;
  label: string;
  editCount: number;
  lastEditBy: string | null;
  notes: string | null;
}

interface Employee {
  employeeId: string;
  employeeNo: string;
  name: string;
  gender: string;
  employmentType: string;
  functionId: string;
  functionName: string;
  teamId: string;
  teamName: string;
  days: Record<string, DayEntry>;
}

interface FunctionGroup {
  id: string;
  name: string;
  employees: Employee[];
}

interface GridData {
  weekStart: string;
  weekEnd: string;
  dates: string[];
  functions: FunctionGroup[];
  coverage: Record<string, { working: number; off: number; leave: number; absent: number; total: number }>;
  totalEmployees: number;
}

interface FunctionOption { id: string; name: string; employee_count: string }

// ─── Day label colours ─────────────────────────────────────────────────────────
// 4 real categories from the CC Schedule Timing sheet:
//   Morning (M, AM, CCNO)  →  06:00–08:59 starts  →  sky/blue
//   Between (B, C)         →  09:00–12:59 starts  →  amber/orange
//   Night   (N, E, EE)     →  13:00–21:59 starts  →  violet/purple (E/EE cross midnight but still "Night")
//   Midnight (MD, MN)      →  22:00–05:59 starts  →  deep indigo/dark
const CATEGORY_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  // ── Working shifts ────────────────────────────────────────────────────────
  morning:  { bg: 'rgba(14,165,233,0.14)',  text: '#38bdf8', border: 'rgba(14,165,233,0.35)'  },
  between:  { bg: 'rgba(245,158,11,0.14)',  text: '#fbbf24', border: 'rgba(245,158,11,0.35)'  },
  night:    { bg: 'rgba(139,92,246,0.15)',  text: '#a78bfa', border: 'rgba(139,92,246,0.35)'  },
  midnight: { bg: 'rgba(17,14,65,0.75)',    text: '#818cf8', border: 'rgba(79,70,229,0.45)'   },
  // ── Non-working ───────────────────────────────────────────────────────────
  off:      { bg: 'rgba(71,85,105,0.10)',   text: '#94a3b8', border: 'rgba(71,85,105,0.22)'   },
  leave:    { bg: 'rgba(168,85,247,0.12)',  text: '#c084fc', border: 'rgba(168,85,247,0.3)'   },
  sick:     { bg: 'rgba(220,38,38,0.10)',   text: '#f87171', border: 'rgba(220,38,38,0.28)'   },
  absent:   { bg: 'rgba(239,68,68,0.16)',   text: '#ef4444', border: 'rgba(239,68,68,0.38)'   },
  holiday:  { bg: 'rgba(6,182,212,0.12)',   text: '#22d3ee', border: 'rgba(6,182,212,0.32)'   },
  unknown:  { bg: 'rgba(100,116,139,0.08)', text: '#64748b', border: 'rgba(100,116,139,0.2)'  },
  // no_data: truly empty cells (unknown marker + no time = blank in the workbook)
  no_data:  { bg: 'transparent',            text: 'transparent', border: 'transparent'         },
  // legacy alias so old data with 'evening' category doesn't break
  evening:  { bg: 'rgba(249,115,22,0.14)',  text: '#fb923c', border: 'rgba(249,115,22,0.35)'  },
};

// ─── 12-hour time formatter ───────────────────────────────────────────────────
/** "07:00:00" → "7am"  |  "16:00:00" → "4pm"  |  "13:30:00" → "1:30pm" */
function fmt12(timeStr: string | null): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? '0', 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

/** "07:00:00" → "07:00" for detail modal */
function fmt24(timeStr: string | null): string {
  if (!timeStr) return '';
  return timeStr.slice(0, 5);
}

// ─── Arabic day names ─────────────────────────────────────────────────────────
const DAY_AR: Record<number, string> = { 0:'أح', 1:'إث', 2:'ثل', 3:'أر', 4:'خم', 5:'جم', 6:'سب' };
const DAY_EN: Record<number, string> = { 0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat' };
const MONTH_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function fmtDate(iso: string, lang: 'ar' | 'en') {
  const d = new Date(iso + 'T00:00:00');
  const day = lang === 'ar' ? DAY_AR[d.getDay()] : DAY_EN[d.getDay()];
  const dd  = d.getDate();
  const mon = lang === 'ar' ? MONTH_AR[d.getMonth()] : d.toLocaleString('en', { month: 'short' });
  return { day, dd, mon, isToday: iso === new Date().toISOString().split('T')[0] };
}

function shiftPeriod(weekStart: string, direction: -1 | 1, weeks: number): string {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + direction * weeks * 7);
  return fmtLocalDate(d);
}
const currentWeekSat = (): string => weekStartSat();

// ─── SaveResult (returned by PATCH /schedule/cell) ───────────────────────────
interface SaveResult {
  hcBefore: number;
  hcAfter: number;
  hcDelta: number;
  validations: Array<{ rule: string; severity: 'error' | 'warning' | 'info'; messageAr: string; messageEn: string }>;
  requiresApproval: boolean;
  hasBlockingViolation: boolean;
  sourceOfChange: string;
  employeeName: string;
  functionName: string;
}

// ─── Shift Cell ───────────────────────────────────────────────────────────────
function ShiftCell({ day, onCellClick, onHistoryClick, date, emp, colWidth, isSelected, ar }: {
  day: DayEntry | undefined;
  date: string;
  emp: Employee;
  colWidth: number;
  isSelected?: boolean;
  ar: boolean;
  onCellClick: (emp: Employee, date: string, day: DayEntry | undefined) => void;
  onHistoryClick?: (emp: Employee, date: string) => void;
}) {
  const tdStyle: React.CSSProperties = {
    borderColor: 'rgba(255,255,255,0.04)',
    minWidth: colWidth,
    padding: '2px 3px',
  };

  // No record at all OR backend returned no_data category → blank cell
  if (!day || day.category === 'no_data') {
    return (
      <td className="border-b border-e" style={tdStyle}>
        <button
          onClick={() => onCellClick(emp, date, day)}
          className="w-full h-14 rounded-lg flex items-center justify-center
                     hover:bg-white/[0.03] transition-colors"
          style={{
            border: isSelected ? '2px solid rgba(99,102,241,0.7)' : '1px dashed rgba(255,255,255,0.05)',
            boxShadow: isSelected ? '0 0 0 3px rgba(99,102,241,0.18), inset 0 0 12px rgba(99,102,241,0.08)' : undefined,
          }}
        />
      </td>
    );
  }

  const style   = CATEGORY_STYLE[day.category] ?? CATEGORY_STYLE.unknown;
  const isOff   = day.marker === 'off';
  const isLeave = ['leave','sick','absent','holiday'].includes(day.marker);
  const hasTime = !isOff && !isLeave && day.start && day.end;
  const timeRange = hasTime ? `${fmt12(day.start)} – ${fmt12(day.end)}` : null;
  const wasEdited = (day.editCount ?? 0) > 0;

  return (
    <td className="border-b border-e" style={tdStyle}>
      <button
        onClick={() => onCellClick(emp, date, day)}
        className="shift-cell w-full h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 relative"
        style={{
          background: isSelected ? `${style.bg}` : style.bg,
          border: isSelected ? `2px solid rgba(99,102,241,0.8)` : `1px solid ${style.border}`,
          boxShadow: isSelected ? `0 0 0 3px rgba(99,102,241,0.2), 0 0 16px rgba(99,102,241,0.15)` : undefined,
          transform: isSelected ? 'scale(1.05)' : undefined,
          zIndex: isSelected ? 10 : undefined,
          ['--cell-accent' as any]: style.text,
        } as any}
      >
        {/* Shift code */}
        <span className="text-[11px] font-bold leading-none tracking-wide" style={{ color: style.text }}>
          {day.code}
        </span>

        {/* Time range */}
        {timeRange && colWidth >= 70 && (
          <span
            className="text-[8px] leading-none font-medium px-1 py-0.5 rounded"
            style={{ color: style.text, opacity: 0.75, background: 'rgba(0,0,0,0.25)', letterSpacing: '0.01em' }}
          >
            {timeRange}
          </span>
        )}

        {/* Indicators */}
        {day.lateMinutes > 0 && (
          <span className="absolute top-0.5 end-0.5 w-1.5 h-1.5 rounded-full bg-rose-500" title={`${ar ? 'تأخير' : 'Late'} ${day.lateMinutes}m`} />
        )}
        {day.otMinutes > 0 && (
          <span className="absolute bottom-0.5 end-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" title={`${ar ? 'أوفرتايم' : 'OT'} ${day.otMinutes}m`} />
        )}
        {day.isWfh && !isOff && (
          <span className="absolute top-0.5 start-0.5 text-[7px] leading-none">🏠</span>
        )}
        {/* Edit indicator — blue dot bottom-left; click opens timeline */}
        {wasEdited && (
          <span
            className="absolute bottom-0.5 start-0.5 w-2 h-2 rounded-full bg-blue-400 cursor-pointer
                       hover:scale-150 transition-transform duration-150 z-10"
            title={ar ? `عُدِّل ${day.editCount} مرة — اضغط لعرض السجل` : `Edited ${day.editCount}x — click for history`}
            onClick={e => {
              e.stopPropagation();
              onHistoryClick?.(emp, date);
            }}
          />
        )}
      </button>
    </td>
  );
}

// ─── Edit type options ────────────────────────────────────────────────────────
const EDIT_TYPES = [
  { value: 'employee_request',  ar: 'طلب من الموظف',    en: 'Employee Request',   color: '#60a5fa' },
  { value: 'business_need',     ar: 'احتياج عمل',        en: 'Business Need',      color: '#34d399' },
  { value: 'wfm_adjustment',    ar: 'تعديل WFM',         en: 'WFM Adjustment',     color: '#a78bfa' },
  { value: 'correction',        ar: 'تصحيح خطأ',         en: 'Correction',         color: '#fbbf24' },
  { value: 'sick_leave',        ar: 'إجازة مرضية',       en: 'Sick Leave',         color: '#f87171' },
  { value: 'absence',           ar: 'غياب',               en: 'Absence',            color: '#ef4444' },
  { value: 'swap_correction',   ar: 'تصحيح تبادل',       en: 'Swap Correction',    color: '#fb923c' },
  { value: 'emergency',         ar: 'طارئ',               en: 'Emergency',          color: '#f97316' },
  { value: 'manual_adjustment', ar: 'تعديل يدوي',        en: 'Manual Adjustment',  color: '#8b5cf6' },
];

// ─── Source-of-change label map ───────────────────────────────────────────────
const SOURCE_LABELS: Record<string, { ar: string; en: string; color: string }> = {
  auto_generated:        { ar: 'توليد تلقائي',       en: 'Auto-Generated',       color: '#6366f1' },
  manual_edit:           { ar: 'تعديل يدوي',          en: 'Manual Edit',           color: '#a78bfa' },
  shift_swap:            { ar: 'تبادل وردية',         en: 'Shift Swap',            color: '#60a5fa' },
  off_swap:              { ar: 'تبادل إجازة',         en: 'Off Swap',              color: '#38bdf8' },
  sick_leave:            { ar: 'إجازة مرضية',         en: 'Sick Leave',            color: '#f87171' },
  absence:               { ar: 'غياب',                 en: 'Absence',               color: '#ef4444' },
  annual_leave:          { ar: 'إجازة سنوية',         en: 'Annual Leave',          color: '#c084fc' },
  comp:                  { ar: 'إجازة تعويضية',       en: 'Comp Off',              color: '#818cf8' },
  permission:            { ar: 'إذن',                  en: 'Permission',            color: '#34d399' },
  business_need_override:{ ar: 'احتياج عمل',           en: 'Business Need',         color: '#34d399' },
  emergency:             { ar: 'طارئ',                 en: 'Emergency',             color: '#f97316' },
  import_excel:          { ar: 'استيراد Excel',        en: 'Excel Import',          color: '#fbbf24' },
  correction:            { ar: 'تصحيح',               en: 'Correction',            color: '#fb923c' },
};

// Common shift codes shown as quick chips in edit form
const QUICK_CODES = ['M','B','C','N','E','EE','MD','MN','AM','M20','B20','C20','N20','OFF','L','SL','ABS','H'];

// ─── Day Detail Modal (with inline edit mode + save result + timeline button) ──
function DayModal({ emp, date, day, onClose, onSaved, onTimeline, lang, anchor }: {
  emp: Employee; date: string; day: DayEntry | undefined;
  onClose: () => void;
  onSaved: () => void;
  onTimeline?: (emp: Employee, date: string) => void;
  lang: 'ar' | 'en';
  anchor?: { gridLeft: number; gridWidth: number; vpH: number };
}) {
  const ar = lang === 'ar';
  const [editMode, setEditMode]   = useState(false);
  const [editType, setEditType]   = useState('business_need');
  const [newCode, setNewCode]     = useState('');
  const [reason, setReason]       = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saveResult, setSaveResult]   = useState<SaveResult | null>(null);

  const style  = day && day.category !== 'no_data'
    ? (CATEGORY_STYLE[day.category] ?? CATEGORY_STYLE.unknown)
    : CATEGORY_STYLE.unknown;
  const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
  const dateInfo = fmtDate(date, lang);

  // Parse audit history from notes
  const history: any[] = (() => {
    if (!day?.notes) return [];
    try { return JSON.parse(day.notes).edits ?? []; } catch { return []; }
  })();

  const handleSave = async () => {
    if (!newCode.trim()) { setError(ar ? 'اختر رمز الوردية' : 'Select a shift code'); return; }
    if (reason.trim().length < 3) { setError(ar ? 'السبب قصير جداً (3 أحرف على الأقل)' : 'Reason too short (min 3 chars)'); return; }
    setSaving(true);
    setError(null);
    try {
      const resp = await apiClient.patch('/schedule/cell', {
        employeeId:   emp.employeeId,
        date,
        newShiftCode: newCode.trim().toUpperCase(),
        editType,
        reason:       reason.trim(),
      });
      setSaveResult(resp.data as SaveResult);
      onSaved();   // reload grid in background
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? (ar ? 'حدث خطأ' : 'An error occurred');
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setSaving(false);
    }
  };

  // Centre modal inside the schedule grid area
  const modalStyle = (() => {
    const W = 356, maxH = Math.min(560, (anchor?.vpH ?? window.innerHeight) - 40);
    if (anchor) {
      const left = anchor.gridLeft + anchor.gridWidth / 2 - W / 2;
      const top  = (anchor.vpH / 2) - (maxH / 2);
      return {
        top: Math.max(16, top),
        left: Math.max(12, left),
        width: W,
        maxHeight: maxH,
      };
    }
    return { top: '50%' as const, left: '50%' as const, transform: 'translate(-50%,-50%)', width: W, maxHeight: maxH };
  })();

  /* ── initials avatar ── */
  const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const accentColor = style.text ?? '#a5b4fc';
  const accentBg    = style.bg  ?? 'rgba(99,102,241,0.15)';

  return createPortal(
    <>
      {/* ── Backdrop ── */}
      <div className="fixed inset-0 z-50" style={{ background: 'rgba(2,6,18,0.72)', backdropFilter: 'blur(4px)' }} onClick={onClose} />

      {/* ── Card ── */}
      <div
        className="fixed z-50 flex flex-col"
        style={{
          ...modalStyle,
          borderRadius: 20,
          background: 'linear-gradient(160deg,#0d1424 0%,#0a1020 100%)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: `0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px ${accentColor}20`,
          animation: 'nx-slide 0.16s cubic-bezier(.22,.68,0,1.2)',
        }}
        onClick={e => e.stopPropagation()}
      >

        {/* ══════ HEADER ══════ */}
        <div className="flex-shrink-0 relative overflow-hidden rounded-t-[20px]">
          {/* colour band */}
          <div style={{ height: 3, background: `linear-gradient(90deg,${accentColor}80,${accentColor}20,transparent)` }} />

          <div className="px-5 pt-4 pb-3 flex items-start gap-3">
            {/* avatar */}
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-extrabold flex-shrink-0 mt-0.5"
              style={{ background: accentBg, color: accentColor, border: `1px solid ${accentColor}35` }}
            >
              {initials}
            </div>

            {/* name + meta */}
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-bold text-white leading-tight truncate">{emp.name}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                #{emp.employeeNo}
                {emp.functionName ? ` · ${emp.functionName}` : ''}
                {emp.employmentType ? ` · ${emp.employmentType}` : ''}
              </p>
            </div>

            {/* date pill + close */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-xl flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all"
              >
                <X size={14} />
              </button>
              <div
                className="text-[10px] font-semibold px-2.5 py-1 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {dateInfo.day} {dateInfo.dd} {dateInfo.mon}
              </div>
            </div>
          </div>

          {/* shift badge row */}
          {day && day.category !== 'no_data' && day.code && (
            <div className="px-5 pb-4 flex items-center gap-2">
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-extrabold"
                style={{ background: accentBg, color: accentColor, border: `1px solid ${accentColor}40` }}
              >
                <Clock size={12} />
                {day.code}
                {day.label && day.label !== day.code && (
                  <span className="text-[10px] font-medium opacity-70 ms-1">{day.label}</span>
                )}
              </div>
              {day.isWfh && (
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[10px] font-semibold"
                  style={{ background: 'rgba(6,182,212,0.12)', color: '#22d3ee', border: '1px solid rgba(6,182,212,0.25)' }}>
                  <Home size={10} />
                  {ar ? 'من البيت' : 'WFH'}
                </div>
              )}
              {day.lateMinutes > 0 && (
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[10px] font-semibold ms-auto"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.22)' }}>
                  <AlertCircle size={10} />
                  {ar ? 'متأخر' : 'Late'} {fmtMin(day.lateMinutes)}
                </div>
              )}
            </div>
          )}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
        </div>

        {/* ══════ BODY ══════ */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">

          {/* ── SAVE RESULT ── */}
          {saveResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(52,211,153,0.15)' }}>
                  <CheckCircle2 size={16} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-emerald-400">{ar ? 'تم الحفظ بنجاح' : 'Saved successfully'}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{saveResult.employeeName} · {saveResult.functionName}</p>
                </div>
              </div>

              {/* HC impact */}
              <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  {ar ? 'تأثير على الحضور' : 'HC Coverage Impact'}
                </p>
                <div className="flex items-center justify-center gap-6">
                  {[
                    { label: ar ? 'قبل' : 'Before', val: saveResult.hcBefore, color: '#94a3b8' },
                    { label: ar ? 'بعد' : 'After',  val: saveResult.hcAfter,  color: saveResult.hcDelta > 0 ? '#34d399' : saveResult.hcDelta < 0 ? '#f87171' : '#94a3b8' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="text-center">
                      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                      <span className="text-3xl font-extrabold" style={{ color }}>{val}</span>
                    </div>
                  ))}
                  {saveResult.hcDelta !== 0 && (
                    <div className="text-center">
                      <p className="text-[10px] text-slate-500 mb-1">{ar ? 'الفرق' : 'Δ'}</p>
                      <span className={`text-xl font-extrabold ${saveResult.hcDelta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {saveResult.hcDelta > 0 ? `+${saveResult.hcDelta}` : saveResult.hcDelta}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {saveResult.sourceOfChange && (() => {
                const src = SOURCE_LABELS[saveResult.sourceOfChange];
                return src ? (
                  <div className="flex items-center gap-2 text-[10px]">
                    <GitBranch size={11} className="text-slate-500" />
                    <span className="text-slate-500">{ar ? 'المصدر:' : 'Source:'}</span>
                    <span className="font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${src.color}18`, color: src.color, border: `1px solid ${src.color}30` }}>
                      {ar ? src.ar : src.en}
                    </span>
                  </div>
                ) : null;
              })()}

              {saveResult.requiresApproval && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)' }}>
                  <ShieldAlert size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-amber-300 leading-relaxed">
                    {ar ? 'يتطلب موافقة المشرف بسبب انتهاك قاعدة' : 'Requires supervisor approval — rule violation'}
                  </p>
                </div>
              )}

              {saveResult.validations.map((v, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl text-[11px]"
                  style={{
                    background: v.severity === 'error' ? 'rgba(239,68,68,0.07)' : v.severity === 'warning' ? 'rgba(245,158,11,0.07)' : 'rgba(99,102,241,0.07)',
                    border: `1px solid ${v.severity === 'error' ? 'rgba(239,68,68,0.2)' : v.severity === 'warning' ? 'rgba(245,158,11,0.2)' : 'rgba(99,102,241,0.2)'}`,
                    color: v.severity === 'error' ? '#f87171' : v.severity === 'warning' ? '#fbbf24' : '#a5b4fc',
                  }}>
                  {v.severity === 'error' ? <ShieldAlert size={12} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
                  {ar ? v.messageAr : v.messageEn}
                </div>
              ))}

              {saveResult.validations.length === 0 && !saveResult.requiresApproval && (
                <div className="flex items-center gap-2 text-[11px] text-emerald-400">
                  <ShieldCheck size={13} />
                  {ar ? 'لا انتهاكات للقواعد' : 'No rule violations'}
                </div>
              )}
            </div>
          )}

          {/* ── VIEW MODE ── */}
          {!editMode && !saveResult && (
            <div className="space-y-2.5">
              {(!day || day.category === 'no_data') ? (
                <div className="flex flex-col items-center py-8 gap-2 text-slate-500">
                  <Info size={22} className="opacity-40" />
                  <p className="text-sm">{ar ? 'لا يوجد بيانات لهذا اليوم' : 'No shift data for this day'}</p>
                </div>
              ) : (
                <>
                  {/* time card */}
                  {day.start && (
                    <div className="rounded-2xl p-3 grid grid-cols-2 gap-2"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{ar ? 'بداية' : 'Start'}</p>
                        <p className="text-base font-extrabold text-white">{fmt12(day.start)}</p>
                        <p className="text-[10px] text-slate-500">{fmt24(day.start)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{ar ? 'نهاية' : 'End'}</p>
                        <p className="text-base font-extrabold text-white">{fmt12(day.end)}</p>
                        <p className="text-[10px] text-slate-500">{fmt24(day.end)}</p>
                      </div>
                    </div>
                  )}

                  {/* stats row */}
                  {(day.punchIn || day.lateMinutes > 0 || day.otMinutes > 0) && (
                    <div className="grid grid-cols-3 gap-2">
                      {day.punchIn && (
                        <div className="rounded-xl px-3 py-2.5 text-center"
                          style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.15)' }}>
                          <p className="text-[9px] text-emerald-500 uppercase tracking-wider mb-1">{ar ? 'بصمة' : 'Punch'}</p>
                          <p className="text-sm font-bold text-emerald-400">{day.punchIn.slice(11,16)}</p>
                        </div>
                      )}
                      {day.lateMinutes > 0 && (
                        <div className="rounded-xl px-3 py-2.5 text-center"
                          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <p className="text-[9px] text-rose-400 uppercase tracking-wider mb-1">{ar ? 'تأخير' : 'Late'}</p>
                          <p className="text-sm font-bold text-rose-400">{fmtMin(day.lateMinutes)}</p>
                        </div>
                      )}
                      {day.otMinutes > 0 && (
                        <div className="rounded-xl px-3 py-2.5 text-center"
                          style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.15)' }}>
                          <p className="text-[9px] text-amber-400 uppercase tracking-wider mb-1">{ar ? 'أوفر' : 'OT'}</p>
                          <p className="text-sm font-bold text-amber-400">{fmtMin(day.otMinutes)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* timeline badge */}
              {(day?.editCount ?? 0) > 0 && (
                <button
                  onClick={() => { onTimeline?.(emp, date); onClose(); }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs transition-all group"
                  style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.18)', color: '#60a5fa' }}
                >
                  <div className="flex items-center gap-1.5">
                    <History size={12} />
                    {ar ? `عُدِّل ${day!.editCount} مرة` : `Edited ${day!.editCount}×`}
                    {day?.lastEditBy && <span className="text-slate-500 text-[10px] ms-1">{ar ? 'بواسطة' : 'by'} {day.lastEditBy}</span>}
                  </div>
                  <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              )}

              {/* inline history */}
              {history.length > 0 && (
                <>
                  <button onClick={() => setShowHistory(!showHistory)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[11px] transition-colors"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#64748b' }}>
                    <div className="flex items-center gap-1.5"><BadgeCheck size={12} />{ar ? 'سجل التعديلات' : 'Edit notes'}</div>
                    <ChevronDown size={12} style={{ transform: showHistory ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
                  </button>
                  {showHistory && (
                    <div className="space-y-2">
                      {history.slice(-3).map((h: any, i: number) => {
                        const et = EDIT_TYPES.find(e => e.value === h.type);
                        return (
                          <div key={i} className="rounded-xl px-3 py-2.5 space-y-1.5"
                            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: `${et?.color ?? '#64748b'}18`, color: et?.color ?? '#94a3b8', border: `1px solid ${et?.color ?? '#64748b'}30` }}>
                                {ar ? et?.ar : et?.en}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {h.at ? new Date(h.at).toLocaleString(ar ? 'ar-KW' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300">{h.reason}</p>
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <span style={{ color: CATEGORY_STYLE[deriveCategory(h.from?.start)]?.text }}>
                                {h.from?.start ? fmt12(h.from.start) : h.from?.marker ?? '?'}
                              </span>
                              <span>→</span>
                              <span style={{ color: '#34d399' }}>{h.to?.code ?? h.to?.start ?? h.to?.marker ?? '?'}</span>
                              <span className="ms-auto">{ar ? 'بواسطة' : 'by'} {h.by}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── EDIT MODE ── */}
          {editMode && !saveResult && (
            <div className="space-y-4">

              {/* from → to preview */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
                <div className="text-center">
                  <p className="text-[9px] text-slate-500 mb-1">{ar ? 'الحالية' : 'Current'}</p>
                  <span className="text-sm font-extrabold text-slate-300">{day?.code || '—'}</span>
                </div>
                <ArrowRight size={14} className="text-slate-600 flex-shrink-0" />
                <div className="text-center">
                  <p className="text-[9px] text-slate-500 mb-1">{ar ? 'الجديدة' : 'New'}</p>
                  <span className={`text-sm font-extrabold ${newCode ? 'text-indigo-300' : 'text-slate-600'}`}>{newCode || '?'}</span>
                </div>
              </div>

              {/* edit type */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{ar ? 'نوع التعديل' : 'Edit Type'}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {EDIT_TYPES.map(et => (
                    <button key={et.value} onClick={() => setEditType(et.value)}
                      className="text-[10px] font-semibold py-2 px-1 rounded-xl transition-all leading-tight"
                      style={{
                        background: editType === et.value ? `${et.color}20` : 'rgba(255,255,255,0.03)',
                        border: editType === et.value ? `1px solid ${et.color}55` : '1px solid rgba(255,255,255,0.07)',
                        color: editType === et.value ? et.color : '#475569',
                      }}>
                      {ar ? et.ar : et.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* shift code */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{ar ? 'الوردية الجديدة' : 'New Shift'}</p>
                <input
                  type="text"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  placeholder={ar ? 'مثال: N أو OFF' : 'e.g. N, OFF, MD'}
                  className="w-full px-3 py-2.5 rounded-xl text-sm font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500/50 mb-2.5"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_CODES.map(c => (
                    <button key={c} onClick={() => setNewCode(c)}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all"
                      style={{
                        background: newCode === c ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.04)',
                        border: newCode === c ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
                        color: newCode === c ? '#a5b4fc' : '#475569',
                      }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* reason */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {ar ? 'السبب' : 'Reason'} <span className="text-rose-500">*</span>
                </p>
                <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder={ar ? 'اكتب سبب التعديل...' : 'Explain the reason...'}
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <p className="text-[10px] text-slate-600 mt-1">
                  {reason.length}/200 {ar ? 'حرف' : 'chars'}
                  {reason.length > 0 && reason.length < 3 ? <span className="text-rose-500 ms-1">{ar ? '· قصير جداً' : '· too short'}</span> : null}
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-rose-400"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={12} className="flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══════ FOOTER ══════ */}
        <div className="flex-shrink-0 px-4 py-3 flex items-center gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)', borderRadius: '0 0 20px 20px' }}>

          {saveResult && (
            <>
              <button onClick={() => { onTimeline?.(emp, date); onClose(); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(96,165,250,0.08)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.22)' }}>
                <History size={13} />{ar ? 'عرض التاريخ' : 'View Timeline'}
              </button>
              <button onClick={onClose}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-white transition-all"
                style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
                <CheckCircle2 size={13} />{ar ? 'تم' : 'Done'}
              </button>
            </>
          )}

          {editMode && !saveResult && (
            <>
              <button onClick={() => { setEditMode(false); setError(null); setNewCode(''); setReason(''); }} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.07)' }}>
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={handleSave} disabled={saving || !newCode.trim() || reason.trim().length < 3}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-35 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? (ar ? 'يحفظ...' : 'Saving…') : (ar ? 'حفظ' : 'Save')}
              </button>
            </>
          )}

          {!editMode && !saveResult && (
            <>
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.07)' }}>
                {ar ? 'إغلاق' : 'Close'}
              </button>
              <button onClick={() => setEditMode(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all"
                style={{ background: `linear-gradient(135deg,${accentColor}22,${accentColor}15)`, color: accentColor, border: `1px solid ${accentColor}35` }}>
                <Pencil size={13} />{ar ? 'تعديل الوردية' : 'Edit Shift'}
              </button>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

/** Helper: derive category name from a start-time string (for history display) */
function deriveCategory(start: string | null | undefined): string {
  if (!start) return 'unknown';
  const h = parseInt(start.split(':')[0], 10);
  if (h >= 6 && h < 9)   return 'morning';
  if (h >= 9 && h < 13)  return 'between';
  if (h >= 13 && h < 22) return 'night';
  return 'midnight';
}

function Row({ icon, label, value, color = 'text-slate-200' }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span className={`text-xs font-semibold ${color}`}>{value}</span>
    </div>
  );
}

// ─── Coverage Bar ─────────────────────────────────────────────────────────────
function CoverageBar({ cov, dates, lang }: {
  cov: Record<string, { working: number; total: number }>;
  dates: string[];
  lang: 'ar' | 'en';
}) {
  return (
    <div className="rounded-2xl p-4 mb-4 card dark:bg-white/[0.03]">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
        {lang === 'ar' ? 'تغطية الحضور اليومية' : 'Daily Attendance Coverage'}
      </p>
      <div className="flex gap-2">
        {dates.map(d => {
          const c = cov[d];
          if (!c) return null;
          const pct = c.total > 0 ? Math.round((c.working / c.total) * 100) : 0;
          const info = fmtDate(d, lang);
          const isLow = pct < 60;
          return (
            <div key={d} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-bold" style={{ color: isLow ? '#f87171' : pct >= 80 ? '#34d399' : '#fbbf24' }}>
                {pct}%
              </span>
              <div
                className="w-full rounded-full overflow-hidden bg-slate-900/10 dark:bg-white/[0.06]"
                style={{ height: 6 }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: isLow ? '#f87171' : pct >= 80 ? '#34d399' : '#fbbf24',
                  }}
                />
              </div>
              <span className="text-[9px] text-slate-500">{info.day}</span>
              <span className="text-[9px] text-slate-500">{info.dd}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Legend ─────────────────────────────────────────────────────────────────
// Matches the real 4 working categories from the CC Schedule workbook
const LEGEND = [
  { cat: 'morning',  label: { ar: 'صباحي — M, AM, CCNO',      en: 'Morning — M, AM, CCNO'      }, time: '06–09' },
  { cat: 'between',  label: { ar: 'بين — B, C',               en: 'Between — B, C'             }, time: '09–13' },
  { cat: 'night',    label: { ar: 'مسائي — N, E, EE',         en: 'Night — N, E, EE'           }, time: '13–22' },
  { cat: 'midnight', label: { ar: 'منتصف الليل — MD, MN',     en: 'Midnight — MD, MN'          }, time: '22–06' },
  { cat: 'off',      label: { ar: 'إجازة أسبوعية',             en: 'Day Off'                    }, time: ''      },
  { cat: 'leave',    label: { ar: 'إجازة سنوية',               en: 'Annual Leave'               }, time: ''      },
  { cat: 'sick',     label: { ar: 'مرضية',                     en: 'Sick Leave'                 }, time: ''      },
  { cat: 'absent',   label: { ar: 'غياب',                      en: 'Absent'                     }, time: ''      },
  { cat: 'holiday',  label: { ar: 'عطلة رسمية',                en: 'Holiday'                    }, time: ''      },
];

// ─── Absence Analysis Panel ───────────────────────────────────────────────────
interface AbsenceCategorySummary {
  category: string;
  label: { ar: string; en: string; code: string };
  sick: number;
  absent: number;
  total: number;
  pct: number;
}
interface AbsenceData {
  grandTotal: number;
  mostAffectedShift: string | null;
  byCategory: AbsenceCategorySummary[];
  details: any[];
}

const ABSENCE_COLORS: Record<string, string> = {
  morning:  '#38bdf8',
  afternoon:'#fbbf24',
  night:    '#a78bfa',
  midnight: '#818cf8',
  unknown:  '#64748b',
};

function AbsencePanel({ data, loading, lang }: {
  data: AbsenceData | null;
  loading: boolean;
  lang: 'ar' | 'en';
}) {
  const ar = lang === 'ar';
  const [showDetails, setShowDetails] = useState(false);

  if (loading) return (
    <div
      className="rounded-2xl p-4 flex items-center justify-center card dark:bg-white/[0.02]"
      style={{ minHeight: 80 }}
    >
      <Loader2 size={18} className="animate-spin text-indigo-400" />
    </div>
  );

  if (!data || data.grandTotal === 0) return (
    <div
      className="rounded-2xl px-4 py-3 flex items-center gap-3"
      style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.15)' }}
    >
      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        {ar ? 'لا توجد غيابات في هذه الفترة' : 'No absences in this period'}
      </p>
    </div>
  );

  const maxTotal = Math.max(...data.byCategory.map(c => c.total), 1);

  return (
    <div className="rounded-2xl p-4 card dark:bg-white/[0.025]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-rose-400" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            {ar ? 'تحليل الغيابات حسب الشفت' : 'Absence Analysis by Shift'}
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
          >
            {data.grandTotal} {ar ? 'غياب' : 'total'}
          </span>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          {showDetails ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'التفاصيل' : 'Details')}
        </button>
      </div>

      {/* Shift breakdown bars */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.byCategory.filter(c => c.category !== 'unknown').map(cat => {
          const color = ABSENCE_COLORS[cat.category] ?? '#64748b';
          const barPct = maxTotal > 0 ? (cat.total / maxTotal) * 100 : 0;
          // Composite code: e.g. NS+NA for night
          const codeBase = cat.label.code.split('/')[0];
          const sCode = `${codeBase}S`;  // NS, MS, BS, MDS
          const aCode = `${codeBase}A`;  // NA, MA, BA, MDA

          return (
            <div key={cat.category} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold" style={{ color }}>
                  {ar ? cat.label.ar : cat.label.en}
                </span>
                <span className="text-[10px] text-slate-500">{cat.total}</span>
              </div>
              {/* Bar */}
              <div className="h-1.5 rounded-full overflow-hidden bg-slate-900/10 dark:bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${barPct}%`, background: color }}
                />
              </div>
              {/* Sub-codes */}
              <div className="flex gap-1">
                {cat.sick > 0 && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.2)' }}
                    title={ar ? 'مرضية' : 'Sick'}
                  >
                    {sCode} ×{cat.sick}
                  </span>
                )}
                {cat.absent > 0 && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                    title={ar ? 'غياب' : 'Absent'}
                  >
                    {aCode} ×{cat.absent}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Most affected */}
      {data.mostAffectedShift && (
        <p className="text-[10px] text-slate-500 mt-3 flex items-center gap-1">
          <AlertCircle size={10} className="text-amber-400" />
          {ar ? 'الشفت الأكثر تأثراً:' : 'Most affected shift:'}
          <span className="font-bold" style={{ color: ABSENCE_COLORS[data.mostAffectedShift] ?? '#94a3b8' }}>
            {ar
              ? data.byCategory.find(c => c.category === data.mostAffectedShift)?.label.ar
              : data.byCategory.find(c => c.category === data.mostAffectedShift)?.label.en
            }
          </span>
        </p>
      )}

      {/* Details table */}
      {showDetails && data.details.length > 0 && (
        <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
          {data.details.slice(0, 50).map((d: any, i: number) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] bg-slate-900/[0.03] dark:bg-white/[0.02]"
            >
              <span
                className="font-bold px-1.5 py-0.5 rounded text-[9px]"
                style={{
                  background: d.marker === 'sick' ? 'rgba(220,38,38,0.15)' : 'rgba(239,68,68,0.12)',
                  color: d.marker === 'sick' ? '#f87171' : '#ef4444',
                }}
              >
                {d.shiftCode}
              </span>
              <span className="text-slate-700 dark:text-slate-300 flex-1 truncate">{d.employeeName}</span>
              <span className="text-slate-500">{d.date}</span>
              {d.shiftStart && (
                <span className="text-slate-600 font-mono">{d.shiftStart}–{d.shiftEnd}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Audit Log Drawer ─────────────────────────────────────────────────────────
interface AuditEntry {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  functionName: string;
  date: string;
  at: string;
  by: string;
  type: string;
  reason: string;
  from: { marker?: string; start?: string; end?: string };
  to: { code?: string; marker?: string; start?: string; end?: string };
}

function AuditLogDrawer({ entries, loading, onClose, lang }: {
  entries: AuditEntry[];
  loading: boolean;
  onClose: () => void;
  lang: 'ar' | 'en';
}) {
  const ar = lang === 'ar';
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? entries.filter(e =>
        e.employeeName.toLowerCase().includes(search.toLowerCase()) ||
        e.reason.toLowerCase().includes(search.toLowerCase()) ||
        e.date.includes(search)
      )
    : entries;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 end-0 h-full z-50 flex flex-col"
        style={{
          width: 480,
          background: 'linear-gradient(160deg,#0d1321,#111827)',
          borderInlineStart: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '-24px 0 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <History size={16} className="text-indigo-400" />
              {ar ? 'سجل التعديلات' : 'Edit Audit Log'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {ar
                ? `${filtered.length} تعديل في هذه الفترة`
                : `${filtered.length} edit${filtered.length !== 1 ? 's' : ''} in this period`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 flex-shrink-0">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={ar ? 'بحث باسم الموظف أو التاريخ...' : 'Search by employee or date…'}
            className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-indigo-400" />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'rgba(99,102,241,0.1)' }}
              >
                <History size={20} className="text-indigo-400" />
              </div>
              <p className="text-slate-400 text-sm">
                {ar ? 'لا توجد تعديلات في هذه الفترة' : 'No edits in this period'}
              </p>
            </div>
          )}

          {!loading && filtered.map((entry, i) => {
            const et = EDIT_TYPES.find(e => e.value === entry.type);
            const fromLabel = entry.from?.start ? fmt12(entry.from.start) : entry.from?.marker ?? '—';
            const toLabel   = entry.to?.code ?? (entry.to?.start ? fmt12(entry.to.start) : entry.to?.marker ?? '—');
            const info = fmtDate(entry.date, lang);
            const editedAt = entry.at
              ? new Date(entry.at).toLocaleString(ar ? 'ar-KW' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
              : '';

            return (
              <div
                key={i}
                className="rounded-2xl p-3.5 space-y-2.5"
                style={{
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {/* Top row: employee + date */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#3b82f6)', color: 'white' }}
                    >
                      {entry.employeeName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{entry.employeeName}</p>
                      <p className="text-[10px] text-slate-500">#{entry.employeeNo} · {entry.functionName}</p>
                    </div>
                  </div>
                  <div className="text-end flex-shrink-0">
                    <p className="text-[11px] font-bold text-slate-300">
                      {info.day} {info.dd} {info.mon}
                    </p>
                    <p className="text-[10px] text-slate-500">{editedAt}</p>
                  </div>
                </div>

                {/* Shift change arrow */}
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(0,0,0,0.3)' }}
                >
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-lg"
                    style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
                  >
                    {fromLabel}
                  </span>
                  <span className="text-slate-500 text-sm">→</span>
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-lg"
                    style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}
                  >
                    {toLabel}
                  </span>
                  {et && (
                    <span
                      className="ms-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${et.color}15`, color: et.color, border: `1px solid ${et.color}30` }}
                    >
                      {ar ? et.ar : et.en}
                    </span>
                  )}
                </div>

                {/* Reason + who */}
                <div className="space-y-1">
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {entry.reason}
                  </p>
                  <p className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Users size={10} />
                    {ar ? 'بواسطة:' : 'By:'} {entry.by}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Cell Timeline Drawer ─────────────────────────────────────────────────────
interface TimelineEntry {
  seq: number;
  action: 'initial' | 'edit';
  at: string | null;
  from: { code?: string; marker?: string; start?: string; end?: string } | null;
  to: { code?: string; marker?: string; start?: string; end?: string } | null;
  by: string;
  type: string | null;
  sourceOfChange: string | null;
  validations: Array<{ rule: string; severity: string; messageAr: string; messageEn: string }>;
  requiresApproval: boolean;
}

function CellTimelineDrawer({ emp, date, onClose, lang }: {
  emp: Employee;
  date: string;
  onClose: () => void;
  lang: 'ar' | 'en';
}) {
  const ar = lang === 'ar';
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const dateInfo = fmtDate(date, lang);

  useEffect(() => {
    setLoading(true);
    apiClient.get(`/schedule/timeline/${emp.employeeId}/${date}`)
      .then(r => setEntries(Array.isArray(r.data) ? r.data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [emp.employeeId, date]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 end-0 h-full z-50 flex flex-col"
        style={{
          width: 440,
          background: 'linear-gradient(160deg,#0a0e1a,#0f1525)',
          borderInlineStart: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '-24px 0 64px rgba(0,0,0,0.65)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <History size={15} className="text-blue-400" />
              {ar ? 'تاريخ تغييرات الخلية' : 'Cell Change Timeline'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              <span className="font-semibold text-slate-200">{emp.name}</span>
              {' · '}
              {dateInfo.day} {dateInfo.dd} {dateInfo.mon}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{emp.functionName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Timeline body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={22} className="animate-spin text-blue-400" />
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'rgba(96,165,250,0.08)' }}>
                <History size={20} className="text-blue-400" />
              </div>
              <p className="text-slate-400 text-sm">
                {ar ? 'لا توجد تغييرات مسجّلة' : 'No recorded changes'}
              </p>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div className="relative">
              {/* Vertical line */}
              <div
                className="absolute start-[18px] top-2 bottom-2 w-px"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              />

              <div className="space-y-4">
                {entries.map((entry, idx) => {
                  const isInitial = entry.action === 'initial';
                  const et = EDIT_TYPES.find(e => e.value === (entry.type ?? ''));
                  const src = entry.sourceOfChange ? SOURCE_LABELS[entry.sourceOfChange] : null;
                  const fromLabel = entry.from?.code ?? (entry.from?.start ? fmt12(entry.from.start) : entry.from?.marker ?? '—');
                  const toLabel   = entry.to?.code   ?? (entry.to?.start   ? fmt12(entry.to.start)   : entry.to?.marker   ?? '—');
                  const dotColor  = isInitial ? '#6366f1' : entry.requiresApproval ? '#f59e0b' : '#34d399';

                  return (
                    <div key={idx} className="flex gap-3">
                      {/* Timeline dot */}
                      <div className="flex-shrink-0 relative z-10 mt-1">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center"
                          style={{ background: `${dotColor}18`, border: `1px solid ${dotColor}35` }}
                        >
                          {isInitial
                            ? <GitBranch size={14} style={{ color: dotColor }} />
                            : entry.requiresApproval
                              ? <ShieldAlert size={14} style={{ color: dotColor }} />
                              : <CheckCircle2 size={14} style={{ color: dotColor }} />
                          }
                        </div>
                      </div>

                      {/* Entry card */}
                      <div
                        className="flex-1 rounded-2xl p-3.5 space-y-2 mb-1"
                        style={{
                          background: isInitial ? 'rgba(99,102,241,0.05)' : 'rgba(255,255,255,0.025)',
                          border: `1px solid ${isInitial ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)'}`,
                        }}
                      >
                        {/* Top: action label + timestamp */}
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{
                              background: `${dotColor}18`,
                              color: dotColor,
                              border: `1px solid ${dotColor}35`,
                            }}
                          >
                            {isInitial
                              ? (ar ? 'الحالة الأصلية' : 'Original State')
                              : (ar ? `تعديل #${entry.seq}` : `Edit #${entry.seq}`)}
                          </span>
                          <span className="text-[10px] text-slate-500 flex-shrink-0">
                            {entry.at
                              ? new Date(entry.at).toLocaleString(ar ? 'ar-KW' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
                              : ''}
                          </span>
                        </div>

                        {/* Shift change */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {isInitial ? (
                            <span
                              className="text-xs font-bold px-2.5 py-1 rounded-lg"
                              style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}
                            >
                              {toLabel || fromLabel || '—'}
                            </span>
                          ) : (
                            <>
                              <span
                                className="text-xs font-bold px-2.5 py-1 rounded-lg"
                                style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
                              >
                                {fromLabel}
                              </span>
                              <ArrowRight size={12} className="text-slate-500" />
                              <span
                                className="text-xs font-bold px-2.5 py-1 rounded-lg"
                                style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}
                              >
                                {toLabel}
                              </span>
                            </>
                          )}

                          {/* Edit type badge */}
                          {et && (
                            <span
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-full ms-auto"
                              style={{ background: `${et.color}15`, color: et.color, border: `1px solid ${et.color}30` }}
                            >
                              {ar ? et.ar : et.en}
                            </span>
                          )}
                        </div>

                        {/* Source + who */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {src && (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: `${src.color}12`, color: src.color }}
                            >
                              {ar ? src.ar : src.en}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 ms-auto">
                            {isInitial ? (ar ? 'النظام' : 'system') : `${ar ? 'بواسطة' : 'by'} ${entry.by}`}
                          </span>
                        </div>

                        {/* Requires approval */}
                        {entry.requiresApproval && (
                          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
                            <ShieldAlert size={10} />
                            {ar ? 'يتطلب موافقة المشرف' : 'Requires supervisor approval'}
                          </div>
                        )}

                        {/* Validations */}
                        {(entry.validations ?? []).length > 0 && (
                          <div className="space-y-1">
                            {entry.validations.map((v, vi) => (
                              <p
                                key={vi}
                                className="text-[10px] flex items-center gap-1"
                                style={{ color: v.severity === 'error' ? '#f87171' : '#fbbf24' }}
                              >
                                <AlertCircle size={9} />
                                {ar ? v.messageAr : v.messageEn}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <p className="text-[10px] text-slate-600 text-center">
            {ar
              ? `${entries.length} إدخال في السجل · ${emp.name}`
              : `${entries.length} timeline entries · ${emp.name}`}
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Main Schedule Component ──────────────────────────────────────────────────
export default function SchedulePage() {
  const { lang } = useUiStore();
  useInjectDsStyles();
  const ar = lang === 'ar';

  const [weekStart, setWeekStart]       = useState<string>(currentWeekSat());
  const [weeks, setWeeks]               = useState<1|2|3|4>(1);
  const [availableWeeks, setAvailWeeks] = useState<string[]>([]);
  const [functions, setFunctions]       = useState<FunctionOption[]>([]);
  const [selFunction, setSelFunction]   = useState<string>('');
  const [gridData, setGridData]         = useState<GridData | null>(null);
  const [loading, setLoading]           = useState(false);
  const [expandedFuncs, setExpandedFuncs] = useState<Set<string>>(new Set());
  const [modal, setModal]               = useState<{ emp: Employee; date: string; day: DayEntry | undefined } | null>(null);
  const [modalAnchor, setModalAnchor]   = useState<{ gridLeft: number; gridWidth: number; vpH: number } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ empId: string; date: string } | null>(null);
  const gridRef                         = useRef<HTMLDivElement>(null);
  const [showLegend, setShowLegend]     = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog]         = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [absenceData, setAbsenceData]   = useState<AbsenceData | null>(null);
  const [absenceLoading, setAbsenceLoading] = useState(false);
  const [showAbsence, setShowAbsence]   = useState(false);
  const [timelineTarget, setTimelineTarget] = useState<{ emp: Employee; date: string } | null>(null);
  const [weekStatus, setWeekStatus]         = useState<{ status: 'draft' | 'published' | 'locked'; publishedAt: string | null; lockedAt: string | null } | null>(null);
  const [weekStatusLoading, setWeekStatusLoading] = useState(false);

  const loadWeekStatus = useCallback(() => {
    setWeekStatusLoading(true);
    apiClient.get(`/schedule/week-status?weekStart=${weekStart}`)
      .then(r => setWeekStatus(r.data))
      .catch(() => setWeekStatus({ status: 'draft', publishedAt: null, lockedAt: null }))
      .finally(() => setWeekStatusLoading(false));
  }, [weekStart]);

  useEffect(() => { loadWeekStatus(); }, [loadWeekStatus]);

  const handleWeekAction = async (action: 'publish' | 'lock' | 'unlock' | 'revert_to_draft') => {
    setWeekStatusLoading(true);
    try {
      const r = await apiClient.patch('/schedule/week-status', { weekStart, action });
      setWeekStatus(r.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? (ar ? 'حدث خطأ' : 'An error occurred');
      alert(Array.isArray(msg) ? msg.join('\n') : String(msg));
    } finally {
      setWeekStatusLoading(false);
    }
  };

  const loadAuditLog = useCallback(() => {
    setAuditLoading(true);
    apiClient.get(`/schedule/audit-log?weekStart=${weekStart}&weeks=${weeks}`)
      .then(r => setAuditLog(r.data))
      .catch(() => setAuditLog([]))
      .finally(() => setAuditLoading(false));
  }, [weekStart, weeks]);

  const loadAbsenceAnalysis = useCallback(() => {
    setAbsenceLoading(true);
    const params = new URLSearchParams({ weekStart, weeks: String(weeks) });
    if (selFunction) params.set('functionId', selFunction);
    apiClient.get(`/schedule/absence-analysis?${params}`)
      .then(r => setAbsenceData(r.data))
      .catch(() => setAbsenceData(null))
      .finally(() => setAbsenceLoading(false));
  }, [weekStart, weeks, selFunction]);

  // Auto-load absence analysis whenever grid changes
  useEffect(() => { if (showAbsence) loadAbsenceAnalysis(); }, [weekStart, weeks, selFunction, showAbsence, loadAbsenceAnalysis]);

  const openAuditLog = () => {
    setShowAuditLog(true);
    loadAuditLog();
  };

  // ── Load meta ──────────────────────────────────────────────────────────────
  useEffect(() => {
    apiClient.get('/schedule/available-weeks').then(r => {
      const weeks: string[] = r.data;
      setAvailWeeks(weeks);
      // Default to latest week that is on or before today
      const today = new Date().toISOString().split('T')[0];
      const pastWeek = weeks.find(w => w <= today) ?? weeks[0];
      if (pastWeek) setWeekStart(pastWeek);
    }).catch(() => {});
    apiClient.get('/schedule/functions').then(r => setFunctions(r.data)).catch(() => {});
  }, []);

  // ── Load grid ──────────────────────────────────────────────────────────────
  const loadGrid = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ weekStart, weeks: String(weeks) });
    if (selFunction) params.set('functionId', selFunction);
    apiClient.get(`/schedule/grid?${params}`)
      .then(r => {
        setGridData(r.data);
        setExpandedFuncs(new Set());
      })
      .catch(() => setGridData(null))
      .finally(() => setLoading(false));
  }, [weekStart, selFunction, weeks]);

  useEffect(() => { loadGrid(); }, [loadGrid]);

  // ── Period range display ───────────────────────────────────────────────────
  const weekLabel = () => {
    if (!gridData) return weekStart;
    const s = fmtDate(gridData.weekStart, lang);
    const e = fmtDate(gridData.weekEnd, lang);
    const rangeStr = ar
      ? `${s.dd} ${s.mon} – ${e.dd} ${e.mon}`
      : `${s.mon} ${s.dd} – ${e.mon} ${e.dd}`;
    if (weeks === 1) return rangeStr;
    const wLabel = ar
      ? weeks === 4 ? 'شهر' : `${weeks} أسابيع`
      : weeks === 4 ? 'Month' : `${weeks} weeks`;
    return `${rangeStr}  ·  ${wLabel}`;
  };

  // Column width depends on view mode
  const colWidth = weeks === 1 ? 90 : weeks === 2 ? 70 : weeks === 3 ? 58 : 50;

  const toggleFunc = (id: string) => {
    setExpandedFuncs(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Calendar size={20} className="text-indigo-500 dark:text-indigo-400" />
            {ar ? 'جدول الدوام' : 'Schedule Grid'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {ar ? 'عرض وتعديل جدول الموظفين مع سجل التدقيق' : 'View and edit employee schedules with audit trail'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                       text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white
                       bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 transition-colors"
          >
            <Eye size={14} />
            {ar ? 'المفتاح' : 'Legend'}
          </button>
          <button
            onClick={() => { setShowAbsence(!showAbsence); if (!showAbsence) loadAbsenceAnalysis(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                       text-red-600 dark:text-red-400"
            style={{
              background: showAbsence ? 'rgba(248,113,113,0.15)' : 'rgba(248,113,113,0.08)',
              border: showAbsence ? '1px solid rgba(248,113,113,0.4)' : '1px solid rgba(248,113,113,0.2)',
            }}
          >
            <BarChart2 size={14} />
            {ar ? 'تحليل الغيابات' : 'Absence Analysis'}
          </button>
          <button
            onClick={openAuditLog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                       text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <History size={14} />
            {ar ? 'سجل التعديلات' : 'Audit Log'}
          </button>
          <button
            onClick={loadGrid}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                       text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      {showLegend && (
        <div className="rounded-2xl p-4 flex flex-wrap gap-2 anim-fadeUp card dark:bg-white/[0.03]">
          {LEGEND.map(l => {
            const s = CATEGORY_STYLE[l.cat];
            return (
              <span
                key={l.cat}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
              >
                {ar ? l.label.ar : l.label.en}
                {l.time && (
                  <span className="text-[9px] opacity-60 font-mono">{l.time}</span>
                )}
              </span>
            );
          })}
          <span className="flex items-center gap-1 text-xs text-slate-500 ms-2">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" /> {ar ? 'تأخير' : 'Late'}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> {ar ? 'أوفرتايم' : 'Overtime'}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            🏠 {ar ? 'بيت' : 'WFH'}
          </span>
        </div>
      )}

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4 flex flex-wrap items-center gap-4 card dark:bg-white/[0.03]">
        {/* Period selector */}
        <div className="flex items-center gap-1">
          {([1,2,3,4] as const).map(w => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-all border ${
                weeks === w
                  ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/40 text-indigo-600 dark:text-indigo-300'
                  : 'bg-slate-900/[0.04] dark:bg-white/[0.04] border-slate-900/10 dark:border-white/10 text-slate-500'
              }`}
            >
              {w === 4 ? (ar ? 'شهر' : 'Mo') : ar ? `${w}أسب` : `${w}W`}
            </button>
          ))}
        </div>

        {/* Week navigator */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(shiftPeriod(weekStart, -1, weeks))}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                       hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors"
          >
            {ar ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <div className="text-center min-w-40">
            <p className="text-xs text-slate-500 dark:text-slate-400">{ar ? 'الفترة' : 'Period'}</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{weekLabel()}</p>
          </div>
          <button
            onClick={() => setWeekStart(shiftPeriod(weekStart, 1, weeks))}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                       hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors"
          >
            {ar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          <button
            onClick={() => setWeekStart(availableWeeks[0] ?? currentWeekSat())}
            className="text-xs px-2.5 py-1 rounded-lg text-indigo-600 dark:text-indigo-400
                       hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            style={{ background: 'rgba(99,102,241,0.1)' }}
          >
            {ar ? 'آخر فترة' : 'Latest'}
          </button>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-900/10 dark:bg-white/10" />

        {/* Function filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <select
            value={selFunction}
            onChange={e => setSelFunction(e.target.value)}
            className="text-xs rounded-xl px-3 py-1.5 text-slate-700 dark:text-slate-200 outline-none
                       focus:ring-2 focus:ring-indigo-500 bg-slate-900/5 dark:bg-white/[0.06]
                       border border-slate-900/10 dark:border-white/10"
          >
            <option value="">{ar ? 'كل الأقسام' : 'All Functions'}</option>
            {functions
              .filter(f => parseInt(f.employee_count) > 0)
              .map(f => (
                <option key={f.id} value={f.id}>{f.name} ({f.employee_count})</option>
              ))}
          </select>
        </div>

        {/* Stats */}
        {gridData && (
          <>
            <div className="h-6 w-px bg-slate-900/10 dark:bg-white/10" />
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-900 dark:text-white">{gridData.totalEmployees}</span>
                {' '}{ar ? 'موظف' : 'employees'}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-900 dark:text-white">{gridData.functions.length}</span>
                {' '}{ar ? 'قسم' : 'functions'}
              </span>
            </div>
          </>
        )}

        {/* Week Status Badge + Actions */}
        <div className="ms-auto flex items-center gap-2">
          {weekStatus && (() => {
            const cfg = {
              draft:     { label: ar ? 'مسودة' : 'Draft',     bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: 'rgba(100,116,139,0.25)', Icon: Clock },
              published: { label: ar ? 'منشور' : 'Published', bg: 'rgba(34,197,94,0.12)',  color: '#4ade80', border: 'rgba(34,197,94,0.3)',    Icon: CheckCircle2 },
              locked:    { label: ar ? 'مقفل'  : 'Locked',    bg: 'rgba(99,102,241,0.12)', color: '#818cf8', border: 'rgba(99,102,241,0.3)',   Icon: Lock },
            }[weekStatus.status];
            const { Icon } = cfg;
            return (
              <span
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
              >
                {weekStatusLoading ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                {cfg.label}
              </span>
            );
          })()}

          {weekStatus?.status === 'draft' && (
            <button
              onClick={() => handleWeekAction('publish')}
              disabled={weekStatusLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}
            >
              <Send size={12} />
              {ar ? 'نشر الجدول' : 'Publish'}
            </button>
          )}

          {weekStatus?.status === 'published' && (
            <>
              <button
                onClick={() => handleWeekAction('lock')}
                disabled={weekStatusLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
              >
                <Lock size={12} />
                {ar ? 'قفل الجدول' : 'Lock'}
              </button>
              <button
                onClick={() => handleWeekAction('revert_to_draft')}
                disabled={weekStatusLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                <RotateCcw size={12} />
                {ar ? 'رجوع لمسودة' : 'Revert'}
              </button>
            </>
          )}

          {weekStatus?.status === 'locked' && (
            <button
              onClick={() => handleWeekAction('unlock')}
              disabled={weekStatusLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}
            >
              <Unlock size={12} />
              {ar ? 'فكّ القفل' : 'Unlock'}
            </button>
          )}
        </div>
      </div>

      {/* ── Coverage Bar ──────────────────────────────────────────────────── */}
      {gridData && <CoverageBar cov={gridData.coverage} dates={gridData.dates} lang={lang} />}

      {/* ── Absence Analysis Panel ────────────────────────────────────────── */}
      {showAbsence && (
        <AbsencePanel data={absenceData} loading={absenceLoading} lang={lang} />
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-indigo-400" />
        </div>
      )}

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      {!loading && gridData && (
        <div ref={gridRef} className="space-y-3 anim-fadeUp">
          {gridData.functions.map(func => {
            const expanded = expandedFuncs.has(func.id);
            // Only compute per-day counts when rendering header (cheap, just counting)
            const funcCov: Record<string, number> = {};
            for (const d of gridData.dates) {
              funcCov[d] = func.employees.filter(e => e.days[d]?.marker === 'present').length;
            }

            return (
              <div
                key={func.id}
                className="rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/10"
              >
                {/* Function header */}
                <button
                  onClick={() => toggleFunc(func.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:brightness-110 transition-all"
                  style={{ background: 'rgba(99,102,241,0.08)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center"
                      style={{ background: 'rgba(99,102,241,0.2)' }}
                    >
                      <Users size={12} className="text-indigo-400" />
                    </div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{func.name}</span>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full bg-slate-900/10 dark:bg-white/[0.06]
                                 text-slate-500 dark:text-slate-400"
                    >
                      {func.employees.length} {ar ? 'موظف' : 'employees'}
                    </span>
                  </div>

                  {/* Mini coverage per day */}
                  <div className="flex items-center gap-2">
                    <div className="hidden lg:flex gap-1 items-center">
                      {gridData.dates.map(d => {
                        const w = funcCov[d];
                        const t = func.employees.length;
                        const pct = t > 0 ? w / t : 0;
                        return (
                          <div
                            key={d}
                            className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold"
                            style={{
                              background: pct >= 0.8 ? 'rgba(52,211,153,0.15)' : pct >= 0.5 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                              color: pct >= 0.8 ? '#34d399' : pct >= 0.5 ? '#fbbf24' : '#f87171',
                            }}
                          >
                            {w}
                          </div>
                        );
                      })}
                    </div>
                    <ChevronRight
                      size={14}
                      className="text-slate-400 transition-transform duration-200"
                      style={{ transform: expanded ? 'rotate(90deg)' : '' }}
                    />
                  </div>
                </button>

                {/* Grid table */}
                {expanded && (
                  <div className="overflow-x-auto" style={{ background: 'rgba(7,9,15,0.6)' }}>
                    <table className="w-full border-collapse" style={{ minWidth: 700 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          {/* Employee column */}
                          <th
                            className="text-start px-3 py-2.5 sticky start-0 z-10"
                            style={{
                              minWidth: 160,
                              background: 'rgba(7,9,15,0.95)',
                              borderInlineEnd: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              {ar ? 'الموظف' : 'Employee'}
                            </span>
                          </th>
                          {/* Date columns */}
                          {gridData.dates.map(d => {
                            const info = fmtDate(d, lang);
                            return (
                              <th
                                key={d}
                                className="text-center px-1 py-2"
                                style={{
                                  minWidth: colWidth,
                                  borderInlineEnd: '1px solid rgba(255,255,255,0.04)',
                                }}
                              >
                                <div
                                  className={`flex flex-col items-center gap-0.5 mx-1 rounded-xl py-1 px-1.5 ${
                                    info.isToday ? 'text-indigo-300' : 'text-slate-400'
                                  }`}
                                  style={info.isToday ? {
                                    background: 'rgba(99,102,241,0.15)',
                                    border: '1px solid rgba(99,102,241,0.3)',
                                  } : {}}
                                >
                                  <span className="text-[10px] font-bold uppercase">{info.day}</span>
                                  <span className="text-[13px] font-extrabold leading-none">{info.dd}</span>
                                  <span className="text-[9px] opacity-60">{info.mon}</span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {func.employees.map((emp, idx) => (
                          <tr
                            key={emp.employeeId}
                            className="group hover:bg-white/[0.02] transition-colors"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                          >
                            {/* Employee cell */}
                            <td
                              className="px-3 py-1.5 sticky start-0 z-10"
                              style={{
                                background: idx % 2 === 0 ? 'rgba(7,9,15,0.95)' : 'rgba(10,12,20,0.95)',
                                borderInlineEnd: '1px solid rgba(255,255,255,0.06)',
                              }}
                            >
                              <div className="flex items-center gap-2">
                                {/* Avatar */}
                                <div
                                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                                  style={{
                                    background: emp.gender === 'female'
                                      ? 'linear-gradient(135deg,#ec4899,#a855f7)'
                                      : 'linear-gradient(135deg,#6366f1,#3b82f6)',
                                    color: 'white',
                                  }}
                                >
                                  {emp.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-200 truncate max-w-[120px]">{emp.name}</p>
                                  <p className="text-[9px] text-slate-500 truncate">
                                    #{emp.employeeNo}
                                    {emp.employmentType === 'intern' && (
                                      <span className="ms-1 text-amber-400">{ar ? 'متدرب' : 'intern'}</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </td>
                            {/* Shift cells */}
                            {gridData.dates.map(d => (
                              <ShiftCell
                                key={d}
                                date={d}
                                emp={emp}
                                day={emp.days[d]}
                                colWidth={colWidth}
                                ar={ar}
                                isSelected={selectedCell?.empId === emp.employeeId && selectedCell?.date === d}
                              onCellClick={(e, date, day) => {
                                if (weekStatus?.status === 'locked') return;
                                const gr = gridRef.current?.getBoundingClientRect();
                                setModalAnchor(gr
                                  ? { gridLeft: gr.left, gridWidth: gr.width, vpH: window.innerHeight }
                                  : null);
                                setSelectedCell({ empId: e.employeeId, date });
                                setModal({ emp: e, date, day });
                              }}
                                onHistoryClick={(e, date) => setTimelineTarget({ emp: e, date })}
                              />
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !gridData && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(99,102,241,0.1)' }}
          >
            <Calendar size={28} className="text-indigo-400" />
          </div>
          <p className="text-slate-400 text-sm">{ar ? 'لا توجد بيانات لهذا الأسبوع' : 'No data for this week'}</p>
        </div>
      )}

      {/* ── Day Modal ─────────────────────────────────────────────────────── */}
      {modal && (
        <DayModal
          emp={modal.emp}
          date={modal.date}
          day={modal.day}
          lang={lang}
          anchor={modalAnchor ?? undefined}
          onClose={() => { setModal(null); setSelectedCell(null); setModalAnchor(null); }}
          onSaved={() => { loadGrid(); loadAuditLog(); }}
          onTimeline={(emp, date) => setTimelineTarget({ emp, date })}
        />
      )}

      {/* ── Cell Timeline Drawer ──────────────────────────────────────────── */}
      {timelineTarget && (
        <CellTimelineDrawer
          emp={timelineTarget.emp}
          date={timelineTarget.date}
          lang={lang}
          onClose={() => setTimelineTarget(null)}
        />
      )}

      {/* ── Audit Log Drawer ──────────────────────────────────────────────── */}
      {showAuditLog && (
        <AuditLogDrawer
          entries={auditLog}
          loading={auditLoading}
          onClose={() => setShowAuditLog(false)}
          lang={lang}
        />
      )}
    </div>
  );
}
