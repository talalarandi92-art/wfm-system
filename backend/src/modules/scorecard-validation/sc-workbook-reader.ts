/**
 * Wave B7 — reader for the Director's real monthly SC workbooks
 * (`new folder/Scorecard 2026/1.Jan..6.June 26 SC..xlsx`).
 *
 * Layout (verified against all 6 workbooks, 2026-07-11):
 *  - The scored table lives on the first sheet whose name contains "SC"
 *    (e.g. "Jan 26 SC", "June SC 26"). Header row = 13.
 *  - One flat table; col E = Function; col I = week label (1..4 / "Final");
 *    each employee has 5 stacked rows (4 weeks + Final).
 *  - Columns: B Agent | C ID | D User ID | E Function | F TL | G WD% |
 *    H Net Points | I Weeks | J Quality | K QualityScore | L ResponseRate |
 *    M PRRrate | N PRRPoints | O PRRBonus | P AHT | Q AHTScore | R FCR |
 *    S FCRScore | T Product. | U ProdScore | V CTR | W CTRScore | X Quiz |
 *    Y QuizScore | Z Mistakes | AA MistakesScore | AB Incidents |
 *    AC IncidentsScore | AD Attendance | AE AttendanceScore | AF RT | AG RTScore.
 *  - Threshold reference cells (the editable "bars") live in rows 2..9,
 *    cols N/O/P/Q/R/S/T/AF.
 *
 * HONESTY RULE: cells that cannot be confidently read are surfaced in
 * `skipped`, never guessed.
 */
import * as XLSX from 'xlsx';
import * as path from 'path';

/** Score-cell descriptors: KPI code → { raw col, score col } */
export const SCORE_CELLS = [
  { kpi: 'QUALITY', rawCol: 'J', scoreCol: 'K' },
  { kpi: 'PRR_POINTS', rawCol: 'M', scoreCol: 'N' },
  { kpi: 'PRR_BONUS', rawCol: 'M', scoreCol: 'O' },
  { kpi: 'AHT', rawCol: 'P', scoreCol: 'Q' },
  { kpi: 'FCR', rawCol: 'R', scoreCol: 'S' },
  { kpi: 'PRODUCTIVITY', rawCol: 'T', scoreCol: 'U' },
  { kpi: 'CTR', rawCol: 'V', scoreCol: 'W' },
  { kpi: 'QUIZ', rawCol: 'X', scoreCol: 'Y' },
  { kpi: 'COMMON_MISTAKES', rawCol: 'Z', scoreCol: 'AA' },
  { kpi: 'RESPONSE_TIME', rawCol: 'AF', scoreCol: 'AG' },
] as const;

export type ScoreKpi = (typeof SCORE_CELLS)[number]['kpi'];

export interface ScCell {
  raw: number | string | null;
  /** cached workbook value of the score cell (what the Director's sheet awarded) */
  wbPoints: number | string | null;
  /** the score cell's own formula text, if any */
  formula: string | null;
}

export interface ScRow {
  rowNum: number; // 1-based sheet row
  agent: string;
  employeeId: string; // col C as string
  userId: string | null;
  functionName: string;
  tl: string | null;
  week: string; // '1'..'4' | 'Final'
  workingDaysPct: number | null;
  wbNet: number | null;
  wbNetFormula: string | null;
  responseRate: number | null; // col L — the RES ≥10% gate for PRR
  cells: Record<ScoreKpi, ScCell>;
}

export interface ScWorkbook {
  filePath: string;
  monthLabel: string; // e.g. "Jan 26"
  /** First day of the workbook's month, ISO — the key for period-scoped bands (D-081). */
  periodDate: string | null;
  sheetName: string;
  rows: ScRow[];
  /** anything we could not confidently read — reported, never guessed */
  skipped: string[];
  /** raw access for the sheet-formula re-evaluation (threshold ref cells etc.) */
  cellValue: (col: string, row: number) => number | string | null;
}

const HEADER_ROW = 13;

function readCell(ws: XLSX.WorkSheet, col: string, row: number): XLSX.CellObject | undefined {
  return ws[`${col}${row}`] as XLSX.CellObject | undefined;
}

function cellV(ws: XLSX.WorkSheet, col: string, row: number): number | string | null {
  const c = readCell(ws, col, row);
  if (!c || c.v === undefined) return null;
  if (typeof c.v === 'number' || typeof c.v === 'string') return c.v;
  if (typeof c.v === 'boolean') return c.v ? 1 : 0;
  return null;
}

