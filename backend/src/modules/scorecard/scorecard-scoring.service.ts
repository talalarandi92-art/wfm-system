import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { scoreBand, roundHalfUpPct } from '../kpi-registry/score-band';
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

/** Per-KPI data-coverage flag (one entry per scoring KPI; PRR spans two cells but is one KPI). */
export interface KpiCoverageFlag {
  code: string;
  /** the KPI can score for this function (a real band, or QA re-enabled by data-driven applicability) */
  applicable: boolean;
  /** a genuine raw input existed (or a documented whole-source bar substitution applied) */
  hasData: boolean;
}

export interface ComputedScorecard {
  points: ComputedScoreCells;
  /** Net Points = Σ score cells (a null cell contributes 0, like a blank Excel cell). */
  netPoints: number;

  /* ── COVERAGE QUORUM (guard #1) — never let a null KPI silently pass as a 0
     that makes a near-empty feed look scored. These surface HOW MUCH real data
     backed the Net so a consumer can gate; `status` flips to 'insufficient-coverage'
     below the quorum. ──────────────────────────────────────────────────────── */
  /** count of scoring KPIs (of the 9) that are applicable AND had real data */
  scoredKpiCount: number;
  /** count of scoring KPIs applicable to this function (denominator for coverage) */
  applicableKpiCount: number;
  /** scoredKpiCount ÷ applicableKpiCount (0 when nothing is applicable) */
  coverage: number;
  /** coverage ≥ quorum */
  coverageMet: boolean;
  /** 'scored' when the quorum is met, else 'insufficient-coverage' (Net is still returned but must NOT be trusted) */
  status: 'scored' | 'insufficient-coverage';
  /** per-KPI applicable/hasData breakdown (explains the coverage number) */
  kpiCoverage: KpiCoverageFlag[];

  /* ── PROVENANCE (guard #6) — this is an ENGINE RE-COMPUTE, never the authority.
     Coaching / incentive / intern consumers must stay on the Director's
     workbook-verbatim scores until auto-scoring is activated. ──────────────── */
  authoritative: false;
  engine: string;
}

/** Optional scoring controls (default-off so the historical-validation path is byte-identical). */
export interface ScorecardScoreOptions {
  /** minimum coverage fraction before `status` = 'insufficient-coverage' (default 0.5). */
  coverageQuorum?: number;
  /**
   * Whole-SOURCE-missing flags (guard #4 — kpi-seed QUALITY.missing_month /
   * QUIZ.no_quiz_week). When a whole month/week source is absent, the documented
   * rule substitutes the BAR (max band points) rather than null/0. This is a
   * PERIOD-level decision the caller supplies — it is NOT inferred from a per-row
   * blank (a per-row blank stays null/not-evaluated).
   */
  sourceMissing?: { quality?: boolean; quiz?: boolean };
}

const kpiByCode = new Map(SEED_KPIS.map((k) => [k.code, k]));

// The 9 KPIs that sum into Net Points (PRR contributes two cells but is ONE KPI
// for coverage) are enumerated inline in the kpiCoverage array of computeScores().

const ENGINE_LABEL = 'kpi-registry score-band (validated engine — ENGINE RE-COMPUTE, not authoritative)';
const DEFAULT_COVERAGE_QUORUM = 0.5;

/** A band that can actually award points, vs an info/absent band (not applicable for this function). */
function isScoringBand(band: KpiBand | null | undefined): boolean {
  return !!band && band.type !== 'info';
}

/** The BAR = max achievable points of a threshold band — substituted on a whole-source-missing period (guard #4). */
function bandMaxPoints(band: KpiBand | null | undefined): number | null {
  if (!band || (band.type !== 'threshold_pct' && band.type !== 'threshold_hours')) return null;
  const pts = (band.bands ?? []).map((b) => b.points);
  return pts.length ? Math.max(...pts) : null;
}

