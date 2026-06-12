import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshCw, Users, Moon, Sun, Award, TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, Plus, Edit2, Trash2, UserPlus,
  BarChart2, Shuffle, CheckCircle2, AlertTriangle, X, ArrowRight,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';

// ── Types ─────────────────────────────────────────────────────────────────────
interface EmployeeShiftRate {
  employeeId: string;
  employeeNo: string;
  name: string;
  gender: string;
  functionId: string;
  functionName: string;
  rotationGroupId: string | null;
  rotationGroupName: string | null;
  rotationGroupColor: string | null;
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  midnight: number;
  off: number;
  leave: number;
  workingTotal: number;
  morningPct: number;
  afternoonPct: number;
  eveningPct: number;
  nightPct: number;
  midnightPct: number;
  nightMidnightPct: number;
  relativeNightScore: number;
  lastShiftCode: string;
  lastShiftDate: string | null;
  recommendedNextShift: string;
  recommendationReason: string;
}

interface RotationGroup {
  id: string;
  name: string;
  rotationSequence: string[];
  color: string;
  description: string | null;
  memberCount: number;
}

interface Summary {
  totalEmployees: number;
  avgNightPct: number;
  avgMidnightPct: number;
  avgMorningPct: number;
  fairnessScore: number;
  rotationGroupCount: number;
  periodLabel: string;
  dataSource: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const SHIFT_COLORS: Record<string, string> = {
  M:   '#0ea5e9', B:  '#38bdf8', C: '#f59e0b',
  E:   '#f97316', N:  '#8b5cf6', N2: '#6d28d9',
  MD:  '#1e3a5f', MN: '#1e1b4b', OFF: '#475569',
};
const SHIFT_LABELS: Record<string, { ar: string; en: string }> = {
  M:   { ar: 'صباحي',       en: 'Morning'   },
  B:   { ar: 'ضحى',         en: 'Mid-Morn'  },
  C:   { ar: 'ظهيرة',       en: 'Midday'    },
  E:   { ar: 'عصري',        en: 'Evening'   },
  N:   { ar: 'مسائي',       en: 'Night'     },
  N2:  { ar: 'ليلي',        en: 'Late Night' },
  MD:  { ar: 'منتصف الليل', en: 'Midnight'  },
  OFF: { ar: 'إجازة',       en: 'OFF'       },
};
const GROUP_COLORS = [
  '#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6',
];
const DEFAULT_SEQUENCES = [
  ['M','B','C','E','N','OFF'],
  ['M','C','N','OFF'],
  ['B','E','MD','OFF'],
];

// ── Mini stacked bar ────────────────────────────────────────────────────────────
function DistBar({ emp }: { emp: EmployeeShiftRate }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const segs = [
    { pct: emp.morningPct,   color: '#0ea5e9', labelAr: 'صباحي', labelEn: 'Morning' },
    { pct: emp.afternoonPct, color: '#f59e0b', labelAr: 'ظهيرة', labelEn: 'Midday'  },
    { pct: emp.eveningPct,   color: '#f97316', labelAr: 'عصري',  labelEn: 'Evening'  },
    { pct: emp.nightPct,     color: '#8b5cf6', labelAr: 'ليلي',  labelEn: 'Night'    },
    { pct: emp.midnightPct,  color: '#1e3a5f', labelAr: 'منتصف', labelEn: 'Midnight' },
  ].filter(s => s.pct > 0);

  return (
    <div className="flex h-3 rounded-full overflow-hidden w-full min-w-[80px] bg-slate-700/30">
      {segs.map((s, i) => (
        <div
          key={i}
          title={`${ar ? s.labelAr : s.labelEn}: ${s.pct}%`}
          style={{ width: `${s.pct}%`, background: s.color }}
          className="transition-all duration-300"
        />
      ))}
    </div>
  );
}

// ── Night score badge ─────────────────────────────────────────────────────────
function NightBadge({ score, pct }: { score: number; pct: number }) {
  const color = score > 120 ? '#ef4444' : score > 105 ? '#f59e0b' : score < 80 ? '#0ea5e9' : '#10b981';
  const icon = score > 110 ? <TrendingUp size={10} /> : score < 90 ? <TrendingDown size={10} /> : null;
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-semibold" style={{ color }}>{pct}%</span>
      {icon && <span style={{ color }}>{icon}</span>}
    </div>
  );
}

