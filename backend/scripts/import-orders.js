#!/usr/bin/env node
/*
 * Ingest the real orders export into order_aggregates (dimensional bucket counts
 * for a labelled window — raw orders NOT stored). Order mix, returns/refunds,
 * country and customer-tier distributions. Idempotent. Run after migration 048.
 *
 * Usage: node scripts/import-orders.js "<orders xlsx>" "<period label>"
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const FILE = process.argv[2] || 'C:/Users/t.bassam/Desktop/ALL DATA/orders 1 to 14 June.xlsx';
const PERIOD = process.argv[3] || '2026-06 (1-14)';
// header name → dimension key
const DIMS = {
  OrderStatus: 'status', OrderType: 'type', OrderCategory: 'category',
  ReturnType: 'return', Country: 'country', CustomerType: 'customer_type', PaymentMethodCode: 'payment',
};
const txt = c => { const v = c && c.value; if (v == null) return ''; if (typeof v === 'object') return v.text != null ? String(v.text) : (Array.isArray(v.richText) ? v.richText.map(t=>t.text).join('') : ''); return String(v); };

(async () => {
  if (!fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];
  const header = ws.getRow(1).values.slice(1).map(x => String(x && x.text ? x.text : (x ?? '')).trim());
  const colOf = name => header.indexOf(name) + 1;
  const cols = Object.fromEntries(Object.entries(DIMS).map(([h, d]) => [d, colOf(h)]));

  const counts = {};               // dim -> bucket -> n
  for (const d of Object.values(DIMS)) counts[d] = {};
  let total = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!txt(row.getCell(colOf('OrderStatus'))).trim()) continue;
    total++;
    for (const [d, ci] of Object.entries(cols)) {
      if (ci <= 0) continue;
      let b = txt(row.getCell(ci)).trim();
      // normalise tier casing (NEW/New, GOLD/Gold)
      if (d === 'customer_type') b = b.toUpperCase();
      if (d === 'return' && !b) b = 'NONE';
      if (!b) b = '(blank)';
      counts[d][b] = (counts[d][b] || 0) + 1;
    }
  }

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '048_order_aggregates.sql'), 'utf8'));

  await c.query('BEGIN');
  await c.query(`DELETE FROM order_aggregates WHERE tenant_id=$1 AND period_label=$2`, [tenantId, PERIOD]);
  const ins = (dim, bucket, n) => c.query(
    `INSERT INTO order_aggregates (tenant_id, period_label, dimension, bucket, count) VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, PERIOD, dim, bucket, n]);
  await ins('_total', '_all', total);
  let rows = 1;
  for (const [d, m] of Object.entries(counts))
    for (const [b, n] of Object.entries(m)) { await ins(d, b, n); rows++; }
  await c.query('COMMIT');

  console.log(`orders ingested: ${total} | period ${PERIOD} | ${rows} aggregate rows`);
  const returns = Object.entries(counts.return).filter(([b])=>b!=='NONE').reduce((s,[,n])=>s+n,0);
  console.log(`returns/refunds (CIR/NDR): ${returns} | exchanges: ${counts.type.EXCHANGE||0} | countries: ${Object.keys(counts.country).length}`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
