/**
 * fill-supervisory-june.js — put the RTA / Team-Leader / Resolution / Management people's
 * June 1–27 SHIFTS into roster_days so the HR Matrix is no longer blank for them.
 *
 * WHY: these record-only supervisory people exist in the June source (Final sheet) but were
 * dropped from the June 1–27 build (the deferred "June missing people" incident) — so they have
 * rows only for 28–30. The HR Matrix (COALESCE(hr_code,attendance_code,shift_code,'OFF') per
 * person×date) therefore shows empty cells for them across 06-01..06-27.
 *
 * WHAT: read their REAL scheduled codes from the source Final sheet, classify with the ENGINE's
 * own classifyCode (correct shift/OFF/leave/H/WFH + hr_code), and ADDITIVELY insert ONLY the
 * (person_no, work_date) rows that don't already exist. It NEVER touches the 103 existing people.
 * These are record-only rows (shift plan shown; NO fabricated attendance — worked/late/OT stay NULL,
 * include_tardiness=false). A data_quality marker labels them so they're clearly a schedule fill,
 * superseded by the full June rebuild once fresh sources land, and trivially reversible.
 *
 *   DRY-RUN:  node scripts/fill-supervisory-june.js
 *   APPLY:    node scripts/fill-supervisory-june.js --apply
 *   UNDO:     DELETE FROM roster_days WHERE data_quality = 'Schedule-only fill — RTA/Leaders/Management (June 1-27); attendance pending full rebuild';
 */
const ExcelJS = require('exceljs');
const { classifyCode, isExcludedRole } = require('./recon-new-roster');
const { getClient } = require('./recon-db');
const fs = require('fs');

const dir = 'C:/Users/t.bassam/Desktop/new roster/';
const SRC = dir + fs.readdirSync(dir).filter(x => /May 30.*June to 27\.xlsx$/i.test(x))[0];
const SHEET_RE = /^final/i;
const FROM = '2026-06-01', TO = '2026-06-27';
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const DQ_MARK = 'Schedule-only fill — RTA/Leaders/Management (June 1-27); attendance pending full rebuild';
// RTA (11571,13234,12377) · Team Leaders (9565,11603,13827) · Resolution (9569,10083)
const TARGET_IDS = new Set([9565, 11571, 9569, 11603, 13827, 10083, 13234, 12377]);
const APPLY = process.argv.includes('--apply');

const serialToISO = (s) => (typeof s === 'number') ? new Date(Math.round((Math.floor(s) - 25569) * 86400000)).toISOString().slice(0, 10) : null;
const tmin = (v) => { if (typeof v !== 'number') return null; return Math.round((v - Math.floor(v)) * 1440); };
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (iso) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
const cell = (v) => { if (v == null) return null; if (typeof v === 'object') { if (v.result !== undefined) return v.result; if (v.text != null) return String(v.text).trim(); if (v.richText) return v.richText.map(t => t.text).join('').trim(); return null; } return (typeof v === 'string') ? v.trim() : v; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekNum = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const sinceSat = (d.getUTCDay() + 1) % 7; const ws = new Date(d); ws.setUTCDate(d.getUTCDate() - sinceSat); const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); const fws = new Date(jan1); fws.setUTCDate(jan1.getUTCDate() - ((jan1.getUTCDay() + 1) % 7)); return Math.floor((ws - fws) / (7 * 86400000)) + 1; };

