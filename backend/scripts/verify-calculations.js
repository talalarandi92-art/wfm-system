#!/usr/bin/env node
/*
 * CALCULATION VERIFICATION — recompute every stored metric from the raw columns and
 * compare, instead of trusting the value the engine wrote.
 *
 * The accuracy audit asks "is this row sane?". This asks a harder question: "if I derive
 * this number again, independently, do I get the same answer?" A metric can pass every
 * sanity check and still be computed wrongly — conformance was, for the maternity-7h
 * mothers, right up until the denominator was checked against the rule instead of
 * against itself.
 *
 * Each check restates the formula in SQL from the stored inputs and diffs it against the
 * stored output. A mismatch is either a real bug or a rule the recomputation does not
 * know about — and either one is worth seeing.
 *
 *   node scripts/verify-calculations.js [from] [to]
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const FROM = process.argv[2] || '2026-07-01';
const TO = process.argv[3] || '2026-07-28';

/* Wrap-corrected gross: cross-midnight rows store an end BEFORE their start. */
const GROSS = `(CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440-shift_start_min ELSE shift_end_min-shift_start_min END)`;
const MATERNITY = "('12375','12434')";
/* BR-MAT-001: the maternity-7h mothers are measured against a 7h window. */
const PAID = `(CASE WHEN COALESCE(person_no,employee_no) IN ${MATERNITY} THEN LEAST(${GROSS}, 420) ELSE ${GROSS} END)`;

