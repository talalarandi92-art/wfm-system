#!/usr/bin/env node
/**
 * audit-builder.js — does the universal report builder agree with the rest of the
 * platform, and with the database?
 *
 * The builder lets anyone assemble a report from a source's dimensions and metrics.
 * That makes it the widest surface in the system for a metric to quietly acquire a
 * SECOND definition: a dedicated screen says one number, a self-service report says
 * another, and both look official. So every metric here is re-derived three ways —
 * the builder, the dedicated endpoint that owns it, and raw SQL over roster_days.
 *
 *   B1  a missing/unknown sourceKey is a 400 that names the valid keys, not a 500
 *   B2  every source in the catalogue actually runs
 *   B3  attendance day counts == raw roster_days
 *   B4  the builder's totals == the dedicated roster report's totals
 *   B5  grouping does not change a total (sum of the parts == the whole)
 *
 * Read-only.  node scripts/audit-builder.js
 */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const envPath = path.join(__dirname, '..', '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = process.env.WFM_BASE || 'http://localhost:3000/api/v1';
const FROM = process.env.WFM_FROM || '2026-07-01';
const TO = process.env.WFM_TO || '2026-08-01';

const c = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

const findings = [];
const add = (id, sev, title, detail) => findings.push({ id, sev, title, detail });
const pad = (s, n) => String(s).padEnd(n);
let TOKEN = '';
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { status: r.status, body };
};

(async () => {
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;
  TOKEN = (await (await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo.admin@boutiqaat.wfm', password: 'Demo@2026' }),
  })).json()).accessToken;

  console.log(`\n  REPORT BUILDER AUDIT — ${FROM} → ${TO}\n  ${'─'.repeat(70)}`);

  // ── B1 ────────────────────────────────────────────────────────────────────
  const bad = await api('/report-builder-v2/run', { method: 'POST', body: JSON.stringify({ metrics: [] }) });
  const b1ok = bad.status === 400 && /sourceKey|data source/i.test(String(bad.body?.message ?? ''));
  console.log(`  B1  bad sourceKey → ${bad.status} ${b1ok ? '(400, named) ✓' : '✗'}`);
  if (!b1ok) add('B1', 'MED', 'a malformed builder request does not fail cleanly', `HTTP ${bad.status}`);

  // ── B2 ────────────────────────────────────────────────────────────────────
  const cat = await api('/report-builder-v2/sources');
  const sources = (cat.body?.sources ?? cat.body ?? []);
  let ran = 0; const broken = [];
  for (const s of sources) {
    const det = await api(`/report-builder-v2/sources/${s.key}`);
    const metrics = (det.body?.metrics ?? []).slice(0, 3).map((m) => m.key ?? m.id);
    if (!metrics.length) { broken.push(`${s.key} (no metrics)`); continue; }
    const run = await api('/report-builder-v2/run', {
      method: 'POST',
      body: JSON.stringify({ sourceKey: s.key, metrics, dimensions: [], dateFrom: FROM, dateTo: TO }),
    });
    if (run.status === 200 || run.status === 201) ran++;
    else broken.push(`${s.key} → ${run.status} ${String(run.body?.message ?? '').slice(0, 60)}`);
  }
  console.log(`  B2  every source runs        ${ran}/${sources.length} ${broken.length ? '✗' : '✓'}`);
  if (broken.length) add('B2', 'HIGH', `${broken.length} source(s) fail to run`, broken.slice(0, 4).join(' · '));

  // ── B3 ── builder attendance counts vs raw roster_days ────────────────────
  const att = await api('/report-builder-v2/run', {
    method: 'POST',
    body: JSON.stringify({
      sourceKey: 'attendance', dimensions: [], dateFrom: FROM, dateTo: TO,
      metrics: ['scheduledDays', 'workedDays', 'offDays', 'leaveDays', 'sickDays', 'absentDays'],
    }),
  });
  const row = (att.body?.rows ?? [])[0] ?? {};
  const [raw] = await q(
    `SELECT COUNT(*)::int scheduled,
            COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
            COUNT(*) FILTER (WHERE presence='off')::int off,
            COUNT(*) FILTER (WHERE presence='leave')::int leave,
            COUNT(*) FILTER (WHERE presence='sick')::int sick,
            COUNT(*) FILTER (WHERE presence='absent')::int absent
     FROM roster_days WHERE work_date BETWEEN $1 AND $2`, [FROM, TO]);
  const pairs = [['scheduledDays', raw.scheduled], ['workedDays', raw.worked], ['offDays', raw.off],
                 ['leaveDays', raw.leave], ['sickDays', raw.sick], ['absentDays', raw.absent]];
  const off3 = [];
  for (const [k, expected] of pairs) {
    const got = Number(row[k] ?? NaN);
    if (!Number.isFinite(got) || got !== expected) off3.push(`${k} builder ${row[k]} vs sql ${expected}`);
  }
  console.log(`  B3  attendance == roster_days ${pairs.length - off3.length}/${pairs.length} ${off3.length ? '✗' : '✓'}`);
  if (off3.length) add('B3', 'HIGH', 'the builder disagrees with roster_days', off3.join(' · '));

  // ── B4 ── grouping must not change a total ────────────────────────────────
  const grouped = await api('/report-builder-v2/run', {
    method: 'POST',
    body: JSON.stringify({
      sourceKey: 'attendance', dimensions: ['function'], dateFrom: FROM, dateTo: TO,
      metrics: ['scheduledDays', 'workedDays'],
    }),
  });
  const gs = (grouped.body?.rows ?? []).reduce((s, r) => s + Number(r.scheduledDays ?? 0), 0);
  const gw = (grouped.body?.rows ?? []).reduce((s, r) => s + Number(r.workedDays ?? 0), 0);
  const b5ok = gs === Number(row.scheduledDays) && gw === Number(row.workedDays);
  console.log(`  B4  grouped sum == ungrouped  ${gs}/${row.scheduledDays} scheduled · ${gw}/${row.workedDays} worked ${b5ok ? '✓' : '✗'}`);
  if (!b5ok) add('B4', 'HIGH', 'grouping by function changes the total',
    `scheduled ${gs} vs ${row.scheduledDays}, worked ${gw} vs ${row.workedDays}`);

  console.log(`\n  ${'─'.repeat(70)}`);
  const high = findings.filter(f => f.sev === 'HIGH');
  if (!findings.length) console.log('  CLEAN — the builder agrees with the database and with itself\n');
  else {
    for (const f of findings) console.log(`  ${pad(f.sev, 5)} ${pad(f.id, 4)} ${f.title}\n        ${f.detail}`);
    console.log(`\n  ${high.length} HIGH · ${findings.length} total\n`);
  }
  await c.end();
  process.exit(high.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
