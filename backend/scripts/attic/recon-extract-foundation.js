/**
 * STAGE 0 — Extract the roster FOUNDATION + identity crosswalk from CC Schedule (107MB) ONCE,
 * and cache to small JSON so the reconciliation engine doesn't re-parse 107MB each run.
 *
 * Reads:
 *   CC Schedule.xlsx › "June"  = matrix (one row per employee, columns = dates 31-May..29-Jun)
 *   CC Schedule.xlsx › "Shift" = long form (one row per employee per day) → identity columns
 *
 * Writes (scratchpad/recon/):
 *   foundation.json = { dates:[{date,day}], employees:[{name,id,username,location,function, days:{date:rawCode}}], identity:{ id -> {id,userId,email,manager,gender,location,name} } }
 *
 * Read-only. No DB. No rules applied here — pure extraction.
 */
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');

const SRC = 'C:/Users/t.bassam/Desktop/new roster/CC Schedule.xlsx';
const OUT = 'C:/Users/T573E~1.BAS/AppData/Local/Temp/claude/C--Users-t-bassam-Desktop-WFM-System/63e84c5a-2fd1-476e-8a73-031ad06b92a0/scratchpad/recon/foundation.json';

// Excel serial date (1900 system, Excel's 1900-leap-bug) -> 'YYYY-MM-DD' (LOCAL, no TZ shift)
function serialToISO(serial) {
  if (typeof serial !== 'number') return null;
  // Excel epoch: serial 1 = 1900-01-01; with the 1900 leap bug, use 1899-12-30 as day 0.
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = days 1899-12-30..1970-01-01
  const d = new Date(ms);
  return d.toISOString().slice(0, 10); // serial is date-only & TZ-naive, so UTC slice is the intended calendar date
}
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayName(iso) { const d = new Date(iso + 'T00:00:00Z'); return DOW[d.getUTCDay()]; }

