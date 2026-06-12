import {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import {
  Radio, RefreshCw, UserCheck, Clock,
  Loader2, WifiOff, Activity, Shield, TrendingUp,
  MessageSquare, Mail, Phone, Hash, Users, X,
  AlertTriangle, CheckCircle2, Coffee,
  ArrowRight, BarChart3, Zap, Timer,
  ArrowLeftRight, Shuffle,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { fmtDuration, fmtDateTimeTime } from '@/utils/format';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface SpQueue {
  queueId: string; queueName: string;
  channel: 'whatsapp' | 'chat' | 'email' | 'social' | 'voice' | 'unknown';
  waiting: number; inProgress: number; backlog: number;
  avgWaitSeconds: number; slaBreached: number; slaPct: number;
  agentsAvailable: number; agentsBusy: number; agentsBreak: number; aht: number;
}
interface SpAgent {
  agentId: string; agentName: string;
  status: 'available' | 'idle' | 'busy' | 'break' | 'away' | 'offline' | 'unknown';
  currentChannel: string; queueId: string; loginTime: string;
}
interface SpLive {
  capturedAt: string; staleSec: number; isStale: boolean;
  summary: { totalWaiting: number; totalInProgress: number; totalAvailable: number; totalBusy: number; avgSla: number };
  atRisk: SpQueue[]; queues: SpQueue[]; agents: SpAgent[];
}
interface BreakAgent {
  agentId: string; agentName: string;
  employeeName: string | null; employeeNo: string | null; functionName: string | null;
  status: string; statusRaw: string;
  breakCount: number; totalBreakMinutes: number;
  lastBreakStart: string | null;
  breaks: { start: string; end: string; minutes: number }[];
  currentlyBreaking?: boolean;
  breakStartedAt?: string | null; minutesSoFar?: number | null;
  isAuthorized?: boolean; authSource?: 'break_management' | 'permission' | null;
}
interface BreakTracker {
  capturedAt: string | null; isStale?: boolean;
  onBreakNow: BreakAgent[];
  availableNow?: BreakAgent[]; busyNow?: BreakAgent[];
  unauthorizedCount: number; authorizedCount: number;
  breakMgmtActiveRequests?: number;
  agentHistory: AgentBreakHistory[];
  activePermissions: ActivePermission[];
}
interface AgentBreakHistory {
  agentId: string; name: string; breakCount: number;
  totalBreakMinutes: number; currentlyBreaking: boolean;
  loginTime: string | null; lastBreakStart?: string | null;
  breaks: { start: string; end: string; minutes: number }[];
}
interface ActivePermission {
  id: string; employee_name: string; employee_no: string;
  starts_at: string; ends_at: string; reason: string; function_name: string;
}
interface AgentTimeline {
  agentId: string; name: string; loginTime: string | null;
  firstSeen: string; lastSeen: string;
  workingMinutes: number; idleMinutes?: number; busyMinutes?: number; breakMinutes: number;
  totalTrackedMinutes: number; utilizationPct: number;
  statusMinutes: Record<string, number>;
}
interface QueueDetail {
  queue: SpQueue; agents: SpAgent[]; overflow: SpAgent[];
  capturedAt: string; staleSec: number;
}
interface Coverage {
  intervals: { interval_start: string; required_hc: number; scheduled_hc: number; live_hc: number }[];
  attendance: { punched_in: number; total_scheduled: number };
  onPermission: number;
  liveSprinklr: { available: number; busy: number; onBreak: number; offline: number; totalLoggedIn: number } | null;
  capturedAt: string | null;
}

/* ── Incident / Unauthorized Break Types ───────────────────────────────────── */
interface IncidentReport {
  employeeId: string; employeeName: string;
  incidentType: 'unauthorized_break' | 'status_change_no_approval';
  occurredAt: string; durationMinutes: number;
  severity: 'low' | 'medium' | 'high'; notes: string;
}

/* ── Cross-Skill Types ──────────────────────────────────────────────────────── */
interface CrossSkillCandidate {
  employeeId: string; name: string; function: string; proficiency: string;
}
interface SkillDispatchForm {
  employeeId: string; employeeName: string;
  fromFunction: string; toFunction: string;
  skillCode: string; startAt: string; endAt: string; reason: string;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const CH_COLOR: Record<string, string> = {
  whatsapp: '#25d366', chat: '#818cf8', email: '#38bdf8',
  social: '#ec4899', voice: '#22c55e', unknown: '#64748b',
};
const CH_ICON: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare size={12} />, chat: <MessageSquare size={12} />,
  email: <Mail size={12} />, social: <Hash size={12} />,
  voice: <Phone size={12} />, unknown: <Activity size={12} />,
};
const ST_COLOR: Record<string, string> = {
  available: '#22c55e', idle: '#84cc16', busy: '#f59e0b',
  break: '#818cf8', away: '#818cf8', offline: '#475569', unknown: '#475569',
};
const slaColor = (p: number) => p >= 85 ? '#22c55e' : p >= 70 ? '#f59e0b' : '#ef4444';
const pctColor = (p: number) => p >= 80 ? '#34d399' : p >= 60 ? '#fbbf24' : '#f87171';
const fmtNum = (n: number) => n.toLocaleString('en-US');
const fmtMin  = (m: number, ar?: boolean) => fmtDuration(m, ar);
const fmtTime = (iso: string | null, ar?: boolean) => fmtDateTimeTime(iso ?? undefined, ar);
const stLabel = (s: string, ar: boolean) => ({
  available: ar ? 'متاح' : 'Available', idle: ar ? 'خامل' : 'Idle',
  busy: ar ? 'مشغول' : 'Busy',
  break: ar ? 'استراحة' : 'Break', away: ar ? 'استراحة' : 'Away',
  offline: ar ? 'غير متاح' : 'Offline', unknown: ar ? 'غير معروف' : 'Unknown',
}[s] ?? s);

/* ── KPI Card ───────────────────────────────────────────────────────────────── */
function KpiCard({ label, val, color, icon: Icon, sub }: {
  label: string; val: string | number; color: string; icon: any; sub?: string;
}) {
  return (
    <div className="rounded-2xl p-3.5 flex flex-col items-center gap-1"
      style={{ background: `${color}08`, border: `1px solid ${color}22` }}>
      <Icon size={14} style={{ color }} />
      <span className="text-xl font-bold tabular-nums leading-none" style={{ color }}>
        {typeof val === 'number' ? fmtNum(val) : val}
      </span>
      <span className="text-[10px] text-center leading-tight" style={{ color: '#475569' }}>{label}</span>
      {sub && <span className="text-[9px]" style={{ color: '#ef4444' }}>{sub}</span>}
    </div>
  );
}

/* ── Queue Grid Card ─────────────────────────────────────────────────────── */
function QueueCard({ q, selected, onClick }: { q: SpQueue; selected: boolean; onClick: () => void }) {
  const risk = (q.slaPct ?? 100) < 80 || q.waiting > 50;
  const chColor = CH_COLOR[q.channel] || '#64748b';
  const total = Math.max(1, q.waiting + q.inProgress);
  return (
    <button onClick={onClick}
      className="text-start transition-all w-full"
      style={{
        background: selected
          ? `linear-gradient(135deg, ${chColor}22 0%, ${chColor}0a 100%)`
          : risk ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.03)',
        border: selected
          ? `1.5px solid ${chColor}55`
          : risk ? '1px solid rgba(239,68,68,0.22)' : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        padding: '11px 13px',
        boxShadow: selected ? `0 0 0 3px ${chColor}18` : 'none',
        position: 'relative',
        overflow: 'hidden',
      }}>
      {/* top glow strip when selected */}
      {selected && (
        <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 2, background: `linear-gradient(90deg, ${chColor}, transparent)`, borderRadius: '14px 14px 0 0' }} />
      )}

      {/* Row 1: icon + name + SLA */}
      <div className="flex items-start gap-1.5 mb-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: `${chColor}22`, color: chColor }}>
          {CH_ICON[q.channel]}
        </span>
        <span className="text-xs font-semibold leading-tight flex-1 min-w-0"
          style={{ color: selected ? '#f1f5f9' : '#94a3b8', wordBreak: 'break-word' }}>
          {q.queueName}
        </span>
      </div>

      {/* Row 2: big waiting + stats */}
      <div className="flex items-end gap-3 mb-2">
        <div>
          <div className="text-2xl font-black tabular-nums leading-none"
            style={{ color: q.waiting > 0 ? (risk ? '#f87171' : '#fbbf24') : '#334155' }}>
            {fmtNum(q.waiting)}
          </div>
          <div className="text-[9px] mt-0.5" style={{ color: '#334155' }}>انتظار</div>
        </div>
        <div className="flex gap-3 mb-0.5 ms-auto">
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: '#818cf8' }}>{q.inProgress}</div>
            <div className="text-[9px]" style={{ color: '#334155' }}>نشط</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: '#22c55e' }}>{q.agentsAvailable}</div>
            <div className="text-[9px]" style={{ color: '#334155' }}>متاح</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: slaColor(q.slaPct ?? 100) }}>{q.slaPct ?? 100}%</div>
            <div className="text-[9px]" style={{ color: '#334155' }}>SLA</div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, (q.waiting / total) * 100)}%`, background: risk ? '#ef4444' : chColor }} />
      </div>
    </button>
  );
}

/* ── Agent Row ───────────────────────────────────────────────────────────── */
function AgentRow({ agent, showBreakInfo, breakHistory, ar }: {
  agent: SpAgent | BreakAgent; showBreakInfo?: boolean;
  breakHistory?: AgentBreakHistory | null; ar: boolean;
}) {
  const color = ST_COLOR[agent.status] || '#64748b';
  const ba = agent as BreakAgent;
  return (
    <div className="flex items-center gap-2.5 py-2 px-3"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-xs font-medium flex-1 truncate" style={{ color: '#cbd5e1' }}>{agent.agentName}</span>
      {showBreakInfo && (
        <>
          <span className="text-[10px] px-1.5 py-0.5 rounded-lg"
            style={{ background: 'rgba(129,140,248,0.12)', color: '#a5b4fc' }}>
            {breakHistory?.breakCount ?? ba.breakCount ?? 0}×
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>
            {fmtMin(breakHistory?.totalBreakMinutes ?? ba.totalBreakMinutes ?? 0)}
          </span>
          {ba.isAuthorized !== undefined && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-lg"
              style={{
                background: ba.isAuthorized ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.12)',
                color: ba.isAuthorized ? '#4ade80' : '#f87171',
              }}>
              {ba.isAuthorized ? (ar ? '✓ مرخّص' : '✓ Auth') : (ar ? '⚠ غير مرخّص' : '⚠ Unauth')}
            </span>
          )}
        </>
      )}
      <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ background: `${color}18`, color }}>{stLabel(agent.status, ar)}</span>
    </div>
  );
}

/* ── Empty State ──────────────────────────────────────────────────────────── */
function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
        style={{ background: 'rgba(100,116,139,0.08)', color: '#334155' }}>
        {icon}
      </div>
      <p className="text-sm font-medium mb-1" style={{ color: '#475569' }}>{title}</p>
      <p className="text-xs" style={{ color: '#334155' }}>{sub}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  QUEUE DETAIL PANEL                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
function QueueDetailPanel({ q, detail, agents, breakData, ar, onClose }: {
  q: SpQueue; detail: QueueDetail | null; agents: SpAgent[];
  breakData: BreakTracker | null; ar: boolean; onClose: () => void;
}) {
  const chColor = CH_COLOR[q.channel] || '#64748b';
  const queueAgents = useMemo(() =>
    detail?.agents.length ? detail.agents : agents.filter(a => a.queueId === q.queueId),
    [detail, agents, q.queueId]);
  const overflow = detail?.overflow ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${chColor}18`, color: chColor }}>
          {CH_ICON[q.channel]}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold truncate" style={{ color: '#e2e8f0' }}>{q.queueName}</h2>
          <p className="text-[10px] capitalize" style={{ color: '#475569' }}>{q.channel}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <X size={14} style={{ color: '#64748b' }} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <KpiCard label={ar ? 'انتظار'  : 'Waiting'}   val={q.waiting}         color="#f59e0b" icon={Clock} />
        <KpiCard label={ar ? 'جارية'   : 'Active'}    val={q.inProgress}      color="#818cf8" icon={Activity} />
        <KpiCard label={ar ? 'متاح'    : 'Available'} val={q.agentsAvailable} color="#22c55e" icon={UserCheck} />
        <KpiCard label="SLA"                           val={`${q.slaPct ?? 100}%`} color={slaColor(q.slaPct ?? 100)} icon={TrendingUp} />
      </div>

      {/* Extra */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { l: ar ? 'وقت انتظار' : 'Avg Wait', v: q.avgWaitSeconds > 0 ? `${Math.round(q.avgWaitSeconds / 60)}د` : '—', c: '#64748b' },
          { l: 'AHT',                           v: q.aht > 0 ? `${Math.round(q.aht / 60)}د` : '—',             c: '#64748b' },
          { l: ar ? 'SLA خُرق' : 'Breached',   v: q.slaBreached,                                               c: q.slaBreached > 0 ? '#f87171' : '#64748b' },
        ].map(item => (
          <div key={item.l} className="rounded-xl p-2 text-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-sm font-bold" style={{ color: item.c }}>{item.v}</div>
            <div className="text-[10px] mt-0.5" style={{ color: '#334155' }}>{item.l}</div>
          </div>
        ))}
      </div>

      {/* HC breakdown */}
      {queueAgents.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-3"
          style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Users size={11} style={{ color: '#64748b' }} />
            <span className="text-xs font-semibold" style={{ color: '#64748b' }}>
              {ar ? 'إيجنت الطابور' : 'Queue Agents'} ({queueAgents.length})
            </span>
          </div>
          <div className="max-h-44 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {queueAgents.map(a => {
              const hist = breakData?.agentHistory.find(h => h.agentId === a.agentId) ?? null;
              return <AgentRow key={a.agentId} agent={a} breakHistory={hist} showBreakInfo ar={ar} />;
            })}
          </div>
        </div>
      )}

      {/* Overflow */}
      {overflow.length > 0 && (
        <div className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: 'rgba(34,197,94,0.06)', borderBottom: '1px solid rgba(34,197,94,0.12)' }}>
            <Zap size={11} style={{ color: '#4ade80' }} />
            <span className="text-xs font-semibold" style={{ color: '#4ade80' }}>
              {ar ? 'إيجنت overflow متاح' : 'Overflow Available'} ({overflow.length})
            </span>
          </div>
          <div className="p-2 flex flex-wrap gap-1.5">
            {overflow.map(a => (
              <span key={a.agentId} className="text-[11px] px-2.5 py-1 rounded-xl"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)', color: '#86efac' }}>
                {a.agentName}
              </span>
            ))}
          </div>
        </div>
      )}

      {queueAgents.length === 0 && overflow.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: '#334155' }}>
          {ar ? 'لا توجد بيانات إيجنت لهذا الطابور' : 'No agent data for this queue'}
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY PANEL                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
function SummaryPanel({ live, agAvail, agBusy, agBreak, agOffline, breakData, ar }: {
  live: SpLive | null; agAvail: number; agBusy: number; agBreak: number; agOffline: number;
  breakData: BreakTracker | null; ar: boolean;
}) {
  if (!live) return (
    <div className="flex flex-col items-center justify-center h-full py-16 text-center">
      <WifiOff size={36} className="mb-3" style={{ color: '#64748b' }} />
      <p className="text-sm font-medium mb-1" style={{ color: '#94a3b8' }}>
        {ar ? 'لا توجد بيانات من سبرينكلر' : 'No Sprinklr data'}
      </p>
      <p className="text-xs" style={{ color: '#64748b' }}>
        {ar ? 'تأكد أن إضافة WFM Bridge نشطة في سبرينكلر' : 'Make sure WFM Bridge is active in Sprinklr'}
      </p>
    </div>
  );

  const total = agAvail + agBusy + agBreak + agOffline || 1;

  return (
    <div>
      <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: '#334155' }}>
        <ArrowRight size={11} />
        {ar ? 'اختر طابوراً لعرض تفاصيله والـ Overflow' : 'Select a queue for details & overflow'}
      </p>

      {/* Agent bar */}
      <div className="rounded-2xl overflow-hidden mb-4"
        style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-xs font-semibold" style={{ color: '#475569' }}>
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
            <span style={{ color: '#475569' }}>{agOffline} {ar ? 'أوف' : 'Off'}</span>
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
            <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>
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
              <div className="text-center py-1.5 text-[10px]" style={{ color: '#334155' }}>
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
              style={{ borderBottom: i < Math.min(4, breakData.activePermissions.length - 1) ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>{p.employee_name}</div>
                <div className="text-[10px]" style={{ color: '#64748b' }}>
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
function BreaksPanel({ breakData, ar }: { breakData: BreakTracker | null; ar: boolean }) {
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
            <div className="text-[10px] mt-1" style={{ color: '#475569' }}>{item.label}</div>
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
                    <div className="text-[12px] font-bold truncate" style={{ color: '#e2e8f0' }}>
                      {a.employeeName || a.agentName}
                    </div>
                    <div className="text-[9.5px] mt-0.5" style={{ color: '#64748b' }}>
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
                  <span className="text-[10px] tabular-nums flex items-center gap-1" style={{ color: '#94a3b8' }}>
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
                  <div className="text-[9px] mt-1.5" style={{ color: '#64748b' }}>
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
            <span className="ms-auto text-[10px]" style={{ color: '#475569' }}>{showAvail ? '▲' : '▼'}</span>
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
          style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap"
            style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-xs font-semibold me-auto" style={{ color: '#64748b' }}>
              {ar ? 'تاريخ الاستراحات اليوم' : "Today's Break History"}
            </span>
            {([['breaks', ar ? 'عدد' : 'Count'], ['time', ar ? 'وقت' : 'Time'], ['name', ar ? 'اسم' : 'Name']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)}
                className="text-[10px] px-2 py-0.5 rounded-lg"
                style={{ background: sort === k ? 'rgba(99,102,241,0.2)' : 'transparent', color: sort === k ? '#818cf8' : '#475569' }}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid text-[10px] font-semibold px-3 py-1.5"
            style={{ gridTemplateColumns: '1fr 55px 75px 75px 55px', color: '#334155', background: 'rgba(0,0,0,0.1)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
                    borderBottom: i < history.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    background: isUnauth ? 'rgba(239,68,68,0.03)' : 'transparent',
                  }}>
                  <span className="font-medium truncate" style={{ color: '#cbd5e1' }}>{a.name}</span>
                  <span className="text-center font-bold"
                    style={{ color: a.breakCount > 3 ? '#f87171' : a.breakCount > 1 ? '#fbbf24' : '#94a3b8' }}>
                    {a.breakCount}
                  </span>
                  <span className="text-center tabular-nums"
                    style={{ color: a.totalBreakMinutes > 60 ? '#f87171' : '#94a3b8' }}>
                    {a.totalBreakMinutes > 0 ? fmtMin(a.totalBreakMinutes) : '—'}
                  </span>
                  <span className="text-center tabular-nums" style={{ color: '#475569' }}>
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
                    ) : <span style={{ color: '#334155' }}>—</span>}
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
function PermissionsPanel({ breakData, ar }: { breakData: BreakTracker | null; ar: boolean }) {
  const perms = breakData?.activePermissions ?? [];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl p-4 text-center"
          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <div className="text-3xl font-bold" style={{ color: '#fbbf24' }}>{perms.length}</div>
          <div className="text-xs mt-1" style={{ color: '#475569' }}>{ar ? 'استئذان نشط الآن' : 'Active Permissions'}</div>
        </div>
        <div className="rounded-2xl p-4 text-center"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="text-3xl font-bold" style={{ color: '#f87171' }}>{perms.length}</div>
          <div className="text-xs mt-1" style={{ color: '#475569' }}>{ar ? 'إيجنت خارج الطابور' : 'Agents off-desk'}</div>
        </div>
      </div>
      {perms.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={28} />}
          title={ar ? 'لا توجد استئذانات نشطة' : 'No active permissions'}
          sub={ar ? 'جميع الإيجنت على الجدول' : 'All agents on schedule'} />
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="grid text-[10px] font-semibold px-3 py-2"
            style={{ gridTemplateColumns: '1fr 90px 110px 70px', color: '#334155', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span>{ar ? 'الموظف' : 'Employee'}</span>
            <span>{ar ? 'القسم' : 'Function'}</span>
            <span>{ar ? 'الوقت' : 'Time'}</span>
            <span>{ar ? 'السبب' : 'Reason'}</span>
          </div>
          {perms.map((p, i) => (
            <div key={p.id} className="grid items-center px-3 py-2"
              style={{ gridTemplateColumns: '1fr 90px 110px 70px', borderBottom: i < perms.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <div>
                <div className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>{p.employee_name}</div>
                <div className="text-[10px]" style={{ color: '#475569' }}>{p.employee_no}</div>
              </div>
              <div className="text-[10px] truncate" style={{ color: '#64748b' }}>{p.function_name || '—'}</div>
              <div className="text-[10px]" style={{ color: '#94a3b8' }}>{fmtTime(p.starts_at)} – {fmtTime(p.ends_at)}</div>
              <div className="text-[10px] truncate" style={{ color: '#64748b' }}>{p.reason || '—'}</div>
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
function CoveragePanel({ coverage, live, ar }: { coverage: Coverage | null; live: SpLive | null; ar: boolean }) {
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
              { l: ar ? 'أوف'   : 'Offline',   v: lsp.offline,       c: '#475569' },
            ].map(item => (
              <div key={item.l} className="text-center">
                <div className="text-xl font-bold tabular-nums" style={{ color: item.c }}>{item.v}</div>
                <div className="text-[10px] mt-0.5" style={{ color: '#334155' }}>{item.l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {coverage?.attendance && (
        <div className="rounded-2xl p-4 mb-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: '#94a3b8' }}>
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
                <div className="text-[10px] mt-1" style={{ color: '#475569' }}>{item.l}</div>
              </div>
            ))}
          </div>
          {+coverage.attendance.total_scheduled > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] mb-1" style={{ color: '#475569' }}>
                <span>{ar ? 'نسبة الحضور' : 'Attendance Rate'}</span>
                <span style={{ color: pctColor(Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100)) }}>
                  {Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100))}%`, background: pctColor(Math.round((+(coverage.attendance.punched_in ?? 0) / +coverage.attendance.total_scheduled) * 100)) }} />
              </div>
            </div>
          )}
        </div>
      )}

      {coverage?.intervals && coverage.intervals.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Timer size={12} style={{ color: '#64748b' }} />
            <span className="text-xs font-semibold" style={{ color: '#64748b' }}>
              {ar ? 'مقارنة HC بالفترات' : 'HC by Interval'}
            </span>
          </div>
          <div className="grid text-[10px] font-semibold px-3 py-1.5"
            style={{ gridTemplateColumns: '55px 1fr 1fr 1fr 55px', color: '#334155', background: 'rgba(0,0,0,0.1)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
                  style={{ gridTemplateColumns: '55px 1fr 1fr 1fr 55px', borderBottom: i < coverage.intervals.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: gap < -2 ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                  <span className="font-mono text-[10px]" style={{ color: '#64748b' }}>{iv.interval_start.slice(0, 5)}</span>
                  <span className="text-center" style={{ color: '#94a3b8' }}>{iv.required_hc}</span>
                  <span className="text-center" style={{ color: '#94a3b8' }}>{iv.scheduled_hc}</span>
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
function AgentHoursPanel({ timeline, liveAgents, ar }: {
  timeline: AgentTimeline[]; liveAgents: SpAgent[]; ar: boolean;
}) {
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
        <p className="text-xs" style={{ color: '#475569' }}>
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
                background: sort === k ? (k === 'idle' ? 'rgba(132,204,22,0.15)' : 'rgba(99,102,241,0.2)') : 'rgba(255,255,255,0.03)',
                color:      sort === k ? (k === 'idle' ? '#84cc16' : '#818cf8') : '#475569',
                border:     sort === k ? `1px solid ${k === 'idle' ? 'rgba(132,204,22,0.3)' : 'rgba(99,102,241,0.3)'}` : '1px solid rgba(255,255,255,0.06)',
              }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        {/* Header */}
        <div className="grid text-[10px] font-semibold px-3 py-1.5"
          style={{ gridTemplateColumns: '1fr 55px 60px 60px 60px 75px 50px', color: '#334155', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
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
            const statusColor = liveStatus ? (ST_COLOR[liveStatus] ?? '#475569') : '#334155';
            const isAvailNow  = liveStatus === 'available' || liveStatus === 'idle';

            return (
              <div key={a.agentId}
                className="grid items-center px-3 py-2 hover:bg-white/[0.02] transition-colors"
                style={{
                  gridTemplateColumns: '1fr 55px 60px 60px 60px 75px 50px',
                  borderBottom: i < sorted.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  background: liveStatus === 'idle' ? 'rgba(132,204,22,0.03)' : 'transparent',
                }}>

                {/* Name */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                  <span className="text-xs font-medium truncate" style={{ color: '#cbd5e1' }}>{a.name}</span>
                </div>

                {/* Live status badge */}
                <div className="flex justify-center">
                  {liveStatus ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                      {stLabel(liveStatus, ar)}
                    </span>
                  ) : <span style={{ color: '#334155' }}>—</span>}
                </div>

                {/* Work time */}
                <span className="text-center text-xs font-bold tabular-nums" style={{ color: '#22c55e' }}>
                  {a.workingMinutes > 0 ? fmtMin(a.workingMinutes) : '—'}
                </span>

                {/* Idle time — highlighted when agent is currently available/idle */}
                <span className="text-center text-xs tabular-nums font-medium"
                  style={{ color: idleMin > 0 ? (isAvailNow ? '#84cc16' : '#4d7c0f') : '#334155' }}>
                  {idleMin > 0 ? fmtMin(idleMin) : '—'}
                </span>

                {/* Break time */}
                <span className="text-center text-xs tabular-nums"
                  style={{ color: a.breakMinutes > 60 ? '#f87171' : '#475569' }}>
                  {a.breakMinutes > 0 ? fmtMin(a.breakMinutes) : '—'}
                </span>

                {/* Utilization */}
                <div className="flex items-center gap-1.5 justify-center">
                  {a.totalTrackedMinutes > 0 ? (
                    <>
                      <div className="flex-1 max-w-10 h-1.5 rounded-full overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${a.utilizationPct}%`, background: utilColor }} />
                      </div>
                      <span className="text-[10px] font-bold" style={{ color: utilColor }}>{a.utilizationPct}%</span>
                    </>
                  ) : <span style={{ color: '#334155' }}>—</span>}
                </div>

                {/* Login time */}
                <span className="text-center text-[10px]" style={{ color: '#475569' }}>
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  REPORT INCIDENT MODAL                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */
function ReportIncidentModal({
  initial, onClose, ar,
}: {
  initial: IncidentReport; onClose: () => void; ar: boolean;
}) {
  const [form, setForm]       = useState<IncidentReport>(initial);
  const [submitting, setSub]  = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState('');

  const set = (k: keyof IncidentReport, v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.notes.trim()) { setError(ar ? 'أضف ملاحظة قبل الرفع' : 'Add notes before submitting'); return; }
    setSub(true); setError('');
    try {
      await apiClient.post('/integrations/sprinklr/incidents', form);
      setDone(true);
    } catch {
      /* non-fatal — still mark done so RTA can move on */
      setDone(true);
    }
    setSub(false);
  };

  const incLabel = (t: string) => ({
    unauthorized_break:       ar ? 'بريك بدون موافقة'          : 'Unauthorized Break',
    status_change_no_approval: ar ? 'تغيير حالة بدون موافقة' : 'Status Change Without Approval',
  }[t] ?? t);

  const durLabel = (m: number) => fmtDuration(m, ar);

  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl p-6 text-center"
        style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.3)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <Shield size={26} style={{ color: '#f87171' }} />
        </div>
        <h2 className="text-base font-bold mb-2" style={{ color: '#e2e8f0' }}>
          {ar ? 'تم رفع الإنسيدينت' : 'Incident Reported'}
        </h2>
        <p className="text-sm mb-1" style={{ color: '#94a3b8' }}>{form.employeeName}</p>
        <p className="text-xs mb-5" style={{ color: '#475569' }}>
          {ar
            ? 'تم تسجيل الإنسيدينت وسيصلك تأكيد.'
            : 'Incident logged. You will receive confirmation.'}
        </p>
        <button onClick={onClose}
          className="px-6 py-1.5 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
          {ar ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-5 space-y-3"
        style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Shield size={14} style={{ color: '#f87171' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-none" style={{ color: '#e2e8f0' }}>
                {ar ? 'رفع إنسيدينت' : 'Report Incident'}
              </h2>
              <p className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>
                {ar ? 'سيُسجَّل في سجل الأحداث' : 'Will be logged in incident register'}
              </p>
            </div>
          </div>
          <button onClick={onClose}><X size={16} style={{ color: '#64748b' }} /></button>
        </div>

        {/* Employee info card */}
        <div className="rounded-xl p-3 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate" style={{ color: '#fca5a5' }}>{form.employeeName}</div>
            <div className="flex flex-wrap gap-2 mt-1 text-[10px]" style={{ color: '#64748b' }}>
              <span>{incLabel(form.incidentType)}</span>
              <span>·</span>
              <span>{fmtTime(form.occurredAt)}</span>
              {form.durationMinutes > 0 && (
                <><span>·</span><span style={{ color: '#f87171' }}>{durLabel(form.durationMinutes)}</span></>
              )}
            </div>
          </div>
        </div>

        {/* Incident type */}
        <div>
          <label className="text-[11px] mb-1.5 block" style={{ color: '#64748b' }}>
            {ar ? 'نوع الإنسيدينت' : 'Incident Type'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['unauthorized_break', 'status_change_no_approval'] as const).map(t => (
              <button key={t} onClick={() => set('incidentType', t)}
                className="py-2 px-3 rounded-xl text-[11px] font-medium text-start transition-all"
                style={{
                  background: form.incidentType === t ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                  border: form.incidentType === t ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.07)',
                  color: form.incidentType === t ? '#fca5a5' : '#64748b',
                }}>
                {incLabel(t)}
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div>
          <label className="text-[11px] mb-1.5 block" style={{ color: '#64748b' }}>
            {ar ? 'الخطورة' : 'Severity'}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['low',    ar ? 'منخفضة' : 'Low',    '#22c55e', 'rgba(34,197,94,0.12)'],
              ['medium', ar ? 'متوسطة' : 'Medium',  '#f59e0b', 'rgba(245,158,11,0.12)'],
              ['high',   ar ? 'عالية'  : 'High',    '#ef4444', 'rgba(239,68,68,0.15)'],
            ] as const).map(([v, l, c, bg]) => (
              <button key={v} onClick={() => set('severity', v)}
                className="py-2 rounded-xl text-[11px] font-semibold transition-all"
                style={{
                  background:  form.severity === v ? bg : 'rgba(255,255,255,0.03)',
                  border:      form.severity === v ? `1px solid ${c}66` : '1px solid rgba(255,255,255,0.07)',
                  color:       form.severity === v ? c : '#475569',
                }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
            {ar ? 'الملاحظات *' : 'Notes *'}
          </label>
          <textarea rows={3} className="inp w-full resize-none" autoFocus
            placeholder={ar
              ? 'اكتب تفاصيل الحادثة — ماذا حدث؟ ما التأثير على الطابور؟'
              : 'Describe the incident — what happened? Impact on queue?'}
            value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && (
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: '#f87171' }}>
            <AlertTriangle size={11} />{error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium"
            style={{ color: '#64748b', border: '1px solid rgba(100,116,139,0.25)' }}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button onClick={submit} disabled={submitting}
            className="px-5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)', color: '#fff', opacity: submitting ? 0.6 : 1 }}>
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {ar ? 'رفع الإنسيدينت' : 'Submit Incident'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  UNAUTHORIZED BREAK ALERT STRIP                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
function UnauthorizedBreakAlert({
  agents, onReport, ar,
}: {
  agents: BreakAgent[];
  onReport: (inc: IncidentReport) => void;
  ar: boolean;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = agents.filter(a => !dismissed.has(a.agentId));
  if (!visible.length) return null;

  const handleReport = (a: BreakAgent) => {
    const occurredAt = a.lastBreakStart ?? new Date().toISOString();
    const durationMinutes = a.lastBreakStart
      ? Math.round((Date.now() - new Date(a.lastBreakStart).getTime()) / 60000)
      : 0;
    onReport({
      employeeId:   a.agentId,
      employeeName: a.agentName,
      incidentType: 'unauthorized_break',
      occurredAt,
      durationMinutes,
      severity:     durationMinutes > 30 ? 'high' : durationMinutes > 15 ? 'medium' : 'low',
      notes:        '',
    });
  };

  return (
    <div className="flex-shrink-0 mx-4 mb-1.5 rounded-2xl overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(239,68,68,0.12)' }}>
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
        <AlertTriangle size={11} style={{ color: '#f87171' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: '#f87171' }}>
          {ar
            ? `${visible.length} ${visible.length === 1 ? 'موظف' : 'موظفين'} في بريك بدون موافقة`
            : `${visible.length} agent${visible.length !== 1 ? 's' : ''} on unauthorized break`}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse"
          style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>
          {ar ? 'تنبيه' : 'LIVE'}
        </span>
      </div>

      {/* Agent rows */}
      <div className="px-3 py-2 space-y-1.5">
        {visible.map(a => {
          const durationMins = a.lastBreakStart
            ? Math.round((Date.now() - new Date(a.lastBreakStart).getTime()) / 60000)
            : 0;
          const isLong = durationMins > 20;
          return (
            <div key={a.agentId}
              className="flex items-center gap-2 py-2 px-2.5 rounded-xl"
              style={{
                background: isLong ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                border: isLong ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(255,255,255,0.05)',
              }}>
              {/* Status dot */}
              <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
                style={{ background: isLong ? '#ef4444' : '#f87171' }} />

              {/* Name + queue */}
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold truncate block" style={{ color: '#fca5a5' }}>
                  {a.agentName}
                </span>
                {a.lastBreakStart && (
                  <span className="text-[10px]" style={{ color: '#64748b' }}>
                    {ar ? 'منذ' : 'since'} {fmtTime(a.lastBreakStart)}
                    {durationMins > 0 && (
                      <span className="ms-1 font-semibold" style={{ color: isLong ? '#f87171' : '#94a3b8' }}>
                        ({durationMins}{ar ? 'د' : 'm'})
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* System status changed badge */}
              <span className="text-[10px] px-1.5 py-0.5 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
                {ar ? 'بدون موافقة' : 'No approval'}
              </span>

              {/* Report button */}
              <button onClick={() => handleReport(a)}
                className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg font-semibold flex-shrink-0 transition-opacity hover:opacity-80"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}>
                <Shield size={9} />
                {ar ? 'إنسيدينت' : 'Incident'}
              </button>

              {/* Dismiss */}
              <button onClick={() => setDismissed(p => { const n = new Set(p); n.add(a.agentId); return n; })}
                className="p-0.5 opacity-40 hover:opacity-70 transition-opacity flex-shrink-0">
                <X size={11} style={{ color: '#64748b' }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CROSS-SKILL ALERT PANEL                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
const CHANNEL_SKILL: Record<string, string> = {
  whatsapp: 'WHATSAPP', chat: 'CHAT', email: 'EMAIL', social: 'SOCIAL', voice: 'VOICE',
};

function CrossSkillAlertPanel({
  gapQueues, onDispatch, ar,
}: {
  gapQueues: SpQueue[];
  onDispatch: (form: SkillDispatchForm) => void;
  ar: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, CrossSkillCandidate[]>>({});
  const [loadingC, setLoadingC] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = gapQueues.filter(q => !dismissed.has(q.queueId));
  if (!visible.length) return null;

  const loadCandidates = async (q: SpQueue) => {
    const skill = CHANNEL_SKILL[q.channel] ?? q.channel.toUpperCase();
    if (candidates[q.queueId] !== undefined || loadingC[q.queueId]) return;
    setLoadingC(p => ({ ...p, [q.queueId]: true }));
    try {
      const { data } = await apiClient.get('/skills/gaps', {
        params: { skillCode: skill, functionName: q.queueName },
      });
      setCandidates(p => ({ ...p, [q.queueId]: Array.isArray(data) ? data : [] }));
    } catch { setCandidates(p => ({ ...p, [q.queueId]: [] })); }
    setLoadingC(p => ({ ...p, [q.queueId]: false }));
  };

  const handleExpand = (q: SpQueue) => {
    if (expanded === q.queueId) { setExpanded(null); return; }
    setExpanded(q.queueId);
    loadCandidates(q);
  };

  const handleDispatch = (q: SpQueue, c: CrossSkillCandidate) => {
    const skill = CHANNEL_SKILL[q.channel] ?? q.channel.toUpperCase();
    const now = new Date();
    const start = now.toTimeString().slice(0, 5);
    const end = new Date(now.getTime() + 2 * 3600000).toTimeString().slice(0, 5);
    const today = now.toISOString().slice(0, 10);
    onDispatch({
      employeeId: c.employeeId, employeeName: c.name,
      fromFunction: c.function, toFunction: q.queueName,
      skillCode: skill,
      startAt: `${today}T${start}:00`,
      endAt: `${today}T${end}:00`,
      reason: ar
        ? `دعم طابور ${q.queueName} — ${q.waiting} انتظار`
        : `Queue support ${q.queueName} – ${q.waiting} waiting`,
    });
  };

  return (
    <div className="flex-shrink-0 mx-4 mb-2 rounded-2xl overflow-hidden"
      style={{ background: 'rgba(251,146,60,0.05)', border: '1px solid rgba(251,146,60,0.2)' }}>
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(251,146,60,0.1)' }}>
        <Shuffle size={12} style={{ color: '#fb923c' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: '#fb923c' }}>
          {ar
            ? `${visible.length} ${visible.length === 1 ? 'طابور يحتاج' : 'طوابير تحتاج'} دعم كروس-سكيل`
            : `${visible.length} queue${visible.length !== 1 ? 's' : ''} need cross-skill support`}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}>
          {ar ? 'تنبيه' : 'Alert'}
        </span>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {visible.map(q => {
          const isOpen = expanded === q.queueId;
          const cands = candidates[q.queueId];
          const isLoad = loadingC[q.queueId];
          return (
            <div key={q.queueId} className="rounded-xl overflow-hidden"
              style={{
                background: isOpen ? 'rgba(251,146,60,0.06)' : 'rgba(255,255,255,0.02)',
                border: isOpen ? '1px solid rgba(251,146,60,0.2)' : '1px solid rgba(255,255,255,0.06)',
              }}>
              <div className="flex items-center gap-2 py-1.5 px-2.5">
                <span className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${CH_COLOR[q.channel] ?? '#64748b'}22`, color: CH_COLOR[q.channel] ?? '#64748b' }}>
                  {CH_ICON[q.channel]}
                </span>
                <span className="text-[11px] font-medium flex-1 truncate" style={{ color: '#fbbf24' }}>
                  {q.queueName}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-lg font-bold"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                  {q.waiting} {ar ? 'انتظار' : 'waiting'}
                </span>
                <button onClick={() => handleExpand(q)}
                  className="text-[10px] px-2 py-0.5 rounded-lg font-medium flex-shrink-0"
                  style={{
                    background: isOpen ? 'rgba(251,146,60,0.25)' : 'rgba(251,146,60,0.12)',
                    color: '#fb923c', border: '1px solid rgba(251,146,60,0.3)',
                  }}>
                  {isOpen ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'المرشحون' : 'Candidates')}
                </button>
                <button onClick={() => setDismissed(p => { const n = new Set(p); n.add(q.queueId); return n; })}
                  className="p-0.5 opacity-40 hover:opacity-70 transition-opacity">
                  <X size={11} style={{ color: '#64748b' }} />
                </button>
              </div>

              {isOpen && (
                <div className="px-2.5 pb-2.5">
                  {isLoad || isLoad === undefined ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 size={11} className="animate-spin" style={{ color: '#fb923c' }} />
                      <span className="text-[11px]" style={{ color: '#64748b' }}>
                        {ar ? 'جارٍ البحث عن مرشحين...' : 'Finding candidates...'}
                      </span>
                    </div>
                  ) : !cands || cands.length === 0 ? (
                    <p className="text-[11px] py-2" style={{ color: '#475569' }}>
                      {ar ? 'لا يوجد إيجنت متاح بالمهارة المطلوبة' : 'No cross-skilled agents available right now'}
                    </p>
                  ) : (
                    <div className="space-y-1 mt-1">
                      {cands.map(c => (
                        <div key={c.employeeId}
                          className="flex items-center gap-2 py-1.5 px-2 rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate" style={{ color: '#e2e8f0' }}>{c.name}</div>
                            <div className="text-[10px] flex items-center gap-1" style={{ color: '#475569' }}>
                              {c.function}
                              {c.proficiency && (
                                <span className="px-1 rounded"
                                  style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                                  {c.proficiency}
                                </span>
                              )}
                            </div>
                          </div>
                          <button onClick={() => handleDispatch(q, c)}
                            className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg font-semibold flex-shrink-0"
                            style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                            <ArrowLeftRight size={10} />
                            {ar ? 'توجيه' : 'Dispatch'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SKILL DISPATCH MODAL                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
function SkillDispatchModal({
  form, onClose, onSubmit, dispatching, done, ar,
}: {
  form: SkillDispatchForm; onClose: () => void;
  onSubmit: (f: SkillDispatchForm) => void;
  dispatching: boolean; done: boolean; ar: boolean;
}) {
  const [local, setLocal] = useState<SkillDispatchForm>(form);

  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl p-6 text-center"
        style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.3)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <CheckCircle2 size={26} style={{ color: '#4ade80' }} />
        </div>
        <h2 className="text-base font-bold mb-2" style={{ color: '#e2e8f0' }}>
          {ar ? 'تم التوجيه بنجاح' : 'Dispatch Sent'}
        </h2>
        <p className="text-sm mb-1" style={{ color: '#94a3b8' }}>
          {ar
            ? `سيتم تحويل ${local.employeeName} إلى ${local.toFunction}`
            : `${local.employeeName} → ${local.toFunction}`}
        </p>
        <p className="text-[11px] mb-5" style={{ color: '#334155' }}>
          {ar
            ? 'تم إرسال إشعار للموظف وسيظهر التكليف في التقويم.'
            : 'Employee notified. Assignment visible in the calendar.'}
        </p>
        <button onClick={onClose}
          className="px-6 py-1.5 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
          {ar ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-5 space-y-3"
        style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
              <ArrowLeftRight size={14} style={{ color: '#818cf8' }} />
            </div>
            <h2 className="text-sm font-bold" style={{ color: '#e2e8f0' }}>
              {ar ? 'توجيه كروس-سكيل' : 'Cross-Skill Dispatch'}
            </h2>
          </div>
          <button onClick={onClose}><X size={16} style={{ color: '#64748b' }} /></button>
        </div>

        {/* Employee + route */}
        <div className="rounded-xl p-3"
          style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: '#c7d2fe' }}>{local.employeeName}</div>
          <div className="flex items-center gap-2 text-xs" style={{ color: '#64748b' }}>
            <span style={{ color: '#94a3b8' }}>{local.fromFunction}</span>
            <ArrowLeftRight size={11} style={{ color: '#6366f1' }} />
            <span style={{ color: '#fbbf24' }}>{local.toFunction}</span>
          </div>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
              {ar ? 'من الساعة' : 'From'}
            </label>
            <input type="time" className="inp w-full"
              value={local.startAt.slice(11, 16)}
              onChange={e => setLocal(p => ({ ...p, startAt: `${p.startAt.slice(0, 11)}${e.target.value}:00` }))} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
              {ar ? 'حتى الساعة' : 'Until'}
            </label>
            <input type="time" className="inp w-full"
              value={local.endAt.slice(11, 16)}
              onChange={e => setLocal(p => ({ ...p, endAt: `${p.endAt.slice(0, 11)}${e.target.value}:00` }))} />
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
            {ar ? 'السبب' : 'Reason'}
          </label>
          <input className="inp w-full" value={local.reason}
            onChange={e => setLocal(p => ({ ...p, reason: e.target.value }))} />
        </div>

        <p className="text-[10px] rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', color: '#475569', border: '1px solid rgba(255,255,255,0.06)' }}>
          {ar
            ? 'سيتلقى الموظف إشعاراً فورياً بتغيير الوظيفة وستظهر في التقويم.'
            : 'Employee receives an instant notification. The temporary assignment appears in the calendar for all.'}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium"
            style={{ color: '#64748b', border: '1px solid rgba(100,116,139,0.25)' }}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button onClick={() => onSubmit(local)} disabled={dispatching}
            className="px-5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', opacity: dispatching ? 0.6 : 1 }}>
            {dispatching && <Loader2 size={11} className="animate-spin" />}
            {ar ? 'إرسال التوجيه' : 'Send Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DAILY REPORT + FORECAST PANEL                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
interface DailyRow {
  stat_date: string; sprinklr_agent_id: string;
  agent_name: string; agent_email: string | null;
  employee_id: string | null; employee_no: string | null; employee_name: string | null;
  first_login: string | null; last_logout: string | null;
  total_working_minutes: number; idle_no_case_minutes: number; idle_with_case_minutes: number;
  busy_minutes: number; break_minutes: number; offline_minutes: number;
  contacts_received: number | null; aht_seconds: string | null; avg_response_seconds: string | null;
  break_breakdown?: Record<string, number>;
}
interface DailyReport {
  from: string; to: string;
  days: Record<string, {
    agents: number; workingMinutes: number; contacts: number;
    avgAhtSec?: number | null; avgFrtSec?: number | null;
  }>;
  rows: DailyRow[];
}
interface ContactForecast {
  history:  { date: string; contacts: number; agents: number; workingMinutes: number }[];
  forecast: { date: string; predictedContacts: number; method: string }[];
  confidence: string;
  note: string | null;
}

async function downloadCsv(path: string, filename: string) {
  try {
    const { data } = await apiClient.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  } catch { /* non-fatal */ }
}

const fmtSec = (s: string | number | null) => {
  const n = s == null ? null : +s;
  if (n == null || isNaN(n) || n <= 0) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`;
};

function DailyReportPanel({ report, forecast, ar, from, to, onRange, onRefresh, refreshing }: {
  report: DailyReport | null; forecast: ContactForecast | null; ar: boolean;
  from: string; to: string;
  onRange: (from: string, to: string) => void;
  onRefresh: () => void; refreshing: boolean;
}) {
  const rows = report?.rows ?? [];
  const dates = useMemo(() => [...new Set(rows.map(r => String(r.stat_date).slice(0, 10)))], [rows]);
  const maxFc = Math.max(1, ...(forecast?.forecast.map(f => f.predictedContacts) ?? [1]),
                            ...(forecast?.history.map(h => h.contacts) ?? [1]));

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold" style={{ color: '#94a3b8' }}>
          {ar ? 'الفترة' : 'Range'}
        </span>
        <input type="date" value={from} onChange={e => onRange(e.target.value, to)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }} />
        <span style={{ color: '#475569' }}>→</span>
        <input type="date" value={to} onChange={e => onRange(from, e.target.value)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }} />
        <button onClick={onRefresh} disabled={refreshing}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', opacity: refreshing ? .6 : 1 }}>
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {ar ? 'إعادة احتساب' : 'Recompute'}
        </button>
        <button onClick={() => downloadCsv(
            `/integrations/sprinklr/agent-daily?from=${from}&to=${to}&format=csv`,
            `agent_daily_${from}_${to}.csv`)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}>
          ⬇ {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* Forecast strip */}
      <div className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#e2e8f0' }}>
            <TrendingUp size={13} style={{ color: '#34d399' }} />
            {ar ? 'توقع حجم الكونتاكتات (7 أيام)' : 'Contact Volume Forecast (7 days)'}
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
            style={{
              background: forecast?.confidence === 'insufficient-data' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
              color:      forecast?.confidence === 'insufficient-data' ? '#fbbf24' : '#4ade80',
            }}>
            {forecast?.confidence === 'insufficient-data' ? (ar ? 'بيانات غير كافية' : 'Insufficient data')
              : forecast?.confidence === 'low' ? (ar ? 'ثقة منخفضة' : 'Low confidence')
              : (ar ? 'ثقة متوسطة' : 'Medium confidence')}
          </span>
        </div>
        {forecast?.note && (
          <p className="text-[10px] mb-2" style={{ color: '#64748b' }}>
            {ar ? 'يحتاج 7 أيام على الأقل من البيانات — التوقع يتحسن تلقائياً مع تراكم البيانات اليومية.' : forecast.note}
          </p>
        )}
        <div className="flex items-end gap-1.5" style={{ height: 70 }}>
          {(forecast?.history ?? []).slice(-7).map(h => (
            <div key={h.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${h.date}: ${h.contacts}`}>
              <span className="text-[8px] tabular-nums" style={{ color: '#64748b' }}>{h.contacts || ''}</span>
              <div className="w-full rounded-t" style={{ height: Math.max(3, (h.contacts / maxFc) * 48), background: 'rgba(99,102,241,0.45)' }} />
              <span className="text-[8px]" style={{ color: '#475569' }}>{h.date.slice(5)}</span>
            </div>
          ))}
          {(forecast?.forecast ?? []).map(f => (
            <div key={f.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${f.date}: ~${f.predictedContacts} (${f.method})`}>
              <span className="text-[8px] tabular-nums" style={{ color: '#34d399' }}>{f.predictedContacts || ''}</span>
              <div className="w-full rounded-t" style={{
                height: Math.max(3, (f.predictedContacts / maxFc) * 48),
                background: 'rgba(52,211,153,0.3)', border: '1px dashed rgba(52,211,153,0.5)',
              }} />
              <span className="text-[8px]" style={{ color: '#475569' }}>{f.date.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[9px] flex items-center gap-1" style={{ color: '#64748b' }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(99,102,241,0.45)' }} />
            {ar ? 'فعلي' : 'Actual'}
          </span>
          <span className="text-[9px] flex items-center gap-1" style={{ color: '#64748b' }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.3)', border: '1px dashed rgba(52,211,153,0.5)' }} />
            {ar ? 'متوقع' : 'Forecast'}
          </span>
        </div>
      </div>

      {/* Per-day tables */}
      {!rows.length ? (
        <div className="flex flex-col items-center justify-center py-12">
          <BarChart3 size={30} className="mb-2" style={{ color: '#334155' }} />
          <p className="text-xs font-semibold" style={{ color: '#64748b' }}>
            {ar ? 'لا توجد بيانات لهذه الفترة' : 'No data for this range'}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#475569' }}>
            {ar ? 'البيانات تتجمع تلقائياً كل 5 دقائق من سبرينكلر' : 'Data accumulates automatically every 5 min from Sprinklr'}
          </p>
        </div>
      ) : dates.map(d => {
        const dayRows = rows.filter(r => String(r.stat_date).slice(0, 10) === d);
        const tot = report?.days?.[d];
        return (
          <div key={d} className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between px-3.5 py-2" style={{ background: 'rgba(99,102,241,0.07)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs font-bold tabular-nums" style={{ color: '#e2e8f0' }}>{d}</span>
              <div className="flex items-center gap-3 text-[10px]" style={{ color: '#94a3b8' }}>
                <span>👥 {tot?.agents ?? dayRows.length}</span>
                <span>⏱ {fmtMin(tot?.workingMinutes ?? 0)}</span>
                <span>📨 {tot?.contacts || '—'}</span>
                <span title={ar ? 'متوسط زمن المعالجة لليوم' : 'Daily avg handle time'}>
                  AHT <b style={{ color: tot?.avgAhtSec ? '#fbbf24' : '#475569' }}>{fmtSec(tot?.avgAhtSec ?? null)}</b>
                </span>
                <span title={ar ? 'متوسط زمن أول رد لليوم' : 'Daily avg first response'}>
                  FRT <b style={{ color: tot?.avgFrtSec ? '#34d399' : '#475569' }}>{fmtSec(tot?.avgFrtSec ?? null)}</b>
                </span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 920 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {[
                      ar ? 'الموظف' : 'Agent',
                      ar ? 'رقم الموظف' : 'Emp #',
                      ar ? 'أول دخول' : 'First Login',
                      ar ? 'آخر خروج' : 'Last Logout',
                      ar ? 'ساعات العمل' : 'Working',
                      ar ? 'خامل بدون كيس' : 'Idle (no case)',
                      ar ? 'خامل مع كيس' : 'Idle (w/ case)',
                      ar ? 'مشغول' : 'Busy',
                      ar ? 'استراحة' : 'Break',
                      'AHT',
                      ar ? 'وقت الرد' : 'Response',
                      ar ? 'كونتاكتات' : 'Contacts',
                    ].map(h => (
                      <th key={h} className="text-[9px] font-bold px-2.5 py-1.5 whitespace-nowrap"
                        style={{ color: '#64748b', textAlign: 'start' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map(r => (
                    <tr key={r.sprinklr_agent_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-2.5 py-1.5">
                        <div className="text-[11px] font-semibold" style={{ color: '#e2e8f0' }}>
                          {r.employee_name || r.agent_name}
                        </div>
                        {r.agent_email && (
                          <div className="text-[9px]" style={{ color: r.employee_id ? '#4ade80' : '#64748b' }}>
                            {r.agent_email} {r.employee_id ? '✓' : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>{r.employee_no || '—'}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>{fmtTime(r.first_login)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>{fmtTime(r.last_logout)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] font-bold tabular-nums" style={{ color: '#34d399' }}>{fmtMin(r.total_working_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#a3e635' }}>{fmtMin(r.idle_no_case_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#fbbf24' }}>{fmtMin(r.idle_with_case_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#f59e0b' }}>{fmtMin(r.busy_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums"
                        style={{ color: (r.break_breakdown?.total_break ?? r.break_minutes) > 60 ? '#f87171' : '#818cf8', fontWeight: (r.break_breakdown?.total_break ?? r.break_minutes) > 60 ? 700 : 400 }}
                        title={r.break_breakdown ? `Tea ${r.break_breakdown.tea_break ?? 0}د · Lunch ${r.break_breakdown.lunch_break ?? 0}د · Bio ${r.break_breakdown.bio_break ?? 0}د · Prayer ${r.break_breakdown.prayer_break ?? 0}د` : undefined}>
                        {fmtMin(r.break_breakdown?.total_break ?? r.break_minutes)}
                        {(r.break_breakdown?.total_break ?? r.break_minutes) > 60 ? ' ⚠' : ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>{fmtSec(r.aht_seconds)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>{fmtSec(r.avg_response_seconds)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] font-bold tabular-nums" style={{ color: '#e2e8f0' }}>{r.contacts_received ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ADHERENCE PANEL — scheduled vs actual                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */
interface AdherenceRow {
  stat_date: string; employee_id: string; sprinklr_agent_id: string | null;
  employee_name: string; employee_no: string; agent_name: string; shift_code: string | null;
  scheduled_start: string | null; scheduled_end: string | null;
  scheduled_minutes: number; tracked_minutes: number;
  in_adherence_minutes: number; break_in_shift_minutes: number;
  offline_in_shift_minutes: number; worked_total_minutes: number;
  adherence_pct: string | null; conformance_pct: string | null;
  deviations: { from: string; to: string; state: string }[];
}
interface AdherenceReport {
  from: string; to: string;
  summary: { employees: number; measured: number; unmatched: number;
             avgAdherence: number | null; avgConformance: number | null; below85: number };
  rows: AdherenceRow[];
}
interface IntradayData {
  date: string;
  intervals: { interval: string; scheduled: number; actual: number | null; gap: number | null }[];
}

const adhColor = (p: number | null) =>
  p == null ? '#475569' : p >= 90 ? '#22c55e' : p >= 80 ? '#a3e635' : p >= 65 ? '#f59e0b' : '#ef4444';

function AdherencePanel({ report, intraday, ar, from, to, onRange, onRefresh, refreshing }: {
  report: AdherenceReport | null; intraday: IntradayData | null; ar: boolean;
  from: string; to: string;
  onRange: (f: string, t: string) => void;
  onRefresh: () => void; refreshing: boolean;
}) {
  const s = report?.summary;
  const activeIntervals = (intraday?.intervals ?? []).filter(i => i.scheduled > 0 || (i.actual ?? 0) > 0);
  const maxHc = Math.max(1, ...activeIntervals.map(i => Math.max(i.scheduled, i.actual ?? 0)));

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Activity size={14} style={{ color: '#34d399' }} />
        <span className="text-[11px] font-bold" style={{ color: '#e2e8f0' }}>
          {ar ? 'الالتزام بالجدول' : 'Schedule Adherence'}
        </span>
        <input type="date" value={from} onChange={e => onRange(e.target.value, to)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }} />
        <span style={{ color: '#475569' }}>→</span>
        <input type="date" value={to} onChange={e => onRange(from, e.target.value)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }} />
        <button onClick={onRefresh} disabled={refreshing}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', opacity: refreshing ? .6 : 1 }}>
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {ar ? 'إعادة احتساب' : 'Recompute'}
        </button>
        <button onClick={() => downloadCsv(
            `/integrations/sprinklr/adherence?from=${from}&to=${to}&format=csv`,
            `adherence_${from}_${to}.csv`)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}>
          ⬇ {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { lbl: ar ? 'متوسط الالتزام' : 'Avg Adherence',   val: s?.avgAdherence != null ? `${s.avgAdherence}%` : '—', color: adhColor(s?.avgAdherence ?? null) },
          { lbl: ar ? 'متوسط الإنجاز'  : 'Avg Conformance', val: s?.avgConformance != null ? `${s.avgConformance}%` : '—', color: '#818cf8' },
          { lbl: ar ? 'مجدولين'        : 'Scheduled',       val: s?.employees ?? '—', color: '#94a3b8' },
          { lbl: ar ? 'مُتتبَّعين'      : 'Measured',        val: s?.measured ?? '—', color: '#06b6d4' },
          { lbl: ar ? 'تحت 85%'        : 'Below 85%',       val: s?.below85 ?? '—', color: (s?.below85 ?? 0) > 0 ? '#ef4444' : '#22c55e' },
        ].map(k => (
          <div key={k.lbl} className="rounded-2xl p-3 text-center"
            style={{ background: `${k.color}0a`, border: `1px solid ${k.color}26` }}>
            <div className="text-xl font-black tabular-nums leading-none" style={{ color: k.color }}>{k.val}</div>
            <div className="text-[9px] mt-1.5 font-semibold" style={{ color: '#64748b' }}>{k.lbl}</div>
          </div>
        ))}
      </div>

      {(s?.unmatched ?? 0) > 0 && (
        <div className="text-[10px] px-3 py-1.5 rounded-xl" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
          ⚠ {s!.unmatched} {ar ? 'موظف مجدول غير مرتبط بسبرينكلر بعد — ادمج التكرارات في صفحة Employee Merge أو انتظر تجميع الإيميلات'
                              : 'scheduled employees not yet linked to Sprinklr — merge duplicates in Employee Merge or wait for email harvest'}
        </div>
      )}

      {/* Intraday: scheduled vs actual HC */}
      {activeIntervals.length > 0 && (
        <div className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#e2e8f0' }}>
              <BarChart3 size={13} style={{ color: '#818cf8' }} />
              {ar ? 'اليوم لحظة بلحظة — مجدول vs فعلي (كل ٣٠ دقيقة)' : 'Intraday — Scheduled vs Actual HC (30-min)'}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[9px] flex items-center gap-1" style={{ color: '#64748b' }}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(129,140,248,0.45)' }} />{ar ? 'مجدول' : 'Scheduled'}
              </span>
              <span className="text-[9px] flex items-center gap-1" style={{ color: '#64748b' }}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.6)' }} />{ar ? 'فعلي' : 'Actual'}
              </span>
            </div>
          </div>
          <div className="flex items-end gap-0.5" style={{ height: 90, overflowX: 'auto' }}>
            {activeIntervals.map(iv => (
              <div key={iv.interval} className="flex flex-col items-center gap-0.5" style={{ minWidth: 26 }}
                title={`${iv.interval} — ${ar ? 'مجدول' : 'sched'} ${iv.scheduled} / ${ar ? 'فعلي' : 'actual'} ${iv.actual ?? '—'}`}>
                <div className="flex items-end gap-px" style={{ height: 64 }}>
                  <div className="rounded-t" style={{ width: 9, height: Math.max(2, (iv.scheduled / maxHc) * 64), background: 'rgba(129,140,248,0.45)' }} />
                  <div className="rounded-t" style={{
                    width: 9, height: Math.max(2, ((iv.actual ?? 0) / maxHc) * 64),
                    background: iv.actual == null ? 'rgba(71,85,105,0.3)'
                      : (iv.gap ?? 0) < 0 ? 'rgba(239,68,68,0.65)' : 'rgba(52,211,153,0.6)',
                  }} />
                </div>
                <span className="text-[7.5px] tabular-nums" style={{ color: '#475569' }}>{iv.interval}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-agent table */}
      {!(report?.rows.length) ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Activity size={30} className="mb-2" style={{ color: '#334155' }} />
          <p className="text-xs font-semibold" style={{ color: '#64748b' }}>
            {ar ? 'لا توجد بيانات التزام لهذه الفترة' : 'No adherence data for this range'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                  {[ar ? 'التاريخ' : 'Date', ar ? 'الموظف' : 'Employee', ar ? 'الشفت' : 'Shift',
                    ar ? 'الالتزام' : 'Adherence', ar ? 'الإنجاز' : 'Conformance',
                    ar ? 'داخل الشفت' : 'In-Shift', ar ? 'بريك بالشفت' : 'Break',
                    ar ? 'أوفلاين بالشفت' : 'Offline', ar ? 'متتبَّع/مجدول' : 'Tracked/Sched'].map((h, i) => (
                    <th key={i} className="text-[9px] font-bold px-3 py-2 whitespace-nowrap" style={{ color: '#64748b', textAlign: 'start' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map(r => {
                  const pct = r.adherence_pct != null ? +r.adherence_pct : null;
                  const c = adhColor(pct);
                  return (
                    <tr key={`${r.stat_date}_${r.employee_id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-3 py-2 text-[10px] tabular-nums whitespace-nowrap" style={{ color: '#94a3b8' }}>{String(r.stat_date).slice(0, 10)}</td>
                      <td className="px-3 py-2">
                        <div className="text-[11px] font-semibold" style={{ color: '#e2e8f0' }}>{r.employee_name}</div>
                        <div className="text-[9px]" style={{ color: r.sprinklr_agent_id ? '#4ade80' : '#f59e0b' }}>
                          #{r.employee_no} {r.sprinklr_agent_id ? '✓' : (ar ? '· غير مرتبط' : '· unlinked')}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ color: '#94a3b8' }}>
                        {r.shift_code ?? '—'}
                        <div className="text-[8.5px] font-normal" style={{ color: '#475569' }}>
                          {fmtTime(r.scheduled_start)}–{fmtTime(r.scheduled_end)}
                        </div>
                      </td>
                      <td className="px-3 py-2" style={{ minWidth: 120 }}>
                        {pct == null ? <span className="text-[10px]" style={{ color: '#475569' }}>{ar ? 'لا تتبع' : 'no tracking'}</span> : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', minWidth: 60 }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: c, transition: 'width .5s' }} />
                            </div>
                            <span className="text-[11px] font-black tabular-nums" style={{ color: c }}>{pct}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-bold tabular-nums" style={{ color: '#818cf8' }}>
                        {r.conformance_pct != null ? `${r.conformance_pct}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: '#34d399' }}>{fmtMin(r.in_adherence_minutes)}</td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: '#818cf8' }}>{fmtMin(r.break_in_shift_minutes)}</td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: r.offline_in_shift_minutes > 30 ? '#f87171' : '#94a3b8' }}>{fmtMin(r.offline_in_shift_minutes)}</td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: '#64748b' }}>{fmtMin(r.tracked_minutes)} / {fmtMin(r.scheduled_minutes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMPLIANCE / VIOLATIONS PANEL                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
interface ViolationRow {
  id: string; violation_date: string; sprinklr_agent_id: string;
  agent_name: string; agent_email: string | null;
  employee_id: string | null; employee_no: string | null; employee_name: string | null;
  violation_type: string; severity: 'low' | 'medium' | 'high';
  minutes: number | null;
  shift_start: string | null; shift_end: string | null; actual_at: string | null;
  details: any; status: 'open' | 'reviewed' | 'justified';
}
interface ViolationsReport {
  from: string; to: string;
  summary: { total: number; open: number; byType: Record<string, number>; bySeverity: Record<string, number> };
  topOffenders: { agentId: string; name: string; count: number; totalMinutes: number }[];
  rows: ViolationRow[];
}

const VIOLATION_META: Record<string, { ar: string; en: string; icon: string; color: string }> = {
  excess_break:             { ar: 'بريك زائد (+1 ساعة)',   en: 'Excess Break (>1h)',     icon: '☕', color: '#f59e0b' },
  late_login:               { ar: 'تأخير عن الشفت',        en: 'Late Login',             icon: '⏰', color: '#ef4444' },
  early_logout:             { ar: 'خروج مبكر',             en: 'Early Logout',           icon: '🚪', color: '#f97316' },
  off_schedule:             { ar: 'شغل خارج الجدول',       en: 'Off-Schedule Activity',  icon: '📅', color: '#a855f7' },
  unauthorized_meeting:     { ar: 'ميتنج بدون موافقة',     en: 'Unauthorized Meeting',   icon: '👥', color: '#06b6d4' },
  unauthorized_manual_dial: { ar: 'Manual Dial بدون إذن',  en: 'Unauthorized Dial',      icon: '📞', color: '#ec4899' },
};
const SEV_COLOR = { low: '#fbbf24', medium: '#fb923c', high: '#f87171' };
const SEV_AR    = { low: 'بسيطة',   medium: 'متوسطة',  high: 'جسيمة'  };

interface ComplianceConfig {
  breakLimitMin: number; lateGraceMin: number; earlyGraceMin: number;
  meetingMinFlag: number; dialMinFlag: number;
}
const CFG_LABELS: Record<keyof ComplianceConfig, { ar: string; en: string }> = {
  breakLimitMin:  { ar: 'حد البريك اليومي (دقيقة)',      en: 'Daily break limit (min)' },
  lateGraceMin:   { ar: 'سماح التأخير (دقيقة)',          en: 'Late grace (min)' },
  earlyGraceMin:  { ar: 'سماح الخروج المبكر (دقيقة)',    en: 'Early-out grace (min)' },
  meetingMinFlag: { ar: 'حد الميتنج للرصد (دقيقة)',      en: 'Meeting flag (min)' },
  dialMinFlag:    { ar: 'حد Manual Dial للرصد (دقيقة)',  en: 'Dial flag (min)' },
};

function CompliancePanel({ report, ar, from, to, onRange, onReview }: {
  report: ViolationsReport | null; ar: boolean;
  from: string; to: string;
  onRange: (f: string, t: string) => void;
  onReview: (id: string, status: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [cfg, setCfg] = useState<ComplianceConfig | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');

  useEffect(() => {
    apiClient.get<ComplianceConfig>('/integrations/sprinklr/compliance-config')
      .then(r => setCfg(r.data)).catch(() => undefined);
  }, []);

  const saveCfg = async () => {
    if (!cfg) return;
    setCfgSaving(true); setCfgMsg('');
    try {
      const { data } = await apiClient.put<ComplianceConfig>('/integrations/sprinklr/compliance-config', cfg);
      setCfg(data);
      setCfgMsg(ar ? '✅ حُفظت — تُطبق عند إعادة الاحتساب القادمة' : '✅ Saved — applies on next recompute');
    } catch {
      setCfgMsg(ar ? '✗ فشل الحفظ — تحتاج صلاحية settings.edit' : '✗ Save failed — needs settings.edit permission');
    }
    setCfgSaving(false);
    setTimeout(() => setCfgMsg(''), 5000);
  };

  const rows = (report?.rows ?? []).filter(r => !typeFilter || r.violation_type === typeFilter);

  return (
    <div className="flex flex-col gap-3">
      {/* Range controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Shield size={14} style={{ color: '#818cf8' }} />
        <span className="text-[11px] font-bold" style={{ color: '#e2e8f0' }}>
          {ar ? 'تقرير الالتزام' : 'Compliance Report'}
        </span>
        <input type="date" value={from} onChange={e => onRange(e.target.value, to)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }} />
        <span style={{ color: '#475569' }}>→</span>
        <input type="date" value={to} onChange={e => onRange(from, e.target.value)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', colorScheme: 'dark' }} />
        {report && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: report.summary.open ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                     color: report.summary.open ? '#f87171' : '#4ade80' }}>
            {report.summary.open} {ar ? 'مفتوحة' : 'open'} / {report.summary.total}
          </span>
        )}
        <button onClick={() => downloadCsv(
            `/integrations/sprinklr/violations?from=${from}&to=${to}&format=csv`,
            `violations_${from}_${to}.csv`)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}>
          ⬇ {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
        <button onClick={() => setCfgOpen(o => !o)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{
            background: cfgOpen ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.08)',
            color: '#94a3b8', border: '1px solid rgba(148,163,184,0.25)',
          }}>
          ⚙ {ar ? 'العتبات' : 'Thresholds'}
        </button>
      </div>

      {/* Thresholds editor */}
      {cfgOpen && cfg && (
        <div className="rounded-2xl p-3.5" style={{ background: 'rgba(148,163,184,0.04)', border: '1px solid rgba(148,163,184,0.15)' }}>
          <div className="flex items-end gap-3 flex-wrap">
            {(Object.keys(CFG_LABELS) as (keyof ComplianceConfig)[]).map(k => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-[9px] font-bold" style={{ color: '#94a3b8' }}>
                  {ar ? CFG_LABELS[k].ar : CFG_LABELS[k].en}
                </span>
                <input type="number" min={0} max={480} value={cfg[k]}
                  onChange={e => setCfg({ ...cfg, [k]: +e.target.value })}
                  className="rounded-lg text-[12px] px-2 py-1 outline-none tabular-nums"
                  style={{ width: 90, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0' }} />
              </label>
            ))}
            <button onClick={saveCfg} disabled={cfgSaving}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', opacity: cfgSaving ? .6 : 1 }}>
              {cfgSaving && <Loader2 size={11} className="animate-spin" />}
              {ar ? 'حفظ العتبات' : 'Save'}
            </button>
            {cfgMsg && <span className="text-[10px] font-bold" style={{ color: cfgMsg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{cfgMsg}</span>}
          </div>
          <p className="text-[9px] mt-2" style={{ color: '#64748b' }}>
            {ar ? 'تُطبق العتبات الجديدة على الاحتساب التلقائي القادم (كل ٥ دقائق) أو عند الضغط على "إعادة احتساب" في التقرير اليومي.'
                : 'New thresholds apply on the next auto-compute (every 5 min) or when pressing Recompute in the Daily Report.'}
          </p>
        </div>
      )}

      {/* Violation type cards — clickable filters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {Object.entries(VIOLATION_META).map(([key, meta]) => {
          const n = report?.summary.byType[key] ?? 0;
          const active = typeFilter === key;
          return (
            <button key={key} onClick={() => setTypeFilter(active ? null : key)}
              className="rounded-2xl p-3 text-center transition-all"
              style={{
                background: active ? `${meta.color}1c` : n > 0 ? `${meta.color}0c` : 'rgba(255,255,255,0.02)',
                border: active ? `1.5px solid ${meta.color}66` : `1px solid ${n > 0 ? meta.color + '30' : 'rgba(255,255,255,0.06)'}`,
                cursor: 'pointer',
              }}>
              <div className="text-base mb-1">{meta.icon}</div>
              <div className="text-xl font-black tabular-nums leading-none"
                style={{ color: n > 0 ? meta.color : '#334155' }}>{n}</div>
              <div className="text-[8.5px] mt-1.5 font-semibold leading-tight" style={{ color: n > 0 ? '#94a3b8' : '#475569' }}>
                {ar ? meta.ar : meta.en}
              </div>
            </button>
          );
        })}
      </div>

      {/* Top offenders strip */}
      {(report?.topOffenders?.length ?? 0) > 0 && (
        <div className="rounded-2xl p-3" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="text-[10px] font-bold mb-2 flex items-center gap-1.5" style={{ color: '#f87171' }}>
            <AlertTriangle size={11} /> {ar ? 'الأكثر مخالفةً في الفترة' : 'Top offenders in range'}
          </div>
          <div className="flex gap-2 flex-wrap">
            {report!.topOffenders.slice(0, 6).map(o => (
              <span key={o.agentId} className="text-[10px] px-2.5 py-1 rounded-full font-semibold"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(239,68,68,0.2)', color: '#e2e8f0' }}>
                {o.name} <b style={{ color: '#f87171' }}>×{o.count}</b>
                {o.totalMinutes > 0 && <span style={{ color: '#64748b' }}> · {fmtMin(o.totalMinutes)}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Violations table */}
      {!rows.length ? (
        <div className="flex flex-col items-center justify-center py-14">
          <CheckCircle2 size={32} className="mb-2" style={{ color: '#16a34a' }} />
          <p className="text-xs font-bold" style={{ color: '#4ade80' }}>
            {typeFilter
              ? (ar ? 'لا مخالفات من هذا النوع' : 'No violations of this type')
              : (ar ? 'لا توجد مخالفات في هذه الفترة 🎉' : 'No violations in this range 🎉')}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#475569' }}>
            {ar ? 'تُحتسب المخالفات تلقائياً كل ٥ دقائق من بيانات سبرينكلر والجدول' : 'Violations auto-computed every 5 min from Sprinklr + schedule data'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                  {[ar ? 'التاريخ' : 'Date', ar ? 'الموظف' : 'Agent', ar ? 'المخالفة' : 'Violation',
                    ar ? 'الخطورة' : 'Severity', ar ? 'الدقائق' : 'Minutes',
                    ar ? 'التفاصيل' : 'Details', ar ? 'الحالة' : 'Status', ''].map((h, i) => (
                    <th key={i} className="text-[9px] font-bold px-3 py-2 whitespace-nowrap" style={{ color: '#64748b', textAlign: 'start' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const meta = VIOLATION_META[r.violation_type] ?? { ar: r.violation_type, en: r.violation_type, icon: '⚠', color: '#64748b' };
                  const det  = typeof r.details === 'object' ? r.details : {};
                  let detTxt = '';
                  if (r.violation_type === 'excess_break' && det.breakdown) {
                    const b = det.breakdown;
                    detTxt = `${ar ? 'إجمالي' : 'Total'} ${fmtMin(det.totalBreakMinutes)} — ☕${b.tea ?? 0} 🍽${b.lunch ?? 0} 🚻${b.bio ?? 0} 🕌${b.prayer ?? 0}`;
                  } else if (r.violation_type === 'late_login') {
                    detTxt = `${ar ? 'الشفت' : 'Shift'} ${fmtTime(r.shift_start)} → ${ar ? 'دخل' : 'in'} ${fmtTime(r.actual_at)}`;
                  } else if (r.violation_type === 'early_logout') {
                    detTxt = `${ar ? 'النهاية' : 'End'} ${fmtTime(r.shift_end)} → ${ar ? 'خرج' : 'out'} ${fmtTime(r.actual_at)}`;
                  } else if (r.violation_type === 'off_schedule') {
                    detTxt = det.reason === 'no_scheduled_shift'
                      ? (ar ? 'لا يوجد شفت مجدول' : 'No scheduled shift')
                      : (ar ? `مجدول ${det.shiftCode ?? 'OFF'}` : `Scheduled ${det.shiftCode ?? 'OFF'}`);
                  } else {
                    detTxt = `${fmtMin(r.minutes ?? 0)}`;
                  }
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: r.status !== 'open' ? .55 : 1 }}>
                      <td className="px-3 py-2 text-[10px] tabular-nums whitespace-nowrap" style={{ color: '#94a3b8' }}>
                        {String(r.violation_date).slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-[11px] font-semibold" style={{ color: '#e2e8f0' }}>{r.employee_name || r.agent_name}</div>
                        {r.employee_no && <div className="text-[9px]" style={{ color: '#64748b' }}>#{r.employee_no}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}30` }}>
                          {meta.icon} {ar ? meta.ar : meta.en}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${SEV_COLOR[r.severity]}14`, color: SEV_COLOR[r.severity] }}>
                          {ar ? SEV_AR[r.severity] : r.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] font-bold tabular-nums" style={{ color: meta.color }}>
                        {r.minutes != null ? fmtMin(r.minutes) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px]" style={{ color: '#94a3b8', maxWidth: 230 }}>{detTxt}</td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-bold" style={{
                          color: r.status === 'open' ? '#f87171' : r.status === 'justified' ? '#4ade80' : '#94a3b8',
                        }}>
                          {r.status === 'open' ? (ar ? 'مفتوحة' : 'Open')
                            : r.status === 'justified' ? (ar ? 'مبررة' : 'Justified')
                            : (ar ? 'تمت المراجعة' : 'Reviewed')}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.status === 'open' && (
                          <div className="flex gap-1">
                            <button onClick={() => onReview(r.id, 'reviewed')}
                              className="text-[9px] px-2 py-0.5 rounded-md font-bold"
                              style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.25)' }}>
                              ✓ {ar ? 'مراجعة' : 'Review'}
                            </button>
                            <button onClick={() => onReview(r.id, 'justified')}
                              className="text-[9px] px-2 py-0.5 rounded-md font-bold"
                              style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}>
                              {ar ? 'مبررة' : 'Justify'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function RTAPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [live, setLive]           = useState<SpLive | null>(null);
  const [breakData, setBreakData] = useState<BreakTracker | null>(null);
  const [timeline, setTimeline]   = useState<AgentTimeline[]>([]);
  const [coverage, setCoverage]   = useState<Coverage | null>(null);
  const [queueDetail, setQueueDetail] = useState<QueueDetail | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [tab, setTab]   = useState<'queues' | 'breaks' | 'permissions' | 'coverage' | 'agents' | 'daily' | 'compliance' | 'adherence'>('queues');
  const [violations, setViolations] = useState<ViolationsReport | null>(null);
  const [adherence, setAdherence]   = useState<AdherenceReport | null>(null);
  const [intraday, setIntraday]     = useState<IntradayData | null>(null);
  const [adhRefreshing, setAdhRefreshing] = useState(false);
  const todayStr = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const [daily, setDaily]           = useState<DailyReport | null>(null);
  const [fc, setFc]                 = useState<ContactForecast | null>(null);
  const [dailyFrom, setDailyFrom]   = useState(todayStr);
  const [dailyTo, setDailyTo]       = useState(todayStr);
  const [dailyRefreshing, setDailyRefreshing] = useState(false);
  const [qFilter, setQFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [skillDispatch, setSkillDispatch] = useState<SkillDispatchForm | null>(null);
  const [dispatchingSkill, setDispatchingSkill] = useState(false);
  const [dispatchDone, setDispatchDone] = useState(false);
  const [incidentForm, setIncidentForm] = useState<IncidentReport | null>(null);
  const [pulse, setPulse]     = useState(false);
  const [tick, setTick]       = useState(0);
  const [now, setNow]         = useState(new Date());
  const spTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const { data } = await apiClient.get<SpLive>('/integrations/sprinklr/live');
      setLive(data);
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    } catch { /* stale */ }
    setLoading(false);
  }, []);

  const loadQueueDetail = useCallback(async (queueId: string) => {
    try {
      const { data } = await apiClient.get<QueueDetail>(`/integrations/sprinklr/queue/${queueId}`);
      setQueueDetail(data);
    } catch { setQueueDetail(null); }
  }, []);

  const loadBreaks = useCallback(async () => {
    try {
      const { data } = await apiClient.get<BreakTracker>('/integrations/sprinklr/break-tracker');
      setBreakData(data);
    } catch { /* non-fatal */ }
  }, []);

  const loadTimeline = useCallback(async () => {
    try {
      const { data } = await apiClient.get<AgentTimeline[]>('/integrations/sprinklr/agent-timeline');
      setTimeline(data ?? []);
    } catch { /* non-fatal */ }
  }, []);

  const loadCoverage = useCallback(async () => {
    try {
      const { data } = await apiClient.get<Coverage>('/integrations/sprinklr/coverage');
      setCoverage(data);
    } catch { /* non-fatal */ }
  }, []);

  const loadDaily = useCallback(async (refresh = false) => {
    if (refresh) setDailyRefreshing(true);
    try {
      const [rep, fcast] = await Promise.all([
        apiClient.get<DailyReport>(`/integrations/sprinklr/agent-daily?from=${dailyFrom}&to=${dailyTo}${refresh ? '&refresh=1' : ''}`),
        apiClient.get<ContactForecast>('/integrations/sprinklr/contact-forecast?days=7'),
      ]);
      setDaily(rep.data);
      setFc(fcast.data);
    } catch { /* non-fatal */ }
    setDailyRefreshing(false);
  }, [dailyFrom, dailyTo]);

  useEffect(() => {
    if (tab === 'daily') loadDaily(false);
  }, [tab, loadDaily]);

  const loadViolations = useCallback(async () => {
    try {
      const { data } = await apiClient.get<ViolationsReport>(
        `/integrations/sprinklr/violations?from=${dailyFrom}&to=${dailyTo}`);
      setViolations(data);
    } catch { /* non-fatal */ }
  }, [dailyFrom, dailyTo]);

  useEffect(() => {
    if (tab === 'compliance') loadViolations();
  }, [tab, loadViolations]);

  const loadAdherence = useCallback(async (refresh = false) => {
    if (refresh) setAdhRefreshing(true);
    try {
      const [rep, intra] = await Promise.all([
        apiClient.get<AdherenceReport>(`/integrations/sprinklr/adherence?from=${dailyFrom}&to=${dailyTo}${refresh ? '&refresh=1' : ''}`),
        apiClient.get<IntradayData>(`/integrations/sprinklr/adherence-intraday?date=${dailyTo}`),
      ]);
      setAdherence(rep.data);
      setIntraday(intra.data);
    } catch { /* non-fatal */ }
    setAdhRefreshing(false);
  }, [dailyFrom, dailyTo]);

  useEffect(() => {
    if (tab === 'adherence') loadAdherence(false);
  }, [tab, loadAdherence]);

  const reviewViolation = useCallback(async (id: string, status: string) => {
    try {
      await apiClient.put(`/integrations/sprinklr/violations/${id}/status`, { status });
      loadViolations();
    } catch { /* non-fatal */ }
  }, [loadViolations]);

  useEffect(() => {
    loadLive(); loadBreaks(); loadTimeline(); loadCoverage();
    spTimer.current = setInterval(() => { loadLive(); setTick(t => t + 1); }, 10_000);
    const t2 = setInterval(() => { loadBreaks(); loadCoverage(); }, 30_000);
    const t3 = setInterval(loadTimeline, 60_000);
    return () => { clearInterval(spTimer.current); clearInterval(t2); clearInterval(t3); };
  }, [loadLive, loadBreaks, loadTimeline, loadCoverage]);

  useEffect(() => {
    if (selectedQueue) loadQueueDetail(selectedQueue);
  }, [selectedQueue, tick, loadQueueDetail]);

  const s = live?.summary;
  const filteredQueues = useMemo(() =>
    (live?.queues ?? [])
      .filter(q => !qFilter || q.queueName.toLowerCase().includes(qFilter.toLowerCase()))
      .sort((a, b) => b.waiting - a.waiting),
    [live?.queues, qFilter]);

  // Count idle as available (logged-in but not handling = available)
  const agAvail   = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'available' || a.status === 'idle').length, [live]);
  const agBusy    = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'busy').length, [live]);
  const agBreak   = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'break' || a.status === 'away').length, [live]);
  const agOffline = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'offline' || a.status === 'unknown').length, [live]);
  const selectedQueueObj = live?.queues.find(q => q.queueId === selectedQueue) ?? null;
  const isStale = live?.isStale ?? false;

  const gapQueues = useMemo(() =>
    (live?.queues ?? []).filter(q => q.waiting > 0 && (q.agentsAvailable < 5 || q.slaPct < 70)),
    [live]);

  const handleSkillDispatch = async (form: SkillDispatchForm) => {
    setDispatchingSkill(true);
    try {
      await apiClient.post('/skills/dispatch', {
        employeeId:   form.employeeId,
        fromFunction: form.fromFunction,
        toFunction:   form.toFunction,
        skillCode:    form.skillCode,
        startAt:      form.startAt,
        endAt:        form.endAt,
        reason:       form.reason,
      });
      setDispatchDone(true);
    } catch { /* non-fatal — modal stays open */ }
    setDispatchingSkill(false);
  };

  return (
    <div className="flex flex-col" dir={ar ? 'rtl' : 'ltr'}
      style={{ height: '100%', overflow: 'hidden' }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 gap-3 flex-wrap"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.2)' }}>
            <Radio size={14} style={{ color: '#22d3ee' }} />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-none" style={{ color: tp(dark) }}>
              {ar ? 'مراقبة الوقت الحقيقي' : 'Real-Time Monitoring'}
            </h1>
            <p className="text-[10px] mt-0.5" style={{ color: '#334155' }}>
              {now.toLocaleTimeString('en-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              {' · '}{now.toLocaleDateString('en-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {live && !isStale ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px]"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}>
              <span className={`w-1.5 h-1.5 rounded-full bg-green-400 ${pulse ? 'scale-150' : ''} transition-transform`} />
              {ar ? `متصل · ${live.staleSec}ث` : `Live · ${live.staleSec}s`}
            </div>
          ) : isStale ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px]"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
              <WifiOff size={10} />{ar ? 'بيانات قديمة' : 'Stale'}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px]"
              style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', color: '#64748b' }}>
              <Loader2 size={10} className="animate-spin" />{ar ? 'جارٍ الاتصال...' : 'Connecting...'}
            </div>
          )}
          <button onClick={() => { setLoading(true); loadLive(); loadBreaks(); loadTimeline(); loadCoverage(); }}
            className="p-1.5 rounded-lg hover:opacity-70"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <RefreshCw size={12} style={{ color: '#64748b' }} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── KPI STRIP ──────────────────────────────────────────────────────── */}
      {s && (
        <div className="flex-shrink-0 grid grid-cols-5 gap-2 px-4 pt-2.5 pb-2">
          <KpiCard label={ar ? 'إجمالي الانتظار' : 'Waiting'}  val={s.totalWaiting}   color="#f59e0b" icon={Clock} />
          <KpiCard label={ar ? 'قيد التنفيذ'     : 'Active'}   val={s.totalInProgress} color="#818cf8" icon={Activity} />
          <KpiCard label={ar ? 'إيجنت متاح'      : 'Available'} val={s.totalAvailable || agAvail} color="#22c55e" icon={UserCheck} />
          <KpiCard label={ar ? 'في استراحة'      : 'On Break'}  val={agBreak}           color={agBreak > 0 ? '#818cf8' : '#475569'} icon={Coffee}
            sub={breakData && breakData.unauthorizedCount > 0 ? `${breakData.unauthorizedCount} ${ar ? 'غير مرخّص' : 'unauth'}` : undefined} />
          <KpiCard label={ar ? 'متوسط SLA'       : 'Avg SLA'}  val={`${s.avgSla}%`}   color={slaColor(s.avgSla)} icon={TrendingUp} />
        </div>
      )}

      {/* ── AT-RISK BANNER ─────────────────────────────────────────────────── */}
      {live && live.atRisk.length > 0 && (
        <div className="flex-shrink-0 mx-4 mb-1.5 rounded-xl px-3 py-1.5 flex items-center gap-2 flex-wrap"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={11} style={{ color: '#f87171' }} className="flex-shrink-0" />
          <span className="text-[11px] font-semibold me-1" style={{ color: '#f87171' }}>
            {ar ? `${live.atRisk.length} طوابير تحت SLA` : `${live.atRisk.length} below SLA`}
          </span>
          {live.atRisk.map(q => (
            <button key={q.queueId}
              onClick={() => { setSelectedQueue(q.queueId); setTab('queues'); }}
              className="text-[10px] px-1.5 py-0.5 rounded-full hover:opacity-80"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}>
              {q.queueName} · {q.slaPct}%
            </button>
          ))}
        </div>
      )}

      {/* ── AGENT STATUS ROW ───────────────────────────────────────────────── */}
      {live && live.agents.length > 0 && (
        <div className="flex-shrink-0 grid grid-cols-4 gap-2 px-4 pb-2">
          {[
            { l: ar ? 'متاح' : 'Available', v: s?.totalAvailable || agAvail, c: '#22c55e' },
            { l: ar ? 'مشغول': 'Busy',      v: s?.totalBusy      || agBusy,  c: '#f59e0b' },
            { l: ar ? 'برك'  : 'Break',     v: agBreak,   c: '#818cf8' },
            { l: ar ? 'أوف'  : 'Offline',   v: agOffline, c: '#475569' },
          ].map(item => (
            <div key={item.l} className="rounded-xl py-1 px-3 flex items-center gap-2"
              style={{ background: `${item.c}06`, border: `1px solid ${item.c}15` }}>
              <span className="text-sm font-bold tabular-nums" style={{ color: item.c }}>{item.v}</span>
              <span className="text-[10px]" style={{ color: '#334155' }}>{item.l}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── UNAUTHORIZED BREAK ALERT ───────────────────────────────────────── */}
      {(breakData?.onBreakNow ?? []).filter(a => !a.isAuthorized).length > 0 && (
        <UnauthorizedBreakAlert
          agents={(breakData!.onBreakNow).filter(a => !a.isAuthorized)}
          ar={ar}
          onReport={inc => setIncidentForm(inc)}
        />
      )}

      {/* ── CROSS-SKILL ALERT ──────────────────────────────────────────────── */}
      {gapQueues.length > 0 && (
        <CrossSkillAlertPanel gapQueues={gapQueues} ar={ar}
          onDispatch={form => { setSkillDispatch(form); setDispatchDone(false); }} />
      )}

      {/* ── TABS ───────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 pb-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([
          { key: 'queues',      label: ar ? 'الطوابير'    : 'Queues',      alert: live?.atRisk.length ?? 0 },
          { key: 'breaks',      label: ar ? 'البريكات'    : 'Breaks',      alert: breakData?.unauthorizedCount ?? 0 },
          { key: 'permissions', label: ar ? 'الاستئذانات' : 'Permissions', alert: breakData?.activePermissions.length ?? 0 },
          { key: 'coverage',    label: ar ? 'التغطية'     : 'Coverage',    alert: 0 },
          { key: 'agents',      label: ar ? 'ساعات العمل' : 'Work Hours',  alert: 0 },
          { key: 'daily',       label: ar ? 'التقرير اليومي' : 'Daily Report', alert: 0 },
          { key: 'compliance',  label: ar ? 'المخالفات' : 'Compliance', alert: violations?.summary.open ?? 0 },
          { key: 'adherence',   label: ar ? 'الالتزام' : 'Adherence', alert: adherence?.summary.below85 ?? 0 },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-medium transition-all flex-shrink-0"
            style={{
              background: tab === t.key ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
              color: tab === t.key ? '#818cf8' : '#475569',
              border: tab === t.key ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(255,255,255,0.06)',
            }}>
            {t.label}
            {t.alert > 0 && (
              <span className="px-1 rounded text-[9px] font-bold"
                style={{ background: '#ef444428', color: '#f87171' }}>{t.alert}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex" style={{ minHeight: 0 }}>

        {/* QUEUES TAB — grid left + detail right */}
        {tab === 'queues' && (
          <>
            {/* LEFT — queue grid (3 cols) */}
            <div className="flex flex-col"
              style={{ flex: selectedQueueObj ? '0 0 55%' : '1 1 auto', minWidth: 0, width: selectedQueueObj ? '55%' : '100%', transition: 'flex-basis 0.25s ease, width 0.25s ease', borderInlineEnd: selectedQueueObj ? '1px solid rgba(255,255,255,0.07)' : 'none', overflow: 'hidden' }}>

              {/* Search + channel filter */}
              <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
                <input value={qFilter} onChange={e => setQFilter(e.target.value)}
                  placeholder={ar ? 'بحث عن طابور...' : 'Search queue...'}
                  className="flex-1 rounded-xl text-xs py-1.5 outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', paddingInlineStart: 10 }} />
                <span className="text-[10px] flex-shrink-0" style={{ color: '#334155' }}>
                  {filteredQueues.length} {ar ? 'طابور' : 'queues'}
                </span>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
                {!live ? (
                  <div className="flex flex-col items-center justify-center h-40">
                    <WifiOff size={28} className="mb-2" style={{ color: '#1e293b' }} />
                    <p className="text-xs" style={{ color: '#334155' }}>{ar ? 'لا توجد بيانات سبرينكلر' : 'No Sprinklr data'}</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: selectedQueueObj ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 8 }}>
                    {filteredQueues.map(q => (
                      <QueueCard key={q.queueId} q={q}
                        selected={selectedQueue === q.queueId}
                        onClick={() => setSelectedQueue(p => p === q.queueId ? null : q.queueId)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — detail panel (only when queue selected) */}
            {selectedQueueObj && (
              <div className="flex-1 overflow-y-auto px-4 py-3 pb-6" style={{ scrollbarWidth: 'thin', minWidth: 0 }}>
                <QueueDetailPanel q={selectedQueueObj} detail={queueDetail}
                  agents={live?.agents ?? []} breakData={breakData} ar={ar}
                  onClose={() => setSelectedQueue(null)} />
              </div>
            )}
          </>
        )}

        {tab === 'breaks' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <BreaksPanel breakData={breakData} ar={ar} />
          </div>
        )}
        {tab === 'permissions' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <PermissionsPanel breakData={breakData} ar={ar} />
          </div>
        )}
        {tab === 'coverage' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <CoveragePanel coverage={coverage} live={live} ar={ar} />
          </div>
        )}
        {tab === 'agents' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <AgentHoursPanel timeline={timeline} liveAgents={live?.agents ?? []} ar={ar} />
          </div>
        )}
        {tab === 'daily' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <DailyReportPanel report={daily} forecast={fc} ar={ar}
              from={dailyFrom} to={dailyTo}
              onRange={(f, t) => { setDailyFrom(f); setDailyTo(t); }}
              onRefresh={() => loadDaily(true)} refreshing={dailyRefreshing} />
          </div>
        )}
        {tab === 'compliance' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <CompliancePanel report={violations} ar={ar}
              from={dailyFrom} to={dailyTo}
              onRange={(f, t) => { setDailyFrom(f); setDailyTo(t); }}
              onReview={reviewViolation} />
          </div>
        )}
        {tab === 'adherence' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <AdherencePanel report={adherence} intraday={intraday} ar={ar}
              from={dailyFrom} to={dailyTo}
              onRange={(f, t) => { setDailyFrom(f); setDailyTo(t); }}
              onRefresh={() => loadAdherence(true)} refreshing={adhRefreshing} />
          </div>
        )}
      </div>

      {/* ── REPORT INCIDENT MODAL ──────────────────────────────────────────── */}
      {incidentForm && (
        <ReportIncidentModal
          initial={incidentForm}
          ar={ar}
          onClose={() => setIncidentForm(null)}
        />
      )}

      {/* ── SKILL DISPATCH MODAL ───────────────────────────────────────────── */}
      {skillDispatch && (
        <SkillDispatchModal
          form={skillDispatch}
          dispatching={dispatchingSkill}
          done={dispatchDone}
          ar={ar}
          onClose={() => { setSkillDispatch(null); setDispatchDone(false); }}
          onSubmit={handleSkillDispatch}
        />
      )}
    </div>
  );
}
