/* ── ERLANG CORE (R2.2, 2026-07-10) ───────────────────────────────────────────
 * THE canonical Erlang-B/C numeric kernel. Three byte-similar private copies
 * lived in capacity.service.ts, staffing.service.ts and forecasting.engine.ts
 * (staffing's own comment called the duplication out). Every function below was
 * lifted VERBATIM from the crowned implementation in capacity.service.ts — the
 * floating-point operation sequences are unchanged, so every call site computes
 * bit-identical results (byte-diff-gated across all consumer endpoints).
 *
 *  PURE ERLANG-C ENGINE — canonical, numerically stable
 *
 *  Sources:
 *  - A.K. Erlang, "The Theory of Probabilities and Telephone Conversations"
 *    (1909) — Erlang B/C.
 *  - Brad Cleveland, "Call Center Management on Fast Forward" (4th ed. 2019)
 *    — size to P90 demand, never P50; SL formula; occupancy discipline.
 *  - D. Reinertsen, "Principles of Product Development Flow" (2009),
 *    Principle 12 — queues explode past ~85% utilization: occupancy cap.
 *  - Hopp & Spearman, "Factory Physics" (3rd ed. 2008) — VUT / stability.
 *
 *  Numerical note: the naive A^N/N! formulation overflows IEEE-754 doubles at
 *  N≈170 agents. The Erlang-B recursion below is exact and stable for any N:
 *      B(0)=1 ;  B(k) = A·B(k−1) / (k + A·B(k−1))
 *      C(N,A) = N·B / (N − A·(1−B))
 * ────────────────────────────────────────────────────────────────────────────*/

/** Erlang-B blocking probability — stable recursion, valid for any N. */
export function erlangB(agents: number, intensity: number): number {
  const N = Math.floor(agents);
  const A = intensity;
  if (N < 1) return 1;
  if (A <= 0) return 0;
  let b = 1.0;
  for (let k = 1; k <= N; k++) {
    b = (A * b) / (k + A * b);
  }
  return b;
}

/** Erlang-C probability that an arriving contact must wait (Pw). */
export function erlangC(agents: number, intensity: number): number {
  const N = Math.floor(agents);
  const A = intensity;
  if (N < 1) return 1;
  if (A <= 0) return 0;
  if (A >= N) return 1; // ρ ≥ 1 → unstable queue, everyone waits
  const b = erlangB(N, A);
  const c = (N * b) / (N - A * (1 - b));
  return Math.min(Math.max(c, 0), 1);
}

/** Service Level = P(answered within targetSec) = 1 − Pw·e^(−(N−A)·t/AHT). */
export function serviceLevel(agents: number, intensity: number, targetSec: number, ahtSec: number): number {
  if (agents < 1 || ahtSec <= 0) return 0;
  const N = Math.floor(agents);
  const A = intensity;
  if (A <= 0) return 1;
  if (A >= N) return 0;
  const pw = erlangC(N, A);
  const sl = 1 - pw * Math.exp(-((N - A) * targetSec) / ahtSec);
  return Math.min(Math.max(sl, 0), 1);
}

/** Average Speed of Answer (seconds) = Pw · AHT / (N − A). */
export function asa(agents: number, intensity: number, ahtSec: number): number {
  const N = Math.floor(agents);
  const A = intensity;
  if (N < 1 || A >= N) return Infinity;
  if (A <= 0) return 0;
  return (erlangC(N, A) * ahtSec) / (N - A);
}

/**
 * Minimum agents meeting BOTH the SL target AND the occupancy cap.
 * Occupancy ρ = A/N must stay ≤ occupancyCap (default 0.85 — Reinertsen P12:
 * beyond that, queue time grows hyperbolically and the team melts down).
 */
export function findMinAgents(
  intensity: number,
  targetSL: number,
  targetSec: number,
  ahtSec: number,
  occupancyCap = 0.85,
  maxIter = 2000,
): number {
  if (intensity <= 0) return 0;
  // Lower bounds: stability (N > A) and occupancy cap (N ≥ A/cap)
  let n = Math.max(Math.ceil(intensity / Math.max(occupancyCap, 0.01)), Math.floor(intensity) + 1, 1);
  for (let i = 0; i < maxIter; i++, n++) {
    if (serviceLevel(n, intensity, targetSec, ahtSec) >= targetSL) return n;
  }
  return n;
}

/**
 * Chat/WhatsApp concurrency: an agent handling c parallel conversations is NOT
 * c× as fast — context switching costs capacity. Marginal-efficiency model:
 *   effective servers per agent = 1 + (c−1)·eff   (eff ≈ 0.75 industry default)
 * With Boutiqaat's confirmed concurrency = 4 → 1 + 3·0.75 = 3.25 effective.
 */
export function effectiveServersPerAgent(concurrency: number, marginalEfficiency = 0.75): number {
  const c = Math.max(1, concurrency);
  return 1 + (c - 1) * Math.min(Math.max(marginalEfficiency, 0), 1);
}
