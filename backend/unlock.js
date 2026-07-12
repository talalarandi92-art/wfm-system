const { Client } = require('pg');
const fs = require('fs'), path = require('path');
// Load DB credentials from .env (repo root or backend/) — never hardcode secrets.
for (const p of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5433), database: process.env.POSTGRES_DB || 'wfm_db', user: process.env.POSTGRES_USER || 'wfm_user', password: process.env.POSTGRES_PASSWORD });
c.connect()
  .then(() => c.query("UPDATE users SET locked_until=NULL, status='active' WHERE email IN ('admin@boutiqaat.wfm','demo.admin@boutiqaat.wfm') RETURNING email,status"))
  .then(r => { console.log('Unlocked:', r.rows); return c.end(); })
  .catch(e => { console.error(e.message); c.end(); });
