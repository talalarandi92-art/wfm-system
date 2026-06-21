#!/usr/bin/env node
/*
 * Import approved Odoo Compensatory-Off → two precise shapes:
 *  - Hour-based (Late In / Early Out / Out-In Comp Off) → request_permissions
 *    (late_in / early_out / temp_out) so they count as AUTHORIZED and are exempt
 *    from tardiness/conformance — identical treatment to permissions.
 *  - Full Day Comp Off → requests(comp_off) + request_leaves (1 day off).
 * Employee matched by [employee_no]. Only "HR Approved". Idempotent via notes tag.
 *
 * Usage: node scripts/import-odoo-compoff.js "<path to Compensatory Off (comp.off) ODOO.xlsx>"
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const FILE = process.argv[2];
const IMPORT_TAG = 'import:odoo-compoff';
const PERM_MAP = { 'Late In Comp Off': 'late_in', 'Early Out Comp Off': 'early_out', 'Out/In Comp Off': 'temp_out' };
const ymd = (d) => { if (d instanceof Date) return d.toISOString().slice(0, 10); const s = String(d || '').trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
function to24(t) { if (!t) return null; const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i); if (!m) return null; let h = +m[1]; const ap = (m[3] || '').toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; return `${String(h).padStart(2, '0')}:${m[2]}:00`; }

(async () => {
  if (!FILE || !fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  const [{ id: permTypeId }] = (await c.query(`SELECT id FROM request_types WHERE tenant_id=$1 AND code='permission'`, [tenantId])).rows;
  const [{ id: compTypeId }] = (await c.query(`SELECT id FROM request_types WHERE tenant_id=$1 AND code='comp_off'`, [tenantId])).rows;
  const [{ id: adminUserId }] = (await c.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.tenant_id=$1 AND r.code='platform_admin' AND u.status='active' LIMIT 1`, [tenantId])).rows;
  const byNo = new Map((await c.query(`SELECT id, employee_no FROM employees WHERE tenant_id=$1`, [tenantId])).rows
    .filter(e => e.employee_no).map(e => [String(e.employee_no).trim(), e.id]));

  const perms = [], days = []; const unmatched = new Set(); let skipped = 0, unknownType = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values;
    if (String(v[8] || '').trim() !== 'HR Approved') { skipped++; continue; }
    const m = String(v[1] || '').match(/\[\s*(\d+)\s*\]/); const no = m ? m[1] : null;
    const empId = no ? byNo.get(no) : null;
    const date = ymd(v[3]); const type = String(v[4] || '').trim();
    if (!empId) { if (no) unmatched.add(no); continue; }
    if (!date) continue;
    if (type === 'Full Day Comp Off') { days.push({ empId, date }); }
    else if (PERM_MAP[type]) { perms.push({ empId, date, code: PERM_MAP[type], from: to24(v[5]), to: to24(v[6]), mins: Math.round((parseFloat(v[7]) || 0) * 60) }); }
    else { unknownType++; }
  }
  console.log(`Parsed: ${perms.length} hour-based comp-off (→permissions), ${days.length} full-day comp-off; skipped ${skipped} non-approved, ${unknownType} unknown-type; ${unmatched.size} unmatched.`);

  await c.query('BEGIN');
  // idempotent cleanup (covers both permissions + leaves created under this tag)
  await c.query(`DELETE FROM request_permissions WHERE request_id IN (SELECT id FROM requests WHERE tenant_id=$1 AND notes=$2)`, [tenantId, IMPORT_TAG]);
  await c.query(`DELETE FROM request_leaves      WHERE request_id IN (SELECT id FROM requests WHERE tenant_id=$1 AND notes=$2)`, [tenantId, IMPORT_TAG]);
  const del = await c.query(`DELETE FROM requests WHERE tenant_id=$1 AND notes=$2`, [tenantId, IMPORT_TAG]);

  let p = 0, d = 0;
  for (const r of perms) {
    const [req] = (await c.query(
      `INSERT INTO requests (tenant_id, request_type_id, requester_id, employee_id, status, notes, submitted_at, approved_l1_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'approved',$5,$6::date,$6::date,NOW(),NOW()) RETURNING id`,
      [tenantId, permTypeId, adminUserId, r.empId, IMPORT_TAG, r.date])).rows;
    await c.query(
      `INSERT INTO request_permissions (request_id, permission_date, permission_type, start_time, end_time, duration_minutes, reason)
       VALUES ($1,$2,$3,$4,$5,$6,'Comp-off (imported from Odoo)')`,
      [req.id, r.date, r.code, r.from, r.to, r.mins]); p++;
  }
  for (const r of days) {
    const [req] = (await c.query(
      `INSERT INTO requests (tenant_id, request_type_id, requester_id, employee_id, status, notes, submitted_at, approved_l1_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'approved',$5,$6::date,$6::date,NOW(),NOW()) RETURNING id`,
      [tenantId, compTypeId, adminUserId, r.empId, IMPORT_TAG, r.date])).rows;
    await c.query(
      `INSERT INTO request_leaves (request_id, leave_type, start_date, end_date, duration_days)
       VALUES ($1,'comp_off',$2,$2,1)`,
      [req.id, r.date]); d++;
  }
  await c.query('COMMIT');
  console.log(`Done. Removed ${del.rowCount} prior; inserted ${p} comp-off permissions + ${d} full-day comp-off.`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
