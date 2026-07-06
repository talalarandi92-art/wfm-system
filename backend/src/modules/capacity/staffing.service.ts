import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/* ═════════════════════════════════════════════════════════════════════════════
 *  STAFFING REQUIREMENT ENGINE — forecast → Erlang → hourly required HC
 *
 *  The chain the Director mandated (2026-07-06): per FUNCTION per HOUR,
 *  from contact load (orders × CPO% as the demand driver / measured contact
 *  history as the baseline), through effective AHT (talk + hold + ACW),
 *  Erlang-C with an occupancy cap, then productivity and shrinkage — producing
 *  the scheduled-headcount requirement the schedule generator must cover FIRST;
 *  rotation/fairness/humane rules apply inside that envelope.
 *
 *  Method (industry order-of-operations — Cleveland "Fast Forward", Calabrio/
 *  NICE practice): Erlang answers "how many must be AVAILABLE"; shrinkage
 *  answers "how many must be SCHEDULED to have that many available".
 *    1. volume/h  = same-weekday 28-day baseline of offered contacts per
 *                   channel × the channel's intraday profile (48 half-hours),
 *                   scaled by the orders scenario (ordersScale × CPO lever).
 *    2. ahtEff    = AHT(talk, measured 28d unless overridden) + hold + ACW.
 *    3. erlangs A = volume/h × ahtEff / 3600.
 *    4. N_avail   = min agents meeting the SL target (Erlang-C, stable
 *                   recursion) AND the occupancy cap; concurrency channels
 *                   divide by effective servers/agent; throughput back-office
 *                   staffs to workload/occupancy.
 *    5. N_prod    = N_avail / productivity        (interns ≈ 0.70 blended).
 *    6. N_sched   = ceil(N_prod / (1 − shrinkage)) — the generator target.
 *  Every intermediate value is returned so the UI can show the exact math.
 * ════════════════════════════════════════════════════════════════════════════ */

// ── the same numerically-stable Erlang core as capacity.service (kept private
//    there) — duplicated formulas are forbidden, so re-derive from the identical
//    published recursion and lock behavior with the staffing smoke test.
function erlangB(agents: number, intensity: number): number {
  const N = Math.floor(agents); const A = intensity;
  if (N < 1) return 1; if (A <= 0) return 0;
  let b = 1.0;
  for (let k = 1; k <= N; k++) b = (A * b) / (k + A * b);
  return b;
}
function erlangC(agents: number, intensity: number): number {
  const N = Math.floor(agents); const A = intensity;
  if (N < 1) return 1; if (A <= 0) return 0; if (A >= N) return 1;
  const b = erlangB(N, A);
  return Math.min(Math.max((N * b) / (N - A * (1 - b)), 0), 1);
}
function serviceLevel(agents: number, intensity: number, targetSec: number, ahtSec: number): number {
  if (agents < 1 || ahtSec <= 0) return 0;
  const N = Math.floor(agents); const A = intensity;
  if (A <= 0) return 1; if (A >= N) return 0;
  return Math.min(Math.max(1 - erlangC(N, A) * Math.exp(-((N - A) * targetSec) / ahtSec), 0), 1);
}
function findMinAgents(intensity: number, targetSL: number, targetSec: number, ahtSec: number, occupancyCap: number): number {
  if (intensity <= 0) return 0;
  let n = Math.max(Math.ceil(intensity / Math.max(occupancyCap, 0.01)), Math.floor(intensity) + 1, 1);
  for (let i = 0; i < 2000; i++, n++) {
    if (serviceLevel(n, intensity, targetSec, ahtSec) >= targetSL) return n;
  }
  return n;
}
function effectiveServersPerAgent(concurrency: number, marginalEff: number): number {
  const c = Math.max(1, concurrency);
  return 1 + (c - 1) * Math.min(Math.max(marginalEff, 0), 1);
}

