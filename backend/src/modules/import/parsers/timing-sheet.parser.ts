import * as XLSX from 'xlsx';

export interface ParsedShiftCode {
  code: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  startTime2: string | null;
  endTime2: string | null;
  workingHours: number | null;
  breakHours: number | null;
  totalHours: number | null;
  isSplitShift: boolean;
  isCrossMidnight: boolean;
  isWfh: boolean;
  isRamadan: boolean;
  isSupervisorShift: boolean;
  isWorkingShift: boolean;
  isLeaveCode: boolean;
  isAbsenceCode: boolean;
  allowsFemale: boolean;
  source: 'timing_sheet';
  rowNumber: number;
  warnings: string[];
}

// Non-working codes that appear in schedules
const NON_WORKING_CODES = new Set([
  'OFF', 'H', 'L', 'SL', 'AL', 'DL', 'ML', 'PL', 'EL',
  'COMP', 'RES', 'TER', 'UPL', 'COV', 'COMP',
]);

// Leave codes
const LEAVE_CODES = new Set(['L', 'AL', 'SL', 'DL', 'ML', 'PL', 'EL', 'UPL']);

// Absence codes
const ABSENCE_CODES = new Set(['A', 'ABS', 'UA']);

/**
 * Convert Excel time serial or string to HH:MM format.
 * Excel stores time as a fraction of a day (0.5 = 12:00).
 */