(async () => {
  console.log('[stage0] parsing June matrix via xlsx (capped to used range)...');
  const t0 = Date.now();
  const wbm = XLSX.readFile(SRC, { sheets: 'June', cellDates: false });
  const June = wbm.Sheets['June'];
  if (!June) { console.error('No June sheet'); process.exit(1); }
  const M = XLSX.utils.sheet_to_json(June, { header: 1, defval: null, blankrows: false, raw: true });
  console.log('[stage0] June rows=' + M.length + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  // Row 0 = labels (Name,ID,Username,Team,Location,Function). Row 1 = dates (serials from col 6). Row 2 = day abbrev.
  const dateRow = M[1] || [];
  const abbrRow = M[2] || []; // matrix's own Mon/Tue/... row — used to CROSS-CHECK our serial→date conversion
  const dates = [];
  const ABBR = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
  let dayMismatch = 0;
  for (let c = 6; c < dateRow.length; c++) {
    const v = dateRow[c];
    if (typeof v === 'number') {
      const iso = serialToISO(v); const dn = dayName(iso);
      const srcAbbr = abbrRow[c] != null ? String(abbrRow[c]).trim() : null;
      if (srcAbbr && ABBR[dn] !== srcAbbr) { dayMismatch++; if (dayMismatch <= 3) console.log('  [WARN] date ' + iso + ' computed ' + dn + ' but matrix says ' + srcAbbr); }
      dates.push({ col: c, date: iso, day: dn });
    }
  }
  console.log('[stage0] date columns=' + dates.length + ' range ' + (dates[0] && dates[0].date) + '..' + (dates[dates.length - 1] && dates[dates.length - 1].date) + ' | day-name cross-check mismatches=' + dayMismatch + (dayMismatch === 0 ? ' ✓' : ' ✗'));

  // Employee rows: ID (col1) is a number. Summary rows (Morning/Between/Night) have null ID.
  const employees = [];
  for (let r = 3; r < M.length; r++) {
    const row = M[r] || [];
    const id = row[1];
    if (typeof id !== 'number') continue; // skip summary / blank rows
    const days = {};
    for (const d of dates) { const raw = row[d.col]; if (raw != null && String(raw).trim() !== '') days[d.date] = String(raw).trim(); }
    employees.push({
      name: row[0] != null ? String(row[0]).trim() : null,
      id, username: row[2] != null ? String(row[2]).trim() : null,
      teamCol: row[3] != null ? String(row[3]).trim() : null,
      location: row[4] != null ? String(row[4]).trim() : null,
      function: row[5] != null ? String(row[5]).trim() : null,
      days,
    });
  }
  console.log('[stage0] employee rows in matrix=' + employees.length);

  // Identity crosswalk from "Shift" long-form sheet via exceljs (xlsx couldn't read it).
  console.log('[stage0] streaming Shift sheet for identity crosswalk...');
  const identity = {};            // id -> {...}
  const byUser = {};              // username -> id
  const byEmail = {};             // email(lower) -> id
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SRC, { sharedStrings: 'cache', worksheets: 'emit', entries: 'emit' });
  let header = null, shiftRows = 0;
  const cell = (v) => { if (v == null) return null; if (typeof v === 'object') { if (v.text != null) return String(v.text).trim(); if (v.result != null) return String(v.result).trim(); if (v.richText) return v.richText.map(t => t.text).join('').trim(); return null; } return String(v).trim(); };
  for await (const ws of reader) {
    if ((ws.name || '') !== 'Shift') {
      // drain non-Shift worksheets so the streaming reader stays in sync (don't load June's media into memory)
      for await (const _ of ws) { /* drain */ }
      continue;
    }
    for await (const row of ws) {
      const vals = row.values || []; // 1-indexed; vals[0] is unused
      if (!header) {
        const joined = vals.map(cell).join('|');
        if (/User ID/i.test(joined) && /Email/i.test(joined)) header = vals.map(cell);
        continue;
      }
      // 1-indexed columns: 1=Date 2=Day 3=Campaign 4=Name 5=ID 6=User ID 7=Team 8=Email 9=Team Manager 10=Gender 11=Location
      const id = vals[5];
      if (typeof id !== 'number') continue;
      if (!identity[id]) {
        const userId = cell(vals[6]), email = cell(vals[8]);
        identity[id] = { id, name: cell(vals[4]), userId, team: cell(vals[7]), email, manager: cell(vals[9]), gender: cell(vals[10]), location: cell(vals[11]) };
        if (userId) byUser[userId.toLowerCase()] = id;
        if (email) byEmail[email.toLowerCase()] = id;
      }
      shiftRows++;
    }
  }
  console.log('[stage0] Shift rows scanned=' + shiftRows + ' unique identities=' + Object.keys(identity).length);

  const out = { meta: { source: SRC, extractedRows: employees.length, dateRange: [dates[0] && dates[0].date, dates[dates.length - 1] && dates[dates.length - 1].date] }, dates, employees, identity, byUser, byEmail };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('[stage0] wrote ' + OUT + ' (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');

  // quick sanity: how many matrix employees have an identity match
  let matched = 0, noEmail = 0, noGender = 0; for (const e of employees) { const idn = identity[e.id]; if (idn) { matched++; if (!idn.email) noEmail++; if (!idn.gender) noGender++; } }
  console.log('[stage0] matrix employees with identity=' + matched + '/' + employees.length + ' | missing email=' + noEmail + ' missing gender=' + noGender);
  console.log('[stage0] sample identities:');
  for (const e of employees.slice(0, 3)) console.log('   ' + JSON.stringify(identity[e.id]));
  // distinct raw codes across the whole matrix (to drive the shift-code mapping audit)
  const codeCount = {}; for (const e of employees) for (const k in e.days) { const c = e.days[k]; codeCount[c] = (codeCount[c] || 0) + 1; }
  const codes = Object.entries(codeCount).sort((a, b) => b[1] - a[1]);
  console.log('[stage0] distinct raw roster codes=' + codes.length);
  console.log('   ' + codes.map(([c, n]) => c + ':' + n).join('  '));
})();
