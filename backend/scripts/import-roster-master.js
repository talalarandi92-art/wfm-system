#!/usr/bin/env node
/*
 * Master roster reconciliation. Schedule source of truth = the MONTHLY MATRIX tab
 * (e.g. "June 26") of ROSTER/CC Schedule 26.xlsx — it already carries the user's
 * shift-aware codes (M7-3, WFH-M, N20S=sick, MA=absent, OFF/L/H). Base shift →
 * start/end via the "Timing" tab. Reconciled with FingerPrint punch + Ameyo
 * (by login) + Sprinklr (by id) system login/logout (LOCAL) + Odoo permission/
 * comp/sick. Applies user conventions (see memory roster_conventions): WFH rule,
 * SL/A + shift-aware codes, mothers' 7h, OT before/after. Writes roster_days.
 *
 * Usage: node scripts/import-roster-master.js [FROM=2026-06-01] [TO=2026-06-07]
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const DIR = 'C:/Users/t.bassam/Desktop/ROSTER';
const FROM = process.argv[2] || '2026-06-01';
const TO   = process.argv[3] || '2026-06-07';
const MONTH_TAB = { '2026-01':'Jan 26','2026-02':'Feb 26','2026-03':'Mar 26','2026-04':'April 26','2026-05':'May 26','2026-06':'June 26','2026-07':'July 26' };

const val = x => { if (x == null) return ''; if (x instanceof Date) return x; if (typeof x === 'object') return x.result !== undefined ? x.result : (x.text != null ? x.text : ''); return x; };
const str = x => { const v = val(x); return v instanceof Date ? v.toISOString() : String(v).trim(); };
const isoOf = x => { const v = (x && x.value !== undefined) ? x.value : x; const r = v instanceof Date ? v : (typeof v === 'object' && v ? v.result : v); if (r instanceof Date) return r.toISOString().slice(0,10); const n = Number(r); return (n>20000&&n<80000) ? new Date(Date.UTC(1899,11,30)+Math.round(n)*86400000).toISOString().slice(0,10) : null; };
const fracMin = x => { let v = val(x); if (v instanceof Date) return v.getUTCHours()*60+v.getUTCMinutes(); if (typeof v==='number') return Math.round(((v%1)+1)%1*1440); return null; };
const timeMin = x => { const v = val(x); if (v instanceof Date) return v.getUTCHours()*60+v.getUTCMinutes(); return null; };
const bracketNo = s => { const m = String(s||'').match(/\[\s*(\d{3,6})\s*\]/); return m ? m[1] : null; };
const hm = m => m==null?'--':`${String(Math.floor((((m%1440)+1440)%1440)/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

// parse a matrix code → planned status + base shift
function parseCode(c0) {
  const c = String(c0||'').trim(); const U = c.toUpperCase();
  if (!c) return { status:'none' };
  if (U==='OFF'||U==='O') return { status:'off', code:c };
  if (U==='L') return { status:'leave', code:c };
  if (U==='H') return { status:'holiday', code:c };
  if (U==='COMP') return { status:'comp', code:c };
  if (U==='UPL') return { status:'leave', code:c };
  if (U==='A') return { status:'absent', base:null, code:c };
  if (U==='S'||U==='SL') return { status:'sick', base:null, code:c };
  if (U==='RES'||U==='TER') return { status:'left', code:c };
  if (U==='P') return { status:'present', base:null, code:'P' };   // P = Present (shift unspecified) — user convention
  if (/^WFH/i.test(c)) { const base = c.replace(/^WFH[-\s]?/i,''); return { status:'wfh', base: base||null, code:c }; }
  if (/S$/.test(c) && c.length>1) return { status:'sick', base:c.slice(0,-1), code:c };
  if (/A$/.test(c) && c.length>1 && !/^AM/i.test(c)) return { status:'absent', base:c.slice(0,-1), code:c };
  return { status:'work', base:c, code:c };
}

// resolve base shift code → {start,end} minutes (cross-midnight aware) using Timing dict
function resolveShift(base, TIMING) {
  if (!base) return null;
  let b = base.toUpperCase();
  let is7h = false, motherEnd = null;
  const mth = b.match(/^([A-Z]+)7(-(\d+))?$/);              // M7 / M7-3 (mothers, 7h)
  if (mth) { is7h = true; b = mth[1]; if (mth[3]) motherEnd = (Number(mth[3])+12)*60; }   // -3 → 15:00
  let t = TIMING[b] || TIMING[b.replace(/[^A-Z]/g,'')];
  if (!t) { const base2 = b.replace(/[0-9].*$/,''); t = TIMING[base2]; }   // strip trailing digits
  if (!t) return { is7h };
  let ss = Math.round(t.start*1440), se = Math.round(t.end*1440);
  if (se <= ss) se += 1440;                                  // cross-midnight
  if (is7h) se = motherEnd != null ? motherEnd : Math.max(ss+60, se - 120);   // mother ends earlier
  return { ss, se, is7h, is20: /20/.test(base) };
}

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const tid = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows[0].id;
  for (const mig of ['053_roster_days.sql','054_roster_days_adherence.sql','055_roster_team_notes.sql','056_roster_master_fields.sql'])
    await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', mig), 'utf8'));
  const empGender = new Map((await c.query(`SELECT employee_no, gender FROM employees`)).rows.map(r=>[String(r.employee_no), r.gender]));
  const sm = (await c.query(`SELECT m.sprinklr_agent_id, lower(m.agent_email) email, e.employee_no FROM sprinklr_agent_map m JOIN employees e ON e.id=m.employee_id WHERE m.employee_id IS NOT NULL`)).rows;
  const sprkIdToNo = new Map(), emailToNo = new Map();
  for (const r of sm) { if (r.sprinklr_agent_id) sprkIdToNo.set(String(r.sprinklr_agent_id), String(r.employee_no)); if (r.email) emailToNo.set(r.email, String(r.employee_no)); }

  // ── Timing dict + monthly matrix + Shifts static (single streaming pass) ──
  const TIMING = {}; const matrix = []; const staticMap = new Map();   // id → {mgr,gender}
  const tabsNeeded = new Set([MONTH_TAB[FROM.slice(0,7)], 'Timing', 'Shifts']);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path.join(DIR, 'CC Schedule 26.xlsx'), {});
  for await (const ws of reader) {
    if (!tabsNeeded.has(ws.name)) continue;
    if (ws.name === 'Timing') {
      for await (const row of ws) { const v = row.values;
        for (const [mc, sc, ec] of [[1,2,3],[4,5,6]]) { const code = str(v[mc]).toUpperCase();
          const s = val(v[sc]), e = val(v[ec]);
          if (code && /^[A-Z]+[0-9]*$/.test(code) && typeof s==='number' && typeof e==='number' && !TIMING[code]) TIMING[code] = { start:s, end:e }; }   // first block wins (a 2nd corrupt block exists)
      }
    } else if (ws.name === 'Shifts') {
      for await (const row of ws) { const v = row.values; const no = String(val(v[5])).replace(/\D/g,''); if (!no) continue;
        if (!staticMap.has(no)) staticMap.set(no, { mgr: str(v[9])||null, gender: str(v[10])||null }); }
    } else { // monthly matrix
      let r = 0, dateCols = [];
      for await (const row of ws) { r++; const v = row.values;
        if (r === 2) { for (let cc = 7; cc < v.length; cc++) { const d = isoOf(v[cc]); if (d) dateCols.push([cc, d]); } continue; }
        if (r < 4) continue;
        const no = String(val(v[2])).replace(/\D/g,''); if (!no) continue;
        const rec = { no, name: str(v[1]), login: str(v[3]).toLowerCase(), team: str(v[4])||null, location: str(v[5])||null, func: str(v[6])||null, days: {} };
        for (const [cc, d] of dateCols) if (d >= FROM && d <= TO) { const code = str(v[cc]); if (code) rec.days[d] = code; }
        if (Object.keys(rec.days).length) matrix.push(rec);
      }
    }
  }
  console.log(`Timing codes: ${Object.keys(TIMING).length} | matrix employees: ${matrix.length}`);

  // ── punch / system / odoo maps (date-windowed) ──
  const punch = new Map();
  let wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR, 'Odoo FingerPrint in and out details.xlsx'));
  let ws = wb.worksheets[0];
  for (let r=2;r<=ws.rowCount;r++){ const row=ws.getRow(r); const iso=isoOf(row.getCell(2)); if(!iso||iso<FROM||iso>TO)continue;
    const no=String(val(row.getCell(1).value)).replace(/\D/g,''); if(!no)continue;
    punch.set(`${no}|${iso}`, { in:timeMin(row.getCell(4).value), out:timeMin(row.getCell(5).value), ot:timeMin(row.getCell(9).value)||0, status:str(row.getCell(10).value) }); }
  const sysByLogin=new Map(), sysByNo=new Map();
  const addSys=(map,key,iso,li,lo)=>{ if(li==null)return; const k=`${key}|${iso}`; let s=map.get(k); if(!s){map.set(k,{li,lo});return;} if(li<s.li)s.li=li; if(lo!=null&&(s.lo==null||lo>s.lo))s.lo=lo; };
  wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR,'Login and logout Ameyo.xlsx')); ws=wb.worksheets[0];
  for(let r=2;r<=ws.rowCount;r++){ const row=ws.getRow(r); const login=str(row.getCell(2).value).toLowerCase(); if(!login)continue;
    const iso=isoOf(row.getCell(3)); if(!iso||iso<FROM||iso>TO)continue; addSys(sysByLogin,login,iso,timeMin(row.getCell(4).value),timeMin(row.getCell(6).value)); }
  wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR,'Login and Logout sprinklr.xlsx')); ws=wb.getWorksheet('Login and Logout')||wb.worksheets[0];
  for(let r=4;r<=ws.rowCount;r++){ const row=ws.getRow(r); const key=str(row.getCell(1).value).toLowerCase(); if(!key)continue;
    const liV=row.getCell(2).value; if(!(liV instanceof Date))continue; const iso=liV.toISOString().slice(0,10); if(iso<FROM||iso>TO)continue;
    const no=sprkIdToNo.get(key)||emailToNo.get(key); if(!no)continue; addSys(sysByNo,no,iso,timeMin(liV),timeMin(row.getCell(3).value)); }
  const annot = async (file, kind) => { const m=new Map(); const w=new ExcelJS.Workbook(); await w.xlsx.readFile(path.join(DIR,file));
    const s=w.worksheets[0]; const H=s.getRow(1).values.map(x=>str(x)); const ci=n=>H.indexOf(n);
    const cEmp=ci('Employee'),cType=ci('Permission Type')>=0?ci('Permission Type'):ci('Type'),cDate=ci('Date'),cFrom=ci('Time From'),cTo=ci('Time To'),cTot=ci('Total Hours'),cStat=ci('Status'),cDF=ci('Date From'),cDT=ci('Date To');
    for(let r=2;r<=s.rowCount;r++){ const row=s.getRow(r); const no=bracketNo(val(row.getCell(cEmp).value)); if(!no)continue;
      if(kind==='sick'){ const df=val(row.getCell(cDF).value),dt=val(row.getCell(cDT).value); if(df instanceof Date){ let d=new Date(df),end=(dt instanceof Date)?new Date(dt):new Date(df); for(;d<=end;d.setUTCDate(d.getUTCDate()+1)){const iso=d.toISOString().slice(0,10); if(iso>=FROM&&iso<=TO)m.set(`${no}|${iso}`,{type:'Sick',status:str(row.getCell(cStat).value)});} } }
      else{ const d=val(row.getCell(cDate).value); if(!(d instanceof Date))continue; const iso=d.toISOString().slice(0,10); if(iso<FROM||iso>TO)continue;
        const tf=str(row.getCell(cFrom).value),tt=str(row.getCell(cTo).value);
        m.set(`${no}|${iso}`,{type:str(row.getCell(cType).value),duration:tf?`${tf}-${tt}`:str(row.getCell(cTot).value),status:str(row.getCell(cStat).value)}); } }
    return m; };
  const perms=await annot('Attendance Permissions ODOO.xlsx','perm'), comps=await annot('Compensatory Off (comp.off) ODOO.xlsx','comp'), sicks=await annot('Sick Leaves ODOO.xlsx','sick');

  // ── reconcile each (employee, day) ──
  const rows = []; const unknownCodes = new Map();
  const SHIFT_LETTER = code => { const r=resolveShiftLetter(code); return r; };
  function resolveShiftLetter(code){ const c=String(code||'').toUpperCase().replace(/(S|A)$/,''); if(/^MD/.test(c))return'MD'; if(/^MN/.test(c))return'MN'; if(/^AM/.test(c))return'M'; if(/^WFH-?M/.test(c))return'M'; if(/^WFH-?B/.test(c))return'B'; if(/^WFH-?C/.test(c))return'C'; if(/^WFH-?N/.test(c))return'N'; const m=c.match(/^(EE|E|M|B|C|N)/); return m?(m[1]==='EE'?'E':m[1]):null; }

  for (const rec of matrix) {
    const st = staticMap.get(rec.no) || {};
    for (const [iso, code] of Object.entries(rec.days)) {
      const pc = parseCode(code);
      const shift = resolveShift(pc.base, TIMING);
      const ss = shift?.ss ?? null, se = shift?.se ?? null;
      const p = punch.get(`${rec.no}|${iso}`);
      const sA = sysByLogin.get(`${rec.login}|${iso}`), sS = sysByNo.get(`${rec.no}|${iso}`);
      let li=null, lo=null, src=[]; for (const s of [sA,sS]) if (s){ if(li==null||s.li<li)li=s.li; if(s.lo!=null&&(lo==null||s.lo>lo))lo=s.lo; }
      if (sA) src.push('Ameyo'); if (sS) src.push('Sprinklr');
      const odPerm=perms.get(`${rec.no}|${iso}`), odComp=comps.get(`${rec.no}|${iso}`), odSick=sicks.get(`${rec.no}|${iso}`);
      const pin=p?.in??null, pout=p?.out??null;

      // presence from planned status + actuals (WFH rule: system + no punch + scheduled shift ⇒ wfh)
      let presence;
      if (pc.status==='sick') presence='sick';
      else if (pc.status==='absent') presence='absent';
      else if (pc.status==='off'||pc.status==='comp') presence='off';
      else if (pc.status==='leave') presence='leave';
      else if (pc.status==='holiday') presence='holiday';
      else if (pc.status==='left') presence='left';
      else if (pc.status==='wfh') presence='wfh';
      else if (pc.status==='present') { const wfhLoc = /wfh/i.test(rec.location||''); presence = pin!=null ? 'office' : ((li!=null || wfhLoc) ? 'wfh' : 'office'); }   // P = trusted present
      else if (pc.status==='work') { const wfhLoc = /wfh/i.test(rec.location||''); presence = pin!=null ? 'office' : ((li!=null || wfhLoc) ? 'wfh' : 'absent'); }
      else presence='off';
      if (pc.status==='work' && pc.base && !shift?.ss) unknownCodes.set(pc.base, (unknownCodes.get(pc.base)||0)+1);   // a working code that didn't resolve to a shift
      const worked = presence==='office'||presence==='wfh';
      const hasActual = (pin!=null) || (li!=null);   // do we have any login/punch trace?

      const inMin=li??pin; let outMin=lo??pout; if(inMin!=null&&outMin!=null&&outMin<inMin)outMin+=1440;
      const authLate=(odPerm&&/late/i.test(odPerm.type))||(odComp&&/late/i.test(odComp.type));
      const authEarly=(odPerm&&/early/i.test(odPerm.type))||(odComp&&/early/i.test(odComp.type));
      const sysLate=(worked&&ss!=null&&inMin!=null)?Math.max(0,inMin-ss):0;
      const sysEarly=(worked&&se!=null&&outMin!=null)?Math.max(0,se-outMin):0;
      const punchLate=(worked&&ss!=null&&pin!=null)?Math.max(0,pin-ss):0;
      let poutAdj=pout; if(pin!=null&&pout!=null&&pout<pin)poutAdj=pout+1440;
      const punchEarly=(worked&&se!=null&&pout!=null)?Math.max(0,se-poutAdj):0;
      const otBefore=(worked&&ss!=null&&inMin!=null)?Math.max(0,ss-inMin):0;
      const otAfter=(worked&&se!=null&&outMin!=null)?Math.max(0,outMin-se):0;
      const workedMin=(pin!=null&&pout!=null)?(poutAdj-pin):(inMin!=null&&outMin!=null?outMin-inMin:null);
      const effLate=authLate?0:sysLate, effEarly=authEarly?0:sysEarly;
      const shiftLen=(ss!=null&&se!=null)?(se-ss):null;
      const adherence=(worked&&shiftLen>0&&hasActual)?Math.max(0,Math.round(100*(shiftLen-Math.min(shiftLen,effLate+effEarly))/shiftLen*10)/10):null;
      const conforming=(worked&&hasActual)?(effLate===0&&effEarly===0):null;

      // codes
      const letter=resolveShiftLetter(code);
      let attCode=code, hrCode;
      if (pc.status==='sick') { attCode = code.length>1?code:(letter?`${letter}S`:'SL'); hrCode='SL'; }
      else if (pc.status==='absent') { attCode = code.length>1?code:(letter?`${letter}A`:'A'); hrCode='A'; }
      else if (pc.status==='off') hrCode='OFF';
      else if (pc.status==='leave') hrCode='L';
      else if (pc.status==='holiday') hrCode='H';
      else if (pc.status==='wfh') hrCode='WFH';
      else if (presence==='absent') { attCode = letter?`${letter}A`:'A'; hrCode='A'; }
      else hrCode = code;   // working shift present → shift code

      // mismatch: only genuine office anomalies (WFH no-punch is normal → not flagged)
      let mismatch=null;
      if (pc.status==='work' && !pc.base?.match(/wfh/i)) {
        if (pin!=null&&li!=null&&Math.abs(pin-li)>30) mismatch='punch<>system';
      }

      rows.push([tid, rec.no, rec.name||null, rec.func||null, iso, null,
        p?.status||null, presence, pin, pout, li, lo, src.join('+')||null,
        punchLate||0, punchEarly||0, (p?.ot||0)+otBefore+otAfter, odPerm?odPerm.type:null, odComp?odComp.type:null, odSick?'Sick':null, conforming,
        st.mgr||null, rec.team||null, st.gender||empGender.get(rec.no)||null, workedMin,
        code||null, ss, se, sysLate, sysEarly, adherence, mismatch,
        rec.location||null, pc.base||null, null, null, otBefore, otAfter, shift?.is7h||false, shift?.is20||false,
        attCode, hrCode, odPerm?odPerm.type:(odComp?odComp.type:null), odPerm?odPerm.duration:(odComp?odComp.duration:null), odPerm?odPerm.status:(odComp?odComp.status:null), null]);
    }
  }

  await c.query('BEGIN');
  await c.query(`DELETE FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [tid, FROM, TO]);
  const CINS=['tenant_id','employee_no','name','function_name','work_date','day_name','status','presence','punch_in_min','punch_out_min','sys_login_min','sys_logout_min','login_src','late_min','early_min','ot_min','permission','comp_off','sick','conforming','team_manager','team_group','gender','worked_min','shift_code','shift_start_min','shift_end_min','sys_late_min','sys_early_min','adherence_pct','mismatch','location','shift_category','shift_start2_min','shift_end2_min','ot_before_min','ot_after_min','is_7h','is_20','attendance_code','hr_code','permission_type','permission_duration','permission_status','campaign'];
  const N=CINS.length;
  for(let i=0;i<rows.length;i+=300){ const ch=rows.slice(i,i+300); const ph=ch.map((_,j)=>`(${Array.from({length:N},(_,k)=>`$${j*N+k+1}`).join(',')})`).join(','); await c.query(`INSERT INTO roster_days (${CINS.join(',')}) VALUES ${ph}`, ch.flat()); }
  await c.query('COMMIT');

  console.log(`written ${rows.length} (${FROM}..${TO})`);
  console.table((await c.query(`SELECT presence, COUNT(*) n FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 GROUP BY presence ORDER BY n DESC`,[tid,FROM,TO])).rows);
  const a=(await c.query(`SELECT ROUND(AVG(adherence_pct),1) adh, COUNT(*) FILTER(WHERE punch_in_min IS NOT NULL) pun, COUNT(*) FILTER(WHERE sys_login_min IS NOT NULL) sys, COUNT(*) FILTER(WHERE sys_late_min>0) lt, COUNT(*) FILTER(WHERE sys_early_min>0) er, COUNT(*) FILTER(WHERE ot_before_min>0) otb, COUNT(*) FILTER(WHERE ot_after_min>0) ota, COUNT(*) FILTER(WHERE shift_start_min IS NOT NULL) sh FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`,[tid,FROM,TO])).rows[0];
  console.log(`adherence ${a.adh}% | shift-resolved ${a.sh} | punched ${a.pun} | system ${a.sys} | sys-late ${a.lt} | early ${a.er} | OT-before ${a.otb} | OT-after ${a.ota}`);
  if (unknownCodes.size) console.log('⚠ UNKNOWN/unresolved working codes:', [...unknownCodes.entries()].map(([k,n])=>`${k}:${n}`).join(' '));
  else console.log('✓ all working codes resolved to a shift');
  await c.end();
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
