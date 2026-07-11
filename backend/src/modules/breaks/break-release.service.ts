import { Injectable, Logger, OnModuleInit, OnModuleDestroy, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BreaksService } from './breaks.service';
import { BreakPolicyService } from './break-policy.service';
import {
  RiskLevel, RiskAssessment, riskAssess,
  maxSimultaneousBreaks,
  PriorityCandidate, priorityScore, ScoreLine,
  ReleaseMode, decideRelease,
  antiClusterOk,
  delayLadder, delayStage,
  ReleaseThresholds, THRESHOLD_DEFAULTS,
} from './break-release.logic';

/**
 * B3 — LIVE RELEASE ENGINE (§4–§13, §19, §22, §23, §30).
 * Background loop (SLA-escalation lifecycle pattern) that advances the break
 * slot state machine every tick, per tenant, per FUNCTION:
 *
 *   scheduled ──(now ≥ earliest_start)──▶ eligible
 *   eligible ──(mode+risk+capacity OK)──▶ released ──(employee starts)──▶ active
 *   eligible ──(capacity full)──────────▶ waiting_capacity
 *   eligible/waiting ──(now > latest_start)──▶ delayed  (delay_min/reason updated each tick)
 *   active ──(now > planned end + 5min grace, no actual_end)──▶ overdue
 *   active/overdue ──(employee returns)──▶ completed  (balance posted via recordActual)
 *
 * All decision math is pure (break-release.logic.ts). All engine state that
 * must survive restarts lives on the slot rows (delay_min drives once-per-stage
 * escalation) or in the notifications table (dedup for reminders).
 */

const BUCKET_MS = 15 * 60_000;
const TZ = '+03:00';                 // data timezone (Kuwait)
const TZ_OFFSET_MS = 3 * 3600_000;
const OVERDUE_GRACE_MIN = 5;
const RETURN_REMINDER_MIN = 5;

const WAITING_STATUSES = ['eligible', 'waiting_capacity', 'delayed'];
const ENGINE_STATUSES = ['scheduled', 'eligible', 'waiting_capacity', 'delayed', 'released', 'active', 'overdue'];

interface SlotRow {
  id: string; employee_id: string; status: string; slot_number: number;
  planned_start: string; planned_end: string;
  earliest_start: string | null; latest_start: string | null;
  planned_date: string; schedule_date: string;
  actual_start: string | null; actual_end: string | null;
  delay_min: number | null; delay_reason: string | null;
  released_at: string | null; priority_score: number | null;
  employee_no: string; employee_name: string; gender: string;
  function_name: string; employment_type: string | null; shift_code: string | null;
  shift_start: string | null; shift_end: string | null;
  team_manager: string | null;
  sessions_used: number; used_minutes: number; entitled_minutes: number;
  last_break_end: string | null;
  duration_minutes: number | null;
}

interface SlotView extends SlotRow {
  plannedTs: Date; plannedEndTs: Date;
  earliestTs: Date; latestTs: Date;
  shiftStartTs: Date | null; shiftEndTs: Date | null;
  expectedEndTs: Date;               // actual_start + planned duration, else plannedEndTs
  durMin: number;
  score?: number; breakdown?: ScoreLine[];
}

interface FunctionState {
  functionName: string;
  mode: ReleaseMode;
  thresholds: ReleaseThresholds;
  maxDelayMin: number;
  policyId: string | null;
  risk: RiskAssessment;
  cap: number;
  activeOnBreak: number;            // released + active + overdue
  requiredNow: number;
  scheduledNow: number;
  candidates: SlotView[];           // scored, ordered
  onBreakSlots: SlotView[];         // released/active/overdue (for ETA)
}

interface EngineSnapshot {
  now: Date;
  dateStr: string;
  live: Awaited<ReturnType<BreaksService['getLiveQueueState']>>;
  staleSec: number | null;
  functions: Map<string, FunctionState>;
  teamActive: Map<string, number>;  // team_manager → released/active count
  allSlots: SlotView[];
}

