import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BreakSchedulerService } from './break-scheduler.service';
import { riskAssess, RiskLevel } from './break-release.logic';
import {
  BreakSimScenario, normalizeScenario, queueSpikeInputs, projectDelayed, SimSlotWindow,
} from './break-simulation.logic';

/**
 * B5 — SIMULATION MODE (§28). Runs the SAME optimizer (BreakSchedulerService.
 * generateForDate) in dry-run with a what-if scenario applied, then scores the
 * resulting plan with the SAME risk engine (riskAssess) the live release loop
 * uses. WRITES NOTHING — there is no INSERT/UPDATE/DELETE anywhere in this
 * service, and the scheduler itself is a pure plan computation.
 */

const BUCKET_MS = 15 * 60_000;
const TZ = '+03:00';

interface IntervalRow { interval_start: string; function_name: string; required_hc: number; scheduled_hc: number }

@Injectable()
export class BreakSimulationService {
  private readonly logger = new Logger(BreakSimulationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduler: BreakSchedulerService,
  ) {}

  private ts(dateStr: string, time: string): Date {
    const t = String(time).slice(0, 8);
    return new Date(`${dateStr}T${t.length === 5 ? `${t}:00` : t}${TZ}`);
  }

  /** Resolve an optional function selector (uuid or name) to a function id. */
  private async resolveFunctionId(tenantId: string, fn?: string): Promise<string | undefined> {
    if (!fn) return undefined;
    const rows = await this.dataSource.query(
      `SELECT id FROM functions
       WHERE tenant_id = $1 AND (id::text = $2 OR canon_fn(name) = canon_fn($2))
       ORDER BY (canon_fn(name) = name) DESC LIMIT 1`,
      [tenantId, fn],
    );
    if (!rows.length) throw new BadRequestException(`Unknown function '${fn}'.`);
    return rows[0].id;
  }