function buildRow(rc) {
  const raw = rc.code;
  const c = classifyCode(raw, rc.id);
  // prefer the user's EXACT scheduled times from the sheet (same as the engine's foundation override)
  let st = rc.s, en = (rc.e2 != null ? rc.e2 : rc.e);
  if (en != null && st != null && en <= st) en += 1440;
  if (st != null && en != null && (c.kind === 'work' || c.kind === 'wfh')) { c.start = st; c.end = en; c.gross = en - st; c.net = (en - st) - 60; c.crossMidnight = en > 1440; }
  const isWorkingKind = (c.kind === 'work' || c.kind === 'wfh');
  const locWFH = /wfh/i.test(rc.location || '');
  const isWFH = isWorkingKind && (c.kind === 'wfh' || locWFH);
  const excluded = isExcludedRole(rc.fn, rc.team) || !!c.management;
  const RAW = String(raw || '').toUpperCase();
  let hrCode, attCode = raw;
  if (c.kind === 'sick') { hrCode = 'SL'; attCode = (raw && String(raw).length > 1) ? raw : 'SL'; }
  else if (c.kind === 'absence') { hrCode = 'A'; attCode = (raw && String(raw).length > 1) ? raw : 'A'; }
  else if (c.kind === 'off') { hrCode = /transfer/i.test(RAW) ? 'Transfer' : 'OFF'; attCode = 'OFF'; }
  else if (c.kind === 'leave') { hrCode = (['DL', 'UPL'].includes(RAW) ? RAW : 'L'); attCode = hrCode; }
  else if (c.kind === 'holiday') { hrCode = 'H'; attCode = 'H'; }
  else if (c.kind === 'comp') { hrCode = 'COMP'; attCode = 'COMP'; }
  else if (c.kind === 'sep') { hrCode = RAW || 'RES'; attCode = hrCode; }
  else if (isWorkingKind) { hrCode = isWFH ? 'WFH' : (c.norm || raw); attCode = c.norm || raw; }
  else { hrCode = raw || 'OFF'; attCode = raw || 'OFF'; }
  const presence = isWorkingKind ? (isWFH ? 'wfh' : 'office')
    : c.kind === 'sick' ? 'sick' : c.kind === 'leave' ? 'leave' : c.kind === 'absence' ? 'absent'
      : c.kind === 'holiday' ? 'holiday' : 'off';
  return {
    tenant_id: TENANT, employee_no: String(rc.id), person_no: String(rc.id), name: rc.name, clean_name: rc.name,
    function_name: rc.fn, role_function: rc.fn, work_date: rc.date, day_name: dayName(rc.date),
    status: raw, presence, location: isWFH ? 'WFH' : 'Office',
    shift_code: c.norm, shift_category: c.norm,
    shift_start_min: c.start != null ? c.start : null,
    shift_end_min: (c.end != null && c.end > 1440) ? c.end - 1440 : (c.end != null ? c.end : null),
    crosses_midnight: !!c.crossMidnight, original_shift_code: c.origin || null,
    hr_code: hrCode, attendance_code: attCode,
    expected_hours: c.net != null ? +(c.net / 60).toFixed(2) : null,
    role_category: excluded ? (c.management ? 'Management' : 'Excluded') : 'Agent',
    include_tardiness: false,          // record-only supervisory — never counts for tardiness/OT rankings
    week_number: weekNum(rc.date), month_name: MONTHS[+rc.date.slice(5, 7) - 1],
    attendance_status: isWorkingKind ? (isWFH ? 'WFH' : 'Present (Office)') : (presence === 'off' ? 'OFF' : presence === 'leave' ? 'Annual Leave' : presence === 'holiday' ? 'Holiday' : presence === 'sick' ? 'Sick Leave' : presence === 'absent' ? 'Absence' : 'OFF'),
    team_manager: rc.manager || null, team_group: rc.team || null, gender: rc.gender || null, username: rc.userId || null,
    data_quality: DQ_MARK, is_active: true,
  };
}

