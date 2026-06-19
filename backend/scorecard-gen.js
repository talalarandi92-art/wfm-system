/* April Scorecard KPI-VALUES generator → outputs an Excel matching the W1 sheet
 * column order, weekly (W1-W4) + Final, ready to PASTE into the user's template
 * (template formulas then score it). Read-only on sources. */
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const D = 'C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
const OPS = 'C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/';
// ── MONTH CONFIG (run `SC_MONTH=may node scorecard-gen.js`) — April is the default/unchanged path ──
const MONTH = (process.env.SC_MONTH || 'april').toLowerCase();
const CFG = {
  april: {
    label: 'April', monthIdx: 3, SC: OPS + '4.April 26 SC..xlsx', scSheet: 'April SC',
    scored: 'April 26 Scorecard - SCORED.xlsx', filled: '4.April 26 SC - FILLED.xlsx',
    sprinklrBreak: 'sprinklr april break.xlsx', sprinklrDigitalWeeks: [4],
    chatAmeyoFile: 'CHAT AND WHATSAPP AMEYO FROM 1 TO 20 APRIL..xlsx',     // chat W1-3 on Ameyo
    surveyAmeyoFile: 'Survey Ameyo & ticket status FCR..xlsx',             // W1-3 FCR + RES/PRR
    caFiles: [['April week4.xlsx', 4]],   // cleaner April W4 Sprinklr CA (248 rows; AHT/FRT/FCR/CaseCount)
    surveyFiles: [['SPRINKLR SURVEY April WEEK 4.xlsx', 4]],
    qaFile: 'QA_Apr.xlsx', qaBarWeeks: [4], quizRe: /april.*quiz.*week/i, quizBarWeeks: [],
    rosterFromProductivity: false,
  },
  may: {
    label: 'May', monthIdx: 4, SC: OPS + '5.May 26 SC..xlsx', scSheet: 'May SC',
    scored: 'May 26 Scorecard - SCORED.xlsx', filled: '5.May 26 SC - FILLED.xlsx',
    sprinklrBreak: 'sprinklr may break.xlsx', sprinklrDigitalWeeks: [1, 2, 3, 4],
    chatAmeyoFile: null, surveyAmeyoFile: null,                            // May = uniformly Sprinklr
    caFiles: [['Agentwise-CaseAssignmentsVSChannel mAY WEEK 1 (1).xlsx', 1], ['Agentwise-CaseAssignmentsVSChannel mAY WEEK 2 (1).xlsx', 2],
              ['Agentwise-CaseAssignmentsVSChannel mAY WEEK 3 (1).xlsx', 3], ['Agentwise-CaseAssignmentsVSChannel mAY WEEK 4 (2).xlsx', 4],
              ['Agentwise-CaseAssignmentsVSChannel mAY WEEK 5 (1).xlsx', 4]],   // W5 (29-31) folds into W4
    surveyFiles: [['SPRINKLR SURVEY MAY WEEK 1.xlsx', 1], ['SPRINKLR SURVEY MAY WEEK 2.xlsx', 2], ['SPRINKLR SURVEY MAY WEEK 3.xlsx', 3],
                  ['SPRINKLR SURVEY MAY WEEK 4.xlsx', 4], ['SPRINKLR SURVEY MAY WEEK 5.xlsx', 4]],
    qaFile: null, qaBarWeeks: [1, 2, 3, 4], quizRe: /may.*quiz.*week/i, quizBarWeeks: [1, 2],
    rosterFromProductivity: true,                                          // include new joiners (template W1 lags)
  },
}[MONTH];
if (!CFG) { console.error('Unknown SC_MONTH:', MONTH); process.exit(1); }
const SC = CFG.SC;
const OUT = D + CFG.label + ' KPI values (paste into template).xlsx';
const SPRINKLR_BREAK_FILE = CFG.sprinklrBreak;
const SPRINKLR_DIGITAL_WEEKS = new Set(CFG.sprinklrDigitalWeeks);
// Sprinklr email-local → roster uid, for agents whose roster User ID differs from their email
const EMAIL_ALIAS = { 'm.hamdan': 'h.malak' };             // Malak Hamdan: email m.hamdan, roster uid h.malak

const rd = (file, name) => { const wb = XLSX.readFile(file); return XLSX.utils.sheet_to_json(wb.Sheets[name || wb.SheetNames[0]], { header: 1, defval: '' }); };
const norm = s => String(s ?? '').trim().toLowerCase();
const round1 = x => Math.round(x * 10) / 10;
// "Bar" = the THRESHOLD value (lowest value that earns the target score), NOT 100%.
const BAR_QA = 0.80;   // QA bar = 80% (lowest value earning a positive Quality score → band 80-89 = 10)
const BAR_FCR = 0.80;  // FCR bar = 80% (lowest value earning a positive FCR score → band 80-84 = 10)
const BAR_CTR = 0.90;  // CTR bar for VOICE (Inbound/Outbound/Refund) = 90% (→ band 90-94 = 5). Sprinklr funcs = 100%.

// ── SCORING (exact bands from the user's template) + round-half-up on every % ──
const rPct = v => (v === '' || v == null || isNaN(v)) ? null : Math.round(Number(v) * 100);   // → integer %
const sQuality = v => { const p = rPct(v); return p == null ? '' : p >= 95 ? 30 : p >= 90 ? 20 : p >= 80 ? 10 : p >= 65 ? -10 : -20; };
const sPRRea = (prr, res) => { const pp = rPct(prr), rr = rPct(res); return (pp != null && rr != null && pp >= 80 && rr >= 10) ? 2.5 : 0; };  // points & bonus each
const sAHT = a => (a === '' || a == null) ? '' : (Number(a) * 24 <= 48 ? 10 : -10);
const sFCR = v => { const p = rPct(v); return p == null ? '' : p >= 85 ? 20 : p >= 80 ? 10 : p >= 75 ? 5 : -10; };
const sProd = v => { const p = rPct(v); return p == null ? '' : p >= 91 ? 15 : p === 90 ? 10 : p === 89 ? 5 : p <= 86 ? -15 : 0; };
const sCTR = v => { const p = rPct(v); return p == null ? '' : p >= 95 ? 10 : (p >= 90 && p <= 94) ? 5 : p < 90 ? -10 : ''; };
const sQuizF = v => { const p = rPct(v); return p == null ? '' : (p >= 90 && p <= 95) ? 5 : (p > 95 && p <= 100) ? 10 : p < 90 ? -10 : ''; };
const sMist = m => (m === '' || m == null) ? 15 : 15 - (Number(m) * 5);
const sRT = rt => (rt === '' || rt == null) ? '' : Number(rt) <= 1 / 24 ? 15 : Number(rt) <= 2 / 24 ? 10 : Number(rt) <= 4 / 24 ? 5 : -15;
const numOr0 = x => (x === '' || x == null || isNaN(x)) ? 0 : Number(x);
// April weeks: W1 1-7, W2 8-14, W3 15-21, W4 22-30
const wkOf = serial => { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000); if (d.getUTCMonth() !== CFG.monthIdx) return 0; const day = d.getUTCDate(); return day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4; };
const WEEKS = [1, 2, 3, 4];