// ── Fairness gauge ─────────────────────────────────────────────────────────────
function FairnessGauge({ score }: { score: number }) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = ar
    ? (score >= 80 ? 'ممتاز' : score >= 60 ? 'مقبول' : 'يحتاج تحسين')
    : (score >= 80 ? 'Excellent' : score >= 60 ? 'Acceptable' : 'Needs Work');
  const circumference = 2 * Math.PI * 28;
  const offset = circumference * (1 - score / 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-slate-900/10 dark:text-white/5" strokeWidth="6" />
          <circle
            cx="32" cy="32" r="28" fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-xs" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Create Group Modal ─────────────────────────────────────────────────────────
function GroupModal({
  onClose, onSave, initial,
}: {
  onClose: () => void;
  onSave: (dto: { name: string; rotationSequence: string[]; color: string; description: string }) => void;
  initial?: RotationGroup;
}) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? GROUP_COLORS[0]);
  const [desc, setDesc]   = useState(initial?.description ?? '');
  const [seq, setSeq]     = useState<string[]>(initial?.rotationSequence ?? DEFAULT_SEQUENCES[0]);
  const [seqInput, setSeqInput] = useState(seq.join(','));

  const handleSeqChange = (val: string) => {
    setSeqInput(val);
    setSeq(val.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  };

  const modalContent = (
    <div
      className="fixed flex items-center justify-center p-4"
      style={{ inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg,#0f1527,#151d35)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          zIndex: 10000,
        }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 end-4 text-slate-400 hover:text-white">
          <X size={18} />
        </button>
        <h3 className="text-white font-semibold text-base mb-4">
          {ar
            ? (initial ? 'تعديل مجموعة الدوران' : 'إنشاء مجموعة دوران جديدة')
            : (initial ? 'Edit Rotation Group' : 'Create Rotation Group')}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{ar ? 'اسم المجموعة' : 'Group Name'}</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              placeholder={ar ? 'مثال: مجموعة A' : 'e.g. Group A'}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-2 block">{ar ? 'اللون' : 'Color'}</label>
            <div className="flex gap-2 flex-wrap">
              {GROUP_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full transition-all duration-150"
                  style={{
                    background: c,
                    outline: color === c ? `2px solid white` : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{ar ? 'تسلسل الورديات (مفصولة بفاصلة)' : 'Shift Sequence (comma-separated)'}</label>
            <input
              value={seqInput} onChange={e => handleSeqChange(e.target.value)}
              className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
              placeholder="M,B,C,E,N,OFF"
            />
            <div className="flex gap-1 mt-2 flex-wrap">
              {seq.map((s, i) => (
                <span key={i}
                  className="px-2 py-0.5 rounded text-xs font-bold text-white"
                  style={{ background: SHIFT_COLORS[s] ?? '#6366f1' }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{ar ? 'الوصف (اختياري)' : 'Description (optional)'}</label>
            <input
              value={desc} onChange={e => setDesc(e.target.value)}
              className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              placeholder={ar ? 'وصف مختصر' : 'Short description'}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => onSave({ name, rotationSequence: seq, color, description: desc })}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
            >
              {ar ? (initial ? 'حفظ التعديلات' : 'إنشاء المجموعة') : (initial ? 'Save Changes' : 'Create Group')}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white border border-slate-700/60 transition-colors"
            >
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ShiftRotationPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';

  const [data, setData]               = useState<{ summary: Summary; employees: EmployeeShiftRate[]; groups: RotationGroup[] } | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [year, setYear]               = useState(new Date().getFullYear());
  const [fnFilter, setFnFilter]       = useState('');
  const [sortBy, setSortBy]           = useState<'nightMidnightPct' | 'morningPct' | 'name'>('nightMidnightPct');
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('desc');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup]     = useState<RotationGroup | null>(null);
  const [expandGroups, setExpandGroups]     = useState(true);
  const [expandTable, setExpandTable]       = useState(true);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [assignToGroupId, setAssignToGroupId]      = useState('');
  const [assignMsg, setAssignMsg] = useState('');

  // Rotation % BEFORE approved swaps (fairness basis) vs AFTER
  const [swapImpact, setSwapImpact] = useState<any | null>(null);
  const [swapOpen, setSwapOpen]     = useState(true);
  useEffect(() => {
    apiClient.get('/schedule-generator/shift-rate')
      .then(r => setSwapImpact(r.data)).catch(() => setSwapImpact(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (fnFilter) params.set('functionId', fnFilter);
      const { data: res } = await apiClient.get(`/schedule-rotation/shift-rates?${params}`);
      setData(res);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (useUiStore.getState().lang === 'ar' ? 'خطأ في تحميل البيانات' : 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, [year, fnFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sortedEmps = data?.employees ? [...data.employees].sort((a, b) => {
    const val = (e: EmployeeShiftRate) =>
      sortBy === 'name' ? e.name : sortBy === 'morningPct' ? e.morningPct : e.nightMidnightPct;
    const diff = val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0;
    return sortDir === 'asc' ? diff : -diff;
  }) : [];

  // Build unique function list {id, name} for filter dropdown
  const functions = data?.employees
    ? Object.values(
        data.employees.reduce((acc, e) => {
          if (e.functionId && !acc[e.functionId]) acc[e.functionId] = { id: e.functionId, name: e.functionName };
          return acc;
        }, {} as Record<string, { id: string; name: string }>)
      )
    : [];

  // Group ops
  const handleCreateGroup = async (dto: any) => {
    try {
      await apiClient.post('/schedule-rotation/groups', dto);
      setShowGroupModal(false);
      setEditingGroup(null);
      load();
    } catch {}
  };
  const handleUpdateGroup = async (dto: any) => {
    if (!editingGroup) return;
    try {
      await apiClient.put(`/schedule-rotation/groups/${editingGroup.id}`, dto);
      setEditingGroup(null);
      load();
    } catch {}
  };
  const handleDeleteGroup = async (id: string) => {
    if (!confirm(useUiStore.getState().lang === 'ar' ? 'حذف المجموعة؟' : 'Delete this group?')) return;
    await apiClient.delete(`/schedule-rotation/groups/${id}`);
    load();
  };

  const handleAssign = async () => {
    if (!assignToGroupId || selectedEmployees.size === 0) return;
    try {
      await apiClient.post(`/schedule-rotation/groups/${assignToGroupId}/members`, {
        employeeIds: Array.from(selectedEmployees),
      });
      setAssignMsg(useUiStore.getState().lang === 'ar'
        ? `✓ تم تعيين ${selectedEmployees.size} موظف للمجموعة`
        : `✓ ${selectedEmployees.size} employee(s) assigned to group`);
      setSelectedEmployees(new Set());
      setTimeout(() => setAssignMsg(''), 3000);
      load();
    } catch {}
  };

  const toggleEmp = (id: string) => {
    setSelectedEmployees(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const card = (
    title: string, value: string | number, sub: string, icon: React.ReactNode, color: string,
  ) => (
    <div
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{
        background: dark ? 'rgba(15,21,39,0.9)' : 'rgba(255,255,255,0.9)',
        border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)',
        boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(15,23,42,0.06)',
      }}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{title}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Shuffle size={20} className="text-indigo-500 dark:text-indigo-400" />
            {ar ? 'دوران الورديات وتوزيع الشيفتات' : 'Shift Rotation & Rate Distribution'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {ar ? 'تتبع عدالة توزيع الورديات وإدارة مجموعات الدوران' : 'Track shift distribution fairness and manage rotation groups'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Year selector */}
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="text-sm rounded-xl px-3 py-2 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700/60 focus:border-indigo-500 focus:outline-none"
            style={{ background: dark ? 'rgba(15,21,39,0.9)' : '#fff' }}
          >
            {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Function filter */}
          <select
            value={fnFilter}
            onChange={e => setFnFilter(e.target.value)}
            className="text-sm rounded-xl px-3 py-2 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700/60 focus:border-indigo-500 focus:outline-none"
            style={{ background: dark ? 'rgba(15,21,39,0.9)' : '#fff' }}
          >
            <option value="">{ar ? 'كل الوظائف' : 'All Functions'}</option>
            {functions.map(fn => <option key={fn.id} value={fn.id}>{fn.name}</option>)}
          </select>

          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {card(
              ar ? 'إجمالي الموظفين' : 'Employees',
              data.summary.totalEmployees, data.summary.periodLabel,
              <Users size={18} />, '#6366f1',
            )}
            {card(
              ar ? 'متوسط الليل' : 'Avg Night',
              `${data.summary.avgNightPct}%`, ar ? 'N shift %' : 'N shift %',
              <Moon size={18} />, '#8b5cf6',
            )}
            {card(
              ar ? 'متوسط منتصف الليل' : 'Avg Midnight',
              `${data.summary.avgMidnightPct}%`, ar ? 'MD shift %' : 'MD shift %',
              <Moon size={18} />, '#1e3a5f',
            )}
            {card(
              ar ? 'متوسط الصباح' : 'Avg Morning',
              `${data.summary.avgMorningPct}%`, ar ? 'M/B shift %' : 'M/B shift %',
              <Sun size={18} />, '#0ea5e9',
            )}
            <div
              className="rounded-2xl p-4 flex items-center gap-3 col-span-1"
              style={{
                background: dark ? 'rgba(15,21,39,0.9)' : 'rgba(255,255,255,0.9)',
                border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)',
                boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(15,23,42,0.06)',
              }}
            >
              <FairnessGauge score={data.summary.fairnessScore} />
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{ar ? 'عدالة التوزيع' : 'Fairness'}</p>
                <p className="text-xs text-slate-500 mt-0.5">{ar ? 'مؤشر التوازن' : 'Balance index'}</p>
              </div>
            </div>
          </div>

          {/* ── Rotation Groups section ── */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: dark ? 'rgba(15,21,39,0.9)' : 'rgba(255,255,255,0.9)',
              border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)',
              boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(15,23,42,0.06)',
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-slate-900/[0.02] dark:hover:bg-white/[0.02]"
              onClick={() => setExpandGroups(g => !g)}
              role="button"
            >
              <div className="flex items-center gap-2">
                <Shuffle size={16} className="text-indigo-500 dark:text-indigo-400" />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  {ar ? 'مجموعات الدوران' : 'Rotation Groups'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">
                  {data.groups.length}
                </span>
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setShowGroupModal(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white font-medium transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                >
                  <Plus size={12} /> {ar ? 'مجموعة جديدة' : 'New Group'}
                </button>
                {expandGroups ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </div>
            </div>

            {expandGroups && (
              <div className="px-5 pb-4 border-t border-slate-900/10 dark:border-white/5">
                {data.groups.length === 0 ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-slate-500">
                    <Shuffle size={24} />
                    <p className="text-sm">{ar ? 'لا توجد مجموعات دوران بعد' : 'No rotation groups yet'}</p>
                    <button
                      onClick={() => setShowGroupModal(true)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      <Plus size={12} /> {ar ? 'إنشاء أول مجموعة' : 'Create first group'}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                    {data.groups.map(grp => (
                      <div
                        key={grp.id}
                        className="rounded-xl p-4"
                        style={{
                          background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
                          border: `1px solid ${grp.color}30`,
                        }}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: grp.color }} />
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{grp.name}</span>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setEditingGroup(grp)}
                              className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                            ><Edit2 size={12} /></button>
                            <button
                              onClick={() => handleDeleteGroup(grp.id)}
                              className="p-1 rounded text-slate-400 hover:text-red-400 transition-colors"
                            ><Trash2 size={12} /></button>
                          </div>
                        </div>

                        {/* Rotation sequence */}
                        <div className="flex gap-1 flex-wrap mb-3">
                          {grp.rotationSequence.map((s, i) => (
                            <div key={i} className="flex items-center gap-0.5">
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                                style={{ background: SHIFT_COLORS[s] ?? '#6366f1' }}
                              >{s}</span>
                              {i < grp.rotationSequence.length - 1 && (
                                <ArrowRight size={8} className="text-slate-600" />
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Users size={11} /> {grp.memberCount} {ar ? 'موظف' : 'members'}
                          </span>
                          {grp.description && <span className="truncate ms-2">{grp.description}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Assign to group strip (shown when employees selected) ── */}
          {selectedEmployees.size > 0 && (
            <div
              className="rounded-xl px-5 py-3 flex items-center gap-3 flex-wrap"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}
            >
              <UserPlus size={15} className="text-indigo-400 flex-shrink-0" />
              <span className="text-sm text-indigo-700 dark:text-indigo-300">
                {ar ? `${selectedEmployees.size} موظف محدد` : `${selectedEmployees.size} selected`}
              </span>
              <select
                value={assignToGroupId} onChange={e => setAssignToGroupId(e.target.value)}
                className="text-sm rounded-lg px-2 py-1 text-slate-900 dark:text-white border border-indigo-500/40 focus:outline-none"
                style={{ background: dark ? 'rgba(15,21,39,0.9)' : '#fff' }}
              >
                <option value="">{ar ? 'اختر مجموعة' : 'Select group'}</option>
                {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button
                onClick={handleAssign}
                disabled={!assignToGroupId}
                className="px-3 py-1 rounded-lg text-xs font-medium text-white disabled:opacity-40 transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
              >
                {ar ? 'تعيين' : 'Assign'}
              </button>
              <button
                onClick={() => setSelectedEmployees(new Set())}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                {ar ? 'إلغاء' : 'Clear'}
              </button>
              {assignMsg && (
                <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> {assignMsg}
                </span>
              )}
            </div>
          )}

          {/* ── Swap Impact: rotation % before vs after approved swaps ── */}
          {swapImpact && (
            <div className="rounded-2xl overflow-hidden"
              style={{
                background: dark ? 'rgba(15,21,39,0.9)' : 'rgba(255,255,255,0.9)',
                border: '1px solid rgba(168,85,247,0.25)',
                boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(15,23,42,0.06)',
              }}>
              <button onClick={() => setSwapOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-3 text-start">
                <span className="text-base">🔁</span>
                <span className="text-sm font-bold" style={{ color: dark ? '#e2e8f0' : '#0f172a' }}>
                  {ar ? 'الروتيشن ٪ — قبل التبديلات vs بعد التبديلات' : 'Rotation % — Before vs After Swaps'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                  style={{ background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                  {swapImpact.affectedEmployees} {ar ? 'متأثر' : 'affected'}
                </span>
                <span className="ms-auto text-xs" style={{ color: '#64748b' }}>{swapOpen ? '▲' : '▼'}</span>
              </button>
              {swapOpen && (
                <div className="px-4 pb-3">
                  <p className="text-[10px] mb-2 px-2 py-1.5 rounded-lg"
                    style={{ background: 'rgba(168,85,247,0.07)', color: dark ? '#c4b5fd' : '#7c3aed' }}>
                    ⚖️ {ar
                      ? 'العدالة ومولّد الجدول يعتمدان أرقام "قبل التبديلات" — التبديل لا يغيّر نصيبك من الروتيشن.'
                      : 'Fairness and the generator use the BEFORE numbers — swapping never changes your rotation share.'}
                  </p>
                  {swapImpact.affectedEmployees === 0 ? (
                    <p className="text-xs py-3 text-center" style={{ color: '#64748b' }}>
                      {ar ? 'لا توجد تبديلات معتمدة مؤثرة هذه السنة' : 'No approved swaps affecting rotation this year'}
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 700 }}>
                        <thead>
                          <tr style={{ borderBottom: dark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.07)' }}>
                            <th className="px-2 py-1.5 text-[10px] font-bold" style={{ color: '#64748b', textAlign: 'start' }}>
                              {ar ? 'الموظف' : 'Employee'}</th>
                            {(['morning', 'afternoon', 'evening', 'night', 'midnight'] as const).map(c => (
                              <th key={c} className="px-2 py-1.5 text-[10px] font-bold text-center" style={{ color: '#64748b' }}>
                                {ar ? ({ morning: 'صباحي', afternoon: 'ظهيرة', evening: 'مسائي', night: 'ليلي', midnight: 'ميدنايت' }[c]) : c}
                                <div className="text-[8px] font-normal">{ar ? 'قبل ← بعد' : 'before → after'}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {swapImpact.rows.filter((r: any) => r.affectedBySwaps).map((r: any) => (
                            <tr key={r.employeeId} style={{ borderBottom: dark ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(0,0,0,0.04)' }}>
                              <td className="px-2 py-2">
                                <div className="font-semibold" style={{ color: dark ? '#e2e8f0' : '#0f172a' }}>{r.name}</div>
                                <div className="text-[9px]" style={{ color: '#64748b' }}>#{r.employeeNo} · {r.functionName}</div>
                              </td>
                              {(['morning', 'afternoon', 'evening', 'night', 'midnight'] as const).map(c => {
                                const pre = r.preSwap.byCategory[c]?.pct ?? 0;
                                const post = r.postSwap.byCategory[c]?.pct ?? 0;
                                const d = r.deltaPct[c] ?? 0;
                                return (
                                  <td key={c} className="px-2 py-2 text-center tabular-nums">
                                    <span style={{ color: dark ? '#94a3b8' : '#475569', fontWeight: 700 }}>{pre}%</span>
                                    <span style={{ color: '#475569' }}> ← </span>
                                    <span style={{ color: d > 0 ? '#f87171' : d < 0 ? '#4ade80' : (dark ? '#94a3b8' : '#475569'), fontWeight: 700 }}>
                                      {post}%
                                    </span>
                                    {d !== 0 && (
                                      <div className="text-[9px] font-bold" style={{ color: d > 0 ? '#f87171' : '#4ade80' }}>
                                        {d > 0 ? `+${d}` : d}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Employee Distribution Table ── */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: dark ? 'rgba(15,21,39,0.9)' : 'rgba(255,255,255,0.9)',
              border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)',
              boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(15,23,42,0.06)',
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-slate-900/[0.02] dark:hover:bg-white/[0.02]"
              onClick={() => setExpandTable(t => !t)}
              role="button"
            >
              <div className="flex items-center gap-2">
                <BarChart2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  {ar ? 'توزيع الورديات السنوي' : 'YTD Shift Distribution'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                  {sortedEmps.length} {ar ? 'موظف' : 'employees'}
                </span>
                {data.summary.dataSource === 'none' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                    {ar ? 'لا توجد بيانات بعد' : 'No data yet'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <span className="text-xs text-slate-500">{ar ? 'ترتيب حسب' : 'Sort by'}</span>
                <button
                  onClick={() => handleSort('nightMidnightPct')}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${sortBy === 'nightMidnightPct' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  <Moon size={11} className="inline me-1" />
                  {ar ? 'ليلي' : 'Night'}
                </button>
                <button
                  onClick={() => handleSort('morningPct')}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${sortBy === 'morningPct' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  <Sun size={11} className="inline me-1" />
                  {ar ? 'صباحي' : 'Morning'}
                </button>
                <button
                  onClick={() => handleSort('name')}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${sortBy === 'name' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  {ar ? 'الاسم' : 'Name'}
                </button>
                <span className="pointer-events-none">
                  {expandTable ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </span>
              </div>
            </div>

            {expandTable && (
              <div className="overflow-x-auto border-t border-slate-900/10 dark:border-white/5">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{
                      background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
                      borderBottom: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)',
                    }}>
                      <th className="w-8 py-3 px-3">
                        <input
                          type="checkbox"
                          className="accent-indigo-500"
                          checked={selectedEmployees.size === sortedEmps.length && sortedEmps.length > 0}
                          onChange={e => {
                            if (e.target.checked) setSelectedEmployees(new Set(sortedEmps.map(emp => emp.employeeId)));
                            else setSelectedEmployees(new Set());
                          }}
                        />
                      </th>
                      <th className="text-start py-3 px-3 text-slate-400 font-medium">{ar ? 'الموظف' : 'Employee'}</th>
                      <th className="text-start py-3 px-3 text-slate-400 font-medium">{ar ? 'الوظيفة' : 'Function'}</th>
                      <th className="text-start py-3 px-3 text-slate-400 font-medium">{ar ? 'المجموعة' : 'Group'}</th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium min-w-[44px]" title="صباحي (M+B)">
                        <span style={{ color: '#0ea5e9' }}>{ar ? 'صباحي' : 'Morn'}</span>
                      </th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium min-w-[44px]" title="ظهيرة (C)">
                        <span style={{ color: '#f59e0b' }}>{ar ? 'ظهيرة' : 'Mid'}</span>
                      </th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium min-w-[44px]" title="عصري (E)">
                        <span style={{ color: '#f97316' }}>{ar ? 'عصري' : 'Eve'}</span>
                      </th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium min-w-[44px]" title="مسائي (N/N2)">
                        <span style={{ color: '#8b5cf6' }}>{ar ? 'ليلي' : 'Night'}</span>
                      </th>
                      <th className="text-center py-3 px-2 text-slate-400 font-medium min-w-[44px]" title="منتصف الليل (MD/MN)">
                        <span style={{ color: '#6366f1' }}>{ar ? 'منتصف' : 'Mid-N'}</span>
                      </th>
                      <th className="text-start py-3 px-3 text-slate-400 font-medium min-w-[120px]">
                        {ar ? 'التوزيع' : 'Distribution'}
                      </th>
                      <th className="text-center py-3 px-3 text-slate-400 font-medium">
                        {ar ? 'ليلي+منتصف' : 'Night+Mid'}
                      </th>
                      <th className="text-start py-3 px-3 text-slate-400 font-medium">
                        {ar ? 'التوصية' : 'Recommend'}
                      </th>
                      <th className="text-center py-3 px-3 text-slate-400 font-medium">
                        {ar ? 'آخر وردية' : 'Last Shift'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEmps.map((emp, idx) => {
                      const selected = selectedEmployees.has(emp.employeeId);
                      const isBelowAvg = emp.relativeNightScore < 80;
                      const isAboveAvg = emp.relativeNightScore > 120;

                      return (
                        <tr
                          key={emp.employeeId}
                          onClick={() => toggleEmp(emp.employeeId)}
                          className="cursor-pointer transition-colors duration-100 hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.03]"
                          style={{
                            borderBottom: dark ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(15,23,42,0.06)',
                            background: selected
                              ? 'rgba(99,102,241,0.08)'
                              : idx % 2 === 0 ? 'transparent' : dark ? 'rgba(255,255,255,0.01)' : 'rgba(15,23,42,0.015)',
                          }}
                        >
                          <td className="py-2.5 px-3">
                            <input type="checkbox" className="accent-indigo-500" checked={selected} onChange={() => {}} />
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-col">
                              <span className="text-slate-900 dark:text-white font-medium truncate max-w-[130px]">{emp.name}</span>
                              <span className="text-slate-500">{emp.employeeNo}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 truncate max-w-[100px]">{emp.functionName}</td>
                          <td className="py-2.5 px-3">
                            {emp.rotationGroupName ? (
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white"
                                style={{ background: `${emp.rotationGroupColor}30`, border: `1px solid ${emp.rotationGroupColor}50`, color: emp.rotationGroupColor! }}
                              >
                                {emp.rotationGroupName}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          {/* Shift category % columns */}
                          {[
                            { val: emp.morningPct,   color: '#0ea5e9' },
                            { val: emp.afternoonPct, color: '#f59e0b' },
                            { val: emp.eveningPct,   color: '#f97316' },
                            { val: emp.nightPct,     color: '#8b5cf6' },
                            { val: emp.midnightPct,  color: '#6366f1' },
                          ].map((s, i) => (
                            <td key={i} className="py-2.5 px-2 text-center">
                              <span style={{ color: s.val > 0 ? s.color : '#334155' }}>
                                {s.val > 0 ? `${s.val}%` : '—'}
                              </span>
                            </td>
                          ))}
                          {/* Distribution bar */}
                          <td className="py-2.5 px-3">
                            {emp.workingTotal > 0 ? <DistBar emp={emp} /> : (
                              <span className="text-slate-600 text-[10px]">{ar ? 'لا بيانات' : 'No data'}</span>
                            )}
                          </td>
                          {/* Night+Midnight combined */}
                          <td className="py-2.5 px-3 text-center">
                            <NightBadge score={emp.relativeNightScore} pct={emp.nightMidnightPct} />
                          </td>
                          {/* Recommendation */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold text-white flex-shrink-0"
                                style={{ background: SHIFT_COLORS[emp.recommendedNextShift] ?? '#6366f1' }}
                              >
                                {emp.recommendedNextShift}
                              </span>
                              <span className="text-slate-500 text-[10px] truncate max-w-[80px]" title={emp.recommendationReason}>
                                {emp.recommendationReason}
                              </span>
                            </div>
                          </td>
                          {/* Last shift */}
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                              style={{ background: SHIFT_COLORS[emp.lastShiftCode] ?? '#475569' }}
                            >
                              {emp.lastShiftCode}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {sortedEmps.length === 0 && (
                  <div className="py-12 text-center">
                    <Users size={28} className="mx-auto text-slate-600 mb-3" />
                    <p className="text-sm text-slate-400">{ar ? 'لا يوجد موظفون في هذا القسم' : 'No employees found'}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Legend ── */}
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            {Object.entries(SHIFT_LABELS).filter(([k]) => k !== 'OFF').map(([code, label]) => (
              <div key={code} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: SHIFT_COLORS[code] }} />
                <span style={{ color: SHIFT_COLORS[code] }}>{code}</span>
                <span>— {ar ? label.ar : label.en}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Modals ── */}
      {showGroupModal && (
        <GroupModal
          onClose={() => setShowGroupModal(false)}
          onSave={handleCreateGroup}
        />
      )}
      {editingGroup && (
        <GroupModal
          onClose={() => setEditingGroup(null)}
          onSave={handleUpdateGroup}
          initial={editingGroup}
        />
      )}
    </div>
  );
}
