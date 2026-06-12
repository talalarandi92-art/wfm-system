import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/* ─────────────────────────────────────────────────────────────────────────────
 *  PURE ERLANG-C ENGINE
 * ────────────────────────────────────────────────────────────────────────────*/

/** Erlang-C probability of queuing (Pw) — standard formula */
function erlangC(agents: number, intensity: number): number {
  if (agents < 1) return 1;
  const N = Math.floor(agents);
  const A = intensity;
  if (A >= N) return 1; // unstable

  // Compute B(N,A) = A^N / N! iteratively (Erlang-B by recursion)
  let b = 1.0;
  for (let i = 1; i <= N; i++) {
    b = (A * b) / (i + A * b) * (i + A * b) / i; // full Erlang-B
  }
  // Actually use Erlang-C direct: Pw = N * B(N,A) / (N - A + A * B(N,A)) — but let's use factorials
  // Iterative Erlang-C using partial sums
  let factorial = 1.0;
  let sum = 1.0;
  let aN = 1.0;
  for (let i = 1; i <= N; i++) {
    aN *= A;
    factorial *= i;
    sum += aN / factorial;
  }
  const lastTerm = aN / factorial;
  const pw = lastTerm * (N / (N - A)) / (sum - lastTerm + lastTerm * (N / (N - A)));
  return Math.min(Math.max(pw, 0), 1);
}

/** Service Level for given N, A, target_seconds, AHT_seconds */
function serviceLevel(agents: number, intensity: number, targetSec: number, ahtSec: number): number {
  if (agents < 1 || ahtSec <= 0) return 0;
  const N = Math.max(agents, 1);
  const A = intensity;
  if (A <= 0) return 1;
  if (A >= N) return 0;
  const pw = erlangC(N, A);
  const sl = 1 - pw * Math.exp(-(N - A) * targetSec / ahtSec);
  return Math.min(Math.max(sl, 0), 1);
}

/** Find minimum agents to meet target SL */
function findMinAgents(
  intensity: number,
  targetSL: number,
  targetSec: number,
  ahtSec: number,
  maxIter = 100,
): number {
  if (intensity <= 0) return 0;
  let n = Math.max(Math.ceil(intensity) + 1, 1);
  for (let i = 0; i < maxIter; i++) {
    const sl = serviceLevel(n, intensity, targetSec, ahtSec);
    if (sl >= targetSL) return n;
    n++;
  }
  return n;
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

      // Minimum HC for target SL
      let minHc = findMinAgents(intensity, inputs.targetSL, inputs.targetAnswerSec, aht);

      // Adjust for intern productivity
      minHc = Math.ceil(minHc / inputs.internFactor);

      // HC with shrinkage (gross staffing)
      const hcWithShrinkage = Math.ceil(minHc / (1 - inputs.shrinkage));

      // Actual occupancy at minHc
      const occ = minHc > 0 ? Math.min(intensity / minHc, 1) : 0;

      // SL check
      const sl = serviceLevel(minHc, intensity, inputs.targetAnswerSec, aht);

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
      let rawAgents = workload / (concurrency * inputs.occupancyTarget);
      rawAgents = Math.ceil(rawAgents / inputs.internFactor);
      const hcWithShrinkage = Math.ceil(rawAgents / (1 - inputs.shrinkage));
      const occ = rawAgents > 0 ? Math.min(workload / (rawAgents * concurrency), 1) : 0;

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
}
