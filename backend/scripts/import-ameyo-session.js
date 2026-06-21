#!/usr/bin/env node
/*
 * Stream the Ameyo agent session details (login/logout + AUX/break states) into
 * shrinkage_aux_daily (raw sessions NOT stored — per date+reason seconds/count).
 * NB the source export is capped at Excel's ~1,048,575-row limit (slightly
 * truncated). Idempotent (delete+insert). Run after migration 051.
 *
 * Usage: node scripts/import-ameyo-session.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const FILE = 'C:/Users/t.bassam/Desktop/ALL DATA/AGENT_Session_Details System login loout and Status AUX Ameyo.xlsx';
const DAY = 86400;
const num = v => { if (v == null) return 0; if (typeof v === 'number') return v; if (typeof v === 'object') return v.result != null ? (Number(v.result)||0) : 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = v => { if (v == null) return ''; if (typeof v === 'object') return v.text != null ? String(v.text) : ''; return String(v); };
const isoOf = n => (Number.isFinite(n) && n > 20000 && n < 80000) ? new Date(Date.UTC(1899,11,30) + Math.round(Math.floor(n))*DAY*1000).toISOString().slice(0,10) : null;

(async () => {
  if (!fs.existsSync(FILE)) { console.error('not found', FILE); process.exit(1); }
  const agg = new Map();   // `${iso}|${reason}` -> {iso,reason,sec,n}
  let rows = 0, skipped = 0, C = {};
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {});
  for await (const ws of reader) {
    let r = 0;
    for await (const row of ws) {
      r++;
      if (r === 1) { const h = row.values.map(x => str(x).trim());
        C = { login: h.indexOf('Login Time'), reason: h.indexOf('Break Reason'), brk: h.indexOf('Break Duration') };
        continue; }
      const v = row.values;
      const iso = isoOf(num(v[C.login]));
      if (!iso) { skipped++; continue; }
      const reason = str(v[C.reason]).trim() || 'Idle/Ready (no break)';
      const sec = Math.round(num(v[C.brk]) * DAY);
      if (sec <= 0 && reason === 'Idle/Ready (no break)') { rows++; continue; }   // skip empty no-break rows
      const k = `${iso}|${reason}`;
      let a = agg.get(k); if (!a) { a = { iso, reason, sec: 0, n: 0 }; agg.set(k, a); }
      a.sec += sec; a.n += 1; rows++;
    }
    break;
  }
  console.log(`rows: ${rows} (skipped ${skipped}) | date×reason buckets: ${agg.size}`);

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '051_shrinkage_aux_daily.sql'), 'utf8'));

  await c.query('BEGIN');
  await c.query(`DELETE FROM shrinkage_aux_daily WHERE tenant_id=$1 AND source='ameyo'`, [tenantId]);
  const vals = [...agg.values()];
  for (let i = 0; i < vals.length; i += 1000) {
    const chunk = vals.slice(i, i + 1000);
    const ph = []; const args = [tenantId];
    chunk.forEach((a, j) => { const b = j * 4; ph.push(`($1,$${b+2},$${b+3},$${b+4},$${b+5})`); args.push(a.iso, a.reason, a.sec, a.n); });
    await c.query(`INSERT INTO shrinkage_aux_daily (tenant_id, aux_date, reason, seconds, sessions) VALUES ${ph.join(',')}`, args);
  }
  await c.query('COMMIT');

  const byReason = (await c.query(
    `SELECT reason, ROUND(SUM(seconds)/3600.0)::int hours, SUM(sessions)::int sessions
       FROM shrinkage_aux_daily WHERE tenant_id=$1 GROUP BY reason ORDER BY SUM(seconds) DESC LIMIT 12`, [tenantId])).rows;
  console.log(`inserted ${vals.length} buckets. Top reasons (hours):`);
  console.table(byReason);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
