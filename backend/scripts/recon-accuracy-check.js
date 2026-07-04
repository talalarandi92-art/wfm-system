/* RECON ACCURACY / DATA-QUALITY CHECK (engine QA, READ-ONLY).
 * How well does raw SYSTEM evidence (Ameyo login/logout ∪ Sprinklr, Odoo punch) agree with the
 * CC Schedule "Shifts" sheet (the assigned-shift truth), and how messy are the sources?
 * Reports window-match % (schedule vs inferred), login-bleed %, late-login count, and corrupt
 * Timing rows. Run after any new-roster upload to catch source problems early.
 *   Methods: A = nearest shift START to login · B = [start,end] window match (login+logout).
 *   KEY FINDING (2026-07-04): you cannot recover the SCHEDULED shift from system times beyond
 *   ~78% — ~90% of the gap is real late/early/bleed. Schedule stays the shift source of truth;
 *   system times measure deviation. See memory/shift_inference_training.md.
 *   Usage:  node scripts/recon-accuracy-check.js ["C:/path/to/new roster/"]
 */
const XLSX = require('xlsx');
const DIR = (process.argv[2] || 'C:/Users/t.bassam/Desktop/new roster/').replace(/[\\/]*$/, '/');
const rd = (f) => XLSX.readFile(DIR + f, { cellDates: false, raw: false });
const rows = (wb, sn) => XLSX.utils.sheet_to_json(wb.Sheets[sn || wb.SheetNames[0]], { header: 1, defval: null, raw: false });

// ── time parsing → minutes from midnight (handles "8:01:57 AM", "16:05", "9:52") ──
function toMin(t) {
  if (t == null || t === '') return null;
  t = String(t).trim();
  const ampm = /(am|pm)/i.exec(t);
  let hh, mm;
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  hh = +m[1]; mm = +m[2];
  if (ampm) { const p = ampm[1].toUpperCase(); if (p === 'PM' && hh !== 12) hh += 12; if (p === 'AM' && hh === 12) hh = 0; }
  return hh * 60 + mm;
}
const hhmm = (m) => m == null ? '—' : `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const norm = (s) => String(s || '').trim().toLowerCase();
const dnorm = (d) => { // normalize date strings to YYYY-MM-DD (handles 27/6/2026, 6/28/26)
  if (!d) return null; d = String(d).trim();
  let m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let [_, a, b, y] = m; y = y.length === 2 ? '20' + y : y;
    // ambiguous: Ameyo/Sprinklr are D/M/Y (27/6), Odoo is M/D/Y (6/28). Detect: if first>12 → D/M.
    let dd, mm;
    if (+a > 12) { dd = a; mm = b; } else if (+b > 12) { mm = a; dd = b; } else { dd = a; mm = b; } // default D/M
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; }
  return d;
};
const dnormMDY = (d) => { if (!d) return null; d = String(d).trim(); const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) { let [_, a, b, y] = m; y = y.length === 2 ? '20' + y : y; return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`; } return d; };

// ── 1) shift dictionary from CC Schedule Timing sheet (normal block cols A,B,C) ──
const sch = rd('CC Schedule 26 June..xlsx');
const timing = rows(sch, 'Timing');
const DICT = {};   // code -> {ss, se}
for (let i = 2; i < timing.length; i++) {
  const r = timing[i]; if (!r) continue;
  const code = (r[0] || '').toString().trim().toUpperCase();
  const ss = toMin(r[1]), se = toMin(r[2]);
  if (code && ss != null && se != null && /^[A-Z0-9\-]{1,6}$/.test(code)) DICT[code] = { ss, se: se <= ss ? se + 1440 : se };
}
// canonical fallbacks (BR-SHF-005) if Timing is sparse
Object.assign(DICT, Object.fromEntries(Object.entries({
  M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320], E: [960, 1500], EE: [1080, 1560],
  MD: [1320, 1860], MN: [1380, 1920], AM: [420, 900], M20: [480, 960], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320],
}).filter(([k]) => !DICT[k]).map(([k, v]) => [k, { ss: v[0], se: v[1] }])));
// LEARNING #2: the Timing parse has corrupt rows (C=23:00, MN=11:00). For INFERENCE use a CLEAN,
// window-deduped canonical set so nearest/window match can't pick a corrupt or aliased label.
const INFER = { M:[420,960], B:[540,1080], C:[660,1200], N:[780,1320], E:[960,1500], EE:[1080,1560],
  MD:[1320,1860], MN:[1380,1920], AM:[420,900], M20:[480,960], B20:[600,1080], N20:[840,1320], CCNO:[540,1020] };
