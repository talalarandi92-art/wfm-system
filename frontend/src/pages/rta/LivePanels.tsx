import {
  useState, useEffect, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Users, X, Loader2, Clock, Activity, UserCheck, TrendingUp, Zap,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useCountUp } from '@/components/dazzle';
import { useUiStore } from '@/store/ui.store';
import { tp, ts as tsColor } from '@/components/ds';
import {
  SpAgent, SpQueue, SpLive, BreakTracker, QueueDetail,
  CH_COLOR, slaColor, pctColor, fmtMin,
} from './types';
import { CH_ICON, KpiCard, AgentRow, tok } from './shared';
import { StationPanel } from './StationPanels';
import { agent360Url, Open360Link } from '@/components/agent360/shared';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  QUEUE DETAIL PANEL                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
/* Full agent-state breakdown — counts + names per state, expandable. Sprinklr
   reports agent status station-wide (agents are not tagged to a single queue), so
   this is the live station picture, enriched with break type/duration. */
const STATE_DEFS: { key: string; ar: string; en: string; color: string; match: (a: SpAgent) => boolean }[] = [
  { key: 'available', ar: 'متاح',          en: 'Available', color: '#22c55e', match: a => a.status === 'available' },
  { key: 'busy',      ar: 'مشغول / على كيس', en: 'Busy',     color: '#818cf8', match: a => a.status === 'busy' },
  { key: 'idle',      ar: 'خامل (Idle)',   en: 'Idle',      color: '#f59e0b', match: a => a.status === 'idle' },
  { key: 'break',     ar: 'بريك',          en: 'On Break',  color: '#fb923c', match: a => a.status === 'break' || a.status === 'away' },
  { key: 'offline',   ar: 'غير متاح',       en: 'Offline',   color: '#64748b', match: a => a.status === 'offline' || a.status === 'unknown' },
];

