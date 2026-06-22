#!/usr/bin/env node
/* perf/mint-token.js
 * Mint a short-lived platform_admin JWT for k6 performance tests and print it to stdout.
 *
 * Pattern copied from backend/scripts/smoke-get.js:
 *   1. Load env from ../backend/.env, then repo-root ../.env (first definition wins).
 *   2. Connect to Postgres via `pg`, pick an ACTIVE user holding the given role.
 *   3. Sign { sub: userId, tenantId } with JWT_ACCESS_SECRET (HS256).
 *
 * Usage:
 *   node perf/mint-token.js                 # prints the token, nothing else
 *   node perf/mint-token.js wfm_supervisor  # impersonate a different role
 *
 * Wire into a k6 run:
 *   bash / git-bash:   TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js
 *   PowerShell:        $env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-load-test.js
 *
 * The token is printed ALONE on stdout so it can be captured via $(...). Any
 * diagnostics go to stderr so they don't pollute the captured value.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

// --- env loading: backend/.env first, then repo-root .env (first wins) ---
for (const p of [
  path.join(__dirname, '..', 'backend', '.env'),
  path.join(__dirname, '..', '.env'),
]) {
  if (fs.existsSync(p)) {
    for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

const ROLE = process.argv[2] || 'platform_admin';
const TTL = process.env.PERF_TOKEN_TTL || '2h'; // long enough for a stress run

(async () => {
  if (!process.env.JWT_ACCESS_SECRET) {
    console.error('FATAL: JWT_ACCESS_SECRET not found in backend/.env or repo-root .env');
    process.exit(1);
  }

  const c = new Client({
    host: process.env.POSTGRES_HOST,
    port: +process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });
  await c.connect();

  const { rows } = await c.query(
    `SELECT u.id, u.tenant_id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.status='active' AND r.code = $1 LIMIT 1`,
    [ROLE],
  );
  await c.end();

  const u = rows[0];
  if (!u) {
    console.error(`FATAL: No active user with role ${ROLE}`);
    process.exit(1);
  }

  const token = jwt.sign(
    { sub: u.id, tenantId: u.tenant_id },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: TTL },
  );

  // diagnostics -> stderr, token -> stdout (alone, so $(...) captures only it)
  console.error(`Minted ${ROLE} JWT (sub=${u.id}, tenant=${u.tenant_id}, ttl=${TTL})`);
  process.stdout.write(token + '\n');
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