/** "May 26" → "2026-05-01". Null when the label is not a recognisable month —
 *  a wrong guess would silently apply the wrong period band, so we return null
 *  and let the caller fall back to the undated rule. */
export function periodDateFromLabel(label: string): string | null {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const m = /^([A-Za-z]{3})[a-z]*\.?\s*(\d{2}|\d{4})/.exec(label.trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  const yy = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${yy}-${String(mi + 1).padStart(2, '0')}-01`;
}

export function monthLabelFromFile(filePath: string): string {
  const base = path.basename(filePath);
  const m = /^\d+\.\s*(.+?)\s*SC/i.exec(base);
  return m ? m[1].trim() : base;
}

export function readScWorkbook(filePath: string): ScWorkbook {
  const wb = XLSX.readFile(filePath, { cellFormula: true });
  const sheetName = wb.SheetNames.find((n) => /\bSC\b|SC\b|\bSC/i.test(n)) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const skipped: string[] = [];
  const rows: ScRow[] = [];

  if (!ws || !ws['!ref']) {
    return { filePath, monthLabel: monthLabelFromFile(filePath), periodDate: periodDateFromLabel(monthLabelFromFile(filePath)), sheetName, rows, skipped: ['sheet unreadable'], cellValue: () => null };
  }

  // Sanity: header row must carry the expected anchor labels
  const hAgent = cellV(ws, 'B', HEADER_ROW);
  const hNet = cellV(ws, 'H', HEADER_ROW);
  if (String(hAgent ?? '').trim() !== 'Agent' || !/net/i.test(String(hNet ?? ''))) {
    skipped.push(`header row ${HEADER_ROW} does not match expected layout (B="${hAgent}", H="${hNet}") — sheet skipped entirely`);
    return { filePath, monthLabel: monthLabelFromFile(filePath), periodDate: periodDateFromLabel(monthLabelFromFile(filePath)), sheetName, rows, skipped, cellValue: (c, r) => cellV(ws, c, r) };
  }

  const range = XLSX.utils.decode_range(ws['!ref']!);
  for (let r = HEADER_ROW + 1; r <= range.e.r + 1; r++) {
    const agent = cellV(ws, 'B', r);
    const id = cellV(ws, 'C', r);
    if (agent === null && id === null) continue; // spacer row
    if (agent === null || id === null || String(agent).trim() === '') {
      skipped.push(`row ${r}: missing agent or ID — row skipped`);
      continue;
    }
    const fn = cellV(ws, 'E', r);
    if (fn === null || String(fn).trim() === '') {
      skipped.push(`row ${r} (${agent}): missing Function — row skipped`);
      continue;
    }
    const weekRaw = cellV(ws, 'I', r);
    const week = weekRaw === null ? '?' : String(weekRaw).trim();

    const cells = {} as Record<ScoreKpi, ScCell>;
    for (const sc of SCORE_CELLS) {
      const scoreCell = readCell(ws, sc.scoreCol, r);
      cells[sc.kpi] = {
        raw: cellV(ws, sc.rawCol, r),
        wbPoints: scoreCell && scoreCell.v !== undefined ? (scoreCell.v as number | string) : null,
        formula: scoreCell && scoreCell.f ? String(scoreCell.f) : null,
      };
    }

    const netCell = readCell(ws, 'H', r);
    const wd = cellV(ws, 'G', r);
    const rr = cellV(ws, 'L', r);
    rows.push({
      rowNum: r,
      agent: String(agent).trim(),
      employeeId: String(id).trim(),
      userId: cellV(ws, 'D', r) === null ? null : String(cellV(ws, 'D', r)).trim(),
      functionName: String(fn).trim(),
      tl: cellV(ws, 'F', r) === null ? null : String(cellV(ws, 'F', r)).trim(),
      week,
      workingDaysPct: typeof wd === 'number' ? wd : null,
      wbNet: netCell && typeof netCell.v === 'number' ? netCell.v : null,
      wbNetFormula: netCell && netCell.f ? String(netCell.f) : null,
      responseRate: typeof rr === 'number' ? rr : null,
      cells,
    });
  }

  return {
    filePath,
    monthLabel: monthLabelFromFile(filePath),
    periodDate: periodDateFromLabel(monthLabelFromFile(filePath)),
    sheetName,
    rows,
    skipped,
    cellValue: (c, r) => cellV(ws, c, r),
  };
}
