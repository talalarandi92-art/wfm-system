import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/* ─────────────────────────────────────────────────────────────────────────────
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
function erlangB(agents: number, intensity: number): number {
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
function erlangC(agents: number, intensity: number): number {
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
function serviceLevel(agents: number, intensity: number, targetSec: number, ahtSec: number): number {
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
function asa(agents: number, intensity: number, ahtSec: number): number {
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
function findMinAgents(
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
function effectiveServersPerAgent(concurrency: number, marginalEfficiency = 0.75): number {
  const c = Math.max(1, concurrency);
  return 1 + (c - 1) * Math.min(Math.max(marginalEfficiency, 0), 1);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  TYPES
 * ────────────────────────────────────────────────────────────────────────────*/

export interface IntervalInput {
  intervalStart: string; // "HH:MM"
  volume: number;
  aht?: number;          // override global AHT for this interval
}

export interface VoiceInputs {
  intervalMinutes: number;
  targetSL: number;           // 0.80 = 80%
  targetAnswerSec: number;    // e.g. 20 seconds
  defaultAht: number;         // seconds
  shrinkage: number;          // 0.25 = 25%
  occupancyTarget: number;    // 0.85 = 85%
  internFactor: number;       // 0.70 = 70% intern productivity
  intervals: IntervalInput[];
}

export interface ChatInputs {
  intervalMinutes: number;
  concurrency: number;       // 4 for chat/WA
  targetResponseSec: number;
  defaultAht: number;        // seconds
  shrinkage: number;
  occupancyTarget: number;
  internFactor: number;
  intervals: IntervalInput[];
}

export interface EmailInputs {
  intervalMinutes: number;
  defaultAht: number;        // seconds per email
  slaHours: number;          // target clearance hours
  shrinkage: number;
  internFactor: number;
  openingBacklog: number;    // emails in backlog at start
  intervals: IntervalInput[];
}

export interface HcIntervalResult {
  intervalStart: string;
  intervalEnd: string;
  volume: number;
  aht: number;
  workload: number;          // Erlangs for voice, normalized for others
  requiredHc: number;        // Pure HC needed (no shrinkage)
  requiredHcWithShrinkage: number;
  scheduledHc: number;       // From DB
  gap: number;               // required - scheduled (positive = understaffed)
  occupancy: number;         // 0-1
  serviceLevel?: number;     // 0-1 for voice
  asaSeconds?: number | null; // Average Speed of Answer at net staffing
  risk: 'ok' | 'warning' | 'critical';
}

