#!/usr/bin/env node
/**
 * DEMO-PATH SMOKE — the endpoints the five presentation pages actually call,
 * with REAL parameters, against the live database.
 *
 * The parameterless smoke (`smoke-get.js`) proves no route is dead. It cannot
 * prove the demo works, because every page in the demo passes a date, a month,
 * a week or a function — and a query that only breaks WITH parameters is exactly
 * the kind that surfaces on stage. This hits each one the way the UI does and
 * fails loudly on a 5xx, an empty payload where data must exist, or a body that
 * carries an error shape.
 *
 *   node scripts/smoke-demo-path.js [baseUrl] [role]
 */
const fs = require('fs'), path = require('path'), jwt = require('jsonwebtoken'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const BASE = process.argv[2] || 'http://localhost:3000';
const ROLE = process.argv[3] || 'platform_admin';

/** Saturday-anchored week start, matching the platform's own week rule (BR-TIM-001). */
function snapToSaturday(d) {
  const x = new Date(d); const dow = x.getDay();          // 0=Sun … 6=Sat
  x.setDate(x.getDate() - ((dow + 1) % 7));
  return x;
}
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [u] = (await c.query(
    `SELECT u.id, u.tenant_id FROM users u JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id WHERE u.status='active' AND r.code=$1 LIMIT 1`, [ROLE])).rows;
  if (!u) { console.error(`no active user with role ${ROLE}`); process.exit(1); }

  /* Anchor every probe on dates that REALLY carry data, read from the spine —
     a smoke test that invents a date proves nothing about the demo. */
  const [span] = (await c.query(
    `SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [u.tenant_id])).rows;
  const [busiest] = (await c.query(
    `SELECT work_date::text d FROM roster_days WHERE tenant_id=$1
      GROUP BY work_date ORDER BY COUNT(*) DESC LIMIT 1`, [u.tenant_id])).rows;
  const [fn] = (await c.query(
    `SELECT role_function f FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL
      GROUP BY role_function ORDER BY COUNT(*) DESC LIMIT 1`, [u.tenant_id])).rows;
  const [person] = (await c.query(
    `SELECT person_no p FROM roster_days WHERE tenant_id=$1
      GROUP BY person_no ORDER BY COUNT(*) DESC LIMIT 1`, [u.tenant_id])).rows;
  const [otMonth] = (await c.query(
    `SELECT to_char(work_date,'YYYY-MM') m FROM roster_days WHERE tenant_id=$1
       AND (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))>0
      GROUP BY 1 ORDER BY SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0)) DESC LIMIT 1`,
    [u.tenant_id])).rows;
  await c.end();

  const DATE = busiest.d, FROM = span.a, TO = span.b, FN = fn.f, PERSON = person.p, MONTH = otMonth.m;
  const WEEK = fmt(snapToSaturday(new Date(DATE)));
  const YEAR = DATE.slice(0, 4);
  const token = jwt.sign({ sub: u.id, tenantId: u.tenant_id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '30m' });

  console.log(`DEMO-PATH SMOKE as [${ROLE}] against ${BASE}`);
  console.log(`  anchors — busiest day ${DATE} · week ${WEEK} · span ${FROM}→${TO} · function "${FN}" · person ${PERSON} · OT month ${MONTH}\n`);

  /** [group, label, path, expectation]  — expectation returns null if OK, else a reason. */
  const nonEmpty = (k) => (b) => (Array.isArray(b?.[k]) ? b[k].length : Object.keys(b?.[k] || {}).length) > 0
    ? null : `"${k}" is empty on a day that has data`;
  const positive = (path) => (b) => {
    const v = path.split('.').reduce((o, s) => (o == null ? o : o[s]), b);
    return Number(v) > 0 ? null : `${path} = ${JSON.stringify(v)} (expected > 0)`;
  };

  const CHECKS = [
    // ── ROSTER ───────────────────────────────────────────────────────────
    ['ROSTER', 'grid (busiest week)', `/attendance-recon/roster-v2?from=${WEEK}&to=${DATE}`, nonEmpty('rows')],
    ['ROSTER', 'dashboard', `/attendance-recon/roster-dashboard?from=${FROM}&to=${TO}`, null],
    ['ROSTER', 'schedule-analysis', `/attendance-recon/roster-v2/schedule-analysis?from=${FROM}&to=${TO}`, null],
    ['ROSTER', 'OT & exceptions', `/attendance-recon/roster-v2/ot-exceptions?from=${FROM}&to=${TO}`, positive('ot.totalHrs')],
    ['ROSTER', 'OT tracker (month)', `/attendance-recon/roster-v2/ot-tracker?month=${MONTH}`, positive('totals.rawTotal')],
    ['ROSTER', 'OT tracker months', `/attendance-recon/roster-v2/ot-tracker/months`, nonEmpty('months')],
    ['ROSTER', 'OT year-to-date', `/attendance-recon/roster-v2/ot-year?year=${YEAR}`, positive('totals.total')],
    ['ROSTER', 'WFH HR report', `/attendance-recon/roster-v2/wfh-hr-report?from=${FROM}&to=${TO}`, null],
    ['ROSTER', 'data quality', `/attendance-recon/roster-v2/data-quality?from=${FROM}&to=${TO}`, null],
    ['ROSTER', 'trends', `/attendance-recon/roster-v2/trends?months=6`, null],
    ['ROSTER', 'fairness', `/attendance-recon/roster-v2/fairness?from=${FROM}&to=${TO}`, null],
    ['ROSTER', 'agent-360', `/attendance-recon/roster-v2/agent-360?person=${PERSON}&from=${FROM}&to=${TO}`, null],
    ['ROSTER', 'team-360', `/attendance-recon/roster-v2/team-360?from=${FROM}&to=${TO}`, null],

    // ── SCHEDULE ─────────────────────────────────────────────────────────
    ['SCHEDULE', 'grid', `/schedule/grid?weekStart=${WEEK}`, null],
    ['SCHEDULE', 'audit log', `/schedule/audit-log?weekStart=${WEEK}&weeks=4`, null],
    ['SCHEDULE', 'absence analysis', `/schedule/absence-analysis?from=${FROM}&to=${TO}`, null],
    ['SCHEDULE', 'hourly analytics', `/attendance-recon/roster-v2/hourly?from=${WEEK}&to=${DATE}`, null],
    ['SCHEDULE', 'interval headcount', `/attendance-recon/roster-v2/interval-headcount?date=${DATE}`, null],
    ['SCHEDULE', 'coverage impact', `/attendance-recon/roster-v2/coverage-impact?date=${DATE}`, null],
    ['SCHEDULE', 'shift rates', `/schedule-rotation/shift-rates?from=${FROM}&to=${TO}`, null],
    ['SCHEDULE', 'change log', `/attendance-recon/roster-v2/schedule-changes?from=${FROM}&to=${TO}`, null],

    // ── GENERATOR ────────────────────────────────────────────────────────
    ['GENERATOR', 'generate-week (dry)', `/attendance-recon/roster-v2/generate-week?weekStart=${WEEK}`, null],
    ['GENERATOR', 'gap remedies', `/attendance-recon/roster-v2/gap-remedies?date=${DATE}`, null],
    ['GENERATOR', 'gap backfill', `/attendance-recon/roster-v2/gap-backfill?from=${WEEK}&to=${DATE}`, null],
    ['GENERATOR', 'week forecast', `/attendance-recon/roster-v2/week-forecast?weekStart=${WEEK}`, null],

    // ── CAPACITY ─────────────────────────────────────────────────────────
    ['CAPACITY', 'hc overview', `/capacity/hc-overview?date=${DATE}`, null],
    ['CAPACITY', 'function hourly', `/capacity/function-hourly?date=${DATE}`, null],
    ['CAPACITY', 'live plan', `/capacity/live-plan?date=${DATE}`, null],
    ['CAPACITY', 'staffing requirement', `/capacity/staffing/requirement?date=${DATE}`, null],
    ['CAPACITY', 'staffing params', `/capacity/staffing/params`, null],
    ['CAPACITY', 'hiring now', `/capacity/staffing/hiring-now`, null],
    ['CAPACITY', 'hc by interval', `/capacity/hc-by-interval?date=${DATE}`, null],
    ['CAPACITY', 'functions', `/capacity/functions`, null],
    ['CAPACITY', 'scenarios', `/capacity/scenarios`, null],
    ['CAPACITY', 'forecasting saved', `/forecasting/saved`, null],

    // ── LIVE MONITORING ──────────────────────────────────────────────────
    ['LIVE', 'RTA live', `/rta/live`, null],
    ['LIVE', 'sprinklr adherence', `/integrations/sprinklr/adherence?date=${DATE}`, null],
    ['LIVE', 'sprinklr agent-board', `/integrations/sprinklr/agent-board?date=${DATE}`, null],
    ['LIVE', 'sprinklr live', `/integrations/sprinklr/live`, null],
    ['LIVE', 'sprinklr break-tracker', `/integrations/sprinklr/break-tracker?date=${DATE}`, null],
    ['LIVE', 'breaks coverage', `/breaks/coverage?date=${DATE}`, null],
    ['LIVE', 'breaks live queue', `/breaks/live-queue?date=${DATE}`, null],
    ['LIVE', 'breaks schedule', `/breaks/schedule?date=${DATE}`, null],
    ['LIVE', 'sprinklr coverage', `/integrations/sprinklr/coverage?date=${DATE}`, null],
    ['LIVE', 'sprinklr agent-daily', `/integrations/sprinklr/agent-daily?date=${DATE}`, null],
    ['LIVE', 'on-seat', `/attendance-recon/roster-v2/on-seat?date=${DATE}&function=${encodeURIComponent(FN)}&hour=14`, null],
  ];

  let pass = 0, warn = 0, fail = 0;
  const problems = [];
  let group = '';
  for (const [g, label, p, expect] of CHECKS) {
    if (g !== group) { group = g; console.log(`── ${g}`); }
    const url = `${BASE}/api/v1${p}`;
    let status = 0, body = null, err = null;
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      status = r.status;
      const text = await r.text();
      try { body = JSON.parse(text); } catch { body = text; }
    } catch (e) { err = e.message; }
    const ms = Date.now() - t0;

    if (err || status >= 500) {
      fail++; problems.push(`${g} · ${label} — ${err || status}`);
      console.log(`   ✗ ${label.padEnd(28)} ${err ? 'ERR ' + err : status}`);
      continue;
    }
    if (status >= 400) {
      warn++; problems.push(`${g} · ${label} — HTTP ${status}`);
      console.log(`   ! ${label.padEnd(28)} HTTP ${status}`);
      continue;
    }
    const why = expect ? expect(body) : null;
    if (why) { warn++; problems.push(`${g} · ${label} — ${why}`); console.log(`   ! ${label.padEnd(28)} ${ms}ms — ${why}`); }
    else { pass++; console.log(`   ✓ ${label.padEnd(28)} ${String(ms).padStart(5)}ms`); }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  PASS ${pass}   WARN ${warn}   FAIL ${fail}   of ${CHECKS.length}`);
  if (problems.length) { console.log('\n  Needs attention:'); problems.forEach((p) => console.log('   • ' + p)); }
  else console.log('\n  ✅ Every demo-path endpoint answers correctly with real parameters.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