export interface StaffingParams {
  functionKey: string;
  channelMix: Record<string, number>;
  model: 'erlang_c' | 'concurrency' | 'throughput';
  cpoPct: number | null;
  ahtSec: number | null;       // null = measured
  acwSec: number;
  holdSec: number;
  targetSl: number;
  targetAnswerSec: number;
  occupancyCap: number;
  shrinkage: number;
  productivity: number;
  concurrency: number;
  marginalEff: number;
  isStaffed: boolean;
}

export interface HourRequirement {
  hour: number;
  volume: number;              // forecast contacts this hour
  ahtEffSec: number;           // talk + hold + acw (volume-weighted across the mix)
  erlangs: number;
  agentsForSl: number;         // Erlang/occupancy answer — must be AVAILABLE
  occupancyAtN: number;
  afterProductivity: number;
  requiredScheduledHc: number; // after shrinkage — the generator target
}

@Injectable()
export class StaffingService {
  constructor(private readonly ds: DataSource) {}

  /* ── params ──────────────────────────────────────────────────────────────── */
  async getParams(tenantId: string): Promise<StaffingParams[]> {
    const rows = await this.ds.query(
      `SELECT function_key, channel_mix, model, cpo_pct, aht_sec, acw_sec, hold_sec,
              target_sl, target_answer_sec, occupancy_cap, shrinkage, productivity,
              concurrency, marginal_eff, is_staffed
       FROM staffing_params WHERE tenant_id = $1 ORDER BY function_key`,
      [tenantId],
    );
    return rows.map((r: any) => ({
      functionKey: r.function_key,
      channelMix: typeof r.channel_mix === 'string' ? JSON.parse(r.channel_mix) : (r.channel_mix ?? {}),
      model: r.model,
      cpoPct: r.cpo_pct == null ? null : +r.cpo_pct,
      ahtSec: r.aht_sec == null ? null : +r.aht_sec,
      acwSec: +r.acw_sec, holdSec: +r.hold_sec,
      targetSl: +r.target_sl, targetAnswerSec: +r.target_answer_sec,
      occupancyCap: +r.occupancy_cap, shrinkage: +r.shrinkage,
      productivity: +r.productivity, concurrency: +r.concurrency,
      marginalEff: +r.marginal_eff, isStaffed: !!r.is_staffed,
    }));
  }

