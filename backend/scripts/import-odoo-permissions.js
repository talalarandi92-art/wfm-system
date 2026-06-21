#!/usr/bin/env node
/*
 * Import approved Odoo attendance permissions → requests + request_permissions.
 * These power the tardiness/conformance "permitted" classification.
 *
 * - Matches employee by the [employee_no] embedded in the "Employee" name column.
 * - Imports only "HR Approved" rows.
 * - Idempotent: deletes previously imported rows (notes = IMPORT_TAG) then re-inserts.
 * - Batched in one transaction. Aggregates nothing — permissions are already 1 row/event.
 *
 * Usage: node scripts/import-odoo-permissions.js "<path to Attendance Permissions ODOO.xlsx>"
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
const IMPORT_TAG = 'import:odoo-permissions';
const TYPE_MAP = {
  'Early Out Permission': 'early_out',
  'Late In Permission': 'late_in',
  'Out/In Permission': 'temp_out',
};

// "03:00 PM" -> "15:00:00"
function to24(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = m[2]; const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}:00`;
}
const ymd = (d) => {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d).trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  return null;
};

(async () => {
  if (!FILE || !fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet('Sheet1') || wb.worksheets[0];

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();

  // tenant + the permission request type + a fallback requester (admin) + employee_no→id map
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  const [{ id: permTypeId }] = (await c.query(`SELECT id FROM request_types WHERE tenant_id=$1 AND code='permission'`, [tenantId])).rows;
  const [{ id: adminUserId }] = (await c.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.tenant_id=$1 AND r.code='platform_admin' AND u.status='active' LIMIT 1`, [tenantId])).rows;
  const emps = (await c.query(`SELECT id, employee_no FROM employees WHERE tenant_id=$1`, [tenantId])).rows;
  const byNo = new Map(emps.filter(e => e.employee_no).map(e => [String(e.employee_no).trim(), e.id]));

  // collect approved rows
  const rows = [];
  const unmatched = new Set();
  let skippedStatus = 0, skippedType = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values;
    const empName = v[1], date = v[3], type = v[4], from = v[5], to = v[6], hours = v[7], status = v[9];
    if (String(status || '').trim() !== 'HR Approved') { skippedStatus++; continue; }
    const code = TYPE_MAP[String(type || '').trim()]; if (!code) { skippedType++; continue; }
    const m = String(empName || '').match(/\[\s*(\d+)\s*\]/); const no = m ? m[1] : null;
    const empId = no ? byNo.get(no) : null;
    const pdate = ymd(date);
    if (!empId) { if (no) unmatched.add(no); continue; }
    if (!pdate) continue;
    rows.push({ empId, pdate, code, from: to24(from), to: to24(to), mins: Math.round((parseFloat(hours) || 0) * 60) });
  }

  console.log(`Parsed: ${rows.length} approved permissions to import; skipped ${skippedStatus} non-approved, ${skippedType} unknown-type; ${unmatched.size} unmatched employee numbers.`);

  await c.query('BEGIN');
  // idempotent: remove previously imported rows
  await c.query(`DELETE FROM request_permissions WHERE request_id IN (SELECT id FROM requests WHERE tenant_id=$1 AND notes=$2)`, [tenantId, IMPORT_TAG]);
  const del = await c.query(`DELETE FROM requests WHERE tenant_id=$1 AND notes=$2`, [tenantId, IMPORT_TAG]);

  let inserted = 0;
  for (const r of rows) {
    const [req] = (await c.query(
      `INSERT INTO requests (tenant_id, request_type_id, requester_id, employee_id, status, notes, submitted_at, approved_l1_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'approved',$5, $6::date, $6::date, NOW(), NOW()) RETURNING id`,
      [tenantId, permTypeId, adminUserId, r.empId, IMPORT_TAG, r.pdate])).rows;
    await c.query(
      `INSERT INTO request_permissions (request_id, permission_date, permission_type, start_time, end_time, duration_minutes, reason)
       VALUES ($1,$2,$3,$4,$5,$6,'Imported from Odoo')`,
      [req.id, r.pdate, r.code, r.from, r.to, r.mins]);
    inserted++;
  }
  await c.query('COMMIT');
  console.log(`Done. Removed ${del.rowCount} prior imported; inserted ${inserted} approved permissions.`);

  const byType = await c.query(
    `SELECT rp.permission_type, COUNT(*) n FROM request_permissions rp JOIN requests rq ON rq.id=rp.request_id
      WHERE rq.tenant_id=$1 AND rq.notes=$2 GROUP BY rp.permission_type ORDER BY n DESC`, [tenantId, IMPORT_TAG]);
  console.log('By type:', byType.rows.map(x => `${x.permission_type}:${x.n}`).join(', '));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