// ── roster (66 agents) ──
function buildRoster() {
  // UNION of all template sources so NO agent is missed: W1 sheet + Productivity blocks (new joiners)
  // + the main <Month> SC 26 sheet (agents that exist only there). Keyed by ID, first source wins.
  const byId = {};
  const add = (name, id, uid, tm, func) => {
    id = Number(id); if (!id || isNaN(id)) return;
    name = String(name || '').trim(); func = String(func || '').trim();
    if (!byId[id]) { byId[id] = { name, id, uid: norm(uid), tm: tm || '', func }; return; }
    const e = byId[id];                                  // backfill missing fields from later sources
    if (!e.name && name) e.name = name; if (!e.func && func) e.func = func; if (!e.uid && uid) e.uid = norm(uid); if (!e.tm && tm) e.tm = tm;
  };
  // 1. W1 weekly sheet (A Name, B ID, C UserID, D TM, E Function)
  rd(SC, 'W1').slice(1).forEach(r => { if (r[0] && r[1]) add(r[0], r[1], r[2], r[3], r[4]); });
  // 2. Productivity sheet blocks
  try {
    const pr = rd(SC, 'Productivity'); const h = pr[0]; const marks = []; h.forEach((x, i) => { if (/^W[1-5]$/.test(String(x).trim())) marks.push(i); });
    marks.forEach((col, idx) => {
      const end = idx + 1 < marks.length ? marks[idx + 1] : h.length;
      let cN = -1, cId = -1, cU = -1, cT = -1, cF = -1;
      for (let c = col; c < end; c++) { const s = String(h[c]).trim().toLowerCase(); if (s === 'name' && cN < 0) cN = c; if (s === 'id' && cId < 0) cId = c; if (s === 'user id' && cU < 0) cU = c; if (s === 'team manager' && cT < 0) cT = c; if (s === 'function' && cF < 0) cF = c; }
      if (cId < 0) return;
      for (let i = 1; i < pr.length; i++) { const r = pr[i]; add(r[cN], r[cId], r[cU], r[cT], r[cF]); }
    });
  } catch (e) { }
  // 3. main <Month> SC 26 sheet — detect columns BY HEADER NAME (the leading-empty-col-A offset varies).
  try {
    const wbx = XLSX.readFile(SC); const sn = wbx.SheetNames.find(n => /SC 26/i.test(n));
    if (sn) {
      const m = XLSX.utils.sheet_to_json(wbx.Sheets[sn], { header: 1, defval: '' });
      const hr = m.findIndex(r => r.some(c => /^agent$/i.test(String(c))) && r.some(c => /^weeks$/i.test(String(c))));
      if (hr >= 0) {
        const H = m[hr].map(x => String(x).trim().toLowerCase());
        const cA = H.indexOf('agent'), cId = H.indexOf('id'), cU = H.indexOf('user id'), cF = H.indexOf('function'), cT = H.findIndex(s => s === 'tl' || s === 'team leader' || s === 'team manager');
        if (cA >= 0 && cId >= 0) for (let i = hr + 1; i < m.length; i++) { const r = m[i]; if (r[cA] && r[cId]) add(r[cA], r[cId], cU >= 0 ? r[cU] : '', cT >= 0 ? r[cT] : '', cF >= 0 ? r[cF] : ''); }
      }
    }
  } catch (e) { }
  return Object.values(byId).filter(a => a.func && a.name);
}
const SUPPORT_RE = /rta|leader|specialist|customer care|support/i;   // excluded from scorecard
const roster = buildRoster().filter(a => !SUPPORT_RE.test(a.func));
const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const byUid = {}; roster.forEach(a => byUid[a.uid] = a); const byId = {}; roster.forEach(a => byId[a.id] = a);
const byName = {}; roster.forEach(a => byName[cleanName(a.name)] = a);
const tight = s => cleanName(s).replace(/[^a-z]/g, '');           // spaces/spelling-tolerant key
const byTight = {}; roster.forEach(a => byTight[tight(a.name)] = a);
const matchName = nm => byName[cleanName(nm)] || byTight[tight(nm)] || null;
const VOICE = f => f === 'Inbound' || f === 'Outbound' || f === 'OMT';   // OMT = outbound voice team
const REFUND = f => f === 'Refund';
const CHAT = f => /CH - WA/i.test(f);
const SMEMAIL = f => /Social Media|Mail/i.test(f);

// per-agent per-week accumulator
const K = {}; // uid -> wk -> {ahtSum,ahtN,conn, chatDurSum,chatN, frtSum,frtN, tickets,closed, fbN,fbPos}
const acc = (uid, wk) => { const a = (K[uid] = K[uid] || {}); return (a[wk] = a[wk] || { ahtSum: 0, ahtN: 0, conn: 0, cdSum: 0, cdN: 0, frtSum: 0, frtN: 0, tk: 0, cl: 0, fbN: 0, fbPos: 0 }); };

// ── voice AHT + connected (Inbound/Outbound) ──
for (const vf of ['Inbound.xlsx', 'Outbound.xlsx']) {
  const isIn = vf === 'Inbound.xlsx';
  const rows = rd(D + vf); // hdr row0: Interval Start(0),..,User ID(5),..,Total Wrapped Calls(10),Avg Handling Time(11)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const wk = wkOf(r[0]); if (!wk) continue; const uid = norm(r[5]); const ag = byUid[uid]; if (!ag) continue;
    // AHT per the agent's OWN channel: Inbound-function ← Inbound file, Outbound ← Outbound file
    if (!VOICE(ag.func)) continue;
    if ((ag.func === 'Inbound') !== isIn) continue;   // Inbound func ← Inbound file; Outbound/OMT ← Outbound file
    const a = acc(uid, wk); if (typeof r[11] === 'number') { a.ahtSum += r[11]; a.ahtN++; } if (typeof r[10] === 'number') a.conn += r[10];
  }
}
// ── chat AHT + FRT (CHAT AMEYO, W1-3) ──
{
  if (CFG.chatAmeyoFile) {
    const rows = rd(D + CFG.chatAmeyoFile); // Chat Time(0),Served by(2),Status(3),FRT(4),...,Total Chat Duration(6)
    for (let i = 1; i < rows.length; i++) { const r = rows[i]; const wk = wkOf(r[0]); if (!wk) continue; const uid = norm(r[2]); if (!byUid[uid]) continue; const a = acc(uid, wk); if (typeof r[6] === 'number') { a.cdSum += r[6]; a.cdN++; } if (typeof r[4] === 'number') { a.frtSum += r[4]; a.frtN++; } }
  }
}
// ── Survey Ameyo: FCR (Closed/total), FRT, RES/PRR (feedback1) by week ──
const fbVals = {};
if (CFG.surveyAmeyoFile) {
  const wb = XLSX.readFile(D + CFG.surveyAmeyoFile);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  // hdr: Created On(0),time(1),Queue(2),Channel(3),...,Status(6),Agent(7),..,Time To Response(9),..,feedback1(13),feedback2(14)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const wk = wkOf(r[0]); if (!wk) continue; const uid = norm(r[7]); if (!byUid[uid]) continue;
    const a = acc(uid, wk); a.tk++; if (/closed/i.test(r[6])) a.cl++;
    if (typeof r[9] === 'number') { a.frtSum += r[9]; a.frtN++; }
    const fb = r[13]; if (fb !== '' && fb != null) { a.fbN++; fbVals[fb] = (fbVals[fb] || 0) + 1; if (/yes|positive|happy|satisf|^5$|^4$|good/i.test(String(fb))) a.fbPos++; }
  }
}
console.log('feedback1 distinct values (top):', JSON.stringify(Object.entries(fbVals).sort((a, b) => b[1] - a[1]).slice(0, 8)));

