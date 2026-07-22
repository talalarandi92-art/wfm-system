/**
 * Wave B7 — historical validation runner: parse each SC workbook, re-score
 * every row through the committed kpi-registry engine, compare, classify,
 * and emit the Historical_Validation_Report.xlsx + console summary.
 *
 * The gate verdict is DESCRIPTIVE only — activation of auto-scoring is the
 * Director's call (spec §18).
 */
import * as XLSX from 'xlsx';
import { readScWorkbook } from './sc-workbook-reader';
import { compareWorkbook, denseRank, CellVariance, RowComparison, VarianceClass } from './comparator';

export const NET_GATE_PCT = 98; // suggested threshold, descriptive only

export interface MonthSummary {
  month: string;
  sheetName: string;
  rowsCompared: number;
  finalRowsCompared: number;
  employees: number;
  cellsCompared: number;
  cellExactMatchPct: number;
  netExactMatches: number;
  netExactMatchPct: number; // Final rows
  avgAbsNetDiff: number; // Final rows
  netExactMatchPctExclKnown: number; // Final rows, excluding AHT+RT cells from both nets
  /** Final rows containing NO hand-typed score cell — the only rows any engine can reproduce. */
  formulaDerivableRows: number;
  /** THE honest accuracy number: net exact-match over formula-derivable rows only. */
  netExactMatchPctFormulaOnly: number;
  /** Final rows carrying at least one cell the sheet itself contradicts (hand-typed). */
  manualOverrideRows: number;
  varianceCounts: Record<VarianceClass, number>;
  rankExactMatchPct: number; // Final rows, dense rank within function by Net
  skipped: string[];
}

export interface ValidationResult {
  months: MonthSummary[];
  diffs: CellVariance[]; // only non-match cells
  netRows: Array<{
    month: string; functionName: string; agent: string; employeeId: string; week: string;
    wbNet: number | null; ourNet: number; netDiff: number | null;
    ourNetExclKnown: number; wbNetExclKnown: number | null;
    wbRank: number | null; ourRank: number | null;
  }>;
  overall: {
    finalRows: number; netExactMatchPct: number; avgAbsNetDiff: number; netExactMatchPctExclKnown: number;
    formulaDerivableRows: number; netExactMatchPctFormulaOnly: number; manualOverrideRows: number;
    /** The gate is judged on the formula-derivable subset — scoring an engine against
     *  hand-typed cells measures the typist, not the engine. */
    gateMet: boolean;
  };
}

const KNOWN_KPIS = new Set(['AHT', 'RESPONSE_TIME']);

function netExclKnown(rc: RowComparison, side: 'wb' | 'ours'): number {
  return rc.cellVariances.reduce((s, cv) => {
    if (KNOWN_KPIS.has(cv.kpi)) return s;
    return s + ((side === 'wb' ? cv.wbPoints : cv.ourPoints) ?? 0);
  }, 0);
}

