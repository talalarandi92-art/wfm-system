/**
 * Compare MY engine's output (records.json) against the USER's manual answer key
 * (CC Schedule › Shift sheet: their XLOOKUP'd Login/Logout System + Late/Early System Duration).
 * Emits a match-rate report + a discrepancy list to scratchpad/compare.json and console.
 */
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const fs = require('fs');
const SCRATCH = 'C:/Users/T573E~1.BAS/AppData/Local/Temp/claude/C--Users-t-bassam-Desktop-WFM-System/63e84c5a-2fd1-476e-8a73-031ad06b92a0/scratchpad/recon';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const M = { dayName: (iso) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()] };
const SRC = process.env.MANUAL_FILE || 'C:/Users/t.bassam/Desktop/new roster/CC Schedule 26 June..xlsx';
// the manual reconciliation sheet — the user's latest is named "Final" (older files used "Shifts."); override via MANUAL_SHEET
const SHEET_RE = process.env.MANUAL_SHEET ? new RegExp('^' + process.env.MANUAL_SHEET, 'i') : /^(final|shift)/i;
const recs = JSON.parse(fs.readFileSync(SCRATCH + '/records.json', 'utf8'));
const byKey = {}; for (const r of recs) byKey[r.id + '|' + r.date] = r;

const BASE_MS = new Date('2026-05-31').getTime();
const serialToISO = (s) => new Date(Math.round((Math.floor(s) - 25569) * 86400000)).toISOString().slice(0, 10);
const tmin = (v) => (typeof v === 'number' && v >= 0 && v < 2) ? Math.round(v * 1440) : null; // excel time fraction -> minutes
const toMin = (s) => { if (!s) return null; const m = String(s).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i); if (!m) return null; let h = +m[1], mn = +m[2]; if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } let v = h * 60 + mn; if (/\(\+1\)/.test(s)) v += 1440; if (/\(-1\)/.test(s)) v -= 1440; return v; };
const hhmm = (m) => m == null ? '—' : (String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 1440) + 1440) % 60).padStart(2, '0'));

