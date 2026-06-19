/* COMPREHENSIVE cross-month audit (April + May): SCORED + FILLED.
 * Independently recomputes every score, checks Net, ranges, coverage, FILLED integrity,
 * and produces a blank/gap summary with classification. Read-only. */
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { execSync } = require('child_process');
const D = 'C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';

const rP = v => (v === '' || v == null || isNaN(v)) ? null : Math.round(Number(v) * 100);
const sQ = v => { const p = rP(v); return p == null ? '' : p >= 95 ? 30 : p >= 90 ? 20 : p >= 80 ? 10 : p >= 65 ? -10 : -20; };
const sP = (prr, res) => { const a = rP(prr), b = rP(res); return (a != null && b != null && a >= 80 && b >= 10) ? 2.5 : 0; };
const sA = a => (a === '' || a == null) ? '' : (Number(a) * 24 <= 48 ? 10 : -10);
const sF = v => { const p = rP(v); return p == null ? '' : p >= 85 ? 20 : p >= 80 ? 10 : p >= 75 ? 5 : -10; };
const sPr = v => { const p = rP(v); return p == null ? '' : p >= 91 ? 15 : p === 90 ? 10 : p === 89 ? 5 : p <= 86 ? -15 : 0; };
const sC = v => { const p = rP(v); return p == null ? '' : p >= 95 ? 10 : (p >= 90 && p <= 94) ? 5 : p < 90 ? -10 : ''; };
const sQz = v => { const p = rP(v); return p == null ? '' : (p >= 90 && p <= 95) ? 5 : (p > 95 && p <= 100) ? 10 : p < 90 ? -10 : ''; };
const sM = m => (m === '' || m == null) ? 15 : 15 - Number(m) * 5;
const sRt = rt => (rt === '' || rt == null) ? '' : Number(rt) <= 1 / 24 ? 15 : Number(rt) <= 2 / 24 ? 10 : Number(rt) <= 4 / 24 ? 5 : -15;
const n0 = x => (x === '' || x == null || isNaN(x)) ? 0 : Number(x);
const near = (a, b, e = 1e-9) => Math.abs((a || 0) - (b || 0)) <= e;
const dfrac = v => v instanceof Date ? (v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds()) / 86400 : v;

