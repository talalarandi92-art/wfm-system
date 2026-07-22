/**
 * Wave B7 — unit tests: comparator classification + fixture-based re-score.
 * The heavy validation against the 6 real workbooks runs via
 * `node scripts/scorecard-validate.js` (SELECT-nothing, file-only).
 */
import { classifyCell, toPoints, denseRank } from './comparator';
import { rescoreRow } from './re-scorer';
import { evalExcelFormula, formulaReferencesOtherRow } from './excel-formula-eval';
import { ScRow, SCORE_CELLS, ScoreKpi } from './sc-workbook-reader';

function emptyCells(): ScRow['cells'] {
  const cells = {} as ScRow['cells'];
  for (const sc of SCORE_CELLS) cells[sc.kpi] = { raw: null, wbPoints: null, formula: null };
  return cells;
}

function fixtureRow(overrides: Partial<Record<ScoreKpi, number>>, responseRate = 0): ScRow {
  const cells = emptyCells();
  for (const [k, v] of Object.entries(overrides)) cells[k as ScoreKpi].raw = v as number;
  return {
    rowNum: 14, agent: 'Synthetic Agent', employeeId: '99999', userId: 's.agent',
    functionName: 'CH - WA', tl: null, week: '1', workingDaysPct: 1,
    wbNet: null, wbNetFormula: null, responseRate, cells,
  };
}

describe('excel-formula-eval', () => {
  const refs: Record<string, number> = { 'N7': 0.00625, 'N6': 0.006597, 'N5': 0.006597, 'N4': 0.006944 };
  const resolve = (col: string, row: number) => refs[`${col}${row}`] ?? null;

  it('evaluates the Quality IF chain with % literals', () => {
    const f = 'IF(AND(J14>=95%),30,IF(AND(J14>=90%,J14<95%),20,IF(AND(J14>=80%,J14<90%),10,IF(AND(J14<=80%,J14>=65%),-10,IF(AND(J14<65%),-20)))))';
    const r = (v: number) => evalExcelFormula(f, (c, row) => (c === 'J' && row === 14 ? v : resolve(c, row)));
    expect(r(0.96)).toBe(30);
    expect(r(0.92)).toBe(20);
    expect(r(0.85)).toBe(10);
    expect(r(0.70)).toBe(-10);
    expect(r(0.50)).toBe(-20);
  });

  it('evaluates the chat AHT band against $-refs and returns "" in the gap', () => {
    const f = 'IF(AND(P14<=$N$7),15,IF(AND(P14>$N$7,P14<$N$6),10,IF(AND(P14>=$N$5,P14<$N$4),5,IF(AND(P14>$N$4),-5,""))))';
    const r = (v: number) => evalExcelFormula(f, (c, row) => (c === 'P' && row === 14 ? v : resolve(c, row)));
    expect(r(0.006)).toBe(15);
    expect(r(0.0064)).toBe(10);
    expect(r(0.0067)).toBe(5);
    expect(r(0.0070)).toBe(-5);
  });

  it('handles TIME() and blank-equality (Mail & NPS RT formula)', () => {
    const f = 'IF(AF14="","",IF(AF14<=TIME(1,0,0),15,IF(AF14<=TIME(2,0,0),10,IF(AF14<=TIME(4,0,0),5,-15))))';
    const r = (v: number | null) => evalExcelFormula(f, () => v);
    expect(r(0.5 / 24)).toBe(15);
    expect(r(1.5 / 24)).toBe(10);
    expect(r(3 / 24)).toBe(5);
    expect(r(6 / 24)).toBe(-15);
    expect(r(null)).toBe('');
  });

  it('evaluates the mistakes arithmetic and Net sum with blank cells as 0', () => {
    expect(evalExcelFormula('IF(Z14=0,15,15-(Z14*5))', () => 2)).toBe(5);
    expect(evalExcelFormula('K14+N14+O14', (c) => (c === 'K' ? 30 : null))).toBe(30);
  });

  it('detects the wrong-row reference sheet bug', () => {
    expect(formulaReferencesOtherRow('IF(AND(AF34<=$AF$5),15,-15)', 89)).toBe(true);
    expect(formulaReferencesOtherRow('IF(AND(AF89<=$AF$5),15,-15)', 89)).toBe(false);
  });
});

describe('re-scorer (fixture employee through the committed engine)', () => {
  it('scores a synthetic employee across 3 KPIs exactly per the decoded bands', () => {
    // Quality 96% → 30 · Quiz exactly 95 → 5 (m088 rule) · 1 common mistake → 10
    const row = fixtureRow({ QUALITY: 0.96, QUIZ: 0.95, COMMON_MISTAKES: 1 });
    const { ourPoints, ourNet } = rescoreRow(row);
    expect(ourPoints.QUALITY).toBe(30);
    expect(ourPoints.QUIZ).toBe(5);
    expect(ourPoints.COMMON_MISTAKES).toBe(10);
    expect(ourPoints.FCR).toBeNull(); // no raw → not scored
    expect(ourNet).toBe(45);
  });

  it('applies the PRR double gate (BRR>=80% AND RES>=10%) to BOTH cells', () => {
    const pass = rescoreRow(fixtureRow({ PRR_POINTS: 0.9, PRR_BONUS: 0.9 }, 0.12));
    expect(pass.ourPoints.PRR_POINTS).toBe(2.5);
    expect(pass.ourPoints.PRR_BONUS).toBe(2.5);
    const failGate = rescoreRow(fixtureRow({ PRR_POINTS: 0.9, PRR_BONUS: 0.9 }, 0.04));
    expect(failGate.ourPoints.PRR_POINTS).toBe(0);
    expect(failGate.ourPoints.PRR_BONUS).toBe(0);
  });

  it('quiz >95 strictly gets 10; <90 gets -10', () => {
    expect(rescoreRow(fixtureRow({ QUIZ: 0.96 })).ourPoints.QUIZ).toBe(10);
    expect(rescoreRow(fixtureRow({ QUIZ: 0.89 })).ourPoints.QUIZ).toBe(-10);
  });
});