  async updateParams(tenantId: string, functionKey: string, patch: Record<string, any>, userId?: string) {
    const map: Record<string, string> = {
      channelMix: 'channel_mix', model: 'model', cpoPct: 'cpo_pct', ahtSec: 'aht_sec',
      acwSec: 'acw_sec', holdSec: 'hold_sec', targetSl: 'target_sl',
      targetAnswerSec: 'target_answer_sec', occupancyCap: 'occupancy_cap',
      shrinkage: 'shrinkage', productivity: 'productivity', concurrency: 'concurrency',
      marginalEff: 'marginal_eff', isStaffed: 'is_staffed',
    };
    const sets: string[] = []; const vals: any[] = [tenantId, functionKey];
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) {
        vals.push(k === 'channelMix' ? JSON.stringify(patch[k]) : patch[k]);
        sets.push(`${col} = $${vals.length}${k === 'channelMix' ? '::jsonb' : ''}`);
      }
    }
    if (!sets.length) return { updated: false };
    if (userId) { vals.push(userId); sets.push(`updated_by = $${vals.length}`); }
    sets.push('updated_at = NOW()');
    const res = await this.ds.query(
      `UPDATE staffing_params SET ${sets.join(', ')} WHERE tenant_id = $1 AND function_key = $2 RETURNING function_key`,
      vals,
    );
    if (!res.length) throw new BadRequestException(`Unknown function '${functionKey}' — seed it in staffing_params first`);
    return { updated: true, functionKey };
  }

  /* ── measured facts: AHT + volume baseline + intraday profile + CPO ─────── */
  private async channelFacts(tenantId: string, asOf: string) {
    // 28-day measured AHT per channel (talk seconds / handled)
    const aht = await this.ds.query(
      `SELECT channel, (SUM(talk_seconds)::numeric / NULLIF(SUM(handled),0))::numeric(10,1) AS aht
       FROM contact_volume_daily
       WHERE tenant_id = $1 AND vol_date BETWEEN ($2::date - 28) AND $2::date
         AND handled > 0 AND talk_seconds > 0
       GROUP BY channel`,
      [tenantId, asOf],
    );
    // same-weekday daily offered baseline per channel (last 4 same weekdays; avg)
    const daily = await this.ds.query(
      `SELECT channel, EXTRACT(DOW FROM vol_date)::int AS dow, AVG(offered)::numeric(12,1) AS offered
       FROM (
         SELECT channel, vol_date, offered,
                ROW_NUMBER() OVER (PARTITION BY channel, EXTRACT(DOW FROM vol_date) ORDER BY vol_date DESC) AS rn
         FROM contact_volume_daily
         WHERE tenant_id = $1 AND vol_date <= $2::date AND offered > 0
       ) t WHERE rn <= 4
       GROUP BY channel, dow`,
      [tenantId, asOf],
    );
    // intraday shape: 48 half-hour shares per channel (normalized)
    const prof = await this.ds.query(
      `SELECT channel, interval_idx, offered FROM contact_volume_profile WHERE tenant_id = $1`,
      [tenantId],
    );
    // CPO actual: contacts per order over the latest order period (transparency metric)
    const [orders] = await this.ds.query(
      `SELECT period_label, count FROM order_aggregates
       WHERE tenant_id = $1 AND dimension = '_total' ORDER BY period_label DESC LIMIT 1`,
      [tenantId],
    ).catch(() => [null]);

    const ahtBy: Record<string, number> = {};
    for (const r of aht) ahtBy[r.channel] = +r.aht;
    const dailyBy: Record<string, Record<number, number>> = {};
    for (const r of daily) (dailyBy[r.channel] = dailyBy[r.channel] || {})[+r.dow] = +r.offered;
    const profBy: Record<string, number[]> = {};
    for (const r of prof) {
      (profBy[r.channel] = profBy[r.channel] || new Array(48).fill(0))[+r.interval_idx] = +r.offered;
    }
    for (const ch of Object.keys(profBy)) {
      const tot = profBy[ch].reduce((a, b) => a + b, 0) || 1;
      profBy[ch] = profBy[ch].map(v => v / tot);
    }
    return { ahtBy, dailyBy, profBy, ordersPeriod: orders ?? null };
  }

  /* ── THE product: per function × hour requirement for a date range ────────── */
  async hourlyRequirement(tenantId: string, from: string, to: string, opts?: {
    ordersScale?: number;        // scenario: orders +20% → 1.2 (CPO% held constant)
    functionKeys?: string[];
  }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    }
    const days = Math.round((+new Date(to) - +new Date(from)) / 86400000) + 1;
    if (days < 1 || days > 35) throw new BadRequestException('range must be 1..35 days');
    const ordersScale = Math.min(3, Math.max(0.3, opts?.ordersScale ?? 1));

    const [params, facts] = await Promise.all([
      this.getParams(tenantId),
      this.channelFacts(tenantId, from),
    ]);
    const scoped = params.filter(p => p.isStaffed &&
      (!opts?.functionKeys?.length || opts.functionKeys.includes(p.functionKey)));
    if (!scoped.length) throw new BadRequestException('No staffed functions in scope (staffing_params)');

    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(+new Date(from) + i * 86400000).toISOString().slice(0, 10));
    }

    const result = dates.map(date => {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const functions = scoped.map(p => {
        const hours: HourRequirement[] = [];
        for (let h = 0; h < 24; h++) {
          // 1. volume: Σ over the channel mix — daily baseline × intraday share × orders scenario
          let volume = 0, ahtWeighted = 0;
          for (const [ch, share] of Object.entries(p.channelMix)) {
            const dailyVol = (facts.dailyBy[ch]?.[dow] ?? 0) * (share as number) * ordersScale;
            const intraday = (facts.profBy[ch]?.[h * 2] ?? 0) + (facts.profBy[ch]?.[h * 2 + 1] ?? 0);
            const v = dailyVol * intraday;
            volume += v;
            const talk = p.ahtSec ?? facts.ahtBy[ch] ?? 300;
            ahtWeighted += v * (talk + p.holdSec + p.acwSec);
          }
          const ahtEff = volume > 0 ? ahtWeighted / volume : 0;
          // 2-4. Erlang / concurrency / throughput → agents that must be AVAILABLE
          const erlangs = (volume * ahtEff) / 3600;
          let agents = 0, serverCapacity = 0;   // capacity = agents × effective servers/agent
          if (erlangs > 0) {
            if (p.model === 'throughput') {
              agents = Math.ceil(erlangs / p.occupancyCap);   // back-office: workload at capped utilization
              serverCapacity = agents;
            } else {
              const servers = findMinAgents(erlangs, p.targetSl, p.targetAnswerSec, ahtEff, p.occupancyCap);
              if (p.model === 'concurrency') {
                const eff = effectiveServersPerAgent(p.concurrency, p.marginalEff);
                agents = Math.ceil(servers / eff);
                serverCapacity = agents * eff;
              } else { agents = servers; serverCapacity = servers; }
            }
          }
          // 5-6. productivity then shrinkage → the SCHEDULED requirement
          const afterProd = agents > 0 ? agents / Math.max(p.productivity, 0.1) : 0;
          const scheduled = afterProd > 0 ? Math.ceil(afterProd / Math.max(1 - p.shrinkage, 0.1)) : 0;
          hours.push({
            hour: h,
            volume: +volume.toFixed(1),
            ahtEffSec: Math.round(ahtEff),
            erlangs: +erlangs.toFixed(2),
            agentsForSl: agents,
            occupancyAtN: serverCapacity > 0 ? +Math.min(erlangs / serverCapacity, 1).toFixed(3) : 0,
            afterProductivity: +afterProd.toFixed(1),
            requiredScheduledHc: scheduled,
          });
        }
        return {
          functionKey: p.functionKey,
          model: p.model,
          params: {
            channelMix: p.channelMix, cpoPct: p.cpoPct,
            ahtSec: p.ahtSec ?? 'measured', acwSec: p.acwSec, holdSec: p.holdSec,
            targetSl: p.targetSl, targetAnswerSec: p.targetAnswerSec,
            occupancyCap: p.occupancyCap, shrinkage: p.shrinkage,
            productivity: p.productivity, concurrency: p.concurrency,
          },
          hours,
          dayTotalRequired: Math.max(...hours.map(x => x.requiredScheduledHc), 0),
          dayContacts: +hours.reduce((s, x) => s + x.volume, 0).toFixed(0),
        };
      });
      // total curve (48 half-hour slots, for the generator's shift-mix engine)
      const totalCurve48 = new Array(48).fill(0);
      for (const f of functions) {
        for (const x of f.hours) { totalCurve48[x.hour * 2] += x.requiredScheduledHc; totalCurve48[x.hour * 2 + 1] += x.requiredScheduledHc; }
      }
      return { date, dow, functions, totalCurve48 };
    });

    return {
      from, to, ordersScale,
      basis: 'forecast: same-weekday 28d offered × intraday profile → effective AHT (talk[measured]+hold+ACW) → Erlang-C @ SL & occupancy cap → ÷productivity → ÷(1−shrinkage)',
      measuredAht: facts.ahtBy,
      ordersPeriod: facts.ordersPeriod,
      days: result,
    };
  }
}
