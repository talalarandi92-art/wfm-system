#!/usr/bin/env node
/* Integration smoke-test: mint an admin JWT, hit every parameterless GET endpoint
 * on the running backend, and flag any 500 (a hidden runtime bug). READ-ONLY:
 * only GET, and write-ish/heavy routes are excluded. Pass the boot-log path + base
 * URL as args:  node scripts/smoke-get.js /tmp/boot.log http://localhost:3001 */
const fs = require('fs'), path = require('path'), jwt = require('jsonwebtoken'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const LOG = process.argv[2], BASE = process.argv[3] || 'http://localhost:3001';
const ROLE = process.argv[4] || 'platform_admin';   // role to impersonate
const LIST_OK = process.argv.includes('--list');     // print reachable (2xx) paths
const EXCLUDE = /(smoke-test|diagnostics|\/report|share-report|export|logout|\/me$|\/docs)/;

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [u] = (await c.query(
    `SELECT u.id, u.tenant_id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.status='active' AND r.code = $1 LIMIT 1`, [ROLE])).rows;
  await c.end();
  if (!u) { console.error(`No active user with role ${ROLE}`); process.exit(1); }
  const token = jwt.sign({ sub: u.id, tenantId: u.tenant_id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });

  const paths = [...new Set((fs.readFileSync(LOG, 'utf8').match(/Mapped \{(\/api\/[^,}]+), GET\}/g) || [])
    .map(m => m.match(/\{(\/api\/[^,}]+),/)[1])
    .filter(p => !p.includes(':') && !EXCLUDE.test(p)))];

  let ok = 0, auth = 0, bad = 0; const fails = [], reachable = [];
  for (const p of paths) {
    const url = BASE + p.replace('/api/', '/api/v1/');
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status >= 500) { bad++; fails.push(`${r.status}  ${p}`); }
      else if (r.status === 401 || r.status === 403) auth++;
      else { ok++; reachable.push(p); }
    } catch (e) { bad++; fails.push(`ERR  ${p} — ${e.message}`); }
  }
  console.log(`\nGET smoke-test as [${ROLE}] — ${paths.length} parameterless endpoints`);
  console.log(`  2xx/reachable: ${ok}   authz(401/403): ${auth}   5xx/error: ${bad}`);
  if (LIST_OK) { console.log('\n  Reachable (2xx):'); reachable.forEach(p => console.log('   • ' + p)); }
  if (fails.length) { console.log('\n  FAILURES (hidden runtime bugs):'); fails.forEach(f => console.log('   ✗ ' + f)); }
  else console.log('\n  ✓ No 500s — every tested GET endpoint runs clean against the live DB.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
