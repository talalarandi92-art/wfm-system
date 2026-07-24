#!/usr/bin/env node
/**
 * OVERTIME WORKBOOK INGEST — reads every OT workbook the Director drops in
 * `Desktop/Overtime 2026` and lands each row in `ot_source_rows` with full
 * provenance (file · sheet · row). Re-runnable: a file is replaced wholesale by
 * its own rows, so re-dropping a corrected workbook simply corrects the ledger.
 *
 * IT DOES NOT DEDUPLICATE. The sheets overlap on purpose (`Details` +
 * `All New+ Old` + `New`; `FULL SYSTEM` + `Normal Days` + `Day OFF`; two
 * End-Of-Year files). One value per person-day is decided at READ time so the
 * 46 genuine conflicts stay visible instead of being silently resolved here.
 *
 * WHAT IT HANDLES, because the real files are not uniform:
 *   • the hours column is `OV` in some workbooks and `OT` in others
 *   • dates arrive as Excel dates AND as `d/m/yyyy` text (National Day)
 *   • one workbook (Israa Wal Miraj) has NO date column — those rows are stored
 *     at MONTH precision rather than having a day invented for them
 *   • every row's date is cross-checked against the file's own `Day` column;
 *     a disagreement is flagged, never corrected silently
 *
 *   node scripts/ot-source-ingest.js [dir] [--dry]
 */
const fs = require('fs'), path = require('path'), XLSX = require('xlsx'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'C:/Users/t.bassam/Desktop/Overtime 2026';
const DRY = process.argv.includes('--dry');
const TENANT = process.env.DEFAULT_TENANT_ID || 'a0000000-0000-0000-0000-000000000001';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const d2s = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Excel date, or `d/m/yyyy` / `dd-mm-yyyy` text. Returns a local Date or null. */
function toDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);          // d/m/yyyy — Kuwaiti convention
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  return null;
}

/** "SS, Arafat Day and Eid Al Adha May 26 CC Overtime Final..xlsx" → a short occasion label. */
function occasionOf(file) {
  return file
    .replace(/\.xlsx?$/i, '').replace(/\.+$/, '')
    .replace(/\s*CC\s*Overtime\s*/ig, ' ').replace(/\s*Overtime\s*/ig, ' ')
    .replace(/\s*-?\s*Updated\s*Final\s*with\s*total/ig, '').replace(/\s*\bfinal\b\s*/ig, ' ')
    .replace(/\s{2,}/g, ' ').trim() || file;
}

/** The month a dateless sheet belongs to, read from its own file name. */
function monthFromName(file) {
  const M = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
              jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const y = (file.match(/\b(20\d{2})\b/) || [])[1] || '2026';
  const mo = (file.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i) || [])[1];
  return mo ? `${y}-${M[mo.toLowerCase()]}` : null;
}

function parseWorkbook(file, full) {
  const wb = XLSX.readFile(full, { cellDates: true });
  const out = [], skipped = [];
  const occasion = occasionOf(file);
  const fallbackMonth = monthFromName(file);

  for (const sheet of wb.SheetNames) {
    const objs = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: null });
    if (!objs.length) continue;
    const keys = Object.keys(objs[0]);
    const find = (re) => keys.find((k) => re.test(String(k).trim()));
    const hCol = find(/^(ov|ot)$/i), idCol = find(/^id$/i);
    if (!hCol || !idCol) continue;                       // not an OT detail sheet
    const dCol = find(/^date$/i), nCol = find(/^name\s*$/i), sCol = find(/^shift$/i);
    const dayCol = find(/^day$/i), locCol = find(/^location$/i), noteCol = find(/^(note|daily note|manager comment)$/i);

    objs.forEach((o, i) => {
      const hours = Number(o[hCol]);
      if (!(hours > 0)) return;
      const personNo = o[idCol] == null ? '' : String(o[idCol]).trim().replace(/\.0$/, '');
      if (!personNo || !/^\d+$/.test(personNo)) { skipped.push({ sheet, row: i + 2, why: `unusable ID "${o[idCol]}"` }); return; }

      const dt = dCol ? toDate(o[dCol]) : null;
      let dq = null;
      if (dt && dayCol && o[dayCol]) {                    // the file's own Day column is the oracle
        const his = String(o[dayCol]).trim(), mine = DOW[dt.getDay()];
        if (mine !== his && mine.slice(0, 3).toLowerCase() !== his.slice(0, 3).toLowerCase())
          dq = `day-name-mismatch: file says ${his}, ${d2s(dt)} is ${mine}`;
      }
      const periodMonth = dt ? d2s(dt).slice(0, 7) : fallbackMonth;
      if (!periodMonth) { skipped.push({ sheet, row: i + 2, why: 'no date and no month in the file name' }); return; }

      out.push({
        personNo, employeeName: nCol ? String(o[nCol] ?? '').trim() || null : null,
        workDate: dt ? d2s(dt) : null, datePrecision: dt ? 'day' : 'month', periodMonth,
        hours: Math.round(hours * 100) / 100,
        shiftCode: sCol ? String(o[sCol] ?? '').trim() || null : null,
        location: locCol ? String(o[locCol] ?? '').trim() || null : null,
        note: noteCol ? String(o[noteCol] ?? '').trim() || null : null,
        occasion, sourceFile: file, sourceSheet: sheet, sourceRow: i + 2, dataQuality: dq,
      });
    });
  }
  return { rows: out, skipped };
}

