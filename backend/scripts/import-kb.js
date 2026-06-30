#!/usr/bin/env node
/*
 * Ingest the cleaned Contact Center Knowledge Base corpus (kb-corpus.json), a local
 * mirror of the cckb2 Odoo KB, into the EXISTING Knowledge Base module (kb_articles +
 * kb_categories). Content stays 100% local (no external LLM).
 *
 * INCREMENTAL / continuous-learning: upserts by (tenant, source_slug), compares an
 * md5 content hash, and records NEW / UPDATED rows into kb_changes so the app can show
 * a "What's New" feed and badge changed articles. Idempotent: re-importing the same
 * corpus records no changes. Run after migrations 062 + 063.
 *
 *   node scripts/import-kb.js
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const AUTHOR = 'd0000000-0000-0000-0000-000000000001'; // admin (provenance)
const CORPUS = path.join(__dirname, 'kb-corpus.json');
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const CAT_MAP = {
  'Exchange':            ['Returns & Refunds',     'الإرجاع والاسترداد', '↩️', 10],
  'Return CIR':          ['Returns & Refunds',     'الإرجاع والاسترداد', '↩️', 10],
  'Return NDR':          ['Returns & Refunds',     'الإرجاع والاسترداد', '↩️', 10],
  'Cancel':              ['Returns & Refunds',     'الإرجاع والاسترداد', '↩️', 10],
  'Gift & Compensation': ['Returns & Refunds',     'الإرجاع والاسترداد', '↩️', 10],
  'Payments':            ['Payments',              'المدفوعات',          '💳', 20],
  'Delivery':            ['Delivery & Shipping',   'التوصيل والشحن',     '🚚', 30],
  'Shipping Partners':   ['Delivery & Shipping',   'التوصيل والشحن',     '🚚', 30],
  'OMT':                 ['Order Management (OMT)', 'إدارة الطلبات',     '📦', 40],
  'Tools & Systems':     ['CRM Guides',            'أدلة الأنظمة',       '🖥️', 50],
  'Email & Escalation':  ['CRM Guides',            'أدلة الأنظمة',       '🖥️', 50],
  'Performance':         ['Performance & QA',      'الأداء والجودة',     '⭐', 60],
  'QA Articles':         ['Performance & QA',      'الأداء والجودة',     '⭐', 60],
  'Training (LMS)':      ['Performance & QA',      'الأداء والجودة',     '⭐', 60],
  'General':             ['Policies',              'السياسات',           '📋', 70],
};

(async () => {
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const c = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: +(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'wfm_db',
    user: process.env.POSTGRES_USER || 'wfm_user',
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await c.connect();

  // Backfill source_slug + content_hash for rows imported before this incremental
  // version (tags = ['cckb2', slug]) so the first incremental run doesn't flag all as new.
  await c.query(
    `UPDATE kb_articles SET source_slug = tags[2], content_hash = md5(body)
       WHERE tenant_id = $1 AND 'cckb2' = ANY(tags) AND source_slug IS NULL`, [TENANT]);

  // Ensure target categories exist → name -> id map
  const catId = {};
  const want = {};
  for (const k in CAT_MAP) { const [n, na, ic, so] = CAT_MAP[k]; want[n] = [na, ic, so]; }
  for (const name in want) {
    const [na, ic, so] = want[name];
    const ex = await c.query(`SELECT id FROM kb_categories WHERE tenant_id=$1 AND name=$2`, [TENANT, name]);
    catId[name] = ex.rows[0]?.id
      || (await c.query(`INSERT INTO kb_categories (tenant_id,name,name_ar,icon,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [TENANT, name, na, ic, so])).rows[0].id;
  }

  let created = 0, updated = 0, unchanged = 0;
  for (const a of corpus) {
    const cat = (CAT_MAP[a.category] || CAT_MAP['General'])[0];
    const hash = md5(a.content);
    const ex = await c.query(
      `SELECT id, content_hash FROM kb_articles WHERE tenant_id=$1 AND source_slug=$2`, [TENANT, a.slug]);

    if (!ex.rows[0]) {
      const ins = await c.query(
        `INSERT INTO kb_articles
           (tenant_id, category_id, title, title_ar, body, body_ar, tags, status, author_id, updated_by,
            published_at, source_slug, content_hash)
         VALUES ($1,$2,$3,'',$4,'',$5,'published',$6,$6, NOW(), $7, $8) RETURNING id`,
        [TENANT, catId[cat], a.title, a.content, ['cckb2', a.slug], AUTHOR, a.slug, hash]);
      await c.query(`INSERT INTO kb_changes (tenant_id, article_id, slug, title, category, change_type)
                     VALUES ($1,$2,$3,$4,$5,'new')`, [TENANT, ins.rows[0].id, a.slug, a.title, cat]);
      created++;
    } else if (ex.rows[0].content_hash !== hash) {
      await c.query(
        `UPDATE kb_articles SET category_id=$2, title=$3, body=$4, tags=$5, content_hash=$6,
                updated_by=$7, updated_at=NOW() WHERE id=$1`,
        [ex.rows[0].id, catId[cat], a.title, a.content, ['cckb2', a.slug], hash, AUTHOR]);
      await c.query(`INSERT INTO kb_changes (tenant_id, article_id, slug, title, category, change_type)
                     VALUES ($1,$2,$3,$4,$5,'updated')`, [TENANT, ex.rows[0].id, a.slug, a.title, cat]);
      updated++;
    } else { unchanged++; }
  }

  const words = corpus.reduce((s, a) => s + (a.word_count || 0), 0);
  await c.query(`INSERT INTO kb_import_log (tenant_id, source, articles, words) VALUES ($1,'cckb2-odoo',$2,$3)`,
    [TENANT, corpus.length, words]);
  console.log(`✓ KB import: ${created} new · ${updated} updated · ${unchanged} unchanged (${corpus.length} total).`);
  await c.end();
})().catch(e => { console.error('Import failed:', e.message); process.exit(1); });
