/**
 * B4 — EMPLOYEE BREAK CARD (SMART_DYNAMIC_BREAK spec §14).
 * Live agent-facing card over GET /breaks/my-break-status:
 * entitlement ring + session dots, next planned break + countdown, status chip
 * (with delay reason + updated ETA), employees-ahead count, START only when the
 * engine released the slot, RETURN with end-countdown (amber ≤5min, red overdue),
 * and an exception-request button into the existing break request flow.
 * Polls every 30s while mounted; optimistic start/return with rollback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Coffee, Play, Undo2, Users, Clock, AlertTriangle, Loader2, FilePlus2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { card as cardStyle, tp, ts } from '@/components/ds';

/* ── Payload types (GET /api/v1/breaks/my-break-status) ─────────────────── */
interface MyBreakStatus {
  date: string;
  asOf: string;
  balance: {
    entitledMinutes: number; usedMinutes: number; sessionsUsed: number;
    remainingMinutes: number; lastBreakEnd: string | null;
  };
  nextBreak: {
    slotId: string; status: string;
    plannedStart: string; plannedEnd: string; durationMin: number;
    earliestStart: string | null; latestStart: string | null;
    delayMin: number; delayReason: string | null;
    employeesAhead: number; positionInLine: number | null;
    estimatedRelease: string | null;
  } | null;
  todaySlots: { slotId: string; status: string; plannedStart: string; plannedEnd: string; slotNumber: number }[];
  buttons: { canStart: boolean; canReturn: boolean; canRequestException: boolean };
}

const MAX_SESSIONS = 4;

/* Status chip — semantic color + ALWAYS a text label (never color alone). */
const CHIP: Record<string, { en: string; ar: string; color: string }> = {
  scheduled:        { en: 'Planned',            ar: 'مخطط',            color: '#60a5fa' },
  eligible:         { en: 'Eligible',           ar: 'مؤهل',            color: '#2dd4bf' },
  waiting_capacity: { en: 'Waiting in line',    ar: 'في الانتظار',     color: '#fbbf24' },
  delayed:          { en: 'Delayed',            ar: 'مؤجل',            color: '#fb923c' },
  released:         { en: 'Released — start now', ar: 'تم الإطلاق — ابدأ الآن', color: '#4ade80' },
  active:           { en: 'On break',           ar: 'في بريك',         color: '#4ade80' },
  overdue:          { en: 'Overdue — return',   ar: 'متجاوز — عُد الآن', color: '#f87171' },
  completed:        { en: 'Returned',           ar: 'عاد',             color: '#94a3b8' },
  missed:           { en: 'Missed',             ar: 'فائت',            color: '#f87171' },
  cancelled:        { en: 'Cancelled',          ar: 'ملغى',            color: '#94a3b8' },
};

function fmtClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' });
}

/** minutes until HH:MM today (Kuwait wall clock ≈ browser clock for on-site users) */
function minutesUntil(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
}

