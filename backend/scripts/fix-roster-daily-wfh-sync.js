/**
 * O-12 (2026-07-03) — sync legacy roster_daily presence to the CANONICAL roster_days.
 *
 * Why: roster_daily was built by the OLD ingest that inferred WFH from "system login +
 * no punch" (violates BR-WFH-001, corrected 2026-06-24). The engine code is fixed, but
 * the original SRC_DIR exports are gone from disk, so a re-ingest is impossible — the
 * only trustworthy source for those days is the canonical roster_days (Jan-1 → Jun-27).
 *
 * What it does (idempotent, backed up):
 *   1. CREATE TABLE roster_daily_wfh_bak_20260703 AS SELECT * FROM roster_daily (once).
 *   2. For every roster_daily row with a matching ACTIVE roster_days row whose canonical
 *      presence ∈ (office, wfh, absent) and differs → set presence (column + payload jsonb)
 *      to the canonical value. Canonical sick/leave/holiday/off/left are NOT mapped (outside
 *      the legacy domain — left untouched, reported).
 *
 * Restore: DROP TABLE roster_daily; ALTER TABLE roster_daily_wfh_bak_20260703 RENAME TO roster_daily;
 */
const { getClient } = require('./recon-db');

(async () => {
  const c = getClient();
  await c.connect();
  const BAK = 'roster_daily_wfh_bak_20260703';
  const [{ exists }] = (await c.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1) AS exists`, [BAK])).rows;
  if (!exists) {
    await c.query(`CREATE TABLE ${BAK} AS SELECT * FROM roster_daily`);
    console.log('backup created: ' + BAK);
  } else {
    console.log('backup already exists: ' + BAK + ' (kept as-is)');
  }

  const before = (await c.query(
    `SELECT d.presence AS from_p, r.presence AS to_p, COUNT(*)::int n
       FROM roster_daily d JOIN roster_days r
         ON r.employee_no = d.employee_no AND r.work_date = d.work_date AND r.is_active
      WHERE r.presence IN ('office','wfh','absent') AND d.presence IS DISTINCT FROM r.presence
      GROUP BY 1,2 ORDER BY 3 DESC`)).rows;
  console.log('will change:', before);

  await c.query('BEGIN');
  try {
    const res = await c.query(
      `UPDATE roster_daily d
          SET presence = r.presence,
              payload  = CASE WHEN d.payload IS NULL THEN d.payload
                              ELSE jsonb_set(d.payload, '{presence}', to_jsonb(r.presence)) END
         FROM roster_days r
        WHERE r.employee_no = d.employee_no AND r.work_date = d.work_date AND r.is_active
          AND r.presence IN ('office','wfh','absent')
          AND d.presence IS DISTINCT FROM r.presence`);
    console.log('rows updated: ' + res.rowCount);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }

  const untouched = (await c.query(
    `SELECT r.presence AS canonical, COUNT(*)::int n
       FROM roster_daily d JOIN roster_days r
         ON r.employee_no = d.employee_no AND r.work_date = d.work_date AND r.is_active
      WHERE r.presence NOT IN ('office','wfh','absent') AND d.presence IS DISTINCT FROM r.presence
      GROUP BY 1 ORDER BY 2 DESC`)).rows;
  console.log('left untouched (canonical outside legacy domain):', untouched);
  const after = (await c.query(`SELECT presence, COUNT(*)::int FROM roster_daily GROUP BY 1 ORDER BY 2 DESC`)).rows;
  console.log('roster_daily presence AFTER:', after);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
