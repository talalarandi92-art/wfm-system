/**
 * GENERATOR PANEL — the demo centerpiece of the Scheduling hub (Stage 2B).
 *
 * Story order (numbered sections, same kit language as /capacity?tab=staffing):
 *   ① Demand basis   — where the requirement comes from (forecast-erlang badge,
 *                      week, required-curve mini-heat)
 *   ② Generate       — one big CTA + options as clean chips
 *                      (engine ★demand/classic, weekend-fair, band rotation,
 *                       rest / OFF, function scope, ladder link)
 *   ③ Result & verdict — VerdictHero (coverage ring, fairness, rule badges,
 *                      hiring hint) + per-day table + honest unfilled reasons
 *                      + the full proposed grid
 *   ④ Save & publish — the flow EXACTLY as it exists today (same API calls:
 *                      /schedule-generator/generate[-demand], /save, /publish)
 *
 * The richer backend `verdict` block + /roster-v2/schedule-quality are being
 * normalized by a parallel agent — everything renders real numbers from the
 * current payloads and upgrades automatically when that lands (see kit.tsx).
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Zap, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, CloudUpload, Users, Clock, ShieldCheck,
  Calendar, ChevronLeft, ChevronRight, Info, Send, Lock,
  Waves, Layers, Award,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { fmtLocalDate, weekStartSat } from '@/utils/format';
import { Section, Awaiting, SPAL, normalizeVerdict, DAY_AR7, DAY_EN7 } from './kit';
import VerdictHero from './VerdictHero';
import { SHIFT_COLORS } from '@/utils/shift-colors';

// ─── Types (identical contract to the generator endpoints) ───────────────────
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
function fmtDateAr(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_AR7[d.getDay()]} ${d.getDate()}`;
}
function fmtDateEn(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_EN7[d.getDay()]} ${d.getDate()}`;
}
function fmtRangeAr(from: string, to: string) {
  const s = new Date(from + 'T00:00:00');
  const e = new Date(to + 'T00:00:00');
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${s.getDate()} ${MONTHS_AR[s.getMonth()]} – ${e.getDate()} ${MONTHS_AR[e.getMonth()]}`;
}
function fmtRange(from: string, to: string, arMode: boolean) {
  if (arMode) return fmtRangeAr(from, to);
  const s = new Date(from + 'T00:00:00');
  const e = new Date(to + 'T00:00:00');
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmtLocalDate(d);
}
const currentSat = () => weekStartSat();

// Demand-grid code colors (canonical shift families — same hues as the legend)
const DEMAND_CODE_COLORS: Record<string, string> = {
  M: '#0ea5e9', B: '#38bdf8', C: '#f59e0b', N: '#8b5cf6',
  E: '#f97316', EE: '#a78bfa', MD: '#6366f1', MN: '#818cf8',
  OFF: '#64748b', L: '#10b981',
};
const demandCodeColor = (code: string) => DEMAND_CODE_COLORS[code] ?? '#94a3b8';

// ─── Shift Cell (classic proposal grid) ───────────────────────────────────────
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

// ─── Classic coverage bars ────────────────────────────────────────────────────
function ClassicCoverageBar({ days, dates }: { days: CoverageDay[]; dates: string[] }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const fmtDay = (iso: string) => ar ? fmtDateAr(iso) : fmtDateEn(iso);
  return (
    <div className="flex gap-1">
      {dates.map(date => {
        const d = days.find(c => c.date === date);
        const pct = d?.coveragePct ?? 0;
        const col = pct >= 80 ? SPAL.ok : pct >= 60 ? SPAL.warn : SPAL.risk;
        return (
          <div key={date} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold" style={{ color: col }}>{pct}%</span>
            <div className="w-full rounded-full" style={{ height: 5, background: 'var(--surface-2)' }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
            </div>
            <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{fmtDay(date).split(' ')[0]}</span>
            <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{fmtDay(date).split(' ')[1]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Classic function group (proposal grid) ───────────────────────────────────
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
              {fn.employees.map(es => (
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

// ─── Violations Panel (classic) ───────────────────────────────────────────────
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

// ─── Fairness detail bars (classic) ───────────────────────────────────────────
function FairnessDetailBars({ fairness }: { fairness: GeneratorResult['fairness'] }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  return (
    <div className="rounded-xl p-3 space-y-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
        {ar ? `توزيع الورديات لكل موظف · تباين ليلي ${fairness.nightVariance}` : `Per-agent shift mix · night variance ${fairness.nightVariance}`}
      </p>
      {fairness.details.slice(0, 6).map(d => (
        <div key={d.employeeId} className="flex items-center gap-2">
          <span className="text-[10px] w-24 truncate" style={{ color: 'var(--text-2)' }}>{d.name}</span>
          <div className="flex-1 flex h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface)' }}>
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
          <span key={lbl} className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--text-3)' }}>
            <span className={`w-2 h-2 rounded-sm ${cls}`} />{lbl}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Demand curve mini-heat (① Demand basis) ─────────────────────────────────
function DemandCurveHeat({ days, ar }: { days: any[]; ar: boolean }) {
  // requiredCurve may be 24 (hourly) or 48 (half-hourly) — bucket to 24 columns.
  const rows = days.map(d => {
    const curve: number[] = Array.isArray(d.requiredCurve) ? d.requiredCurve : [];
    const per = Math.max(1, Math.ceil(curve.length / 24));
    const cols: number[] = [];
    for (let h = 0; h < 24; h++) {
      const slice = curve.slice(h * per, (h + 1) * per);
      cols.push(slice.length ? Math.max(...slice) : 0);
    }
    return { date: String(d.date), cols };
  });
  const max = Math.max(1, ...rows.flatMap(r => r.cols));
  return (
    <div className="space-y-1">
      {rows.map(r => (
        <div key={r.date} className="flex items-center gap-2">
          <span className="text-[9.5px] font-bold w-14 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
            {ar ? fmtDateAr(r.date) : fmtDateEn(r.date)}
          </span>
          <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
            {r.cols.map((v, h) => (
              <div key={h} className="h-4 rounded-[3px]"
                title={`${String(h).padStart(2, '0')}:00 · ${ar ? 'مطلوب' : 'required'} ${v}`}
                style={{ background: v > 0 ? `${SPAL.required}${Math.round(15 + (v / max) * 70).toString(16).padStart(2, '0')}` : 'var(--surface-2)' }} />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[8.5px]" style={{ color: 'var(--text-3)' }}>00:00</span>
        <span className="text-[8.5px]" style={{ color: 'var(--text-3)' }}>{ar ? 'أغمق = طلب أعلى (HC مطلوب)' : 'darker = higher required HC'}</span>
        <span className="text-[8.5px]" style={{ color: 'var(--text-3)' }}>23:00</span>
      </div>
    </div>
  );
}

// ─── Option chip ──────────────────────────────────────────────────────────────
function Chip({ on, onClick, children, tone = SPAL.publish, title }: {
  on: boolean; onClick: () => void; children: React.ReactNode; tone?: string; title?: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className="text-xs px-3 py-1.5 rounded-xl font-bold transition-all border"
      style={on
        ? { background: `${tone}16`, border: `1px solid ${tone}55`, color: tone }
        : { background: 'var(--chip-bg, rgba(120,130,160,.08))', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
      {children}
    </button>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export default function GeneratorPanel() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [weeks, setWeeks]           = useState<1|2|3|4>(1);
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);
  const [functions, setFunctions]   = useState<{ id: string; name: string; employee_count: string }[]>([]);
  const [selectedWeek, setSelectedWeek] = useState(currentSat());
  const [selectedFns, setSelectedFns]   = useState<string[]>([]);
  const [femaleLateFns, setFemaleLateFns] = useState<string[]>([]);  // per-function female-N exception (classic)
  const [options, setOptions]   = useState({ minRestHours: 10, offDaysPerWeek: 1, allowFemaleN: false });
  // Engine mode (D-077): demand-driven is THE generator; classic kept for comparison
  const [engine, setEngine] = useState<'demand' | 'classic'>('demand');
  const [demandOpts, setDemandOpts] = useState<{ offStrategy: 'lowest-demand' | 'weekend-fair'; rotationFairness: boolean }>({
    offStrategy: 'lowest-demand', rotationFairness: false,
  });
  const [demandResult, setDemandResult] = useState<any | null>(null);
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

  const effWeeks = engine === 'demand' ? 1 : weeks;   // demand engine plans one Sat→Fri week
  const weekEnd = addDays(selectedWeek, effWeeks * 7 - 1);

  // Body for the demand-driven engine (functionIds live INSIDE options there)
  const demandBody = useCallback(() => ({
    weekStart: selectedWeek,
    options: {
      minRestHours: options.minRestHours,
      offDaysPerWeek: options.offDaysPerWeek,
      offStrategy: demandOpts.offStrategy,
      rotationFairness: demandOpts.rotationFairness,
      ...(selectedFns.length > 0 ? { functionIds: selectedFns } : {}),
    },
  }), [selectedWeek, options, demandOpts, selectedFns]);

  const handleGenerate = useCallback(async () => {
    if (!selectedWeek) return;
    // Reset ALL save/publish state — a new result invalidates any previously-saved draft
    setLoading(true); setError(''); setResult(null); setDemandResult(null); setSaveMsg(''); setSaveOk(false);
    setSavedVersionId(null); setPublishMsg(''); setPublishOk(false);
    try {
      if (engine === 'demand') {
        const res = await apiClient.post('/schedule-generator/generate-demand', demandBody());
        setDemandResult(res.data);
      } else {
        const body: any = {
          weekStart: selectedWeek,
          options: { ...options, weeks, femaleLateFunctionIds: femaleLateFns },
        };
        if (selectedFns.length > 0) body.functionIds = selectedFns;
        const res = await apiClient.post('/schedule-generator/generate', body);
        setResult(res.data);
      }
    } catch (e: any) {
      const arErr = useUiStore.getState().lang === 'ar';
      setError(e?.response?.data?.message ?? (arErr ? 'حدث خطأ أثناء التوليد' : 'An error occurred during generation'));
    } finally {
      setLoading(false);
    }
  }, [selectedWeek, selectedFns, options, weeks, engine, demandBody, femaleLateFns]);

  const handleSave = async () => {
    if (!selectedWeek) return;
    setSaving(true); setSaveMsg(''); setSaveOk(false);
    const arNow = useUiStore.getState().lang === 'ar';
    try {
      let res: any;
      if (engine === 'demand') {
        res = await apiClient.post('/schedule-generator/generate-demand/save', {
          ...demandBody(),
          label: arNow
            ? `مسودة (حسب الطلب) — ${fmtRangeAr(selectedWeek, weekEnd)}`
            : `Demand draft — ${fmtRange(selectedWeek, weekEnd, false)}`,
        });
        setDemandResult(res.data);
      } else {
        const body: any = {
          weekStart: selectedWeek,
          options: { ...options, weeks, femaleLateFunctionIds: femaleLateFns },
          label: arNow
            ? `مسودة — ${fmtRangeAr(selectedWeek, weekEnd)}`
            : `Draft — ${fmtRange(selectedWeek, weekEnd, false)}`,
        };
        if (selectedFns.length > 0) body.functionIds = selectedFns;
        res = await apiClient.post('/schedule-generator/save', body);
      }
      setSaveOk(true);
      setSavedVersionId(res.data?.versionId ?? null);
      setPublishMsg(''); setPublishOk(false);
      setSaveMsg(arNow
        ? `تم الحفظ كمسودة — ${res.data?.versionId?.substring(0, 8)}…`
        : `Saved as draft — ${res.data?.versionId?.substring(0, 8)}…`);
      if (engine === 'classic' && result) setResult({ ...result, versionId: res.data?.versionId });
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

  // Normalized verdict for the hero (verdict block when live; honest fallback today)
  const activeRaw = engine === 'demand' ? demandResult : result;
  const verdict = activeRaw ? normalizeVerdict(activeRaw, engine) : null;
  const resultDates: string[] = engine === 'demand'
    ? (demandResult ? Array.from({ length: 7 }, (_, i) => addDays(demandResult.weekStart, i)) : [])
    : (result?.dates ?? []);

  // ── Week status badge (shared source with the Schedule grid) ──
  const weekBadge = weekStatus && (() => {
    const cfg = {
      draft:     { label: ar ? 'مسودة' : 'Draft',     bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: 'rgba(100,116,139,0.25)', Icon: Clock },
      published: { label: ar ? 'منشور' : 'Published', bg: 'rgba(34,197,94,0.12)',  color: '#4ade80', border: 'rgba(34,197,94,0.3)',    Icon: CheckCircle2 },
      locked:    { label: ar ? 'مقفل'  : 'Locked',    bg: 'rgba(99,102,241,0.12)', color: '#818cf8', border: 'rgba(99,102,241,0.3)',   Icon: Lock },
    }[weekStatus.status];
    const { Icon } = cfg;
    return (
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
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
  })();

  // ── ④ Save/Publish/Regenerate action row (classic + demand results) ──
  const actionBar = (
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

      <button onClick={() => { setResult(null); setDemandResult(null); }}
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
  );

  const dr = demandResult;
  const riskCfg: Record<string, { label: string; color: string; bg: string }> = {
    safe:     { label: ar ? 'آمن'   : 'Safe',     color: '#4ade80', bg: 'rgba(34,197,94,0.12)' },
    warning:  { label: ar ? 'تحذير' : 'Warning',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    critical: { label: ar ? 'حرج'   : 'Critical', color: '#f87171', bg: 'rgba(239,68,68,0.12)' },
  };
  const fmtDay = (iso: string) => ar ? fmtDateAr(iso) : fmtDateEn(iso);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1600px] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Zap size={20} className="text-indigo-500 dark:text-indigo-400" />
            {ar ? 'مولّد الجدول الذكي' : 'Schedule Generator'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {ar
              ? 'من الطلب المتوقع إلى جدول عادل ومطابق للقواعد — بضغطة واحدة، بحكم صريح'
              : 'From forecast demand to a fair, rule-compliant schedule — one click, an honest verdict'}
          </p>
        </div>
        {(result?.generatedAt || dr?.generatedAt) && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={12} />
            {ar ? 'آخر توليد:' : 'Last generated:'}{' '}
            {new Date(result?.generatedAt ?? dr?.generatedAt).toLocaleTimeString(ar ? 'ar-KW' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {/* ══ ① DEMAND BASIS ══════════════════════════════════════════════════ */}
      <Section
        no={ar ? '١' : '1'}
        icon={Waves}
        color={SPAL.required}
        title={ar ? 'أساس الطلب — الأسبوع والمنحنى المطلوب' : 'Demand basis — the week & its required curve'}
        desc={ar
          ? 'الأسبوع يبدأ السبت. المولّد المعتمد يبني على توقّع الفوركاست + Erlang لكل فنكشن — المنحنى يظهر بعد التوليد.'
          : 'Week starts Saturday. THE generator builds on forecast + Erlang per function — the curve fills in after Generate.'}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Week navigator */}
            <button
              onClick={() => {
                const idx = availableWeeks.indexOf(selectedWeek);
                if (idx < availableWeeks.length - 1) setSelectedWeek(availableWeeks[idx + 1]);
                else setSelectedWeek(addDays(selectedWeek, -effWeeks * 7));
              }}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                         hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors">
              {ar ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <div className="text-center" style={{ minWidth: 150 }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{ar ? 'فترة التوليد' : 'Period'}</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{fmtRange(selectedWeek, weekEnd, ar)}</p>
            </div>
            <button
              onClick={() => {
                const idx = availableWeeks.indexOf(selectedWeek);
                if (idx > 0) setSelectedWeek(availableWeeks[idx - 1]);
                else setSelectedWeek(addDays(selectedWeek, effWeeks * 7));
              }}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                         hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors">
              {ar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
            {weekBadge}
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {dr?.demand ? (
              <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
                style={dr.demand.source === 'forecast-erlang'
                  ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                  : { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                {dr.demand.source === 'forecast-erlang'
                  ? (ar ? '⚡ المصدر: فوركاست + Erlang لكل فنكشن' : '⚡ Source: forecast + Erlang per function')
                  : (ar ? 'المصدر: تاريخ الحمل المُقاس (بديل)' : 'Source: measured-load history (fallback)')}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
                style={{ background: `${SPAL.required}14`, color: SPAL.required, border: `1px solid ${SPAL.required}35` }}>
                {ar ? '⚡ المصدر المتوقع: فوركاست + Erlang (demand.source)' : '⚡ Expected source: forecast + Erlang (demand.source)'}
              </span>
            )}
            {dr?.demand?.basis && (
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{dr.demand.basis}</span>
            )}
            <Link to="/capacity?tab=staffing"
              className="text-[10.5px] font-semibold underline ms-auto"
              style={{ color: SPAL.staffed }}>
              {ar ? 'تفاصيل محرك المتطلبات → Capacity' : 'Requirement engine details → Capacity'}
            </Link>
          </div>

          {dr?.demand?.days?.length
            ? <DemandCurveHeat days={dr.demand.days} ar={ar} />
            : <Awaiting ar={ar}
                text="Run Generate — the 7-day × 24h required-HC heat renders here from the demand engine."
                textAr="اضغط توليد — خريطة الطلب (٧ أيام × ٢٤ ساعة) تظهر هنا من محرك الطلب." />}
        </div>
      </Section>

      {/* ══ ② GENERATE ══════════════════════════════════════════════════════ */}
      <Section
        no={ar ? '٢' : '2'}
        icon={Zap}
        color={SPAL.publish}
        title={ar ? 'التوليد — المحرك والخيارات' : 'Generate — engine & options'}
        desc={ar
          ? 'المولّد المعتمد = حسب الطلب (D-077). كل الخيارات افتراضياتها هي السلوك المعتمد الحالي.'
          : 'THE generator = demand-driven (D-077). Every option defaults to today’s approved behavior.'}
        actions={
          <button onClick={handleGenerate} disabled={loading || !selectedWeek}
            className="flex items-center gap-2 px-7 py-2.5 rounded-xl text-sm font-bold text-white
                       transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <Zap size={15} />}
            {loading ? (ar ? 'جاري التوليد…' : 'Generating…') : (ar ? 'توليد الجدول' : 'Generate')}
          </button>
        }
      >
        <div className="space-y-3.5">

          {/* Engine + core option chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider me-1" style={{ color: 'var(--text-3)' }}>
              {ar ? 'المحرك' : 'Engine'}
            </span>
            <Chip on={engine === 'demand'} tone="#10b981"
              title={ar ? 'المولّد المعتمد — من توقع الفوركاست/Erlang لكل فنكشن' : 'THE generator — forecast/Erlang demand per function'}
              onClick={() => { setEngine('demand'); setResult(null); setDemandResult(null); setSavedVersionId(null); setSaveMsg(''); setPublishMsg(''); setError(''); }}>
              {ar ? 'حسب الطلب ★' : 'Demand ★'}
            </Chip>
            <Chip on={engine === 'classic'} tone={SPAL.neutral}
              title={ar ? 'محرك المقارنة (روتيشن أسبوعي بلا منحنى طلب)' : 'Comparison engine (weekly rotation, no demand curve)'}
              onClick={() => { setEngine('classic'); setResult(null); setDemandResult(null); setSavedVersionId(null); setSaveMsg(''); setPublishMsg(''); setError(''); }}>
              {ar ? 'كلاسيكي' : 'Classic'}
            </Chip>

            <span className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />

            {engine === 'demand' ? (
              <>
                <span className="text-[10px] font-bold uppercase tracking-wider me-1" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'الخيارات' : 'Options'}
                </span>
                <Chip on={demandOpts.offStrategy === 'lowest-demand'} tone={SPAL.publish}
                  title={ar ? 'الـ OFF بأيام أقل احتياج — أقصى تغطية' : 'OFFs on the lowest-demand days — max coverage'}
                  onClick={() => setDemandOpts(o => ({ ...o, offStrategy: 'lowest-demand' }))}>
                  {ar ? 'OFF: أقل طلب' : 'OFF: lowest demand'}
                </Chip>
                <Chip on={demandOpts.offStrategy === 'weekend-fair'} tone={SPAL.publish}
                  title={ar ? 'OFF ويكند (خميس/جمعة) + OFF منتصف الأسبوع بعدالة سنوية' : 'One Thu/Fri OFF + one mid-week OFF, YTD-fair'}
                  onClick={() => setDemandOpts(o => ({ ...o, offStrategy: 'weekend-fair' }))}>
                  {ar ? 'OFF: ويكند عادل' : 'OFF: weekend-fair'}
                </Chip>
                <Chip on={demandOpts.rotationFairness} tone="#10b981"
                  title={ar ? 'روتيشن أسبوعي بالباند (ليلي→ظهر→صباح→منتصف)' : 'Weekly band rotation (night→afternoon→morning→midnight)'}
                  onClick={() => setDemandOpts(o => ({ ...o, rotationFairness: !o.rotationFairness }))}>
                  {demandOpts.rotationFairness ? '✓ ' : ''}{ar ? 'روتيشن الباند' : 'Band rotation'}
                </Chip>
                <Link to="/schedule?tab=ladder"
                  className="text-xs px-3 py-1.5 rounded-xl font-bold transition-all border flex items-center gap-1.5"
                  style={{ background: 'var(--chip-bg, rgba(120,130,160,.08))', border: '1px solid var(--border)', color: 'var(--text-3)' }}
                  title={ar ? 'محرك الدوران التدريجي — بلوكات 2-3 أيام إنسانية' : 'Laddered rotation engine — humane 2-3 day blocks'}>
                  <Layers size={12} />
                  {ar ? 'السلّم →' : 'Ladder →'}
                </Link>
              </>
            ) : (
              <>
                <span className="text-[10px] font-bold uppercase tracking-wider me-1" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'المدة' : 'Duration'}
                </span>
                {([1, 2, 3, 4] as const).map(w => (
                  <Chip key={w} on={weeks === w} tone={SPAL.publish} onClick={() => setWeeks(w)}>
                    {ar ? (w === 4 ? 'شهر' : `${w} أسب`) : (w === 4 ? 'Month' : `${w}w`)}
                  </Chip>
                ))}
              </>
            )}
          </div>

          {/* Rest + OFF rows */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <Clock size={12} style={{ color: 'var(--text-3)' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                {ar ? 'راحة دنيا' : 'Min rest'}
              </span>
              <input type="range" min="8" max="16" step="1"
                value={options.minRestHours}
                onChange={e => setOptions(o => ({ ...o, minRestHours: +e.target.value }))}
                className="accent-indigo-500" style={{ width: 110 }} />
              <span className="text-sm font-bold text-indigo-400 w-8 text-center">{options.minRestHours}h</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                {ar ? 'OFF أسبوعي' : 'Weekly OFF'}
              </span>
              {[1, 2].map(n => (
                <Chip key={n} on={options.offDaysPerWeek === n} tone={SPAL.publish}
                  onClick={() => setOptions(o => ({ ...o, offDaysPerWeek: n }))}>
                  {n} {ar ? 'يوم' : 'd'}
                </Chip>
              ))}
            </div>
          </div>

          {/* Function scope chips */}
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: 'var(--text-3)' }}>
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

          {/* Classic-only: female late-shift exception per function */}
          {engine === 'classic' && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: 'var(--text-3)' }}>
                {ar ? 'استثناء: إناث يشتغلوا N — اختر الأقسام' : 'Exception: females may work N — pick functions'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {activeFns.length === 0 && (
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'حمّل الأقسام أولاً' : 'Load functions first'}</span>
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
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                {ar
                  ? 'الإناث ينتهوا 20:00 (C) افتراضياً. الأقسام المحددة هنا: إناثها يشتغلوا N (حتى 22:00). منتصف الليل ممنوع دائماً.'
                  : 'Females end by 20:00 (C) by default. Picked functions: their females may work N (to 22:00). Midnight always blocked.'}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-red-700 dark:text-red-400 text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <XCircle size={15} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      </Section>

      {/* ══ ③ RESULT & VERDICT ══════════════════════════════════════════════ */}
      {(verdict || result || dr) && (
        <Section
          no={ar ? '٣' : '3'}
          icon={Award}
          color={SPAL.fair}
          title={ar ? 'النتيجة والحكم — هل نقدر نشغّل هذا الأسبوع؟' : 'Result & verdict — can we run this week?'}
          desc={ar
            ? 'التغطية مقابل الطلب، العدالة، الالتزام بالقواعد، والشواغر بأسبابها — بصراحة كاملة.'
            : 'Coverage vs demand, fairness, rule compliance, and every unfilled slot with its reason — fully honest.'}
        >
          <div className="space-y-4">

            {/* The verdict hero */}
            {verdict && <VerdictHero ar={ar} verdict={verdict} dates={resultDates} />}

            {/* ── Demand engine detail blocks ── */}
            {engine === 'demand' && dr && (
              <>
                {/* Summary tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { la: 'الموظفون',      le: 'Employees',      v: dr.summary.employees,            c: '#818cf8' },
                    { la: 'ورديات مخططة', le: 'Shifts planned', v: dr.summary.totalShiftsPlanned,   c: '#34d399' },
                    { la: 'أيام OFF',      le: 'OFF days',       v: dr.summary.totalOffDays,          c: '#94a3b8' },
                    { la: 'شواغر',         le: 'Unfilled',       v: dr.summary.unfilledSlots,         c: dr.summary.unfilledSlots ? '#f87171' : '#64748b' },
                    { la: 'فترات عجز',     le: 'Gap intervals',  v: dr.summary.residualGapIntervals,  c: dr.summary.residualGapIntervals ? '#fbbf24' : '#64748b' },
                    { la: 'أيام حرجة',     le: 'Critical days',  v: dr.summary.criticalDays,          c: dr.summary.criticalDays ? '#f87171' : '#4ade80' },
                  ].map(t => (
                    <div key={t.le} className="rounded-2xl p-4" style={{ background: `${t.c}12`, border: `1px solid ${t.c}30` }}>
                      <p className="text-2xl font-extrabold" style={{ color: t.c }}>{t.v}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{ar ? t.la : t.le}</p>
                    </div>
                  ))}
                </div>

                {/* Applied options */}
                <div className="rounded-xl p-3 flex items-center gap-2 flex-wrap" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style={{ background: 'var(--chip-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    OFF: {dr.summary.offStrategy === 'weekend-fair' ? (ar ? 'ويكند عادل' : 'weekend-fair') : (ar ? 'أقل طلب' : 'lowest-demand')}
                  </span>
                  {dr.summary.rotationFairness && (
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>
                      {ar ? '✓ روتيشن الباند' : '✓ Band rotation'}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{dr.demand.basis}</span>
                </div>

                {/* Per-day coverage verdicts table */}
                <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <h3 className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                    <Calendar size={12} className="text-indigo-400" />
                    {ar ? 'التغطية مقابل الطلب — يوم بيوم' : 'Coverage vs demand — day by day'}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ minWidth: 640 }}>
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                          <th className="text-start px-2 py-1.5">{ar ? 'اليوم' : 'Day'}</th>
                          <th className="text-center px-2 py-1.5">{ar ? 'الحالة' : 'Risk'}</th>
                          <th className="text-center px-2 py-1.5">{ar ? 'مطلوب (ذروة)' : 'Required peak'}</th>
                          <th className="text-center px-2 py-1.5">{ar ? 'مجدول (ذروة)' : 'Staffed peak'}</th>
                          <th className="text-start px-2 py-1.5">{ar ? 'المزيج' : 'Mix'}</th>
                          <th className="text-start px-2 py-1.5">{ar ? 'فجوات (فنكشن)' : 'Gaps (function)'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dr.demand.days.map((d: any) => {
                          const rc = riskCfg[d.riskStatus] ?? riskCfg.warning;
                          const gapsByFn = new Map<string, number>();
                          for (const g of d.residualGaps ?? []) {
                            if (+String(g.interval).slice(0, 2) < 7) continue;   // 00–07 covered by prior-day MD tails (display accounting)
                            const k = g.functionName ?? '—';
                            gapsByFn.set(k, Math.max(gapsByFn.get(k) ?? 0, g.deficit));
                          }
                          return (
                            <tr key={d.date} style={{ borderTop: '1px solid var(--border)' }}>
                              <td className="px-2 py-2 font-bold" style={{ color: 'var(--text-1)' }}>{fmtDay(d.date)}</td>
                              <td className="px-2 py-2 text-center">
                                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold" style={{ background: rc.bg, color: rc.color }}>{rc.label}</span>
                              </td>
                              <td className="px-2 py-2 text-center font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>{d.requiredPeak}</td>
                              <td className="px-2 py-2 text-center font-bold tabular-nums" style={{ color: d.staffedPeak >= d.requiredPeak ? '#4ade80' : '#fbbf24' }}>{d.staffedPeak}</td>
                              <td className="px-2 py-2">
                                <div className="flex gap-1 flex-wrap">
                                  {Object.entries(d.mix ?? {}).map(([c, n]) => (
                                    <span key={c} className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                                      style={{ background: `${demandCodeColor(c)}18`, color: demandCodeColor(c), border: `1px solid ${demandCodeColor(c)}35` }}>
                                      {c}×{n as number}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-2 py-2">
                                {gapsByFn.size === 0
                                  ? <span className="text-[10px]" style={{ color: '#4ade80' }}>{ar ? '✓ لا فجوات نهارية' : '✓ no daytime gaps'}</span>
                                  : <div className="flex gap-1 flex-wrap">
                                      {[...gapsByFn.entries()].map(([fn, n]) => (
                                        <span key={fn} className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                                          style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                                          {fn} −{n}
                                        </span>
                                      ))}
                                    </div>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[9px] mt-2" style={{ color: 'var(--text-3)' }}>
                    {ar
                      ? 'فجوات 00:00–07:00 لا تُعرض هنا — يغطيها ذيل ورديات منتصف الليل (MD/MN) من اليوم السابق.'
                      : '00:00–07:00 gaps are excluded here — prior-day midnight (MD/MN) tails cover them.'}
                  </p>
                </div>

                {/* Warnings (unfilled already lives in the hero) */}
                {(dr.warnings?.length ?? 0) > 0 && (
                  <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'var(--surface-2)', border: '1px solid rgba(251,191,36,0.3)' }}>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                      <AlertTriangle size={12} className="text-amber-400" />
                      {ar ? `تنبيهات المحرك (${dr.warnings.length})` : `Engine warnings (${dr.warnings.length})`}
                    </h3>
                    {dr.warnings.slice(0, 8).map((w: string, i: number) => (
                      <p key={i} className="text-[11px]" style={{ color: 'var(--text-2)' }}>• {w}</p>
                    ))}
                    {dr.warnings.length > 8 && (
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>+{dr.warnings.length - 8} {ar ? 'أخرى…' : 'more…'}</p>
                    )}
                  </div>
                )}

                {/* Proposed grid, grouped by function */}
                {(() => {
                  const dDates: string[] = Array.from({ length: 7 }, (_, i) => addDays(dr.weekStart, i));
                  const gridByFn = new Map<string, any[]>();
                  for (const row of dr.grid ?? []) {
                    if (!Object.keys(row.days ?? {}).length) continue;   // no-demand-basis functions (scheduled elsewhere)
                    (gridByFn.get(row.functionName) ?? gridByFn.set(row.functionName, []).get(row.functionName)!).push(row);
                  }
                  return (
                    <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <h3 className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                        <Users size={12} className="text-indigo-400" />
                        {ar ? 'الجدول المقترح' : 'Proposed Schedule'}
                        <span className="font-normal" style={{ color: 'var(--text-3)' }}>{dr.summary.employees} {ar ? 'موظف' : 'employees'}</span>
                      </h3>
                      <div className="space-y-4">
                        {[...gridByFn.entries()].map(([fnName, rows]) => (
                          <div key={fnName}>
                            <p className="text-[11px] font-bold mb-1" style={{ color: 'var(--text-2)' }}>{fnName} <span className="opacity-60">({rows.length})</span></p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs" style={{ minWidth: 620 }}>
                                <thead>
                                  <tr className="text-[9px] uppercase" style={{ color: 'var(--text-3)' }}>
                                    <th className="text-start px-2 py-1">{ar ? 'الموظف' : 'Employee'}</th>
                                    {dDates.map(dt => <th key={dt} className="text-center px-1 py-1">{fmtDay(dt)}</th>)}
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((r: any) => (
                                    <tr key={r.employeeId} style={{ borderTop: '1px solid var(--border)' }}>
                                      <td className="px-2 py-1 whitespace-nowrap">
                                        <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{r.name}</span>
                                        {r.gender === 'female' && <span className="ms-1 text-[9px]" style={{ color: '#f472b6' }}>♀</span>}
                                      </td>
                                      {dDates.map(dt => {
                                        const code = r.days?.[dt];
                                        return (
                                          <td key={dt} className="px-1 py-1 text-center">
                                            {code
                                              ? <span className="inline-flex items-center justify-center w-9 h-7 rounded-lg text-[10px] font-bold"
                                                  style={code === 'OFF'
                                                    ? { background: 'rgba(71,85,105,0.15)', color: '#64748b', border: '1px solid rgba(71,85,105,0.2)' }
                                                    : { background: `${demandCodeColor(code)}20`, color: demandCodeColor(code), border: `1px solid ${demandCodeColor(code)}40` }}>
                                                  {code}
                                                </span>
                                              : <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>—</span>}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* ── Classic engine detail blocks ── */}
            {engine === 'classic' && result && (
              <>
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

                {/* Daily coverage + fairness details */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                      <Calendar size={12} className="text-indigo-400" />
                      {ar ? 'التغطية اليومية' : 'Daily Coverage'}
                    </h3>
                    <ClassicCoverageBar days={result.coverage} dates={result.dates} />
                  </div>
                  <FairnessDetailBars fairness={result.fairness} />
                </div>

                {/* Hourly HC health per function */}
                {(result as any).hourlyHealth && (
                  <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: `1px solid ${(result as any).hourlyHealth.verdict === 'ok' ? 'rgba(34,197,94,0.4)' : 'rgba(251,191,36,0.5)'}` }}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                        <ShieldCheck size={12} style={{ color: (result as any).hourlyHealth.verdict === 'ok' ? '#22c55e' : '#fbbf24' }} />
                        {ar ? 'فحص الهيدكاونت بالساعة لكل فنكشن' : 'Hourly HC health per function'}
                      </h3>
                      <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold" style={{
                        background: (result as any).hourlyHealth.verdict === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)',
                        color: (result as any).hourlyHealth.verdict === 'ok' ? '#22c55e' : '#fbbf24' }}>
                        {(result as any).hourlyHealth.verdict === 'ok' ? (ar ? '✓ مناسب' : '✓ Adequate') : (ar ? '⚠ يحتاج مراجعة' : '⚠ Needs review')}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        {ar ? 'الخط المرجعي = متوسط المجدول بالساعة آخر 28 يوم (نمط ملاحَظ، ليس Erlang)' : (result as any).hourlyHealth.basis}
                      </span>
                    </div>
                    <div className="space-y-2 mt-3">
                      {(result as any).hourlyHealth.functions.map((f: any) => (
                        <div key={f.fn} className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold w-40 truncate" style={{ color: 'var(--text-2)' }} title={f.fn}>{f.fn}</span>
                          <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(24,1fr)' }}>
                            {f.hours.map((h: any) => (
                              <div key={h.hour} className="h-5 rounded-sm flex items-center justify-center"
                                title={`${String(h.hour).padStart(2, '0')}:00 · ${ar ? 'الخطة' : 'plan'} ${h.planned}/${ar ? 'يوم' : 'day'} · ${ar ? 'المرجع' : 'baseline'} ${h.baseline}`}
                                style={{ background: h.baseline < 1 && h.planned === 0 ? 'var(--surface)'
                                  : h.short ? 'rgba(239,68,68,0.55)'
                                  : h.ratio != null && h.ratio < 1 ? 'rgba(251,191,36,0.45)'
                                  : 'rgba(34,197,94,0.4)' }}>
                                <span className="text-[7px] font-bold" style={{ color: 'var(--text-2)' }}>{h.planned >= 1 ? Math.round(h.planned) : ''}</span>
                              </div>
                            ))}
                          </div>
                          <span className="text-[10px] font-bold w-24 text-end" style={{ color: f.verdict === 'ok' ? '#22c55e' : '#ef4444' }}>
                            {f.verdict === 'ok' ? (ar ? '✓ مناسب' : '✓ OK') : (ar ? `⚠ ${f.shortHours.length} ساعات ناقصة` : `⚠ ${f.shortHours.length} short hrs`)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 text-[9px] pt-1" style={{ color: 'var(--text-3)' }}>
                        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle me-1" style={{ background: 'rgba(34,197,94,0.4)' }} />{ar ? 'يغطي المرجع' : 'meets baseline'}</span>
                        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle me-1" style={{ background: 'rgba(251,191,36,0.45)' }} />{ar ? 'أقل قليلًا' : 'slightly under'}</span>
                        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle me-1" style={{ background: 'rgba(239,68,68,0.55)' }} />{ar ? 'ناقص >15%' : 'short >15%'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Violations */}
                <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <h3 className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                    <ShieldCheck size={12} className="text-indigo-400" />
                    {ar ? 'مخالفات القواعد التشغيلية' : 'Rule Violations'}
                  </h3>
                  <ViolationsPanel violations={result.violations} />
                </div>

                {/* Proposed schedule grid */}
                <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                      <Calendar size={12} className="text-indigo-400" />
                      {ar ? 'الجدول المقترح' : 'Proposed Schedule'}
                      <span className="font-normal" style={{ color: 'var(--text-3)' }}>{result.summary.totalEmployees} {ar ? 'موظف' : 'employees'}</span>
                    </h3>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        // Canonical categories (backend/src/common/shift-category.ts): M/B/C = Morning/Day family, N = Night, MD/MN = Midnight
                        { code: 'M',  color: '#0ea5e9', labelAr: 'صباحي',                 labelEn: 'Morning' },
                        { code: 'C',  color: '#f59e0b', labelAr: 'نهاري — تنتهي 20:00',   labelEn: 'Day (ends 20:00)' },
                        { code: 'N',  color: SHIFT_COLORS.N, labelAr: 'ليلي',            labelEn: 'Night' },
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
              </>
            )}
          </div>
        </Section>
      )}

      {/* ══ ④ SAVE & PUBLISH ════════════════════════════════════════════════ */}
      {(result || dr) && (
        <Section
          no={ar ? '٤' : '4'}
          icon={Send}
          color="#10b981"
          title={ar ? 'الحفظ والنشر' : 'Save & publish'}
          desc={ar
            ? 'احفظ كمسودة أولاً (نسخة قابلة للتعديل من شاشة الجدول)، ثم انشر ليصل الجدول لكل موظف.'
            : 'Save as draft first (editable from the Schedule grid), then publish so every agent sees their shifts.'}
        >
          <div className="space-y-3">
            {actionBar}
            {engine === 'classic' && result && result.summary.totalErrors > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl text-xs text-amber-700 dark:text-amber-300"
                style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.15)' }}>
                <Info size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                {ar
                  ? 'يمكنك حفظ الجدول كمسودة وتعديله يدوياً من شاشة جدول الدوام لإصلاح المخالفات قبل النشر.'
                  : 'You can save as draft and manually edit it from the Schedule screen to fix violations before publishing.'}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!result && !dr && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <Zap size={28} className="text-indigo-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-300 text-sm font-medium">
            {ar
              ? <>{`اختر الفترة والأقسام ثم اضغط `}<span className="text-indigo-500 dark:text-indigo-400 font-bold">توليد الجدول</span></>
              : <>{'Select period & functions, then click '}<span className="text-indigo-500 dark:text-indigo-400 font-bold">Generate</span></>}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {ar
              ? `يتم توليد جدول يراعي العدالة، قواعد الراحة (${options.minRestHours}h)، وقيود الجنس — مع حكم صريح على التغطية`
              : `Generates a fair schedule respecting rest rules (${options.minRestHours}h) and gender constraints — with an honest coverage verdict`}
          </p>
        </div>
      )}
    </div>
  );
}
