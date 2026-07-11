/**
 * B4 — BREAK COMMAND CENTER (SMART_DYNAMIC_BREAK spec §16 + §22 explainability).
 * Supervisor/RTA real-time view over the live release engine:
 *  - per-function risk chips (click = filter) + release-mode selector + FREEZE
 *  - engine heartbeat (last tick + live-data staleness banner)
 *  - <Kpi> provenance row (on-break / waiting / delayed / overdue / released / slots)
 *  - waiting line with the AR/EN priority-score breakdown (§22), risk, ETA,
 *    Release action (reason mandatory at risk ≥ orange — enforced server-side too)
 *  - on-break-now table with due-back countdown, overdue highlighted
 *  - per-function coverage mini-panel (required vs working vs on-break)
 * Data: GET /breaks/engine/status + GET /breaks/live-queue — polled every 30s.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Coffee, Users, Clock, AlertTriangle, ShieldAlert, Timer,
  Loader2, Radio, Snowflake, ChevronDown, ChevronUp, Send,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { card as cardStyle, tp, ts } from '@/components/ds';
import { Kpi, KpiRow } from '@/components/kpi';

/* ── Payload types ────────────────────────────────────────────────────────── */
interface ScoreLine { points: number; reason: string; reasonAr: string }
interface WaitingRow {
  slotId: string; employeeId: string; employeeNo: string; employeeName: string;
  teamManager: string | null; status: string;
  plannedStart: string; plannedEnd: string; latestStart: string | null;
  delayMin: number; delayReason: string | null;
  score: number; breakdown: ScoreLine[];
  employeesAhead: number; eta: string | null; decision: string;
}
interface OnBreakRow { slotId: string; employeeName: string; status: string; expectedEnd: string }
interface FnQueue {
  function: string; mode: string; risk: string; riskReasons: string[];
  requiredNow: number; scheduledNow: number; onBreakNow: number;
  maxSimultaneous: number; availableSlots: number;
  waiting: WaitingRow[]; onBreak: OnBreakRow[];
}
interface LiveQueue {
  date: string; asOf: string;
  liveData: { capturedAt: string | null; staleSec: number | null; fresh: boolean } | null;
  functions: FnQueue[];
}
interface EngineStatus {
  intervalMs: number; running: boolean;
  lastTick: { at: string; date: string; released: number; transitions: number } | null;
  liveData: { capturedAt: string | null; staleSec: number | null; fresh: boolean; stale5min: boolean; stale15min: boolean };
  modes: { policyId: string; function: string; shiftType: string | null; mode: string }[];
}

/* Risk scale (§23) — semantic color + ALWAYS a text label (never color alone). */
const RISK: Record<string, { color: string; en: string; ar: string }> = {
  green:    { color: '#22c55e', en: 'Green — safe',            ar: 'أخضر — آمن' },
  yellow:   { color: '#eab308', en: 'Yellow — caution',        ar: 'أصفر — حذر' },
  orange:   { color: '#f97316', en: 'Orange — confirm',        ar: 'برتقالي — تأكيد مشرف' },
  red:      { color: '#ef4444', en: 'Red — do not release',    ar: 'أحمر — لا إطلاق' },
  critical: { color: '#dc2626', en: 'CRITICAL — freeze',       ar: 'حرج — تجميد' },
};
const RISK_RANK: Record<string, number> = { green: 0, yellow: 1, orange: 2, red: 3, critical: 4 };

const MODES: { value: string; en: string; ar: string }[] = [
  { value: 'auto',       en: 'Auto',        ar: 'تلقائي' },
  { value: 'supervisor', en: 'Supervisor',  ar: 'مشرف' },
  { value: 'hybrid',     en: 'Hybrid',      ar: 'هجين' },
];

const WAIT_STATUS: Record<string, { en: string; ar: string; color: string }> = {
  eligible:         { en: 'Eligible', ar: 'مؤهل',        color: '#2dd4bf' },
  waiting_capacity: { en: 'Waiting',  ar: 'ينتظر سعة',   color: '#fbbf24' },
  delayed:          { en: 'Delayed',  ar: 'مؤجل',        color: '#fb923c' },
  scheduled:        { en: 'Planned',  ar: 'مخطط',        color: '#60a5fa' },
};
const ONBREAK_STATUS: Record<string, { en: string; ar: string; color: string }> = {
  released: { en: 'Released — not started', ar: 'مُطلق — لم يبدأ', color: '#818cf8' },
  active:   { en: 'On break',               ar: 'في بريك',          color: '#4ade80' },
  overdue:  { en: 'OVERDUE',                ar: 'متجاوز',           color: '#f87171' },
};

