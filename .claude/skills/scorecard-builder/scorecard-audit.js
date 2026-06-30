/* COMPREHENSIVE AUDIT of the generated April scorecard.
 * Independently recomputes scores, cross-checks values vs raw sources, verifies
 * FILLED↔SCORED consistency, coverage, and sanity. Reports every issue found. */
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const D = 'C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
const SC = 'C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx';
const SCORED = D + 'April 26 Scorecard - SCORED.xlsx';
const FILLED = D + '4.April 26 SC - FILLED.xlsx';
const issues = []; const pass = []; const ADD = (ok, msg) => (ok ? pass : issues).push(msg);
const rd = (f, s) => { const wb = XLSX.readFile(f); return XLSX.utils.sheet_to_json(wb.Sheets[s || wb.SheetNames[0]], { header: 1, defval: '' }); };
const norm = s => String(s ?? '').trim().toLowerCase();
const near = (a, b, e = 1e-6) => Math.abs((a || 0) - (b || 0)) <= e;

// independent band engine (round-half-up)
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
// exceljs returns time-formatted cells as Date — convert back to day-fraction
const dfrac = v => v instanceof Date ? (v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds()) / 86400 : v;

(async () => {
  // ---- roster ----
  const roster = rd(SC, 'W1').slice(1).filter(r => r[0]).map(r => ({ name: r[0], id: Number(r[1]), uid: norm(r[2]), func: String(r[4]).trim() }));
  const ids = roster.map(a => a.id);
  ADD(new Set(ids).size === ids.length, `Roster IDs unique: ${new Set(ids).size}/${ids.length}` + (new Set(ids).size === ids.length ? '' : ' ❌ DUPLICATES'));

  // ---- SCORED sheet ----
  const wbS = new ExcelJS.Workbook(); await wbS.xlsx.readFile(SCORED);
  const sc = wbS.getWorksheet('April SC'); const rows = [];
  sc.eachRow((r, n) => { if (n === 1) return; const o = []; for (let c = 1; c <= 28; c++) o[c] = r.getCell(c).value; o[15] = dfrac(o[15]); o[27] = dfrac(o[27]); rows.push(o); });
  const scAgents = new Set(rows.map(r => r[2])).size;   // SCORED's own agent count (union roster incl. main-sheet-only agents)
  ADD(rows.length === scAgents * 5, `SCORED rows = ${rows.length} = agents ${scAgents} ×5` + (rows.length === scAgents * 5 ? '' : ' ❌'));
  ADD(!!wbS.getWorksheet('DATA (audit)'), 'DATA (audit) tab present');

  // ---- recompute every score row, compare ----
  let scoreMismatch = 0, netMismatch = 0; const exMis = [];
  for (const r of rows) {
    // SCORED cols: 6 WD,7 Net,8 Wk,9 Q,10 Qs,11 RES,12 PRR,13 PRRpt,14 PRRbn,15 AHT,16 AHTs,17 FCR,18 FCRs,19 Prod,20 Prods,21 CTR,22 CTRs,23 Quiz,24 Quizs,25 Mist,26 Mists,27 RT,28 RTs
    // on-leave / no-data row: all KPIs blank → scorecard leaves scores blank by design (not scored). Skip.
    if ([6, 9, 11, 12, 17, 19, 21, 23, 27].every(i => r[i] === '' || r[i] == null)) continue;
    const exp = { 10: sQ(r[9]), 13: sP(r[12], r[11]), 14: sP(r[12], r[11]), 16: sA(r[15]), 18: sF(r[17]), 20: sPr(r[19]), 22: sC(r[21]), 24: sQz(r[23]), 26: sM(r[25]), 28: sRt(r[27]) };
    for (const c in exp) { const got = r[c] === '' ? '' : r[c]; if (String(got) !== String(exp[c])) { scoreMismatch++; if (exMis.length < 8) exMis.push(`${r[1]} wk${r[8]} col${c}: got ${got} expected ${exp[c]} (val=${r[c - 1]})`); } }
    const net = [10, 13, 14, 16, 18, 20, 22, 24, 26, 28].reduce((s, c) => s + n0(r[c]), 0);
    if (!near(net, n0(r[7]))) { netMismatch++; if (exMis.length < 12) exMis.push(`${r[1]} wk${r[8]} NET got ${r[7]} expected ${net}`); }
  }
  ADD(scoreMismatch === 0, `Score-band recompute: ${scoreMismatch} mismatches` + (scoreMismatch ? ' ❌' : ' ✓'));
  ADD(netMismatch === 0, `Net Points recompute: ${netMismatch} mismatches` + (netMismatch ? ' ❌' : ' ✓'));
  exMis.forEach(m => issues.push('   • ' + m));

  // ---- sanity on values ----
  let badPct = 0, badAht = 0, wdSameAll = 0;
  const byAgentWk = {};
  for (const r of rows) { byAgentWk[String(r[2]) + '|' + r[8]] = r; }   // key by ID
  // pct cols (as fractions) should be 0..1.0 (allow up to 1.0)
  for (const r of rows) {
    [6, 9, 11, 12, 17, 19, 21, 23].forEach(c => { const v = r[c]; if (typeof v === 'number' && (v < 0 || v > 1.0001)) { badPct++; } });
    [15, 27].forEach(c => { const v = r[c]; if (typeof v === 'number' && (v < 0 || v >= 2)) badAht++; });
  }
  ADD(badPct === 0, `Percentages within 0..100%: ${badPct} out-of-range` + (badPct ? ' ❌' : ' ✓'));
  ADD(badAht === 0, `AHT/RT plausible (<48h): ${badAht} out-of-range` + (badAht ? ' ❌' : ' ✓'));
  // WD% varies across weeks (not identical) for agents present all weeks
  for (const a of roster) { const w = [1, 2, 3, 4].map(k => byAgentWk[String(a.id) + '|' + k]).filter(Boolean).map(r => r[6]).filter(v => typeof v === 'number'); if (w.length >= 3 && new Set(w).size === 1) wdSameAll++; }
  ADD(wdSameAll < roster.length * 0.5, `WD% varies per week (agents w/ identical-all-weeks: ${wdSameAll})`);

  // ---- bar checks ----
  let barBad = 0;
  for (const r of rows) {
    const f = r[5]; // function (col5)
    if ((f === 'Inbound' || f === 'Outbound' || f === 'Refund')) { if (typeof r[17] === 'number' && !near(r[17], 0.80)) barBad++; if (typeof r[21] === 'number' && !near(r[21], 0.90)) barBad++; }
    if (String(r[8]) === '4' && typeof r[9] === 'number' && !near(r[9], 0.80)) barBad++; // QA W4 bar = 80%
  }
  ADD(barBad === 0, `Bar values (voice FCR=80/CTR=90, QA W4=80): ${barBad} off` + (barBad ? ' ❌' : ' ✓'));

  // ---- FILLED ↔ SCORED consistency (W1 raw values match) ----
  const wbF = new ExcelJS.Workbook(); await wbF.xlsx.readFile(FILLED);
  let consMis = 0, formulaOk = true;
  const wsSC = wbF.getWorksheet('April SC 26');
  // check a score formula still present
  let anyFormula = false; wsSC.getRow(14).eachCell(c => { if (c.formula) anyFormula = true; }); formulaOk = anyFormula;
  ADD(formulaOk, 'FILLED template score formulas intact (VLOOKUP/IF)');
  // compare W1 sheet QA (col7) vs SCORED W1 QA (col9)
  const w1 = wbF.getWorksheet('W1');
  w1.eachRow((r, n) => { if (n === 1) return; const id = r.getCell(2).value; if (!id || isNaN(id)) return; const a = roster.find(x => x.id === Number(id)); if (!a) return; const sr = byAgentWk[String(a.id) + '|1']; if (!sr) return; const fq = r.getCell(7).value, sq = sr[9]; if (typeof fq === 'number' && typeof sq === 'number' && !near(fq, sq, 1e-4)) consMis++; });
  ADD(consMis === 0, `FILLED↔SCORED W1 QA consistency: ${consMis} mismatches` + (consMis ? ' ❌' : ' ✓'));

  // ---- independent provenance spot-check: voice AHT for 3 inbound agents ----
  const wkOf = s => { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(s) * 86400000); if (d.getUTCMonth() !== 3) return 0; const day = d.getUTCDate(); return day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4; };
  const inb = rd(D + 'Inbound.xlsx');
  const recompAht = {}; // uid|wk -> {s,n}
  for (let i = 1; i < inb.length; i++) { const r = inb[i]; const wk = wkOf(r[0]); if (!wk) continue; const uid = norm(r[5]); const k = uid + '|' + wk; (recompAht[k] = recompAht[k] || { s: 0, n: 0 }); if (typeof r[11] === 'number') { recompAht[k].s += r[11]; recompAht[k].n++; } }
  // read SCORED AHT as RAW float via SheetJS (exceljs rounds time cells to the second)
  const scX = rd(SCORED, 'April SC');   // hdr + rows; ID col idx1, Week idx7, AHT idx14
  const rawAht = {}; for (let i = 1; i < scX.length; i++) { const r = scX[i]; rawAht[String(r[1]) + '|' + r[7]] = r[14]; }
  let provMis = 0, provChecked = 0;
  for (const a of roster.filter(x => x.func === 'Inbound').slice(0, 5)) {
    for (const wk of [1, 2, 3]) { const k = a.uid + '|' + wk; const rec = recompAht[k]; const fileAht = rawAht[String(a.id) + '|' + wk]; if (rec && rec.n && typeof fileAht === 'number') { provChecked++; const exp = rec.s / rec.n; if (!near(exp, fileAht, 1e-9)) { provMis++; if (issues.length < 60) issues.push(`   • AHT prov ${a.name} wk${wk}: file ${fileAht} vs raw ${exp}`); } } }
  }
  ADD(provMis === 0, `Voice AHT provenance (independent recompute, ${provChecked} checks): ${provMis} mismatches` + (provMis ? ' ❌' : ' ✓'));

  // ---- coverage: every agent × 5 rows ----
  let missing = 0; for (const a of roster) { for (const wk of [1, 2, 3, 4]) if (!byAgentWk[String(a.id) + '|' + wk]) missing++; if (!byAgentWk[String(a.id) + '|Final']) missing++; }
  ADD(missing === 0, `Coverage (66 agents × W1-4+Final): ${missing} missing rows` + (missing ? ' ❌' : ' ✓'));

  // ---- report ----
  console.log('\n========== SCORECARD AUDIT — APRIL ==========');
  console.log('\n✅ PASSED (' + pass.length + '):'); pass.forEach(p => console.log('  ✓ ' + p));
  console.log('\n' + (issues.length ? '❌ ISSUES (' + issues.length + '):' : '🎉 NO ISSUES FOUND'));
  issues.forEach(p => console.log('  ' + p));
})().catch(e => console.log('AUDIT ERROR', e.message, e.stack));