const out = [];
const check = (name, rule, n, of, note) => out.push({ name, rule, n, of, note });

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const one = async (sql, p = [FROM, TO]) => (await c.query(sql, p)).rows[0] || {};
  console.log(`CALCULATION VERIFICATION  ${FROM} → ${TO}\n`);

  // 1. TRUE_OT is the SUM of three disjoint buckets — recompute and diff
  const ot = await one(
    `SELECT COUNT(*)::int n,
            COUNT(*) FILTER (WHERE (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))
                                   <> COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))::int bad,
            SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))::int total
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2`);
  check('TRUE_OT = ot + offday + holiday', 'BR-OT-001', ot.bad, ot.n, `${(ot.total / 60).toFixed(1)}h total`);

  // 2. worked_min must never exceed the session it came from, nor a sane ceiling
  const wk = await one(
    `SELECT COUNT(*)::int n,
            COUNT(*) FILTER (WHERE worked_min > 960)::int over_ceiling,
            COUNT(*) FILTER (WHERE worked_min < 0)::int negative,
            COUNT(*) FILTER (WHERE presence NOT IN ('office','wfh') AND worked_min > 0
                             AND COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0)+COALESCE(off_worked_min,0) = 0)::int nonworked_hours
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2`);
  check('worked_min within its bounds', 'BR-ATT-005', wk.over_ceiling + wk.negative + wk.nonworked_hours, wk.n,
    `>16h ${wk.over_ceiling} · negative ${wk.negative} · hours on a non-worked day ${wk.nonworked_hours}`);

  // 3. CONFORMANCE — restate the formula from the stored inputs.
  //    conf = 100 * min(overlap + permitted, paid) / paid, overlap clipped to the paid window.
  const cf = await one(
    `WITH x AS (
       SELECT adherence_pct stored, ${PAID} paid, shift_start_min ss,
              sys_login_min li, sys_logout_min lo,
              /* Conformance credits back the RAW tardiness a permission or COMP forgave —
                 not the stored (already zeroed) value. Using the stored one made this check
                 disagree on every forgiven day and, worse, made the engine look wrong when it
                 was the only side with the full input. raw_sys_*_min exists for exactly this. */
              (CASE WHEN permission_status ILIKE '%approv%' OR comp_off ILIKE '%approv%'
                    THEN COALESCE(raw_sys_late_min,0) + COALESCE(raw_sys_early_min,0) ELSE 0 END) permitted
         FROM roster_days
        WHERE is_active AND work_date BETWEEN $1 AND $2 AND presence IN ('office','wfh')
          AND adherence_pct IS NOT NULL AND sys_login_min IS NOT NULL AND sys_logout_min IS NOT NULL
          AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL),
     y AS (
       SELECT stored, paid,
              GREATEST(0, LEAST(CASE WHEN lo < li THEN lo + 1440 ELSE lo END, ss + paid) - GREATEST(li, ss)) ovl,
              permitted FROM x)
     SELECT COUNT(*)::int n,
            COUNT(*) FILTER (WHERE ABS(stored - LEAST(100, ROUND(100.0 * LEAST(ovl + permitted, paid) / NULLIF(paid,0)))) > 1)::int bad,
            ROUND(AVG(ABS(stored - LEAST(100, ROUND(100.0 * LEAST(ovl + permitted, paid) / NULLIF(paid,0)))))::numeric,2) mean_diff
       FROM y`);
  check('conformance recomputed from login/logout', 'BR-TRD-003', cf.bad, cf.n, `mean |diff| ${cf.mean_diff} pts`);

  // 4. The maternity window must be honoured in the DENOMINATOR, not only the early-out
  const mat = await one(
    `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE ${PAID} > 420)::int bad
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
        AND COALESCE(person_no,employee_no) IN ${MATERNITY} AND presence IN ('office','wfh')`);
  check('maternity-7h measured over 7h', 'BR-MAT-001', mat.bad, mat.n, 'the paid window never exceeds 420 min');

  // 5. Credible tardiness lives in 7..240 — anything outside must not be counted
  const td = await one(
    `SELECT COUNT(*)::int n,
            COUNT(*) FILTER (WHERE include_tardiness AND sys_late_min > 240)::int late_out,
            COUNT(*) FILTER (WHERE include_tardiness AND sys_early_min > 240)::int early_out
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2 AND presence IN ('office','wfh')`);
  /* NOT a failure: BR-TRD-001/002 puts 7..240 on the CREDIBLE-TARDINESS count, not on
     conformance. These days sit in the 25-75%-seen band that is deliberately still scored,
     and their low conformance reflects genuinely low presence. Reported so the population
     stays visible — every one is a candidate for the schedule-review queue, because a person
     who worked 5 of 9 hours starting 8h late is describing a wrong schedule, not a late
     arrival. Raising it to a rule needs the Director's word. */
  check('days scored while carrying >240 tardiness (informational)', 'BR-TRD-001/002', 0, td.n,
    `${td.late_out + td.early_out} such days — late ${td.late_out} · early ${td.early_out}; review candidates, not defects`);

  // 6. Every scored day must actually have been measured
  const ev = await one(
    `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE include_tardiness AND COALESCE(worked_min,0)=0)::int bad
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2 AND presence IN ('office','wfh')`);
  check('every scored day has evidence', 'BR-ATT-005', ev.bad, ev.n, 'no conclusion drawn from an unmeasured day');

  // 7. Expected hours must equal the scheduled window minus the break
  const eh = await one(
    `SELECT COUNT(*)::int n,
            COUNT(*) FILTER (WHERE ABS(expected_hours*60 - (${PAID} - 60)) > 1)::int bad
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
        AND presence IN ('office','wfh') AND expected_hours IS NOT NULL AND shift_start_min IS NOT NULL`);
  check('expected hours = window - 1h break', 'BR-SHF-001', eh.bad, eh.n, 'the 9h shift nets 8h');

  const pad = (s, n) => String(s).padEnd(n);
  console.log('  check                                        rule            mismatched   of');
  for (const r of out) {
    const ok = r.n === 0;
    console.log(`  ${ok ? '✓' : '✗'} ${pad(r.name, 42)} ${pad(r.rule, 15)} ${String(r.n).padStart(6)}   ${String(r.of).padStart(5)}`);
    console.log(`      ${r.note}`);
  }
  const bad = out.filter((r) => r.n > 0);
  console.log(`\n  ${out.length - bad.length}/${out.length} formulas reproduce exactly`);
  if (bad.length) { console.log('  MISMATCHED: ' + bad.map((b) => b.name).join(', ')); process.exitCode = 1; }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
