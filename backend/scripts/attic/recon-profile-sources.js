/** STAGE 1 — profile the 4 source files: distinct statuses/types + identifier match-rate vs foundation. Read-only. */
const XLSX = require('xlsx');
const fs = require('fs');
const F = JSON.parse(fs.readFileSync('C:/Users/T573E~1.BAS/AppData/Local/Temp/claude/C--Users-t-bassam-Desktop-WFM-System/63e84c5a-2fd1-476e-8a73-031ad06b92a0/scratchpad/recon/foundation.json', 'utf8'));
const dir = 'C:/Users/t.bassam/Desktop/new roster/';
const idSet = new Set(F.employees.map(e => e.id));
const byUser = F.byUser, byEmail = F.byEmail;
const tally = (arr) => { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const read = (f, opts) => XLSX.utils.sheet_to_json(XLSX.readFile(dir + f, Object.assign({ cellDates: true }, opts || {})).Sheets[Object.keys(XLSX.readFile(dir + f, { bookSheets: true }).Sheets ? {} : {})[0] || XLSX.readFile(dir + f, { bookSheets: true }).SheetNames[0]], { header: 1, defval: null, blankrows: false });

function loadSheet(f, sheetIdx = 0) {
  const wb = XLSX.readFile(dir + f, { cellDates: true });
  const sn = wb.SheetNames[sheetIdx];
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false });
}

// ---- Odoo ----
console.log('\n===== ODOO FINGERPRINT =====');
{
  const R = loadSheet('Odoo Fingerprint June.xlsx');
  const hdr = R[0]; console.log('header:', JSON.stringify(hdr));
  const rows = R.slice(1);
  const codes = rows.map(r => r[0]);
  let inIds = 0; for (const c of new Set(codes)) if (idSet.has(c)) inIds++;
  console.log('rows=' + rows.length + ' distinctCodes=' + new Set(codes).size + ' codesMatchingRosterId=' + inIds);
  console.log('Status distinct:', tally(rows.map(r => (r[9] == null ? 'null' : String(r[9]).trim()))).slice(0, 20).map(([k, n]) => k + ':' + n).join('  '));
  console.log('sample In/Out (non-null):');
  let shown = 0; for (const r of rows) { if (r[3] != null || r[4] != null) { console.log('  code=' + r[0] + ' date=' + (r[1] instanceof Date ? r[1].toISOString() : r[1]) + ' in=' + (r[3] instanceof Date ? r[3].toISOString() : r[3]) + ' out=' + (r[4] instanceof Date ? r[4].toISOString() : r[4]) + ' lateIn=' + r[6] + ' earlyOut=' + r[7] + ' OT=' + r[8]); if (++shown >= 4) break; } }
}

// ---- Permission & Compo ----
console.log('\n===== PERMISSION & COMPO =====');
{
  const R = loadSheet('Permission & Compo June.xlsx');
  const hdr = R[0]; console.log('header:', JSON.stringify(hdr));
  const rows = R.slice(1);
  const ids = rows.map(r => r[1]);
  let inIds = 0; for (const c of new Set(ids)) if (idSet.has(c)) inIds++;
  console.log('rows=' + rows.length + ' distinctIds=' + new Set(ids).size + ' idsMatchingRoster=' + inIds);
  console.log('Type distinct:', tally(rows.map(r => String(r[3] || 'null').trim())).map(([k, n]) => k + ':' + n).join('  '));
  console.log('Status distinct:', tally(rows.map(r => String(r[7] || 'null').trim())).map(([k, n]) => k + ':' + n).join('  '));
  console.log('sample rows:'); rows.slice(0, 4).forEach(r => console.log('  ' + JSON.stringify(r.map(c => c instanceof Date ? c.toISOString() : c))));
}

// ---- Ameyo ----
console.log('\n===== AMEYO =====');
{
  const R = loadSheet('Ameyo login and logout.xlsx');
  const hdr = R[0]; console.log('header:', JSON.stringify(hdr));
  const rows = R.slice(1);
  const users = rows.map(r => String(r[0] || '').toLowerCase());
  let inU = 0; const uniqU = new Set(users); for (const u of uniqU) if (byUser[u] != null) inU++;
  console.log('rows=' + rows.length + ' distinctUserIds=' + uniqU.size + ' userIdsMatchingRoster=' + inU);
  console.log('sample rows:'); rows.slice(0, 3).forEach(r => console.log('  ' + JSON.stringify(r.map(c => c instanceof Date ? c.toISOString() : c))));
  console.log('unmatched sample:', [...uniqU].filter(u => byUser[u] == null).slice(0, 10).join(', '));
}

// ---- Sprinklr ----
console.log('\n===== SPRINKLR =====');
{
  const R = loadSheet('Login and Logout sprinklr.xlsx');
  console.log('row0(banner):', JSON.stringify(R[0]).slice(0, 120));
  const hdr = R[1]; console.log('header:', JSON.stringify(hdr));
  const rows = R.slice(2);
  const aids = rows.map(r => String(r[0] || '').trim());
  const uniq = new Set(aids);
  let emailMatch = 0, numeric = 0, otherEmail = 0;
  for (const a of uniq) { const lo = a.toLowerCase(); if (byEmail[lo] != null) emailMatch++; else if (/^\d+$/.test(a)) numeric++; else if (/@/.test(a)) otherEmail++; }
  console.log('rows=' + rows.length + ' distinctAgentIds=' + uniq.size + ' matchRosterEmail=' + emailMatch + ' numericIds=' + numeric + ' otherEmails=' + otherEmail);
  console.log('sample rows:'); rows.slice(0, 4).forEach(r => console.log('  ' + JSON.stringify(r.map(c => c instanceof Date ? c.toISOString() : c))));
  console.log('numeric/other sample:', [...uniq].filter(a => byEmail[a.toLowerCase()] == null).slice(0, 8).join(', '));
}
