import { useState, useEffect, useCallback } from 'react';
import {
  Zap, Users, Search, Plus, AlertTriangle, Check, Loader2,
  ArrowRightLeft, Star, TrendingUp, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '../store/ui.store';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Skill {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  channelType: string;
  expiryMonths: number | null;
  isActive: boolean;
}

interface EmployeeSkill {
  employeeId: string;
  employeeName: string;
  function: string;
  team: string;
  skills: { skillId: string; skillCode: string; proficiency: number; expiresAt: string | null }[];
}

interface GapCandidate {
  employeeId: string;
  name: string;
  function: string;
  proficiency: number;
  expiresAt: string | null;
}

interface DispatchForm {
  employeeId: string;
  employeeName: string;
  fromFunction: string;
  toFunction: string;
  skillCode: string;
  startAt: string;
  endAt: string;
  reason: string;
}

/* ─── Channel badge ──────────────────────────────────────────────────────── */
const CHANNEL_COLORS: Record<string, string> = {
  voice:   '#818cf8', chat: '#34d399', whatsapp: '#22c55e',
  email:   '#fb923c', social: '#f472b6', general: '#64748b',
};

function ChannelBadge({ type, ar }: { type: string | null | undefined; ar: boolean }) {
  const c = CHANNEL_COLORS[(type ?? '').toLowerCase()] ?? '#64748b';
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase"
      style={{ background: `${c}15`, color: c, border: `1px solid ${c}25` }}>
      {type}
    </span>
  );
}

