import { BadRequestException, Body, Controller, Get, Post, Query, Req, Res, StreamableFile, UseGuards, UseInterceptors } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { MATERNITY_7H, TRUE_OT, CRED_LATE, CRED_EARLY } from '@common/wfm-metrics';
import { RosterTtlCacheInterceptor } from '@common/ttl-cache.interceptor';
import { covHourSql, covMinSql, covAbsSql, covHhSql, coversHourJs, STD_SHIFT_START_SQL, STD_SHIFT_END_SQL } from './coverage-core';

/* Hourly analytics + live-week forecast + gap-remedy/cross-skill/OT-request
 * endpoints, split VERBATIM out of the monolithic ReconController (2026-07-07,
 * EXECUTION_BRIEF Phase-4). Same route prefix — zero route renames. The
 * RosterTtlCacheInterceptor stays on hourly + week-forecast exactly as before. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class RosterHourlyController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  /** HOURLY analytics (0-23) per function over the canonical roster (roster_days):
   *  coverage (scheduled/working/%), permissions, shrinkage (count/%), tardiness count,
   *  and OT (before/after) per hour — with a TOTAL row. Cross-midnight aware. The
   *  professional hour-by-hour staffing + exception picture HR/RTA asks for. */
  @Get('roster-v2/hourly')
  @UseInterceptors(RosterTtlCacheInterceptor)   // 90s TTL — grid recompute was p95≈35s at 120 concurrent (2026-07-06)
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-hour (0-23) coverage / permissions / shrinkage / sick / absence / tardiness / OT — by function, or per AGENT (level=agent / agent=<id|name>)' })
  async hourly(
    @Req() req: any, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') functionName?: string, @Query('teamLeader') teamLeader?: string,
    @Query('agent') agent?: string, @Query('level') level?: string,
    @Query('format') format?: string, @Res({ passthrough: true }) res?: Response,
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo];
    let wBase = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    const add = (cond: string, val: any) => { p.push(val); return cond.replace('$$', `$${p.length}`); };
    if (functionName) wBase += ` AND ${add('canon_fn(COALESCE(role_function,function_name))=canon_fn($$)', functionName)}`;
    if (teamLeader)   wBase += ` AND ${add('team_manager=$$', teamLeader)}`;
    // AGENT-level mode (Director 2026-07-02): same hourly cascade but for one person —
    // agent = person_no or a name fragment; level=agent groups rows per agent name.
    if (agent) {
      p.push(agent, `%${agent.toLowerCase()}%`);
      wBase += ` AND (person_no = $${p.length - 1} OR employee_no = $${p.length - 1} OR lower(COALESCE(clean_name,name)) LIKE $${p.length} OR lower(COALESCE(username,'')) LIKE $${p.length})`;
    }
    const w = `${wBase} AND shift_start_min IS NOT NULL`;
    // Shrinkage rows in some months carry NO shift timing (June suffix rows) — derive the window
    // from the BASE code's canonical times (BR-SHF-005; a suffix keeps the base shift + timing),
    // so sick/absence still land in their real hours instead of vanishing from the grid.
    const stdStart = STD_SHIFT_START_SQL, stdEnd = STD_SHIFT_END_SQL;   // coverage-core (R2.1)
    const wR = `${wBase} AND (shift_start_min IS NOT NULL OR (presence IN ('sick','absent','leave') AND (${stdStart}) IS NOT NULL))`;
    const GRP = (level === 'agent' || agent)
      ? `COALESCE(clean_name,name) || ' · ' || COALESCE(person_no,employee_no)`
      : `canon_fn(COALESCE(role_function,function_name))`;

    // a person covers hour h (its [h*60,h*60+60) bucket) if the window [start,start+len)
    // — normalized to minute-of-day, cross-midnight & negative aware — overlaps it. One
    // helper for EVERY window: the shift, the OT-before/after extensions, and the
    // late-arrival / early-departure gaps. So the headcount truly reflects who is at seat.
    // Both kernels live in coverage-core (R2.1) — identical SQL text as before.
    const cov = covHourSql, covMin = covMinSql;
    // shift length must be WRAP-CORRECTED: cross-midnight shifts store shift_end_min < shift_start_min
    // (MD 1320→420), so a naive r.se-r.ss is NEGATIVE and cov() then covers NOTHING → evening/night
    // headcount was undercounted ~4-16% (bug found 2026-07-03). Normalize to the real duration.
    const SHIFT = cov('r.ss', '(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END)');
    const pres = `r.presence IN ('office','wfh')`;
    const credL = `r.sys_late_min BETWEEN 7 AND 240`;
    const credE = `r.sys_early_min BETWEEN 7 AND 240 AND COALESCE(r.person_no,r.employee_no) NOT IN ${MATERNITY_7H}`;
    const grid = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      r AS (SELECT ${GRP} fn, person_no, employee_no,
                   COALESCE(shift_start_min, ${stdStart}) ss,
                   COALESCE(shift_end_min,   ${stdEnd})   se,
                   presence, permission_type, sys_late_min, sys_early_min, ot_before_min, ot_after_min, adherence_pct
              FROM roster_days WHERE ${wR})
      SELECT r.fn, h.hh AS "hour",
        COUNT(*) FILTER (WHERE ${SHIFT})::int scheduled,
        COUNT(*) FILTER (WHERE ${SHIFT} AND ${pres})::int working,
        COUNT(*) FILTER (WHERE ${SHIFT} AND r.presence IN ('absent','sick','leave'))::int shrinkage,
        COUNT(*) FILTER (WHERE ${SHIFT} AND r.presence = 'sick')::int sick,
        COUNT(*) FILTER (WHERE ${SHIFT} AND r.presence = 'absent')::int absent,
        COUNT(*) FILTER (WHERE ${SHIFT} AND r.presence = 'leave')::int on_leave,
        COUNT(*) FILTER (WHERE ${SHIFT} AND r.permission_type IS NOT NULL)::int permission,
        ROUND(AVG(r.adherence_pct) FILTER (WHERE ${SHIFT} AND ${pres}),1) conformance,
        COUNT(*) FILTER (WHERE ${pres} AND ${credL} AND r.permission_type IS NULL AND ${cov('r.ss', 'r.sys_late_min')})::int tardiness,
        COUNT(*) FILTER (WHERE ${pres} AND ${credL} AND r.permission_type IS NOT NULL AND ${cov('r.ss', 'r.sys_late_min')})::int perm_late,
        COUNT(*) FILTER (WHERE ${pres} AND ${credE} AND r.permission_type IS NULL AND ${cov('r.se-r.sys_early_min', 'r.sys_early_min')})::int early_out,
        COUNT(*) FILTER (WHERE ${pres} AND ${credE} AND r.permission_type IS NOT NULL AND ${cov('r.se-r.sys_early_min', 'r.sys_early_min')})::int perm_early,
        COUNT(*) FILTER (WHERE ${pres} AND COALESCE(r.ot_before_min,0)>0 AND ${cov('r.ss-r.ot_before_min', 'r.ot_before_min')})::int ot_before_hc,
        COUNT(*) FILTER (WHERE ${pres} AND COALESCE(r.ot_after_min,0)>0 AND ${cov('r.se', 'r.ot_after_min')})::int ot_after_hc,
        COALESCE(SUM(${covMin('r.ss-r.ot_before_min', 'r.ot_before_min')}) FILTER (WHERE ${pres} AND COALESCE(r.ot_before_min,0)>0),0)::int ot_before_min,
        COALESCE(SUM(${covMin('r.se', 'r.ot_after_min')}) FILTER (WHERE ${pres} AND COALESCE(r.ot_after_min,0)>0),0)::int ot_after_min,
        COALESCE(SUM(${covMin('r.ss', 'r.sys_late_min')}) FILTER (WHERE ${pres} AND ${credL} AND r.permission_type IS NOT NULL),0)::int perm_late_min,
        COALESCE(SUM(${covMin('r.se-r.sys_early_min', 'r.sys_early_min')}) FILTER (WHERE ${pres} AND ${credE} AND r.permission_type IS NOT NULL),0)::int perm_early_min,
        COALESCE(SUM(${covMin('r.ss', 'r.sys_late_min')}) FILTER (WHERE ${pres} AND ${credL} AND r.permission_type IS NULL),0)::int tardy_min,
        COALESCE(SUM(${covMin('r.se-r.sys_early_min', 'r.sys_early_min')}) FILTER (WHERE ${pres} AND ${credE} AND r.permission_type IS NULL),0)::int early_min
      FROM r CROSS JOIN h
      GROUP BY r.fn, h.hh`, p);
    const [{ days }] = await this.ds.query(`SELECT COUNT(DISTINCT work_date)::int days FROM roster_days WHERE ${w} AND shift_start_min IS NOT NULL`, p);
    // OT hours (and %) per function — the "كم ساعة" summary; per-hour we show the headcount boost.
    // ob/oa = the within-shift before/after SPLIT (from the reconciliation engine; can be 0 in months
    //   whose rebuild hasn't run). reg/offd/hol = the REAL OT buckets that make up TRUE_OT (BR-OT-001)
    //   — summed over wBase (NO shift-timing filter) so OFF-day OT, which sits on OFF rows with no shift
    //   window, is not silently dropped. TRUE_OT hrs = (reg+offd+hol)/60 — the honest "كم ساعة OT".
    const otAgg = await this.ds.query(`SELECT ${GRP} fn,
        COALESCE(SUM(ot_before_min) FILTER (WHERE presence IN ('office','wfh') AND shift_start_min IS NOT NULL),0)::int ob,
        COALESCE(SUM(ot_after_min)  FILTER (WHERE presence IN ('office','wfh') AND shift_start_min IS NOT NULL),0)::int oa,
        COALESCE(SUM(ot_min),0)::int reg, COALESCE(SUM(offday_ot_min),0)::int offd, COALESCE(SUM(holiday_ot_min),0)::int hol
      FROM roster_days WHERE ${wBase} GROUP BY 1`, p);
    const otByFn: Record<string, { ob: number; oa: number; reg: number; offd: number; hol: number }> = {};
    let obAll = 0, oaAll = 0, regAll = 0, offdAll = 0, holAll = 0;
    for (const r of otAgg) { otByFn[r.fn || '—'] = { ob: r.ob, oa: r.oa, reg: r.reg, offd: r.offd, hol: r.hol }; obAll += r.ob; oaAll += r.oa; regAll += r.reg; offdAll += r.offd; holAll += r.hol; }
    // DAY-level shrinkage counts (no timing filter — leave/SL-only rows carry no shift window):
    // the honest totals; the per-hour columns show only what is hour-placeable.
    const shAgg = await this.ds.query(`SELECT ${GRP} fn,
        COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent,
        COUNT(*) FILTER (WHERE presence='leave')::int leave
      FROM roster_days WHERE ${wBase} AND presence IN ('sick','absent','leave') GROUP BY 1`, p);
    const shByFn: Record<string, { sick: number; absent: number; leave: number }> = {};
    const shAll = { sick: 0, absent: 0, leave: 0 };
    for (const r of shAgg) { shByFn[r.fn || '—'] = { sick: r.sick, absent: r.absent, leave: r.leave }; shAll.sick += r.sick; shAll.absent += r.absent; shAll.leave += r.leave; }
    // DAY-level CASE counts (distinct person-days) for the TOTAL row — the per-hour cells are
    // person-HOURS (a person counted once per hour their shift/gap covers), so summing them over 24
    // hours over-counts a case ~7x. HR reads these as "how many were tardy / on permission", so the
    // totals must be distinct person-day counts (audit 2026-07-03, finding #1). Per-hour cells untouched.
    const caseAgg = await this.ds.query(`SELECT ${GRP} fn,
        COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND permission_type IS NOT NULL)::int permission,
        COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND ${CRED_LATE} AND permission_type IS NULL)::int tardiness,
        COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND ${CRED_EARLY} AND permission_type IS NULL)::int early_out,
        COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND ${CRED_LATE} AND permission_type IS NOT NULL)::int perm_late,
        COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND ${CRED_EARLY} AND permission_type IS NOT NULL)::int perm_early
      FROM roster_days WHERE ${wBase} GROUP BY 1`, p);
    const caseByFn: Record<string, any> = {};
    const caseAll = { permission: 0, tardiness: 0, early_out: 0, perm_late: 0, perm_early: 0 };
    for (const r of caseAgg) { caseByFn[r.fn || '—'] = r; for (const k of Object.keys(caseAll)) caseAll[k] += r[k]; }

    // ── PLAN overlay (Director 2026-07-03): the hourly headcount the SCHEDULE will produce —
    //    latest non-archived version per (employee, date) from schedule_entries × shift_codes,
    //    minus APPROVED requests: leave spans (full day) and permission windows (per hour).
    //    Runs in parallel with the actuals so Generate + request approvals reflect immediately.
    const planGrid = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      v AS (SELECT DISTINCT ON (se.employee_id, se.entry_date)
                   se.employee_id, se.entry_date, e.employee_no, canon_fn(COALESCE(f.name,'—')) fn,
                   (EXTRACT(HOUR FROM sc.start_time)*60 + EXTRACT(MINUTE FROM sc.start_time))::int ss,
                   (CASE WHEN sc.end_time <= sc.start_time
                         THEN EXTRACT(HOUR FROM sc.end_time)*60 + EXTRACT(MINUTE FROM sc.end_time) + 1440
                         ELSE EXTRACT(HOUR FROM sc.end_time)*60 + EXTRACT(MINUTE FROM sc.end_time) END)::int se_min
              FROM schedule_entries se
              JOIN schedule_versions sv ON sv.id = se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published')
              JOIN employees e ON e.id = se.employee_id
              LEFT JOIN functions f ON f.id = e.function_id
              LEFT JOIN shift_codes sc ON sc.tenant_id = se.tenant_id AND sc.code = se.shift_code_display
             WHERE se.tenant_id = $1 AND se.entry_date BETWEEN $2 AND $3 AND sc.start_time IS NOT NULL
             ORDER BY se.employee_id, se.entry_date, sv.created_at DESC),
      lv AS (SELECT r.employee_id, gs::date d
               FROM requests r JOIN request_leaves rl ON rl.request_id = r.id
               CROSS JOIN generate_series(rl.start_date, rl.end_date, interval '1 day') gs
              WHERE r.tenant_id = $1 AND r.status = 'approved'),
      pm AS (SELECT r.employee_id, rp.permission_date d,
                    (EXTRACT(HOUR FROM rp.start_time)*60 + EXTRACT(MINUTE FROM rp.start_time))::int ps,
                    (EXTRACT(HOUR FROM rp.end_time)*60 + EXTRACT(MINUTE FROM rp.end_time))::int pe
               FROM requests r JOIN request_permissions rp ON rp.request_id = r.id
              WHERE r.tenant_id = $1 AND r.status = 'approved' AND rp.start_time IS NOT NULL AND rp.end_time IS NOT NULL)
      SELECT v.fn, h.hh AS "hour",
        COUNT(*) FILTER (WHERE v.ss < h.hh*60+60 AND LEAST(v.se_min,1440) > h.hh*60
                            OR (v.se_min > 1440 AND (v.se_min-1440) > h.hh*60))::int plan,
        COUNT(*) FILTER (WHERE (v.ss < h.hh*60+60 AND LEAST(v.se_min,1440) > h.hh*60
                            OR (v.se_min > 1440 AND (v.se_min-1440) > h.hh*60))
                           AND NOT EXISTS (SELECT 1 FROM lv WHERE lv.employee_id = v.employee_id AND lv.d = v.entry_date)
                           AND NOT EXISTS (SELECT 1 FROM pm WHERE pm.employee_id = v.employee_id AND pm.d = v.entry_date
                                             AND pm.ps < h.hh*60+60 AND pm.pe > h.hh*60))::int plan_after_req
      FROM v CROSS JOIN h GROUP BY v.fn, h.hh`, [t, dFrom, dTo]).catch(() => []);
    const [{ plan_days } = { plan_days: 0 }] = await this.ds.query(
      `SELECT COUNT(DISTINCT se.entry_date)::int plan_days
         FROM schedule_entries se JOIN schedule_versions sv ON sv.id = se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published')
        WHERE se.tenant_id = $1 AND se.entry_date BETWEEN $2 AND $3`, [t, dFrom, dTo]).catch(() => [{ plan_days: 0 }]);

    const FLD = ['scheduled', 'working', 'shrinkage', 'sick', 'absent', 'on_leave', 'permission', 'tardiness', 'perm_late', 'early_out', 'perm_early', 'ot_before_hc', 'ot_after_hc', 'ot_before_min', 'ot_after_min', 'perm_late_min', 'perm_early_min', 'tardy_min', 'early_min', 'plan', 'plan_after_req'];
    const blank = () => Array.from({ length: 24 }, (_, hour) => { const o: any = { hour, _cs: 0, _cw: 0 }; FLD.forEach(f => o[f] = 0); return o; });
    const fnMap: Record<string, any[]> = {}; const all = blank();
    for (const g of grid) {
      const fn = g.fn || '—'; if (!fnMap[fn]) fnMap[fn] = blank();
      const c = fnMap[fn][g.hour], a = all[g.hour];
      for (const f of FLD) { c[f] += g[f] || 0; a[f] += g[f] || 0; }
      if (g.conformance != null) { const wgt = g.working || 1; c._cs += g.conformance * wgt; c._cw += wgt; a._cs += g.conformance * wgt; a._cw += wgt; }
    }
    // fold the plan overlay in (function labels come from employees.function — may differ from the
    // roster's per-month role_function; the ALL row is always exact). Skipped in agent mode.
    // When the caller filtered to one function, restrict the plan to it too (the plan CTE groups
    // every function, so without this the ALL/plan totals would leak other functions' plan HC).
    const fnCanon = functionName ? functionName.replace(/^\s*[Ii]nternship\s+/, '') : null;
    if (!agent && level !== 'agent') for (const g of planGrid) {
      const fn = g.fn || '—'; if (fnCanon && fn !== fnCanon) continue;
      if (!fnMap[fn]) fnMap[fn] = blank();
      fnMap[fn][g.hour].plan += g.plan; fnMap[fn][g.hour].plan_after_req += g.plan_after_req;
      all[g.hour].plan += g.plan; all[g.hour].plan_after_req += g.plan_after_req;
    }
    const enrich = (hours: any[], ot: { ob: number; oa: number; reg?: number; offd?: number; hol?: number }, shDay?: { sick: number; absent: number; leave: number }, cases?: { permission: number; tardiness: number; early_out: number; perm_late: number; perm_early: number }) => {
      const av = (n: number) => days ? +(n / days).toFixed(1) : 0;
      const rows = hours.map(h => {
        // running cascade: base working → after OT (boosted) → after permission → effective
        const hcWithOt = h.working + h.ot_before_hc + h.ot_after_hc;     // ← headcount AFTER overtime
        const hcAfterPerm = hcWithOt - h.perm_late - h.perm_early;        // ← headcount AFTER permissions
        const effective = Math.max(0, hcAfterPerm - h.tardiness - h.early_out);
        // LOST hours in this hour = full shrinkage hours (scheduled-but-out people) +
        // credited tardiness/early minutes + permission-covered minutes (Director 2026-07-03)
        const lostHours = +(h.shrinkage + (h.tardy_min + h.early_min + h.perm_late_min + h.perm_early_min) / 60).toFixed(1);
        return {
          hour: h.hour, scheduled: h.scheduled, working: h.working,
          hcWithOt, hcAfterPerm, effective, lostHours,
          plan: h.plan, planAfterReq: h.plan_after_req,
          avgPlan: plan_days ? +(h.plan / plan_days).toFixed(1) : 0,
          avgPlanAfterReq: plan_days ? +(h.plan_after_req / plan_days).toFixed(1) : 0,
          shrinkage: h.shrinkage, sick: h.sick, absent: h.absent, onLeave: h.on_leave, permission: h.permission,
          tardiness: h.tardiness, permLate: h.perm_late, earlyOut: h.early_out, permEarly: h.perm_early,
          otBeforeHc: h.ot_before_hc, otAfterHc: h.ot_after_hc,
          otHours: +((h.ot_before_min + h.ot_after_min) / 60).toFixed(1),     // OT hours actually worked in this hour
          permHours: +((h.perm_late_min + h.perm_early_min) / 60).toFixed(1), // permission hours lost in this hour
          // ── DURATION dimension (Director 2026-07-03: "كل شي يكون اله ساعات أو دقايق") ──
          workedHrs: h.working,                                               // person-hours on seat this hour (each on-seat person = 1 person-hour)
          otBeforeHrs: +(h.ot_before_min / 60).toFixed(1), otAfterHrs: +(h.ot_after_min / 60).toFixed(1),
          otBeforeMin: h.ot_before_min, otAfterMin: h.ot_after_min,
          tardyMin: h.tardy_min, earlyMin: h.early_min,
          tardyHrs: +(h.tardy_min / 60).toFixed(1), earlyHrs: +(h.early_min / 60).toFixed(1),
          permLateMin: h.perm_late_min, permEarlyMin: h.perm_early_min,
          permLateHrs: +(h.perm_late_min / 60).toFixed(1), permEarlyHrs: +(h.perm_early_min / 60).toFixed(1),
          conformance: h._cw ? Math.round(h._cs / h._cw) : null,
          avgScheduled: av(h.scheduled), avgWorking: av(h.working),
          avgHcWithOt: av(hcWithOt), avgHcAfterPerm: av(hcAfterPerm), avgEffective: av(effective),
          // per-day AVG of the cascade DELTAS (finding #4) — so a row's +OT/−perm/−tardy are on the
          // SAME per-day scale as the avg checkpoints (avgWorking + avgOtBefore + ... = avgEffective).
          avgOtBeforeHc: av(h.ot_before_hc), avgOtAfterHc: av(h.ot_after_hc),
          avgPermLate: av(h.perm_late), avgPermEarly: av(h.perm_early),
          avgTardiness: av(h.tardiness), avgEarlyOut: av(h.early_out),
          avgSick: av(h.sick), avgAbsent: av(h.absent), avgOnLeave: av(h.on_leave),
          coveragePct: h.scheduled ? Math.round(100 * effective / h.scheduled) : 0,
          shrinkagePct: h.scheduled ? Math.round(100 * h.shrinkage / h.scheduled) : 0,
        };
      });
      const sum = (k: string) => rows.reduce((s, r: any) => s + (r[k] || 0), 0);
      const tSched = sum('scheduled'), tEff = sum('effective'), tShr = sum('shrinkage');
      const cw = hours.reduce((s, h) => s + h._cw, 0), csum = hours.reduce((s, h) => s + h._cs, 0);
      const otTot = ot.ob + ot.oa;
      const total = {
        scheduled: tSched, working: sum('working'), hcWithOt: sum('hcWithOt'), hcAfterPerm: sum('hcAfterPerm'), effective: tEff,
        lostHours: +sum('lostHours').toFixed(1),
        plan: sum('plan'), planAfterReq: sum('planAfterReq'), planDays: plan_days,
        // totals are DISTINCT PERSON-DAY counts (finding #1) — NOT the per-hour sums, which are
        // person-hours and over-count a case ~7x. Fall back to the hour-sum only if the day-agg is absent.
        sick: shDay?.sick ?? sum('sick'), absent: shDay?.absent ?? sum('absent'), onLeave: shDay?.leave ?? sum('onLeave'),
        shrinkDays: shDay ? shDay.sick + shDay.absent + shDay.leave : null,
        // shrinkage TOTAL = distinct sick+absent+leave person-days (reconciles with the breakdown);
        // shrinkagePct still uses the person-hours ratio below (tShr/tSched) so % stays interval-based.
        shrinkage: shDay ? shDay.sick + shDay.absent + shDay.leave : tShr,
        permission: cases?.permission ?? sum('permission'),
        tardiness: cases?.tardiness ?? sum('tardiness'), permLate: cases?.perm_late ?? sum('permLate'),
        earlyOut: cases?.early_out ?? sum('earlyOut'), permEarly: cases?.perm_early ?? sum('permEarly'),
        otBeforeHc: sum('otBeforeHc'), otAfterHc: sum('otAfterHc'),
        otHours: +sum('otHours').toFixed(1), permHours: +sum('permHours').toFixed(1),
        coveragePct: tSched ? Math.round(100 * tEff / tSched) : 0, shrinkagePct: tSched ? Math.round(100 * tShr / tSched) : 0,
        conformance: cw ? Math.round(csum / cw) : null,
        otBeforeHours: +(ot.ob / 60).toFixed(1), otAfterHours: +(ot.oa / 60).toFixed(1),
        otBeforePct: otTot ? Math.round(100 * ot.ob / otTot) : 0, otAfterPct: otTot ? Math.round(100 * ot.oa / otTot) : 0,
        // ── DURATION totals: person-hours on seat + OT/tardy/early/permission in hrs & mins ──
        workedHrs: sum('working'),                                            // total person-hours on seat
        otBeforeHrs: +(ot.ob / 60).toFixed(1), otAfterHrs: +(ot.oa / 60).toFixed(1), otHrs: +((ot.ob + ot.oa) / 60).toFixed(1),
        otBeforeMin: ot.ob, otAfterMin: ot.oa,
        // TRUE_OT (BR-OT-001) — the REAL total OT: regular + OFF-day + holiday. This is the honest
        // "كم ساعة OT" (the before/after split above can read 0 in a not-yet-rebuilt month).
        otRegHrs: +((ot.reg || 0) / 60).toFixed(1), otOffdayHrs: +((ot.offd || 0) / 60).toFixed(1),
        otHolidayHrs: +((ot.hol || 0) / 60).toFixed(1),
        otTrueHrs: +(((ot.reg || 0) + (ot.offd || 0) + (ot.hol || 0)) / 60).toFixed(1),
        tardyMin: sum('tardyMin'), earlyMin: sum('earlyMin'),
        tardyHrs: +(sum('tardyMin') / 60).toFixed(1), earlyHrs: +(sum('earlyMin') / 60).toFixed(1),
        permLateMin: sum('permLateMin'), permEarlyMin: sum('permEarlyMin'),
        permLateHrs: +(sum('permLateMin') / 60).toFixed(1), permEarlyHrs: +(sum('permEarlyMin') / 60).toFixed(1),
      };
      const peak = rows.reduce((mx, r) => r.effective > mx.effective ? r : mx, rows[0]);
      return { hours: rows, total, peakHour: peak?.hour };
    };

    const byFunction = Object.entries(fnMap).map(([fn, hours]) => ({ fn, ...enrich(hours, otByFn[fn] || { ob: 0, oa: 0, reg: 0, offd: 0, hol: 0 }, shByFn[fn], caseByFn[fn]) }))
      .sort((a, b) => b.total.scheduled - a.total.scheduled);
    const payload = { from: dFrom, to: dTo, days, functions: byFunction.map(f => f.fn), byFunction, all: enrich(all, { ob: obAll, oa: oaAll, reg: regAll, offd: offdAll, hol: holAll }, shAll, caseAll) };

    // Excel export (Director 2026-07-03): one sheet per view (All + each function),
    // 24 hourly rows + TOTAL, same columns as the on-screen table.
    if (format === 'xlsx' && res) {
      const wb = new ExcelJS.Workbook();
      // headcount cascade + KPIs, then the DURATION block (hours/minutes) the Director asked for.
      const HD = ['Hour', 'Scheduled', 'Working', '+OT before', '+OT after', '= After OT', '−Perm late', '−Perm early', '= After perm', '−Tardy', '−Early', '= Effective', 'Sick', 'Absent', 'Leave', 'Shrinkage', 'Shrink %', 'Lost hrs', 'Plan HC', 'Plan −req', 'Coverage %', 'Conformance %',
        'Working hrs', 'OT before hrs', 'OT after hrs', 'Total OT hrs', 'Tardy min', 'Early min', 'Perm late min', 'Perm early min'];
      const rowOf = (h: any) => [
        `${String(h.hour).padStart(2, '0')}:00`, h.avgScheduled, h.avgWorking, h.otBeforeHc, h.otAfterHc, h.avgHcWithOt,
        h.permLate, h.permEarly, h.avgHcAfterPerm, h.tardiness, h.earlyOut, h.avgEffective,
        h.sick, h.absent, h.onLeave, h.shrinkage, h.shrinkagePct, h.lostHours, h.avgPlan, h.avgPlanAfterReq,
        h.coveragePct, h.conformance ?? '',
        h.workedHrs, h.otBeforeHrs, h.otAfterHrs, h.otHours, h.tardyMin, h.earlyMin, h.permLateMin, h.permEarlyMin];
      const totOf = (tt: any) => ['TOTAL', tt.scheduled, tt.working, tt.otBeforeHc, tt.otAfterHc, tt.hcWithOt,
        tt.permLate, tt.permEarly, tt.hcAfterPerm, tt.tardiness, tt.earlyOut, tt.effective,
        tt.sick ?? '', tt.absent ?? '', tt.onLeave ?? '', tt.shrinkage, tt.shrinkagePct, tt.lostHours ?? '', tt.plan ?? '', tt.planAfterReq ?? '',
        tt.coveragePct, tt.conformance ?? '',
        tt.workedHrs, tt.otBeforeHrs, tt.otAfterHrs, tt.otHrs, tt.tardyMin, tt.earlyMin, tt.permLateMin, tt.permEarlyMin];
      const addSheet = (name: string, view: any) => {
        const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/*?:[\]]/g, '·'));
        ws.addRow([`Hourly Analytics — ${name} — ${dFrom} → ${dTo} (${days} days)`]).font = { bold: true };
        ws.addRow(HD).font = { bold: true };
        ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
        ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        view.hours.forEach((h: any) => ws.addRow(rowOf(h)));
        const tr = ws.addRow(totOf(view.total)); tr.font = { bold: true };
        ws.columns.forEach(c => { c.width = 12; });
        ws.views = [{ state: 'frozen', ySplit: 2 }];
      };
      addSheet('All', payload.all);
      for (const f of byFunction) addSheet(f.fn || '—', f);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="hourly-analytics_${dFrom}_${dTo}.xlsx"`);
      return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    return payload;
  }

  /* ── LIVE WEEK FORECAST (Director 2026-07-03) ──────────────────────────────────────
   *  "أشوف الهيدكاونت بالساعة كم رح يكون — سويت جينيريت، والأيام تتعبى فعلي أول بأول من
   *   الريكويستات والسيك والأوفرتايم والتأخيرات." One 7-day × 24-hour headcount grid where
   *   each cell BLENDS reality with plan:
   *     • a day that has reconciled roster_days rows (past / today-so-far) → the ACTUAL
   *       effective HC (working + OT − tardy/early − perm-late/early) — the SAME cascade as
   *       /roster-v2/hourly, grouped by day.
   *     • a day with no actuals yet (future) → the PLANNED HC from the latest non-archived
   *       schedule version (schedule_entries × shift_codes), then − approved leave (full day)
   *       − approved permission (window) + approved overtime (window) = plan-after-requests.
   *   As reconciliation/requests land, past hours fill with truth and the future re-projects.
   *   Default week = the "seam" (Saturday on/before the actual frontier) so the blend shows. */
  @Get('roster-v2/week-forecast')
  @UseInterceptors(RosterTtlCacheInterceptor)
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Live 7×24 headcount forecast — actual (past) blended with plan−requests (future), per hour per day' })
  async weekForecast(@Req() req: any, @Query('weekStart') weekStart?: string, @Query('function') functionName?: string) {
    const t = req.user.tenantId;
    // actual frontier = last reconciled day; default the week to the Saturday on/before it (the seam).
    const [{ frontier }] = await this.ds.query(`SELECT MAX(work_date)::text frontier FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]);
    const snapSat = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); };
    const ws = snapSat(weekStart || frontier || new Date().toISOString().slice(0, 10));
    const dates: string[] = []; { const d = new Date(ws + 'T00:00:00Z'); for (let i = 0; i < 7; i++) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }
    const weekEnd = dates[6];
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const fp: any[] = [t, ws, weekEnd];
    let fnFilter = '';
    if (functionName) { fp.push(functionName); fnFilter = ` AND canon_fn(COALESCE(role_function,function_name))=canon_fn($${fp.length})`; }
    let fnFilterPlan = '';
    let otFnJoin = '', otFnWhere = '';
    if (functionName) {
      // fold interns into the parent on BOTH keys (actuals=role_function, plan=employees.function_id) so
      // the parent/intern label split can't invent a phantom plan-vs-actual gap (Director headcount rule).
      fnFilterPlan = ` AND canon_fn(COALESCE(f.name,'—'))=canon_fn($4)`;   // same param slot ($4)
      // finding #6/#8: a function-scoped forecast must NOT add company-wide approved OT — scope the
      // ot CTE to the same function via request_overtimes.function_id.
      otFnJoin = ` LEFT JOIN functions fo ON fo.id = ro.function_id`;
      otFnWhere = ` AND canon_fn(fo.name) = canon_fn($4)`;
    }

    const cov = covHourSql;   // coverage-core (R2.1); unused covWin helper removed
    const pres = `r.presence IN ('office','wfh')`;
    const credL = `r.sys_late_min BETWEEN 7 AND 240`;
    const credE = `r.sys_early_min BETWEEN 7 AND 240 AND COALESCE(r.person_no,r.employee_no) NOT IN ${MATERNITY_7H}`;

    // ── ACTUAL: effective HC per (day, hour) from roster_days, placed on the ABSOLUTE calendar ──
    // A cross-midnight shift (MD 22:00→07:00) physically covers 00:00-07:00 of the NEXT calendar
    // day; the per-day grid must place that tail on the next day, not the shift's start day
    // (audit 2026-07-03 finding #2). We work in minutes-from-week-start: each measure's window
    // [absStart, absStart+len) is matched against the 7×24 buckets and attributed to the bucket's
    // (day-offset bi, hour), so wrap tails land on the correct calendar day. se_c = canonical end
    // (raw wall-clock end <= start ⇒ +1440), handling both stored conventions.
    const covAbs = covAbsSql;   // coverage-core (R2.1)
    const actual = await this.ds.query(`
      WITH b AS (SELECT bi, hh FROM generate_series(0,6) bi CROSS JOIN generate_series(0,23) hh),
      r AS (SELECT (work_date - $2::date) AS di, person_no, employee_no, shift_start_min ss,
                   (CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440 ELSE shift_end_min END) se_c,
                   presence, permission_type, sys_late_min, sys_early_min, ot_before_min, ot_after_min
              FROM roster_days
             WHERE tenant_id=$1 AND is_active AND work_date BETWEEN ($2::date - 1) AND $3 AND shift_start_min IS NOT NULL${fnFilter})
      SELECT b.bi, b.hh AS "hour",
        COUNT(*) FILTER (WHERE ${pres} AND ${covAbs('r.di*1440 + r.ss', 'r.se_c - r.ss')})::int working,
        COUNT(*) FILTER (WHERE ${pres} AND COALESCE(r.ot_before_min,0)>0 AND ${covAbs('r.di*1440 + r.ss - r.ot_before_min', 'r.ot_before_min')})::int ot_before,
        COUNT(*) FILTER (WHERE ${pres} AND COALESCE(r.ot_after_min,0)>0 AND ${covAbs('r.di*1440 + r.se_c', 'r.ot_after_min')})::int ot_after,
        COUNT(*) FILTER (WHERE ${pres} AND ${credL} AND r.permission_type IS NULL AND ${covAbs('r.di*1440 + r.ss', 'r.sys_late_min')})::int tardy,
        COUNT(*) FILTER (WHERE ${pres} AND ${credE} AND r.permission_type IS NULL AND ${covAbs('r.di*1440 + r.se_c - r.sys_early_min', 'r.sys_early_min')})::int early,
        COUNT(*) FILTER (WHERE ${pres} AND ${credL} AND r.permission_type IS NOT NULL AND ${covAbs('r.di*1440 + r.ss', 'r.sys_late_min')})::int perm_late,
        COUNT(*) FILTER (WHERE ${pres} AND ${credE} AND r.permission_type IS NOT NULL AND ${covAbs('r.di*1440 + r.se_c - r.sys_early_min', 'r.sys_early_min')})::int perm_early
      FROM r CROSS JOIN b GROUP BY b.bi, b.hh`, fp).catch(() => []);

    // ── PLAN: planned HC per (day, hour) from the latest non-archived version, ± approved requests.
    //    Same ABSOLUTE-calendar placement as the actual side (finding #2): a plan MD shift's tail
    //    lands on the next calendar day. Leave is keyed to the scheduling day (entry_date); permission
    //    & OT are keyed to the BUCKET's calendar day (ws + bi) so both in-day and wrap are correct. ──
    const plan = await this.ds.query(`
      WITH b AS (SELECT bi, hh FROM generate_series(0,6) bi CROSS JOIN generate_series(0,23) hh),
      v AS (SELECT DISTINCT ON (se.employee_id, se.entry_date)
                   se.employee_id, se.entry_date::text d, (se.entry_date - $2::date) AS di,
                   (EXTRACT(HOUR FROM sc.start_time)*60 + EXTRACT(MINUTE FROM sc.start_time))::int ss,
                   (CASE WHEN sc.end_time <= sc.start_time
                         THEN EXTRACT(HOUR FROM sc.end_time)*60 + EXTRACT(MINUTE FROM sc.end_time) + 1440
                         ELSE EXTRACT(HOUR FROM sc.end_time)*60 + EXTRACT(MINUTE FROM sc.end_time) END)::int se_min
              FROM schedule_entries se
              JOIN schedule_versions sv ON sv.id = se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published')
              JOIN employees e ON e.id = se.employee_id
              LEFT JOIN functions f ON f.id = e.function_id
              LEFT JOIN shift_codes sc ON sc.tenant_id = se.tenant_id AND sc.code = se.shift_code_display
             WHERE se.tenant_id=$1 AND se.entry_date BETWEEN ($2::date - 1) AND $3 AND sc.start_time IS NOT NULL${fnFilterPlan}
             ORDER BY se.employee_id, se.entry_date, sv.created_at DESC),
      lv AS (SELECT r.employee_id, gs::date::text d FROM requests r JOIN request_leaves rl ON rl.request_id=r.id
               CROSS JOIN generate_series(rl.start_date, rl.end_date, interval '1 day') gs
              WHERE r.tenant_id=$1 AND r.status='approved'),
      pm AS (SELECT r.employee_id, rp.permission_date::text d,
                    (EXTRACT(HOUR FROM rp.start_time)*60+EXTRACT(MINUTE FROM rp.start_time))::int ps,
                    (EXTRACT(HOUR FROM rp.end_time)*60+EXTRACT(MINUTE FROM rp.end_time))::int pe
               FROM requests r JOIN request_permissions rp ON rp.request_id=r.id
              WHERE r.tenant_id=$1 AND r.status='approved' AND rp.start_time IS NOT NULL AND rp.end_time IS NOT NULL),
      ot AS (SELECT r.employee_id, ro.ot_date::text d,
                    (EXTRACT(HOUR FROM ro.start_time)*60+EXTRACT(MINUTE FROM ro.start_time))::int os,
                    (EXTRACT(HOUR FROM ro.end_time)*60+EXTRACT(MINUTE FROM ro.end_time))::int oe
               FROM requests r JOIN request_overtimes ro ON ro.request_id=r.id${otFnJoin}
              WHERE r.tenant_id=$1 AND r.status='approved' AND ro.start_time IS NOT NULL AND ro.end_time IS NOT NULL${otFnWhere})
      SELECT b.bi, b.hh AS "hour",
        COUNT(*) FILTER (WHERE ${covAbs('v.di*1440 + v.ss', 'v.se_min - v.ss')})::int plan,
        COUNT(*) FILTER (WHERE ${covAbs('v.di*1440 + v.ss', 'v.se_min - v.ss')}
                           AND NOT EXISTS (SELECT 1 FROM lv WHERE lv.employee_id=v.employee_id AND lv.d=v.d)
                           AND NOT EXISTS (SELECT 1 FROM pm WHERE pm.employee_id=v.employee_id AND pm.d=($2::date + b.bi)::text AND pm.ps<b.hh*60+60 AND pm.pe>b.hh*60))::int plan_after_req,
        (SELECT COUNT(*) FROM ot WHERE ot.d=($2::date + b.bi)::text AND ot.os<b.hh*60+60 AND ot.oe>b.hh*60)::int ot_extra
      FROM v CROSS JOIN b GROUP BY b.bi, b.hh`, fp).catch(() => []);

    // ── BASELINE: observed avg scheduled HC per hour over the 28 days before the week ──
    // (own param list — must reference EXACTLY the params passed; Postgres rejects extras.)
    const bp: any[] = [t, ws];
    const fnFilterBase = functionName ? (bp.push(functionName), ` AND canon_fn(COALESCE(role_function,function_name))=canon_fn($${bp.length})`) : '';
    const baseRows = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      r AS (SELECT shift_start_min ss, shift_end_min se FROM roster_days
             WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
               AND work_date >= ($2::date - interval '28 days') AND work_date < $2::date${fnFilterBase}),
      d AS (SELECT COUNT(DISTINCT work_date)::int n FROM roster_days
             WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
               AND work_date >= ($2::date - interval '28 days') AND work_date < $2::date)
      SELECT h.hh AS "hour",
        (COUNT(*) FILTER (WHERE ${cov('r.ss', '(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END)')})::float / NULLIF((SELECT n FROM d),0)) baseline
      FROM r CROSS JOIN h GROUP BY h.hh`, bp).catch(() => []);
    const baseline = Array(24).fill(0);
    for (const b of baseRows) baseline[b.hour] = +(+b.baseline || 0).toFixed(1);

    // ── merge into a 7×24 blended grid — actual/plan rows are keyed by day-OFFSET (bi 0-6),
    //    already placed on the correct calendar day (cross-midnight tails moved to the next day). ──
    const aMap: Record<string, any> = {}; for (const r of actual) aMap[`${r.bi}|${r.hour}`] = r;
    const pMap: Record<string, any> = {}; for (const r of plan) pMap[`${r.bi}|${r.hour}`] = r;
    const days = dates.map((d, di) => {
      const dow = DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
      const mode = (frontier && d <= frontier) ? 'actual' : 'plan';
      const hours = Array.from({ length: 24 }, (_, hh) => {
        const a = aMap[`${di}|${hh}`], p = pMap[`${di}|${hh}`];
        const effective = a ? Math.max(0, a.working + a.ot_before + a.ot_after - a.tardy - a.early - a.perm_late - a.perm_early) : 0;
        const planHc = p ? p.plan : 0;
        const planAfterReq = p ? Math.max(0, p.plan_after_req + p.ot_extra) : 0;
        const hc = mode === 'actual' ? effective : planAfterReq;
        const req = baseline[hh];
        return {
          hour: hh, mode, hc,
          actual: a ? effective : null,
          plan: planHc, planAfterReq,
          required: req,
          gap: +(hc - req).toFixed(1),
          coveragePct: req > 0 ? Math.round(100 * hc / req) : null,
          detail: a ? { working: a.working, otBefore: a.ot_before, otAfter: a.ot_after, tardy: a.tardy, early: a.early, permLate: a.perm_late, permEarly: a.perm_early }
                    : p ? { plan: p.plan, minusReq: p.plan - p.plan_after_req, plusOt: p.ot_extra } : null,
        };
      });
      const dayHc = hours.reduce((s, x) => s + x.hc, 0);
      const dayReq = hours.reduce((s, x) => s + x.required, 0);
      const peak = hours.reduce((mx, x) => x.hc > mx.hc ? x : mx, hours[0]);
      return { date: d, dayName: dow, mode, hours, totalHc: dayHc, totalRequired: +dayReq.toFixed(1),
        coveragePct: dayReq > 0 ? Math.round(100 * dayHc / dayReq) : null, peakHour: peak.hour, peakHc: peak.hc,
        gapHours: hours.filter(x => x.required >= 1 && x.gap < 0).length };
    });

    // ── week rollups + realization (how much of the week is already reality) ──
    const actualCount = days.filter(d => d.mode === 'actual').length;
    const byHour = Array.from({ length: 24 }, (_, hh) => {
      const cells = days.map(d => d.hours[hh]);
      const hc = cells.reduce((s, c) => s + c.hc, 0);
      const req = cells.reduce((s, c) => s + c.required, 0);
      return { hour: hh, hc, required: +req.toFixed(1), avgHc: +(hc / 7).toFixed(1), gap: +(hc - req).toFixed(1),
        coveragePct: req > 0 ? Math.round(100 * hc / req) : null };
    });
    const weekHc = days.reduce((s, d) => s + d.totalHc, 0);
    const weekReq = days.reduce((s, d) => s + d.totalRequired, 0);
    const actualHc = days.filter(d => d.mode === 'actual').reduce((s, d) => s + d.totalHc, 0);
    const planHcTotal = days.filter(d => d.mode === 'plan').reduce((s, d) => s + d.totalHc, 0);
    // lost & OT lift across the plan side (approved requests already applied) + the actual side
    let lostReq = 0, otLift = 0;
    for (const d of days) for (const x of d.hours) {
      if (x.detail) {
        if (x.mode === 'actual') { lostReq += (x.detail.tardy || 0) + (x.detail.early || 0) + (x.detail.permLate || 0) + (x.detail.permEarly || 0); otLift += (x.detail.otBefore || 0) + (x.detail.otAfter || 0); }
        else { lostReq += (x.detail.minusReq || 0); otLift += (x.detail.plusOt || 0); }
      }
    }
    return {
      weekStart: ws, weekEnd, frontier, function: functionName || null,
      days, byHour, baseline,
      summary: {
        weekHc, weekRequired: +weekReq.toFixed(1),
        coveragePct: weekReq > 0 ? Math.round(100 * weekHc / weekReq) : null,
        actualDays: actualCount, planDays: 7 - actualCount,
        realizationPct: Math.round(100 * actualCount / 7),   // fraction of the week that is already reality
        actualHc, planHc: planHcTotal,
        gapHours: days.reduce((s, d) => s + d.gapHours, 0),
        lostHc: lostReq, otLiftHc: otLift,
        peakDay: days.reduce((mx, d) => d.totalHc > mx.totalHc ? d : mx, days[0])?.date,
      },
    };
  }

  /* ── GAP REMEDIES (Director 2026-07-03) — for every under-covered hour, recommend the fix ──
   *  Vision (CLAUDE.md §11): never hide a gap — show it with the reason + a suggested solution.
   *  Per (function, hour) over the week: SUPPLY = avg/day planned HC (schedule_entries), REQUIRED =
   *  28-day observed baseline. A gap → ranked remedies: ① cross-skill from a SURPLUS function that
   *  hour, ② overtime (extend adjacent shifts), ③ shift-mix add, ④ exception/hire; plus a
   *  permission-block advisory window (don't approve permissions here — coverage is short). */
  @Get('roster-v2/gap-remedies')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-under-covered-hour remedies: cross-skill / overtime / shift-mix / exception + permission-block windows' })
  async gapRemedies(@Req() req: any, @Query('weekStart') weekStart?: string, @Query('function') functionName?: string) {
    const t = req.user.tenantId;
    const [{ frontier }] = await this.ds.query(`SELECT MAX(work_date)::text frontier FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]);
    const snapSat = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); };
    const ws = snapSat(weekStart || frontier || new Date().toISOString().slice(0, 10));
    const we = new Date(ws + 'T00:00:00Z'); we.setUTCDate(we.getUTCDate() + 6); const weekEnd = we.toISOString().slice(0, 10);
    const covHh = covHhSql;   // wrap-corrected hour-of-day coverage — coverage-core (R2.1)
    const SEC = '(CASE WHEN sc.end_time<=sc.start_time THEN EXTRACT(HOUR FROM sc.end_time)*60+EXTRACT(MINUTE FROM sc.end_time)+1440 ELSE EXTRACT(HOUR FROM sc.end_time)*60+EXTRACT(MINUTE FROM sc.end_time) END)';
    // SUPPLY: avg/day planned HC per (function, hour) from the latest non-archived schedule
    const planRows = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      v AS (SELECT DISTINCT ON (se.employee_id, se.entry_date) canon_fn(COALESCE(f.name,'—')) fn,
                   (EXTRACT(HOUR FROM sc.start_time)*60+EXTRACT(MINUTE FROM sc.start_time))::int ss, ${SEC}::int se_c
              FROM schedule_entries se
              JOIN schedule_versions sv ON sv.id=se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published')
              JOIN employees e ON e.id=se.employee_id LEFT JOIN functions f ON f.id=e.function_id
              LEFT JOIN shift_codes sc ON sc.tenant_id=se.tenant_id AND sc.code=se.shift_code_display
             WHERE se.tenant_id=$1 AND se.entry_date BETWEEN $2 AND $3 AND sc.start_time IS NOT NULL
             ORDER BY se.employee_id, se.entry_date, sv.created_at DESC),
      pd AS (SELECT GREATEST(COUNT(DISTINCT se.entry_date),1) n FROM schedule_entries se JOIN schedule_versions sv ON sv.id=se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published') WHERE se.tenant_id=$1 AND se.entry_date BETWEEN $2 AND $3)
      SELECT v.fn, h.hh AS "hour", ROUND(COUNT(*) FILTER (WHERE ${covHh('v.ss', 'v.se_c')})::numeric / (SELECT n FROM pd), 1)::float plan
      FROM v CROSS JOIN h GROUP BY v.fn, h.hh`, [t, ws, weekEnd]).catch(() => []);
    // REQUIRED: 28-day observed avg scheduled HC per (function, hour)
    const baseRows = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      r AS (SELECT canon_fn(COALESCE(role_function,function_name)) fn, shift_start_min ss,
                   (CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440 ELSE shift_end_min END) se_c
              FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
                AND work_date >= ($2::date - 28) AND work_date < $2::date),
      d AS (SELECT GREATEST(COUNT(DISTINCT work_date),1) n FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL AND work_date >= ($2::date - 28) AND work_date < $2::date)
      SELECT r.fn, h.hh AS "hour", ROUND(COUNT(*) FILTER (WHERE ${covHh('r.ss', 'r.se_c')})::numeric / (SELECT n FROM d), 1)::float required
      FROM r CROSS JOIN h GROUP BY r.fn, h.hh`, [t, ws]).catch(() => []);

    const plan: Record<string, number[]> = {}, reqd: Record<string, number[]> = {};
    for (const r of planRows) { (plan[r.fn] = plan[r.fn] || Array(24).fill(0))[r.hour] = r.plan; }
    for (const r of baseRows) { (reqd[r.fn] = reqd[r.fn] || Array(24).fill(0))[r.hour] = r.required; }
    const fnCanon = functionName ? functionName.replace(/^\s*[Ii]nternship\s+/, '') : functionName;
    const fns = [...new Set([...Object.keys(plan), ...Object.keys(reqd)])].filter(f => f && f !== '—' && (!fnCanon || f === fnCanon));
    // surplus per hour per function (for cross-skill sourcing) — EXCLUDE supervisory/record-only
    // functions (TL/RTA/Resolution/WFM/Senior): they're never pulled to cover an agent gap.
    const SUPERVISORY = /team leader|\brta\b|resolution specialist|\bwfm\b|senior/i;
    const surplusAt = (h: number, exclude: string) => Object.keys(plan)
      .filter(f => f !== exclude && f !== '—' && !SUPERVISORY.test(f))
      .map(f => ({ fn: f, surplus: +((plan[f]?.[h] || 0) - (reqd[f]?.[h] || 0)).toFixed(1) }))
      .filter(x => x.surplus >= 0.5).sort((a, b) => b.surplus - a.surplus);

    const gaps: any[] = [];
    for (const fn of fns) {
      for (let h = 0; h < 24; h++) {
        const need = reqd[fn]?.[h] || 0, have = plan[fn]?.[h] || 0; const deficit = +(need - have).toFixed(1);
        if (need >= 1 && deficit >= 0.5) {
          const remedies: any[] = [];
          const src = surplusAt(h, fn);
          if (src.length) remedies.push({ type: 'cross_skill', rank: 1, label: 'نقل كروس-سكيل', labelEn: 'Cross-skill move',
            take: Math.min(deficit, src[0].surplus), from: src[0].fn, sources: src.slice(0, 3),
            detail: `انقل ${Math.ceil(Math.min(deficit, src[0].surplus))} من «${src[0].fn}» (فائض ${src[0].surplus})` });
          remedies.push({ type: 'overtime', rank: src.length ? 2 : 1, label: 'أوفر تايم', labelEn: 'Overtime',
            take: Math.ceil(deficit), detail: `مدّد شفت ${Math.ceil(deficit)} موظف بساعة OT لتغطية ${String(h).padStart(2, '0')}:00` });
          remedies.push({ type: 'shift_mix', rank: 3, label: 'تعديل المِكس', labelEn: 'Shift-mix add',
            detail: `أضِف شفت ${h >= 16 || h < 2 ? 'مساء/ليل (E/EE/N)' : 'يغطّي هذه الساعة'} في التوليد` });
          remedies.push({ type: 'exception', rank: 4, label: 'استثناء/توظيف', labelEn: 'Exception / hire', detail: 'لو ما توفّر مصدر — علِّمها للموافقة أو التوظيف' });
          gaps.push({ fn, hour: h, required: need, planned: have, deficit,
            severity: deficit >= 3 ? 'high' : deficit >= 1.5 ? 'medium' : 'low', remedies });
        }
      }
    }
    gaps.sort((a, b) => b.deficit - a.deficit);
    // permission-block windows: contiguous gap hours per function → "don't approve permissions HH-HH"
    const blocks: any[] = [];
    for (const fn of fns) {
      const hrs = gaps.filter(g => g.fn === fn).map(g => g.hour).sort((a, b) => a - b);
      let s = null as number | null, p = null as number | null;
      const flush = (end: number) => { if (s != null) blocks.push({ fn, from: s, to: end + 1, label: `لا تقبل استئذان ${String(s).padStart(2, '0')}:00–${String((end + 1) % 24).padStart(2, '0')}:00 (نقص تغطية)` }); s = null; };
      for (const h of hrs) { if (s == null) { s = h; p = h; } else if (h === (p as number) + 1) { p = h; } else { flush(p as number); s = h; p = h; } }
      if (s != null) flush(p as number);
    }
    return { weekStart: ws, weekEnd, frontier, function: functionName || null, functions: fns,
      gapCount: gaps.length, gaps: gaps.slice(0, 60), permissionBlocks: blocks };
  }

  /** WHO-ON-SEAT — the agents on seat for a function + date + hour (actual for reconciled days,
   *  planned from the latest schedule for future days). Powers the heatmap-cell roster popover. */
  @Get('roster-v2/on-seat')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Agents on seat for a function+date+hour (actual roster_days, else planned schedule)' })
  async onSeat(@Req() req: any, @Query('date') date: string, @Query('function') fn: string, @Query('hour') hour: string, @Query('skillFor') skillFor?: string) {
    const t = req.user.tenantId; const h = Math.max(0, Math.min(23, parseInt(hour || '0', 10)));
    const [{ frontier }] = await this.ds.query(`SELECT MAX(work_date)::text frontier FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]);
    const isActual = frontier && date <= frontier;
    const covJs = (ss: number, se: number) => coversHourJs(ss, se, h);   // coverage-core (R2.1)
    const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
    const p: any[] = [t, date]; let rows: any[] = [];   // function optional — omit for an all-functions seat list
    if (isActual) {
      let w = `tenant_id=$1 AND is_active AND work_date=$2::date AND presence IN ('office','wfh') AND shift_start_min IS NOT NULL`;
      if (fn) { p.push(fn); w += ` AND canon_fn(COALESCE(role_function,function_name))=canon_fn($${p.length})`; }
      rows = await this.ds.query(
        `SELECT person_no, COALESCE(clean_name,name) name, COALESCE(role_function,function_name) fn, shift_code, shift_start_min ss, shift_end_min se, presence
           FROM roster_days WHERE ${w}`, p).catch(() => []);
    } else {
      let w = `se.tenant_id=$1 AND se.entry_date=$2::date AND sc.start_time IS NOT NULL`;
      if (fn) { p.push(fn); w += ` AND canon_fn(COALESCE(f.name,'—'))=canon_fn($${p.length})`; }
      rows = await this.ds.query(
        `SELECT DISTINCT ON (se.employee_id) e.employee_no person_no,
                TRIM(CONCAT(e.first_name_en,' ',COALESCE(e.last_name_en,''))) name, COALESCE(f.name,'—') fn, se.shift_code_display shift_code,
                (EXTRACT(HOUR FROM sc.start_time)*60+EXTRACT(MINUTE FROM sc.start_time))::int ss,
                (CASE WHEN sc.end_time<=sc.start_time THEN EXTRACT(HOUR FROM sc.end_time)*60+EXTRACT(MINUTE FROM sc.end_time)+1440 ELSE EXTRACT(HOUR FROM sc.end_time)*60+EXTRACT(MINUTE FROM sc.end_time) END)::int se,
                'plan' presence
           FROM schedule_entries se
           JOIN schedule_versions sv ON sv.id=se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published')
           JOIN employees e ON e.id=se.employee_id LEFT JOIN functions f ON f.id=e.function_id
           LEFT JOIN shift_codes sc ON sc.tenant_id=se.tenant_id AND sc.code=se.shift_code_display
          WHERE ${w} ORDER BY se.employee_id, sv.created_at DESC`, p).catch(() => []);
    }
    let seated = rows.filter(r => covJs(Number(r.ss), Number(r.se)))
      .map(r => ({ personNo: r.person_no, name: r.name, fn: r.fn, shiftCode: r.shift_code, start: hhmm(r.ss), end: hhmm(r.se), presence: r.presence, skilled: undefined as boolean | undefined, proficiency: undefined as string | undefined }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    // OPTIONAL skill badge: does each candidate hold the TARGET function's channel skill, and at what
    // proficiency? Rank skilled-first, then by proficiency (expert > advanced > intermediate > beginner).
    if (skillFor && seated.length) {
      const code = this.funcToSkillCode(skillFor);
      const profOf: Record<string, string> = {};
      for (const r of (await this.ds.query(
        `SELECT e.employee_no, es.proficiency FROM employee_skills es JOIN skills s ON s.id=es.skill_id JOIN employees e ON e.id=es.employee_id
          WHERE es.tenant_id=$1 AND es.status='active' AND s.code=$2 AND e.employee_no = ANY($3)`,
        [t, code, seated.map(a => a.personNo)]).catch(() => [])) as any[]) profOf[r.employee_no] = r.proficiency;
      const rank: Record<string, number> = { expert: 4, advanced: 3, intermediate: 2, beginner: 1 };
      seated = seated.map(a => ({ ...a, skilled: !!profOf[a.personNo], proficiency: profOf[a.personNo] }))
        .sort((a, b) => (rank[b.proficiency || ''] || 0) - (rank[a.proficiency || ''] || 0) || (a.name || '').localeCompare(b.name || ''));
    }
    return { date, function: fn || null, hour: h, mode: isActual ? 'actual' : 'plan', skillFor: skillFor || null, count: seated.length, agents: seated };
  }

  /** Map a function/channel name → the canonical skill code (for cross-skill matching). */
  private funcToSkillCode(fnName: string): string {
    const f = (fnName || '').toLowerCase();
    if (/inbound|voice|\bomt\b|outbound/.test(f)) return 'VOICE';
    if (/whatsapp|\bwa\b|chat|\bch\b/.test(f)) return 'CHAT';
    if (/email|mail/.test(f)) return 'EMAIL';
    if (/social|\bsm\b/.test(f)) return 'SOCIAL';
    if (/refund/.test(f)) return 'REFUND';
    return 'CC';   // customer care / offline / support default
  }

  /** CROSS-SKILL COVER — commit a manager's cross-skill pick: create a cross_skill_move, notify the
   *  agent, and drop a coverage event on BOTH calendars (agent + manager). One transaction. */
  @Post('roster-v2/cross-skill-cover')
  @RequirePermissions('schedule.edit')
  async crossSkillCover(@Req() req: any, @Body() b: { personNo?: string; fromFunction?: string; toFunction: string; date: string; startHour: number; endHour: number; reason?: string }) {
    const t = req.user.tenantId; const managerId = req.user.id || req.user.sub;
    if (!b?.toFunction || !b?.date || b?.startHour == null || b?.endHour == null || !b?.personNo)
      throw new BadRequestException('personNo, toFunction, date, startHour, endHour are required');
    const [emp] = await this.ds.query(`SELECT id, employee_no, TRIM(CONCAT(first_name_en,' ',COALESCE(last_name_en,''))) name FROM employees WHERE tenant_id=$1 AND employee_no=$2`, [t, b.personNo]);
    if (!emp) throw new BadRequestException(`Employee ${b.personNo} not found`);
    const [usr] = await this.ds.query(`SELECT id FROM users WHERE tenant_id=$1 AND employee_id=$2 AND status='active' LIMIT 1`, [t, emp.id]).catch(() => [null]);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startAt = `${b.date}T${pad(b.startHour)}:00:00+03:00`, endAt = `${b.date}T${pad(b.endHour)}:00:00+03:00`;
    const win = `${pad(b.startHour)}:00–${pad(b.endHour)}:00`;
    const qr = this.ds.createQueryRunner(); await qr.connect(); await qr.startTransaction();
    try {
      // 1) calendar event (visible to manager + agent via attendee)
      const [ev] = await qr.query(
        `INSERT INTO calendar_events (tenant_id, title, event_type, start_at, end_at, all_day, description, color, status, created_by)
         VALUES ($1,$2,'cross_skill',$3::timestamptz,$4::timestamptz,false,$5,'#fb923c','scheduled',$6) RETURNING id`,
        [t, `تغطية: ${emp.name} → ${b.toFunction} (${win})`, startAt, endAt, `Cross-skill coverage of ${b.toFunction}${b.fromFunction ? ' from ' + b.fromFunction : ''}. ${b.reason || ''}`, managerId]);
      const eventId = ev.id;
      await qr.query(`INSERT INTO calendar_event_attendees (event_id, user_id, employee_id, role, status) VALUES ($1,$2,$3,'attendee','accepted')`, [eventId, usr?.id ?? null, emp.id]);
      // 2) cross_skill_move record
      const [mv] = await qr.query(
        `INSERT INTO cross_skill_moves (tenant_id, employee_id, from_function, to_function, start_at, end_at, reason, status, requested_by, approved_by, calendar_event_id)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,'approved',$8,$8,$9) RETURNING id`,
        [t, emp.id, b.fromFunction ?? null, b.toFunction, startAt, endAt, b.reason ?? 'Gap coverage', managerId, eventId]);
      // 3) notify the agent
      if (usr?.id) await qr.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
         VALUES ($1,$2,'coverage.cross_skill',$3,$4,$5,$6,'cross_skill_move',$7,'/calendar')`,
        [t, usr.id, `You will cover ${b.toFunction} on ${b.date}`, `ستغطّي ${b.toFunction} بتاريخ ${b.date}`,
         `Coverage assignment: ${b.toFunction} ${win} on ${b.date}.`, `تعيين تغطية: ${b.toFunction} ${win} بتاريخ ${b.date}.`, mv.id]);
      await qr.commitTransaction();
      return { ok: true, moveId: mv.id, eventId, agent: emp.name, notified: !!usr?.id, window: win, date: b.date, toFunction: b.toFunction };
    } catch (e: any) { await qr.rollbackTransaction(); throw new BadRequestException('cross-skill cover failed: ' + (e?.message || e)); }
    finally { await qr.release(); }
  }

  /** REQUEST OT — a manager asks an agent to work overtime to close a gap. Creates an overtime
   *  request (status pending — awaiting the agent's acknowledgement) + notifies the agent. When the
   *  agent acknowledges (ot-ack) it becomes approved: the forecast plan overlay (approved OT) reflects
   *  it AND the OT hours are written onto the roster row for both to see. */
  @Post('roster-v2/ot-request')
  @RequirePermissions('schedule.edit')
  async otRequest(@Req() req: any, @Body() b: { personNo: string; toFunction?: string; date: string; startHour: number; endHour: number; reason?: string }) {
    const t = req.user.tenantId; const managerId = req.user.id || req.user.sub;
    if (!b?.personNo || !b?.date || b?.startHour == null || b?.endHour == null) throw new BadRequestException('personNo, date, startHour, endHour required');
    const [emp] = await this.ds.query(`SELECT id, employee_no, TRIM(CONCAT(first_name_en,' ',COALESCE(last_name_en,''))) name FROM employees WHERE tenant_id=$1 AND employee_no=$2`, [t, b.personNo]);
    if (!emp) throw new BadRequestException(`Employee ${b.personNo} not found`);
    const [usr] = await this.ds.query(`SELECT id FROM users WHERE tenant_id=$1 AND employee_id=$2 AND status='active' LIMIT 1`, [t, emp.id]).catch(() => [null]);
    const [rt] = await this.ds.query(`SELECT id FROM request_types WHERE tenant_id=$1 AND code='overtime' LIMIT 1`, [t]);
    const [fnRow] = b.toFunction ? await this.ds.query(`SELECT id FROM functions WHERE tenant_id=$1 AND name=$2 LIMIT 1`, [t, b.toFunction]).catch(() => [null]) : [null];
    const pad = (n: number) => String(n).padStart(2, '0'); const win = `${pad(b.startHour)}:00–${pad(b.endHour)}:00`;
    const dur = Math.max(0, (b.endHour - b.startHour)) * 60;
    const qr = this.ds.createQueryRunner(); await qr.connect(); await qr.startTransaction();
    try {
      const [rq] = await qr.query(
        `INSERT INTO requests (tenant_id, request_type_id, requester_id, employee_id, status, notes, submitted_at)
         VALUES ($1,$2,$3,$4,'pending',$5,NOW()) RETURNING id`,
        [t, rt?.id ?? null, managerId, emp.id, `OT requested by manager to cover ${b.toFunction || ''} ${win} on ${b.date}. ${b.reason || ''}`]);
      await qr.query(
        `INSERT INTO request_overtimes (request_id, ot_date, start_time, end_time, duration_minutes, ot_reason, function_id)
         VALUES ($1,$2::date,$3::time,$4::time,$5,$6,$7)`,
        [rq.id, b.date, `${pad(b.startHour)}:00`, `${pad(b.endHour)}:00`, dur, b.reason ?? 'Gap coverage OT', fnRow?.id ?? null]);
      if (usr?.id) await qr.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
         VALUES ($1,$2,'overtime.request',$3,$4,$5,$6,'request',$7,'/requests')`,
        [t, usr.id, `Overtime requested: ${b.date} ${win}`, `طلب أوفر تايم: ${b.date} ${win}`,
         `Please acknowledge overtime ${win} on ${b.date}${b.toFunction ? ' (' + b.toFunction + ')' : ''}.`, `يرجى الإقرار بأوفر تايم ${win} بتاريخ ${b.date}${b.toFunction ? ' (' + b.toFunction + ')' : ''}.`, rq.id]);
      await qr.commitTransaction();
      return { ok: true, requestId: rq.id, agent: emp.name, window: win, date: b.date, status: 'pending', notified: !!usr?.id };
    } catch (e: any) { await qr.rollbackTransaction(); throw new BadRequestException('OT request failed: ' + (e?.message || e)); }
    finally { await qr.release(); }
  }

  /** ACKNOWLEDGE / DECIDE an OT request. On accept → status approved + the OT hours are stamped onto
   *  the agent's roster_days row (before/after/off-day bucket by window vs shift) so it shows for both;
   *  the forecast (approved-OT overlay) also reflects it. Callable by the agent or a manager. */
  @Post('roster-v2/ot-ack')
  @RequirePermissions('requests.view_own')
  async otAck(@Req() req: any, @Body() b: { requestId: string; accept: boolean; reason?: string }) {
    const t = req.user.tenantId;
    if (!b?.requestId) throw new BadRequestException('requestId required');
    const [row] = await this.ds.query(
      `SELECT r.id, r.employee_id, r.requester_id, e.employee_no,
              TRIM(CONCAT(e.first_name_en,' ',COALESCE(e.last_name_en,''))) agent, ro.ot_date::text d,
              EXTRACT(HOUR FROM ro.start_time)*60+EXTRACT(MINUTE FROM ro.start_time) os,
              EXTRACT(HOUR FROM ro.end_time)*60+EXTRACT(MINUTE FROM ro.end_time) oe, ro.duration_minutes dur
         FROM requests r JOIN request_overtimes ro ON ro.request_id=r.id JOIN employees e ON e.id=r.employee_id
        WHERE r.tenant_id=$1 AND r.id=$2`, [t, b.requestId]);
    if (!row) throw new BadRequestException('OT request not found');
    if (!b.accept) {
      // agent declined — store the reason and tell the manager WHY, so they can pick another remedy.
      await this.ds.query(`UPDATE requests SET status='rejected', rejected_at=NOW(), rejection_reason=$2, updated_at=NOW() WHERE id=$1`, [b.requestId, b.reason ?? null]);
      const [m0] = await this.ds.query(`SELECT id FROM users WHERE tenant_id=$1 AND id=$2 LIMIT 1`, [t, row.requester_id]).catch(() => [null]);
      if (m0?.id) await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
         VALUES ($1,$2,'overtime.declined',$3,$4,$5,$6,'request',$7,'/schedule?tab=forecast')`,
        [t, m0.id, 'Overtime declined', 'اعتذر الموظف عن الأوفر تايم',
         `${row.agent} declined the OT on ${row.d}${b.reason ? ' — ' + b.reason : ''}.`, `اعتذر ${row.agent} عن الأوفر تايم بتاريخ ${row.d}${b.reason ? ' — ' + b.reason : ''}.`, b.requestId]).catch(() => {});
      return { ok: true, status: 'rejected', reason: b.reason ?? null };
    }
    await this.ds.query(`UPDATE requests SET status='approved', approved_l1_at=NOW(), updated_at=NOW() WHERE id=$1`, [b.requestId]);
    // stamp the OT onto the roster row (if one exists for that agent/day) — before/after/off-day bucket.
    const [rd] = await this.ds.query(
      `SELECT shift_start_min ss, shift_end_min se FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3::date AND is_active`,
      [t, row.employee_no, row.d]).catch(() => [null]);
    let bucket = 'offday_ot_min', rosterUpdated = false;
    if (rd && rd.ss != null) {
      const ss = Number(rd.ss); const seC = rd.se != null ? (Number(rd.se) <= ss ? Number(rd.se) + 1440 : Number(rd.se)) : ss + 540;
      const os = Number(row.os), oe = Number(row.oe);
      bucket = oe <= ss ? 'ot_before_min' : os >= seC % 1440 || os >= seC ? 'ot_after_min' : 'ot_after_min';
    }
    if (rd) {
      const res = await this.ds.query(
        `UPDATE roster_days SET ${bucket} = COALESCE(${bucket},0) + $4 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3::date AND is_active`,
        [t, row.employee_no, row.d, Number(row.dur)]);
      rosterUpdated = Array.isArray(res) && typeof res[1] === 'number' ? res[1] > 0 : true;
    }
    // notify the manager that the agent acknowledged
    const [mgr] = await this.ds.query(`SELECT id FROM users WHERE tenant_id=$1 AND id=$2 LIMIT 1`, [t, row.requester_id]).catch(() => [null]);
    if (mgr?.id) await this.ds.query(
      `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url)
       VALUES ($1,$2,'overtime.acknowledged',$3,$4,$5,$6,'request',$7,'/schedule?tab=forecast')`,
      [t, mgr.id, 'Overtime acknowledged', 'تم الإقرار بالأوفر تايم', `The agent acknowledged the OT on ${row.d}.`, `أقرّ الموظف بالأوفر تايم بتاريخ ${row.d}.`, b.requestId]).catch(() => {});
    return { ok: true, status: 'approved', bucket, rosterUpdated, minutes: Number(row.dur) };
  }

  /** PERMISSION COVERAGE CHECK — soft-warn before approving a permission: is the function
   *  under-covered during the permission window? Returns the short hours + deficit so the
   *  approver sees "coverage is tight here" (advisory, never a hard block). */
  @Get('roster-v2/permission-coverage-check')
  @RequirePermissions('attendance.view_team')
  async permCoverageCheck(@Req() req: any, @Query('date') date: string, @Query('function') fn: string,
    @Query('startHour') sh: string, @Query('endHour') eh: string) {
    const t = req.user.tenantId;
    if (!date || !fn) return { short: false, hours: [] };
    const s = Math.max(0, parseInt(sh || '0', 10)), e = Math.min(24, parseInt(eh || '24', 10));
    const covHh = covHhSql;   // coverage-core (R2.1)
    const SEC = '(CASE WHEN sc.end_time<=sc.start_time THEN EXTRACT(HOUR FROM sc.end_time)*60+EXTRACT(MINUTE FROM sc.end_time)+1440 ELSE EXTRACT(HOUR FROM sc.end_time)*60+EXTRACT(MINUTE FROM sc.end_time) END)';
    // planned HC per hour for this function ON that date; baseline = 28-day observed per hour
    const planRows = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      v AS (SELECT DISTINCT ON (se.employee_id) (EXTRACT(HOUR FROM sc.start_time)*60+EXTRACT(MINUTE FROM sc.start_time))::int ss, ${SEC}::int se_c
              FROM schedule_entries se JOIN schedule_versions sv ON sv.id=se.schedule_version_id AND sv.status IN ('draft','generated','reviewed','published')
              JOIN employees e ON e.id=se.employee_id LEFT JOIN functions f ON f.id=e.function_id
              LEFT JOIN shift_codes sc ON sc.tenant_id=se.tenant_id AND sc.code=se.shift_code_display
             WHERE se.tenant_id=$1 AND se.entry_date=$2::date AND canon_fn(COALESCE(f.name,'—'))=canon_fn($3) AND sc.start_time IS NOT NULL ORDER BY se.employee_id, sv.created_at DESC)
      SELECT h.hh AS "hour", COUNT(*) FILTER (WHERE ${covHh('v.ss', 'v.se_c')})::int plan FROM v CROSS JOIN h GROUP BY h.hh`, [t, date, fn]).catch(() => []);
    const baseRows = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      r AS (SELECT shift_start_min ss, (CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440 ELSE shift_end_min END) se_c
              FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL AND canon_fn(COALESCE(role_function,function_name))=canon_fn($3)
                AND work_date >= ($2::date - 28) AND work_date < $2::date),
      d AS (SELECT GREATEST(COUNT(DISTINCT work_date),1) n FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL AND work_date >= ($2::date - 28) AND work_date < $2::date)
      SELECT h.hh AS "hour", ROUND(COUNT(*) FILTER (WHERE ${covHh('r.ss', 'r.se_c')})::numeric/(SELECT n FROM d),1)::float required FROM r CROSS JOIN h GROUP BY h.hh`, [t, date, fn]).catch(() => []);
    const planH: number[] = Array(24).fill(0), reqH: number[] = Array(24).fill(0);
    for (const r of planRows) planH[r.hour] = r.plan; for (const r of baseRows) reqH[r.hour] = r.required;
    const hours: any[] = [];
    for (let h = s; h < e; h++) { const def = +(reqH[h] - planH[h]).toFixed(1); if (reqH[h] >= 1 && def >= 0.5) hours.push({ hour: h, planned: planH[h], required: reqH[h], deficit: def }); }
    return { short: hours.length > 0, function: fn, date, window: `${String(s).padStart(2, '0')}:00–${String(e).padStart(2, '0')}:00`, hours, worst: hours.reduce((m, x) => x.deficit > (m?.deficit || 0) ? x : m, null) };
  }

  /** The current agent's PENDING OT requests (awaiting their acknowledgement) — for AgentHome. */
  @Get('roster-v2/my-ot-pending')
  @RequirePermissions('requests.view_own')
  async myOtPending(@Req() req: any) {
    const t = req.user.tenantId; const empId = req.user.employeeId;
    if (!empId) return { requests: [] };
    const rows = await this.ds.query(
      `SELECT r.id, r.status, r.notes, ro.ot_date::text d, to_char(ro.start_time,'HH24:MI') start, to_char(ro.end_time,'HH24:MI') "end",
              ro.duration_minutes dur, f.name function, r.submitted_at
         FROM requests r JOIN request_overtimes ro ON ro.request_id=r.id
         JOIN request_types rt ON rt.id=r.request_type_id AND rt.code='overtime'
         LEFT JOIN functions f ON f.id=ro.function_id
        WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.status='pending'
        ORDER BY ro.ot_date`, [t, empId]).catch(() => []);
    return { requests: rows };
  }

  /** MANAGER OT LOG — the OT requests in a window with their lifecycle + REQUESTED vs ACTUALLY-WORKED
   *  minutes. Once an approved OT's date has passed and the recon engine has recorded OT on the
   *  agent's roster row (ot_before/after/off-day), it reads as 'worked' — closing the loop the
   *  Director asked for (requested → acknowledged → worked → recorded). */
  @Get('roster-v2/ot-requests')
  @RequirePermissions('attendance.view_team')
  async otRequestsLog(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('function') fn?: string) {
    const t = req.user.tenantId;
    const [{ frontier }] = await this.ds.query(`SELECT MAX(work_date)::text frontier FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]);
    const p: any[] = [t, from || '2000-01-01', to || '2999-12-31'];
    let w = `r.tenant_id=$1 AND ro.ot_date BETWEEN $2 AND $3`;
    if (fn) { p.push(fn); w += ` AND canon_fn(f.name)=canon_fn($${p.length})`; }
    const rows = await this.ds.query(
      `SELECT r.id, r.status, ro.ot_date::text d, to_char(ro.start_time,'HH24:MI') start, to_char(ro.end_time,'HH24:MI') "end",
              ro.duration_minutes requested, f.name function, e.employee_no,
              TRIM(CONCAT(e.first_name_en,' ',COALESCE(e.last_name_en,''))) agent,
              (SELECT COALESCE(rd.ot_before_min,0)+COALESCE(rd.ot_after_min,0)+COALESCE(rd.offday_ot_min,0)
                 FROM roster_days rd WHERE rd.tenant_id=r.tenant_id AND rd.person_no=e.employee_no AND rd.work_date=ro.ot_date AND rd.is_active) worked_day
         FROM requests r JOIN request_overtimes ro ON ro.request_id=r.id
         JOIN request_types rt ON rt.id=r.request_type_id AND rt.code='overtime'
         JOIN employees e ON e.id=r.employee_id LEFT JOIN functions f ON f.id=ro.function_id
        WHERE ${w} ORDER BY ro.ot_date DESC, r.submitted_at DESC LIMIT 200`, p).catch(() => []);
    const items = rows.map((r: any) => {
      const worked = Number(r.worked_day || 0);
      const past = frontier && r.d <= frontier;
      // lifecycle: pending → approved (acknowledged) → completed (approved + past + roster shows OT)
      const phase = r.status === 'pending' ? 'awaiting_ack'
        : r.status === 'rejected' ? 'declined'
        : (r.status === 'approved' && past && worked > 0) ? 'completed'
        : r.status === 'approved' ? 'acknowledged' : r.status;
      return { id: r.id, date: r.d, window: `${r.start}–${r.end}`, agent: r.agent, personNo: r.employee_no,
        function: r.function, requestedMin: Number(r.requested || 0), workedMin: past ? worked : null, phase };
    });
    return { from: p[1], to: p[2], frontier, count: items.length, items };
  }
}
