import { Injectable, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { AgentRunner } from '@common/agent-runner';
// Pure shift-mix optimizer (no DI) — used by hiring-now to translate the hourly
// requirement into BODIES/day (9h shifts can't span a 12h window; peak alone hides that).
import { computeShiftMix } from '../schedule-generator/demand.engine';

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

// ── the same numerically-stable Erlang core as capacity.service — now shared
//    for real (R2.2): capacity.service's copy was lifted VERBATIM into
//    @common/erlang; this file's former private re-derivation was mathematically
//    identical (same recursion, same guards), so results are bit-identical.
import { serviceLevel, findMinAgents, effectiveServersPerAgent } from '@common/erlang';

/**
 * Defensive ceiling on the LEARNED floor (2026-07-12). Belt-and-suspenders atop the
 * real fix (floor = P90 of concurrent `erlangs` only, ≥5 samples): no single measured
 * cell may ever demand more concurrent servers than this — a hard stop against ANY future
 * data glitch (real center loads are ~1–50 Erlangs per function-hour). Env-overridable for
 * growth. Pure + unit-tested so the guard can't silently regress.
 */
export const LEARNED_ERL_CEIL = Math.max(50, +(process.env.STAFFING_LEARNED_ERL_CEIL ?? 1000));
export function cappedLearnedFloor(learnedErl: number, ordersScale: number, ceil = LEARNED_ERL_CEIL): number {
  const v = Math.max(0, Number.isFinite(learnedErl) ? learnedErl : 0) * Math.max(0, ordersScale);
  return Math.min(v, ceil);
}

/** Normalize raw intraday weights into shares that sum to exactly 1 (all-zero → zeros).
 *  Pure + unit-tested: the 48 half-hour shares the forecast spreads a day's volume over
 *  MUST sum to 1 or daily volume silently leaks/inflates. */
export function normalizeShares(raw: number[]): number[] {
  const tot = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(v => v / tot);
}

export type CellParams = Pick<StaffingParams,
  'model' | 'targetSl' | 'targetAnswerSec' | 'occupancyCap' | 'shrinkage' | 'productivity' | 'concurrency' | 'marginalEff'>;

/**
 * Steps 3–6 of the chain for ONE function×hour cell, as a pure function so the spec can
 * hand-verify a real cell end-to-end (volume×AHT → Erlang-C @ SL & occupancy cap →
 * ÷productivity → ÷(1−shrinkage)). Extracted VERBATIM from the hourlyRequirement loop —
 * same operations in the same order, so results are bit-identical.
 * `serverCapacity` = agents × effective servers/agent — occupancy MUST divide by this
 * (not raw agents) on concurrency channels.
 */
export function computeCellRequirement(volume: number, ahtEffSec: number, learnedFloor: number, p: CellParams) {
  const estimated = (volume * ahtEffSec) / 3600;
  const learnedApplied = learnedFloor > estimated + 0.05;
  const erlangs = Math.max(estimated, learnedFloor);
  let agents = 0, serverCapacity = 0;   // capacity = agents × effective servers/agent
  if (erlangs > 0) {
    if (p.model === 'throughput') {
      agents = Math.ceil(erlangs / p.occupancyCap);   // back-office: workload at capped utilization
      serverCapacity = agents;
    } else {
      const servers = findMinAgents(erlangs, p.targetSl, p.targetAnswerSec, ahtEffSec, p.occupancyCap);
      if (p.model === 'concurrency') {
        const eff = effectiveServersPerAgent(p.concurrency, p.marginalEff);
        agents = Math.ceil(servers / eff);
        serverCapacity = agents * eff;
      } else { agents = servers; serverCapacity = servers; }
    }
  }
  const afterProductivity = agents > 0 ? agents / Math.max(p.productivity, 0.1) : 0;
  const requiredScheduledHc = afterProductivity > 0 ? Math.ceil(afterProductivity / Math.max(1 - p.shrinkage, 0.1)) : 0;
  return { estimated, erlangs, agentsForSl: agents, serverCapacity, afterProductivity, requiredScheduledHc, learnedApplied };
}

/* ── forecast-accuracy backtest math (pure, unit-tested) ─────────────────────
 *  WAPE = Σ|F−A| ÷ ΣA  (volume-weighted absolute error — the buyer's headline)
 *  bias = Σ(F−A) ÷ ΣA  (signed; positive = we over-forecast / over-staff)     */
export interface BacktestRow { actual: number; forecast: number }
export function backtestStats(rows: BacktestRow[]): { n: number; wapePct: number | null; biasPct: number | null } {
  let sumA = 0, sumAbs = 0, sumSigned = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.actual) || !Number.isFinite(r.forecast)) continue;
    sumA += r.actual; sumAbs += Math.abs(r.forecast - r.actual); sumSigned += r.forecast - r.actual;
  }
  if (!rows.length || sumA <= 0) return { n: rows.length, wapePct: null, biasPct: null };
  return { n: rows.length, wapePct: +((100 * sumAbs) / sumA).toFixed(1), biasPct: +((100 * sumSigned) / sumA).toFixed(1) };
}

