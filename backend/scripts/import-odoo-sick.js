#!/usr/bin/env node
/*
 * Import approved Odoo sick leaves → requests(sick_leave) + request_leaves.
 * Powers leave-taken (balances), shrinkage and attrition signals.
 * Employee matched by [employee_no] in the name column. Only "HR Approved".
 * Idempotent via notes = IMPORT_TAG. One transaction.
 *
 * Usage: node scripts/import-odoo-sick.js "<path to Sick Leaves ODOO.xlsx>"
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
const IMPORT_TAG = 'import:odoo-sick';
const ymd = (d) => { if (d instanceof Date) return d.toISOString().slice(0, 10); const s = String(d || '').trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };

(async () => {
  if (!FILE || !fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  const [{ id: rtId }] = (await c.query(`SELECT id FROM request_types WHERE tenant_id=$1 AND code='sick_leave'`, [tenantId])).rows;
  const [{ id: adminUserId }] = (await c.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.tenant_id=$1 AND r.code='platform_admin' AND u.status='active' LIMIT 1`, [tenantId])).rows;
  const byNo = new Map((await c.query(`SELECT id, employee_no FROM employees WHERE tenant_id=$1`, [tenantId])).rows
    .filter(e => e.employee_no).map(e => [String(e.employee_no).trim(), e.id]));

  const rows = []; const unmatched = new Set(); let skipped = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values;
    if (String(v[6] || '').trim() !== 'HR Approved') { skipped++; continue; }
    const m = String(v[1] || '').match(/\[\s*(\d+)\s*\]/); const no = m ? m[1] : null;
    const empId = no ? byNo.get(no) : null;
    const from = ymd(v[3]), to = ymd(v[4]) || ymd(v[3]);
    const dur = parseFloat(v[5]) || 1;
    if (!empId) { if (no) unmatched.add(no); continue; }
    if (!from) continue;
    rows.push({ empId, from, to, dur });
  }
  console.log(`Parsed ${rows.length} approved sick leaves; skipped ${skipped} non-approved; ${unmatched.size} unmatched employees.`);

  await c.query('BEGIN');
  await c.query(`DELETE FROM request_leaves WHERE request_id IN (SELECT id FROM requests WHERE tenant_id=$1 AND notes=$2)`, [tenantId, IMPORT_TAG]);
  const del = await c.query(`DELETE FROM requests WHERE tenant_id=$1 AND notes=$2`, [tenantId, IMPORT_TAG]);
  let inserted = 0;
  for (const r of rows) {
    const [req] = (await c.query(
      `INSERT INTO requests (tenant_id, request_type_id, requester_id, employee_id, status, notes, submitted_at, approved_l1_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'approved',$5,$6::date,$6::date,NOW(),NOW()) RETURNING id`,
      [tenantId, rtId, adminUserId, r.empId, IMPORT_TAG, r.from])).rows;
    await c.query(
      `INSERT INTO request_leaves (request_id, leave_type, start_date, end_date, duration_days)
       VALUES ($1,'sick_leave',$2,$3,$4)`,
      [req.id, r.from, r.to, r.dur]);
    inserted++;
  }
  await c.query('COMMIT');
  console.log(`Done. Removed ${del.rowCount} prior; inserted ${inserted} sick leaves.`);
  const agg = (await c.query(
    `SELECT EXTRACT(YEAR FROM rl.start_date) yr, COUNT(*) n, SUM(rl.duration_days) days
       FROM request_leaves rl JOIN requests rq ON rq.id=rl.request_id
      WHERE rq.tenant_id=$1 AND rq.notes=$2 GROUP BY 1 ORDER BY 1`, [tenantId, IMPORT_TAG])).rows;
  console.log('By year:', agg.map(x => `${x.yr}:${x.n} reqs/${x.days}d`).join(', '));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
