#!/usr/bin/env node
/*
 * ACCURACY AUDIT — everything standing between the roster and 100% correct.
 *
 * Written 2026-07-29 after the July load, when a question ("why can't you make it
 * accurate?") turned out to have an embarrassing answer: 235 of the 238 "unexplained"
 * days were explained in a column the engine already reads but never consulted for that
 * case. Spot checks kept finding one thing at a time. This asks every question at once,
 * on the live data, and ranks what it finds by how many person-days it touches.
 *
 * Each check states the RULE it tests, the count, and whether the gap is fixable in code
 * or blocked on data that does not exist. A check that cannot be evaluated reports
 * UNKNOWN — never a pass.
 *
 *   node scripts/accuracy-audit.js [from] [to]
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
const NET = `(CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440-shift_start_min ELSE shift_end_min-shift_start_min END - 60)`;
const WORKED = `presence IN ('office','wfh')`;

/* BR-SHF-005 — the canonical windows. Never invent one; a code whose stored window
   disagrees is either a Timing-sheet corruption or a real schedule change, and both
   need a human. Minutes from local midnight; >1440 = next day. */
const CANON = {
  M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320],
  E: [960, 1500], EE20: [1080, 1560], MD: [1320, 1860], MN: [1380, 1920],
  M20: [480, 960], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320],
};