/* ── insight derivation (pure, unit-tested) — verified numbers only, no LLM ── */
export type InsightSeverity = 'info' | 'warn' | 'critical';
export interface Insight { id: string; severity: InsightSeverity; metric: Record<string, any>; text: string }
export interface InsightInput {
  from: string;
  dataAnchor: string | null;      // latest measured vol_date (offered > 0)
  days: any[];                    // hourlyRequirement().days
  hiringPerFunction: any[];       // hiringNow().perFunction
  wow: { channel: string; last7: number; prev7: number }[];
  /** forecastAccuracy().perChannel — when supplied, forecast quality becomes a bullet. */
  backtest?: { channel: string; wapePct: number | null; biasPct: number | null }[];
}
export function deriveInsights(inp: InsightInput): Insight[] {
  const out: Insight[] = [];
  // 1 ── data freshness: every downstream number rides on this
  if (inp.dataAnchor) {
    const staleDays = Math.round((+new Date(inp.from) - +new Date(inp.dataAnchor)) / 86400000);
    out.push({
      id: 'data-freshness',
      severity: staleDays > 28 ? 'critical' : staleDays > 7 ? 'warn' : 'info',
      metric: { latestMeasuredDate: inp.dataAnchor, staleDays },
      text: staleDays > 0
        ? `Measured volume history ends ${inp.dataAnchor} (${staleDays}d before the plan start) — baseline and AHT ride on the last available 28 days.`
        : `Measured volume history is current through ${inp.dataAnchor}.`,
    });
  } else {
    out.push({ id: 'data-freshness', severity: 'critical', metric: { latestMeasuredDate: null },
      text: 'No measured volume history — the requirement is running on defaults.' });
  }
  // 2 ── peak day/hour per function + learned cells + hours no current team size can staff
  const peaks = new Map<string, { date: string; hour: number; required: number }>();
  const learnedBy = new Map<string, number>(); let learnedTotal = 0;
  const impossible = new Map<string, number>();
  const teamOf = new Map(inp.hiringPerFunction.map((f: any) => [f.functionKey, f.currentTeam]));
  for (const d of inp.days) for (const f of d.functions) for (const h of f.hours) {
    const cur = peaks.get(f.functionKey);
    if (!cur || h.requiredScheduledHc > cur.required) peaks.set(f.functionKey, { date: d.date, hour: h.hour, required: h.requiredScheduledHc });
    if (h.learned) { learnedTotal++; learnedBy.set(f.functionKey, (learnedBy.get(f.functionKey) ?? 0) + 1); }
    const team = teamOf.get(f.functionKey);
    if (team != null && h.requiredScheduledHc > team) impossible.set(f.functionKey, (impossible.get(f.functionKey) ?? 0) + 1);
  }
  for (const [fn, p] of peaks) {
    if (p.required <= 0) continue;
    out.push({ id: `peak:${fn}`, severity: 'info', metric: { functionKey: fn, ...p },
      text: `${fn}: peak requirement ${p.required} scheduled HC at ${String(p.hour).padStart(2, '0')}:00 on ${p.date}.` });
  }
  // 3 ── tightest function: smallest schedulable margin (fieldable bodies/day − bodies needed)
  let tight: any = null;
  for (const f of inp.hiringPerFunction) {
    const margin = +(f.fieldablePerDay - f.scheduleBodiesWorstDay).toFixed(1);
    if (!tight || margin < tight.margin) {
      tight = { functionKey: f.functionKey, margin, fieldablePerDay: f.fieldablePerDay,
                bodiesNeeded: f.scheduleBodiesWorstDay, worstDay: f.coverageWorstDay };
    }
  }
  if (tight) {
    out.push({ id: 'tightest-function',
      severity: tight.margin < 0 ? 'critical' : tight.margin < 2 ? 'warn' : 'info',
      metric: tight,
      text: tight.margin < 0
        ? `${tight.functionKey} is the binding team: needs ${tight.bodiesNeeded} bodies/day but can field only ${tight.fieldablePerDay} — short ${Math.abs(tight.margin)}.`
        : `${tight.functionKey} is the tightest team: ${tight.fieldablePerDay} fieldable bodies/day vs ${tight.bodiesNeeded} needed (margin ${tight.margin}).` });
  }
  // 4 ── function-hours the CURRENT team cannot staff even at 100% attendance
  const impTotal = [...impossible.values()].reduce((a, b) => a + b, 0);
  if (impTotal > 0) {
    out.push({ id: 'impossible-hours', severity: 'critical',
      metric: { hours: impTotal, perFunction: Object.fromEntries(impossible) },
      text: `${impTotal} function-hour(s) in the range require more scheduled HC than the whole current team — unstaffable without hiring or OT.` });
  }
  // 5 ── learned-floor coverage (measurement beating estimation)
  out.push({ id: 'learned-floor', severity: 'info',
    metric: { cellsApplied: learnedTotal, perFunction: Object.fromEntries(learnedBy) },
    text: learnedTotal > 0
      ? `Measured-load floor (Sprinklr P90) raised ${learnedTotal} cell(s) above the volume×AHT estimate.`
      : 'No learned-floor cells active — the requirement is purely forecast-driven (a cell needs ≥5 same-weekday measured samples).' });
  // 6 ── biggest week-over-week move in measured volume
  let mover: any = null;
  for (const w of inp.wow) {
    if (w.prev7 > 0) {
      const pct = +((100 * (w.last7 - w.prev7)) / w.prev7).toFixed(1);
      if (!mover || Math.abs(pct) > Math.abs(mover.pct)) mover = { channel: w.channel, pct, last7: w.last7, prev7: w.prev7 };
    }
  }
  if (mover) {
    out.push({ id: 'wow-volume', severity: Math.abs(mover.pct) >= 20 ? 'warn' : 'info', metric: mover,
      text: `${mover.channel}: measured volume ${mover.pct >= 0 ? 'up' : 'down'} ${Math.abs(mover.pct)}% week-over-week (${Math.round(mover.prev7)} → ${Math.round(mover.last7)}).` });
  }
  // 7 ── forecast quality: how right the SAME baseline has been on the last measured days.
  //      Bias positive = the baseline over-forecasts (over-hire risk); WAPE ≥50% = the
  //      baseline is unreliable (regime change, e.g. a channel migration) — the hiring
  //      verdict must be read with that on the table.
  if (inp.backtest?.length) {
    let worstBt: any = null;
    for (const b of inp.backtest) {
      if (b.wapePct == null) continue;
      if (!worstBt || b.wapePct > worstBt.wapePct) worstBt = b;
    }
    if (worstBt) {
      out.push({ id: 'forecast-quality',
        severity: worstBt.wapePct >= 50 ? 'critical' : worstBt.wapePct >= 25 ? 'warn' : 'info',
        metric: { worstChannel: worstBt.channel, wapePct: worstBt.wapePct, biasPct: worstBt.biasPct, perChannel: inp.backtest },
        text: worstBt.wapePct >= 50
          ? `Baseline forecast is UNRELIABLE right now: ${worstBt.channel} backtests at ${worstBt.wapePct}% WAPE (bias ${worstBt.biasPct! > 0 ? '+' : ''}${worstBt.biasPct}%) — volumes are shifting faster than the 4-week baseline; treat the hiring verdict as an upper bound and re-run after fresh ingest.`
          : `Forecast backtest: worst channel ${worstBt.channel} at ${worstBt.wapePct}% WAPE (bias ${worstBt.biasPct! > 0 ? '+' : ''}${worstBt.biasPct}%).` });
    }
  }
  // 8 ── overstaffed functions: surplus bodies/day beyond the schedulable need
  const over = inp.hiringPerFunction.filter((f: any) => f.surplusBodies > 0);
  if (over.length) {
    out.push({ id: 'overstaffed', severity: 'info',
      metric: { perFunction: Object.fromEntries(over.map((f: any) => [f.functionKey, f.surplusBodies])) },
      text: `Surplus beyond the schedulable need: ${over.map((f: any) => `${f.functionKey} +${f.surplusBodies} bodies/day`).join(', ')} — cross-skill donor candidates.` });
  }
  return out;
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
  openHour: number;    // operating window start (0..24)
  closeHour: number;   // operating window end — volume outside rolls INTO the window (deferred work)
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
  learned?: boolean;           // the LEARNED floor (measured P90) exceeded the estimate here
}

@Injectable()
export class StaffingService implements OnModuleInit {
  private readonly logger = new Logger(StaffingService.name);
  constructor(private readonly ds: DataSource) {}

  /** AI-workforce W1 "Staffing Observer": rolls Sprinklr snapshots into the learning
   *  store every hour — advisory-lock exclusive, so multi-instance deploys stay safe.
   *  Disable with STAFFING_OBSERVER=0. */
  onModuleInit() {
    if (process.env.STAFFING_OBSERVER === '0') return;
    const runner = new AgentRunner(this.ds, 'staffing-observer');
    const tick = async () => {
      try {
        await runner.runExclusive(async () => {
          const tenants = await this.ds.query(`SELECT DISTINCT tenant_id FROM staffing_params`);
          for (const t of tenants) {
            const r = await this.rollupObservations(t.tenant_id, 26);
            if (r.hourChannelCells > 0) {
              await runner.publishEvent(t.tenant_id, 'learning',
                { what: 'staffing.observations.rollup', cells: r.hourChannelCells, snapshots: r.snapshotRows },
                { severity: 'info' }).catch(() => {});
            }
          }
        });
      } catch (e: any) { this.logger.warn(`staffing-observer tick skipped: ${e.message}`); }
    };
    setTimeout(tick, 30_000);                 // first pass shortly after boot
    setInterval(tick, 60 * 60 * 1000);        // then hourly
  }

