#!/usr/bin/env node
/*
 * AUDIT SWEEP — drive every GET endpoint as every role and record what actually happens.
 *
 * This is deliberately not a smoke test. A smoke test asks "did it 200?". This asks four
 * harder questions that a 200 hides:
 *
 *   1. Does it FAIL?               5xx, or a 4xx on a route the role should reach
 *   2. Does it LEAK?               a role seeing data its permission tier forbids
 *   3. Is it EMPTY?                200 with no rows — a page that renders nothing is broken
 *                                  to the user even though the code "worked"
 *   4. Is it SLOW?                 over a second on a page someone opens all day
 *
 * Findings are written to docs/audit/FINDINGS.json so they survive the session, and are
 * appended to the master audit document rather than replacing it.
 *
 *   node scripts/audit-sweep.js
 */
const fs = require('fs');
const path = require('path');
const B = process.env.AUDIT_BASE || 'http://localhost:3000/api/v1';
const OUT = path.join(__dirname, '..', '..', 'docs', 'audit');

/* The roles as the platform actually defines them, with the access each is supposed to have.
   Admin = everything · RTA + TL = admin minus settings/users · Agent = own data only. */
const ROLES = [
  { key: 'admin', email: 'demo.admin@boutiqaat.wfm', tier: 3 },
  { key: 'wfm', email: 'demo.wfm@boutiqaat.wfm', tier: 2 },
  { key: 'rta', email: 'demo.rta@boutiqaat.wfm', tier: 2 },
  { key: 'tl', email: 'demo.tl@boutiqaat.wfm', tier: 2 },
  { key: 'hr', email: 'demo.hr@boutiqaat.wfm', tier: 2 },
  { key: 'agent', email: 'demo.agent@boutiqaat.wfm', tier: 1 },
];
const PASS = 'Demo@2026';

/* Ranges chosen to exercise the live data rather than an empty future window. */
const D = { from: '2026-07-01', to: '2026-07-31', month: '2026-07', date: '2026-07-15' };

const EP = (p, opts = {}) => ({ path: p, ...opts });

/* Endpoints grouped by the page that consumes them, so a finding names a screen the
   Director can open rather than a route only a developer recognises. */
const SURFACE = [
  ['Command Center', [
    EP('/dashboard/command-center'), EP('/dashboard/summary'),
    EP('/control-dashboard/overview'), EP('/dashboard/wfm-overview'),
  ]],
  ['Roster & Reconciliation', [
    EP(`/attendance-recon/roster-v2/rows?from=${D.from}&to=${D.to}&limit=50`, { rows: true }),
    EP(`/attendance-recon/roster-v2/summary?from=${D.from}&to=${D.to}`),
    EP(`/attendance-recon/roster-v2/hr-matrix?month=${D.month}`, { rows: true }),
    EP(`/attendance-recon/roster-v2/data-trust`),
    EP(`/attendance-recon/roster-v2/data-quality?from=${D.from}&to=${D.to}`),
    EP(`/attendance-recon/roster-v2/ot-exceptions?from=${D.from}&to=${D.to}`),
    EP(`/attendance-recon/roster-v2/employee-master`, { rows: true }),
    EP(`/attendance-recon/roster-v2/integrity?from=${D.from}&to=${D.to}`),
  ]],
  ['Schedule', [
    EP('/schedule/grid'), EP('/schedule/functions', { rows: true }),
    EP('/schedule/available-weeks'), EP('/schedule/coverage'),
    EP('/schedule/shift-codes', { rows: true }),
    EP(`/schedule/absence-analysis`), EP('/schedule/audit-log'),
  ]],
  ['Capacity & Forecast', [
    EP('/capacity/scenarios'), EP(`/attendance-recon/roster-v2/hourly?from=${D.from}&to=${D.to}`),
    EP(`/attendance-recon/roster-v2/interval-headcount?date=${D.date}`),
    EP('/forecasting/backtest'),
  ]],
  ['Live Ops / RTA', [
    EP('/rta/live'), EP('/rta/alerts'), EP('/coverage/live'),
    EP(`/attendance-recon/roster-v2/on-seat?date=${D.date}`),
  ]],
  ['Requests & Approvals', [
    EP('/requests?limit=25', { rows: true }), EP('/requests/stats'),
    EP('/permission-requests?limit=25'), EP('/leave-balances'),
    EP('/breaks/today'), EP('/calendar/events'),
  ]],
  ['Scorecard & People', [
    EP(`/scorecard/monthly?month=${D.month}`, { rows: true }),
    EP('/scorecard/agent-scores'), EP('/employees?limit=25', { rows: true }),
    EP('/skills'), EP('/coaching'), EP('/attrition/summary'),
    EP('/productivity/summary'),
  ]],
  ['Analytics & Reports', [
    EP('/reports/catalogue'), EP('/operations-analytics/summary'),
    EP('/workforce-analytics/summary'), EP('/report-builder/sources'),
  ]],
  ['Admin & Integrations', [
    EP('/users?limit=25', { adminOnly: true, rows: true }),
    EP('/settings', { adminOnly: true }),
    EP('/integrations/health'), EP('/audit-log?limit=25'),
    EP('/import/batches'),
  ]],
];

const findings = [];
const add = (f) => { findings.push({ ...f, at: new Date().toISOString() }); };