  async simulate(tenantId: string, body: {
    date: string;
    function?: string;
    scenario?: BreakSimScenario;
  }) {
    const date = String(body?.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Body field "date" (YYYY-MM-DD) is required.');
    const scenario = normalizeScenario(body?.scenario);
    const functionId = await this.resolveFunctionId(tenantId, body?.function);

    // ── 1. DRY-RUN the real optimizer with the scenario applied ─────────────
    const plan = await this.scheduler.generateForDate(tenantId, date, functionId, scenario);

    // ── 2. Current persisted plan (for the comparison block) ────────────────
    const currentSlots: Array<{
      employee_id: string; planned_start: string; planned_end: string; planned_date: string;
      status: string; function_name: string; generated_by: string;
    }> = await this.dataSource.query(
      `SELECT bs.employee_id, bs.planned_start::text, bs.planned_end::text,
              COALESCE(bs.planned_date, bs.schedule_date)::text AS planned_date,
              bs.status, bs.generated_by,
              canon_fn(COALESCE(f.name,'—')) AS function_name
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE bs.tenant_id = $1 AND bs.schedule_date = $2::date
         AND bs.status NOT IN ('cancelled','missed')
         ${functionId ? 'AND e.function_id = $3' : ''}`,
      functionId ? [tenantId, date, functionId] : [tenantId, date],
    );

    // ── 3. Demand spine (canon-folded) + scenario adjustment ────────────────
    const intervals: IntervalRow[] = await this.dataSource.query(
      `SELECT hi.interval_start, canon_fn(COALESCE(f.name,'—')) AS function_name,
              SUM(hi.required_hc)::int AS required_hc, SUM(hi.scheduled_hc)::int AS scheduled_hc
       FROM headcount_intervals hi
       LEFT JOIN functions f ON f.id = hi.function_id
       WHERE hi.tenant_id = $1 AND hi.snapshot_date IN ($2::date, $2::date + 1)
       GROUP BY hi.interval_start, canon_fn(COALESCE(f.name,'—'))`,
      [tenantId, date],
    );
    // scheduledBefore per bucket|fn; scheduledAfter = − absent + extraStaff
    const before = new Map<string, { required: number; scheduled: number }>();
    for (const r of intervals) {
      before.set(`${Math.floor(new Date(r.interval_start).getTime() / BUCKET_MS)}|${r.function_name}`,
        { required: +r.required_hc, scheduled: +r.scheduled_hc });
    }
    const after = new Map<string, { required: number; scheduled: number }>();
    for (const [k, v] of before) after.set(k, { ...v });

    // absent employees leave the scheduled spine (same rule the scheduler applied)
    if (plan.simulation?.absentEmployees.length) {
      const ids = plan.simulation.absentEmployees.map(a => a.employee_id);
      const spans: Array<{ employee_id: string; function_name: string; shift_start: string; shift_end: string }> =
        await this.dataSource.query(
          `SELECT ar.employee_id, canon_fn(COALESCE(f.name,'—')) AS function_name,
                  (ar.attendance_date::text || ' ' || ar.scheduled_start::text || '+03')::timestamptz::text AS shift_start,
                  CASE WHEN ar.scheduled_end <= ar.scheduled_start
                    THEN ((ar.attendance_date + 1)::text || ' ' || ar.scheduled_end::text || '+03')::timestamptz::text
                    ELSE (ar.attendance_date::text || ' ' || ar.scheduled_end::text || '+03')::timestamptz::text
                  END AS shift_end
           FROM attendance_records ar
           JOIN employees e ON e.id = ar.employee_id
           LEFT JOIN functions f ON f.id = e.function_id
           WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date AND ar.employee_id = ANY($3)
             AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL`,
          [tenantId, date, ids],
        );
      for (const sp of spans) {
        const st = new Date(sp.shift_start).getTime(), en = new Date(sp.shift_end).getTime();
        for (let t = Math.floor(st / BUCKET_MS) * BUCKET_MS; t < en; t += BUCKET_MS) {
          const cell = after.get(`${Math.floor(t / BUCKET_MS)}|${sp.function_name}`);
          if (cell) cell.scheduled = Math.max(0, cell.scheduled - 1);
        }
      }
    }
    if (scenario.extraStaff > 0) for (const cell of after.values()) cell.scheduled += scenario.extraStaff;

    // ── 4. Simulated on-break occupancy per bucket|fn (planned slots + kept) ─
    const fnOfEmployee = new Map<string, string>();
    const empFns: Array<{ id: string; function_name: string }> = await this.dataSource.query(
      `SELECT e.id, canon_fn(COALESCE(f.name,'—')) AS function_name
       FROM employees e LEFT JOIN functions f ON f.id = e.function_id WHERE e.tenant_id = $1`,
      [tenantId],
    );
    for (const r of empFns) fnOfEmployee.set(r.id, r.function_name);

    const slotWindows: SimSlotWindow[] = [];
    const occupy = new Map<string, number>(); // bucketIdx|fn → on-break count
    const addWindow = (fn: string, plannedDate: string, start: string, end: string, collect: boolean) => {
      const st = this.ts(plannedDate, start);
      let en = this.ts(plannedDate, end);
      if (en <= st) en = new Date(en.getTime() + 86_400_000);
      for (let t = Math.floor(st.getTime() / BUCKET_MS) * BUCKET_MS; t < en.getTime(); t += BUCKET_MS) {
        const k = `${Math.floor(t / BUCKET_MS)}|${fn}`;
        occupy.set(k, (occupy.get(k) ?? 0) + 1);
      }
      if (collect) slotWindows.push({ functionName: fn, startMin: Math.floor(st.getTime() / 60_000), endMin: Math.ceil(en.getTime() / 60_000) });
      return { st, en };
    };
    // kept slots survive a regenerate → they exist in the simulated world too
    const kept = currentSlots.filter(s => !(s.status === 'scheduled' && s.generated_by === 'auto'));
    for (const s of kept) addWindow(s.function_name, s.planned_date, s.planned_start, s.planned_end, true);
    for (const s of plan.slots) {
      const fn = fnOfEmployee.get(s.employee_id) ?? '—';
      addWindow(fn, s.planned_date, s.planned_start, s.planned_end, true);
    }

    // ── 5. Risk timeline per function per hour (same riskAssess as the engine) ─
    const spike = queueSpikeInputs(scenario.queueSpike);
    const fnNames = new Set<string>();
    for (const k of after.keys()) fnNames.add(k.split('|')[1]);
    for (const w of slotWindows) fnNames.add(w.functionName);

    const dayStart = this.ts(date, '00:00');
    const riskByHour = new Map<string, RiskLevel>();   // epochHourMin|fn → level
    const riskTimeline: Record<string, Array<{ hour: number; level: RiskLevel; required: number; scheduled: number; onBreak: number }>> = {};
    for (const fn of fnNames) {
      riskTimeline[fn] = [];
      for (let h = 0; h < 24; h++) {
        const hourStart = dayStart.getTime() + h * 3600_000;
        let required = 0, scheduled = 0, onBreak = 0, cells = 0;
        for (let q = 0; q < 4; q++) {
          const idx = Math.floor((hourStart + q * BUCKET_MS) / BUCKET_MS);
          const cell = after.get(`${idx}|${fn}`);
          if (cell) { required = Math.max(required, cell.required); scheduled = Math.max(scheduled, cell.scheduled); cells++; }
          onBreak = Math.max(onBreak, occupy.get(`${idx}|${fn}`) ?? 0);
        }
        if (cells === 0 && onBreak === 0) continue; // hour with no demand data and no breaks
        const nb = after.get(`${Math.floor((hourStart + 3600_000) / BUCKET_MS)}|${fn}`);
        const risk = riskAssess({
          requiredNow: required,
          scheduledNow: scheduled,
          onBreakNow: onBreak,
          liveAvailableNow: null,
          queueWaiting: spike.queueWaiting,
          atRiskQueueCount: spike.atRiskQueueCount,
          forecastRequiredNext30: nb?.required ?? 0,
          forecastScheduledNext30: nb?.scheduled ?? scheduled,
          staleSec: spike.staleSec,   // 0 = fresh synthetic snapshot (no §30 distortion)
          thresholds: null,
        });
        riskByHour.set(`${Math.floor(hourStart / 60_000 / 60) * 60}|${fn}`, risk.level);
        riskTimeline[fn].push({ hour: h, level: risk.level, required, scheduled, onBreak });
      }
      if (!riskTimeline[fn].length) delete riskTimeline[fn];
    }

    // ── 6. Projected delayed slots (window lands in red/critical hour) ───────
    const delayed = projectDelayed(slotWindows, riskByHour);

    // ── 7. Employees at risk of missing entitlement (from optimizer warnings) ─
    const atRisk = Array.from(new Set(
      plan.warnings
        .filter(w => /no coverage-safe slot|can't fit|shift too short/.test(w))
        .map(w => w.split(':')[0].trim()),
    ));

    // ── 8. Histograms + coverage table (per hour, bounded payload) ───────────
    const histByHour = (slots: Array<{ planned_start: string }>) => {
      const h = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
      for (const s of slots) {
        const hh = parseInt(String(s.planned_start).slice(0, 2), 10);
        if (hh >= 0 && hh < 24) h[hh].count++;
      }
      return h;
    };
    const coverage: Array<{
      hour: number; function: string; required: number;
      scheduledBefore: number; scheduledAfter: number; onBreakSim: number; availableAfter: number;
    }> = [];
    for (const fn of fnNames) {
      for (let h = 0; h < 24; h++) {
        const idx = Math.floor((dayStart.getTime() + h * 3600_000) / BUCKET_MS);
        const b = before.get(`${idx}|${fn}`), a = after.get(`${idx}|${fn}`);
        const ob = occupy.get(`${idx}|${fn}`) ?? 0;
        if (!b && !a && !ob) continue;
        coverage.push({
          hour: h, function: fn, required: a?.required ?? b?.required ?? 0,
          scheduledBefore: b?.scheduled ?? 0, scheduledAfter: a?.scheduled ?? 0,
          onBreakSim: ob, availableAfter: (a?.scheduled ?? 0) - ob,
        });
      }
    }
    coverage.sort((x, y) => x.function.localeCompare(y.function) || x.hour - y.hour);

    const simByFn: Record<string, number> = {};
    for (const s of plan.slots) {
      const fn = fnOfEmployee.get(s.employee_id) ?? '—';
      simByFn[fn] = (simByFn[fn] ?? 0) + 1;
    }
    const curByFn: Record<string, number> = {};
    for (const s of currentSlots) curByFn[s.function_name] = (curByFn[s.function_name] ?? 0) + 1;

    return {
      simulation: true as const,
      applied: false as const,      // NOTHING was written — dry-run only
      date,
      function: body?.function ?? null,
      scenario: {
        absencePct: scenario.absencePct,
        queueSpike: scenario.queueSpike,
        extraStaff: scenario.extraStaff,
        mode: scenario.mode ?? null,
        policyOverrides: scenario.policyOverrides ?? null,
      },
      plan: {
        slotCount: plan.slots.length,
        employeesPlanned: new Set(plan.slots.map(s => s.employee_id)).size,
        onShiftAfterAbsence: plan.simulation?.onShiftCount ?? null,
        absentCount: plan.simulation?.absentEmployees.length ?? 0,
        absentEmployees: (plan.simulation?.absentEmployees ?? []).slice(0, 100),
        keptSlots: kept.length,
        coverageSource: plan.coverageSource,
        warnings: plan.warnings.slice(0, 100),
        slotsByHour: histByHour(plan.slots),
        slotsByFunction: simByFn,
      },
      riskTimeline,
      projectedDelayed: delayed.length,
      atRiskEmployees: atRisk,
      coverage,
      comparison: {
        current:   { slotCount: currentSlots.length, employees: new Set(currentSlots.map(s => s.employee_id)).size, slotsByHour: histByHour(currentSlots), slotsByFunction: curByFn },
        simulated: { slotCount: plan.slots.length + kept.length, employees: new Set([...plan.slots.map(s => s.employee_id), ...kept.map(s => s.employee_id)]).size, slotsByHour: histByHour([...plan.slots, ...kept]), slotsByFunction: simByFn },
        deltaSlots: plan.slots.length + kept.length - currentSlots.length,
      },
    };
  }
}
