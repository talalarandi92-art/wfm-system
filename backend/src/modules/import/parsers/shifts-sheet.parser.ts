import * as XLSX from 'xlsx';

export interface ParsedAttendanceRow {
  employeeNo: string | null;
  employeeName: string | null;
  functionName: string | null;
  teamManager: string | null;
  attendanceDate: string | null;   // YYYY-MM-DD
  shiftCode: string | null;
  scheduledStart: string | null;   // HH:MM
  scheduledEnd: string | null;
  punchIn: string | null;          // ISO datetime string
  punchOut: string | null;
  systemLogin: string | null;
  systemLogout: string | null;
  punchLateMinutes: number;
  punchEarlyOutMinutes: number;
  systemLateMinutes: number;
  systemEarlyOutMinutes: number;
  otMinutes: number;
  isMissingPunch: boolean;
  isMissingSystem: boolean;
  isWfh: boolean;
  notes: string | null;
  rowNumber: number;
  errors: string[];
  warnings: string[];
}

/** Convert Excel serial date or string to YYYY-MM-DD */
function toDateStr(val: any): string | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    // DD/MM/YYYY
    const m1 = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10);
    // MM/DD/YYYY
    const m2 = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }
  return null;
}

/** Convert Excel datetime or string to ISO datetime */
function toDateTimeStr(val: any, baseDate?: string): string | null {
  if (val == null || val === '' || val === '-' || val === '0') return null;
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}T${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}:00`;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t === '' || t === '-') return null;
    // HH:MM only — combine with base date
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t) && baseDate) {
      return `${baseDate}T${t.padStart(5, '0')}:00`;
    }
    // Full datetime
    if (/\d{4}-\d{2}-\d{2}/.test(t)) return t;
  }
  return null;
}

function toMinutes(val: any): number {
  if (val == null || val === '' || val === '-') return 0;
  if (typeof val === 'number') {
    // Could be hours fraction or already minutes
    if (val < 1 && val > 0) return Math.round(val * 24 * 60); // time fraction
    return Math.round(val);
  }
  if (typeof val === 'string') {
    const t = val.trim();
    // HH:MM
    const m = t.match(/^(\d+):(\d+)$/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    const n = parseFloat(t);
    if (!isNaN(n)) return Math.round(n);
  }
  return 0;
}

function col(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex(h => patterns.some(p => p.test(h)));
}

/**
 * Parse the Shifts / Attendance sheet.
 * Flexible header detection — handles Arabic and English column names.
 */
export function parseShiftsSheet(
  workbook: XLSX.WorkBook,
  sheetName?: string,
): { rows: ParsedAttendanceRow[]; errors: string[] } {
  const targetSheet = sheetName
    ?? workbook.SheetNames.find(n =>
        /shift|attendance|حضور|شيفت/i.test(n)
      )
    ?? workbook.SheetNames[0];

  const ws = workbook.Sheets[targetSheet];
  if (!ws) return { rows: [], errors: [`Sheet not found: ${targetSheet}`] };

  const raw: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, blankrows: false,
  });

  if (raw.length < 2) return { rows: [], errors: ['Shifts sheet has no data'] };

  // Detect header row
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const r = raw[i].map((c: any) => String(c ?? '').toLowerCase());
    if (r.some(c => /employee|emp.?id|emp.?no|موظف|رقم/.test(c))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = raw[headerRowIdx].map((h: any) => String(h ?? '').toLowerCase().trim());

  const cEmpNo      = col(headers, [/emp.?(?:id|no|num|code)|رقم.?الموظف|employee.?id/]);
  const cEmpName    = col(headers, [/emp.?name|name|اسم.?الموظف|الاسم/]);
  const cFunction   = col(headers, [/function|dept|قسم|إدارة|وظيفة/]);
  const cManager    = col(headers, [/manager|team.?lead|مدير|مشرف/]);
  const cDate       = col(headers, [/^date$|attendance.?date|تاريخ/]);
  const cShift      = col(headers, [/shift.?code|shift$|شيفت|كود/]);
  const cSchedStart = col(headers, [/sched.?start|shift.?start(?!.?2)|بداية.?الشيفت/]);
  const cSchedEnd   = col(headers, [/sched.?end|shift.?end(?!.?2)|نهاية.?الشيفت/]);
  const cPunchIn    = col(headers, [/punch.?in|بصمة.?دخول|check.?in/]);
  const cPunchOut   = col(headers, [/punch.?out|بصمة.?خروج|check.?out/]);
  const cSysLogin   = col(headers, [/system.?login|sys.?login|login.?time|دخول.?النظام/]);
  const cSysLogout  = col(headers, [/system.?logout|sys.?logout|logout.?time|خروج.?النظام/]);
  const cLatePunch  = col(headers, [/late.?punch|punch.?late|late.?in(?!.?sys)|تأخير.?بصمة/]);
  const cLateSystem = col(headers, [/late.?sys|system.?late|late.?in.?sys|تأخير.?نظام/]);
  const cEarlyPunch = col(headers, [/early.?out.?punch|punch.?early|خروج.?مبكر.?بصمة/]);
  const cEarlySys   = col(headers, [/early.?out.?sys|system.?early|خروج.?مبكر.?نظام/]);
  const cOt         = col(headers, [/^ot$|overtime|أوفرتايم|إضافي/]);
  const cNotes      = col(headers, [/notes|note|ملاحظات|notes/]);

  const results: ParsedAttendanceRow[] = [];
  const globalErrors: string[] = [];

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];

    // Skip fully empty rows
    if (row.every((c: any) => c == null || c === '')) continue;

    const errors: string[] = [];
    const warnings: string[] = [];

    const employeeNo = cEmpNo >= 0 ? String(row[cEmpNo] ?? '').trim() || null : null;
    const attendanceDate = cDate >= 0 ? toDateStr(row[cDate]) : null;

    if (!employeeNo) errors.push('Missing Employee ID');
    if (!attendanceDate) errors.push('Missing or invalid date');

    const shiftCode = cShift >= 0
      ? String(row[cShift] ?? '').trim().toUpperCase() || null
      : null;

    const punchIn  = toDateTimeStr(cPunchIn  >= 0 ? row[cPunchIn]  : null, attendanceDate ?? undefined);
    const punchOut = toDateTimeStr(cPunchOut >= 0 ? row[cPunchOut] : null, attendanceDate ?? undefined);
    const systemLogin  = toDateTimeStr(cSysLogin  >= 0 ? row[cSysLogin]  : null, attendanceDate ?? undefined);
    const systemLogout = toDateTimeStr(cSysLogout >= 0 ? row[cSysLogout] : null, attendanceDate ?? undefined);

    const punchLateMinutes     = toMinutes(cLatePunch >= 0 ? row[cLatePunch] : null);
    const systemLateMinutes    = toMinutes(cLateSystem >= 0 ? row[cLateSystem] : null);
    const punchEarlyOutMinutes = toMinutes(cEarlyPunch >= 0 ? row[cEarlyPunch] : null);
    const systemEarlyOutMinutes = toMinutes(cEarlySys >= 0 ? row[cEarlySys] : null);
    const otMinutes = toMinutes(cOt >= 0 ? row[cOt] : null);

    const functionName = cFunction >= 0 ? String(row[cFunction] ?? '').trim() || null : null;
    const isWfh = shiftCode ? /wfh/i.test(shiftCode) : false;
    const isMissingPunch  = !punchIn && !!shiftCode && !['OFF', 'H', 'L', 'SL'].includes(shiftCode);
    const isMissingSystem = !systemLogin && !!shiftCode && !['OFF', 'H', 'L', 'SL', 'WFH'].includes(shiftCode ?? '');

    results.push({
      employeeNo,
      employeeName: cEmpName >= 0 ? String(row[cEmpName] ?? '').trim() || null : null,
      functionName,
      teamManager: cManager >= 0 ? String(row[cManager] ?? '').trim() || null : null,
      attendanceDate,
      shiftCode,
      scheduledStart: cSchedStart >= 0 ? String(row[cSchedStart] ?? '').trim() || null : null,
      scheduledEnd:   cSchedEnd   >= 0 ? String(row[cSchedEnd]   ?? '').trim() || null : null,
      punchIn,
      punchOut,
      systemLogin,
      systemLogout,
      punchLateMinutes,
      punchEarlyOutMinutes,
      systemLateMinutes,
      systemEarlyOutMinutes,
      otMinutes,
      isMissingPunch,
      isMissingSystem,
      isWfh,
      notes: cNotes >= 0 ? String(row[cNotes] ?? '').trim() || null : null,
      rowNumber: i + 1,
      errors,
      warnings,
    });
  }

  return { rows: results, errors: globalErrors };
}
