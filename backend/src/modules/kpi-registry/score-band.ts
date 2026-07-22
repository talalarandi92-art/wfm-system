/**
 * Pure band-scoring engine for the KPI Registry (wave B1).
 * Interprets the `band` JSONB stored in kpi_function_config and reproduces the
 * scorecard-builder skill's scoring 1:1 (see kpi-seed.ts for conventions).
 *
 * NOTHING in the live scoring path uses this yet (B6 will) — it exists so the
 * registry's rulebook is executable and provably equal to the skill.
 */
import { KpiBand } from './kpi-seed';

/**
 * Round-half-up a fraction (0.895 → 90). Matches the skill's `Math.round(v*100)`.
 *
 * DISPLAY ONLY (D-079, Director 2026-07-22). Scoring compares the RAW percentage —
 * rounding first promoted values across band edges and paid MORE than the
 * Director's own SC workbooks on 71 of 71 disagreeing cells (68 higher, +550 net
 * points; QA 79.80% paid 10 by the old path and −10 by his sheet).
 */
export function roundHalfUpPct(v: number): number {
  return Math.round(v * 100);
}

/** Float-noise tolerance: 0.8 × 100 = 80.00000000000001 must still satisfy `gte: 80`. */
const PCT_EPS = 1e-6;

/**
 * The percentage a band is compared against: the RAW fraction × 100, never rounded
 * (D-079). One definition — every band type and the gate check go through it.
 */
export function bandPct(v: number): number {
  return v * 100;
}

/** `a >= b` / `a <= b` / `a === b` with the float-noise tolerance applied. */
const gteEps = (a: number, b: number) => a >= b - PCT_EPS;
const lteEps = (a: number, b: number) => a <= b + PCT_EPS;
const eqEps = (a: number, b: number) => Math.abs(a - b) < PCT_EPS;

/**
 * Score a KPI value against a band definition.
 *  - threshold_pct  : value is a FRACTION (0.95); compared as the RAW percentage
 *                     (D-079 — round-half-up is DISPLAY only, never a scoring step).
 *  - threshold_hours: value is an Excel DAY-FRACTION; converted to hours (×24).
 *  - gate           : aux carries the gate metrics as FRACTIONS keyed by metric
 *                     name (e.g. { PRR: 0.82, SURVEY_RR: 0.12 }); returns the
 *                     points for ONE cell (PRR Points or PRR Bonus each = pass_points).
 *  - linear_count   : value is a raw count → base + count×per_unit.
 *  - deduction      : value truthy (missed) → points_if_missed, else 0.
 *  - info           : never scored → null.
 */
export function scoreBand(band: KpiBand | null | undefined, value: number, aux?: Record<string, number>): number | null {
  if (!band) return null;
  switch (band.type) {
    case 'info':
      return null;

    case 'threshold_pct': {
      if (value === null || value === undefined || isNaN(value)) return null;
      // D-079: band the RAW percentage. Rounding first crossed band edges and paid
      // more than the SC workbooks (94.75% was scored as 95%). Display still rounds.
      const p = bandPct(value);
      for (const b of band.bands ?? []) {
        if (b.eq !== undefined && eqEps(p, b.eq)) return b.points;
        if (b.gt !== undefined && p > b.gt + PCT_EPS) return b.points;
        if (b.gte !== undefined && gteEps(p, b.gte)) return b.points;
        if (b.lte !== undefined && lteEps(p, b.lte)) return b.points;
      }
      return band.default ?? null;
    }

    case 'threshold_hours': {
      if (value === null || value === undefined || isNaN(value)) return null;
      const h = band.transform === 'dayfrac_to_hours' ? value * 24 : value;
      // NOTE: strict comparisons, deliberately. D-079 was about the PERCENTAGE
      // rounding step; the hour bands never rounded, and their exact edges carry
      // sheet meaning (exactly 9:30 belongs to the NEXT band). Adding a tolerance
      // here silently moved those edges.
      for (const b of band.bands ?? []) {
        if (b.lte !== undefined && h <= b.lte) return b.points;
        if (b.gte !== undefined && h >= b.gte) return b.points;
      }
      return band.default ?? null;
    }

    case 'gate': {
      const gates = band.gates ?? [];
      const pass = gates.every((g) => {
        const raw = aux?.[g.metric];
        if (raw === null || raw === undefined || isNaN(raw)) return false;
        // Same basis as the bands (D-079) — a gate is a threshold too. The EPS keeps
        // an exact 10.00% passing a `gte: 10` gate despite float noise.
        return gteEps(bandPct(raw), g.gte);
      });
      return pass ? (band.pass_points ?? 0) : (band.default ?? 0);
    }

    case 'linear_count': {
      if (value === null || value === undefined || isNaN(value)) return null;
      return (band.base ?? 0) + value * (band.per_unit ?? 0);
    }

    case 'deduction':
      return value ? (band.points_if_missed ?? 0) : 0;

    default:
      return null;
  }
}
