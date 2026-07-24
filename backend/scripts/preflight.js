#!/usr/bin/env node
/**
 * PRE-FLIGHT — one command, run before the presentation, that answers GO / NO-GO.
 *
 * Not a test suite. A checklist of the things that actually break a live demo,
 * each one PROVEN rather than assumed, in the order they would hurt:
 *   1. is the supervisor running (so a crash self-heals)
 *   2. is the API up and fast
 *   3. is the SPA being served from a build that includes the latest code
 *   4. does the database answer, and how fresh is each feed
 *   5. do the demo pages' own endpoints work with real parameters
 *   6. do the screens agree with each other
 *
 * Exits non-zero on anything that would show badly. Prints what to DO about it.
 *
 *   node scripts/preflight.js
 */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const BASE = process.argv[2] || 'http://localhost:3000';
const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[90m', off: '\x1b[0m', b: '\x1b[1m' };

const items = [];
const add = (level, name, detail, fix) => { items.push({ level, name, detail, fix }); };

(async () => {
  console.log(`${C.b}PRE-FLIGHT — WFM presentation readiness${C.off}`);
  console.log(`${C.dim}${new Date().toString()}${C.off}\n`);

  // ── 1. supervisor ────────────────────────────────────────────────────
  try {
    const out = execSync('npx pm2 jlist', { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const apps = JSON.parse(out);
    const app = apps.find((a) => a.name === 'wfm-backend');
    if (!app) add('bad', 'Supervisor', 'PM2 has no wfm-backend process — a crash will NOT self-heal',
      'cd backend && npx pm2 start ecosystem.config.js && npx pm2 save');
    else if (app.pm2_env.status !== 'online') add('bad', 'Supervisor', `wfm-backend is "${app.pm2_env.status}"`,
      'cd backend && npx pm2 restart wfm-backend');
    else {
      const up = Math.round((Date.now() - app.pm2_env.pm_uptime) / 1000);
      const r = app.pm2_env.restart_time || 0;
      add(r > 3 ? 'warn' : 'ok', 'Supervisor',
        `online · pid ${app.pid} · up ${up < 90 ? up + 's' : Math.round(up / 60) + 'm'} · ${r} restart(s) · ${Math.round((app.monit?.memory || 0) / 1e6)}MB`,
        r > 3 ? 'It has restarted repeatedly — check `npx pm2 logs wfm-backend --err`' : null);
    }
  } catch (e) {
    add('warn', 'Supervisor', 'could not query PM2 — the backend may be running bare (no auto-restart)',
      'cd backend && npx pm2 start ecosystem.config.js && npx pm2 save');
  }

  // ── 2. API ───────────────────────────────────────────────────────────
  let apiUp = false;
  try {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/v1/health`);
    const ms = Date.now() - t0;
    apiUp = r.ok;
    add(r.ok ? (ms > 1500 ? 'warn' : 'ok') : 'bad', 'API', `${BASE} → HTTP ${r.status} in ${ms}ms`,
      r.ok ? null : 'The backend is not answering — start it before anything else');
  } catch (e) {
    add('bad', 'API', `${BASE} unreachable — ${e.message}`, 'cd backend && npx pm2 restart wfm-backend');
  }

  // ── 3. SPA build freshness ───────────────────────────────────────────
  const distIdx = path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(distIdx)) {
    add('bad', 'SPA build', 'frontend/dist/index.html is missing — the app will not load',
      'cd frontend && npm run build');
  } else {
    const built = fs.statSync(distIdx).mtime;
    const srcDir = path.join(__dirname, '..', '..', 'frontend', 'src');
    let newest = 0, newestFile = '';
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else { const m = fs.statSync(p).mtimeMs; if (m > newest) { newest = m; newestFile = path.relative(srcDir, p); } }
    } };
    walk(srcDir);
    const stale = newest > built.getTime() + 1000;
    add(stale ? 'bad' : 'ok', 'SPA build',
      stale ? `dist is OLDER than src (${newestFile} changed after the build)` : `built ${built.toLocaleString()} — newer than every source file`,
      stale ? 'cd frontend && npm run build   (then restart the backend, it serves dist)' : null);
  }

  // ── 4. database + feed freshness ─────────────────────────────────────
  try {
    const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
    await c.connect();
    const [r] = (await c.query(
      `SELECT COUNT(*)::int rows, COUNT(DISTINCT person_no)::int people,
              MIN(work_date)::text a, MAX(work_date)::text b,
              (CURRENT_DATE - MAX(work_date)::date)::int behind FROM roster_days`)).rows;
    add(r.rows > 0 ? 'ok' : 'bad', 'Database',
      `${r.rows.toLocaleString()} roster rows · ${r.people} people · ${r.a} → ${r.b}`,
      r.rows > 0 ? null : 'The roster is empty — nothing will render');
    add(r.behind > 30 ? 'warn' : 'ok', 'Roster freshness',
      `${r.behind} day(s) behind today — screens open on ${r.b}, and say so on-screen`,
      r.behind > 30 ? 'Consider uploading the latest month (Roster → Upload & Rebuild) before the demo' : null);
    const [s] = (await c.query(
      `SELECT MAX(stat_date)::text b, (CURRENT_DATE - MAX(stat_date)::date)::int behind FROM agent_daily_stats`)).rows
      .concat([{ b: null, behind: null }]);
    if (s.b) add(s.behind <= 1 ? 'ok' : 'warn', 'Live feed (Sprinklr)',
      `through ${s.b} · ${s.behind} day(s) behind`,
      s.behind > 1 ? 'Live Monitoring will look stale — open the bridge extension to refresh' : null);
    await c.end();
  } catch (e) {
    add('bad', 'Database', `cannot connect — ${e.message}`, 'Check PostgreSQL is running and backend/.env is correct');
  }

  // ── 5 + 6. demo endpoints and cross-screen agreement ─────────────────
  if (apiUp) {
    const run = (script, label, fixHint) => {
      try {
        /* Quote the script path: this repo lives under "…\WFM System\…" and an
           unquoted argument made node treat "…\WFM" as the script and the rest as
           arguments — reported as a demo failure when nothing was wrong. */
        const out = execSync(`node "${path.join(__dirname, script)}" ${BASE}`,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const m = out.match(/PASS (\d+)\s+WARN (\d+)\s+FAIL (\d+)/) || out.match(/(\d+)\/(\d+) cross-checks agree/);
        const line = (out.trim().split('\n').filter((l) => l.includes('PASS') || l.includes('agree')).pop() || '').trim();
        add('ok', label, line.replace(/\s+/g, ' ') || 'passed', null);
        void m;
      } catch (e) {
        const out = (e.stdout || '') + (e.stderr || '');
        const bad = out.split('\n').filter((l) => l.trim().startsWith('•')).map((l) => l.trim()).slice(0, 4);
        add('bad', label, bad.length ? bad.join(' | ') : 'failed', fixHint);
      }
    };
    run('smoke-demo-path.js', 'Demo endpoints', 'A demo page will error — see the failing endpoint above');
    run('cross-check-demo.js', 'Screen agreement', 'Two screens disagree on a number — fix before presenting');
  }

  // ── verdict ──────────────────────────────────────────────────────────
  console.log('');
  for (const i of items) {
    const mark = i.level === 'ok' ? `${C.ok}✓${C.off}` : i.level === 'warn' ? `${C.warn}!${C.off}` : `${C.bad}✗${C.off}`;
    console.log(` ${mark} ${C.b}${i.name.padEnd(20)}${C.off} ${i.detail}`);
    if (i.fix) console.log(`   ${C.dim}→ ${i.fix}${C.off}`);
  }
  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  console.log(`\n${'─'.repeat(72)}`);
  if (bad) console.log(` ${C.bad}${C.b}NO-GO${C.off} — ${bad} blocker(s)${warn ? `, ${warn} warning(s)` : ''}. Fix the ✗ lines above.`);
  else if (warn) console.log(` ${C.warn}${C.b}GO, with ${warn} caveat(s)${C.off} — nothing blocking; know the ! lines before you present.`);
  else console.log(` ${C.ok}${C.b}GO${C.off} — everything checked out.`);
  console.log(`${'─'.repeat(72)}\n`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('PRE-FLIGHT ERROR', e); process.exit(1); });