/* ─── Proficiency stars ──────────────────────────────────────────────────── */
function ProficiencyStars({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={9} fill={i <= value ? '#fbbf24' : 'transparent'}
          style={{ color: i <= value ? '#fbbf24' : '#334155' }} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Skills Page
═══════════════════════════════════════════════════════════════════════════ */
export default function SkillsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';

  const [tab, setTab]       = useState<'matrix' | 'gaps'>('matrix');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [matrix, setMatrix] = useState<EmployeeSkill[]>([]);
  const [gaps,   setGaps]   = useState<GapCandidate[]>([]);
  const [loading, setLoading]   = useState(false);
  const [search,  setSearch]    = useState('');
  const [fnFilter, setFnFilter] = useState('');
  const [gapFn,    setGapFn]    = useState('');
  const [gapSkill, setGapSkill] = useState('');
  const [dispatch, setDispatch] = useState<DispatchForm | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchDone, setDispatchDone] = useState(false);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

  const textPri  = dark ? '#e2e8f0' : '#0f172a';
  const textSec  = dark ? '#64748b' : '#94a3b8';
  const surface  = dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.9)';
  const border   = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const inputBg  = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  /* ── Load skills list ─────────────────────────────────────────────────── */
  useEffect(() => {
    apiClient.get('/skills').then(({ data }) => setSkills(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  /* ── Load matrix ──────────────────────────────────────────────────────── */
  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/skills/matrix');
      setMatrix(Array.isArray(data) ? data : []);
    } catch { setMatrix([]); }
    setLoading(false);
  }, []);

  /* ── Load gaps ────────────────────────────────────────────────────────── */
  const loadGaps = useCallback(async () => {
    if (!gapSkill) return;
    setLoading(true);
    try {
      const params: any = { skillCode: gapSkill };
      if (gapFn) params.functionName = gapFn;
      const { data } = await apiClient.get('/skills/gaps', { params });
      setGaps(Array.isArray(data) ? data : []);
    } catch { setGaps([]); }
    setLoading(false);
  }, [gapFn, gapSkill]);

  useEffect(() => { if (tab === 'matrix') loadMatrix(); }, [tab, loadMatrix]);
  useEffect(() => { if (tab === 'gaps' && gapSkill) loadGaps(); }, [tab, gapSkill, loadGaps]);

  /* ── Dispatch ─────────────────────────────────────────────────────────── */
  const openDispatch = (candidate: GapCandidate) => {
    const now   = new Date();
    const start = now.toTimeString().slice(0, 5);
    const end   = new Date(now.getTime() + 2 * 3600000).toTimeString().slice(0, 5);
    const today = now.toISOString().slice(0, 10);
    setDispatch({
      employeeId:   candidate.employeeId,
      employeeName: candidate.name,
      fromFunction: candidate.function,
      toFunction:   gapFn,
      skillCode:    gapSkill,
      startAt:      `${today}T${start}:00`,
      endAt:        `${today}T${end}:00`,
      reason:       '',
    });
    setDispatchDone(false);
  };

  const submitDispatch = async () => {
    if (!dispatch) return;
    setDispatching(true);
    try {
      await apiClient.post('/skills/dispatch', {
        employeeId:   dispatch.employeeId,
        fromFunction: dispatch.fromFunction,
        toFunction:   dispatch.toFunction,
        skillCode:    dispatch.skillCode,
        startAt:      dispatch.startAt,
        endAt:        dispatch.endAt,
        reason:       dispatch.reason,
      });
      setDispatchDone(true);
    } catch { /* ignore */ }
    setDispatching(false);
  };

  /* ── Filtered matrix ─────────────────────────────────────────────────── */
  const filtered = matrix.filter(e => {
    const matchSearch = !search || e.employeeName.toLowerCase().includes(search.toLowerCase());
    const matchFn     = !fnFilter || e.function === fnFilter;
    return matchSearch && matchFn;
  });

  const functions = [...new Set(matrix.map(e => e.function).filter(Boolean))].sort();

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.2)' }}>
            <Zap size={18} style={{ color: '#fb923c' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: textPri }}>
              {ar ? 'المهارات والكروس-سكيل' : 'Skills & Cross-Skill'}
            </h1>
            <p className="text-xs" style={{ color: textSec }}>
              {ar ? 'مصفوفة المهارات، الفجوات، والتوجيه' : 'Skills matrix, gap detection & dispatch'}
            </p>
          </div>
        </div>

        {/* Skill pills */}
        <div className="flex flex-wrap gap-1.5">
          {skills.slice(0, 8).map(s => (
            <div key={s.id} className="flex items-center gap-1">
              <ChannelBadge type={s.channelType} ar={ar} />
              <span className="text-[10px]" style={{ color: textSec }}>{ar ? s.nameAr : s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-5 p-1 rounded-2xl w-fit"
        style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
        {(['matrix', 'gaps'] as const).map(v => (
          <button key={v} onClick={() => setTab(v)}
            className="px-4 py-2 text-xs rounded-xl font-medium transition-all"
            style={{
              background: tab === v ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
              color: tab === v ? textPri : textSec,
            }}>
            {v === 'matrix' ? (ar ? 'مصفوفة المهارات' : 'Skills Matrix') : (ar ? 'الفجوات والتوجيه' : 'Gap Detection')}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MATRIX TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'matrix' && (
        <div>
          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute top-1/2 -translate-y-1/2 start-3 opacity-40" style={{ color: textSec }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={ar ? 'بحث عن موظف...' : 'Search employee...'}
                className="text-xs rounded-xl ps-8 pe-3 py-2 outline-none w-48"
                style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
            </div>
            <select value={fnFilter} onChange={e => setFnFilter(e.target.value)}
              className="text-xs rounded-xl px-3 py-2 outline-none"
              style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }}>
              <option value="">{ar ? 'كل الفنكشنات' : 'All Functions'}</option>
              {functions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <span className="text-xs self-center" style={{ color: textSec }}>
              {filtered.length} {ar ? 'موظف' : 'employees'}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={24} className="animate-spin" style={{ color: textSec }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl p-12 text-center" style={{ background: surface, border: `1px solid ${border}` }}>
              <Users size={32} className="mx-auto mb-3 opacity-30" style={{ color: textSec }} />
              <div className="text-sm" style={{ color: textSec }}>
                {ar ? 'لا يوجد موظفون' : 'No employees found'}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(emp => {
                const isExpanded = expandedEmp === emp.employeeId;
                return (
                  <div key={emp.employeeId} className="rounded-2xl overflow-hidden"
                    style={{ background: surface, border: `1px solid ${border}` }}>
                    {/* Row */}
                    <div className="flex items-center justify-between p-3 cursor-pointer select-none"
                      onClick={() => setExpandedEmp(isExpanded ? null : emp.employeeId)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: 'rgba(129,140,248,0.12)', color: '#818cf8' }}>
                          {emp.employeeName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate" style={{ color: textPri }}>{emp.employeeName}</div>
                          <div className="text-[10px]" style={{ color: textSec }}>{emp.function} · {emp.team}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {emp.skills.length === 0 ? (
                          <span className="text-[9px] px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                            {ar ? 'لا مهارات' : 'No skills'}
                          </span>
                        ) : (
                          <div className="flex gap-1 flex-wrap justify-end max-w-xs">
                            {emp.skills.slice(0, 5).map(s => (
                              <span key={s.skillId} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                style={{
                                  background: CHANNEL_COLORS[skills.find(sk => sk.id === s.skillId)?.channelType ?? 'general'] + '15',
                                  color: CHANNEL_COLORS[skills.find(sk => sk.id === s.skillId)?.channelType ?? 'general'],
                                }}>
                                {s.skillCode}
                              </span>
                            ))}
                            {emp.skills.length > 5 && (
                              <span className="text-[9px]" style={{ color: textSec }}>+{emp.skills.length - 5}</span>
                            )}
                          </div>
                        )}
                        {isExpanded ? <ChevronUp size={13} style={{ color: textSec }} /> : <ChevronDown size={13} style={{ color: textSec }} />}
                      </div>
                    </div>

                    {/* Expanded skills */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0">
                        <div className="pt-3" style={{ borderTop: `1px solid ${border}` }}>
                          {emp.skills.length === 0 ? (
                            <div className="text-xs py-2 text-center" style={{ color: textSec }}>
                              {ar ? 'لم تُضف أي مهارات لهذا الموظف' : 'No skills assigned'}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {emp.skills.map(s => {
                                const skillDef = skills.find(sk => sk.id === s.skillId);
                                const color    = CHANNEL_COLORS[skillDef?.channelType ?? 'general'];
                                const expired  = s.expiresAt && new Date(s.expiresAt) < new Date();
                                const nearExp  = s.expiresAt && !expired && (new Date(s.expiresAt).getTime() - Date.now()) < 30 * 86400000;
                                return (
                                  <div key={s.skillId} className="rounded-xl p-2.5"
                                    style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs font-semibold" style={{ color }}>
                                        {ar ? skillDef?.nameAr : skillDef?.name} ({s.skillCode})
                                      </span>
                                      {expired && <AlertTriangle size={10} style={{ color: '#ef4444' }} />}
                                      {nearExp  && <AlertTriangle size={10} style={{ color: '#fbbf24' }} />}
                                    </div>
                                    <ProficiencyStars value={s.proficiency ?? 3} />
                                    {s.expiresAt && (
                                      <div className="text-[9px] mt-1" style={{ color: expired ? '#ef4444' : nearExp ? '#fbbf24' : textSec }}>
                                        {ar ? 'ينتهي' : 'Expires'}: {new Date(s.expiresAt).toLocaleDateString(ar ? 'ar-KW' : 'en')}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          GAP DETECTION TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'gaps' && (
        <div>
          {/* Gap filters */}
          <div className="rounded-3xl p-5 mb-5 space-y-4"
            style={{ background: surface, border: `1px solid ${border}` }}>
            <h3 className="text-sm font-bold" style={{ color: textPri }}>
              {ar ? 'اكتشاف الفجوة' : 'Gap Detection'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: textSec }}>
                  {ar ? 'الفنكشن المحتاج للتغطية' : 'Function needing coverage'}
                </label>
                <input value={gapFn} onChange={e => setGapFn(e.target.value)}
                  placeholder={ar ? 'مثال: Customer Care' : 'e.g. Customer Care'}
                  className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                  style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: textSec }}>
                  {ar ? 'المهارة المطلوبة' : 'Required skill'}
                </label>
                <select value={gapSkill} onChange={e => setGapSkill(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                  style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }}>
                  <option value="">{ar ? '-- اختر مهارة --' : '-- Select skill --'}</option>
                  {skills.map(s => (
                    <option key={s.id} value={s.code}>{ar ? s.nameAr : s.name} ({s.code})</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={loadGaps} disabled={!gapSkill || loading}
                  className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />}
                  {ar ? 'إيجاد المرشحين' : 'Find Candidates'}
                </button>
              </div>
            </div>
          </div>

          {/* Candidates */}
          {gaps.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users size={14} style={{ color: '#fb923c' }} />
                <span className="text-sm font-semibold" style={{ color: textPri }}>
                  {gaps.length} {ar ? 'موظف مؤهل للتغطية' : 'candidates available'}
                  {gapFn && ` → ${gapFn}`}
                </span>
              </div>
              <div className="space-y-2">
                {gaps.map(c => (
                  <div key={c.employeeId} className="rounded-2xl p-4 flex items-center justify-between gap-3"
                    style={{ background: surface, border: '1px solid rgba(251,146,60,0.15)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold"
                        style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c' }}>
                        {c.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <div className="text-sm font-semibold" style={{ color: textPri }}>{c.name}</div>
                        <div className="text-[10px]" style={{ color: textSec }}>
                          {ar ? 'الفنكشن الحالي:' : 'Current function:'} {c.function}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <div className="text-[9px] mb-0.5" style={{ color: textSec }}>{ar ? 'الكفاءة' : 'Proficiency'}</div>
                        <ProficiencyStars value={c.proficiency ?? 3} />
                      </div>
                      {c.expiresAt && (
                        <div className="text-[9px]" style={{ color: textSec }}>
                          {ar ? 'ينتهي' : 'Exp.'}: {new Date(c.expiresAt).toLocaleDateString()}
                        </div>
                      )}
                      <button onClick={() => openDispatch(c)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold transition-all"
                        style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>
                        <ArrowRightLeft size={11} />
                        {ar ? 'توجيه' : 'Dispatch'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'gaps' && !loading && gaps.length === 0 && gapSkill && (
            <div className="rounded-3xl p-10 text-center" style={{ background: surface, border: `1px solid ${border}` }}>
              <AlertTriangle size={28} className="mx-auto mb-3 opacity-30" style={{ color: '#fb923c' }} />
              <div className="text-sm font-semibold mb-1" style={{ color: textPri }}>
                {ar ? 'لا يوجد موظفون مؤهلون' : 'No qualified employees found'}
              </div>
              <div className="text-xs" style={{ color: textSec }}>
                {ar ? 'لا يوجد موظفون لديهم هذه المهارة أو أن مهاراتهم منتهية' : 'No employees have this skill or their certifications have expired'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Dispatch Modal ─────────────────────────────────────────────────── */}
      {dispatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-3xl p-6 space-y-4" dir={ar ? 'rtl' : 'ltr'}
            style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${border}` }}>

            {dispatchDone ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center"
                  style={{ background: 'rgba(34,197,94,0.12)' }}>
                  <Check size={26} style={{ color: '#22c55e' }} />
                </div>
                <div className="text-base font-bold" style={{ color: textPri }}>
                  {ar ? 'تم التوجيه بنجاح!' : 'Dispatched Successfully!'}
                </div>
                <div className="text-xs" style={{ color: textSec }}>
                  {ar ? `تم إرسال إشعار لـ ${dispatch.employeeName} وفريق RTA/WFM` : `Notification sent to ${dispatch.employeeName} and RTA/WFM team`}
                </div>
                <div className="text-[10px] px-3 py-2 rounded-xl" style={{ background: 'rgba(251,146,60,0.08)', color: '#fb923c' }}>
                  {ar
                    ? `${dispatch.employeeName} → ${dispatch.toFunction || 'الفنكشن المطلوب'} من ${dispatch.startAt.slice(11,16)} إلى ${dispatch.endAt.slice(11,16)}`
                    : `${dispatch.employeeName} → ${dispatch.toFunction || 'Target Function'} from ${dispatch.startAt.slice(11,16)} to ${dispatch.endAt.slice(11,16)}`}
                </div>
                <button onClick={() => { setDispatch(null); loadGaps(); }}
                  className="w-full py-2.5 rounded-2xl text-sm font-semibold"
                  style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}>
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(251,146,60,0.1)' }}>
                      <ArrowRightLeft size={16} style={{ color: '#fb923c' }} />
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: textPri }}>
                        {ar ? 'توجيه موظف' : 'Dispatch Employee'}
                      </div>
                      <div className="text-[10px]" style={{ color: textSec }}>{dispatch.employeeName}</div>
                    </div>
                  </div>
                  <button onClick={() => setDispatch(null)}><X size={16} style={{ color: textSec }} /></button>
                </div>

                {/* From → To */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full"
                    style={{ background: 'rgba(100,116,139,0.1)', color: textSec }}>
                    {dispatch.fromFunction || (ar ? 'الفنكشن الحالي' : 'Current function')}
                  </span>
                  <ArrowRightLeft size={12} style={{ color: '#fb923c' }} />
                  <input value={dispatch.toFunction}
                    onChange={e => setDispatch(d => d && ({ ...d, toFunction: e.target.value }))}
                    placeholder={ar ? 'الفنكشن المستهدف' : 'Target function'}
                    className="flex-1 rounded-xl px-3 py-1.5 text-xs outline-none"
                    style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
                </div>

                {/* Time range */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: ar ? 'من' : 'From', key: 'startAt' },
                    { label: ar ? 'إلى' : 'To',  key: 'endAt'   },
                  ].map(({ label, key }) => (
                    <div key={key}>
                      <label className="text-[10px] mb-1 block" style={{ color: textSec }}>{label}</label>
                      <input type="datetime-local"
                        value={(dispatch as any)[key]?.slice(0, 16)}
                        onChange={e => setDispatch(d => d && ({ ...d, [key]: e.target.value + ':00' }))}
                        className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                        style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
                    </div>
                  ))}
                </div>

                {/* Reason */}
                <div>
                  <label className="text-[10px] mb-1 block" style={{ color: textSec }}>
                    {ar ? 'السبب' : 'Reason'}
                  </label>
                  <input value={dispatch.reason}
                    onChange={e => setDispatch(d => d && ({ ...d, reason: e.target.value }))}
                    placeholder={ar ? 'سبب التوجيه...' : 'Reason for dispatch...'}
                    className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                    style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
                </div>

                {/* Info note */}
                <div className="rounded-xl p-3 text-[10px]"
                  style={{ background: 'rgba(251,146,60,0.06)', color: textSec, border: '1px solid rgba(251,146,60,0.1)' }}>
                  {ar
                    ? 'سيتم إرسال إشعار للموظف وفريق RTA/WFM وسيظهر الحدث في تقويم الموظف'
                    : 'A notification will be sent to the employee and RTA/WFM team. The event will appear in the employee calendar.'}
                </div>

                <button onClick={submitDispatch} disabled={dispatching}
                  className="w-full py-2.5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #fb923c, #f97316)', color: '#fff' }}>
                  {dispatching ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                  {ar ? 'تأكيد التوجيه وإرسال الإشعار' : 'Confirm Dispatch & Notify'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
