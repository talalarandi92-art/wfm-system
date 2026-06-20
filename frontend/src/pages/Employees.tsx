import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Search, RefreshCw, Filter, ChevronDown, ChevronUp,
  User, Building2, Briefcase, Calendar, Link2, Shield,
  CheckCircle2, XCircle, Loader2, Edit3, Check, X as XIcon,
  UserCheck, TrendingUp, Clock,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Employee {
  id: string;
  employeeNo: string;
  fullName: string;
  firstNameEn: string;
  lastNameEn: string | null;
  gender: string;
  status: string;
  employmentType: string;
  hireDate: string | null;
  isSupervisor: boolean;
  productivityFactor: number;
  notes: string | null;
  functionId: string | null;
  functionName: string | null;
  userId: string | null;
  userEmail: string | null;
  attendanceCount: number;
  scheduleCount: number;
}

interface FunctionOption { id: string; name: string; }

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  active:     { bg: 'rgba(16,185,129,0.12)',  color: '#34d399', label: 'Active' },
  inactive:   { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: 'Inactive' },
  resigned:   { bg: 'rgba(245,158,11,0.12)',  color: '#fbbf24', label: 'Resigned' },
  terminated: { bg: 'rgba(239,68,68,0.12)',   color: '#f87171', label: 'Terminated' },
  on_leave:   { bg: 'rgba(139,92,246,0.12)',  color: '#a78bfa', label: 'On Leave' },
};

const TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  full_time:   { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
  intern:      { bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24' },
  part_time:   { bg: 'rgba(52,211,153,0.1)',  color: '#34d399' },
  contractor:  { bg: 'rgba(249,115,22,0.1)',  color: '#fb923c' },
};

const GENDER_ICON = (g: string) => g === 'female' ? '♀' : '♂';

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function EmployeesPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [functions, setFunctions] = useState<FunctionOption[]>([]);

  // Filters
  const [search, setSearch]         = useState('');
  const [statusF, setStatusF]       = useState('');
  const [functionF, setFunctionF]   = useState('');
  const [typeF, setTypeF]           = useState('');
  const [genderF, setGenderF]       = useState('');
  const [page, setPage]             = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const LIMIT = 30;

  // Inline edit
  const [editing, setEditing]         = useState<string | null>(null);
  const [editNotes, setEditNotes]     = useState('');
  const [editStatus, setEditStatus]   = useState('');
  const [editPF, setEditPF]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  /* ── Load ────────────────────────────────────────────────────────────── */
  const load = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const params: any = { limit: LIMIT, offset: p * LIMIT };
      if (search.trim())    params.search         = search.trim();
      if (statusF)          params.status         = statusF;
      if (functionF)        params.functionId     = functionF;
      if (typeF)            params.employmentType = typeF;
      if (genderF)          params.gender         = genderF;
      const { data } = await apiClient.get('/employees', { params });
      setEmployees(data.data);
      setTotal(data.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, statusF, functionF, typeF, genderF]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(0); load(0); }, 350);
  }, [search, statusF, functionF, typeF, genderF, load]);

  // Load function list once
  useEffect(() => {
    apiClient.get('/employees/meta/functions')
      .then(({ data }) => setFunctions(data))
      .catch(() => {});
  }, []);

  /* ── Inline edit save ────────────────────────────────────────────────── */
  const saveEdit = async (emp: Employee) => {
    setSaving(true);
    try {
      const body: any = {};
      if (editStatus !== emp.status)                          body.status = editStatus;
      if (editNotes  !== (emp.notes ?? ''))                   body.notes  = editNotes;
      if (parseFloat(editPF) !== emp.productivityFactor)      body.productivityFactor = parseFloat(editPF);
      if (!Object.keys(body).length) { setEditing(null); setSaving(false); return; }
      await apiClient.patch(`/employees/${emp.id}`, body);
      await load(page);
      showToast(ar ? 'تم الحفظ' : 'Saved', true);
    } catch (e: any) {
      showToast(e?.response?.data?.message ?? (ar ? 'خطأ' : 'Error'), false);
    }
    setSaving(false);
    setEditing(null);
  };

  const startEdit = (emp: Employee) => {
    setEditing(emp.id);
    setEditStatus(emp.status);
    setEditNotes(emp.notes ?? '');
    setEditPF(String(emp.productivityFactor));
    setExpandedId(null);
  };

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  };

  /* ── Stats from loaded data ──────────────────────────────────────────── */
  const active   = employees.filter(e => e.status === 'active').length;
  const interns  = employees.filter(e => e.employmentType === 'intern').length;
  const linked   = employees.filter(e => e.userId).length;
  const female   = employees.filter(e => e.gender === 'female').length;

  /* ── Pagination ──────────────────────────────────────────────────────── */
  const totalPages = Math.ceil(total / LIMIT);
  const goPage = (p: number) => { setPage(p); load(p); };

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: tp(dark) }}>
            {ar ? 'الموظفون' : 'Employees'}
          </h1>
          <p className="text-sm mt-1" style={{ color: tsColor(dark) }}>
            {ar ? `${total} موظف في قاعدة البيانات` : `${total} employees in database`}
          </p>
        </div>
        <button
          onClick={() => load(page)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-opacity hover:opacity-80"
          style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: ar ? 'نشط' : 'Active',       value: active,  color: '#34d399', icon: UserCheck },
          { label: ar ? 'متدرب' : 'Interns',    value: interns, color: '#fbbf24', icon: TrendingUp },
          { label: ar ? 'مربوط بحساب' : 'Linked', value: linked, color: '#818cf8', icon: Link2 },
          { label: ar ? 'إناث' : 'Female',      value: female,  color: '#f472b6', icon: Users },
        ].map(c => (
          <div key={c.label}
            style={{ ...cardStyle(dark), padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${c.color}18`, color: c.color }}>
              <c.icon size={16} />
            </div>
            <div>
              <div className="text-xl font-bold" style={{ color: c.color }}>{c.value}</div>
              <div className="text-[11px]" style={{ color: tsColor(dark) }}>{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Search + Filters bar ─────────────────────────────────────────── */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-slate-500"
            style={{ [ar ? 'right' : 'left']: 12 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={ar ? 'بحث بالاسم أو الرقم...' : 'Search by name or employee #...'}
            className="w-full rounded-xl text-sm py-2.5 outline-none"
            style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#e2e8f0', paddingInlineStart: 36, paddingInlineEnd: 12,
            }}
          />
        </div>
        <button
          onClick={() => setFiltersOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors"
          style={{
            background: filtersOpen ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${filtersOpen ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)'}`,
            color: filtersOpen ? '#818cf8' : '#94a3b8',
          }}
        >
          <Filter size={14} />
          {ar ? 'فلاتر' : 'Filters'}
          {(statusF || functionF || typeF || genderF) && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
          )}
        </button>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────────── */}
      {filtersOpen && (
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4"
          style={{ ...cardStyle(dark), padding: 16 }}
        >
          {/* Status */}
          <FilterSelect
            value={statusF} onChange={setStatusF}
            placeholder={ar ? 'الحالة' : 'Status'}
            options={[
              { value: 'active',     label: ar ? 'نشط' : 'Active' },
              { value: 'inactive',   label: ar ? 'غير نشط' : 'Inactive' },
              { value: 'resigned',   label: ar ? 'استقال' : 'Resigned' },
              { value: 'terminated', label: ar ? 'فُصل' : 'Terminated' },
            ]}
          />
          {/* Function */}
          <FilterSelect
            value={functionF} onChange={setFunctionF}
            placeholder={ar ? 'الوظيفة' : 'Function'}
            options={functions.map(f => ({ value: f.id, label: f.name }))}
          />
          {/* Type */}
          <FilterSelect
            value={typeF} onChange={setTypeF}
            placeholder={ar ? 'نوع التوظيف' : 'Type'}
            options={[
              { value: 'full_time',  label: ar ? 'دوام كامل' : 'Full Time' },
              { value: 'intern',     label: ar ? 'متدرب' : 'Intern' },
              { value: 'part_time',  label: ar ? 'دوام جزئي' : 'Part Time' },
              { value: 'contractor', label: ar ? 'متعاقد' : 'Contractor' },
            ]}
          />
          {/* Gender */}
          <FilterSelect
            value={genderF} onChange={setGenderF}
            placeholder={ar ? 'الجنس' : 'Gender'}
            options={[
              { value: 'male',   label: ar ? 'ذكر' : 'Male' },
              { value: 'female', label: ar ? 'أنثى' : 'Female' },
            ]}
          />
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading && employees.length === 0 ? (
        <div className="flex items-center justify-center h-48 gap-3" style={{ color: tsColor(dark) }}>
          <Loader2 size={22} className="animate-spin" /><span>{ar ? 'جاري التحميل...' : 'Loading...'}</span>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden"
            style={{ ...cardStyle(dark) }}>

            {/* Header row */}
            <div
              className="grid text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5"
              style={{
                gridTemplateColumns: '1fr 1fr 120px 100px 100px 36px',
                color: tsColor(dark),
                borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                background: dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)',
              }}
            >
              <span>{ar ? 'الموظف' : 'Employee'}</span>
              <span>{ar ? 'الوظيفة' : 'Function'}</span>
              <span>{ar ? 'النوع' : 'Type'}</span>
              <span>{ar ? 'الحالة' : 'Status'}</span>
              <span>{ar ? 'سجلات' : 'Records'}</span>
              <span />
            </div>

            {employees.map((emp, idx) => (
              <EmployeeRow
                key={emp.id}
                emp={emp}
                ar={ar}
                dark={dark}
                isLast={idx === employees.length - 1}
                isEditing={editing === emp.id}
                isExpanded={expandedId === emp.id}
                editStatus={editStatus} setEditStatus={setEditStatus}
                editNotes={editNotes}   setEditNotes={setEditNotes}
                editPF={editPF}         setEditPF={setEditPF}
                saving={saving}
                onStartEdit={() => startEdit(emp)}
                onSave={() => saveEdit(emp)}
                onCancelEdit={() => setEditing(null)}
                onToggleExpand={() => setExpandedId(expandedId === emp.id ? null : emp.id)}
              />
            ))}

            {employees.length === 0 && (
              <div className="text-center py-12" style={{ color: tsColor(dark) }}>
                {ar ? 'لا توجد نتائج' : 'No results found'}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs" style={{ color: '#64748b' }}>
                {ar
                  ? `${page * LIMIT + 1}–${Math.min((page + 1) * LIMIT, total)} من ${total}`
                  : `${page * LIMIT + 1}–${Math.min((page + 1) * LIMIT, total)} of ${total}`}
              </span>
              <div className="flex gap-1.5">
                {Array.from({ length: totalPages }, (_, i) => i).map(p => (
                  <button
                    key={p}
                    onClick={() => goPage(p)}
                    className="w-7 h-7 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: p === page ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                      color: p === page ? '#818cf8' : '#64748b',
                      border: p === page ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                    }}
                  >
                    {p + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-6 flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-medium shadow-xl z-50"
          style={{
            [ar ? 'left' : 'right']: 24,
            background: toast.ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
            color: toast.ok ? '#34d399' : '#f87171',
            backdropFilter: 'blur(12px)',
          }}
        >
          {toast.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ─── EmployeeRow ─────────────────────────────────────────────────────────── */
function EmployeeRow({
  emp, ar, dark, isLast, isEditing, isExpanded,
  editStatus, setEditStatus, editNotes, setEditNotes, editPF, setEditPF,
  saving, onStartEdit, onSave, onCancelEdit, onToggleExpand,
}: {
  emp: Employee; ar: boolean; dark: boolean; isLast: boolean;
  isEditing: boolean; isExpanded: boolean;
  editStatus: string; setEditStatus: (v: string) => void;
  editNotes: string; setEditNotes: (v: string) => void;
  editPF: string; setEditPF: (v: string) => void;
  saving: boolean;
  onStartEdit: () => void; onSave: () => void; onCancelEdit: () => void;
  onToggleExpand: () => void;
}) {
  const ss = STATUS_STYLE[emp.status] ?? { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: emp.status };
  const typeStyle = TYPE_STYLE[emp.employmentType] ?? { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' };
  const dividerColor = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';

  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${dividerColor}` }}>
      {/* Main row */}
      <div
        className="grid items-center px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.02]"
        style={{ gridTemplateColumns: '1fr 1fr 120px 100px 100px 36px' }}
        onClick={onToggleExpand}
      >
        {/* Employee name + no + gender */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold"
            style={{
              background: emp.gender === 'female'
                ? 'linear-gradient(135deg,rgba(244,114,182,0.2),rgba(236,72,153,0.1))'
                : 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(79,70,229,0.1))',
              color: emp.gender === 'female' ? '#f472b6' : '#818cf8',
              border: `1px solid ${emp.gender === 'female' ? 'rgba(244,114,182,0.25)' : 'rgba(99,102,241,0.2)'}`,
            }}
          >
            {GENDER_ICON(emp.gender)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: tp(dark) }}>{emp.fullName}</div>
            <div className="text-[10px]" style={{ color: '#64748b' }}>
              #{emp.employeeNo}
              {emp.isSupervisor && (
                <span className="ms-1.5 px-1 rounded" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>
                  {ar ? 'مشرف' : 'Sup.'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Function */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Building2 size={12} style={{ color: '#475569', flexShrink: 0 }} />
          <span className="text-xs truncate" style={{ color: '#94a3b8' }}>
            {emp.functionName ?? '—'}
          </span>
        </div>

        {/* Employment type */}
        <div>
          <span
            className="text-[10px] px-2 py-0.5 rounded-lg font-medium"
            style={{ background: typeStyle.bg, color: typeStyle.color }}
          >
            {emp.employmentType === 'full_time' ? (ar ? 'دوام كامل' : 'Full Time')
              : emp.employmentType === 'intern' ? (ar ? 'متدرب' : 'Intern')
              : emp.employmentType}
          </span>
          {emp.employmentType === 'intern' && (
            <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>
              {Math.round(emp.productivityFactor * 100)}%
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <span
            className="text-[10px] px-2 py-0.5 rounded-lg font-medium"
            style={{ background: ss.bg, color: ss.color }}
          >
            {ar
              ? (emp.status === 'active' ? 'نشط' : emp.status === 'inactive' ? 'غير نشط'
                : emp.status === 'resigned' ? 'استقال' : ss.label)
              : ss.label}
          </span>
        </div>

        {/* Record counts */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1 text-[10px]" style={{ color: '#64748b' }}>
            <Clock size={9} />{emp.attendanceCount}
          </div>
          <div className="flex items-center gap-1 text-[10px]" style={{ color: '#64748b' }}>
            <Calendar size={9} />{emp.scheduleCount}
          </div>
        </div>

        {/* Expand chevron */}
        <div className="flex justify-end">
          {isExpanded
            ? <ChevronUp size={14} style={{ color: '#64748b' }} />
            : <ChevronDown size={14} style={{ color: '#64748b' }} />}
        </div>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && !isEditing && (
        <div
          className="px-4 pb-4 pt-1"
          style={{ background: dark ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.02)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <DetailItem label={ar ? 'تاريخ التوظيف' : 'Hire Date'}
              value={emp.hireDate ?? '—'} icon={Calendar} />
            <DetailItem label={ar ? 'معامل الإنتاجية' : 'Productivity'}
              value={`${Math.round(emp.productivityFactor * 100)}%`} icon={TrendingUp} />
            <DetailItem label={ar ? 'الجنس' : 'Gender'}
              value={emp.gender === 'female' ? (ar ? 'أنثى' : 'Female') : (ar ? 'ذكر' : 'Male')} icon={User} />
            <DetailItem label={ar ? 'حساب المستخدم' : 'User Account'}
              value={emp.userEmail ?? (ar ? 'غير مربوط' : 'Unlinked')}
              icon={emp.userId ? Shield : Link2}
              color={emp.userId ? '#34d399' : '#f59e0b'} />
          </div>
          {emp.notes && (
            <div className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', color: '#94a3b8' }}>
              {emp.notes}
            </div>
          )}
          <button
            onClick={onStartEdit}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}
          >
            <Edit3 size={11} />
            {ar ? 'تعديل' : 'Edit'}
          </button>
        </div>
      )}

      {/* Edit panel */}
      {isEditing && (
        <div
          className="px-4 pb-4 pt-2"
          style={{ background: dark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.02)', borderTop: '1px solid rgba(99,102,241,0.15)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            {/* Status */}
            <div>
              <label className="text-[10px] mb-1 block" style={{ color: '#64748b' }}>
                {ar ? 'الحالة' : 'Status'}
              </label>
              <select
                value={editStatus}
                onChange={e => setEditStatus(e.target.value)}
                className="w-full rounded-xl text-sm py-2 px-3 outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="resigned">Resigned</option>
                <option value="terminated">Terminated</option>
                <option value="on_leave">On Leave</option>
              </select>
            </div>
            {/* Productivity factor */}
            <div>
              <label className="text-[10px] mb-1 block" style={{ color: '#64748b' }}>
                {ar ? 'معامل الإنتاجية (0.1–2.0)' : 'Productivity Factor (0.1–2.0)'}
              </label>
              <input
                type="number" min="0.1" max="2" step="0.05"
                value={editPF}
                onChange={e => setEditPF(e.target.value)}
                className="w-full rounded-xl text-sm py-2 px-3 outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }}
              />
            </div>
            {/* Notes */}
            <div>
              <label className="text-[10px] mb-1 block" style={{ color: '#64748b' }}>
                {ar ? 'ملاحظات' : 'Notes'}
              </label>
              <input
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                className="w-full rounded-xl text-sm py-2 px-3 outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {ar ? 'حفظ' : 'Save'}
            </button>
            <button
              onClick={onCancelEdit}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              <XIcon size={11} />
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── DetailItem ──────────────────────────────────────────────────────────── */
function DetailItem({ label, value, icon: Icon, color = '#94a3b8' }: {
  label: string; value: string; icon: any; color?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: `${color}18`, color }}>
        <Icon size={12} />
      </div>
      <div>
        <div className="text-[10px]" style={{ color: '#475569' }}>{label}</div>
        <div className="text-xs font-medium mt-0.5 truncate max-w-[140px]" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

/* ─── FilterSelect ────────────────────────────────────────────────────────── */
function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void;
  placeholder: string; options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl text-sm py-2 px-3 outline-none"
      style={{
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
        color: value ? '#e2e8f0' : '#64748b',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
