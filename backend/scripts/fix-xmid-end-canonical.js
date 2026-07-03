/**
 * ROOT FIX (2026-07-03 deep audit) — normalize legacy cross-midnight rows so shift_end_min is
 * always the recon-engine CANONICAL form (start+duration, MD 22:00→07:00 = 1320→1860), never the
 * raw wall-clock end (420) with crosses_midnight=false.
 *
 * WHY: 449 legacy is_active rows (229 MD + 220 E) store end<start with crosses_midnight=false.
 * At least FIVE consumers read shift_end_min WITHOUT wrap-correction and silently break on them:
 *   - the 10h rest-rule validator (undetected rest violations — SAFETY),
 *   - schedule-analysis hourly HC + /hourly-coverage-live (shifts dropped from the grid),
 *   - the WFH-HR report (negative gross → fairness guard bypassed),
 *   - covHours (safe only by luck).
 * Patching every consumer forever is fragile; normalizing the DATA once (to match the 3019 already-
 * canonical rows) closes all of them and is the durable fix. Idempotent + backed up + reversible.
 *
 * Restore: DROP TABLE roster_days; ALTER TABLE roster_days_xmid_bak_20260703 RENAME TO roster_days;
 * (or targeted: UPDATE from the backup for the affected keys).
 */
const { getClient } = require('./recon-db');

(async () => {
  const c = getClient();
  await c.connect();
  const BAK = 'roster_days_xmid_bak_20260703';
  const [{ exists }] = (await c.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1) AS exists`, [BAK])).rows;
  if (!exists) {
    // back up ONLY the rows we are about to touch (small, targeted, fast restore)
    await c.query(`CREATE TABLE ${BAK} AS SELECT * FROM roster_days
                     WHERE shift_end_min IS NOT NULL AND shift_start_min IS NOT NULL AND shift_end_min < shift_start_min`);
    const [{ n }] = (await c.query(`SELECT COUNT(*)::int n FROM ${BAK}`)).rows;
    console.log('backup created: ' + BAK + ' (' + n + ' rows)');
  } else {
    console.log('backup already exists: ' + BAK + ' (kept)');
  }

  const before = (await c.query(
    `SELECT shift_code, COUNT(*)::int n FROM roster_days
      WHERE shift_end_min IS NOT NULL AND shift_start_min IS NOT NULL AND shift_end_min < shift_start_min
      GROUP BY 1 ORDER BY 2 DESC`)).rows;
  console.log('rows to normalize:', before);

  await c.query('BEGIN');
  try {
    const res = await c.query(
      `UPDATE roster_days
          SET shift_end_min = shift_end_min + 1440, crosses_midnight = TRUE
        WHERE shift_end_min IS NOT NULL AND shift_start_min IS NOT NULL AND shift_end_min < shift_start_min`);
    console.log('rows normalized: ' + res.rowCount);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; }

  const [{ leftover }] = (await c.query(
    `SELECT COUNT(*)::int leftover FROM roster_days
      WHERE shift_end_min IS NOT NULL AND shift_start_min IS NOT NULL AND shift_end_min < shift_start_min`)).rows;
  const [{ canon, xmid }] = (await c.query(
    `SELECT COUNT(*)::int canon, COUNT(*) FILTER (WHERE crosses_midnight)::int xmid
       FROM roster_days WHERE is_active AND shift_end_min > 1440`)).rows;
  console.log('leftover raw-wrapped rows (must be 0):', leftover);
  console.log('canonical (se>1440) now:', canon, 'of which crosses_midnight=true:', xmid);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
