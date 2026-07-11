/**
 * Pure band-scoring engine for the KPI Registry (wave B1).
 * Interprets the `band` JSONB stored in kpi_function_config and reproduces the
 * scorecard-builder skill's scoring 1:1 (see kpi-seed.ts for conventions).
 *
 * NOTHING in the live scoring path uses this yet (B6 will) — it exists so the
 * registry's rulebook is executable and provably equal to the skill.
 */
import { KpiBand } from './kpi-seed';

/** Round-half-up a fraction (0.895 → 90). Matches the skill's `Math.round(v*100)`. */
export function roundHalfUpPct(v: number): number {
  return Math.round(v * 100);
}

/**
 * Score a KPI value against a band definition.
 *  - threshold_pct  : value is a FRACTION (0.95); rounded half-up to integer % first.
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
      const p = roundHalfUpPct(value);
      for (const b of band.bands ?? []) {
        if (b.eq !== undefined && p === b.eq) return b.points;
        if (b.gt !== undefined && p > b.gt) return b.points;
        if (b.gte !== undefined && p >= b.gte) return b.points;
        if (b.lte !== undefined && p <= b.lte) return b.points;
      }
      return band.default ?? null;
    }

    case 'threshold_hours': {
      if (value === null || value === undefined || isNaN(value)) return null;
      const h = band.transform === 'dayfrac_to_hours' ? value * 24 : value;
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
        return roundHalfUpPct(raw) >= g.gte;
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