// ── Sprinklr Case-Assignments → SPR[uid][wk] = {aht,frt,fcr} (FCR/AHT/FRT live in
//    this file; keyed by AGENT NAME; aggregate across social networks weighted by case count) ──
const SPR = {};
function loadCA(file, wk) {
  let r; try { r = rd(D + file); } catch (e) { console.log('CA missing:', file); return 0; }
  // exact match on the header cell (the title row also CONTAINS "Social Network")
  const hr = r.findIndex(row => String(row[0]).trim().toLowerCase() === 'social network'); if (hr < 0) return 0;
  const h = r[hr];
  // locate columns by HEADER NAME (layout differs between exports)
  const cName = h.findIndex(x => /last engaged user/i.test(String(x)));
  const cCnt = h.findIndex(x => /case count/i.test(String(x)));
  const cFrt = h.findIndex(x => /first response time/i.test(String(x)));
  const cFcr = h.findIndex(x => /first contact closure/i.test(String(x)));
  // AHT: prefer the real handling time ("Avg. Handling Time"), NOT the case-open duration ("...(Case)")
  let cAht = h.findIndex(x => /handling time/i.test(String(x)) && !/case/i.test(String(x)));
  if (cAht < 0) cAht = h.findIndex(x => /handling time/i.test(String(x)));
  const agg = {};
  for (let i = hr + 1; i < r.length; i++) {
    const row = r[i]; const nm = cleanName(row[cName >= 0 ? cName : 1]); if (!nm) continue; const a = matchName(nm); if (!a) continue;
    const cnt = Number(row[cCnt >= 0 ? cCnt : 2]) || 0; if (!cnt) continue;
    let fcr = row[cFcr]; if (typeof fcr === 'string') fcr = parseFloat(fcr.replace('%', '')) / 100; fcr = Number(fcr) || 0;
    const g = (agg[a.uid] = agg[a.uid] || { aht: 0, frt: 0, fcr: 0, cnt: 0 });
    g.aht += (Number(row[cAht]) || 0) * cnt; g.frt += (Number(row[cFrt]) || 0) * cnt; g.fcr += fcr * cnt; g.cnt += cnt;
  }
  let m = 0; for (const uid in agg) {
    const g = agg[uid]; const prev = SPR[uid]?.[wk];   // MERGE if this week already loaded (e.g. May W4 = WEEK4+WEEK5)
    const pc = prev ? prev.cnt : 0, cnt = g.cnt + pc;
    (SPR[uid] = SPR[uid] || {})[wk] = {
      aht: (g.aht + (prev ? prev.aht * pc : 0)) / cnt,
      frt: (g.frt + (prev ? prev.frt * pc : 0)) / cnt,
      fcr: (g.fcr + (prev ? prev.fcr * pc : 0)) / cnt, cnt,
    }; m++;
  }
  return m;
}
for (const [file, wk] of CFG.caFiles) console.log(`CA ${file} (wk${wk}) matched:`, loadCA(file, wk));

// ── Sprinklr survey (RES/PRR) → SRV[uid][wk] = {yes,no} (by agent NAME) ──
const SRV = {};
function loadSurvey(file, wk) {
  let r; try { r = rd(D + file); } catch (e) { console.log('survey missing:', file); return 0; }
  const hr = r.findIndex(row => /resolve your issue|were we able/i.test(String(row[0])));
  const start = hr >= 0 ? hr + 1 : 1;
  let m = 0;
  for (let i = start; i < r.length; i++) {
    const row = r[i]; const ans = String(row[0]).trim().toLowerCase(); const nm = cleanName(row[1]); const cnt = Number(row[2]) || 0;
    if (!nm || !cnt) continue; const a = matchName(nm); if (!a) continue;
    const w = ((SRV[a.uid] = SRV[a.uid] || {})[wk] = SRV[a.uid][wk] || { yes: 0, no: 0 });
    if (ans === 'yes') w.yes += cnt; else if (ans === 'no') w.no += cnt; m++;
  }
  return Object.keys(SRV).length;
}
for (const [file, wk] of CFG.surveyFiles) loadSurvey(file, wk);
console.log('survey agents loaded:', Object.keys(SRV).length);

// ── QA (QA_Apr): per agent per week ──
const QA = {};
if (CFG.qaFile) {
  const qaRows = rd(D + CFG.qaFile); const qaH = qaRows[0];
  for (let i = 1; i < qaRows.length; i++) { const r = qaRows[i]; const qid = Number(String(r[1] ?? '').replace(/\s+/g, '')); if (!qid || isNaN(qid)) continue; QA[qid] = QA[qid] || {}; qaH.forEach((h, c) => { const m = String(h).match(/WK0?(\d).*C\d/i); if (m && typeof r[c] === 'number') { const wk = +m[1]; (QA[qid][wk] = QA[qid][wk] || []).push(r[c]); } }); }   // strip spaces in ID
}
// Weeks with no QA captured → Quality = BAR (per user). qaBarWeeks per month config.
const qaBar = new Set(CFG.qaBarWeeks);
const qa = (id, wk) => { if (qaBar.has(wk)) return BAR_QA; const x = QA[id]?.[wk]; return x && x.length ? round1(x.reduce((s, v) => s + v, 0) / x.length * 100) / 100 : ''; };

// ── Quiz (April Week N files): match by email-local OR name (filenames have odd
//    spaces, so discover them via readdir, never hardcode). ──
const QZ = {};
const quizFileWeeks = new Set();   // weeks that HAD a quiz (absence of a score = didn't solve)
const quizFiles = fs.readdirSync(D).filter(f => CFG.quizRe.test(f) && /\.xlsx$/i.test(f));   // incl. "New Joiners" files
let qzMatched = 0, qzUnmatched = 0;
for (const f of quizFiles) {
  const m = f.match(/week\s*(\d)/i); if (!m) continue; const wk = +m[1]; if (!WEEKS.includes(wk)) continue; quizFileWeeks.add(wk);
  const q = rd(D + f); const h = q[0];
  const e = h.findIndex(c => /email/i.test(c)); const n = h.findIndex(c => /^name$/i.test(c) || /your name|full name/i.test(c) || /name/i.test(c)); const p = h.findIndex(c => /total points/i.test(c));
  for (let i = 1; i < q.length; i++) {
    const pts = q[i][p]; if (typeof pts !== 'number') continue;
    const em = norm(q[i][e]).split('@')[0]; const nm = cleanName(q[i][n]);
    const a = byUid[em] || matchName(nm);
    if (a) { (QZ[a.uid] = QZ[a.uid] || {})[wk] = pts; qzMatched++; } else qzUnmatched++;
  }
}
console.log('quiz files:', quizFiles.length, '| matched:', qzMatched, 'unmatched:', qzUnmatched);
// quiz value: bar weeks (e.g. May W1-2) → everyone gets the bar (100 → top band); else the agent's score.
const quizBar = new Set(CFG.quizBarWeeks);
const quizOf = (uid, wk) => quizBar.has(wk) ? 100 : (QZ[uid]?.[wk] ?? '');

