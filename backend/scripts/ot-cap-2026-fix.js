#!/usr/bin/env node
/*
 * ONE-TIME OT CORRECTION — Jan–May 2026 (roster_days), 2026-07-12.
 *
 * WHY: the OLD writer import-roster-master.js:380 wrote ot_min = odooOT + otBefore + otAfter,
 * bundled/double-counted with NO 300 ceiling — so 494 pre-June rows carry ot_min > 300, violating
 * the agreed BR-OT-004 5h/300-min OT ceiling that June/July (recon engine) already enforce. A deep
 * 5-agent analysis + a full dry-run to a scratch table PROVED that re-deriving Jan–May through the
 * writer is UNSAFE (sources drifted → it would regress 3,129 NON-OT rows). So the only safe fix is
 * this TARGETED in-place correction, which touches ONLY ot_min (+ a data_quality flag) on exactly the
 * defective rows, preserving every other column and the separate holiday/offday OT premium buckets.
 *
 * WHAT IT DOES (safe + reversible):
 *   1. Full-row backup of every affected row → roster_days_otcap_bak (dropped+recreated each run).
 *   2. In ONE transaction:
 *      - CAP: 494 rows with ot_min>300  → ot_min=300, flag 'ot-cap-300-br004'.
 *      - FLAG ONLY (no value change): 140 rows with ot_min<=300 but (TRUE_OT > worked_min) — physically
 *        impossible bundled-bleed → flag 'ot-exceeds-worked-review' for HR/Director review (NOT auto-altered,
 *        so no one is wrongly under-paid on ambiguous evidence).
 *   3. Verify: no pre-June ot_min>300 remains; report TRUE_OT drop (~62,451 min).
 *
 * REVERSE (undo everything this did):
 *   UPDATE roster_days t SET ot_min=b.ot_min, data_quality=b.data_quality
 *     FROM roster_days_otcap_bak b
 *    WHERE t.tenant_id=b.tenant_id AND t.employee_no=b.employee_no AND t.work_date=b.work_date;
 *
 * RUN:  node backend/scripts/ot-cap-2026-fix.js
 */
const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

(async () => {
  const c = new Client({
    host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  });
  await c.connect();
  const one = async (s, p) => (await c.query(s, p)).rows[0];

  const b4 = await one(`SELECT COUNT(*) over300,
    (SELECT COUNT(*) FROM roster_days WHERE work_date<'2026-06-01' AND ot_min<=300 AND (ot_min+offday_ot_min+holiday_ot_min)>worked_min) impossible,
    (SELECT COALESCE(SUM(ot_min+offday_ot_min+holiday_ot_min),0) FROM roster_days WHERE work_date<'2026-06-01') true_ot_pre
    FROM roster_days WHERE work_date<'2026-06-01' AND ot_min>300`);
  console.log(`BEFORE  over300=${b4.over300}  impossible<=300=${b4.impossible}  TRUE_OT(pre-June)=${b4.true_ot_pre}`);

  await c.query('DROP TABLE IF EXISTS roster_days_otcap_bak');
  await c.query(`CREATE TABLE roster_days_otcap_bak AS
    SELECT *, now() AS backed_up_at,
      CASE WHEN ot_min>300 THEN 'ot-cap-300-br004' ELSE 'ot-exceeds-worked-review' END AS fix_reason
    FROM roster_days
    WHERE work_date<'2026-06-01' AND (ot_min>300 OR (ot_min<=300 AND (ot_min+offday_ot_min+holiday_ot_min)>worked_min))`);
  const bak = await one('SELECT COUNT(*) n FROM roster_days_otcap_bak');
  console.log(`BACKUP  roster_days_otcap_bak rows=${bak.n}  (full-row snapshot for reversibility)`);

  await c.query('BEGIN');
  const cap = await c.query(`UPDATE roster_days SET ot_min=300,
      data_quality=CASE WHEN data_quality IS NULL OR data_quality='' THEN 'ot-cap-300-br004' ELSE data_quality||'; ot-cap-300-br004' END
    WHERE work_date<'2026-06-01' AND ot_min>300`);
  const flag = await c.query(`UPDATE roster_days SET
      data_quality=CASE WHEN data_quality IS NULL OR data_quality='' THEN 'ot-exceeds-worked-review' ELSE data_quality||'; ot-exceeds-worked-review' END
    WHERE work_date<'2026-06-01' AND ot_min<=300 AND (ot_min+offday_ot_min+holiday_ot_min)>worked_min`);
  await c.query('COMMIT');
  console.log(`APPLIED capped=${cap.rowCount} (expect 494)  flagged-for-review=${flag.rowCount} (expect 140)`);

  const af = await one(`SELECT
    (SELECT COUNT(*) FROM roster_days WHERE work_date<'2026-06-01' AND ot_min>300) still_over300,
    (SELECT COALESCE(SUM(ot_min+offday_ot_min+holiday_ot_min),0) FROM roster_days WHERE work_date<'2026-06-01') true_ot_pre_after`);
  console.log(`AFTER   still_over300=${af.still_over300} (must be 0)  TRUE_OT(pre-June)=${af.true_ot_pre_after}  dropped=${b4.true_ot_pre - af.true_ot_pre_after}`);
  console.log('DONE. Reverse anytime from roster_days_otcap_bak (see header).');
  await c.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
