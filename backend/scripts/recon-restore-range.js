#!/usr/bin/env node
/*
 * Restore ONE date range of roster_days from roster_days_recon_bak.
 *
 * WHY, not just `recon-ingest.js --restore`: that reverts everything the last ingest
 * touched. When a July load has damaged June but July itself is good, a full restore
 * throws away the good work to undo the bad. This puts back exactly the days named.
 *
 * The case it was written for: the July payload carried two stray rows on 2026-06-20..30
 * (two fixed-pattern WFH employees whose weekly pattern is projected backwards), the
 * ingest derived its replace-range from the payload's MIN and MAX date, and so deleted
 * eleven days of June — ~118 rows each — to insert two. recon-ingest.js now takes the
 * range from the schedule being ingested instead, and refuses a date that would lose
 * most of its rows.
 *
 * Dry-run by default.
 *   node scripts/recon-restore-range.js 2026-06-20 2026-06-30 [--apply]
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const [, , from, to] = process.argv;
const APPLY = process.argv.includes('--apply');
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
  console.error('usage: recon-restore-range.js <from YYYY-MM-DD> <to YYYY-MM-DD> [--apply]');
  process.exit(1);
}

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();

  const { rows: cmp } = await c.query(`
    WITH n AS (SELECT work_date d, COUNT(*)::int c FROM roster_days       WHERE work_date BETWEEN $1 AND $2 GROUP BY 1),
         b AS (SELECT work_date d, COUNT(*)::int c FROM roster_days_recon_bak WHERE work_date BETWEEN $1 AND $2 GROUP BY 1)
    SELECT COALESCE(n.d,b.d)::text d, COALESCE(n.c,0) live, COALESCE(b.c,0) bak
      FROM n FULL JOIN b ON b.d=n.d ORDER BY 1`, [from, to]);
  if (!cmp.length) { console.log('nothing in that range, in either table.'); await c.end(); return; }

  console.log('date          live    backup');
  let restore = 0;
  for (const r of cmp) { console.log(`  ${r.d}  ${String(r.live).padStart(5)}   ${String(r.bak).padStart(5)}`); restore += r.bak; }
  console.log(`\n${APPLY ? 'RESTORING' : 'would restore'} ${restore} row(s) from roster_days_recon_bak over ${cmp.length} day(s).`);
  if (!APPLY) { console.log('(dry run — pass --apply)'); await c.end(); return; }

  await c.query('BEGIN');
  try {
    const del = await c.query(`DELETE FROM roster_days WHERE work_date BETWEEN $1 AND $2 RETURNING 1`, [from, to]);
    /* Column-list INSERT, not SELECT * — the backup is `LIKE roster_days` today, but a
       later migration that adds a column to one and not the other would otherwise turn
       a restore into a positional mis-write across 60+ columns. */
    const cols = (await c.query(
      `SELECT a.column_name FROM information_schema.columns a
        WHERE a.table_name='roster_days'
          AND a.column_name IN (SELECT column_name FROM information_schema.columns WHERE table_name='roster_days_recon_bak')
        ORDER BY a.ordinal_position`)).rows.map(r => `"${r.column_name}"`).join(', ');
    const ins = await c.query(
      `INSERT INTO roster_days (${cols}) SELECT ${cols} FROM roster_days_recon_bak WHERE work_date BETWEEN $1 AND $2 RETURNING 1`,
      [from, to]);
    await c.query(
      `INSERT INTO audit_logs (tenant_id, action, module, entity_type, old_value, notes)
       SELECT id,'restore','attendance-recon','roster_days',$1,$2 FROM tenants LIMIT 1`,
      [JSON.stringify({ from, to, deleted: del.rows.length, restored: ins.rows.length }),
       `Restored ${from}..${to} from roster_days_recon_bak after an ingest replaced a wider range than it covered.`]);
    await c.query('COMMIT');
    console.log(`   deleted ${del.rows.length} · restored ${ins.rows.length} · audit written`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLED BACK —', e.message);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
