// Parity test: snapshot the roster fingerprint before/after an upload of the SAME
// data, then diff. If the upload path is lossless, baseline === current exactly.
// Usage:  node _parity_check.js baseline   (run BEFORE upload)
//         node _parity_check.js compare    (run AFTER upload)
const fs = require('fs');
const BASE = 'C:/Users/t.bassam/Desktop/WFM System/_parity_baseline.json';
const API = 'http://localhost:3000/api/v1';

async function login() {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo.admin@boutiqaat.wfm', password: 'Demo@2026' }) });
  return (await r.json()).accessToken;
}

async function fingerprint() {
  const tok = await login();
  const H = { Authorization: 'Bearer ' + tok };
  // The roster query caps at 5000 rows, so fetch month-by-month (each < cap) and merge
  // to cover the whole year.
  const rows = [];
  const LAST = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 2026 not a leap year
  for (let m = 1; m <= 12; m++) {
    const mo = String(m).padStart(2, '0');
    const dd = String(LAST[m - 1]).padStart(2, '0');
    const r = await fetch(`${API}/attendance-recon/roster?from=2026-${mo}-01&to=2026-${mo}-${dd}&limit=5000`, { headers: H });
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (Array.isArray(j.rows) ? j.rows : null);
    if (!arr) { console.error(`month ${mo} returned no array:`, JSON.stringify(j).slice(0, 200)); continue; }
    rows.push(...arr);
  }
  const n = x => Math.round(Number(x) || 0);
  const agg = {
    totalRows: rows.length,
    employees: new Set(rows.map(r => r.employeeId)).size,
    sumOtTotalMin: 0, sumEffLateMin: 0, sumEffEarlyMin: 0, sumConformance: 0,
    dayType: {}, presence: {}, byMonth: {},
  };
  for (const r of rows) {
    agg.sumOtTotalMin += n(r.otTotalMin);
    agg.sumEffLateMin += n(r.effectiveLateMin);
    agg.sumEffEarlyMin += n(r.effectiveEarlyOutMin);
    agg.sumConformance += n(r.conformancePct);
    agg.dayType[r.dayType || '?'] = (agg.dayType[r.dayType || '?'] || 0) + 1;
    agg.presence[r.presence || '?'] = (agg.presence[r.presence || '?'] || 0) + 1;
    const m = (r.date || '').slice(0, 7);
    agg.byMonth[m] = (agg.byMonth[m] || 0) + 1;
  }
  // Spot checks: specific (name, month) -> manager / func / OT — the period-accurate fields
  const spot = {};
  const want = [
    ['Dima Awada', '2026-01'], ['Dima Awada', '2026-06'],
    ['Hamzeh Almalkawi', '2026-01'], ['Hamzeh Almalkawi', '2026-06'],
    ['Mohammed Elnaggar', '2026-06'], ['Abdalla', '2026-05'],
  ];
  for (const [nm, mo] of want) {
    const rs = rows.filter(r => (r.name || '').toLowerCase().includes(nm.toLowerCase()) && (r.date || '').startsWith(mo));
    spot[`${nm}|${mo}`] = {
      rows: rs.length,
      mgrs: [...new Set(rs.map(r => r.teamManager))].sort(),
      funcs: [...new Set(rs.map(r => r.func))].sort(),
      otMin: rs.reduce((s, r) => s + n(r.otTotalMin), 0),
    };
  }
  return { agg, spot };
}

function diff(a, b, path, out) {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
}

(async () => {
  const mode = process.argv[2];
  const fp = await fingerprint();
  if (mode === 'baseline') {
    fs.writeFileSync(BASE, JSON.stringify(fp, null, 2));
    console.log('BASELINE captured:');
    console.log('  totalRows:', fp.agg.totalRows, '| employees:', fp.agg.employees);
    console.log('  sumOT(min):', fp.agg.sumOtTotalMin, '| sumLate:', fp.agg.sumEffLateMin, '| sumConf:', fp.agg.sumConformance);
    console.log('  byMonth:', JSON.stringify(fp.agg.byMonth));
    console.log('Saved to', BASE, '\nNow upload the same files from the page, then run: node _parity_check.js compare');
  } else if (mode === 'compare') {
    const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
    const out = [];
    diff(base, fp, '', out);
    if (!out.length) {
      console.log('✅ PERFECT PARITY — upload reproduced the baseline EXACTLY.');
      console.log('  totalRows:', fp.agg.totalRows, '| sumOT:', fp.agg.sumOtTotalMin, '| sumConf:', fp.agg.sumConformance);
    } else {
      console.log('⚠️  DIFFERENCES FOUND (' + out.length + '):');
      out.forEach(l => console.log('  ' + l));
    }
  } else {
    console.log('Usage: node _parity_check.js [baseline|compare]');
  }
})();
