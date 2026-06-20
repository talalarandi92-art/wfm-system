#!/usr/bin/env node
/* READ-ONLY: run the queries from this session's changes against the live schema
 * to prove they execute (catches column mismatches that compile but fail at run). */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tid }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  const today = new Date().toISOString().slice(0, 10);
  const checks = [
    ['forecasting: ops_contacts history', `SELECT channel, contact_date::text AS date, contact_hour AS hour, COUNT(*)::int AS volume FROM ops_contacts WHERE tenant_id=$1 AND contact_hour IS NOT NULL AND channel IS NOT NULL GROUP BY channel, contact_date, contact_hour LIMIT 5`, [tid]],
    ['forecasting: avg AHT', `SELECT AVG(aht_seconds)::numeric(10,2) AS aht FROM agent_daily_stats WHERE tenant_id=$1 AND aht_seconds>0`, [tid]],
    ['tech-issues stats (sla/cx)', `SELECT COUNT(*) FILTER (WHERE sla_due_at < NOW() AND status NOT IN ('resolved','rejected')) AS sla_breached, COUNT(*) FILTER (WHERE is_cx_issue) AS cx FROM agent_tech_reports WHERE tenant_id=$1`, [tid]],
    ['reports: tech-issues detailed', `SELECT ti.id, ti.title, ti.description AS issue_reason, ti.repeat_count AS repeated_count, ti.resolution_notes AS resolution, ti.function_name, ti.reporter_name AS reported_by, ti.validated_by_name AS validated_by, ti.is_cx_issue, ti.sla_due_at FROM agent_tech_reports ti WHERE ti.tenant_id=$1 LIMIT 5`, [tid]],
    ['calendar: cross-skill scheduled HC', `SELECT fn.name, COUNT(DISTINCT ar.employee_id) FROM attendance_records ar JOIN employees e ON e.id=ar.employee_id JOIN functions fn ON fn.id=e.function_id WHERE ar.tenant_id=$1 AND ar.attendance_date=$2 AND ar.scheduled_start IS NOT NULL AND ar.attendance_marker NOT IN ('off','leave','holiday','sick','absent','comp') AND ((ar.scheduled_end > ar.scheduled_start AND $3::time >= ar.scheduled_start AND $3::time < ar.scheduled_end) OR (ar.scheduled_end <= ar.scheduled_start AND ($3::time >= ar.scheduled_start OR $3::time < ar.scheduled_end))) GROUP BY fn.name`, [tid, today, '10:00']],
    ['leave-balance: taken days', `SELECT COALESCE(SUM(rl.duration_days),0) FROM requests r JOIN request_leaves rl ON rl.request_id=r.id WHERE r.tenant_id=$1 AND rl.leave_type='annual_leave' AND r.status='approved'`, [tid]],
    ['coverage/hourly roster', `SELECT ar.attendance_marker FROM attendance_records ar WHERE ar.tenant_id=$1 AND ar.attendance_date=$2 AND ar.scheduled_start IS NOT NULL AND ar.attendance_marker IN ('present','absent','sick') LIMIT 5`, [tid, today]],
  ];
  let ok = 0;
  for (const [name, sql, p] of checks) {
    try { const r = await c.query(sql, p); console.log(`  ✓ ${name.padEnd(36)} → ${r.rowCount} row(s)`); ok++; }
    catch (e) { console.log(`  ✗ ${name.padEnd(36)} → ERROR: ${e.message}`); }
  }
  console.log(`\n${ok}/${checks.length} live query checks passed.`);
  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
