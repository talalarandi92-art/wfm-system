/**
 * Forecasting engine — pure, deterministic baseline models.
 *
 * Enterprise roadmap #3 (NICE/Genesys parity): historical volume analysis with
 * hour-of-day + day-of-week seasonality, weighted-recent history, and forecast
 * accuracy metrics (MAPE / WAPE / bias). No ML yet — deterministic baselines
 * first, per the roadmap. All inputs are passed in; nothing reads the clock, so
 * the engine is fully testable.
 */

// Shared Erlang kernel (R2.2) — the exported erlangC/serviceLevel below keep
// this module's historical edge behavior and delegate the main path here.
import { erlangC as coreErlangC, serviceLevel as coreServiceLevel } from '@common/erlang';

export interface VolumePoint {
  date: string;        // YYYY-MM-DD
  hour: number;        // 0..23
  channel: string;
  volume: number;      // contacts in that (date, hour, channel)
}

export interface ForecastInterval {
  date: string;
  hour: number;
  channel: string;
  forecast: number;    // predicted contacts
  basis: number;       // # of historical same-weekday-hour samples used
}

/** Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD string, timezone-safe (UTC). */
export function dowOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Enumerate YYYY-MM-DD strings from..to inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Build a (dow, hour) → recency-weighted average volume profile for one channel.
 * More recent occurrences get more weight (linear decay by recency rank), so a
 * recent campaign shift bends the profile faster than a flat mean would.
 */
