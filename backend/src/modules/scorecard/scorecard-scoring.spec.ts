/**
 * ALIGNMENT GATE — the LIVE scorecard scoring path (ScorecardScoringService)
 * reproduces the VALIDATED engine 1:1.
 *
 * The live module historically ingested the Director's already-scored workbook
 * and never computed points. ScorecardScoringService re-points it onto the exact
 * kpi-registry engine the historical-validation harness proved at 98.47%
 * (Jan/May/June 100%). This spec asserts, for a known employee/function, that the
 * live-computed per-cell points AND Net Points equal what the validated
 * re-scorer (scorecard-validation/re-scorer.ts) produces from the same raws —
 * proving production scores match the validated output.
 */
import { ScorecardScoringService, ScorecardActualInputs } from './scorecard-scoring.service';
import {
  feedToActualInputs, percentToFraction, secondsToDayFraction, feedUnitWarnings, ScorecardFeedInputs,
} from './scorecard-unit-adapter';
import { rescoreRow } from '../scorecard-validation/re-scorer';
import { ScRow, SCORE_CELLS, ScoreKpi } from '../scorecard-validation/sc-workbook-reader';

// computeScores() is pure (never touches this.ds), so a null DataSource is fine.
const svc = new ScorecardScoringService(null as any);

/** Excel day-fraction from seconds — the raw format of SC!P (AHT) / SC!AF (RT). */
const dayfrac = (seconds: number) => seconds / 86400;

/** Build the SC-row the validated re-scorer consumes from the SAME live actuals. */
function scRow(a: ScorecardActualInputs): ScRow {
  const cells = {} as ScRow['cells'];
  for (const sc of SCORE_CELLS) cells[sc.kpi] = { raw: null, wbPoints: null, formula: null };
  const set = (k: ScoreKpi, v: number | null) => { cells[k].raw = v; };
  set('QUALITY', a.qualityActual);
  set('PRR_POINTS', a.prrRate);
  set('PRR_BONUS', a.prrRate);
  set('AHT', a.ahtActual);
  set('FCR', a.fcrActual);
  set('PRODUCTIVITY', a.productivityActual);
  set('CTR', a.ctrActual);
  set('QUIZ', a.quizActual);
  set('COMMON_MISTAKES', a.mistakesActual);
  set('RESPONSE_TIME', a.responseTimeActual);
  return {
    rowNum: 14, agent: 'Fixture Agent', employeeId: '10001', userId: 'f.agent',
    functionName: a.functionName, tl: null, week: 'Final', workingDaysPct: 1,
    wbNet: null, wbNetFormula: null, responseRate: a.responseRate, cells,
  };
}

/** live points → the re-scorer's ScoreKpi keying, for a direct cell-by-cell compare. */
function liveByCell(a: ScorecardActualInputs): Record<ScoreKpi, number | null> {
  const p = svc.computeScores(a).points;
  return {
    QUALITY: p.quality, PRR_POINTS: p.prrPoints, PRR_BONUS: p.prrBonus,
    AHT: p.aht, FCR: p.fcr, PRODUCTIVITY: p.productivity, CTR: p.ctr,
    QUIZ: p.quiz, COMMON_MISTAKES: p.mistakes, RESPONSE_TIME: p.responseTime,
  };
}