export function AgentStateBreakdown({ agents, breakData, ar, onSelectAgent }: { agents: SpAgent[]; breakData: BreakTracker | null; ar: boolean; onSelectAgent?: (id: string) => void }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const [open, setOpen] = useState<string | null>('available');
  const groups = STATE_DEFS.map(s => ({ ...s, list: agents.filter(s.match) })).filter(g => g.list.length > 0);
  if (!agents.length) return null;
  const breakInfo = (id: string) => breakData?.onBreakNow.find(b => b.agentId === id) ?? null;

  return (
    <div className="rounded-2xl overflow-hidden mb-3" style={{ border: `1px solid ${T.bdr}` }}>
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
        <Users size={11} style={{ color: tsColor(dark) }} />
        <span className="text-xs font-semibold" style={{ color: tsColor(dark) }}>{ar ? 'حالة الإيجنتات الآن — مين بكل حالة' : 'Agent states now — who is where'}</span>
        <span className="text-[9px] ms-auto" style={{ color: T.faint }}>{ar ? 'على مستوى المحطة' : 'station-wide'}</span>
      </div>
      {/* Count chips */}
      <div className="p-2 flex flex-wrap gap-1.5">
        {groups.map(g => (
          <button key={g.key} onClick={() => setOpen(open === g.key ? null : g.key)}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-xl transition-colors"
            style={{ background: open === g.key ? `${g.color}22` : T.panel, border: `1px solid ${open === g.key ? g.color + '55' : T.bdr}`, color: g.color }}>
            <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
            {ar ? g.ar : g.en} <b className="tabular-nums">{g.list.length}</b>
          </button>
        ))}
      </div>
      {/* Names for the open state */}
      {open && groups.find(g => g.key === open) && (
        <div className="px-2 pb-2 flex flex-wrap gap-1.5">
          {groups.find(g => g.key === open)!.list.map(a => {
            const bi = open === 'break' ? breakInfo(a.agentId) : null;
            const color = groups.find(g => g.key === open)!.color;
            return (
              <span key={a.agentId} onClick={() => onSelectAgent?.(a.agentId)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg transition-colors hover:brightness-125"
                style={{ background: `${color}10`, border: `1px solid ${color}22`, color: tp(dark), cursor: onSelectAgent ? 'pointer' : 'default' }}>
                {a.agentName}
                {a.statusSec != null && a.statusSec > 0 && <span className="text-[9px] tabular-nums" style={{ color: T.faint }}>· {fmtSince(a.statusSec, ar)}</span>}
                {bi?.statusRaw && <span className="text-[9px]" style={{ color }}>· {bi.statusRaw}{bi.minutesSoFar != null ? ` ${bi.minutesSoFar}${ar ? 'د' : 'm'}` : ''}{bi.isAuthorized === false ? ' ⚠' : ''}</span>}
                {!bi && a.statusRaw && a.statusRaw !== a.status && <span className="text-[9px]" style={{ color: T.faint }}>· {a.statusRaw}</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Compact "time in current status" formatter (status-transition engine).
function fmtSince(sec: number | null | undefined, ar: boolean): string {
  if (sec == null || sec < 0) return '';
  if (sec < 60) return ar ? `${sec}ث` : `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return ar ? `${m}د` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return ar ? `${h}س${rm ? ' ' + rm + 'د' : ''}` : `${h}h${rm ? ' ' + rm + 'm' : ''}`;
}

export function LiveAgentsPanel({ live, breakData, ar, onSelectAgent }: { live: SpLive | null; breakData: BreakTracker | null; ar: boolean; onSelectAgent?: (id: string) => void }) {
  const agents = live?.agents ?? [];
  return (
    <div>
      {live?.stationSummary && <StationPanel station={live.stationSummary} ar={ar} />}
      <AgentStateBreakdown agents={agents} breakData={breakData} ar={ar} onSelectAgent={onSelectAgent} />
      {/* Rich live roster: status + duration + today's contacts/AHT/hold/idle/conformance */}
      <AgentBoard ar={ar} onSelectAgent={onSelectAgent} />
    </div>
  );
}

/* ── Agent 360 drawer — everything about one agent in one place ─────────────── */
const ST_META: Record<string, { c: string; ar: string; en: string }> = {
  available: { c: '#22c55e', ar: 'متاح', en: 'Available' },
  idle:      { c: '#f59e0b', ar: 'خامل', en: 'Idle' },
  busy:      { c: '#818cf8', ar: 'مشغول', en: 'Busy' },
  break:     { c: '#fb923c', ar: 'بريك', en: 'Break' },
  away:      { c: '#fb923c', ar: 'بعيد', en: 'Away' },
  offline:   { c: '#64748b', ar: 'غير متصل', en: 'Offline' },
  unknown:   { c: '#475569', ar: 'غير معروف', en: 'Unknown' },
};
const stMeta = (s: string) => ST_META[s] || ST_META.unknown;
const fmtSecHM = (s: number | null | undefined) => { if (s == null || s <= 0) return '—'; const m = Math.floor(s / 60), ss = Math.round(s % 60); return m ? `${m}m ${ss}s` : `${ss}s`; };
const fmtClock = (iso: string | null | undefined, ar: boolean) => iso ? new Date(iso).toLocaleTimeString(ar ? 'ar-KW' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuwait' }) : '—';

/* Count up to a value ONCE on mount (entrance dazzle), then track live value
   instantly — so live-polling numbers don't re-animate from 0 every refresh. */
export function useCountUpOnce(target: number) {
  const [done, setDone] = useState(false);
  const v = useCountUp(target, 900, !done);
  useEffect(() => { const t = setTimeout(() => setDone(true), 950); return () => clearTimeout(t); }, []);
  return done ? target : v;
}

/* Self-contained SVG donut for the agent-state mix (explicit colors → safe on
   the dark Wallboard regardless of theme). Center shows total agents.
   KEEP-DARK (theme-token sweep): embedded in the full-screen TV Wallboard whose
   surface is hardcoded dark, so its neutrals stay explicit — do not tokenize. */
export function AgentDonut({ avail, busy, brk, off, ar, size = 150, thickness = 16 }: { avail: number; busy: number; brk: number; off: number; ar: boolean; size?: number; thickness?: number }) {
  const segs = [
    { v: avail, c: '#22c55e', l: ar ? 'متاح' : 'Available' },
    { v: busy, c: '#f59e0b', l: ar ? 'مشغول' : 'Busy' },
    { v: brk, c: '#a855f7', l: ar ? 'بريك' : 'Break' },
    { v: off, c: '#334155', l: ar ? 'غير متصل' : 'Offline' },
  ];
  const total = Math.max(1, segs.reduce((s, x) => s + x.v, 0));
  const r = (size - thickness) / 2; const C = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
          {segs.filter(s => s.v > 0).map((s, i) => {
            const len = (s.v / total) * C; const o = acc; acc += len;
            return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.c} strokeWidth={thickness}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-o}
              style={{ transition: 'stroke-dasharray .6s ease, stroke-dashoffset .6s ease' }} />;
          })}
        </g>
        <text x="50%" y="45%" textAnchor="middle" dominantBaseline="middle" fill="#e8edf7" fontSize={size * 0.26} fontWeight="800">{total}</text>
        <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" fill="#64748b" fontSize={size * 0.085}>{ar ? 'موظف' : 'agents'}</text>
      </svg>
      <div className="space-y-1.5">
        {segs.map(s => (
          <div key={s.l} className="flex items-center gap-2" style={{ fontSize: 12 }}>
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.c }} />
            <span style={{ color: '#94a3b8', minWidth: 64 }}>{s.l}</span>
            <b className="tabular-nums" style={{ color: '#e2e8f0' }}>{s.v}</b>
            <span className="tabular-nums" style={{ color: '#475569' }}>{Math.round((s.v / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Agent Board — rich live roster: status + duration + today's stats ──────── */
/* KEEP-DARK (theme-token sweep): AgentBoard is rendered INSIDE the full-screen
   TV Wallboard (big) whose surface is hardcoded #060912 regardless of theme —
   theming its neutrals would break the wallboard, so they stay explicit. */
interface BoardRow {
  agentId: string; name: string; email: string | null; employeeNo: string | null; functionName: string | null;
  status: string; statusRaw: string | null; statusSec: number | null;
  contacts: number | null; ahtSec: number | null; frtSec: number | null;
  idleMin: number | null; holdMin: number | null; busyMin: number | null; breakMin: number | null; workingMin: number | null;
  adherencePct: number | null; conformancePct: number | null;
}
const BOARD_FILTERS: { key: string; ar: string; en: string; c: string; match: (s: string) => boolean }[] = [
  { key: 'all', ar: 'الكل', en: 'All', c: '#94a3b8', match: () => true },
  { key: 'available', ar: 'متاح', en: 'Available', c: '#22c55e', match: s => s === 'available' || s === 'idle' },
  { key: 'busy', ar: 'مشغول', en: 'Busy', c: '#818cf8', match: s => s === 'busy' },
  { key: 'break', ar: 'بريك', en: 'Break', c: '#fb923c', match: s => s === 'break' || s === 'away' },
  { key: 'offline', ar: 'غير متصل', en: 'Offline', c: '#64748b', match: s => s === 'offline' || s === 'unknown' },
];
export function AgentBoard({ ar, big, onSelectAgent }: { ar: boolean; big?: boolean; onSelectAgent?: (id: string) => void }) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = () => apiClient.get<{ agents: BoardRow[] }>('/integrations/sprinklr/agent-board')
      .then(r => { if (alive) setRows(r.data.agents || []); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    load(); const t = setInterval(load, 25000); return () => { alive = false; clearInterval(t); };
  }, []);
  const counts: Record<string, number> = {}; for (const f of BOARD_FILTERS) counts[f.key] = rows.filter(r => f.match(r.status)).length;
  const def = BOARD_FILTERS.find(f => f.key === filter) ?? BOARD_FILTERS[0];
  const list = rows.filter(r => def.match(r.status) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const mm = (m: number | null | undefined) => (m == null ? '—' : `${m}${ar ? 'د' : 'm'}`);
  const cols = '1.7fr 1.2fr 0.7fr 0.8fr 0.7fr 0.7fr 0.9fr';
  const fz = big ? 13 : 11;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: big ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
      <div className="flex items-center gap-2 p-2 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث عن إيجنت...' : 'Search agent...'}
          className="rounded-lg text-xs py-1.5 px-3 outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', minWidth: 150 }} />
        {BOARD_FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-xl"
            style={{ background: filter === f.key ? `${f.c}22` : 'rgba(255,255,255,0.03)', border: `1px solid ${filter === f.key ? f.c + '55' : 'rgba(255,255,255,0.06)'}`, color: f.c }}>
            <span className="w-2 h-2 rounded-full" style={{ background: f.c }} />{ar ? f.ar : f.en} <b className="tabular-nums">{counts[f.key]}</b>
          </button>
        ))}
        {/* View toggle: table ⇄ cards */}
        <div className="flex items-center gap-0.5 rounded-lg p-0.5 ms-auto" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {([['table', '☰'], ['cards', '▦']] as const).map(([v, ic]) => (
            <button key={v} onClick={() => setView(v)} title={v}
              style={{ padding: '3px 9px', borderRadius: 7, fontSize: 13, cursor: 'pointer', border: 'none',
                background: view === v ? 'rgba(99,102,241,0.25)' : 'transparent', color: view === v ? '#a5b4fc' : '#64748b' }}>{ic}</button>
          ))}
        </div>
        <span className="text-[10px]" style={{ color: '#475569' }}>{list.length} {ar ? 'موظف' : 'agents'}</span>
      </div>
      {view === 'table' && (
      <div className="grid items-center gap-2 px-3 py-2 text-[9px] font-bold uppercase tracking-wide"
        style={{ gridTemplateColumns: cols, background: 'rgba(255,255,255,0.03)', color: '#475569', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span>{ar ? 'الإيجنت' : 'Agent'}</span><span>{ar ? 'الحالة' : 'Status'}</span><span>{ar ? 'كونتاكت' : 'Contacts'}</span><span>AHT</span><span>{ar ? 'هولد' : 'Hold'}</span><span>{ar ? 'خامل' : 'Idle'}</span><span>{ar ? 'كونفورمانس' : 'Conf'}</span>
      </div>
      )}
      <div className="overflow-y-auto" style={{ maxHeight: big ? 'calc(100vh - 380px)' : 'calc(100vh - 430px)', scrollbarWidth: 'thin' }}>
        {loading && rows.length === 0 ? <p className="text-xs text-center py-6" style={{ color: '#334155' }}>{ar ? 'جاري التحميل...' : 'Loading...'}</p>
          : list.length === 0 ? <p className="text-xs text-center py-6" style={{ color: '#334155' }}>{ar ? 'لا إيجنتات' : 'No agents'}</p>
            : view === 'cards' ? (
              <div className="grid gap-2.5 p-2.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${big ? 240 : 208}px, 1fr))` }}>
                {list.map(r => {
                  const m = stMeta(r.status);
                  const off = r.status === 'offline' || r.status === 'unknown';
                  const initials = (r.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
                  const conf = r.conformancePct;
                  return (
                    <div key={r.agentId} onClick={() => onSelectAgent?.(r.agentId)}
                      className="rounded-2xl p-3 transition-all"
                      style={{ background: `${m.c}10`, border: `1px solid ${m.c}33`, borderTop: `3px solid ${m.c}`, cursor: onSelectAgent ? 'pointer' : 'default', opacity: off ? 0.6 : 1 }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.background = `${m.c}1f`; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.background = `${m.c}10`; }}>
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="flex items-center justify-center rounded-full flex-shrink-0 font-bold"
                          style={{ width: 42, height: 42, fontSize: 15, color: '#fff', background: `linear-gradient(135deg, ${m.c}, ${m.c}aa)`, boxShadow: `0 0 0 2px ${m.c}40, 0 0 14px ${m.c}55` }}>{initials}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold" style={{ color: '#e8edf7', fontSize: 13 }}>{r.name}</div>
                          {r.functionName && r.functionName !== '—' && <div className="truncate text-[10px]" style={{ color: '#64748b' }}>{r.functionName}</div>}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 mb-2.5 text-[11px]" style={{ background: `${m.c}1f`, border: `1px solid ${m.c}3a`, color: m.c, fontWeight: 600 }}>
                        <span className="rounded-full" style={{ width: 6, height: 6, background: m.c, boxShadow: `0 0 6px ${m.c}` }} />{ar ? m.ar : m.en}{r.statusSec != null && r.statusSec > 0 ? <span className="tabular-nums" style={{ opacity: 0.75 }}> · {fmtSince(r.statusSec, ar)}</span> : null}
                      </span>
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        {[
                          { l: ar ? 'كونتاكت' : 'Contacts', v: r.contacts ?? '—', c: r.contacts ? '#34d399' : '#475569' },
                          { l: 'AHT', v: fmtSecHM(r.ahtSec), c: r.ahtSec ? '#a5b4fc' : '#475569' },
                          { l: ar ? 'كونف' : 'Conf', v: conf != null ? `${Math.round(conf)}%` : '—', c: conf != null ? pctColor(conf) : '#475569' },
                        ].map(k => (<div key={k.l} className="rounded-lg py-1.5" style={{ background: 'rgba(0,0,0,0.18)' }}><div className="font-bold tabular-nums" style={{ color: k.c, fontSize: 14 }}>{k.v}</div><div className="text-[9px] mt-0.5" style={{ color: '#475569' }}>{k.l}</div></div>))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-center mt-1.5">
                        {[
                          { l: ar ? 'هولد' : 'Hold', v: mm(r.holdMin), c: r.holdMin ? '#22d3ee' : '#475569' },
                          { l: ar ? 'خامل' : 'Idle', v: mm(r.idleMin), c: r.idleMin ? '#fbbf24' : '#475569' },
                        ].map(k => (<div key={k.l} className="rounded-lg py-1.5" style={{ background: 'rgba(0,0,0,0.18)' }}><div className="font-bold tabular-nums" style={{ color: k.c, fontSize: 13 }}>{k.v}</div><div className="text-[9px] mt-0.5" style={{ color: '#475569' }}>{k.l}</div></div>))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
            : list.map(r => {
              const m = stMeta(r.status);
              const off = r.status === 'offline' || r.status === 'unknown';
              const initials = (r.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
              const conf = r.conformancePct;
              const av = big ? 38 : 30;
              return (
                <div key={r.agentId} onClick={() => onSelectAgent?.(r.agentId)}
                  className="grid items-center gap-2 transition-all"
                  style={{ gridTemplateColumns: cols, fontSize: fz, padding: big ? '10px 14px' : '7px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.03)', borderInlineStart: `2px solid ${off ? 'transparent' : m.c}`,
                    cursor: onSelectAgent ? 'pointer' : 'default', opacity: off ? 0.55 : 1, background: off ? 'transparent' : `${m.c}0a` }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${m.c}24`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = off ? 'transparent' : `${m.c}0a`; }}>
                  {/* Agent: avatar + name/function */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex items-center justify-center rounded-full flex-shrink-0 font-bold"
                      style={{ width: av, height: av, fontSize: big ? 14 : 11, color: '#fff', background: `linear-gradient(135deg, ${m.c}, ${m.c}aa)`, boxShadow: `0 0 0 2px ${m.c}33` }}>{initials}</div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold" style={{ color: '#e8edf7' }}>{r.name}</div>
                      {r.functionName && r.functionName !== '—' && <div className="truncate" style={{ color: '#64748b', fontSize: big ? 11 : 9 }}>{r.functionName}</div>}
                    </div>
                  </div>
                  {/* Status pill */}
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: `${m.c}1f`, border: `1px solid ${m.c}3a`, color: m.c, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: m.c, boxShadow: `0 0 6px ${m.c}` }} />
                      {ar ? m.ar : m.en}{r.statusSec != null && r.statusSec > 0 ? <span className="tabular-nums" style={{ opacity: 0.7 }}> · {fmtSince(r.statusSec, ar)}</span> : null}
                    </span>
                  </div>
                  <span className="tabular-nums font-semibold" style={{ color: r.contacts ? '#34d399' : '#475569' }}>{r.contacts ?? '—'}</span>
                  <span className="tabular-nums" style={{ color: r.ahtSec ? '#a5b4fc' : '#475569' }}>{fmtSecHM(r.ahtSec)}</span>
                  <span className="tabular-nums" style={{ color: r.holdMin ? '#22d3ee' : '#475569' }}>{mm(r.holdMin)}</span>
                  <span className="tabular-nums" style={{ color: r.idleMin ? '#fbbf24' : '#475569' }}>{mm(r.idleMin)}</span>
                  {/* Conformance mini-bar + % */}
                  <span className="flex items-center gap-1.5">
                    {conf != null ? (<>
                      <span className="rounded-full overflow-hidden" style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', maxWidth: 46 }}>
                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, conf))}%`, background: pctColor(conf) }} />
                      </span>
                      <span className="tabular-nums font-semibold" style={{ color: pctColor(conf), minWidth: 30, textAlign: 'end' }}>{Math.round(conf)}%</span>
                    </>) : <span style={{ color: '#475569' }}>—</span>}
                  </span>
                </div>
              );
            })}
      </div>
    </div>
  );
}

interface A360 {
  agentId: string; date: string | null;
  daily: null | {
    stat_date: string; agent_name: string; agent_email: string; employee_no: string | null; employee_name: string | null; function_name: string | null;
    first_login: string | null; last_logout: string | null;
    total_working_minutes: number; idle_no_case_minutes: number; idle_with_case_minutes: number; busy_minutes: number; break_minutes: number; offline_minutes: number;
    contacts_received: number | null; aht_seconds: number | null; avg_response_seconds: number | null;
    status_minutes: Record<string, number>; break_breakdown: Record<string, number>; utilizationPct: number | null;
  };
  live: null | { status: string; statusRaw: string | null; since: string; seconds: number; name: string | null; email: string | null };
  timeline: { status: string; status_raw: string | null; started_at: string; ended_at: string | null; duration_sec: number }[];
}

export function Agent360Drawer({ agentId, fallbackName, ar, dark, onClose }: {
  agentId: string; fallbackName?: string; ar: boolean; dark: boolean; onClose: () => void;
}) {
  const [data, setData] = useState<A360 | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient.get<A360>(`/integrations/sprinklr/agent-360?agentId=${encodeURIComponent(agentId)}`)
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [agentId]);

  const d = data?.daily;
  const live = data?.live;
  const name = d?.employee_name || live?.name || d?.agent_name || fallbackName || agentId;
  const lm = live ? stMeta(live.status) : null;
  const surface = dark ? 'rgba(255,255,255,0.03)' : '#fff';
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const txt = dark ? '#e2e8f0' : '#0f172a';
  const muted = dark ? '#64748b' : '#94a3b8';

  // Time-composition segments (busy / idle-no-case / hold / break / offline)
  const segs = d ? [
    { k: 'busy',  c: '#818cf8', v: d.busy_minutes,           l: ar ? 'مشغول' : 'Busy' },
    { k: 'idle',  c: '#f59e0b', v: d.idle_no_case_minutes,   l: ar ? 'خامل (بلا كيس)' : 'Idle (no case)' },
    { k: 'hold',  c: '#22d3ee', v: d.idle_with_case_minutes, l: ar ? 'هولد (كيس معلّق)' : 'Hold (case held)' },
    { k: 'break', c: '#fb923c', v: d.break_minutes,          l: ar ? 'بريك' : 'Break' },
    { k: 'off',   c: '#475569', v: d.offline_minutes,        l: ar ? 'غير متصل' : 'Offline' },
  ].filter(s => s.v > 0) : [];
  const segTotal = segs.reduce((s, x) => s + x.v, 0) || 1;
  const tlTotal = (data?.timeline ?? []).reduce((s, x) => s + (x.duration_sec || 0), 0) || 1;
  const bd = d?.break_breakdown && typeof d.break_breakdown === 'object' ? d.break_breakdown : {};
  const breakChips = Object.entries(bd).filter(([, v]) => Number(v) > 0);

  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', justifyContent: ar ? 'flex-start' : 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: tok(dark).overlay, backdropFilter: 'blur(2px)' }} />
      <div className="h-full overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}
        style={{ position: 'relative', width: 440, maxWidth: '92vw', background: dark ? '#0b0f1c' : '#f8fafc', borderInlineStart: `1px solid ${border}`, boxShadow: '0 0 40px rgba(0,0,0,0.5)', animation: 'ds-slide .25s ease' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10" style={{ background: dark ? '#0b0f1c' : '#f8fafc', borderBottom: `1px solid ${border}` }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }}>{(name[0] || '?').toUpperCase()}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate" style={{ color: txt }}>{name}</div>
            <div className="text-[11px] truncate" style={{ color: muted }}>
              {(d?.function_name && d.function_name !== '—') ? d.function_name : ''}{d?.employee_no ? ` · #${d.employee_no}` : ''}{d?.agent_email ? ` · ${d.agent_email}` : ''}
            </div>
          </div>
          {/* cross-link → the full historical Agent 360 (this drawer is the LIVE Sprinklr day only) */}
          {d?.employee_no && <Open360Link to={agent360Url(d.employee_no)} label={ar ? 'الملف الكامل 360' : 'Full 360'} ar={ar} title={ar ? 'افتح ملف الموظف 360 الكامل (سكوركارد)' : 'Open the full Agent 360 profile (Scorecard hub)'} />}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10"><X size={16} style={{ color: muted }} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin" style={{ color: '#6366f1' }} /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Live status */}
            <div className="rounded-2xl p-3 flex items-center gap-3" style={{ background: surface, border: `1px solid ${lm ? lm.c + '44' : border}` }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: lm?.c || muted, boxShadow: lm ? `0 0 10px ${lm.c}` : 'none' }} />
              <div className="flex-1">
                <div className="text-[10px]" style={{ color: muted }}>{ar ? 'الحالة الآن' : 'Current status'}</div>
                <div className="text-sm font-bold" style={{ color: lm?.c || muted }}>
                  {live ? (ar ? lm!.ar : lm!.en) : (ar ? '— (لا بث حيّ)' : '— (no live feed)')}
                  {live?.statusRaw && live.statusRaw !== live.status ? <span className="text-[11px] font-normal" style={{ color: muted }}> · {live.statusRaw}</span> : null}
                </div>
              </div>
              {live && <div className="text-end"><div className="text-sm font-bold tabular-nums" style={{ color: txt }}>{fmtSince(live.seconds, ar)}</div><div className="text-[10px]" style={{ color: muted }}>{ar ? 'منذ' : 'in status'}</div></div>}
            </div>

            {d ? (<>
              {data?.date && d.stat_date !== data.date && (
                <div className="text-[10px] text-center" style={{ color: '#fbbf24' }}>{ar ? `لا بيانات لليوم — يعرض آخر يوم: ${d.stat_date}` : `No data today — showing last day: ${d.stat_date}`}</div>
              )}
              {/* KPI tiles */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { l: 'AHT', v: fmtSecHM(d.aht_seconds), c: '#818cf8' },
                  { l: ar ? 'كونتاكت' : 'Contacts', v: d.contacts_received ?? '—', c: '#22c55e' },
                  { l: ar ? 'زمن أول رد' : 'First Response', v: fmtSecHM(d.avg_response_seconds), c: '#06b6d4' },
                  { l: ar ? 'الإشغال' : 'Utilization', v: d.utilizationPct != null ? `${d.utilizationPct}%` : '—', c: '#f59e0b' },
                ].map(k => (
                  <div key={k.l} className="rounded-xl p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                    <div className="text-lg font-bold tabular-nums" style={{ color: k.c }}>{k.v}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: muted }}>{k.l}</div>
                  </div>
                ))}
              </div>

              {/* Login / Logout */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                  <div className="text-sm font-bold" style={{ color: '#86efac' }}>{fmtClock(d.first_login, ar)}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: muted }}>{ar ? 'أول دخول' : 'First login'}</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                  <div className="text-sm font-bold" style={{ color: '#fca5a5' }}>{fmtClock(d.last_logout, ar)}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: muted }}>{ar ? 'آخر خروج' : 'Last logout'}</div>
                </div>
              </div>

              {/* Time composition */}
              {segs.length > 0 && (
                <div className="rounded-2xl p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                  <div className="text-[11px] font-bold mb-2" style={{ color: txt }}>{ar ? 'توزيع وقت العمل' : 'Time composition'} · {fmtMin(segTotal)}</div>
                  <div className="flex h-2.5 rounded-full overflow-hidden mb-2">
                    {segs.map(s => <span key={s.k} title={`${s.l} ${fmtMin(s.v)}`} style={{ width: `${(s.v / segTotal) * 100}%`, background: s.c }} />)}
                  </div>
                  <div className="space-y-1">
                    {segs.map(s => (
                      <div key={s.k} className="flex items-center gap-2 text-[11px]">
                        <span className="w-2 h-2 rounded-sm" style={{ background: s.c }} />
                        <span className="flex-1" style={{ color: muted }}>{s.l}</span>
                        <span className="tabular-nums font-semibold" style={{ color: txt }}>{fmtMin(s.v)}</span>
                        <span className="tabular-nums" style={{ color: muted, minWidth: 38, textAlign: 'end' }}>{Math.round((s.v / segTotal) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Break breakdown */}
              {breakChips.length > 0 && (
                <div className="rounded-2xl p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                  <div className="text-[11px] font-bold mb-2" style={{ color: txt }}>{ar ? 'تفصيل البريكات' : 'Break breakdown'}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {breakChips.map(([k, v]) => (
                      <span key={k} className="text-[10px] px-2 py-1 rounded-lg" style={{ background: 'rgba(251,146,60,0.12)', color: '#fdba74', border: '1px solid rgba(251,146,60,0.25)' }}>{k}: {fmtMin(Number(v))}</span>
                    ))}
                  </div>
                </div>
              )}
            </>) : (
              <div className="text-center py-6 text-xs" style={{ color: muted }}>{ar ? 'لا توجد إحصائيات يومية لهذا الموظف بعد' : 'No daily stats for this agent yet'}</div>
            )}

            {/* Status timeline */}
            {(data?.timeline?.length ?? 0) > 0 && (
              <div className="rounded-2xl p-3" style={{ background: surface, border: `1px solid ${border}` }}>
                <div className="text-[11px] font-bold mb-2" style={{ color: txt }}>{ar ? 'الخط الزمني للحالات' : 'Status timeline'}</div>
                <div className="flex h-3 rounded-full overflow-hidden mb-2">
                  {data!.timeline.map((t, i) => {
                    const m = stMeta(t.status);
                    return <span key={i} title={`${ar ? m.ar : m.en} · ${fmtSecHM(t.duration_sec)} (${fmtClock(t.started_at, ar)}–${fmtClock(t.ended_at, ar)})`} style={{ width: `${(t.duration_sec / tlTotal) * 100}%`, background: m.c }} />;
                  })}
                </div>
                <div className="space-y-1 max-h-44 overflow-y-auto">
                  {[...data!.timeline].reverse().slice(0, 30).map((t, i) => {
                    const m = stMeta(t.status);
                    return (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: m.c }} />
                        <span className="tabular-nums" style={{ color: muted }}>{fmtClock(t.started_at, ar)}</span>
                        <span className="flex-1 truncate" style={{ color: txt }}>{t.status_raw || (ar ? m.ar : m.en)}</span>
                        <span className="tabular-nums" style={{ color: muted }}>{fmtSecHM(t.duration_sec)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

export function QueueDetailPanel({ q, detail, agents, breakData, ar, onClose, onSelectAgent }: {
  q: SpQueue; detail: QueueDetail | null; agents: SpAgent[];
  breakData: BreakTracker | null; ar: boolean; onClose: () => void; onSelectAgent?: (id: string) => void;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
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
          <h2 className="text-sm font-bold truncate" style={{ color: tp(dark) }}>{q.queueName}</h2>
          <p className="text-[10px] capitalize" style={{ color: T.faint }}>{q.channel}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <X size={14} style={{ color: tsColor(dark) }} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <KpiCard label={ar ? 'انتظار'  : 'Waiting'}   val={q.waiting}         color="#f59e0b" icon={Clock} />
        <KpiCard label={ar ? 'جارية'   : 'Active'}    val={q.inProgress}      color="#818cf8" icon={Activity} />
        <KpiCard label={ar ? 'متاح'    : 'Available'} val={q.agentsAvailable} color="#22c55e" icon={UserCheck} />
        <KpiCard label="SLA"                           val={`${q.slaPct ?? 100}%`} color={slaColor(q.slaPct ?? 100)} icon={TrendingUp} />
      </div>

      {/* Extra — full per-queue metric set (backlog, wait, AHT, breached, staffing) */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { l: ar ? 'باكلوج' : 'Backlog',     v: q.backlog ?? 0,                                                          c: (q.backlog ?? 0) > 0 ? '#f59e0b' : tsColor(dark) },
          { l: ar ? 'وقت انتظار' : 'Avg Wait', v: q.avgWaitSeconds > 0 ? `${Math.round(q.avgWaitSeconds / 60)}${ar ? 'د' : 'm'}` : '—', c: tsColor(dark) },
          { l: ar ? 'AHT الكيو' : 'Queue AHT', v: q.aht > 0 ? `${Math.round(q.aht / 60)}${ar ? 'د' : 'm'}` : '—',           c: '#818cf8' },
          { l: ar ? 'SLA خُرق' : 'Breached',   v: q.slaBreached,                                                           c: q.slaBreached > 0 ? '#f87171' : tsColor(dark) },
          { l: ar ? 'مشغول' : 'Busy',         v: q.agentsBusy ?? 0,                                                       c: '#818cf8' },
          { l: ar ? 'بريك' : 'On Break',      v: q.agentsBreak ?? 0,                                                      c: (q.agentsBreak ?? 0) > 0 ? '#fb923c' : tsColor(dark) },
          { l: ar ? 'مسجّل دخول' : 'Logged In', v: q.agentsLoggedIn ?? '—',                                               c: '#22c55e' },
          { l: ar ? 'خامل' : 'Idle',          v: q.agentsIdle ?? '—',                                                     c: '#f59e0b' },
        ].map(item => (
          <div key={item.l} className="rounded-xl p-2 text-center"
            style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
            <div className="text-sm font-bold tabular-nums" style={{ color: item.c }}>{item.v}</div>
            <div className="text-[10px] mt-0.5" style={{ color: T.faint }}>{item.l}</div>
          </div>
        ))}
      </div>

      {/* Full agent-state breakdown — who is available/busy/idle/break/offline */}
      <AgentStateBreakdown agents={agents} breakData={breakData} ar={ar} onSelectAgent={onSelectAgent} />

      {/* HC breakdown */}
      {queueAgents.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-3"
          style={{ border: `1px solid ${T.bdr}` }}>
          <div className="px-3 py-2 flex items-center gap-2"
            style={{ background: T.panel, borderBottom: `1px solid ${T.bdr}` }}>
            <Users size={11} style={{ color: tsColor(dark) }} />
            <span className="text-xs font-semibold" style={{ color: tsColor(dark) }}>
              {ar ? 'إيجنت الطابور' : 'Queue Agents'} ({queueAgents.length})
            </span>
          </div>
          <div className="max-h-44 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {queueAgents.map(a => {
              const hist = breakData?.agentHistory.find(h => h.agentId === a.agentId) ?? null;
              return (
                <div key={a.agentId} onClick={() => onSelectAgent?.(a.agentId)} style={{ cursor: onSelectAgent ? 'pointer' : 'default' }}>
                  <AgentRow agent={a} breakHistory={hist} showBreakInfo ar={ar} />
                </div>
              );
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
        <p className="text-xs text-center py-4" style={{ color: T.faint }}>
          {ar ? 'لا توجد بيانات إيجنت لهذا الطابور' : 'No agent data for this queue'}
        </p>
      )}
    </div>
  );
}
