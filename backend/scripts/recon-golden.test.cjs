/**
 * GOLDEN-MASTER for the shipping recon engine (EXECUTION_BRIEF risk #9 — pay-affecting rules
 * with zero coverage). Two layers, zero external deps:
 *
 *  A) PURE-FUNCTION golden master — classifyCode (the shift dictionary: exact times/kind/net
 *     per BR-SHF-005) and pickWindow (bleed detection + the 5h OT window) from
 *     recon-new-roster.js. If a rule edit changes ANY of these outputs, this fails loudly.
 *
 *  B) LIVE PAY-INVARIANTS — the clamps recon-build.js guarantees, asserted against roster_days:
 *     no unflagged ot_min > 300 · no cross-midnight sys_late/early > 240 · OT buckets disjoint ·
 *     no negative minutes · absence/sick rows carry no OT. A rebuild that violates any of these
 *     must NOT ship.
 *
 *  Run:  node scripts/recon-golden.test.cjs          (exits 1 on any failure)
 *  Wired as the recon-refresh tail — a refresh that breaks a pay rule fails the pipeline.
 */
const path = require('path');
process.env.RECON_SKIP_BUILD = '1';   // just in case; we only need the exports
const M = require('./recon-new-roster.js');
const { classifyCode, pickWindow } = M;

let failures = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + name); return; }
  failures++; console.error('  ✗ ' + name + '\n      expected ' + e + '\n      actual   ' + a);
};

console.log('A) classifyCode golden master (BR-SHF-004/005 + suffix grammar)');
const pickC = (c) => ({ kind: c.kind, start: c.start, end: c.end, net: c.net, x: c.crossMidnight, loc: c.location });
// canonical working codes — exact minutes (never invent times)
eq('M 07-16 9h',      pickC(classifyCode('M', 1)),    { kind: 'work', start: 420,  end: 960,  net: 480, x: false, loc: 'Office' });
eq('B 09-18',         pickC(classifyCode('B', 1)),    { kind: 'work', start: 540,  end: 1080, net: 480, x: false, loc: 'Office' });
eq('C 11-20',         pickC(classifyCode('C', 1)),    { kind: 'work', start: 660,  end: 1200, net: 480, x: false, loc: 'Office' });
eq('N 13-22',         pickC(classifyCode('N', 1)),    { kind: 'work', start: 780,  end: 1320, net: 480, x: false, loc: 'Office' });
eq('E 16-01 crosses', pickC(classifyCode('E', 1)),    { kind: 'work', start: 960,  end: 1500, net: 480, x: true,  loc: 'Office' });
eq('MD 22-07 crosses',pickC(classifyCode('MD', 1)),   { kind: 'work', start: 1320, end: 1860, net: 480, x: true,  loc: 'Office' });
eq('MN 23-08 crosses',pickC(classifyCode('MN', 1)),   { kind: 'work', start: 1380, end: 1920, net: 480, x: true,  loc: 'Office' });
eq('N20 14-22 resp',  pickC(classifyCode('N20', 1)),  { kind: 'work', start: 840,  end: 1320, net: 420, x: false, loc: 'Office' });
eq('M20 08-16 resp',  pickC(classifyCode('M20', 1)),  { kind: 'work', start: 480,  end: 960,  net: 420, x: false, loc: 'Office' });
eq('CCNO 09-17 mgmt', (c => ({ kind: c.kind, mgmt: !!c.management, net: c.net }))(classifyCode('CCNO', 1)), { kind: 'work', mgmt: true, net: 420 });
eq('M7-3 07-15',      pickC(classifyCode('M7-3', 1)), { kind: 'work', start: 420,  end: 900,  net: 420, x: false, loc: 'Office' });
// mothers 7h (only valid for 12375/12434)
eq('B7 mother ok',    (c => ({ kind: c.kind, net: c.net, flag: /review/.test(c.note) }))(classifyCode('B7', 12375)), { kind: 'work', net: 360, flag: false });
eq('B7 non-mother flagged', (c => /review/.test(c.note))(classifyCode('B7', 999)), true);
// WFH variants
eq('WFH-M wfh 07-16', pickC(classifyCode('WFH-M', 1)), { kind: 'wfh', start: 420, end: 960, net: 480, x: false, loc: 'WFH' });
eq('bare WFH no window', (c => ({ kind: c.kind, start: c.start, loc: c.location }))(classifyCode('WFH', 1)), { kind: 'wfh', start: null, loc: 'WFH' });
// suffix grammar: base+S = sick, base+A = absence (generic, longest-first)
eq('NS = sick on N',   (c => ({ kind: c.kind, origin: c.origin }))(classifyCode('NS', 1)),   { kind: 'sick',    origin: 'N' });
eq('EE20A = abs EE20', (c => ({ kind: c.kind, origin: c.origin }))(classifyCode('EE20A', 1)),{ kind: 'absence', origin: 'EE20' });
// non-working dictionary
for (const [code, kind] of [['OFF','off'],['H','holiday'],['L','leave'],['SL','leave'],['DL','leave'],['COMP','comp'],['RES','sep'],['TER','sep']])
  eq(`${code} → ${kind}`, classifyCode(code, 1).kind, kind);
