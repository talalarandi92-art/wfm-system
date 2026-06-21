#!/usr/bin/env node
/*
 * Ingest per-agent monthly Net Points from the real monthly Score Card workbooks
 * (Score Card 2025/2026) into scorecard_monthly. Detects the agent-results sheet
 * by its header (Agent/ID + Net Points + Weeks), collects weekly nets per agent,
 * stores a transparent monthly average. The precise per-KPI scoring stays in the
 * scorecard module. Idempotent (upsert per year/month/employee). Run after mig 052.
 *
 * Usage: node scripts/import-scorecards.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const ROOT = 'C:/Users/t.bassam/Desktop/ALL DATA';
const FOLDERS = [['Score Card 2025', 2025], ['Score Card 2026', 2026]];
const cv = x => { if (x == null) return ''; if (typeof x === 'object') return x.text != null ? x.text : (x.result != null ? x.result : ''); return x; };
const numOrNull = x => { const v = cv(x); if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const monthFromName = f => { const m = f.match(/^(\d{1,2})\s*[.\-]/); return m ? +m[1] : null; };

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '052_scorecard_monthly.sql'), 'utf8'));

  let totalAgents = 0; const summary = [];
  for (const [folder, year] of FOLDERS) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => /\.xlsx$/i.test(f) && /^\d/.test(f))) {
      const month = monthFromName(file);
      if (!month) continue;
      let wb; try { wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(dir, file)); }
      catch (e) { console.log('  skip', file, e.message); continue; }

      // find the agent-results sheet: header has Net Points + Weeks + (Agent|ID)
      let ws = null, H = null;
      for (const s of wb.worksheets) {
        if (!s.rowCount) continue;
        const h = s.getRow(1).values.map(x => String(cv(x)).trim());
        if (h.includes('Net Points') && h.includes('Weeks') && (h.includes('Agent') || h.includes('ID'))) { ws = s; H = h; break; }
      }
      if (!ws) { console.log(`  ${file}: no agent-results sheet`); continue; }

      const cAgent = H.indexOf('Agent') >= 0 ? H.indexOf('Agent') : H.indexOf('Name');
      const cId = H.indexOf('ID'), cNet = H.indexOf('Net Points'), cFn = H.indexOf('Function'), cTl = H.indexOf('TL') >= 0 ? H.indexOf('TL') : H.indexOf('Team Manager');

      const perAgent = new Map();   // id -> {name,fn,tl,nets[]}
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const idRaw = cv(row.getCell(cId).value);
        if (idRaw === '' || idRaw == null) continue;
        const id = String(Math.round(Number(idRaw)) || idRaw).trim();
        if (!/^\d{3,6}$/.test(id)) continue;
        const net = numOrNull(row.getCell(cNet).value);
        let a = perAgent.get(id);
        if (!a) { a = { name: String(cv(row.getCell(cAgent).value)).trim(), fn: cFn >= 0 ? String(cv(row.getCell(cFn).value)).trim() : null, tl: cTl >= 0 ? String(cv(row.getCell(cTl).value)).trim() : null, nets: [] }; perAgent.set(id, a); }
        if (net != null) a.nets.push(Math.round(net * 10) / 10);
      }

      let n = 0;
      for (const [id, a] of perAgent) {
        const scored = a.nets.filter(v => v != null);
        if (!scored.length) continue;
        const avg = Math.round((scored.reduce((s, v) => s + v, 0) / scored.length) * 10) / 10;
        await c.query(
          `INSERT INTO scorecard_monthly (tenant_id, year, month, employee_no, name, function_name, team_manager, weekly_nets, weeks_scored, avg_net_points, best_net, worst_net, source_file)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (tenant_id, year, month, employee_no)
           DO UPDATE SET name=EXCLUDED.name, function_name=EXCLUDED.function_name, team_manager=EXCLUDED.team_manager,
                         weekly_nets=EXCLUDED.weekly_nets, weeks_scored=EXCLUDED.weeks_scored, avg_net_points=EXCLUDED.avg_net_points,
                         best_net=EXCLUDED.best_net, worst_net=EXCLUDED.worst_net, source_file=EXCLUDED.source_file`,
          [tenantId, year, month, id, a.name, a.fn || null, a.tl || null, scored, scored.length, avg, Math.max(...scored), Math.min(...scored), file]);
        n++;
      }
      summary.push({ file, year, month, agents: n });
      totalAgents += n;
    }
  }
  console.log(`scorecard_monthly: ${totalAgents} agent-months across ${summary.length} files`);
  console.table(summary);
  const trend = (await c.query(
    `SELECT year, month, COUNT(*)::int agents, ROUND(AVG(avg_net_points),1) avg_net
       FROM scorecard_monthly WHERE tenant_id=$1 GROUP BY year, month ORDER BY year, month`, [tenantId])).rows;
  console.table(trend);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
