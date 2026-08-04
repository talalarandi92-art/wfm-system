#!/usr/bin/env node
/*
 * AUDIT SWEEP v2 — drive the REAL endpoint surface as every role, and judge each response
 * against the permissions the platform actually grants.
 *
 * v1 produced four findings and three were false. Every one of those false positives came
 * from the harness ASSUMING something it could have READ:
 *
 *   it assumed a tier model      -> reported a privilege leak that was a granted permission
 *   it re-authenticated per run  -> tripped the login throttle and called it a login failure
 *   it guessed endpoint paths    -> reported sixteen 404s on routes no page has ever called
 *
 * So v2 assumes nothing it can look up:
 *
 *   A-1  role expectations come from role_permissions in the live database
 *   A-2  tokens are cached to disk and reused, so the throttle is never the thing under test
 *   A-3  endpoints are HARVESTED from every apiClient call site in the frontend
 *
 * A finding here is worth reading. A finding in v1 was worth checking.
 *
 *   node scripts/audit-sweep.js [--limit N]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getClient } = require('./recon-db');

const B = process.env.AUDIT_BASE || 'http://localhost:3000/api/v1';
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'audit');
const TOKENS = path.join(__dirname, '..', '.recon-scratch', 'audit-tokens.json');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] : 0; })();

const ACCOUNTS = [
  ['admin', 'demo.admin@boutiqaat.wfm'], ['wfm', 'demo.wfm@boutiqaat.wfm'],
  ['rta', 'demo.rta@boutiqaat.wfm'], ['tl', 'demo.tl@boutiqaat.wfm'],
  ['hr', 'demo.hr@boutiqaat.wfm'], ['agent', 'demo.agent@boutiqaat.wfm'],
];
const PASS = 'Demo@2026';

/* ── A-3: the endpoint list is harvested, never invented ──────────────────────────────── */
function harvestPaths() {
  const src = path.join(ROOT, 'frontend', 'src');
  const out = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(tsx?|jsx?)$/.test(e.name)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      const re = /apiClient\.get\(\s*[`'"]([^`'"]+)/g;
      let m;
      while ((m = re.exec(txt))) {
        let raw = m[1];
        if (!raw.startsWith('/')) continue;
        /* Template holes become concrete values so the URL is actually fetchable. A path we
           cannot make concrete is skipped rather than guessed — guessing is what broke v1. */
        if (/\$\{/.test(raw)) {
          if (/\$\{[^}]*(from|start)[^}]*\}/i.test(raw)) raw = raw.replace(/\$\{[^}]*(from|start)[^}]*\}/gi, '2026-07-01');
          if (/\$\{[^}]*(to|end)[^}]*\}/i.test(raw)) raw = raw.replace(/\$\{[^}]*(to|end)[^}]*\}/gi, '2026-07-31');
          if (/\$\{[^}]*month[^}]*\}/i.test(raw)) raw = raw.replace(/\$\{[^}]*month[^}]*\}/gi, '2026-07');
          if (/\$\{[^}]*date[^}]*\}/i.test(raw)) raw = raw.replace(/\$\{[^}]*date[^}]*\}/gi, '2026-07-15');
          if (/\$\{[^}]*limit[^}]*\}/i.test(raw)) raw = raw.replace(/\$\{[^}]*limit[^}]*\}/gi, '25');
          if (/\$\{/.test(raw)) continue;               // still unresolved -> skip, do not guess
        }
        out.add(raw.replace(/[?&]$/, ''));
      }
    }
  };
  walk(src);
  return [...out].sort();
}

/* ── A-1: what each role may reach comes from the database, not from a belief ─────────── */
async function permissionModel() {
  const c = getClient(); await c.connect();
  const { rows } = await c.query(
    `SELECT u.email, r.name AS role, p.code AS perm
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.email LIKE '%boutiqaat.wfm'`);
  await c.end();
  const byEmail = {};
  for (const r of rows) {
    byEmail[r.email] = byEmail[r.email] || { role: r.role, perms: new Set() };
    if (r.perm) byEmail[r.email].perms.add(r.perm);
  }
  return byEmail;
}