export function runValidation(files: string[]): ValidationResult {
  const months: MonthSummary[] = [];
  const diffs: CellVariance[] = [];
  const netRows: ValidationResult['netRows'] = [];
  let totFinal = 0, totNetExact = 0, totAbsDiff = 0, totNetExactExcl = 0;
  let totFormula = 0, totFormulaExact = 0, totManualRows = 0;

  for (const file of files) {
    const wb = readScWorkbook(file);
    const comps = compareWorkbook(wb);
    const finals = comps.filter((c) => /final/i.test(c.row.week));

    // rank comparison per function on Final rows
    const rankMatch = new Map<string, boolean>(); // key rowNum
    const byFn = new Map<string, RowComparison[]>();
    for (const f of finals) {
      const k = f.row.functionName;
      byFn.set(k, [...(byFn.get(k) ?? []), f]);
    }
    for (const [, list] of byFn) {
      const withNet = list.filter((l) => l.wbNet !== null);
      const wbRanks = denseRank(withNet.map((l) => l.wbNet as number));
      const ourRanks = denseRank(withNet.map((l) => l.ourNet));
      withNet.forEach((l, i) => {
        rankMatch.set(`${l.row.rowNum}`, wbRanks[i] === ourRanks[i]);
        (l as RowComparison & { _wbRank?: number; _ourRank?: number })._wbRank = wbRanks[i];
        (l as RowComparison & { _wbRank?: number; _ourRank?: number })._ourRank = ourRanks[i];
      });
    }

    const varianceCounts: Record<VarianceClass, number> = { match: 0, rounding: 0, boundary: 0, 'formula-mismatch': 0, data: 0, 'manual-override': 0, 'not-applicable': 0 };
    let cells = 0;
    for (const c of comps) {
      for (const cv of c.cellVariances) {
        cells++;
        varianceCounts[cv.class]++;
        if (cv.class !== 'match') diffs.push(cv);
      }
      const ex = c as RowComparison & { _wbRank?: number; _ourRank?: number };
      netRows.push({
        month: wb.monthLabel,
        functionName: c.row.functionName,
        agent: c.row.agent,
        employeeId: c.row.employeeId,
        week: c.row.week,
        wbNet: c.wbNet,
        ourNet: c.ourNet,
        netDiff: c.netDiff,
        ourNetExclKnown: netExclKnown(c, 'ours'),
        wbNetExclKnown: c.wbNet === null ? null : netExclKnown(c, 'wb'),
        wbRank: ex._wbRank ?? null,
        ourRank: ex._ourRank ?? null,
      });
    }

    const finalsWithNet = finals.filter((f) => f.wbNet !== null);
    /* A row whose score cell was hand-typed (the sheet's own formula disagrees with the
       displayed value) cannot be reproduced by ANY engine — including a perfect one.
       Measuring accuracy against those rows measures the typist. Split them out. */
    const hasManual = (f: RowComparison) => f.cellVariances.some((v) => v.class === 'manual-override');
    const formulaRows = finalsWithNet.filter((f) => !hasManual(f));
    const formulaExact = formulaRows.filter((f) => Math.abs(f.netDiff as number) < 1e-6).length;
    const netExact = finalsWithNet.filter((f) => Math.abs(f.netDiff as number) < 1e-6).length;
    const netExactExcl = finalsWithNet.filter((f) => Math.abs(netExclKnown(f, 'ours') - netExclKnown(f, 'wb')) < 1e-6).length;
    const absSum = finalsWithNet.reduce((s, f) => s + Math.abs(f.netDiff as number), 0);
    const ranksChecked = finalsWithNet.filter((f) => rankMatch.has(`${f.row.rowNum}`));
    const rankOk = ranksChecked.filter((f) => rankMatch.get(`${f.row.rowNum}`)).length;

    months.push({
      month: wb.monthLabel,
      sheetName: wb.sheetName,
      rowsCompared: comps.length,
      finalRowsCompared: finalsWithNet.length,
      employees: new Set(comps.map((c) => c.row.employeeId)).size,
      cellsCompared: cells,
      cellExactMatchPct: cells ? +(100 * varianceCounts.match / cells).toFixed(2) : 0,
      netExactMatches: netExact,
      netExactMatchPct: finalsWithNet.length ? +(100 * netExact / finalsWithNet.length).toFixed(2) : 0,
      avgAbsNetDiff: finalsWithNet.length ? +(absSum / finalsWithNet.length).toFixed(2) : 0,
      netExactMatchPctExclKnown: finalsWithNet.length ? +(100 * netExactExcl / finalsWithNet.length).toFixed(2) : 0,
      formulaDerivableRows: formulaRows.length,
      netExactMatchPctFormulaOnly: formulaRows.length ? +(100 * formulaExact / formulaRows.length).toFixed(2) : 0,
      manualOverrideRows: finalsWithNet.length - formulaRows.length,
      varianceCounts,
      rankExactMatchPct: ranksChecked.length ? +(100 * rankOk / ranksChecked.length).toFixed(2) : 0,
      skipped: wb.skipped,
    });

    totFinal += finalsWithNet.length;
    totFormula += formulaRows.length;
    totFormulaExact += formulaExact;
    totManualRows += finalsWithNet.length - formulaRows.length;
    totNetExact += netExact;
    totNetExactExcl += netExactExcl;
    totAbsDiff += absSum;
  }

  const overallPct = totFinal ? +(100 * totNetExact / totFinal).toFixed(2) : 0;
  const formulaPct = totFormula ? +(100 * totFormulaExact / totFormula).toFixed(2) : 0;
  return {
    months,
    diffs,
    netRows,
    overall: {
      finalRows: totFinal,
      netExactMatchPct: overallPct,
      avgAbsNetDiff: totFinal ? +(totAbsDiff / totFinal).toFixed(2) : 0,
      netExactMatchPctExclKnown: totFinal ? +(100 * totNetExactExcl / totFinal).toFixed(2) : 0,
      formulaDerivableRows: totFormula,
      netExactMatchPctFormulaOnly: formulaPct,
      manualOverrideRows: totManualRows,
      gateMet: formulaPct >= NET_GATE_PCT,
    },
  };
}

