/**
 * ============================================================================
 *  CORRECTED ROSTER RECONCILIATION ENGINE  —  "new roster" (June 2026)
 * ============================================================================
 *  Built from the AGREED rules + the three sign-off decisions (2026-06-28):
 *    1) WFH = roster WFH code  OR  Location=WFH  OR  Odoo Status=WFH.
 *       Office-coded + system-without-punch  →  Manual Review (NOT auto-WFH).
 *    2) Excluded (record-only, no HR/tardiness) = supervisory roles ONLY:
 *       Team Leader / Senior / RTA / Resolution Specialist / WFM.
 *       Customer Care (front-line function) is NOT excluded.
 *    3) Permission "HR Approved" covers the violation; anything Pending/Waiting
 *       does NOT cover and routes the case to Manual Review (never auto-HR).
 *
 *  FOUNDATION = CC Schedule > June matrix (source of truth for who/when/what).
 *  Sources are then filled IN ORDER: Odoo → Permission/Comp → Ameyo → Sprinklr.
 *  Fairness > aggressive reporting. Weak evidence → Manual Review / Data Quality.
 *
 *  Output: Roster_Reconciliation_June2026.xlsx with the 16 required sheets.
 *  Read-only on the source files. Does NOT touch the live DB.
 * ============================================================================
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Scratch + source dirs are env-configurable (2026-07-06, bug #13 — was a hardcoded session-UUID temp path)
const SCRATCH = (process.env.RECON_SCRATCH || require('path').join(__dirname, '..', '.recon-scratch'));
const SRCDIR = process.env.RECON_SRCDIR || 'C:/Users/t.bassam/Desktop/new roster/';
const F = JSON.parse(fs.readFileSync(SCRATCH + '/foundation.json', 'utf8'));
const OUT_XLSX = (process.env.RECON_OUT || (SRCDIR + 'Roster_Reconciliation_June2026.xlsx'));

// ---------------------------------------------------------------------------
// time / date helpers — read source files RAW (cellDates:false) to avoid all
// timezone artifacts; convert serials ourselves.
// ---------------------------------------------------------------------------
const EXCEL_EPOCH_OFFSET = 25569; // days between 1899-12-30 and 1970-01-01
function serialToISO(serial) {            // integer serial -> 'YYYY-MM-DD' (calendar date as stored)
  if (typeof serial !== 'number') return null;
  const ms = Math.round((Math.floor(serial) - EXCEL_EPOCH_OFFSET) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}
function serialTimeMin(serial) {           // any serial -> minutes-from-midnight (wall clock)
  if (typeof serial !== 'number') return null;
  const frac = serial - Math.floor(serial);
  return Math.round(frac * 1440);
}
function serialDateTime(serial) {          // full datetime serial -> {date, min}
  if (typeof serial !== 'number') return null;
  return { date: serialToISO(serial), min: serialTimeMin(serial) };
}
function parseClock(str) {                  // "03:00 PM" -> minutes
  if (str == null) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = +m[1], mn = +m[2];
  if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h * 60 + mn;
}
const hhmm = (min) => { if (min == null) return ''; let neg = min < 0; min = Math.abs(min); const h = Math.floor(min / 60), m = Math.round(min % 60); return (neg ? '-' : '') + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
const hhmmss = (min) => { if (min == null) return ''; let neg = min < 0; min = Math.abs(min); const h = Math.floor(min / 60), m = Math.floor(min % 60), s = Math.round((min - Math.floor(min)) * 60); return (neg ? '-' : '') + [h, m, s].map(x => String(x).padStart(2, '0')).join(':'); };
const minToHHMMSS = (min) => hhmm(min) + ':00';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (iso) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];

// ---------------------------------------------------------------------------
// SHIFT CODE DICTIONARY — the ONE mapping. Unknown codes are flagged, never guessed.
// kind: work | wfh | off | leave | holiday | sick | absence | comp | sep | unknown
// times in minutes-from-midnight; end>1440 means cross-midnight.
// ---------------------------------------------------------------------------
const BREAK = 60;
const STD = { M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320], E: [960, 1500], EE20: [1080, 1620], MD: [1320, 1860], MN: [1380, 1920] }; // 9h gross
const MOM = { M7: [420, 840], B7: [540, 960], C7: [660, 1080], N7: [780, 1200] }; // 7h gross -> 6h net (mothers)
// user-confirmed exact times 2026-06-28: M20 08-16, B20 10-18, C20 11-20, N20 14-22
const RESP = { M20: [480, 960], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320] };
const MOTHERS = new Set([12375, 12434]); // Haya Al-Muhanna, Shaima Saud
// Director 2026-07-03: ANY valid base shift + S = sick, + A = absence (EE20S/EE20A and
// M7-3 variants were missing from the old fixed lists). Longest-first so EE20S wins over ES.
const SICK_PREFIX = ['EE20S', 'M7-3S', 'M20S', 'B20S', 'C20S', 'N20S', 'MDS', 'MNS', 'EES', 'AMS', 'MS', 'BS', 'CS', 'NS', 'ES'];
const ABS_PREFIX = ['EE20A', 'M7-3A', 'M20A', 'B20A', 'C20A', 'N20A', 'MDA', 'MNA', 'EEA', 'AMA', 'MA', 'BA', 'CA', 'NA', 'EA'];

function classifyCode(rawIn, empId) {
  const raw = String(rawIn || '').trim();
  const U = raw.toUpperCase();
  const mk = (o) => Object.assign({ raw, norm: U, origin: U, kind: 'unknown', start: null, end: null, gross: null, net: null, location: 'Office', mapped: false, crossMidnight: false, note: '' }, o);

  if (U === 'OFF') return mk({ kind: 'off', mapped: true });
  if (U === 'H') return mk({ kind: 'holiday', mapped: true });
  if (U === 'L') return mk({ kind: 'leave', mapped: true, note: 'Annual leave' });
  if (U === 'SL') return mk({ kind: 'leave', mapped: true, note: 'Sick leave (scheduled)' });
  if (U === 'DL') return mk({ kind: 'leave', mapped: true, note: 'Death leave' });
  if (U === 'COMP') return mk({ kind: 'comp', mapped: true, note: 'Compensatory day' });
  if (U === 'RES') return mk({ kind: 'sep', mapped: true, note: 'Resignation marker' });
  if (U === 'TER') return mk({ kind: 'sep', mapped: true, note: 'Termination marker' });

  // sick / absence by shift code (must check BEFORE plain letters, longest first)
  for (const p of SICK_PREFIX) if (U === p) return mk({ kind: 'sick', mapped: true, origin: p.replace(/S$/, ''), note: 'Sick on ' + p.replace(/S$/, '') });
  for (const p of ABS_PREFIX) if (U === p) return mk({ kind: 'absence', mapped: true, origin: p.replace(/A$/, ''), note: 'Absent on ' + p.replace(/A$/, '') });

  // WFH variants: WFH-M / WFHM / WFH-B ... and bare WFH
  let wm = U.match(/^WFH[-]?([A-Z]+\d*)$/);
  if (U === 'WFH') return mk({ kind: 'wfh', mapped: true, origin: null, location: 'WFH', note: 'WFH (no shift timing in roster) — schedule window unknown' });
  if (wm) {
    const base = wm[1];
    if (STD[base]) { const [s, e] = STD[base]; return mk({ kind: 'wfh', mapped: true, origin: base, location: 'WFH', start: s, end: e, gross: (e - s), net: (e - s) - BREAK, crossMidnight: e > 1440 }); }
    if (MOM[base]) { const [s, e] = MOM[base]; return mk({ kind: 'wfh', mapped: true, origin: base, location: 'WFH', start: s, end: e, gross: (e - s), net: (e - s) - BREAK, note: 'mother 7h' }); }
    return mk({ kind: 'wfh', mapped: false, origin: base, location: 'WFH', note: 'WFH variant with unmapped base "' + base + '"' });
  }

  // mother 7h (only valid for the two named mothers; otherwise flag)
  if (MOM[U]) { const [s, e] = MOM[U]; const ok = MOTHERS.has(empId); return mk({ kind: 'work', mapped: true, start: s, end: e, gross: e - s, net: (e - s) - BREAK, note: ok ? 'mother 7h' : 'M7-style code on non-mother — review' }); }

  // responsible "20" shifts — exact times confirmed by the user
  if (RESP[U]) { const [s, e] = RESP[U]; return mk({ kind: 'work', mapped: true, start: s, end: e, gross: e - s, net: (e - s) - BREAK, note: 'responsible shift (' + (((e - s) / 60).toFixed(0)) + 'h)' }); }

  // standard 9h
  if (STD[U]) { const [s, e] = STD[U]; return mk({ kind: 'work', mapped: true, start: s, end: e, gross: e - s, net: (e - s) - BREAK, crossMidnight: e > 1440 }); }
  // AM (8h morning, distinct from M9) — keep as work if seen
  if (U === 'AM') return mk({ kind: 'work', mapped: true, start: 480, end: 960, gross: 480, net: 420, note: 'AM 8h' });

  // user-confirmed 2026-06-28
  if (U === 'CCNO') return mk({ kind: 'work', mapped: true, start: 540, end: 1020, gross: 480, net: 420, management: true, note: 'Management fixed shift 09:00-17:00 (record-only)' });
  if (U === 'M7-3') return mk({ kind: 'work', mapped: true, start: 420, end: 900, gross: 480, net: 420, note: 'Fixed shift 07:00-15:00' });
  return mk({ kind: 'unknown', mapped: false, note: 'Unmapped roster code "' + raw + '"' });
}

// excluded (supervisory) role test — confirmed: TL/Senior/RTA/Resolution Specialist/WFM only.
// SCOPE (policy 2026-06-30): "excluded/record-only" suppresses HR-action + tardiness *deductions* ONLY.
// It does NOT exempt anyone from opening the system: the no-system-no-punch flag (recon-build _ingest.dq)
// is role-blind and fires for these roles too — everyone, leaders included, must open the system.
function isExcludedRole(fn, team) {
  const f = (fn || '').toLowerCase(); const t = (team || '').toLowerCase();
  if (/team leader|senior|resolution specialist/.test(f)) return true;
  if (/\brta\b/.test(f) || f === 'rta') return true;
  if (t === 'wfm' || /\bwfm\b/.test(f)) return true;
  return false;
}

console.log('=== CORRECTED RECONCILIATION ENGINE ===');
console.log('foundation: ' + F.employees.length + ' employees, dates ' + F.meta.dateRange.join('..'));

// ===========================================================================
// LOAD SOURCE FILES (raw)
// ===========================================================================
function loadRaw(file) {
  const wb = XLSX.readFile(SRCDIR + file, { cellDates: false, raw: true });
  const sn = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false, raw: true });
}
const localDateFromSerial = (serial) => serialToISO(serial); // raw integer serial already = calendar date

// ---- ODOO ---- Code,Date,Day,In,Out,Total,Late In,Early Out,OT,Status
const odoo = {}; // key id|date -> {in,out,status}
let odooStatusByKey = {};
{
  const R = loadRaw('Odoo Fingerprint June.xlsx').slice(1);
  for (const r of R) {
    const id = r[0]; if (typeof id !== 'number') continue;
    const date = localDateFromSerial(r[1]); if (!date) continue;
    const inMin = serialTimeMin(r[3]); const outMin = serialTimeMin(r[4]);
    const status = r[9] == null ? null : String(r[9]).replace(/\s+/g, ' ').trim();
    odoo[id + '|' + date] = { punchIn: (r[3] != null ? inMin : null), punchOut: (r[4] != null ? outMin : null), status };
  }
  console.log('odoo fingerprints loaded: ' + Object.keys(odoo).length + ' keyed (id|date)');
}

// ---- PERMISSION & COMP ---- Employee,ID,Date,Type,From,To,TotalHrs,Status
const perms = {}; // key id|date -> [ {kind:'perm'|'comp', type, fromMin, toMin, hours, approved, status} ]
{
  const R = loadRaw('Permission & Compo June.xlsx').slice(1);
  for (const r of R) {
    const id = r[1]; if (typeof id !== 'number') continue;
    const date = localDateFromSerial(r[2]); if (!date) continue;
    const type = String(r[3] || '').trim();
    const status = String(r[7] || '').trim();
    const approved = /approved/i.test(status); // "HR Approved" => true; Pending/Waiting => false
    const isComp = /comp off/i.test(type);
    const rec = { kind: isComp ? 'comp' : 'perm', type, fromMin: parseClock(r[4]), toMin: parseClock(r[5]), hours: (typeof r[6] === 'number' ? r[6] : null), approved, status,
      covers: /late in/i.test(type) ? 'late' : /early out/i.test(type) ? 'early' : /full day/i.test(type) ? 'full' : /out\/in/i.test(type) ? 'both' : 'other' };
    (perms[id + '|' + date] = perms[id + '|' + date] || []).push(rec);
  }
  console.log('permission/comp loaded: ' + Object.keys(perms).length + ' keyed days, rows=' + Object.values(perms).reduce((s, a) => s + a.length, 0));
}

// absolute-minute timeline (base = 2026-05-31) so cross-midnight night shifts attribute correctly
const BASE = '2026-05-31';
const BASE_MS = new Date(BASE).getTime();
const dayOffset = (iso) => Math.round((new Date(iso) - new Date(BASE)) / 86400000); // days since base
const absMin = (iso, min) => dayOffset(iso) * 1440 + min;
const absToDM = (abs) => { const dayIdx = Math.floor(abs / 1440), min = ((abs % 1440) + 1440) % 1440; return { date: new Date(BASE_MS + dayIdx * 86400000).toISOString().slice(0, 10), min }; };

// ---- AMEYO ---- store ALL sessions per employee on the absolute timeline (shift-relative selection happens in build)
// Read columns BY HEADER NAME, never position (L-009): the file gained a "Username" (full-name) column at col 0,
// which used to shift every position-read by one and drop ALL login data (matched=0).
const ameyoSessions = {}; // id -> [{aLogin, aLogout}]
{
  const rows = loadRaw('Ameyo login and logout.xlsx');
  const H = (rows[0] || []).map(x => String(x || '').toLowerCase().trim());
  const ci = (...names) => { for (const n of names) { const i = H.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const cUser = ci('user id', 'userid'), cLd = ci('login date'), cLt = ci('login time'), cOd = ci('logout date'), cOt = ci('logout time');
  const R = rows.slice(1);
  let matched = 0, unmatched = 0;
  for (const r of R) {
    const user = String(r[cUser] || '').toLowerCase().trim();
    const id = F.byUser[user]; if (id == null) { unmatched++; continue; }
    const loginDate = localDateFromSerial(r[cLd]); if (!loginDate) continue;
    const loginMin = serialTimeMin(r[cLt]); if (loginMin == null) continue;
    const logoutDate = localDateFromSerial(r[cOd]) || loginDate;
    let logoutMin = serialTimeMin(r[cOt]);
    let aLogin = absMin(loginDate, loginMin);
    let aLogout = logoutMin == null ? aLogin : absMin(logoutDate, logoutMin);
    if (aLogout < aLogin) aLogout = aLogin; // guard
    (ameyoSessions[id] = ameyoSessions[id] || []).push({ aLogin, aLogout });
    matched++;
  }
  console.log('ameyo: matched rows=' + matched + ' unmatched=' + unmatched + ' employees=' + Object.keys(ameyoSessions).length);
}

// ---- SPRINKLR ---- same; degenerate sessions guarded. Read BY HEADER NAME (L-009). The Sprinklr `ID` is a
// USERNAME (m.abdulbaqi) → match byUser, not byEmail. Login/Logout are SEPARATE date-serial + time-fraction
// columns → combine them (the old code read the date column as a full datetime = midnight, dropping the time).
const sprinkSessions = {}; // id -> [{aLogin, aLogout}]
{
  const wb = XLSX.readFile(SRCDIR + 'Login and Logout sprinklr.xlsx', { cellDates: false, raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false, raw: true });
  const H = (rows[0] || []).map(x => String(x || '').toLowerCase().trim());
  const ci = (...names) => { for (const n of names) { const i = H.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const cId = ci('id', 'user id', 'username'), cLd = ci('login date'), cLt = ci('login time'), cOd = ci('logout date'), cOt = ci('logout tim', 'logout time');
  const R = rows.slice(1);
  let matched = 0, unmatched = 0, degenerate = 0;
  for (const r of R) {
    const lo = String(r[cId] || '').toLowerCase().trim();
    const id = (F.byUser[lo] != null ? F.byUser[lo] : F.byEmail[lo]); if (id == null) { unmatched++; continue; }
    const ld = localDateFromSerial(r[cLd]), lt = serialTimeMin(r[cLt]);
    const od = localDateFromSerial(r[cOd]) || ld, ot = serialTimeMin(r[cOt]);
    if (!ld || lt == null) { continue; }
    const aLogin = absMin(ld, lt); const aLogout = ot == null ? aLogin : absMin(od, ot);
    if (aLogout <= aLogin || (aLogout - aLogin) > 16 * 60) { degenerate++; continue; } // same-second / never-closed bleed
    (sprinkSessions[id] = sprinkSessions[id] || []).push({ aLogin, aLogout });
    matched++;
  }
  console.log('sprinklr: matched=' + matched + ' unmatched=' + unmatched + ' degenerateSkipped=' + degenerate + ' employees=' + Object.keys(sprinkSessions).length);
}

// dates whose SYSTEM evidence came from the sheet itself (recon-build relabels login_src honestly)
const sheetEvidenceDates = new Set();

// ---- EMBEDDED EVIDENCE (Phase-0 supplement, 2026-07-06) ----------------------------------
// The user's FINAL long-form sheet itself records the evidence per day (Punch In/Out cols 19/20,
// Permission Type/Duration/Status cols 26–28, Login/Logout System Time cols 29/30). When the four
// dedicated evidence files don't cover a date (e.g. June 1–27 after the 28–30 slice overwrote the
// month files), SUPPLEMENT from the sheet — NEVER override a key the dedicated loaders filled.
// This is the same evidence base those days were originally reconciled from; the point is to
// re-run it through the CORRECTED engine rules.
{
  const SRC = process.env.MANUAL_FILE || (SRCDIR + 'CC Schedule 26 June..xlsx');
  let wfhCarry = {};
  try { wfhCarry = JSON.parse(fs.readFileSync(SCRATCH + '/wfh-evidence.json', 'utf8')); } catch (e) { /* none exported */ }
  try {
    const wb = XLSX.readFile(SRC, { cellDates: false, raw: true });
    const sn = wb.SheetNames.find(n => /^(final|shift)/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false, raw: true });
    // day-coverage of the dedicated sources: any key on that date means the file covered the date
    const odooDates = new Set(Object.keys(odoo).map(k => k.split('|')[1]));
    const permDates = new Set(Object.keys(perms).map(k => k.split('|')[1]));
    const sysDates = new Set();
    for (const [id, ss] of Object.entries(ameyoSessions).concat(Object.entries(sprinkSessions)))
      for (const s of ss) sysDates.add(absToDM(s.aLogin).date);
    let addO = 0, addP = 0, addS = 0;
    const t = (v) => (typeof v === 'number') ? serialTimeMin(v) : parseClock(v);
    for (const r of rows.slice(1)) {
      const id = (typeof r[4] === 'number') ? r[4] : parseInt(r[4], 10); if (!id || isNaN(id)) continue;
      const date = (typeof r[0] === 'number') ? localDateFromSerial(r[0]) : null; if (!date) continue;
      const key = id + '|' + date;
      // punches + per-DAY WFH location → odoo shape (only if the Odoo file did not cover this DATE).
      // WFH evidence, in priority order: the sheet's per-day Location col (10) if the export kept it,
      // else the carried-forward wfh-evidence.json (dumped from live roster_days by
      // recon-export-wfh-evidence.js — the original file's Location column survives THERE after
      // later re-exports flattened it to "Office"). The engine's BR-WFH-001 reads it via odoo.status.
      if (!odooDates.has(date) && !odoo[key]) {
        const pi = t(r[18]), po = t(r[19]);
        const dayWFH = /wfh|work from home/i.test(String(r[10] || '')) || !!wfhCarry[key];
        if (pi != null || po != null || dayWFH) { odoo[key] = { punchIn: pi, punchOut: po, status: dayWFH ? 'WFH' : null }; addO++; }
      }
      // system window → one session on the absolute timeline (cross-midnight: logout < login = next day)
      if (!sysDates.has(date)) {
        const li = t(r[28]), lo = t(r[29]);
        if (li != null) {
          const aLogin = absMin(date, li);
          let aLogout = lo == null ? aLogin : absMin(date, lo) + (lo < li ? 1440 : 0);
          (ameyoSessions[id] = ameyoSessions[id] || []).push({ aLogin, aLogout });
          sheetEvidenceDates.add(date);
          addS++;
        }
      }
      // permission → perms shape (Duration is a TEXT window "4:00 PM - 6:00 PM" or an hour count — parse, never sum)
      if (!permDates.has(date) && !perms[key] && r[25] != null && String(r[25]).trim() !== '') {
        const type = String(r[25]).trim();
        const status = r[27] == null ? '' : String(r[27]).replace(/\s+/g, ' ').trim();
        let fromMin = null, toMin = null, hours = null;
        const dur = r[26];
        if (typeof dur === 'number') { hours = dur < 1 ? Math.round(dur * 24 * 100) / 100 : dur; } // time-fraction or hour count
        else if (dur != null) {
          const parts = String(dur).split(/\s*[-–]\s*/);
          if (parts.length === 2) { fromMin = parseClock(parts[0]); toMin = parseClock(parts[1]); }
        }
        perms[key] = [{ kind: /comp off/i.test(type) ? 'comp' : 'perm', type, fromMin, toMin, hours,
          approved: /approved/i.test(status), status,
          covers: /late in/i.test(type) ? 'late' : /early out/i.test(type) ? 'early' : /full day/i.test(type) ? 'full' : /out\/in/i.test(type) ? 'both' : 'other' }];
        addP++;
      }
    }
    if (addO + addP + addS > 0)
      console.log('embedded evidence supplemented from ' + SRC.split('/').pop() + ': punches+' + addO + ' systemSessions+' + addS + ' permissions+' + addP);
  } catch (e) { console.warn('embedded-evidence supplement skipped: ' + e.message); }
}

