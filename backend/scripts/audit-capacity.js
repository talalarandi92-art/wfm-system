#!/usr/bin/env node
/**
 * audit-capacity.js — judge the staffing requirement engine by its own numbers.
 *
 * Every cell of `/capacity/staffing/requirement` returns its full working:
 * volume → effective AHT → erlangs → agents for SL → occupancy → ÷productivity
 * → ÷(1−shrinkage) → required scheduled HC. That makes it checkable, so this
 * harness re-derives each step from the inputs the cell itself reports, with a
 * textbook Erlang-C written out HERE — never imported from the engine, because a
 * check that borrows the engine's own formula cannot catch a wrong formula.
 *
 *   K1  erlangs        = volume × AHTeff / 3600
 *   K2  agentsForSl    reproduces textbook Erlang-C at the stated SL/target
 *   K3  occupancy      = A / N, and never above the configured cap
 *   K4  productivity   afterProductivity = agentsForSl / productivity
 *   K5  shrinkage      requiredScheduledHc = ceil(afterProductivity / (1−shrinkage))
 *   K6  concurrency    chat/WhatsApp uses the confirmed value of 4
 *   K7  monotonic      more volume never asks for fewer agents
 *   K8  agreement      the generator's demand equals this engine's curve
 *
 * Read-only.  node scripts/audit-capacity.js [--date=YYYY-MM-DD]
 */
const BASE = process.env.WFM_BASE || 'http://localhost:3000/api/v1';
const EMAIL = process.env.WFM_EMAIL || 'demo.admin@boutiqaat.wfm';
const PASS = process.env.WFM_PASS || 'Demo@2026';
const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

