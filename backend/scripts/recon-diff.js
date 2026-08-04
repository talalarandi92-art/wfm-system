#!/usr/bin/env node
/*
 * RECON DIFF — what a dry run would change, before anything is committed to it.
 *
 * Compares roster_days_dryrun (built by `recon-refresh.js --dry-run`) against the live
 * roster_days over the same person-days, and reports four things separately, because they
 * carry very different risk:
 *
 *   ARRIVING   person-days the load adds        — normally the point of the load
 *   LEAVING    person-days the load would drop  — THE DANGEROUS ONE. A partial source file
 *              silently erases people who are simply absent from it, and the row count of
 *              the load looks perfectly healthy while it happens.
 *   CHANGED    person-days whose values move    — the ones worth reading
 *   IDENTICAL  person-days that do not move     — reassurance, reported as a count only
 *
 * Run it after a dry run and before promoting. It exits non-zero if anything would be lost,
 * so it can gate an automated pipeline as well as inform a person.
 *
 *   node scripts/recon-diff.js [--full]
 */
const { getClient } = require('./recon-db');
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const FULL = process.argv.includes('--full');

/* The fields worth diffing: the ones a person would argue about. Everything else is
   derived from these, so a change there without a change here would itself be a defect. */
const FIELDS = [
  ['shift_code', 'shift'], ['presence', 'presence'], ['hr_code', 'HR code'],
  ['worked_min', 'worked'], ['sys_late_min', 'late'], ['sys_early_min', 'early'],
  ['adherence_pct', 'conformance'], ['ot_min', 'OT'], ['offday_ot_min', 'off-day OT'],
  ['holiday_ot_min', 'holiday OT'], ['include_tardiness', 'scored'],
];

const fmt = (v) => (v === null || v === undefined ? '—' : String(v));

