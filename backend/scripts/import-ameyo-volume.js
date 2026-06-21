#!/usr/bin/env node
/*
 * Stream the Ameyo ACD interval summary (voice) into contact_volume_daily +
 * contact_volume_profile. Raw intervals NOT stored — only daily roll-ups and an
 * average half-hour profile. Idempotent (deletes the channel rows first).
 *
 * Usage: node scripts/import-ameyo-volume.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const FILE = 'C:/Users/t.bassam/Desktop/ALL DATA/ACD_Call_Interval_Summary Ameyo.xlsx';
const CHANNEL = 'voice';
const num = v => { if (v == null) return 0; if (typeof v === 'number') return v; if (typeof v === 'object') { if (v.result != null) return Number(v.result) || 0; return 0; } const n = Number(v); return Number.isFinite(n) ? n : 0; };
const serialToISO = n => (Number.isFinite(n) && n > 20000 && n < 80000) ? new Date(Date.UTC(1899,11,30) + Math.round(n)*86400000).toISOString().slice(0,10) : null;

(async () => {
  if (!fs.existsSync(FILE)) { console.error('not found', FILE); process.exit(1); }
  const daily = new Map();    // iso -> {offered,handled,abandoned,inTarget,talk}
  const profile = new Map();  // idx -> offered
  let rows = 0, skipped = 0;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {});
  for await (const ws of reader) {
    let r = 0;
    for await (const row of ws) {
      r++; if (r === 1) continue;
      const v = row.values;                       // 1-indexed
      const iso = serialToISO(num(v[1]));
      if (!iso) { skipped++; continue; }
      const timeFrac = num(v[2]);                  // fraction of day
      const idx = Math.max(0, Math.min(47, Math.round(timeFrac * 48)));
      const offered = num(v[5]), handled = num(v[6]), abandoned = num(v[7]), inTarget = num(v[8]);
      const talkSec = Math.round(num(v[21]) * 86400);
      let d = daily.get(iso); if (!d) { d = { offered:0,handled:0,abandoned:0,inTarget:0,talk:0 }; daily.set(iso, d); }
      d.offered += offered; d.handled += handled; d.abandoned += abandoned; d.inTarget += inTarget; d.talk += talkSec;
      profile.set(idx, (profile.get(idx) || 0) + offered);
      rows++;
    }
    break;
  }

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '049_contact_volume_daily.sql'), 'utf8'));

  await c.query('BEGIN');
  await c.query(`DELETE FROM contact_volume_daily WHERE tenant_id=$1 AND channel=$2`, [tenantId, CHANNEL]);
  await c.query(`DELETE FROM contact_volume_profile WHERE tenant_id=$1 AND channel=$2`, [tenantId, CHANNEL]);
  for (const [iso, d] of daily) await c.query(
    `INSERT INTO contact_volume_daily (tenant_id, vol_date, channel, offered, handled, abandoned, in_target, talk_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenantId, iso, CHANNEL, d.offered, d.handled, d.abandoned, d.inTarget, d.talk]);
  for (const [idx, off] of profile) await c.query(
    `INSERT INTO contact_volume_profile (tenant_id, channel, interval_idx, offered) VALUES ($1,$2,$3,$4)`,
    [tenantId, CHANNEL, idx, off]);
  await c.query('COMMIT');

  const tot = [...daily.values()].reduce((a,d)=>({o:a.o+d.offered,h:a.h+d.handled,ab:a.ab+d.abandoned,t:a.t+d.talk}),{o:0,h:0,ab:0,t:0});
  const dates = [...daily.keys()].sort();
  console.log(`intervals: ${rows} (skipped ${skipped}) | days: ${daily.size} (${dates[0]} … ${dates[dates.length-1]})`);
  console.log(`voice offered: ${tot.o} | handled: ${tot.h} | abandoned: ${tot.ab} (${(100*tot.ab/(tot.o||1)).toFixed(1)}%) | AHT: ${(tot.t/(tot.h||1)).toFixed(0)}s`);
  // peak intraday interval
  const peak = [...profile.entries()].sort((a,b)=>b[1]-a[1])[0];
  console.log(`peak half-hour: idx ${peak[0]} (${String(Math.floor(peak[0]/2)).padStart(2,'0')}:${peak[0]%2?'30':'00'}) offered ${peak[1]}`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
