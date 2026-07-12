import {
  useState, useEffect, useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { Radio } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { tp, ts as tsColor } from '@/components/ds';
import {
  SpLive, BreakTracker, Coverage, ContactForecast, ViolationsReport, AdherenceReport,
  CH_COLOR, slaColor, pctColor, fmtNum,
} from './types';
import { CH_ICON, tok } from './shared';
import { useCountUpOnce, AgentDonut, AgentBoard } from './LivePanels';

/* KEEP-DARK (theme-token sweep): WbKpi + Wallboard below are a full-screen TV
   overlay rendered on a hardcoded #060912 surface (portal, cinematic wallboard
   for wall screens) — like a media lightbox they stay dark in every theme, so
   their neutral hexes/white-overlays are deliberate and must NOT be tokenized. */

/* Module-level so it keeps a STABLE identity across the Wallboard's frequent
   re-renders (clock 1s + rotation progress 120ms). If defined inline it would
   remount every render and the count-up would restart from 0 → numbers "dance". */
function WbKpi({ label, num, suffix, color, text, note }: { label: string; num?: number; suffix?: string; color: string; text?: string; note?: string }) {
  // `text` overrides the numeric count-up (e.g. "—" when a value is UNKNOWN, so the
  // TV never fabricates a green 100% SLA on a degraded queue feed).
  const n = useCountUpOnce(num ?? 0);
  return (
    <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}33`, borderRadius: 20, padding: '20px 24px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 3, background: color }} />
      <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{text != null ? text : `${fmtNum(n)}${suffix || ''}`}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', marginTop: 10, letterSpacing: '0.04em' }}>{label}{note ? <span style={{ fontSize: 12, color: '#fca5a5', marginInlineStart: 8 }}>· {note}</span> : ''}</div>
    </div>
  );
}

/* ── Wallboard / TV mode — cinematic full-screen live ops display ──────────── */
export function Wallboard({ live, breakData, fc, coverage, ar, onClose }: { live: SpLive | null; breakData: BreakTracker | null; fc: ContactForecast | null; coverage: Coverage | null; ar: boolean; onClose: () => void }) {
  const [clock, setClock] = useState(new Date());
  const [alertIdx, setAlertIdx] = useState(0);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const PAGES = [{ ar: 'الطوابير', en: 'Queues' }, { ar: 'الموظفون', en: 'Agents' }, { ar: 'التوقّع', en: 'Forecast' }];
  const ROTATE_MS = 15000;
  // Which pages actually have data right now — rotation skips the empty ones so
  // the TV never sits on a dead screen (e.g. queues=0 or forecast not ready).
  const pageDataRef = useRef<boolean[]>([true, true, true]);
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  // Auto-rotate pages (TV mode) — pausable; advances only to pages with data.
  useEffect(() => {
    if (paused) return;
    const step = 120;
    const t = setInterval(() => {
      const active = pageDataRef.current.map((d, i) => (d ? i : -1)).filter(i => i >= 0);
      if (active.length <= 1) { setProgress(0); return; }
      setProgress(p => {
        const np = p + (step / ROTATE_MS) * 100;
        if (np >= 100) { setPage(x => { const idx = active.indexOf(x); return active[(idx + 1) % active.length] ?? active[0]; }); return 0; }
        return np;
      });
    }, step);
    return () => clearInterval(t);
  }, [paused]);
  const goPage = (i: number) => { setPage(i); setProgress(0); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const agents = live?.agents ?? [];
  const avail = agents.filter(a => a.status === 'available' || a.status === 'idle').length;
  const busy  = agents.filter(a => a.status === 'busy').length;
  const brk   = agents.filter(a => a.status === 'break' || a.status === 'away').length;
  const off   = agents.filter(a => a.status === 'offline' || a.status === 'unknown').length;
  const totalAg = Math.max(1, avail + busy + brk + off);
  const queues = [...(live?.queues ?? [])].sort((a, b) => (b.waiting || 0) - (a.waiting || 0));
  const risky  = queues.filter(q => (q.slaPct ?? 100) < 80 || (q.waiting || 0) > 50);
  const s = live?.summary;
  const avgSla = s?.avgSla ?? null; // null = UNKNOWN (degraded queue feed) — never fabricate 100
  const isStale = live?.isStale;

  // Page data-availability → drives empty-page skipping in the rotation.
  const pageHasData = [
    queues.length > 0,
    agents.length > 0,
    !!fc?.forecast?.some(f => f.predictedContacts > 0),
  ];
  if (!pageHasData.some(Boolean)) pageHasData[1] = true; // always keep at least one page
  // Keep the ref in sync + jump off an empty current page — in an effect (no render side-effects).
  useEffect(() => {
    pageDataRef.current = pageHasData;
    if (!pageHasData[page]) { const first = pageHasData.findIndex(Boolean); if (first >= 0) { setPage(first); setProgress(0); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageHasData[0], pageHasData[1], pageHasData[2]]);

  const alerts = [
    ...(live?.queueFeedMissing ? [ar ? '⚠ تغذية الطوابير مفقودة — SLA وعدد المنتظرين غير معروف (ليس ٠)' : '⚠ Queue feed missing — SLA & waiting UNKNOWN (not zero)'] : []),
    ...risky.map(q => `⚠ ${q.queueName} — SLA ${q.slaPct ?? 0}% · ${q.waiting} ${ar ? 'بالانتظار' : 'waiting'}`),
    ...(breakData && breakData.unauthorizedCount > 0 ? [`⚠ ${breakData.unauthorizedCount} ${ar ? 'بريك غير مرخّص الآن' : 'unauthorized breaks now'}`] : []),
  ];
  useEffect(() => { if (alerts.length < 2) return; const t = setInterval(() => setAlertIdx(i => (i + 1) % alerts.length), 4000); return () => clearInterval(t); }, [alerts.length]);

  return createPortal((
    <div dir={ar ? 'rtl' : 'ltr'} style={{
      position: 'fixed', inset: 0, zIndex: 9999, color: '#fff', display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(120% 80% at 100% -5%, rgba(99,102,241,0.18), transparent 55%), radial-gradient(120% 80% at 0% 105%, rgba(139,92,246,0.14), transparent 55%), #060912',
      fontFamily: '-apple-system, system-ui, Segoe UI, Tahoma, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Radio size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Boutiqaat — {ar ? 'مركز العمليات الحيّ' : 'Live Operations'}</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>{ar ? 'مراقبة لحظية' : 'Real-time wallboard'}{isStale ? ` · ${ar ? '⚠ بيانات غير لحظية' : '⚠ data not live'}` : ''}</div>
        </div>
        <div style={{ textAlign: ar ? 'left' : 'right' }}>
          <div style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
            {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>{clock.toLocaleDateString(ar ? 'ar-KW' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 14, background: isStale ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${isStale ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`, color: isStale ? '#fbbf24' : '#4ade80' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: isStale ? '#fbbf24' : '#22c55e', boxShadow: `0 0 12px ${isStale ? '#fbbf24' : '#22c55e'}` }} />
          {isStale ? (ar ? 'غير لحظي' : 'STALE') : 'LIVE'}
        </span>
        {/* page dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {PAGES.map((p, i) => (
            <button key={i} onClick={() => goPage(i)} title={ar ? p.ar : p.en}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 10, cursor: 'pointer', opacity: pageHasData[i] ? 1 : 0.4,
                background: page === i ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.04)', border: `1px solid ${page === i ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`, color: page === i ? '#c7d2fe' : '#64748b', fontSize: 12, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: page === i ? '#818cf8' : '#475569' }} />{ar ? p.ar : p.en}
            </button>
          ))}
        </div>
        <button onClick={() => setPaused(v => !v)} title={paused ? (ar ? 'تشغيل' : 'Play') : (ar ? 'إيقاف' : 'Pause')}
          style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1', cursor: 'pointer', fontSize: 14 }}>
          {paused ? '▶' : '⏸'}
        </button>
        <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {ar ? 'خروج' : 'Exit'} ✕
        </button>
      </div>
      {/* rotation progress */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ height: '100%', width: `${paused ? 0 : progress}%`, background: 'linear-gradient(90deg,#6366f1,#22d3ee)', transition: 'width .12s linear' }} />
      </div>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 14, padding: '18px 28px' }}>
        <WbKpi label={ar ? 'في الانتظار' : 'Waiting'} num={s?.totalWaiting ?? 0} color="#f59e0b" />
        <WbKpi label={ar ? 'قيد التنفيذ' : 'Active'} num={s?.totalInProgress ?? 0} color="#818cf8" />
        <WbKpi label={ar ? 'متاح الآن' : 'Available'} num={avail} color="#22c55e" />
        <WbKpi label={ar ? 'في استراحة' : 'On Break'} num={brk} color="#a855f7" />
        <WbKpi label={ar ? 'متوسط SLA' : 'Avg SLA'}
          num={avgSla ?? undefined} suffix="%"
          text={avgSla == null ? '—' : undefined}
          note={avgSla == null ? (ar ? 'لا تغذية طوابير' : 'no queue feed') : undefined}
          color={avgSla == null ? '#64748b' : slaColor(avgSla)} />
      </div>

      {/* Page 0 — Queue grid */}
      {page === 0 && (
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 28px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {queues.map(q => {
            const sla = q.slaPct ?? 100;
            const risk = sla < 80 || (q.waiting || 0) > 50;
            const ch = CH_COLOR[q.channel] || '#64748b';
            return (
              <div key={q.queueId} style={{ background: risk ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${risk ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 18, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                {risk && <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 3, background: 'linear-gradient(90deg,#ef4444,transparent)' }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, background: `${ch}22`, color: ch, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{CH_ICON[q.channel]}</span>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.queueName}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: `${slaColor(sla)}22`, color: slaColor(sla) }}>{sla}%</span>
                </div>
                <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
                  <div><div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: risk ? '#f87171' : '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(q.waiting || 0)}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{ar ? 'بالانتظار' : 'waiting'}</div></div>
                  <div><div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: '#818cf8', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(q.inProgress || 0)}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{ar ? 'جارية' : 'active'}</div></div>
                  <div style={{ marginInlineStart: 'auto', textAlign: ar ? 'left' : 'right' }}><div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(q.agentsAvailable || 0)}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{ar ? 'متاح' : 'avail'}</div></div>
                </div>
              </div>
            );
          })}
          {queues.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: '#475569', fontSize: 16 }}>{ar ? 'لا توجد بيانات طوابير' : 'No queue data'}</div>}
        </div>
      </div>
      )}

      {/* Page 1 — Agents */}
      {page === 1 && (
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 28px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          {[
            { l: ar ? 'متاح الآن' : 'Available', v: avail, c: '#22c55e' },
            { l: ar ? 'مشغول' : 'Busy', v: busy, c: '#f59e0b' },
            { l: ar ? 'في استراحة' : 'On Break', v: brk, c: '#a855f7' },
            { l: ar ? 'غير متصل' : 'Offline', v: off, c: '#64748b' },
          ].map(t => (
            <div key={t.l} style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: `1px solid ${t.c}33`, borderRadius: 20, padding: '26px 28px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 3, background: t.c }} />
              <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1, color: t.c, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em' }}>{fmtNum(t.v)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#94a3b8', marginTop: 12 }}>{t.l}</div>
              <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{Math.round((t.v / totalAg) * 100)}%</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
          <AgentDonut avail={avail} busy={busy} brk={brk} off={off} ar={ar} size={168} thickness={18} keepDark />
        </div>
        {/* Rich per-agent roster: contacts / AHT / hold / idle / conformance */}
        <div style={{ flex: 1, minHeight: 0 }}><AgentBoard ar={ar} big keepDark /></div>
      </div>
      )}

      {/* Page 2 — Forecast & coverage */}
      {page === 2 && (
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 28px 18px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#cbd5e1', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          {ar ? 'توقّع الحِمل والـ HC المطلوب — ٧ أيام' : 'Contact forecast & required HC — 7 days'}
          {fc?.confidence && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>{fc.confidence}</span>}
        </div>
        {!fc?.forecast?.length ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569', fontSize: 16 }}>{ar ? 'لا بيانات كافية للتوقّع' : 'Not enough data to forecast'}</div>
        ) : (() => {
          const fmx = Math.max(1, ...fc.forecast.map(f => f.predictedContacts));
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {fc.forecast.slice(0, 7).map(f => (
                <div key={f.date} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ minWidth: 96, fontSize: 15, color: '#94a3b8' }}>{new Date(f.date).toLocaleDateString(ar ? 'ar-KW' : 'en-GB', { weekday: 'long', day: 'numeric' })}</span>
                  <div style={{ flex: 1, height: 26, borderRadius: 13, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
                    <div style={{ height: '100%', width: `${(f.predictedContacts / fmx) * 100}%`, background: 'linear-gradient(90deg,#6366f1,#22d3ee)', borderRadius: 13 }} />
                  </div>
                  <span style={{ minWidth: 80, textAlign: 'end', fontSize: 22, fontWeight: 800, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(f.predictedContacts)}</span>
                  <span style={{ minWidth: 96, textAlign: 'end', fontSize: 16, fontWeight: 700, color: '#a5b4fc' }}>{f.requiredHcP90 != null ? `≈ ${f.requiredHcP90} ${ar ? 'موظف' : 'HC'}` : '—'}</span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                {[
                  { l: ar ? 'حضور / مجدول' : 'Punched / Scheduled', v: `${coverage?.attendance?.punched_in ?? 0} / ${coverage?.attendance?.total_scheduled ?? 0}`, c: '#34d399' },
                  { l: ar ? 'على استئذان' : 'On permission', v: coverage?.onPermission ?? 0, c: '#fbbf24' },
                  { l: ar ? 'مسجّل دخول (لايف)' : 'Logged in (live)', v: coverage?.liveSprinklr?.totalLoggedIn ?? '—', c: '#06b6d4' },
                  { l: 'AHT', v: fc.staffing?.avgAhtSec != null ? `${Math.round(fc.staffing.avgAhtSec / 60)}${ar ? 'د' : 'm'}` : '—', c: '#818cf8' },
                ].map(x => (
                  <div key={x.l} style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '16px 18px' }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: x.c, fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>{x.l}</div>
                  </div>
                ))}
              </div>
              {fc.staffing?.avgAhtSec != null && <p style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>{ar ? `HC المطلوب (P90) = الحِمل × AHT ÷ ${fc.staffing.productiveHoursPerAgent}س منتجة لكل موظف` : `Required HC (P90) = load × AHT ÷ ${fc.staffing.productiveHoursPerAgent}h productive per agent`}</p>}
            </div>
          );
        })()}
      </div>
      )}

      {/* Alert ticker */}
      {alerts.length > 0 && (
        <div style={{ padding: '13px 28px', borderTop: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#f87171', padding: '4px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.15)' }}>{ar ? `تنبيهات (${alerts.length})` : `ALERTS (${alerts.length})`}</span>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#fca5a5' }}>{alerts[alertIdx % alerts.length]}</span>
        </div>
      )}
    </div>
  ), document.body);
}

/* ── Executive Overview — one-screen command dashboard ─────────────────────── */
export function ExecutiveOverview({ live, breakData, coverage, violations, adherence, fc, ar, onSelectQueue }: {
  live: SpLive | null; breakData: BreakTracker | null; coverage: Coverage | null;
  violations: ViolationsReport | null; adherence: AdherenceReport | null; fc: ContactForecast | null;
  ar: boolean; onSelectQueue?: (id: string) => void;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const s = live?.summary;
  const avgSla = s?.avgSla ?? null; // null = UNKNOWN (degraded queue feed) — never fabricate 100
  const agents = live?.agents ?? [];
  const avail = agents.filter(a => a.status === 'available' || a.status === 'idle').length;
  const busy  = agents.filter(a => a.status === 'busy').length;
  const brk   = agents.filter(a => a.status === 'break' || a.status === 'away').length;
  const off   = agents.filter(a => a.status === 'offline' || a.status === 'unknown').length;
  const totalAg = Math.max(1, avail + busy + brk + off);
  const risky = live?.atRisk ?? [];
  const openViol = violations?.summary.open ?? 0;
  const below85 = adherence?.summary.below85 ?? 0;
  const avgAdh = adherence?.summary.avgAdherence ?? null;
  const unauth = breakData?.unauthorizedCount ?? 0;
  const queues = [...(live?.queues ?? [])].sort((a, b) => (b.waiting || 0) - (a.waiting || 0));

  // A degraded queue feed (avgSla unknown) can NEVER read as "Stable/on target" —
  // that was the false all-clear. Force at least Caution when we can't see queues.
  const feedDegraded = !!live?.queueFeedMissing || avgSla == null;
  const posture = (risky.length > 0 || below85 > 3 || unauth > 2)
    ? { c: '#ef4444', t: ar ? 'خطر — يتطلّب تدخّلاً الآن' : 'Risk — needs intervention now' }
    : (openViol > 0 || unauth > 0 || feedDegraded || (avgSla ?? 100) < 90)
      ? { c: '#f59e0b', t: ar ? 'انتباه — راقب عن قرب' : 'Caution — watch closely' }
      : { c: '#22c55e', t: ar ? 'مستقرّ — كل شيء ضمن الهدف' : 'Stable — everything on target' };

  const tiles = [
    { l: ar ? 'في الانتظار' : 'Waiting', v: fmtNum(s?.totalWaiting ?? 0), c: '#f59e0b' },
    { l: ar ? 'قيد التنفيذ' : 'Active', v: fmtNum(s?.totalInProgress ?? 0), c: '#818cf8' },
    { l: ar ? 'متاح الآن' : 'Available', v: fmtNum(avail), c: '#22c55e' },
    { l: ar ? 'في استراحة' : 'On Break', v: fmtNum(brk), c: '#a855f7' },
    { l: ar ? 'متوسط SLA' : 'Avg SLA', v: avgSla == null ? '—' : `${avgSla}%`, c: avgSla == null ? tsColor(dark) : slaColor(avgSla) },
    { l: ar ? 'إجمالي الموظفين' : 'Agents', v: fmtNum(agents.length), c: '#06b6d4' },
    { l: ar ? 'الالتزام' : 'Adherence', v: avgAdh != null ? `${Math.round(avgAdh)}%` : '—', c: avgAdh != null ? pctColor(avgAdh) : tsColor(dark) },
    { l: ar ? 'مخالفات مفتوحة' : 'Open issues', v: fmtNum(openViol), c: openViol > 0 ? '#f87171' : tsColor(dark) },
  ];

  const card: React.CSSProperties = { background: T.panel, border: `1px solid ${T.bdr}`, borderRadius: 16 };
  const fcMax = Math.max(1, ...((fc?.forecast ?? []).map(f => f.predictedContacts)));
  const byType = violations?.summary.byType ?? {};

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: 'thin' }}>
      {/* Posture */}
      <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: `${posture.c}14`, border: `1px solid ${posture.c}44` }}>
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: posture.c, boxShadow: `0 0 10px ${posture.c}` }} />
        <span className="text-sm font-bold" style={{ color: posture.c }}>{ar ? 'الوضع التنفيذي' : 'Executive posture'}: {posture.t}</span>
        {feedDegraded && <span className="text-[11px]" style={{ color: '#fca5a5' }}>⚠ {ar ? 'تغذية الطوابير مفقودة — SLA غير معروف' : 'queue feed missing — SLA unknown'}</span>}
        {live?.isStale && <span className="text-[11px] ms-auto" style={{ color: '#fbbf24' }}>⚠ {ar ? 'بيانات غير لحظية' : 'data not live'}</span>}
      </div>

      {/* KPI grid */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {tiles.map(t => (
          <div key={t.l} style={{ ...card, padding: '12px 14px' }}>
            <div className="text-2xl font-bold tabular-nums" style={{ color: t.c, letterSpacing: '-0.02em' }}>{t.v}</div>
            <div className="text-[10px] mt-1" style={{ color: tsColor(dark) }}>{t.l}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {/* Queue health */}
        <div style={card}>
          <div className="px-3 py-2 text-xs font-bold" style={{ color: tp(dark), borderBottom: `1px solid ${T.bdr}` }}>{ar ? 'صحّة الطوابير' : 'Queue health'}</div>
          <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
            {queues.length === 0 && <p className="text-[11px] text-center py-4" style={{ color: T.faint }}>{ar ? 'لا طوابير' : 'No queues'}</p>}
            {queues.map(q => {
              const sla = q.slaPct ?? 100; const risk = sla < 80 || (q.waiting || 0) > 50;
              return (
                <div key={q.queueId} onClick={() => onSelectQueue?.(q.queueId)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] hover:bg-white/[0.04]" style={{ cursor: onSelectQueue ? 'pointer' : 'default', background: risk ? 'rgba(239,68,68,0.06)' : 'transparent' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: slaColor(sla) }} />
                  <span className="flex-1 truncate" style={{ color: tp(dark) }}>{q.queueName}</span>
                  <span className="tabular-nums" style={{ color: '#fbbf24', minWidth: 30, textAlign: 'end' }}>{q.waiting}</span>
                  <span className="tabular-nums" style={{ color: tsColor(dark), minWidth: 26, textAlign: 'end' }}>{q.inProgress}</span>
                  <span className="tabular-nums font-semibold" style={{ color: slaColor(sla), minWidth: 38, textAlign: 'end' }}>{sla}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Coverage + agent mix */}
        <div style={card}>
          <div className="px-3 py-2 text-xs font-bold" style={{ color: tp(dark), borderBottom: `1px solid ${T.bdr}` }}>{ar ? 'التغطية وحالة الفريق' : 'Coverage & team mix'}</div>
          <div className="p-3 space-y-3">
            <div className="flex justify-center py-1">
              <AgentDonut avail={avail} busy={busy} brk={brk} off={off} ar={ar} size={132} thickness={14} />
            </div>
            {coverage && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { l: ar ? 'حضور/مجدول' : 'Punched/Sched', v: `${coverage.attendance?.punched_in ?? 0}/${coverage.attendance?.total_scheduled ?? 0}`, c: '#34d399' },
                  { l: ar ? 'استئذان' : 'On permission', v: coverage.onPermission ?? 0, c: '#fbbf24' },
                  { l: ar ? 'مسجّل دخول (لايف)' : 'Logged in (live)', v: coverage.liveSprinklr?.totalLoggedIn ?? '—', c: '#06b6d4' },
                ].map(x => (
                  <div key={x.l} className="rounded-lg p-2 text-center" style={{ background: T.panel }}>
                    <div className="text-sm font-bold tabular-nums" style={{ color: x.c }}>{x.v}</div>
                    <div className="text-[9px] mt-0.5" style={{ color: T.faint }}>{x.l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Compliance */}
        <div style={card}>
          <div className="px-3 py-2 text-xs font-bold flex items-center gap-2" style={{ color: tp(dark), borderBottom: `1px solid ${T.bdr}` }}>
            {ar ? 'الالتزام والمخالفات' : 'Compliance'} {openViol > 0 && <span className="px-1.5 rounded text-[9px] font-bold" style={{ background: '#ef444428', color: '#f87171' }}>{openViol}</span>}
          </div>
          <div className="p-3">
            {Object.keys(byType).length === 0 ? (
              <p className="text-[11px] text-center py-3" style={{ color: '#4ade80' }}>{ar ? 'لا مخالفات مفتوحة 🎉' : 'No open violations 🎉'}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(byType).map(([k, v]) => (
                  <span key={k} className="text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.22)' }}>{k.replace(/_/g, ' ')}: <b>{v}</b></span>
                ))}
              </div>
            )}
            {unauth > 0 && <div className="mt-2 text-[11px]" style={{ color: '#fb923c' }}>⚠ {unauth} {ar ? 'بريك غير مرخّص الآن' : 'unauthorized breaks now'}</div>}
            {avgAdh != null && <div className="mt-2 text-[11px]" style={{ color: tsColor(dark) }}>{ar ? 'متوسط الالتزام' : 'Avg adherence'}: <b style={{ color: pctColor(avgAdh) }}>{Math.round(avgAdh)}%</b>{below85 > 0 ? ` · ${below85} ${ar ? 'تحت 85%' : 'below 85%'}` : ''}</div>}
          </div>
        </div>

        {/* Forecast */}
        <div style={card}>
          <div className="px-3 py-2 text-xs font-bold flex items-center gap-2" style={{ color: tp(dark), borderBottom: `1px solid ${T.bdr}` }}>
            {ar ? 'توقّع الحِمل (٧ أيام)' : 'Contact forecast (7d)'}
            {fc?.confidence && <span className="px-1.5 rounded text-[9px] font-semibold" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>{fc.confidence}</span>}
          </div>
          <div className="p-3">
            {!fc?.forecast?.length ? (
              <p className="text-[11px] text-center py-3" style={{ color: T.faint }}>{ar ? 'لا بيانات كافية للتوقّع' : 'Not enough data to forecast'}</p>
            ) : (
              <div className="space-y-1.5">
                {fc.forecast.slice(0, 7).map(f => (
                  <div key={f.date} className="flex items-center gap-2 text-[11px]">
                    <span style={{ color: tsColor(dark), minWidth: 58 }}>{new Date(f.date).toLocaleDateString(ar ? 'ar-KW' : 'en-GB', { weekday: 'short', day: 'numeric' })}</span>
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: T.panel }}>
                      <div className="h-full rounded-full" style={{ width: `${(f.predictedContacts / fcMax) * 100}%`, background: 'linear-gradient(90deg,#6366f1,#22d3ee)' }} />
                    </div>
                    <span className="tabular-nums font-semibold" style={{ color: tp(dark), minWidth: 44, textAlign: 'end' }}>{fmtNum(f.predictedContacts)}</span>
                    {f.requiredHcP90 != null && <span className="tabular-nums" style={{ color: '#a5b4fc', minWidth: 52, textAlign: 'end' }}>≈{f.requiredHcP90} {ar ? 'موظف' : 'HC'}</span>}
                  </div>
                ))}
                {fc.staffing?.avgAhtSec != null && <p className="text-[9px] mt-1" style={{ color: T.faint }}>{ar ? `HC المطلوب (P90) من الحِمل × AHT ${Math.round(fc.staffing.avgAhtSec / 60)}د ÷ ${fc.staffing.productiveHoursPerAgent}س منتجة` : `Required HC (P90) from load × AHT ${Math.round(fc.staffing.avgAhtSec / 60)}m ÷ ${fc.staffing.productiveHoursPerAgent}h productive`}</p>}
                {fc.note && <p className="text-[9px] mt-1" style={{ color: T.faint }}>{fc.note}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
