/**
 * Zero-dependency load tester (Phase 4 DoD: "100+ concurrent users on the SAME page").
 * N concurrent workers hammer one endpoint for D seconds; reports rps, p50/p95/p99, errors.
 *
 *   node scripts/loadtest.cjs "<path>" [concurrency] [seconds]
 *   e.g. node scripts/loadtest.cjs "/attendance-recon/roster-v2/hourly?from=2026-06-01&to=2026-06-30" 120 30
 *
 * Uses the bridge account. Node's global fetch; keep-alive via undici defaults.
 */
const BASE = process.env.LT_BASE || 'http://localhost:3000/api/v1';
const PATHQ = process.argv[2];
const CONC = +(process.argv[3] || 120);
const SECS = +(process.argv[4] || 30);
if (!PATHQ) { console.error('usage: node scripts/loadtest.cjs "<path>" [conc] [secs]'); process.exit(1); }

(async () => {
  // login once
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bridge@boutiqaat.wfm', password: 'Demo@2026' }),
  });
  const { accessToken } = await lr.json();
  if (!accessToken) { console.error('login failed'); process.exit(1); }
  const H = { Authorization: `Bearer ${accessToken}` };
  const url = `${BASE}${PATHQ}`;

  // warmup (2 hits)
  await fetch(url, { headers: H }).then(r => r.text()).catch(() => {});
  await fetch(url, { headers: H }).then(r => r.text()).catch(() => {});

  const lat = [];
  let ok = 0, errs = 0, non200 = 0, throttled = 0;
  const deadline = Date.now() + SECS * 1000;

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = process.hrtime.bigint();
      try {
        const res = await fetch(url, { headers: H });
        await res.arrayBuffer();                       // drain
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (res.status === 200) { ok++; lat.push(ms); }
        else if (res.status === 429) throttled++;
        else non200++;
      } catch { errs++; }
    }
  }

  console.log(`[loadtest] ${url}`);
  console.log(`[loadtest] concurrency=${CONC} duration=${SECS}s ...`);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, worker));
  const wall = (Date.now() - t0) / 1000;

  lat.sort((a, b) => a - b);
  const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : NaN).toFixed(0);
  const total = ok + non200 + errs + throttled;
  console.log(`\nrequests: ${total}  (ok ${ok} · non200 ${non200} · net-errors ${errs} · 429 ${throttled})`);
  console.log(`throughput: ${(ok / wall).toFixed(1)} rps`);
  console.log(`latency ms: p50=${q(0.50)}  p95=${q(0.95)}  p99=${q(0.99)}  max=${(lat[lat.length - 1] || 0).toFixed(0)}`);
  console.log(`error rate: ${(((non200 + errs) / Math.max(1, total)) * 100).toFixed(2)}%`);
  const pass = +q(0.95) < 1000 && (non200 + errs) / Math.max(1, total) < 0.001;
  console.log(pass ? '✅ PASS (p95<1s, err<0.1%)' : '❌ FAIL vs the DoD bar (p95<1s, err<0.1%)');
})();