// ── Productivity PER WEEK via the user's formula (decoded from May sheet cols X/Y/Z/AA):
//    X = WD×9h (×7 for maternity *7 shifts) ; Y = X − break ; Z = Y/X ; sick penalty on Z.
//    break = "Short Break" (sheet) for voice funcs ; Bio+Tea+Lunch (Sprinklr) for digital funcs.
//    Productivity sheet has W1..W5 blocks each carrying WD / WD% / Short Break / Sick. ──
const MATERNITY = new Set(['h.mohanna', 's.saoud']);   // 7-hour shift (Haya Mohanna, Shaima Saoud) — *7 codes
const PROD = {};    // uid -> wk -> { wdc, wdpct, sbreak, sick }
const PRODM = {};   // uid -> monthly productivity% (sheet, fallback only)
{
  const pr = rd(SC, 'Productivity'); const h = pr[0];
  const marks = []; h.forEach((x, i) => { const m = String(x).trim().match(/^W([1-5])$/); if (m) marks.push({ wk: +m[1], col: i }); });
  const monthlyProdCol = h.findIndex(x => /productivity/i.test(String(x)));
  marks.forEach((mk, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].col : h.length;
    let cId = -1, cWd = -1, cWdp = -1, cSick = -1; const cBreaks = [];
    for (let c = mk.col; c < end; c++) {
      const s = String(h[c]).trim().toLowerCase();
      if (s === 'id' && cId < 0) cId = c;
      if (s === 'wd' && cWd < 0) cWd = c;
      if (s === 'wd%' && cWdp < 0) cWdp = c;
      if (/break/.test(s)) cBreaks.push(c);                 // ANY "*break*" column → total break
      if (/^sick/.test(s) && cSick < 0) cSick = c;
    }
    if (cId < 0) return;
    for (let i = 1; i < pr.length; i++) {
      const row = pr[i]; const id = row[cId]; if (!id || isNaN(id)) continue; const a = byId[Number(id)]; if (!a) continue;
      const rec = ((PROD[a.uid] = PROD[a.uid] || {})[mk.wk] = PROD[a.uid][mk.wk] || {});
      if (cWd >= 0 && typeof row[cWd] === 'number') rec.wdc = row[cWd];
      if (cWdp >= 0 && typeof row[cWdp] === 'number') rec.wdpct = row[cWdp];
      if (cBreaks.length) rec.sbreak = cBreaks.reduce((s, cc) => s + (typeof row[cc] === 'number' ? row[cc] : 0), 0);
      if (cSick >= 0 && typeof row[cSick] === 'number') rec.sick = row[cSick];
      if (mk.col === 0 && monthlyProdCol >= 0 && typeof row[monthlyProdCol] === 'number') PRODM[a.uid] = row[monthlyProdCol];
    }
  });
}
const wdOf = (uid, wk) => { const v = PROD[uid]?.[wk]?.wdpct; return typeof v === 'number' ? v : ''; };
// Quiz-commitment: present that week but did NOT solve the quiz → note + (−5 commitment). On leave → no note.
const presentInWeek = (uid, wk) => { const wd = PROD[uid]?.[wk]?.wdc; return typeof wd === 'number' && wd > 0; };
// On leave that week = a productivity record exists but 0 working days (full leave/off week).
const onLeaveWeek = (uid, wk) => { const r = PROD[uid]?.[wk]; return !!r && typeof r.wdc === 'number' && r.wdc === 0; };
const quizMiss = (a, wk) => quizFileWeeks.has(wk) && (QZ[a.uid]?.[wk] == null) && presentInWeek(a.uid, wk);
const quizMissNote = (a, wk) => quizMiss(a, wk) ? "didn't solve quiz (−5 commitment)" : '';

// Sprinklr digital break (Bio + Tea + Lunch) per agent(email-local) per week
const SPB = {};   // uid -> wk -> break (day-fraction)
(function loadSprinklrBreak() {
  let rows; try { rows = rd(D + SPRINKLR_BREAK_FILE); } catch (e) { console.log('Sprinklr break file not found:', SPRINKLR_BREAK_FILE); return; }
  let hr = rows.findIndex(r => String(r[0]).trim().toLowerCase() === 'date');   // real header row (title row also contains "Agent Email ID")
  if (hr < 0) hr = rows.findIndex(r => r.filter(x => x !== '').length > 3);
  const H = rows[hr].map(x => String(x).trim().toLowerCase());
  const cE = H.findIndex(s => /agent email/.test(s)), cD = H.findIndex(s => s === 'date');
  const brkCols = []; H.forEach((s, i) => { if (/break/.test(s)) brkCols.push(i); });   // ANY status with "break" = total break
  console.log('Sprinklr break columns:', brkCols.map(i => H[i]).join(' + '));
  let n = 0;
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i]; const d = r[cD]; if (typeof d !== 'number') continue; const wk = wkOf(d); if (!wk) continue;
    let uid = String(r[cE] || '').split('@')[0].toLowerCase().trim(); if (!uid) continue; uid = EMAIL_ALIAS[uid] || uid;
    const brk = brkCols.reduce((s, ci) => s + (typeof r[ci] === 'number' ? r[ci] : 0), 0);
    (SPB[uid] = SPB[uid] || {}); SPB[uid][wk] = (SPB[uid][wk] || 0) + brk; n++;
  }
  console.log('Sprinklr break rows:', n, '| agents:', Object.keys(SPB).length);
})();

// productivity% via the user's formula, per agent/week (returns fraction)
const isDigital = f => CHAT(f) || SMEMAIL(f);
// break per agent/week: digital → Sprinklr (Bio+Tea+Lunch) when present (W4 Apr / all May), else
// the sheet's Short Break (Ameyo, e.g. CH-WA W1-3 Apr); voice → always sheet Short Break.
function breakOf(a, wk, rec) {
  if (isDigital(a.func) && SPRINKLR_DIGITAL_WEEKS.has(wk)) return SPB[a.uid]?.[wk] ?? 0;   // Sprinklr (Bio+Tea+Lunch)
  return typeof rec?.sbreak === 'number' ? rec.sbreak : 0;                                   // Ameyo sheet Short Break
}
function prodOf(a, wk) {
  const rec = PROD[a.uid]?.[wk]; if (!rec || typeof rec.wdc !== 'number' || rec.wdc <= 0) return '';
  const hrs = MATERNITY.has(a.uid) ? 7 : 9;
  const X = rec.wdc * hrs / 24;                                   // total hours as day-fraction
  let Z = (X - breakOf(a, wk, rec)) / X;
  const sick = typeof rec.sick === 'number' ? rec.sick : 0;
  if (sick === 1) Z -= 0.02; else if (sick === 2) Z -= 0.05;     // user's IF (no penalty for >2)
  return Math.round(Z * 10000) / 10000;
}
function prodFinal(a) {                                            // whole month: one formula on summed WD/break
  let wd = 0, brk = 0, sick = 0;
  for (const wk of WEEKS) { const rec = PROD[a.uid]?.[wk]; if (!rec) continue;
    if (typeof rec.wdc === 'number') wd += rec.wdc;
    brk += breakOf(a, wk, rec);
    if (typeof rec.sick === 'number') sick += rec.sick;
  }
  if (wd <= 0) return PRODM[a.uid] ?? '';
  const hrs = MATERNITY.has(a.uid) ? 7 : 9; const X = wd * hrs / 24;
  let Z = (X - brk) / X; if (sick === 1) Z -= 0.02; else if (sick >= 2) Z -= 0.05;
  return Math.round(Z * 10000) / 10000;
}

