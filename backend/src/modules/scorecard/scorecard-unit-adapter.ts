import { ScorecardActualInputs } from './scorecard-scoring.service';

/**
 * SCORECARD UNIT ADAPTER — the explicit boundary between a LIVE FEED's native
 * units and the units the validated kpi-registry bands expect.
 *
 * WHY THIS EXISTS (deep-risk-study finding, CRITICAL): the band engine
 * (`kpi-registry/score-band.ts`) is unit-specific and silent about it —
 *   • `roundHalfUpPct` (score-band.ts:12) expects a FRACTION (0.95 → 95%);
 *   • `threshold_hours` (score-band.ts:47) multiplies by 24, i.e. it expects an
 *     Excel DAY-FRACTION (1h = 1/24), NOT seconds and NOT hours.
 * The Director's SC workbook already stores those canonical units, so the
 * historical-validation path is correct. But a LIVE aggregate feed typically
 * carries `avg_aht_seconds` and `avg_quality` as a PERCENT (0–100). Handing a
 * percent (96) or seconds (555) straight to a band scores it as ~9600% / ~13320h
 * → a real-looking but catastrophically wrong point value, silently. This adapter
 * converts every feed column to the exact unit its band expects BEFORE scoring,
 * and surfaces range warnings so a unit mismatch is caught, never scored blind.
 *
 * It does NOT change any band. It is a pure, explicit, by-contract converter:
 * each field name states its unit; nothing is auto-detected (auto-detecting
 * fraction-vs-percent is itself a silent-mis-score hazard — see feedUnitWarnings
 * for a heuristic that only WARNS, never mutates).
 */

/** A live feed row in SOURCE units: percentages as 0–100, durations as SECONDS. */
export interface ScorecardFeedInputs {
  functionName: string;
  /** QA % as 0–100 (e.g. avg_quality = 96 means 96%). */
  qualityPercent: number | null;
  /** BRR (positive response rate among responders) as 0–100. */
  prrPercent: number | null;
  /** Survey response rate (responses ÷ contacts) as 0–100 — the ≥10% PRR gate. */
  responseRatePercent: number | null;
  /** Average handling time in SECONDS (e.g. avg_aht_seconds = 555 → 9:15). */
  ahtSeconds: number | null;
  /** FCR % as 0–100. */
  fcrPercent: number | null;
  /** Productivity % as 0–100. */
  productivityPercent: number | null;
  /** CTR % as 0–100. */
  ctrPercent: number | null;
  /** Quiz % as 0–100. */
  quizPercent: number | null;
  /** Common-mistakes COUNT (already a count — no conversion). */
  mistakesCount: number | null;
  /** First response time in SECONDS. */
  responseTimeSeconds: number | null;
}

const isFiniteNum = (v: number | null | undefined): v is number => typeof v === 'number' && isFinite(v);

/** Percent (0–100) → fraction (0–1), the unit `threshold_pct` / `roundHalfUpPct` expects. Null-preserving. */
export function percentToFraction(pct: number | null | undefined): number | null {
  return isFiniteNum(pct) ? pct / 100 : null;
}

/** Seconds → Excel day-fraction (1 day = 86 400 s), the unit `threshold_hours` (×24) expects. Null-preserving. */
export function secondsToDayFraction(seconds: number | null | undefined): number | null {
  return isFiniteNum(seconds) ? seconds / 86400 : null;
}

/**
 * Convert a live feed row (percent + seconds) into the canonical
 * ScorecardActualInputs the validated engine scores (fractions + day-fractions).
 * Pure; null in → null out (never coerces a missing value to 0).
 */
export function feedToActualInputs(feed: ScorecardFeedInputs): ScorecardActualInputs {
  return {
    functionName: feed.functionName,
    qualityActual: percentToFraction(feed.qualityPercent),
    prrRate: percentToFraction(feed.prrPercent),
    responseRate: percentToFraction(feed.responseRatePercent),
    ahtActual: secondsToDayFraction(feed.ahtSeconds),
    fcrActual: percentToFraction(feed.fcrPercent),
    productivityActual: percentToFraction(feed.productivityPercent),
    ctrActual: percentToFraction(feed.ctrPercent),
    quizActual: percentToFraction(feed.quizPercent),
    mistakesActual: isFiniteNum(feed.mistakesCount) ? feed.mistakesCount : null,
    responseTimeActual: secondsToDayFraction(feed.responseTimeSeconds),
  };
}

/**
 * Non-blocking sanity warnings that catch a UNIT MISMATCH before it silently
 * mis-scores. Returns human-readable strings; never throws, never mutates.
 *  - a "percent" field outside [0, 100]  → almost certainly not a percent;
 *  - a "percent" field in (0, 1)         → suspiciously fractional (caller may
 *    have passed a 0–1 fraction into a 0–100 percent field — it would score ~0–1%);
 *  - a negative duration                 → impossible seconds value.
 * A consumer should log these and refuse to trust the score when any appear.
 */
export function feedUnitWarnings(feed: ScorecardFeedInputs): string[] {
  const warns: string[] = [];
  const pctFields: Array<[string, number | null]> = [
    ['qualityPercent', feed.qualityPercent],
    ['prrPercent', feed.prrPercent],
    ['responseRatePercent', feed.responseRatePercent],
    ['fcrPercent', feed.fcrPercent],
    ['productivityPercent', feed.productivityPercent],
    ['ctrPercent', feed.ctrPercent],
    ['quizPercent', feed.quizPercent],
  ];
  for (const [name, v] of pctFields) {
    if (!isFiniteNum(v)) continue;
    if (v < 0 || v > 100) warns.push(`${name}=${v} is outside 0–100 — not a percent? (would score as ${Math.round(v)}%)`);
    else if (v > 0 && v < 1) warns.push(`${name}=${v} is in (0,1) — looks like a fraction passed into a percent field (would score as ${(v).toFixed(2)}%, near-zero)`);
  }
  const secFields: Array<[string, number | null]> = [
    ['ahtSeconds', feed.ahtSeconds],
    ['responseTimeSeconds', feed.responseTimeSeconds],
  ];
  for (const [name, v] of secFields) {
    if (isFiniteNum(v) && v < 0) warns.push(`${name}=${v} is negative — impossible duration`);
  }
  if (isFiniteNum(feed.mistakesCount) && feed.mistakesCount < 0) warns.push(`mistakesCount=${feed.mistakesCount} is negative — impossible count`);
  return warns;
}
