/**
 * Shared building blocks for the "360" surfaces (R2.4 consolidation).
 *
 * The agent/team-360 concept lives on four surfaces, each reading a DIFFERENT
 * backend engine — they are intentionally NOT merged into one page:
 *   • Agent 360  — /scorecard?tab=agent360  → roster-v2/agent-360 (clean roster_days master)
 *   • Team 360   — /scorecard?tab=team360   → roster-v2/team-360  (team-leader aggregate)
 *   • People 360 — /analytics?tab=people360 → ops-analytics/people (cross-source blend + Ameyo/score)
 *   • RTA drawer — Agent360Drawer           → integrations/sprinklr/agent-360 (LIVE Sprinklr day)
 *
 * What IS genuinely shared: the duration/colour formatters, the small KPI
 * stat-card render block (Team 360 + People 360 had byte-identical markup),
 * and the canonical deep-link builders so every surface can point to the others.
 */
import type { LucideIcon } from 'lucide-react';
import { Orbit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/store/ui.store';
import { tp, ts } from '@/components/ds';

/* ── shared formatters (were duplicated verbatim across the 360 pages) ────── */

/** minutes → "3h 20m" (identical helper previously copy-pasted in Agent360 + Team360). */
export const dur = (m: number) => { if (!m) return '0'; const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? ` ${mm}m` : ''}` : `${mm}m`; };

/** conformance % → status colour (was `adhC` in Agent360/Team360 and `cf` in People360 — identical bands). */
export const confColor = (v: number | null | undefined) =>
  v == null ? '#64748b' : v >= 95 ? '#22c55e' : v >= 85 ? '#06b6d4' : v >= 70 ? '#f59e0b' : '#f43f5e';

/* ── canonical cross-links between the 360 surfaces ───────────────────────── */

/** Deep link into Agent 360 with the person preselected (Agent360 reads `?person=`). */
export const agent360Url = (person?: string | number | null) =>
  `/scorecard?tab=agent360${person != null && person !== '' ? `&person=${encodeURIComponent(String(person))}` : ''}`;

/** Deep link into Team 360 with the team leader preselected (Team360 reads `?tl=`). */
export const team360Url = (teamLeader?: string | null) =>
  `/scorecard?tab=team360${teamLeader ? `&tl=${encodeURIComponent(teamLeader)}` : ''}`;

/** Deep link into People 360 (Analytics hub tab). */
export const PEOPLE_360_URL = '/analytics?tab=people360';

/* ── small KPI stat card (icon + label + value + optional sub) ─────────────── */
/** The icon-tile stat card whose markup was duplicated in Team360's KPI grid
 *  and People360's summary band. Theme-aware (tp/ts + token borders). */
export function Kpi360Card({ icon: Icon, label, value, sub, color, small = false }: {
  icon: LucideIcon; label: string; value: string | number; sub?: string; color: string; small?: boolean;
}) {
  const dark = useUiStore(s => s.dark);
  return (
    <div className={`flex items-center ${small ? 'gap-2 p-2.5' : 'gap-2.5 p-3'} rounded-xl`}
      style={{ background: dark ? 'rgba(255,255,255,0.035)' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
      <div className={`${small ? 'w-8 h-8' : 'w-10 h-10'} rounded-lg flex items-center justify-center flex-shrink-0`}
        style={{ background: `${color}22`, color }}><Icon size={small ? 15 : 18} /></div>
      <div className="min-w-0">
        <p className="text-[9px] uppercase font-semibold tracking-wide truncate" style={{ color: ts(dark) }}>{label}</p>
        <p className={`${small ? 'text-base' : 'text-xl'} font-bold leading-tight`} style={{ color: tp(dark) }}>
          {typeof value === 'number' ? value.toLocaleString() : value}</p>
        {sub && <p className="text-[9px]" style={{ color: ts(dark) }}>{sub}</p>}
      </div>
    </div>
  );
}

/* ── "open the full 360" pill ──────────────────────────────────────────────── */
/** Small pill that jumps to another 360 surface. Stops propagation so it can
 *  sit inside clickable table rows. */
export function Open360Link({ to, label, ar, title }: {
  to: string; label?: string; ar: boolean; title?: string;
}) {
  const nav = useNavigate();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); nav(to); }}
      title={title || (ar ? 'افتح الملف الكامل 360' : 'Open full 360 profile')}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors hover:opacity-90"
      style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.35)' }}>
      <Orbit size={11} />{label ?? '360'}
    </button>
  );
}
