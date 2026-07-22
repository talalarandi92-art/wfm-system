/**
 * Wave B7 — comparator: workbook-awarded points vs our-engine points, per
 * month × function × employee × week × KPI cell, with honest variance
 * classification:
 *
 *   match            — identical points
 *   rounding         — our round-half-up integer-% step vs the sheet's raw-fraction compare
 *   boundary         — raw value sits exactly on a band edge
 *   formula-mismatch — our committed band awards different points for the same raw value
 *                      (includes the KNOWN simplified AHT/RT bands and the sheet's
 *                      wrong-row formula bug, each noted)
 *   data             — raw value unreadable/missing while the sheet still carries points
 *   manual-override  — the workbook cell's cached value disagrees with its OWN formula,
 *                      or the score cell is a hand-typed constant (no formula)
 *   not-applicable   — our committed rulebook scores this KPI as N/A for this FUNCTION
 *                      (info band / not evaluated) while the sheet awarded points —
 *                      a scope difference, not a wrong number
 */
import { KpiBand, SEED_KPIS } from '../kpi-registry/kpi-seed';
import { roundHalfUpPct } from '../kpi-registry/score-band';
import { evalExcelFormula, formulaReferencesOtherRow, ExcelValue } from './excel-formula-eval';
import { ScRow, ScWorkbook, ScoreKpi, SCORE_CELLS } from './sc-workbook-reader';
import { rescoreRow, bandFor } from './re-scorer';

export type VarianceClass = 'match' | 'rounding' | 'boundary' | 'formula-mismatch' | 'data' | 'manual-override' | 'not-applicable';

export interface CellVariance {
  month: string;
  functionName: string;
  agent: string;
  employeeId: string;
  week: string;
  rowNum: number;
  kpi: ScoreKpi;
  raw: number | string | null;
  wbPoints: number | null;
  ourPoints: number | null;
  sheetFormulaPoints: number | null;
  class: VarianceClass;
  note: string;
}

export interface RowComparison {
  row: ScRow;
  ourNet: number;
  wbNet: number | null;
  netDiff: number | null;
  cellVariances: CellVariance[]; // one entry per score cell (including matches)
}

const EPS = 1e-6;
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

/** Normalize a workbook score-cell cached value to points ("" → null, "0" → 0). */
export function toPoints(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return isNaN(n) ? null : n;
}

const bandByKpiCode = new Map(SEED_KPIS.map((k) => [k.code, k.band]));

/** Score a threshold_pct band WITHOUT the round-half-up step (raw fraction × 100, strict). */
function scoreThresholdPctUnrounded(band: KpiBand, value: number): number | null {
  const p = value * 100;
  for (const b of band.bands ?? []) {
    if (b.eq !== undefined && eq(p, b.eq)) return b.points;
    if (b.gt !== undefined && p > b.gt + EPS) return b.points;
    if (b.gte !== undefined && (p >= b.gte || eq(p, b.gte))) return b.points;
    if (b.lte !== undefined && (p <= b.lte || eq(p, b.lte))) return b.points;
  }
  return band.default ?? null;
}

/** Is the rounded percentage exactly on one of OUR band edges? */
function onBandBoundary(band: KpiBand | null | undefined, value: number): boolean {
  if (!band || (band.type !== 'threshold_pct' && band.type !== 'threshold_hours')) return false;
  const v = band.type === 'threshold_pct' ? roundHalfUpPct(value) : (band.transform === 'dayfrac_to_hours' ? value * 24 : value);
  return (band.bands ?? []).some((b) =>
    (b.gte !== undefined && eq(v, b.gte)) ||
    (b.gt !== undefined && eq(v, b.gt)) ||
    (b.lte !== undefined && eq(v, b.lte)) ||
    (b.eq !== undefined && eq(v, b.eq)),
  );
}

const CELL_TO_KPI_CODE: Record<ScoreKpi, string> = {
  QUALITY: 'QUALITY', PRR_POINTS: 'PRR', PRR_BONUS: 'PRR', AHT: 'AHT', FCR: 'FCR',
  PRODUCTIVITY: 'PRODUCTIVITY', CTR: 'CTR', QUIZ: 'QUIZ', COMMON_MISTAKES: 'COMMON_MISTAKES', RESPONSE_TIME: 'RESPONSE_TIME',
};

/** KPIs whose committed band is a KNOWN, Director-approved simplification vs the sheet's per-function bands. */
const KNOWN_SIMPLIFIED = new Set<ScoreKpi>(['AHT', 'RESPONSE_TIME']);

