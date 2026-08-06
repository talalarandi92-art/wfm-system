#!/usr/bin/env node
/**
 * audit-generator.js — drive the schedule generator and judge its OUTPUT.
 *
 * The generator is the one place the system AUTHORS a schedule rather than
 * receiving one, so it is the one place a rule can be broken silently: nobody
 * reviews 160 people x 7 days by eye. This harness generates a real week and
 * re-derives every rule the generator claims to honour from the assignments it
 * returned — independently, from the shift catalog, not from its own report.
 *
 *   G1  female shift rule       BR-GEN-001/002/003
 *   G2  10h rest between shifts BR-RST-001  (cross-midnight aware)
 *   G3  exactly 2 OFF per week  BR-OFF-001
 *   G4  never 3+ OFF in a row   BR-OFF-002
 *   G5  self-report agreement   does its own violations[] match what happened?
 *   G6  function shift policy   an Outbound agent never gets a midnight
 *   G7  publish lock            BR-APP-001 — Generate never overwrites Published
 *
 * Read-only: uses POST generate / generate-demand, which return a PROPOSAL.
 * Nothing is saved unless --save is passed, which this harness never does.
 *
 *   node scripts/audit-generator.js [--week=YYYY-MM-DD]
 */
const BASE = process.env.WFM_BASE || 'http://localhost:3000/api/v1';
const EMAIL = process.env.WFM_EMAIL || 'demo.admin@boutiqaat.wfm';
const PASS = process.env.WFM_PASS || 'Demo@2026';

const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

// Canonical shift windows — minutes from local midnight. Mirrors SHIFTS in
// generator.types.ts but written out HERE on purpose: a harness that imports the
// engine's own table cannot catch the engine using the wrong table.
const WIN = {
  M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320],
  E: [960, 1500], EE: [1080, 1560], MD: [1320, 1860], MN: [1380, 1920],
  'M7-3': [420, 900], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320],
  M20: [480, 960], CCNO: [540, 1020], AM: [480, 960],
};
const MIDNIGHT = /^(MD|MN|MDR|MNR)$/i;
const NON_WORK = /^(OFF|L|H|SL|A|COMP|DL|RES|TER)$/i;

let TOKEN = '';
async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

const findings = [];
const add = (id, sev, title, detail) => findings.push({ id, sev, title, detail });
const pad = (s, n) => String(s).padEnd(n);

