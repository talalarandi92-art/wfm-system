const { Client } = require('pg');
const fs = require('fs'), path = require('path');
// Load DB credentials from .env (repo root or backend/) — never hardcode secrets.
for (const p of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const client = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5433), user: process.env.POSTGRES_USER || 'wfm_user', password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB || 'wfm_db' });
client.connect().then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name='skills' ORDER BY ordinal_position")).then(r => { r.rows.forEach(row => console.log(row.column_name)); client.end(); }).catch(e => { console.error(e.message); client.end(); });