eq('unknown flagged', (c => ({ kind: c.kind, mapped: c.mapped }))(classifyCode('XYZ9', 1)), { kind: 'unknown', mapped: false });

console.log('B) pickWindow golden master (bleed + 5h OT window)');
const D = 0; // absolute day base
// a clean session inside an M shift (420-960): login 425 → logout 965 (5 min OT)
eq('clean session kept', (w => ({ in: w.loginMin, out: w.logoutMin, capped: w.capped }))(
  pickWindow([{ aLogin: 425, aLogout: 965 }], D, 420, 960)), { in: 425, out: 965, capped: false });
// OT beyond the +5h window is capped (logout at end+400 → capped to end+300)
eq('residual bleed capped at +5h', (w => ({ out: w.logoutMin, capped: w.capped }))(
  pickWindow([{ aLogin: 425, aLogout: 960 + 400 }], D, 420, 960)), { out: 960 + 300, capped: true });
// a forgotten re-open (logs in after midpoint, runs longer than the shift, ends past end+2h) is DROPPED
eq('never-closed re-open dropped', (w => ({ n: w.sessions, dropped: w.droppedBleed }))(
  pickWindow([{ aLogin: 425, aLogout: 900 }, { aLogin: 800, aLogout: 800 + 600 }], D, 420, 960)), { n: 1, dropped: 1 });
// sessions outside the window (previous day bleed) are ignored entirely
eq('out-of-window session → null', pickWindow([{ aLogin: -600, aLogout: -100 }], D, 420, 960), null);

console.log('C) LIVE pay-invariants on roster_days (the clamps must hold on shipped data)');
const { Client } = require('pg'); const fs = require('fs');
const B = __dirname + '/..';
for (const p of [B + '/.env', B + '/../.env']) if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const one = async (name, sql, expectZero = true) => {
    const [r] = (await c.query(sql)).rows; const n = +Object.values(r)[0];
    if ((n === 0) === expectZero) console.log('  ✓ ' + name + ' (' + n + ')');
    else { failures++; console.error('  ✗ ' + name + ' → ' + n + ' violating rows'); }
  };
  // NOTE: invariants apply to CLAMPED slices; pre-clamp history is bounded by the June-28+ engine
  // era — scope to the era the clamps shipped for (>= 2026-06-28) so the gate is honest.
  const ERA = "work_date >= '2026-06-28'";
  await one('no unflagged ot_min > 300 (era)', `SELECT COUNT(*) FROM roster_days WHERE is_active AND ${ERA} AND ot_min > 300 AND COALESCE(data_quality,'') = ''`);
  await one('no cross-midnight sys_late/early > 240 (era)', `SELECT COUNT(*) FROM roster_days WHERE is_active AND ${ERA} AND crosses_midnight AND (sys_late_min > 240 OR sys_early_min > 240)`);
  await one('OT buckets disjoint (all history)', `SELECT COUNT(*) FROM roster_days WHERE is_active AND ((COALESCE(ot_min,0)>0 AND COALESCE(offday_ot_min,0)>0) OR (COALESCE(ot_min,0)>0 AND COALESCE(holiday_ot_min,0)>0) OR (COALESCE(offday_ot_min,0)>0 AND COALESCE(holiday_ot_min,0)>0))`);
  await one('no negative pay minutes (all history)', `SELECT COUNT(*) FROM roster_days WHERE is_active AND (COALESCE(ot_min,0)<0 OR COALESCE(offday_ot_min,0)<0 OR COALESCE(holiday_ot_min,0)<0 OR COALESCE(sys_late_min,0)<0 OR COALESCE(sys_early_min,0)<0)`);
  await one('absence/sick rows carry no OT (era)', `SELECT COUNT(*) FROM roster_days WHERE is_active AND ${ERA} AND presence IN ('absent','sick') AND (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0)) > 0`);
  await c.end();
  console.log(failures ? `\n❌ GOLDEN MASTER FAILED — ${failures} assertion(s). A pay rule changed or a rebuild violated a clamp.` : '\n✅ GOLDEN MASTER PASS — the pay rules hold.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('invariant layer failed to run: ' + e.message); process.exit(1); });