(async () => {
  // 1) read the Final sheet for the target people, June 1-27
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(SRC, { sharedStrings: 'cache', worksheets: 'emit', entries: 'emit' });
  const recs = [];
  for await (const ws of reader) {
    if (!SHEET_RE.test(ws.name || '')) { for await (const _ of ws) { } continue; }
    let r = 0;
    for await (const row of ws) {
      r++; if (r === 1) continue;
      const v = row.values || [];
      const id = cell(v[5]); if (typeof id !== 'number' || !TARGET_IDS.has(id)) continue;
      const date = serialToISO(cell(v[1])); if (!date || date < FROM || date > TO) continue;
      const code = cell(v[14]) != null ? String(cell(v[14])).trim() : null; if (!code) continue;
      recs.push({ id, name: cell(v[4]), userId: cell(v[6]) ? String(cell(v[6])) : null, team: cell(v[7]),
        manager: cell(v[9]), gender: cell(v[10]), location: cell(v[11]), fn: cell(v[12]) != null ? String(cell(v[12])) : null,
        date, code, s: tmin(cell(v[15])), e: tmin(cell(v[16])), s2: tmin(cell(v[17])), e2: tmin(cell(v[18])) });
    }
    break;
  }
  console.log('\n=== source rows read (Final sheet, ' + FROM + '..' + TO + '): ' + recs.length + ' for ' + new Set(recs.map(r => r.id)).size + ' people ===');

  const rows = recs.map(buildRow);
  // per-person summary of what we'd fill
  const byP = {};
  for (const r of rows) { (byP[r.person_no] = byP[r.person_no] || { name: r.clean_name, fn: r.function_name, codes: {} }); byP[r.person_no].codes[r.shift_code || r.hr_code] = (byP[r.person_no].codes[r.shift_code || r.hr_code] || 0) + 1; }
  for (const p in byP) console.log('  ' + p + ' ' + String(byP[p].name).slice(0, 18).padEnd(19) + String(byP[p].fn).padEnd(22) + Object.entries(byP[p].codes).map(([k, n]) => k + '×' + n).join('  '));

  // 2) additive: only insert (person_no, work_date) that don't already exist
  const c = getClient(); await c.connect();
  try {
    const existing = new Set((await c.query(
      `SELECT person_no||'|'||work_date::text k FROM roster_days WHERE tenant_id=$1 AND person_no = ANY($2) AND work_date BETWEEN $3 AND $4`,
      [TENANT, [...TARGET_IDS].map(String), FROM, TO])).rows.map(r => r.k));
    const toInsert = rows.filter(r => !existing.has(r.person_no + '|' + r.work_date));
    console.log('\nalready present (skip): ' + existing.size + '  |  NEW rows to insert: ' + toInsert.length);
    if (!APPLY) { console.log('\n(DRY-RUN — no DB write. Re-run with --apply to insert.)'); await c.end(); return; }
    if (!toInsert.length) { console.log('nothing to insert.'); await c.end(); return; }

    // only write columns that exist in the table
    const existingCols = new Set((await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='roster_days'")).rows.map(r => r.column_name));
    const cols = Object.keys(toInsert[0]).filter(k => existingCols.has(k));
    await c.query('BEGIN');
    await c.query(`DROP TABLE IF EXISTS roster_days_superv_bak`);
    await c.query(`CREATE TABLE roster_days_superv_bak AS SELECT * FROM roster_days WHERE tenant_id=$1 AND person_no = ANY($2) AND work_date BETWEEN $3 AND $4`, [TENANT, [...TARGET_IDS].map(String), FROM, TO]);
    let n = 0;
    for (const r of toInsert) {
      const vals = cols.map(k => r[k] === undefined ? null : r[k]);
      const ph = vals.map((_, i) => '$' + (i + 1)).join(',');
      await c.query(`INSERT INTO roster_days (${cols.join(',')}) VALUES (${ph})`, vals);
      n++;
    }
    await c.query('COMMIT');
    console.log('\n✅ INSERTED ' + n + ' record-only rows (cols=' + cols.length + '). Backup: roster_days_superv_bak. Undo: DELETE FROM roster_days WHERE data_quality=' + "'" + DQ_MARK + "';");
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.log('FAILED (rolled back): ' + e.message); process.exit(1); }
  finally { await c.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