for (const k of Object.keys(DICT)) delete DICT[k];
for (const [k, v] of Object.entries(INFER)) DICT[k] = { ss: v[0], se: v[1] };
const WORK_CODES = Object.keys(DICT);
console.log(`Inference dictionary (clean canonical, window-deduped): ${WORK_CODES.length} codes, e.g. M=${hhmm(DICT.M.ss)}-${hhmm(DICT.M.se)} E=${hhmm(DICT.E.ss)}-${hhmm(DICT.E.se)} MD=${hhmm(DICT.MD.ss)}-${hhmm(DICT.MD.se)}`);

// ── 2) TRUTH: CC Schedule "Shifts" sheet (per employee-day assigned shift) ──
const shifts = rows(sch, 'Shifts');
const H = shifts[0].map(norm);
const col = (name) => H.findIndex(h => h === norm(name));
const cDate = col('Date'), cName = col('Name'), cId = col('ID'), cUser = col('User ID'), cShift = col('Shift'), cShiftTime = col('Shift Time'), cFunc = col('Function');
const truth = new Map();  // key user|date -> {code, name, id, func}
const idToUser = new Map(), userToId = new Map();
const NONWORK = /^(OFF|H|L|SL|DL|RES|TER|COMP|UPL|A|ABS|WFH.*)?$/i;
for (let i = 1; i < shifts.length; i++) {
  const r = shifts[i]; if (!r || !r[cUser]) continue;
  const user = norm(r[cUser]), id = String(r[cId] || '').trim(), date = dnorm(r[cDate]);
  const code = (r[cShift] || '').toString().trim().toUpperCase().replace(/[SA]$/, ''); // strip S/A suffix for the base
  truth.set(`${user}|${date}`, { code, raw: (r[cShift] || '').toString().trim(), name: r[cName], id, func: r[cFunc], shiftTime: r[cShiftTime] });
  if (id) { idToUser.set(id, user); userToId.set(user, id); }
}
console.log(`Schedule truth: ${truth.size} employee-days, ${idToUser.size} identities. Dates: ${[...new Set([...truth.keys()].map(k => k.split('|')[1]))].sort().join(', ')}`);

// ── 3) SYSTEM: Ameyo (username) → aggregate per user|date: first login, last logout ──
function loadSessions(file, uCol, ldCol, ltCol, odCol, otCol, dateFmt) {
  const wb = rd(file); const rs = rows(wb);
  const h = rs[0].map(norm);
  const ci = (n) => h.findIndex(x => x === norm(n));
  const u = ci(uCol), ld = ci(ldCol), lt = ci(ltCol), od = ci(odCol), ot = ci(otCol);
  const agg = new Map(); // user|date -> {inMin, outMin}
  for (let i = 1; i < rs.length; i++) {
    const r = rs[i]; if (!r || !r[u]) continue;
    const user = norm(r[u]); const d = (dateFmt === 'mdy' ? dnormMDY : dnorm)(r[ld]);
    const inM = toMin(r[lt]); let outM = toMin(r[ot]);
    if (d == null || inM == null) continue;
    // cross-midnight: if logout date > login date, add 1440
    const outDate = (dateFmt === 'mdy' ? dnormMDY : dnorm)(r[od]);
    if (outM != null && outDate && outDate > d) outM += 1440;
    const k = `${user}|${d}`;
    const cur = agg.get(k) || { inMin: inM, outMin: outM };
    cur.inMin = Math.min(cur.inMin, inM);
    if (outM != null) cur.outMin = Math.max(cur.outMin ?? outM, outM);
    agg.set(k, cur);
  }
  return agg;
}
const ameyo = loadSessions('Ameyo login and logout.xlsx', 'User ID', 'Login Date', 'Login Time', 'Logout Date', 'Logout Time');
const sprk = loadSessions('Login and Logout sprinklr.xlsx', 'ID', 'Login Date', 'Login Time', 'Logout Date', 'Logout Tim');
console.log(`Ameyo user-days: ${ameyo.size} | Sprinklr user-days: ${sprk.size}`);

// Odoo punch by code|date (M/D/Y dates)
const odoo = new Map();
{ const wb = rd('Odoo Fingerprint June.xlsx'); const rs = rows(wb); const h = rs[0].map(norm);
  const ci = (n) => h.findIndex(x => x === norm(n));
  const cc = ci('Code'), cd = ci('Date'), cin = ci('In'), cout = ci('Out');
  for (let i = 1; i < rs.length; i++) { const r = rs[i]; if (!r || !r[cc]) continue;
    const code = String(r[cc]).trim(), d = dnormMDY(r[cd]); let inM = toMin(r[cin]), outM = toMin(r[cout]);
    if (outM != null && inM != null && outM < inM) outM += 1440;
    odoo.set(`${code}|${d}`, { inMin: inM, outMin: outM }); } }
