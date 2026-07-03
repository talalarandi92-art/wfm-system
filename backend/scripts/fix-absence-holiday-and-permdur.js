/**
 * One-shot data repair (2026-07-03) — aligns legacy rows with the corrected engine:
 *  1) A-suffix absence rows that the OLD pipeline stamped presence='holiday' → 'absent'
 *     (the corrected recon-build maps kind=absence → presence='absent' unconditionally;
 *      hr_code is already 'A' on these rows, so analysis/shrinkage just wasn't seeing them).
 *  2) June permission_duration backfill — June 1..27 was ingested BEFORE the engine
 *     emitted permDur; rebuilds the "h:mm AM → h:mm PM (Xh)" text from the source
 *     Permission & Compo June.xlsx for rows where permission_type IS NOT NULL AND
 *     permission_duration IS NULL. Idempotent; only fills NULLs.
 */
const XLSX = require('xlsx');
const { getClient } = require('./recon-db.js');

function parseClock(str) {
  if (str == null) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = +m[1]; const mn = +m[2];
  if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h * 60 + mn;
}
const clock12 = (min) => {
  if (min == null) return '';
  const h24 = Math.floor(min / 60) % 24, m = min % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM'; const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
};
const localDateFromSerial = (v) => {
  if (typeof v !== 'number') return null;
  const d = new Date(Math.round((v - 25569) * 86400 * 1000));
  return d.toISOString().slice(0, 10);
};

(async () => {
  const c = getClient(); await c.connect();
  const dry = process.argv.includes('--dry');

  // ---- 1) A-on-holiday → absent ----
  const before = await c.query(`SELECT COUNT(*)::int n FROM roster_days WHERE upper(COALESCE(hr_code,''))='A' AND presence='holiday'`);
  console.log('[1] A-suffix rows stuck on presence=holiday:', before.rows[0].n);
  if (!dry && before.rows[0].n) {
    const r = await c.query(`UPDATE roster_days SET presence='absent' WHERE upper(COALESCE(hr_code,''))='A' AND presence='holiday'`);
    console.log('[1] updated:', r.rowCount);
  }

  // ---- 2) June permission_duration backfill ----
  // The SRCDIR June file was overwritten with the 28–30 test slice, so source the full-month
  // durations from the year-wide Odoo exports (Update/(47) is freshest for 2026, All Data as fallback).
  const SOURCES = [
    'C:/Users/t.bassam/Desktop/Update/Attendance Permissions (attendance.permissions) (47).xlsx',
    'C:/Users/t.bassam/Desktop/All Data/Attendance Permissions ODOO.xlsx',
    'C:/Users/t.bassam/Desktop/new roster/Permission & Compo June.xlsx',
  ];
  const durByKey = {}; // id|date -> duration text (first non-comp permission, same pick as the engine)
  for (const file of SOURCES) {
    let rows;
    try { const wb = XLSX.readFile(file); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1); }
    catch (e) { console.log('[2] skip unreadable source:', file, e.message); continue; }
    let added = 0;
    for (const r of rows) {
      const id = r[1]; if (typeof id !== 'number') continue;
      const date = localDateFromSerial(r[2]); if (!date) continue;
      const type = String(r[3] || '').trim(); if (/comp off/i.test(type)) continue;
      const from = parseClock(r[4]); if (from == null) continue;
      const to = parseClock(r[5]);
      const hours = typeof r[6] === 'number' ? Math.round(r[6] * 100) / 100 : null;
      const key = id + '|' + date;
      if (!(key in durByKey)) { durByKey[key] = clock12(from) + ' → ' + clock12(to) + (hours != null ? ' (' + hours + 'h)' : ''); added++; }
    }
    console.log('[2] source', file.split('/').pop(), '→ +', added, 'keys');
  }
  console.log('[2] durations parsed from sources:', Object.keys(durByKey).length);

  const targets = await c.query(`SELECT COALESCE(person_no,employee_no) pid, work_date::text d
    FROM roster_days WHERE permission_type IS NOT NULL AND permission_duration IS NULL
      AND work_date BETWEEN '2026-06-01' AND '2026-06-27'`);
  let hit = 0, miss = 0;
  for (const t of targets.rows) {
    const dur = durByKey[t.pid + '|' + t.d];
    if (!dur) { miss++; continue; }
    hit++;
    if (!dry) await c.query(
      `UPDATE roster_days SET permission_duration=$1
        WHERE COALESCE(person_no,employee_no)=$2 AND work_date=$3 AND permission_type IS NOT NULL AND permission_duration IS NULL`,
      [dur, t.pid, t.d]);
  }
  console.log(`[2] June NULL-duration rows: ${targets.rows.length} → backfilled ${hit}, no source match ${miss}${dry ? ' (DRY RUN)' : ''}`);

  // verify
  const after = await c.query(`SELECT
     (SELECT COUNT(*)::int FROM roster_days WHERE upper(COALESCE(hr_code,''))='A' AND presence='holiday') stuck,
     (SELECT COUNT(*)::int FROM roster_days WHERE permission_type IS NOT NULL AND permission_duration IS NOT NULL AND work_date BETWEEN '2026-06-01' AND '2026-06-27') withdur`);
  console.log('[verify] A-on-holiday remaining:', after.rows[0].stuck, '| June perms with duration:', after.rows[0].withdur);
  await c.end();
})().catch(e => { console.error('ERR', e); process.exit(1); });
