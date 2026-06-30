/**
 * Shared DB helper for the reconciliation ingest — uses the SAME POSTGRES_* env the app/seeds use.
 * Exports getClient(); when run directly, prints roster_days schema + a sample row (de-risks the insert).
 */
const { Client } = require('pg');
const path = require('path');
// the app's ConfigModule loads ['.env','../.env']; the real POSTGRES_* live in the PROJECT ROOT .env
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getClient() {
  return new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'wfm_db',
    user: process.env.POSTGRES_USER || 'wfm_user',
    password: String(process.env.POSTGRES_PASSWORD ?? ''),
  });
}
module.exports = { getClient };

if (require.main === module) {
  (async () => {
    const c = getClient();
    await c.connect();
    const cols = await c.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='roster_days' ORDER BY ordinal_position");
    console.log('roster_days has ' + cols.rows.length + ' columns. NOT NULL (no default):');
    console.log('  ' + cols.rows.filter(r => r.is_nullable === 'NO' && !r.column_default).map(r => r.column_name + ':' + r.data_type).join(', '));
    const tenants = await c.query("SELECT DISTINCT tenant_id FROM roster_days LIMIT 3");
    console.log('tenant_id(s):', tenants.rows.map(r => r.tenant_id).join(', '));
    const sample = await c.query("SELECT * FROM roster_days WHERE work_date='2026-06-10' LIMIT 1");
    if (sample.rows[0]) { const r = sample.rows[0]; console.log('sample June-10 row keys+values (first 40):'); console.log('  ' + Object.entries(r).slice(0, 40).map(([k, v]) => k + '=' + (v === null ? 'NULL' : String(v).slice(0, 18))).join(' | ')); }
    const jun = await c.query("SELECT MIN(work_date)::text a, MAX(work_date)::text b, COUNT(*)::int n FROM roster_days WHERE work_date BETWEEN '2026-06-01' AND '2026-06-30'");
    console.log('current June rows:', JSON.stringify(jun.rows[0]));
    await c.end();
  })().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
}