function toTimeStr(val: any): string | null {
  if (val == null || val === '' || val === '-') return null;

  // Already a string like "07:00" or "7:00"
  if (typeof val === 'string') {
    const cleaned = val.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) {
      const parts = cleaned.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1]}`;
    }
    // Handle "0700" format
    if (/^\d{3,4}$/.test(cleaned)) {
      const padded = cleaned.padStart(4, '0');
      return `${padded.slice(0, 2)}:${padded.slice(2)}`;
    }
    return null;
  }

  // Excel time fraction
  if (typeof val === 'number') {
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

function toNumber(val: any): number | null {
  if (val == null || val === '' || val === '-') return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function detectCrossMidnight(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  return endMins < startMins || endMins === 0;
}

/**
 * Detect if a shift code is a midnight shift based on start time.
 * Midnight range: 00:00 – 06:00 or ending after 00:00 when cross-midnight.
 */
function detectMidnightShift(start: string | null): boolean {
  if (!start) return false;
  const [h] = start.split(':').map(Number);
  return h >= 0 && h < 6;
}

/**
 * Parse the Timing sheet from the real workbook.
 *
 * The Timing sheet is the authoritative shift code dictionary.
 * Column detection is flexible — we scan row 1 for headers.
 *
 * Expected columns (order may vary):
 *   Code / Shift Code / الكود
 *   Description / الوصف
 *   Start / Start Time / وقت البداية
 *   End / End Time / وقت النهاية
 *   Start 2 / Split Start
 *   End 2 / Split End
 *   Working Hours / ساعات العمل
 *   Break / Break Hours
 *   Total Hours
 */
export function parseTimingSheet(
  workbook: XLSX.WorkBook,
  sheetName?: string,
): { rows: ParsedShiftCode[]; errors: string[] } {
  const availableSheets = workbook.SheetNames;

  // Find the Timing sheet — flexible name matching
  const targetSheet = sheetName
    ?? workbook.SheetNames.find(n =>
        /timing|توقيت|shift.?code|^code$|^shifts?$/i.test(n)
      )
    ?? workbook.SheetNames[0];

  const ws = workbook.Sheets[targetSheet];
  if (!ws) {
    return {
      rows: [],
      errors: [
        `Sheet not found: "${targetSheet}". Available sheets: ${availableSheets.join(', ')}`,
      ],
    };
  }

  const raw: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (raw.length < 2) {
    return {
      rows: [],
      errors: [
        `Sheet "${targetSheet}" has no data. Available sheets: ${availableSheets.join(', ')}`,
      ],
    };
  }

  // Detect header row — scan up to 15 rows, look for any time-like or code-like header
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(15, raw.length); i++) {
    const row = raw[i].map((c: any) => String(c ?? '').toLowerCase().trim());
    const hasCodeLike = row.some(c =>
      /code|shift|كود|رمز|الشيفت|الكود|رمز.?الشيفت|shift.?code/i.test(c)
    );
    const hasTimeLike = row.some(c =>
      /start|end|time|بداية|نهاية|وقت|from|to/i.test(c)
    );
    if (hasCodeLike || hasTimeLike) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = raw[headerRowIdx].map((h: any) =>
    String(h ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  );

  // Flexible column lookup
  const col = (patterns: RegExp[]): number =>
    headers.findIndex(h => patterns.some(p => p.test(h)));

  // Code column — very broad set of patterns
  let colCode = col([
    /^code$/,
    /shift.?code/,
    /code.?shift/,
    /^shift$/,
    /^كود$/,
    /^رمز$/,
    /الكود/,
    /كود.?الشيفت/,
    /رمز.?الشيفت/,
    /^الشيفت$/,
    /shift.?name/,
    /^abbr/,
    /^symbol/,
    /^id$/,
  ]);

  // Fallback: if still -1, use the first non-empty column as the code column
  // (common in simple timing tables where row 0 is just the shift code)
  if (colCode === -1) {
    const firstDataRow = raw[headerRowIdx + 1] ?? [];
    // Find first column that has a short string value (looks like a shift code)
    for (let c = 0; c < Math.min(headers.length, 5); c++) {
      const headerVal = headers[c];
      const dataVal   = String(firstDataRow[c] ?? '').trim();
      // Accept if: header is empty (no header) OR header looks generic AND data is short like a code
      if (dataVal.length > 0 && dataVal.length <= 10) {
        colCode = c;
        break;
      }
    }
  }

  if (colCode === -1) {
    return {
      rows: [],
      errors: [
        `Cannot locate Code column in sheet "${targetSheet}". ` +
        `Headers found: [${headers.filter(Boolean).join(', ')}]. ` +
        `Available sheets: ${availableSheets.join(', ')}. ` +
        `Tip: Select the correct sheet name in the "Sheet Name" field.`,
      ],
    };
  }

  const colDesc  = col([/desc|description|وصف|الوصف|اسم|name/]);
  const colStart = col([/^start$/, /start.?time/, /^from$/, /بداية/, /وقت.?بداية/, /^time.?in$/]);
  const colEnd   = col([/^end$/, /end.?time/, /^to$/, /نهاية/, /وقت.?نهاية/, /^time.?out$/]);
  const colStart2 = col([/start.?2/, /split.?start/, /بداية.?2/, /2.?start/]);
  const colEnd2   = col([/end.?2/, /split.?end/, /نهاية.?2/, /2.?end/]);
  const colWork  = col([/work.?hour/, /ساعات.?عمل/, /working/, /work.?hrs/, /^hours?$/]);
  const colBreak = col([/break/, /استراحة/, /rest/]);
  const colTotal = col([/total/, /إجمالي/, /اجمالي/, /total.?hour/]);

  const results: ParsedShiftCode[] = [];
  const errors: string[] = [];

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const rawCode = row[colCode];
    if (rawCode == null || String(rawCode).trim() === '') continue;

    const code = String(rawCode).trim().toUpperCase();
    const warnings: string[] = [];

    const startTime  = toTimeStr(colStart  >= 0 ? row[colStart]  : null);
    const endTime    = toTimeStr(colEnd    >= 0 ? row[colEnd]    : null);
    const startTime2 = toTimeStr(colStart2 >= 0 ? row[colStart2] : null);
    const endTime2   = toTimeStr(colEnd2   >= 0 ? row[colEnd2]   : null);
    const workingHours = toNumber(colWork  >= 0 ? row[colWork]  : null);
    const breakHours   = toNumber(colBreak >= 0 ? row[colBreak] : null);
    const totalHours   = toNumber(colTotal >= 0 ? row[colTotal] : null);

    const isCrossMidnight = detectCrossMidnight(startTime, endTime);
    const isSplitShift    = startTime2 != null && endTime2 != null;
    const isWfh           = /wfh|work.?from.?home/i.test(code);
    const isRamadan       = /^r[a-z]|ramadan|رمضان/i.test(code) ||
                            (colDesc >= 0 && /ramadan|رمضان/i.test(String(row[colDesc] ?? '')));
    const isSupervisorShift = /20$/.test(code);
    const isLeaveCode     = LEAVE_CODES.has(code);
    const isAbsenceCode   = ABSENCE_CODES.has(code);
    const isWorkingShift  = !NON_WORKING_CODES.has(code) && !isLeaveCode && !isAbsenceCode;

    // Female restriction: midnight shifts and some night shifts
    const allowsFemale = !detectMidnightShift(startTime) ||
                         /^(MD|MN|MNR|MDR)/i.test(code) === false;

    if (isWorkingShift && !startTime) {
      warnings.push(`Working shift "${code}" has no start time`);
    }

    results.push({
      code,
      description: colDesc >= 0 ? String(row[colDesc] ?? '').trim() || null : null,
      startTime,
      endTime,
      startTime2,
      endTime2,
      workingHours,
      breakHours,
      totalHours,
      isSplitShift,
      isCrossMidnight,
      isWfh,
      isRamadan,
      isSupervisorShift,
      isWorkingShift,
      isLeaveCode,
      isAbsenceCode,
      allowsFemale,
      source: 'timing_sheet',
      rowNumber: i + 1,
      warnings,
    });
  }

  return { rows: results, errors };
}
