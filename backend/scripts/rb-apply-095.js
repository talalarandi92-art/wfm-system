#!/usr/bin/env node
/* Apply migration 095 (ot_source_rows — the OT workbook ledger) DIRECTLY — idempotent.
   Creates ONE new table; reads and writes no employee, roster, or pay row. */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
(async () => {
  const file = '095_ot_source_rows.sql';
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', file), 'utf8');
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  await c.query(sql);
  const reg = (await c.query(`SELECT to_regclass('public.schema_migrations') r`)).rows[0].r;
  if (reg) await c.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]).catch(() => {});

  const cols = (await c.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns WHERE table_name = 'ot_source_rows' ORDER BY ordinal_position`)).rows;
  console.table(cols);
  const [n] = (await c.query(`SELECT COUNT(*)::int AS rows FROM ot_source_rows`)).rows;
  console.log('existing rows:', n.rows);
  await c.end();
})().catch(e => { console.error('APPLY ERROR:', e.message); process.exit(1); });