// Select the system window for a specific shift: sessions whose login lands within the shift
// window (+/- tolerance). Returns {loginMin, logoutMin, sessions} RELATIVE to the shift date (Dabs),
// or null. Cross-midnight safe because everything is on the absolute timeline.
function pickWindow(sessions, Dabs, schedStartMin, schedEndMin) {
  if (!sessions || !sessions.length) return null;
  const OT_MAX = 300;                                                           // plausible OT ceiling = 5h (user: avg 2h, sometimes 5h)
  const winLo = Dabs + (schedStartMin != null ? schedStartMin : 0) - 180;       // 3h grace before start
  const winHi = Dabs + (schedEndMin != null ? schedEndMin : 1440) + OT_MAX;     // include OT sessions up to +5h after shift end
  const shiftLen = (schedEndMin != null && schedStartMin != null) ? schedEndMin - schedStartMin : 540;
  const mid = Dabs + ((schedStartMin != null ? schedStartMin : 0) + (schedEndMin != null ? schedEndMin : 1440)) / 2;
  const endCap = Dabs + (schedEndMin != null ? schedEndMin : 1440) + OT_MAX;     // credit OT up to +5h; beyond = never-closed bleed
  const inWin = sessions.filter(s => s.aLogin >= winLo && s.aLogin <= winHi);
  if (!inWin.length) return null;
  // SMART bleed detection — a forgotten/never-closed re-open is identified by ALL three holding together:
  //   (a) it logs in AFTER the shift midpoint (a real work session starts near shift start),
  //   (b) it runs LONGER than the whole shift, and
  //   (c) it logs out past schedEnd+2h.
  // Only such sessions are dropped. A genuine long session (logs in near start) is NEVER dropped, so this can
  // never fabricate an early-out / false HR case. If every session is a bleed, fall back to all (then cap).
  const isBleed = (s) => s.aLogin > mid && (s.aLogout - s.aLogin) > shiftLen && s.aLogout > endCap;
  const clean = inWin.filter(s => !isBleed(s));
  const use = clean.length ? clean : inWin;
  let login = null, logout = null;
  for (const s of use) { login = (login == null) ? s.aLogin : Math.min(login, s.aLogin); logout = (logout == null) ? s.aLogout : Math.max(logout, s.aLogout); }
  let capped = false; if (logout > endCap) { logout = endCap; capped = true; }   // cap any residual bleed
  return { loginMin: login - Dabs, logoutMin: logout - Dabs, sessions: use.length, capped, droppedBleed: inWin.length - clean.length };
}

