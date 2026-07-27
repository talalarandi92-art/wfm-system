/**
 * RTA / MISSION-CONTROL KIT — shared primitives for the Live Monitoring command
 * center (Stage 4B redesign).
 *
 * Same design language as pages/capacity/kit.tsx · pages/schedule/kit.tsx ·
 * pages/roster/kit.tsx so the whole product reads as ONE premium app:
 * numbered `Section` cards with AR/EN one-line explainers, an honest `Awaiting`
 * state, `useMaybe` for endpoints that may not be deployed yet, and ONE semantic
 * palette (one meaning per hue).
 *
 * Theme-aware via CSS variables (--surface / --surface-2 / --border /
 * --text-1/2/3) so a single component renders correctly across all three themes
 * (Dark / Light / Aurora-Glass). RTL-aware (logical properties only).
 *
 * NOTE — the Wallboard (WallboardPanels.tsx) is deliberately KEEP-DARK: it is a
 * TV surface rendered on a hardcoded #060912 background and must NOT consume the
 * theme tokens below. Everything in-page does.
 *
 *   nfmt / pctFmt / fmtAgo — number, percent and freshness formatting
 *   QPAL                   — the ONE semantic palette (state + risk + degraded)
 *   riskHue / stateHue     — semantic colour by band / agent state
 *   Section                — numbered story-section card
 *   Awaiting               — honest "awaiting data / endpoint" state
 *   Degraded               — honest "this feed is degraded, value is UNKNOWN"
 *   FreshChip              — live / stale / connecting freshness chip
 *   Pulse                  — flashes when a live value actually changes
 *   HeatCell / MiniBar     — dense mission-control primitives
 *   useMaybe<T>            — 'loading' → 'live' | 'missing' (404 ⇒ missing)
 */
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Hourglass, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { scalarLabel, readableOn, readableOnWash } from '@/utils/format';

