const fs=require('fs'),path=require('path');
for(const p of [path.join(__dirname,'..','.env'),path.join(__dirname,'..','..','.env')])
  if(fs.existsSync(p)) for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const {Client}=require('pg');const T='a0000000-0000-0000-0000-000000000001';
(async()=>{
  const c=new Client({host:process.env.POSTGRES_HOST||'localhost',port:+(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'wfm_db',user:process.env.POSTGRES_USER||'wfm_user',password:process.env.POSTGRES_PASSWORD,ssl:process.env.POSTGRES_SSL==='true'?{rejectUnauthorized:false}:false});
  await c.connect();
  const ch=await c.query("SELECT title, change_type FROM kb_changes WHERE tenant_id=$1 AND changed_at > NOW() - interval '10 min' ORDER BY changed_at DESC",[T]);
  console.log("Just updated:"); ch.rows.forEach(r=>console.log(`  [${r.change_type}] ${r.title}`));
  for(const q of ['%maxCartValue%','%770 KWD%','%Delivery SLA%']){
    const s=await c.query("SELECT title FROM kb_articles WHERE tenant_id=$1 AND body ILIKE $2 LIMIT 2",[T,q]);
    console.log(`\nsearch ${q}:`, s.rows.map(r=>r.title).join(' | ')||'(none)');
  }
  await c.end();
})().catch(e=>{console.error('ERR:',e.message);process.exit(1);});
