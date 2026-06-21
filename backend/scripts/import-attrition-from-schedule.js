#!/usr/bin/env node
/*
 * Extract attrition (RES = resignation, TER = termination) from a yearly schedule
 * workbook's long-format "Shifts" sheet → attrition_events + per-year headcount.
 * Streamed (handles 12–26 MB files without loading all into memory). Per employee
 * keeps the LATEST RES/TER and the last real working day before it. Idempotent
 * per (employee_no, leave_date). Headcount = distinct employees who actually
 * worked that year (denominator for the rate).
 *
 * Usage: node scripts/import-attrition-from-schedule.js "<path to CC Schedule YYYY.xlsx>"
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
// codes that are NOT a worked shift (so they don't count as a "last working day")
const NONWORK = new Set(['OFF','RES','TER','H','L','SL','A','S','COMP','DL','UPL','RES.','TER.','']);

function cellStr(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text);
    return '';
  }
  return String(v);
}
function cellDate(cell) {
  const v = cell && cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = typeof v === 'number' ? v : (v && v.result != null ? Number(v.result) : NaN);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null;
}

(async () => {
  if (!FILE || !fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  // per employee accumulator
  const emp = new Map();          // employee_no -> {name, func, lastReal, leaveDate, code}
  const yearEmployees = new Map(); // year -> Set(employee_no) with a real shift

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {});
  for await (const ws of reader) {
    if (ws.name !== 'Shifts') continue;
    let r = 0;
    for await (const row of ws) {
      r++; if (r === 1) continue;                       // header
      const no = cellStr(row.getCell(4)).trim();
      const date = cellDate(row.getCell(1));
      const code = cellStr(row.getCell(13)).trim().toUpperCase();
      if (!no || !date) continue;
      const year = +date.slice(0, 4);
      const name = cellStr(row.getCell(3)).trim();
      const func = cellStr(row.getCell(11)).trim();

      const isWork = code && !NONWORK.has(code);
      if (isWork) {
        if (!yearEmployees.has(year)) yearEmployees.set(year, new Set());
        yearEmployees.get(year).add(no);
      }
      let e = emp.get(no);
      if (!e) { e = { name, func, lastReal: null, leaveDate: null, code: null }; emp.set(no, e); }
      if (name) e.name = name; if (func) e.func = func;
      if (isWork && (!e.lastReal || date > e.lastReal)) e.lastReal = date;
      if ((code === 'RES' || code === 'TER') && (!e.leaveDate || date >= e.leaveDate)) { e.leaveDate = date; e.code = code; }
    }
    break;
  }

  const leavers = [...emp.entries()].filter(([, e]) => e.leaveDate);
  console.log(`Scanned. ${leavers.length} leavers (RES/TER) found; headcount years: ${[...yearEmployees.keys()].sort().join(', ')}`);

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '046_attrition_events.sql'), 'utf8'));

  await c.query('BEGIN');
  let n = 0;
  for (const [no, e] of leavers) {
    const lastWork = e.lastReal && e.lastReal <= e.leaveDate ? e.lastReal : null;
    await c.query(
      `INSERT INTO attrition_events (tenant_id, employee_no, name, function_name, type, leave_date, last_working_day, year, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'schedule')
       ON CONFLICT (tenant_id, employee_no, leave_date)
       DO UPDATE SET name=EXCLUDED.name, function_name=EXCLUDED.function_name, type=EXCLUDED.type,
                     last_working_day=EXCLUDED.last_working_day, year=EXCLUDED.year`,
      [tenantId, no, e.name, e.func, e.code === 'TER' ? 'termination' : 'resignation', e.leaveDate, lastWork, +e.leaveDate.slice(0, 4)]);
    n++;
  }
  for (const [year, set] of yearEmployees) {
    await c.query(
      `INSERT INTO attrition_headcount_yearly (tenant_id, year, headcount) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, year) DO UPDATE SET headcount=EXCLUDED.headcount`,
      [tenantId, year, set.size]);
  }
  await c.query('COMMIT');
  console.log(`Upserted ${n} attrition events + headcount for ${yearEmployees.size} year(s).`);
  const byType = {};
  for (const [, e] of leavers) byType[e.code] = (byType[e.code] || 0) + 1;
  console.log('By type:', JSON.stringify(byType), '| HC:', [...yearEmployees.entries()].map(([y, s]) => `${y}:${s.size}`).join(', '));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