// ── build rows: per week + Final ──
const mmss = f => f; // keep day-fraction number for AHT/FRT (template formats as time)
function kpiRow(a, wk) {
  // On leave that week (0 working days) → don't score; row stays blank + "on leave" note.
  if (onLeaveWeek(a.uid, wk)) return [a.name, a.id, a.uid, a.tm, a.func, '', '', '', '', '', '', '', '', '', '', ''];
  const k = K[a.uid]?.[wk] || {};
  let aht = '', frt = '', fcr = '', ctr = '', res = '', prr = '';
  const spr = SPR[a.uid]?.[wk];
  // WEEKS = real values per criteria (weeks are review-for-improvement). Bar KPIs (CTR/FCR peak) → Final only.
  if (VOICE(a.func)) { aht = k.ahtN ? k.ahtSum / k.ahtN : ''; }                  // real AHT; CTR/FCR blank (bar on Final)
  else if (REFUND(a.func)) { /* no real CTR/FCR in peak — blank weeks; bar on Final */ }
  else if (CHAT(a.func)) {
    if (SPRINKLR_DIGITAL_WEEKS.has(wk)) { if (spr) { aht = spr.aht; frt = spr.frt; fcr = round1(spr.fcr * 100) / 100; } }   // Sprinklr (Apr W4 / all May)
    else { aht = k.cdN ? k.cdSum / k.cdN : ''; frt = k.frtN ? k.frtSum / k.frtN : ''; fcr = k.tk ? round1(k.cl / k.tk * 100) / 100 : ''; }   // Ameyo
    /* CTR bar → Final only (blank weeks) */
  }
  else if (SMEMAIL(a.func)) { if (spr) { aht = spr.aht; frt = spr.frt; fcr = round1(spr.fcr * 100) / 100; } /* CTR bar → Final */ }
  // RES/PRR: prefer Sprinklr survey (chat/SM weeks on Sprinklr) → else Ameyo feedback
  const sv = SRV[a.uid]?.[wk];
  if (sv && (sv.yes + sv.no) > 0) {
    const resp = sv.yes + sv.no; const denom = (spr && spr.cnt) ? spr.cnt : (k.tk || resp);
    res = Math.min(1, round1(resp / denom * 100) / 100); prr = round1(sv.yes / resp * 100) / 100;   // RES is a rate ≤100%
  } else {
    if (k.tk) res = Math.min(1, round1(k.fbN / k.tk * 100) / 100);
    if (k.fbN) prr = round1(k.fbPos / k.fbN * 100) / 100;
  }
  const mist = quizMiss(a, wk) ? 1 : '';   // didn't-solve-quiz → +1 Common Mistake (Mistakes Score −5)
  return [a.name, a.id, a.uid, a.tm, a.func, wdOf(a.uid, wk), qa(a.id, wk), res, prr, aht, fcr, prodOf(a, wk), ctr, quizOf(a.uid, wk), frt, mist];
}
function finalRow(a) {
  // Final = whole-month aggregate from raw; QA/Quiz = avg of weeks
  let ahtS = 0, ahtN = 0, cd = 0, cdN = 0, frtS = 0, frtN = 0, tk = 0, cl = 0, fbN = 0, fbP = 0, conn = 0;
  for (const wk of WEEKS) { const k = K[a.uid]?.[wk]; if (!k) continue; ahtS += k.ahtSum; ahtN += k.ahtN; cd += k.cdSum; cdN += k.cdN; frtS += k.frtSum; frtN += k.frtN; tk += k.tk; cl += k.cl; fbN += k.fbN; fbP += k.fbPos; conn += k.conn; }
  let aht = '', frt = '', fcr = '', ctr = '', res = '', prr = '';
  if (VOICE(a.func)) { aht = ahtN ? ahtS / ahtN : ''; fcr = BAR_FCR; ctr = BAR_CTR; }
  else if (REFUND(a.func)) { fcr = BAR_FCR; ctr = BAR_CTR; }
  else if (CHAT(a.func) || SMEMAIL(a.func)) {
    // Final = volume-weighted blend across ALL weeks, each week from its own source:
    // Sprinklr weeks (SPRINKLR_DIGITAL_WEEKS) ← CA; other weeks ← Ameyo (chat only). (May = all Sprinklr.)
    let aN = 0, aD = 0, fN = 0, fD = 0, cN = 0, cD = 0;
    for (const wk of WEEKS) {
      if (SPRINKLR_DIGITAL_WEEKS.has(wk)) { const s = SPR[a.uid]?.[wk]; if (s && s.cnt) { aN += s.aht * s.cnt; aD += s.cnt; fN += s.frt * s.cnt; fD += s.cnt; cN += s.fcr * s.cnt; cD += s.cnt; } }
      else if (CHAT(a.func)) { const k = K[a.uid]?.[wk]; if (k) { aN += k.cdSum; aD += k.cdN; fN += k.frtSum; fD += k.frtN; if (k.tk) { cN += k.cl; cD += k.tk; } } }
    }
    aht = aD ? aN / aD : ''; frt = fD ? fN / fD : ''; fcr = cD ? round1(cN / cD * 100) / 100 : ''; ctr = 1;
  }
  // RES/PRR Final: Ameyo feedback (W1-3) blended with Sprinklr survey (W4)
  let svResp = 0, svYes = 0, sprCnt = 0;
  for (const wk of WEEKS) { const sv = SRV[a.uid]?.[wk]; if (sv) { svResp += sv.yes + sv.no; svYes += sv.yes; } if (SPRINKLR_DIGITAL_WEEKS.has(wk)) sprCnt += SPR[a.uid]?.[wk]?.cnt || 0; }
  const totResp = fbN + svResp, totYes = fbP + svYes, denom = tk + sprCnt;   // Ameyo feedback (W1-3) + Sprinklr survey (all Sprinklr weeks)
  if (denom) res = Math.min(1, round1(totResp / denom * 100) / 100); if (totResp) prr = round1(totYes / totResp * 100) / 100;
  const qaW = WEEKS.map(w => qa(a.id, w)).filter(v => v !== ''); const qaAvg = qaW.length ? round1(qaW.reduce((s, v) => s + v, 0) / qaW.length * 100) / 100 : '';
  const qzW = WEEKS.map(w => quizOf(a.uid, w)).filter(v => v !== '' && v != null); const qzAvg = qzW.length ? Math.round(qzW.reduce((s, v) => s + v, 0) / qzW.length) : '';
  const wdW = WEEKS.map(w => wdOf(a.uid, w)).filter(v => v !== ''); const wdAvg = wdW.length ? round1(wdW.reduce((s, v) => s + v, 0) / wdW.length * 100) / 100 : '';
  const totMiss = WEEKS.filter(w => quizMiss(a, w)).length;   // total didn't-solve-quiz weeks → Final Common Mistakes
  return [a.name, a.id, a.uid, a.tm, a.func, wdAvg, qaAvg, res, prr, aht, fcr, prodFinal(a), ctr, qzAvg, frt, (totMiss || '')];
}

