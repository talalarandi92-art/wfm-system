#!/usr/bin/env node
/*
 * Stream the 223MB Ameyo agent-productivity interval summary into
 * agent_productivity_daily (raw intervals NOT stored — per-agent per-day rollup).
 * Resolves agent_login → employee_no via sprinklr_agent_map. Idempotent (delete+
 * insert). Run after migration 050.
 *
 * Usage: node scripts/import-ameyo-productivity.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const FILE = 'C:/Users/t.bassam/Desktop/ALL DATA/AGENT_Productivity_Interval_Summary Inbound and Outbound Ameyo.xlsx';
const DAY = 86400;
const num = v => { if (v == null) return 0; if (typeof v === 'number') return v; if (typeof v === 'object') return v.result != null ? (Number(v.result)||0) : 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = v => { if (v == null) return ''; if (typeof v === 'object') return v.text != null ? String(v.text) : ''; return String(v); };
const isoOf = n => (Number.isFinite(n) && n > 20000 && n < 80000) ? new Date(Date.UTC(1899,11,30) + Math.round(n)*DAY*1000).toISOString().slice(0,10) : null;
// column index map (1-based row.values), built from header
let C = {};

(async () => {
  if (!fs.existsSync(FILE)) { console.error('not found', FILE); process.exit(1); }
  const daily = new Map();   // `${login}|${iso}` -> agg
  let rows = 0, skipped = 0;
  const t0 = Date.now ? null : null;   // Date.now unavailable in some harnesses; not needed
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {});
  for await (const ws of reader) {
    let r = 0;
    for await (const row of ws) {
      r++;
      if (r === 1) {
        const h = row.values.map(x => str(x).trim());
        C = {
          login: h.indexOf('User ID'), date: h.indexOf('date'),
          staffed: h.indexOf('Total Staffed Duration'), ready: h.indexOf('Total Ready Duration'),
          brk: h.indexOf('Total Break Duration'), idle: h.indexOf('Total Idle Time'),
          talk: h.indexOf('Total Talk Time in Interval'), acw: h.indexOf('Total ACW Duration in Interval'),
          inbound: h.indexOf('Inbound Received'), wrapped: h.indexOf('Total Wrapped Calls(Applicable after 2022-10-01 00:00:00.0)'),
        };
        continue;
      }
      const v = row.values;
      const login = str(v[C.login]).trim().toLowerCase();
      const iso = isoOf(num(v[C.date]));
      if (!login || !iso) { skipped++; continue; }
      const k = `${login}|${iso}`;
      let d = daily.get(k);
      if (!d) { d = { login, iso, staffed:0,ready:0,brk:0,idle:0,talk:0,acw:0,inbound:0,wrapped:0 }; daily.set(k, d); }
      d.staffed += num(v[C.staffed]) * DAY; d.ready += num(v[C.ready]) * DAY;
      d.brk += num(v[C.brk]) * DAY; d.idle += num(v[C.idle]) * DAY;
      d.talk += num(v[C.talk]) * DAY; d.acw += num(v[C.acw]) * DAY;
      d.inbound += num(v[C.inbound]); d.wrapped += num(v[C.wrapped]);
      rows++;
      if (rows % 500000 === 0) console.log(`  …${rows} intervals, ${daily.size} agent-days`);
    }
    break;
  }
  console.log(`intervals: ${rows} (skipped ${skipped}) | agent-days: ${daily.size}`);

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '050_agent_productivity_daily.sql'), 'utf8'));

  // login → employee_no via sprinklr_agent_map (email local part)
  const map = new Map();
  const mrows = (await c.query(`SELECT lower(agent_email) email, employee_id FROM sprinklr_agent_map WHERE employee_id IS NOT NULL AND agent_email IS NOT NULL`)).rows;
  const empNo = new Map((await c.query(`SELECT id, employee_no FROM employees`)).rows.map(r => [r.id, r.employee_no]));
  for (const m of mrows) { const local = m.email.split('@')[0]; if (local) map.set(local, empNo.get(m.employee_id) || null); }

  await c.query('BEGIN');
  await c.query(`DELETE FROM agent_productivity_daily WHERE tenant_id=$1 AND source='ameyo'`, [tenantId]);
  let ins = 0, matched = 0;
  const vals = [...daily.values()];
  for (let i = 0; i < vals.length; i += 1000) {
    const chunk = vals.slice(i, i + 1000);
    const ph = []; const args = [tenantId];
    chunk.forEach((d, j) => {
      const no = map.get(d.login) || null; if (no) matched++;
      const b = j * 11;
      ph.push(`($1,$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`);
      args.push(d.iso, d.login, no, Math.round(d.staffed), Math.round(d.ready), Math.round(d.brk), Math.round(d.idle), Math.round(d.talk), Math.round(d.acw), Math.round(d.inbound), Math.round(d.wrapped));
    });
    await c.query(
      `INSERT INTO agent_productivity_daily (tenant_id, work_date, agent_login, employee_no, staffed_seconds, ready_seconds, break_seconds, idle_seconds, talk_seconds, acw_seconds, inbound_received, wrapped_calls) VALUES ${ph.join(',')}`,
      args);
    ins += chunk.length;
  }
  await c.query('COMMIT');
  console.log(`inserted ${ins} agent-days | matched to employee: ${matched} (${(100*matched/ins).toFixed(0)}%)`);

  const dates = [...daily.values()].reduce((a,d)=>({a:d.iso<a.a?d.iso:a.a,b:d.iso>a.b?d.iso:a.b}),{a:'9999',b:'0000'});
  const tot = [...daily.values()].reduce((a,d)=>({talk:a.talk+d.talk,acw:a.acw+d.acw,staffed:a.staffed+d.staffed,brk:a.brk+d.brk,calls:a.calls+d.wrapped}),{talk:0,acw:0,staffed:0,brk:0,calls:0});
  console.log(`range ${dates.a}…${dates.b} | AHT ${((tot.talk+tot.acw)/(tot.calls||1)).toFixed(0)}s | occupancy ${(100*(tot.talk+tot.acw)/(tot.staffed||1)).toFixed(1)}% | break-share ${(100*tot.brk/(tot.staffed||1)).toFixed(1)}%`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