// data horizon = last date where a MEANINGFUL number of employees have attendance evidence
let horizon = '0000';
{
  // count distinct employees per date with ANY attendance evidence: an odoo punch OR a system
  // session (2026-07-06 fix — a punch-only count silently dropped days where the fingerprint
  // export was missing but 61 employees had system logins, e.g. 2026-06-27).
  const empByDate = {};
  for (const k in odoo) { const [id, d] = k.split('|'); if (odoo[k].punchIn != null) (empByDate[d] = empByDate[d] || new Set()).add(id); }
  for (const pool of [ameyoSessions, sprinkSessions])
    for (const id in pool) for (const s of pool[id]) { const d = absToDM(s.aLogin).date; (empByDate[d] = empByDate[d] || new Set()).add(id); }
  // upper bound = RECON_TO, else the uploaded schedule's last date — NOT a hardcoded June, so ANY month works
  const HZ_CAP = process.env.RECON_TO || (F.meta && F.meta.dateRange && F.meta.dateRange[1]) || '2999-12-31';
  for (const d in empByDate) if (d <= HZ_CAP && empByDate[d].size >= 10 && d > horizon) horizon = d;
}
console.log('data horizon (>=10 employees with punch or system evidence): ' + horizon);

module.exports = { classifyCode, isExcludedRole, F, odoo, perms, ameyoSessions, sprinkSessions, sheetEvidenceDates, pickWindow, dayOffset, absToDM, horizon, serialToISO, parseClock, hhmm, hhmmss, minToHHMMSS, dayName, OUT_XLSX, SCRATCH };

// run the build if invoked directly
if (require.main === module) require('./recon-build')();