// ── FILL THE TEMPLATE'S W1-W5 sheets (SC sheet VLOOKUPs+formulas auto-score) ──
// W-sheet cols (1-based): A Name,B ID,C UserID,D TM,E Function,F WD%,G QA,H RES%,
//   I PRR%,J AHT,K FCR%,L Productivity%,M CTR%,N Quiz,O ResponseTime,P CommonMistakes
// kpiRow order: [name,id,uid,tm,func,wd,qa,res,prr,aht,fcr,prod,ctr,quiz,rt,mist]
const OUT_FILLED = process.env.FILLED_OUT || (D + CFG.filled);
const SHEET_OF = { 1: 'W1', 2: 'W2', 3: 'W3', 4: 'W4', Final: 'W5' };
const num = v => (v === '' || v == null || isNaN(v)) ? null : Number(v);
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SC);
  // exceljs re-emits the template's conditional formatting as EMPTY <conditionalFormatting/> (no <cfRule>),
  // which Excel rejects as "unreadable content" → repair. Strip CF from the sheets we write.
  for (const sn of Object.values(SHEET_OF)) { const w = wb.getWorksheet(sn); if (w) w.conditionalFormattings = []; }
  const fill = (sheetName, rowsByUid) => {
    const ws = wb.getWorksheet(sheetName); if (!ws) { console.log('missing sheet', sheetName); return; }
    let filled = 0;
    ws.eachRow((row, n) => {
      const id = row.getCell(2).value; if (!id || isNaN(id)) return;       // col B = ID
      const a = byId[Number(id)]; if (!a) return;
      const v = rowsByUid(a); if (!v) return;
      // v = kpiRow/finalRow array → write F..O
      row.getCell(6).value = num(v[5]);   // WD%
      row.getCell(7).value = num(v[6]);   // QA
      row.getCell(8).value = num(v[7]);   // RES%
      row.getCell(9).value = num(v[8]);   // PRR%
      row.getCell(10).value = num(v[9]);  // AHT (day-fraction time)
      row.getCell(11).value = num(v[10]); // FCR%
      row.getCell(12).value = num(v[11]); // Productivity%
      row.getCell(13).value = num(v[12]); // CTR%
      const qz = num(v[13]); row.getCell(14).value = qz == null ? null : qz / 100;  // Quiz as FRACTION
      row.getCell(15).value = num(v[14]); // Response Time (day-fraction time)
      row.getCell(16).value = num(v[15]); // Common Mistakes (quiz-miss → 1 → Mistakes Score −5)
      filled++;
    });
    console.log(sheetName + ': filled ' + filled + ' agent rows');
  };
  for (const wk of WEEKS) fill(SHEET_OF[wk], a => kpiRow(a, wk));
  fill(SHEET_OF.Final, a => finalRow(a));

  // ── APPEND NEW JOINERS (in roster but missing from the template) — clone the formula block of an
  //    existing agent OF THE SAME FUNCTION (per-function pattern), rewriting same-row refs. ──
  const reRef = (f, S, R) => f.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (m, col, abs, row) => (abs === '' && Number(row) === S) ? `${col}${abs}${R}` : m);
  {
    const main = wb.worksheets.find(w => /SC 26/i.test(w.name));
    let hr = 0; main.eachRow((r, n) => { if (hr) return; let a = false, w = false; r.eachCell(c => { if (/^agent$/i.test(String(c.value))) a = true; if (/^weeks$/i.test(String(c.value))) w = true; }); if (a && w) hr = n; });
    const existIds = new Set(); const funcSrc = {}; let lastRow = hr;
    main.eachRow((r, n) => { if (n <= hr) return; const id = r.getCell(3).value; const wk = r.getCell(9).value; if (id && !isNaN(id)) { existIds.add(Number(id)); const f = String(r.getCell(5).value || '').trim(); if (String(wk) === '1' && funcSrc[f] == null) funcSrc[f] = n; } lastRow = Math.max(lastRow, n); });
    const newbies = roster.filter(a => !existIds.has(Number(a.id)));
    const wsLast = {}; for (const sn of Object.values(SHEET_OF)) { const w = wb.getWorksheet(sn); let lr = 1; w.eachRow((r, n) => { const id = r.getCell(2).value; if (id && !isNaN(id)) lr = Math.max(lr, n); }); wsLast[sn] = lr; }
    const writeW = (sn, a, v) => {
      const w = wb.getWorksheet(sn); const row = w.getRow(++wsLast[sn]);
      row.getCell(1).value = a.name; row.getCell(2).value = a.id; row.getCell(3).value = a.uid; row.getCell(4).value = a.tm; row.getCell(5).value = a.func;
      row.getCell(6).value = num(v[5]); row.getCell(7).value = num(v[6]); row.getCell(8).value = num(v[7]); row.getCell(9).value = num(v[8]); row.getCell(10).value = num(v[9]); row.getCell(11).value = num(v[10]); row.getCell(12).value = num(v[11]); row.getCell(13).value = num(v[12]); const qz = num(v[13]); row.getCell(14).value = qz == null ? null : qz / 100; row.getCell(15).value = num(v[14]); row.getCell(16).value = num(v[15]);
    };
    let appended = 0;
    for (const a of newbies) {
      const src = funcSrc[a.func] || Object.values(funcSrc)[0]; if (!src) continue;
      for (const wk of WEEKS) writeW(SHEET_OF[wk], a, kpiRow(a, wk));
      writeW(SHEET_OF.Final, a, finalRow(a));
      for (let k = 0; k < 5; k++) {
        const S = src + k, R = ++lastRow; const sRow = main.getRow(S), dRow = main.getRow(R);
        sRow.eachCell({ includeEmpty: true }, (cell, col) => {
          const d = dRow.getCell(col); const fv = cell.value;
          let formula = null, mrow = S;
          if (fv && typeof fv === 'object' && fv.formula) formula = fv.formula;                 // master cell (refs its own row S)
          else if (fv && typeof fv === 'object' && fv.sharedFormula) {                            // shared child → rebuild from the master
            const mm = main.getCell(fv.sharedFormula); mrow = Number((String(fv.sharedFormula).match(/(\d+)/) || [])[1]);
            formula = (mm.value && mm.value.formula) || (typeof mm.formula === 'string' ? mm.formula : null);
          }
          if (formula) d.value = { formula: reRef(formula, mrow, R) };                             // standalone formula for row R (no shared ref)
          else if (col === 2) d.value = a.name; else if (col === 3) d.value = a.id; else if (col === 4) d.value = a.uid;
          else if (col === 5) d.value = a.func; else if (col === 9) d.value = (k < 4 ? k + 1 : 'Final');
          else d.value = fv;
          if (cell.style) d.style = cell.style;
        });
      }
      appended++;
    }
    console.log('new joiners appended to template:', appended, '/', newbies.length);
    // Set the CORRECT cached result on every main-sheet formula cell (our computed score). This fixes the
    // stale-result display (e.g. QA showed -20) AND makes the file programmatically readable (the /scorecard
    // upload reads cell values). Excel still recomputes on open (fullCalcOnLoad) → same numbers. Standalone
    // formulas (no shared refs) avoid the empty-<conditionalFormatting> corruption too.
    // template main-sheet 1-indexed col → scoredRow index:
    const COL2IDX = { 7: 5, 8: 6, 10: 8, 11: 9, 12: 10, 13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 16, 19: 17, 20: 18, 21: 19, 22: 20, 23: 21, 24: 22, 25: 23, 26: 24, 27: 25, 32: 26, 33: 27 };
    main.eachRow((row, n) => {
      if (n <= hr) return;
      const id = row.getCell(3).value; if (!id || isNaN(id)) return; const a = byId[Number(id)]; if (!a) return;
      const wkv = row.getCell(9).value;
      const scored = /final/i.test(String(wkv)) ? scoredRow(finalRow(a), 'Final') : scoredRow(kpiRow(a, Number(wkv)), Number(wkv));
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const fv = cell.value; if (!fv || typeof fv !== 'object') return;
        let formula = null;
        if (fv.formula) formula = fv.formula;                                  // master cell (refs row n)
        else if (fv.sharedFormula) { const mm = main.getCell(fv.sharedFormula); const mrow = Number((String(fv.sharedFormula).match(/(\d+)/) || [])[1]); const mf = mm.value && mm.value.formula; if (mf) formula = reRef(mf, mrow, n); }
        if (!formula) return;
        const idx = COL2IDX[col]; const v = idx != null ? scored[idx] : undefined;
        cell.value = (v !== '' && v != null && !isNaN(v)) ? { formula, result: Number(v) } : { formula };
      });
    });
  }

  // WFM Note as PLAIN TEXT in a free column Q(17) — Excel cell comments corrupt the template XML, so use text.
  const NOTE_COL = 17;
  const setNote = (sheetName, textFor) => {
    const ws = wb.getWorksheet(sheetName); if (!ws) return;
    if (!ws.getCell(1, NOTE_COL).value) ws.getCell(1, NOTE_COL).value = 'WFM Note';
    ws.eachRow((row, n) => { if (n === 1) return; const id = row.getCell(2).value; if (!id || isNaN(id)) return; const a = byId[Number(id)]; if (!a) return; const t = textFor(a, row); if (t) row.getCell(NOTE_COL).value = t; });
  };
  // Final (W5): bar-score reference
  setNote(SHEET_OF.Final, (a) => ['Inbound', 'Outbound', 'Refund'].includes(a.func) ? 'bar score (reference) — FCR & CTR; final evaluation, weeks are review' : 'bar score (reference) — CTR; final evaluation, weeks are review');
  // Weeks W1-W4: "didn't solve quiz" where present-but-unsolved
  for (const wk of WEEKS) setNote(SHEET_OF[wk], (a) => quizMissNote(a, wk));

  // ── VISIBLE notes on the MAIN scorecard sheet (the one the user reads) as a PLAIN-TEXT column
  //    "WFM Note" (col 35) — Excel cell comments are unreliable here (drop/corrupt). + record −5 commitment. ──
  const scMain = wb.worksheets.find(w => /SC 26/i.test(w.name));
  if (scMain) {
    const NC = 35;
    let hr = 0; scMain.eachRow((r, n) => { if (hr) return; let a = false, w = false; r.eachCell(c => { if (/^agent$/i.test(String(c.value))) a = true; if (/^weeks$/i.test(String(c.value))) w = true; }); if (a && w) hr = n; });
    if (hr) {
      scMain.getCell(hr, NC).value = 'WFM Note';
      scMain.eachRow((row, n) => {
        if (n <= hr) return; const id = row.getCell(3).value; if (!id || isNaN(id)) return; const a = byId[Number(id)]; if (!a) return;
        const wk = row.getCell(9).value;
        if (/final/i.test(String(wk))) {
          row.getCell(NC).value = 'bar score (reference) — final evaluation; weekly rows are review-for-improvement';
        } else if (onLeaveWeek(a.uid, Number(wk))) {
          row.getCell(NC).value = 'on leave — not scored this week';
        } else if (quizMiss(a, Number(wk))) {
          row.getCell(NC).value = "didn't solve quiz (present, not on leave) → +1 Common Mistake (-5)";
        } else if (quizBar.has(Number(wk))) {
          row.getCell(NC).value = 'quiz: bar (no quiz held this week — everyone gets the bar)';
        }
      });
    }
  }
  addRankingSheets(wb);                            // Ranking + Intern Review inside the template form too
  wb.calcProperties = { fullCalcOnLoad: true };   // force Excel to recompute scores on open
  let filledPath = OUT_FILLED;
  try { await wb.xlsx.writeFile(OUT_FILLED); }
  catch (e) { if (e.code === 'EBUSY' || e.code === 'EPERM') { filledPath = OUT_FILLED.replace(/\.xlsx$/, ' (new).xlsx'); await wb.xlsx.writeFile(filledPath); console.log('⚠️ original FILLED is open in Excel — wrote a copy instead.'); } else throw e; }
  console.log('\n✅ FILLED TEMPLATE:', filledPath, '(open in Excel → scores auto-compute)');
})().catch(e => console.log('ERR', e.message));

