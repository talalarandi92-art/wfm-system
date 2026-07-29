/**
 * INGEST the corrected June reconciliation (scratchpad/recon/ingest.json) into the LIVE roster_days,
 * so the redesigned /roster page shows the validated data instead of the old pipeline.
 *
 * SAFE: backs up the affected range first (roster_days_recon_bak), runs in ONE transaction, and only
 * touches June 1..HORIZON for the demo tenant. Restore = node recon-ingest.js --restore.
 */
const fs = require('fs');
const { getClient } = require('./recon-db');
const SCRATCH = process.env.RECON_SCRATCH || require('path').join(__dirname, '..', '.recon-scratch');
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
  raw_sys_late_min: 'rawSysLate', raw_sys_early_min: 'rawSysEarly',
  ot_min: 'otMin', offday_ot_min: 'offdayOt', holiday_ot_min: 'holidayOt', ot_record_only: 'otRecordOnly', worked_min: 'worked',
  off_worked_min: 'offWorkedMin', off_worked_hr_review: 'offWorkedHrReview',   // migration 082 (Director decision 1)
  adherence_pct: 'adherence', conforming: 'conforming', permission: 'permission', permission_status: 'permissionStatus', permission_type: 'permType', permission_duration: 'permDur',
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
    /* Pre-forgiveness tardiness — makes conformance reproducible from the row (2026-07-29). */
    await c.query(`ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS raw_sys_late_min integer`);
    await c.query(`ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS raw_sys_early_min integer`);
    await c.query(`ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS ot_record_only boolean NOT NULL DEFAULT false`); // migration 081 (Director rule 4) — self-heal like username
    // migration 082 (Director decision 1) — OFF-worked → HR clarify, NOT auto-OT; self-heal so a refresh never NULLs
    await c.query(`ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS off_worked_min integer NOT NULL DEFAULT 0`);
    await c.query(`ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS off_worked_hr_review boolean NOT NULL DEFAULT false`);
    // migration 083 (Director decision 2) — before/after-shift OT review flags (preserve-on-rebuild)
    await c.query(`CREATE TABLE IF NOT EXISTS ot_review_flags (
      id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, person_no text NOT NULL, work_date date NOT NULL,
      kind text NOT NULL, minutes integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
      employee_name text, function_name text, reviewed_by text, reviewed_at timestamptz, note text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ot_review ON ot_review_flags (tenant_id, person_no, work_date, kind)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_ot_review_status ON ot_review_flags (tenant_id, status, work_date)`);
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

    // ── CRITICAL SAFETY (FIX 1 — pre-June wipe guard): NEVER DELETE roster_days earlier than the
    //    earliest date this ingest actually CARRIES. An operator who sets RECON_FROM to a pre-June date
    //    while the source folder holds only June+ data would otherwise DELETE the whole Jan–May history
    //    (rows this ingest cannot replace), and the golden test — scoped to the June+ era — would still
    //    pass vacuously. Refuse any delete-from earlier than the source floor. HARD_FLOOR is the ultimate
    //    reconciled-era floor used when the source min can't be derived. A legitimate June rebuild
    //    (source starts 2026-06-01) is unaffected; narrowing the range (RECON_FROM later) is fine.
    const HARD_FLOOR = '2026-06-01';                                   // reconciled era never starts before this
    const srcMin = ingDates[0] || HARD_FLOOR;                          // earliest work_date present in ingest.json (guarded non-empty above)
    const deleteFloor = srcMin > HARD_FLOOR ? srcMin : HARD_FLOOR;     // whichever is LATER = the safest allowed floor
    if (rFrom < deleteFloor) {
      throw new Error(
        `REFUSING pre-floor wipe: requested delete-from ${rFrom} (RECON_FROM) is earlier than the allowed floor ${deleteFloor} ` +
        `(earliest date present in ingest.json = ${srcMin}; reconciled-era hard floor = ${HARD_FLOOR}). ` +
        `A DELETE from ${rFrom} would wipe roster_days history this ingest cannot replace. ` +
        `Set RECON_FROM >= ${deleteFloor} or leave it unset for a normal rebuild.`);
    }

    /* ── CRITICAL SAFETY (FIX 2 — thin-coverage wipe, 2026-07-29). Replacing a RANGE is
       not the same as replacing what the upload actually covers. A July payload also
       carries a handful of rows on late-June dates, because two fixed-pattern employees
       have their weekly pattern projected backwards. rFrom therefore came out as
       2026-06-20, and BETWEEN deleted eleven days of June — ~118 rows each — to insert
       two. The pre-floor guard above did not fire: 2026-06-20 IS the payload's floor.
       Nothing was lost (roster_days_recon_bak held it, restored via
       recon-restore-range.js), but the roster read as an empty month in between.

       So delete the DATES THIS UPLOAD COVERS, never a span. A date counts as covered
       when the payload brings a real share of what is already there; a date carrying a
       couple of projected rows is left alone and reported. Shrinkage is normal as people
       leave, so the bar is deliberately low (20%) — this is a collapse detector, not an
       equality check. RECON_ALLOW_THIN=1 restores the old behaviour for a deliberate
       partial rebuild. */
    const payloadByDate = new Map();
    for (const d of ingDates) payloadByDate.set(d, (payloadByDate.get(d) || 0) + 1);
    const liveByDate = new Map((await c.query(
      `SELECT work_date::text d, COUNT(*)::int n FROM roster_days
        WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 GROUP BY 1`, [TENANT, rFrom, rTo])).rows
      .map((r) => [r.d, r.n]));

    const covered = [], thin = [];
    for (const [d, n] of payloadByDate) {
      if (d < rFrom || d > rTo) continue;
      const live = liveByDate.get(d) || 0;
      (process.env.RECON_ALLOW_THIN === '1' || live === 0 || n >= Math.max(3, live * 0.2) ? covered : thin)
        .push({ d, n, live });
    }
    covered.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!covered.length) throw new Error('no date in ingest.json brings enough rows to replace what is stored — refusing to delete anything');
    if (thin.length) {
      console.log(`thin-coverage dates LEFT UNTOUCHED (payload has far fewer rows than stored):`);
      for (const t of thin.sort((a, b) => (a.d < b.d ? -1 : 1))) console.log(`   ${t.d}  payload ${t.n} vs stored ${t.live}`);
    }
    const coveredDates = covered.map((x) => x.d);

    await c.query('BEGIN');
    // BACKUP the affected dates FRESH each run = a true "undo last ingest"
    await c.query(`DROP TABLE IF EXISTS roster_days_recon_bak`);
    await c.query(`CREATE TABLE roster_days_recon_bak AS SELECT * FROM roster_days WHERE tenant_id=$1 AND work_date::text = ANY($2)`, [TENANT, coveredDates]);
    const bakN = (await c.query('SELECT COUNT(*)::int n FROM roster_days_recon_bak')).rows[0].n;

    // REPLACE only the dates this upload actually covers
    console.log(`ingest range: ${coveredDates[0]} .. ${coveredDates[coveredDates.length - 1]}  ` +
      `(${coveredDates.length} covered day(s)${thin.length ? `, ${thin.length} thin day(s) skipped` : ''}; backed up ${bakN} rows before replace)`);
    /* Record what was JUST WRITTEN, for step 4. The resync used to read its range from
       roster_days_recon_bak — but that table holds the rows as they were BEFORE the
       replace, so after the July load its max date was 2026-07-03 and the resync covered
       06-20..07-03 while the ingest had written through 07-28. The raw spine silently
       stopped 25 days short of the roster. */
    fs.writeFileSync(SCRATCH + '/last-ingest-range.json',
      JSON.stringify({ from: coveredDates[0], to: coveredDates[coveredDates.length - 1], dates: coveredDates, at: new Date().toISOString() }));
    await c.query(`DELETE FROM roster_days WHERE tenant_id=$1 AND work_date::text = ANY($2)`, [TENANT, coveredDates]);
    const allCols = (hasTenant ? ['tenant_id'] : []).concat(cols);
    let inserted = 0;
    /* Only rows for the dates just cleared. Inserting a thin date's rows on top of the
       stored ones would duplicate the person-day rather than replace it. */
    const coveredSet = new Set(coveredDates);
    for (const r of ing) {
      if (!coveredSet.has(r.date)) continue;
      const vals = (hasTenant ? [TENANT] : []).concat(cols.map(col => { const v = r[MAP[col]]; return v === undefined ? null : v; }));
      const ph = vals.map((_, i) => '$' + (i + 1)).join(',');
      await c.query(`INSERT INTO roster_days (${allCols.join(',')}) VALUES (${ph})`, vals);
      inserted++;
    }
    // ── Director decision 2 (2026-07-11): populate before/after-shift OT REVIEW FLAGS.
    //    PRESERVE-ON-REBUILD (mirrors src/common/ot-review.ts mergePendingFlags + attendance_excuses):
    //    only refresh 'pending' rows for the ingested range; never touch an acknowledged/ignored decision.
    //    A pending flag is raised whenever ot_before_min OR ot_after_min ≥ 15 min.
    const REVIEW_THRESHOLD = 15;
    let flagsInserted = 0;
    // drop only STALE pending flags in range (resolved decisions survive), then re-raise from current evidence
    // scoped to the same covered dates as the row replace — a thin date keeps its flags
    await c.query(`DELETE FROM ot_review_flags WHERE tenant_id=$1 AND work_date::text = ANY($2) AND status='pending'`, [TENANT, coveredDates]);
    for (const r of ing) {
      if (!coveredSet.has(r.date)) continue;
      for (const kind of ['before', 'after']) {
        const mins = Math.round(Number(kind === 'before' ? r.otBefore : r.otAfter) || 0);
        if (mins < REVIEW_THRESHOLD) continue;
        // ON CONFLICT DO NOTHING → a resolved (acknowledged/ignored) row for this person/date/kind is preserved.
        const res = await c.query(
          `INSERT INTO ot_review_flags (tenant_id, person_no, work_date, kind, minutes, status, employee_name, function_name)
           VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)
           ON CONFLICT (tenant_id, person_no, work_date, kind) DO NOTHING`,
          [TENANT, String(r.person), r.date, kind, mins, r.name || null, r.fn || null]);
        if (res.rowCount > 0) flagsInserted++;
      }
    }
    await c.query('COMMIT');
    console.log('INGEST OK — backed up ' + bakN + ' rows → roster_days_recon_bak; replaced June with ' + inserted + ' corrected rows (cols=' + cols.length + '); raised ' + flagsInserted + ' pending OT-review flag(s)');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.log('INGEST FAILED (rolled back): ' + e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