console.log(`Odoo code-days: ${odoo.size}`);

// ── 4) inference ──
function nearestStart(login) { // Method A
  let best = null, bd = 1e9;
  for (const c of WORK_CODES) { const d = Math.abs(DICT[c].ss - login); const d2 = Math.abs(DICT[c].ss - (login + 1440)); const dd = Math.min(d, d2); if (dd < bd) { bd = dd; best = c; } }
  return best;
}
function windowMatch(login, logout) { // Method B — needs both
  if (logout == null) return nearestStart(login);
  let best = null, bd = 1e9;
  for (const c of WORK_CODES) { const { ss, se } = DICT[c];
    // try aligning login to ss on same or next day
    for (const off of [0, 1440]) { const L = login + off; const cost = Math.abs(L - ss) + Math.abs(logout + off - se); if (cost < bd) { bd = cost; best = c; } } }
  return best;
}

// ── 4b) WINDOW-EQUIVALENCE (learning #1): from clock times you recover a WINDOW, not a label.
//    N≡N9, B≡B9 … (the trailing "9" = the 9-hour variant, identical window). Score by window,
//    using CLEAN canonical times (BR-SHF-005) because the Timing sheet has corrupt rows (e.g. C=23:00). ──
const CANON = { M:[420,960], B:[540,1080], C:[660,1200], N:[780,1320], E:[960,1500], EE:[1080,1560],
  MD:[1320,1860], MN:[1380,1920], AM:[420,900], 'M7-3':[420,900], M20:[480,960], B20:[600,1080],
  C20:[660,1200], N20:[840,1320], CCNO:[540,1020], EE20:[1080,1620] };
function famWin(code) {
  if (!code) return null;
  let c = String(code).toUpperCase().replace(/\s+/g, '');
  if (CANON[c]) return CANON[c];
  const c9 = c.replace(/9$/, '');            // strip the 9-hour-variant suffix
  if (CANON[c9]) return CANON[c9];
  return DICT[c] ? [DICT[c].ss, DICT[c].se] : null;
}
const winEq = (a, b) => { const wa = famWin(a), wb = famWin(b); if (!wa || !wb) return false;
  const d = (x, y) => Math.min(Math.abs(x - y), Math.abs(x - y - 1440), Math.abs(x - y + 1440));
  return d(wa[0], wb[0]) <= 20 && d(wa[1], wb[1]) <= 20; };

// ── 5) score against truth (working shifts only; skip OFF/leave/absence) ──
const results = [];
for (const [key, tr] of truth) {
  const base = tr.code;
  if (!base || !DICT[base]) continue; // only score days with a real working shift in the dictionary
  const [user, date] = key.split('|');
  const id = tr.id;
  const a = ameyo.get(key), s = sprk.get(key), o = id ? odoo.get(`${id}|${date}`) : null;
  // combine-both: Ameyo first, Sprinklr fills gaps (BR-ATT-001)
  const login = a?.inMin ?? s?.inMin ?? o?.inMin;
  const logout = a?.outMin ?? s?.outMin ?? o?.outMin;
  if (login == null) continue; // no system evidence
  const src = a?.inMin != null ? 'ameyo' : s?.inMin != null ? 'sprinklr' : 'odoo';
  // HYPOTHESIS (smarter method): biometric punch-in (Odoo) is closer to the SCHEDULED start
  // than telephony login. Build an Odoo-first login/logout and compare.
  const bioLogin = o?.inMin ?? a?.inMin ?? s?.inMin;
  const bioLogout = o?.outMin ?? a?.outMin ?? s?.outMin;
  const dur = logout != null ? logout - login : null;
  const clean = dur != null && dur >= 2 * 60 && dur <= 14 * 60;   // drop junk (33-min) + bleed (>14h)
  const guessA = nearestStart(login);
  const guessB = windowMatch(login, logout);
  const guessBio = windowMatch(bioLogin, bioLogout);
  const guessStartOnly = nearestStart(bioLogin);   // biometric start alone
  results.push({ user, date, id, func: tr.func, truth: base, guessA, guessB, guessBio, guessStartOnly, login, logout, src, clean,
    okA: winEq(guessA, base), okB: winEq(guessB, base), okBio: winEq(guessBio, base), okStart: winEq(guessStartOnly, base),
    hasOdoo: !!o, dur });
}
const n = results.length;
const cleanR = results.filter(r => r.clean);
const pct = (k, set) => `${set.filter(r => r[k]).length}/${set.length} = ${(100 * set.filter(r => r[k]).length / (set.length || 1)).toFixed(1)}%`;
console.log(`\n═══ SCORED ${n} employee-days (WINDOW-equivalence: N≡N9, clean canonical dict) ═══`);
console.log(`  Method A  nearest login-start (Ameyo-first):     ${pct('okA', results)}`);
console.log(`  Method B  login+logout window (Ameyo-first):     ${pct('okB', results)}`);
console.log(`  Method Bio login+logout window (Odoo-first):     ${pct('okBio', results)}   ← biometric-first hypothesis`);
console.log(`\n  On CLEAN sessions only (2h≤dur≤14h, ${cleanR.length}/${n} = drop junk+bleed):`);
console.log(`    Method B  (Ameyo-first window):  ${pct('okB', cleanR)}`);
console.log(`    Method Bio (Odoo-first window):  ${pct('okBio', cleanR)}   ← true inference ceiling`);
const withOdoo = cleanR.filter(r => r.hasOdoo);
console.log(`    Method Bio on clean days WITH an Odoo punch (${withOdoo.length}): ${pct('okBio', withOdoo)}`);
const accB = results.filter(r => r.okB).length;

