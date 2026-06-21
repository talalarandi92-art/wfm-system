#!/usr/bin/env node
/*
 * Import Sprinklr survey "Were we able to resolve your issue today?" → survey_fcr_monthly.
 * Monthly FCR per agent + channel. Answers Yes/No AND Arabic نعم/لا. employee_id
 * resolved via sprinklr_agent_map (authoritative) then an UNAMBIGUOUS email-pattern
 * heuristic; left NULL otherwise (never guessed). Idempotent upsert.
 *
 * Usage: node scripts/import-sprinklr-survey.js "<path to Feedback survey ...xlsx>"
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const FILE = process.argv[2];
const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };

function monthToDate(s) {
  const m = String(s || '').trim().match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()]; if (!mm) return null;
  return `${m[2]}-${String(mm).padStart(2,'0')}-01`;
}
function normChannel(c) {
  const s = String(c || '').toLowerCase();
  if (s.includes('whatsapp')) return 'whatsapp';
  if (s.includes('instagram')) return 'instagram';
  if (s.includes('facebook')) return 'facebook';
  if (s === 'x' || s.includes('twitter')) return 'x';
  if (s.includes('mail')) return 'email';
  return s || null;
}
const isYes = (a) => { const s = String(a||'').trim().toLowerCase(); return s === 'yes' || s === 'نعم'; };
const isNo  = (a) => { const s = String(a||'').trim().toLowerCase(); return s === 'no'  || s === 'لا'; };

(async () => {
  if (!FILE || !fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '045_survey_fcr_monthly.sql'), 'utf8'));

  // mapping sources
  const mapRows = (await c.query(`SELECT LOWER(agent_email) em, employee_id, agent_name FROM sprinklr_agent_map WHERE tenant_id=$1 AND employee_id IS NOT NULL`, [tenantId])).rows;
  const byEmail = new Map(mapRows.map(r => [r.em, { id: r.employee_id, name: r.agent_name }]));
  const emps = (await c.query(`SELECT id, LOWER(first_name_en) fn, LOWER(last_name_en) ln FROM employees WHERE tenant_id=$1 AND first_name_en IS NOT NULL`, [tenantId])).rows;
  function heuristic(email) {
    const parts = email.split('@')[0].split(/[._]/); if (parts.length < 2) return null;
    const init = parts[0][0], last = parts.slice(1).join('');
    const cand = emps.filter(e => e.fn && e.fn[0] === init && e.ln && e.ln.replace(/\s/g, '') === last);
    return cand.length === 1 ? cand[0].id : null;   // only unambiguous
  }

  // aggregate per (email, channel, month)
  const agg = new Map();
  for (let r = 4; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values;
    const ym = monthToDate(v[1]); const email = v[2] ? String(v[2]).trim().toLowerCase() : null;
    const channel = normChannel(v[3]); const ans = v[4]; const cnt = parseInt(v[5], 10) || 0;
    if (!ym || !email || !channel) continue;
    const key = `${email}|${channel}|${ym}`;
    if (!agg.has(key)) agg.set(key, { email, channel, ym, yes: 0, no: 0 });
    const a = agg.get(key);
    if (isYes(ans)) a.yes += cnt; else if (isNo(ans)) a.no += cnt;
  }

  let upserts = 0, mappedMap = 0, mappedHeur = 0, unmapped = 0;
  const unmappedEmails = new Set();
  for (const a of agg.values()) {
    let empId = null;
    if (byEmail.has(a.email)) { empId = byEmail.get(a.email).id; mappedMap++; }
    else { const h = heuristic(a.email); if (h) { empId = h; mappedHeur++; } else { unmapped++; unmappedEmails.add(a.email); } }
    const total = a.yes + a.no;
    const fcr = total ? Math.round((a.yes / total) * 1000) / 10 : null;
    await c.query(
      `INSERT INTO survey_fcr_monthly (tenant_id, employee_id, agent_email, channel, year_month, resolved_yes, resolved_no, total, fcr_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, agent_email, channel, year_month)
       DO UPDATE SET employee_id=EXCLUDED.employee_id, resolved_yes=EXCLUDED.resolved_yes, resolved_no=EXCLUDED.resolved_no,
                     total=EXCLUDED.total, fcr_pct=EXCLUDED.fcr_pct, updated_at=now()`,
      [tenantId, empId, a.email, a.channel, a.ym, a.yes, a.no, total, fcr]);
    upserts++;
  }
  console.log(`Upserted ${upserts} monthly survey rows.`);
  console.log(`Mapped via sprinklr_agent_map: ${mappedMap} · via unambiguous heuristic: ${mappedHeur} · unmapped: ${unmapped} (distinct emails: ${unmappedEmails.size}).`);

  const overall = (await c.query(`SELECT SUM(resolved_yes) y, SUM(total) t FROM survey_fcr_monthly WHERE tenant_id=$1`, [tenantId])).rows[0];
  console.log(`Overall FCR: ${overall.t ? (100 * overall.y / overall.t).toFixed(1) : '—'}% (${overall.y}/${overall.t})`);
  const byCh = (await c.query(`SELECT channel, SUM(resolved_yes) y, SUM(total) t FROM survey_fcr_monthly WHERE tenant_id=$1 GROUP BY channel ORDER BY t DESC`, [tenantId])).rows;
  console.log('By channel FCR:', byCh.map(x => `${x.channel}:${x.t?Math.round(100*x.y/x.t):0}%`).join(', '));
  if (unmappedEmails.size) console.log('Unmapped emails (need manual map):', [...unmappedEmails].slice(0, 20).join(', '));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
