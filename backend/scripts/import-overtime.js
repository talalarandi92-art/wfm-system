#!/usr/bin/env node
/*
 * Ingest the real Overtime workbooks (Desktop/ALL DATA/Overtime 20xx) into two
 * aggregates (raw rows NOT stored):
 *   peak_events  — one row per OT event sheet: name, date range, headcount, OT hours.
 *   ot_monthly   — approved OT hours per employee per month (consolidated yearly files).
 * Idempotent (upserts by natural key). Run after migration 047.
 *
 * Usage: node scripts/import-overtime.js
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
const FOLDERS = ['Overtime 2024', 'Overtime 2025', 'Overtime 2026'].map(d => path.join(ROOT, d));
const CONSOLIDATED = { 'Overtime 2024 CC..xlsx': 2024, 'Overtime 25..xlsx': 2025 };
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };

const txt = c => { const v = c && c.value; if (v == null) return ''; if (typeof v === 'object') return v.text != null ? String(v.text) : (Array.isArray(v.richText) ? v.richText.map(t=>t.text).join('') : ''); return String(v); };
const num = c => { const v = c && c.value; if (v == null) return null; if (typeof v === 'number') return v; if (typeof v === 'object' && v.result != null && typeof v.result === 'number') return v.result; const n = Number(v); return Number.isFinite(n) ? n : null; };
const serialToDate = n => (Number.isFinite(n) && n > 20000 && n < 80000) ? new Date(Date.UTC(1899,11,30) + Math.round(n)*86400000).toISOString().slice(0,10) : null;
const cellDate = c => { const v = c && c.value; if (v instanceof Date) return v.toISOString().slice(0,10); const n = num(c); return serialToDate(n); };
const cellHours = c => { const v = c && c.value; if (v instanceof Date) return ((v.getTime()-Date.UTC(1899,11,30))/86400000)*24; const n = num(c); return n; };
const norm = s => String(s||'').toLowerCase().replace(/[^a-z]/g,'');

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '047_overtime_peak_events.sql'), 'utf8'));

  // name → employee_no map for best-effort matching
  const emps = (await c.query(`SELECT employee_no, first_name_en, last_name_en FROM employees`)).rows;
  const nameMap = new Map();
  for (const e of emps) { const k = norm(`${e.first_name_en} ${e.last_name_en||''}`); if (!nameMap.has(k)) nameMap.set(k, e.employee_no); }
  const resolveNo = (name) => nameMap.get(norm(name)) || null;

  let peakN = 0, otN = 0;

  // ── 1. PEAK EVENTS — every non-WFH sheet across the event files ──────────────
  for (const folder of FOLDERS) {
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.xlsx') && !CONSOLIDATED[f])) {
      const full = path.join(folder, file);
      let wb;
      try { wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(full); }
      catch (e) { console.log('  skip (read err):', file, e.message); continue; }
      for (const ws of wb.worksheets) {
        if (/wfh/i.test(ws.name)) continue;
        // locate header row by the Empl. ID label
        let hdr = 0, idCol = 0, totCol = 0, title = '';
        for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
          const row = ws.getRow(r);
          let foundId = 0, foundTot = 0;
          for (let cc = 1; cc <= ws.columnCount; cc++) {
            const t = txt(row.getCell(cc)).trim().toLowerCase();
            if (t === 'empl. id' || t === 'employee id' || t === 'empl id') foundId = cc;
            if (t === 'total hours') foundTot = cc;
          }
          if (foundId) { hdr = r; idCol = foundId; totCol = foundTot; break; }
        }
        // event title from an "Overtime ..." / "Overtime Month-" line above the header
        for (let r = 1; r <= (hdr || 4); r++) { const t = txt(ws.getRow(r).getCell(1)).trim(); if (/overtime/i.test(t)) { title = t; break; } }
        if (!hdr) continue;
        // day columns = columns in the row below the header that hold a real date
        const dateRow = ws.getRow(hdr + 1);
        const dayCols = [];
        for (let cc = idCol + 1; cc <= ws.columnCount; cc++) if (cellDate(dateRow.getCell(cc))) dayCols.push(cc);
        const dates = dayCols.map(cc => cellDate(dateRow.getCell(cc))).filter(Boolean).sort();
        const ids = new Set(); let hours = 0;
        for (let r = hdr + 2; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const id = num(row.getCell(idCol));
          if (id == null || id < 1000) continue;          // employee IDs are 4-5 digits
          ids.add(String(Math.round(id)));
          if (totCol) { const h = cellHours(row.getCell(totCol)); if (Number.isFinite(h)) hours += h; }
          else for (const cc of dayCols) { const h = num(row.getCell(cc)); if (Number.isFinite(h) && h > 0) hours += h; }
        }
        if (!ids.size && !dates.length) continue;
        let name = title.replace(/^overtime\s*(month-)?\s*[-–]?\s*/i, '').replace(/contact center\.?$/i, '').replace(/\.+$/,'').trim();
        if (!name) name = `${file.replace(/\.+xlsx$/i,'')} — ${ws.name}`;
        name = `${name} (${ws.name})`.slice(0, 160);
        const start = dates[0] || null, end = dates[dates.length-1] || null;
        const year = start ? +start.slice(0,4) : +(file.match(/20\d\d/)?.[0] || folder.match(/20\d\d/)?.[0]);
        await c.query(
          `INSERT INTO peak_events (tenant_id, event_name, year, start_date, end_date, headcount, ot_hours, source_file)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, event_name, start_date)
           DO UPDATE SET end_date=EXCLUDED.end_date, headcount=EXCLUDED.headcount, ot_hours=EXCLUDED.ot_hours, source_file=EXCLUDED.source_file, year=EXCLUDED.year`,
          [tenantId, name, year, start, end, ids.size, Math.round(hours*100)/100, file]);
        peakN++;
      }
    }
  }

  // ── 2. OT MONTHLY — consolidated yearly files ───────────────────────────────
  for (const [fname, year] of Object.entries(CONSOLIDATED)) {
    const full = FOLDERS.map(f => path.join(f, fname)).find(fs.existsSync);
    if (!full) { console.log('  consolidated not found:', fname); continue; }
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(full);
    const ws = wb.worksheets[0];
    const hrow = ws.getRow(1);
    let nameCol = 0, idCol = 0; const monthCols = [];
    for (let cc = 1; cc <= ws.columnCount; cc++) {
      const t = txt(hrow.getCell(cc)).trim().toLowerCase();
      if (t === 'name') nameCol = cc;
      else if (t === 'id') idCol = cc;
      else if (MONTHS[t]) monthCols.push([cc, MONTHS[t]]);
    }
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = txt(row.getCell(nameCol)).trim();
      if (!name) continue;
      const no = idCol ? (num(row.getCell(idCol)) != null ? String(Math.round(num(row.getCell(idCol)))) : null) : resolveNo(name);
      for (const [cc, mo] of monthCols) {
        const h = cellHours(row.getCell(cc));
        if (!Number.isFinite(h) || h <= 0) continue;
        await c.query(
          `INSERT INTO ot_monthly (tenant_id, employee_no, name, year, month, ot_hours, source)
           VALUES ($1,$2,$3,$4,$5,$6,'consolidated')
           ON CONFLICT (tenant_id, year, month, name)
           DO UPDATE SET employee_no=COALESCE(EXCLUDED.employee_no, ot_monthly.employee_no), ot_hours=EXCLUDED.ot_hours`,
          [tenantId, no, name, year, mo, Math.round(h*100)/100]);
        otN++;
      }
    }
  }

  const pe = (await c.query(`SELECT year, COUNT(*) n, SUM(headcount) hc, ROUND(SUM(ot_hours)) oth FROM peak_events WHERE tenant_id=$1 GROUP BY year ORDER BY year`, [tenantId])).rows;
  const om = (await c.query(`SELECT year, COUNT(DISTINCT name) emp, ROUND(SUM(ot_hours)) oth, COUNT(*) FILTER (WHERE employee_no IS NULL) noid FROM ot_monthly WHERE tenant_id=$1 GROUP BY year ORDER BY year`, [tenantId])).rows;
  console.log(`peak_events upserted: ${peakN}`); console.table(pe);
  console.log(`ot_monthly rows upserted: ${otN}`); console.table(om);
  await c.end();
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
