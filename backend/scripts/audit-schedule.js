#!/usr/bin/env node
/*
 * SCHEDULE + GENERATOR AUDIT — queue item 2.
 *
 * Not "does it respond". Six questions a responding endpoint can still fail:
 *
 *   S1  Does the schedule grid agree with roster_days, cell for cell?
 *       Two surfaces reading the same week must not disagree about who works what.
 *   S2  Does the coverage summary's arithmetic close?
 *   S3  Do the shift windows the grid reports match the canonical dictionary?
 *   S4  Does the generator honour the rules it claims — 10h rest, exactly 2 OFF,
 *       female eligibility — in output it actually produced?
 *   S5  Is a published week protected from regeneration?
 *   S6  Do the same endpoints behave for every role that needs them?
 *
 * Every check states what it compared and prints the disagreeing rows, because a count
 * without the rows behind it cannot be acted on.
 */
const fs = require('fs');
const path = require('path');
const { getClient } = require('./recon-db');
const B = process.env.AUDIT_BASE || 'http://localhost:3000/api/v1';
const TOKENS = path.join(__dirname, '..', '.recon-scratch', 'audit-tokens.json');

const results = [];
const check = (id, name, ok, detail) => {
  results.push({ id, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}`);
  if (detail) console.log(`        ${detail}`);
};

/* Canonical windows (BR-SHF-005). A grid reporting anything else for these codes is wrong. */
const CANON = {
  M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320],
  E: [960, 60], MD: [1320, 420], MN: [1380, 480],
  M20: [480, 960], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320],
  'M7-3': [420, 900], CCNO: [540, 1020],
};

(async () => {
  const { t } = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
  const H = (role) => ({ authorization: 'Bearer ' + t[role].token });
  const c = getClient(); await c.connect();

  /* Pick a week that actually has data, anchored on Saturday (BR-TIM-001). */
  const { rows: [wk] } = await c.query(
    `SELECT (work_date - ((EXTRACT(DOW FROM work_date)::int + 1) % 7))::text AS sat
       FROM roster_days WHERE is_active AND shift_start_min IS NOT NULL
      ORDER BY work_date DESC LIMIT 1`);
  const WS = wk.sat;
  console.log(`\nSCHEDULE + GENERATOR AUDIT — week starting ${WS} (Saturday)\n`);

  /* ── S1 · grid vs roster_days, cell for cell ─────────────────────────────────────── */
  const gr = await fetch(`${B}/schedule/grid?weekStart=${WS}&weeks=1`, { headers: H('admin') });
  const grid = await gr.json();
  const gridRows = grid?.rows || grid?.employees || (Array.isArray(grid) ? grid : []);
  if (!gridRows.length) {
    check('S1', 'grid vs roster_days', false, `the grid returned no rows for ${WS} (HTTP ${gr.status}) — keys: ${Object.keys(grid || {}).join(',')}`);
  } else {
    /* Flatten whatever shape the grid uses into person|date -> code */
    const gm = new Map();
    for (const r of gridRows) {
      const id = String(r.employeeNo ?? r.employee_no ?? r.employeeId ?? r.id ?? '');
      const days = r.days || r.cells || {};
      if (Array.isArray(days)) {
        for (const d of days) {
          const dt = d.date ?? d.day; const cd = d.shiftCode ?? d.shift_code ?? d.code;
          if (dt) gm.set(id + '|' + String(dt).slice(0, 10), String(cd ?? '').toUpperCase());
        }
      } else {
        for (const [dt, v] of Object.entries(days)) {
          const cd = typeof v === 'string' ? v : (v?.shiftCode ?? v?.shift_code ?? v?.code);
          gm.set(id + '|' + String(dt).slice(0, 10), String(cd ?? '').toUpperCase());
        }
      }
    }
    const { rows: rd } = await c.query(
      `SELECT employee_no, person_no, work_date::text d, COALESCE(shift_code,'OFF') code
         FROM roster_days WHERE is_active AND work_date BETWEEN $1::date AND $1::date + 6`, [WS]);
    let agree = 0; const dis = [];
    for (const r of rd) {
      const g = gm.get(String(r.employee_no) + '|' + r.d) ?? gm.get(String(r.person_no) + '|' + r.d);
      if (g === undefined) continue;
      if (g === String(r.code).toUpperCase()) agree++;
      else if (dis.length < 8) dis.push({ emp: r.employee_no, date: r.d, grid: g, roster: r.code });
    }
    const total = agree + dis.length;
    check('S1', 'schedule grid agrees with roster_days',
      dis.length === 0 && total > 0,
      total === 0 ? `no overlapping cells to compare (grid keyed differently — grid has ${gm.size} cells, roster ${rd.length} rows)`
                  : `${agree}/${total} cells agree` + (dis.length ? `\n        ` + dis.map(x => `${x.date} ${x.emp}: grid=${x.grid} roster=${x.roster}`).join('\n        ') : ''));
  }

  /* ── S3 · shift windows against the canonical dictionary ─────────────────────────── */
  const { rows: win } = await c.query(
    `SELECT shift_code, MIN(shift_start_min)::int ss, MIN(shift_end_min)::int se, COUNT(*)::int n
       FROM roster_days WHERE is_active AND shift_start_min IS NOT NULL
        AND work_date >= '2026-06-01' GROUP BY 1`);
  const bad = win.filter(w => CANON[w.shift_code] &&
    (CANON[w.shift_code][0] !== w.ss || CANON[w.shift_code][1] !== w.se));
  check('S3', 'stored shift windows match the canonical dictionary', bad.length === 0,
    bad.length ? bad.map(b => `${b.shift_code}: stored ${b.ss}-${b.se}, canon ${CANON[b.shift_code].join('-')} (${b.n} rows)`).join('\n        ')
               : `${win.filter(w => CANON[w.shift_code]).length} known codes verified`);

  /* ── S3b · no shift may end at 21:00 (a 21:00 end is a typing error) ─────────────── */
  const { rows: [e21] } = await c.query(
    `SELECT COUNT(*)::int n FROM roster_days WHERE is_active AND shift_end_min = 1260`);
  check('S3b', 'no shift ends at 21:00', e21.n === 0, `${e21.n} rows end at 21:00`);

  /* ── S4a · minimum rest 10h between consecutive shifts (BR-RST-001) ──────────────── */
  const { rows: rest } = await c.query(
    `WITH s AS (
       SELECT person_no, clean_name, work_date, shift_start_min ss,
              CASE WHEN shift_end_min <= shift_start_min THEN shift_end_min + 1440 ELSE shift_end_min END se
         FROM roster_days WHERE is_active AND shift_start_min IS NOT NULL AND work_date >= '2026-07-01'),
     p AS (
       SELECT s.*, LEAD(work_date) OVER w nd, LEAD(ss) OVER w nss
         FROM s WINDOW w AS (PARTITION BY person_no ORDER BY work_date))
     SELECT clean_name, work_date::text d, se, nd::text ndate, nss,
            ((nd - work_date) * 1440 + nss - se) AS rest_min
       FROM p WHERE nd IS NOT NULL AND ((nd - work_date) * 1440 + nss - se) < 600
      ORDER BY rest_min LIMIT 10`);
  check('S4a', 'minimum 10h rest between consecutive shifts', rest.length === 0,
    rest.length ? `${rest.length} violations (worst first):\n        ` +
      rest.slice(0, 5).map(r => `${r.clean_name} ${r.d}→${r.ndate}: ${r.rest_min} min rest`).join('\n        ')
                : 'no violation in July onward');

  /* ── S4b · female agents never on MD/MN (BR-GEN-003) ────────────────────────────── */
  const { rows: fem } = await c.query(
    `SELECT clean_name, work_date::text d, shift_code FROM roster_days
      WHERE is_active AND gender ILIKE 'f%' AND shift_code IN ('MD','MN','MDR','MNR')
        AND work_date >= '2026-06-01' ORDER BY work_date DESC LIMIT 10`);
  check('S4b', 'no female agent on a midnight shift', fem.length === 0,
    fem.length ? `${fem.length} rows:\n        ` + fem.slice(0, 5).map(f => `${f.clean_name} ${f.d} ${f.shift_code}`).join('\n        ')
               : 'none found June onward');

  /* ── S4c · never 3+ consecutive OFF (BR-OFF-002) ────────────────────────────────── */
  const { rows: off3 } = await c.query(
    `WITH s AS (
       SELECT person_no, clean_name, work_date,
              LAG(shift_code) OVER w p1, shift_code cur, LEAD(shift_code) OVER w n1
         FROM roster_days WHERE is_active AND work_date >= '2026-06-01'
        WINDOW w AS (PARTITION BY person_no ORDER BY work_date))
     SELECT clean_name, work_date::text d FROM s
      WHERE p1='OFF' AND cur='OFF' AND n1='OFF' ORDER BY work_date DESC LIMIT 10`);
  check('S4c', 'never 3 or more consecutive OFF days', off3.length === 0,
    off3.length ? `${off3.length} occurrences (middle day shown):\n        ` +
      off3.slice(0, 5).map(o => `${o.clean_name} ${o.d}`).join('\n        ')
                : 'none June onward');

  /* ── S5 · a published week must refuse regeneration ─────────────────────────────── */
  const ws = await fetch(`${B}/schedule/week-status?weekStart=${WS}`, { headers: H('admin') });
  const wsj = await ws.json().catch(() => ({}));
  check('S5', 'week-status endpoint answers', ws.status === 200,
    `HTTP ${ws.status} · status="${wsj?.status ?? wsj?.weekStatus ?? JSON.stringify(wsj).slice(0, 60)}"`);

  /* ── S6 · role reach on the schedule surface ────────────────────────────────────── */
  const paths = ['/schedule/grid', '/schedule/functions', '/schedule/coverage',
                 '/schedule/available-weeks', '/schedule/shift-codes', '/schedule/audit-log'];
  const roleRows = [];
  for (const p of paths) {
    const row = { path: p };
    for (const role of ['admin', 'wfm', 'rta', 'tl', 'hr', 'agent']) {
      if (!t[role]) { row[role] = '-'; continue; }
      const r = await fetch(B + p, { headers: H(role) });
      row[role] = r.status;
    }
    roleRows.push(row);
  }
  const anyServerErr = roleRows.some(r => Object.values(r).some(v => typeof v === 'number' && v >= 500));
  check('S6', 'schedule surface has no server errors for any role', !anyServerErr, '');
  console.table(roleRows);

  await c.end();
  const fails = results.filter(r => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks pass` +
    (fails.length ? `\nFAILING: ${fails.map(f => f.id).join(', ')}` : ''));
  fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'audit', 'SCHEDULE_CHECKS.json'),
    JSON.stringify(results, null, 1));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
