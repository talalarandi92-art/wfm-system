/**
 * FOUNDATION v2 — build the roster foundation from the USER's FINAL long-form sheet
 * (CC Schedule 26 June..xlsx › "Shifts."), which carries, per employee/day:
 *   code (col14) + the user's EXACT scheduled Start/End (col15/16) + split Start2/End2 (col17/18)
 *   + full identity (ID, User ID, Email, Manager, Gender, Location, Function).
 *
 * Using the user's own scheduled times removes every shift-code/time mismatch
 * (e.g. Shaima B→B7) so the only remaining diffs are pure login/logout judgment.
 *
 * Writes scratchpad/recon/foundation.json (same shape the engine already reads),
 * PLUS a `schedule` map { "id|date": {start,end,start2,end2} } the engine prefers.
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const SRC = process.env.MANUAL_FILE || 'C:/Users/t.bassam/Desktop/new roster/CC Schedule 26 June..xlsx';
const SCRATCH = process.env.RECON_SCRATCH || require('path').join(__dirname, '..', '.recon-scratch');
require('fs').mkdirSync(SCRATCH, { recursive: true });
const OUT = SCRATCH + '/foundation.json';

const serialToISO = (s) => (typeof s === 'number') ? new Date(Math.round((Math.floor(s) - 25569) * 86400000)).toISOString().slice(0, 10) : null;
const tmin = (v) => { if (typeof v !== 'number') return null; const f = v - Math.floor(v); return Math.round(f * 1440); }; // excel time fraction -> minutes
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (iso) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
const cell = (v) => { if (v == null) return null; if (typeof v === 'object') { if (v.result !== undefined) return v.result; if (v.text != null) return String(v.text).trim(); if (v.richText) return v.richText.map(t => t.text).join('').trim(); return null; } return (typeof v === 'string') ? v.trim() : v; };

(async () => {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SRC, { sharedStrings: 'cache', worksheets: 'emit', entries: 'emit' });
  const employees = {}, identity = {}, byUser = {}, byEmail = {}, schedule = {}, dateSet = new Set();
  let scanned = 0;
  const SHEET_RE = process.env.MANUAL_SHEET ? new RegExp('^' + process.env.MANUAL_SHEET, 'i') : /^(final|shift)/i;
  for await (const ws of reader) {
    if (!SHEET_RE.test(ws.name || '')) { for await (const _ of ws) {} continue; }
    let r = 0;
    for await (const row of ws) {
      r++; if (r === 1) continue;
      const v = row.values || []; // 1-indexed
      const id = cell(v[5]); if (typeof id !== 'number') continue;
      // accept any date >= RECON_FROM (default Jun 1) — pre-June rows have no attendance source, so they're excluded;
      // the upper bound is open so the next upload (more June days, or a new month with its own attendance) just works.
      const date = serialToISO(cell(v[1])); if (!date || date < (process.env.RECON_FROM || '2026-06-01') || (process.env.RECON_TO && date > process.env.RECON_TO)) continue;
      scanned++; dateSet.add(date);
      const userId = cell(v[6]) ? String(cell(v[6])) : null;
      const email = cell(v[8]) ? String(cell(v[8])) : null;
      const code = cell(v[14]) != null ? String(cell(v[14])).trim() : null;
      if (!employees[id]) {
        employees[id] = { id, name: cell(v[4]), username: userId, teamCol: cell(v[7]), location: cell(v[11]), function: cell(v[12]) != null ? String(cell(v[12])) : null, days: {} };
        identity[id] = { id, name: cell(v[4]), userId, team: cell(v[7]), email, manager: cell(v[9]), gender: cell(v[10]), location: cell(v[11]) };
        if (userId) byUser[userId.toLowerCase()] = id;
        if (email) byEmail[email.toLowerCase()] = id;
      }
      if (code) employees[id].days[date] = code;
      // exact scheduled window from the user's sheet
      const s = tmin(cell(v[15])), e = tmin(cell(v[16])), s2 = tmin(cell(v[17])), e2 = tmin(cell(v[18]));
      if (s != null || e != null) schedule[id + '|' + date] = { start: s, end: e, start2: s2, end2: e2 };
    }
    break;
  }
  const dates = [...dateSet].sort().map(d => ({ date: d, day: dayName(d) }));

  // ── SUPPLEMENTAL PEOPLE (Director 2026-07-10) — people NOT on the ops schedule sheet ──────────
  // 1) fixedEmployees (recon-config.json): standing pattern — always <code>, WFH, OFF on the listed
  //    weekdays; generated for every horizon date. 2) supplementalMatrices: the Director's own matrix
  //    files (Name|ID|serial-date cols) for his direct team — merged for the listed ids only.
  try {
    const cfg = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'recon-config.json'), 'utf8'));
    const CANON = { B: { start: 540, end: 1080 } };   // fixed-pattern shift times (B 09:00-18:00); others fall back to classifyCode
    for (const fe of (cfg.fixedEmployees || [])) {
      if (employees[fe.id]) continue;   // ops sheet wins if they ever appear there
      employees[fe.id] = { id: fe.id, name: fe.name, username: null, teamCol: null, location: fe.wfh ? 'WFH' : null, function: fe.function || null, days: {} };
      identity[fe.id] = { id: fe.id, name: fe.name, userId: null, team: null, email: null, manager: null, gender: fe.gender || null, location: fe.wfh ? 'WFH' : null };
      for (const dd of dates) {
        const off = (fe.offDays || []).includes(dd.day);
        employees[fe.id].days[dd.date] = off ? 'OFF' : fe.code;
        if (!off && CANON[fe.code]) schedule[fe.id + '|' + dd.date] = { start: CANON[fe.code].start, end: CANON[fe.code].end, start2: null, end2: null };
      }
      console.log('[v2] fixed-pattern employee merged: ' + fe.name + ' #' + fe.id + ' (' + fe.code + ', WFH, OFF ' + (fe.offDays || []).join('+') + ')');
    }
    if ((cfg.supplementalMatrices || []).length) {
      const XLSX = require('xlsx');
      const serTo = s => new Date(Math.round((Math.floor(s) - 25569) * 86400000)).toISOString().slice(0, 10);
      for (const sm of cfg.supplementalMatrices) {
        let wb2; try { wb2 = XLSX.readFile(sm.path, { cellDates: false, raw: true }); } catch (e) { console.warn('[v2] supplemental matrix unreadable: ' + sm.path + ' — ' + e.message); continue; }
        const rows2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: null, blankrows: false, raw: true });
        const H2 = rows2[0] || [];
        const dcols = []; H2.forEach((h, i) => { if (typeof h === 'number' && h > 40000) dcols.push({ i, d: serTo(h) }); });
        let mergedDays = 0;
        for (const r of rows2.slice(1)) {
          const id = (typeof r[1] === 'number') ? r[1] : parseInt(r[1], 10);
          if (!id || isNaN(id) || !(sm.ids || []).includes(id)) continue;
          const sid = (cfg.supplementalIdentity || {})[String(id)] || {};
          if (!employees[id]) {
            employees[id] = { id, name: sid.name || String(r[0] || '').trim(), username: null, teamCol: null, location: null, function: sid.function || null, days: {} };
            identity[id] = { id, name: sid.name || String(r[0] || '').trim(), userId: null, team: null, email: null, manager: null, gender: sid.gender || null, location: null };
          }
          for (const { i, d } of dcols) {
            if (d < (process.env.RECON_FROM || '2026-06-01') || (process.env.RECON_TO && d > process.env.RECON_TO)) continue;
            const code = r[i] == null ? null : String(r[i]).trim();
            if (code && !employees[id].days[d]) { employees[id].days[d] = code; mergedDays++; }
          }
        }
        if (mergedDays) console.log('[v2] supplemental matrix merged: ' + sm.path.split('/').pop() + ' → +' + mergedDays + ' person-days for ids ' + (sm.ids || []).join(','));
      }
    }
  } catch (e) { console.warn('[v2] supplemental-people merge skipped: ' + e.message); }

  const out = { meta: { source: SRC, version: 2, extractedRows: scanned, employees: Object.keys(employees).length, dateRange: [dates[0] && dates[0].date, dates[dates.length - 1] && dates[dates.length - 1].date] }, dates, employees: Object.values(employees), identity, byUser, byEmail, schedule };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('[v2] rows=' + scanned + ' employees=' + Object.keys(employees).length + ' dates=' + dates.length + ' (' + out.meta.dateRange.join('..') + ') schedule-keys=' + Object.keys(schedule).length);
  // sanity: Shaima B7 should now be 09:00-16:00
  const sh = Object.values(employees).find(e => /Shaima/.test(e.name || ''));
  if (sh) { const k = Object.keys(schedule).find(x => x.startsWith(sh.id + '|') && /B7|B/.test(employees[sh.id].days[x.split('|')[1]] || '')); if (k) { const w = schedule[k]; console.log('[v2] sample ' + sh.name + ' ' + k + ' code=' + employees[sh.id].days[k.split('|')[1]] + ' sched=' + (w.start) + '-' + (w.end) + ' min'); } }
})();