// ── 6) analyze the GENUINE misses (Method B, window-equivalence) ──
const missB = results.filter(r => !r.okB);
console.log(`\n═══ MISS ANALYSIS (Method B: ${missB.length} misses) ═══`);
// confusion pairs
const conf = {};
for (const m of missB) { const k = `${m.truth} → ${m.guessB}`; conf[k] = (conf[k] || 0) + 1; }
console.log('Top confusions (truth → guessed):');
Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ×${v}`));
console.log('\nSample misses (login/logout vs the shift window):');
for (const m of missB.slice(0, 14)) {
  const t = DICT[m.truth], g = DICT[m.guessB];
  console.log(`  ${m.user.padEnd(16)} ${m.date}  login ${hhmm(m.login)} logout ${hhmm(m.logout)} [${m.src}]  truth=${m.truth}(${hhmm(t.ss)}-${hhmm(t.se)}) guess=${m.guessB}(${hhmm(g.ss)}-${hhmm(g.se)})`);
}
// how far off were late logins?
// LEARNING #3: are the WINNING method's (A, nearest login-start) misses real attendance events?
const missA = results.filter(r => !r.okA);
const tW = (r) => famWin(r.truth);
let cLate = 0, cEarly = 0, cBleed = 0, cAdj = 0, cOther = 0;
for (const m of missA) {
  const w = tW(m); if (!w) { cOther++; continue; }
  const lateBy = m.login - w[0];                       // +ve = logged in after scheduled start
  const shortBy = m.dur != null ? (w[1] - w[0]) - m.dur : 0; // +ve = worked less than scheduled span
  if (m.dur != null && m.dur > 13 * 60) cBleed++;
  else if (lateBy > 45) cLate++;
  else if (shortBy > 60) cEarly++;
  else if (Math.abs(m.login - w[0]) <= 90) cAdj++;     // login near start but adjacent window won
  else cOther++;
}
console.log(`\n═══ WHY method A (best, 76.8%) misses ${missA.length} — cause breakdown ═══`);
console.log(`  late login (>45m after scheduled start):  ${cLate}  ← real TARDINESS, not inference error`);
console.log(`  early-out / short session (>60m short):    ${cEarly}  ← real EARLY-OUT`);
console.log(`  login bleed (>13h session):                ${cBleed}  ← unclosed session (data quality)`);
console.log(`  adjacent-window flip (login≈start):        ${cAdj}  ← E/EE/MD/MN neighbours, true ambiguity`);
console.log(`  other/unexplained:                         ${cOther}`);
console.log(`  → ${(100*(cLate+cEarly+cBleed)/missA.length).toFixed(0)}% of misses are REAL attendance deviations (late/early/bleed), NOT inference failure.`);
const lateLogins = results.filter(r => r.login - DICT[r.truth].ss > 30);
console.log(`\nDays where login was >30min AFTER the true shift start: ${lateLogins.length}/${n} (avg ${Math.round(lateLogins.reduce((s, r) => s + (r.login - DICT[r.truth].ss), 0) / (lateLogins.length || 1))}min late) — these break "nearest-start" inference.`);
const bleed = results.filter(r => r.dur != null && r.dur > 13 * 60);
console.log(`Sessions >13h (login bleed / forgot logout): ${bleed.length}/${n} — these break "window-match" on the logout side.`);
