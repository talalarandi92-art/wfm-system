import { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap, RefreshCw, Loader2, Check, X, AlertTriangle, Clock, Fingerprint, CalendarPlus, Award, Search,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { useFilterStore } from '@/store/filter.store';
import { FunctionFilter } from '@/components/FunctionFilter';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { kwDateOffset } from '@/utils/format';

interface Flag {
  id: string; triggerType: string; occurrences: number; detail: string;
  severity: 'low' | 'medium' | 'high'; status: string; detectedAt: string; periodDays: number;
  employeeNo: string; employeeName: string; function: string | null;
}

const TRIGGER_META: Record<string, { ar: string; en: string; icon: any }> = {
  repeated_late:      { ar: 'تأخّر متكرر',         en: 'Repeated late',      icon: Clock },
  repeated_early_out: { ar: 'خروج مبكر متكرر',     en: 'Repeated early-out', icon: AlertTriangle },
  missing_punch:      { ar: 'بصمات ناقصة متكررة',  en: 'Missing punches',    icon: Fingerprint },
  low_scorecard:      { ar: 'أداء تحت الهدف',      en: 'Below-target score', icon: Award },
};
const SEV: Record<string, { ar: string; en: string; color: string }> = {
  high:   { ar: 'عالية',   en: 'High',   color: '#ef4444' },
  medium: { ar: 'متوسطة',  en: 'Medium', color: '#f59e0b' },
  low:    { ar: 'منخفضة',  en: 'Low',    color: '#06b6d4' },
};

export default function CoachingPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [flags, setFlags] = useState<Flag[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [view, setView]   = useState<'flags' | 'sessions'>('flags');
  const [loading, setL]   = useState(true);
  const [scanning, setSc] = useState(false);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [q, setQ] = useState('');
  const [trig, setTrig] = useState('all');
  const functionName = useFilterStore(s => s.functionName);  // shared global function filter

  const load = useCallback(async () => {
    setL(true);
    try {
      const [f, s] = await Promise.all([
        apiClient.get<Flag[]>('/coaching/flags', { params: { status } }),
        apiClient.get<any[]>('/coaching/sessions'),
      ]);
      setFlags(Array.isArray(f.data) ? f.data : []);
      setSessions(Array.isArray(s.data) ? s.data : []);
    } catch { setFlags([]); setSessions([]); }
    setL(false);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const scan = async () => { setSc(true); try { await apiClient.post('/coaching/scan'); await load(); } catch {} setSc(false); };
  const address = async (id: string) => { try { await apiClient.post(`/coaching/flags/${id}/address`); await load(); } catch {} };
  const dismiss = async (id: string) => { try { await apiClient.post(`/coaching/flags/${id}/dismiss`); await load(); } catch {} };
  const schedule = async (id: string) => {
    const def = `${kwDateOffset(1)} 10:00`;   // tomorrow in Kuwait, not in UTC
    const when = window.prompt(ar ? 'موعد الجلسة (YYYY-MM-DD HH:MM)' : 'Session time (YYYY-MM-DD HH:MM)', def);
    if (!when) return;
    try { await apiClient.post(`/coaching/flags/${id}/schedule-session`, { scheduledAt: when.replace(' ', 'T') }); await load(); } catch {}
  };

  const counts = {
    high:   flags.filter(f => f.severity === 'high'   && f.status === 'open').length,
    medium: flags.filter(f => f.severity === 'medium' && f.status === 'open').length,
    low:    flags.filter(f => f.severity === 'low'    && f.status === 'open').length,
  };

  // Client-side filter: trigger type + free-text (name / no / function).
  const trigTypes = Array.from(new Set(flags.map(f => f.triggerType)));
  const shownFlags = flags.filter(f =>
    (trig === 'all' || f.triggerType === trig) &&
    (!functionName || f.function === functionName) &&
    (!q || `${f.employeeName} ${f.employeeNo} ${f.function ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  /* theme-aware neutral tokens — dark keeps the original explicit values; light mirrors them.
     Semantic (purple/severity) + mid-gray muted text (#475569/#64748b/#94a3b8) stay as-is. */
  const T = {
    cardBg:  dark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
    fieldBg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    panelBg: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
    bdr:     dark ? 'rgba(255,255,255,0.1)'  : 'rgba(15,23,42,0.12)',
    bdrSoft: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
    bdrRow:  dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.06)',
    headBg:  dark ? 'rgba(0,0,0,0.25)'       : 'rgba(15,23,42,0.05)',
    text:    tp(dark),
    text2:   dark ? '#cbd5e1' : '#334155',
  };

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.22)' }}>
            <GraduationCap size={18} style={{ color: '#a855f7' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'الكوتشينج' : 'Coaching'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>
              {ar ? 'كشف تلقائي للمشاكل المتكررة بالحضور (آخر 30 يوم)' : 'Auto-detected repeated attendance issues (last 30 days)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FunctionFilter />
          <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${T.bdr}` }}>
            {(['flags', 'sessions'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-xs font-medium"
                style={{ background: view === v ? 'rgba(168,85,247,0.18)' : 'transparent', color: view === v ? '#a855f7' : '#64748b' }}>
                {v === 'flags' ? (ar ? `الحالات (${flags.filter(f => f.status === 'open').length})` : `Flags (${flags.filter(f => f.status === 'open').length})`) : (ar ? `الجلسات (${sessions.length})` : `Sessions (${sessions.length})`)}
              </button>
            ))}
          </div>
          {view === 'flags' && (
            <>
              <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${T.bdr}` }}>
                {(['open', 'all'] as const).map(s => (
                  <button key={s} onClick={() => setStatus(s)} className="px-3 py-1.5 text-xs font-medium"
                    style={{ background: status === s ? 'rgba(168,85,247,0.18)' : 'transparent', color: status === s ? '#a855f7' : '#64748b' }}>
                    {s === 'open' ? (ar ? 'مفتوحة' : 'Open') : (ar ? 'الكل' : 'All')}
                  </button>
                ))}
              </div>
              <button onClick={scan} disabled={scanning}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-60 hover:opacity-80"
                style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
                {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {ar ? 'فحص الآن' : 'Scan now'}
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : view === 'sessions' ? (
        /* ── Scheduled 1:1 sessions ── */
        sessions.length === 0 ? (
          <div className="text-center py-20" style={{ color: '#475569' }}>
            <CalendarPlus size={32} className="mx-auto mb-3" style={{ color: '#334155' }} />
            <p className="text-sm">{ar ? 'لا توجد جلسات كوتشينج' : 'No coaching sessions yet'}</p>
          </div>
        ) : (
          <div className="rounded-2xl overflow-x-auto" style={{ background: T.cardBg, border: `1px solid ${T.bdrSoft}` }}>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: T.headBg, borderBottom: `1px solid ${T.bdrSoft}` }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'الموعد' : 'When', ar ? 'المدة' : 'Duration', ar ? 'التركيز' : 'Focus', ar ? 'المدرّب' : 'Coach', ar ? 'الحالة' : 'Status'].map((h, i) => (
                    <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-4 py-2.5" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${T.bdrRow}` }}>
                    <td className="px-4 py-2.5">
                      <div className="text-xs font-medium" style={{ color: T.text }}>{s.employeeName}</div>
                      <div className="text-[10px]" style={{ color: '#475569' }}>#{s.employeeNo}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums" style={{ color: '#94a3b8' }}>{s.scheduledAt ? new Date(s.scheduledAt).toLocaleString(ar ? 'ar-KW' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: '#64748b' }}>{s.durationMinutes}m</td>
                    <td className="px-4 py-2.5 text-[11px]" style={{ color: T.text2 }}>{(s.focusAreas ?? []).map((fa: string) => (ar ? TRIGGER_META[fa]?.ar : TRIGGER_META[fa]?.en) ?? fa).join(', ')}</td>
                    <td className="px-4 py-2.5 text-[11px]" style={{ color: '#64748b' }}>{s.coach ?? '—'}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* ── Coaching flags ── */
        <>
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            {(['high', 'medium', 'low'] as const).map(s => (
              <span key={s} className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: `${SEV[s].color}1a`, color: SEV[s].color }}>
                {ar ? SEV[s].ar : SEV[s].en}: {counts[s]}
              </span>
            ))}
          </div>
          {/* Filters: search + trigger type */}
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <div className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5" style={{ background: T.fieldBg, border: `1px solid ${T.bdrSoft}` }}>
              <Search size={13} style={{ color: '#475569' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث: اسم / رقم / قسم' : 'Search: name / no / function'}
                className="text-xs outline-none bg-transparent" style={{ color: T.text, minWidth: 150 }} />
            </div>
            <button onClick={() => setTrig('all')} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: trig === 'all' ? 'rgba(168,85,247,0.18)' : T.panelBg, color: trig === 'all' ? '#c4b5fd' : '#64748b', border: `1px solid ${trig === 'all' ? 'rgba(168,85,247,0.3)' : 'transparent'}` }}>
              {ar ? 'كل الأنواع' : 'All types'} {flags.length}
            </button>
            {trigTypes.map(t => {
              const tm = TRIGGER_META[t] ?? { ar: t, en: t };
              const n = flags.filter(f => f.triggerType === t).length;
              return (
                <button key={t} onClick={() => setTrig(t)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                  style={{ background: trig === t ? 'rgba(168,85,247,0.18)' : T.panelBg, color: trig === t ? '#c4b5fd' : '#64748b', border: `1px solid ${trig === t ? 'rgba(168,85,247,0.3)' : 'transparent'}` }}>
                  {ar ? tm.ar : tm.en} {n}
                </button>
              );
            })}
          </div>
          {shownFlags.length === 0 ? (
            <div className="text-center py-20" style={{ color: '#475569' }}>
              <GraduationCap size={32} className="mx-auto mb-3" style={{ color: '#334155' }} />
              <p className="text-sm">{ar ? 'لا توجد حالات كوتشينج' : 'No coaching flags'}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shownFlags.map(f => {
                const tm = TRIGGER_META[f.triggerType] ?? { ar: f.triggerType, en: f.triggerType, icon: AlertTriangle };
                const sv = SEV[f.severity] ?? SEV.low;
                const Icon = tm.icon;
                return (
                  <div key={f.id} style={{ background: T.cardBg, border: `1px solid ${sv.color}33`, borderRadius: 16, padding: 16, borderInlineStart: `3px solid ${sv.color}` }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate" style={{ color: tp(dark) }}>{f.employeeName}</div>
                        <div className="text-[10px]" style={{ color: '#475569' }}>#{f.employeeNo}{f.function ? ` · ${f.function}` : ''}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold" style={{ background: `${sv.color}22`, color: sv.color }}>
                        {ar ? sv.ar : sv.en}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon size={13} style={{ color: sv.color }} />
                      <span className="text-xs font-semibold" style={{ color: T.text2 }}>{ar ? tm.ar : tm.en}</span>
                    </div>
                    <div className="text-[11px] mb-3" style={{ color: '#94a3b8' }}>
                      <span className="font-bold" style={{ color: sv.color }}>{f.occurrences}</span> {ar ? `مرة خلال ${f.periodDays} يوم` : `times in ${f.periodDays} days`}
                    </div>
                    {f.status === 'open' ? (
                      <div className="flex items-center gap-2 pt-2 flex-wrap" style={{ borderTop: `1px solid ${T.bdrSoft}` }}>
                        <button onClick={() => schedule(f.id)} className="flex items-center gap-1 text-[11px] hover:opacity-80" style={{ color: '#a855f7' }}><CalendarPlus size={12} /> {ar ? 'جدولة 1:1' : 'Schedule 1:1'}</button>
                        <button onClick={() => address(f.id)} className="flex items-center gap-1 text-[11px] hover:opacity-80" style={{ color: '#22c55e' }}><Check size={12} /> {ar ? 'تمّت' : 'Done'}</button>
                        <button onClick={() => dismiss(f.id)} className="flex items-center gap-1 text-[11px] hover:opacity-80 ms-auto" style={{ color: '#64748b' }}><X size={12} /> {ar ? 'تجاهل' : 'Dismiss'}</button>
                      </div>
                    ) : (
                      <div className="text-[10px] pt-2" style={{ borderTop: `1px solid ${T.bdrSoft}`, color: '#475569' }}>
                        {f.status === 'addressed' ? (ar ? '✓ تمّت المعالجة' : '✓ Addressed') : (ar ? 'تم التجاهل' : 'Dismissed')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