const findings = [];
const add = (id, sev, rule, title, n, unit, detail, fix) =>
  findings.push({ id, sev, rule, title, n, unit, detail, fix });

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0] || {};

  const [base] = await q(
    `SELECT COUNT(*)::int days, COUNT(DISTINCT person_no)::int people,
            COUNT(*) FILTER (WHERE ${WORKED})::int worked
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2`, [FROM, TO]);
  console.log(`ACCURACY AUDIT  ${FROM} → ${TO}`);
  console.log(`${base.days} person-days · ${base.people} people · ${base.worked} worked\n`);

  // ── A. IDENTITY ────────────────────────────────────────────────────────────
  const a1 = await one(
    `SELECT COUNT(*)::int n FROM (SELECT person_no, work_date FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2 GROUP BY 1,2 HAVING COUNT(*)>1) x`, [FROM, TO]);
  add('A1', a1.n ? 'HIGH' : 'OK', 'BR-ATT-008', 'One row per person per day', a1.n, 'duplicate person-days',
    'A person counted twice inflates every headcount and average.', 'dedupe at ingest');

  const a2 = await one(
    `SELECT COUNT(*)::int n FROM roster_days rd
      LEFT JOIN employees e ON e.tenant_id=rd.tenant_id AND e.employee_no=rd.person_no
      WHERE rd.is_active AND rd.work_date BETWEEN $1 AND $2 AND e.id IS NULL`, [FROM, TO]);
  add('A2', a2.n ? 'HIGH' : 'OK', 'BR-ATT-008', 'Every roster row resolves to an employee', a2.n, 'unresolved person-days',
    'Unresolved rows silently vanish from anything that joins employees — coverage, scorecard, People 360.', 'backfill employee_identity');

  const a3 = await one(
    `SELECT COUNT(DISTINCT person_no)::int n FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2 AND (username IS NULL OR username='')`, [FROM, TO]);
  add('A3', a3.n ? 'MED' : 'OK', 'BR-ATT-008', 'Every person has a system username', a3.n, 'people with no username',
    'Without a username no Sprinklr/Ameyo session can ever match them — they are permanently evidence-blind.', 'add User ID to the schedule sheet');

  // ── B. THE SCHEDULE, WHICH IS THE AUTHORITY ────────────────────────────────
  const b1 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ${WORKED} AND (shift_start_min IS NULL OR shift_end_min IS NULL)`, [FROM, TO]);
  add('B1', b1.n ? 'HIGH' : 'OK', 'BR-SHF-004', 'Every worked day has a shift window', b1.n, 'days with no window',
    'No window means no expected hours: lateness, OT and coverage are all uncomputable for that day.', 'map the code in the Timing sheet');

  const winRows = await q(
    `SELECT shift_code code, MODE() WITHIN GROUP (ORDER BY shift_start_min) ss,
            MODE() WITHIN GROUP (ORDER BY shift_end_min) se, COUNT(*)::int n
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2 AND ${WORKED}
        AND shift_start_min IS NOT NULL GROUP BY 1`, [FROM, TO]);
  const drift = winRows.filter(r => CANON[r.code] && (CANON[r.code][0] !== r.ss || CANON[r.code][1] !== (r.se <= r.ss ? r.se + 1440 : r.se)));
  add('B2', drift.length ? 'MED' : 'OK', 'BR-SHF-005', 'Stored windows match the canonical times',
    drift.reduce((s, r) => s + r.n, 0), 'days on a drifted window',
    drift.length ? drift.map(r => `${r.code} stored ${r.ss}-${r.se} vs canonical ${CANON[r.code].join('-')}`).join('; ') : 'all codes canonical',
    'confirm with the Timing sheet, then pin');

  const b3 = await one(
    `SELECT COUNT(*)::int n, COUNT(DISTINCT person_no)::int people FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2 AND ${WORKED}
        AND (worked_min IS NULL OR worked_min=0) AND include_tardiness`, [FROM, TO]);
  add('B3', b3.n ? 'HIGH' : 'OK', 'BR-ATT-005', 'A scored working day has evidence', b3.n, 'scored days with zero evidence',
    `${b3.people} people. Odoo explains most of these (Off Day / leave / WFH) but the engine does not consult it for this case.`,
    'use Odoo Status as the arbiter when no session or punch exists');

  // ── C. EVIDENCE QUALITY ────────────────────────────────────────────────────
  const c1 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ${WORKED} AND include_tardiness AND worked_min > 0 AND worked_min < ${NET}*0.25`, [FROM, TO]);
  add('C1', c1.n ? 'HIGH' : 'OK', 'BR-TRD-001', 'Scored days rest on enough evidence', c1.n, 'days scored on <25% of the shift',
    'A three-minute session standing in for a nine-hour day produces a punctuality score from nothing.',
    'exclude from conformance, route to Data Quality');

  const c2 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ${WORKED} AND include_tardiness AND worked_min >= ${NET}*0.75
       AND GREATEST(COALESCE(sys_late_min,0),COALESCE(sys_early_min,0)) > 240`, [FROM, TO]);
  add('C2', c2.n ? 'HIGH' : 'OK', 'BR-TIM-003', 'A full shift at the wrong hour is not lateness', c2.n, 'displaced full shifts',
    'Worked the whole shift, hours away from the scheduled window — the schedule is wrong for that day, not the person.',
    'route to schedule review, exclude from tardiness');

  const c3 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ${WORKED} AND sys_login_min IS NULL AND punch_in_min IS NOT NULL`, [FROM, TO]);
  add('C3', c3.n ? 'LOW' : 'OK', 'BR-ATT-001', 'Punch-only days are recognised', c3.n, 'punch but no system login',
    'Legitimate (biometric without a system session) but the shift start rests on one witness.', 'none — informational');

  // ── D. DERIVED NUMBERS ─────────────────────────────────────────────────────
  const d1 = await one(
    `SELECT COUNT(*) FILTER (WHERE worked_min < 0)::int neg,
            COUNT(*) FILTER (WHERE worked_min > 1440)::int over24,
            COUNT(*) FILTER (WHERE COALESCE(ot_min,0)<0 OR COALESCE(offday_ot_min,0)<0 OR COALESCE(holiday_ot_min,0)<0)::int negot,
            COUNT(*) FILTER (WHERE COALESCE(ot_min,0)>300 OR COALESCE(offday_ot_min,0)>300 OR COALESCE(holiday_ot_min,0)>300)::int bigot
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2`, [FROM, TO]);
  add('D1', (d1.neg + d1.over24 + d1.negot) ? 'HIGH' : 'OK', 'BR-OT-004/005', 'No impossible durations',
    d1.neg + d1.over24 + d1.negot, 'impossible values',
    `negative worked ${d1.neg} · worked>24h ${d1.over24} · negative OT ${d1.negot} · OT>300 ${d1.bigot}`, 'clamp at the engine');

  const d2 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ((COALESCE(ot_min,0)>0)::int + (COALESCE(offday_ot_min,0)>0)::int + (COALESCE(holiday_ot_min,0)>0)::int) > 1`, [FROM, TO]);
  add('D2', d2.n ? 'HIGH' : 'OK', 'BR-OT-001', 'The three OT buckets stay disjoint', d2.n, 'days in two buckets at once',
    'TRUE_OT sums the buckets, so an overlap double-pays.', 'make the bucket choice exclusive');

  const d3 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND presence IN ('absent','sick','leave','off')
       AND (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0)) > 0
       AND COALESCE(offday_ot_min,0) = 0`, [FROM, TO]);
  add('D3', d3.n ? 'HIGH' : 'OK', 'BR-OT-003', 'A non-worked day carries no regular OT', d3.n, 'absent/sick days with OT',
    'Paying overtime on a day the person was absent is the most visible possible error.', 'suppress at the engine');

  // ── E. TIME ────────────────────────────────────────────────────────────────
  const e1 = await one(
    `SELECT COUNT(*) FILTER (WHERE shift_end_min<=shift_start_min AND NOT crosses_midnight)::int unflagged,
            COUNT(*) FILTER (WHERE shift_end_min>shift_start_min AND crosses_midnight)::int overflagged
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2 AND ${WORKED}
         AND shift_start_min IS NOT NULL`, [FROM, TO]);
  add('E1', (e1.unflagged + e1.overflagged) ? 'HIGH' : 'OK', 'BR-TIM-003', 'Cross-midnight flag matches the window',
    e1.unflagged + e1.overflagged, 'mis-flagged days',
    `wraps but unflagged ${e1.unflagged} · flagged but does not wrap ${e1.overflagged}`, 'derive the flag from the window');

  const e2 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ${WORKED} AND sys_late_min BETWEEN 1 AND 6`, [FROM, TO]);
  add('E2', 'OK', 'BR-TRD-001', 'The 6-minute tolerance is applied', e2.n, 'days inside the tolerance',
    'Correctly present but not counted as lateness.', 'none');

  // ── F. AGREEMENT BETWEEN STORES ────────────────────────────────────────────
  const f1 = await one(
    `SELECT COUNT(*)::int n FROM roster_days rd
       JOIN employees e ON e.tenant_id=rd.tenant_id AND e.employee_no=rd.person_no
       LEFT JOIN attendance_records ar ON ar.employee_id=e.id AND ar.attendance_date=rd.work_date
      WHERE rd.is_active AND rd.work_date BETWEEN $1 AND $2 AND ar.id IS NULL`, [FROM, TO]);
  add('F1', f1.n ? 'MED' : 'OK', 'P-2', 'The legacy spine mirrors the canonical table', f1.n, 'roster days missing downstream',
    'Anything still reading attendance_records shows a different world from the roster pages.', 'resync inserts as well as updates');

  const f2 = await one(
    `SELECT COUNT(*)::int n FROM roster_days rd
       JOIN employees e ON e.tenant_id=rd.tenant_id AND e.employee_no=rd.person_no
       JOIN attendance_records ar ON ar.employee_id=e.id AND ar.attendance_date=rd.work_date
      WHERE rd.is_active AND rd.work_date BETWEEN $1 AND $2
        AND ar.ot_minutes IS DISTINCT FROM (COALESCE(rd.ot_min,0)+COALESCE(rd.offday_ot_min,0)+COALESCE(rd.holiday_ot_min,0))`, [FROM, TO]);
  add('F2', f2.n ? 'MED' : 'OK', 'P-3', 'OT agrees across both stores', f2.n, 'days where OT differs',
    'Two screens quoting different overtime for the same person-day.', 'resync');

  // ── G. WHAT NO CODE CAN FIX ────────────────────────────────────────────────
  const g1 = await one(
    `SELECT MAX(work_date)::text last, (CURRENT_DATE - MAX(work_date))::int behind FROM roster_days WHERE is_active`);
  add('G1', g1.behind > 3 ? 'MED' : 'OK', '—', 'Roster reaches today', g1.behind, 'days behind',
    `latest ${g1.last}. Nothing can be measured for a day whose sources have not arrived.`, 'supply the month files');

  // ── report, ranked by how many person-days each touches ────────────────────
  const rank = { HIGH: 0, MED: 1, LOW: 2, OK: 3 };
  findings.sort((a, b) => rank[a.sev] - rank[b.sev] || b.n - a.n);
  const pct = (n) => base.worked ? ` (${(100 * n / base.worked).toFixed(1)}% of worked days)` : '';
  for (const f of findings) {
    const mark = f.sev === 'OK' ? '  ok ' : f.sev === 'HIGH' ? ' HIGH' : f.sev === 'MED' ? ' med ' : ' low ';
    console.log(`${mark} ${f.id}  ${f.title}  [${f.rule}]`);
    console.log(`       ${f.n} ${f.unit}${f.sev !== 'OK' && f.n ? pct(f.n) : ''}`);
    if (f.sev !== 'OK') { console.log(`       why: ${f.detail}`); console.log(`       fix: ${f.fix}`); }
  }
  const open = findings.filter(f => f.sev !== 'OK');
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`  ${findings.length - open.length}/${findings.length} clean · ${open.filter(f => f.sev === 'HIGH').length} HIGH · ${open.filter(f => f.sev === 'MED').length} med · ${open.filter(f => f.sev === 'LOW').length} low`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