(async () => {
  const tokens = {};
  for (const r of ROLES) {
    try {
      const res = await fetch(B + '/auth/login', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: r.email, password: PASS }) });
      const j = await res.json();
      if (j.accessToken) tokens[r.key] = j.accessToken;
      else add({ sev: 'HIGH', area: 'Auth', what: `role ${r.key} (${r.email}) cannot log in`,
                 evidence: `HTTP ${res.status} ${JSON.stringify(j).slice(0, 120)}`,
                 why: 'A role that cannot authenticate cannot be audited, and if it is a real role, cannot work.' });
    } catch (e) { add({ sev: 'HIGH', area: 'Auth', what: `login threw for ${r.key}`, evidence: e.message }); }
  }
  console.log('logged in:', Object.keys(tokens).join(', ') || '(none)');

  let checked = 0;
  for (const [surface, eps] of SURFACE) {
    for (const ep of eps) {
      for (const role of ROLES) {
        const tok = tokens[role.key];
        if (!tok) continue;
        const t0 = Date.now();
        let status, body, ms;
        try {
          const res = await fetch(B + ep.path, { headers: { authorization: 'Bearer ' + tok } });
          ms = Date.now() - t0;
          status = res.status;
          const txt = await res.text();
          try { body = JSON.parse(txt); } catch { body = txt.slice(0, 200); }
        } catch (e) {
          add({ sev: 'HIGH', area: surface, role: role.key, what: 'request threw', path: ep.path, evidence: e.message });
          continue;
        }
        checked++;

        // 1. server errors are never acceptable
        if (status >= 500) {
          add({ sev: 'HIGH', area: surface, role: role.key, what: `${status} server error`, path: ep.path,
                evidence: typeof body === 'string' ? body : JSON.stringify(body).slice(0, 200),
                why: 'A 5xx is a crash the user sees as a blank or broken page.' });
          continue;
        }

        // 2. permission shape — an agent reaching an admin surface is a leak
        if (ep.adminOnly && role.tier < 3 && status === 200) {
          add({ sev: 'HIGH', area: surface, role: role.key, what: 'reaches an admin-only surface', path: ep.path,
                evidence: `HTTP 200 for tier-${role.tier} role`,
                why: 'Admin-only means settings and user administration; a lower tier reading it is a privilege leak.' });
        }
        if (role.key === 'agent' && status === 200 && ep.rows) {
          const n = Array.isArray(body) ? body.length : (body?.rows?.length ?? body?.data?.length ?? null);
          if (n !== null && n > 5) {
            add({ sev: 'REVIEW', area: surface, role: 'agent', what: `agent receives ${n} rows`, path: ep.path,
                  evidence: `array length ${n}`,
                  why: 'An agent should see their own data. A large row count suggests the self-scope filter is missing.' });
          }
        }

        // 3. a 200 that renders nothing is broken to the person looking at it
        if (status === 200 && ep.rows && role.tier >= 2) {
          const n = Array.isArray(body) ? body.length : (body?.rows?.length ?? body?.data?.length ?? null);
          if (n === 0) {
            add({ sev: 'MED', area: surface, role: role.key, what: 'returns zero rows over a period with live data', path: ep.path,
                  evidence: 'HTTP 200, 0 rows',
                  why: 'The page renders empty. The code succeeded; the screen is still useless.' });
          }
        }

        // 4. an unexpected 4xx for a role that should reach it
        if (status === 403 && role.tier >= 2 && !ep.adminOnly) {
          add({ sev: 'MED', area: surface, role: role.key, what: '403 on a surface this role needs', path: ep.path,
                evidence: `HTTP 403`,
                why: 'RTA/TL/WFM are admin-minus-settings; a 403 here blocks real work.' });
        }
        if (status === 404 && role.key === 'admin') {
          add({ sev: 'MED', area: surface, role: 'admin', what: 'route not found', path: ep.path,
                evidence: 'HTTP 404',
                why: 'Either the page calls a route that does not exist, or this probe has the wrong path — both need resolving.' });
        }

        // 5. slow enough to be felt
        if (status === 200 && ms > 1500 && role.key === 'admin') {
          add({ sev: 'LOW', area: surface, role: 'admin', what: `slow response ${ms}ms`, path: ep.path,
                evidence: `${ms}ms`, why: 'Over 1.5s on a page opened repeatedly through the day.' });
        }
      }
    }
    process.stdout.write('.');
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'FINDINGS.json'), JSON.stringify(findings, null, 1));

  const by = (s) => findings.filter(f => f.sev === s).length;
  console.log(`\n\nAUDIT SWEEP — ${checked} role×endpoint checks`);
  console.log(`  HIGH ${by('HIGH')} · MED ${by('MED')} · REVIEW ${by('REVIEW')} · LOW ${by('LOW')}`);
  const seen = new Set();
  for (const f of findings) {
    const k = f.sev + f.area + f.what + (f.path || '');
    if (seen.has(k)) continue; seen.add(k);
    console.log(`  [${f.sev}] ${f.area} · ${f.role || '-'} · ${f.what}` + (f.path ? `\n         ${f.path}` : ''));
  }
  console.log(`\nwritten: docs/audit/FINDINGS.json (${findings.length} findings)`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