  /* ── params ──────────────────────────────────────────────────────────────── */
  async getParams(tenantId: string): Promise<StaffingParams[]> {
    const rows = await this.ds.query(
      `SELECT function_key, channel_mix, model, cpo_pct, aht_sec, acw_sec, hold_sec,
              target_sl, target_answer_sec, occupancy_cap, shrinkage, productivity,
              concurrency, marginal_eff, is_staffed, open_hour, close_hour
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
      openHour: +(r.open_hour ?? 0), closeHour: +(r.close_hour ?? 24),
    }));
  }

  async updateParams(tenantId: string, functionKey: string, patch: Record<string, any>, userId?: string) {
    const map: Record<string, string> = {
      channelMix: 'channel_mix', model: 'model', cpoPct: 'cpo_pct', ahtSec: 'aht_sec',
      acwSec: 'acw_sec', holdSec: 'hold_sec', targetSl: 'target_sl',
      targetAnswerSec: 'target_answer_sec', occupancyCap: 'occupancy_cap',
      shrinkage: 'shrinkage', productivity: 'productivity', concurrency: 'concurrency',
      marginalEff: 'marginal_eff', isStaffed: 'is_staffed',
      openHour: 'open_hour', closeHour: 'close_hour',
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
    // 28-day measured AHT per channel (talk seconds / handled) — anchored to each
    // channel's LAST 28 days of AVAILABLE data at/before asOf, NOT a fixed calendar
    // window. Accuracy-audit fix (2026-07-20): when ingest lags (volume history ended
    // 2026-06-21 while planning 2026-07-21), the old BETWEEN(asOf−28, asOf) window went
    // EMPTY and every channel silently fell back to the 300s default AHT — overstating
    // voice ~2× (real 157s) and understating chat/WA ~3× (real 862/1086s), which skewed
    // the hiring verdict. The same-weekday volume baseline below already degrades
    // gracefully (no lower bound); AHT now does too.
    const aht = await this.ds.query(
      `SELECT channel,
              (SUM(talk_seconds)::numeric / NULLIF(SUM(handled),0))::numeric(10,1) AS aht,
              MIN(vol_date)::text AS win_from, MAX(vol_date)::text AS win_to
       FROM (
         SELECT channel, vol_date, talk_seconds, handled,
                MAX(vol_date) OVER (PARTITION BY channel) AS last_day
         FROM contact_volume_daily
         WHERE tenant_id = $1 AND vol_date <= $2::date
           AND handled > 0 AND talk_seconds > 0
       ) t
       WHERE vol_date >= last_day - 28
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
    const ahtWindow: Record<string, { from: string; to: string }> = {};
    for (const r of aht) {
      ahtBy[r.channel] = +r.aht;
      ahtWindow[r.channel] = { from: r.win_from, to: r.win_to };
    }
    const dailyBy: Record<string, Record<number, number>> = {};
    for (const r of daily) (dailyBy[r.channel] = dailyBy[r.channel] || {})[+r.dow] = +r.offered;
    const profBy: Record<string, number[]> = {};
    for (const r of prof) {
      (profBy[r.channel] = profBy[r.channel] || new Array(48).fill(0))[+r.interval_idx] = +r.offered;
    }
    for (const ch of Object.keys(profBy)) {
      profBy[ch] = normalizeShares(profBy[ch]);   // 48 shares summing to exactly 1 (unit-tested)
    }
    return { ahtBy, ahtWindow, dailyBy, profBy, ordersPeriod: orders ?? null };
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

    const [params, facts, learned] = await Promise.all([
      this.getParams(tenantId),
      this.channelFacts(tenantId, from),
      this.learnedCurves(tenantId).catch(() => ({} as Record<string, Record<number, Record<number, number>>>)),
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
        // OPERATING WINDOW (deferred-work model): volume arriving OUTSIDE the window
        // rolls INTO it — an email at 02:00 is handled next morning, not staffed at night.
        // Immediate channels keep 0..24 windows and staff to arrival.
        const inWindow = (h: number) => h >= p.openHour && h < p.closeHour;
        const windowed = p.openHour > 0 || p.closeHour < 24;
        let outOfWindowVol = 0, inWindowShare = 0;
        if (windowed) {
          for (let h = 0; h < 24; h++) {
            for (const [ch, share] of Object.entries(p.channelMix)) {
              const dailyVol = (facts.dailyBy[ch]?.[dow] ?? 0) * (share as number) * ordersScale;
              const v = dailyVol * ((facts.profBy[ch]?.[h * 2] ?? 0) + (facts.profBy[ch]?.[h * 2 + 1] ?? 0));
              if (inWindow(h)) inWindowShare += v; else outOfWindowVol += v;
            }
          }
        }
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
          if (windowed) {
            if (!inWindow(h)) { volume = 0; ahtWeighted = 0; }
            else if (inWindowShare > 0 && outOfWindowVol > 0) {
              // redistribute the overnight arrivals proportionally across the window
              const boost = 1 + outOfWindowVol / inWindowShare;
              ahtWeighted *= boost; volume *= boost;
            }
          }
          // share-weighted AHT fallback: when the learned floor supplies workload on an
          // hour with zero forecast volume, Erlang still needs a real AHT (0 would spin
          // findMinAgents to its iteration cap).
          let shareAht = 0, shareSum = 0;
          for (const [ch, share] of Object.entries(p.channelMix)) {
            const talk = p.ahtSec ?? facts.ahtBy[ch] ?? 300;
            shareAht += (share as number) * (talk + p.holdSec + p.acwSec);
            shareSum += (share as number);
          }
          const ahtEff = volume > 0 ? ahtWeighted / volume : (shareSum > 0 ? shareAht / shareSum : 300);
          // 2-4. Erlang / concurrency / throughput → agents that must be AVAILABLE.
          // LEARNED floor: where the Sprinklr learning store has measured P90 concurrent
          // load (Erlangs = inProgress ONLY — waiting is queue BACKLOG, an outcome of
          // understaffing, not concurrent demand; Erlang already models the wait, so adding
          // queue depth to the required-server floor double-counts and runs away on a spike)
          // for this weekday×hour, never staff below it — measurement beats estimation
          // (volume×AHT) when they disagree upward.
          let learnedErl = 0;
          if (!windowed || inWindow(h)) {   // deferred functions never staff outside their window
            for (const [ch, share] of Object.entries(p.channelMix)) {
              const v = learned[ch]?.[dow]?.[h];
              if (v != null) learnedErl += v * (share as number);
            }
          }
          // Steps 3–6 live in computeCellRequirement (pure, hand-verified in the spec):
          // Erlang/concurrency/throughput → ÷productivity → ÷(1−shrinkage).
          const cell = computeCellRequirement(volume, ahtEff, cappedLearnedFloor(learnedErl, ordersScale), p);
          hours.push({
            hour: h,
            volume: +volume.toFixed(1),
            ahtEffSec: Math.round(ahtEff),
            erlangs: +cell.erlangs.toFixed(2),
            agentsForSl: cell.agentsForSl,
            occupancyAtN: cell.serverCapacity > 0 ? +Math.min(cell.erlangs / cell.serverCapacity, 1).toFixed(3) : 0,
            afterProductivity: +cell.afterProductivity.toFixed(1),
            requiredScheduledHc: cell.requiredScheduledHc,
            ...(cell.learnedApplied ? { learned: true } : {}),
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

    // How far behind the forecast's own inputs are. The window was already
    // reported, but a date range is not a warning: nobody reads "measured
    // 2026-05-23 → 2026-06-20" on an August schedule and computes seven weeks in
    // their head. So the gap is measured here and named, and a schedule staffed to
    // volume this old says so rather than presenting itself as current.
    const newestInput = Object.values(facts.ahtWindow ?? {})
      .map((w: any) => w?.to).filter(Boolean).sort().pop() as string | undefined;
    const daysBehind = newestInput
      ? Math.round((Date.parse(from) - Date.parse(newestInput)) / 86400000) : null;
    const freshness = {
      newestVolumeDay: newestInput ?? null,
      daysBehind,
      // A contact centre's mix moves week to week; a fortnight is a soft edge and
      // a month means the curve is describing a different business.
      level: daysBehind == null ? 'unknown' : daysBehind > 30 ? 'stale' : daysBehind > 14 ? 'ageing' : 'current',
      note: daysBehind == null ? null
        : daysBehind > 14
          ? `Demand is built on volume last measured ${newestInput} — ${daysBehind} days before this schedule. ` +
            `Required HC reflects that period, not today. · الطلب مبني على فوليوم آخر قياس له ${newestInput} — ` +
            `أي ${daysBehind} يوم قبل هذا الجدول؛ الأرقام تصف تلك الفترة لا اليوم.`
          : null,
    };

    return {
      from, to, ordersScale,
      basisKind: 'engine-forecast' as const,
      basis: 'forecast: same-weekday 28d offered × intraday profile → effective AHT (talk[measured]+hold+ACW) → Erlang-C @ SL & occupancy cap → ÷productivity → ÷(1−shrinkage)',
      measuredAht: facts.ahtBy,
      measuredAhtWindow: facts.ahtWindow,   // the exact dates each channel's AHT was measured over (staleness is visible, never silent)
      freshness,
      ordersPeriod: facts.ordersPeriod,
      days: result,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  EVENT / PERIOD FORECAST (Director 2026-07-07): fill an Excel with the
   *  expected demand for a date range + the agents you actually have per
   *  function → the engine answers, per function: required peak, gap, HOW MANY
   *  INTERNS TO HIRE (gap ÷ intern productivity, ceil) and the SL you'd run at
   *  with current staff vs after hiring (reverse Erlang at the worst hour).
   * ═══════════════════════════════════════════════════════════════════════════ */

  /** The sample template the Director downloads, fills and uploads back. */
  async eventTemplate(tenantId: string): Promise<Buffer> {
    const params = (await this.getParams(tenantId)).filter(p => p.isStaffed);
    const fnCols = params.map(p => p.functionKey);
    const today = new Date();
    const d0 = new Date(today.getTime() + 7 * 86400000);
    const wb = XLSX.utils.book_new();

    const instructions = [
      ['WFM — Event / Period Forecast Template  (v2)'],
      [''],
      ['1. Daily_Forecast (REQUIRED): one row per DAY. Orders (expected orders) + expected CONTACTS'],
      ['   per function that day. Add/remove date rows freely — the range = the rows you fill.'],
      ['2. Available_Agents (REQUIRED): agents you actually HAVE per function + intern productivity'],
      ['   (0.70 = an intern delivers 70% of an agent).'],
      ['3. Function_Overrides (OPTIONAL): your OWN expected AHT / ACW / Hold / SL target / shrinkage /'],
      ['   productivity per function for THIS event. Leave a cell BLANK to keep the system value'],
      ['   (AHT blank = measured 28-day actuals). Percent columns are entered as % (80 = 80%).'],
      ['4. Hourly_Profile (OPTIONAL): how the day\'s volume spreads over the 24 hours per function'],
      ['   (relative weights — they are normalized; blank row = the system\'s measured profile).'],
      ['5. Save and upload in Capacity → Staffing Engine → Event Forecast.'],
      [''],
      ['كيفية الاستخدام: Daily_Forecast يوم بيوم (طلبات + كونتاكتس كل فنكشن) و Available_Agents (المتاحين'],
      ['+ إنتاجية الإنترن) إلزاميان. Function_Overrides اختياري — AHT/ACW/Hold/SL/شرينكج/إنتاجية متوقعة'],
      ['لهالإيفنت (الفاضي = قيمة النظام). Hourly_Profile اختياري — توزيع حجم اليوم على الساعات لكل فنكشن'],
      ['(أوزان نسبية تتطبّع تلقائيًا؛ الصف الفاضي = بروفايل النظام المقاس). احفظ وارفع.'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), 'Instructions');

    const fcHeader = ['Date', 'Orders', ...fnCols];
    const fcRows = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(d0.getTime() + i * 86400000).toISOString().slice(0, 10);
      return [d, 5000, ...fnCols.map(() => 100)];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([fcHeader, ...fcRows]), 'Daily_Forecast');

    const avHeader = ['Function', 'AvailableAgents', 'InternProductivity'];
    const avRows = params.map(p => [p.functionKey, 10, 0.7]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([avHeader, ...avRows]), 'Available_Agents');

    // OPTIONAL: orders-only forecast (the Director's SS'26 method) — fill Orders per day
    // and CPO_pct per function; contacts are DERIVED (orders × CPO%). If Daily_Forecast
    // has explicit contacts for a function, those win.
    const eoRows = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(d0.getTime() + i * 86400000).toISOString().slice(0, 10);
      return [d, 20000];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Orders'], ...eoRows]), 'Event_Orders');

    // OPTIONAL overrides — blank cell = keep the system value for that function
    const ovHeader = ['Function', 'CPO_pct', 'AHT_sec', 'ACW_sec', 'Hold_sec', 'TargetSL_pct', 'AnswerSec', 'Shrinkage_pct', 'Productivity_pct', 'OT_pct'];
    const ovRows = params.map(p => [p.functionKey, p.cpoPct, null, null, null, null, null, null, null, null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ovHeader, ...ovRows]), 'Function_Overrides');

    // OPTIONAL intraday profile — relative weights per hour (normalized on upload)
    const hpHeader = ['Function', ...Array.from({ length: 24 }, (_, h) => `H${String(h).padStart(2, '0')}`)];
    const hpRows = params.map(p => [p.functionKey, ...new Array(24).fill(null)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hpHeader, ...hpRows]), 'Hourly_Profile');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /** Parse the uploaded workbook, run the math, persist + return the verdict. */
  async uploadEventForecast(tenantId: string, userId: string | null, fileName: string, buf: Buffer, eventName?: string) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const fcWs = wb.Sheets['Daily_Forecast'];
    const avWs = wb.Sheets['Available_Agents'];
    const eoWs = wb.Sheets['Event_Orders'];
    if (!avWs || (!fcWs && !eoWs)) {
      throw new BadRequestException('Workbook must contain Available_Agents plus Daily_Forecast and/or Event_Orders (use the downloaded template)');
    }

    const avRows: any[][] = XLSX.utils.sheet_to_json(avWs, { header: 1, defval: null, blankrows: false });
    const toISO = (v: any): string | null => {
      if (typeof v === 'number') return new Date(Math.round((Math.floor(v) - 25569) * 86400000)).toISOString().slice(0, 10);
      const s = String(v ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
    };

    // Daily_Forecast (explicit contacts per function) — optional when Event_Orders is used
    let fnCols: string[] = [];
    let daily: { date: string; orders: number; contacts: Record<string, number> }[] = [];
    if (fcWs) {
      const fcRows: any[][] = XLSX.utils.sheet_to_json(fcWs, { header: 1, defval: null, blankrows: false });
      const header = (fcRows[0] ?? []).map((h: any) => String(h ?? '').trim());
      fnCols = header.slice(2).filter(Boolean);
      if (header[0] !== 'Date') throw new BadRequestException('Daily_Forecast header must be: Date | Orders | <function columns>');
      daily = fcRows.slice(1)
        .map(r => ({ date: toISO(r[0]), orders: +(r[1] ?? 0) || 0, contacts: Object.fromEntries(fnCols.map((f, i) => [f, +(r[2 + i] ?? 0) || 0])) }))
        .filter(r => !!r.date) as typeof daily;
    }

    // Event_Orders (the Director's SS'26 method): Date | Orders — contacts DERIVED per
    // function as orders × CPO% (Function_Overrides CPO_pct, else staffing_params.cpo_pct).
    // Merges with Daily_Forecast by date; explicit contacts (>0) always win over derived.
    const ordersByDate = new Map<string, number>();
    if (eoWs) {
      const eoRows: any[][] = XLSX.utils.sheet_to_json(eoWs, { header: 1, defval: null, blankrows: false });
      for (const r of eoRows.slice(1)) {
        const d = toISO(r[0]); const o = +(r[1] ?? 0) || 0;
        if (d && o > 0) ordersByDate.set(d, o);
      }
      for (const [d, o] of ordersByDate) {
        const row = daily.find(x => x.date === d);
        if (row) row.orders = row.orders || o;
        else daily.push({ date: d, orders: o, contacts: {} });
      }
    }
    if (!daily.length) throw new BadRequestException('No dated rows found (Daily_Forecast/Event_Orders)');
    daily.sort((a, b) => a.date.localeCompare(b.date));

    const available: Record<string, { agents: number; internProductivity: number }> = {};
    for (const r of avRows.slice(1)) {
      const fn = String(r[0] ?? '').trim(); if (!fn) continue;
      available[fn] = { agents: +(r[1] ?? 0) || 0, internProductivity: Math.min(Math.max(+(r[2] ?? 0.7) || 0.7, 0.2), 1) };
    }

    // OPTIONAL sheets: per-function overrides (the Director's OWN expected AHT/ACW/Hold/SL/
    // shrinkage/productivity for THIS event) + a manual hourly profile. Blank = system value.
    // v3 columns: Function | CPO_pct | AHT_sec | ACW_sec | Hold_sec | TargetSL_pct | AnswerSec | Shrinkage_pct | Productivity_pct | OT_pct
    const overrides: Record<string, Partial<{ cpoPct: number; ahtSec: number; acwSec: number; holdSec: number; targetSl: number; targetAnswerSec: number; shrinkage: number; productivity: number; otPct: number }>> = {};
    if (wb.Sheets['Function_Overrides']) {
      const ov: any[][] = XLSX.utils.sheet_to_json(wb.Sheets['Function_Overrides'], { header: 1, defval: null, blankrows: false });
      const hdr = (ov[0] ?? []).map((h: any) => String(h ?? '').trim().toLowerCase());
      const col = (name: string) => hdr.indexOf(name.toLowerCase());
      const num = (v: any) => (v == null || v === '' ? null : (isNaN(+v) ? null : +v));
      const pick = (r: any[], name: string) => { const i = col(name); return i >= 0 ? num(r[i]) : null; };
      for (const r of ov.slice(1)) {
        const fn = String(r[0] ?? '').trim(); if (!fn) continue;
        const o: any = {};
        const cpo = pick(r, 'CPO_pct'); if (cpo != null) o.cpoPct = cpo > 1 ? cpo : cpo * 100;   // stored as %
        const aht = pick(r, 'AHT_sec'); if (aht != null) o.ahtSec = aht;
        const acw = pick(r, 'ACW_sec'); if (acw != null) o.acwSec = acw;
        const hold = pick(r, 'Hold_sec'); if (hold != null) o.holdSec = hold;
        const sl = pick(r, 'TargetSL_pct'); if (sl != null) o.targetSl = sl > 1 ? sl / 100 : sl;
        const ans = pick(r, 'AnswerSec'); if (ans != null) o.targetAnswerSec = ans;
        const shr = pick(r, 'Shrinkage_pct'); if (shr != null) o.shrinkage = shr > 1 ? shr / 100 : shr;
        const prod = pick(r, 'Productivity_pct'); if (prod != null) o.productivity = prod > 1 ? prod / 100 : prod;
        const ot = pick(r, 'OT_pct'); if (ot != null) o.otPct = ot > 1 ? ot / 100 : ot;
        if (Object.keys(o).length) overrides[fn] = o;
      }
    }
    const manualProfile: Record<string, number[]> = {}; // fn → 24 normalized weights
    if (wb.Sheets['Hourly_Profile']) {
      const hp: any[][] = XLSX.utils.sheet_to_json(wb.Sheets['Hourly_Profile'], { header: 1, defval: null, blankrows: false });
      for (const r of hp.slice(1)) {
        const fn = String(r[0] ?? '').trim(); if (!fn) continue;
        const weights = Array.from({ length: 24 }, (_, h) => Math.max(0, +(r[1 + h] ?? 0) || 0));
        const sum = weights.reduce((a, b) => a + b, 0);
        if (sum > 0) manualProfile[fn] = weights.map(w => w / sum);
      }
    }

    const [paramsRaw, facts] = await Promise.all([this.getParams(tenantId), this.channelFacts(tenantId, daily[0].date)]);
    const byKey = new Map(paramsRaw.map(p => [p.functionKey, p]));

    // Effective function list: explicit contact columns ∪ (orders present → every
    // function with a CPO% — the Director's orders-driven method).
    const fnSet = new Set(fnCols);
    if (ordersByDate.size > 0) {
      for (const p of paramsRaw) {
        const cpo = overrides[p.functionKey]?.cpoPct ?? p.cpoPct;
        if (p.isStaffed && cpo != null && cpo > 0) fnSet.add(p.functionKey);
      }
    }

    const perFunction: any[] = [];
    for (const fn of fnSet) {
      const base = byKey.get(fn);
      if (!base) { perFunction.push({ functionKey: fn, error: 'unknown function (not in staffing_params)' }); continue; }
      const p = { ...base, ...(overrides[fn] ?? {}) };
      const cpoFrac = ((overrides[fn]?.cpoPct ?? base.cpoPct) ?? 0) / 100;
      // per-day contacts: explicit wins; else DERIVED = orders × CPO%
      const contactsOf = (d: { orders: number; contacts: Record<string, number> }) =>
        (d.contacts[fn] ?? 0) > 0 ? d.contacts[fn] : +(d.orders * cpoFrac).toFixed(1);
      // intraday profile: the manual sheet wins; else blend the measured channel profiles
      const mixEntries = Object.entries(p.channelMix);
      const mixTotal = mixEntries.reduce((s, [, v]) => s + (v as number), 0) || 1;
      let prof: number[]; let profSum: number;
      if (manualProfile[fn]) {
        prof = manualProfile[fn].flatMap(w => [w / 2, w / 2]);   // 24 → 48 half-hours
        profSum = 1;
      } else {
        prof = new Array(48).fill(0);
        for (const [ch, share] of mixEntries) {
          const w = (share as number) / mixTotal;
          (facts.profBy[ch] ?? new Array(48).fill(1 / 48)).forEach((v, i) => { prof[i] += v * w; });
        }
        profSum = prof.reduce((a, b) => a + b, 0) || 1;
      }
      let talk = 0;
      for (const [ch, share] of mixEntries) {
        talk += ((p.ahtSec ?? facts.ahtBy[ch] ?? 300) as number) * ((share as number) / mixTotal);
      }
      const ahtEff = talk + p.holdSec + p.acwSec;
      const eff = p.model === 'concurrency' ? effectiveServersPerAgent(p.concurrency, p.marginalEff) : 1;

      // worst (peak-demand) day drives the hire decision; every day reported
      let periodPeakRequired = 0, worst: any = null;
      const days = daily.map(d => {
        const dayContacts = contactsOf(d);
        const hours = Array.from({ length: 24 }, (_, h) => {
          const vol = dayContacts * ((prof[h * 2] + prof[h * 2 + 1]) / profSum);
          const erl = (vol * ahtEff) / 3600;
          let agents = 0;
          if (erl > 0) {
            if (p.model === 'throughput') agents = Math.ceil(erl / p.occupancyCap);
            else agents = Math.ceil(findMinAgents(erl, p.targetSl, p.targetAnswerSec, ahtEff, p.occupancyCap) / eff);
          }
          const sched = agents > 0 ? Math.ceil(agents / Math.max(p.productivity, 0.1) / Math.max(1 - p.shrinkage, 0.1)) : 0;
          return { h, vol, erl, agentsAvail: agents, sched };
        });
        const peak = Math.max(...hours.map(x => x.sched), 0);
        if (peak > periodPeakRequired) { periodPeakRequired = peak; worst = { date: d.date, hours }; }
        return { date: d.date, contacts: dayContacts, requiredPeak: peak };
      });

      const av = available[fn] ?? { agents: 0, internProductivity: 0.7 };
      const gap = Math.max(0, periodPeakRequired - av.agents);
      const internsToHire = gap > 0 ? Math.ceil(gap / av.internProductivity) : 0;

      // Reverse Erlang — projected SL at the WORST hour of the worst day:
      // scheduled bodies → on-duty available = bodies × (1−shrinkage) × productivity,
      // apportioned to the hour by its share of the peak requirement.
      const slAt = (bodies: number) => {
        if (!worst) return 1;
        let minSL = 1;
        for (const x of worst.hours) {
          if (x.erl <= 0 || x.sched <= 0) continue;
          const bodiesAtHour = Math.min(x.sched, bodies * (x.sched / periodPeakRequired));
          const availAtHour = Math.floor(bodiesAtHour * (1 - p.shrinkage) * p.productivity * eff);
          const sl = p.model === 'throughput'
            ? (availAtHour >= Math.ceil(x.erl / p.occupancyCap) ? 1 : availAtHour / Math.max(Math.ceil(x.erl / p.occupancyCap), 1))
            : serviceLevel(availAtHour, x.erl, p.targetAnswerSec, ahtEff);
          if (sl < minSL) minSL = sl;
        }
        return minSL;
      };
      // ── The Director's flat method (SS'26 sheet) as a cross-check + his OT view:
      //    REQ = Σcontacts × AHT_eff ÷ (days × 8h productive × 3600 × occupancy) ÷ concurrency
      //    → with shrinkage ÷(1−s) → with OT ÷(1+ot). Variance = available − ceil(withOt).
      const eventOtPct = overrides[fn]?.otPct ?? 0;
      const totalContacts = days.reduce((s, d) => s + d.contacts, 0);
      const productiveSec = daily.length * 8 * 3600;
      const reqNoShrink = +((totalContacts * ahtEff) / (productiveSec * p.occupancyCap) / eff).toFixed(1);
      const reqWithShrink = +(reqNoShrink / Math.max(1 - p.shrinkage, 0.1)).toFixed(1);
      const reqWithOt = +(reqWithShrink / (1 + eventOtPct)).toFixed(1);
      const varianceVsTeam = +(av.agents - Math.ceil(eventOtPct > 0 ? reqWithOt : reqWithShrink)).toFixed(0);
      const otHoursWeekly = eventOtPct > 0 ? Math.round(Math.min(reqWithShrink - reqWithOt, av.agents * eventOtPct) * 8 * 7) : 0;

      perFunction.push({
        functionKey: fn, model: p.model, ahtEffSec: Math.round(ahtEff),
        targetSl: p.targetSl,
        cpoPct: cpoFrac > 0 ? +(cpoFrac * 100).toFixed(2) : null,
        contactsBasis: fnCols.includes(fn) && daily.some(d => (d.contacts[fn] ?? 0) > 0) ? 'explicit' : (cpoFrac > 0 ? 'orders × CPO%' : 'explicit'),
        totalContacts: Math.round(totalContacts),
        overridesApplied: overrides[fn] ?? null,
        manualHourlyProfile: !!manualProfile[fn],
        requiredPeak: periodPeakRequired,
        availableAgents: av.agents,
        gapAgents: gap,
        internProductivity: av.internProductivity,
        internsToHire,
        // the Director's flat-hours view (cross-check + OT lever)
        flatMethod: { reqNoShrink, reqWithShrink, reqWithOt, otPct: eventOtPct, varianceVsTeam, otHoursWeekly },
        projectedSlNow: +slAt(av.agents).toFixed(3),
        projectedSlAfterHire: +slAt(av.agents + internsToHire * av.internProductivity).toFixed(3),
        worstDay: worst?.date ?? null,
        days,
      });
    }

    const inputs = { daily, available, fnCols };
    const results = { perFunction, computedAt: new Date().toISOString() };
    const [row] = await this.ds.query(
      `INSERT INTO forecast_events (tenant_id, name, date_from, date_to, inputs, results, file_name, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING id`,
      [tenantId, eventName || fileName || 'Event forecast', daily[0].date, daily[daily.length - 1].date,
       JSON.stringify(inputs), JSON.stringify(results), fileName ?? null, userId],
    );
    return { id: row.id, name: eventName || fileName, from: daily[0].date, to: daily[daily.length - 1].date, perFunction };
  }

  /**
   * INSTANT hiring verdict — no Excel needed: the forecast requirement for the
   * period vs the CURRENT active team per function (live roster). Same math as
   * the event flow; the Excel flow is for events with YOUR OWN volumes/params.
   */
  async hiringNow(tenantId: string, from: string, to: string, internProductivity = 0.7, otPct = 0,
                  opts?: { ordersScale?: number }) {
    const [req, pools] = await Promise.all([
      this.hourlyRequirement(tenantId, from, to, opts?.ordersScale ? { ordersScale: opts.ordersScale } : undefined),
      this.ds.query(
        `SELECT canon_fn(f.name) AS fn, COUNT(*)::int AS agents
         FROM employees e JOIN functions f ON e.function_id = f.id
         WHERE e.tenant_id = $1 AND e.status = 'active'
         GROUP BY canon_fn(f.name)`, [tenantId]),
    ]);
    const poolBy: Record<string, number> = {};
    for (const r of pools) poolBy[r.fn] = +r.agents;

    const fns = new Map<string, { requiredPeak: number; worstDay: string | null; bodiesWorstDay: number; bodiesWorstDate: string | null }>();
    for (const d of req.days) {
      for (const f of d.functions) {
        const peak = Math.max(...f.hours.map((h: any) => h.requiredScheduledHc), 0);
        // Schedulable view: how many BODIES a day like this needs when covered with
        // real 9h shifts (uncapped shift-mix over the hourly curve). A 12h operating
        // window at requirement 2 needs 4 bodies (2×M + 2×C) even though the peak
        // says 2 — this is exactly why the generator shows edge gaps the peak hides.
        const curve = new Array(48).fill(0);
        for (const x of f.hours) { curve[x.hour * 2] = x.requiredScheduledHc; curve[x.hour * 2 + 1] = x.requiredScheduledHc; }
        const bodies = Object.values(computeShiftMix(d.date, curve, Number.MAX_SAFE_INTEGER).mix)
          .reduce((a, b) => a + b, 0);
        const cur = fns.get(f.functionKey) ?? { requiredPeak: 0, worstDay: null, bodiesWorstDay: 0, bodiesWorstDate: null };
        if (peak > cur.requiredPeak) { cur.requiredPeak = peak; cur.worstDay = d.date; }
        if (bodies > cur.bodiesWorstDay) { cur.bodiesWorstDay = bodies; cur.bodiesWorstDate = d.date; }
        fns.set(f.functionKey, cur);
      }
    }
    // Bodies/day a team of T can field at 2 OFF/week — the generator's own ceiling.
    // With an OT allowance, each agent works otPct more hours → the team fields
    // otPct more body-days (extra/extended shifts) before anyone new is hired.
    const NET_H = 8;   // net working hours per shift (9h gross − 1h break)
    const fieldable = (T: number, ot = 0) => Math.max(0, T - Math.ceil(T * 2 / 7)) * (1 + ot);
    let totalInterns = 0, totalInternsWithOt = 0, totalOtHoursWeekly = 0, totalSurplus = 0;
    const perFunction = [...fns.entries()].map(([fn, v]) => {
      const available = poolBy[fn] ?? 0;
      const gap = Math.max(0, v.requiredPeak - available);
      const fieldablePerDay = fieldable(available);
      const coverageGapBodies = Math.max(0, v.bodiesWorstDay - fieldablePerDay);
      // Coverage gap in TEAM terms: the smallest extra headcount whose fieldable
      // bodies/day close the schedulable shortfall (Director-approved 2026-07-08:
      // the hire answer is the BINDING constraint — a 9h shift cannot span a 12h
      // window, so requiredPeak alone under-hires small back-office teams).
      const teamGapFor = (ot: number) => {
        let t = 0;
        while (fieldable(available + t, ot) < v.bodiesWorstDay && t < 200) t++;
        return t;
      };
      const coverageTeamGap = coverageGapBodies > 0 ? teamGapFor(0) : 0;
      const teamGap = Math.max(gap, coverageTeamGap);
      const interns = teamGap > 0 ? Math.ceil(teamGap / internProductivity) : 0;
      totalInterns += interns;
      // ── OT scenario: same math with the team's capacity scaled by (1+otPct) ──
      const coverageTeamGapOt = otPct > 0 && Math.max(0, v.bodiesWorstDay - fieldable(available, otPct)) > 0 ? teamGapFor(otPct) : (otPct > 0 ? 0 : coverageTeamGap);
      const teamGapOt = Math.max(gap, otPct > 0 ? coverageTeamGapOt : coverageTeamGap);
      const internsWithOt = teamGapOt > 0 ? Math.ceil(teamGapOt / internProductivity) : 0;
      totalInternsWithOt += internsWithOt;
      // OT hours the scenario actually consumes: only the deficit OT covers, capped
      // by the team's OT budget at otPct — per week (×7 days, NET hours/body-day).
      const otBudgetBodies = fieldable(available) * otPct;                  // bodies/day OT can add
      const otUsedBodies = Math.min(coverageGapBodies, otBudgetBodies);     // deficit actually absorbed
      const otHoursWeekly = +(otUsedBodies * NET_H * 7).toFixed(0);
      const otBudgetHoursWeekly = +(otBudgetBodies * NET_H * 7).toFixed(0);
      totalOtHoursWeekly += otHoursWeekly;
      // ── OVERSTAFF: surplus bodies/day beyond the schedulable need ──
      const surplusBodies = coverageGapBodies > 0 ? 0 : Math.max(0, Math.floor(fieldable(available) - v.bodiesWorstDay));
      totalSurplus += surplusBodies;
      return {
        functionKey: fn, requiredPeak: v.requiredPeak, currentTeam: available, gap,
        coverageTeamGap,                               // extra HEADCOUNT to close the schedulable shortfall
        bindingConstraint: coverageTeamGap > gap ? 'coverage' : (gap > 0 ? 'peak' : 'none'),
        internsToHire: interns, worstDay: v.worstDay,
        scheduleBodiesWorstDay: v.bodiesWorstDay,      // bodies/day for FULL curve coverage
        fieldablePerDay: +fieldablePerDay.toFixed(1),  // bodies/day the team can schedule (2 OFF/wk)
        coverageGapBodies: +coverageGapBodies.toFixed(1),
        coverageWorstDay: v.bodiesWorstDate,
        // OT scenario + overstaff
        internsWithOt,                                 // hires still needed AFTER the OT allowance
        otHoursWeekly,                                 // OT hours/week the team would actually work
        otBudgetHoursWeekly,                           // ceiling at otPct (team × fieldable × NET_H × 7)
        surplusBodies,                                 // bodies/day OVER the need → overstaffed
      };
    }).sort((a, b) => b.internsToHire - a.internsToHire || b.gap - a.gap);
    return {
      from, to, internProductivity, otPct,
      ordersScale: req.ordersScale,
      basisKind: 'engine-forecast' as const,
      totalInternsToHire: totalInterns,
      totalInternsWithOt,
      totalOtHoursWeekly,
      totalSurplusBodies: totalSurplus,
      basis: 'interns = ceil(max(peak gap, coverage team-gap) / internProductivity) — the BINDING constraint: ' +
             'peak gap = requiredPeak (period max, incl. shrinkage/productivity/windows) vs current team; ' +
             'coverage team-gap = extra headcount whose fieldable bodies/day (team − 2-OFF/week) cover the full hourly curve with 9h shifts. ' +
             'OT scenario scales team capacity by (1+otPct); otHoursWeekly = deficit bodies OT absorbs × 8h net × 7d (capped by the otPct budget). ' +
             'surplusBodies = fieldable bodies/day beyond the schedulable need (overstaff).',
      perFunction,
    };
  }

  async listEventForecasts(tenantId: string) {
    return this.ds.query(
      `SELECT id, name, date_from::text AS "from", date_to::text AS "to", file_name, created_at, results
       FROM forecast_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId],
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  ANALYSIS LAYER (Stage 1A, 2026-07-20) — verified data only, never fabricated.
   *  1. forecastAccuracy: backtest the SAME same-weekday baseline the engine uses
   *     against measured actuals → per-channel WAPE/bias ("how right were we").
   *  2. scenarioCompare: base ×1.0 / surge ×1.2 / quiet ×0.85 / base+OT-10% in one call.
   *  3. staffingInsights: computed bullets derived from the real requirement/hiring
   *     numbers (deriveInsights is pure + unit-tested).
   * ═══════════════════════════════════════════════════════════════════════════ */

  /** The scenario grid scenarioCompare runs — fixed + unit-tested so the UI and the
   *  Director always see the same definitions. */
  static readonly SCENARIO_DEFS: ReadonlyArray<{ key: string; ordersScale: number; otPct: number }> = [
    { key: 'base', ordersScale: 1.0, otPct: 0 },
    { key: 'surge', ordersScale: 1.2, otPct: 0 },
    { key: 'quiet', ordersScale: 0.85, otPct: 0 },
    { key: 'base+ot10', ordersScale: 1.0, otPct: 0.10 },
  ];

  /**
   * Backtest: for each of the last N measured days, what the engine's own
   * same-weekday baseline (mean of the previous ≤4 same-weekday offered, blind to
   * the day itself) WOULD have forecast, vs the measured offered. Anchored at the
   * LAST day with actuals — an honest anchor: with stale ingest the backtest still
   * scores the freshest real data instead of returning an empty window.
   */
  async forecastAccuracy(tenantId: string, days = 28, asOf?: string) {
    const nDays = Math.min(Math.max(Math.round(days) || 28, 7), 120);
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BadRequestException('asOf must be YYYY-MM-DD');
    const [{ mx }] = await this.ds.query(
      `SELECT MAX(vol_date)::text AS mx FROM contact_volume_daily
       WHERE tenant_id = $1 AND offered > 0 ${asOf ? 'AND vol_date <= $2::date' : ''}`,
      asOf ? [tenantId, asOf] : [tenantId]);
    if (!mx) {
      return { asOf: null, days: nDays, note: 'no measured volume history to backtest', overall: backtestStats([]), perChannel: [], perDay: [] };
    }
    const rows = await this.ds.query(
      `WITH hist AS (
         SELECT channel, vol_date, offered,
                AVG(offered) OVER (PARTITION BY channel, EXTRACT(DOW FROM vol_date)
                                   ORDER BY vol_date ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS fc,
                COUNT(*)     OVER (PARTITION BY channel, EXTRACT(DOW FROM vol_date)
                                   ORDER BY vol_date ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS n_hist
         FROM contact_volume_daily
         WHERE tenant_id = $1 AND offered > 0 AND vol_date <= $2::date
       )
       SELECT channel, vol_date::text AS date, offered::float AS actual,
              ROUND(fc::numeric, 1)::float AS forecast, n_hist::int AS baseline_samples
       FROM hist
       WHERE vol_date > $2::date - $3::int AND fc IS NOT NULL
       ORDER BY channel, vol_date`,
      [tenantId, mx, nDays]);

    const byCh = new Map<string, any[]>();
    for (const r of rows) (byCh.get(r.channel) ?? byCh.set(r.channel, []).get(r.channel)!).push(r);
    const perChannel = [...byCh.entries()].map(([channel, rs]) => {
      const stats = backtestStats(rs);
      let worst: any = null;
      for (const r of rs) {
        const absErr = Math.abs(r.forecast - r.actual);
        if (!worst || absErr > worst.absErr) worst = { date: r.date, actual: r.actual, forecast: r.forecast, absErr };
      }
      // A trailing-mean forecast meeting a series that CHANGED LEVEL reports huge
      // error, and the error is real — but its cause is not the model. Voice fell
      // 8,271 → 287 offered/day over seven weeks while Ameyo was being switched off;
      // the 2026-05-27 forecast of 4,181 against 743 actual is arithmetically exactly
      // right for that history. Reading WAPE 156% as "the forecast is broken" would
      // send someone to fix a model that is working. So the level shift is measured
      // beside it and the reader is told which one they are looking at.
      const ordered = [...rs].sort((a, b) => (a.date < b.date ? -1 : 1));
      const half = Math.floor(ordered.length / 2);
      const mean = (xs: any[]) => xs.length ? xs.reduce((s, r) => s + r.actual, 0) / xs.length : 0;
      const firstHalf = mean(ordered.slice(0, half)), secondHalf = mean(ordered.slice(half));
      const shiftPct = firstHalf > 0 ? +((100 * (secondHalf - firstHalf)) / firstHalf).toFixed(1) : null;
      const structuralBreak = shiftPct != null && Math.abs(shiftPct) >= 40;
      return {
        channel, ...stats,
        avgDailyActual: +(rs.reduce((s, r) => s + r.actual, 0) / rs.length).toFixed(1),
        levelShiftPct: shiftPct,
        structuralBreak,
        errorCause: !structuralBreak ? 'model'
          : (shiftPct as number) < 0 ? 'series-fell' : 'series-rose',
        note: structuralBreak
          ? `Actual volume ${(shiftPct as number) < 0 ? 'fell' : 'rose'} ${Math.abs(shiftPct as number)}% ` +
            `across this window, so most of the error is the level change, not the model. · ` +
            `الفوليوم الفعلي ${(shiftPct as number) < 0 ? 'انخفض' : 'ارتفع'} ${Math.abs(shiftPct as number)}% ` +
            `خلال هذه الفترة — الخطأ في معظمه تغيّر مستوى وليس خطأ نموذج.`
          : null,
        worstDay: worst ? { date: worst.date, actual: worst.actual, forecast: worst.forecast,
                            errPct: worst.actual > 0 ? +((100 * (worst.forecast - worst.actual)) / worst.actual).toFixed(1) : null } : null,
      };
    }).sort((a, b) => (b.wapePct ?? 0) - (a.wapePct ?? 0));

    // Which system these numbers came from, and when it last spoke. The whole table
    // is one source today; if that source has stopped, every forecast built on it is
    // describing a platform the centre may no longer be running.
    const srcRows = await this.ds.query(
      `SELECT source, max(vol_date)::text AS newest, count(*)::int AS n
       FROM contact_volume_daily WHERE tenant_id = $1 GROUP BY source ORDER BY n DESC`,
      [tenantId],
    );
    const brokenChannels = perChannel.filter((c: any) => c.structuralBreak).map((c: any) => c.channel);

    return {
      asOf: mx, days: nDays,
      basisKind: 'engine-forecast' as const,
      basis: 'backtest of the engine\'s own baseline: forecast(D) = mean of the previous ≤4 same-weekday measured offered, computed blind to D, vs measured offered (contact_volume_daily). WAPE = Σ|F−A|÷ΣA; bias positive = over-forecast (over-staff), negative = under-forecast (SL risk).',
      sources: srcRows.map((r: any) => ({ source: r.source, rows: r.n, newest: r.newest })),
      headline: brokenChannels.length
        ? `${brokenChannels.length} of ${perChannel.length} channels changed level inside this window ` +
          `(${brokenChannels.join(', ')}) — read the error as a level change first, the model second. · ` +
          `${brokenChannels.length} من ${perChannel.length} قنوات تغيّر مستواها داخل هذه الفترة — ` +
          `اقرأ الخطأ كتغيّر مستوى أولاً لا كخطأ نموذج.`
        : null,
      overall: backtestStats(rows),
      perChannel,
      perDay: rows,
    };
  }

  /** Requirement + hiring verdict under base/surge/quiet/OT — one call, side-by-side. */
  async scenarioCompare(tenantId: string, from: string, to: string, internProductivity = 0.7) {
    const defs = StaffingService.SCENARIO_DEFS;
    const runs = await Promise.all(defs.map(s =>
      this.hiringNow(tenantId, from, to, internProductivity, s.otPct, { ordersScale: s.ordersScale })));
    const scenarios = defs.map((s, i) => {
      const r: any = runs[i];
      const useOt = s.otPct > 0;   // the OT variant's verdict = hires still needed AFTER the OT allowance
      return {
        key: s.key, ordersScale: s.ordersScale, otPct: s.otPct,
        totalInternsToHire: useOt ? r.totalInternsWithOt : r.totalInternsToHire,
        totalOtHoursWeekly: useOt ? r.totalOtHoursWeekly : 0,
        totalSurplusBodies: r.totalSurplusBodies,
        perFunction: r.perFunction.map((f: any) => ({
          functionKey: f.functionKey, requiredPeak: f.requiredPeak, currentTeam: f.currentTeam,
          gap: f.gap, coverageTeamGap: f.coverageTeamGap, bindingConstraint: f.bindingConstraint,
          internsToHire: useOt ? f.internsWithOt : f.internsToHire,
          otHoursWeekly: useOt ? f.otHoursWeekly : 0,
          surplusBodies: f.surplusBodies,
          worstDay: f.worstDay,
        })),
      };
    });
    const base = scenarios.find(s => s.key === 'base')!;
    return {
      from, to, internProductivity,
      basisKind: 'engine-forecast' as const,
      basis: 'same engine chain per scenario: surge/quiet scale forecast volume (ordersScale ×1.2 / ×0.85, CPO held constant); base+ot10 keeps base volume and lets the current team work +10% hours before hiring.',
      scenarios: scenarios.map(s => ({ ...s, deltaInternsVsBase: s.totalInternsToHire - base.totalInternsToHire })),
    };
  }

  /** Computed insight bullets from the real numbers — see deriveInsights (pure). */
  async staffingInsights(tenantId: string, from: string, to: string) {
    const [req, hiring, wow, anchorRow, accuracy] = await Promise.all([
      this.hourlyRequirement(tenantId, from, to),
      this.hiringNow(tenantId, from, to),
      this.ds.query(
        `WITH mx AS (SELECT MAX(vol_date) AS m FROM contact_volume_daily WHERE tenant_id = $1 AND offered > 0)
         SELECT c.channel,
                SUM(CASE WHEN c.vol_date >  mx.m - 7 THEN c.offered ELSE 0 END)::float AS last7,
                SUM(CASE WHEN c.vol_date <= mx.m - 7 AND c.vol_date > mx.m - 14 THEN c.offered ELSE 0 END)::float AS prev7
         FROM contact_volume_daily c CROSS JOIN mx
         WHERE c.tenant_id = $1 AND c.offered > 0 AND c.vol_date > mx.m - 14
         GROUP BY c.channel`, [tenantId]),
      this.ds.query(
        `SELECT MAX(vol_date)::text AS anchor FROM contact_volume_daily WHERE tenant_id = $1 AND offered > 0`, [tenantId]),
      this.forecastAccuracy(tenantId, 28).catch(() => null),
    ]);
    const insights = deriveInsights({
      from,
      dataAnchor: anchorRow[0]?.anchor ?? null,
      days: req.days,
      hiringPerFunction: (hiring as any).perFunction,
      wow,
      backtest: accuracy?.perChannel?.map((c: any) => ({ channel: c.channel, wapePct: c.wapePct, biasPct: c.biasPct })),
    });
    return {
      from, to,
      basisKind: 'engine-forecast' as const,
      generatedAt: new Date().toISOString(),
      counts: {
        critical: insights.filter(i => i.severity === 'critical').length,
        warn: insights.filter(i => i.severity === 'warn').length,
        info: insights.filter(i => i.severity === 'info').length,
      },
      insights,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  LEARNING STORE — roll Sprinklr snapshots up into hourly measured workload
   *  (avg inProgress = Erlangs, measured — no estimation error) and blend the
   *  learned curves into the forecast. aht/acw/hold learn the same way once the
   *  bridge captures handle stats. AI-workforce W1: runs itself hourly.
   * ═══════════════════════════════════════════════════════════════════════════ */

  /** Aggregate integration_snapshots → staffing_observations for a window (default: last 48h). */
  async rollupObservations(tenantId: string, hoursBack = 48) {
    const rows = await this.ds.query(
      `SELECT date_trunc('hour', captured_at) AS h, captured_at, queues_json
       FROM integration_snapshots
       WHERE tenant_id = $1 AND source = 'sprinklr'
         AND captured_at >= NOW() - ($2 || ' hours')::interval
       ORDER BY captured_at`,
      [tenantId, String(hoursBack)],
    );
    type Acc = { erl: number[]; wait: number[] };
    const agg = new Map<string, Acc>(); // `${hourISO}|${channel}`
    for (const r of rows) {
      const queues: any[] = Array.isArray(r.queues_json) ? r.queues_json : JSON.parse(r.queues_json || '[]');
      const perCh: Record<string, { p: number; w: number }> = {};
      for (const q of queues) {
        const ch = q.channel || 'unknown';
        perCh[ch] = perCh[ch] || { p: 0, w: 0 };
        perCh[ch].p += q.inProgress ?? 0;
        perCh[ch].w += q.waiting ?? 0;
      }
      for (const [ch, v] of Object.entries(perCh)) {
        const key = `${new Date(r.h).toISOString()}|${ch}`;
        const a = agg.get(key) ?? { erl: [], wait: [] };
        a.erl.push(v.p); a.wait.push(v.w);
        agg.set(key, a);
      }
    }
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    let upserts = 0;
    for (const [key, a] of agg) {
      const [hour, channel] = key.split('|');
      await this.ds.query(
        `INSERT INTO staffing_observations (tenant_id, obs_hour, channel, erlangs, waiting_avg, samples)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, obs_hour, channel, source) DO UPDATE
           SET erlangs = EXCLUDED.erlangs, waiting_avg = EXCLUDED.waiting_avg,
               samples = EXCLUDED.samples, computed_at = NOW()`,
        // anti-garbage: winsorize the stored averages at the same ceiling so a grossly
        // corrupt snapshot can never poison the store (the floor already ignores waiting).
        [tenantId, hour, channel, Math.min(avg(a.erl), LEARNED_ERL_CEIL).toFixed(3), Math.min(avg(a.wait), LEARNED_ERL_CEIL).toFixed(3), a.erl.length],
      );
      upserts++;
    }
    return { ok: true, hoursBack, snapshotRows: rows.length, hourChannelCells: upserts };
  }

  /** Learning-store visibility for the UI: coverage + a 7×24 P90 heat per channel. */
  async learnedSummary(tenantId: string) {
    const [meta] = await this.ds.query(
      `SELECT COUNT(*)::int cells, COUNT(DISTINCT channel)::int channels,
              MIN(obs_hour)::text first_obs, MAX(obs_hour)::text last_obs,
              SUM(samples)::int total_samples
       FROM staffing_observations WHERE tenant_id = $1`, [tenantId]);
    const rows = await this.ds.query(
      `SELECT channel,
              EXTRACT(DOW  FROM obs_hour AT TIME ZONE 'Asia/Kuwait')::int AS dow,
              EXTRACT(HOUR FROM obs_hour AT TIME ZONE 'Asia/Kuwait')::int AS hr,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY erlangs) AS p90,
              COUNT(*)::int n
       FROM staffing_observations WHERE tenant_id = $1
       GROUP BY channel, dow, hr ORDER BY channel, dow, hr`, [tenantId]);
    const channels: Record<string, { grid: (number | null)[][]; cells: number }> = {};
    for (const r of rows) {
      const c = (channels[r.channel] = channels[r.channel] || { grid: Array.from({ length: 7 }, () => new Array(24).fill(null)), cells: 0 });
      c.grid[+r.dow][+r.hr] = +(+r.p90).toFixed(2);
      c.cells++;
    }
    return {
      ...meta,
      note: 'P90 measured CONCURRENT load (Erlangs = inProgress; queue WAITING is excluded — it is backlog, not concurrent demand) per weekday×hour, over ≥5 same-weekday samples — the engine never staffs below these where present. aht/acw/hold learn the same way once the bridge captures handle stats.',
      channels,
    };
  }

  /** Learned P90 measured concurrent Erlangs (inProgress; waiting EXCLUDED) per channel ×
   *  weekday × hour, requiring ≥5 same-weekday-hour samples so one anomalous snapshot
   *  (e.g. a transient queue backlog) can never become a hard staffing floor. */
  async learnedCurves(tenantId: string): Promise<Record<string, Record<number, Record<number, number>>>> {
    const rows = await this.ds.query(
      `SELECT channel,
              EXTRACT(DOW  FROM obs_hour AT TIME ZONE 'Asia/Kuwait')::int AS dow,
              EXTRACT(HOUR FROM obs_hour AT TIME ZONE 'Asia/Kuwait')::int AS hr,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY erlangs) AS p90,
              COUNT(*)::int AS n
       FROM staffing_observations WHERE tenant_id = $1
       GROUP BY channel, dow, hr HAVING COUNT(*) >= 5`,
      [tenantId],
    );
    const out: Record<string, Record<number, Record<number, number>>> = {};
    for (const r of rows) ((out[r.channel] = out[r.channel] || {})[+r.dow] = out[r.channel][+r.dow] || {})[+r.hr] = +r.p90;
    return out;
  }
}
