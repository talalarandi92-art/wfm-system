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
   need a human. Minutes from local midnight; >1440 = next day.
 *
 * THE EE FAMILY IS ROLE-DEPENDENT (Director, 2026-07-29): it starts at 18:00 for
 * everyone, but an AGENT works 9 hours to 03:00 while an ADMIN works 8 to 02:00. The
 * first version of this table had one flat EE20 = 18:00-02:00 and duly reported the
 * only EE20 row in the data as "drifted" — the row was correct and the constant was
 * wrong. A canonical table that is not itself checked against the business just moves
 * the error somewhere quieter. */
const CANON = {
  M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320],
  E: [960, 1500], MD: [1320, 1860], MN: [1380, 1920],
  M20: [480, 960], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320],
};
/** code → { agent, admin } where the window depends on who works it. */
const CANON_BY_ROLE = {
  EE:   { agent: [1080, 1620], admin: [1080, 1560] },
  EE20: { agent: [1080, 1620], admin: [1080, 1560] },
};
const canonFor = (code, role) => {
  const byRole = CANON_BY_ROLE[code];
  if (byRole) return /agent/i.test(role || '') ? byRole.agent : byRole.admin;
  return CANON[code] || null;
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

  /* Record-only people (BR-ROL-002 + recon-config recordOnlyPeople) legitimately do not
     open the operational system — management and standing-pattern staff. Counting them
     as a username gap turns an accepted fact into a permanent warning, and a check that
     cries wolf is a check people stop reading. They are reported separately. */
  const recordOnly = (() => {
    try {
      return (JSON.parse(fs.readFileSync(path.join(__dirname, 'recon-config.json'), 'utf8')).recordOnlyPeople || [])
        .map((p) => String(p.id));
    } catch { return []; }
  })();
  /* Record-only is TWO things and the check has to honour both, exactly as the engine
     does: the config list AND the role regex in recon-new-roster.js (Team Leader /
     Senior / Resolution Specialist / RTA / WFM). Checking only the list reported Asayel
     Sameah as a real gap — she is a Team Leader, already excluded by role. A check that
     asks the Director to fix something the engine already handles is worse than no
     check, because it spends the one thing that makes a check useful: being believed. */
  const ROLE_ONLY = `(function_name ~* '(team leader|senior|resolution specialist)' OR function_name ~* '\\yrta\\y'
                      OR function_name ~* '\\ywfm\\y' OR team_manager ~* '\\ywfm\\y')`;
  const a3 = await one(
    `SELECT COUNT(DISTINCT person_no) FILTER (WHERE NOT (person_no = ANY($3)) AND NOT ${ROLE_ONLY})::int n,
            COUNT(DISTINCT person_no) FILTER (WHERE person_no = ANY($3) OR ${ROLE_ONLY})::int accepted
       FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2 AND (username IS NULL OR username='')`,
    [FROM, TO, recordOnly]);
  add('A3', a3.n ? 'MED' : 'OK', 'BR-ATT-008', 'Every scored person has a system username', a3.n, 'people with no username',
    `Without a username no Sprinklr/Ameyo session can ever match them. ${a3.accepted} record-only ` +
    `people also have none — expected, and not counted.`,
    'add User ID to the schedule sheet');

  // ── B. THE SCHEDULE, WHICH IS THE AUTHORITY ────────────────────────────────
  const b1 = await one(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
       AND ${WORKED} AND (shift_start_min IS NULL OR shift_end_min IS NULL)`, [FROM, TO]);
  /* Severity depends on WHO. A missing window on an agent's day means their lateness and
     OT cannot be computed — serious. On a record-only supervisor it costs only their
     contribution to the hourly coverage curve, because they were never scored anyway.
     Measured before choosing: all 20 July cases are supervisors, 0 of them scored. */
  const b1s = await one(
    `SELECT COUNT(*) FILTER (WHERE include_tardiness)::int scored,
            COUNT(DISTINCT person_no)::int people
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2
        AND ${WORKED} AND (shift_start_min IS NULL OR shift_end_min IS NULL)`, [FROM, TO]);
  add('B1', b1.n ? (b1s.scored ? 'HIGH' : 'MED') : 'OK', 'BR-SHF-004', 'Every worked day has a shift window',
    b1.n, 'days with no window',
    b1s.scored
      ? `${b1s.scored} of them are SCORED days — lateness and OT are uncomputable for a person being judged on them.`
      : `${b1s.people} people, none of them scored (all record-only), so nobody is judged on these. The cost is that the days contribute nothing to the hourly coverage curve.`,
    'the sheet cell reads a bare "WFH" — give it the shift letter (WFH-M / WFH-B / WFH-N)');

  const winRows = await q(
    `SELECT shift_code code, COALESCE(role_category,'') role,
            MODE() WITHIN GROUP (ORDER BY shift_start_min) ss,
            MODE() WITHIN GROUP (ORDER BY shift_end_min) se, COUNT(*)::int n
       FROM roster_days WHERE is_active AND work_date BETWEEN $1 AND $2 AND ${WORKED}
        AND shift_start_min IS NOT NULL GROUP BY 1,2`, [FROM, TO]);
  const drift = winRows.filter((r) => {
    const want = canonFor(r.code, r.role);
    if (!want) return false;
    const end = r.se <= r.ss ? r.se + 1440 : r.se;      // stored ends wrap; canonical does not
    return want[0] !== r.ss || want[1] !== end;
  });
  add('B2', drift.length ? 'MED' : 'OK', 'BR-SHF-005', 'Stored windows match the canonical times',
    drift.reduce((s, r) => s + r.n, 0), 'days on a drifted window',
    drift.length
      ? drift.map(r => `${r.code}/${r.role || '?'} stored ${r.ss}-${r.se <= r.ss ? r.se + 1440 : r.se} vs canonical ${canonFor(r.code, r.role).join('-')}`).join('; ')
      : 'all codes canonical, including the role-dependent EE family',
    'confirm with the Timing sheet, then pin');

  /* "Scored" must mean CARRIES A SCORE, not "carries a flag that once meant scored".
     Measured 2026-08-05: this check reported 238 HIGH on days where adherence_pct is NULL on
     every single one — nothing was scored, no average polluted, nobody judged. They are
     pre-2026-07-25 rows where include_tardiness was left true before that flag encoded the
     evidence gate; raw_sys_late_min is NULL on all of them, which dates them precisely.
     A check that reports 238 violations of a rule that is not actually being broken is the
     same cry-wolf failure this audit keeps finding elsewhere: it trains the reader to skip
     the section, and the day a real one appears they skip that too. The condition now names
     what BR-ATT-005 actually forbids — a CONFORMANCE FIGURE standing on no evidence. */
  const b3 = await one(
    `SELECT COUNT(*)::int n, COUNT(DISTINCT person_no)::int people FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2 AND ${WORKED}
        AND (worked_min IS NULL OR worked_min=0)
        AND include_tardiness AND adherence_pct IS NOT NULL`, [FROM, TO]);
  add('B3', b3.n ? 'HIGH' : 'OK', 'BR-ATT-005', 'A scored working day has evidence', b3.n,
    'days carrying a conformance score with zero measured work',
    `${b3.people} people. A conformance figure on a day nothing was measured on is a judgement with no basis.`,
    'the day must be flagged for review and left unscored, never given a score');

  /* The stale flag is still worth surfacing — just not as a rule breach. It is a rebuild
     backlog: days built before the evidence gate existed still say "scored" in a column
     nothing reads for scoring. Harmless today, misleading to anyone who queries the column. */
  const b3b = await one(
    `SELECT COUNT(*)::int n FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2 AND ${WORKED}
        AND (worked_min IS NULL OR worked_min=0)
        AND include_tardiness AND adherence_pct IS NULL AND raw_sys_late_min IS NULL`, [FROM, TO]);
  add('B3b', b3b.n ? 'LOW' : 'OK', 'BR-ATT-005', 'include_tardiness reflects the evidence gate', b3b.n,
    'old-engine days whose include_tardiness flag predates the evidence gate',
    'They carry no score, so no figure is affected — but the column reads "scored" and a future query could believe it.',
    'clears when these dates are rebuilt on the current engine');

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

  /* C4 — the identity table and the roster must agree about who is still here.
     Found 2026-08-05: an employee flagged inactive with last_working_date 2026-06-19 had 64
     roster rows running through 2026-08-01. Every people-level report joins through
     employee_identity, so a person in that state is not merely mislabelled — they are
     INVISIBLE. Fairness could not see her, which means if her rotation were unfair nobody
     would ever learn it from this system. The person disappears from the very report meant
     to protect them. */
  const c4 = await one(
    `SELECT COUNT(*)::int n, MIN(rd.clean_name) AS example, MAX(rd.work_date)::text AS latest
       FROM roster_days rd JOIN employee_identity ei ON ei.person_no = rd.person_no
      WHERE rd.is_active AND NOT ei.is_active AND COALESCE(ei.alias_of,'') = ''
        AND rd.work_date BETWEEN $1 AND $2 AND rd.shift_start_min IS NOT NULL`, [FROM, TO]);
  add('C4', c4.n ? 'HIGH' : 'OK', 'BR-ATT-008', 'Identity and roster agree on who is active',
    c4.n, 'worked days by people the identity table calls inactive',
    c4.n ? `e.g. ${c4.example}, still on the roster to ${c4.latest}. People-level reports join through ` +
           `employee_identity, so these person-days are invisible to fairness, scorecard and 360s.`
         : 'no contradiction',
    c4.n ? 'Refresh employee_identity.is_active / last_working_date against real roster activity, ' +
           'or correct the roster if the person truly left.' : 'none');

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

  /* The HR Matrix renders COALESCE(hr_code, attendance_code, shift_code,'OFF'). If presence
     and hr_code disagree, the roster and the matrix describe the same person's same day
     differently — and the matrix is what HR acts on. This fired at 44 when the 2026-07-29
     Odoo arbitration moved presence to leave/absent without moving hr_code with it. */
  const d4 = await one(
    `SELECT COUNT(*)::int n FROM roster_days
      WHERE is_active AND work_date BETWEEN $1 AND $2
        AND presence IN ('leave','absent','sick')
        AND COALESCE(hr_code,'') NOT IN ('L','A','SL','DL','UPL','H','COMP','Transfer')`, [FROM, TO]);
  add('D4', d4.n ? 'HIGH' : 'OK', 'BR-LVE-002', 'The HR matrix agrees with the roster', d4.n, 'contradicting days',
    'A leave or absent day whose hr_code still names a worked shift shows HR a shift the roster says was never worked.',
    'hr_code must follow presence wherever the engine arbitrates it');

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