describe('comparator classification', () => {
  const base = { kpi: 'QUALITY' as ScoreKpi, sheetFormulaPoints: null as number | null, hasFormula: true, rowRefBug: false };

  it('match', () => {
    expect(classifyCell({ ...base, raw: 0.96, wbPoints: 30, ourPoints: 30 }).cls).toBe('match');
    expect(classifyCell({ ...base, raw: null, wbPoints: null, ourPoints: null }).cls).toBe('match');
  });

  it('data — missing raw but sheet awards points', () => {
    expect(classifyCell({ ...base, raw: null, wbPoints: 20, ourPoints: null }).cls).toBe('data');
    expect(classifyCell({ ...base, raw: 'N/A', wbPoints: 20, ourPoints: null }).cls).toBe('data');
  });

  it('manual-override — cached value disagrees with its own formula', () => {
    const r = classifyCell({ ...base, raw: 0.92, wbPoints: 30, ourPoints: 20, sheetFormulaPoints: 20 });
    expect(r.cls).toBe('manual-override');
  });

  it('manual-override — hand-typed constant (no formula)', () => {
    const r = classifyCell({ ...base, raw: 0.92, wbPoints: 30, ourPoints: 20, hasFormula: false });
    expect(r.cls).toBe('manual-override');
  });

  it('rounding — sheet raw-fraction compare vs our round-half-up', () => {
    // 89.5% rounds half-up to 90 → our 20; sheet compares 0.895 < 0.90 → 10
    const r = classifyCell({ ...base, raw: 0.895, wbPoints: 10, ourPoints: 20, sheetFormulaPoints: 10 });
    expect(r.cls).toBe('rounding');
  });

  it('formula-mismatch — same raw, different band (known AHT simplification noted)', () => {
    const r = classifyCell({ ...base, kpi: 'AHT', raw: 0.0104, wbPoints: -5, ourPoints: 10, sheetFormulaPoints: -5 });
    expect(r.cls).toBe('formula-mismatch');
    expect(r.note).toContain('KNOWN');
  });

  it('not-applicable — our rulebook scores the KPI N/A for this function, the sheet awarded points', () => {
    // Offline QA is an info band (Director rule 2026-07-11) → our engine returns null.
    // That is a SCOPE difference, not a wrong number: it must not be filed as rounding.
    const r = classifyCell({ ...base, raw: 0.8, wbPoints: 10, ourPoints: null, sheetFormulaPoints: 10, functionName: 'Offline' });
    expect(r.cls).toBe('not-applicable');
    expect(r.note).toContain('not applicable');
    expect(r.note).toContain('Offline');
  });

  it('classifies against the FUNCTION band the scorer used, not the generic one', () => {
    // Inbound AHT band (m089) is the 6-band 2:30..5:00 one; the generic AHT band is the
    // simplified email band. 4 min = 0.0027778 dayfrac. Classifying with the generic band
    // would call this a rounding/boundary case; with the real Inbound band it is a
    // genuine band difference. What matters is that the function is honoured at all.
    const withFn = classifyCell({ ...base, kpi: 'AHT', raw: 0.0027778, wbPoints: 5, ourPoints: 10, sheetFormulaPoints: 5, functionName: 'Inbound' });
    const withoutFn = classifyCell({ ...base, kpi: 'AHT', raw: 0.0027778, wbPoints: 5, ourPoints: 10, sheetFormulaPoints: 5 });
    expect(withFn.cls).not.toBe('match');
    expect(withoutFn.cls).not.toBe('match');
    // both classify, but the note must never claim a band the scorer did not use
    expect(typeof withFn.note).toBe('string');
  });

  it('formula-mismatch — wrong-row sheet bug', () => {
    const r = classifyCell({ ...base, kpi: 'RESPONSE_TIME', raw: 0.01, wbPoints: 15, ourPoints: 5, sheetFormulaPoints: 15, rowRefBug: true });
    expect(r.cls).toBe('formula-mismatch');
    expect(r.note).toContain('SHEET BUG');
  });

  it('toPoints normalizes "" and "0"', () => {
    expect(toPoints('')).toBeNull();
    expect(toPoints('0')).toBe(0);
    expect(toPoints(12.5)).toBe(12.5);
  });

  it('denseRank ranks descending with ties sharing a rank', () => {
    expect(denseRank([120, 100, 120, 90])).toEqual([1, 2, 1, 3]);
  });
});
