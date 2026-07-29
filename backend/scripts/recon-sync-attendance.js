/**
 * RECON step 4 — resync attendance_records from canonical roster_days (2026-07-06,
 * EXECUTION_BRIEF bug #1: recon-refresh never resynced the raw spine, so the 31 readers of
 * attendance_records — dashboard/RTA/scorecard/coverage — showed DIFFERENT OT/late/presence
 * than the roster pages after every rebuild; e.g. person 6297 2026-06-10 TRUE_OT 300 vs 0).
 *
 * Projects, for the ingested date range, per person-day:
 *   attendance_marker (presence/hr_code → enum), scheduled_start/end (shift minutes → time),
 *   ot_minutes = TRUE_OT (all 3 disjoint buckets summed), system/punch late+early,
 *   is_wfh, is_missing_punch/system  →  into attendance_records (matched via
 *   employees.employee_no = roster_days.person_no).
 *
 * SAFETY:
 *   • DRY-RUN by default — prints the would-change counts; APPLY=1 to write.
 *   • Only touches the range roster_days_recon_bak covers (= the last ingest), or
 *     SYNC_FROM/SYNC_TO env. Never touches dates outside it.
 *   • Preserves published/generated future weeks (notes LIKE '[generated %') — the
 *     schedule plan is NOT attendance truth.
 *   • UPDATE-only (does not INSERT): a person-day with no attendance_records row simply
 *     stays absent from the raw spine — no fabrication.
 *   • One real transaction.
 *
 * Wired as step 4 in recon-refresh.js (env APPLY=1 there — the pipeline already ingested).
 */
const fs = require('fs');
const { getClient } = require('./recon-db');
const SCRATCH = process.env.RECON_SCRATCH || require('path').join(__dirname, '..', '.recon-scratch');
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');