const isFiniteNum = (v: number | null | undefined): v is number => typeof v === 'number' && !isNaN(v);

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
   * Score one employee's actuals through the validated engine, HARDENED so that
   * IF auto-scoring is ever activated it cannot silently mis-score anyone.
   *
   * The per-cell POINTS and Net Points remain 1:1 with scorecard-validation/
   * re-scorer.ts (the historical harness) for every row that harness covers —
   * all guards below are ADDITIVE: they surface coverage/provenance and, only
   * under explicit opt-in flags (whole-source-missing) or genuinely-present data
   * (data-driven QA), change a cell the harness never asserts on. With no options
   * and a normal row, the returned `points`/`netPoints` are byte-identical to the
   * prior implementation.
   *
   * Guards:
   *  #1 coverage quorum   — reports scoredKpiCount / applicableKpiCount / coverage
   *                         / status so a null KPI is VISIBLE, never a silent 0.
   *  #2 null sentinel     — a missing raw maps to null (excluded), never to a 0
   *                         that would score −10/−15 (see cellScore()).
   *  #4 bar substitution  — a whole-source-missing QA month / quiz week uses the
   *                         BAR (max band points), per kpi-seed, when opted in.
   *  #5 data-driven QA    — a function the seed marks QA-not-applicable that
   *                         nonetheless carries a real QA value IS scored.
   *  #6 provenance        — result is flagged authoritative:false (engine re-compute).
   */
  computeScores(a: ScorecardActualInputs, opts?: ScorecardScoreOptions): ComputedScorecard {
    const fn = a.functionName;
    const quorum = opts?.coverageQuorum ?? DEFAULT_COVERAGE_QUORUM;

    // GUARD #2 — null sentinel: a missing/blank/NaN raw is EXCLUDED (null), never
    // banded as a 0 (which would fall to a band default like FCR −10 / RT −15).
    const cellScore = (band: KpiBand | null, raw: number | null | undefined): number | null =>
      isFiniteNum(raw) ? scoreBand(band, raw) : null;

    // ── QUALITY — data-driven applicability (#5) + not-evaluated + bar-sub (#4) ──
    const qBaseBand = kpiByCode.get('QUALITY')?.band ?? null;
    const qOverrideBand = bandFor('QUALITY', fn);            // info-band for the seed's not-applicable functions
    const qSeedNotApplicable = !isScoringBand(qOverrideBand);
    // "present" mirrors the band's not-evaluated rule: blank OR rounds to 0% = not evaluated.
    const qRawPresent = isFiniteNum(a.qualityActual) && roundHalfUpPct(a.qualityActual) >= 1;
    // #5: if the seed says not-applicable BUT a real QA value exists, score it with the base band
    //     (real data shows e.g. 8/37 Feb Offline rows WERE QA-scored). Only exclude when genuinely absent.
    const qEffectiveBand = qSeedNotApplicable ? (qRawPresent ? qBaseBand : null) : qOverrideBand;
    const qBarSub = !!opts?.sourceMissing?.quality && isScoringBand(qEffectiveBand);
    const qualityPoints = qBarSub ? bandMaxPoints(qEffectiveBand) : cellScore(qEffectiveBand, a.qualityActual);

    // ── PRR gate: aux carries BRR (col M) + Survey-RR (col L) as fractions; the
    //    gate band ignores `value` and awards pass_points to BOTH cells (max 5). ──
    const prrBand = bandFor('PRR', fn);
    const prrApplicable = isScoringBand(prrBand);
    const prrAux = { PRR: numOrNaN(a.prrRate), SURVEY_RR: numOrNaN(a.responseRate) };
    const prrCellVal = prrApplicable ? scoreBand(prrBand, numOrNaN(a.prrRate), prrAux) : null;

    // ── QUIZ — bar substitution (#4) on a whole no-quiz week ──
    const quizBand = bandFor('QUIZ', fn);
    const quizBarSub = !!opts?.sourceMissing?.quiz && isScoringBand(quizBand);
    const quizPoints = quizBarSub ? bandMaxPoints(quizBand) : cellScore(quizBand, a.quizActual);

    // ── plain cells (band once, reuse the band for coverage) ──
    const ahtBand = bandFor('AHT', fn);
    const fcrBand = bandFor('FCR', fn);
    const prodBand = bandFor('PRODUCTIVITY', fn);
    const ctrBand = bandFor('CTR', fn);
    const mistakesBand = bandFor('COMMON_MISTAKES', fn);
    const rtBand = bandFor('RESPONSE_TIME', fn);

    const points: ComputedScoreCells = {
      quality: qualityPoints,
      prrPoints: prrCellVal,
      prrBonus: prrCellVal,
      aht: cellScore(ahtBand, a.ahtActual),
      fcr: cellScore(fcrBand, a.fcrActual),
      productivity: cellScore(prodBand, a.productivityActual),
      ctr: cellScore(ctrBand, a.ctrActual),
      quiz: quizPoints,
      mistakes: cellScore(mistakesBand, a.mistakesActual),
      responseTime: cellScore(rtBand, a.responseTimeActual),
    };

    // Net Points = Σ score cells; a null cell contributes 0 exactly like a blank
    // Excel cell in H = K+N+O+Q+S+U+W+Y+AA+AG (unchanged from the validated path).
    const netPoints = (Object.keys(points) as (keyof ComputedScoreCells)[])
      .reduce((sum, k) => sum + (points[k] ?? 0), 0);

    // ── GUARD #1 — coverage quorum (per KPI, PRR counted once) ──
    const kpiCoverage: KpiCoverageFlag[] = [
      { code: 'QUALITY', applicable: isScoringBand(qEffectiveBand), hasData: qRawPresent || qBarSub },
      { code: 'PRR', applicable: prrApplicable, hasData: isFiniteNum(a.prrRate) },
      { code: 'AHT', applicable: isScoringBand(ahtBand), hasData: isFiniteNum(a.ahtActual) },
      { code: 'FCR', applicable: isScoringBand(fcrBand), hasData: isFiniteNum(a.fcrActual) },
      { code: 'PRODUCTIVITY', applicable: isScoringBand(prodBand), hasData: isFiniteNum(a.productivityActual) },
      { code: 'CTR', applicable: isScoringBand(ctrBand), hasData: isFiniteNum(a.ctrActual) },
      { code: 'QUIZ', applicable: isScoringBand(quizBand), hasData: isFiniteNum(a.quizActual) || quizBarSub },
      { code: 'COMMON_MISTAKES', applicable: isScoringBand(mistakesBand), hasData: isFiniteNum(a.mistakesActual) },
      { code: 'RESPONSE_TIME', applicable: isScoringBand(rtBand), hasData: isFiniteNum(a.responseTimeActual) },
    ];
    const applicableKpiCount = kpiCoverage.filter((k) => k.applicable).length;
    const scoredKpiCount = kpiCoverage.filter((k) => k.applicable && k.hasData).length;
    const coverage = applicableKpiCount ? Math.round((scoredKpiCount / applicableKpiCount) * 10000) / 10000 : 0;
    const coverageMet = coverage >= quorum;

    return {
      points,
      netPoints,
      scoredKpiCount,
      applicableKpiCount,
      coverage,
      coverageMet,
      status: coverageMet ? 'scored' : 'insufficient-coverage',
      kpiCoverage,
      authoritative: false,
      engine: ENGINE_LABEL,
    };
  }

  /**
   * GUARD #6 — per-batch "match rate vs workbook" summary (reuses the validation
   * comparator's exact-Net concept). Given (workbookNet, engineNet) pairs it
   * reports how many the engine reproduces. Consumers surface this so a low match
   * rate BLOCKS trusting the engine re-compute over the Director's verbatim scores.
   * Pure; no DB.
   */
  matchRateSummary(pairs: Array<{ workbookNet: number; engineNet: number }>): {
    totalRows: number; netMatching: number; netMismatched: number; matchRatePct: number | null;
    authoritative: false; engine: string;
  } {
    const EPS = 1e-6;
    const netMatching = pairs.filter((p) => Math.abs(p.workbookNet - p.engineNet) < EPS).length;
    return {
      totalRows: pairs.length,
      netMatching,
      netMismatched: pairs.length - netMatching,
      matchRatePct: pairs.length ? Math.round((netMatching / pairs.length) * 1000) / 10 : null,
      authoritative: false,
      engine: ENGINE_LABEL,
    };
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
