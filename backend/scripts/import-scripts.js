#!/usr/bin/env node
/* Load parsed reply scripts (scripts.json) into kb_scripts. Idempotent (clears + reloads). */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
for (const p of [path.join(__dirname,'..','.env'), path.join(__dirname,'..','..','.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p,'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
  }
const TENANT = 'a0000000-0000-0000-0000-000000000001';
(async () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(__dirname,'scripts.json'),'utf8'));
  const c = new Client({ host: process.env.POSTGRES_HOST||'localhost', port:+(process.env.POSTGRES_PORT||5432),
    database: process.env.POSTGRES_DB||'wfm_db', user: process.env.POSTGRES_USER||'wfm_user',
    password: process.env.POSTGRES_PASSWORD, ssl: process.env.POSTGRES_SSL==='true'?{rejectUnauthorized:false}:false });
  await c.connect();
  await c.query(`DELETE FROM kb_scripts WHERE tenant_id=$1`, [TENANT]);
  let n = 0;
  for (const s of scripts) {
    const kw = `${s.category||''} ${s.en||''} ${s.ar||''} ${s.code||''}`.toLowerCase();
    await c.query(`INSERT INTO kb_scripts (tenant_id, source, category, en, ar, code, keywords) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [TENANT, s.source, s.category, s.en, s.ar, s.code, kw]);
    n++;
  }
  console.log(`✓ Imported ${n} reply scripts into kb_scripts.`);
  await c.end();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
