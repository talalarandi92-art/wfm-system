#!/usr/bin/env node
/**
 * ONE-TIME identity backfill for `agent_daily_stats` (prepared 2026-07-23).
 *
 * WHY: the stats upsert fills employee_id only when the SAME (tenant, stat_date,
 * agent) row is rewritten, so an identity resolved on day N left every earlier
 * day orphaned forever. The ENGINE is now fixed (sprinklr.service.persistAgentLink
 * heals history whenever a link is resolved) — this script repairs the rows that
 * were already stranded before that fix existed.
 *
 * WHAT IT DOES: for every stats row with employee_id IS NULL where
 * `sprinklr_agent_map` ALREADY holds an employee_id for that agent, copy the
 * mapping in. It invents nothing: the attribution already exists and is
 * authoritative — the row simply never received it.
 *
 * SAFETY:
 *   • fills BLANKS only (`employee_id IS NULL`) — an existing attribution can
 *     never be overwritten;
 *   • DRY-RUN by default — prints the exact diff and writes nothing;
 *   • `--apply` takes a backup table first and reports the row count;
 *   • test/dev agents (no mapped employee) are untouched by construction.
 *
 *   node scripts/agent-link-backfill.js            # dry run, writes nothing
 *   node scripts/agent-link-backfill.js --apply    # writes, after a backup
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const APPLY = process.argv.includes('--apply');
const BAK = 'agent_daily_stats_linkfix_bak';

const SELECT_TARGETS = `
  SELECT s.id, s.stat_date::text AS stat_date, s.sprinklr_agent_id,
         m.agent_name, m.agent_email, m.employee_id
    FROM agent_daily_stats s
    JOIN sprinklr_agent_map m
      ON m.tenant_id = s.tenant_id AND m.sprinklr_agent_id = s.sprinklr_agent_id
   WHERE s.employee_id IS NULL AND m.employee_id IS NOT NULL
   ORDER BY m.agent_name, s.stat_date`;

(async () => {
  const c = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'wfm_db',
    user: process.env.POSTGRES_USER,
    password: String(process.env.POSTGRES_PASSWORD || ''),
  });
  await c.connect();

  const { rows } = await c.query(SELECT_TARGETS);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — orphan stat rows whose identity is already known: ${rows.length}`);

  if (!rows.length) {
    console.log('Nothing to do — no stats row is missing a link the map can supply.');
    await c.end();
    return;
  }

  const byAgent = new Map();
  for (const r of rows) {
    const e = byAgent.get(r.agent_name) ?? { rows: 0, first: r.stat_date, last: r.stat_date, email: r.agent_email };
    e.rows++;
    if (r.stat_date < e.first) e.first = r.stat_date;
    if (r.stat_date > e.last) e.last = r.stat_date;
    byAgent.set(r.agent_name, e);
  }
  console.log('\nper person:');
  for (const [name, e] of [...byAgent.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${String(name).padEnd(24)} ${String(e.rows).padStart(3)} row(s)  ${e.first} → ${e.last}`);
  }
  console.log(`\n${byAgent.size} people · ${rows.length} rows`);

  // Nothing below this line runs without --apply.
  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to commit.');
    await c.end();
    return;
  }

  await c.query(`DROP TABLE IF EXISTS ${BAK}`);
  await c.query(`CREATE TABLE ${BAK} AS SELECT * FROM agent_daily_stats WHERE employee_id IS NULL`);
  const [{ n: backedUp }] = (await c.query(`SELECT COUNT(*)::int n FROM ${BAK}`)).rows;
  console.log(`\nbackup: ${BAK} (${backedUp} rows)`);

  const res = await c.query(`
    UPDATE agent_daily_stats s SET employee_id = m.employee_id
      FROM sprinklr_agent_map m
     WHERE m.tenant_id = s.tenant_id AND m.sprinklr_agent_id = s.sprinklr_agent_id
       AND s.employee_id IS NULL AND m.employee_id IS NOT NULL`);
  console.log(`updated ${res.rowCount} row(s)`);

  const [after] = (await c.query(
    `SELECT COUNT(*)::int total, COUNT(employee_id)::int linked FROM agent_daily_stats`)).rows;
  console.log(`agent_daily_stats now: ${after.linked}/${after.total} rows carry an employee link`);
  console.log(`\nrollback: UPDATE agent_daily_stats s SET employee_id = NULL FROM ${BAK} b WHERE b.id = s.id;`);
  await c.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