export function classifyCell(args: {
  kpi: ScoreKpi;
  raw: number | string | null;
  wbPoints: number | null;
  ourPoints: number | null;
  sheetFormulaPoints: number | null;
  hasFormula: boolean;
  rowRefBug: boolean;
  /** The row's function — the band MUST be resolved the same way the scorer did. */
  functionName?: string;
  /** The workbook's month — period-scoped bands (D-081) resolve differently per month. */
  periodDate?: string | null;
}): { cls: VarianceClass; note: string } {
  const { kpi, raw, wbPoints, ourPoints, sheetFormulaPoints, hasFormula, rowRefBug, functionName, periodDate } = args;
  const wb = wbPoints ?? 0;
  const ours = ourPoints ?? 0;

  if (wbPoints === null && ourPoints === null) return { cls: 'match', note: 'not scored on either side' };
  if (eq(wb, ours)) return { cls: 'match', note: '' };

  if (typeof raw !== 'number') {
    return { cls: 'data', note: `raw value ${raw === null || raw === '' ? 'missing' : `unreadable ("${raw}")`} but sheet awards ${wb}` };
  }

  // The sheet's own formula disagrees with its cached value → someone typed over it.
  if (hasFormula && sheetFormulaPoints !== null && !eq(wb, sheetFormulaPoints)) {
    return { cls: 'manual-override', note: `sheet formula yields ${sheetFormulaPoints} but cell shows ${wb} (Director manual entry)` };
  }
  if (!hasFormula) {
    return { cls: 'manual-override', note: `score cell is a hand-typed constant (${wb}), no formula` };
  }

  if (rowRefBug) {
    return { cls: 'formula-mismatch', note: 'SHEET BUG: score formula references a different row (e.g. Social Media RT block reading row 34)' };
  }

  /* Our engine returning NULL means "the committed rulebook says this KPI does not
     apply to this function" (info band / not-evaluated) — NOT "we scored zero".
     Folding it into rounding/formula-mismatch hid 130 cells behind the wrong
     cause; they are a rulebook-vs-sheet SCOPE difference and need their own class. */
  if (ourPoints === null && wbPoints !== null) {
    return {
      cls: 'not-applicable',
      note: `our rulebook marks ${kpi} as not applicable for ${functionName ?? 'this function'} (no band / not evaluated) but the sheet awards ${wb}`,
    };
  }

  const band = functionName
    ? bandFor(CELL_TO_KPI_CODE[kpi], functionName, periodDate)
    : bandByKpiCode.get(CELL_TO_KPI_CODE[kpi]) ?? null;
  if (band && band.type === 'threshold_pct') {
    const unrounded = scoreThresholdPctUnrounded(band, raw);
    if (unrounded !== null && eq(unrounded, wb)) {
      return { cls: 'rounding', note: `our round-half-up (${roundHalfUpPct(raw)}%) vs sheet raw-fraction compare (${(raw * 100).toFixed(2)}%)` };
    }
  }
  if (onBandBoundary(band, raw)) {
    return { cls: 'boundary', note: `raw value exactly on a band edge (${band?.type === 'threshold_pct' ? roundHalfUpPct(raw) + '%' : raw})` };
  }

  const simplified = KNOWN_SIMPLIFIED.has(kpi)
    ? ' [KNOWN: committed seed uses the simplified 48h-AHT / email-RT band, not the sheet\'s per-function band]'
    : '';
  return { cls: 'formula-mismatch', note: `same raw value, our band → ${ours}, sheet → ${wb}${simplified}` };
}

export function compareWorkbook(wb: ScWorkbook): RowComparison[] {
  const out: RowComparison[] = [];
  for (const row of wb.rows) {
    const { ourPoints, ourNet } = rescoreRow(row, wb.periodDate);
    const cellVariances: CellVariance[] = [];

    for (const sc of SCORE_CELLS) {
      const cell = row.cells[sc.kpi];
      const wbPts = toPoints(cell.wbPoints);

      let sheetFormulaPoints: number | null = null;
      let rowRefBug = false;
      if (cell.formula) {
        rowRefBug = formulaReferencesOtherRow(cell.formula, row.rowNum);
        const v: ExcelValue = evalExcelFormula(cell.formula, (col, r) => wb.cellValue(col, r));
        sheetFormulaPoints = typeof v === 'number' ? v : (typeof v === 'string' ? toPoints(v) : null);
      }

      const { cls, note } = classifyCell({
        kpi: sc.kpi,
        raw: cell.raw,
        wbPoints: wbPts,
        ourPoints: ourPoints[sc.kpi],
        sheetFormulaPoints,
        hasFormula: cell.formula !== null,
        rowRefBug,
        functionName: row.functionName,
        periodDate: wb.periodDate,
      });

      cellVariances.push({
        month: wb.monthLabel,
        functionName: row.functionName,
        agent: row.agent,
        employeeId: row.employeeId,
        week: row.week,
        rowNum: row.rowNum,
        kpi: sc.kpi,
        raw: cell.raw,
        wbPoints: wbPts,
        ourPoints: ourPoints[sc.kpi],
        sheetFormulaPoints,
        class: cls,
        note,
      });
    }

    out.push({
      row,
      ourNet,
      wbNet: row.wbNet,
      netDiff: row.wbNet === null ? null : ourNet - row.wbNet,
      cellVariances,
    });
  }
  return out;
}

/** Dense ranking (1,2,2,3) by descending net within a list. */
export function denseRank(values: number[]): number[] {
  const sorted = [...new Set(values)].sort((a, b) => b - a);
  const rankOf = new Map(sorted.map((v, i) => [v, i + 1]));
  return values.map((v) => rankOf.get(v)!);
}
