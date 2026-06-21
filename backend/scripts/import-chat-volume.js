#!/usr/bin/env node
/*
 * Add chat / WhatsApp / social / email contact volume to contact_volume_daily +
 * contact_volume_profile from two detail exports (streamed, raw rows NOT stored):
 *   CHAT_Detail_Report Ameyo.xlsx        → channel 'chat'   (Ameyo live chat)
 *   LiveChatPerformance AND SM.xlsx       → channel per "Channel Type (Case)"
 * Completes the multi-channel volume so CPO covers all channels. Idempotent:
 * deletes the channels it owns first. Run after migration 049.
 *
 * Usage: node scripts/import-chat-volume.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const DIR = 'C:/Users/t.bassam/Desktop/ALL DATA';
const OWNED = ['chat', 'whatsapp', 'social', 'email'];
const num = v => { if (v == null) return 0; if (typeof v === 'number') return v; if (typeof v === 'object') return v.result != null ? (Number(v.result)||0) : 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = v => { if (v == null) return ''; if (typeof v === 'object') return v.text != null ? String(v.text) : (Array.isArray(v.richText)?v.richText.map(t=>t.text).join(''):''); return String(v); };
const isoOf = n => (Number.isFinite(n) && n > 20000 && n < 80000) ? new Date(Date.UTC(1899,11,30) + Math.round(n)*86400000).toISOString().slice(0,10) : null;
const idxOf = frac => Math.max(0, Math.min(47, Math.round((frac - Math.floor(frac)) * 48)));
const mapChannel = t => { t = t.toLowerCase(); if (/whatsapp/.test(t)) return 'whatsapp'; if (/email|mail/.test(t)) return 'email'; if (/facebook|instagram|twitter|^x$|social|insta|messenger|tiktok|snap|youtube|telegram/.test(t)) return 'social'; if (/chat|live/.test(t)) return 'chat'; return null; };

const daily = new Map();   // `${ch}|${iso}` -> {offered,handled,abandoned,talk}
const profile = new Map(); // `${ch}|${idx}` -> offered
const unknown = new Map();
const add = (ch, iso, idx, off, hand, ab, talk) => {
  const k = `${ch}|${iso}`; let d = daily.get(k); if (!d) { d = { ch, iso, offered:0,handled:0,abandoned:0,talk:0 }; daily.set(k, d); }
  d.offered += off; d.handled += hand; d.abandoned += ab; d.talk += talk;
  const pk = `${ch}|${idx}`; profile.set(pk, (profile.get(pk) || 0) + off);
};

(async () => {
  // ── CHAT_Detail (Ameyo live chat) ──
  let rows = 0;
  let reader = new ExcelJS.stream.xlsx.WorkbookReader(path.join(DIR, 'CHAT_Detail_Report Ameyo.xlsx'), {});
  for await (const ws of reader) {
    let r = 0;
    for await (const row of ws) {
      r++; if (r === 1) continue;
      const v = row.values;
      const iso = isoOf(num(v[2]));            // Chat DATE
      if (!iso) continue;
      const frac = num(v[3]);                  // Chat Time
      const status = str(v[4]).toLowerCase();
      const missed = /miss|abandon/.test(status);
      const talk = Math.round(num(v[7]) * 86400);  // Total Chat Duration
      add('chat', iso, idxOf(frac), 1, missed ? 0 : 1, missed ? 1 : 0, talk);
      rows++;
    }
    break;
  }
  console.log(`CHAT_Detail rows: ${rows}`);

  // ── LiveChatPerformance AND SM (Sprinklr; channel per row) ──
  let rows2 = 0;
  reader = new ExcelJS.stream.xlsx.WorkbookReader(path.join(DIR, 'LiveChatPerformance AND SM.xlsx'), {});
  for await (const ws of reader) {
    let r = 0, head = [];
    for await (const row of ws) {
      r++;
      if (r === 1) { head = row.values.map(x => str(x).trim()); continue; }
      const v = row.values;
      const ccCol = head.indexOf('Case Creation Time');
      const chCol = head.indexOf('Channel Type (Case)');
      const asgCol = head.indexOf('Contacts Assigned (SUM)');
      const hndCol = head.indexOf('Contacts Handled (SUM)');
      const htCol  = head.indexOf('Handle Time (Assigned Duration) (AVG)');
      const serial = num(v[ccCol]); const iso = isoOf(serial);
      if (!iso) continue;
      const rawCh = str(v[chCol]).trim();
      const ch = mapChannel(rawCh);
      if (!ch) { unknown.set(rawCh, (unknown.get(rawCh)||0)+1); continue; }
      const off = num(v[asgCol]) || 1, hand = num(v[hndCol]);
      const talk = Math.round(num(v[htCol]) * 86400 * (hand || 1));
      add(ch, iso, idxOf(serial), off, hand, Math.max(0, off - hand), talk);
      rows2++;
    }
    break;
  }
  console.log(`LiveChat/SM rows: ${rows2}`);
  if (unknown.size) console.log('  unmapped channel types:', JSON.stringify([...unknown.entries()]));

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query('BEGIN');
  await c.query(`DELETE FROM contact_volume_daily WHERE tenant_id=$1 AND channel = ANY($2)`, [tenantId, OWNED]);
  await c.query(`DELETE FROM contact_volume_profile WHERE tenant_id=$1 AND channel = ANY($2)`, [tenantId, OWNED]);
  for (const d of daily.values()) await c.query(
    `INSERT INTO contact_volume_daily (tenant_id, vol_date, channel, offered, handled, abandoned, in_target, talk_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
    [tenantId, d.iso, d.ch, d.offered, d.handled, d.abandoned, d.talk]);
  for (const [k, off] of profile) { const [ch, idx] = k.split('|'); await c.query(
    `INSERT INTO contact_volume_profile (tenant_id, channel, interval_idx, offered) VALUES ($1,$2,$3,$4)`,
    [tenantId, ch, +idx, off]); }
  await c.query('COMMIT');

  const byCh = {};
  for (const d of daily.values()) { const a = byCh[d.ch] ||= { offered:0,handled:0,abandoned:0,talk:0,days:new Set() }; a.offered+=d.offered; a.handled+=d.handled; a.abandoned+=d.abandoned; a.talk+=d.talk; a.days.add(d.iso); }
  for (const [ch, a] of Object.entries(byCh))
    console.log(`  ${ch}: offered ${a.offered} | handled ${a.handled} | abandoned ${a.abandoned} | AHT ${(a.talk/(a.handled||1)).toFixed(0)}s | days ${a.days.size}`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
