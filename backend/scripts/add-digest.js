#!/usr/bin/env node
/* Adds the synthesized "CC Operations — Full Digest" as a master KB article so the
 * Expert bot can answer from the high-level summary too. Idempotent (source_slug). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const TENANT = 'a0000000-0000-0000-0000-000000000001';
const AUTHOR = 'd0000000-0000-0000-0000-000000000001';
const body = fs.readFileSync(path.join(require('os').homedir(), 'Downloads', 'CC_Knowledge_Digest.md'), 'utf8');
const hash = crypto.createHash('md5').update(body).digest('hex');
(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'wfm_db', user: process.env.POSTGRES_USER || 'wfm_user',
    password: process.env.POSTGRES_PASSWORD, ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await c.connect();
  const cat = (await c.query(`SELECT id FROM kb_categories WHERE tenant_id=$1 AND name='Policies'`, [TENANT])).rows[0]?.id || null;
  const slug = 'cc-operations-digest';
  const ex = await c.query(`SELECT id FROM kb_articles WHERE tenant_id=$1 AND source_slug=$2`, [TENANT, slug]);
  const title = '📚 CC Operations — Full Digest (synthesis)';
  if (ex.rows[0]) {
    await c.query(`UPDATE kb_articles SET body=$3, content_hash=$4, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [ex.rows[0].id, TENANT, body, hash]);
    console.log('✓ Digest article updated.');
  } else {
    await c.query(`INSERT INTO kb_articles (tenant_id,category_id,title,title_ar,body,body_ar,tags,status,author_id,updated_by,published_at,source_slug,content_hash)
      VALUES ($1,$2,$3,'الملخّص الشامل لعمليات مركز الاتصال',$4,'',$5,'published',$6,$6,NOW(),$7,$8)`,
      [TENANT, cat, title, body, ['cckb2', 'digest', slug], AUTHOR, slug, hash]);
    console.log('✓ Digest article added to the Knowledge Base (bot can now answer from it).');
  }
  await c.end();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