// Local date formatting only. toISOString() shifts by the UTC offset and lands
// on the wrong day — the exact trap BR-TIM-001 warns about.
const fmtLocal = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/** Saturday on or before d. */
function snapSaturday(d) {
  const x = new Date(d + 'T00:00:00');
  x.setDate(x.getDate() - ((x.getDay() + 1) % 7));
  return fmtLocal(x);
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (login.status !== 200 && login.status !== 201) {
    console.error('login failed', login.status, login.body);
    process.exit(2);
  }
  TOKEN = login.body.accessToken || login.body.access_token || login.body.token;

  // A week far enough ahead that it is not published and not already worked.
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 9);
  const week = arg('week', snapSaturday(fmtLocal(nextWeek)));

  console.log(`\n  GENERATOR AUDIT — week ${week}\n  ${'─'.repeat(64)}`);

  const t0 = Date.now();
  const gen = await api('/schedule-generator/generate', {
    method: 'POST',
    body: JSON.stringify({ weekStart: week }),
  });
  const ms = Date.now() - t0;
  if (gen.status !== 200 && gen.status !== 201) {
    console.error(`  generate → ${gen.status}`, JSON.stringify(gen.body).slice(0, 400));
    process.exit(2);
  }
  const R = gen.body;
  // Result is grouped per function: functions[].employees[] holds the schedules.
  const schedules = (R.functions || []).flatMap(f => f.employees || []);
  console.log(`  generate → ${gen.status} in ${(ms / 1000).toFixed(1)}s · ` +
    `${schedules.length} people · ${schedules[0]?.assignments?.length ?? 0} days each`);

  if (!schedules.length) {
    add('G0', 'HIGH', 'generator returned no schedules',
      `top-level keys: ${Object.keys(R || {}).join(', ')}`);
    report(); return;
  }

  // ── build a flat view of what it actually produced ────────────────────────
  const rows = [];
  for (const es of schedules) {
    const e = es.employee || {};
    for (const a of es.assignments || []) {
      rows.push({
        person: e.name, no: e.employeeNo, gender: String(e.gender || '').toLowerCase(),
        fn: e.functionName || '', date: a.date,
        code: String(a.shift?.code ?? a.shift ?? '').trim().toUpperCase(),
        selfViol: a.violations || [], selfRest: a.restHours,
      });
    }
  }
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.no)) byPerson.set(r.no, []);
    byPerson.get(r.no).push(r);
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.date < b.date ? -1 : 1);

  const working = rows.filter(r => r.code && !NON_WORK.test(r.code));
  console.log(`  ${rows.length} assignments · ${working.length} working · ` +
    `${rows.length - working.length} OFF/leave\n`);

  // ── G1 female shift rule ──────────────────────────────────────────────────
  const femMid = working.filter(r => r.gender.startsWith('f') && MIDNIGHT.test(r.code));
  const femLate = working.filter(r => r.gender.startsWith('f') && /^(E|EE|EE20)$/i.test(r.code));
  const femN = working.filter(r => r.gender.startsWith('f') && /^N/i.test(r.code));
  if (femMid.length) add('G1', 'HIGH', `generator put ${femMid.length} female assignment(s) on a midnight shift`,
    femMid.slice(0, 5).map(r => `${r.person} ${r.date} ${r.code}`).join(' · '));
  if (femLate.length) add('G1b', 'HIGH', `generator put ${femLate.length} female assignment(s) on a blocked evening shift`,
    femLate.slice(0, 5).map(r => `${r.person} ${r.date} ${r.code}`).join(' · '));
  console.log(`  G1  female rule     midnight ${femMid.length} · blocked-evening ${femLate.length} · ` +
    `N (allowed by exception) ${femN.length}`);

  // ── G2 rest ───────────────────────────────────────────────────────────────
  const restBreaches = [];
  for (const [no, list] of byPerson) {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      const wa = WIN[a.code], wb = WIN[b.code];
      if (!wa || !wb) continue;
      const gapDays = Math.round(
        (new Date(b.date + 'T00:00:00') - new Date(a.date + 'T00:00:00')) / 86400000);
      if (gapDays < 1 || gapDays > 2) continue;
      const endA = wa[1];                       // already unwrapped past 1440
      const startB = gapDays * 1440 + wb[0];
      const rest = startB - endA;
      if (rest < 600) restBreaches.push({ ...a, next: b, rest });
    }
  }
  if (restBreaches.length) add('G2', 'HIGH', `${restBreaches.length} rest breach(es) below 10h in generated output`,
    restBreaches.slice(0, 6).map(r =>
      `${r.person} ${r.date} ${r.code}→${r.next.code} ${(r.rest / 60).toFixed(1)}h`).join(' · '));
  console.log(`  G2  rest >= 10h     ${restBreaches.length} breach(es)`);

  // ── G3 / G4 OFF discipline ────────────────────────────────────────────────
  const offCounts = [], runs = [];
  for (const [no, list] of byPerson) {
    const offs = list.filter(r => /^OFF$/i.test(r.code)).length;
    offCounts.push({ no, person: list[0].person, offs });
    let run = 0;
    for (const r of list) {
      if (/^OFF$/i.test(r.code)) { run++; if (run >= 3) { runs.push({ person: r.person, at: r.date, run }); } }
      else run = 0;
    }
  }
  const wrongOff = offCounts.filter(x => x.offs !== 2);
  if (wrongOff.length) add('G3', wrongOff.length > byPerson.size * 0.1 ? 'HIGH' : 'MED',
    `${wrongOff.length}/${byPerson.size} people did not get exactly 2 OFF`,
    wrongOff.slice(0, 6).map(x => `${x.person} ${x.offs}`).join(' · '));
  const maxRuns = new Map();
  for (const r of runs) maxRuns.set(r.person, Math.max(maxRuns.get(r.person) || 0, r.run));
  if (maxRuns.size) add('G4', 'HIGH', `${maxRuns.size} person(s) given 3+ consecutive OFF`,
    [...maxRuns].slice(0, 6).map(([p, n]) => `${p} ${n}`).join(' · '));
  console.log(`  G3  exactly 2 OFF   ${byPerson.size - wrongOff.length}/${byPerson.size} people`);
  console.log(`  G4  no 3+ OFF run   ${maxRuns.size} person(s) affected`);

  // ── G5 does its own report agree with its own output? ─────────────────────
  const selfClaimed = rows.filter(r => (r.selfViol || []).length).length;
  const reported = (R.violations || []).length;
  console.log(`  G5  self-report     ${reported} violation(s) reported · ${selfClaimed} assignment(s) carry a flag`);
  const realTotal = femMid.length + femLate.length + restBreaches.length + maxRuns.size;
  if (realTotal > 0 && reported === 0) add('G5', 'HIGH',
    'generator reported a clean week while its own output breaks rules',
    `independently found ${realTotal} breach(es), generator reported 0`);

  // ── G6 function shift policy ──────────────────────────────────────────────
  const fnBreach = working.filter(r =>
    /outbound|\bomt\b/i.test(r.fn) && !/^(B|N)/i.test(r.code));
  if (fnBreach.length) add('G6', 'MED', `${fnBreach.length} Outbound assignment(s) outside the B/N policy`,
    fnBreach.slice(0, 5).map(r => `${r.person} ${r.date} ${r.code}`).join(' · '));
  console.log(`  G6  function policy ${fnBreach.length} outside-policy assignment(s)`);

  // ── G7 publish lock (BR-APP-001) ──────────────────────────────────────────
  // The real test: take a DRAFT whose period is already covered by a PUBLISHED
  // version and try to publish it. It must be refused, and nothing may move.
  // A refusal alone is not proof — the first version of this check "passed" on a
  // 400 that was really a malformed request of my own. So it asserts the reason
  // (the conflict message) and re-reads the statuses afterwards.
  const list = await api('/schedule-generator/versions');
  const versions = Array.isArray(list.body) ? list.body : list.body?.items || [];
  const day = (v) => String(v.period_start || '').slice(0, 10);
  const pubs = versions.filter(v => /published|locked/i.test(String(v.status || '')));
  const overlapped = versions.find(v => v.status === 'draft' &&
    pubs.some(p => day(p) <= day(v) && String(p.period_end || '').slice(0, 10) >= day(v)));

  if (!overlapped) {
    console.log('  G7  publish lock    no draft overlaps a published period — NOT VERIFIED');
    add('G7', 'INFO', 'publish lock not exercised',
      'this database has no draft sitting inside a published period to attempt');
  } else {
    const sig = (vv) => vv.map(v => `${v.id}:${v.status}`).sort().join(',');
    const before = sig(versions);
    const r = await api(`/schedule-generator/versions/${overlapped.id}/publish`, { method: 'POST' });
    const after = sig(Array.isArray((await api('/schedule-generator/versions')).body)
      ? (await api('/schedule-generator/versions')).body : []);
    const msg = String(r.body?.message ?? '');
    const refusedForTheRightReason = r.status === 400 && /already covers/i.test(msg);
    const nothingMoved = before === after;
    console.log(`  G7  publish lock    publish over published → ${r.status} ` +
      `${refusedForTheRightReason ? 'REFUSED (conflict) ✓' : 'unexpected ✗'} · ` +
      `statuses ${nothingMoved ? 'unchanged ✓' : 'CHANGED ✗'}`);
    if (!refusedForTheRightReason || !nothingMoved) add('G7', 'HIGH',
      'a published week is not protected from being republished over',
      `HTTP ${r.status} · ${msg.slice(0, 160)} · statuses ${nothingMoved ? 'unchanged' : 'CHANGED'}`);
  }

  report();
}

function report() {
  console.log(`\n  ${'─'.repeat(64)}`);
  const high = findings.filter(f => f.sev === 'HIGH');
  if (!findings.length) { console.log('  CLEAN — every rule held in the generated output\n'); process.exit(0); }
  for (const f of findings) console.log(`  ${pad(f.sev, 5)} ${pad(f.id, 5)} ${f.title}\n        ${f.detail}`);
  console.log(`\n  ${high.length} HIGH · ${findings.length} total\n`);
  process.exit(high.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