const fmtClock = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' })
  : '—';
const fmtAge = (sec: number | null, ar: boolean) => sec == null ? '—'
  : sec < 60 ? `${sec}${ar ? 'ث' : 's'}`
  : sec < 3600 ? `${Math.floor(sec / 60)}${ar ? 'د' : 'm'}`
  : `${Math.floor(sec / 3600)}${ar ? 'س' : 'h'} ${Math.floor((sec % 3600) / 60)}${ar ? 'د' : 'm'}`;

export default function BreakCommandCenter({ date }: { date: string }) {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  const [queue, setQueue]   = useState<LiveQueue | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [fnFilter, setFnFilter] = useState('');
  const [openScore, setOpenScore] = useState<string | null>(null);   // slotId → §22 breakdown open
  const [releaseFor, setReleaseFor] = useState<{ slot: WaitingRow; fn: FnQueue } | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [freezeFor, setFreezeFor] = useState<{ function: string; current: string } | null>(null);
  const [freezeReason, setFreezeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setTickNow] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [q, e] = await Promise.all([
        apiClient.get(`/breaks/live-queue?date=${date}`),
        apiClient.get('/breaks/engine/status'),
      ]);
      setQueue(q.data); setEngine(e.data); setError('');
    } catch {
      setError(ar ? 'تعذّر تحميل بيانات المحرك' : 'Failed to load engine data');
    } finally { setLoading(false); }
  }, [date, ar]);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(true), 30_000);   // §16 — 30s live poll
    const clock = setInterval(() => setTickNow(t => t + 1), 15_000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const setMode = async (fn: string, mode: string, reason?: string) => {
    setBusy(true);
    try {
      await apiClient.post('/breaks/engine/mode', {
        mode, function: fn === '(default)' ? undefined : fn, ...(reason ? { reason } : {}),
      });
      await load(true);
    } catch (e: any) {
      alert(e?.response?.data?.message ?? (ar ? 'تعذّر تغيير الوضع' : 'Failed to change mode'));
    } finally { setBusy(false); setFreezeFor(null); setFreezeReason(''); }
  };

  const doRelease = async () => {
    if (!releaseFor) return;
    const needReason = RISK_RANK[releaseFor.fn.risk] >= 2;
    if (needReason && !releaseReason.trim()) return;
    setBusy(true);
    try {
      await apiClient.post(`/breaks/slots/${releaseFor.slot.slotId}/release`, { reason: releaseReason.trim() || undefined });
      setReleaseFor(null); setReleaseReason('');
      await load(true);
    } catch (e: any) {
      alert(e?.response?.data?.message ?? (ar ? 'تعذّر الإطلاق' : 'Release failed'));
    } finally { setBusy(false); }
  };

  const divider  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const rowHover = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const panelBg  = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  if (loading && !queue) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
      <Loader2 size={28} style={{ color: '#818cf8', animation: 'ds-spin 1s linear infinite' }} />
    </div>;
  }
  if (error && !queue) {
    return <div style={{ ...cardStyle(dark), padding: 32, textAlign: 'center', color: '#f87171', fontSize: 13 }}>
      <AlertTriangle size={20} style={{ display: 'block', margin: '0 auto 8px' }} /> {error}
    </div>;
  }

  const fns = queue?.functions ?? [];
  const visible = fnFilter ? fns.filter(f => f.function === fnFilter) : fns;
  const allWaiting = visible.flatMap(f => f.waiting.map(w => ({ ...w, fn: f })));
  const allOnBreak = visible.flatMap(f => f.onBreak.map(b => ({ ...b, fn: f })));
  const sum = (pick: (f: FnQueue) => number) => fns.reduce((s, f) => s + pick(f), 0);
  const delayedCount = fns.reduce((s, f) => s + f.waiting.filter(w => w.status === 'delayed').length, 0);
  const overdueCount = fns.reduce((s, f) => s + f.onBreak.filter(b => b.status === 'overdue').length, 0);
  const releasedCount = fns.reduce((s, f) => s + f.onBreak.filter(b => b.status === 'released').length, 0);

  const lastTickAge = engine?.lastTick ? Math.round((Date.now() - new Date(engine.lastTick.at).getTime()) / 1000) : null;
  const stale = engine?.liveData?.stale15min ? 15 : engine?.liveData?.stale5min ? 5 : 0;
  const src = (def: string, defAr: string) => ({
    endpoint: 'GET /api/v1/breaks/live-queue', table: 'break_slots',
    definition: def, definitionAr: defAr, period: queue?.date,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} dir={ar ? 'rtl' : 'ltr'}>

      {/* ── a. Engine strip: heartbeat + staleness ─────────────────────────── */}
      <div style={{ ...cardStyle(dark), padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: engine?.running ? '#22c55e' : '#f87171' }}>
          <Radio size={13} style={{ animation: engine?.running ? 'ds-pulse 2s ease infinite' : 'none' }} />
          {engine?.running ? (ar ? 'المحرك يعمل' : 'Engine running') : (ar ? 'المحرك متوقف' : 'Engine stopped')}
        </span>
        <span style={{ fontSize: 11, color: ts(dark) }}>
          {ar ? 'آخر دورة' : 'Last tick'}: <b style={{ color: tp(dark) }}>{engine?.lastTick ? fmtClock(engine.lastTick.at) : '—'}</b>
          {lastTickAge != null && <span> ({fmtAge(lastTickAge, ar)} {ar ? 'مضت' : 'ago'})</span>}
        </span>
        <span style={{ fontSize: 11, color: ts(dark) }}>
          {ar ? 'بيانات الطوابير الحية' : 'Live queue data'}: <b style={{ color: engine?.liveData?.fresh ? '#22c55e' : '#f97316' }}>
            {engine?.liveData?.capturedAt ? `${fmtAge(engine.liveData.staleSec, ar)} ${ar ? 'قِدم' : 'old'}` : (ar ? 'لا بيانات' : 'none')}
          </b>
        </span>
        <span style={{ fontSize: 10.5, color: ts(dark), marginInlineStart: 'auto' }}>
          {ar ? 'كما في' : 'As of'} {fmtClock(queue?.asOf ?? null)} · {queue?.date}
        </span>
      </div>

      {stale > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600,
          background: stale === 15 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${stale === 15 ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
          color: stale === 15 ? '#f87171' : '#fbbf24' }}>
          <AlertTriangle size={14} />
          {stale === 15
            ? (ar ? 'بيانات سبرينكلر قديمة (>15 دقيقة) — المحرك يعمل بوضع الأمان: كل الإطلاقات تتطلب تأكيد مشرف' : 'Sprinklr live data is stale (>15 min) — engine is in fail-safe: all releases need supervisor confirmation')
            : (ar ? 'بيانات سبرينكلر متأخرة (>5 دقائق) — المخاطر مرفوعة احترازياً' : 'Sprinklr live data delayed (>5 min) — risk floors raised as a precaution')}
        </div>
      )}

      {/* ── a. Risk chips (click = filter) + mode selectors ───────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {fns.map(f => {
          const r = RISK[f.risk] ?? RISK.orange;
          const active = fnFilter === f.function;
          return (
            <button key={f.function}
              onClick={() => setFnFilter(active ? '' : f.function)}
              title={f.riskReasons.join('\n')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: active ? `${r.color}28` : `${r.color}12`,
                border: `1.5px solid ${active ? r.color : r.color + '45'}`,
                color: r.color,
              }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, animation: f.risk === 'critical' ? 'ds-pulse 1s ease infinite' : 'none' }} />
              {f.function}
              <span style={{ fontWeight: 600, opacity: 0.9 }}>· {ar ? r.ar : r.en}</span>
              {f.waiting.length > 0 && <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 10, background: `${r.color}22` }}>{f.waiting.length}</span>}
            </button>
          );
        })}
        {fnFilter && (
          <button onClick={() => setFnFilter('')} style={{ fontSize: 10.5, color: ts(dark), background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            {ar ? 'إظهار الكل' : 'Show all'}
          </button>
        )}
      </div>

      {/* mode per policy row + FREEZE emergency toggle */}
      <div style={{ ...cardStyle(dark), padding: '10px 16px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: ts(dark) }}>
          {ar ? 'وضع الإطلاق' : 'Release mode'}
        </span>
        {(engine?.modes ?? []).map(m => (
          <div key={m.policyId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: tp(dark), fontWeight: 600 }}>
              {m.function === '(default)' ? (ar ? 'افتراضي' : 'Default') : m.function}
            </span>
            {m.mode === 'freeze' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8' }}>
                <Snowflake size={12} /> {ar ? 'تجميد طارئ' : 'EMERGENCY FREEZE'}
                <button disabled={busy} onClick={() => setMode(m.function, 'hybrid')}
                  style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#38bdf8', color: '#0a0f1e' }}>
                  {ar ? 'إلغاء التجميد' : 'Unfreeze'}
                </button>
              </span>
            ) : (
              <>
                <select value={m.mode} disabled={busy}
                  onChange={e => setMode(m.function, e.target.value)}
                  style={{ fontSize: 11, padding: '5px 8px', borderRadius: 8, background: panelBg, border: `1px solid ${divider}`, color: tp(dark), cursor: 'pointer', outline: 'none' }}>
                  {MODES.map(o => <option key={o.value} value={o.value}>{ar ? o.ar : o.en}</option>)}
                </select>
                <button disabled={busy} onClick={() => setFreezeFor({ function: m.function, current: m.mode })}
                  title={ar ? 'تجميد طارئ — لا إطلاق بريكات جديدة' : 'Emergency freeze — no new break releases'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
                  <Snowflake size={11} /> {ar ? 'تجميد' : 'FREEZE'}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── b. KPI row (provenance kit) ───────────────────────────────────── */}
      <KpiRow cols={6}>
        <Kpi label={ar ? 'في بريك الآن' : 'On break now'} value={sum(f => f.onBreakNow)} accent="#4ade80"
          icon={<Coffee size={14} />} source={src('Slots in released/active/overdue status right now (engine snapshot)', 'الفتحات بحالة مُطلق/نشط/متجاوز الآن (لقطة المحرك)')} />
        <Kpi label={ar ? 'طابور الانتظار' : 'Waiting line'} value={sum(f => f.waiting.length)} accent="#fbbf24"
          icon={<Users size={14} />} source={src('Eligible + waiting-capacity + delayed slots ordered by priority score', 'الفتحات المؤهلة + بانتظار السعة + المؤجلة مرتبة بنقاط الأولوية')} />
        <Kpi label={ar ? 'مؤجل' : 'Delayed'} value={delayedCount} accent="#fb923c"
          icon={<Timer size={14} />} source={src('Waiting slots past their latest safe start (status=delayed)', 'فتحات تجاوزت آخر وقت آمن للبدء (حالة مؤجل)')} />
        <Kpi label={ar ? 'متجاوز العودة' : 'Overdue'} value={overdueCount} accent="#f87171"
          icon={<AlertTriangle size={14} />} source={src('Active breaks past planned end + 5 min grace (status=overdue)', 'بريكات نشطة تجاوزت النهاية المخططة + 5 دقائق سماح')} />
        <Kpi label={ar ? 'مُطلق لم يبدأ' : 'Released, not started'} value={releasedCount} accent="#818cf8"
          icon={<Send size={14} />} source={src('Slots released by the engine/supervisor where the agent has not pressed Start yet', 'فتحات أطلقها المحرك/المشرف ولم يضغط الموظف ابدأ بعد')} />
        <Kpi label={ar ? 'سعة متاحة' : 'Available slots'} value={sum(f => f.availableSlots)} accent="#2dd4bf"
          icon={<Activity size={14} />} source={src('Max safe simultaneous breaks minus on-break now, summed over functions', 'أقصى بريكات متزامنة آمنة ناقص من هم في بريك الآن، مجموع الوظائف')} />
      </KpiRow>

      {/* ── e. Coverage mini-panel per function ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {visible.map(f => {
          const r = RISK[f.risk] ?? RISK.orange;
          const working = f.scheduledNow - f.onBreakNow;
          return (
            <div key={f.function} style={{ ...cardStyle(dark), padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: tp(dark) }}>{f.function}</span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: `${r.color}18`, color: r.color }}>{ar ? r.ar.split(' — ')[0] : r.en.split(' — ')[0]}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center' }}>
                {[
                  { l: ar ? 'مطلوب' : 'Req',      v: f.requiredNow,  c: '#818cf8' },
                  { l: ar ? 'يعمل' : 'Working',   v: working,        c: working >= f.requiredNow ? '#22c55e' : '#f87171' },
                  { l: ar ? 'في بريك' : 'Break',  v: f.onBreakNow,   c: '#f59e0b' },
                ].map(x => (
                  <div key={x.l} style={{ padding: '5px 0', borderRadius: 8, background: panelBg }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: x.c, fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
                    <div style={{ fontSize: 8.5, color: ts(dark) }}>{x.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9.5, color: ts(dark), marginTop: 6 }}>
                {ar ? `سقف البريكات المتزامنة ${f.maxSimultaneous} · متاح ${f.availableSlots}` : `Cap ${f.maxSimultaneous} simultaneous · ${f.availableSlots} free`} · {ar ? 'وضع' : 'mode'} {f.mode}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── c. Waiting line ───────────────────────────────────────────────── */}
      <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={14} style={{ color: '#fbbf24' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: tp(dark) }}>
            {ar ? 'طابور الانتظار العادل' : 'Fair Waiting Line'} ({allWaiting.length})
          </span>
          <span style={{ fontSize: 10, color: ts(dark) }}>{ar ? 'اضغط على النقاط لشرح الأولوية' : 'click the score for the priority explanation'}</span>
        </div>
        {allWaiting.length === 0 ? (
          <p style={{ padding: 28, textAlign: 'center', fontSize: 12, color: ts(dark) }}>{ar ? 'لا أحد في الانتظار الآن' : 'No one is waiting right now'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ background: panelBg }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'الوظيفة' : 'Function', ar ? 'الفريق' : 'Team',
                    ar ? 'المخطط' : 'Planned', ar ? 'انتظر' : 'Waited', ar ? 'النقاط' : 'Score',
                    ar ? 'الخطورة' : 'Risk', ar ? 'الحالة' : 'Status', 'ETA', ar ? 'إجراء' : 'Action'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'start', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: ts(dark), borderBottom: `1px solid ${divider}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allWaiting.map(w => {
                  const r = RISK[w.fn.risk] ?? RISK.orange;
                  const st = WAIT_STATUS[w.status] ?? { en: w.status, ar: w.status, color: '#94a3b8' };
                  const open = openScore === w.slotId;
                  return (
                    <FragmentRow key={w.slotId}>
                      <tr style={{ borderBottom: open ? 'none' : `1px solid ${divider}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: tp(dark), whiteSpace: 'nowrap' }}>{w.employeeName}</div>
                          <div style={{ fontSize: 9.5, color: ts(dark) }}>{w.employeeNo}</div>
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: ts(dark), whiteSpace: 'nowrap' }}>{w.fn.function}</td>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: ts(dark), whiteSpace: 'nowrap' }}>{w.teamManager ?? '—'}</td>
                        <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: tp(dark), whiteSpace: 'nowrap', direction: 'ltr' }}>{w.plannedStart}–{w.plannedEnd}</td>
                        <td style={{ padding: '9px 12px', fontSize: 11.5, fontWeight: 700, color: w.delayMin > 30 ? '#f87171' : w.delayMin > 0 ? '#fb923c' : ts(dark), whiteSpace: 'nowrap' }}
                          title={w.delayReason ?? undefined}>
                          {w.delayMin > 0 ? `${w.delayMin}${ar ? 'د' : 'm'}` : '—'}
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <button onClick={() => setOpenScore(open ? null : w.slotId)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 8, cursor: 'pointer', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}>
                            {w.score}
                            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${r.color}15`, color: r.color }}>{ar ? r.ar.split(' — ')[0] : w.fn.risk}</span>
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${st.color}15`, color: st.color }}>{ar ? st.ar : st.en}</span>
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: tp(dark), whiteSpace: 'nowrap' }}>{fmtClock(w.eta)}</td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <button onClick={() => { setReleaseFor({ slot: w, fn: w.fn }); setReleaseReason(''); }}
                            style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', color: '#fff', background: RISK_RANK[w.fn.risk] >= 2 ? '#d97706' : '#16a34a' }}>
                            {ar ? 'إطلاق' : 'Release'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: `1px solid ${divider}` }}>
                          <td colSpan={10} style={{ padding: '4px 16px 12px' }}>
                            <div style={{ borderRadius: 10, padding: '10px 14px', background: panelBg, border: `1px solid ${divider}` }}>
                              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: ts(dark), marginBottom: 6 }}>
                                {ar ? `شرح نقاط الأولوية (${w.score})` : `Priority score explanation (${w.score})`}
                              </div>
                              {w.breakdown.map((b, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '2px 0' }}>
                                  <span style={{ fontWeight: 800, color: b.points >= 0 ? '#4ade80' : '#f87171', minWidth: 36, fontVariantNumeric: 'tabular-nums', direction: 'ltr', textAlign: 'end' }}>
                                    {b.points >= 0 ? '+' : ''}{b.points}
                                  </span>
                                  <span style={{ color: tp(dark) }}>{ar ? b.reasonAr : b.reason}</span>
                                </div>
                              ))}
                              {w.delayReason && (
                                <div style={{ fontSize: 10.5, color: '#fb923c', marginTop: 6 }}>
                                  {ar ? 'سبب التأجيل' : 'Delay reason'}: {w.delayReason}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── d. On break now ───────────────────────────────────────────────── */}
      <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Coffee size={14} style={{ color: '#4ade80' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: tp(dark) }}>{ar ? 'في بريك الآن' : 'On Break Now'} ({allOnBreak.length})</span>
        </div>
        {allOnBreak.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', fontSize: 12, color: ts(dark) }}>{ar ? 'لا أحد في بريك الآن' : 'No one is on break right now'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ background: panelBg }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'الوظيفة' : 'Function', ar ? 'الحالة' : 'Status', ar ? 'العودة المتوقعة' : 'Due back', ar ? 'المتبقي' : 'Remaining'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'start', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: ts(dark), borderBottom: `1px solid ${divider}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allOnBreak.map(b => {
                  const st = ONBREAK_STATUS[b.status] ?? { en: b.status, ar: b.status, color: '#94a3b8' };
                  const leftMin = Math.round((new Date(b.expectedEnd).getTime() - Date.now()) / 60_000);
                  const over = b.status === 'overdue' || leftMin < 0;
                  return (
                    <tr key={b.slotId} style={{ borderBottom: `1px solid ${divider}`, background: over ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                      <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 600, color: tp(dark), whiteSpace: 'nowrap' }}>{b.employeeName}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: ts(dark), whiteSpace: 'nowrap' }}>{b.fn.function}</td>
                      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${st.color}15`, color: st.color }}>{ar ? st.ar : st.en}</span>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: tp(dark), whiteSpace: 'nowrap' }}>{fmtClock(b.expectedEnd)}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', color: over ? '#f87171' : leftMin <= 5 ? '#fbbf24' : '#4ade80' }}>
                        {over
                          ? (ar ? `متجاوز ${Math.abs(leftMin)}د` : `${Math.abs(leftMin)}m overdue`)
                          : (ar ? `${leftMin}د` : `${leftMin}m`)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Release dialog (reason mandatory at risk ≥ orange) ────────────── */}
      {releaseFor && (() => {
        const r = RISK[releaseFor.fn.risk] ?? RISK.orange;
        const needReason = RISK_RANK[releaseFor.fn.risk] >= 2;
        return (
          <Modal onClose={() => setReleaseFor(null)} dark={dark}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: tp(dark), display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Send size={15} style={{ color: '#22c55e' }} /> {ar ? 'إطلاق بريك يدوي' : 'Manual Break Release'}
            </h3>
            <p style={{ fontSize: 12, color: tp(dark), marginBottom: 4 }}>
              {releaseFor.slot.employeeName} · {releaseFor.fn.function} · {releaseFor.slot.plannedStart}–{releaseFor.slot.plannedEnd}
            </p>
            <p style={{ fontSize: 11, fontWeight: 700, color: r.color, marginBottom: 10 }}>
              {ar ? 'الخطورة عند الإطلاق' : 'Risk at release'}: {ar ? r.ar : r.en}
            </p>
            {releaseFor.fn.riskReasons.length > 0 && (
              <ul style={{ fontSize: 10.5, color: ts(dark), margin: '0 0 10px', paddingInlineStart: 16 }}>
                {releaseFor.fn.riskReasons.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            )}
            <label style={{ fontSize: 11, color: ts(dark), display: 'block', marginBottom: 4 }}>
              {ar ? 'السبب' : 'Reason'} {needReason ? <b style={{ color: '#f87171' }}>({ar ? 'إلزامي عند خطورة برتقالي فأعلى' : 'required at orange+ risk'})</b> : `(${ar ? 'اختياري' : 'optional'})`}
            </label>
            <textarea rows={2} value={releaseReason} onChange={e => setReleaseReason(e.target.value)}
              placeholder={ar ? 'مبرر الإطلاق رغم الخطورة...' : 'Justification for releasing at this risk...'}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit', fontSize: 12, padding: '8px 10px', borderRadius: 10, background: panelBg, border: `1px solid ${divider}`, color: tp(dark), outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setReleaseFor(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: `1px solid ${divider}`, background: 'transparent', cursor: 'pointer', fontSize: 12, color: tp(dark) }}>
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={doRelease} disabled={busy || (needReason && !releaseReason.trim())}
                style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff', background: '#16a34a', opacity: busy || (needReason && !releaseReason.trim()) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {busy && <Loader2 size={12} style={{ animation: 'ds-spin 1s linear infinite' }} />}
                {ar ? 'إطلاق البريك' : 'Release Break'}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* ── FREEZE confirm dialog (emergency, reason required) ────────────── */}
      {freezeFor && (
        <Modal onClose={() => { setFreezeFor(null); setFreezeReason(''); }} dark={dark}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: '#f87171', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ShieldAlert size={16} /> {ar ? 'تجميد طارئ للبريكات' : 'Emergency Break Freeze'}
          </h3>
          <p style={{ fontSize: 12, color: tp(dark), marginBottom: 10 }}>
            {ar
              ? `سيتوقف إطلاق أي بريك جديد (${freezeFor.function === '(default)' ? 'كل الوظائف' : freezeFor.function}) حتى إلغاء التجميد. الاستثناءات الصحية المعتمدة فقط تُطلق يدوياً. الإجراء مُسجّل في سجل التدقيق.`
              : `No new breaks will be released (${freezeFor.function === '(default)' ? 'all functions' : freezeFor.function}) until unfrozen. Only approved health/emergency exceptions may be released manually. This action is audited.`}
          </p>
          <label style={{ fontSize: 11, color: ts(dark), display: 'block', marginBottom: 4 }}>
            {ar ? 'سبب التجميد' : 'Freeze reason'} <b style={{ color: '#f87171' }}>({ar ? 'إلزامي' : 'required'})</b>
          </label>
          <textarea rows={2} value={freezeReason} onChange={e => setFreezeReason(e.target.value)}
            placeholder={ar ? 'مثال: انقطاع خدمة + طابور حرج...' : 'e.g. outage + critical queue backlog...'}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit', fontSize: 12, padding: '8px 10px', borderRadius: 10, background: panelBg, border: `1px solid ${divider}`, color: tp(dark), outline: 'none' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => { setFreezeFor(null); setFreezeReason(''); }} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: `1px solid ${divider}`, background: 'transparent', cursor: 'pointer', fontSize: 12, color: tp(dark) }}>
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
            <button onClick={() => setMode(freezeFor.function, 'freeze', freezeReason.trim())} disabled={busy || !freezeReason.trim()}
              style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#fff', background: '#dc2626', opacity: busy || !freezeReason.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {busy ? <Loader2 size={12} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <Snowflake size={12} />}
              {ar ? 'تفعيل التجميد' : 'Activate Freeze'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* tiny helpers */
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function Modal({ children, onClose, dark }: { children: React.ReactNode; onClose: () => void; dark: boolean }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, borderRadius: 18, padding: 20, background: dark ? '#151c30' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
        {children}
      </div>
    </div>
  );
}