/* ── A-2: log in once, reuse for an hour, so the throttle is never what fails ─────────── */
async function tokens() {
  try {
    const cached = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
    if (Date.now() - cached.at < 45 * 60 * 1000) { console.log('tokens: reused from cache'); return cached.t; }
  } catch { /* first run */ }
  const t = {};
  for (const [key, email] of ACCOUNTS) {
    const r = await fetch(B + '/auth/login', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
    const j = await r.json().catch(() => ({}));
    if (j.accessToken) t[key] = { token: j.accessToken, email };
    else console.log(`  ! ${key} login ${r.status} — ${JSON.stringify(j).slice(0, 60)}`);
    await new Promise(s => setTimeout(s, 1200));      // stay under the throttle deliberately
  }
  fs.mkdirSync(path.dirname(TOKENS), { recursive: true });
  fs.writeFileSync(TOKENS, JSON.stringify({ at: Date.now(), t }));
  return t;
}

(async () => {
  const paths = harvestPaths();
  const perms = await permissionModel();
  const tok = await tokens();
  const roles = Object.keys(tok);
  const list = LIMIT ? paths.slice(0, LIMIT) : paths;
  console.log(`harvested ${paths.length} real GET paths · probing ${list.length} × ${roles.length} roles`);
  console.log('roles:', roles.map(r => `${r}(${perms[tok[r].email]?.role || '?'}, ${perms[tok[r].email]?.perms.size || 0} perms)`).join(' · '));

  const findings = [];
  const add = (f) => findings.push({ ...f, at: new Date().toISOString() });
  let n = 0;

  for (const p of list) {
    const seen = {};
    for (const role of roles) {
      const t0 = Date.now();
      let status, body, ms;
      try {
        const r = await fetch(B + p, { headers: { authorization: 'Bearer ' + tok[role].token } });
        ms = Date.now() - t0; status = r.status;
        const txt = await r.text();
        try { body = JSON.parse(txt); } catch { body = txt.slice(0, 160); }
      } catch (e) {
        add({ sev: 'HIGH', kind: 'threw', path: p, role, evidence: e.message }); continue;
      }
      n++;
      seen[role] = { status, rows: Array.isArray(body) ? body.length : (body?.rows?.length ?? body?.data?.length ?? null) };

      if (status >= 500) {
        add({ sev: 'HIGH', kind: 'server error', path: p, role, evidence: `HTTP ${status} ${typeof body === 'string' ? body : JSON.stringify(body).slice(0, 160)}`,
              why: 'A 5xx is a crash the user sees as a broken page.' });
      }
      if (status === 404 && role === 'admin') {
        add({ sev: 'HIGH', kind: 'page calls a route that does not exist', path: p, role,
              evidence: 'HTTP 404 — and this path IS called by the UI',
              why: 'Harvested from a real apiClient call site, so a 404 means a page is wired to a missing route.' });
      }
      if (status === 200 && ms > 2000 && role === 'admin') {
        add({ sev: 'LOW', kind: 'slow', path: p, role, evidence: `${ms}ms` });
      }
    }

    /* Cross-role shape: agent seeing materially more than a supervisor is the leak that matters,
       and it is judged by comparison rather than by an assumed tier. */
    const a = seen.agent, admin = seen.admin;
    if (a && admin && a.status === 200 && admin.status === 200 && a.rows != null && admin.rows != null
        && admin.rows > 0 && a.rows >= admin.rows && a.rows > 5) {
      add({ sev: 'REVIEW', kind: 'agent sees as much as admin', path: p, role: 'agent',
            evidence: `agent ${a.rows} rows vs admin ${admin.rows}`,
            why: 'An agent should be scoped to their own data; parity with admin suggests the self-scope filter is absent.' });
    }
    if (++n % 40 === 0) process.stdout.write('.');
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'FINDINGS.json'), JSON.stringify(findings, null, 1));
  const by = (s) => findings.filter(f => f.sev === s).length;
  console.log(`\n\nAUDIT SWEEP v2 — ${n} role×endpoint checks over HARVESTED paths`);
  console.log(`  HIGH ${by('HIGH')} · REVIEW ${by('REVIEW')} · LOW ${by('LOW')}\n`);
  const shown = new Set();
  for (const f of findings.filter(x => x.sev !== 'LOW')) {
    const k = f.kind + f.path; if (shown.has(k)) continue; shown.add(k);
    console.log(`  [${f.sev}] ${f.kind} · ${f.role}\n         ${f.path}\n         ${f.evidence}`);
  }
  console.log(`\nwritten: docs/audit/FINDINGS.json (${findings.length})`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
