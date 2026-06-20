#!/usr/bin/env node
/* READ-ONLY probe of the live DB — lists tables + key state. No writes. */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

(async () => {
  const c = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  });
  await c.connect();
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;

  const [{ count: tableCount }] = await q(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`);
  console.log(`Connected to "${process.env.POSTGRES_DB}". public tables: ${tableCount}`);

  const exists = async (t) => (await q(`SELECT to_regclass('public.${t}') AS r`))[0].r ? 'YES' : 'no';
  for (const t of ['schema_migrations', 'technical_issues', 'agent_tech_reports', 'forecasts', 'leave_balances', 'attendance_records', 'requests', 'employees', 'audit_logs']) {
    console.log(`  ${t.padEnd(24)} ${await exists(t)}`);
  }

  // row counts on the big operational tables (read-only)
  for (const t of ['employees', 'attendance_records', 'requests', 'audit_logs']) {
    if ((await q(`SELECT to_regclass('public.${t}') AS r`))[0].r) {
      const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${t}`);
      console.log(`  rows in ${t}: ${n}`);
    }
  }

  if ((await q(`SELECT to_regclass('public.schema_migrations') AS r`))[0].r) {
    const applied = await q(`SELECT filename FROM schema_migrations ORDER BY filename`);
    console.log(`  schema_migrations tracked: ${applied.length}`);
  }
  await c.end();
})().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
