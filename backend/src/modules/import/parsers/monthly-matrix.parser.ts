import * as XLSX from 'xlsx';

/**
 * Parse the monthly schedule matrix sheets ("Jan 26", "June 26", …) into a
 * lookup of planned shift codes: "employeeNo|YYYY-MM-DD" → shift code.
 *
 * The Shifts sheet only carries shift codes up to the current day (future
 * cells hold stale formula zeros), while the monthly matrix holds the planned
 * schedule for the whole month — so the matrix is the source of truth for
 * future dates.
 *
 * Matrix layout:
 *   row 0: Name | ID | Username | Team | Location | Function | …
 *   row 1: (blank cols) … Excel serial date per day column
 *   row 2: (blank cols) … day names (Mon/Tue/…)
 *   row 3+: one row per employee, shift code per day column
 */
export function parseMonthlyMatrix(
  workbook: XLSX.WorkBook,
): { lookup: Map<string, string>; sheetsParsed: string[] } {
  const lookup = new Map<string, string>();
  const sheetsParsed: string[] = [];

  const MONTH_SHEET =
    /^(jan|feb|mar|apr|april|may|jun|june|jul|july|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{2,4}\s*$/i;

  for (const name of workbook.SheetNames) {
    if (!MONTH_SHEET.test(name.trim())) continue;
    if (/hc/i.test(name)) continue; // "Jan 26 HC" — headcount sheets, not schedule

    const ws = workbook.Sheets[name];
    if (!ws) continue;

    const raw: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1, defval: null, blankrows: false,
    });
    if (raw.length < 4) continue;

    // Find the row of Excel serial dates (within the first 5 rows)
    let dateRowIdx = -1;
    for (let i = 0; i < Math.min(5, raw.length); i++) {
      const serials = (raw[i] ?? []).filter(
        (v: any) => typeof v === 'number' && v > 40000 && v < 60000,
      ).length;
      if (serials >= 10) { dateRowIdx = i; break; }
    }
    if (dateRowIdx < 0) continue;

    // Column → date string map
    const dateRow = raw[dateRowIdx];
    const colDates = new Map<number, string>();
    for (let c = 0; c < dateRow.length; c++) {
      const v = dateRow[c];
      if (typeof v !== 'number' || v <= 40000 || v >= 60000) continue;
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) continue;
      colDates.set(c, `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);
    }
    if (!colDates.size) continue;

    // Employee-no column from the header row (usually row 0, header "ID")
    const headers = (raw[0] ?? []).map((h: any) => String(h ?? '').toLowerCase().trim());
    let idCol = headers.findIndex(h => h === 'id' || /emp.?(id|no)/.test(h) || /رقم/.test(h));
    if (idCol < 0) idCol = 1; // observed layout: Name | ID | …

    // Data rows start after the day-name row (date row + 2 in observed layout)
    for (let i = dateRowIdx + 1; i < raw.length; i++) {
      const row = raw[i];
      if (!row) continue;
      const empNo = String(row[idCol] ?? '').trim();
      // Skip header/day-name rows and rows without a numeric-ish employee no
      if (!empNo || empNo === 'null' || !/^\d+$/.test(empNo)) continue;

      for (const [c, dateStr] of colDates) {
        const v = row[c];
        if (v == null) continue;
        const code = String(v).trim().toUpperCase();
        // Real shift codes are alphanumeric ("M", "EE20", "M7-3", "OFF") —
        // pure numbers are formula leftovers, not codes.
        if (!code || /^\d+(\.\d+)?$/.test(code)) continue;
        lookup.set(`${empNo}|${dateStr}`, code);
      }
    }

    sheetsParsed.push(name);
  }

  return { lookup, sheetsParsed };
}