export default function BreakCard({ onRequestException }: { onRequestException?: () => void }) {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  const [data, setData] = useState<MyBreakStatus | null>(null);
  const [noLink, setNoLink] = useState(false);
  const [err, setErr] = useState('');
  const [acting, setActing] = useState(false);
  const [, setTick] = useState(0); // re-render for countdowns
  // local optimistic start time (ms) — payload has no actual_start, so the
  // return-countdown anchors on the moment the agent pressed Start here.
  const startedAtRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await apiClient.get('/breaks/my-break-status');
      setData(d);
      setNoLink(false);
      if (!(d?.nextBreak && ['active', 'overdue'].includes(d.nextBreak.status))) startedAtRef.current = null;
    } catch (e: any) {
      if (e?.response?.status === 400) setNoLink(true);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30_000);        // §14 — 30s poll while mounted
    const clock = setInterval(() => setTick(t => t + 1), 1_000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  if (noLink || !data) return null;

  const bal = data.balance;
  const nb = data.nextBreak;
  const chip = nb ? (CHIP[nb.status] ?? { en: nb.status, ar: nb.status, color: '#94a3b8' }) : null;
  const usedPct = bal.entitledMinutes > 0 ? Math.min(100, (bal.usedMinutes / bal.entitledMinutes) * 100) : 0;

  // return countdown: optimistic local start + duration, else planned end
  let endLeftMin: number | null = null;
  if (nb && ['active', 'overdue'].includes(nb.status)) {
    if (startedAtRef.current) {
      endLeftMin = Math.round((startedAtRef.current + nb.durationMin * 60_000 - Date.now()) / 60_000);
    } else {
      endLeftMin = minutesUntil(nb.plannedEnd);
    }
  }
  const startInMin = nb && !['active', 'overdue', 'released'].includes(nb.status) ? minutesUntil(nb.plannedStart) : null;

  const doStart = async () => {
    if (!nb) return;
    setActing(true); setErr('');
    const prev = nb.status;
    setData(d => d?.nextBreak ? { ...d, nextBreak: { ...d.nextBreak, status: 'active' }, buttons: { ...d.buttons, canStart: false, canReturn: true } } : d);
    startedAtRef.current = Date.now();
    try { await apiClient.post(`/breaks/slots/${nb.slotId}/start`); }
    catch (e: any) {
      startedAtRef.current = null;
      setData(d => d?.nextBreak ? { ...d, nextBreak: { ...d.nextBreak, status: prev }, buttons: { ...d.buttons, canStart: prev === 'released', canReturn: false } } : d);
      setErr(e?.response?.data?.message === 'not released'
        ? (ar ? 'لم يُفتح البريك بعد — بانتظار الإطلاق' : 'Break not released yet — waiting for release')
        : (e?.response?.data?.message ?? (ar ? 'تعذّر بدء البريك' : 'Failed to start break')));
    }
    finally { setActing(false); load(); }
  };

  const doReturn = async () => {
    if (!nb) return;
    setActing(true); setErr('');
    const prev = nb.status;
    setData(d => d?.nextBreak ? { ...d, nextBreak: { ...d.nextBreak, status: 'completed' }, buttons: { ...d.buttons, canReturn: false } } : d);
    try { await apiClient.post(`/breaks/slots/${nb.slotId}/return`); }
    catch (e: any) {
      setData(d => d?.nextBreak ? { ...d, nextBreak: { ...d.nextBreak, status: prev }, buttons: { ...d.buttons, canReturn: true } } : d);
      setErr(e?.response?.data?.message ?? (ar ? 'تعذّر تسجيل العودة' : 'Failed to record return'));
    }
    finally { setActing(false); load(); }
  };

  const divider = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const onBreak = !!nb && ['active', 'overdue'].includes(nb.status);
  const endTone = endLeftMin == null ? null : endLeftMin < 0 ? '#ef4444' : endLeftMin <= 5 ? '#f59e0b' : '#4ade80';

  return (
    <div dir={ar ? 'rtl' : 'ltr'} style={{ ...cardStyle(dark), padding: 16 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(245,158,11,0.15)' }}>
            <Coffee size={15} style={{ color: '#f59e0b' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: tp(dark) }}>{ar ? 'بريكي اليوم' : 'My Break Today'}</span>
        </div>
        {chip && (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${chip.color}1a`, color: chip.color, border: `1px solid ${chip.color}35` }}>
            {ar ? chip.ar : chip.en}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* entitlement ring */}
        <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
          <svg viewBox="0 0 42 42" style={{ width: 76, height: 76, transform: 'rotate(-90deg)' }}>
            <circle cx="21" cy="21" r="16" fill="none" stroke={divider} strokeWidth="5" />
            <circle cx="21" cy="21" r="16" fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${(usedPct / 100) * 100.5} 100.5`} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: tp(dark), lineHeight: 1 }}>{bal.remainingMinutes}<span style={{ fontSize: 9 }}>{ar ? 'د' : 'm'}</span></div>
              <div style={{ fontSize: 8, color: ts(dark) }}>{ar ? 'متبقي' : 'left'}</div>
            </div>
          </div>
        </div>

        {/* balance + sessions */}
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: ts(dark) }}>
            {ar ? `المستخدم ${bal.usedMinutes} من ${bal.entitledMinutes} دقيقة` : `Used ${bal.usedMinutes} of ${bal.entitledMinutes} min`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
            {Array.from({ length: MAX_SESSIONS }, (_, i) => (
              <span key={i} title={`${ar ? 'جلسة' : 'session'} ${i + 1}`}
                style={{ width: 10, height: 10, borderRadius: '50%', background: i < bal.sessionsUsed ? '#f59e0b' : 'transparent', border: `1.5px solid ${i < bal.sessionsUsed ? '#f59e0b' : ts(dark)}` }} />
            ))}
            <span style={{ fontSize: 10, color: ts(dark), marginInlineStart: 4 }}>
              {bal.sessionsUsed}/{MAX_SESSIONS} {ar ? 'جلسات' : 'sessions'}
            </span>
          </div>

          {/* next break + countdown */}
          {nb ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: tp(dark) }}>
                <Clock size={12} style={{ color: '#818cf8' }} /> {nb.plannedStart}–{nb.plannedEnd}
              </span>
              <span style={{ fontSize: 10.5, color: ts(dark) }}>{nb.durationMin}{ar ? ' دقيقة' : ' min'}</span>
              {startInMin != null && startInMin > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#818cf8' }}>
                  {ar ? `بعد ${startInMin} دقيقة` : `in ${startInMin} min`}
                </span>
              )}
              {nb.employeesAhead > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: ts(dark) }}>
                  <Users size={11} /> {ar ? `${nb.employeesAhead} قبلك في الطابور` : `${nb.employeesAhead} ahead of you`}
                </span>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 11, color: ts(dark), marginTop: 8 }}>
              {ar ? 'لا يوجد بريك مجدول لك اليوم' : 'No break scheduled for you today'}
            </p>
          )}
        </div>
      </div>

      {/* delayed → reason + updated ETA (§11/§14) */}
      {nb && nb.status === 'delayed' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(251,146,60,0.09)', border: '1px solid rgba(251,146,60,0.28)' }}>
          <AlertTriangle size={13} style={{ color: '#fb923c', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: '#fb923c' }}>
            <b>{ar ? `مؤجل ${nb.delayMin} دقيقة` : `Delayed ${nb.delayMin} min`}</b>
            {nb.delayReason && <span style={{ color: ts(dark) }}> — {nb.delayReason}</span>}
            {nb.estimatedRelease && (
              <span> · {ar ? 'الإطلاق المتوقع' : 'ETA'} <b>{fmtClock(nb.estimatedRelease)}</b></span>
            )}
          </div>
        </div>
      )}

      {/* on-break → return countdown */}
      {onBreak && endLeftMin != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 12px', borderRadius: 10, background: `${endTone}12`, border: `1px solid ${endTone}35` }}>
          <Clock size={13} style={{ color: endTone!, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: endTone! }}>
            {endLeftMin < 0
              ? (ar ? `متجاوز ${Math.abs(endLeftMin)} دقيقة — عُد الآن` : `${Math.abs(endLeftMin)} min overdue — return now`)
              : (ar ? `ينتهي البريك خلال ${endLeftMin} دقيقة` : `Break ends in ${endLeftMin} min`)}
          </span>
        </div>
      )}

      {err && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={12} /> {err}
        </div>
      )}

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {!onBreak && nb && !['completed', 'missed', 'cancelled'].includes(nb.status) && (
          <button onClick={doStart} disabled={!data.buttons.canStart || acting}
            title={!data.buttons.canStart ? (ar ? 'لا يمكن البدء قبل إطلاق النظام' : 'Cannot start before the system releases it') : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 10, border: 'none',
              cursor: data.buttons.canStart && !acting ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700,
              color: data.buttons.canStart ? '#fff' : ts(dark),
              background: data.buttons.canStart ? 'linear-gradient(135deg,#16a34a,#22c55e)' : (dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
            }}>
            {acting ? <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <Play size={13} />}
            {data.buttons.canStart ? (ar ? 'ابدأ البريك' : 'Start Break') : (ar ? 'بانتظار الإطلاق' : 'Waiting for release')}
          </button>
        )}
        {data.buttons.canReturn && (
          <button onClick={doReturn} disabled={acting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff', background: endLeftMin != null && endLeftMin < 0 ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'linear-gradient(135deg,#4f46e5,#7c3aed)', opacity: acting ? 0.6 : 1 }}>
            {acting ? <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <Undo2 size={13} />}
            {ar ? 'عدت من البريك' : 'Return from Break'}
          </button>
        )}
        {onRequestException && (
          <button onClick={onRequestException}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`, background: 'transparent', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: tp(dark) }}>
            <FilePlus2 size={12} /> {ar ? 'طلب استثناء' : 'Request Exception'}
          </button>
        )}
      </div>
    </div>
  );
}
