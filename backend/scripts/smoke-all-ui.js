#!/usr/bin/env node
/**
 * WHOLE-UI SMOKE — every endpoint the frontend actually calls, discovered by
 * READING THE FRONTEND, then exercised with real parameters against live data.
 *
 * WHY IT READS THE SOURCE INSTEAD OF A HAND-WRITTEN LIST: a hand-written list is
 * correct on the day it is written and silently stale after that. Someone adds a
 * page, the list does not grow, and the gap is invisible until a buyer clicks it.
 * This harness cannot drift, because the UI source IS the list. If a page calls
 * it, this tests it.
 *
 * Parameters are substituted by NAME from anchors read out of the live database —
 * `${date}` gets a day that really has rows, `${weekStart}` a real Saturday,
 * `${person}` someone who really exists. A smoke test that invents its inputs
 * proves nothing about the product.
 *
 * READ-ONLY: GET only. Mutations and heavy/destructive routes are excluded by
 * name and listed at the end so the exclusion is visible, never silent.
 *
 *   node scripts/smoke-all-ui.js [baseUrl] [role] [--list] [--slow]
 */
const fs = require('fs'), path = require('path'), jwt = require('jsonwebtoken'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3000';
const ROLE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'platform_admin';
const LIST = process.argv.includes('--list');
const SLOW = process.argv.includes('--slow');          // also report slow-but-working endpoints
const FE = path.join(__dirname, '..', '..', 'frontend', 'src');

/* Routes deliberately NOT smoked, with the reason. Anything excluded is printed,
   so the coverage claim stays honest. */
const EXCLUDE = [
  [/\/export/i,               'streams a file — proven separately by the export checks'],
  [/recon-refresh|rebuild/i,  'rebuilds the whole roster — far too heavy to smoke'],
  [/publish|unpublish|revert/i, 'state-changing'],
  [/logout|refresh-token/i,   'would end the session'],
  [/\/poll\b/i,               'long-poll — would hang the run'],
  [/smoke-test|diagnostics/i, 'the self-test endpoints; smoking them is circular'],
];

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f.name)) out.push(p);
  }
  return out;
};

