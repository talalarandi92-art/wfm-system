/**
 * INGEST the corrected June reconciliation (scratchpad/recon/ingest.json) into the LIVE roster_days,
 * so the redesigned /roster page shows the validated data instead of the old pipeline.
 *
 * SAFE: backs up the affected range first (roster_days_recon_bak), runs in ONE transaction, and only
 * touches June 1..HORIZON for the demo tenant. Restore = node recon-ingest.js --restore.
 */
const fs = require('fs');
const { getClient } = require('./recon-db');
const SCRATCH = 'C:/Users/T573E~1.BAS/AppData/Local/Temp/claude/C--Users-t-bassam-Desktop-WFM-System/63e84c5a-2fd1-476e-8a73-031ad06b92a0/scratchpad/recon';
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const FROM = '2026-06-01', TO = '2026-06-30';
const RESTORE = process.argv.includes('--restore');

// roster_days column  ->  ingest field
const MAP = {
  employee_no: 'emp', person_no: 'person', name: 'name', clean_name: 'name', function_name: 'fn', role_function: 'fn',
  work_date: 'date', day_name: 'day', status: 'status', presence: 'presence', location: 'location',
  shift_code: 'shiftCode', shift_category: 'shiftCat', shift_start_min: 'schedStart', shift_end_min: 'schedEnd',
  punch_in_min: 'punchIn', punch_out_min: 'punchOut', sys_login_min: 'sysLogin', sys_logout_min: 'sysLogout', login_src: 'loginSrc',
  late_min: 'lateMin', early_min: 'earlyMin', sys_late_min: 'sysLate', sys_early_min: 'sysEarly',
  ot_min: 'otMin', offday_ot_min: 'offdayOt', holiday_ot_min: 'holidayOt', worked_min: 'worked',
  adherence_pct: 'adherence', conforming: 'conforming', permission: 'permission', permission_type: 'permType', permission_duration: 'permDur',
  comp_off: 'comp', sick: 'sick', hr_code: 'hrCode', attendance_code: 'attCode', mismatch: 'mismatch', data_quality: 'dq',
  team_manager: 'teamMgr', team_group: 'teamGroup', gender: 'gender', role_category: 'roleCat',
  expected_hours: 'expectedH', is_active: 'active',
};

(async () => {
  const c = getClient();
  await c.connect();
  try {
    if (RESTORE) {
      await c.query('BEGIN');
      await c.query(`DELETE FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TENANT, FROM, TO]);
      const n = await c.query(`INSERT INTO roster_days SELECT * FROM roster_days_recon_bak`);
      await c.query('COMMIT');
      console.log('RESTORED from roster_days_recon_bak');
      await c.end(); return;
    }
    const ing = JSON.parse(fs.readFileSync(SCRATCH + '/ingest.json', 'utf8'));
    // keep only columns that actually exist in the table
    const existing = new Set((await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='roster_days'")).rows.map(r => r.column_name));
    const cols = Object.keys(MAP).filter(col => existing.has(col));
    const hasTenant = existing.has('tenant_id');

    await c.query('BEGIN');
    // BACKUP the affected range ONCE — keep the very first snapshot, never clobber it on re-ingest
    await c.query(`CREATE TABLE IF NOT EXISTS roster_days_recon_bak AS SELECT * FROM roster_days WHERE work_date BETWEEN $1 AND $2`, [FROM, TO]);
    const bakN = (await c.query('SELECT COUNT(*)::int n FROM roster_days_recon_bak')).rows[0].n;

    // REPLACE June 1..30 for this tenant with the corrected rows
    await c.query(`DELETE FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TENANT, FROM, TO]);
    const allCols = (hasTenant ? ['tenant_id'] : []).concat(cols);
    let inserted = 0;
    for (const r of ing) {
      const vals = (hasTenant ? [TENANT] : []).concat(cols.map(col => { const v = r[MAP[col]]; return v === undefined ? null : v; }));
      const ph = vals.map((_, i) => '$' + (i + 1)).join(',');
      await c.query(`INSERT INTO roster_days (${allCols.join(',')}) VALUES (${ph})`, vals);
      inserted++;
    }
    await c.query('COMMIT');
    console.log('INGEST OK — backed up ' + bakN + ' rows → roster_days_recon_bak; replaced June with ' + inserted + ' corrected rows (cols=' + cols.length + ')');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.log('INGEST FAILED (rolled back): ' + e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
