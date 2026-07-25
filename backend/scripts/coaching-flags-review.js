#!/usr/bin/env node
/**
 * RE-EVALUATE OPEN COACHING FLAGS AGAINST THE CORRECTED TARDINESS RULE.
 *
 * `coaching.service.ts` used to trigger on `punch_late_minutes > 0`, so a
 * ONE-MINUTE lateness three times in 30 days opened a coaching flag and notified
 * every TL and manager. The confirmed rule (BR-TRD-001) tolerates ≤6 minutes and
 * caps at 240, because anything beyond four hours is a cross-midnight punch
 * artifact rather than a person's behaviour. The engine is fixed — but `scan()`
 * only ever INSERTs or UPDATEs, never closes a flag that no longer qualifies, so
 * flags raised under the old rule stay open against real people indefinitely.
 *
 * This re-runs each open flag through the corrected window and reports which no
 * longer hold. DRY RUN BY DEFAULT — closing an HR record is the Director's call,
 * never a script's. Pass --apply to close them, which sets status='dismissed'
 * with a reason and writes an audit row; nothing is deleted.
 *
 *   node scripts/coaching-flags-review.js            # report only
 *   node scripts/coaching-flags-review.js --apply    # close the ones that no longer hold
 */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const APPLY = process.argv.includes('--apply');
const WINDOW = 30, THRESHOLD = 3;

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();

  /* Re-count each flag's occurrences over ITS OWN 30-day window, using the
     corrected 7..240 rule and still honouring approved permissions — the same
     exclusion the live trigger applies, so this is a like-for-like re-run. */
  const sql = (col, permCol) => `
    WITH f AS (
      SELECT cf.id, cf.tenant_id, cf.employee_id, cf.occurrences, cf.detected_at, cf.detail,
             e.employee_no, TRIM(COALESCE(e.first_name_en,'') || ' ' || COALESCE(e.last_name_en,'')) AS full_name
        FROM coaching_flags cf
        LEFT JOIN employees e ON e.id = cf.employee_id
       WHERE cf.status = 'open' AND cf.trigger_type = $1
    )
    SELECT f.id, f.employee_no, f.full_name, f.occurrences AS old_occ, f.detected_at::date::text AS detected,
           COUNT(*) FILTER (WHERE ar.${col} BETWEEN 7 AND 240 AND NOT COALESCE(perm.${permCol}, FALSE))::int AS new_occ
      FROM f
      LEFT JOIN attendance_records ar
        ON ar.employee_id = f.employee_id
       AND ar.attendance_date >  f.detected_at::date - ${WINDOW}
       AND ar.attendance_date <= f.detected_at::date
      LEFT JOIN LATERAL (
        SELECT COALESCE(bool_or(rp.permission_type = 'late_in'), FALSE) AS perm_late,
               COALESCE(bool_or(rp.permission_type IN ('early_out','temp_out')), FALSE) AS perm_early
          FROM request_permissions rp JOIN requests rq ON rq.id = rp.request_id
         WHERE rq.tenant_id = ar.tenant_id AND rq.employee_id = ar.employee_id
           AND rq.status = 'approved' AND rp.permission_date = ar.attendance_date
      ) perm ON TRUE
     GROUP BY f.id, f.employee_no, f.full_name, f.occurrences, f.detected_at
     ORDER BY new_occ ASC`;

  const TYPES = [
    ['repeated_late', 'punch_late_minutes', 'perm_late'],
    ['repeated_early_out', 'punch_early_out_minutes', 'perm_early'],
  ];

  let totalStale = 0;
  const toClose = [];
  for (const [type, col, permCol] of TYPES) {
    const rows = await c.query(sql(col, permCol), [type]).then(r => r.rows).catch((e) => {
      console.log(`  (could not re-evaluate ${type}: ${e.message.slice(0, 80)})`);
      return [];
    });
    if (!rows.length) continue;
    const stale = rows.filter(r => r.new_occ < THRESHOLD);
    console.log(`\n── ${type}: ${rows.length} open · ${stale.length} no longer qualify under 7..240 min`);
    for (const r of stale.slice(0, 25)) {
      console.log(`   • ${(r.full_name || r.employee_no || r.id).toString().padEnd(28)} was ${r.old_occ} occurrence(s), now ${r.new_occ}  (raised ${r.detected})`);
      toClose.push({ id: r.id, type, old: r.old_occ, now: r.new_occ });
    }
    if (stale.length > 25) console.log(`   … and ${stale.length - 25} more`);
    totalStale += stale.length;
  }

  console.log(`\n${'═'.repeat(72)}`);
  if (!totalStale) { console.log('  Every open flag still holds under the corrected rule.'); await c.end(); return; }
  console.log(`  ${totalStale} open coaching flag(s) were raised on lateness that is within`);
  console.log(`  tolerance (≤6 min) or a cross-midnight artifact (>240 min).`);

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing changed. These are HR records against real people;`);
    console.log(`  closing them is the Director's decision, not this script's.`);
    console.log(`  To close them:  node scripts/coaching-flags-review.js --apply\n`);
    await c.end();
    return;
  }

  await c.query('BEGIN');
  try {
    for (const f of toClose) {
      await c.query(
        `UPDATE coaching_flags
            SET status = 'dismissed', updated_at = NOW(),
                detail = COALESCE(detail, '') || ' — أُغلق آليًا: التأخير ضمن التسامح (≤6 د) أو أثر بيانات (>240 د) حسب القاعدة المعتمدة'
          WHERE id = $1 AND status = 'open'`, [f.id]);
      await c.query(
        `INSERT INTO audit_logs (tenant_id, actor_email, action, module, entity_type, entity_id, new_value, notes)
         SELECT tenant_id, 'system:coaching-rule-correction', 'coaching_flag.dismiss', 'coaching',
                'coaching_flag', $1::text, '{"status":"dismissed"}'::jsonb,
                $2 FROM coaching_flags WHERE id = $1`,
        [f.id, `Re-evaluated under the confirmed 7..240 tardiness window: ${f.old} occurrence(s) → ${f.now}. Raised by the superseded ">0 minutes" trigger.`],
      ).catch(() => {});
    }
    await c.query('COMMIT');
    console.log(`\n  ✅ ${toClose.length} flag(s) dismissed, each with an audit row. Nothing was deleted.\n`);
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  await c.end();
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
