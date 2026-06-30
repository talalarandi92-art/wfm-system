#!/usr/bin/env node
/* Dev-only: mint a short-lived JWT for an active admin user to smoke-test
   our OWN running API. Reads secret + DB creds from .env; prints ONLY the
   token (never the secret). For local pre-demo verification. */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

(async () => {
  const c = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  });
  await c.connect();
  // Pick an active admin-ish user (most permissions), else any active user.
  const { rows } = await c.query(`
    SELECT u.id, u.tenant_id, u.email,
           COUNT(rp.permission_id) AS perms
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE u.status = 'active'
    GROUP BY u.id, u.tenant_id, u.email
    ORDER BY perms DESC
    LIMIT 1`);
  await c.end();
  if (!rows.length) { console.error('NO_ACTIVE_USER'); process.exit(1); }
  const u = rows[0];
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) { console.error('NO_JWT_ACCESS_SECRET'); process.exit(1); }
  const token = jwt.sign(
    { sub: u.id, tenantId: u.tenant_id, email: u.email },
    secret,
    { expiresIn: '6h' },
  );
  // Print ONLY the token + the (non-secret) identity used.
  process.stdout.write(token);
  process.stderr.write(`\n[gen-test-token] user=${u.email} perms=${u.perms}\n`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
