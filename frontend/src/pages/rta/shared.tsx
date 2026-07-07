import {
  MessageSquare, Mail, Phone, Hash, Activity,
} from 'lucide-react';
import { StatTile } from '@/components/dazzle';
import {
  SpQueue, SpAgent, BreakAgent, AgentBreakHistory,
  CH_COLOR, ST_COLOR, slaColor, fmtNum, fmtMin, stLabel,
} from './types';

export const CH_ICON: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare size={12} />, chat: <MessageSquare size={12} />,
  email: <Mail size={12} />, social: <Hash size={12} />,
  voice: <Phone size={12} />, unknown: <Activity size={12} />,
};

/* ── KPI Card ───────────────────────────────────────────────────────────────── */
// Live KPI tile — premium dazzle StatTile look (accent edge / glow / hover, theme-var) but INSTANT
// values (no count-up) so it never flashes to zero on the live RTA re-poll.
export function KpiCard({ label, val, color, icon: Icon, sub }: {
  label: string; val: string | number; color: string; icon: any; sub?: string;
}) {
  return <StatTile icon={Icon} label={label} value={typeof val === 'number' ? fmtNum(val) : String(val)} sub={sub} color={color} />;
}

/* ── Queue Grid Card ─────────────────────────────────────────────────────── */
export function QueueCard({ q, selected, onClick, ar }: { q: SpQueue; selected: boolean; onClick: () => void; ar: boolean }) {
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
          <div className="text-[9px] mt-0.5" style={{ color: '#334155' }}>{ar ? 'انتظار' : 'Waiting'}</div>
        </div>
        <div className="flex gap-3 mb-0.5 ms-auto">
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: '#818cf8' }}>{q.inProgress}</div>
            <div className="text-[9px]" style={{ color: '#334155' }}>{ar ? 'نشط' : 'Active'}</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: '#22c55e' }}>{q.agentsAvailable}</div>
            <div className="text-[9px]" style={{ color: '#334155' }}>{ar ? 'متاح' : 'Available'}</div>
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
export function AgentRow({ agent, showBreakInfo, breakHistory, ar }: {
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
export function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
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