/* ── Number & time formatting ─────────────────────────────────────────────── */
/** Thin-space thousands, max one decimal: 69429 → "69 429", 6.87 → "6.9". */
export const nfmt = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }).replace(/,/g, ' ');
};
/** 0–100 number → "83%" ; null → "—" (never a fabricated 0 or 100). */
export const pctFmt = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${Math.round(n)}%`;

/** Seconds-since → compact human age: "12s" / "4m" / "3h" / "2d" (AR aware). */
export const fmtAgo = (sec: number | null | undefined, ar: boolean): string => {
  if (sec == null || sec < 0) return '—';
  if (sec < 90) return ar ? `${Math.round(sec)}ث` : `${Math.round(sec)}s`;
  const m = Math.round(sec / 60); if (m < 90) return ar ? `${m}د` : `${m}m`;
  const h = Math.round(m / 60);   if (h < 36) return ar ? `${h}س` : `${h}h`;
  const d = Math.round(h / 24);   return ar ? `${d} يوم` : `${d}d`;
};

/** "09:00" from an interval label that may be "09:00", "09:00:00" or an ISO ts. */
export const hhmm = (v: string | null | undefined): string => {
  if (!v) return '—';
  if (/^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5).padStart(5, '0');
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toTimeString().slice(0, 5);
};

/* ── Coverage folding — ONE definition of "the floor at this interval" ─────
   /integrations/sprinklr/coverage returns ONE ROW PER FUNCTION per interval
   (~480 rows for a day). Reading a single row — or listing the raw rows —
   silently reports ONE function's coverage as the whole floor. Every consumer
   folds through here so no two panels can disagree. */
export interface CoverageIntervalRow {
  interval_start: string;
  required_hc: number; scheduled_hc: number; live_hc: number;
  live_stale?: boolean;
}
export interface FoldedCoverageRow {
  key: string; at: string;
  req: number; sched: number; live: number; stale: boolean;
  /** The honest "what we actually have": live when the bridge is usable, else scheduled. */
  have: number; gap: number;
}
export interface FoldedCoverage {
  rows: FoldedCoverageRow[];
  /** The snapshot date the rows belong to — may NOT be today; show it. */
  date: string | null;
  /** false ⇒ `have` is the SCHEDULED column and must be labelled as such. */
  liveUsable: boolean;
}
export function foldCoverage(intervals: CoverageIntervalRow[] | null | undefined): FoldedCoverage | null {
  if (!intervals?.length) return null;
  const m = new Map<string, { req: number; sched: number; live: number; stale: boolean }>();
  for (const x of intervals) {
    const k = String(x.interval_start);
    const e = m.get(k) ?? { req: 0, sched: 0, live: 0, stale: false };
    e.req   += Number(x.required_hc)  || 0;
    e.sched += Number(x.scheduled_hc) || 0;
    e.live  += Number(x.live_hc)      || 0;
    e.stale = e.stale || !!x.live_stale;
    m.set(k, e);
  }
  const rows = [...m.entries()]
    .map(([key, v]) => ({ key, at: hhmm(key), ...v }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const liveUsable = rows.some(r => !r.stale && r.live > 0);
  return {
    rows: rows.map(r => {
      const have = liveUsable ? r.live : r.sched;
      return { ...r, have, gap: have - r.req };
    }),
    date: rows[0]?.key.slice(0, 10) ?? null,
    liveUsable,
  };
}

/* ── Semantic palette — one meaning per hue across mission control ────────── */
export const QPAL = {
  ok:        '#22c55e',   // green  — on-track / available / covered
  busy:      '#818cf8',   // indigo — handling / active work
  watch:     '#f59e0b',   // amber  — at-risk / waiting / watch
  gap:       '#ef4444',   // red    — gap / breach / violation
  degraded:  '#64748b',   // slate  — feed degraded / value UNKNOWN
  brk:       '#fb923c',   // orange — on break
  offline:   '#475569',   // deep slate — offline / not logged in
  brand:     '#06b6d4',   // cyan   — RTA identity / live
  info:      '#a855f7',   // violet — informational / schedule side
} as const;

/* Light-mode ink map. The palette above is tuned for dark surfaces; used as TEXT
   on the light theme the mid-tone hues (amber/green/cyan) fall under 3:1. `ink()`
   swaps in a darker sibling of the SAME hue for text only — dots, bars, borders
   and tints keep the vivid palette so the semantic reading never changes.
   (Verified with the contrast-auditor method: every swap lands ≥ 4.4:1 on
   --surface #f4f6fa.) */
const INK_LIGHT: Record<string, string> = {
  '#22c55e': '#15803d', // ok      green
  '#84cc16': '#4d7c0f', // idle    lime
  '#818cf8': '#4f46e5', // busy    indigo
  '#f59e0b': '#b45309', // watch   amber
  '#ef4444': '#b91c1c', // gap     red
  '#64748b': '#475569', // degraded slate
  '#fb923c': '#c2410c', // break   orange
  '#475569': '#334155', // offline deep slate
  '#06b6d4': '#0e7490', // brand   cyan
  '#a855f7': '#7e22ce', // info    violet
};
/** Palette hue → a hue-faithful, contrast-safe TEXT colour for the active theme. */
export const ink = (c: string, dark: boolean): string =>
  dark ? c : (INK_LIGHT[c.toLowerCase()] ?? c);

/** Adherence / SLA / coverage 0–100 → band colour. null ⇒ degraded slate. */
export const riskHue = (v: number | null | undefined): string =>
  v == null ? QPAL.degraded : v >= 90 ? QPAL.ok : v >= 80 ? '#84cc16' : v >= 70 ? QPAL.watch : QPAL.gap;

/** Live agent state → the ONE canonical hue used everywhere in-page. */
export const stateHue = (s: string): string => ({
  available: QPAL.ok, idle: '#84cc16', busy: QPAL.busy,
  break: QPAL.brk, away: QPAL.brk,
  offline: QPAL.offline, unknown: QPAL.offline,
}[s] ?? QPAL.offline);

/* ── Section — a numbered chapter of the mission-control story ────────────── */
export function Section({ no, icon: Icon, color, title, desc, actions, children, pad = true }: {
  no: string;                       // "١" / "1" — story position
  icon: LucideIcon; color: string;
  title: string;                    // already language-resolved by the caller
  desc?: string;                    // one-line explainer, already language-resolved
  actions?: React.ReactNode;        // header end side (chips, filters, buttons)
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

/* ── Awaiting — the honest empty state (never fake numbers) ───────────────── */
export function Awaiting({ ar, text, textAr }: { ar: boolean; text: string; textAr: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
      style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
      <Hourglass size={13} style={{ color: QPAL.degraded, flexShrink: 0 }} />
      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? textAr : text}</span>
    </div>
  );
}

/* ── Degraded — a feed is present but NOT trustworthy → value is UNKNOWN ──── */
/* This is the headline of the page: a missing feed reads as UNKNOWN, never as
   an all-clear. (Preserves the committed queue-feed honesty fix.) */
export function Degraded({ ar, title, titleAr, body, bodyAr, fix, fixAr }: {
  ar: boolean; title: string; titleAr: string; body: string; bodyAr: string;
  fix?: string; fixAr?: string;
}) {
  const { dark } = useUiStore();
  const g = ink(QPAL.gap, dark);
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
      style={{ background: `${QPAL.gap}12`, border: `1px solid ${QPAL.gap}44` }}>
      <AlertTriangle size={14} style={{ color: g, flexShrink: 0, marginTop: 1 }} />
      <div className="text-[11px]" style={{ lineHeight: 1.55, color: 'var(--text-2)' }}>
        <b style={{ color: g }}>{ar ? titleAr : title}</b>{' — '}{ar ? bodyAr : body}
        {fix && <div className="mt-0.5" style={{ color: 'var(--text-3)' }}>{ar ? fixAr : fix}</div>}
      </div>
    </div>
  );
}

/* ── FreshChip — how old is what you are looking at, in one glance ────────── */
export function FreshChip({ ar, staleSec, isStale, connecting, pulse }: {
  ar: boolean; staleSec: number | null | undefined; isStale?: boolean;
  connecting?: boolean; pulse?: boolean;
}) {
  const { dark } = useUiStore();
  const base = connecting ? QPAL.degraded : isStale ? QPAL.watch : QPAL.ok;
  const c = ink(base, dark);
  const label = connecting ? (ar ? 'جارٍ الاتصال…' : 'connecting…')
    : isStale ? `${ar ? 'قديم' : 'stale'} · ${fmtAgo(staleSec, ar)}`
    : `${ar ? 'حيّ' : 'live'} · ${fmtAgo(staleSec, ar)}`;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: `${base}18`, border: `1px solid ${base}44`, color: c }}>
      <span style={{
        width: 6, height: 6, borderRadius: 99, background: base,
        boxShadow: pulse && !isStale && !connecting ? `0 0 0 4px ${base}22` : 'none',
        transition: 'box-shadow .5s ease',
      }} />
      {label}
    </span>
  );
}

/* ── Pulse — flashes ONLY when the live value actually changes ────────────── */
/* Mission-control feedback: the eye is drawn to what moved, not to every poll. */
export function Pulse({ value, color, children }: {
  value: number | string | null | undefined; color: string; children: React.ReactNode;
}) {
  const prev = useRef(value);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined) {
      setHot(true);
      const t = setTimeout(() => setHot(false), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return (
    <span style={{
      display: 'inline-block', borderRadius: 6, padding: '0 3px', marginInline: -3,
      background: hot ? `${color}2a` : 'transparent',
      transition: 'background .7s ease',
    }}>{children}</span>
  );
}

/* ── MiniBar — one dense horizontal meter (value vs target) ───────────────── */
export function MiniBar({ pct, color, height = 6, track }: {
  pct: number | null; color: string; height?: number; track?: string;
}) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: track ?? 'var(--surface-2)' }}>
      <div style={{
        height: '100%', width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: color,
        borderRadius: 99, transition: 'width .7s cubic-bezier(.4,0,.2,1)',
      }} />
    </div>
  );
}

/* ── HeatCell — one interval of the intraday heat strip ───────────────────── */
export function HeatCell({ label, color, intensity, title, sub, dim }: {
  label: string; color: string; intensity: number;  // 0..1
  title?: string; sub?: string; dim?: boolean;
}) {
  const a = Math.max(0.1, Math.min(1, intensity));
  /* The cell background is an ALPHA WASH of a semantic hue, so what the text sits
     on changes with intensity: faint at the low end (the theme surface shows
     through, and the theme's own tokens are right) and saturated at the high end
     (the hue dominates, and --text-2 measured 2.27:1 on a hot red cell). Switch on
     the alpha, exactly like the capacity heat grid. */
  /* 0.55 was still too generous — at alpha 0.45 over a light card the wash is
     already saturated enough that --text-2 measures 3.70:1. Measured switch. */
  /* No threshold: readableOnWash COMPOSITES the wash over the theme surface, so it
     is already correct at both ends of the ramp. The earlier `a >= 0.55`, then
     `>= 0.4`, were attempts to guess where the hue starts to dominate — a guess the
     compositing makes unnecessary, and both guesses left mid-intensity cells wrong
     (--text-2 measured 3.77:1 on a moderately hot green cell). */
  const fg = dim ? 'var(--text-3)' : readableOnWash(color, a);
  return (
    <div title={title} className="rounded-lg flex flex-col items-center justify-center flex-1"
      style={{
        minWidth: 34, padding: '6px 2px',
        background: dim ? 'var(--surface-2)' : `${color}${Math.round(a * 200 + 25).toString(16).padStart(2, '0')}`,
        border: `1px solid ${dim ? 'var(--border)' : `${color}55`}`,
        opacity: dim ? 0.55 : 1,
      }}>
      <span className="text-[9.5px] font-bold tabular-nums leading-none" style={{ color: fg }}>{label}</span>
      {sub && <span className="text-[8.5px] tabular-nums mt-0.5 leading-none" style={{ color: fg, opacity: 0.85 }}>{sub}</span>}
    </div>
  );
}

/* ── useMaybe — endpoint that may not be deployed yet ─────────────────────── */
export type Maybe<T> = { status: 'loading' } | { status: 'live'; data: T } | { status: 'missing' };

/** GET `url` (query string already embedded). 404 / network error ⇒ 'missing'
 *  so sections graceful-hide until the parallel backend agent lands.
 *  `pollMs` re-fetches on an interval (mission control is a live surface). */
export function useMaybe<T = unknown>(url: string, pollMs?: number): Maybe<T> {
  const [st, setSt] = useState<Maybe<T>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    const run = (first: boolean) => {
      if (first) setSt({ status: 'loading' });
      apiClient.get(url)
        .then(r => { if (alive) setSt({ status: 'live', data: r.data as T }); })
        .catch(() => { if (alive) setSt({ status: 'missing' }); });
    };
    run(true);
    if (!pollMs) return () => { alive = false; };
    const t = setInterval(() => run(false), pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [url, pollMs]);
  return st;
}

/* ── Contracts for the NEW RTA endpoints (parallel backend agent) ─────────── */
/* Shapes may drift until they land, so every reader below is defensive. */

export interface IntradayInterval {
  interval: string;
  scheduled: number | null;
  actual: number | null;
  adherencePct: number | null;
  required: number | null;
  available: number | null;
  noEvidence: number | null;
  gap: number | null;
  /** ok = on track · watch = drifting · gap = at_risk|critical · null = UNKNOWN */
  risk: 'ok' | 'watch' | 'gap' | null;
}
export interface IntradayView {
  date: string | null;
  /** the date the caller ASKED for — differs from `date` when the service falls
   *  back to the newest reconciled day (must be surfaced, never silently served) */
  requestedDate: string | null;
  isExact: boolean;
  ageDays: number | null;
  intervals: IntradayInterval[];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && !Number.isNaN(v) ? v
  : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v)
  : null;
const pick = (o: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const k of keys) { const v = num(o[k]); if (v != null) return v; }
  return null;
};
const str = (o: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v.trim()) return v; }
  return null;
};

/** Normalize `GET /rta/intraday`.
 *  Primary contract (rta-intraday.core.ts): a top-level all-functions
 *  `intervals[]` of IntervalCell — `{ start, scheduled, scheduledOnSystem,
 *  onSystem, noEvidence, adherencePct, gap, risk }` — where `risk` is
 *  ok|watch|at_risk|critical|unknown and `adherencePct` is NULL (never 0) when
 *  nothing is measurable. Alternate key spellings are still accepted so a
 *  contract tweak degrades to a partial read instead of a blank section. */
export function readIntraday(data: unknown): IntradayView | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const raw = (Array.isArray(d.intervals) ? d.intervals
    : Array.isArray(d.rows) ? d.rows
    : Array.isArray(data) ? (data as unknown[]) : null) as Record<string, unknown>[] | null;
  if (!raw?.length) return null;

  const intervals = raw.map(r => {
    // `scheduled` IS the requirement in this engine: gap = onSystem − scheduled.
    const scheduled = pick(r, 'scheduled', 'scheduled_hc', 'scheduledHc', 'planned');
    const actual = pick(r, 'onSystem', 'on_system', 'actual', 'actual_hc', 'actualHc', 'live', 'live_hc');
    const required = pick(r, 'required', 'required_hc', 'requiredHc') ?? scheduled;
    const available = pick(r, 'available', 'available_hc', 'availableHc') ?? actual;
    const noEvidence = pick(r, 'noEvidence', 'no_evidence');
    let adherencePct = pick(r, 'adherencePct', 'adherence_pct', 'adherence');
    // Derive ONLY from a measurable base — never turn "no evidence" into 0 %.
    if (adherencePct == null) {
      const measured = pick(r, 'measured');
      const onSched = pick(r, 'scheduledOnSystem', 'scheduled_on_system');
      if (measured != null && measured > 0 && onSched != null) adherencePct = (onSched / measured) * 100;
    }
    let gap = pick(r, 'gap', 'coverage_gap', 'coverageGap');
    if (gap == null && required != null && available != null) gap = available - required;

    const riskRaw = str(r, 'risk', 'risk_flag', 'riskFlag', 'coverageState', 'coverage_state');
    let risk: IntradayInterval['risk'];
    if (riskRaw) {
      risk = /unknown/i.test(riskRaw) ? null
        : /crit|at[_-]?risk|short|high|red|gap/i.test(riskRaw) ? 'gap'
        : /watch|warn|med|amber|met/i.test(riskRaw) ? (/^met$/i.test(riskRaw) ? 'ok' : 'watch')
        : 'ok';
    } else {
      risk = gap == null ? null : gap < 0 ? 'gap' : gap === 0 ? 'watch' : 'ok';
    }

    return {
      interval: String(r.start ?? r.interval ?? r.interval_start ?? r.hour ?? r.time ?? ''),
      scheduled, actual, adherencePct, required, available, noEvidence, gap, risk,
    };
  }).filter(x => x.interval);
  if (!intervals.length) return null;

  const date = str(d, 'date');
  const requestedDate = str(d, 'requestedDate', 'requested_date');
  return {
    date,
    requestedDate,
    isExact: typeof d.isExact === 'boolean' ? d.isExact : (!requestedDate || requestedDate === date),
    ageDays: pick(d, 'ageDays', 'age_days', 'rosterAgeDays'),
    intervals,
  };
}

export interface RtaAlert {
  severity: 'critical' | 'high' | 'warning' | 'info';
  type: string; text: string; textAr: string; metric: string | null;
}
export const alertHue = (s: string): string =>
  /crit|high/i.test(s) ? QPAL.gap : /warn|med/i.test(s) ? QPAL.watch : QPAL.brand;
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, warning: 2, info: 3 };
export const sevRank = (s: string): number => SEV_RANK[s.toLowerCase()] ?? 4;

/** Normalize `GET /rta/alerts` → severity-sorted list. */
export function readAlerts(data: unknown): RtaAlert[] | null {
  const arr = (Array.isArray(data) ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).alerts)
      ? (data as Record<string, unknown>).alerts as unknown[]
      : null) as Record<string, unknown>[] | null;
  if (!arr) return null;
  const out = arr.map(a => {
    const sevRaw = String(a.severity ?? a.level ?? 'info').toLowerCase();
    const severity: RtaAlert['severity'] =
      /crit/.test(sevRaw) ? 'critical' : /high/.test(sevRaw) ? 'high' : /warn|med/.test(sevRaw) ? 'warning' : 'info';
    const text = String(a.text_en ?? a.textEn ?? a.text ?? a.message ?? '').trim();
    return {
      severity,
      type: String(a.type ?? a.kind ?? 'alert'),
      text,
      textAr: String(a.text_ar ?? a.textAr ?? text).trim(),
      // NOT String(): /rta/alerts carries an OBJECT here (per alert type —
      // {staleSec,staleMin,capturedAt}, {agentCount,knownStatusAgents}, the whole
      // intraday-gap record…). String() turned all 14 live alerts into a literal
      // "[object Object]" on screen. The alert's own sentence already states the
      // numbers, so a non-scalar metric simply shows no chip.
      metric: scalarLabel(a.metric),
    };
  }).filter(a => a.text);
  return out.sort((x, y) => sevRank(x.severity) - sevRank(y.severity));
}
