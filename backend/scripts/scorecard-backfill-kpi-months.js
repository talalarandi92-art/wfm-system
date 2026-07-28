#!/usr/bin/env node
/*
 * Load the per-KPI scorecard detail for the months that only have Net Points.
 *
 * THE GAP. There are two scorecard stores and they cover different periods:
 *   · scorecard_monthly  — one row per agent-month, Net Points only. Filled in bulk
 *     by import-scorecards.js from every workbook on disk. 12 months.
 *   · scorecard_batches + scorecard_entries — the per-KPI detail (Quality, AHT, FCR,
 *     PRR, Productivity, CTR, Quiz, Mistakes, Response Time, Working Days %) plus the
 *     weekly rows. Filled only by the UI upload, one file at a time. ONE month.
 * February 2026 is the only month ever pushed through the upload screen, which is why
 * every per-KPI surface — the board, the weak-KPI coaching, the drill-downs — shows
 * February and nothing else. Nothing is broken; the months were never uploaded.
 *
 * This drives the SAME parser the upload screen uses (POST /scorecard/upload/preview
 * and /commit) over every workbook on disk, so a month loaded here is byte-identical
 * to a month the Director would have loaded by hand. It does not re-implement the
 * parsing — a second implementation would drift from the first.
 *
 * SAFETY. Preview-only by default: it reports what each workbook would yield and
 * stops. --apply commits, and skips any period that already has a batch, so
 * February is never touched or duplicated.
 *
 * Usage:  node scripts/scorecard-backfill-kpi-months.js [--apply] [--only 2026-01]
 */
const fs = require('fs'), path = require('path'), jwt = require('jsonwebtoken');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const BASE = process.env.WFM_BASE || 'http://localhost:3000';
const ROOT = 'C:/Users/t.bassam/Desktop/ALL DATA';
const FOLDERS = ['Score Card 2025', 'Score Card 2026'];
const APPLY = process.argv.includes('--apply');
const onlyIx = process.argv.indexOf('--only');
const ONLY = onlyIx > 0 ? process.argv[onlyIx + 1] : null;
/* --year narrows which FILES get previewed, not just which get committed. The preview
   endpoint is throttled to 20/hour; previewing all 13 workbooks on every run to load
   three of them burns the budget and the later files come back 429. */
const yearIx = process.argv.indexOf('--year');
const YEAR = yearIx > 0 ? Number(process.argv[yearIx + 1]) : null;

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [u] = (await c.query(
    `SELECT u.id, u.tenant_id, u.email FROM users u JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id WHERE u.status='active' AND r.code='platform_admin' LIMIT 1`)).rows;
  const token = jwt.sign({ sub: u.id, tenantId: u.tenant_id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '60m' });

  const have = new Set((await c.query(
    `SELECT period_year y, period_month m FROM scorecard_batches WHERE tenant_id=$1 AND status <> 'archived'`,
    [u.tenant_id])).rows.map(r => `${r.y}-${String(r.m).padStart(2, '0')}`));
  console.log(`already loaded: ${have.size ? [...have].sort().join(', ') : '(none)'}\n`);

  /* The FOLDER carries the year the filenames omit — "Score Card 2025/10.OCT SC..xlsx"
     says nothing about 2025 on its own, and detection would fall back to the current
     year. Pass it explicitly rather than letting the parser guess. */
  const files = [];
  for (const folder of FOLDERS) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    const year = Number((folder.match(/20\d{2}/) || [])[0]) || null;
    if (YEAR && year !== YEAR) continue;
    for (const f of fs.readdirSync(dir).filter(f => /\.xlsx$/i.test(f) && /^\d/.test(f))) {
      const mo = Number((f.match(/^(\d{1,2})\s*[.\-]/) || [])[1]) || null;
      // `month` is YYYY-MM, the platform's shape for the param everywhere else
      files.push({ file: path.join(dir, f), period: year && mo ? `${year}-${String(mo).padStart(2, '0')}` : null });
    }
  }

  const post = async (route, file, q = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null)).toString();
    const r = await fetch(`${BASE}/api/v1/scorecard/${route}${qs ? `?${qs}` : ''}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || `HTTP ${r.status}`);
    return body;
  };

  /* The preview reports the period it DETECTED, not the one in the filename. Print
     both: detectPeriod() reads the filename AND the sheet name, and May 2026 already
     proved a sheet can be named for the wrong month's content. A file landing on an
     unexpected period is the signal to stop, not a detail to skim past. */
  console.log("file                      period   sheet             agents rows   KPI  weeks seen             verdict");
  const plan = [];
  for (const { file, period } of files) {
    let p;
    try { p = await post('upload/preview', file, { month: period }); }
    catch (e) { console.log(`${path.basename(file).slice(0, 24).padEnd(26)} PARSE FAILED — ${e.message}`); continue; }

    const key = `${p.periodYear}-${String(p.periodMonth).padStart(2, '0')}`;
    const weeks = (p.weekLabels || []).slice().sort();
    /* A month only loads when its Weeks column is legible: real week rows AND a verdict
       row. Committing a sheet whose Weeks reads 0.73 would fill nine KPI columns from
       whatever sits beside them — nine wrong numbers per agent, indistinguishable from
       real ones once stored. */
    const realWeeks = weeks.filter(w => /^(w?[1-5])$/i.test(String(w)));
    const bad = p.columnsLookMisaligned ? 'columns misaligned'
      /* An unfilled sheet parses perfectly and scores everyone as a penalty — May 2026
         reads Quality 0 / AHT 0 / FCR 0 across all 335 rows and lands its 67 agents
         between -60 and 0. Half the rows with no real signal means the month is not
         ready — and it must be measured as NON-ZERO, since zeros read as "filled". */
      : p.kpiSignalRate < 0.5 ? `KPI inputs all zero (${Math.round(p.kpiSignalRate * 100)}% carry a value)`
      : !realWeeks.length ? 'verdict rows only, no weekly breakdown'
      : have.has(key) ? 'already loaded' : null;
    const skip = !!bad || (ONLY && ONLY !== key);
    console.log(`${path.basename(file).slice(0, 24).padEnd(26)}${key}  ${String(p.sheetName).slice(0, 16).padEnd(17)}` +
      `${String(p.totalEmployees).padStart(5)} ${String(p.totalEntries).padStart(5)}  ${String(Math.round(p.kpiSignalRate * 100)).padStart(4)}%  ${weeks.join(',').slice(0, 22).padEnd(22)} ` +
      `${bad ? `SKIP — ${bad}` : ONLY && ONLY !== key ? 'not selected' : APPLY ? 'WILL COMMIT' : 'would commit'}`);
    if (!skip) plan.push({ file, key, period });
  }

  if (!plan.length) { console.log('\nnothing loadable.'); await c.end(); return; }
  if (!APPLY) { console.log(`\n(preview — pass --apply to commit ${plan.length} month(s))`); await c.end(); return; }

  console.log('');
  for (const { file, key, period } of plan) {
    try {
      const r = await post('upload/commit', file, { month: period, notes: `backfill from ${path.basename(file)}` });
      console.log(`  ${key}  committed ${r.totalEntries} entries (batch ${r.batchId})`);
    } catch (e) { console.log(`  ${key}  FAILED — ${e.message}`); }
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
