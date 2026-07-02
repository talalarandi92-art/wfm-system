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
  username: 'username', total_work_sys_min: 'totalSysMin', daily_note: 'dailyNote', include_tardiness: 'includeTardiness',
  ot_before_min: 'otBefore', ot_after_min: 'otAfter', week_number: 'weekNumber', month_name: 'monthName',
  attendance_status: 'attendanceStatus', late_category: 'lateCategory', missing_punch: 'missingPunch',
  missing_system: 'missingSystem', crosses_midnight: 'crossesMidnight', original_shift_code: 'originalShiftCode',
  team_manager: 'teamMgr', team_group: 'teamGroup', gender: 'gender', role_category: 'roleCat',
  expected_hours: 'expectedH', is_active: 'active',
};

(async () => {
  const c = getClient();
  await c.connect();
  try {
    await c.query(`ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS username text`); // User ID (a.wahab) — durable across re-ingest
    // keep the editable holiday list (recon-config.json) mirrored into the `holidays` table so the leave-balance
    // calc can exclude holidays that fall inside annual leave (rule: a holiday during leave returns to the balance).
    try {
      const cfg = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'recon-config.json'), 'utf8'));
      await c.query(`CREATE TABLE IF NOT EXISTS holidays (tenant_id uuid NOT NULL, holiday_date date NOT NULL, name text, PRIMARY KEY (tenant_id, holiday_date))`);
      for (const h of (cfg.holidays || []))
        await c.query(`INSERT INTO holidays (tenant_id, holiday_date, name) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, holiday_date) DO UPDATE SET name=EXCLUDED.name`, [TENANT, h.date, h.name]);
      console.log('synced ' + (cfg.holidays || []).length + ' holidays → holidays table');
    } catch (e) { console.warn('holidays sync skipped: ' + e.message); }
    if (RESTORE) {
      await c.query('BEGIN');
      const br = (await c.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days_recon_bak WHERE tenant_id=$1`, [TENANT])).rows[0];
      const rf = (br && br.a) || FROM, rt = (br && br.b) || TO;   // restore ONLY the range the backup covers
      await c.query(`DELETE FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TENANT, rf, rt]);
      const n = await c.query(`INSERT INTO roster_days SELECT * FROM roster_days_recon_bak WHERE tenant_id=$1`, [TENANT]);
      await c.query('COMMIT');
      console.log(`RESTORED from roster_days_recon_bak (${rf}..${rt}, ${n.rowCount} rows)`);
      await c.end(); return;
    }
    const ing = JSON.parse(fs.readFileSync(SCRATCH + '/ingest.json', 'utf8'));
    // keep only columns that actually exist in the table
    const existing = new Set((await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='roster_days'")).rows.map(r => r.column_name));
    const cols = Object.keys(MAP).filter(col => existing.has(col));
    const hasTenant = existing.has('tenant_id');

    // ── CRITICAL SAFETY (added after the 2026-07-01 partial-upload wipe): only ever replace the date
    //    range that is ACTUALLY present in this upload. A partial upload (e.g. just Jun 28–30) must NEVER
    //    wipe the rest of the month. Derive the range from the records; explicit RECON_FROM/TO env still wins.
    const ingDates = ing.map(r => r.date).filter(Boolean).sort();
    if (!ingDates.length) throw new Error('ingest.json has no dated records — refusing to delete anything');
    const rFrom = process.env.RECON_FROM || ingDates[0];
    const rTo   = process.env.RECON_TO   || ingDates[ingDates.length - 1];

    await c.query('BEGIN');
    // BACKUP the affected range FRESH each run = a true "undo last ingest"
    await c.query(`DROP TABLE IF EXISTS roster_days_recon_bak`);
    await c.query(`CREATE TABLE roster_days_recon_bak AS SELECT * FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TENANT, rFrom, rTo]);
    const bakN = (await c.query('SELECT COUNT(*)::int n FROM roster_days_recon_bak')).rows[0].n;

    // REPLACE only the uploaded range for this tenant with the corrected rows
    console.log(`ingest range: ${rFrom} .. ${rTo}  (backed up ${bakN} rows before replace)`);
    await c.query(`DELETE FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [TENANT, rFrom, rTo]);
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
