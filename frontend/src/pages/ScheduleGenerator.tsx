import { useState, useEffect, useCallback } from 'react';
import {
  Zap, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, CloudUpload, ChevronDown, ChevronUp,
  Users, Clock, ShieldCheck, SlidersHorizontal,
  Calendar, ChevronLeft, ChevronRight, Info, Send, Lock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { fmtLocalDate, weekStartSat } from '@/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ShiftDef { code: string; label: string; color: string; category: string; }
interface DayAssignment { date: string; dayName: string; shift: ShiftDef; violations: string[]; restHours: number; }
interface EmployeeSchedule {
  employee: { id: string; name: string; gender: string; employmentType: string; functionName: string };
  ytdDist: { morning: number; evening: number; night: number; midnight: number; off: number; total: number };
  assignments: DayAssignment[];
  weekStats: { morningCount: number; eveningCount: number; nightCount: number; midnightCount: number; offCount: number; violationCount: number };
}
interface CoverageDay { date: string; dayName: string; total: number; working: number; off: number; morning: number; evening: number; night: number; midnight: number; coveragePct: number; }
interface Violation { type: string; employeeId?: string; employeeName?: string; date?: string; shiftCode?: string; restHours?: number; severity: 'error' | 'warning'; messageAr: string; messageEn?: string; }
interface FairnessDetail { employeeId: string; name: string; morningPct: number; eveningPct: number; nightPct: number; midnightPct: number; }
interface GeneratorResult {
  weekStart: string; weekEnd: string; dates: string[];
  functions: { id: string; name: string; employees: EmployeeSchedule[] }[];
  coverage: CoverageDay[];
  violations: Violation[];
  fairness: { score: number; nightVariance: number; details: FairnessDetail[] };
  summary: { totalEmployees: number; totalErrors: number; totalWarnings: number; avgCoveragePct: number; offAssigned: number; workingDays: number };
  generatedAt: string;
  versionId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DAY_NAMES_AR = ['أحد','إث','ثلا','أرب','خمس','جمع','سبت'];
function fmtDateAr(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_NAMES_AR[d.getDay()]} ${d.getDate()}`;
}
function fmtRangeAr(from: string, to: string) {
  const s = new Date(from + 'T00:00:00');
  const e = new Date(to   + 'T00:00:00');
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${s.getDate()} ${MONTHS_AR[s.getMonth()]} – ${e.getDate()} ${MONTHS_AR[e.getMonth()]}`;
}
function fmtRange(from: string, to: string, arMode: boolean) {
  if (arMode) return fmtRangeAr(from, to);
  const s = new Date(from + 'T00:00:00');
  const e = new Date(to   + 'T00:00:00');
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmtLocalDate(d);
}
const currentSat = () => weekStartSat();

// ─── Shift Cell ───────────────────────────────────────────────────────────────
function GenShiftCell({ day }: { day: DayAssignment }) {
  const hasViolation = day.violations.length > 0;
  const isError = day.violations.some(v => v.startsWith('female_blocked') || v.startsWith('rest'));
  const isOff   = day.shift.code === 'OFF';

  return (
    <td className="p-1 text-center">
      <div
        className="inline-flex flex-col items-center justify-center w-11 h-9 rounded-lg text-xs font-bold relative"
        style={isOff
          ? { background: 'rgba(71,85,105,0.15)', color: '#64748b', border: '1px solid rgba(71,85,105,0.2)' }
          : { background: `${day.shift.color}20`, color: day.shift.color, border: `1px solid ${day.shift.color}40` }
        }
        title={`${day.shift.label}${day.violations.length ? ' ⚠ ' + day.violations.join(', ') : ''}`}
      >
        <span className="text-[11px] font-bold">{day.shift.code}</span>
        {hasViolation && (
          <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full border border-white dark:border-slate-900 ${isError ? 'bg-red-500' : 'bg-amber-400'}`} />
        )}
      </div>
    </td>
  );
}

// ─── Coverage Bars ────────────────────────────────────────────────────────────
const DAY_NAMES_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtDateEn(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_NAMES_EN[d.getDay()]} ${d.getDate()}`;
}
function CoverageBar({ days, dates }: { days: CoverageDay[]; dates: string[] }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const fmtDay = (iso: string) => ar ? fmtDateAr(iso) : fmtDateEn(iso);
  return (
    <div className="flex gap-1">
      {dates.map(date => {
        const d = days.find(c => c.date === date);
        const pct = d?.coveragePct ?? 0;
        const col = pct >= 80 ? '#34d399' : pct >= 60 ? '#fbbf24' : '#f87171';
        return (
          <div key={date} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold" style={{ color: col }}>{pct}%</span>
            <div className="w-full rounded-full bg-slate-900/10 dark:bg-white/[0.06]" style={{ height: 5 }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
            </div>
            <span className="text-[9px] text-slate-500">{fmtDay(date).split(' ')[0]}</span>
            <span className="text-[9px] text-slate-500">{fmtDay(date).split(' ')[1]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Function Group ───────────────────────────────────────────────────────────
function FunctionGroup({ fn, dates, defaultOpen = false }: { fn: GeneratorResult['functions'][0]; dates: string[]; defaultOpen?: boolean }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [open, setOpen] = useState(defaultOpen);
  const violations = fn.employees.reduce((a, e) => a + e.weekStats.violationCount, 0);

  return (
    <div className="rounded-xl overflow-hidden mb-2 border border-slate-900/10 dark:border-white/[0.06]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 transition-all hover:brightness-110"
        style={{ background: 'rgba(99,102,241,0.07)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)' }}>
            <Users size={11} className="text-indigo-400" />
          </div>
          <span className="text-sm font-bold text-slate-900 dark:text-white">{fn.name}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full text-slate-500 dark:text-slate-400 bg-slate-900/10 dark:bg-white/[0.06]">
            {fn.employees.length} {ar ? 'موظف' : 'staff'}
          </span>
          {violations > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full text-red-600 dark:text-red-400 flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.1)' }}>
              <AlertTriangle size={9} /> {violations}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden lg:flex gap-1">
            {dates.map(d => {
              const w = fn.employees.filter(e => e.assignments.find(a => a.date === d)?.shift.code !== 'OFF').length;
              const t = fn.employees.length;
              const pct = t > 0 ? w / t : 0;
              return (
                <div key={d} className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold"
                  style={{
                    background: pct >= 0.8 ? 'rgba(52,211,153,0.12)' : pct >= 0.5 ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.12)',
                    color:      pct >= 0.8 ? '#34d399' : pct >= 0.5 ? '#fbbf24' : '#f87171',
                  }}>
                  {w}
                </div>
              );
            })}
          </div>
          <ChevronRight size={14} className="text-slate-400 transition-transform duration-200"
            style={{ transform: open ? 'rotate(90deg)' : '' }} />
        </div>
      </button>

      {open && (
        // Intentionally dark grid canvas (same as Schedule grid) — keeps light text in both themes
        <div className="overflow-x-auto" style={{ background: 'rgba(7,9,15,0.75)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th className="text-start px-4 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider min-w-[140px]">
                  {ar ? 'الموظف' : 'Employee'}
                </th>
                <th className="text-center px-1 py-2 text-[10px] text-slate-500 w-6">{ar ? 'ج' : 'G'}</th>
                {dates.map((date, i) => (
                  <th key={date} className="text-center px-1 py-2 text-[10px] font-semibold text-slate-400 w-12">
                    {ar
                      ? ['سبت','أحد','اثن','ثلا','أرب','خمس','جمع'][i % 7]
                      : ['Sat','Sun','Mon','Tue','Wed','Thu','Fri'][i % 7]}
                    <br />
                    <span className="text-slate-600 font-normal">{new Date(date + 'T00:00:00').getDate()}</span>
                  </th>
                ))}
                <th className="text-center px-1 py-2 text-[10px] text-sky-500 font-semibold" title={ar ? 'صباحي' : 'Morning'}>{ar ? 'ص' : 'M'}</th>
                <th className="text-center px-1 py-2 text-[10px] text-purple-400 font-semibold" title={ar ? 'ليلي' : 'Night'}>{ar ? 'ل' : 'N'}</th>
                <th className="text-center px-1 py-2 text-[10px] text-slate-500 font-semibold" title={ar ? 'إجازة' : 'Off'}>{ar ? 'أج' : 'Off'}</th>
              </tr>
            </thead>
            <tbody>
              {fn.employees.map((es, idx) => (
                <tr key={es.employee.id}
                  className="group hover:bg-white/[0.02] transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                        style={{
                          background: es.employee.gender === 'female'
                            ? 'linear-gradient(135deg,#ec4899,#a855f7)' : 'linear-gradient(135deg,#6366f1,#3b82f6)',
                          color: 'white',
                        }}>
                        {es.employee.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-200 truncate max-w-[110px]">{es.employee.name}</p>
                        {es.employee.employmentType === 'intern' && (
                          <p className="text-[9px] text-amber-400">{ar ? 'متدرب' : 'Intern'}</p>
                        )}
                      </div>
                      {es.weekStats.violationCount > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="text-center px-1">
                    <span className="text-[9px] font-bold" style={{ color: es.employee.gender === 'female' ? '#f472b6' : '#60a5fa' }}>
                      {es.employee.gender === 'female' ? 'F' : 'M'}
                    </span>
                  </td>
                  {es.assignments.map(day => <GenShiftCell key={day.date} day={day} />)}
                  <td className="text-center px-1 text-[10px] font-bold text-sky-400">{es.weekStats.morningCount}</td>
                  <td className="text-center px-1 text-[10px] font-bold text-purple-400">{es.weekStats.nightCount}</td>
                  <td className="text-center px-1 text-[10px] font-bold text-slate-500">{es.weekStats.offCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Violations Panel ─────────────────────────────────────────────────────────
function ViolationsPanel({ violations }: { violations: Violation[] }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const errors   = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  if (!violations.length) return (
    <div className="flex items-center gap-2 p-3 rounded-xl text-emerald-700 dark:text-emerald-400 text-sm"
      style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
      <CheckCircle2 size={15} className="flex-shrink-0" />
      {ar ? 'لا توجد مخالفات — الجدول مطابق لجميع القواعد التشغيلية' : 'No violations — schedule meets all operational rules'}
    </div>
  );

  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="p-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={13} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            <span className="text-xs font-bold text-red-600 dark:text-red-400">{errors.length} {ar ? 'خطأ يحتاج مراجعة' : 'error(s) need review'}</span>
          </div>
          <div className="space-y-1">
            {errors.slice(0, 5).map((v, i) => (
              <div key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <span className="mt-0.5 text-red-500">•</span>{ar ? v.messageAr : (v.messageEn ?? v.messageAr)}
              </div>
            ))}
            {errors.length > 5 && <p className="text-[10px] text-red-500">+{errors.length - 5} {ar ? 'أخرى…' : 'more…'}</p>}
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="p-3 rounded-xl" style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
            <span className="text-xs font-bold text-amber-400">{warnings.length} {ar ? 'تحذير' : 'warning(s)'}</span>
          </div>
          <div className="space-y-1">
            {warnings.slice(0, 5).map((v, i) => (
              <div key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                <span className="mt-0.5 text-amber-500">•</span>{ar ? v.messageAr : (v.messageEn ?? v.messageAr)}
              </div>
            ))}
            {warnings.length > 5 && <p className="text-[10px] text-amber-500">+{warnings.length - 5} {ar ? 'أخرى…' : 'more…'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fairness Ring ────────────────────────────────────────────────────────────
function FairnessRing({ fairness }: { fairness: GeneratorResult['fairness'] }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const score = fairness.score;
  const c = circumference(30);
  const offset = c - (score / 100) * c;
  const ringCol = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  const textCol = score >= 80
    ? 'text-emerald-600 dark:text-emerald-400'
    : score >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="p-4 rounded-2xl space-y-4 card dark:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-indigo-400" />
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">{ar ? 'مؤشر العدالة' : 'Fairness Score'}</h3>
        </div>
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 70 70">
            <circle cx="35" cy="35" r="30" fill="none" stroke="currentColor" className="text-slate-900/10 dark:text-white/[0.08]" strokeWidth="7" />
            <circle cx="35" cy="35" r="30" fill="none" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={offset}
              stroke={ringCol} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <div className={`absolute inset-0 flex items-center justify-center text-xs font-extrabold ${textCol}`}>
            {score}%
          </div>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        {ar ? 'تباين ليلي:' : 'Night variance:'} <span className="font-semibold text-slate-400">{fairness.nightVariance}</span>
      </p>
      {fairness.details.slice(0, 6).map(d => (
        <div key={d.employeeId} className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 w-24 truncate">{d.name}</span>
          <div className="flex-1 flex h-2.5 rounded-full overflow-hidden bg-slate-900/10 dark:bg-white/5">
            <div className="bg-sky-500"    style={{ width: `${d.morningPct}%`  }} title={`${ar ? 'صباحي' : 'Morning'} ${d.morningPct}%`} />
            <div className="bg-amber-400"  style={{ width: `${d.eveningPct}%`  }} title={`${ar ? 'مسائي' : 'Evening'} ${d.eveningPct}%`} />
            <div className="bg-purple-500" style={{ width: `${d.nightPct}%`    }} title={`${ar ? 'ليلي' : 'Night'} ${d.nightPct}%`} />
            <div className="bg-indigo-900" style={{ width: `${d.midnightPct}%` }} title={`${ar ? 'منتصف' : 'Midnight'} ${d.midnightPct}%`} />
          </div>
        </div>
      ))}
      <div className="flex gap-3 flex-wrap">
        {([
          ['bg-sky-500',    ar ? 'صباحي'       : 'Morning'],
          ['bg-amber-400',  ar ? 'مسائي'       : 'Evening'],
          ['bg-purple-500', ar ? 'ليلي'        : 'Night'],
          ['bg-indigo-900', ar ? 'منتصف الليل' : 'Midnight'],
        ] as [string, string][]).map(([cls, lbl]) => (
          <span key={lbl} className="flex items-center gap-1 text-[9px] text-slate-500">
            <span className={`w-2 h-2 rounded-sm ${cls}`} />{lbl}
          </span>
        ))}
      </div>
    </div>
  );
}
function circumference(r: number) { return 2 * Math.PI * r; }

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScheduleGeneratorPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [weeks, setWeeks]           = useState<1|2|3|4>(1);
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);
  const [functions, setFunctions]   = useState<{ id: string; name: string; employee_count: string }[]>([]);
  const [selectedWeek, setSelectedWeek] = useState(currentSat());
  const [selectedFns, setSelectedFns]   = useState<string[]>([]);
  const [femaleLateFns, setFemaleLateFns] = useState<string[]>([]);  // per-function female-N exception
  const [options, setOptions]   = useState({ minRestHours: 10, offDaysPerWeek: 1, allowFemaleN: false });
  const [showOptions, setShowOptions]   = useState(false);
  const [result, setResult]     = useState<GeneratorResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');
  const [saveOk, setSaveOk]     = useState(false);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');
  const [publishOk, setPublishOk]   = useState(false);
  const [error, setError]       = useState('');
  const [weekStatus, setWeekStatus] = useState<{ status: 'draft' | 'published' | 'locked'; publishedAt: string | null; lockedAt: string | null } | null>(null);

  // Non-empty functions
  const activeFns = functions.filter(f => parseInt(f.employee_count) > 0);

  useEffect(() => {
    Promise.all([
      apiClient.get('/schedule-generator/available-weeks'),
      apiClient.get('/schedule-generator/functions'),
    ]).then(([wRes, fRes]) => {
      const wks: string[] = wRes.data ?? [];
      setAvailableWeeks(wks);
      const today = fmtLocalDate(new Date());
      const future = wks.filter(w => w >= today);
      setSelectedWeek(future[future.length - 1] ?? wks[0] ?? currentSat());
      setFunctions(fRes.data ?? []);
    }).catch(() => {});
  }, []);

  // Week publish/lock status for the selected week (same source as the Schedule grid)
  useEffect(() => {
    if (!selectedWeek) return;
    apiClient.get(`/schedule/week-status?weekStart=${selectedWeek}`)
      .then(r => setWeekStatus(r.data))
      .catch(() => setWeekStatus(null));
  }, [selectedWeek]);

  const toggleFn = (id: string) => {
    setSelectedFns(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const weekEnd = addDays(selectedWeek, weeks * 7 - 1);

  const handleGenerate = useCallback(async () => {
    if (!selectedWeek) return;
    // Reset ALL save/publish state — a new result invalidates any previously-saved draft
    setLoading(true); setError(''); setResult(null); setSaveMsg(''); setSaveOk(false);
    setSavedVersionId(null); setPublishMsg(''); setPublishOk(false);
    try {
      const body: any = {
        weekStart: selectedWeek,
        options: { ...options, weeks, femaleLateFunctionIds: femaleLateFns },
      };
      if (selectedFns.length > 0) body.functionIds = selectedFns;
      const res = await apiClient.post('/schedule-generator/generate', body);
      setResult(res.data);
    } catch (e: any) {
      const arErr = useUiStore.getState().lang === 'ar';
      setError(e?.response?.data?.message ?? (arErr ? 'حدث خطأ أثناء التوليد' : 'An error occurred during generation'));
    } finally {
      setLoading(false);
    }
  }, [selectedWeek, selectedFns, options, weeks]);

  const handleSave = async () => {
    if (!selectedWeek) return;
    setSaving(true); setSaveMsg(''); setSaveOk(false);
    const arNow = useUiStore.getState().lang === 'ar';
    try {
      const body: any = {
        weekStart: selectedWeek,
        options: { ...options, weeks, femaleLateFunctionIds: femaleLateFns },
        label: arNow
          ? `مسودة — ${fmtRangeAr(selectedWeek, weekEnd)}`
          : `Draft — ${fmtRange(selectedWeek, weekEnd, false)}`,
      };
      if (selectedFns.length > 0) body.functionIds = selectedFns;
      const res = await apiClient.post('/schedule-generator/save', body);
      setSaveOk(true);
      setSavedVersionId(res.data?.versionId ?? null);
      setPublishMsg(''); setPublishOk(false);
      setSaveMsg(arNow
        ? `تم الحفظ كمسودة — ${res.data?.versionId?.substring(0, 8)}…`
        : `Saved as draft — ${res.data?.versionId?.substring(0, 8)}…`);
      if (result) setResult({ ...result, versionId: res.data?.versionId });
    } catch (e: any) {
      setSaveOk(false);
      setSaveMsg(arNow
        ? 'فشل الحفظ: ' + (e?.response?.data?.message ?? 'خطأ غير معروف')
        : 'Save failed: ' + (e?.response?.data?.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Publish the saved draft → applies the schedule to attendance_records so every
  // agent sees their new shifts. Requires a Save first (needs the version id).
  // Selected week already published/locked on the live grid → publishing is blocked
  const weekBlocked = weekStatus?.status === 'published' || weekStatus?.status === 'locked';

  const handlePublish = async () => {
    if (!savedVersionId || weekBlocked) return;
    const arNow = useUiStore.getState().lang === 'ar';
    if (!window.confirm(arNow
      ? 'سيتم نشر الجدول وإرساله لجميع الموظفين (يظهر بجدولهم). متابعة؟'
      : 'This publishes the schedule to all agents (it appears in their schedule). Continue?')) return;
    setPublishing(true); setPublishMsg(''); setPublishOk(false);
    try {
      const res = await apiClient.post(`/schedule-generator/versions/${savedVersionId}/publish`);
      setPublishOk(true);
      const n = res.data?.appliedToAgents ?? 0;
      setPublishMsg(arNow ? `تم النشر — وصل ${n} موظف/يوم لجداول الموظفين ✓` : `Published — ${n} shifts pushed to agents ✓`);
      // Refresh the week badge — the week is now published
      apiClient.get(`/schedule/week-status?weekStart=${selectedWeek}`)
        .then(r => setWeekStatus(r.data)).catch(() => {});
    } catch (e: any) {
      setPublishOk(false);
      setPublishMsg(arNow
        ? 'فشل النشر: ' + (e?.response?.data?.message ?? 'خطأ غير معروف')
        : 'Publish failed: ' + (e?.response?.data?.message ?? 'Unknown error'));
    } finally {
      setPublishing(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1600px] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Zap size={20} className="text-indigo-500 dark:text-indigo-400" />
            {ar ? 'مولّد الجدول التلقائي' : 'Auto Schedule Generator'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {ar ? 'توليد جدول تلقائي يراعي العدالة وقواعد الراحة وقيود الجنس' : 'Generate a fair schedule respecting rest rules and gender constraints'}
          </p>
        </div>
        {result && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={12} />
            {ar ? 'آخر توليد:' : 'Last generated:'} {new Date(result.generatedAt).toLocaleTimeString(ar ? 'ar-KW' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 space-y-4 card dark:bg-white/[0.03]">

        {/* Row 1: Period + Navigator + Generate */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Period selector */}
          <div className="flex items-center gap-1 bg-slate-900/5 dark:bg-black/20 rounded-xl p-1">
            {([1,2,3,4] as const).map(w => (
              <button key={w} onClick={() => setWeeks(w)}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all border ${
                  weeks === w
                    ? 'bg-indigo-500/15 dark:bg-indigo-500/25 border-indigo-500/50 text-indigo-600 dark:text-indigo-300'
                    : 'border-transparent text-slate-500 dark:text-slate-600'
                }`}>
                {ar ? (w === 4 ? 'شهر' : `${w} أسب`) : (w === 4 ? 'Month' : `${w}w`)}
              </button>
            ))}
          </div>

          {/* Navigator */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const idx = availableWeeks.indexOf(selectedWeek);
                if (idx < availableWeeks.length - 1) setSelectedWeek(availableWeeks[idx + 1]);
                else setSelectedWeek(addDays(selectedWeek, -weeks * 7));
              }}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                         hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors">
              {ar ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <div className="text-center" style={{ minWidth: 160 }}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{ar ? 'فترة التوليد' : 'Period'}</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{fmtRange(selectedWeek, weekEnd, ar)}</p>
            </div>
            <button
              onClick={() => {
                const idx = availableWeeks.indexOf(selectedWeek);
                if (idx > 0) setSelectedWeek(availableWeeks[idx - 1]);
                else setSelectedWeek(addDays(selectedWeek, weeks * 7));
              }}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                         hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors">
              {ar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>

          {/* Week publish/lock status badge (same source as the Schedule grid) */}
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
                style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                <Icon size={12} />
                {cfg.label}
                {weekStatus.status !== 'draft' && (
                  <Link to="/schedule?tab=schedule" className="underline opacity-80 hover:opacity-100">
                    {ar ? 'الجدول' : 'Schedule'}
                  </Link>
                )}
              </span>
            );
          })()}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Advanced options toggle */}
          <button onClick={() => setShowOptions(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
              showOptions
                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-600 dark:text-indigo-300'
                : 'bg-slate-900/5 dark:bg-white/5 border-slate-900/10 dark:border-white/10 text-slate-500'
            }`}>
            <SlidersHorizontal size={13} />
            {ar ? 'خيارات متقدمة' : 'Advanced'}
            {showOptions ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          {/* Generate */}
          <button onClick={handleGenerate} disabled={loading || !selectedWeek}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white
                       transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <Zap size={15} />}
            {loading ? (ar ? 'جاري التوليد…' : 'Generating…') : (ar ? 'توليد الجدول' : 'Generate')}
          </button>
        </div>

        {/* Row 2: Function chips */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
            {ar ? 'الأقسام' : 'Functions'} {selectedFns.length > 0 && <span className="text-indigo-400">({selectedFns.length} {ar ? 'محدد' : 'selected'})</span>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setSelectedFns([])}
              className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all border ${
                selectedFns.length === 0
                  ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/40 text-indigo-600 dark:text-indigo-300'
                  : 'bg-slate-900/[0.04] dark:bg-white/[0.04] border-slate-900/10 dark:border-white/10 text-slate-500'
              }`}>
              {ar ? 'الكل' : 'All'}
            </button>
            {activeFns.map(fn => (
              <button key={fn.id} onClick={() => toggleFn(fn.id)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all border ${
                  selectedFns.includes(fn.id)
                    ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/40 text-indigo-600 dark:text-indigo-300'
                    : 'bg-slate-900/[0.04] dark:bg-white/[0.04] border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-slate-400'
                }`}>
                {fn.name}
                <span className="ms-1 text-[9px] opacity-60">({fn.employee_count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Options */}
        {showOptions && (
          <div className="pt-4 border-t border-slate-900/10 dark:border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Min rest */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2 block">
                <Clock size={10} className="inline me-1" />
                {ar ? 'راحة دنيا (ساعات)' : 'Min Rest (hours)'}
              </label>
              <div className="flex items-center gap-2">
                <input type="range" min="8" max="16" step="1"
                  value={options.minRestHours}
                  onChange={e => setOptions(o => ({ ...o, minRestHours: +e.target.value }))}
                  className="flex-1 accent-indigo-500" />
                <span className="text-sm font-bold text-indigo-400 w-8 text-center">{options.minRestHours}h</span>
              </div>
            </div>

            {/* OFF days */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2 block">
                {ar ? 'أيام إجازة أسبوعية' : 'Weekly OFF Days'}
              </label>
              <div className="flex gap-2">
                {[1, 2].map(n => (
                  <button key={n} onClick={() => setOptions(o => ({ ...o, offDaysPerWeek: n }))}
                    className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-all border ${
                      options.offDaysPerWeek === n
                        ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/40 text-indigo-600 dark:text-indigo-300'
                        : 'bg-slate-900/[0.04] dark:bg-white/[0.04] border-slate-900/10 dark:border-white/10 text-slate-500'
                    }`}>
                    {n} {ar ? 'يوم' : 'd'}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration summary */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2 block">
                {ar ? 'مدة التوليد' : 'Duration'}
              </label>
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-indigo-600 dark:text-indigo-300"
                style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <Calendar size={13} />
                {ar
                  ? (weeks === 4 ? 'شهر كامل (28 يوم)' : `${weeks} أسبوع${weeks > 1 ? (weeks === 2 ? 'ان' : '') : ''} (${weeks * 7} يوم)`)
                  : (weeks === 4 ? 'Full month (28 days)' : `${weeks} week${weeks > 1 ? 's' : ''} (${weeks * 7} days)`)}
              </div>
              <p className="text-[9px] text-slate-600 mt-1">{ar ? 'يُغيَّر من الأزرار أعلاه' : 'Changed from buttons above'}</p>
            </div>

            {/* Female late-shift exception — per function */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2 block">
                {ar ? 'استثناء: إناث يشتغلوا N — اختر الأقسام' : 'Exception: females may work N — pick functions'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {activeFns.length === 0 && (
                  <span className="text-[11px] text-slate-500">{ar ? 'حمّل الأقسام أولاً' : 'Load functions first'}</span>
                )}
                {activeFns.map(fn => {
                  const on = femaleLateFns.includes(fn.id);
                  return (
                    <button key={fn.id}
                      onClick={() => setFemaleLateFns(s => on ? s.filter(x => x !== fn.id) : [...s, fn.id])}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1"
                      style={{
                        background: on ? 'rgba(251,191,36,0.12)' : 'var(--chip-bg)',
                        border: `1px solid ${on ? 'rgba(251,191,36,0.35)' : 'var(--border)'}`,
                        color: on ? '#d97706' : 'var(--text-secondary)',
                      }}>
                      {on && <span className="text-[9px]">✓</span>}
                      {fn.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                {ar
                  ? 'الإناث ينتهوا 20:00 (C) افتراضياً. الأقسام المحددة هنا: إناثها يشتغلوا N (حتى 22:00). منتصف الليل ممنوع دائماً.'
                  : 'Females end by 20:00 (C) by default. Picked functions: their females may work N (to 22:00). Midnight always blocked.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl text-red-700 dark:text-red-400 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <XCircle size={15} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4">

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { labelAr: 'الموظفون',  labelEn: 'Employees',    value: result.summary.totalEmployees,  color: '#818cf8', bg: 'rgba(99,102,241,0.1)'  },
              { labelAr: 'أيام عمل', labelEn: 'Working Days',  value: result.summary.workingDays,     color: '#34d399', bg: 'rgba(52,211,153,0.08)'  },
              { labelAr: 'أخطاء',    labelEn: 'Errors',        value: result.summary.totalErrors,     color: result.summary.totalErrors ? '#f87171' : '#64748b', bg: result.summary.totalErrors ? 'rgba(248,113,113,0.08)' : 'var(--surface)' },
              { labelAr: 'تحذيرات', labelEn: 'Warnings',       value: result.summary.totalWarnings,   color: result.summary.totalWarnings ? '#fbbf24' : '#64748b', bg: result.summary.totalWarnings ? 'rgba(251,191,36,0.08)' : 'var(--surface)' },
            ].map(c => (
              <div key={c.labelEn} className="rounded-2xl p-4" style={{ background: c.bg, border: `1px solid ${c.color}25` }}>
                <p className="text-2xl font-extrabold" style={{ color: c.color }}>{c.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{ar ? c.labelAr : c.labelEn}</p>
              </div>
            ))}
          </div>

          {/* Coverage + Fairness */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Calendar size={13} className="text-indigo-400" />
                {ar ? 'التغطية اليومية' : 'Daily Coverage'}
              </h3>
              <CoverageBar days={result.coverage} dates={result.dates} />
            </div>
            <FairnessRing fairness={result.fairness} />
          </div>

          {/* Violations */}
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldCheck size={13} className="text-indigo-400" />
              {ar ? 'مخالفات القواعد التشغيلية' : 'Rule Violations'}
            </h3>
            <ViolationsPanel violations={result.violations} />
          </div>

          {/* Schedule Grid */}
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Calendar size={13} className="text-indigo-400" />
                {ar ? 'الجدول المقترح' : 'Proposed Schedule'}
                <span className="font-normal text-slate-500">{result.summary.totalEmployees} {ar ? 'موظف' : 'employees'}</span>
              </h3>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  // Canonical categories (backend/src/common/shift-category.ts): M/B/C = Morning/Day family, N = Night, MD/MN = Midnight
                  { code: 'M',  color: '#0ea5e9', labelAr: 'صباحي',                 labelEn: 'Morning' },
                  { code: 'C',  color: '#f59e0b', labelAr: 'نهاري — تنتهي 20:00',   labelEn: 'Day (ends 20:00)' },
                  { code: 'N',  color: '#8b5cf6', labelAr: 'ليلي',                  labelEn: 'Night' },
                  { code: 'MD', color: '#6366f1', labelAr: 'منتصف الليل',           labelEn: 'Midnight' },
                ].map(s => (
                  <span key={s.code} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg font-semibold"
                    style={{ background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}30` }}>
                    {s.code} <span className="text-[9px] opacity-70 hidden sm:inline">{ar ? s.labelAr : s.labelEn}</span>
                  </span>
                ))}
              </div>
            </div>
            {result.functions.map((fn, i) => (
              <FunctionGroup key={fn.id} fn={fn} dates={result.dates} defaultOpen={i === 0} />
            ))}
          </div>

          {/* Save/Re-generate */}
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#059669,#10b981)', boxShadow: '0 4px 20px rgba(16,185,129,0.25)' }}>
                {saving ? <RefreshCw size={15} className="animate-spin" /> : <CloudUpload size={15} />}
                {saving ? (ar ? 'جاري الحفظ…' : 'Saving…') : (ar ? 'حفظ كمسودة' : 'Save as Draft')}
              </button>

              <button onClick={handlePublish} disabled={publishing || !savedVersionId || weekBlocked}
                title={weekBlocked
                  ? (ar ? 'الأسبوع منشور/مقفل بالفعل' : 'Week already published/locked')
                  : !savedVersionId ? (ar ? 'احفظ المسودة أولاً' : 'Save as draft first') : undefined}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#6366f1)', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
                {publishing ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                {publishing ? (ar ? 'جاري النشر…' : 'Publishing…') : (ar ? 'نشر وإرسال للموظفين' : 'Publish to agents')}
              </button>

              {!savedVersionId && !weekBlocked && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <Info size={13} className="flex-shrink-0" />
                  {ar ? 'النتيجة غير محفوظة — احفظ كمسودة أولاً لتفعيل النشر' : 'Out of sync — save as draft again to enable publish'}
                </span>
              )}
              {weekBlocked && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                  <Lock size={13} className="flex-shrink-0" />
                  {ar
                    ? <>هذا الأسبوع {weekStatus?.status === 'locked' ? 'مقفل' : 'منشور'} بالفعل — <Link to="/schedule?tab=schedule" className="underline">افتح الجدول</Link></>
                    : <>This week is already {weekStatus?.status === 'locked' ? 'locked' : 'published'} — <Link to="/schedule?tab=schedule" className="underline">open Schedule</Link></>}
                </span>
              )}

              <button onClick={handleGenerate} disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all
                           text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-white disabled:opacity-40"
                style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
                <RefreshCw size={14} />
                {ar ? 'إعادة التوليد' : 'Regenerate'}
              </button>

              <button onClick={() => setResult(null)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-slate-500 dark:text-slate-400
                           hover:text-slate-900 dark:hover:text-white transition-colors"
                style={{ background: 'var(--chip-bg)', border: '1px solid var(--border)' }}>
                <XCircle size={14} />
                {ar ? 'مسح النتيجة' : 'Clear Result'}
              </button>

              {saveMsg && (
                <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-xl font-medium ${
                  saveOk ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
                  style={{ background: saveOk ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)' }}>
                  {saveOk ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {saveMsg}
                </div>
              )}
              {publishMsg && (
                <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-xl font-medium ${
                  publishOk ? 'text-indigo-700 dark:text-indigo-300' : 'text-red-700 dark:text-red-400'}`}
                  style={{ background: publishOk ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.08)' }}>
                  {publishOk ? <Send size={14} /> : <XCircle size={14} />}
                  {publishMsg}
                </div>
              )}
            </div>

            {result.summary.totalErrors > 0 && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-xl text-xs text-amber-700 dark:text-amber-300"
                style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.15)' }}>
                <Info size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                {ar
                  ? 'يمكنك حفظ الجدول كمسودة وتعديله يدوياً من شاشة جدول الدوام لإصلاح المخالفات قبل النشر.'
                  : 'You can save as draft and manually edit it from the Schedule screen to fix violations before publishing.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty State ───────────────────────────────────────────────────── */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <Zap size={28} className="text-indigo-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-300 text-sm font-medium">
            {ar
              ? <>{`اختر الفترة والأقسام ثم اضغط `}<span className="text-indigo-500 dark:text-indigo-400 font-bold">توليد الجدول</span></>
              : <>{'Select period & functions, then click '}<span className="text-indigo-500 dark:text-indigo-400 font-bold">Generate Schedule</span></>}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {ar
              ? `يتم توليد جدول يراعي العدالة، قواعد الراحة (${options.minRestHours}h)، وقيود الجنس`
              : `Generates a fair schedule respecting rest rules (${options.minRestHours}h) and gender constraints`}
          </p>
        </div>
      )}

    </div>
  );
}