describe('Live scorecard scoring == validated kpi-registry engine', () => {
  // A real-shaped CH-WA agent exercising every scoring cell (incl. the m089
  // per-function chat AHT/RT bands + the PRR double gate).
  const chWa: ScorecardActualInputs = {
    functionName: 'CH - WA',
    qualityActual: 0.96,            // ≥95 → 30
    prrRate: 0.90, responseRate: 0.12, // BRR≥80 AND RES≥10 → 2.5 + 2.5
    ahtActual: dayfrac(555),       // 9:15 chat band → 10
    fcrActual: 0.86,               // ≥85 → 20
    productivityActual: 0.92,      // ≥91 → 15
    ctrActual: 0.96,               // ≥95 → 10
    quizActual: 0.96,              // >95 → 10
    mistakesActual: 0,             // 0 → 15
    responseTimeActual: dayfrac(30), // 30s chat RT band → 10
  };

  it('per-cell + Net Points match the validated re-scorer for a CH-WA employee', () => {
    const live = svc.computeScores(chWa);
    const validated = rescoreRow(scRow(chWa));

    // per-cell parity with the harness the 98.47% run uses
    const liveCells = liveByCell(chWa);
    for (const sc of SCORE_CELLS) {
      expect(liveCells[sc.kpi]).toBe(validated.ourPoints[sc.kpi]);
    }
    // Net parity
    expect(live.netPoints).toBe(validated.ourNet);
    // …and the documented expected total (30+2.5+2.5+10+20+15+10+10+15+10)
    expect(live.netPoints).toBe(125);
  });

  it('reproduces the exact decoded points per cell (m089 chat bands + QA + PRR gate live)', () => {
    const p = svc.computeScores(chWa).points;
    expect(p.quality).toBe(30);
    expect(p.prrPoints).toBe(2.5);
    expect(p.prrBonus).toBe(2.5);
    expect(p.aht).toBe(10);           // chat 9:15 (would be −10 under the old flat 48h band)
    expect(p.fcr).toBe(20);
    expect(p.productivity).toBe(15);
    expect(p.ctr).toBe(10);
    expect(p.quiz).toBe(10);
    expect(p.mistakes).toBe(15);
    expect(p.responseTime).toBe(10);  // chat 30s RT band
  });

  it('QUALITY not-evaluated rule is live: blank/zero QA → null (never −20), and a real value still scores', () => {
    const blank = svc.computeScores({ ...chWa, qualityActual: 0 });
    expect(blank.points.quality).toBeNull();
    expect(svc.computeScores({ ...chWa, qualityActual: null }).points.quality).toBeNull();
    expect(svc.computeScores({ ...chWa, qualityActual: 0.5 }).points.quality).toBe(-20); // 1–64% band intact
  });

  it('GUARD #5 — data-driven QUALITY applicability: a seed-excluded function scores QA when a real value exists, null only when genuinely absent', () => {
    for (const fn of ['Support', 'Offline', 'Team Leader', 'Customer Care', 'إداري']) {
      // real QA value present → NOW scored (real data shows e.g. 8/37 Feb Offline WERE QA-scored)
      expect(svc.computeScores({ ...chWa, functionName: fn, qualityActual: 0.96 }).points.quality).toBe(30);
      expect(svc.computeScores({ ...chWa, functionName: fn, qualityActual: 0.5 }).points.quality).toBe(-20);
      // genuinely absent (blank / zero / not-evaluated) → excluded (null), never a forced −20
      expect(svc.computeScores({ ...chWa, functionName: fn, qualityActual: null }).points.quality).toBeNull();
      expect(svc.computeScores({ ...chWa, functionName: fn, qualityActual: 0 }).points.quality).toBeNull();
    }
  });

  it('email-shaped function (Mail & NPS) uses the 48h AHT band, matching the validated engine', () => {
    const mail: ScorecardActualInputs = {
      functionName: 'Mail & NPS',
      qualityActual: 0.91, prrRate: null, responseRate: null,
      ahtActual: 40 / 24,            // 40h ≤ 48 → 10
      fcrActual: 0.80, productivityActual: 0.90, ctrActual: 0.92,
      quizActual: 0.95, mistakesActual: 1, responseTimeActual: 1.5 / 24, // ≤2h → 10
    };
    const live = svc.computeScores(mail);
    const validated = rescoreRow(scRow(mail));
    expect(live.netPoints).toBe(validated.ourNet);
    const liveCells = liveByCell(mail);
    for (const sc of SCORE_CELLS) expect(liveCells[sc.kpi]).toBe(validated.ourPoints[sc.kpi]);
    expect(live.points.aht).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   HARDENING GUARDS — these prove the auto-scoring path cannot silently
   mis-score IF the Director ever activates it. All are additive; none change
   the validated per-cell points/Net for a normal row (asserted above).
   ══════════════════════════════════════════════════════════════════════════ */

const fullChWa: ScorecardActualInputs = {
  functionName: 'CH - WA',
  qualityActual: 0.96, prrRate: 0.90, responseRate: 0.12,
  ahtActual: 555 / 86400, fcrActual: 0.86, productivityActual: 0.92,
  ctrActual: 0.96, quizActual: 0.96, mistakesActual: 0, responseTimeActual: 30 / 86400,
};

describe('GUARD #1 — coverage quorum (a null KPI is visible, never a silent 0)', () => {
  it('a fully-fed CH-WA row is fully covered → status scored, coverage 1.0', () => {
    const r = svc.computeScores(fullChWa);
    expect(r.applicableKpiCount).toBe(9);       // all 9 scoring KPIs apply to CH-WA
    expect(r.scoredKpiCount).toBe(9);
    expect(r.coverage).toBe(1);
    expect(r.coverageMet).toBe(true);
    expect(r.status).toBe('scored');
  });

  it('a near-empty feed still yields a Net but is flagged insufficient-coverage', () => {
    // only QA present — Net would look like a real 30 from almost no data
    const sparse: ScorecardActualInputs = {
      functionName: 'CH - WA', qualityActual: 0.96,
      prrRate: null, responseRate: null, ahtActual: null, fcrActual: null,
      productivityActual: null, ctrActual: null, quizActual: null,
      mistakesActual: null, responseTimeActual: null,
    };
    const r = svc.computeScores(sparse);
    expect(r.netPoints).toBe(30);               // Net is still computed (not swallowed)…
    expect(r.scoredKpiCount).toBe(1);
    expect(r.applicableKpiCount).toBe(9);
    expect(r.coverage).toBeCloseTo(1 / 9, 4);
    expect(r.coverageMet).toBe(false);          // …but explicitly flagged as untrustworthy
    expect(r.status).toBe('insufficient-coverage');
  });

  it('coverage denominator is per-function: a not-applicable KPI is excluded from the quorum, not counted as missing', () => {
    // Refund: AHT + Response Time are info-band (not applicable) in the seed.
    const refund: ScorecardActualInputs = {
      functionName: 'Refund', qualityActual: 0.9, prrRate: 0.9, responseRate: 0.12,
      ahtActual: 100 / 86400, fcrActual: 0.9, productivityActual: 0.92,
      ctrActual: 0.96, quizActual: 0.96, mistakesActual: 0, responseTimeActual: 60 / 86400,
    };
    const r = svc.computeScores(refund);
    // AHT + RT excluded → 7 applicable, all fed → full coverage despite AHT/RT being present-but-ignored
    expect(r.applicableKpiCount).toBe(7);
    expect(r.coverage).toBe(1);
    expect(r.kpiCoverage.find((k) => k.code === 'AHT')!.applicable).toBe(false);
    expect(r.kpiCoverage.find((k) => k.code === 'RESPONSE_TIME')!.applicable).toBe(false);
    expect(r.points.aht).toBeNull();
    expect(r.points.responseTime).toBeNull();
  });

  it('quorum threshold is configurable via opts', () => {
    // 5 of 9 KPIs present → coverage 0.556
    const sparse: ScorecardActualInputs = {
      functionName: 'CH - WA', qualityActual: 0.96, prrRate: 0.9, responseRate: 0.12,
      ahtActual: 555 / 86400, fcrActual: 0.86, productivityActual: 0.92,
      ctrActual: null, quizActual: null, mistakesActual: null, responseTimeActual: null,
    };
    expect(svc.computeScores(sparse).scoredKpiCount).toBe(5);
    expect(svc.computeScores(sparse).status).toBe('scored');                       // 0.556 ≥ default 0.5
    expect(svc.computeScores(sparse, { coverageQuorum: 0.9 }).status).toBe('insufficient-coverage'); // 0.556 < 0.9
  });
});

describe('GUARD #2 — null sentinel: a missing raw is excluded (null), never a 0 that scores −10/−15', () => {
  it('missing FCR/AHT/RT/CTR/Productivity map to null cells, not their negative band defaults', () => {
    const r = svc.computeScores({
      functionName: 'Mail & NPS', qualityActual: 0.9, prrRate: null, responseRate: null,
      ahtActual: null, fcrActual: null, productivityActual: null, ctrActual: null,
      quizActual: null, mistakesActual: null, responseTimeActual: null,
    });
    expect(r.points.fcr).toBeNull();          // NOT −10 (the FCR <75 default)
    expect(r.points.aht).toBeNull();          // NOT −10
    expect(r.points.responseTime).toBeNull(); // NOT −15 (the RT >4h default)
    expect(r.points.ctr).toBeNull();          // NOT −10
    expect(r.points.productivity).toBeNull(); // NOT −15
    // only QUALITY (0.9 → 20) contributes; nothing was zero-filled into a negative
    expect(r.netPoints).toBe(20);
  });
});

describe('GUARD #4 — bar substitution for a whole-source-missing month/week', () => {
  it('sourceMissing.quality substitutes the QA bar (30), not null/0', () => {
    const noQa: ScorecardActualInputs = { ...fullChWa, qualityActual: null };
    expect(svc.computeScores(noQa).points.quality).toBeNull();                          // per-row blank → null
    expect(svc.computeScores(noQa, { sourceMissing: { quality: true } }).points.quality).toBe(30); // whole month gone → bar
  });

  it('sourceMissing.quiz substitutes the quiz bar (10), not null/0', () => {
    const noQuiz: ScorecardActualInputs = { ...fullChWa, quizActual: null };
    expect(svc.computeScores(noQuiz).points.quiz).toBeNull();
    expect(svc.computeScores(noQuiz, { sourceMissing: { quiz: true } }).points.quiz).toBe(10);
  });

  it('bar substitution does NOT resurrect a not-applicable KPI (QA still null for a truly-excluded function with no data)', () => {
    const r = svc.computeScores(
      { ...fullChWa, functionName: 'Team Leader', qualityActual: null },
      { sourceMissing: { quality: true } },
    );
    expect(r.points.quality).toBeNull(); // Team Leader has no QA at all → bar-sub must not invent one
  });
});

describe('GUARD #6 — engine-recompute provenance + per-batch match rate', () => {
  it('every computeScores result is flagged authoritative:false', () => {
    const r = svc.computeScores(fullChWa);
    expect(r.authoritative).toBe(false);
    expect(r.engine).toMatch(/not authoritative/i);
  });

  it('matchRateSummary reproduces the comparator exact-Net concept', () => {
    const s = svc.matchRateSummary([
      { workbookNet: 125, engineNet: 125 },
      { workbookNet: 100, engineNet: 100 },
      { workbookNet: 90, engineNet: 85 },
    ]);
    expect(s.totalRows).toBe(3);
    expect(s.netMatching).toBe(2);
    expect(s.netMismatched).toBe(1);
    expect(s.matchRatePct).toBeCloseTo(66.7, 1);
    expect(s.authoritative).toBe(false);
  });
});

/* ── GUARD #3 — unit adapter (feed units → band units) with band-edge tests ── */
describe('GUARD #3 — unit adapter converts feed units to band units before scoring', () => {
  it('percentToFraction / secondsToDayFraction are null-preserving and exact', () => {
    expect(percentToFraction(96)).toBeCloseTo(0.96, 10);
    expect(percentToFraction(null)).toBeNull();
    expect(percentToFraction(NaN)).toBeNull();
    expect(secondsToDayFraction(86400)).toBe(1);
    expect(secondsToDayFraction(540)).toBeCloseTo(540 / 86400, 12);
    expect(secondsToDayFraction(null)).toBeNull();
  });

  const chWaFeed = (over: Partial<ScorecardFeedInputs> = {}): ScorecardFeedInputs => ({
    functionName: 'CH - WA',
    qualityPercent: 96, prrPercent: 90, responseRatePercent: 12,
    ahtSeconds: 555, fcrPercent: 86, productivityPercent: 92,
    ctrPercent: 96, quizPercent: 96, mistakesCount: 0, responseTimeSeconds: 30,
    ...over,
  });

  it('a percent+seconds feed scores identically to the canonical fraction+dayfraction inputs', () => {
    const viaFeed = svc.computeScores(feedToActualInputs(chWaFeed()));
    expect(viaFeed.netPoints).toBe(125);          // = the canonical CH-WA fixture Net
    expect(viaFeed.points.quality).toBe(30);
    expect(viaFeed.points.aht).toBe(10);          // 555s = 9:15 chat band
    expect(viaFeed.points.responseTime).toBe(10); // 30s chat RT band
  });

  it('AHT band edges land correctly through the seconds→day-fraction conversion (CH-WA 9:00/9:30/10:00)', () => {
    const aht = (sec: number) => svc.computeScores(feedToActualInputs(chWaFeed({ ahtSeconds: sec }))).points.aht;
    expect(aht(540)).toBe(15);  // exactly 9:00
    expect(aht(555)).toBe(10);  // 9:15
    expect(aht(590)).toBe(5);   // 9:50
    expect(aht(600)).toBe(0);   // exactly 10:00 → sheet blank ⇒ 0
    expect(aht(601)).toBe(-5);  // > 10:00
  });

  it('QUALITY percent band edges land correctly through percent→fraction (95/90/80)', () => {
    const qa = (pct: number) => svc.computeScores(feedToActualInputs(chWaFeed({ qualityPercent: pct }))).points.quality;
    expect(qa(95)).toBe(30);
    expect(qa(90)).toBe(20);
    expect(qa(80)).toBe(10);
    expect(qa(64)).toBe(-20);
  });

  it('email-shaped 48h AHT edge lands correctly from seconds (48h=172800s → 10, 49h → −10)', () => {
    const mailFeed = (sec: number): ScorecardFeedInputs => ({
      functionName: 'Mail & NPS', qualityPercent: 91, prrPercent: null, responseRatePercent: null,
      ahtSeconds: sec, fcrPercent: 80, productivityPercent: 90, ctrPercent: 92,
      quizPercent: 95, mistakesCount: 1, responseTimeSeconds: 5400, // 1.5h → 10
    });
    expect(svc.computeScores(feedToActualInputs(mailFeed(48 * 3600))).points.aht).toBe(10);
    expect(svc.computeScores(feedToActualInputs(mailFeed(49 * 3600))).points.aht).toBe(-10);
  });

  it('feedUnitWarnings catches unit mismatches (fraction-in-percent, out-of-range, negative)', () => {
    expect(feedUnitWarnings(chWaFeed())).toEqual([]);                                   // clean feed → no warnings
    expect(feedUnitWarnings(chWaFeed({ qualityPercent: 0.96 }))[0]).toMatch(/fraction/i); // 0.96 passed as percent
    expect(feedUnitWarnings(chWaFeed({ fcrPercent: 860 }))[0]).toMatch(/outside 0–100/);  // 0.86 → 86, but 860 is wrong
    expect(feedUnitWarnings(chWaFeed({ ahtSeconds: -5 }))[0]).toMatch(/negative/);
  });
});
