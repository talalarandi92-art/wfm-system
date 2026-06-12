import * as XLSX from 'xlsx';

export interface ParsedAttendanceRow {
  employeeNo: string | null;
  employeeName: string | null;
  userId: string | null;         // login/username e.g. "a.elfar"
  email: string | null;
  gender: string | null;
  location: string | null;       // "Office" | "WFH"
  functionName: string | null;
  teamName: string | null;       // Team/Campaign name (separate from manager)
  teamManager: string | null;
  attendanceDate: string | null; // YYYY-MM-DD
  shiftCode: string | null;
  shiftLabel: string | null;     // "Midnight", "Night" — human label from "Shift Time" col
  scheduledStart: string | null; // HH:MM
  scheduledEnd: string | null;
  scheduledStart2: string | null;
  scheduledEnd2: string | null;
  totalScheduledMinutes: number; // computed from scheduledStart/End (cross-midnight aware)
  punchIn: string | null;        // ISO datetime string
  punchOut: string | null;
  systemLogin: string | null;
  systemLogout: string | null;
  totalActualMinutes: number;    // from punch or system (whichever is available)
  hoursShortfall: number;        // max(0, scheduledMinutes - actualMinutes - 15min tolerance)
  punchLateMinutes: number;
  punchEarlyOutMinutes: number;
  systemLateMinutes: number;
  systemEarlyOutMinutes: number;
  otMinutes: number;
  permissionType: string | null;
  permissionDuration: number;
  permissionStatus: string | null;
  isMissingPunch: boolean;
  isMissingSystem: boolean;
  isWfh: boolean;
  isNoShow: boolean;             // scheduled working day but zero presence (no punch AND no system)
  isUncompensatedLate: boolean;  // came late AND actual hours < scheduled hours (not offset by OT)
  concordanceStatus: string;     // on_time|late|early_out|incomplete|no_show|missing_punch|wfh_ok|wfh_unverified|leave|off|holiday|sick|absent
  notes: string | null;
  rowNumber: number;
  errors: string[];
  warnings: string[];
}

// ─── Time Helpers ──────────────────────────────────────────────────────────────

/** Convert Excel serial date or string to YYYY-MM-DD */
function toDateStr(val: any): string | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    if (val > 0 && val < 1) return null;
    const d = XLSX.SSF.parse_date_code(val);
    if (!d || d.y < 2000 || d.y > 2100) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    const m1 = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10);
    const m2 = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }
  return null;
}

