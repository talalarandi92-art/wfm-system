/**
 * SCHEDULE KIT — shared primitives for the Schedule + Generate experience
 * (Stage 2B redesign — same design language as pages/capacity/kit.tsx).
 *
 * Theme-aware via CSS variables (--surface / --surface-2 / --border /
 * --text-1/2/3) so one component renders correctly across all three themes
 * (Dark / Light / Aurora-Glass) with zero per-theme code. RTL-aware (logical
 * properties only).
 *
 *   nfmt / pct1      — number formatting: thin-space thousands / whole-% format
 *   SPAL             — the ONE semantic palette (required/staffed/fairness + status)
 *   Section          — numbered story-section card (icon chip + title + explainer)
 *   Awaiting         — honest "awaiting data" state (never fake numbers)
 *   useMaybe<T>      — fetch an endpoint that may not exist yet (parallel backend
 *                      agent): 'loading' → 'live' | 'missing' (404/network ⇒ missing)
 *   normalizeVerdict — reads the backend's richer `verdict` block when present,
 *                      else derives an honest client-side verdict from the
 *                      existing generate payload (demand or classic engine)
 *   normalizeQuality — defensive reader for GET /roster-v2/schedule-quality
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Hourglass } from 'lucide-react';
import { apiClient } from '@/api/client';

/* ── Number formatting ────────────────────────────────────────────────────── */
/** Thin-space thousands, max one decimal: 69429 → "69 429", 6.87 → "6.9". */
export const nfmt = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }).replace(/,/g, ' ');
};
/** 0–100 number → "83%". */
export const pct1 = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${Math.round(n)}%`;

/* ── Semantic palette — one meaning per hue across the schedule world ─────── */
export const SPAL = {
  required: '#818cf8',   // indigo  — the requirement (demand / Erlang output)
  staffed:  '#38bdf8',   // sky     — scheduled bodies / staffed curve
  fair:     '#a78bfa',   // violet  — fairness / people-balance
  ok:       '#22c55e',   // green   — covered / compliant / on-target
  warn:     '#f59e0b',   // amber   — watch / near-gap / warnings
  risk:     '#ef4444',   // red     — gap / violation / unfilled
  neutral:  '#64748b',   // slate   — muted / awaiting
  publish:  '#6366f1',   // brand indigo — actions (generate / publish)
} as const;

/** Color a 0–100 score: ≥90 green, ≥70 amber, else red. */
export const scoreHue = (s: number | null | undefined): string =>
  s == null ? SPAL.neutral : s >= 90 ? SPAL.ok : s >= 70 ? SPAL.warn : SPAL.risk;

/** Color a gap (positive = bodies SHORT): 0 → green, 1 → amber, ≥2 → red. */
export const gapHue = (gap: number): string =>
  gap <= 0 ? SPAL.ok : gap === 1 ? SPAL.warn : SPAL.risk;

/* ── Section — a numbered chapter of the scheduling story ─────────────────── */
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
            style={{ insetInlineEnd: -5, width: 14, height: 14, background: color, color: '#fff' }}>{no}</span>
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
      <Hourglass size={13} style={{ color: SPAL.neutral, flexShrink: 0 }} />
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

/* ═══════════════════════════════════════════════════════════════════════════
 * VERDICT CONTRACT — the parallel backend agent is normalizing a richer
 * `verdict` block onto the generate responses:
 *   { perDay/perFunction required/staffed/gap, fairnessScore,
 *     rule-compliance counters (femaleNightViolations, restViolations,
 *     offPerWeekOk), unfilled+reasons }
 * Everything below reads that block DEFENSIVELY and falls back to the fields
 * the engines already return today, so the hero renders real numbers now and
 * gets richer the moment the backend lands. Convention: gap > 0 = bodies SHORT.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface VerdictDayCell { required: number | null; staffed: number | null; gap: number }
export interface VerdictDay extends VerdictDayCell { date: string }
export interface VerdictFn { functionName: string; days: Record<string, VerdictDayCell> }
export interface RuleCounters {
  femaleNightViolations: number | null;
  restViolations: number | null;
  offPerWeekOk: boolean | null;
}
export interface UnfilledItem { date?: string; functionName?: string; code?: string; reason: string }
export interface GenVerdict {
  /** true = backend's normalized verdict block; false = derived client-side */
  live: boolean;
  coveragePct: number | null;
  fairnessScore: number | null;
  perDay: VerdictDay[];
  perFunction: VerdictFn[];
  rules: RuleCounters;
  unfilled: UnfilledItem[];
  /** days where staffed peak < required peak */
  gapDays: number;
  /** Σ positive day gaps (bodies short at peak, summed over the week) */
  totalGap: number;
  hiringHint: string | null;
}

const asNum = (v: unknown): number | null =>
  typeof v === 'number' && !Number.isNaN(v) ? v : null;

const dayGap = (required: number | null, staffed: number | null, gap: unknown): number => {
  const g = asNum(gap);
  if (g != null) return g;
  if (required != null && staffed != null) return required - staffed;
  return 0;
};

function coverageFromDays(perDay: VerdictDay[]): number | null {
  const withReq = perDay.filter(d => (d.required ?? 0) > 0);
  if (!withReq.length) return null;
  const req = withReq.reduce((s, d) => s + (d.required ?? 0), 0);
  const met = withReq.reduce((s, d) => s + Math.min(d.staffed ?? 0, d.required ?? 0), 0);
  return req > 0 ? (met / req) * 100 : null;
}

function readUnfilled(raw: unknown): UnfilledItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
    .map(u => ({
      date: typeof u.date === 'string' ? u.date : undefined,
      functionName: typeof u.functionName === 'string' ? u.functionName
        : typeof u.function === 'string' ? u.function : undefined,
      code: typeof u.code === 'string' ? u.code : undefined,
      reason: typeof u.reason === 'string' ? u.reason : String(u.reason ?? ''),
    }));
}

/** Interval "HH:MM" before 07:00 ⇒ covered by prior-day MD/MN tails (display accounting). */
const isDaytimeInterval = (interval: unknown): boolean =>
  +String(interval ?? '').slice(0, 2) >= 7;

/**
 * Normalize any generate response (demand or classic engine) to ONE verdict.
 * Prefers the backend `verdict` block; otherwise derives from today's payload.
 */
export function normalizeVerdict(raw: any, engine: 'demand' | 'classic'): GenVerdict | null {
  if (!raw || typeof raw !== 'object') return null;

  /* ── 1. Backend-normalized block (parallel agent) ── */
  const v = raw.verdict;
  if (v && typeof v === 'object') {
    const perDay: VerdictDay[] = (Array.isArray(v.perDay) ? v.perDay : [])
      .filter((d: unknown): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d: any) => {
        const required = asNum(d.required ?? d.requiredPeak);
        const staffed = asNum(d.staffed ?? d.staffedPeak);
        return { date: String(d.date ?? ''), required, staffed, gap: dayGap(required, staffed, d.gap) };
      });

    const perFunction: VerdictFn[] = (Array.isArray(v.perFunction) ? v.perFunction : [])
      .filter((f: unknown): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f: any) => {
        const name = String(f.functionName ?? f.function ?? f.name ?? '—');
        const days: Record<string, VerdictDayCell> = {};
        const list: any[] = Array.isArray(f.days) ? f.days
          : f.days && typeof f.days === 'object'
            ? Object.entries(f.days).map(([date, x]) => (x && typeof x === 'object' ? { date, ...(x as object) } : { date, gap: x }))
            : [];
        for (const d of list) {
          const required = asNum(d.required ?? d.requiredPeak);
          const staffed = asNum(d.staffed ?? d.staffedPeak);
          days[String(d.date ?? '')] = { required, staffed, gap: dayGap(required, staffed, d.gap) };
        }
        return { functionName: name, days };
      });

    const rc = (v.ruleCompliance ?? v.rules ?? {}) as Record<string, unknown>;
    const perDayGaps = perDay.map(d => Math.max(0, d.gap));
    return {
      live: true,
      coveragePct: asNum(v.coveragePct) ?? coverageFromDays(perDay),
      fairnessScore: asNum(v.fairnessScore) ?? asNum((v.fairness as any)?.score) ?? asNum((raw.fairness as any)?.score),
      perDay,
      perFunction,
      rules: {
        femaleNightViolations: asNum(rc.femaleNightViolations),
        restViolations: asNum(rc.restViolations),
        offPerWeekOk: typeof rc.offPerWeekOk === 'boolean' ? rc.offPerWeekOk : null,
      },
      unfilled: readUnfilled(v.unfilled ?? raw.unfilled),
      gapDays: perDayGaps.filter(g => g > 0).length,
      totalGap: perDayGaps.reduce((s, g) => s + g, 0),
      hiringHint: typeof v.hiringHint === 'string' ? v.hiringHint : null,
    };
  }

  /* ── 2. Client-side fallback — demand engine (THE generator, D-077) ── */
  if (engine === 'demand') {
    const days: any[] = Array.isArray(raw.demand?.days) ? raw.demand.days : [];
    if (!days.length) return null;
    const perDay: VerdictDay[] = days.map(d => {
      const required = asNum(d.requiredPeak);
      const staffed = asNum(d.staffedPeak);
      return { date: String(d.date ?? ''), required, staffed, gap: dayGap(required, staffed, undefined) };
    });
    // Per-function gaps from residualGaps (daytime window only — same accounting
    // rule as the day table: 00:00–07:00 is covered by prior-day MD/MN tails).
    const fnNames = new Set<string>();
    const fnDayGap = new Map<string, Map<string, number>>();
    for (const d of days) {
      for (const g of (Array.isArray(d.residualGaps) ? d.residualGaps : [])) {
        if (!isDaytimeInterval(g.interval)) continue;
        const fn = String(g.functionName ?? '—');
        fnNames.add(fn);
        const m = fnDayGap.get(fn) ?? new Map<string, number>();
        m.set(String(d.date), Math.max(m.get(String(d.date)) ?? 0, asNum(g.deficit) ?? 0));
        fnDayGap.set(fn, m);
      }
    }
    // Include every function present in the proposal grid so covered ones show ✓.
    for (const row of (Array.isArray(raw.grid) ? raw.grid : [])) {
      if (row?.functionName && Object.keys(row.days ?? {}).length) fnNames.add(String(row.functionName));
    }
    const perFunction: VerdictFn[] = [...fnNames].sort().map(name => {
      const m = fnDayGap.get(name);
      const dcells: Record<string, VerdictDayCell> = {};
      for (const d of days) {
        dcells[String(d.date)] = { required: null, staffed: null, gap: m?.get(String(d.date)) ?? 0 };
      }
      return { functionName: name, days: dcells };
    });
    const perDayGaps = perDay.map(d => Math.max(0, d.gap));
    return {
      live: false,
      coveragePct: coverageFromDays(perDay),
      fairnessScore: null,                    // demand payload has no fairness score yet
      perDay,
      perFunction,
      rules: { femaleNightViolations: null, restViolations: null, offPerWeekOk: null },
      unfilled: readUnfilled(raw.unfilled),
      gapDays: perDayGaps.filter(g => g > 0).length,
      totalGap: perDayGaps.reduce((s, g) => s + g, 0),
      hiringHint: null,
    };
  }

  /* ── 3. Client-side fallback — classic engine ── */
  const cov: any[] = Array.isArray(raw.coverage) ? raw.coverage : [];
  if (!cov.length) return null;
  const perDay: VerdictDay[] = cov.map(d => {
    const required = asNum(d.total);          // classic coveragePct = working / headcount
    const staffed = asNum(d.working);
    return { date: String(d.date ?? ''), required, staffed, gap: dayGap(required, staffed, undefined) };
  });
  const violations: any[] = Array.isArray(raw.violations) ? raw.violations : [];
  const female = violations.filter(x => String(x?.type ?? '').toLowerCase().includes('female')).length;
  const rest = violations.filter(x => String(x?.type ?? '').toLowerCase().includes('rest')).length;
  return {
    live: false,
    coveragePct: asNum(raw.summary?.avgCoveragePct) ?? coverageFromDays(perDay),
    fairnessScore: asNum(raw.fairness?.score),
    perDay,
    perFunction: [],                          // classic payload carries no per-fn×day staffing
    rules: { femaleNightViolations: female, restViolations: rest, offPerWeekOk: null },
    unfilled: [],
    gapDays: perDay.filter(d => d.gap > 0).length,
    totalGap: perDay.reduce((s, d) => s + Math.max(0, d.gap), 0),
    hiringHint: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SCHEDULE QUALITY — GET /roster-v2/schedule-quality?from&to grades an
 * EXISTING week. Endpoint lands with the parallel backend agent → callers use
 * useMaybe() and hide until 'live'. Shape read defensively.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ScheduleQuality {
  coveragePct: number | null;
  fairnessScore: number | null;
  rules: RuleCounters;
  perDay: VerdictDay[];
  worstDay: { date: string; gap: number; reason: string | null } | null;
}

export function normalizeQuality(raw: any): ScheduleQuality | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.quality && typeof raw.quality === 'object' ? raw.quality : raw;
  const days: any[] = Array.isArray(src.perDay) ? src.perDay : Array.isArray(src.days) ? src.days : [];
  const perDay: VerdictDay[] = days
    .filter((d: unknown): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d: any) => {
      const required = asNum(d.required ?? d.requiredPeak);
      const staffed = asNum(d.staffed ?? d.staffedPeak ?? d.scheduled);
      return { date: String(d.date ?? ''), required, staffed, gap: dayGap(required, staffed, d.gap) };
    });
  const rc = (src.ruleCompliance ?? src.rules ?? {}) as Record<string, unknown>;
  let worstDay: ScheduleQuality['worstDay'] = null;
  if (src.worstDay && typeof src.worstDay === 'object') {
    worstDay = {
      date: String((src.worstDay as any).date ?? ''),
      gap: asNum((src.worstDay as any).gap) ?? 0,
      reason: typeof (src.worstDay as any).reason === 'string' ? (src.worstDay as any).reason : null,
    };
  } else if (perDay.length) {
    const w = [...perDay].sort((a, b) => b.gap - a.gap)[0];
    if (w && w.gap > 0) worstDay = { date: w.date, gap: w.gap, reason: null };
  }
  const coveragePct = asNum(src.coveragePct) ?? asNum(src.coverage?.pct) ?? coverageFromDays(perDay);
  const fairnessScore = asNum(src.fairnessScore) ?? asNum(src.fairness?.score);
  if (coveragePct == null && fairnessScore == null && !perDay.length) return null;
  return {
    coveragePct,
    fairnessScore,
    rules: {
      femaleNightViolations: asNum(rc.femaleNightViolations),
      restViolations: asNum(rc.restViolations),
      offPerWeekOk: typeof rc.offPerWeekOk === 'boolean' ? rc.offPerWeekOk : null,
    },
    perDay,
    worstDay,
  };
}

/* ── Small date helpers shared by the schedule panels ─────────────────────── */
export const DAY_AR7 = ['أحد', 'إث', 'ثلا', 'أرب', 'خمس', 'جمع', 'سبت'];
export const DAY_EN7 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDayShort(iso: string, ar: boolean): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return `${(ar ? DAY_AR7 : DAY_EN7)[d.getDay()]} ${d.getDate()}`;
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
