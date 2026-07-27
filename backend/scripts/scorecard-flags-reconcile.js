#!/usr/bin/env node
/**
 * RECONCILE OPEN low_scorecard FLAGS WITH THE BOTTOM-QUARTILE RULE.
 *
 * The trigger changed on 2026-07-27 (Director's decision) from "below the
 * function average" — which selects ~half of any group by arithmetic — to "the
 * bottom quartile of the function". `scan()` only ever INSERTs or UPDATEs; it
 * never closes a flag that no longer qualifies, so every flag raised under the
 * retired rule stays open against a real person indefinitely.
 *
 * This re-runs each open flag through the NEW rule and closes the ones that no
 * longer hold. Closing is the un-punishing direction and it is reversible:
 * status becomes 'dismissed' with a stated reason plus an audit row — nothing is
 * deleted, and `scan()` will re-raise anything that genuinely still qualifies.
 *
 * DRY RUN BY DEFAULT.
 *   node scripts/scorecard-flags-reconcile.js            # report only
 *   node scripts/scorecard-flags-reconcile.js --apply    # close the stale ones
 */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const APPLY = process.argv.includes('--apply');
const MIN_POOL = 4;                       // must match scorecard-guard.service.ts
const bold = (s) => `\x1b[1m${s}\x1b[0m`, dim = (s) => `\x1b[90m${s}\x1b[0m`;

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;

  const [batch] = await q(
    `SELECT id, period_name, tenant_id FROM scorecard_batches WHERE status <> 'archived'
      ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, uploaded_at DESC LIMIT 1`);
  if (!batch) { console.log('No scorecard batch — nothing to reconcile.'); await c.end(); return; }

  /* Who qualifies under the NEW rule — same definition as the service:
     PERCENTILE_CONT(0.25), and functions smaller than MIN_POOL are not judged. */
  const qualifying = new Set((await q(
    `WITH e AS (
       SELECT function_name fn, employee_no, net_points pts
         FROM scorecard_entries
        WHERE batch_id = $1 AND week_label = 'Final' AND net_points IS NOT NULL
     ), agg AS (
       SELECT fn, COUNT(*) n, PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY pts) p25
         FROM e GROUP BY fn
     )
     SELECT e.employee_no FROM e JOIN agg USING (fn)
      WHERE agg.n >= $2 AND e.pts < agg.p25`, [batch.id, MIN_POOL])).map((r) => r.employee_no));

  const open = await q(
    `SELECT cf.id, cf.employee_id, cf.detail, e.employee_no, e.first_name_en, e.last_name_en
       FROM coaching_flags cf JOIN employees e ON e.id = cf.employee_id
      WHERE cf.status = 'open' AND cf.trigger_type = 'low_scorecard'`);

  const stale = open.filter((f) => !qualifying.has(f.employee_no));
  const kept = open.length - stale.length;

  console.log(`\n${bold('low_scorecard flags vs the bottom-quartile rule')}  ${dim(batch.period_name)}`);
  console.log(`  open now: ${open.length}   ·   still qualify: ${bold(String(kept))}   ·   no longer qualify: ${bold(String(stale.length))}\n`);
  for (const f of stale)
    console.log(`   ${dim('close')}  ${f.first_name_en} ${f.last_name_en} ${dim(`(${f.employee_no})`)}`);

  if (!stale.length) { console.log(dim('\n  Nothing to close.\n')); await c.end(); return; }

  if (!APPLY) {
    console.log(dim(`\n  DRY RUN — nothing was changed. Re-run with --apply to close these ${stale.length}.\n`));
    await c.end(); return;
  }

  /* The close and its audit row go in ONE transaction, and the audit INSERT is NOT
     wrapped in a catch. Closing an HR record without a trail is worse than not
     closing it — an earlier draft of this script had the column names wrong
     (actor_user_id/new_values; the table has actor_id/new_value and a NOT NULL
     `module`), and a swallowed error would have dismissed 17 records silently. */
  let closed = 0;
  for (const f of stale) {
    await c.query('BEGIN');
    try {
      await c.query(
        `UPDATE coaching_flags
            SET status = 'dismissed', updated_at = NOW(),
                detail = detail || ' — أُغلق: القاعدة صارت أدنى 25% بدل تحت المتوسط (2026-07-27)'
          WHERE id = $1 AND status = 'open'`, [f.id]);
      await c.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, new_value, notes, created_at)
         VALUES ($1, NULL, 'coaching_flag.dismissed', 'scorecard-guard', 'coaching_flags', $2, $3, $4, NOW())`,
        [batch.tenant_id, f.id,
         JSON.stringify({ status: 'dismissed', employee_no: f.employee_no, period: batch.period_name }),
         'coaching trigger changed from below-function-average to bottom-quartile (Director, 2026-07-27)']);
      await c.query('COMMIT');
      closed++;
    } catch (e) {
      await c.query('ROLLBACK');
      console.error(`  ! ${f.employee_no} NOT closed — ${e.message}`);
    }
  }
  console.log(`\n  ${bold(`${closed} flag(s) dismissed`)} ${dim('— reversible: status only, with an audit row; nothing deleted.')}\n`);
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