// ── SCORED scorecard (scores computed by us, SAME criteria) — self-contained ──
// valArr (kpiRow/finalRow): [name,id,uid,tm,func,wd,qa,res,prr,aht,fcr,prod,ctr,quiz,rt,mist]
// ── RANKING + Intern Review sheets (added to BOTH the SCORED and the FILLED workbooks) ──
//  • per function, eligible only (ineligible if any Final KPI below its bar = negative band)
//  • INTERNS excluded from the top (review-only); Net desc, ties → "better in MORE KPIs" + Why
function addRankingSheets(wb) {
  const isIntern = f => /intern/i.test(f);
  const SCORE_IDX = [9, 12, 13, 15, 17, 19, 21, 23, 25, 27];
  const KPIS = [['Productivity', 11, 1], ['AHT', 9, -1], ['FCR', 10, 1], ['CTR', 12, 1], ['Quiz', 13, 1], ['QA', 6, 1], ['RES', 7, 1], ['PRR', 8, 1], ['Common Mistakes', 15, -1]];
  const ranked = roster.map(a => {
    const fv = finalRow(a); const sr = scoredRow(fv, 'Final');
    const below = SCORE_IDX.some(i => typeof sr[i] === 'number' && sr[i] < 0);
    const kpi = {}; KPIS.forEach(([n, i]) => kpi[n] = (fv[i] === '' || fv[i] == null) ? null : Number(fv[i]));
    return { a, net: typeof sr[6] === 'number' ? sr[6] : -999, eligible: !below && typeof sr[6] === 'number', kpi };
  });
  const computeWins = group => {
    group.forEach(r => { r.wins = 0; r.led = []; });
    for (const [name, , dir] of KPIS) {
      const vals = group.map(r => r.kpi[name]).filter(v => v != null); if (!vals.length) continue;
      const best = dir > 0 ? Math.max(...vals) : Math.min(...vals);
      group.forEach(r => { if (r.kpi[name] != null && r.kpi[name] === best) { r.wins++; r.led.push(name); } });
    }
  };
  const byFunc = {}; ranked.forEach(r => (byFunc[r.a.func] = byFunc[r.a.func] || []).push(r));
  const rk = wb.addWorksheet('Ranking');
  rk.addRow(['Function', 'Rank', 'Name', 'ID', 'Net Points', 'Reward KD', 'Eligible', 'Why (led KPIs)']);
  rk.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; });
  const funcRanked = {};
  for (const fn of Object.keys(byFunc).filter(f => !isIntern(f)).sort()) {
    const grp = byFunc[fn]; computeWins(grp);
    const elig = grp.filter(r => r.eligible).sort((x, y) => y.net - x.net || y.wins - x.wins);
    funcRanked[fn] = elig;
    elig.forEach((r, i) => rk.addRow([fn, i + 1, r.a.name, r.a.id, r.net, '', 'Yes', `led in ${r.wins} KPIs: ${r.led.join(', ') || '—'}`]));
    grp.filter(r => !r.eligible).sort((x, y) => y.net - x.net).forEach(r => rk.addRow([fn, '', r.a.name, r.a.id, r.net, '', 'No (below bar)', '']));
    rk.addRow([]);
  }
  rk.columns.forEach((c, i) => c.width = i === 2 ? 22 : i === 7 ? 40 : i === 0 ? 18 : 12);
  rk.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Populate the template's "Incentive" sheet (user's format): TOP 3 eligible per function + Reward KD + SUM ──
  const inc = wb.getWorksheet('Incentive');
  if (inc) {
    for (let n = 1; n <= 80; n++) for (let c = 1; c <= 6; c++) inc.getRow(n).getCell(c).value = null;   // clear old
    const H = ['Rank', 'Name', 'ID', 'Function', 'Net point', 'Reward KD']; H.forEach((h, i) => { const c = inc.getRow(1).getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; });
    let row = 2;
    for (const fn of Object.keys(funcRanked).sort()) {
      funcRanked[fn].slice(0, 3).forEach((r, i) => { const rr = inc.getRow(row++); rr.getCell(1).value = i + 1; rr.getCell(2).value = r.a.name; rr.getCell(3).value = r.a.id; rr.getCell(4).value = fn; rr.getCell(5).value = r.net; /* F Reward KD = user fills */ });
    }
    const sum = inc.getRow(row + 1); sum.getCell(5).value = 'Total'; sum.getCell(6).value = { formula: `SUM(F2:F${row - 1})` }; sum.getCell(5).font = { bold: true };
    inc.columns.forEach((c, i) => c.width = i === 1 ? 24 : i === 3 ? 20 : 12);
    inc.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const interns = ranked.filter(r => isIntern(r.a.func));
  if (interns.length) {
    const iv = wb.addWorksheet('Intern Review');
    iv.addRow(['Intern', 'ID', 'Function', 'Attendance %', 'Net Points (review)', 'Recommendation', 'Why']);
    iv.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7030A0' } }; });
    interns.forEach(r => { const fv = finalRow(r.a); r.att = (fv[5] === '' || fv[5] == null) ? 0 : Number(fv[5]); });
    const maxN = Math.max(...interns.map(r => r.net), 1);
    interns.sort((x, y) => (y.att + y.net / maxN) - (x.att + x.net / maxN));
    interns.forEach(r => {
      let rec, why;
      if (r.att >= 0.85 && r.net >= 80) { rec = 'Keep'; why = `strong attendance (${Math.round(r.att * 100)}%) + score ${r.net}`; }
      else if (r.att < 0.7 || r.net < 50) { rec = 'Let go'; why = `low ${r.att < 0.7 ? 'attendance ' + Math.round(r.att * 100) + '%' : ''}${r.att < 0.7 && r.net < 50 ? ' & ' : ''}${r.net < 50 ? 'score ' + r.net : ''}`; }
      else { rec = 'Review'; why = `mid: attendance ${Math.round(r.att * 100)}%, score ${r.net}`; }
      const row = iv.addRow([r.a.name, r.a.id, r.a.func, r.att, r.net, rec, why]);
      row.getCell(4).numFmt = '0%';
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rec === 'Keep' ? 'FFC6EFCE' : rec === 'Let go' ? 'FFF8CBAD' : 'FFFFF2CC' } };
    });
    iv.columns.forEach((c, i) => c.width = i === 0 ? 22 : i === 6 ? 40 : i === 2 ? 20 : 13);
    iv.views = [{ state: 'frozen', ySplit: 1 }];
  }
}

