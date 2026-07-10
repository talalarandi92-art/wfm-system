import { useState } from 'react';
import {
  Radio, WifiOff, ArrowRight, AlertTriangle, Coffee, Shield,
  UserCheck, Clock, CheckCircle2, Activity, BarChart3, Timer,
} from 'lucide-react';
import { fmtDurationSec } from '@/utils/format';
import { useUiStore } from '@/store/ui.store';
import { tp, ts as tsColor } from '@/components/ds';
import {
  StationSummary, SpLive, SpAgent, BreakTracker, AgentTimeline, Coverage,
  ST_COLOR, pctColor, fmtMin, fmtTime, stLabel,
} from './types';
import { AgentRow, EmptyState, tok } from './shared';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  STATION PANEL — faithful mirror of the Sprinklr Supervisor right-rail       */
/* ═══════════════════════════════════════════════════════════════════════════ */
// Color per known station label (status + state). Falls back to slate.
function stationLabelColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('working') || l.includes('on a case'))   return '#22c55e'; // working on a case
  if (l.includes('available') && !l.includes('un'))       return '#22c55e';
  if (l.includes('idle'))                                 return '#06b6d4';
  if (l.includes('manual') || l.includes('outbound'))     return '#a78bfa';
  if (l.includes('unavailable'))                          return '#f59e0b';
  if (l.includes('logged out') || l.includes('offline'))  return '#475569';
  if (l.includes('break') || l.includes('lunch') || l.includes('prayer') || l.includes('bio')) return '#818cf8';
  if (l.includes('meeting') || l.includes('training') || l.includes('coach')) return '#f472b6';
  return '#64748b';
}

