import { useState, useEffect, useCallback, useRef } from 'react';
import {
  UserCog, Search, RefreshCw, Link2, Link2Off, CheckCircle2,
  XCircle, Loader2, AlertTriangle, Shield, User, ChevronDown,
  ChevronUp, X, Sparkles, Building2,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface LinkedEmp {
  employeeNo: string;
  fullName: string;
  functionName: string | null;
}

interface UserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  roles: string[];
  employeeId: string | null;
  employee: LinkedEmp | null;
}

interface EmpSuggestion {
  id: string;
  employee_no: string;
  full_name: string;
  function_name: string | null;
  score: number;
}

interface EmpSearchResult {
  id: string;
  employeeNo: string;
  fullName: string;
  functionName: string | null;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const STATUS_COLOR: Record<string, string> = {
  active:   '#10b981',
  pending:  '#f59e0b',
  inactive: '#64748b',
  suspended:'#ef4444',
};

const ROLE_LABEL: Record<string, string> = {
  admin:         'Admin',
  wfm_analyst:   'WFM',
  wfm_supervisor:'WFM Sup.',
  team_leader:   'TL',
  rta:           'RTA',
  agent:         'Agent',
  hr:            'HR',
  operations_manager: 'Ops Mgr',
};

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function UserManagementPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [users, setUsers]           = useState<UserRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [searchQ, setSearchQ]       = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);

  // per-row link panel state
  const [suggestions, setSuggestions]     = useState<EmpSuggestion[]>([]);
  const [sugLoading, setSugLoading]       = useState(false);
  const [empSearch, setEmpSearch]         = useState('');
  const [empResults, setEmpResults]       = useState<EmpSearchResult[]>([]);
  const [empSearching, setEmpSearching]   = useState(false);
  const [linking, setLinking]             = useState(false);
  const empSearchTimer = useRef<ReturnType<typeof setTimeout>>();

  /* ── Load users ─────────────────────────────────────────────────────── */
  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/users', { params: q ? { search: q } : {} });
      setUsers(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Debounced search ───────────────────────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => load(searchQ || undefined), 350);
    return () => clearTimeout(t);
  }, [searchQ, load]);

  /* ── Expand row → fetch suggestions ────────────────────────────────── */
  const expand = useCallback(async (userId: string) => {
    if (expandedId === userId) { setExpandedId(null); return; }
    setExpandedId(userId);
    setSuggestions([]);
    setEmpSearch('');
    setEmpResults([]);
    setSugLoading(true);
    try {
      const { data } = await apiClient.get(`/users/${userId}/employee-suggestions`);
      setSuggestions(data);
    } catch { /* ignore */ }
    setSugLoading(false);
  }, [expandedId]);

  /* ── Employee free-text search ──────────────────────────────────────── */
  useEffect(() => {
    clearTimeout(empSearchTimer.current);
    if (!empSearch.trim() || empSearch.length < 2) { setEmpResults([]); return; }
    empSearchTimer.current = setTimeout(async () => {
      setEmpSearching(true);
      try {
        const { data } = await apiClient.get('/employees', {
          params: { search: empSearch, limit: 8 },
        });
        setEmpResults(data.map((e: any) => ({
          id: e.id,
          employeeNo: e.employeeNo ?? e.employee_no,
          fullName: e.fullName ?? e.full_name,
          functionName: e.functionName ?? e.function_name ?? null,
        })));
      } catch { setEmpResults([]); }
      setEmpSearching(false);
    }, 300);
  }, [empSearch]);

  /* ── Link / unlink ──────────────────────────────────────────────────── */
  const linkEmployee = useCallback(async (userId: string, employeeId: string | null) => {
    setLinking(true);
    try {
      await apiClient.patch(`/users/${userId}/employee`, { employeeId });
      await load(searchQ || undefined);
      if (employeeId) setExpandedId(null);
      const arNow = useUiStore.getState().lang === 'ar';
      showToast(employeeId ? (arNow ? 'تم ربط الحساب بالموظف' : 'Account linked') : (arNow ? 'تم فك الربط' : 'Link removed'), true);
    } catch (e: any) {
      const arNow = useUiStore.getState().lang === 'ar';
      showToast(e?.response?.data?.message ?? (arNow ? 'حدث خطأ' : 'An error occurred'), false);
    }
    setLinking(false);
  }, [load, searchQ]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  /* ── Stats ──────────────────────────────────────────────────────────── */
  const linked   = users.filter(u => u.employeeId).length;
  const unlinked = users.filter(u => !u.employeeId).length;

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: tp(dark) }}>
            {ar ? 'إدارة المستخدمين' : 'User Management'}
          </h1>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>
            {ar
              ? 'ربط حسابات المستخدمين بسجلات الموظفين'
              : 'Link user accounts to employee records'}
          </p>
        </div>
        <button
          onClick={() => load(searchQ || undefined)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors"
          style={{
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.25)',
            color: '#818cf8',
          }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: ar ? 'إجمالي الحسابات' : 'Total Accounts', value: users.length, color: '#818cf8' },
          { label: ar ? 'مربوط بموظف'      : 'Linked',          value: linked,       color: '#10b981' },
          { label: ar ? 'غير مربوط'         : 'Unlinked',        value: unlinked,     color: '#f59e0b' },
        ].map(c => (
          <div key={c.label} style={{ ...cardStyle(dark), padding: 16 }}>
            <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-xs mt-1" style={{ color: tsColor(dark) }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search size={15} className="absolute top-1/2 -translate-y-1/2 text-slate-500"
          style={{ [ar ? 'right' : 'left']: 12 }} />
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder={ar ? 'بحث بالاسم أو البريد...' : 'Search by name or email...'}
          className="w-full rounded-xl text-sm py-2.5 outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#e2e8f0',
            paddingInlineStart: 36,
            paddingInlineEnd: 12,
          }}
        />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading && users.length === 0 ? (
        <div className="flex items-center justify-center h-48 gap-3" style={{ color: '#64748b' }}>
          <Loader2 size={22} className="animate-spin" />
          <span>{ar ? 'جاري التحميل...' : 'Loading...'}</span>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>

          {users.map((user, idx) => (
            <UserRowComp
              key={user.id}
              user={user}
              ar={ar}
              isExpanded={expandedId === user.id}
              onExpand={() => expand(user.id)}
              isLast={idx === users.length - 1}
              /* link-panel props */
              suggestions={suggestions}
              sugLoading={sugLoading}
              empSearch={empSearch}
              setEmpSearch={setEmpSearch}
              empResults={empResults}
              empSearching={empSearching}
              linking={linking}
              onLink={empId => linkEmployee(user.id, empId)}
              onUnlink={() => linkEmployee(user.id, null)}
            />
          ))}

          {users.length === 0 && (
            <div className="text-center py-12" style={{ color: '#64748b' }}>
              {ar ? 'لا توجد نتائج' : 'No results found'}
            </div>
          )}
        </div>
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

/* ─── UserRowComp ─────────────────────────────────────────────────────────── */
interface RowProps {
  user: UserRow;
  ar: boolean;
  isExpanded: boolean;
  onExpand: () => void;
  isLast: boolean;
  suggestions: EmpSuggestion[];
  sugLoading: boolean;
  empSearch: string;
  setEmpSearch: (v: string) => void;
  empResults: EmpSearchResult[];
  empSearching: boolean;
  linking: boolean;
  onLink: (id: string) => void;
  onUnlink: () => void;
}

function UserRowComp({
  user, ar, isExpanded, onExpand, isLast,
  suggestions, sugLoading, empSearch, setEmpSearch,
  empResults, empSearching, linking, onLink, onUnlink,
}: RowProps) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>

      {/* ── Main row ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-4 py-3.5 cursor-pointer transition-colors"
        style={{ ':hover': {} } as any}
        onClick={onExpand}
      >
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold"
          style={{
            background: user.employeeId
              ? 'linear-gradient(135deg,rgba(16,185,129,0.2),rgba(52,211,153,0.1))'
              : 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.1))',
            border: `1px solid ${user.employeeId ? 'rgba(16,185,129,0.25)' : 'rgba(99,102,241,0.2)'}`,
            color: user.employeeId ? '#34d399' : '#818cf8',
          }}
        >
          {fullName[0]?.toUpperCase() ?? '?'}
        </div>

        {/* Name + email */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: '#e2e8f0' }}>
              {fullName}
            </span>
            {/* Status badge */}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
              style={{
                color: STATUS_COLOR[user.status] ?? '#64748b',
                background: `${STATUS_COLOR[user.status] ?? '#64748b'}18`,
              }}
            >
              {user.status}
            </span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>{user.email}</div>
        </div>

        {/* Roles */}
        <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
          {user.roles.slice(0, 2).map(r => (
            <span
              key={r}
              className="text-[10px] px-2 py-0.5 rounded-lg"
              style={{
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.2)',
                color: '#818cf8',
              }}
            >
              {ROLE_LABEL[r] ?? r}
            </span>
          ))}
          {user.roles.length > 2 && (
            <span className="text-[10px]" style={{ color: '#64748b' }}>+{user.roles.length - 2}</span>
          )}
        </div>

        {/* Link status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {user.employee ? (
            <div className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-xl"
              style={{
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.2)',
                color: '#34d399',
              }}
            >
              <Link2 size={11} />
              <span className="font-medium truncate max-w-[120px]">{user.employee.fullName}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-xl"
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.2)',
                color: '#fbbf24',
              }}
            >
              <AlertTriangle size={11} />
              {ar ? 'غير مربوط' : 'Unlinked'}
            </div>
          )}
          {isExpanded ? <ChevronUp size={15} style={{ color: '#64748b' }} /> : <ChevronDown size={15} style={{ color: '#64748b' }} />}
        </div>
      </div>

      {/* ── Expanded link panel ───────────────────────────────────────────── */}
      {isExpanded && (
        <div
          className="px-4 pb-5 pt-1"
          style={{ background: 'rgba(0,0,0,0.15)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Current link info */}
          {user.employee && (
            <div
              className="flex items-center justify-between gap-3 p-3 rounded-xl mb-4"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
                  <Shield size={14} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: '#34d399' }}>
                    {user.employee.fullName}
                  </div>
                  <div className="text-[11px]" style={{ color: '#64748b' }}>
                    {user.employee.functionName ?? (ar ? 'لا توجد وظيفة' : 'No function')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => !linking && onUnlink()}
                disabled={linking}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl transition-opacity hover:opacity-80"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  color: '#f87171',
                }}
              >
                {linking ? <Loader2 size={11} className="animate-spin" /> : <Link2Off size={11} />}
                {ar ? 'فك الربط' : 'Unlink'}
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={13} style={{ color: '#818cf8' }} />
            <span className="text-xs font-semibold" style={{ color: '#818cf8' }}>
              {ar ? 'ربط بموظف' : 'Link to Employee'}
            </span>
          </div>

          {/* Suggestions */}
          {sugLoading ? (
            <div className="flex items-center gap-2 py-3" style={{ color: '#64748b' }}>
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">{ar ? 'جاري جلب المقترحات...' : 'Loading suggestions...'}</span>
            </div>
          ) : suggestions.length > 0 && !empSearch && (
            <div className="mb-3">
              <div className="text-[10px] mb-2 uppercase tracking-wider" style={{ color: '#475569' }}>
                {ar ? 'مقترحات بناءً على الاسم' : 'Name-based suggestions'}
              </div>
              <div className="space-y-1.5">
                {suggestions.map(s => (
                  <SuggestionCard
                    key={s.id}
                    id={s.id}
                    employeeNo={s.employee_no}
                    fullName={s.full_name}
                    functionName={s.function_name}
                    score={s.score}
                    ar={ar}
                    linking={linking}
                    onLink={onLink}
                    alreadyLinked={user.employeeId === s.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Manual search */}
          <div className="relative">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 text-slate-500"
              style={{ [ar ? 'right' : 'left']: 10 }} />
            <input
              value={empSearch}
              onChange={e => setEmpSearch(e.target.value)}
              placeholder={ar ? 'أو ابحث عن موظف...' : 'Or search for an employee...'}
              className="w-full rounded-xl text-sm py-2 outline-none"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0',
                paddingInlineStart: 30,
                paddingInlineEnd: empSearch ? 30 : 10,
              }}
            />
            {empSearch && (
              <button
                className="absolute top-1/2 -translate-y-1/2"
                style={{ [ar ? 'left' : 'right']: 10, color: '#64748b' }}
                onClick={() => setEmpSearch('')}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Search results */}
          {empSearching && (
            <div className="flex items-center gap-2 pt-2" style={{ color: '#64748b' }}>
              <Loader2 size={13} className="animate-spin" />
              <span className="text-xs">{ar ? 'جاري البحث...' : 'Searching...'}</span>
            </div>
          )}
          {empResults.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {empResults.map(e => (
                <SuggestionCard
                  key={e.id}
                  id={e.id}
                  employeeNo={e.employeeNo}
                  fullName={e.fullName}
                  functionName={e.functionName}
                  score={null}
                  ar={ar}
                  linking={linking}
                  onLink={onLink}
                  alreadyLinked={user.employeeId === e.id}
                />
              ))}
            </div>
          )}
          {empSearch && !empSearching && empResults.length === 0 && (
            <div className="text-xs pt-2" style={{ color: '#64748b' }}>
              {ar ? 'لا توجد نتائج' : 'No results'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── SuggestionCard ──────────────────────────────────────────────────────── */
function SuggestionCard({
  id, employeeNo, fullName, functionName, score,
  ar, linking, onLink, alreadyLinked,
}: {
  id: string; employeeNo: string; fullName: string; functionName: string | null;
  score: number | null; ar: boolean; linking: boolean; onLink: (id: string) => void;
  alreadyLinked: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
      style={{
        background: alreadyLinked
          ? 'rgba(16,185,129,0.08)'
          : 'rgba(255,255,255,0.04)',
        border: alreadyLinked
          ? '1px solid rgba(16,185,129,0.2)'
          : '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[11px] font-bold"
          style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
        >
          {fullName[0]?.toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{fullName}</div>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: '#64748b' }}>
            <span>#{employeeNo}</span>
            {functionName && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Building2 size={9} />
                  {functionName}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {score !== null && score > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md"
            style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
            {Math.round(score * 100)}%
          </span>
        )}
        {alreadyLinked ? (
          <span className="text-[11px] flex items-center gap-1" style={{ color: '#34d399' }}>
            <CheckCircle2 size={12} /> {ar ? 'مربوط' : 'Linked'}
          </span>
        ) : (
          <button
            onClick={() => !linking && onLink(id)}
            disabled={linking}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl transition-opacity hover:opacity-80"
            style={{
              background: 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              color: '#818cf8',
            }}
          >
            {linking ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
            {ar ? 'ربط' : 'Link'}
          </button>
        )}
      </div>
    </div>
  );
}