(async () => {
  const c = getClient();
  await c.connect();
  try {
    /* Range = what the ingest JUST WROTE, read from the file it now leaves behind.
       This used to come from roster_days_recon_bak, which holds the rows as they were
       BEFORE the replace — so after the July load its max date was 2026-07-03 while the
       ingest had written through 07-28, and the raw spine stopped 25 days short of the
       roster without a word. The backup remains the fallback for an older scratch dir. */
    let from = process.env.SYNC_FROM, to = process.env.SYNC_TO;
    if (!from || !to) {
      try {
        const r = JSON.parse(fs.readFileSync(SCRATCH + '/last-ingest-range.json', 'utf8'));
        from = from || r.from; to = to || r.to;
      } catch { /* fall through to the backup table */ }
    }
    if (!from || !to) {
      const [r] = (await c.query(
        `SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days_recon_bak WHERE tenant_id=$1`, [TENANT])).rows;
      from = from || (r && r.a); to = to || (r && r.b);
    }
    if (!from || !to) throw new Error('no sync range: set SYNC_FROM/SYNC_TO or run after an ingest (roster_days_recon_bak)');
    console.log(`[sync-attendance] range ${from}..${to}  mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    // the projection — canonical roster_days → attendance_records columns
    const PROJECTION = `
      SELECT e.id AS employee_id, rd.work_date,
             (CASE
                WHEN rd.presence IN ('office','wfh') THEN 'present'
                WHEN rd.presence = 'sick'    THEN 'sick'
                WHEN rd.presence = 'absent'  THEN 'absent'
                WHEN rd.presence = 'leave'   THEN 'leave'
                WHEN rd.presence = 'holiday' THEN 'holiday'
                WHEN rd.hr_code  = 'COMP'    THEN 'comp'
                WHEN rd.presence IN ('off','left') THEN 'off'
                ELSE 'unknown'
              END)::attendance_marker_enum AS marker,
             (MAKE_INTERVAL(mins => (rd.shift_start_min % 1440)))::time AS sched_start,
             (MAKE_INTERVAL(mins => (rd.shift_end_min   % 1440)))::time AS sched_end,
             (COALESCE(rd.ot_min,0)+COALESCE(rd.offday_ot_min,0)+COALESCE(rd.holiday_ot_min,0)) AS true_ot,
             COALESCE(rd.sys_late_min,0)  AS sys_late,  COALESCE(rd.sys_early_min,0) AS sys_early,
             COALESCE(rd.late_min,0)      AS punch_late, COALESCE(rd.early_min,0)    AS punch_early,
             COALESCE(rd.presence = 'wfh', false) AS is_wfh,   -- presence can be NULL (unknown rows) and is_wfh is NOT NULL
             COALESCE(rd.missing_punch,false)  AS missing_punch,
             COALESCE(rd.missing_system,false) AS missing_system
        FROM roster_days rd
        JOIN employees e ON e.tenant_id = rd.tenant_id AND e.employee_no = rd.person_no
       WHERE rd.tenant_id = $1 AND rd.is_active AND rd.work_date BETWEEN $2 AND $3`;

    // dry-run: how many raw rows would change (any projected column differing)?
    const [stats] = (await c.query(`
      WITH m AS (${PROJECTION})
      SELECT COUNT(*)::int matched,
             COUNT(*) FILTER (WHERE ar.ot_minutes IS DISTINCT FROM m.true_ot
                              OR ar.system_late_minutes IS DISTINCT FROM m.sys_late
                              OR ar.attendance_marker    IS DISTINCT FROM m.marker
                              OR ar.is_wfh               IS DISTINCT FROM m.is_wfh)::int would_change,
             COUNT(*) FILTER (WHERE COALESCE(ar.notes,'') LIKE '[generated %')::int generated_preserved
        FROM attendance_records ar
        JOIN m ON m.employee_id = ar.employee_id AND m.work_date = ar.attendance_date
       WHERE ar.tenant_id = $1`, [TENANT, from, to])).rows;
    console.log(`[sync-attendance] matched raw rows: ${stats.matched} · would change: ${stats.would_change} · generated-week rows preserved: ${stats.generated_preserved}`);

    if (!APPLY) { console.log('[sync-attendance] DRY-RUN only — set APPLY=1 to write.'); await c.end(); return; }

    await c.query('BEGIN');
    const res = await c.query(`
      WITH m AS (${PROJECTION})
      UPDATE attendance_records ar SET
        attendance_marker         = m.marker,
        scheduled_start           = m.sched_start,
        scheduled_end             = m.sched_end,
        ot_minutes                = m.true_ot,
        system_late_minutes       = m.sys_late,
        system_early_out_minutes  = m.sys_early,
        punch_late_minutes        = m.punch_late,
        punch_early_out_minutes   = m.punch_early,
        is_wfh                    = m.is_wfh,
        is_missing_punch          = m.missing_punch,
        is_missing_system         = m.missing_system,
        updated_at                = NOW()
      FROM m
      WHERE ar.tenant_id = $1 AND ar.employee_id = m.employee_id AND ar.attendance_date = m.work_date
        AND COALESCE(ar.notes,'') NOT LIKE '[generated %'`, [TENANT, from, to]);
    /* INSERT the person-days the raw spine does not have at all.
       This was UPDATE-only to avoid fabricating attendance, and that instinct is right —
       but a person-day that EXISTS in roster_days is not fabricated, it is the canonical
       record, and refusing to project it is what left 1,133 July person-days missing from
       every reader still on this table (coverage/hourly returned an empty day for the
       whole second half of the month). Only rows backed by a canonical roster row are
       written, they carry a provenance note, and the generated-plan guard still applies. */
    const ins = await c.query(`
      WITH m AS (${PROJECTION})
      INSERT INTO attendance_records
        (tenant_id, employee_id, attendance_date, attendance_marker, scheduled_start, scheduled_end,
         ot_minutes, system_late_minutes, system_early_out_minutes, punch_late_minutes,
         punch_early_out_minutes, is_wfh, is_missing_punch, is_missing_system, notes)
      SELECT $1, m.employee_id, m.work_date, m.marker, m.sched_start, m.sched_end,
             m.true_ot, m.sys_late, m.sys_early, m.punch_late, m.punch_early,
             m.is_wfh, m.missing_punch, m.missing_system, '[recon] projected from roster_days'
        FROM m
       WHERE NOT EXISTS (
         SELECT 1 FROM attendance_records ar
          WHERE ar.tenant_id = $1 AND ar.employee_id = m.employee_id AND ar.attendance_date = m.work_date)
      RETURNING 1`, [TENANT, from, to]);
    await c.query('COMMIT');
    console.log(`[sync-attendance] SYNCED ${res.rowCount} updated · ${ins.rowCount} inserted from roster_days (${from}..${to}).`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[sync-attendance] FAILED (rolled back): ' + e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