export interface CapacityResult {
  functionId: string;
  functionName: string;
  channelType: string;
  date: string;
  totalRequired: number;
  totalScheduled: number;
  totalGap: number;
  avgOccupancy: number;
  slaAtRisk: boolean;
  intervals: HcIntervalResult[];
  scenarios: {
    base: { required: number; gap: number };
    withOT: { required: number; gap: number };
    lean: { required: number; gap: number };
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  SERVICE
 * ────────────────────────────────────────────────────────────────────────────*/

@Injectable()
export class CapacityService {
  constructor(private readonly ds: DataSource) {}

  /* ── Functions list ────────────────────────────────────────────────────── */
  async getFunctions(tenantId: string) {
    return this.ds.query(
      `SELECT id, name, name_ar, channel_type, concurrency, is_active
       FROM functions
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY sort_order, name`,
      [tenantId],
    );
  }

  /* ── Scheduled HC by interval from attendance_records ───────────────────── */
  async getScheduledHcByInterval(
    tenantId: string,
    functionId: string,
    date: string,
    intervalMinutes = 30,
  ): Promise<Record<string, number>> {
    // Get all scheduled shifts for this function on this date
    const shifts = await this.ds.query(
      `SELECT ar.scheduled_start, ar.scheduled_end
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       WHERE ar.tenant_id = $1
         AND e.function_id = $2
         AND ar.attendance_date::date = $3::date
         AND ar.scheduled_start IS NOT NULL`,
      [tenantId, functionId, date],
    );

    // Build HC count per interval slot
    const hcMap: Record<string, number> = {};

    for (let h = 6; h < 24; h++) {
      for (let m = 0; m < 60; m += intervalMinutes) {
        const slot = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        hcMap[slot] = 0;
      }
    }

    for (const shift of shifts) {
      const start = this.parseTimeMin(shift.scheduled_start);
      let end   = this.parseTimeMin(shift.scheduled_end);
      if (end <= start) end += 24 * 60; // cross midnight

      for (const slot of Object.keys(hcMap)) {
        const slotMin = this.parseTimeMin(slot);
        const slotEnd = slotMin + intervalMinutes;
        // Employee is present if their shift overlaps this interval
        if (start < slotEnd && end > slotMin) {
          hcMap[slot]++;
        }
      }
    }

    return hcMap;
  }

  private parseTimeMin(t: string): number {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  /* ── VOICE: Erlang-C calculation ─────────────────────────────────────────── */
  async calculateVoice(
    tenantId: string,
    functionId: string,
    date: string,
    inputs: VoiceInputs,
  ): Promise<CapacityResult> {
    const funcInfo = await this.getFunctionInfo(tenantId, functionId);
    const scheduledHc = await this.getScheduledHcByInterval(tenantId, functionId, date, inputs.intervalMinutes);

    const intervalResults: HcIntervalResult[] = [];
    let totalReq = 0, totalSched = 0, slotCount = 0, occupancySum = 0;

    for (const inp of inputs.intervals) {
      const slotKey = inp.intervalStart;
      const endMin = this.parseTimeMin(inp.intervalStart) + inputs.intervalMinutes;
      const endH   = Math.floor(endMin / 60);
      const endM   = endMin % 60;
      const intervalEnd = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;

      if (inp.volume <= 0) {
        const sched = scheduledHc[slotKey] ?? 0;
        intervalResults.push({
          intervalStart: inp.intervalStart, intervalEnd,
          volume: 0, aht: inputs.defaultAht,
          workload: 0, requiredHc: 0, requiredHcWithShrinkage: 0,
          scheduledHc: sched, gap: -sched,
          occupancy: 0, serviceLevel: 1, risk: 'ok',
        });
        totalSched += sched;
        continue;
      }

      const aht = inp.aht ?? inputs.defaultAht;
      const intervalSec = inputs.intervalMinutes * 60;

      // Traffic intensity (Erlangs)
      const callRate   = inp.volume / intervalSec; // calls per second
      const intensity  = callRate * aht;

      // Minimum HC for target SL — with the occupancy cap enforced (Reinertsen P12)
      const minHcPure = findMinAgents(
        intensity, inputs.targetSL, inputs.targetAnswerSec, aht, inputs.occupancyTarget);

      // Adjust for intern productivity
      const minHc = Math.ceil(minHcPure / inputs.internFactor);

      // HC with shrinkage (gross staffing) — Cleveland: net ÷ (1 − shrinkage)
      const hcWithShrinkage = Math.ceil(minHc / (1 - inputs.shrinkage));

      // Actual occupancy + SL + ASA at the pure (net) staffing point
      const occ = minHcPure > 0 ? Math.min(intensity / minHcPure, 1) : 0;
      const sl = serviceLevel(minHcPure, intensity, inputs.targetAnswerSec, aht);
      const asaSec = asa(minHcPure, intensity, aht);

      const sched = scheduledHc[slotKey] ?? 0;
      const gap   = hcWithShrinkage - sched;

      totalReq   += hcWithShrinkage;
      totalSched += sched;
      occupancySum += occ;
      slotCount++;

      intervalResults.push({
        intervalStart: inp.intervalStart, intervalEnd,
        volume: inp.volume, aht,
        workload: Math.round(intensity * 100) / 100,
        requiredHc: minHc, requiredHcWithShrinkage: hcWithShrinkage,
        scheduledHc: sched, gap,
        occupancy: Math.round(occ * 1000) / 1000,
        serviceLevel: Math.round(sl * 1000) / 1000,
        asaSeconds: Number.isFinite(asaSec) ? Math.round(asaSec) : null,
        risk: gap > 3 ? 'critical' : gap > 0 ? 'warning' : 'ok',
      });
    }

    const avgOcc = slotCount > 0 ? occupancySum / slotCount : 0;
    const totalGap = totalReq - totalSched;

    return {
      functionId, functionName: funcInfo?.name ?? '—',
      channelType: 'voice', date,
      totalRequired: totalReq, totalScheduled: totalSched, totalGap,
      avgOccupancy: Math.round(avgOcc * 1000) / 1000,
      slaAtRisk: intervalResults.some(i => i.serviceLevel !== undefined && i.serviceLevel < inputs.targetSL),
      intervals: intervalResults,
      scenarios: {
        base:   { required: totalReq,                      gap: totalGap },
        withOT: { required: Math.ceil(totalReq * 0.9),     gap: Math.ceil(totalReq * 0.9) - totalSched },
        lean:   { required: Math.ceil(totalReq * 1.15),    gap: Math.ceil(totalReq * 1.15) - totalSched },
      },
    };
  }

  /* ── CHAT / WHATSAPP: Concurrency model ──────────────────────────────────── */
  async calculateChat(
    tenantId: string,
    functionId: string,
    date: string,
    inputs: ChatInputs,
  ): Promise<CapacityResult> {
    const funcInfo = await this.getFunctionInfo(tenantId, functionId);
    const scheduledHc = await this.getScheduledHcByInterval(tenantId, functionId, date, inputs.intervalMinutes);

    const intervalResults: HcIntervalResult[] = [];
    let totalReq = 0, totalSched = 0, occupancySum = 0, slotCount = 0;

    for (const inp of inputs.intervals) {
      const slotKey = inp.intervalStart;
      const endMin = this.parseTimeMin(inp.intervalStart) + inputs.intervalMinutes;
      const intervalEnd = `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`;

      if (inp.volume <= 0) {
        const sched = scheduledHc[slotKey] ?? 0;
        intervalResults.push({ intervalStart: inp.intervalStart, intervalEnd, volume: 0, aht: inputs.defaultAht, workload: 0, requiredHc: 0, requiredHcWithShrinkage: 0, scheduledHc: sched, gap: -sched, occupancy: 0, risk: 'ok' });
        totalSched += sched;
        continue;
      }

      const aht = inp.aht ?? inputs.defaultAht;
      const intervalSec = inputs.intervalMinutes * 60;
      const concurrency = inputs.concurrency;

      // Workload = volume * AHT / interval_seconds
      const workload = (inp.volume * aht) / intervalSec;

      // Raw agents = workload / (concurrency * occupancy)
      // Erlang-C on EFFECTIVE servers, not naive division (Kingman: queues are
      // nonlinear — the linear model understaffs badly near the SL knee).
      // Each agent contributes 1+(c−1)·0.75 effective servers (context-switch cost).
      const effPerAgent = effectiveServersPerAgent(concurrency);
      const effServersNeeded = findMinAgents(
        workload, 0.8, inputs.targetResponseSec, aht, inputs.occupancyTarget);

      let rawAgents = Math.ceil(effServersNeeded / effPerAgent);
      rawAgents = Math.ceil(rawAgents / inputs.internFactor);
      const hcWithShrinkage = Math.ceil(rawAgents / (1 - inputs.shrinkage));
      const occ = rawAgents > 0 ? Math.min(workload / (rawAgents * effPerAgent), 1) : 0;
      const sl  = serviceLevel(rawAgents * effPerAgent, workload, inputs.targetResponseSec, aht);

      const sched = scheduledHc[slotKey] ?? 0;
      const gap   = hcWithShrinkage - sched;

      totalReq   += hcWithShrinkage;
      totalSched += sched;
      occupancySum += occ;
      slotCount++;

      intervalResults.push({
        intervalStart: inp.intervalStart, intervalEnd,
        volume: inp.volume, aht,
        workload: Math.round(workload * 100) / 100,
        requiredHc: rawAgents, requiredHcWithShrinkage: hcWithShrinkage,
        scheduledHc: sched, gap,
        occupancy: Math.round(occ * 1000) / 1000,
        serviceLevel: Math.round(sl * 1000) / 1000,
        risk: gap > 2 ? 'critical' : gap > 0 ? 'warning' : 'ok',
      });
    }

    const avgOcc = slotCount > 0 ? occupancySum / slotCount : 0;
    const totalGap = totalReq - totalSched;

    return {
      functionId, functionName: funcInfo?.name ?? '—',
      channelType: funcInfo?.channel_type ?? 'chat', date,
      totalRequired: totalReq, totalScheduled: totalSched, totalGap,
      avgOccupancy: Math.round(avgOcc * 1000) / 1000,
      slaAtRisk: totalGap > 0,
      intervals: intervalResults,
      scenarios: {
        base:   { required: totalReq,                   gap: totalGap },
        withOT: { required: Math.ceil(totalReq * 0.9),  gap: Math.ceil(totalReq * 0.9) - totalSched },
        lean:   { required: Math.ceil(totalReq * 1.1),  gap: Math.ceil(totalReq * 1.1) - totalSched },
      },
    };
  }

  /* ── EMAIL: Backlog / throughput model ───────────────────────────────────── */
  async calculateEmail(
    tenantId: string,
    functionId: string,
    date: string,
    inputs: EmailInputs,
  ): Promise<CapacityResult> {
    const funcInfo = await this.getFunctionInfo(tenantId, functionId);
    const scheduledHc = await this.getScheduledHcByInterval(tenantId, functionId, date, inputs.intervalMinutes);

    const intervalResults: HcIntervalResult[] = [];
    let totalReq = 0, totalSched = 0;
    let runningBacklog = inputs.openingBacklog;

    for (const inp of inputs.intervals) {
      const slotKey = inp.intervalStart;
      const endMin = this.parseTimeMin(inp.intervalStart) + inputs.intervalMinutes;
      const intervalEnd = `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`;
      const aht = inp.aht ?? inputs.defaultAht;

      const sched = scheduledHc[slotKey] ?? 0;
      const intervalHours = inputs.intervalMinutes / 60;

      if (inp.volume <= 0 && runningBacklog <= 0) {
        intervalResults.push({ intervalStart: inp.intervalStart, intervalEnd, volume: 0, aht, workload: 0, requiredHc: 0, requiredHcWithShrinkage: 0, scheduledHc: sched, gap: -sched, occupancy: 0, risk: 'ok' });
        totalSched += sched;
        continue;
      }

      const totalWork = (runningBacklog + inp.volume) * aht; // seconds
      const availSecondsPerAgent = intervalHours * 3600 * (1 - inputs.shrinkage);
      const rawAgents = Math.ceil(totalWork / availSecondsPerAgent / inputs.internFactor);

      // Simulate clearance
      const throughputPerAgent = availSecondsPerAgent / aht;
      const totalThroughput = rawAgents * throughputPerAgent;
      runningBacklog = Math.max(0, runningBacklog + inp.volume - totalThroughput);

      const occ = rawAgents > 0 ? Math.min(totalWork / (rawAgents * availSecondsPerAgent), 1) : 0;
      const gap = rawAgents - sched;

      totalReq   += rawAgents;
      totalSched += sched;

      intervalResults.push({
        intervalStart: inp.intervalStart, intervalEnd,
        volume: inp.volume, aht,
        workload: Math.round((totalWork / 3600) * 100) / 100, // hours
        requiredHc: rawAgents, requiredHcWithShrinkage: rawAgents,
        scheduledHc: sched, gap,
        occupancy: Math.round(occ * 1000) / 1000,
        risk: gap > 2 ? 'critical' : gap > 0 ? 'warning' : 'ok',
      });
    }

    const totalGap = totalReq - totalSched;
    return {
      functionId, functionName: funcInfo?.name ?? '—',
      channelType: 'email', date,
      totalRequired: totalReq, totalScheduled: totalSched, totalGap,
      avgOccupancy: 0.75,
      slaAtRisk: runningBacklog > 0,
      intervals: intervalResults,
      scenarios: {
        base:   { required: totalReq,                   gap: totalGap },
        withOT: { required: Math.ceil(totalReq * 0.85), gap: Math.ceil(totalReq * 0.85) - totalSched },
        lean:   { required: Math.ceil(totalReq * 1.1),  gap: Math.ceil(totalReq * 1.1) - totalSched },
      },
    };
  }

  /* ── Current HC snapshot (from attendance_records) ───────────────────────── */
  async getCurrentHcOverview(tenantId: string, date: string) {
    const rows = await this.ds.query(
      `SELECT e.function_id, f.name AS func_name, f.channel_type, f.concurrency,
              COUNT(*) AS scheduled_hc,
              SUM(CASE WHEN ar.is_wfh THEN 1 ELSE 0 END) AS wfh_hc,
              COUNT(*) - SUM(CASE WHEN ar.is_wfh THEN 1 ELSE 0 END) AS office_hc
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       JOIN functions f ON f.id = e.function_id
       WHERE ar.tenant_id = $1
         AND ar.attendance_date::date = $2::date
         AND ar.scheduled_start IS NOT NULL
         AND f.is_active = true
       GROUP BY e.function_id, f.name, f.channel_type, f.concurrency
       ORDER BY scheduled_hc DESC`,
      [tenantId, date],
    );
    return rows;
  }

  /* ── HC by interval for a function (for the chart) ─────────────────────── */
  async getHcByInterval(tenantId: string, functionId: string, date: string) {
    const hcMap = await this.getScheduledHcByInterval(tenantId, functionId, date, 30);
    return Object.entries(hcMap).map(([slot, hc]) => ({
      intervalStart: slot,
      scheduledHc: hc,
    }));
  }

  private async getFunctionInfo(tenantId: string, functionId: string) {
    const r = await this.ds.query(
      `SELECT id, name, name_ar, channel_type, concurrency
       FROM functions WHERE id = $1 AND tenant_id = $2`,
      [functionId, tenantId],
    );
    return r[0] ?? null;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  LIVE CAPACITY PLAN — measured workload from Sprinklr, not assumptions.
   *
   *  Key insight: Sprinklr's inProgress per queue IS the concurrent load —
   *  i.e. the offered traffic A in Erlangs, measured directly. No volume×AHT
   *  estimation error. Waiting counts expose unserved demand on top.
   *
   *  Per 30-min interval and channel:
   *    A_measured  = avg(inProgress)  +  avg(waiting)·urgencyWeight
   *    N_required  = Erlang-C minimum agents for SL target @ occupancy cap
   *                  (÷ effective servers/agent for concurrency channels)
   *    N_staffed   = N_required ÷ (1 − shrinkage)
   *    gap         = N_staffed − scheduled HC (from attendance_records)
   * ═══════════════════════════════════════════════════════════════════════════ */
  async getLivePlan(tenantId: string, date: string, opts?: {
    targetSL?: number; targetAnswerSec?: number; ahtSec?: number;
    shrinkage?: number; occupancyCap?: number; concurrency?: number;
  }) {
    const targetSL     = opts?.targetSL ?? 0.8;
    const targetSec    = opts?.targetAnswerSec ?? 60;     // chat-first center: 60s first response
    const ahtSec       = opts?.ahtSec ?? 300;             // 5 min default conversation AHT
    const shrinkage    = Math.min(opts?.shrinkage ?? 0.25, 0.9);
    const occupancyCap = opts?.occupancyCap ?? 0.85;
    const concurrency  = opts?.concurrency ?? 4;          // Boutiqaat confirmed
    const effPerAgent  = effectiveServersPerAgent(concurrency);

    // 1. Snapshots for the operational day (Kuwait)
    const snaps: { captured_at: string; queues_json: any }[] = await this.ds.query(
      `SELECT captured_at, queues_json FROM integration_snapshots
       WHERE tenant_id = $1 AND source = 'sprinklr'
         AND captured_at BETWEEN ($2::date::timestamptz - interval '3 hours')
                             AND ($2::date::timestamptz + interval '21 hours')
       ORDER BY captured_at ASC`,
      [tenantId, date],
    );

    // 2. Scheduled HC per interval — ALL working employees (cross-midnight aware)
    const shifts: any[] = await this.ds.query(
      `SELECT scheduled_start, scheduled_end FROM attendance_records
       WHERE tenant_id = $1 AND attendance_date = $2::date
         AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL`,
      [tenantId, date],
    );

    const dayStart = new Date(`${date}T00:00:00+03:00`).getTime();
    const parse = (v: any) => (Array.isArray(v) ? v : JSON.parse(v || '[]'));

    type Acc = { inProg: number[]; waiting: number[] };
    const byInterval: Map<number, Map<string, Acc>> = new Map();

    for (const s of snaps) {
      const idx = Math.floor((new Date(s.captured_at).getTime() - dayStart) / (30 * 60000));
      if (idx < 0 || idx >= 48) continue;
      const queues: any[] = parse(s.queues_json);
      const perCh = byInterval.get(idx) ?? new Map<string, Acc>();
      const chAgg: Record<string, { p: number; w: number }> = {};
      for (const q of queues) {
        const ch = q.channel || 'unknown';
        chAgg[ch] = chAgg[ch] || { p: 0, w: 0 };
        chAgg[ch].p += q.inProgress ?? 0;
        chAgg[ch].w += q.waiting ?? 0;
      }
      for (const [ch, v] of Object.entries(chAgg)) {
        const acc = perCh.get(ch) ?? { inProg: [], waiting: [] };
        acc.inProg.push(v.p);
        acc.waiting.push(v.w);
        perCh.set(ch, acc);
      }
      byInterval.set(idx, perCh);
    }

    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    const intervals: any[] = [];
    const channelsSeen = new Set<string>();
    let totalReq = 0, totalSched = 0, slots = 0;

    for (let i = 0; i < 48; i++) {
      const from = dayStart + i * 30 * 60000;
      const hh = String(Math.floor(i / 2)).padStart(2, '0');
      const mm = i % 2 === 0 ? '00' : '30';
      const label = `${hh}:${mm}`;

      const scheduled = shifts.filter(sh => {
        const st = this.parseTimeMin(sh.scheduled_start);
        let en = this.parseTimeMin(sh.scheduled_end);
        if (en <= st) en += 24 * 60;
        const slotMin = i * 30;
        return st < slotMin + 30 && en > slotMin;
      }).length;

      const perCh = byInterval.get(i);
      if (!perCh) {
        intervals.push({ interval: label, measured: false, scheduledHc: scheduled,
          channels: [], totalErlangs: 0, requiredHc: null, gap: null, risk: 'no-data' });
        continue;
      }

      let intervalErlangs = 0;
      const channels: any[] = [];
      // Channel semantics matter (Gartner/Kingman — anti-pattern #7):
      //  - SYNC (voice, live chat): "waiting" is a real-time queue → near-full pressure.
      //  - ASYNC (whatsapp, email, social): "waiting" is a BACKLOG measured in hours,
      //    not seconds. Pressure = backlog cleared over a working horizon:
      //    backlogErlangs = backlog × AHT / horizonSec  (Little's Law throughput).
      const SYNC = new Set(['voice', 'chat']);
      const BACKLOG_HORIZON_SEC = 8 * 3600; // clear async backlog within the working day
      for (const [ch, acc] of perCh.entries()) {
        channelsSeen.add(ch);
        const inProg  = avg(acc.inProg);
        const waiting = avg(acc.waiting);
        const backlogErlangs = SYNC.has(ch)
          ? waiting * 0.5
          : (waiting * ahtSec) / BACKLOG_HORIZON_SEC;
        const erlangs = inProg + backlogErlangs;
        intervalErlangs += erlangs;
        channels.push({
          channel: ch,
          avgInProgress:  +inProg.toFixed(1),
          avgWaiting:     +waiting.toFixed(1),
          backlogErlangs: +backlogErlangs.toFixed(1),
          erlangs:        +erlangs.toFixed(1),
          mode: SYNC.has(ch) ? 'sync' : 'async-backlog',
        });
      }

      // Erlang-C on effective servers → physical agents → gross with shrinkage
      const effNeeded = findMinAgents(intervalErlangs, targetSL, targetSec, ahtSec, occupancyCap);
      const netAgents = Math.ceil(effNeeded / effPerAgent);
      const required  = Math.ceil(netAgents / (1 - shrinkage));
      const gap = required - scheduled;

      totalReq += required; totalSched += scheduled; slots++;

      intervals.push({
        interval: label, measured: true,
        channels: channels.sort((a, b) => b.erlangs - a.erlangs),
        totalErlangs: +intervalErlangs.toFixed(1),
        requiredHc: required, scheduledHc: scheduled, gap,
        serviceLevel: +serviceLevel(netAgents * effPerAgent, intervalErlangs, targetSec, ahtSec).toFixed(3),
        risk: gap > 3 ? 'critical' : gap > 0 ? 'warning' : 'ok',
      });
    }

    const measured = intervals.filter(x => x.measured);
    return {
      date,
      assumptions: { targetSL, targetAnswerSec: targetSec, ahtSec, shrinkage, occupancyCap,
                     concurrency, effectiveServersPerAgent: +effPerAgent.toFixed(2),
                     method: 'Erlang-C on measured concurrent load (Sprinklr inProgress) + 0.5×waiting' },
      coverage: { measuredIntervals: measured.length, totalIntervals: 48,
                  snapshots: snaps.length, channels: [...channelsSeen] },
      summary: {
        peakErlangs:    measured.length ? Math.max(...measured.map(x => x.totalErlangs)) : 0,
        peakRequiredHc: measured.length ? Math.max(...measured.map(x => x.requiredHc ?? 0)) : 0,
        avgRequiredHc:  slots ? Math.round(totalReq / slots) : 0,
        avgScheduledHc: slots ? Math.round(totalSched / slots) : 0,
        worstGap:       measured.length ? Math.max(...measured.map(x => x.gap ?? 0)) : 0,
        criticalIntervals: measured.filter(x => x.risk === 'critical').length,
      },
      intervals,
    };
  }

  /* ── Scenario persistence ───────────────────────────────────────────────── */
  async saveScenario(tenantId: string, userId: string, dto: {
    name: string; channel: string; scenarioType?: string;
    inputs: any; results: any; notes?: string;
  }) {
    const [row] = await this.ds.query(
      `INSERT INTO capacity_scenarios
         (tenant_id, name, channel, scenario_type, inputs, results, notes, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
       ON CONFLICT (tenant_id, name, channel) DO UPDATE SET
         scenario_type = EXCLUDED.scenario_type,
         inputs  = EXCLUDED.inputs,
         results = EXCLUDED.results,
         notes   = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id, name, channel, updated_at`,
      [tenantId, dto.name, dto.channel, dto.scenarioType ?? 'base',
       JSON.stringify(dto.inputs), JSON.stringify(dto.results), dto.notes ?? null, userId],
    );
    return row;
  }

  async listScenarios(tenantId: string, channel?: string) {
    return this.ds.query(
      `SELECT s.id, s.name, s.channel, s.scenario_type, s.notes, s.updated_at,
              s.inputs, s.results,
              TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name,''))) AS created_by_name
       FROM capacity_scenarios s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.tenant_id = $1 ${channel ? 'AND s.channel = $2' : ''}
       ORDER BY s.updated_at DESC LIMIT 50`,
      channel ? [tenantId, channel] : [tenantId],
    );
  }

  async deleteScenario(tenantId: string, id: string) {
    await this.ds.query(
      `DELETE FROM capacity_scenarios WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return { ok: true };
  }
}
