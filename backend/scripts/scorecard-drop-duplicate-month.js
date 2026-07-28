#!/usr/bin/env node
/*
 * Remove a scorecard month that is a byte-for-byte copy of another month.
 *
 * WHY THIS EXISTS. Monthly scorecard workbooks are started by copying the previous
 * month's file. May 2026 was: the aggregation tab was renamed "May 26" but never
 * rebuilt, so it still holds January's 411 rows. The importer takes the first sheet
 * whose header carries Net Points + Weeks + ID — that tab — so all 82 agents landed
 * twice, once as January and once as May, with identical weekly_nets. Every screen
 * showing May 2026 was showing January, and the Jan-to-May trend was a flat line by
 * construction. A sheet-NAME check cannot catch this; the name is correct.
 *
 * import-scorecards.js now fingerprints a month's content and refuses a duplicate,
 * so this only has to clean up what is already stored.
 *
 * SAFETY. Refuses to delete unless the month is PROVEN identical to another month —
 * same agents, same nets, same count. Copies the rows to scorecard_monthly_bak
 * first, then deletes and writes the audit entry in ONE transaction, so a failure
 * cannot leave data removed with no trail. --dry-run is the default.
 *
 * Usage:  node scripts/scorecard-drop-duplicate-month.js 2026 5 [--apply]
 * Undo:   INSERT INTO scorecard_monthly SELECT ... FROM scorecard_monthly_bak WHERE ...
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const [, , yArg, mArg] = process.argv;
const APPLY = process.argv.includes('--apply');
const year = Number(yArg), month = Number(mArg);
if (!year || !month) { console.error('usage: scorecard-drop-duplicate-month.js <year> <month> [--apply]'); process.exit(1); }

const fp = rows => rows.map(r => `${r.employee_no}:${r.weekly_nets.map(Number).join(',')}`).sort().join('|');

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;

  const target = (await c.query(
    `SELECT employee_no, weekly_nets, source_file FROM scorecard_monthly
      WHERE tenant_id=$1 AND year=$2 AND month=$3`, [tenantId, year, month])).rows;
  if (!target.length) { console.log(`${year}-${month}: no rows — nothing to do.`); await c.end(); return; }

  // Prove it is a duplicate. Without this the script is just a delete button.
  const others = new Map();
  for (const r of (await c.query(
    `SELECT year, month, employee_no, weekly_nets, source_file FROM scorecard_monthly
      WHERE tenant_id=$1 AND NOT (year=$2 AND month=$3)`, [tenantId, year, month])).rows) {
    const k = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!others.has(k)) others.set(k, { file: r.source_file, rows: [] });
    others.get(k).rows.push(r);
  }
  const mine = fp(target);
  const twin = [...others].find(([, v]) => fp(v.rows) === mine);
  if (!twin) {
    console.log(`${year}-${String(month).padStart(2, '0')} is NOT identical to any other month — refusing to delete.`);
    console.log('If the month is wrong for another reason, that is a different problem and needs a different fix.');
    await c.end(); process.exit(2);
  }

  console.log(`${year}-${String(month).padStart(2, '0')}  ${target.length} agents, source "${target[0].source_file}"`);
  console.log(`   is identical to ${twin[0]} (source "${twin[1].file}") — same agents, same weekly_nets.`);
  console.log(`   ${APPLY ? 'DELETING' : 'would delete'} ${target.length} rows.`);
  if (!APPLY) { console.log('\n(dry run — pass --apply to execute)'); await c.end(); return; }

  await c.query('BEGIN');
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS scorecard_monthly_bak
                   (LIKE scorecard_monthly INCLUDING DEFAULTS,
                    removed_at timestamptz NOT NULL DEFAULT now(), removed_reason text)`);
    const bak = await c.query(
      `INSERT INTO scorecard_monthly_bak
       SELECT *, now(), $4 FROM scorecard_monthly WHERE tenant_id=$1 AND year=$2 AND month=$3
       RETURNING employee_no`,
      [tenantId, year, month, `duplicate of ${twin[0]}`]);
    const del = await c.query(
      `DELETE FROM scorecard_monthly WHERE tenant_id=$1 AND year=$2 AND month=$3 RETURNING employee_no`,
      [tenantId, year, month]);
    if (bak.rows.length !== del.rows.length) throw new Error(`backup ${bak.rows.length} != deleted ${del.rows.length}`);
    await c.query(
      `INSERT INTO audit_logs (tenant_id, action, module, entity_type, old_value, notes)
       VALUES ($1,'delete','scorecard','scorecard_monthly',$2,$3)`,
      [tenantId,
       JSON.stringify({ year, month, agents: del.rows.length, source_file: target[0].source_file, identical_to: twin[0] }),
       `Removed ${year}-${String(month).padStart(2, '0')}: the workbook's aggregation tab was a copy of ${twin[0]} that was renamed but never rebuilt. Rows preserved in scorecard_monthly_bak.`]);
    await c.query('COMMIT');
    console.log(`   removed ${del.rows.length} rows · backed up to scorecard_monthly_bak · audit written`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLED BACK —', e.message);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