export function writeReport(result: ValidationResult, outPath: string): void {
  const wb = XLSX.utils.book_new();

  const summaryRows = result.months.map((m) => ({
    Month: m.month,
    Sheet: m.sheetName,
    Employees: m.employees,
    'Rows (weeks+final)': m.rowsCompared,
    'Final rows': m.finalRowsCompared,
    'Cells compared': m.cellsCompared,
    'Cell exact-match %': m.cellExactMatchPct,
    'Net exact-match % (Final)': m.netExactMatchPct,
    'Avg |Net diff| (Final)': m.avgAbsNetDiff,
    'Net exact-match % excl AHT/RT': m.netExactMatchPctExclKnown,
    'Formula-derivable rows': m.formulaDerivableRows,
    'Net exact-match % (formula-derivable ONLY)': m.netExactMatchPctFormulaOnly,
    'Rows w/ a hand-typed cell': m.manualOverrideRows,
    'Rank exact-match %': m.rankExactMatchPct,
    Match: m.varianceCounts.match,
    Rounding: m.varianceCounts.rounding,
    Boundary: m.varianceCounts.boundary,
    'Formula-mismatch': m.varianceCounts['formula-mismatch'],
    Data: m.varianceCounts.data,
    'Manual-override': m.varianceCounts['manual-override'],
    'Not-applicable': m.varianceCounts['not-applicable'],
    Skipped: m.skipped.join('; '),
  }));
  summaryRows.push({
    Month: 'OVERALL',
    Sheet: '',
    Employees: 0,
    'Rows (weeks+final)': 0,
    'Final rows': result.overall.finalRows,
    'Cells compared': 0,
    'Cell exact-match %': 0,
    'Net exact-match % (Final)': result.overall.netExactMatchPct,
    'Avg |Net diff| (Final)': result.overall.avgAbsNetDiff,
    'Net exact-match % excl AHT/RT': result.overall.netExactMatchPctExclKnown,
    'Formula-derivable rows': result.overall.formulaDerivableRows,
    'Net exact-match % (formula-derivable ONLY)': result.overall.netExactMatchPctFormulaOnly,
    'Rows w/ a hand-typed cell': result.overall.manualOverrideRows,
    'Rank exact-match %': 0,
    Match: 0, Rounding: 0, Boundary: 0, 'Formula-mismatch': 0, Data: 0, 'Manual-override': 0, 'Not-applicable': 0,
    Skipped: `Gate (>=${NET_GATE_PCT}% net exact on FORMULA-DERIVABLE rows): ${result.overall.gateMet ? 'MET' : 'NOT MET'} — descriptive only, activation is the Director's call`,
  } as (typeof summaryRows)[number]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  for (const m of result.months) {
    const monthDiffs = result.diffs.filter((d) => d.month === m.month).map((d) => ({
      Function: d.functionName, Agent: d.agent, ID: d.employeeId, Week: d.week, Row: d.rowNum,
      KPI: d.kpi, Raw: d.raw, 'WB pts': d.wbPoints, 'Our pts': d.ourPoints,
      'Sheet-formula pts': d.sheetFormulaPoints, Class: d.class, Note: d.note,
    }));
    const netDiffRows = result.netRows
      .filter((n) => n.month === m.month && n.netDiff !== null && Math.abs(n.netDiff) > 1e-6)
      .map((n) => ({
        Function: n.functionName, Agent: n.agent, ID: n.employeeId, Week: n.week,
        'WB Net': n.wbNet, 'Our Net': n.ourNet, 'Net diff': n.netDiff,
        'WB Net excl AHT/RT': n.wbNetExclKnown, 'Our Net excl AHT/RT': n.ourNetExclKnown,
        'WB rank': n.wbRank, 'Our rank': n.ourRank,
      }));
    const sheetBase = m.month.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 22);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthDiffs.length ? monthDiffs : [{ Note: 'no KPI-cell differences' }]), `${sheetBase} KPI diffs`.slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(netDiffRows.length ? netDiffRows : [{ Note: 'no Net differences' }]), `${sheetBase} Net diffs`.slice(0, 31));
  }

  XLSX.writeFile(wb, outPath);
}