export function StationPanel({ station, ar }: { station: StationSummary; ar: boolean }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const cell = dark ? 'rgba(15,23,42,0.4)' : 'rgba(15,23,42,0.04)';
  const qs    = station.queueSummary;
  const status = station.agentStatus ?? [];
  const state  = station.agentState ?? [];
  if (!qs && !status.length && !state.length) return null;

  const stateTotal = state.reduce((s, x) => s + x.count, 0) || 1;

  return (
    <div className="flex-shrink-0 mx-4 mb-2 rounded-2xl overflow-hidden"
      style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
      <div className="px-3 py-1.5 flex items-center gap-2"
        style={{ borderBottom: `1px solid ${T.bdr}` }}>
        <Radio size={12} style={{ color: '#06b6d4' }} />
        <span className="text-[11px] font-bold" style={{ color: tsColor(dark) }}>
          {ar ? 'محطة سبرينكلر المباشرة' : 'Live Sprinklr Station'}
        </span>
      </div>

      <div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', background: T.bdr }}>

        {/* ── Queue Summary ── */}
        <div className="p-2.5" style={{ background: cell }}>
          <div className="text-[9px] font-bold uppercase tracking-wide mb-1.5" style={{ color: T.faint }}>
            {ar ? 'ملخص الطابور' : 'Queue Summary'}
          </div>
          {qs ? (
            <div className="space-y-1">
              {[
                { l: ar ? 'عملاء بالانتظار' : 'Customers Waiting', v: qs.customersWaiting, c: qs.customersWaiting > 0 ? '#fbbf24' : tsColor(dark) },
                { l: ar ? 'حالات قيد المعالجة' : 'Cases in Progress', v: qs.casesInProgress, c: '#818cf8' },
                { l: ar ? 'متوسط الانتظار' : 'Avg Wait', v: fmtDurationSec(qs.avgWaitSeconds, ar), c: tsColor(dark) },
                { l: ar ? 'أقدم انتظار' : 'Oldest Wait', v: fmtDurationSec(qs.oldestWaitSeconds, ar), c: qs.oldestWaitSeconds > 120 ? '#f87171' : tsColor(dark) },
              ].map(r => (
                <div key={r.l} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] truncate" style={{ color: T.faint }}>{r.l}</span>
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0" style={{ color: r.c }}>{r.v}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-[10px]" style={{ color: T.faint }}>—</div>}
        </div>

        {/* ── Agent Status (chosen presence) ── */}
        <div className="p-2.5" style={{ background: cell }}>
          <div className="text-[9px] font-bold uppercase tracking-wide mb-1.5" style={{ color: T.faint }}>
            {ar ? 'حالة الموظف' : 'Agent Status'}
          </div>
          {status.length ? (
            <div className="space-y-1">
              {status.map(r => (
                <div key={r.label} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: stationLabelColor(r.label) }} />
                    <span className="text-[10px] truncate" style={{ color: tsColor(dark) }}>{r.label}</span>
                  </span>
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0" style={{ color: stationLabelColor(r.label) }}>{r.count}</span>
                </div>
              ))}
            </div>
          ) : <div className="text-[10px]" style={{ color: T.faint }}>—</div>}
        </div>

        {/* ── Agent State (actual activity) + % bars ── */}
        <div className="p-2.5" style={{ background: cell }}>
          <div className="text-[9px] font-bold uppercase tracking-wide mb-1.5" style={{ color: T.faint }}>
            {ar ? 'وضع الموظف' : 'Agent State'}
          </div>
          {state.length ? (
            <div className="space-y-1.5">
              {state.map(r => {
                const pct = r.pct || (r.count / stateTotal) * 100;
                const c = stationLabelColor(r.label);
                return (
                  <div key={r.label}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[10px] truncate" style={{ color: tsColor(dark) }}>{r.label}</span>
                      <span className="text-[10px] font-bold tabular-nums flex-shrink-0" style={{ color: c }}>
                        {r.count} <span style={{ color: T.faint }}>({pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: T.panel }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: c }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-[10px]" style={{ color: T.faint }}>—</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY PANEL                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function SummaryPanel({ live, agAvail, agBusy, agBreak, agOffline, breakData, ar }: {
  live: SpLive | null; agAvail: number; agBusy: number; agBreak: number; agOffline: number;
  breakData: BreakTracker | null; ar: boolean;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  if (!live) return (
    <div className="flex flex-col items-center justify-center h-full py-16 text-center">
      <WifiOff size={36} className="mb-3" style={{ color: T.faint }} />
      <p className="text-sm font-medium mb-1" style={{ color: tsColor(dark) }}>
        {ar ? 'لا توجد بيانات من سبرينكلر' : 'No Sprinklr data'}
      </p>
      <p className="text-xs" style={{ color: T.faint }}>
        {ar ? 'تأكد أن إضافة WFM Bridge نشطة في سبرينكلر' : 'Make sure WFM Bridge is active in Sprinklr'}
      </p>
    </div>
  );

  const total = agAvail + agBusy + agBreak + agOffline || 1;

  return (
    <div>
      <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: T.faint }}>
        <ArrowRight size={11} />
        {ar ? 'اختر طابوراً لعرض تفاصيله والـ Overflow' : 'Select a queue for details & overflow'}
      </p>

      {/* Agent bar */}
      <div className="rounded-2xl overflow-hidden mb-4"
        style={{ border: `1px solid ${T.bdr}` }}>
        <div className="px-3 py-2" style={{ background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
          <span className="text-xs font-semibold" style={{ color: tsColor(dark) }}>
            {ar ? 'توزيع الإيجنت' : 'Agent Distribution'}
          </span>
        </div>
        <div className="px-3 py-3">
          <div className="flex h-5 rounded-lg overflow-hidden mb-2 gap-px">
            {[
              { val: agAvail,   color: '#22c55e' },
              { val: agBusy,    color: '#f59e0b' },
              { val: agBreak,   color: '#818cf8' },
              { val: agOffline, color: '#1e293b' },
            ].map((item, i) => {
              const pct = (item.val / total) * 100;
              return pct > 0 ? (
                <div key={i} title={`${item.val}`}
                  className="flex items-center justify-center text-[10px] font-bold transition-all"
                  style={{ width: `${pct}%`, background: item.color, color: '#000', opacity: 0.85 }}>
                  {pct > 9 ? item.val : ''}
                </div>
              ) : null;
            })}
          </div>
          <div className="flex justify-between text-[10px]">
            <span style={{ color: '#22c55e' }}>{agAvail} {ar ? 'متاح' : 'Avail'}</span>
            <span style={{ color: '#f59e0b' }}>{agBusy} {ar ? 'مشغول' : 'Busy'}</span>
            <span style={{ color: '#818cf8' }}>{agBreak} {ar ? 'برك' : 'Break'}</span>
            <span style={{ color: T.faint }}>{agOffline} {ar ? 'أوف' : 'Off'}</span>
          </div>
        </div>
      </div>

      {/* Unauthorized breaks */}
      {breakData && breakData.unauthorizedCount > 0 && (
        <div className="rounded-xl p-3 mb-3 flex items-start gap-2"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={13} style={{ color: '#f87171' }} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold" style={{ color: '#f87171' }}>
              {breakData.unauthorizedCount} {ar ? 'إيجنت في استراحة غير مرخّصة' : 'agents on unauthorized break'}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: T.faint }}>
              {ar ? 'انتقل لتبويب البريكات لعرض التفاصيل' : 'Go to Breaks tab for details'}
            </p>
          </div>
        </div>
      )}

      {/* On break now */}
      {breakData && breakData.onBreakNow.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-3"
          style={{ border: '1px solid rgba(129,140,248,0.2)' }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: 'rgba(129,140,248,0.06)', borderBottom: '1px solid rgba(129,140,248,0.12)' }}>
            <Coffee size={11} style={{ color: '#a5b4fc' }} />
            <span className="text-xs font-semibold" style={{ color: '#a5b4fc' }}>
              {ar ? 'في الاستراحة الآن' : 'On Break Now'} ({breakData.onBreakNow.length})
            </span>
          </div>
          <div>
            {breakData.onBreakNow.slice(0, 6).map(a => {
              const hist = breakData.agentHistory.find(h => h.agentId === a.agentId) ?? null;
              return <AgentRow key={a.agentId} agent={a} showBreakInfo breakHistory={hist} ar={ar} />;
            })}
            {breakData.onBreakNow.length > 6 && (
              <div className="text-center py-1.5 text-[10px]" style={{ color: T.faint }}>
                +{breakData.onBreakNow.length - 6} {ar ? 'أكثر' : 'more'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active permissions */}
      {breakData && breakData.activePermissions.length > 0 && (
        <div className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(251,191,36,0.2)' }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.12)' }}>
            <Shield size={11} style={{ color: '#fbbf24' }} />
            <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>
              {ar ? 'استئذانات نشطة الآن' : 'Active Permissions'} ({breakData.activePermissions.length})
            </span>
          </div>
          {breakData.activePermissions.slice(0, 5).map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2"
              style={{ borderBottom: i < Math.min(4, breakData.activePermissions.length - 1) ? `1px solid ${T.bdr}` : 'none' }}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: tp(dark) }}>{p.employee_name}</div>
                <div className="text-[10px]" style={{ color: tsColor(dark) }}>
                  {fmtTime(p.starts_at)} – {fmtTime(p.ends_at)}
                  {p.function_name ? ` · ${p.function_name}` : ''}
                </div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                {ar ? 'مرخّص' : 'Auth'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  BREAKS PANEL                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function BreaksPanel({ breakData, ar }: { breakData: BreakTracker | null; ar: boolean }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const [sort, setSort] = useState<'breaks' | 'time' | 'name'>('breaks');
  const [showAvail, setShowAvail] = useState(false);
  const history = [...(breakData?.agentHistory ?? [])].sort((a, b) =>
    sort === 'breaks' ? b.breakCount - a.breakCount
    : sort === 'time' ? b.totalBreakMinutes - a.totalBreakMinutes
    : a.name.localeCompare(b.name),
  );
  const onBreak   = breakData?.onBreakNow ?? [];
  const available = breakData?.availableNow ?? [];

  return (
    <div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: ar ? 'في استراحة الآن' : 'On Break Now', val: onBreak.length, color: '#818cf8' },
          { label: ar ? 'مرخّص'           : 'Authorized',   val: breakData?.authorizedCount ?? 0,   color: '#22c55e' },
          { label: ar ? 'غير مرخّص'       : 'Unauthorized', val: breakData?.unauthorizedCount ?? 0,  color: '#ef4444' },
          { label: ar ? 'متاحين الآن'     : 'Available Now', val: available.length, color: '#06b6d4' },
        ].map(item => (
          <div key={item.label} className="rounded-2xl p-3 text-center"
            style={{ background: `${item.color}08`, border: `1px solid ${item.color}22` }}>
            <div className="text-2xl font-bold" style={{ color: item.color }}>{item.val}</div>
            <div className="text-[10px] mt-1" style={{ color: T.faint }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* ── LIVE: who is on break right now — name, function, started, duration ── */}
      {onBreak.length > 0 && (
        <div className="mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
          {onBreak.map(a => {
            const over = (a.minutesSoFar ?? 0) > 30;
            const c = !a.isAuthorized ? '#ef4444' : over ? '#f59e0b' : '#818cf8';
            return (
              <div key={a.agentId} className="rounded-2xl p-3"
                style={{ background: `${c}0a`, border: `1px solid ${c}33`, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, bottom: 0, width: 3, background: c }} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold truncate" style={{ color: tp(dark) }}>
                      {a.employeeName || a.agentName}
                    </div>
                    <div className="text-[9.5px] mt-0.5" style={{ color: tsColor(dark) }}>
                      {a.functionName || (ar ? 'وظيفة غير مرتبطة' : 'Unlinked function')}
                      {a.employeeNo ? ` · #${a.employeeNo}` : ''}
                    </div>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: `${c}1c`, color: c }}>
                    {a.statusRaw || (ar ? 'استراحة' : 'Break')}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2.5">
                  <span className="text-[10px] tabular-nums flex items-center gap-1" style={{ color: tsColor(dark) }}>
                    <Clock size={10} /> {ar ? 'بدأ' : 'Since'} {fmtTime(a.breakStartedAt ?? a.lastBreakStart)}
                  </span>
                  {a.minutesSoFar != null && (
                    <span className="text-[13px] font-black tabular-nums" style={{ color: c }}>
                      {fmtMin(a.minutesSoFar)} {over ? '⚠' : ''}
                    </span>
                  )}
                  <span className="text-[9px] font-bold ms-auto px-1.5 py-0.5 rounded"
                    style={{
                      background: a.isAuthorized ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                      color: a.isAuthorized ? '#4ade80' : '#f87171',
                    }}>
                    {a.isAuthorized
                      ? (a.authSource === 'break_management' ? (ar ? '✓ بريك مجدول' : '✓ Scheduled') : (ar ? '✓ استئذان' : '✓ Permission'))
                      : (ar ? '✗ بدون إذن' : '✗ No approval')}
                  </span>
                </div>
                {a.breakCount > 1 && (
                  <div className="text-[9px] mt-1.5" style={{ color: tsColor(dark) }}>
                    {ar ? `البريك رقم ${a.breakCount} اليوم — المجموع ${fmtMin(a.totalBreakMinutes)}`
                        : `Break #${a.breakCount} today — total ${fmtMin(a.totalBreakMinutes)}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Available now board (collapsible) ── */}
      {available.length > 0 && (
        <div className="rounded-2xl mb-4 overflow-hidden" style={{ border: '1px solid rgba(6,182,212,0.2)', background: 'rgba(6,182,212,0.03)' }}>
          <button onClick={() => setShowAvail(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-start">
            <UserCheck size={12} style={{ color: '#22d3ee' }} />
            <span className="text-xs font-bold" style={{ color: '#22d3ee' }}>
              {ar ? `المتاحين الآن (${available.length})` : `Available Now (${available.length})`}
            </span>
            <span className="ms-auto text-[10px]" style={{ color: T.faint }}>{showAvail ? '▲' : '▼'}</span>
          </button>
          {showAvail && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              {available.map(a => (
                <span key={a.agentId} className="text-[10px] px-2.5 py-1 rounded-xl"
                  style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.18)', color: '#a5f3fc' }}>
                  {a.employeeName || a.agentName}
                  {a.functionName ? <span style={{ color: '#155e75' }}> · {a.functionName}</span> : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {history.length > 0 ? (
        <div className="rounded-2xl overflow-hidden"
          style={{ border: `1px solid ${T.bdr}` }}>
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap"
            style={{ background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
            <span className="text-xs font-semibold me-auto" style={{ color: tsColor(dark) }}>
              {ar ? 'تاريخ الاستراحات اليوم' : "Today's Break History"}
            </span>
            {([['breaks', ar ? 'عدد' : 'Count'], ['time', ar ? 'وقت' : 'Time'], ['name', ar ? 'اسم' : 'Name']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)}
                className="text-[10px] px-2 py-0.5 rounded-lg"
                style={{ background: sort === k ? 'rgba(99,102,241,0.2)' : 'transparent', color: sort === k ? '#818cf8' : T.faint }}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid text-[10px] font-semibold px-3 py-1.5"
            style={{ gridTemplateColumns: '1fr 55px 75px 75px 55px', color: T.faint, background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
            <span>{ar ? 'الإيجنت' : 'Agent'}</span>
            <span className="text-center">{ar ? 'مرات' : 'Times'}</span>
            <span className="text-center">{ar ? 'مجموع' : 'Total'}</span>
            <span className="text-center">{ar ? 'آخر برك' : 'Last'}</span>
            <span className="text-center">{ar ? 'الآن' : 'Now'}</span>
          </div>
          <div className="max-h-96 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {history.map((a, i) => {
              const isOnBreak = breakData?.onBreakNow.some(b => b.agentId === a.agentId);
              const isUnauth  = breakData?.onBreakNow.find(b => b.agentId === a.agentId && !b.isAuthorized);
              return (
                <div key={a.agentId} className="grid items-center px-3 py-2 text-xs hover:bg-white/[0.02]"
                  style={{
                    gridTemplateColumns: '1fr 55px 75px 75px 55px',
                    borderBottom: i < history.length - 1 ? `1px solid ${T.bdr}` : 'none',
                    background: isUnauth ? 'rgba(239,68,68,0.03)' : 'transparent',
                  }}>
                  <span className="font-medium truncate" style={{ color: tp(dark) }}>{a.name}</span>
                  <span className="text-center font-bold"
                    style={{ color: a.breakCount > 3 ? '#f87171' : a.breakCount > 1 ? '#fbbf24' : tsColor(dark) }}>
                    {a.breakCount}
                  </span>
                  <span className="text-center tabular-nums"
                    style={{ color: a.totalBreakMinutes > 60 ? '#f87171' : tsColor(dark) }}>
                    {a.totalBreakMinutes > 0 ? fmtMin(a.totalBreakMinutes) : '—'}
                  </span>
                  <span className="text-center tabular-nums" style={{ color: T.faint }}>
                    {(() => {
                      const last = a.breaks?.[a.breaks.length - 1];
                      if (isOnBreak && a.lastBreakStart) return `${fmtTime(a.lastBreakStart)} → …`;
                      if (last) return `${fmtTime(last.start)} → ${fmtTime(last.end)}`;
                      return a.lastBreakStart ? fmtTime(a.lastBreakStart) : '—';
                    })()}
                  </span>
                  <span className="text-center">
                    {isOnBreak ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: isUnauth ? 'rgba(239,68,68,0.15)' : 'rgba(129,140,248,0.15)', color: isUnauth ? '#f87171' : '#a5b4fc' }}>
                        {isUnauth ? '⚠' : '●'}
                      </span>
                    ) : <span style={{ color: T.faint }}>—</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState icon={<Coffee size={28} />}
          title={ar ? 'لا يوجد تاريخ استراحات' : 'No break history'}
          sub={ar ? 'يحتاج وقتاً لتجميع البيانات من سبرينكلر' : 'Needs time to accumulate Sprinklr data'} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PERMISSIONS PANEL                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function PermissionsPanel({ breakData, ar }: { breakData: BreakTracker | null; ar: boolean }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const perms = breakData?.activePermissions ?? [];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl p-4 text-center"
          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <div className="text-3xl font-bold" style={{ color: '#fbbf24' }}>{perms.length}</div>
          <div className="text-xs mt-1" style={{ color: T.faint }}>{ar ? 'استئذان نشط الآن' : 'Active Permissions'}</div>
        </div>
        <div className="rounded-2xl p-4 text-center"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="text-3xl font-bold" style={{ color: '#f87171' }}>{perms.length}</div>
          <div className="text-xs mt-1" style={{ color: T.faint }}>{ar ? 'إيجنت خارج الطابور' : 'Agents off-desk'}</div>
        </div>
      </div>
      {perms.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={28} />}
          title={ar ? 'لا توجد استئذانات نشطة' : 'No active permissions'}
          sub={ar ? 'جميع الإيجنت على الجدول' : 'All agents on schedule'} />
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.bdr}` }}>
          <div className="grid text-[10px] font-semibold px-3 py-2"
            style={{ gridTemplateColumns: '1fr 90px 110px 70px', color: T.faint, background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
            <span>{ar ? 'الموظف' : 'Employee'}</span>
            <span>{ar ? 'القسم' : 'Function'}</span>
            <span>{ar ? 'الوقت' : 'Time'}</span>
            <span>{ar ? 'السبب' : 'Reason'}</span>
          </div>
          {perms.map((p, i) => (
            <div key={p.id} className="grid items-center px-3 py-2"
              style={{ gridTemplateColumns: '1fr 90px 110px 70px', borderBottom: i < perms.length - 1 ? `1px solid ${T.bdr}` : 'none' }}>
              <div>
                <div className="text-xs font-medium truncate" style={{ color: tp(dark) }}>{p.employee_name}</div>
                <div className="text-[10px]" style={{ color: T.faint }}>{p.employee_no}</div>
              </div>
              <div className="text-[10px] truncate" style={{ color: tsColor(dark) }}>{p.function_name || '—'}</div>
              <div className="text-[10px]" style={{ color: tsColor(dark) }}>{fmtTime(p.starts_at)} – {fmtTime(p.ends_at)}</div>
              <div className="text-[10px] truncate" style={{ color: tsColor(dark) }}>{p.reason || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COVERAGE PANEL                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function CoveragePanel({ coverage, live, ar }: { coverage: Coverage | null; live: SpLive | null; ar: boolean }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const lsp = coverage?.liveSprinklr ?? (live ? {
    available:    (live.agents).filter(a => a.status === 'available').length,
    busy:         (live.agents).filter(a => a.status === 'busy').length,
    onBreak:      (live.agents).filter(a => a.status === 'break' || a.status === 'away').length,
    offline:      (live.agents).filter(a => a.status === 'offline' || a.status === 'unknown').length,
    totalLoggedIn: (live.agents).filter(a => a.status !== 'offline' && a.status !== 'unknown').length,
  } : null);

  return (
    <div>
      {lsp && (
        <div className="rounded-2xl p-4 mb-4"
          style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.15)' }}>
          <p className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: '#22d3ee' }}>
            <Activity size={12} />{ar ? 'القوى العاملة الحية (سبرينكلر)' : 'Live HC from Sprinklr'}
          </p>
          <div className="grid grid-cols-5 gap-2">
            {[
              { l: ar ? 'مسجّل' : 'Logged In', v: lsp.totalLoggedIn, c: '#22d3ee' },
              { l: ar ? 'متاح'  : 'Available', v: lsp.available,     c: '#22c55e' },
              { l: ar ? 'مشغول' : 'Busy',      v: lsp.busy,          c: '#f59e0b' },
              { l: ar ? 'برك'   : 'Break',     v: lsp.onBreak,       c: '#818cf8' },
              { l: ar ? 'أوف'   : 'Offline',   v: lsp.offline,       c: T.faint },
            ].map(item => (
              <div key={item.l} className="text-center">
                <div className="text-xl font-bold tabular-nums" style={{ color: item.c }}>{item.v}</div>
                <div className="text-[10px] mt-0.5" style={{ color: T.faint }}>{item.l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {coverage?.attendance && (
        <div className="rounded-2xl p-4 mb-4"
          style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
          <p className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: tsColor(dark) }}>
            <BarChart3 size={12} />{ar ? 'الجدول مقابل الفعلي' : 'Schedule vs Actual'}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { l: ar ? 'مجدول' : 'Scheduled',  v: +(coverage.attendance.total_scheduled ?? 0), c: '#818cf8' },
              { l: ar ? 'بصمة دخول' : 'Punched In', v: +(coverage.attendance.punched_in ?? 0),  c: '#22c55e' },
              { l: ar ? 'باستئذان' : 'Permission', v: coverage.onPermission,                      c: '#fbbf24' },
            ].map(item => (
              <div key={item.l} className="text-center py-2 rounded-xl"
                style={{ background: `${item.c}08`, border: `1px solid ${item.c}18` }}>
                <div className="text-2xl font-bold tabular-nums" style={{ color: item.c }}>{item.v}</div>
                <div className="text-[10px] mt-1" style={{ color: T.faint }}>{item.l}</div>
              </div>
            ))}
          </div>
          {+coverage.attendance.total_scheduled > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] mb-1" style={{ color: T.faint }}>
                <span>{ar ? 'نسبة الحضور' : 'Attendance Rate'}</span>
                <span style={{ color: pctColor(Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100)) }}>
                  {Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.panel }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100))}%`, background: pctColor(Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100)) }} />
              </div>
            </div>
          )}
        </div>
      )}

      {coverage?.intervals && coverage.intervals.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.bdr}` }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
            <Timer size={12} style={{ color: tsColor(dark) }} />
            <span className="text-xs font-semibold" style={{ color: tsColor(dark) }}>
              {ar ? 'مقارنة HC بالفترات' : 'HC by Interval'}
            </span>
          </div>
          <div className="grid text-[10px] font-semibold px-3 py-1.5"
            style={{ gridTemplateColumns: '55px 1fr 1fr 1fr 55px', color: T.faint, background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
            <span>{ar ? 'الوقت' : 'Time'}</span>
            <span className="text-center">{ar ? 'مطلوب' : 'Req'}</span>
            <span className="text-center">{ar ? 'مجدول' : 'Sched'}</span>
            <span className="text-center">{ar ? 'حي' : 'Live'}</span>
            <span className="text-center">{ar ? 'فرق' : 'Gap'}</span>
          </div>
          <div className="max-h-56 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {coverage.intervals.map((iv, i) => {
              const gap = iv.live_hc - iv.required_hc;
              const gc = gap >= 0 ? '#22c55e' : gap >= -2 ? '#fbbf24' : '#f87171';
              return (
                <div key={i} className="grid items-center px-3 py-1.5 text-xs"
                  style={{ gridTemplateColumns: '55px 1fr 1fr 1fr 55px', borderBottom: i < coverage.intervals.length - 1 ? `1px solid ${T.bdr}` : 'none', background: gap < -2 ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                  <span className="font-mono text-[10px]" style={{ color: tsColor(dark) }}>{iv.interval_start.slice(0, 5)}</span>
                  <span className="text-center" style={{ color: tsColor(dark) }}>{iv.required_hc}</span>
                  <span className="text-center" style={{ color: tsColor(dark) }}>{iv.scheduled_hc}</span>
                  <span className="text-center font-semibold" style={{ color: '#22d3ee' }}>{iv.live_hc || '—'}</span>
                  <span className="text-center font-bold" style={{ color: gc }}>
                    {iv.live_hc > 0 ? (gap > 0 ? `+${gap}` : gap) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!coverage && !lsp && (
        <EmptyState icon={<BarChart3 size={28} />}
          title={ar ? 'لا توجد بيانات تغطية' : 'No coverage data'}
          sub={ar ? 'استورد الجدول وبيانات الحضور' : 'Import schedule and attendance data'} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  AGENT HOURS PANEL                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function AgentHoursPanel({ timeline, liveAgents, ar }: {
  timeline: AgentTimeline[]; liveAgents: SpAgent[]; ar: boolean;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const [sort, setSort] = useState<'working' | 'util' | 'break' | 'idle' | 'name'>('working');

  // Build a quick lookup: agent name → current live status
  const liveStatusMap = new Map<string, SpAgent['status']>();
  liveAgents.forEach(a => liveStatusMap.set(a.agentName.toLowerCase(), a.status));

  const getLiveStatus = (name: string) => liveStatusMap.get(name.toLowerCase());

  const sorted = [...timeline].sort((a, b) =>
    sort === 'working' ? b.workingMinutes - a.workingMinutes
    : sort === 'util'  ? b.utilizationPct - a.utilizationPct
    : sort === 'break' ? b.breakMinutes - a.breakMinutes
    : sort === 'idle'  ? (b.statusMinutes?.idle ?? 0) - (a.statusMinutes?.idle ?? 0)
    : a.name.localeCompare(b.name),
  );

  if (!timeline.length) return (
    <EmptyState icon={<Timer size={28} />}
      title={ar ? 'لا توجد بيانات ساعات عمل' : 'No working hours data'}
      sub={ar ? 'يحتاج 30 دقيقة من بيانات سبرينكلر' : 'Requires 30+ min of Sprinklr data'} />
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs" style={{ color: T.faint }}>
          {ar ? `${timeline.length} إيجنت · آخر 10 ساعات` : `${timeline.length} agents · last 10h`}
        </p>
        <div className="flex gap-1">
          {([
            ['working', ar ? 'عمل'   : 'Work'],
            ['idle',    ar ? 'خامل'  : 'Idle'],
            ['break',   ar ? 'برك'   : 'Break'],
            ['util',    ar ? 'كفاءة' : 'Util'],
            ['name',    ar ? 'اسم'   : 'Name'],
          ] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)}
              className="text-[10px] px-2 py-0.5 rounded-lg"
              style={{
                background: sort === k ? (k === 'idle' ? 'rgba(132,204,22,0.15)' : 'rgba(99,102,241,0.2)') : T.panel,
                color:      sort === k ? (k === 'idle' ? '#84cc16' : '#818cf8') : T.faint,
                border:     sort === k ? `1px solid ${k === 'idle' ? 'rgba(132,204,22,0.3)' : 'rgba(99,102,241,0.3)'}` : `1px solid ${T.bdr}`,
              }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.bdr}` }}>
        {/* Header */}
        <div className="grid text-[10px] font-semibold px-3 py-1.5"
          style={{ gridTemplateColumns: '1fr 55px 60px 60px 60px 75px 50px', color: T.faint, background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
          <span>{ar ? 'الإيجنت' : 'Agent'}</span>
          <span className="text-center">{ar ? 'الحالة' : 'Status'}</span>
          <span className="text-center">{ar ? 'عمل' : 'Work'}</span>
          <span className="text-center" style={{ color: '#84cc16' }}>{ar ? 'خامل' : 'Idle'}</span>
          <span className="text-center">{ar ? 'برك' : 'Break'}</span>
          <span className="text-center">{ar ? 'الكفاءة' : 'Util%'}</span>
          <span className="text-center">{ar ? 'دخول' : 'Login'}</span>
        </div>

        {/* Rows */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 440px)', scrollbarWidth: 'thin' }}>
          {sorted.map((a, i) => {
            const utilColor   = a.utilizationPct >= 80 ? '#22c55e' : a.utilizationPct >= 60 ? '#fbbf24' : '#f87171';
            const idleMin     = a.idleMinutes ?? a.statusMinutes?.idle ?? 0;
            const liveStatus  = getLiveStatus(a.name);
            const statusColor = liveStatus ? (ST_COLOR[liveStatus] ?? T.faint) : T.faint;
            const isAvailNow  = liveStatus === 'available' || liveStatus === 'idle';

            return (
              <div key={a.agentId}
                className="grid items-center px-3 py-2 hover:bg-white/[0.02] transition-colors"
                style={{
                  gridTemplateColumns: '1fr 55px 60px 60px 60px 75px 50px',
                  borderBottom: i < sorted.length - 1 ? `1px solid ${T.bdr}` : 'none',
                  background: liveStatus === 'idle' ? 'rgba(132,204,22,0.03)' : 'transparent',
                }}>

                {/* Name */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                  <span className="text-xs font-medium truncate" style={{ color: tp(dark) }}>{a.name}</span>
                </div>

                {/* Live status badge */}
                <div className="flex justify-center">
                  {liveStatus ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                      {stLabel(liveStatus, ar)}
                    </span>
                  ) : <span style={{ color: T.faint }}>—</span>}
                </div>

                {/* Work time */}
                <span className="text-center text-xs font-bold tabular-nums" style={{ color: '#22c55e' }}>
                  {a.workingMinutes > 0 ? fmtMin(a.workingMinutes) : '—'}
                </span>

                {/* Idle time — highlighted when agent is currently available/idle */}
                <span className="text-center text-xs tabular-nums font-medium"
                  style={{ color: idleMin > 0 ? (isAvailNow ? '#84cc16' : '#4d7c0f') : T.faint }}>
                  {idleMin > 0 ? fmtMin(idleMin) : '—'}
                </span>

                {/* Break time */}
                <span className="text-center text-xs tabular-nums"
                  style={{ color: a.breakMinutes > 60 ? '#f87171' : T.faint }}>
                  {a.breakMinutes > 0 ? fmtMin(a.breakMinutes) : '—'}
                </span>

                {/* Utilization */}
                <div className="flex items-center gap-1.5 justify-center">
                  {a.totalTrackedMinutes > 0 ? (
                    <>
                      <div className="flex-1 max-w-10 h-1.5 rounded-full overflow-hidden"
                        style={{ background: T.panel }}>
                        <div className="h-full rounded-full" style={{ width: `${a.utilizationPct}%`, background: utilColor }} />
                      </div>
                      <span className="text-[10px] font-bold" style={{ color: utilColor }}>{a.utilizationPct}%</span>
                    </>
                  ) : <span style={{ color: T.faint }}>—</span>}
                </div>

                {/* Login time */}
                <span className="text-center text-[10px]" style={{ color: T.faint }}>
                  {fmtTime(a.loginTime ?? a.firstSeen)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
