import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { scoreBand } from '../kpi-registry/score-band';
import { SEED_KPIS, KpiBand, NET_POINTS_MAX, NET_POINTS_FORMULA } from '../kpi-registry/kpi-seed';

/**
 * ScorecardScoringService — the LIVE scoring path, re-pointed onto the VALIDATED
 * kpi-registry engine (wave B: score-band.ts + kpi-seed.ts, incl. the m080/m088/m089
 * per-function AHT/RT bands + the QUALITY not-evaluated rule).
 *
 * WHY: the live scorecard module INGESTS the Director's already-scored workbook
 * (scorecard-upload.service reads the K/Q/S… score columns verbatim). It never
 * computed points itself, so it neither diverged from nor used the registry bands.
 * This service makes the live module able to compute/verify Net Points with the
 * EXACT engine the historical-validation harness proved at 98.47% (Jan/May/June
 * 100%) — importing scoreBand + SEED_KPIS, never re-implementing a band.
 *
 * SCOPE GUARD (Director's call): this is a READ-ONLY compute/verify path. It does
 * NOT auto-score a month from raw data and never writes scores or runs in the
 * background — AUTO-scoring activation stays the Director's decision. `computeScores`
 * re-derives points from actuals already ingested from the approved workbook; the
 * /verify endpoint only compares engine output against the stored workbook values.
 */

/** Live-entry actuals in the SAME raw formats the SC sheet carries (and that
 *  scorecard_entries stores verbatim): %-KPIs as fractions, AHT/RT as Excel
 *  day-fractions, Common Mistakes as a count, PRR/Response-Rate as fractions. */
export interface ScorecardActualInputs {
  functionName: string;
  qualityActual: number | null;        // col J  — fraction
  prrRate: number | null;              // col M  — BRR fraction (PRR gate value)
  responseRate: number | null;         // col L  — Survey RR fraction (PRR ≥10% gate)
  ahtActual: number | null;            // col P  — day-fraction
  fcrActual: number | null;            // col R  — fraction
  productivityActual: number | null;   // col T  — fraction
  ctrActual: number | null;            // col V  — fraction
  quizActual: number | null;           // col X  — fraction
  mistakesActual: number | null;       // col Z  — count
  responseTimeActual: number | null;   // col AF — day-fraction
}

/** The 10 Net-Points score cells (null = not scorable: missing raw / info band). */
export interface ComputedScoreCells {
  quality: number | null;
  prrPoints: number | null;
  prrBonus: number | null;
  aht: number | null;
  fcr: number | null;
  productivity: number | null;
  ctr: number | null;
  quiz: number | null;
  mistakes: number | null;
  responseTime: number | null;
}

export interface ComputedScorecard {
  points: ComputedScoreCells;
  /** Net Points = Σ score cells (a null cell contributes 0, like a blank Excel cell). */
  netPoints: number;
}

const kpiByCode = new Map(SEED_KPIS.map((k) => [k.code, k]));

/** Resolve the band for a KPI + function — the SAME resolution the validated
 *  re-scorer (scorecard-validation/re-scorer.ts) uses: function override wins. */
function bandFor(kpiCode: string, functionName: string): KpiBand | null {
  const kpi = kpiByCode.get(kpiCode);
  if (!kpi) return null;
  const ov = kpi.functionOverrides?.find(
    (o) => o.functionName.toLowerCase() === (functionName || '').toLowerCase(),
  );
  return (ov?.band ?? kpi.band) ?? null;
}

const numOrNaN = (v: number | null | undefined): number => (typeof v === 'number' ? v : NaN);