/** Convert Excel time fraction or HH:MM string to HH:MM */
function toTimeStr(val: any): string | null {
  if (val == null || val === '' || val === '-' || val === '0') return null;
  if (typeof val === 'number') {
    if (val === 0) return null;
    if (val >= 0 && val < 1) {
      const totalMinutes = Math.round(val * 24 * 60);
      const h = Math.floor(totalMinutes / 60) % 24;
      const m = totalMinutes % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t === '' || t === '-') return null;
    const m = t.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return null;
}

/** Convert Excel datetime, time fraction, or string to ISO datetime */
function toDateTimeStr(val: any, baseDate?: string): string | null {
  if (val == null || val === '' || val === '-' || val === '0') return null;
  if (typeof val === 'number') {
    if (val === 0) return null;
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    if (val < 1 && baseDate) {
      return `${baseDate}T${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}:00`;
    }
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}T${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}:00`;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t === '' || t === '-') return null;
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t) && baseDate) {
      return `${baseDate}T${t.padStart(5, '0')}:00`;
    }
    if (/\d{4}-\d{2}-\d{2}/.test(t)) return t;
  }
  return null;
}

function toMinutes(val: any): number {
  if (val == null || val === '' || val === '-') return 0;
  if (typeof val === 'number') {
    if (val === 0) return 0;
    if (val > 0 && val < 1) return Math.round(val * 24 * 60);
    return Math.round(val);
  }
  if (typeof val === 'string') {
    const t = val.trim();
    const m = t.match(/^(\d+):(\d+)$/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    const n = parseFloat(t);
    if (!isNaN(n)) return Math.round(n);
  }
  return 0;
}

/**
 * Compute scheduled duration in minutes (cross-midnight aware).
 * E.g. 22:00 → 07:00 = 9 hours = 540 minutes
 */
function scheduledDurationMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin   = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60; // cross-midnight
  const dur = endMin - startMin;
  return dur > 0 ? dur : 0;
}

/**
 * Compute actual duration in minutes from ISO datetime strings.
 */
function datetimeDurationMinutes(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  try {
    const inMs  = new Date(from).getTime();
    const outMs = new Date(to).getTime();
    if (outMs <= inMs) return 0;
    return Math.round((outMs - inMs) / 60000);
  } catch {
    return 0;
  }
}

function col(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex(h => patterns.some(p => p.test(h)));
}

/**
 * Parse the Shifts / Attendance sheet.
 *
 * Supports the Boutiqaat workbook column layout:
 *   Date | Day | Campaign | Name | ID | User ID | Team | Email |
 *   Team Manager | Gender | Location | Function | Shift Time | Shift |
 *   Shift Start Time | Shift End Time | ... | Punch In | Punch Out |
 *   Total OD | Punch Late In | Punch Early Out | OT |
 *   Login System Time | Logout System Time |
 *   Late In System Duration | Early Out System Duration | ...
 */
export function parseShiftsSheet(
  workbook: XLSX.WorkBook,
  sheetName?: string,
  /** Planned codes from the monthly matrix sheets: "empNo|YYYY-MM-DD" → code.
   *  Used to backfill future dates where the Shifts sheet holds stale zeros. */
  matrixLookup?: Map<string, string>,
): { rows: ParsedAttendanceRow[]; errors: string[]; backfilledFromMatrix: number } {
  const targetSheet = sheetName
    ?? workbook.SheetNames.find(n =>
        /shift|attendance|حضور|شيفت/i.test(n)
      )
    ?? workbook.SheetNames[0];

  const ws = workbook.Sheets[targetSheet];
  if (!ws) return { rows: [], errors: [`Sheet not found: ${targetSheet}`], backfilledFromMatrix: 0 };

  const raw: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, blankrows: false,
  });

  if (raw.length < 2) return { rows: [], errors: ['Shifts sheet has no data'], backfilledFromMatrix: 0 };

  // ── Header row detection ───────────────────────────────────────────────────
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const r = raw[i].map((c: any) => String(c ?? '').toLowerCase().trim());
    const textCells = r.filter(c => c && !/^\d+(\.\d+)?$/.test(c)).length;
    if (
      textCells >= 5 &&
      r.some(c =>
        /^date$|^name$|^id$|employee|attendance|function|shift|manager|موظف|تاريخ|رقم/.test(c)
      )
    ) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = raw[headerRowIdx].map((h: any) => String(h ?? '').toLowerCase().trim());

  // ── Column mapping ─────────────────────────────────────────────────────────
  const cEmpNo = col(headers, [
    /^id$/,
    /emp.?(?:id|no|num|code)/,
    /رقم.?الموظف/,
    /employee.?(?:id|no|number)/,
    /staff.?(?:id|no|num)/,
    /badge.?(?:id|no|num)?/,
    /payroll.?(?:id|no)/,
    /personnel.?(?:id|no)/,
    /الرقم.?الوظيفي/,
  ]);

  const cEmpName    = col(headers, [/^name$|emp.?name|employee.?name|اسم.?الموظف|^الاسم$/]);
  const cUserId     = col(headers, [/^user.?id$|^username$|^login.?name$/]);
  const cEmail      = col(headers, [/^email$|email.?address|بريد/]);
  const cGender     = col(headers, [/^gender$|^sex$|الجنس/]);
  const cLocation   = col(headers, [/^location$|^office|^wfh|الموقع/]);
  const cFunction   = col(headers, [/^function$|dept|department|قسم|إدارة|وظيفة/]);

  // Team name (e.g. "Care", "Refund") — separate from Team Manager
  const cTeam       = col(headers, [/^team$|^campaign$|^الفريق$|^فريق$|^team.?name$/]);
  const cManager    = col(headers, [/team.?manager|^manager$|team.?lead|مدير.?الفريق|مشرف/]);
  const cDate       = col(headers, [/^date$|attendance.?date|تاريخ/]);

  // Shift code ("MD", "N", "B"…) vs label ("Midnight", "Night")
  const cShift       = col(headers, [/^shift$|^shift.?code$|^الشيفت$|^كود.?الشيفت$/]);
  const cShiftLabel  = col(headers, [/^shift.?time$|^shift.?type$|^shift.?name$/]);

  const cSchedStart  = col(headers, [/^shift.?start.?time$|^sched.?start$|بداية.?الشيفت$/]);
  const cSchedEnd    = col(headers, [/^shift.?end.?time$|^sched.?end$|نهاية.?الشيفت$/]);
  const cSchedStart2 = col(headers, [/^shift.?start.?time.?2$|^sched.?start.?2$/]);
  const cSchedEnd2   = col(headers, [/^shift.?end.?time.?2$|^sched.?end.?2$/]);

  const cPunchIn    = col(headers, [/^punch.?in$|بصمة.?دخول|check.?in/]);
  const cPunchOut   = col(headers, [/^punch.?out$|بصمة.?خروج|check.?out/]);

  const cSysLogin   = col(headers, [/login.?system.?time|system.?login|sys.?login|دخول.?النظام/]);
  const cSysLogout  = col(headers, [/logout.?system.?time|system.?logout|sys.?logout|خروج.?النظام/]);

  const cLatePunch   = col(headers, [/^punch.?late.?in$|^late.?in.?punch$|^punch.?late$/]);
  const cEarlyPunch  = col(headers, [/^punch.?early.?out$|^early.?out.?punch$/]);
  const cLateSystem  = col(headers, [/late.?in.?system|system.?late|late.?sys|^late.?in.?sys/]);
  const cEarlySys    = col(headers, [/early.?out.?system|system.?early|early.?sys/]);

  const cOt          = col(headers, [/^ot$|^overtime$/]);
  const cPermType    = col(headers, [/permission.?type|نوع.?الإذن/]);
  const cPermDur     = col(headers, [/permission.?duration|مدة.?الإذن/]);
  const cPermStatus  = col(headers, [/permission.?status|حالة.?الإذن/]);
  const cNotes       = col(headers, [/^notes?$|^daily.?note$|ملاحظات/]);

  // ── Row parsing ────────────────────────────────────────────────────────────
  const results: ParsedAttendanceRow[] = [];

  // Leave-like codes where missing punch/system is expected
  const LEAVE_CODES = new Set(['OFF', 'H', 'L', 'SL', 'DL', 'COMP', 'RES', 'TER', 'UPL']);

  // Tolerance: shifts within 15 min of scheduled are considered "complete"
  const HOURS_SHORTFALL_TOLERANCE = 15;

  // Local "today" — future dates have no punches yet, so absence-style
  // warnings (no-show, incomplete) must not fire for them.
  const now = new Date();
  const todayStr =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let backfilledFromMatrix = 0;

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (row.every((c: any) => c == null || c === '')) continue;

    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Employee No ──────────────────────────────────────────────────────────
    let employeeNo: string | null = null;
    if (cEmpNo >= 0) {
      const rawVal = row[cEmpNo];
      const str = String(rawVal ?? '').trim();
      if (str && str !== '0' && str !== 'null') employeeNo = str;
    }

    // ── Date ─────────────────────────────────────────────────────────────────
    const attendanceDate = cDate >= 0 ? toDateStr(row[cDate]) : null;

    if (!employeeNo)     errors.push('Missing Employee ID');
    if (!attendanceDate) errors.push('Missing or invalid date');

    // ── Shift code ───────────────────────────────────────────────────────────
    let shiftCode: string | null = null;
    if (cShift >= 0) {
      const rawSc = row[cShift];
      const sc = String(rawSc ?? '').trim().toUpperCase();
      if (sc && sc !== '0' && !/^\d+$/.test(sc)) shiftCode = sc;
    }

    let shiftLabel = cShiftLabel >= 0
      ? String(row[cShiftLabel] ?? '').trim() || null
      : null;
    if (shiftLabel && /^\d+(\.\d+)?$/.test(shiftLabel)) shiftLabel = null; // stale formula zeros

    // Backfill from the monthly matrix when the Shifts sheet has no code
    // (future dates hold stale formula zeros — the matrix is the planned schedule)
    let scheduleFromMatrix = false;
    if (!shiftCode && matrixLookup && employeeNo && attendanceDate) {
      const planned = matrixLookup.get(`${employeeNo}|${attendanceDate}`);
      if (planned) {
        shiftCode = planned;
        scheduleFromMatrix = true;
        backfilledFromMatrix++;
      }
    }

    // ── Times ─────────────────────────────────────────────────────────────────
    const punchIn       = toDateTimeStr(cPunchIn    >= 0 ? row[cPunchIn]    : null, attendanceDate ?? undefined);
    const punchOut      = toDateTimeStr(cPunchOut   >= 0 ? row[cPunchOut]   : null, attendanceDate ?? undefined);
    const systemLogin   = toDateTimeStr(cSysLogin   >= 0 ? row[cSysLogin]   : null, attendanceDate ?? undefined);
    const systemLogout  = toDateTimeStr(cSysLogout  >= 0 ? row[cSysLogout]  : null, attendanceDate ?? undefined);

    let scheduledStart  = toTimeStr(cSchedStart  >= 0 ? row[cSchedStart]  : null);
    let scheduledEnd    = toTimeStr(cSchedEnd    >= 0 ? row[cSchedEnd]    : null);
    let scheduledStart2 = toTimeStr(cSchedStart2 >= 0 ? row[cSchedStart2] : null);
    let scheduledEnd2   = toTimeStr(cSchedEnd2   >= 0 ? row[cSchedEnd2]   : null);

    // Matrix says OFF/leave: any times left in the sheet are stale formula
    // residue from another day — not a real schedule.
    if (scheduleFromMatrix && shiftCode && LEAVE_CODES.has(shiftCode)) {
      scheduledStart = scheduledEnd = scheduledStart2 = scheduledEnd2 = null;
    }

    // ── Minutes ───────────────────────────────────────────────────────────────
    const punchLateMinutes       = toMinutes(cLatePunch  >= 0 ? row[cLatePunch]  : null);
    const systemLateMinutes      = toMinutes(cLateSystem >= 0 ? row[cLateSystem] : null);
    const punchEarlyOutMinutes   = toMinutes(cEarlyPunch >= 0 ? row[cEarlyPunch] : null);
    const systemEarlyOutMinutes  = toMinutes(cEarlySys   >= 0 ? row[cEarlySys]   : null);
    const otMinutes              = toMinutes(cOt         >= 0 ? row[cOt]         : null);
    const permissionDuration     = toMinutes(cPermDur    >= 0 ? row[cPermDur]    : null);

    // ── Scheduled vs Actual duration ──────────────────────────────────────────
    const totalScheduledMinutes = scheduledDurationMinutes(scheduledStart, scheduledEnd);

    // Prefer punch data; fall back to system login/logout
    const punchActualMinutes  = datetimeDurationMinutes(punchIn, punchOut);
    const systemActualMinutes = datetimeDurationMinutes(systemLogin, systemLogout);
    const totalActualMinutes  = punchActualMinutes || systemActualMinutes;

    // Shortfall = how many minutes short of scheduled hours (after tolerance)
    const rawShortfall =
      totalScheduledMinutes > 0 && totalActualMinutes > 0
        ? totalScheduledMinutes - totalActualMinutes
        : 0;
    const hoursShortfall = Math.max(0, rawShortfall - HOURS_SHORTFALL_TOLERANCE);

    // ── Flags ─────────────────────────────────────────────────────────────────
    const locationStr = cLocation >= 0 ? String(row[cLocation] ?? '').trim() : '';

    const isLeave = shiftCode ? LEAVE_CODES.has(shiftCode) : !shiftCode;
    const isFutureDate = !!attendanceDate && attendanceDate > todayStr;

    // WFH detection (3 signals)
    const isWfhByLocation = locationStr.toLowerCase().includes('wfh');
    const isWfhByShift    = shiftCode ? /wfh/i.test(shiftCode) : false;
    const isWfhByBehaviour = !isLeave && !!systemLogin && !punchIn;
    const isWfh = isWfhByLocation || isWfhByShift || isWfhByBehaviour;

    // Missing flags — never for future dates (shift hasn't happened yet)
    const isMissingPunch  = isLeave || isFutureDate ? false : isWfh ? false : !punchIn;
    const isMissingSystem = isLeave || isFutureDate ? false : !systemLogin;

    // ── No-show: was supposed to work but zero presence ────────────────────
    // Must be a working day + no punch + no system + not WFH.
    // Future dates can't be no-shows — the shift hasn't happened yet.
    const isNoShow = !isFutureDate && !isLeave &&
      !punchIn &&
      !systemLogin &&
      !!shiftCode &&
      shiftCode !== 'OFF' &&
      !isWfhByLocation &&
      !isWfhByShift;

    // ── Uncompensated late ─────────────────────────────────────────────────
    // Came late (punchLateMinutes > 0) AND actual hours < scheduled (no OT to cover it)
    const isUncompensatedLate =
      punchLateMinutes > 0 &&
      hoursShortfall > 0 &&
      otMinutes === 0;

    // ── WFH warning ────────────────────────────────────────────────────────
    if (!isLeave && isWfhByLocation && isMissingSystem) {
      warnings.push('WFH — system login not verified');
    }

    // ── No-show warning ────────────────────────────────────────────────────
    if (isNoShow) {
      warnings.push(`No-show: no punch and no system login for shift ${shiftCode ?? '?'}`);
    }

    // ── Uncompensated late warning ─────────────────────────────────────────
    if (isUncompensatedLate) {
      warnings.push(
        `Uncompensated late: arrived ${punchLateMinutes} min late, ` +
        `${hoursShortfall} min short of scheduled hours — no OT recorded`
      );
    }

    // ── Incomplete hours warning (not late, just left early / short) ───────
    if (!isNoShow && !isUncompensatedLate && hoursShortfall > 30 && !isLeave && punchIn) {
      warnings.push(
        `Incomplete shift: ${hoursShortfall} min short of scheduled ${Math.round(totalScheduledMinutes / 60 * 10) / 10}h`
      );
    }

    // ── Concordance status ─────────────────────────────────────────────────
    let concordanceStatus: string;

    const scUpper = (shiftCode ?? '').toUpperCase();
    if (scUpper === 'OFF')                                   concordanceStatus = 'off';
    else if (scUpper === 'H')                                concordanceStatus = 'holiday';
    else if (['L','DL','UPL','AL','EL','COV','COMP'].includes(scUpper)) concordanceStatus = 'leave';
    else if (scUpper === 'SL' || scUpper.endsWith('S'))      concordanceStatus = 'sick';
    else if (scUpper === 'A'  || scUpper.endsWith('A'))      concordanceStatus = 'absent';
    else if (isNoShow)                                        concordanceStatus = 'no_show';
    else if (isWfhByLocation && isMissingSystem)             concordanceStatus = 'wfh_unverified';
    else if (isWfh && systemLogin)                           concordanceStatus = punchLateMinutes > 0 || systemLateMinutes > 0 ? 'late' : 'wfh_ok';
    else if (isMissingPunch)                                  concordanceStatus = 'missing_punch';
    else if (punchLateMinutes > 15 || systemLateMinutes > 15) concordanceStatus = 'late';
    else if (punchEarlyOutMinutes > 15 || systemEarlyOutMinutes > 15) concordanceStatus = 'early_out';
    else if (hoursShortfall > 30)                             concordanceStatus = 'incomplete';
    else                                                      concordanceStatus = 'on_time';

    results.push({
      employeeNo,
      employeeName:     cEmpName  >= 0 ? String(row[cEmpName]  ?? '').trim() || null : null,
      userId:           cUserId   >= 0 ? String(row[cUserId]   ?? '').trim() || null : null,
      email:            cEmail    >= 0 ? String(row[cEmail]    ?? '').trim() || null : null,
      gender:           cGender   >= 0 ? String(row[cGender]   ?? '').trim() || null : null,
      location:         locationStr || null,
      functionName:     cFunction >= 0 ? String(row[cFunction] ?? '').trim() || null : null,
      teamName:         cTeam     >= 0 ? String(row[cTeam]     ?? '').trim() || null : null,
      teamManager:      cManager  >= 0 ? String(row[cManager]  ?? '').trim() || null : null,
      attendanceDate,
      shiftCode,
      shiftLabel,
      scheduledStart,
      scheduledEnd,
      scheduledStart2,
      scheduledEnd2,
      totalScheduledMinutes,
      punchIn,
      punchOut,
      systemLogin,
      systemLogout,
      totalActualMinutes,
      hoursShortfall,
      punchLateMinutes,
      punchEarlyOutMinutes,
      systemLateMinutes,
      systemEarlyOutMinutes,
      otMinutes,
      permissionType:   cPermType   >= 0 ? String(row[cPermType]   ?? '').trim() || null : null,
      permissionDuration,
      permissionStatus: cPermStatus >= 0 ? String(row[cPermStatus] ?? '').trim() || null : null,
      isMissingPunch,
      isMissingSystem,
      isWfh,
      isNoShow,
      isUncompensatedLate,
      concordanceStatus,
      notes:            cNotes >= 0 ? String(row[cNotes] ?? '').trim() || null : null,
      rowNumber: i + 1,
      errors,
      warnings,
    });
  }

  return { rows: results, errors: [], backfilledFromMatrix };
}
