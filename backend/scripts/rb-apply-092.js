#!/usr/bin/env node
/* Apply migration 092 (Offline QUALITY not-applicable becomes FORWARD-ONLY,
   D-081b) DIRECTLY — idempotent, no shared migrate runner.
   Touches the RULEBOOK only (kpi_function_config + an audit formula version);
   no employee, roster, or pay row is read or written. */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
(async () => {
  const file = '092_quality_offline_forward_only.sql';
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', file), 'utf8');
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  await c.query(sql);
  const reg = (await c.query(`SELECT to_regclass('public.schema_migrations') r`)).rows[0].r;
  if (reg) await c.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]).catch(() => {});

  const rows = (await c.query(
    `SELECT r.kpi_code, c.function_name, c.weight, c.applies_from::text, c.applies_to::text, c.band->>'type' AS band_type
       FROM kpi_function_config c JOIN kpi_registry r ON r.id = c.kpi_id
      WHERE c.function_name IN ('Offline','Internship Offline') AND r.kpi_code = 'QUALITY'
      ORDER BY r.kpi_code, c.applies_from`)).rows;
  console.table(rows);
  await c.end();
})().catch(e => { console.error('APPLY ERROR:', e.message); process.exit(1); });