@Injectable()
export class BreakReleaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BreakReleaseService.name);
  private timer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;
  private ticking = false;
  private lastTick: {
    at: string; date: string; tenants: number; released: number; transitions: number;
    perFunction: Record<string, { risk: RiskLevel; reasons: string[]; mode: string; cap: number; onBreak: number; waiting: number }>;
    staleSec: number | null;
  } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly breaksService: BreaksService,
    private readonly policyService: BreakPolicyService,
  ) {}

  onModuleInit() {
    const ms = parseInt(process.env.BREAK_ENGINE_INTERVAL_MS ?? '45000', 10);
    if (!Number.isFinite(ms) || ms <= 0) {
      this.logger.log('Break release engine DISABLED (BREAK_ENGINE_INTERVAL_MS <= 0)');
      return;
    }
    this.bootTimer = setTimeout(() => this.safeTick(), 20_000);
    this.timer = setInterval(() => this.safeTick(), ms);
    this.logger.log(`Break release engine armed — tick every ${ms}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  private safeTick() {
    this.tick().catch(e => this.logger.warn(`break engine tick failed: ${e.message}`));
  }

  // ── Time helpers (all wall clocks are Kuwait +03, matching the data) ──────
  private todayLocal(): string {
    return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** Current time-of-day projected onto the tick date (identical when date = today). */
  private effectiveNow(dateStr: string): Date {
    const nowKW = new Date(Date.now() + TZ_OFFSET_MS);
    const hh = String(nowKW.getUTCHours()).padStart(2, '0');
    const mm = String(nowKW.getUTCMinutes()).padStart(2, '0');
    const ss = String(nowKW.getUTCSeconds()).padStart(2, '0');
    return new Date(`${dateStr}T${hh}:${mm}:${ss}${TZ}`);
  }

  private ts(dateStr: string, time: string): Date {
    const t = String(time).slice(0, 8);
    const norm = t.length === 5 ? `${t}:00` : t;
    return new Date(`${dateStr}T${norm}${TZ}`);
  }

  private hhmmss(d: Date): string {
    const kw = new Date(d.getTime() + TZ_OFFSET_MS);
    return kw.toISOString().slice(11, 19);
  }

  private minOf(d: Date): number { return Math.floor(d.getTime() / 60_000); }

  // ── The tick ───────────────────────────────────────────────────────────────
  async tick(dateOverride?: string): Promise<{ date: string; tenants: number; released: number; transitions: number }> {
    if (this.ticking) return { date: dateOverride ?? this.todayLocal(), tenants: 0, released: 0, transitions: 0 };
    this.ticking = true;
    try {
      const dateStr = dateOverride ?? this.todayLocal();
      const tenants: Array<{ tenant_id: string }> = await this.dataSource.query(
        `SELECT DISTINCT tenant_id FROM break_slots
         WHERE COALESCE(planned_date, schedule_date) = $1::date
           AND status = ANY($2)`,
        [dateStr, ENGINE_STATUSES],
      );
      let released = 0, transitions = 0;
      const perFunction: Record<string, any> = {};
      let staleSec: number | null = null;
      for (const t of tenants) {
        const r = await this.tickTenant(t.tenant_id, dateStr);
        released += r.released; transitions += r.transitions;
        Object.assign(perFunction, r.perFunction);
        staleSec = r.staleSec;
      }
      this.lastTick = {
        at: new Date().toISOString(), date: dateStr, tenants: tenants.length,
        released, transitions, perFunction, staleSec,
      };
      return { date: dateStr, tenants: tenants.length, released, transitions };
    } finally {
      this.ticking = false;
    }
  }

  private async tickTenant(tenantId: string, dateStr: string): Promise<{
    released: number; transitions: number; staleSec: number | null;
    perFunction: Record<string, { risk: RiskLevel; reasons: string[]; mode: string; cap: number; onBreak: number; waiting: number }>;
  }> {
    const snap = await this.buildSnapshot(tenantId, dateStr);
    const now = snap.now;
    let released = 0, transitions = 0;

    for (const [fnName, fs] of snap.functions) {
      // ── Phase 1: lifecycle advance (non-release transitions) ──────────────
      for (const s of fs.candidates) {
        if (s.status === 'scheduled' && now >= s.earliestTs) {
          await this.setStatus(tenantId, s.id, ['scheduled'], 'eligible', {});
          s.status = 'eligible';
          transitions++;
        }
        if (WAITING_STATUSES.includes(s.status)) {
          const delayMin = Math.max(0, Math.round((now.getTime() - s.plannedTs.getTime()) / 60_000));
          const pastLatest = now > s.latestTs;
          const prevDelay = Number(s.delay_min ?? 0);
          if (pastLatest && s.status !== 'delayed') {
            await this.setStatus(tenantId, s.id, WAITING_STATUSES, 'delayed', {
              delay_min: delayMin,
              delay_reason: fs.risk.level === 'green' ? 'delayed past latest safe start' : `operational pressure (risk ${fs.risk.level})`,
            });
            s.status = 'delayed';
            transitions++;
          } else if (delayMin > 0 && delayMin !== prevDelay) {
            await this.dataSource.query(
              `UPDATE break_slots SET delay_min = $1, delay_reason = COALESCE(delay_reason, $2), updated_at = NOW()
               WHERE id = $3 AND tenant_id = $4`,
              [delayMin, `waiting (risk ${fs.risk.level})`, s.id, tenantId],
            );
          }
          // §11 delay escalation — once per stage, driven by persisted delay_min
          if (delayMin > 0) {
            const ladder = delayLadder(fs.thresholds, fs.maxDelayMin);
            const prevStage = delayStage(prevDelay, ladder);
            const newStage = delayStage(delayMin, ladder);
            if (newStage > prevStage) {
              await this.escalateDelay(tenantId, s, delayMin, newStage);
            }
          }
          s.delay_min = delayMin;
        }
      }

      // ── Phase 2: releases (mode × risk × capacity × anti-cluster) ─────────
      for (const s of fs.candidates) {
        if (!WAITING_STATUSES.includes(s.status)) continue;
        if (now < s.earliestTs) continue;
        const entitlementOverride =
          s.sessions_used >= 4 && s.entitled_minutes <= s.used_minutes; // conservative; policy caps enforced at completion
        const decision = decideRelease(fs.mode, fs.risk.level, { entitlementOverride });
        if (decision !== 'release') continue;
        const cluster = antiClusterOk({
          activeInFunction: fs.activeOnBreak,
          functionCap: fs.cap,
          activeInTeam: s.team_manager ? (snap.teamActive.get(s.team_manager) ?? 0) : null,
          teamCap: Math.max(1, Number(fs.thresholds.max_simultaneous_per_team ?? THRESHOLD_DEFAULTS.max_simultaneous_per_team)),
        });
        if (!cluster.ok) {
          if (s.status === 'eligible') {
            await this.setStatus(tenantId, s.id, ['eligible'], 'waiting_capacity', { delay_reason: cluster.reason });
            s.status = 'waiting_capacity';
            transitions++;
          }
          continue;
        }
        const res = await this.dataSource.query(
          `UPDATE break_slots
           SET status = 'released', released_at = NOW(), release_source = 'auto',
               priority_score = $1, updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3 AND status = ANY($4)
           RETURNING id`,
          [s.score ?? 0, s.id, tenantId, WAITING_STATUSES],
        );
        const okRows = Array.isArray(res?.[0]) ? res[0] : res;
        if (!okRows?.length) continue;
        s.status = 'released';
        fs.activeOnBreak += 1;
        if (s.team_manager) snap.teamActive.set(s.team_manager, (snap.teamActive.get(s.team_manager) ?? 0) + 1);
        released++;
        await this.policyService.audit(tenantId, null, 'breaks.release.auto', 'break_slot', s.id,
          `${s.employee_name} (${fnName}) released — risk=${fs.risk.level}, score=${s.score}, cap ${fs.activeOnBreak}/${fs.cap}`);
        await this.notifyEmployee(tenantId, s.employee_id, 'break.released', s.id,
          'Break released — you can start now', 'تم فتح البريك — يمكنك البدء الآن',
          `Your break (planned ${String(s.planned_start).slice(0, 5)}) is released. Press Start.`,
          `بريكك (المخطط ${String(s.planned_start).slice(0, 5)}) أصبح متاحاً. اضغط ابدأ.`);
      }

      // update priority_score on remaining waiting slots (visible fairness)
      for (const s of fs.candidates) {
        if (WAITING_STATUSES.includes(s.status) && s.score != null && Number(s.priority_score) !== s.score) {
          await this.dataSource.query(
            `UPDATE break_slots SET priority_score = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [s.score, s.id, tenantId],
          );
        }
      }
    }

    // ── Phase 3: return monitoring (§19) — active → reminder / overdue ──────
    for (const s of snap.allSlots) {
      if (s.status === 'active' && !s.actual_end) {
        const msToEnd = s.expectedEndTs.getTime() - now.getTime();
        if (msToEnd <= RETURN_REMINDER_MIN * 60_000 && msToEnd > 0) {
          if (!(await this.alreadyNotified(tenantId, 'break.return_reminder', s.id))) {
            await this.notifyEmployee(tenantId, s.employee_id, 'break.return_reminder', s.id,
              'Break ending soon', 'البريك ينتهي قريباً',
              `Your break ends at ${this.hhmmss(s.expectedEndTs).slice(0, 5)} — please head back.`,
              `ينتهي بريكك الساعة ${this.hhmmss(s.expectedEndTs).slice(0, 5)} — الرجاء العودة.`);
          }
        } else if (now.getTime() > s.expectedEndTs.getTime() + OVERDUE_GRACE_MIN * 60_000) {
          await this.setStatus(tenantId, s.id, ['active'], 'overdue', {});
          s.status = 'overdue';
          transitions++;
          const overMin = Math.round((now.getTime() - s.expectedEndTs.getTime()) / 60_000);
          await this.notifyEmployee(tenantId, s.employee_id, 'break.overdue', s.id,
            'Break overdue — return now', 'تجاوزت وقت البريك — عد الآن',
            `Your break ended ${overMin} min ago. Please return and press Return.`,
            `انتهى بريكك قبل ${overMin} دقيقة. الرجاء العودة والضغط على زر العودة.`);
          await this.notifyRoles(tenantId, ['rta', 'wfm_analyst'], 'break.overdue', s.id,
            'Break overdue', 'بريك متجاوز للوقت',
            `${s.employee_name} (${s.function_name}) is ${overMin} min overdue from break.`,
            `${s.employee_name} (${s.function_name}) متأخر ${overMin} دقيقة عن العودة من البريك.`);
          await this.policyService.audit(tenantId, null, 'breaks.overdue', 'break_slot', s.id,
            `${s.employee_name} overdue ${overMin}min (expected end ${this.hhmmss(s.expectedEndTs)})`);
        }
      }
    }

    const perFunction: Record<string, any> = {};
    for (const [fnName, fs] of snap.functions) {
      perFunction[fnName] = {
        risk: fs.risk.level, reasons: fs.risk.reasons, mode: fs.mode,
        cap: fs.cap, onBreak: fs.activeOnBreak,
        waiting: fs.candidates.filter(c => WAITING_STATUSES.includes(c.status)).length,
      };
    }
    return { released, transitions, staleSec: snap.staleSec, perFunction };
  }

  // ── Snapshot builder (shared by tick + endpoints) ──────────────────────────
  async buildSnapshot(tenantId: string, dateStr: string): Promise<EngineSnapshot> {
    const now = this.effectiveNow(dateStr);
    const live = await this.breaksService.getLiveQueueState(tenantId);
    const staleSec = live?.staleSec ?? null;
    const policies = await this.policyService.loadActivePolicies(tenantId);

    const rows: SlotRow[] = await this.dataSource.query(
      `SELECT bs.id, bs.employee_id, bs.status, bs.slot_number,
              bs.planned_start::text, bs.planned_end::text,
              bs.earliest_start::text, bs.latest_start::text,
              COALESCE(bs.planned_date, bs.schedule_date)::text AS planned_date,
              bs.schedule_date::text AS schedule_date,
              bs.actual_start::text, bs.actual_end::text,
              bs.delay_min, bs.delay_reason, bs.released_at, bs.priority_score,
              e.employee_no,
              (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
              e.gender,
              canon_fn(COALESCE(f.name,'—')) AS function_name,
              e.employment_type::text AS employment_type,
              sc.code AS shift_code,
              ar.scheduled_start::text AS shift_start,
              ar.scheduled_end::text   AS shift_end,
              rd.team_manager,
              COALESCE(b.sessions_used, 0)     AS sessions_used,
              COALESCE(b.used_minutes, 0)      AS used_minutes,
              COALESCE(b.entitled_minutes, 60) AS entitled_minutes,
              b.last_break_end,
              bt.duration_minutes
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN break_types bt ON bt.id = bs.break_type_id
       LEFT JOIN attendance_records ar
         ON ar.tenant_id = bs.tenant_id AND ar.employee_id = bs.employee_id
        AND ar.attendance_date = bs.schedule_date
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       LEFT JOIN LATERAL (
         SELECT r.team_manager FROM roster_days r
         WHERE r.tenant_id = bs.tenant_id AND r.person_no = e.employee_no
           AND r.work_date = bs.schedule_date AND r.is_active
         LIMIT 1
       ) rd ON TRUE
       LEFT JOIN break_daily_balance b
         ON b.tenant_id = bs.tenant_id AND b.employee_id = bs.employee_id
        AND b.balance_date = bs.schedule_date
       WHERE bs.tenant_id = $1
         AND COALESCE(bs.planned_date, bs.schedule_date) = $2::date
         AND bs.status = ANY($3)
       ORDER BY bs.planned_start`,
      [tenantId, dateStr, ENGINE_STATUSES],
    );

    // headcount_intervals for today + tomorrow, folded to canon function name
    const intervals: Array<{ interval_start: string; function_name: string; required_hc: number; scheduled_hc: number }> =
      await this.dataSource.query(
        `SELECT hi.interval_start, canon_fn(COALESCE(f.name,'—')) AS function_name,
                SUM(hi.required_hc)::int AS required_hc, SUM(hi.scheduled_hc)::int AS scheduled_hc
         FROM headcount_intervals hi
         LEFT JOIN functions f ON f.id = hi.function_id
         WHERE hi.tenant_id = $1 AND hi.snapshot_date IN ($2::date, $2::date + 1)
         GROUP BY hi.interval_start, canon_fn(COALESCE(f.name,'—'))`,
        [tenantId, dateStr],
      );
    const intervalMap = new Map<string, { required: number; scheduled: number }>();
    for (const r of intervals) {
      const key = `${Math.floor(new Date(r.interval_start).getTime() / BUCKET_MS)}|${r.function_name}`;
      intervalMap.set(key, { required: Number(r.required_hc), scheduled: Number(r.scheduled_hc) });
    }
    const bucketFor = (fn: string, at: Date) =>
      intervalMap.get(`${Math.floor(at.getTime() / BUCKET_MS)}|${fn}`) ?? null;

    // Build slot views
    const views: SlotView[] = rows.map(r => {
      const plannedTs = this.ts(r.planned_date, r.planned_start);
      let plannedEndTs = this.ts(r.planned_date, r.planned_end);
      if (plannedEndTs <= plannedTs) plannedEndTs = new Date(plannedEndTs.getTime() + 86_400_000);
      let earliestTs = r.earliest_start ? this.ts(r.planned_date, r.earliest_start) : plannedTs;
      if (earliestTs > plannedTs) earliestTs = new Date(earliestTs.getTime() - 86_400_000);
      let latestTs = r.latest_start ? this.ts(r.planned_date, r.latest_start) : plannedTs;
      if (latestTs < plannedTs) latestTs = new Date(latestTs.getTime() + 86_400_000);
      const durMin = Math.round((plannedEndTs.getTime() - plannedTs.getTime()) / 60_000);
      let expectedEndTs = plannedEndTs;
      if (r.actual_start) {
        // actual_start belongs to the same local day the break was planned on
        const as = this.ts(r.planned_date, r.actual_start);
        expectedEndTs = new Date(as.getTime() + durMin * 60_000);
      }
      let shiftStartTs: Date | null = null, shiftEndTs: Date | null = null;
      if (r.shift_start && r.shift_end) {
        shiftStartTs = this.ts(r.schedule_date, r.shift_start);
        shiftEndTs = this.ts(r.schedule_date, r.shift_end);
        if (shiftEndTs <= shiftStartTs) shiftEndTs = new Date(shiftEndTs.getTime() + 86_400_000);
      }
      return { ...r, plannedTs, plannedEndTs, earliestTs, latestTs, shiftStartTs, shiftEndTs, expectedEndTs, durMin };
    });

    // Group per function; count on-break; team counts
    const functions = new Map<string, FunctionState>();
    const teamActive = new Map<string, number>();
    const delayedEmployees = new Set(views.filter(v => Number(v.delay_min ?? 0) > 0).map(v => v.employee_id));

    for (const v of views) {
      if (!functions.has(v.function_name)) {
        const policy = policies.length
          ? (policies.find(p => p.function_name && p.function_name.toLowerCase() === v.function_name.toLowerCase() && !p.shift_type && !p.employment_type)
             ?? policies.find(p => !p.function_name && !p.shift_type && !p.employment_type)
             ?? policies[0])
          : null;
        functions.set(v.function_name, {
          functionName: v.function_name,
          mode: (policy?.release_mode ?? 'hybrid') as ReleaseMode,
          thresholds: (policy?.thresholds ?? {}) as ReleaseThresholds,
          maxDelayMin: Number(policy?.max_delay_min ?? 45),
          policyId: policy?.id ?? null,
          risk: { level: 'orange', reasons: ['not yet assessed'] },
          cap: 0, activeOnBreak: 0, requiredNow: 0, scheduledNow: 0,
          candidates: [], onBreakSlots: [],
        });
      }
      const fs = functions.get(v.function_name)!;
      if (['released', 'active', 'overdue'].includes(v.status)) {
        fs.activeOnBreak += 1;
        fs.onBreakSlots.push(v);
        if (v.team_manager) teamActive.set(v.team_manager, (teamActive.get(v.team_manager) ?? 0) + 1);
      } else if (WAITING_STATUSES.includes(v.status) || (v.status === 'scheduled' && v.earliestTs <= now)) {
        // scheduled slots whose window opened join the line this tick (Phase 1 flips them eligible)
        fs.candidates.push(v);
      }
    }

    // Risk + capacity + priority per function
    for (const fs of functions.values()) {
      const nowBucket = bucketFor(fs.functionName, now);
      const b1 = bucketFor(fs.functionName, new Date(now.getTime() + BUCKET_MS));
      const b2 = bucketFor(fs.functionName, new Date(now.getTime() + 2 * BUCKET_MS));
      fs.requiredNow = nowBucket?.required ?? 0;
      fs.scheduledNow = nowBucket?.scheduled ?? 0;
      fs.risk = riskAssess({
        requiredNow: fs.requiredNow,
        scheduledNow: fs.scheduledNow,
        onBreakNow: fs.activeOnBreak,
        liveAvailableNow: live?.availableNow ?? null,
        queueWaiting: live?.totalWaiting ?? 0,
        atRiskQueueCount: live?.atRiskQueues?.length ?? 0,
        forecastRequiredNext30: Math.max(b1?.required ?? 0, b2?.required ?? 0),
        forecastScheduledNext30: Math.min(b1?.scheduled ?? fs.scheduledNow, b2?.scheduled ?? fs.scheduledNow),
        staleSec,
        thresholds: fs.thresholds,
      });
      fs.cap = maxSimultaneousBreaks(fs.scheduledNow, fs.requiredNow, fs.thresholds);
      // fallback when demand spine is empty for this function: cap on live scheduled agents unknown → allow 1
      if (fs.scheduledNow === 0) fs.cap = Math.max(fs.cap, 1);

      // Score candidates (peers = waiting candidates of the SAME function)
      const nowMin = this.minOf(now);
      const asCand = (v: SlotView): PriorityCandidate => ({
        slotId: v.id,
        sessionsToday: Number(v.sessions_used),
        maxSessions: 4,
        minutesUsedToday: Number(v.used_minutes),
        entitledMinutes: Number(v.entitled_minutes),
        plannedStartMin: this.minOf(v.plannedTs),
        latestStartMin: this.minOf(v.latestTs),
        shiftStartMin: v.shiftStartTs ? this.minOf(v.shiftStartTs) : this.minOf(v.plannedTs) - 240,
        shiftEndMin: v.shiftEndTs ? this.minOf(v.shiftEndTs) : this.minOf(v.plannedEndTs) + 240,
        lastBreakEndMin: v.last_break_end ? this.minOf(new Date(v.last_break_end)) : null,
        wasDelayedToday: delayedEmployees.has(v.employee_id) || Number(v.delay_min ?? 0) > 0,
      });
      const peerCands = fs.candidates.map(asCand);
      const weights = (fs.thresholds.priority_weights ?? null) as any;
      for (const v of fs.candidates) {
        const me = asCand(v);
        const peers = peerCands.filter(p => p.slotId !== v.id);
        const r = priorityScore(me, peers, nowMin, weights);
        v.score = r.score;
        v.breakdown = r.breakdown;
      }
      // strict order: score desc, tie → earlier planned start, then slot id
      // (same rule as orderCandidates — kept in-place to preserve object identity)
      fs.candidates.sort((a, b) =>
        (b.score! - a.score!) || (a.plannedTs.getTime() - b.plannedTs.getTime()) || a.id.localeCompare(b.id));
    }

    return { now, dateStr, live, staleSec, functions, teamActive, allSlots: views };
  }

  // ── ETA: when capacity frees (earliest expected end among on-break slots) ──
  private etaFor(fs: FunctionState, position: number, now: Date): string | null {
    const freeCap = fs.cap - fs.activeOnBreak;
    if (position < freeCap) return now.toISOString();
    const ends = fs.onBreakSlots.map(s => s.expectedEndTs.getTime()).sort((a, b) => a - b);
    const idx = position - Math.max(0, freeCap);
    if (!ends.length) return null;
    return new Date(ends[Math.min(idx, ends.length - 1)]).toISOString();
  }

  // ── Public: the live waiting line (§16 command-center feed) ───────────────
  async getLiveQueue(tenantId: string, date?: string, functionName?: string) {
    const dateStr = date ?? this.todayLocal();
    const snap = await this.buildSnapshot(tenantId, dateStr);
    const out: any[] = [];
    for (const [fnName, fs] of snap.functions) {
      if (functionName && fnName.toLowerCase() !== functionName.toLowerCase()) continue;
      out.push({
        function: fnName,
        mode: fs.mode,
        risk: fs.risk.level,
        riskReasons: fs.risk.reasons,
        requiredNow: fs.requiredNow,
        scheduledNow: fs.scheduledNow,
        onBreakNow: fs.activeOnBreak,
        maxSimultaneous: fs.cap,
        availableSlots: Math.max(0, fs.cap - fs.activeOnBreak),
        waiting: fs.candidates.map((c, i) => ({
          slotId: c.id,
          employeeId: c.employee_id,
          employeeNo: c.employee_no,
          employeeName: c.employee_name,
          teamManager: c.team_manager,
          status: c.status,
          plannedStart: String(c.planned_start).slice(0, 5),
          plannedEnd: String(c.planned_end).slice(0, 5),
          latestStart: c.latest_start ? String(c.latest_start).slice(0, 5) : null,
          delayMin: c.delay_min ?? 0,
          delayReason: c.delay_reason,
          score: c.score ?? 0,
          breakdown: c.breakdown ?? [],
          employeesAhead: i,
          eta: this.etaFor(fs, i, snap.now),
          decision: decideRelease(fs.mode, fs.risk.level),
        })),
        onBreak: fs.onBreakSlots.map(s => ({
          slotId: s.id, employeeName: s.employee_name, status: s.status,
          expectedEnd: s.expectedEndTs.toISOString(),
        })),
      });
    }
    return {
      date: dateStr,
      asOf: snap.now.toISOString(),
      liveData: snap.live ? { capturedAt: snap.live.capturedAt, staleSec: snap.staleSec, fresh: snap.live.fresh } : null,
      functions: out,
    };
  }

  // ── Public: agent break card payload (§14) ─────────────────────────────────
  async getMyBreakStatus(tenantId: string, employeeId: string, date?: string) {
    const dateStr = date ?? this.todayLocal();
    const snap = await this.buildSnapshot(tenantId, dateStr);
    const mySlots = snap.allSlots.filter(s => s.employee_id === employeeId);
    // include finished slots for the balance card
    const finished = await this.dataSource.query(
      `SELECT bs.id, bs.status, bs.planned_start::text, bs.planned_end::text,
              bs.actual_start::text, bs.actual_end::text, bs.slot_number, bs.late_minutes
       FROM break_slots bs
       WHERE bs.tenant_id = $1 AND bs.employee_id = $2
         AND COALESCE(bs.planned_date, bs.schedule_date) = $3::date
         AND bs.status IN ('completed','missed','cancelled')
       ORDER BY bs.planned_start`,
      [tenantId, employeeId, dateStr],
    );
    const [bal] = await this.dataSource.query(
      `SELECT entitled_minutes, used_minutes, sessions_used, last_break_end
       FROM break_daily_balance
       WHERE tenant_id = $1 AND employee_id = $2 AND balance_date IN ($3::date, $3::date - 1)
       ORDER BY balance_date DESC LIMIT 1`,
      [tenantId, employeeId, dateStr],
    );

    const ord = ['released', 'active', 'overdue', 'eligible', 'waiting_capacity', 'delayed', 'scheduled'];
    const next = [...mySlots].sort((a, b) =>
      ord.indexOf(a.status) - ord.indexOf(b.status) || a.plannedTs.getTime() - b.plannedTs.getTime())[0] ?? null;

    let position: number | null = null, eta: string | null = null, ahead = 0;
    if (next && WAITING_STATUSES.includes(next.status)) {
      const fs = snap.functions.get(next.function_name);
      if (fs) {
        const idx = fs.candidates.findIndex(c => c.id === next.id);
        if (idx >= 0) { position = idx + 1; ahead = idx; eta = this.etaFor(fs, idx, snap.now); }
      }
    } else if (next && next.status === 'released') {
      eta = snap.now.toISOString();
    }

    return {
      date: dateStr,
      asOf: snap.now.toISOString(),
      balance: {
        entitledMinutes: Number(bal?.entitled_minutes ?? next?.entitled_minutes ?? 60),
        usedMinutes: Number(bal?.used_minutes ?? 0),
        sessionsUsed: Number(bal?.sessions_used ?? 0),
        remainingMinutes: Math.max(0, Number(bal?.entitled_minutes ?? 60) - Number(bal?.used_minutes ?? 0)),
        lastBreakEnd: bal?.last_break_end ?? null,
      },
      nextBreak: next ? {
        slotId: next.id,
        status: next.status,
        plannedStart: String(next.planned_start).slice(0, 5),
        plannedEnd: String(next.planned_end).slice(0, 5),
        durationMin: next.durMin,
        earliestStart: next.earliest_start ? String(next.earliest_start).slice(0, 5) : null,
        latestStart: next.latest_start ? String(next.latest_start).slice(0, 5) : null,
        delayMin: next.delay_min ?? 0,
        delayReason: next.delay_reason,
        employeesAhead: ahead,
        positionInLine: position,
        estimatedRelease: eta,
      } : null,
      todaySlots: [
        ...mySlots.map(s => ({
          slotId: s.id, status: s.status, plannedStart: String(s.planned_start).slice(0, 5),
          plannedEnd: String(s.planned_end).slice(0, 5), slotNumber: s.slot_number,
        })),
        ...finished.map((s: any) => ({
          slotId: s.id, status: s.status, plannedStart: String(s.planned_start).slice(0, 5),
          plannedEnd: String(s.planned_end).slice(0, 5), slotNumber: s.slot_number,
        })),
      ],
      buttons: {
        canStart: next?.status === 'released',
        canReturn: next?.status === 'active' || next?.status === 'overdue',
        canRequestException: true,
      },
    };
  }

  // ── Public: manual supervisor release (§13 Mode B / §16) ───────────────────
  async manualRelease(tenantId: string, slotId: string, actor: { id?: string; email?: string }, reason?: string) {
    const [slot] = await this.dataSource.query(
      `SELECT bs.id, bs.status, bs.employee_id, bs.planned_start::text,
              COALESCE(bs.planned_date, bs.schedule_date)::text AS planned_date,
              (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
              canon_fn(COALESCE(f.name,'—')) AS function_name
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bs.id = $1 AND bs.tenant_id = $2`,
      [slotId, tenantId],
    );
    if (!slot) throw new NotFoundException('Break slot not found');
    if (!['scheduled', ...WAITING_STATUSES].includes(slot.status)) {
      throw new BadRequestException(`Slot is '${slot.status}' — only scheduled/eligible/waiting/delayed slots can be released.`);
    }

    const snap = await this.buildSnapshot(tenantId, slot.planned_date);
    const fs = snap.functions.get(slot.function_name);
    const risk = fs?.risk.level ?? 'orange';
    const mode = fs?.mode ?? 'hybrid';
    if (mode === 'freeze') {
      throw new BadRequestException('Emergency freeze is active — no releases. Change the engine mode first.');
    }
    const RANK: Record<string, number> = { green: 0, yellow: 1, orange: 2, red: 3, critical: 4 };
    if (RANK[risk] >= 2 && !reason?.trim()) {
      throw new BadRequestException(`Risk is ${risk} — a justification reason is required to release manually.`);
    }

    const res = await this.dataSource.query(
      `UPDATE break_slots
       SET status = 'released', released_at = NOW(), release_source = 'supervisor', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = ANY($3)
       RETURNING id`,
      [slotId, tenantId, ['scheduled', ...WAITING_STATUSES]],
    );
    const okRows = Array.isArray(res?.[0]) ? res[0] : res;
    if (!okRows?.length) throw new BadRequestException('Slot state changed — try again.');

    await this.policyService.audit(tenantId, actor, 'breaks.release.manual', 'break_slot', slotId,
      `${slot.employee_name} (${slot.function_name}) released by supervisor — risk=${risk}${reason ? `, reason: ${reason}` : ''}`);
    await this.notifyEmployee(tenantId, slot.employee_id, 'break.released', slotId,
      'Break released by supervisor', 'تم فتح البريك من المشرف',
      `Your break (planned ${String(slot.planned_start).slice(0, 5)}) was released. Press Start.`,
      `تم فتح بريكك (المخطط ${String(slot.planned_start).slice(0, 5)}). اضغط ابدأ.`);
    return { success: true, risk, released: true };
  }

  // ── Public: agent starts the break (only when released) ───────────────────
  async startBreak(tenantId: string, slotId: string, employeeId: string) {
    const [slot] = await this.dataSource.query(
      `SELECT id, status, employee_id FROM break_slots WHERE id = $1 AND tenant_id = $2`,
      [slotId, tenantId],
    );
    if (!slot) throw new NotFoundException('Break slot not found');
    if (slot.employee_id !== employeeId) throw new ForbiddenException('Not your break slot');
    if (slot.status !== 'released') throw new BadRequestException('not released');

    const nowTime = this.hhmmss(new Date());
    await this.dataSource.query(
      `UPDATE break_slots SET status = 'active', actual_start = $1::time, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'released'`,
      [nowTime, slotId, tenantId],
    );
    return { success: true, status: 'active', actualStart: nowTime.slice(0, 5) };
  }

  // ── Public: agent returns (completion + balance via existing flow §19) ─────
  async returnFromBreak(tenantId: string, slotId: string, employeeId: string) {
    const [slot] = await this.dataSource.query(
      `SELECT bs.id, bs.status, bs.employee_id, bs.actual_start::text,
              bs.planned_start::text, bs.planned_end::text,
              COALESCE(bs.planned_date, bs.schedule_date)::text AS planned_date
       FROM break_slots bs WHERE bs.id = $1 AND bs.tenant_id = $2`,
      [slotId, tenantId],
    );
    if (!slot) throw new NotFoundException('Break slot not found');
    if (slot.employee_id !== employeeId) throw new ForbiddenException('Not your break slot');
    if (!['active', 'overdue'].includes(slot.status)) {
      throw new BadRequestException(`Slot is '${slot.status}' — only an active/overdue break can be returned.`);
    }

    const now = new Date();
    const nowTime = this.hhmmss(now);
    // late-return math: expected end = actual_start + planned duration
    const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
    let plannedDur = toMin(slot.planned_end) - toMin(slot.planned_start);
    if (plannedDur <= 0) plannedDur += 1440;
    let actualDur = slot.actual_start ? toMin(nowTime) - toMin(slot.actual_start) : plannedDur;
    if (actualDur < 0) actualDur += 1440;
    const lateReturnMin = Math.max(0, actualDur - plannedDur);

    // Reuse the existing completion flow (late-start math + balance posting)
    await this.breaksService.recordActual(tenantId, slotId, {
      actualStart: slot.actual_start ?? nowTime,
      actualEnd: nowTime,
      status: 'completed',
      notes: lateReturnMin > 0 ? `late return +${lateReturnMin}min` : undefined,
    });
    return {
      success: true, status: 'completed',
      actualEnd: nowTime.slice(0, 5),
      consumedMinutes: actualDur,
      lateReturnMinutes: lateReturnMin,
    };
  }

  // ── Public: emergency mode switch (§13 Mode D) ─────────────────────────────
  async setMode(tenantId: string, actor: { id?: string; email?: string }, mode: ReleaseMode, functionName?: string) {
    if (!['auto', 'supervisor', 'hybrid', 'freeze'].includes(mode)) {
      throw new BadRequestException('mode must be auto | supervisor | hybrid | freeze');
    }
    const policy = await this.policyService.resolvePolicy(tenantId, functionName ?? null, null, null);
    if (!policy) throw new NotFoundException('No matching break policy row (seed the tenant default policy).');
    const res = await this.policyService.updatePolicy(tenantId, policy.id, { release_mode: mode });
    await this.policyService.audit(tenantId, actor, 'breaks.engine.mode', 'break_policies_v2', policy.id,
      `release_mode ${policy.release_mode} → ${mode}${functionName ? ` (function ${functionName}${policy.function_name ? '' : ' — via tenant default row'})` : ' (tenant default)'}`);
    return { success: true, policyId: policy.id, appliedTo: policy.function_name ?? 'tenant-default', mode: res?.after?.release_mode ?? mode };
  }

  // ── Public: engine status (§16) ────────────────────────────────────────────
  async getEngineStatus(tenantId: string) {
    const live = await this.breaksService.getLiveQueueState(tenantId);
    const policies = await this.policyService.listPolicies(tenantId);
    return {
      intervalMs: parseInt(process.env.BREAK_ENGINE_INTERVAL_MS ?? '45000', 10),
      running: !!this.timer,
      lastTick: this.lastTick,
      liveData: live
        ? { capturedAt: live.capturedAt, staleSec: live.staleSec, fresh: live.fresh, stale5min: (live.staleSec ?? 1e9) > 300, stale15min: (live.staleSec ?? 1e9) > 900 }
        : { capturedAt: null, staleSec: null, fresh: false, stale5min: true, stale15min: true },
      modes: policies
        .filter((p: any) => p.active)
        .map((p: any) => ({ policyId: p.id, function: p.function_name ?? '(default)', shiftType: p.shift_type, mode: p.release_mode })),
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────
  private async setStatus(
    tenantId: string, slotId: string, fromStatuses: string[], to: string,
    extra: { delay_min?: number; delay_reason?: string | null },
  ) {
    const sets = [`status = '${to}'`, 'updated_at = NOW()'];
    const params: unknown[] = [slotId, tenantId, fromStatuses];
    if (extra.delay_min != null) { params.push(extra.delay_min); sets.push(`delay_min = $${params.length}`); }
    if (extra.delay_reason !== undefined) { params.push(extra.delay_reason); sets.push(`delay_reason = $${params.length}`); }
    await this.dataSource.query(
      `UPDATE break_slots SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 AND status = ANY($3)`,
      params,
    );
  }

  /** §11 delay escalation ladder: 1=employee info, 2=priority raised, 3=supervisor alert, 4=manager/RTA escalation. */
  private async escalateDelay(tenantId: string, s: SlotView, delayMin: number, stage: number) {
    const type = `break.delay.stage${stage}`;
    if (await this.alreadyNotified(tenantId, type, s.id)) return;
    if (stage <= 2) {
      await this.notifyEmployee(tenantId, s.employee_id, type, s.id,
        stage === 1 ? 'Break delayed' : 'Break delayed — priority raised',
        stage === 1 ? 'تأجل البريك' : 'تأجل البريك — تم رفع الأولوية',
        `Your break is delayed ${delayMin} min (${s.delay_reason ?? 'operational pressure'}). ${stage === 2 ? 'Your queue priority was increased.' : 'You will be updated automatically.'}`,
        `تأجل بريكك ${delayMin} دقيقة (${s.delay_reason ?? 'ضغط تشغيلي'}). ${stage === 2 ? 'تم رفع أولويتك في الطابور.' : 'سيتم تحديثك تلقائياً.'}`);
    } else {
      const roles = stage === 3 ? ['rta', 'wfm_analyst'] : ['rta', 'wfm_analyst', 'wfm_supervisor', 'operations_manager'];
      await this.notifyRoles(tenantId, roles, type, s.id,
        stage === 3 ? 'Break delayed beyond threshold' : 'Break delay escalation',
        stage === 3 ? 'بريك متأخر عن الحد' : 'تصعيد تأخير بريك',
        `${s.employee_name} (${s.function_name}) break delayed ${delayMin} min — ${s.delay_reason ?? 'operational pressure'}.`,
        `بريك ${s.employee_name} (${s.function_name}) متأخر ${delayMin} دقيقة — ${s.delay_reason ?? 'ضغط تشغيلي'}.`);
      await this.notifyEmployee(tenantId, s.employee_id, `${type}.emp`, s.id,
        'Break delay escalated', 'تم تصعيد تأخير البريك',
        `Your break delay (${delayMin} min) was escalated to the supervisor.`,
        `تم تصعيد تأخير بريكك (${delayMin} دقيقة) إلى المشرف.`);
    }
    await this.policyService.audit(tenantId, null, 'breaks.delay.escalated', 'break_slot', s.id,
      `${s.employee_name} delay ${delayMin}min crossed stage ${stage}`);
  }

  private async alreadyNotified(tenantId: string, type: string, entityId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM notifications
       WHERE tenant_id = $1 AND notification_type = $2 AND entity_type = 'break_slot' AND entity_id = $3
       LIMIT 1`,
      [tenantId, type, entityId],
    ).catch(() => []);
    return rows.length > 0;
  }

  private async notifyEmployee(
    tenantId: string, employeeId: string, type: string, slotId: string,
    title: string, titleAr: string, body: string, bodyAr: string,
  ) {
    await this.dataSource.query(
      `INSERT INTO notifications
         (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
       SELECT $1, u.id, $2, $3, $4, $5, $6, 'break_slot', $7, '/breaks'
       FROM users u WHERE u.tenant_id = $1 AND u.employee_id = $8 AND u.status = 'active'`,
      [tenantId, type, title, titleAr, body, bodyAr, slotId, employeeId],
    ).catch((e) => this.logger.warn(`break notify (employee) failed: ${e.message}`));
  }

  private async notifyRoles(
    tenantId: string, roles: string[], type: string, slotId: string,
    title: string, titleAr: string, body: string, bodyAr: string,
  ) {
    await this.dataSource.query(
      `INSERT INTO notifications
         (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
       SELECT $1, u.id, $2, $3, $4, $5, $6, 'break_slot', $7, '/breaks'
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = $1 AND u.status = 'active' AND r.code = ANY($8)
         AND u.username <> 'wfm-bridge'`,
      [tenantId, type, title, titleAr, body, bodyAr, slotId, roles],
    ).catch((e) => this.logger.warn(`break notify (roles) failed: ${e.message}`));
  }
}