async function auditMonth(M) {
  const issues = [], pass = [], notes = [];
  const ADD = (ok, msg) => (ok ? pass : issues).push(msg);

  // ---- SCORED ----
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(D + M.scored);
  const ws = wb.getWorksheet(M.scSheet);
  if (!ws) { issues.push(`SCORED sheet "${M.scSheet}" missing`); return { M, issues, pass, notes }; }
  const rows = [];
  ws.eachRow((r, n) => { if (n === 1) return; const o = []; for (let c = 1; c <= 28; c++) o[c] = r.getCell(c).value; o[15] = dfrac(o[15]); o[27] = dfrac(o[27]); rows.push(o); });
  const agents = new Set(rows.map(r => r[2])); const finals = rows.filter(r => String(r[8]).toLowerCase() === 'final');
  ADD(rows.length === agents.size * 5, `rows ${rows.length} = agents ${agents.size} ×5 (${agents.size * 5})`);
  ADD(rows.length > 0, `SCORED has ${rows.length} rows`);

  // recompute every score + Net
  let sMis = 0, nMis = 0; const ex = [];
  for (const r of rows) {
    if ([6, 9, 11, 12, 17, 19, 21, 23, 27].every(i => r[i] === '' || r[i] == null)) continue;   // on-leave/no-data row
    const exp = { 10: sQ(r[9]), 13: sP(r[12], r[11]), 14: sP(r[12], r[11]), 16: sA(r[15]), 18: sF(r[17]), 20: sPr(r[19]), 22: sC(r[21]), 24: sQz(r[23]), 26: sM(r[25]), 28: sRt(r[27]) };
    for (const c in exp) { if (String(r[c] === '' ? '' : r[c]) !== String(exp[c])) { sMis++; if (ex.length < 6) ex.push(`${r[1]} wk${r[8]} col${c}: got ${r[c]} exp ${exp[c]} (val=${r[c - 1]})`); } }
    const net = [10, 13, 14, 16, 18, 20, 22, 24, 26, 28].reduce((s, c) => s + n0(r[c]), 0);
    if (!near(net, n0(r[7]), 1e-6)) { nMis++; if (ex.length < 12) ex.push(`${r[1]} wk${r[8]} NET ${r[7]} exp ${net}`); }
  }
  ADD(sMis === 0, `Score-band recompute: ${sMis} mismatches`); ADD(nMis === 0, `Net recompute: ${nMis} mismatches`);
  ex.forEach(m => issues.push('   • ' + m));

  // ranges
  let badPct = 0, badT = 0;
  for (const r of rows) { [6, 9, 11, 12, 17, 19, 21, 23].forEach(c => { if (typeof r[c] === 'number' && (r[c] < 0 || r[c] > 1.0001)) badPct++; }); [15, 27].forEach(c => { if (typeof r[c] === 'number' && (r[c] < 0 || r[c] >= 2)) badT++; }); }
  ADD(badPct === 0, `% within 0..100: ${badPct} bad`); ADD(badT === 0, `AHT/RT <48h: ${badT} bad`);

  // tabs
  ADD(!!wb.getWorksheet('DATA (audit)'), 'DATA (audit) tab present');
  ADD(!!wb.getWorksheet('Ranking'), 'Ranking tab present');

  // blank/gap summary per function×KPI (Final rows)
  const KPI = { AHT: 15, FCR: 17, CTR: 21, Quality: 9, Prod: 19, Quiz: 23, RES: 11, PRR: 12, RT: 27, WD: 6 };
  const gap = {};
  for (const r of finals) { const f = r[5]; for (const k in KPI) { const v = r[KPI[k]]; if (v === '' || v == null) { (gap[f] = gap[f] || {})[k] = (gap[f]?.[k] || 0) + 1; } } }
  for (const f in gap) { const g = Object.entries(gap[f]).map(([k, n]) => `${k}:${n}`).join(' '); notes.push(`gap [${f}] Final blanks → ${g}`); }

  // ---- FILLED ----
  const F = D + M.filled;
  let cf = 0; try { const list = execSync(`unzip -l "${F}"`, { maxBuffer: 1e8 }).toString().split('\n').filter(l => /worksheets\/sheet\d+\.xml/.test(l)).map(l => l.trim().split(/\s+/).pop()); for (const p of list) { const x = execSync(`unzip -p "${F}" "${p}"`, { maxBuffer: 1e8 }).toString(); cf += (x.match(/<conditionalFormatting[^>]*\/>/g) || []).length; } } catch (e) { issues.push('FILLED unzip failed: ' + e.message.split('\n')[0]); }
  ADD(cf === 0, `FILLED empty conditionalFormatting: ${cf} (must be 0 — else Excel "repair")`);
  const wbF = new ExcelJS.Workbook();
  try { await wbF.xlsx.readFile(F); ADD(true, 'FILLED opens (valid XML)'); } catch (e) { issues.push('FILLED read ERR: ' + e.message); return { M, issues, pass, notes }; }
  const main = wbF.worksheets.find(w => /SC 26/i.test(w.name));
  let mainIds = new Set(), hr = 0; main.eachRow((r, n) => { if (hr) return; let a = false, w = false; r.eachCell(c => { if (/^agent$/i.test(String(c.value))) a = true; if (/^weeks$/i.test(String(c.value))) w = true; }); if (a && w) hr = n; });
  main.eachRow((r, n) => { if (n <= hr) return; const id = r.getCell(3).value; if (id && !isNaN(id)) mainIds.add(Number(id)); });
  ADD(mainIds.size === agents.size, `FILLED main agents ${mainIds.size} = SCORED agents ${agents.size}`);
  // cached result present on a score cell (K = Quality Score, col 11)
  let hasResult = false; const k14 = main.getCell(hr + 1, 11).value; if (k14 && typeof k14 === 'object' && 'result' in k14) hasResult = true;
  ADD(hasResult, 'FILLED score cells carry cached result (Excel shows values + upload-readable)');
  // WFM Note column
  let noteCol = false; for (let c = 30; c <= 40; c++) if (/wfm note/i.test(String(main.getCell(hr, c).value || ''))) noteCol = true;
  ADD(noteCol, 'FILLED "WFM Note" column present');

  return { M, issues, pass, notes };
}

(async () => {
  const MONTHS = [
    { label: 'APRIL', scored: 'April 26 Scorecard - SCORED.xlsx', scSheet: 'April SC', filled: '4.April 26 SC - FILLED.xlsx' },
    { label: 'MAY', scored: 'May 26 Scorecard - SCORED.xlsx', scSheet: 'May SC', filled: '5.May 26 SC - FILLED.xlsx' },
  ];
  for (const M of MONTHS) {
    const { issues, pass, notes } = await auditMonth(M);
    console.log(`\n══════════ ${M.label} ══════════`);
    console.log(`✅ PASSED (${pass.length}):`); pass.forEach(p => console.log('  ✓ ' + p));
    console.log(`\n📋 GAPS (expected blanks — verify, not necessarily bugs):`); notes.forEach(nt => console.log('  • ' + nt));
    if (issues.length) { console.log(`\n❌ ISSUES (${issues.length}):`); issues.forEach(i => console.log('  ' + i)); }
    else console.log('\n🎉 NO ISSUES');
  }
})().catch(e => console.log('FATAL', e.message));