@Injectable()
export class ScorecardScoringService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Score one employee's actuals through the validated engine.
   * 1:1 with scorecard-validation/re-scorer.ts (which the 98.47% harness runs),
   * differing only in that inputs come from the live entry rather than an SC row.
   */
  computeScores(a: ScorecardActualInputs): ComputedScorecard {
    const fn = a.functionName;

    // PRR gate: aux carries BRR (col M) + Survey-RR (col L) as fractions; the
    // gate band ignores `value` and awards pass_points to BOTH cells (max 5).
    const prrBand = bandFor('PRR', fn);
    const prrAux = { PRR: numOrNaN(a.prrRate), SURVEY_RR: numOrNaN(a.responseRate) };
    const prrCell = () => scoreBand(prrBand, numOrNaN(a.prrRate), prrAux);

    // Every other cell: null when the raw is missing, else band the raw value.
    const cell = (code: string, raw: number | null): number | null =>
      raw === null || raw === undefined || isNaN(raw) ? null : scoreBand(bandFor(code, fn), raw);

    const points: ComputedScoreCells = {
      quality: cell('QUALITY', a.qualityActual),
      prrPoints: prrCell(),
      prrBonus: prrCell(),
      aht: cell('AHT', a.ahtActual),
      fcr: cell('FCR', a.fcrActual),
      productivity: cell('PRODUCTIVITY', a.productivityActual),
      ctr: cell('CTR', a.ctrActual),
      quiz: cell('QUIZ', a.quizActual),
      mistakes: cell('COMMON_MISTAKES', a.mistakesActual),
      responseTime: cell('RESPONSE_TIME', a.responseTimeActual),
    };

    const netPoints = (Object.keys(points) as (keyof ComputedScoreCells)[])
      .reduce((sum, k) => sum + (points[k] ?? 0), 0);

    return { points, netPoints };
  }

  /**
   * Read-only rulebook for the transparency viewer. Reads the LIVE registry the
   * validation proved (kpi_registry + kpi_function_config, seeded by m080/088/089).
   * Never mutates. NULL-function config = the base weight/target/band; non-NULL
   * rows are per-function overrides (AHT/RT band shapes, QUALITY not-applicable).
   */
  async getRulebook(tenantId: string) {
    const rows = await this.ds.query(
      `SELECT r.kpi_code, r.name_en, r.name_ar, r.definition, r.formula_text,
              r.direction, r.unit, r.source, r.attribution_rule, r.active,
              COALESCE(json_agg(json_build_object(
                'functionName', c.function_name, 'weight', c.weight,
                'target', c.target, 'band', c.band, 'appliesFrom', c.applies_from
              ) ORDER BY c.function_key, c.applies_from DESC)
                FILTER (WHERE c.id IS NOT NULL), '[]') AS configs
         FROM kpi_registry r
         LEFT JOIN kpi_function_config c ON c.kpi_id = r.id
        WHERE r.tenant_id = $1
        GROUP BY r.id
        ORDER BY r.kpi_code`,
      [tenantId],
    );

    const kpis = rows.map((r: any) => {
      const configs: any[] = Array.isArray(r.configs) ? r.configs : [];
      const base = configs.find((c) => c.functionName === null) ?? null;
      const overrides = configs
        .filter((c) => c.functionName !== null)
        .map((c) => ({
          functionName: c.functionName,
          weight: c.weight === null ? null : Number(c.weight),
          target: c.target === null ? null : Number(c.target),
          band: c.band ?? null,
        }));
      return {
        kpiCode: r.kpi_code,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        formulaText: r.formula_text,
        direction: r.direction,
        unit: r.unit,
        source: r.source,
        attributionRule: r.attribution_rule,
        active: r.active,
        definition: r.definition ?? {},
        weight: base && base.weight !== null ? Number(base.weight) : 0,
        target: base && base.target !== null ? Number(base.target) : null,
        band: base?.band ?? null,
        functionOverrides: overrides,
      };
    });

    return {
      netPointsMax: NET_POINTS_MAX,
      netPointsFormula: NET_POINTS_FORMULA,
      engine: 'kpi-registry score-band (validated 98.47% — Jan/May/June 100%)',
      provenance: 'Bands seeded from the Director\'s 2026 SC workbooks via migrations 080 + 088 (authoritative weights) + 089 (per-function AHT/RT bands + QUALITY not-evaluated rule).',
      count: kpis.length,
      kpis,
    };
  }
}
