#!/usr/bin/env node
/*
 * SOURCE-TRUTH VERIFICATION — compare what landed in roster_days against the RAW workbook,
 * cell by cell, instead of checking the database against itself.
 *
 * Every other harness here asks whether the data is internally consistent. That is necessary
 * and not sufficient: an engine can be perfectly self-consistent about a number it read wrong.
 * This one re-opens the Director's own file and asks a blunter question — for each person-day,
 * does the shift code in the database equal the shift code in the sheet, and do the punch
 * times equal the punch times in Odoo's export.
 *
 *   node scripts/verify-against-source.js <srcdir> <from> <to> [sheet]
 */
const XLSX = require('xlsx');
const { getClient } = require('./recon-db');

const SRCDIR = process.argv[2] || './.recon-src-julaug/';
const FROM = process.argv[3] || '2026-07-25';
const TO = process.argv[4] || '2026-08-01';
const SHEET = process.argv[5] || 'Shift';

const serToISO = (n) => (typeof n !== 'number' ? null
  : new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10));
const serToMin = (n) => (typeof n !== 'number' ? null : Math.round((n - Math.floor(n)) * 1440));
const norm = (s) => String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');

(async () => {
  /* ---- read the schedule the Director actually sent ---- */
  const wb = XLSX.readFile(SRCDIR + 'CC Schedule 26 June..xlsx', { cellDates: false, raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: null, blankrows: false, raw: true });
  const H = (rows[0] || []).map(x => String(x || '').trim().toLowerCase());
  const ix = (n) => H.indexOf(n);
  const cDate = ix('date'), cId = ix('id'), cShift = ix('shift'),
        cStart = ix('shift start time'), cEnd = ix('shift end time');

  const src = new Map();               // "id|date" -> { code, start, end }
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i];
    const d = serToISO(v[cDate]), id = v[cId] == null ? null : String(v[cId]).trim();
    if (!d || !id || d < FROM || d > TO) continue;
    src.set(id + '|' + d, {
      code: norm(v[cShift]),
      start: serToMin(v[cStart]),
      end: serToMin(v[cEnd]),
    });
  }

  /* ---- read Odoo's punches ---- */
  const fw = XLSX.readFile(SRCDIR + 'Odoo Fingerprint June.xlsx', { cellDates: false, raw: true });
  const fr = XLSX.utils.sheet_to_json(fw.Sheets[fw.SheetNames[0]], { header: 1, defval: null, blankrows: false, raw: true });
  const FH = (fr[0] || []).map(x => String(x || '').trim().toLowerCase());
  const fCode = FH.indexOf('code'), fDate = FH.indexOf('date'), fIn = FH.indexOf('in');
  const punch = new Map();
  for (let i = 1; i < fr.length; i++) {
    const v = fr[i];
    const d = serToISO(v[fDate]) || (typeof v[fDate] === 'string' ? v[fDate].slice(0, 10) : null);
    const id = v[fCode] == null ? null : String(v[fCode]).trim();
    if (!d || !id || d < FROM || d > TO) continue;
    const t = serToMin(v[fIn]);
    if (t != null) punch.set(id + '|' + d, t);
  }

  /* ---- what the database says ---- */
  const c = getClient(); await c.connect();
  const { rows: db } = await c.query(
    `SELECT COALESCE(employee_no, person_no) AS eid, person_no, work_date::text d,
            shift_code, shift_start_min ss, shift_end_min se, punch_in_min pin
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2`, [FROM, TO]);

  let codeOk = 0, codeBad = 0, timeOk = 0, timeBad = 0, punchOk = 0, punchBad = 0, notInSrc = 0;
  const badCode = [], badTime = [], badPunch = [];
  const seen = new Set();

  for (const r of db) {
    /* Identity folds intern 6xxxx into full-time 1xxxx, so try both keys before calling a row
       absent from the source — a fold mismatch would otherwise read as missing data. */
    const k1 = String(r.eid) + '|' + r.d, k2 = String(r.person_no) + '|' + r.d;
    const s = src.get(k1) || src.get(k2);
    if (!s) { notInSrc++; continue; }
    seen.add(src.has(k1) ? k1 : k2);

    if (s.code && norm(r.shift_code) === s.code) codeOk++;
    else if (s.code) { codeBad++; if (badCode.length < 8) badCode.push({ id: r.eid, d: r.d, sheet: s.code, db: norm(r.shift_code) }); }

    if (s.start != null && r.ss != null) {
      if (Math.abs(Number(r.ss) - s.start) <= 1) timeOk++;
      else { timeBad++; if (badTime.length < 8) badTime.push({ id: r.eid, d: r.d, sheet: s.start, db: Number(r.ss) }); }
    }

    const p = punch.get(k1) != null ? punch.get(k1) : punch.get(k2);
    if (p != null && r.pin != null) {
      if (Math.abs(Number(r.pin) - p) <= 1) punchOk++;
      else { punchBad++; if (badPunch.length < 8) badPunch.push({ id: r.eid, d: r.d, odoo: p, db: Number(r.pin) }); }
    }
  }
  const missingFromDb = [...src.keys()].filter(k => !seen.has(k)).length;

  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) + '%' : '—');
  console.log(`\nSOURCE-TRUTH VERIFICATION  ${FROM} → ${TO}   (sheet "${SHEET}")`);
  console.log(`  source person-days: ${src.size}   database rows: ${db.length}`);
  console.log(`\n  shift CODE matches the sheet      ${codeOk}/${codeOk + codeBad}   ${pct(codeOk, codeOk + codeBad)}`);
  console.log(`  shift START TIME matches the sheet ${timeOk}/${timeOk + timeBad}   ${pct(timeOk, timeOk + timeBad)}`);
  console.log(`  punch-in matches Odoo              ${punchOk}/${punchOk + punchBad}   ${pct(punchOk, punchOk + punchBad)}`);
  console.log(`\n  rows in DB with no source row:     ${notInSrc}`);
  console.log(`  source person-days never landed:   ${missingFromDb}`);
  if (badCode.length) { console.log('\n  CODE mismatches (first few):'); console.table(badCode); }
  if (badTime.length) { console.log('\n  START-TIME mismatches (first few):'); console.table(badTime); }
  if (badPunch.length) { console.log('\n  PUNCH mismatches (first few):'); console.table(badPunch); }
  const clean = codeBad === 0 && timeBad === 0 && punchBad === 0 && missingFromDb === 0;
  console.log('\n  ' + (clean ? 'CLEAN — the database says what the source says.'
                              : 'DIFFERENCES FOUND — see above; each is either a bug or a rule the comparison does not know.'));
  await c.end();
  if (!clean) process.exitCode = 1;
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