(async () => {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SRC, { sharedStrings: 'cache', worksheets: 'emit', entries: 'emit' });
  let compared = 0, loginMatch = 0, lateMatch = 0, earlyMatch = 0, noMyRec = 0;
  const TOL = 6; // minutes tolerance
  const diffs = [];
  const allRows = [];
  for await (const ws of reader) {
    if (!SHEET_RE.test(ws.name || '')) { for await (const _ of ws) {} continue; }
    let r = 0;
    for await (const row of ws) {
      r++; if (r === 1) continue;
      const v = (row.values || []).map(x => { if (x == null) return null; if (typeof x === 'object') { if (x.result !== undefined) return x.result; if (x.text != null) return x.text; return null; } return x; });
      const id = v[5]; if (typeof id !== 'number') continue;
      const date = (typeof v[1] === 'number') ? serialToISO(v[1]) : null; if (!date) continue;
      const manLogin = tmin(v[29]), manLogout = tmin(v[30]);
      const manLate = (typeof v[31] === 'number') ? Math.round(v[31] * 1440) : null;
      const manEarly = (typeof v[32] === 'number') ? Math.round(v[32] * 1440) : null;
      if (manLogin == null && manLate == null && manEarly == null) continue; // only compare rows the user actually reconciled
      const mine = byKey[id + '|' + date];
      if (!mine) { noMyRec++; continue; }
      if (/Non-working|Absence/.test(mine.disp || '')) continue; // only compare ACTUAL working days (OFF/leave/holiday don't affect tardiness)
      compared++;
      const myLogin = toMin(mine.sysLogin), myLate = mine.rawLate, myEarly = mine.rawEarly;
      const lOk = (manLogin == null || myLogin == null) ? null : Math.abs(((myLogin % 1440) - (manLogin % 1440) + 720 + 1440) % 1440 - 720) <= TOL;
      const lateOk = (manLate == null) ? null : Math.abs((myLate || 0) - manLate) <= TOL;
      const earlyOk = (manEarly == null) ? null : Math.abs((myEarly || 0) - manEarly) <= TOL;
      if (lOk) loginMatch++; if (lateOk) lateMatch++; if (earlyOk) earlyMatch++;
      const isDiff = (lateOk === false || earlyOk === false || lOk === false);
      // ADJUDICATION — neither side is gospel. If a login lands OUTSIDE the shift window, that side likely grabbed
      // the wrong row / a midnight ping (a human XLOOKUP slip, or an engine mis-pick). Only judged for non-cross-
      // midnight shifts (clean comparison); cross-midnight diffs are marked "review together".
      const ss = tmin(v[15]), se = tmin(v[16]);
      const crossMid = (ss != null && se != null && se < ss);
      const outside = (m) => (m == null || ss == null || se == null) ? null : (m < ss - 180 || m > se + 120);
      let likely = '';
      if (isDiff) {
        if (crossMid) likely = 'review together (midnight shift)';
        else { const moOut = outside(manLogin), myOut = outside(myLogin);
          if (moOut && !myOut) likely = 'YOUR login outside shift — likely manual slip';
          else if (myOut && !moOut) likely = 'MY login outside shift — engine to check';
          else if ((mine.disp || '').includes('capped')) likely = 'open session capped — verify early-out';
          else likely = 'review together'; }
      }
      if (isDiff && diffs.length < 60) diffs.push({ id, date, name: v[4], code: v[14],
        manLogin: hhmm(manLogin), myLogin: hhmm(myLogin), manLate: hhmm(manLate), myLate: hhmm(myLate), manEarly: hhmm(manEarly), myEarly: hhmm(myEarly), disp: mine.disp, src: mine.src, likely });
      allRows.push({
        'Likely issue': likely,
        Match: isDiff ? '✗ DIFF' : '✓', Date: date, Day: M.dayName(date), Name: v[4], EmployeeID: id, Code: v[14],
        'My Login': hhmm(myLogin), 'Your Login': hhmm(manLogin), 'Login ✓': lOk == null ? '' : (lOk ? '✓' : '✗'),
        'My Late': hhmm(myLate), 'Your Late': hhmm(manLate), 'Late ✓': lateOk == null ? '' : (lateOk ? '✓' : '✗'),
        'My EarlyOut': hhmm(myEarly), 'Your EarlyOut': hhmm(manEarly), 'Early ✓': earlyOk == null ? '' : (earlyOk ? '✓' : '✗'),
        'My Logout': hhmm(toMin(mine.sysLogout)), 'Your Logout': hhmm(manLogout), 'My Disposition': mine.disp, Source: mine.src,
      });
    }
    break;
  }
  // side-by-side comparison workbook (diffs sorted to the top so we review them together)
  allRows.sort((a, b) => (a.Match === '✗ DIFF' ? 0 : 1) - (b.Match === '✗ DIFF' ? 0 : 1) || a.Date.localeCompare(b.Date) || a.Name.localeCompare(b.Name));
  const owb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(owb, XLSX.utils.json_to_sheet(allRows), 'Manual_vs_Engine');
  const outPath = 'C:/Users/t.bassam/Desktop/new roster/Manual_vs_Engine_Comparison.xlsx';
  XLSX.writeFile(owb, outPath);
  const pct = (a) => compared ? (100 * a / compared).toFixed(1) + '%' : '—';
  console.log('=== MY ENGINE vs YOUR MANUAL Shift sheet (tol ±' + TOL + 'min) ===');
  console.log('manual rows reconciled (with system/late/early): ' + compared);
  console.log('  no matching record in my engine: ' + noMyRec);
  console.log('  system LOGIN match:  ' + loginMatch + ' / ' + compared + '  (' + pct(loginMatch) + ')');
  console.log('  LATE match:          ' + lateMatch + ' / ' + compared + '  (' + pct(lateMatch) + ')');
  console.log('  EARLY-OUT match:     ' + earlyMatch + ' / ' + compared + '  (' + pct(earlyMatch) + ')');
  console.log('\nsample discrepancies (first 18):');
  for (const d of diffs.slice(0, 18)) console.log('  ' + d.date + ' ' + d.name + ' (' + d.id + ') ' + d.code + ' | login mine=' + d.myLogin + ' you=' + d.manLogin + ' | late mine=' + d.myLate + ' you=' + d.manLate + ' | early mine=' + d.myEarly + ' you=' + d.manEarly + ' | ' + d.disp + '/' + d.src);
  console.log('\nside-by-side comparison workbook → ' + outPath + ' (' + allRows.length + ' rows, diffs on top)');
  fs.writeFileSync(SCRATCH + '/compare.json', JSON.stringify({ compared, noMyRec, loginMatch, lateMatch, earlyMatch, diffs }, null, 2));
})();
