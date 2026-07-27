/**
 * ROSTER KIT — shared primitives for the Roster Analytics dashboard
 * (Stage 3B redesign — same design language as pages/capacity/kit.tsx and
 * pages/schedule/kit.tsx, so the whole product feels like ONE premium app).
 *
 * Theme-aware via CSS variables (--surface / --surface-2 / --border /
 * --text-1/2/3) so one component renders correctly across all three themes
 * (Dark / Light / Aurora-Glass) with zero per-theme code. RTL-aware (logical
 * properties only).
 *
 *   nfmt / pct1 / hrs / dur — number & duration formatting
 *   RPAL                    — the ONE semantic palette (presence + OT + status)
 *   PRESENCE                — canonical presence-category metadata (key/label/hue)
 *   adhHue                  — conformance/adherence colour by band
 *   Section                 — numbered story-section card (icon chip + title + explainer)
 *   Awaiting                — honest "awaiting data" state (never fake numbers)
 *   useMaybe<T>             — fetch an endpoint that may not exist yet (parallel
 *                            backend agent): 'loading' → 'live' | 'missing' (404 ⇒ missing)
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Hourglass } from 'lucide-react';
import { apiClient } from '@/api/client';
import { readableOn } from '@/utils/format';

/* ── Number & duration formatting ─────────────────────────────────────────── */
/** Thin-space thousands, max one decimal: 69429 → "69 429", 6.87 → "6.9". */
export const nfmt = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }).replace(/,/g, ' ');
};
/** 0–100 number → "83%". */
export const pct1 = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${Math.round(n)}%`;
/** minutes → decimal hours number (for count-up tiles). */
export const toHrs = (min: number | null | undefined): number =>
  min == null || Number.isNaN(min) ? 0 : Math.round((min / 60) * 10) / 10;
/** minutes → "12.5h" string. */
export const hrs = (min: number | null | undefined): string =>
  min == null || Number.isNaN(min) ? '—' : `${nfmt(min / 60)}h`;
/** minutes → "1h 20m" / "45m" — compact human duration. */
export const dur = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min) || min === 0) return '0';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

/* ── Semantic palette — one meaning per hue across the roster world ───────── */
export const RPAL = {
  office:  '#22c55e',   // green   — present in office
  wfh:     '#06b6d4',   // cyan    — present, work-from-home
  off:     '#64748b',   // slate   — weekly rest day
  leave:   '#8b5cf6',   // violet  — annual / approved leave
  sick:    '#f59e0b',   // amber   — sick
  absent:  '#ef4444',   // red     — unplanned absence
  // OT buckets — kept identical to the OT & Exceptions page for cross-page consistency
  otReg:   '#22d3ee',   // cyan    — regular workday OT
  otOff:   '#a78bfa',   // violet  — off-day OT
  otHol:   '#ef4444',   // red     — public-holiday OT
  ot:      '#f59e0b',   // amber   — overtime (headline)
  // status
  ok:      '#22c55e',   // green   — on-target / clean / compliant
  warn:    '#f59e0b',   // amber   — watch
  risk:    '#ef4444',   // red     — flagged / below target
  brand:   '#6366f1',   // indigo  — headline / navigation
  neutral: '#64748b',   // slate   — muted / awaiting
} as const;

/** Presence categories in canonical stack order (worked → rest → exceptions). */
export const PRESENCE: { key: string; en: string; ar: string; color: string }[] = [
  { key: 'office', en: 'Office', ar: 'مكتب',  color: RPAL.office },
  { key: 'wfh',    en: 'WFH',    ar: 'WFH',   color: RPAL.wfh },
  { key: 'off',    en: 'Off',    ar: 'أوف',   color: RPAL.off },
  { key: 'leave',  en: 'Leave',  ar: 'إجازة', color: RPAL.leave },
  { key: 'sick',   en: 'Sick',   ar: 'سيك',   color: RPAL.sick },
  { key: 'absent', en: 'Absent', ar: 'غياب',  color: RPAL.absent },
];

/** Conformance / adherence 0–100 → band colour (≥95 green, ≥85 cyan, ≥70 amber, else red). */
export const adhHue = (v: number | null | undefined): string =>
  v == null ? RPAL.neutral : v >= 95 ? RPAL.ok : v >= 85 ? '#06b6d4' : v >= 70 ? RPAL.warn : RPAL.risk;

/* ── Section — a numbered chapter of the roster story ─────────────────────── */
export function Section({ no, icon: Icon, color, title, desc, actions, children, pad = true }: {
  no: string;                       // "١" / "1" — story position
  icon: LucideIcon; color: string;
  title: string;                    // already language-resolved by the caller
  desc?: string;                    // one-line explainer, already language-resolved
  actions?: React.ReactNode;        // header end side (chips, navigators, buttons)
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
      <Hourglass size={13} style={{ color: RPAL.neutral, flexShrink: 0 }} />
      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? textAr : text}</span>
    </div>
  );
}

/* ── useMaybe — endpoint that may not be deployed yet ─────────────────────── */
export type Maybe<T> = { status: 'loading' } | { status: 'live'; data: T } | { status: 'missing' };

/** GET `url` (query string already embedded). 404 / network error ⇒ 'missing'
 *  so panels can graceful-hide until the parallel backend agent lands. */
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

/* ── StackBar — a single clean horizontal stacked bar (presence mix) ──────── */
export function StackBar({ segments, height = 14 }: {
  segments: { key: string; label: string; value: number; color: string }[];
  height?: number;
}) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1;
  return (
    <div className="w-full rounded-full overflow-hidden flex" style={{ height, background: 'var(--surface-2)' }}>
      {segments.filter(s => (s.value || 0) > 0).map(s => (
        <div key={s.key} title={`${s.label}: ${nfmt(s.value)} (${Math.round((100 * s.value) / total)}%)`}
          style={{ width: `${(100 * s.value) / total}%`, background: s.color, transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
      ))}
    </div>
  );
}

/* ── Source-basis badge — makes the data basis explicit (Director's rule) ─── */
export type Basis = 'live' | 'corrected' | 'twelve';
export function BasisBadge({ basis, ar }: { basis: Basis; ar: boolean }) {
  const meta: Record<Basis, { dot: string; en: string; ar: string }> = {
    live:      { dot: '#3b82f6', en: 'live recon',      ar: 'مطابقة حيّة' },
    corrected: { dot: '#22c55e', en: 'corrected',       ar: 'مصحّحة' },
    twelve:    { dot: '#a855f7', en: '12-month basis',  ar: 'أساس ١٢ شهر' },
  };
  const m = meta[basis];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: `${m.dot}18`, border: `1px solid ${m.dot}44`, color: m.dot }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: m.dot }} />
      {ar ? m.ar : m.en}
    </span>
  );
}
