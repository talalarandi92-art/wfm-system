#!/usr/bin/env node
/* Apply migration 084 (BUILDER v2) DIRECTLY — idempotent, no shared migrate runner. */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
(async () => {
  const sqlPath = path.join(__dirname, '..', '..', 'database', 'migrations', '084_report_builder_v2.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  await c.query(sql);
  // record in schema_migrations if that ledger exists (won't clash — ON CONFLICT DO NOTHING)
  const reg = (await c.query(`SELECT to_regclass('public.schema_migrations') r`)).rows[0].r;
  if (reg) await c.query(`INSERT INTO schema_migrations (filename) VALUES ('084_report_builder_v2.sql') ON CONFLICT DO NOTHING`).catch(() => {});
  const t = await c.query(`SELECT to_regclass('public.rb_saved_reports') a, to_regclass('public.rb_saved_dashboards') b`);
  console.log('applied. rb_saved_reports=', t.rows[0].a, 'rb_saved_dashboards=', t.rows[0].b);
  await c.end();
})().catch(e => { console.error('APPLY ERROR:', e.message); process.exit(1); });
