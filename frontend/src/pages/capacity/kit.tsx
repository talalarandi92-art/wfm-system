/**
 * CAPACITY PLANNER KIT — shared primitives for the /capacity?tab=staffing
 * world-class planner (Stage 1B redesign).
 *
 * Everything is theme-aware via the CSS variables (--surface / --surface-2 /
 * --border / --text-1/2/3) so one component renders correctly across all three
 * themes (Dark / Light / Aurora-Glass) with zero per-theme code, and RTL-aware
 * (logical properties only).
 *
 *   nfmt / fmt1     — number formatting: thin-space thousands, max one decimal
 *   PAL             — the ONE semantic palette (demand/require/team/learn + status)
 *   Section         — numbered story-section card: icon chip + title + one-line
 *                     explainer (AR/EN) + optional header actions
 *   Awaiting        — honest "awaiting data" state (never fake numbers, never 0-as-real)
 *   useMaybe<T>     — fetch an endpoint that may not exist yet (parallel backend
 *                     agent): 'loading' → 'live' | 'missing' (404/network ⇒ missing)
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Hourglass } from 'lucide-react';
import { apiClient } from '@/api/client';
import { readableOn } from '@/utils/format';

/* ── Number formatting ────────────────────────────────────────────────────── */
/** Thin-space thousands, max one decimal: 69429 → "69 429", 6.87 → "6.9". */
export const nfmt = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }).replace(/,/g, ' ');
};
/** One decimal, no thousands logic — for ratios like ×1.25. */
export const fmt1 = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : (Math.round(n * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.$/, '');
/** 0-1 fraction → "83%". */
export const pctFmt = (x: number | null | undefined): string =>
  x == null || Number.isNaN(x) ? '—' : `${Math.round(x * 100)}%`;

/* ── Semantic palette — one meaning per hue across the whole planner ──────── */
export const PAL = {
  demand:  '#38bdf8',   // sky     — demand / volume / contacts
  require: '#818cf8',   // indigo  — the requirement (Erlang output)
  team:    '#a78bfa',   // violet  — people / team / fieldable
  learn:   '#34d399',   // emerald — measured / learned floor (Sprinklr)
  ok:      '#22c55e',   // green   — surplus / sufficient / on-target
  warn:    '#f59e0b',   // amber   — watch / OT / peak column
  risk:    '#ef4444',   // red     — gap / hire / SLA at risk
  neutral: '#64748b',   // slate   — muted / awaiting
} as const;

export const sevPal = (sev: string | undefined): string =>
  sev === 'critical' || sev === 'risk' || sev === 'high' || sev === 'danger' ? PAL.risk
  : sev === 'warning' || sev === 'warn' || sev === 'medium' ? PAL.warn
  : sev === 'good' || sev === 'ok' || sev === 'success' ? PAL.ok
  : PAL.neutral;

/* ── Section — a numbered chapter of the planning story ───────────────────── */
export function Section({ no, icon: Icon, color, title, desc, actions, children, pad = true }: {
  no: string;                       // "١" / "1" — story position
  icon: LucideIcon; color: string;
  title: string;                    // already language-resolved by the caller
  desc?: string;                    // one-line explainer, already language-resolved
  actions?: React.ReactNode;        // header right side (sliders, chips, buttons)
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <section className="rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3 p-4 pb-3 flex-wrap">
        <div className="relative flex-shrink-0" style={{ width: 34, height: 34 }}>
          <div className="w-full h-full rounded-xl grid place-items-center" style={{ background: `${color}1c` }}>
            <Icon size={16} style={{ color }} strokeWidth={2.2} />
          </div>
          <span className="absolute -top-1.5 grid place-items-center rounded-full text-[8px] font-black"
            style={{ insetInlineEnd: -5, width: 14, height: 14, background: color,
              /* the step number sits ON the section's accent, and that accent ranges from
                 indigo to amber — '#fff' was 2.15:1 on amber, 2.28:1 on green. Derive it. */
              color: readableOn(color) }}>{no}</span>
        </div>
        <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
          <div className="font-extrabold text-[13px] leading-tight" style={{ color: 'var(--text-1)' }}>{title}</div>
          {desc && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{desc}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      <div className={pad ? 'px-4 pb-4' : ''}>{children}</div>
    </section>
  );
}

/* ── Awaiting — the honest empty state ────────────────────────────────────── */
export function Awaiting({ ar, text, textAr }: { ar: boolean; text: string; textAr: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
      style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
      <Hourglass size={13} style={{ color: PAL.neutral, flexShrink: 0 }} />
      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? textAr : text}</span>
    </div>
  );
}

/* ── useMaybe — endpoint that may not be deployed yet ─────────────────────── */
export type Maybe<T> = { status: 'loading' } | { status: 'live'; data: T } | { status: 'missing' };

/** GET `url` (query string already embedded). 404 / network error ⇒ 'missing'
 *  so sections can graceful-hide until the parallel backend agent lands. */
export function useMaybe<T = unknown>(url: string): Maybe<T> {
  const [st, setSt] = useState<Maybe<T>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setSt({ status: 'loading' });
    apiClient.get(url)
      .then(r => { if (alive) setSt({ status: 'live', data: r.data as T }); })
      .catch(() => { if (alive) setSt({ status: 'missing' }); });
    return () => { alive = false; };
  }, [url]);
  return st;
}

/* ── Shared planner types (contract with /capacity/staffing/*) ────────────── */
export interface StaffParams {
  functionKey: string; channelMix: Record<string, number>; model: string;
  cpoPct: number | null; ahtSec: number | null; acwSec: number; holdSec: number;
  targetSl: number; targetAnswerSec: number; occupancyCap: number;
  shrinkage: number; productivity: number; concurrency: number; marginalEff: number;
  isStaffed: boolean;
}
export interface HourReq {
  hour: number; volume: number; ahtEffSec: number; erlangs: number;
  agentsForSl: number; occupancyAtN: number; afterProductivity: number;
  requiredScheduledHc: number; learned?: boolean;
}
export interface FnDay { functionKey: string; model: string; hours: HourReq[]; dayTotalRequired: number; dayContacts: number }
export interface ReqDay { date: string; dow?: number; functions: FnDay[]; totalCurve48: number[] }
export interface ReqResp {
  from: string; to: string; ordersScale: number; basis: string;
  measuredAht: Record<string, number>;
  ordersPeriod: { period_label: string; count: number } | null;
  days: ReqDay[];
}
export interface HiringFn {
  functionKey: string; requiredPeak: number; currentTeam: number; gap: number;
  coverageTeamGap?: number; bindingConstraint?: string | null; internsToHire: number;
  worstDay: string | null; scheduleBodiesWorstDay?: number; fieldablePerDay?: number;
  coverageGapBodies?: number; coverageWorstDay?: string | null;
  internsWithOt?: number; otHoursWeekly?: number; surplusBodies?: number;
}
export interface HiringResp {
  from: string; to: string; internProductivity: number; otPct: number;
  totalInternsToHire: number; totalInternsWithOt?: number; totalOtHoursWeekly?: number;
  totalSurplusBodies?: number; basis?: string; perFunction: HiringFn[];
}