function scoredRow(v, weekLabel) {
  // on-leave / no-data week: all KPIs blank → don't score (blank Net), so a leave week isn't credited.
  if ([5, 6, 9, 10, 11, 12, 13, 14].every(i => v[i] === '' || v[i] == null)) {
    return [v[0], v[1], v[2], v[4], v[3], '', '', weekLabel, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  }
  const quizFrac = (v[13] === '' || v[13] == null) ? '' : Number(v[13]) / 100;
  const qS = sQuality(v[6]), pPt = sPRRea(v[8], v[7]), pBn = sPRRea(v[8], v[7]), aS = sAHT(v[9]),
    fS = sFCR(v[10]), prS = sProd(v[11]), cS = sCTR(v[12]), qzS = sQuizF(quizFrac), mS = sMist(v[15]), rS = sRT(v[14]);
  const net = numOr0(qS) + numOr0(pPt) + numOr0(pBn) + numOr0(aS) + numOr0(fS) + numOr0(prS) + numOr0(cS) + numOr0(qzS) + numOr0(mS) + numOr0(rS);
  // SC column order
  return [v[0], v[1], v[2], v[4], v[3], v[5], net, weekLabel, v[6], qS, v[7], v[8], pPt, pBn, v[9], aS, v[10], fS, v[11], prS, v[12], cS, quizFrac, qzS, v[15], mS, v[14], rS];
}
(async () => {
  const out = new ExcelJS.Workbook();
  const ws = out.addWorksheet(CFG.scSheet);
  const HDR = ['Agent', 'ID', 'User ID', 'Function', 'TL', 'Working Days%', 'Net Points', 'Weeks', 'Quality', 'Quality Score', 'Response Rate', 'PRR rate', 'PRR Points', 'PRR Bonus', 'AHT', 'AHT Score', 'Suc%-FCR', 'FCR Score', 'Product.', 'Product. Score', 'Call to Ticket Ratio', 'CTR Score', 'Quiz', 'Quiz Score', 'Common Mistakes', 'Mistakes Score', 'Response Time', 'Response Time Score'];
  ws.addRow(HDR); ws.getRow(1).font = { bold: true };
  for (const a of roster) {
    for (const wk of WEEKS) ws.addRow(scoredRow(kpiRow(a, wk), wk));
    const f = ws.addRow(scoredRow(finalRow(a), 'Final')); f.font = { bold: true };
  }
  // formats: % cols + time cols; color Net Points (col7) — simple (FILLED is the canonical form)
  const pct = [6, 9, 11, 12, 17, 19, 21, 23];   // WD,Quality,RES,PRR,FCR,Prod,CTR,Quiz
  const timeC = [15, 27];                         // AHT, Response Time
  ws.eachRow((row, n) => {
    if (n === 1) return;
    pct.forEach(c => { const v = row.getCell(c).value; if (typeof v === 'number') row.getCell(c).numFmt = '0%'; });
    timeC.forEach(c => { const v = row.getCell(c).value; if (typeof v === 'number') row.getCell(c).numFmt = '[h]:mm:ss'; });
    const net = row.getCell(7).value; const isFinal = row.getCell(8).value === 'Final';
    if (typeof net === 'number') row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: net <= 0 ? 'FFF8CBAD' : isFinal ? 'FFC6EFCE' : 'FFFFF2CC' } };
  });
  ws.columns.forEach((c, i) => c.width = i < 5 ? 18 : 10);
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ── DATA (audit) tab: raw components per agent×week so every KPI is traceable ──
  const aud = out.addWorksheet('DATA (audit)');
  const AH = ['Agent', 'ID', 'Function', 'Week', 'Voice Connected', '# Chats', 'Tickets', 'Closed', 'FCR=Closed/Tickets', 'Survey Yes', 'Survey No', 'RES=Resp/Tickets', 'PRR=Yes/Resp', 'AHT', 'FRT', 'QA', 'Quiz', 'WD%', 'Prod%'];
  aud.addRow(AH); aud.getRow(1).font = { bold: true };
  for (const a of roster) {
    for (const wk of WEEKS) {
      const k = K[a.uid]?.[wk] || {}; const sv = SRV[a.uid]?.[wk]; const v = kpiRow(a, wk);
      const closed = k.cl || 0, tk = k.tk || 0;
      // Yes/No reflect the SOURCE actually used for RES/PRR: Sprinklr survey if present, else Ameyo feedback1.
      const yes = sv ? sv.yes : (k.fbN ? k.fbPos : ''), no = sv ? sv.no : (k.fbN ? (k.fbN - k.fbPos) : '');
      aud.addRow([a.name, a.id, a.func, wk, k.conn || '', k.cdN || '', tk || '', tk ? closed : '', tk ? round1(closed / tk * 100) / 100 : '',
        yes, no, num(v[7]), num(v[8]), num(v[9]), num(v[14]), num(v[6]), num(v[13]) == null ? '' : v[13] / 100, num(v[5]), num(v[11])]);
    }
  }
  aud.eachRow((row, n) => { if (n === 1) return; [9, 12, 13, 16, 17, 18, 19].forEach(c => { if (typeof row.getCell(c).value === 'number') row.getCell(c).numFmt = '0%'; }); [14, 15].forEach(c => { if (typeof row.getCell(c).value === 'number') row.getCell(c).numFmt = '[h]:mm:ss'; }); });
  aud.columns.forEach((c, i) => c.width = i < 3 ? 18 : 11);
  aud.views = [{ state: 'frozen', ySplit: 1 }];

  addRankingSheets(out);
  await out.xlsx.writeFile(D + CFG.scored);
  console.log('✅ SCORED (+ DATA audit + Ranking tabs):', D + CFG.scored);
  const s = scoredRow(kpiRow(roster.find(x => x.func === 'Inbound'), 1), 1);
  console.log('sample Inbound W1 scored: Net=' + s[6] + ' Q=' + s[8] + '→' + s[9] + ' AHT→' + s[15] + ' FCR=' + s[16] + '→' + s[17] + ' CTR=' + s[20] + '→' + s[21]);
})().catch(e => console.log('ERR scored', e.message));
