#!/usr/bin/env node
/*
 * Simple, safe SQL migration runner.
 *
 * The docker-entrypoint-initdb.d mount only runs migrations on a FRESH volume,
 * so new .sql files are silently ignored on an existing database. TypeORM is
 * pointed at an empty dir and synchronize is off, so nothing else applies them.
 *
 * This runner records every applied file in a `schema_migrations` table and
 * applies only the new ones, in filename order, each inside its own transaction.
 * Idempotent: re-running applies nothing once everything is recorded.
 *
 *   node scripts/migrate.js                 # apply pending
 *   node scripts/migrate.js --status        # list applied vs pending, apply nothing
 *   node scripts/migrate.js --baseline 034  # mark every file up to the one whose
 *                                           # name contains "034" as already applied
 *                                           # WITHOUT running it — use once when
 *                                           # adopting this runner on a DB that was
 *                                           # already initialised via the init-dir mount.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Minimal .env loader (no dependency) — checks backend/.env then repo-root .env;
// does not override real env vars.
(function loadEnv() {
  for (const envPath of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
})();

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');
const statusOnly = process.argv.includes('--status');
const baselineIdx = process.argv.indexOf('--baseline');
const baselineToken = baselineIdx >= 0 ? process.argv[baselineIdx + 1] : null;

async function main() {
  const client = new Client({
    host:     process.env.POSTGRES_HOST || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'wfm_db',
    user:     process.env.POSTGRES_USER || 'wfm_user',
    password: process.env.POSTGRES_PASSWORD,
    ssl:      process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await client.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename),
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  if (baselineToken) {
    const cutoff = files.find(f => f.includes(baselineToken));
    if (!cutoff) { console.error(`No migration filename contains "${baselineToken}".`); await client.end(); process.exit(1); }
    const upTo = files.filter(f => f <= cutoff && !applied.has(f));
    for (const f of upTo) {
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
    }
    console.log(`✓ Baselined ${upTo.length} file(s) up to ${cutoff} (marked applied, not executed).`);
    await client.end();
    return;
  }

  const pending = files.filter(f => !applied.has(f));

  if (statusOnly) {
    console.log(`Applied: ${files.length - pending.length} / ${files.length}`);
    pending.forEach(f => console.log(`  pending: ${f}`));
    await client.end();
    return;
  }

  if (!pending.length) { console.log('✓ Database is up to date — nothing to apply.'); await client.end(); return; }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`→ applying ${file} … `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('done');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`\n✗ FAILED on ${file} — rolled back. No further migrations applied.\n${e.message}`);
      await client.end();
      process.exit(1);
    }
  }
  console.log(`✓ Applied ${pending.length} migration(s).`);
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