export function buildProfile(history: VolumePoint[], channel: string) {
  // Group volumes by dow|hour, each as a list ordered by date (oldest→newest).
  const byKey = new Map<string, { date: string; volume: number }[]>();
  for (const p of history) {
    if (p.channel !== channel) continue;
    const key = `${dowOf(p.date)}|${p.hour}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ date: p.date, volume: p.volume });
  }
  const profile = new Map<string, { avg: number; samples: number }>();
  for (const [key, list] of byKey) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    // Linear recency weights: oldest=1 … newest=n
    let wsum = 0, vsum = 0;
    list.forEach((it, i) => { const w = i + 1; wsum += w; vsum += w * it.volume; });
    profile.set(key, { avg: wsum ? vsum / wsum : 0, samples: list.length });
  }
  return profile;
}

/** Forecast every hour of every day in [from,to] for one channel. */
export function forecastRange(
  history: VolumePoint[], channel: string, from: string, to: string,
): ForecastInterval[] {
  const profile = buildProfile(history, channel);
  const out: ForecastInterval[] = [];
  for (const date of dateRange(from, to)) {
    const dow = dowOf(date);
    for (let hour = 0; hour < 24; hour++) {
      const cell = profile.get(`${dow}|${hour}`);
      out.push({
        date, hour, channel,
        forecast: cell ? Math.round(cell.avg * 10) / 10 : 0,
        basis: cell ? cell.samples : 0,
      });
    }
  }
  return out;
}

/** Sum forecast intervals into daily totals per (date, channel). */
export function dailyTotals(intervals: ForecastInterval[]) {
  const m = new Map<string, number>();
  for (const it of intervals) {
    const k = `${it.date}|${it.channel}`;
    m.set(k, (m.get(k) ?? 0) + it.forecast);
  }
  return [...m.entries()].map(([k, v]) => {
    const [date, channel] = k.split('|');
    return { date, channel, total: Math.round(v * 10) / 10 };
  });
}

/* ── Event calendar: campaign / seasonal volume multipliers ─────────────────── */

export interface ForecastEvent {
  from: string;        // YYYY-MM-DD inclusive
  to: string;          // YYYY-MM-DD inclusive
  multiplier: number;  // e.g. 1.3 = +30% (from a campaign's required_hc_uplift_pct)
  label: string;
  color?: string;
}

/**
 * Combined volume multiplier for a date from all overlapping events (multiplicative).
 * Returns the factor + the contributing labels so the UI can explain the bump.
 */
export function eventFactor(date: string, events: ForecastEvent[]): { multiplier: number; labels: string[]; color?: string } {
  let multiplier = 1; const labels: string[] = []; let color: string | undefined;
  for (const e of events) {
    if (date >= e.from && date <= e.to) {
      multiplier *= e.multiplier;
      labels.push(e.label);
      if (!color) color = e.color;
    }
  }
  return { multiplier, labels, color };
}

/* ── Staffing: turn forecast volume into required agents (Erlang-C) ──────────── */

/** Erlang-C probability of waiting for N agents at traffic intensity A (erlangs).
 *  R2.2: main path delegates to the shared kernel (@common/erlang — bit-identical
 *  recursion); this module's historical edge-order is preserved by the guards
 *  (here N<1 with A<=0 → 0, whereas the shared core returns 1). */
export function erlangC(agents: number, intensity: number): number {
  const N = Math.floor(agents), A = intensity;
  if (A <= 0) return 0;
  if (N <= A) return 1; // unstable / saturated
  return coreErlangC(N, A);
}

/** Service level = P(answer within targetSec) for N agents.
 *  R2.2: guards preserve this module's historical edge-order (A<=0 → 1 even when
 *  ahtSec<=0, unlike the shared core); main path is the shared kernel. */
export function serviceLevel(agents: number, intensity: number, targetSec: number, ahtSec: number): number {
  const N = Math.floor(agents), A = intensity;
  if (A <= 0) return 1;
  if (N <= A || ahtSec <= 0) return 0;
  return coreServiceLevel(N, A, targetSec, ahtSec);
}

export interface StaffingParams {
  ahtSec: number; intervalSec?: number; targetSL?: number; targetSec?: number;
  shrinkage?: number; occupancyCap?: number;
}

/**
 * Minimum agents to hit the service-level target for `volume` contacts in an
 * interval, then grossed up for shrinkage. Returns both the pure Erlang need and
 * the staffed (with-shrinkage) requirement. Deterministic & testable.
 */
export function requiredAgents(volume: number, p: StaffingParams): {
  intensity: number; pure: number; required: number; occupancy: number; serviceLevel: number;
} {
  const intervalSec = p.intervalSec ?? 3600;
  const targetSL = p.targetSL ?? 0.8;
  const targetSec = p.targetSec ?? 20;
  const shrink = Math.min(Math.max(p.shrinkage ?? 0.3, 0), 0.95);
  const occCap = p.occupancyCap ?? 0.85;
  const A = (volume * p.ahtSec) / intervalSec; // erlangs
  if (A <= 0 || p.ahtSec <= 0) return { intensity: 0, pure: 0, required: 0, occupancy: 0, serviceLevel: 1 };

  let n = Math.max(1, Math.floor(A) + 1);
  for (let i = 0; i < 2000; i++) {
    const sl = serviceLevel(n, A, targetSec, p.ahtSec);
    const occ = A / n;
    if (sl >= targetSL && occ <= occCap) break;
    n++;
  }
  return {
    intensity: Math.round(A * 100) / 100,
    pure: n,
    required: Math.ceil(n / (1 - shrink)),
    occupancy: Math.round((A / n) * 1000) / 10,
    serviceLevel: Math.round(serviceLevel(n, A, targetSec, p.ahtSec) * 1000) / 10,
  };
}

/**
 * Forecast accuracy metrics over matched (date,hour,channel) cells.
 * MAPE = mean abs % error (excludes zero-actual cells, undefined there).
 * WAPE = sum|err| / sum(actual) — robust to zeros, the headline metric.
 * bias = sum(forecast-actual) / sum(actual) — +over / −under-forecast.
 */
export function accuracy(
  actuals: VolumePoint[], forecasts: ForecastInterval[],
): { mape: number | null; wape: number | null; bias: number | null; matched: number; totalActual: number } {
  const fMap = new Map<string, number>();
  for (const f of forecasts) fMap.set(`${f.date}|${f.hour}|${f.channel}`, f.forecast);

  let absErr = 0, sumActual = 0, signedErr = 0, matched = 0;
  let mapeSum = 0, mapeN = 0;
  for (const a of actuals) {
    const key = `${a.date}|${a.hour}|${a.channel}`;
    if (!fMap.has(key)) continue;
    const f = fMap.get(key)!;
    const err = f - a.volume;
    absErr += Math.abs(err);
    signedErr += err;
    sumActual += a.volume;
    matched++;
    if (a.volume > 0) { mapeSum += Math.abs(err) / a.volume; mapeN++; }
  }
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return {
    mape: mapeN ? pct(mapeSum / mapeN) : null,
    wape: sumActual ? pct(absErr / sumActual) : null,
    bias: sumActual ? pct(signedErr / sumActual) : null,
    matched,
    totalActual: Math.round(sumActual * 10) / 10,
  };
}
