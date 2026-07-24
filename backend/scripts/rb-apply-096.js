#!/usr/bin/env node
/* Apply migration 096 (ot_source_rows: allow date_precision = 'derived') DIRECTLY — idempotent.
   Widens one CHECK constraint. Touches no employee, roster, or pay row. */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
(async () => {
  const file = '096_ot_source_derived_date.sql';
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', file), 'utf8');
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  await c.query(sql);
  const reg = (await c.query(`SELECT to_regclass('public.schema_migrations') r`)).rows[0].r;
  if (reg) await c.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]).catch(() => {});

  const [ck] = (await c.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ot_source_rows_precision_ck'`)).rows;
  console.log('constraint:', ck ? ck.def : '(missing)');
  const dist = (await c.query(
    `SELECT date_precision, COUNT(*)::int AS rows, ROUND(SUM(hours), 2) AS hours
       FROM ot_source_rows GROUP BY 1 ORDER BY 1`)).rows;
  console.table(dist);
  await c.end();
})().catch(e => { console.error('APPLY ERROR:', e.message); process.exit(1); });
