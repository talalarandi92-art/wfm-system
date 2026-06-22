const fs=require('fs'),path=require('path');const{Client}=require('pg');
for(const p of [path.join(__dirname,'..','.env'),path.join(__dirname,'..','..','.env')]){if(fs.existsSync(p))for(const line of fs.readFileSync(p,'utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}
const T='a0000000-0000-0000-0000-000000000001';
(async()=>{const c=new Client({host:process.env.POSTGRES_HOST||'localhost',port:+(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});await c.connect();const q=async(s,p=[])=>(await c.query(s,p)).rows;

console.log('━━━ FIX #1: HR-matrix codes (June) — must contain ZERO invented "P" ━━━');
const codes=await q(`SELECT COALESCE(hr_code,attendance_code,shift_code,'OFF') code, COUNT(*)::int n
  FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN '2026-06-01' AND '2026-06-29' AND is_active
  GROUP BY 1 ORDER BY n DESC`,[T]);
const pCount=codes.filter(r=>r.code==='P').reduce((a,r)=>a+r.n,0);
console.log('distinct codes:',codes.map(r=>`${r.code}:${r.n}`).join('  '));
console.log(pCount===0?'✅ ZERO "P" codes':`❌ STILL ${pCount} "P"`);

console.log('\n━━━ The exact days the user flagged — what the master roster actually shows ━━━');
console.log(await q(`SELECT clean_name, work_date::text d, presence, attendance_status, shift_code, hr_code,
  COALESCE(hr_code,attendance_code,shift_code,'OFF') matrix_code
  FROM roster_days WHERE tenant_id=$1 AND (
   (clean_name ILIKE '%Abdulkarim Barbazi%' AND work_date IN ('2026-06-02','2026-06-07')) OR
   (clean_name ILIKE '%Afnan%Ajaimi%' AND work_date IN ('2026-06-01','2026-06-07')) OR
   (clean_name ILIKE '%Aisha%Aljbawi%' AND work_date='2026-06-09')) ORDER BY clean_name,d`,[T]));

console.log('\n━━━ FIX #2: rankings dedupe — any person appearing >1 in mostLate top-50? ━━━');
const REP=`mode() WITHIN GROUP (ORDER BY clean_name) name`;
const late=await q(`SELECT person_no employee_no, ${REP}, SUM(sys_late_min)::int v
  FROM roster_days r WHERE tenant_id=$1 AND work_date BETWEEN '2026-06-01' AND '2026-06-29' AND is_active AND include_tardiness AND person_no IS NOT NULL
  GROUP BY person_no HAVING SUM(sys_late_min)>0 ORDER BY SUM(sys_late_min) DESC LIMIT 50`,[T]);
const nameCounts={};late.forEach(r=>nameCounts[r.name]=(nameCounts[r.name]||0)+1);
const dups=Object.entries(nameCounts).filter(([,n])=>n>1);
console.log(`top-50 late rows: ${late.length}, distinct names: ${Object.keys(nameCounts).length}`);
console.log(dups.length===0?'✅ NO duplicate names in rankings':`❌ dup names: ${JSON.stringify(dups)}`);
console.log('Fatma Hasan appears:', late.filter(r=>/fatma hasan/i.test(r.name)).length, 'time(s) — was 2 before fix');

console.log('\n━━━ FIX #3: Team-leader verification (ex-TLs flagged, not in current dropdown) ━━━');
const tl=await q(`SELECT r.team_manager name, COUNT(DISTINCT r.person_no)::int reports, MAX(r.work_date)::text last_seen,
   bool_or(i.is_active) verified
  FROM roster_days r LEFT JOIN employee_identity i ON i.tenant_id=r.tenant_id AND i.is_canonical AND i.role_category='Team Leader'
    AND replace(lower(i.clean_name),' ','')=replace(lower(r.team_manager),' ','')
  WHERE r.tenant_id=$1 AND r.team_manager IS NOT NULL AND r.team_manager<>'' GROUP BY r.team_manager ORDER BY reports DESC`,[T]);
const ALIAS={fatmehassan:'fatma hasan'};const norm=s=>(s||'').toLowerCase().replace(/\s+/g,'');
const tlActive=new Set((await q(`SELECT clean_name FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND role_category='Team Leader' AND is_active`,[T])).map(r=>norm(r.clean_name)));
tl.forEach(r=>{const v=!!r.verified||tlActive.has(norm(r.name))||tlActive.has(norm(ALIAS[norm(r.name)]||''));console.log(`  ${v?'✅ current ':'⚠️  flagged'} ${r.name.padEnd(18)} reports=${String(r.reports).padStart(3)} last=${r.last_seen} ${v?'':'→ verify if left'}`);});

console.log('\n━━━ Role-hours: 8h roles excluded from tardiness KPI ━━━');
console.log(await q(`SELECT role_category, default_hours, include_tardiness FROM role_working_hours WHERE tenant_id=$1 ORDER BY default_hours DESC, role_category`,[T]));
console.log('persons counted in tardiness vs records-only:');
console.log(await q(`SELECT include_tardiness, COUNT(DISTINCT person_no)::int persons FROM roster_days WHERE tenant_id=$1 AND is_active GROUP BY 1`,[T]));
await c.end();})().catch(e=>{console.error(e);process.exit(1)});