(async () => {
  if (!fs.existsSync(DIR)) { console.error(`folder not found: ${DIR}`); process.exit(1); }
  const files = fs.readdirSync(DIR)
    .filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$') && !/OV\s*CALCULATION/i.test(f))
    .sort();
  console.log(`OT source ingest — ${files.length} workbook(s) in ${DIR}${DRY ? '   [DRY RUN]' : ''}\n`);

  const all = []; const allSkipped = [];
  for (const f of files) {
    const { rows, skipped } = parseWorkbook(f, path.join(DIR, f));
    const hrs = rows.reduce((a, r) => a + r.hours, 0);
    const undated = rows.filter((r) => r.datePrecision === 'month').length;
    const flagged = rows.filter((r) => r.dataQuality).length;
    console.log(`  ${String(rows.length).padStart(5)} rows ${String(Math.round(hrs)).padStart(6)} h` +
      `${undated ? `  (${undated} undated)` : ''}${flagged ? `  (${flagged} flagged)` : ''}${skipped.length ? `  (${skipped.length} skipped)` : ''}  ${f}`);
    skipped.slice(0, 3).forEach((s) => console.log(`        skip ${s.sheet} r${s.row}: ${s.why}`));
    all.push(...rows); allSkipped.push(...skipped);
  }

  // What the ledger will look like once read back with one value per person-day.
  const g = new Map();
  for (const r of all) {
    const k = `${r.personNo}|${r.workDate || r.periodMonth}`;
    (g.get(k) || g.set(k, []).get(k)).push(r.hours);
  }
  let conflicts = 0;
  for (const v of g.values()) if (new Set(v.map((x) => Math.round(x * 100))).size > 1) conflicts++;
  const naive = all.reduce((a, r) => a + r.hours, 0);
  const deduped = [...g.values()].reduce((a, v) => a + Math.max(...v), 0);
  console.log(`\n  TOTAL ${all.length} rows · ${Math.round(naive)} h stacked` +
    `  →  ${g.size} person-days · ${Math.round(deduped)} h deduped  (double-count avoided: ${Math.round(naive - deduped)} h)`);
  console.log(`  person-days where the sheets DISAGREE on the hours: ${conflicts}`);
  if (allSkipped.length) console.log(`  skipped rows: ${allSkipped.length}`);

  if (DRY) { console.log('\n[DRY RUN] nothing written.'); return; }

  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  try {
    await c.query('BEGIN');
    // Replace each ingested file wholesale — a corrected workbook corrects its own rows
    // and can never leave a stale half behind. Files NOT in this run are left untouched.
    for (const f of files) await c.query(`DELETE FROM ot_source_rows WHERE tenant_id=$1 AND source_file=$2`, [TENANT, f]);
    const CH = 500;
    for (let i = 0; i < all.length; i += CH) {
      const chunk = all.slice(i, i + CH);
      const vals = [], ps = [];
      chunk.forEach((r, j) => {
        const b = j * 14;
        ps.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14})`);
        vals.push(TENANT, r.personNo, r.employeeName, r.workDate, r.datePrecision, r.periodMonth,
          r.hours, r.shiftCode, r.location, r.note, r.occasion, r.sourceFile, r.sourceSheet, r.sourceRow);
      });
      await c.query(
        `INSERT INTO ot_source_rows
           (tenant_id, person_no, employee_name, work_date, date_precision, period_month,
            hours, shift_code, location, note, occasion, source_file, source_sheet, source_row)
         VALUES ${ps.join(',')}
         ON CONFLICT (tenant_id, source_file, source_sheet, source_row) DO NOTHING`, vals);
    }
    // data-quality flags applied separately so the bulk insert stays one shape
    for (const r of all.filter((x) => x.dataQuality))
      await c.query(`UPDATE ot_source_rows SET data_quality=$5
                      WHERE tenant_id=$1 AND source_file=$2 AND source_sheet=$3 AND source_row=$4`,
        [TENANT, r.sourceFile, r.sourceSheet, r.sourceRow, r.dataQuality]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; }

  const [tot] = (await c.query(
    `SELECT COUNT(*)::int rows, COUNT(DISTINCT person_no)::int people,
            ROUND(SUM(hours),2) hours, COUNT(*) FILTER (WHERE date_precision='month')::int undated,
            COUNT(*) FILTER (WHERE data_quality IS NOT NULL)::int flagged
       FROM ot_source_rows WHERE tenant_id=$1`, [TENANT])).rows;
  console.log(`\n✅ ledger now holds ${tot.rows} rows · ${tot.people} people · ${tot.hours} h stacked · ${tot.undated} undated · ${tot.flagged} flagged`);
  await c.end();
})().catch((e) => { console.error('INGEST ERROR:', e.message); process.exit(1); });
