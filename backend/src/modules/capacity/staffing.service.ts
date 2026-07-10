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
          // load (Erlangs, incl. waiting) for this weekday×hour, never staff below it —
          // measurement beats estimation (volume×AHT) when they disagree upward.
          let learnedErl = 0;
          if (!windowed || inWindow(h)) {   // deferred functions never staff outside their window
            for (const [ch, share] of Object.entries(p.channelMix)) {
              const v = learned[ch]?.[dow]?.[h];
              if (v != null) learnedErl += v * (share as number);
            }
          }
          const estimated = (volume * ahtEff) / 3600;
          const learnedApplied = learnedErl * ordersScale > estimated + 0.05;
          const erlangs = Math.max(estimated, learnedErl * ordersScale);
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
            ...(learnedApplied ? { learned: true } : {}),
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
  async hiringNow(tenantId: string, from: string, to: string, internProductivity = 0.7, otPct = 0) {
    const [req, pools] = await Promise.all([
      this.hourlyRequirement(tenantId, from, to),
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
        [tenantId, hour, channel, avg(a.erl).toFixed(3), avg(a.wait).toFixed(3), a.erl.length],
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
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY erlangs + waiting_avg) AS p90,
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
      note: 'P90 measured concurrent load (Erlangs incl. waiting) per weekday×hour — the engine never staffs below these where present. aht/acw/hold learn the same way once the bridge captures handle stats.',
      channels,
    };
  }

  /** Learned P90 measured Erlangs per channel × weekday × hour (≥2 same-weekday samples). */
  async learnedCurves(tenantId: string): Promise<Record<string, Record<number, Record<number, number>>>> {
    const rows = await this.ds.query(
      `SELECT channel,
              EXTRACT(DOW  FROM obs_hour AT TIME ZONE 'Asia/Kuwait')::int AS dow,
              EXTRACT(HOUR FROM obs_hour AT TIME ZONE 'Asia/Kuwait')::int AS hr,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY erlangs + waiting_avg) AS p90,
              COUNT(*)::int AS n
       FROM staffing_observations WHERE tenant_id = $1
       GROUP BY channel, dow, hr HAVING COUNT(*) >= 2`,
      [tenantId],
    );
    const out: Record<string, Record<number, Record<number, number>>> = {};
    for (const r of rows) ((out[r.channel] = out[r.channel] || {})[+r.dow] = out[r.channel][+r.dow] || {})[+r.hr] = +r.p90;
    return out;
  }
}