(async () => {
  const c = getClient();
  await c.connect();
  try {
    const exists = (await c.query(`SELECT to_regclass('roster_days_dryrun') t`)).rows[0].t;
    if (!exists) {
      console.log('No dry-run table found. Build one first:');
      console.log('   node scripts/recon-refresh.js --dry-run');
      process.exit(1);
    }

    const { rows: [span] } = await c.query(
      `SELECT MIN(work_date)::text a, MAX(work_date)::text b, COUNT(*)::int n,
              COUNT(DISTINCT person_no)::int people FROM roster_days_dryrun`);
    if (!span.n) { console.log('The dry-run table is empty — nothing was built.'); process.exit(1); }

    console.log(`\nRECON DIFF   ${span.a} → ${span.b}`);
    console.log(`  the dry run built ${span.n} rows for ${span.people} people\n`);

    /* ARRIVING / LEAVING — keyed on person-day, scoped to the dates the load covers so a
       date outside the range is never counted as "leaving". */
    const { rows: [counts] } = await c.query(
      `WITH d AS (SELECT person_no, work_date FROM roster_days_dryrun),
            l AS (SELECT person_no, work_date FROM roster_days
                   WHERE tenant_id=$1 AND is_active
                     AND work_date BETWEEN $2::date AND $3::date)
       SELECT (SELECT COUNT(*) FROM d LEFT JOIN l USING (person_no, work_date) WHERE l.person_no IS NULL)::int arriving,
              (SELECT COUNT(*) FROM l LEFT JOIN d USING (person_no, work_date) WHERE d.person_no IS NULL)::int leaving`,
      [TENANT, span.a, span.b]);

    const cmp = FIELDS.map(([f]) => `d.${f} IS DISTINCT FROM l.${f}`).join(' OR ');
    const { rows: [ch] } = await c.query(
      `SELECT COUNT(*) FILTER (WHERE ${cmp})::int changed,
              COUNT(*) FILTER (WHERE NOT (${cmp}))::int identical
         FROM roster_days_dryrun d
         JOIN roster_days l ON l.tenant_id=$1 AND l.is_active
              AND l.person_no=d.person_no AND l.work_date=d.work_date`, [TENANT]);

    console.log('  ARRIVING   ' + String(counts.arriving).padStart(5) + '   person-days the load adds');
    console.log('  LEAVING    ' + String(counts.leaving).padStart(5) + '   person-days the load would DROP' +
      (counts.leaving ? '   ← read these before promoting' : ''));
    console.log('  CHANGED    ' + String(ch.changed).padStart(5) + '   person-days whose values move');
    console.log('  IDENTICAL  ' + String(ch.identical).padStart(5) + '   unchanged\n');

    if (counts.leaving) {
      const { rows } = await c.query(
        `SELECT l.person_no, l.clean_name, l.work_date::text d, l.shift_code, l.presence
           FROM roster_days l
           LEFT JOIN roster_days_dryrun x ON x.person_no=l.person_no AND x.work_date=l.work_date
          WHERE l.tenant_id=$1 AND l.is_active AND l.work_date BETWEEN $2::date AND $3::date
            AND x.person_no IS NULL
          ORDER BY l.clean_name, l.work_date LIMIT ${FULL ? 500 : 20}`, [TENANT, span.a, span.b]);
      console.log('  WOULD BE LOST — these person-days exist today and are NOT in the load:');
      console.table(rows);
      console.log('  A source file that simply omits someone looks identical to a source file that');
      console.log('  says they did not work. Confirm the omission is intended before promoting.\n');
    }

    if (ch.changed) {
      const sel = FIELDS.map(([f]) => `l.${f} AS "old_${f}", d.${f} AS "new_${f}"`).join(', ');
      const { rows } = await c.query(
        `SELECT d.clean_name, d.work_date::text d, ${sel}
           FROM roster_days_dryrun d
           JOIN roster_days l ON l.tenant_id=$1 AND l.is_active
                AND l.person_no=d.person_no AND l.work_date=d.work_date
          WHERE ${cmp}
          ORDER BY d.work_date, d.clean_name LIMIT ${FULL ? 1000 : 25}`, [TENANT]);
      console.log(`  WHAT MOVES  (showing ${rows.length} of ${ch.changed}${FULL ? '' : ' — use --full for all'}):`);
      for (const r of rows) {
        const bits = FIELDS
          .filter(([f]) => String(r['old_' + f]) !== String(r['new_' + f]))
          .map(([f, label]) => `${label} ${fmt(r['old_' + f])} → ${fmt(r['new_' + f])}`);
        console.log(`   ${r.d}  ${(r.clean_name || '').padEnd(22)}  ${bits.join(' · ')}`);
      }
      console.log('');
    }

    /* The headline totals, because a per-row diff can hide a shift in the aggregate. */
    const agg = async (t, where) => (await c.query(
      `SELECT COUNT(*) FILTER (WHERE include_tardiness)::int scored,
              ROUND(AVG(adherence_pct),1) conf,
              SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))::int true_ot,
              COUNT(*) FILTER (WHERE presence='absent')::int absent
         FROM ${t} WHERE ${where}`, t === 'roster_days' ? [TENANT, span.a, span.b] : [])).rows[0];
    const before = await agg('roster_days', `tenant_id=$1 AND is_active AND work_date BETWEEN $2::date AND $3::date`);
    const after = await agg('roster_days_dryrun', 'TRUE');
    console.log('  THE NUMBERS THAT MATTER');
    console.table([
      { metric: 'scored days', before: before.scored, after: after.scored },
      { metric: 'mean conformance', before: before.conf, after: after.conf },
      { metric: 'TRUE_OT minutes', before: before.true_ot, after: after.true_ot },
      { metric: 'days marked absent', before: before.absent, after: after.absent },
    ]);

    if (counts.leaving) {
      console.log('\n  ❌ NOT SAFE TO PROMOTE — person-days would be lost. Resolve the list above first.');
      process.exitCode = 1;
    } else {
      console.log('\n  ✅ Nothing would be lost. Promote with:  node scripts/recon-refresh.js');
    }
  } finally { await c.end(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
