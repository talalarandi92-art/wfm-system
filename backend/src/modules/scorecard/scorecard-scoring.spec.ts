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

  it('QUALITY not applicable for excluded functions (Support/Offline/Team Leader/Customer Care/إداري)', () => {
    for (const fn of ['Support', 'Offline', 'Team Leader', 'Customer Care', 'إداري']) {
      const p = svc.computeScores({ ...chWa, functionName: fn }).points;
      expect(p.quality).toBeNull(); // even a perfect 96% QA scores null — no QA evaluation
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
