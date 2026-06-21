#!/usr/bin/env node
/*
 * Import Ameyo ticket/feedback rows → ops_contacts (one row per ticket).
 * Powers Operations Analytics: channel mix, contact reasons (refund/return/
 * exchange/...), per-agent volume, statuses. Stores the ticket grain the app
 * expects (not raw call logs) + extras in raw jsonb.
 *
 * Idempotent: removes the prior import batch (notes=IMPORT_TAG) then re-creates.
 * Chunked multi-row inserts (fast for ~70k rows).
 *
 * Usage: node scripts/import-ameyo-tickets.js "<path to FEEDBACK and tickets with status Ameyo.xlsx>"
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
const IMPORT_TAG = 'import:ameyo-tickets';
const CHUNK = 1000;

// Normalize the Ameyo channel string into {channel, missed, direction} without
// losing the original distinction (MISSED chats are NOT handled contacts).
function classifyChannel(c) {
  const s = String(c || '').toUpperCase();
  let channel = null;
  if (s.includes('VOICE')) channel = 'voice';
  else if (s.includes('MAIL')) channel = 'email';
  else if (s.includes('CHAT')) channel = 'chat';
  else if (s.includes('MANUAL') || s.includes('MESSAGE')) channel = 'social';
  else if (s) channel = s.toLowerCase();
  const missed = s.includes('MISSED');
  const direction = s.startsWith('OUTGOING') ? 'outbound' : s.startsWith('INCOMING') ? 'inbound' : null;
  return { channel, missed, direction, raw: c ? String(c).trim() : null };
}
// Date cell is a pure date (00:00:00Z) → ISO date is correct.
const ymd = (d) => {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d || '').trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null;
};
// Time-only cells are anchored to 1899 (exceljs applies historical TZ); the
// stored UTC hour + 3 (modern Kuwait) = the true local clock hour. Verified
// against the rendered text on real rows.
function localHour(t) {
  if (!(t instanceof Date)) return null;
  if (t.getUTCFullYear() > 1901) return null; // not a time-only cell
  return (t.getUTCHours() + 3) % 24;
}

(async () => {
  if (!FILE || !fs.existsSync(FILE)) { console.error('File not found:', FILE); process.exit(1); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [{ id: tenantId }] = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows;

  // Parse rows
  const rows = [];
  let minD = null, maxD = null, missedCount = 0, droppedCount = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).values;
    const agent = v[1] ? String(v[1]).trim() : null;
    const date = ymd(v[3]);
    if (!date) continue;
    const hour = localHour(v[4]);
    const ch = classifyChannel(v[5]);
    const reason = v[16] ? String(v[16]).trim() : null;
    const status = v[7] ? String(v[7]).trim() : null;
    const dropped = reason === 'Drop Contact';
    // Handled = a real agent-served contact: not a missed channel and not a dropped contact.
    const handled = !ch.missed && !dropped;
    if (ch.missed) missedCount++; if (dropped) droppedCount++;
    if (!minD || date < minD) minD = date;
    if (!maxD || date > maxD) maxD = date;
    rows.push({
      date, hour, channel: ch.channel, reason, agent,
      raw: {
        ticketId: v[2] != null ? String(v[2]) : null,
        status, category: v[17] ? String(v[17]).trim() : null,
        department: v[15] ? String(v[15]).trim() : null,
        feedback1: v[11] != null ? String(v[11]) : null,
        feedback2: v[12] != null ? String(v[12]) : null,
        channelRaw: ch.raw, direction: ch.direction,
        missed: ch.missed, dropped, handled,
      },
    });
  }
  console.log(`Parsed ${rows.length} ticket rows (${minD} → ${maxD}); of which ${missedCount} missed, ${droppedCount} dropped → ${rows.length - missedCount - droppedCount} handled.`);

  await c.query('BEGIN');
  // idempotent cleanup of prior import
  await c.query(`DELETE FROM ops_contacts WHERE batch_id IN (SELECT id FROM ops_batches WHERE tenant_id=$1 AND notes=$2)`, [tenantId, IMPORT_TAG]);
  await c.query(`DELETE FROM ops_batches WHERE tenant_id=$1 AND notes=$2`, [tenantId, IMPORT_TAG]);
  const [batch] = (await c.query(
    `INSERT INTO ops_batches (tenant_id, file_name, period_from, period_to, total_rows, status, notes)
     VALUES ($1,$2,$3,$4,$5,'committed',$6) RETURNING id`,
    [tenantId, path.basename(FILE), minD, maxD, rows.length, IMPORT_TAG])).rows;

  let inserted = 0;
  const COLS = 9;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vals = [], params = [];
    slice.forEach((r, j) => {
      const b = j * COLS;
      vals.push(`($${b+1},$${b+2},$${b+3}::date,$${b+4},$${b+5}::timestamptz,$${b+6},$${b+7},$${b+8},$${b+9}::jsonb)`);
      const ts = r.hour != null
        ? `${r.date}T${String(r.hour).padStart(2, '0')}:00:00+03:00`
        : `${r.date}T00:00:00+03:00`;
      params.push(tenantId, batch.id, r.date, r.hour, ts, r.channel, r.reason, r.agent, JSON.stringify(r.raw));
    });
    // columns: tenant_id, batch_id, contact_date, contact_hour, contact_ts, channel, contact_reason, agent_login, raw
    await c.query(
      `INSERT INTO ops_contacts (tenant_id, batch_id, contact_date, contact_hour, contact_ts, channel, contact_reason, agent_login, raw) VALUES ${vals.join(',')}`,
      params,
    );
    inserted += slice.length;
  }
  await c.query('COMMIT');
  console.log(`Done. Inserted ${inserted} contacts into ops_contacts (batch ${batch.id}).`);

  const ch = await c.query(`SELECT channel, COUNT(*) total, COUNT(*) FILTER (WHERE (raw->>'handled')::boolean) handled FROM ops_contacts WHERE batch_id=$1 GROUP BY channel ORDER BY total DESC`, [batch.id]);
  console.log('By channel (total / handled):', ch.rows.map(x => `${x.channel}:${x.total}/${x.handled}`).join(', '));
  const hrs = await c.query(`SELECT COUNT(*) FILTER (WHERE contact_hour IS NOT NULL) with_hour, COUNT(*) total FROM ops_contacts WHERE batch_id=$1`, [batch.id]);
  console.log(`Hour extracted: ${hrs.rows[0].with_hour}/${hrs.rows[0].total}`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
