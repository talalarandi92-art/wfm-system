import * as XLSX from 'xlsx';
import { normalizeShiftCode } from '../../../common/shift-normalize';

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

// Absence codes — bare markers only; 'ABS' is a legacy read alias (official HR code is A).
// Suffix codes (MA/NS/EE20A …) resolve through the shared normalizer below.
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

/**
 * Parse human time-range text like "10 PM - 5 AM" or the split form
 * "3 PM - 5 PM / 7 PM - 12 AM" (used by Ramadan shifts in the Timing sheet).
 */
function parseTimeRangeText(val: any): {
  start: string | null; end: string | null;
  start2: string | null; end2: string | null;
} | null {
  if (typeof val !== 'string') return null;
  const t = val.trim();
  if (!t.includes('-')) return null;

  const toHHMM = (s: string): string | null => {
    const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!m) return null;
    let h = parseInt(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
  };

  const segments = t.split('/').map(s => s.trim()).filter(Boolean);
  const ranges: Array<{ start: string; end: string }> = [];
  for (const seg of segments) {
    const parts = seg.split('-').map(s => s.trim());
    if (parts.length !== 2) return null;
    const start = toHHMM(parts[0]);
    const end   = toHHMM(parts[1]);
    if (!start || !end) return null;
    ranges.push({ start, end });
  }
  if (!ranges.length) return null;
  return {
    start:  ranges[0].start,
    end:    ranges[0].end,
    start2: ranges[1]?.start ?? null,
    end2:   ranges[1]?.end   ?? null,
  };
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

  // Detect header row — first prefer a row with an explicit code-column header
  // ("Shift Mark", "Code"…), because banner rows like "Normal Shifts |
  // Ramadan Shifts | Shift Start Time" above it also contain time-like text.
  const CODE_HEADER = /^(code|shift.?mark|shift.?code|كود|رمز|الكود|الشيفت)$/i;
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(15, raw.length); i++) {
    const row = raw[i].map((c: any) => String(c ?? '').toLowerCase().trim());
    if (row.some(c => CODE_HEADER.test(c))) { headerRowIdx = i; break; }
  }
  if (headerRowIdx < 0) {
    headerRowIdx = 0;
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
    /^shift.?mark$/,
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

  // First occurrence wins: the sheet repeats the same codes lower down in a
  // "Ramadan Shifts" section with different times — the Normal Shifts section
  // at the top is the authoritative definition for duplicated codes.
  const mainSeen = new Set<string>();

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const rawCode = row[colCode];
    if (rawCode == null || String(rawCode).trim() === '') continue;

    const code = String(rawCode).trim().toUpperCase();
    if (mainSeen.has(code)) continue;
    if (/^shift.?mark$/i.test(code)) continue; // repeated section headers
    mainSeen.add(code);
    const warnings: string[] = [];

    const rawStart = colStart >= 0 ? row[colStart] : null;
    const rawEnd   = colEnd   >= 0 ? row[colEnd]   : null;

    let startTime  = toTimeStr(rawStart);
    let endTime    = toTimeStr(rawEnd);
    let startTime2 = toTimeStr(colStart2 >= 0 ? row[colStart2] : null);
    let endTime2   = toTimeStr(colEnd2   >= 0 ? row[colEnd2]   : null);

    // Time cell may hold a text range like "10 PM - 5 AM" or a split
    // "3 PM - 5 PM / 7 PM - 12 AM" (Ramadan style)
    if (!startTime) {
      const range = parseTimeRangeText(rawStart);
      if (range) {
        startTime  = range.start;
        endTime    = endTime ?? range.end;
        startTime2 = startTime2 ?? range.start2;
        endTime2   = endTime2 ?? range.end2;
      }
    }

    // Leave/absence rows hold their label in the time columns
    // ("OFF | Day Off | Day Off", "AMS | 07:00 | Sick Leave")
    let textDescription: string | null = null;
    for (const v of [rawStart, rawEnd]) {
      if (typeof v === 'string' && v.trim() && !toTimeStr(v) && !parseTimeRangeText(v)) {
        textDescription = v.trim();
        break;
      }
    }
    const workingHours = toNumber(colWork  >= 0 ? row[colWork]  : null);
    const breakHours   = toNumber(colBreak >= 0 ? row[colBreak] : null);
    const totalHours   = toNumber(colTotal >= 0 ? row[colTotal] : null);

    const isCrossMidnight = detectCrossMidnight(startTime, endTime);
    const isSplitShift    = startTime2 != null && endTime2 != null;
    const isWfh           = /wfh|work.?from.?home/i.test(code);
    const isRamadan       = /^r[a-z]|ramadan|رمضان/i.test(code) ||
                            (colDesc >= 0 && /ramadan|رمضان/i.test(String(row[colDesc] ?? '')));
    const isSupervisorShift = /20$/.test(code);
    const norm = normalizeShiftCode(code); // shared grammar: MA/NS/EE20A… = base shift + A/S suffix
    const isLeaveCode     = LEAVE_CODES.has(code) || norm.status === 'leave';
    const isAbsenceCode   = ABSENCE_CODES.has(code) || norm.status === 'absence' || norm.status === 'sick';
    const isWorkingShift  = !NON_WORKING_CODES.has(code) && !isLeaveCode && !isAbsenceCode;

    // Female restriction: midnight shifts and some night shifts
    const allowsFemale = !detectMidnightShift(startTime) ||
                         /^(MD|MN|MNR|MDR)/i.test(code) === false;

    if (isWorkingShift && !startTime) {
      warnings.push(`Working shift "${code}" has no start time`);
    }

    results.push({
      code,
      description: (colDesc >= 0 ? String(row[colDesc] ?? '').trim() || null : null) ?? textDescription,
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

  // ── Ramadan side block ─────────────────────────────────────────────────────
  // The Boutiqaat Timing sheet has a second column group headed "Ramadan
  // Shifts" (codes MR/BR/CR/… with times in the next one or two cells).
  const seenCodes = new Set(results.map(r => r.code));
  for (let r = 0; r < Math.min(5, raw.length); r++) {
    for (let c = 0; c < (raw[r]?.length ?? 0); c++) {
      if (c === colCode) continue;
      if (!/ramadan/i.test(String(raw[r]?.[c] ?? ''))) continue;

      let blanks = 0;
      for (let i = r + 1; i < raw.length && blanks < 3; i++) {
        const rawCode = String(raw[i]?.[c] ?? '').trim();
        if (!rawCode) { blanks++; continue; }
        blanks = 0;
        if (!/^[A-Za-z][A-Za-z0-9]{0,9}$/.test(rawCode)) continue;
        const code = rawCode.toUpperCase();
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);

        const cell1 = raw[i]?.[c + 1];
        const cell2 = raw[i]?.[c + 2];
        const range = parseTimeRangeText(cell1);
        const startTime  = toTimeStr(cell1) ?? range?.start ?? null;
        const endTime    = toTimeStr(cell2) ?? range?.end   ?? null;
        const startTime2 = range?.start2 ?? null;
        const endTime2   = range?.end2   ?? null;

        results.push({
          code,
          description: 'Ramadan shift',
          startTime,
          endTime,
          startTime2,
          endTime2,
          workingHours: null,
          breakHours: null,
          totalHours: null,
          isSplitShift: startTime2 != null && endTime2 != null,
          isCrossMidnight: detectCrossMidnight(startTime, endTime),
          isWfh: /wfh/i.test(code),
          isRamadan: true,
          isSupervisorShift: /20$/.test(code),
          isWorkingShift: true,
          isLeaveCode: false,
          isAbsenceCode: false,
          allowsFemale: /^(MD|MN)/i.test(code) === false,
          source: 'timing_sheet',
          rowNumber: i + 1,
          warnings: [],
        });
      }
    }
  }

  return { rows: results, errors };
}
