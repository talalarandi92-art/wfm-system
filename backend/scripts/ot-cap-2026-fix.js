#!/usr/bin/env node
/*
 * ONE-TIME OT CORRECTION — Jan–May 2026 (roster_days), 2026-07-12. OPTION B (Director-approved).
 *
 * WHY: the OLD writer import-roster-master.js:380 wrote ot_min = odooOT + otBefore + otAfter,
 * bundled/double-counted with NO 300 ceiling — so 494 pre-June rows carry ot_min > 300, violating
 * the agreed BR-OT-004 5h/300-min OT ceiling that June/July (recon engine) already enforce. A deep
 * analysis + a full dry-run PROVED re-deriving Jan–May through the writer is UNSAFE (sources drifted
 * → it would regress 3,129 NON-OT rows). So this is a TARGETED in-place correction, split by kind.
 *
 * THE SPLIT (494 rows, verified 2026-07-12):
 *   • 457 REGULAR rows (worked a normal/scheduled day, OT bled past the 5h ceiling)
 *        → ot_min capped at 300 (BR-OT-004), flag 'ot-cap-300-br004'.
 *   • 37 OFF-DAY / COMP rows (status OFF SHIFT / Off Day / Comp Off — they WORKED their off day,
 *        all with punch/system evidence; the old writer wrongly dumped the whole off-day shift into
 *        payable ot_min). Per the Director's own 2026-07-11 rule (off-day work → off_worked_min +
 *        HR review, NOT auto-paid), route them to review: ot_min → 0, off_worked_min ← worked_min,
 *        flag 'offday-worked-review'. NOTHING is lost — the real off-day work is preserved & VISIBLE,
 *        and the Director pays the correct amount on acknowledge (matches June/July).
 *   • 140 IMPOSSIBLE rows (ot_min ≤ 300 but TRUE_OT > worked_min — bundled bleed) → flag
 *        'ot-exceeds-worked-review', NO value change (ambiguous → surfaced, never auto-cut).
 *
 * PAIRED STEP (finding #7 — keep the two spines consistent): AFTER this runs, re-derive the raw
 * spine so scorecard/coverage match: `node scripts/recon-sync-attendance.js 2026-01-01 2026-05-31`
 * (it projects attendance_records.ot_minutes = TRUE_OT from the corrected roster_days). Do NOT hand-
 * UPDATE attendance_records — let it re-derive so the off-day→0 treatment carries across cleanly.
 *
 * SAFE + REVERSIBLE: full-row backup → roster_days_otcap_bak; one transaction; verify. Reverse:
 *   UPDATE roster_days t SET ot_min=b.ot_min, off_worked_min=b.off_worked_min, data_quality=b.data_quality
 *     FROM roster_days_otcap_bak b
 *    WHERE t.tenant_id=b.tenant_id AND t.employee_no=b.employee_no AND t.work_date=b.work_date;
 *
 * PRECONDITION: take an off-machine backup FIRST (backup-local.ps1). RUN: node backend/scripts/ot-cap-2026-fix.js
 */
const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const OFFDAY = `(status ILIKE '%off shift%' OR status ILIKE '%off day%' OR status ILIKE '%comp off%')`;

(async () => {
  const c = new Client({
    host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  });
  await c.connect();
  const one = async (s, p) => (await c.query(s, p)).rows[0];

  const b4 = await one(`SELECT
    COUNT(*) FILTER (WHERE ot_min>300 AND NOT ${OFFDAY}) regular_over,
    COUNT(*) FILTER (WHERE ot_min>300 AND ${OFFDAY}) offday_over,
    COUNT(*) FILTER (WHERE ot_min<=300 AND (ot_min+offday_ot_min+holiday_ot_min)>worked_min) impossible,
    (SELECT COALESCE(SUM(ot_min+offday_ot_min+holiday_ot_min),0) FROM roster_days WHERE work_date<'2026-06-01') true_ot_pre
    FROM roster_days WHERE work_date<'2026-06-01'`);
  console.log(`BEFORE  regular>300=${b4.regular_over}  offday>300=${b4.offday_over}  impossible<=300=${b4.impossible}  TRUE_OT(pre-June)=${b4.true_ot_pre}`);

  await c.query('DROP TABLE IF EXISTS roster_days_otcap_bak');
  await c.query(`CREATE TABLE roster_days_otcap_bak AS
    SELECT *, now() AS backed_up_at,
      CASE WHEN ot_min>300 AND ${OFFDAY} THEN 'offday-worked-review'
           WHEN ot_min>300 THEN 'ot-cap-300-br004'
           ELSE 'ot-exceeds-worked-review' END AS fix_reason
    FROM roster_days
    WHERE work_date<'2026-06-01' AND (ot_min>300 OR (ot_min<=300 AND (ot_min+offday_ot_min+holiday_ot_min)>worked_min))`);
  console.log(`BACKUP  roster_days_otcap_bak rows=${(await one('SELECT COUNT(*) n FROM roster_days_otcap_bak')).n}  (full-row snapshot for reversibility)`);

  await c.query('BEGIN');
  const reg = await c.query(`UPDATE roster_days SET ot_min=300,
      data_quality=CASE WHEN data_quality IS NULL OR data_quality='' THEN 'ot-cap-300-br004' ELSE data_quality||'; ot-cap-300-br004' END
    WHERE work_date<'2026-06-01' AND ot_min>300 AND NOT ${OFFDAY}`);
  const off = await c.query(`UPDATE roster_days SET ot_min=0, off_worked_min=GREATEST(off_worked_min, worked_min),
      data_quality=CASE WHEN data_quality IS NULL OR data_quality='' THEN 'offday-worked-review' ELSE data_quality||'; offday-worked-review' END
    WHERE work_date<'2026-06-01' AND ot_min>300 AND ${OFFDAY}`);
  const imp = await c.query(`UPDATE roster_days SET
      data_quality=CASE WHEN data_quality IS NULL OR data_quality='' THEN 'ot-exceeds-worked-review' ELSE data_quality||'; ot-exceeds-worked-review' END
    WHERE work_date<'2026-06-01' AND ot_min<=300 AND (ot_min+offday_ot_min+holiday_ot_min)>worked_min`);
  await c.query('COMMIT');
  console.log(`APPLIED  regular-capped=${reg.rowCount} (expect 457)  offday→review=${off.rowCount} (expect 37)  impossible-flagged=${imp.rowCount} (expect 140)`);

  const af = await one(`SELECT
    (SELECT COUNT(*) FROM roster_days WHERE work_date<'2026-06-01' AND ot_min>300) still_over300,
    (SELECT COALESCE(SUM(off_worked_min),0) FROM roster_days WHERE work_date<'2026-06-01' AND data_quality LIKE '%offday-worked-review%') offday_worked_parked,
    (SELECT COALESCE(SUM(ot_min+offday_ot_min+holiday_ot_min),0) FROM roster_days WHERE work_date<'2026-06-01') true_ot_pre_after`);
  console.log(`AFTER   still_over300=${af.still_over300} (must be 0)  off-day worked parked for review=${af.offday_worked_parked} min  TRUE_OT(pre-June)=${af.true_ot_pre_after}`);
  console.log('NEXT    sync the raw spine:  node scripts/recon-sync-attendance.js 2026-01-01 2026-05-31');
  console.log('DONE. Reverse anytime from roster_days_otcap_bak (see header).');
  await c.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