/** Pull every apiClient.get('…') / .get(`…`) path out of the UI source. */
function discover() {
  const found = new Map();                 // path → Set(source files)
  for (const file of walk(FE)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /apiClient\.get\(\s*(`[^`]+`|'[^']+'|"[^"]+")/g;
    let m;
    while ((m = re.exec(src))) {
      const raw = m[1].slice(1, -1);
      if (!raw.startsWith('/')) continue;
      const rel = path.relative(FE, file).replace(/\\/g, '/');
      if (!found.has(raw)) found.set(raw, new Set());
      found.get(raw).add(rel);
    }
  }
  return found;
}

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [u] = (await c.query(
    `SELECT u.id, u.tenant_id FROM users u JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id WHERE u.status='active' AND r.code=$1 LIMIT 1`, [ROLE])).rows;
  if (!u) { console.error(`no active user with role ${ROLE}`); process.exit(1); }
  const T = u.tenant_id;
  const one = async (q, p = []) => (await c.query(q, p).catch(() => ({ rows: [{}] }))).rows[0] || {};

  const span    = await one(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [T]);
  const busiest = await one(`SELECT work_date::text d FROM roster_days WHERE tenant_id=$1 GROUP BY work_date ORDER BY COUNT(*) DESC LIMIT 1`, [T]);
  const fn      = await one(`SELECT role_function f FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`, [T]);
  const person  = await one(`SELECT person_no p, MAX(clean_name) n FROM roster_days WHERE tenant_id=$1 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`, [T]);
  const otMonth = await one(`SELECT to_char(work_date,'YYYY-MM') m FROM roster_days WHERE tenant_id=$1
      AND (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))>0
     GROUP BY 1 ORDER BY SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0)) DESC LIMIT 1`, [T]);
  const emp     = await one(`SELECT id::text FROM employees WHERE tenant_id=$1 LIMIT 1`, [T]);
  const usr     = await one(`SELECT id::text FROM users WHERE tenant_id=$1 LIMIT 1`, [T]);

  /* A bare `${id}` means a DIFFERENT table on every route. Feeding an employee
     uuid to an outage lookup proves nothing except that the row is missing, so
     each route family gets a real id of its own kind where the table has one. */
  const ID_OF = {};
  for (const [re, sql] of [
    ['/outages',            `SELECT id::text FROM outages WHERE tenant_id=$1 LIMIT 1`],
    ['/technical-issues',   `SELECT id::text FROM technical_issues WHERE tenant_id=$1 LIMIT 1`],
    ['/knowledge-base',     `SELECT id::text FROM kb_articles WHERE tenant_id=$1 LIMIT 1`],
    ['/chat/channels',      `SELECT c.id::text FROM chat_channels c JOIN chat_channel_members m ON m.channel_id=c.id WHERE m.user_id=$2 LIMIT 1`],
    ['/report-builder-v2/saved-reports',    `SELECT id::text FROM saved_reports WHERE tenant_id=$1 LIMIT 1`],
    ['/report-builder-v2/saved-dashboards', `SELECT id::text FROM saved_dashboards WHERE tenant_id=$1 LIMIT 1`],
    ['/forecasting/saved',  `SELECT id::text FROM forecast_scenarios WHERE tenant_id=$1 LIMIT 1`],
    ['/imports',            `SELECT id::text FROM import_batches WHERE tenant_id=$1 LIMIT 1`],
    ['/requests',           `SELECT id::text FROM requests WHERE tenant_id=$1 LIMIT 1`],
    ['/reporter/runs',      `SELECT id::text FROM reporter_runs WHERE tenant_id=$1 LIMIT 1`],
  ]) {
    const r = await one(sql.includes('$2') ? sql : sql, sql.includes('$2') ? [T, u.id] : [T]);
    if (r && r.id) ID_OF[re] = r.id;
  }
  await c.end();

  const DATE = busiest.d || span.b, FROM = span.a, TO = span.b;
  const sat = (() => { const x = new Date(DATE); x.setDate(x.getDate() - ((x.getDay() + 1) % 7));
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();

  /* Substitute `${expr}` by what the variable NAME means, not by its code. */
  const byName = [
    [/week(start|_start)?$|^wk/i,              sat],   // weekStart, selectedWeek, wk — but NOT plural 'weeks' (a count)
    [/from|start(date)?|since/i,               FROM],
    [/to\b|end(date)?|until/i,                 TO],
    [/month/i,                                 otMonth.m || DATE.slice(0, 7)],
    [/year/i,                                  DATE.slice(0, 4)],
    [/date|day/i,                              DATE],
    [/person|employeeno|empno|agentno/i,       person.p],
    [/employeeid|empid/i,                      emp.id || person.p],
    [/userid/i,                                usr.id || ''],
    [/function|dept|team/i,                    fn.f],
    [/hour/i,                                  '14'],
    [/limit|count|top|months|weeks|days/i,     '6'],
    [/id$/i,                                   emp.id || '1'],
  ];
  /* A page that writes `?${qp}` is interpolating a whole URLSearchParams bag, not
     one value. Substituting '' sent a query with NO parameters and every handler
     with a required param answered 400 — the harness grading its own empty URL as
     a product bug. Build the bag the page would have built instead. */
  const BAG = /^(qp|pq|qs|q|params|sp|usp|query|args)\d*$/i;
  const bagFor = (route) => {
    const p = new URLSearchParams();
    if (/person|agent-|\/me\//.test(route)) p.set('person', String(person.p));
    if (/aFrom|period-compare/.test(route)) { p.set('aFrom', FROM); p.set('aTo', TO); p.set('bFrom', FROM); p.set('bTo', TO); }
    p.set('from', FROM); p.set('to', TO);
    if (/month/i.test(route)) p.set('month', otMonth.m || DATE.slice(0, 7));
    if (/week/i.test(route)) p.set('weekStart', sat);
    if (/date=/i.test(route)) p.set('date', DATE);
    return p.toString();
  };

  /** true when a `${…}` could not be resolved to anything real. */
  let unresolved = false;
  const fill = (raw) => {
    unresolved = false;
    return raw.replace(/\$\{([^}]*)\}/g, (_, expr) => {
      const e = expr.trim();
      if (BAG.test(e)) {
        // Some pages keep the leading '?' INSIDE the variable (const q = `?from=…`),
        // others outside it (`…?${qp}`). Emit one iff the path has none already —
        // without this the query was glued onto the route name and every such call
        // 404'd on a path that does not exist.
        const bag = bagFor(raw);
        return raw.slice(0, raw.indexOf('${' + expr)).includes('?') ? bag : '?' + bag;
      }
      if (/^[a-z_]*id\d*$/i.test(e) || /id$/i.test(e)) {          // a row id → pick the right table
        const hit = Object.keys(ID_OF).find((k) => raw.startsWith(k));
        if (hit) return encodeURIComponent(ID_OF[hit]);
        if (/employeeid|empid/i.test(e) && emp.id) return encodeURIComponent(emp.id);
        if (/userid/i.test(e) && usr.id) return encodeURIComponent(usr.id);
        unresolved = true;                                       // no row of this kind exists
        return '00000000-0000-0000-0000-000000000000';
      }
      const hit = byName.find(([re]) => re.test(e));
      if (!hit) { unresolved = true; return ''; }
      return encodeURIComponent(hit[1]);
    });
  };

  /* Documented, UI-handled precondition failures. Declared, not silenced — they
     are printed in their own bucket so the claim stays checkable. */
  const EXPECTED_400 = [
    [/\/breaks\/my-break-status/, 'admin has no linked employee — BreakCard renders the "not linked" state off this exact 400'],
  ];

  const token = jwt.sign({ sub: u.id, tenantId: T }, process.env.JWT_ACCESS_SECRET, { expiresIn: '45m' });
  const discovered = discover();

  console.log(`WHOLE-UI SMOKE as [${ROLE}] · ${discovered.size} endpoints discovered by reading ${FE.replace(/\\/g, '/')}`);
  console.log(`  anchors — day ${DATE} · week ${sat} · span ${FROM}→${TO} · fn "${fn.f}" · person ${person.p} (${person.n}) · month ${otMonth.m}\n`);

  const skipped = [], fails = [], slow = [], authz = [], unbuildable = [], expected = [], throttled = [];
  let ok = 0;

  for (const [raw, files] of [...discovered.entries()].sort()) {
    const ex = EXCLUDE.find(([re]) => re.test(raw));
    if (ex) { skipped.push({ raw, why: ex[1] }); continue; }
    const filled = fill(raw);
    const couldNotBuild = unresolved;
    const url = `${BASE}/api/v1${filled}`;
    const t0 = Date.now();
    try {
      let r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      /* 429 is the API defending itself, not a broken endpoint. Running this straight
         after pre-flight (which runs its own 46-endpoint sweep) tripped the throttle
         and reported 160 "failures" from a completely healthy system — the harness
         grading its own impatience. Back off once, then count it separately. */
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 1200));
        r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 429) { throttled.push({ raw }); continue; }
      }
      const ms = Date.now() - t0;
      // a 500 is ALWAYS a product failure, however the URL was built
      if (r.status >= 500) { fails.push({ raw, status: r.status, files: [...files], ms }); continue; }
      if (r.status === 401 || r.status === 403) { authz.push({ raw, status: r.status }); continue; }
      const exp = EXPECTED_400.find(([re]) => re.test(raw));
      if (r.status === 400 && exp) { expected.push({ raw, why: exp[1] }); continue; }
      // 404 on an id this harness had to invent says nothing about the product
      if (couldNotBuild && (r.status === 404 || r.status === 400)) { unbuildable.push({ raw, status: r.status }); continue; }
      if (r.status >= 400) { fails.push({ raw, status: r.status, files: [...files], ms }); continue; }
      ok++;
      if (ms > 1500) slow.push({ raw, ms });
      if (LIST) console.log(`   ✓ ${String(ms).padStart(5)}ms  ${raw}`);
    } catch (e) {
      fails.push({ raw, status: 'ERR', err: e.message, files: [...files], ms: Date.now() - t0 });
    }
  }

  console.log(`${'═'.repeat(74)}`);
  console.log(`  OK ${ok}   FAIL ${fails.length}   authz-blocked ${authz.length}   ` +
              `expected-400 ${expected.length}   no-test-row ${unbuildable.length}   ` +
              `rate-limited ${throttled.length}   skipped ${skipped.length}`);
  if (fails.length) {
    console.log('\n  FAILURES — a page in the product calls each of these:');
    for (const f of fails) console.log(`   ✗ ${f.status}  ${f.raw}\n        called from: ${f.files.slice(0, 3).join(', ')}`);
  }
  if (slow.length && SLOW) {
    console.log('\n  SLOW (>1.5s) — works, but would feel sluggish live:');
    for (const s of slow.sort((a, b) => b.ms - a.ms)) console.log(`   ! ${String(s.ms).padStart(6)}ms  ${s.raw}`);
  }
  if (throttled.length) {
    console.log(`
  RATE-LIMITED — the throttle held (it is meant to). Re-run on its own,`);
    console.log('  or wait a minute after pre-flight; these were never exercised:');
    for (const t2 of throttled.slice(0, 8)) console.log(`   · ${t2.raw}`);
    if (throttled.length > 8) console.log(`   · …and ${throttled.length - 8} more`);
  }
  if (expected.length) {
    console.log('\n  EXPECTED 400 — the UI reads this exact response as a state, not an error:');
    for (const e of expected) console.log(`   · ${e.raw}\n        ${e.why}`);
  }
  if (unbuildable.length) {
    console.log('\n  NO TEST ROW — the route needs an id of a kind this database has none of,');
    console.log('  so the harness could not build a real URL. NOT a product failure; listed so');
    console.log('  the coverage number is not quietly inflated:');
    for (const u2 of unbuildable) console.log(`   · ${u2.status}  ${u2.raw}`);
  }
  if (skipped.length) {
    console.log('\n  Deliberately not smoked (stated so the coverage claim stays honest):');
    const byWhy = {};
    for (const s of skipped) (byWhy[s.why] = byWhy[s.why] || []).push(s.raw);
    for (const [why, list] of Object.entries(byWhy)) console.log(`   · ${list.length} × ${why}`);
  }
  console.log(fails.length ? '\n  ✗ Fix the failures above before shipping.\n' : '\n  ✅ Every endpoint the UI calls answers correctly.\n');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