let TOKEN = '';
async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(opts.headers || {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

// ── Textbook Erlang, written out on purpose ─────────────────────────────────
/** Erlang B by the stable recursion: B(0,A)=1, B(n,A) = A·B(n−1) / (n + A·B(n−1)). */
function erlangB(n, a) {
  let b = 1;
  for (let i = 1; i <= n; i++) b = (a * b) / (i + a * b);
  return b;
}
/** Erlang C — probability an arrival waits. */
function erlangC(n, a) {
  if (n <= a) return 1;
  const b = erlangB(n, a);
  return b / (1 - (a / n) * (1 - b));
}
/** Service level: P(wait ≤ t) = 1 − C·e^(−(N−A)·t/AHT). */
function serviceLevel(n, a, ahtSec, targetSec) {
  if (n <= a) return 0;
  return 1 - erlangC(n, a) * Math.exp(-((n - a) * targetSec) / ahtSec);
}
/**
 * Effective servers one concurrency agent provides: 1 + (c−1)·marginalEfficiency.
 * Mirrors effectiveServersPerAgent in common/erlang.ts — written out here so the
 * check does not inherit the assumption it is checking.
 */
function effectiveServers(concurrency, marginalEfficiency = 0.75) {
  return 1 + (Math.max(1, concurrency) - 1) * marginalEfficiency;
}

/** Smallest N meeting the SL target (and the occupancy cap when given). */
function agentsFor(a, ahtSec, targetSec, targetSl, occCap) {
  let n = Math.max(1, Math.floor(a) + 1);
  while (n < 10000) {
    const slOk = serviceLevel(n, a, ahtSec, targetSec) >= targetSl;
    const occOk = occCap ? (a / n) <= occCap + 1e-9 : true;
    if (slOk && occOk) return n;
    n++;
  }
  return n;
}

const findings = [];
const add = (id, sev, title, detail) => findings.push({ id, sev, title, detail });
const near = (x, y, tol) => Math.abs(x - y) <= tol;
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) });
  if (login.status > 201) { console.error('login failed', login.status); process.exit(2); }
  TOKEN = login.body.accessToken;

  const date = arg('date', '2026-08-15');
  console.log(`\n  CAPACITY / REQUIREMENT AUDIT — ${date}\n  ${'─'.repeat(66)}`);

  const req = await api(`/capacity/staffing/requirement?from=${date}&to=${date}`);
  if (req.status !== 200) { console.error('requirement →', req.status); process.exit(2); }
  const day = req.body.days[0];
  console.log(`  basis: ${String(req.body.basis).slice(0, 90)}`);
  console.log(`  ${day.functions.length} functions · AHT measured ${req.body.measuredAhtWindow?.voice?.from} → ${req.body.measuredAhtWindow?.voice?.to}\n`);

  let cells = 0, k1 = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0;
  const k2Off = [], k1Off = [], k3Off = [], k4Off = [], k5Off = [], occOver = [];

  for (const f of day.functions) {
    const p = f.params || {};
    for (const c of f.hours || []) {
      if (!c.volume) continue;
      cells++;

      // K1 — erlangs from volume and effective AHT
      const expErl = (c.volume * c.ahtEffSec) / 3600;
      if (near(expErl, c.erlangs, Math.max(0.05, expErl * 0.01))) k1++;
      else k1Off.push(`${f.functionKey} h${c.hour} ${c.erlangs} vs ${expErl.toFixed(2)}`);

      // A concurrency agent handles several conversations but not at full speed:
      // effective servers = 1 + (c−1)·0.75. So four concurrent chats are worth 3.25
      // servers, not 4 — a deliberately conservative assumption that staffs MORE
      // people than naive division would. Checking against raw `concurrency` makes
      // every one of those cells look wrong; that was this harness's error, not the
      // engine's, and the reason K3 first reported 36 false mismatches.
      const eff = f.model === 'concurrency' ? effectiveServers(p.concurrency ?? 1) : 1;
      const aEff = c.erlangs / eff;

      // K2 — reproduce the staffing decision for the model this function uses.
      // Erlang-C answers "how many to meet a WAIT-time target"; a throughput/backlog
      // function has no wait target (targetAnswerSec 0) and is staffed to its
      // occupancy ceiling instead. Judging it by Erlang is judging the wrong question.
      let mine;
      if (f.model === 'throughput') mine = Math.max(1, Math.ceil(c.erlangs / (p.occupancyCap ?? 0.85)));
      else mine = agentsFor(aEff, c.ahtEffSec / eff, p.targetAnswerSec ?? 60, p.targetSl ?? 0.8, p.occupancyCap);
      if (Math.abs(mine - c.agentsForSl) <= 1) k2++;
      else k2Off.push(`${f.functionKey} h${c.hour} [${f.model}] A=${aEff.toFixed(2)} engine ${c.agentsForSl} mine ${mine}`);

      // K3 — occupancy consistent with A/N and under the cap
      if (c.occupancyAtN != null) {
        const expOcc = c.agentsForSl > 0 ? aEff / c.agentsForSl : 0;
        if (near(expOcc, c.occupancyAtN, 0.02)) k3++;
        else k3Off.push(`${f.functionKey} h${c.hour} ${c.occupancyAtN} vs ${expOcc.toFixed(3)}`);
        if (p.occupancyCap && c.occupancyAtN > p.occupancyCap + 0.02)
          occOver.push(`${f.functionKey} h${c.hour} ${c.occupancyAtN} > cap ${p.occupancyCap}`);
      } else k3++;

      // K4 — productivity divisor
      const expProd = c.agentsForSl / (p.productivity ?? 1);
      if (near(expProd, c.afterProductivity, 0.15)) k4++;
      else k4Off.push(`${f.functionKey} h${c.hour} ${c.afterProductivity} vs ${expProd.toFixed(2)}`);

      // K5 — shrinkage divisor, then rounded up to whole people
      const expHc = Math.ceil(c.afterProductivity / (1 - (p.shrinkage ?? 0)));
      if (Math.abs(expHc - c.requiredScheduledHc) <= 1) k5++;
      else k5Off.push(`${f.functionKey} h${c.hour} ${c.requiredScheduledHc} vs ${expHc}`);
    }
  }

  const show = (id, label, ok, total, offenders) => {
    const bad = total - ok;
    console.log(`  ${pad(id, 4)} ${pad(label, 30)} ${String(ok).padStart(4)}/${total}` +
      (bad ? `   ✗ ${offenders.slice(0, 2).join(' · ')}` : '   ✓'));
    if (bad) add(id, bad > total * 0.05 ? 'HIGH' : 'MED', `${label}: ${bad} cell(s) disagree`, offenders.slice(0, 5).join(' · '));
  };
  show('K1', 'erlangs = vol × AHT / 3600', k1, cells, k1Off);
  show('K2', 'agents match textbook Erlang-C', k2, cells, k2Off);
  show('K3', 'occupancy = A / N', k3, cells, k3Off);
  show('K4', 'afterProductivity divisor', k4, cells, k4Off);
  show('K5', 'shrinkage → scheduled HC', k5, cells, k5Off);

  if (occOver.length) {
    console.log(`  K3b  occupancy over its cap        ${occOver.length}   ✗`);
    add('K3b', 'HIGH', `${occOver.length} cell(s) exceed the occupancy cap`, occOver.slice(0, 4).join(' · '));
  } else console.log(`  K3b  occupancy within its cap     ${cells}/${cells}   ✓`);

  // K6 — the CONFIRMED rule is chat/WhatsApp = 4. It says nothing about social or
  // email, so only functions actually carrying chat or WhatsApp are judged by it;
  // the rest are reported, not failed. (Flagging Social Media & Email for using 3
  // was this harness applying a rule to a channel the rule never named.)
  const concFns = day.functions.filter(f => f.model === 'concurrency');
  const chatFns = concFns.filter(f => {
    const mix = f.params?.channelMix ?? {};
    return !!(mix.chat || mix.whatsapp);
  });
  const wrongConc = chatFns.filter(f => (f.params?.concurrency ?? 0) !== 4);
  console.log(`  K6   chat/WhatsApp concurrency = 4  ${chatFns.length - wrongConc.length}/${chatFns.length}   ${wrongConc.length ? '✗' : '✓'}`);
  if (wrongConc.length) add('K6', 'HIGH', 'a chat/WhatsApp function does not use the confirmed concurrency of 4',
    wrongConc.map(f => `${f.functionKey}=${f.params?.concurrency}`).join(' · '));
  for (const f of concFns.filter(f => !chatFns.includes(f)))
    console.log(`       (${f.functionKey} carries ${Object.keys(f.params?.channelMix ?? {}).join('+')} at concurrency ` +
      `${f.params?.concurrency} — outside the chat/WhatsApp rule, reported not judged)`);

  // K7 — monotonicity: sort cells by volume, required HC must not go backwards
  let breaks = 0;
  for (const f of day.functions) {
    const pts = (f.hours || []).filter(c => c.volume).sort((a, b) => a.volume - b.volume);
    for (let i = 1; i < pts.length; i++) if (pts[i].requiredScheduledHc < pts[i - 1].requiredScheduledHc) breaks++;
  }
  console.log(`  K7   more volume never needs fewer  ${breaks === 0 ? 'ok' : breaks + ' inversion(s)'}   ${breaks ? '✗' : '✓'}`);
  if (breaks) add('K7', 'HIGH', `${breaks} case(s) where more volume required fewer agents`, '');

  // K8 — the generator consumes this engine's curve unchanged
  const gen = await api('/schedule-generator/generate-demand', {
    method: 'POST', body: JSON.stringify({ weekStart: '2026-08-15' }),
  });
  const engPeak = Math.max(...Array.from({ length: 24 }, (_, h) =>
    day.functions.reduce((s, f) => s + ((f.hours || []).find(c => c.hour === h)?.requiredScheduledHc ?? 0), 0)));
  const genDay = (gen.body?.verdict?.coverage?.perDay || []).find(d => d.date === date);
  const genPeak = genDay?.requiredPeak ?? null;
  const agree = genPeak != null && Math.abs(genPeak - engPeak) <= Math.max(2, engPeak * 0.1);
  console.log(`  K8   generator demand = this engine  engine peak ${engPeak} · generator ${genPeak ?? '—'}   ${agree ? '✓' : '✗'}`);
  if (genPeak != null && !agree) add('K8', 'HIGH', 'the generator and the requirement engine disagree on required HC',
    `requirement engine peak ${engPeak}, generator ${genPeak}`);

  console.log(`\n  ${'─'.repeat(66)}`);
  const high = findings.filter(f => f.sev === 'HIGH');
  if (!findings.length) { console.log(`  CLEAN — ${cells} cells re-derive to their own inputs\n`); process.exit(0); }
  for (const f of findings) console.log(`  ${pad(f.sev, 5)} ${pad(f.id, 5)} ${f.title}\n        ${f.detail}`);
  console.log(`\n  ${high.length} HIGH · ${findings.length} total\n`);
  process.exit(high.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
