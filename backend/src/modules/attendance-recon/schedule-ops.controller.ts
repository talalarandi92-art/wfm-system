import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, Res, UseGuards, NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { shiftCategoryFromCode } from '@common/shift-category';
import { TRUE_OT, CRED_LATE, CRED_EARLY } from '@common/wfm-metrics';
import { payableOtMin } from '@common/ot-review';
import { rosterCacheInvalidate } from '@common/ttl-cache.interceptor';
import { RosterSharedService, SHIFT_CAT } from './roster-shared.service';
import { coversIntervalOnDate, sampledHourlyMinutes } from './coverage-core';

/* Schedule operations & analysis: soft-lock endpoints, OT & exceptions (+Excel),
 * schedule-analysis, interval-headcount, coverage-impact, and the manual
 * schedule-change / swap / change-log / revert chain with its validation helpers —
 * split VERBATIM out of the monolithic ReconController (2026-07-07,
 * EXECUTION_BRIEF Phase-4). Same route prefix — zero route renames. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class ScheduleOpsController {
  constructor(
    private readonly shared: RosterSharedService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}
  /* ══════════════════════════════════════════════════════════════════════════
   *  SCHEDULE ANALYSIS — the consolidated dashboard over the APPROVED roster_days
   *  schedule: shrinkage, shift-rate distribution, OFF%, leave%, weekend-OFF%,
   *  hourly headcount, permission hours — by function/team/period. This is the
   *  authoritative foundation everything builds on once the schedule is uploaded.
   *  ══════════════════════════════════════════════════════════════════════════ */
  private parsePermMin(d: any): number {
    if (d == null) return 0; const s = String(d).trim(); let m;
    // dominant format: a TIME WINDOW like "02:00 PM-04:00 PM" → duration = end − start (cross-midnight aware)
    if ((m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i))) {
      const to24 = (h: string, mn: string, ap?: string) => { let hh = (+h) % 12; if (ap && /pm/i.test(ap)) hh += 12; return hh * 60 + (+mn); };
      let dur = to24(m[4], m[5], m[6]) - to24(m[1], m[2], m[3]); if (dur <= 0) dur += 1440;
      return dur > 0 && dur <= 1440 ? dur : 0;
    }
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*h/i))) return Math.round(parseFloat(m[1]) * 60);
    if ((m = s.match(/(\d+)\s*m/i))) return +m[1];
    if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) { const n = parseFloat(m[1]); return n <= 12 ? Math.round(n * 60) : Math.round(n); }
    return 0;
  }

  /* Approved-schedule SOFT LOCK helpers moved to RosterSharedService (roster-shared.service.ts). */
  private async assertScheduleEditable(req: any, date: string) {
    const lock = await this.shared.getScheduleLock(req.user.tenantId);
    const locked = lock && date >= lock.from && date <= lock.to;
    const canOverride = (req.user.permissionCodes || []).includes('schedule.publish');
    if (locked && !canOverride) {
      throw new ForbiddenException(`Schedule ${date} is inside the approved/locked range (${lock!.from} → ${lock!.to}). Manual edits are not allowed — re-upload the schedule to change it (a supervisor with schedule.publish may override, with audit).`);
    }
    return { locked, overridden: locked && canOverride };
  }

  /** Approved-schedule lock status (range + who can edit). */
  @Get('roster-v2/schedule-lock')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Approved-schedule soft-lock status (locked range + override capability)' })
  async scheduleLockStatus(@Req() req: any) {
    const lock = await this.shared.getScheduleLock(req.user.tenantId);
    return { lock, canOverride: (req.user.permissionCodes || []).includes('schedule.publish') };
  }

  /** Manually set / clear the approved-schedule lock (supervisor only). */
  @Put('roster-v2/schedule-lock')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Set or clear the approved-schedule lock range' })
  async setScheduleLockManual(@Req() req: any, @Body() b: { from?: string; to?: string; clear?: boolean }) {
    const t = req.user.tenantId;
    if (b?.clear) { await this.ds.query(`DELETE FROM tenant_settings WHERE tenant_id=$1 AND setting_key='schedule_lock'`, [t]); return { lock: null }; }
    if (!b?.from || !b?.to) throw new BadRequestException('from and to are required');
    const val = { from: b.from, to: b.to, lockedAt: new Date().toISOString(), lockedBy: req.user.id || req.user.sub || 'manual' };
    await this.shared.setScheduleLock(t, val); return { lock: val };
  }

  /* ── OT & EXCEPTIONS analytics — the "stories" in the data: overtime (incl.
   *  public-holiday split), tardiness & early-out WITHOUT permission, permissions
   *  (by type/shift/day), and absences — by agent / function / hours. ── */
  @Get('roster-v2/ot-exceptions')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'OT (holiday vs non-holiday) + tardiness/early-out (no permission) + permissions + absences, by agent/function' })
  async otExceptions(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('function') fn?: string, @Query('teamLeader') tl?: string) {
    return this.buildOtExceptions(req.user.tenantId, from, to, fn, tl);
  }

  private async buildOtExceptions(t: string, from?: string, to?: string, fn?: string, tl?: string) {
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    if (fn) { p.push(fn); w += ` AND canon_fn(role_function)=canon_fn($${p.length})`; }
    if (tl) { p.push(tl); w += ` AND team_manager=$${p.length}`; }

    // Tardiness plausibility cap (240 min). Cross-midnight night shifts (MD/MN/MNR,
    // shift_end_min>1440) make the post-midnight session tail read as a multi-HOUR
    // "early-out" — a measurement artifact, not the agent leaving early. A real
    // late-in/early-out is bounded, so values >4h are excluded from the counts and
    // surfaced as `excludedDq` instead of being held against night agents (HR-safe;
    // mirrors the WFH report's ">3h short → data quality" rule).
    // Rule 4 (Director 2026-07-11): rows flagged ot_record_only (excluded roles — TL/Senior/Resolution/
    // RTA/WFM/Management) are NOT payable — excluded from every payable OT total below and surfaced in
    // a separate record-only section instead.
    const PAY = `NOT COALESCE(ot_record_only,false)`;
    const [s] = await this.ds.query(`
      SELECT COALESCE(SUM(ot_min) FILTER (WHERE ${PAY}),0)::int ot, COALESCE(SUM(holiday_ot_min) FILTER (WHERE ${PAY}),0)::int "holOt",
             COALESCE(SUM(offday_ot_min) FILTER (WHERE ${PAY}),0)::int "offOt", COALESCE(SUM(ot_before_min) FILTER (WHERE ${PAY}),0)::int "befOt",
             COALESCE(SUM(ot_after_min) FILTER (WHERE ${PAY}),0)::int "aftOt",
             COUNT(*) FILTER (WHERE ${PAY} AND (ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0))::int "otDays",
             COUNT(DISTINCT person_no) FILTER (WHERE ${PAY} AND (ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0))::int "otAgents",
             COALESCE(SUM(ot_min+holiday_ot_min+offday_ot_min) FILTER (WHERE NOT ${PAY}),0)::int "recOnlyMin",
             COUNT(*) FILTER (WHERE NOT ${PAY} AND (ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0))::int "recOnlyDays",
             COUNT(DISTINCT person_no) FILTER (WHERE NOT ${PAY} AND (ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0))::int "recOnlyAgents",
             COUNT(*) FILTER (WHERE ${CRED_LATE} AND permission_type IS NULL)::int "lateDays",
             COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE} AND permission_type IS NULL),0)::int "lateMin",
             COUNT(*) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NULL)::int "earlyDays",
             COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NULL),0)::int "earlyMin",
             COUNT(*) FILTER (WHERE presence='absent')::int "absentDays",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             COUNT(*) FILTER (WHERE ${CRED_LATE} AND permission_type IS NOT NULL)::int "lateExcused",
             COUNT(*) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NOT NULL)::int "earlyExcused",
             COUNT(*) FILTER (WHERE (sys_late_min>240 OR sys_early_min>240) AND permission_type IS NULL)::int "excludedDq"
        FROM roster_days WHERE ${w}`, p);
    const byAgent = await this.ds.query(`
      SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) fn,
             COALESCE(SUM(ot_min+holiday_ot_min+offday_ot_min) FILTER (WHERE ${PAY}),0)::int "otMin",
             COALESCE(SUM(ot_min) FILTER (WHERE ${PAY}),0)::int "regOtMin", COALESCE(SUM(holiday_ot_min) FILTER (WHERE ${PAY}),0)::int "holOtMin", COALESCE(SUM(offday_ot_min) FILTER (WHERE ${PAY}),0)::int "offOtMin",
             COUNT(*) FILTER (WHERE ${PAY} AND (ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0))::int "otDays",
             COALESCE(SUM(COALESCE(expected_hours,9)*60) FILTER (WHERE presence IN ('office','wfh')),0)::int "workMin",
             COUNT(*) FILTER (WHERE ${CRED_LATE} AND permission_type IS NULL)::int "lateDays",
             COUNT(*) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NULL)::int "earlyDays",
             COUNT(*) FILTER (WHERE presence='absent')::int "absentDays",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int perms
        FROM roster_days WHERE ${w} GROUP BY person_no ORDER BY "otMin" DESC`, p);
    const byFn = await this.ds.query(`
      SELECT canon_fn(role_function) fn, COALESCE(SUM(ot_min+holiday_ot_min+offday_ot_min) FILTER (WHERE ${PAY}),0)::int "otMin",
             COALESCE(SUM(holiday_ot_min) FILTER (WHERE ${PAY}),0)::int "holOtMin", COALESCE(SUM(offday_ot_min) FILTER (WHERE ${PAY}),0)::int "offOtMin",
             COUNT(*) FILTER (WHERE ${PAY} AND (ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0))::int "otDays",
             COUNT(DISTINCT person_no)::int people,
             COUNT(*) FILTER (WHERE ${CRED_LATE} AND permission_type IS NULL)::int "lateDays",
             COUNT(*) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NULL)::int "earlyDays",
             COUNT(*) FILTER (WHERE presence='absent')::int "absentDays", COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int perms
        FROM roster_days WHERE ${w} GROUP BY canon_fn(role_function) ORDER BY "otMin" DESC`, p);
    // record-only OT (excluded roles) — listed separately, never in payable totals
    const recordOnlyRows = await this.ds.query(`
      SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) fn,
             COALESCE(SUM(ot_min+holiday_ot_min+offday_ot_min),0)::int "otMin",
             COALESCE(SUM(ot_min),0)::int "regOtMin", COALESCE(SUM(holiday_ot_min),0)::int "holOtMin", COALESCE(SUM(offday_ot_min),0)::int "offOtMin",
             COUNT(*) FILTER (WHERE ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0)::int "otDays"
        FROM roster_days WHERE ${w} AND NOT ${PAY} GROUP BY person_no ORDER BY "otMin" DESC`, p);
    const permByType = await this.ds.query(`SELECT permission_type k, COUNT(*)::int n FROM roster_days WHERE ${w} AND permission_type IS NOT NULL GROUP BY permission_type ORDER BY n DESC`, p);
    const permByShift = await this.ds.query(`SELECT COALESCE(shift_code,'—') k, COUNT(*)::int n FROM roster_days WHERE ${w} AND permission_type IS NOT NULL GROUP BY shift_code ORDER BY n DESC LIMIT 12`, p);
    const permByDate = await this.ds.query(`SELECT work_date::text k, COUNT(*)::int n FROM roster_days WHERE ${w} AND permission_type IS NOT NULL GROUP BY work_date ORDER BY n DESC LIMIT 12`, p);
    const absByDate = await this.ds.query(`SELECT work_date::text k, COUNT(*)::int n FROM roster_days WHERE ${w} AND presence='absent' GROUP BY work_date ORDER BY n DESC LIMIT 12`, p);
    // permission hours (parse the TEXT time-window)
    const perms = await this.ds.query(`SELECT permission_duration d FROM roster_days WHERE ${w} AND permission_type IS NOT NULL AND permission_duration IS NOT NULL`, p);
    const permMin = perms.reduce((a: number, r: any) => a + this.parsePermMin(r.d), 0);

    // ── Director decision 1 (2026-07-11): scheduled OFF days worked → HR clarify, NOT payable off-day OT.
    //    These rows carry off_worked_hr_review=true with the net hours parked in off_worked_min (non-payable).
    const offWorkedRows = await this.ds.query(`
      SELECT person_no, clean_name name, role_function fn, work_date::text date, shift_code "shiftCode",
             COALESCE(off_worked_min,0)::int mins, sys_login_min "sysLogin", sys_logout_min "sysLogout",
             punch_in_min "punchIn", punch_out_min "punchOut", data_quality dq
        FROM roster_days WHERE ${w} AND COALESCE(off_worked_hr_review,false) ORDER BY off_worked_min DESC, work_date`, p);
    const [offW] = await this.ds.query(`
      SELECT COALESCE(SUM(off_worked_min),0)::int mins, COUNT(*)::int days, COUNT(DISTINCT person_no)::int agents
        FROM roster_days WHERE ${w} AND COALESCE(off_worked_hr_review,false)`, p);

    // ── Director decision 2 (2026-07-11): before/after-shift OT review flags. Payable ADDS only
    //    ACKNOWLEDGED minutes; pending/ignored contribute nothing. roster_days.ot_min is never mutated.
    //    Filters (function/team) are applied via the joined roster_days row for the same person/date.
    const rvW = w.replace(/\btenant_id=\$1\b/, 'rd.tenant_id=$1').replace(/\bwork_date BETWEEN\b/, 'rd.work_date BETWEEN')
      .replace(/\bis_active\b/, 'rd.is_active').replace(/canon_fn\(role_function\)/g, 'canon_fn(rd.role_function)').replace(/\bteam_manager=/g, 'rd.team_manager=');
    const rvJoin = `FROM ot_review_flags orf JOIN roster_days rd
        ON rd.tenant_id=orf.tenant_id AND rd.person_no=orf.person_no AND rd.work_date=orf.work_date AND rd.is_active
       WHERE ${rvW}`;
    const [rv] = await this.ds.query(`
      SELECT COALESCE(SUM(orf.minutes) FILTER (WHERE orf.status='acknowledged'),0)::int "ackMin",
             COUNT(*) FILTER (WHERE orf.status='pending')::int pending,
             COUNT(*) FILTER (WHERE orf.status='acknowledged')::int acknowledged,
             COUNT(*) FILTER (WHERE orf.status='ignored')::int ignored,
             COUNT(DISTINCT orf.person_no) FILTER (WHERE orf.status='pending')::int "pendingAgents"
        ${rvJoin}`, p);
    const pendingPersonRows = await this.ds.query(`SELECT DISTINCT orf.person_no ${rvJoin} AND orf.status='pending'`, p);

    const fnOpts = await this.ds.query(`SELECT DISTINCT canon_fn(role_function) v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t]);
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);

    const r1 = (n: number) => Math.round(n * 10) / 10;
    // OT buckets are DISJOINT in roster_days: ot_min = regular workday OT, offday_ot_min
    // = OT on the agent's OFF day, holiday_ot_min = OT on a public holiday (each row sits
    // in exactly one bucket). True total = sum of all three. Non-holiday = regular + off-day.
    // payable OT = regular + off-day + holiday + ACKNOWLEDGED before/after review minutes (decision 2).
    const ackMin = rv?.ackMin || 0;
    const totalOt = payableOtMin({ regularMin: s.ot, offdayMin: s.offOt, holidayMin: s.holOt, ackReviewMin: ackMin });
    const nonHolOt = s.ot + s.offOt + ackMin;
    const pendingPersons: string[] = pendingPersonRows.map((r: any) => r.person_no);
    return {
      from: dFrom, to: dTo, function: fn || null, teamLeader: tl || null,
      ot: { totalHrs: r1(totalOt / 60), regularHrs: r1(s.ot / 60), offdayHrs: r1(s.offOt / 60), holidayHrs: r1(s.holOt / 60),
            nonHolidayHrs: r1(nonHolOt / 60),
            holidayPct: totalOt > 0 ? r1(100 * s.holOt / totalOt) : 0, nonHolidayPct: totalOt > 0 ? r1(100 * nonHolOt / totalOt) : 0,
            beforeShiftHrs: r1(s.befOt / 60), afterShiftHrs: r1(s.aftOt / 60),
            acknowledgedReviewHrs: r1(ackMin / 60),
            days: s.otDays, agents: s.otAgents },
      // before/after-shift OT review (Director decision 2, 2026-07-11) — pending needs Acknowledge/Ignore
      otReview: { pending: rv?.pending || 0, acknowledged: rv?.acknowledged || 0, ignored: rv?.ignored || 0,
        pendingAgents: rv?.pendingAgents || 0, acknowledgedHrs: r1(ackMin / 60), pendingPersons },
      // scheduled OFF days worked → HR clarify, NOT payable off-day OT (Director decision 1, 2026-07-11)
      offWorked: { hrs: r1((offW?.mins || 0) / 60), days: offW?.days || 0, agents: offW?.agents || 0,
        rows: offWorkedRows.map((r: any) => ({ ...r, hrs: r1(r.mins / 60) })) },
      // excluded-role OT — computed & stored but NOT payable (Director rule 4, 2026-07-11)
      otRecordOnly: { totalHrs: r1(s.recOnlyMin / 60), days: s.recOnlyDays, agents: s.recOnlyAgents,
        byAgent: recordOnlyRows.map((a: any) => ({ ...a, otHrs: r1(a.otMin / 60), regOtHrs: r1(a.regOtMin / 60), holOtHrs: r1(a.holOtMin / 60), offOtHrs: r1(a.offOtMin / 60) })) },
      tardiness: { lateDays: s.lateDays, lateHrs: r1(s.lateMin / 60), earlyDays: s.earlyDays, earlyHrs: r1(s.earlyMin / 60), lateExcused: s.lateExcused, earlyExcused: s.earlyExcused, excludedDq: s.excludedDq, cap: 240 },
      permissions: { count: s.permissions, hrs: r1(permMin / 60), avgHrs: s.permissions > 0 ? r1(permMin / 60 / s.permissions) : 0, byType: permByType, byShift: permByShift, byDate: permByDate },
      absence: { days: s.absentDays, byDate: absByDate },
      byAgent: byAgent.map((a: any) => ({ ...a, otHrs: r1(a.otMin / 60), regOtHrs: r1(a.regOtMin / 60), holOtHrs: r1(a.holOtMin / 60), offOtHrs: r1(a.offOtMin / 60),
        otPctOfWork: a.workMin > 0 ? r1(100 * a.otMin / a.workMin) : 0 })).slice(0, 300),
      byFunction: byFn.map((a: any) => ({ ...a, otHrs: r1(a.otMin / 60), holOtHrs: r1(a.holOtMin / 60), offOtHrs: r1(a.offOtMin / 60) })),
      filterOptions: { functions: fnOpts.map((r: any) => r.v), teamLeaders: tlOpts.map((r: any) => r.v) },
    };
  }

  /** OT & Exceptions → Excel (Summary + By_Agent + By_Function + Permissions + Absences). */
  @Get('roster-v2/ot-exceptions/export')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'OT & Exceptions report → .xlsx' })
  async otExceptionsExport(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('function') fn?: string, @Query('teamLeader') tl?: string) {
    const d = await this.buildOtExceptions(req.user.tenantId, from, to, fn, tl);
    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const bold = (ws: any) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
    // Summary
    const sum = wb.addWorksheet('Summary');
    sum.columns = [{ header: 'Metric', key: 'm', width: 38 }, { header: 'Value', key: 'v', width: 18 }];
    [['Period', `${d.from} → ${d.to}`], ['Function', d.function || 'All'], ['Team Leader', d.teamLeader || 'All'],
     ['— OVERTIME —', ''], ['Total OT (hrs)', d.ot.totalHrs], ['Regular workday OT (hrs)', d.ot.regularHrs],
     ['Off-day OT (hrs)', d.ot.offdayHrs], ['Public-holiday OT (hrs)', d.ot.holidayHrs],
     ['Public-holiday OT %', `${d.ot.holidayPct}%`], ['Non-holiday OT %', `${d.ot.nonHolidayPct}%`],
     ['Before-shift OT (hrs)', d.ot.beforeShiftHrs], ['After-shift OT (hrs)', d.ot.afterShiftHrs],
     ['Acknowledged before/after OT in payable (hrs)', d.ot.acknowledgedReviewHrs],
     ['OT days', d.ot.days], ['Agents with OT', d.ot.agents],
     ['— OT REVIEW (before/after shift) —', ''], ['Pending review', d.otReview.pending], ['Acknowledged', d.otReview.acknowledged], ['Ignored', d.otReview.ignored],
     ['— OFF WORKED (HR clarify, not auto-paid) —', ''], ['OFF-worked hours', d.offWorked.hrs], ['OFF-worked days', d.offWorked.days], ['Agents', d.offWorked.agents],
     ['— TARDINESS (no permission) —', ''], ['Late-in days', d.tardiness.lateDays], ['Late-in (hrs)', d.tardiness.lateHrs],
     ['Early-out days', d.tardiness.earlyDays], ['Early-out (hrs)', d.tardiness.earlyHrs],
     ['Late excused by permission', d.tardiness.lateExcused], ['Early excused by permission', d.tardiness.earlyExcused],
     ['Excluded — data quality (cross-midnight bleed)', d.tardiness.excludedDq],
     ['— PERMISSIONS —', ''], ['Permissions count', d.permissions.count], ['Permission hours', d.permissions.hrs], ['Avg per permission (hrs)', d.permissions.avgHrs],
     ['— ABSENCE —', ''], ['Absence days', d.absence.days]].forEach(([m, v]) => sum.addRow({ m, v }));
    bold(sum);
    // By agent
    const ag = wb.addWorksheet('By_Agent');
    ag.columns = [{ header: 'Employee', key: 'name', width: 22 }, { header: 'Function', key: 'fn', width: 16 },
      { header: 'OT hrs', key: 'otHrs' }, { header: 'Regular OT', key: 'regOtHrs' }, { header: 'Off-day OT', key: 'offOtHrs' }, { header: 'Holiday OT', key: 'holOtHrs' },
      { header: 'OT days', key: 'otDays' }, { header: 'OT % of work', key: 'otPctOfWork' },
      { header: 'Late days', key: 'lateDays' }, { header: 'Early days', key: 'earlyDays' }, { header: 'Absent days', key: 'absentDays' }, { header: 'Permissions', key: 'perms' }];
    d.byAgent.forEach((r: any) => ag.addRow(r)); bold(ag);
    // By function
    const fns = wb.addWorksheet('By_Function');
    fns.columns = [{ header: 'Function', key: 'fn', width: 20 }, { header: 'People', key: 'people' }, { header: 'OT hrs', key: 'otHrs' },
      { header: 'Off-day OT', key: 'offOtHrs' }, { header: 'Holiday OT', key: 'holOtHrs' }, { header: 'OT days', key: 'otDays' },
      { header: 'Late days', key: 'lateDays' }, { header: 'Early days', key: 'earlyDays' }, { header: 'Absent days', key: 'absentDays' }, { header: 'Permissions', key: 'perms' }];
    d.byFunction.forEach((r: any) => fns.addRow(r)); bold(fns);
    // Permissions breakdowns
    const pt = wb.addWorksheet('Permissions');
    pt.columns = [{ header: 'By Type', key: 'k', width: 26 }, { header: 'Count', key: 'n' }];
    d.permissions.byType.forEach((r: any) => pt.addRow(r));
    pt.addRow({}); pt.addRow({ k: 'By Shift code', n: '' });
    d.permissions.byShift.forEach((r: any) => pt.addRow(r));
    pt.addRow({}); pt.addRow({ k: 'Top days', n: '' });
    d.permissions.byDate.forEach((r: any) => pt.addRow(r)); bold(pt);
    // Absences
    const ab = wb.addWorksheet('Absences_By_Date');
    ab.columns = [{ header: 'Date', key: 'k', width: 16 }, { header: 'Absent count', key: 'n' }];
    d.absence.byDate.forEach((r: any) => ab.addRow(r)); bold(ab);
    // OFF worked — HR review (decision 1): scheduled OFF but worked; NOT auto-paid as off-day OT
    const ow = wb.addWorksheet('OFF_Worked_HR_Review');
    ow.columns = [{ header: 'Employee', key: 'name', width: 22 }, { header: 'Function', key: 'fn', width: 16 },
      { header: 'Date', key: 'date', width: 14 }, { header: 'Shift', key: 'shiftCode', width: 10 },
      { header: 'Worked hrs (not paid)', key: 'hrs', width: 18 }, { header: 'Note', key: 'dq', width: 40 }];
    (d.offWorked.rows || []).forEach((r: any) => ow.addRow(r)); bold(ow);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="OT_Exceptions_${d.from}_${d.to}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /* ── Director decision 2 (2026-07-11): before/after-shift OT REVIEW queue.
   *  Each pending flag = an "uncertain / reserved period" alert next to a name with two
   *  actions: Acknowledge (it IS overtime → its minutes become payable in the OT report) or
   *  Ignore (they just opened early / stayed logged in → does not count). Until acted on it
   *  stays 'pending' — never silently paid. roster_days.ot_min is never mutated by these
   *  actions; the OT report ADDS acknowledged minutes so the engine stays the source of truth. */
  @Get('roster-v2/ot-review')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Before/after-shift OT review queue (pending / acknowledged / ignored) with evidence' })
  async otReviewList(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string,
    @Query('status') status?: string, @Query('function') fn?: string, @Query('teamLeader') tl?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo];
    let w = `orf.tenant_id=$1 AND orf.work_date BETWEEN $2 AND $3`;
    if (status && ['pending', 'acknowledged', 'ignored'].includes(status)) { p.push(status); w += ` AND orf.status=$${p.length}`; }
    if (fn) { p.push(fn); w += ` AND canon_fn(rd.role_function)=canon_fn($${p.length})`; }
    if (tl) { p.push(tl); w += ` AND rd.team_manager=$${p.length}`; }
    const rows = await this.ds.query(`
      SELECT orf.id, orf.person_no "personNo", orf.work_date::text date, orf.kind, orf.minutes,
             orf.status, orf.note, orf.reviewed_by "reviewedBy", orf.reviewed_at "reviewedAt",
             COALESCE(orf.employee_name, rd.clean_name) name, COALESCE(orf.function_name, rd.role_function) fn,
             rd.shift_code "shiftCode", rd.shift_start_min "schedStart", rd.shift_end_min "schedEnd",
             rd.sys_login_min "sysLogin", rd.sys_logout_min "sysLogout", rd.punch_in_min "punchIn", rd.punch_out_min "punchOut"
        FROM ot_review_flags orf LEFT JOIN roster_days rd
          ON rd.tenant_id=orf.tenant_id AND rd.person_no=orf.person_no AND rd.work_date=orf.work_date AND rd.is_active
       WHERE ${w} ORDER BY (orf.status='pending') DESC, orf.work_date DESC, orf.minutes DESC LIMIT 500`, p);
    const [c] = await this.ds.query(`
      SELECT COUNT(*) FILTER (WHERE status='pending')::int pending,
             COUNT(*) FILTER (WHERE status='acknowledged')::int acknowledged,
             COUNT(*) FILTER (WHERE status='ignored')::int ignored
        FROM ot_review_flags WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [t, dFrom, dTo]);
    return { from: dFrom, to: dTo, counts: c, items: rows };
  }

  private async resolveOtReview(req: any, id: string, status: 'acknowledged' | 'ignored', note?: string) {
    const t = req.user.tenantId;
    const [flag] = await this.ds.query(`SELECT * FROM ot_review_flags WHERE tenant_id=$1 AND id=$2`, [t, id]);
    if (!flag) throw new NotFoundException('OT review flag not found');
    const actor = req.user.email || req.user.id || req.user.sub || 'unknown';
    await this.ds.query(
      `UPDATE ot_review_flags SET status=$3, note=$4, reviewed_by=$5, reviewed_at=NOW(), updated_at=NOW() WHERE tenant_id=$1 AND id=$2`,
      [t, id, status, note ?? null, actor]);
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value, notes)
       VALUES ($1,$2,$3,$4,'attendance-recon','ot_review_flag',$5,$6::jsonb,$7)`,
      [t, req.user.id || req.user.sub || null, req.user.email || null,
       status === 'acknowledged' ? 'ot_review.acknowledge' : 'ot_review.ignore', String(id),
       JSON.stringify({ personNo: flag.person_no, date: flag.work_date, kind: flag.kind, minutes: flag.minutes, status }),
       `${status === 'acknowledged' ? 'Acknowledged' : 'Ignored'} ${flag.kind}-shift OT ${flag.minutes}m for ${flag.person_no} on ${flag.work_date}${note ? ' — ' + note : ''}`]).catch(() => {});
    rosterCacheInvalidate();
    return { ok: true, id: Number(id), status, minutes: flag.minutes, kind: flag.kind };
  }

  @Post('roster-v2/ot-review/:id/acknowledge')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Acknowledge a before/after-shift OT flag → its minutes become payable' })
  async otReviewAck(@Req() req: any, @Param('id') id: string, @Body() b: { note?: string }) {
    return this.resolveOtReview(req, id, 'acknowledged', b?.note);
  }

  @Post('roster-v2/ot-review/:id/ignore')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Ignore a before/after-shift OT flag → does NOT count as overtime' })
  async otReviewIgnore(@Req() req: any, @Param('id') id: string, @Body() b: { note?: string }) {
    return this.resolveOtReview(req, id, 'ignored', b?.note);
  }

  @Get('roster-v2/schedule-analysis')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Consolidated schedule analysis — shrinkage, shift-rate, OFF/leave/weekend-OFF %, hourly HC, permission hours' })
  async scheduleAnalysis(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('function') fn?: string, @Query('teamLeader') tl?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    if (fn) { p.push(fn); w += ` AND canon_fn(role_function)=canon_fn($${p.length})`; }
    if (tl) { p.push(tl); w += ` AND team_manager=$${p.length}`; }

    const [s] = await this.ds.query(`
      SELECT COUNT(*)::int scheduled,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='office')::int office,
             COUNT(*) FILTER (WHERE presence='wfh')::int wfh,
             COUNT(*) FILTER (WHERE presence='off')::int "off",
             COUNT(*) FILTER (WHERE presence='leave')::int "leave",
             COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent,
             COUNT(*) FILTER (WHERE presence='holiday')::int holiday,
             COUNT(*) FILTER (WHERE EXTRACT(DOW FROM work_date) IN (4,5,6))::int weekend,
             COUNT(*) FILTER (WHERE presence='off' AND EXTRACT(DOW FROM work_date) IN (4,5,6))::int "weekendOff",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             COUNT(DISTINCT person_no)::int people, COUNT(DISTINCT work_date)::int days
        FROM roster_days WHERE ${w}`, p);
    const cats = await this.ds.query(`SELECT ${SHIFT_CAT} cat, COUNT(*)::int n FROM roster_days WHERE ${w} AND presence IN ('office','wfh') GROUP BY 1`, p);
    const shiftRate: Record<string, number> = { Morning: 0, Night: 0, Evening: 0, Midnight: 0, Other: 0 };
    for (const c of cats) shiftRate[c.cat] = c.n;
    const byFn = await this.ds.query(`
      SELECT canon_fn(role_function) fn, COUNT(*)::int scheduled,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='off')::int "off",
             COUNT(*) FILTER (WHERE presence IN ('leave','sick','absent','holiday'))::int lost,
             COUNT(*) FILTER (WHERE presence='off' AND EXTRACT(DOW FROM work_date) IN (4,5,6))::int "weekendOff",
             COUNT(DISTINCT person_no)::int people
        FROM roster_days WHERE ${w} GROUP BY canon_fn(role_function) ORDER BY scheduled DESC`, p);
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);
    const fnOpts = await this.ds.query(`SELECT DISTINCT canon_fn(role_function) v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t]);

    // hourly scheduled headcount (avg concurrent by clock-hour, cross-midnight aware)
    const shifts = await this.ds.query(`SELECT shift_start_min ss, shift_end_min se FROM roster_days WHERE ${w} AND presence IN ('office','wfh') AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL`, p);
    // wrap-corrected 30-min sampling — canonical kernel in coverage-core (R2.1).
    const mins = sampledHourlyMinutes(shifts);
    const days = s.days || 1;
    const hourly = mins.map((pm, h) => ({ hour: h, avgHC: Math.round(pm / 60 / days * 10) / 10 }));

    // permission hours (parse the TEXT duration)
    const perms = await this.ds.query(`SELECT permission_duration d FROM roster_days WHERE ${w} AND permission_type IS NOT NULL AND permission_duration IS NOT NULL`, p);
    const permMin = perms.reduce((a: number, r: any) => a + this.parsePermMin(r.d), 0);

    // rates + shrinkage
    const HRS = 8; // net hours/day basis for shrinkage
    const schedulable = s.worked + s.leave + s.sick + s.absent + s.holiday; // = scheduled − off
    const lostHrs = (s.leave + s.sick + s.absent + s.holiday) * HRS + permMin / 60;
    const schedulableHrs = schedulable * HRS;
    const pct = (n: number, d: number) => d > 0 ? Math.round(1000 * n / d) / 10 : 0;
    return {
      from: dFrom, to: dTo, function: fn || null, teamLeader: tl || null,
      summary: {
        people: s.people, days: s.days, scheduled: s.scheduled, worked: s.worked, office: s.office, wfh: s.wfh,
        off: s.off, leave: s.leave, sick: s.sick, absent: s.absent, holiday: s.holiday,
        offPct: pct(s.off, s.scheduled), leavePct: pct(s.leave, s.scheduled), sickPct: pct(s.sick, s.scheduled),
        absentPct: pct(s.absent, s.scheduled), wfhPct: pct(s.wfh, s.worked),
        weekendOffPct: pct(s.weekendOff, s.off), weekendOff: s.weekendOff, weekend: s.weekend,
        shrinkagePct: pct(lostHrs, schedulableHrs), lostHrs: Math.round(lostHrs), schedulableHrs: Math.round(schedulableHrs),
        permissions: s.permissions, permissionHrs: Math.round(permMin / 60 * 10) / 10,
      },
      shiftRate, shiftRatePct: Object.fromEntries(Object.entries(shiftRate).map(([k, v]) => [k, pct(v as number, s.worked)])),
      byFunction: byFn.map((r: any) => ({ ...r, workedPct: pct(r.worked, r.scheduled), offPct: pct(r.off, r.scheduled), lostPct: pct(r.lost, r.scheduled) })),
      hourly,
      filterOptions: { functions: fnOpts.map((r: any) => r.v), teamLeaders: tlOpts.map((r: any) => r.v) },
    };
  }

  /** Interval Headcount — half-hourly staffing curve for a date, by function, over
   *  the clean roster_days. Cross-midnight aware: an MD/MN shift staffs the late
   *  hours of its own date AND the early hours of the next date; the previous day's
   *  overnight tail is folded into this date's 00:00–07:30. Scheduled vs present. */
  @Get('roster-v2/interval-headcount')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Half-hourly headcount by function for a date (scheduled vs present), cross-midnight aware' })
  async intervalHeadcount(@Req() req: any, @Query('date') date?: string, @Query('function') fn?: string, @Query('step') step = '30') {
    const t = req.user.tenantId;
    // latest day with real coverage (≥20 working rows), skipping marker-only tail days (lone RES/TER)
    const d = date || (await this.ds.query(
      `SELECT work_date::text b FROM roster_days WHERE tenant_id=$1 AND is_active AND presence IN ('office','wfh')
       GROUP BY work_date HAVING COUNT(*) > 20 ORDER BY work_date DESC LIMIT 1`, [t]))[0]?.b
      || (await this.ds.query(`SELECT MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0]?.b;
    const prev = new Date(d + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1); const dPrev = prev.toISOString().slice(0, 10);
    const stepMin = Math.max(15, Math.min(60, Number(step) || 30));
    const p: any[] = [t, dPrev, d]; let w = `tenant_id=$1 AND work_date IN ($2,$3) AND presence IN ('office','wfh') AND shift_start_min IS NOT NULL`;
    if (fn) { p.push(fn); w += ` AND canon_fn(role_function)=canon_fn($${p.length})`; }
    const rows = await this.ds.query(
      `SELECT work_date::text d, canon_fn(role_function) fn, is_active, shift_start_min ss,
              (CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440 ELSE shift_end_min END) se,
              sys_login_min li, sys_logout_min lo FROM roster_days WHERE ${w} AND is_active`, p);

    const fnSet = new Set<string>();
    const N = Math.floor(1440 / stepMin);
    // per interval: function → {scheduled, present}
    const grid: Record<string, { sched: Record<string, number>; pres: Record<string, number> }> = {};
    for (let i = 0; i < N; i++) grid[i] = { sched: {}, pres: {} };
    // does an interval starting at minute i0 (on date d) fall in this agent's window?
    // window [lo,hi) is on the row's own date; a previous-day row reaches d only via its
    // overnight tail (hi>1440). Canonical kernel: coverage-core.coversIntervalOnDate (R2.1).
    const covers = (rowDate: string, lo: number, hi: number, i0: number) => coversIntervalOnDate(rowDate, d, lo, hi, i0);
    for (const r of rows) {
      const f = r.fn || '—'; fnSet.add(f);
      for (let k = 0; k < N; k++) { const i0 = k * stepMin;
        if (covers(r.d, r.ss, r.se, i0)) grid[k].sched[f] = (grid[k].sched[f] || 0) + 1;
        // present uses actual login/logout (logout may be > login already; if logout<login it wrapped)
        let li = r.li, lo = r.lo; if (li != null && lo != null && lo < li) lo += 1440;
        if (li != null && lo != null && covers(r.d, li, lo, i0)) grid[k].pres[f] = (grid[k].pres[f] || 0) + 1;
      }
    }
    const functions = [...fnSet].sort();
    const intervals = Array.from({ length: N }, (_, k) => {
      const m = k * stepMin; const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const schedTotal = Object.values(grid[k].sched).reduce((a, b) => a + b, 0);
      const presTotal = Object.values(grid[k].pres).reduce((a, b) => a + b, 0);
      return { t: label, scheduled: grid[k].sched, present: grid[k].pres, scheduledTotal: schedTotal, presentTotal: presTotal };
    });
    const peak = intervals.reduce((mx, x) => x.scheduledTotal > mx.scheduledTotal ? x : mx, intervals[0]);
    return { date: d, function: fn || null, step: stepMin, functions, intervals, peak: { t: peak?.t, headcount: peak?.scheduledTotal } };
  }

  /** Permission / Leave HC Impact (daily) — per function for a date: planned working
   *  headcount vs what permission / sick / absent / leave / no-show take away, with a
   *  coverage% and risk level. Day-granularity (roster_days has no permission start/end). */
  @Get('roster-v2/coverage-impact')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-function daily coverage vs permission/sick/absent/no-show impact + risk' })
  async coverageImpact(@Req() req: any, @Query('date') date?: string, @Query('function') fn?: string) {
    const t = req.user.tenantId;
    // default to the latest day with REAL coverage (≥20 working rows), not the absolute MAX —
    // marker-only tail days (e.g. a lone RES/TER resignation marker) would otherwise show all-zeros.
    const d = date || (await this.ds.query(
      `SELECT work_date::text b FROM roster_days WHERE tenant_id=$1 AND is_active
         AND presence IN ('office','wfh','sick','absent')
       GROUP BY work_date HAVING COUNT(*) > 20 ORDER BY work_date DESC LIMIT 1`, [t]))[0]?.b
      || (await this.ds.query(`SELECT MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0]?.b;
    const p: any[] = [t, d]; let w = `tenant_id=$1 AND work_date=$2 AND is_active`;
    if (fn) { p.push(fn); w += ` AND canon_fn(role_function)=canon_fn($${p.length})`; }
    const rows = await this.ds.query(`
      SELECT canon_fn(role_function) fn,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence='sick' OR presence='absent')::int planned,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='office')::int office,
             COUNT(*) FILTER (WHERE presence='wfh')::int wfh,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND sys_login_min IS NOT NULL)::int present,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int on_permission,
             COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent,
             COUNT(*) FILTER (WHERE presence='leave')::int leave,
             COUNT(*) FILTER (WHERE presence='off')::int off
        FROM roster_days r WHERE ${w} GROUP BY canon_fn(role_function) ORDER BY planned DESC NULLS LAST`, p);
    const out = rows.filter((r: any) => r.fn).map((r: any) => {
      const lost = r.sick + r.absent;                      // rostered but didn't work
      const noShow = Math.max(0, r.worked - r.present);    // worked-roster but no system login
      const coverage = r.planned ? Math.round(100 * r.present / r.planned) : null;
      const risk = coverage == null ? 'n/a' : coverage >= 90 ? 'ok' : coverage >= 75 ? 'watch' : 'critical';
      return { ...r, lost, noShow, coverage, risk };
    });
    const tot = out.reduce((a: any, r: any) => { for (const k of ['planned', 'worked', 'present', 'on_permission', 'sick', 'absent', 'leave', 'off', 'lost', 'noShow']) a[k] = (a[k] || 0) + (r[k] || 0); return a; }, {});
    tot.coverage = tot.planned ? Math.round(100 * tot.present / tot.planned) : null;
    return { date: d, function: fn || null, rows: out, totals: tot };
  }

  // ── Schedule Change Log: manual shift edit / swap with before/after impact ──────
  /* SHIFT_CAT SQL classifier moved to roster-shared.service.ts (exported const). */
  private catOf(code: string): string {
    const c = (code || '').toUpperCase();
    if (/^(MD|MN)/.test(c)) return 'Midnight';
    if (/^(EE|E)/.test(c)) return 'Evening';
    if (/^N/.test(c)) return 'Night';
    if (/^(M|B|C|AM)/.test(c)) return 'Morning';
    return 'Other';
  }
  /** SET-clause fragment: when a manual edit/swap changes the scheduled window on a day that was
   *  actually WORKED (has punch/login), every metric derived against the OLD window (late/early/OT/
   *  adherence) is now wrong — NULL/zero it so no report shows a stale value; the next recon rebuild
   *  recomputes it correctly against the new window. Unworked/future days keep their values. */
  private staleMetricReset(): string {
    const ev = '(punch_in_min IS NOT NULL OR sys_login_min IS NOT NULL)';
    return `, sys_late_min=CASE WHEN ${ev} THEN NULL ELSE sys_late_min END`
      + `, sys_early_min=CASE WHEN ${ev} THEN NULL ELSE sys_early_min END`
      + `, late_min=CASE WHEN ${ev} THEN NULL ELSE late_min END`
      + `, early_min=CASE WHEN ${ev} THEN NULL ELSE early_min END`
      + `, adherence_pct=CASE WHEN ${ev} THEN NULL ELSE adherence_pct END`
      + `, late_category=CASE WHEN ${ev} THEN NULL ELSE late_category END`
      + `, ot_before_min=CASE WHEN ${ev} THEN 0 ELSE ot_before_min END`
      + `, ot_after_min=CASE WHEN ${ev} THEN 0 ELSE ot_after_min END`
      + `, ot_min=CASE WHEN ${ev} THEN 0 ELSE ot_min END`;
  }
  /** Canonical start/end (min) for a shift code, learned from existing roster rows. */
  private async resolveShiftTimes(t: string, code: string): Promise<{ ss: number | null; se: number | null }> {
    const [r] = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY shift_start_min) ss, mode() WITHIN GROUP (ORDER BY shift_end_min) se
         FROM roster_days WHERE tenant_id=$1 AND upper(shift_code)=upper($2) AND shift_start_min IS NOT NULL`, [t, code]);
    return { ss: r?.ss ?? null, se: r?.se ?? null };
  }
  /** Person's YTD shift-rate distribution (category → count) up to a date. */
  private async shiftRate(t: string, personNo: string, toDate: string): Promise<Record<string, number>> {
    const rows = await this.ds.query(
      `SELECT ${SHIFT_CAT} cat, COUNT(*)::int n FROM roster_days
         WHERE tenant_id=$1 AND person_no=$2 AND work_date<=$3 GROUP BY 1`, [t, personNo, toDate]);
    const out: Record<string, number> = { Morning: 0, Night: 0, Evening: 0, Midnight: 0, Other: 0 };
    for (const r of rows) out[r.cat] = r.n; return out;
  }
  /** Headcount-by-shift for a function on a date (coverage view). */
  private async coverageByShift(t: string, fn: string, date: string): Promise<Record<string, number>> {
    const rows = await this.ds.query(
      `SELECT shift_code, COUNT(DISTINCT person_no)::int n FROM roster_days
         WHERE tenant_id=$1 AND canon_fn(role_function)=canon_fn($2) AND work_date=$3 AND is_active AND presence IN ('office','wfh') GROUP BY shift_code`, [t, fn, date]);
    const out: Record<string, number> = {}; for (const r of rows) out[r.shift_code || '—'] = r.n; return out;
  }
  /** Manual-edit validation for change/swap (rule 6.4 female shifts + rule 6.6 ≥10h rest,
   *  cross-midnight aware). Returns the violation list — caller blocks unless override:true,
   *  in which case the violations are applied but flagged in the response + change log. */
  private async validateShiftChange(t: string, personNo: string, date: string, newCode: string,
    gender: string | null, ss: number | null, se: number | null): Promise<string[]> {
    const problems: string[] = [];
    if (String(gender || '').toLowerCase().startsWith('f')) {
      const cat = shiftCategoryFromCode(newCode);          // THE canonical classifier (common/shift-category)
      const endsAfter20 = se != null && Number(se) > 1200; // minutes from midnight; >1440 = cross-midnight (also past 20:00)
      if (cat === 'midnight') problems.push(`female rule: ${newCode} is a midnight shift (rule 6.4)`);
      else if (cat === 'night' || endsAfter20) problems.push(`female rule: ${newCode} ends after 20:00 (rule 6.4)`);
    }
    if (ss != null && se != null) {
      // 10h rest vs the adjacent roster days. Times are minutes from each row's OWN midnight
      // (end may exceed 1440 = cross-midnight), so +1440 bridges consecutive days.
      const adj = await this.ds.query(
        `SELECT work_date::text d, shift_start_min ss,
                (CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440 ELSE shift_end_min END) se
           FROM roster_days
           WHERE tenant_id=$1 AND person_no=$2 AND is_active AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL
             AND work_date IN ($3::date - 1, $3::date + 1)`, [t, personNo, date]);
      for (const a of adj) {
        // adjacent end is now wrap-corrected (canonical); guard against any raw legacy row too.
        const aSe = Number(a.se) <= Number(a.ss) ? Number(a.se) + 1440 : Number(a.se);
        const rest = a.d < date ? (1440 + Number(ss)) - aSe : (1440 + Number(a.ss)) - Number(se);
        if (rest < 600) problems.push(`rest rule: only ${Math.max(0, Math.round(rest / 6) / 10)}h rest vs ${a.d} (min 10h, rule 6.6)`);
      }
    }
    return problems;
  }
  /** Dual-write: mirror a roster_days shift change into attendance_records (the editable grid)
   *  for the same employee/date — only when a row exists there AND the code is in shift_codes. */
  private async mirrorShiftToAttendance(qr: QueryRunner, t: string, personNo: string, date: string, code: string) {
    await qr.query(
      `UPDATE attendance_records ar
          SET scheduled_shift_code_id = sc.id, scheduled_start = sc.start_time, scheduled_end = sc.end_time
         FROM employees e, shift_codes sc
        WHERE e.tenant_id=$1 AND e.employee_no=$2
          AND sc.tenant_id=$1 AND upper(sc.code)=upper($4)
          AND ar.tenant_id=$1 AND ar.employee_id=e.id AND ar.attendance_date=$3::date`,
      [t, personNo, date, code]);
  }

  @Post('roster-v2/schedule-change')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Apply a manual shift change to a (person, date) — logs before/after + impact' })
  async scheduleChange(@Req() req: any, @Body() b: { personNo: string; date: string; newShift: string; reason?: string; override?: boolean }) {
    rosterCacheInvalidate();
    const t = req.user.tenantId;
    if (!b?.personNo || !b?.date || !b?.newShift) throw new BadRequestException('personNo, date and newShift are required');
    await this.assertScheduleEditable(req, b.date);   // soft-lock: blocks non-supervisors in the approved range (audited via changed_by)
    const [cur] = await this.ds.query(
      `SELECT person_no, clean_name, role_function, shift_code, gender FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active LIMIT 1`, [t, b.personNo, b.date]);
    if (!cur) throw new BadRequestException('No roster row for that person/date');
    const oldShift = cur.shift_code;
    const { ss, se } = await this.resolveShiftTimes(t, b.newShift);
    // validate BEFORE applying: female rule (6.4) + 10h rest (6.6) — override:true applies anyway, flagged
    const violations = await this.validateShiftChange(t, b.personNo, b.date, b.newShift, cur.gender, ss, se);
    if (violations.length && !b.override) throw new BadRequestException(`Change blocked — ${violations.join('; ')}. Resend with override:true to apply anyway (flagged & logged).`);
    const rateBefore = await this.shiftRate(t, b.personNo, b.date);
    const covBefore = await this.coverageByShift(t, cur.role_function, b.date);
    // apply + mirror into attendance_records in ONE real transaction (QueryRunner — ds.query BEGIN/COMMIT is a fake txn)
    const qr = this.ds.createQueryRunner();
    await qr.connect(); await qr.startTransaction();
    try {
      await qr.query(
        `UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=COALESCE($5,shift_start_min), shift_end_min=COALESCE($6,shift_end_min)${this.staleMetricReset()}
           WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, b.personNo, b.date, b.newShift, ss, se]);
      await this.mirrorShiftToAttendance(qr, t, b.personNo, b.date, b.newShift);
      await qr.commitTransaction();
    } catch (e) { await qr.rollbackTransaction(); throw e; } finally { await qr.release(); }
    // after = before shifted by one day from old category to new category
    const rateAfter = { ...rateBefore }; const oc = this.catOf(oldShift), nc = this.catOf(b.newShift);
    rateAfter[oc] = Math.max(0, (rateAfter[oc] || 0) - 1); rateAfter[nc] = (rateAfter[nc] || 0) + 1;
    const covAfter = { ...covBefore }; if (oldShift) covAfter[oldShift] = Math.max(0, (covAfter[oldShift] || 0) - 1); covAfter[b.newShift] = (covAfter[b.newShift] || 0) + 1;
    const impact = { shiftRate: { before: rateBefore, after: rateAfter }, coverage: { function: cur.role_function, date: b.date, before: covBefore, after: covAfter }, violations };
    const [log] = await this.ds.query(
      `INSERT INTO schedule_change_log (tenant_id, change_type, work_date, person_no, person_name, old_shift, new_shift, reason, changed_by, approval_status, impact)
       VALUES ($1,'edit',$2,$3,$4,$5,$6,$7,$8,'applied',$9) RETURNING id`,
      [t, b.date, b.personNo, cur.clean_name, oldShift, b.newShift, b.reason || null, req.user.sub || req.user.userId || 'wfm', JSON.stringify(impact)]);
    return { ok: true, id: log.id, oldShift, newShift: b.newShift, violations, impact };
  }

  @Post('roster-v2/schedule-swap')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Swap shifts between two people on a date — logs both + before/after shift-rate' })
  async scheduleSwap(@Req() req: any, @Body() b: { personA: string; personB: string; date: string; reason?: string; override?: boolean }) {
    rosterCacheInvalidate();
    const t = req.user.tenantId;
    if (!b?.personA || !b?.personB || !b?.date) throw new BadRequestException('personA, personB and date are required');
    await this.assertScheduleEditable(req, b.date);   // soft-lock on the approved schedule range
    const rows = await this.ds.query(
      `SELECT person_no, clean_name, role_function, shift_code, shift_start_min, shift_end_min, gender FROM roster_days
         WHERE tenant_id=$1 AND person_no IN ($2,$3) AND work_date=$4 AND is_active`, [t, b.personA, b.personB, b.date]);
    const A = rows.find((r: any) => r.person_no === b.personA), B = rows.find((r: any) => r.person_no === b.personB);
    if (!A || !B) throw new BadRequestException('Both people must have a roster row on that date');
    // validate BOTH directions BEFORE touching anything: female rule (6.4) + 10h rest (6.6)
    const violations = [
      ...(await this.validateShiftChange(t, b.personA, b.date, B.shift_code, A.gender, B.shift_start_min, B.shift_end_min)).map((v: string) => `${A.clean_name}: ${v}`),
      ...(await this.validateShiftChange(t, b.personB, b.date, A.shift_code, B.gender, A.shift_start_min, A.shift_end_min)).map((v: string) => `${B.clean_name}: ${v}`),
    ];
    if (violations.length && !b.override) throw new BadRequestException(`Swap blocked — ${violations.join('; ')}. Resend with override:true to apply anyway (flagged & logged).`);
    const rateBeforeA = await this.shiftRate(t, b.personA, b.date), rateBeforeB = await this.shiftRate(t, b.personB, b.date);
    // swap shift code + times, mirroring both sides into attendance_records in ONE real transaction
    const qr = this.ds.createQueryRunner();
    await qr.connect(); await qr.startTransaction();
    try {
      await qr.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6${this.staleMetricReset()} WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, b.personA, b.date, B.shift_code, B.shift_start_min, B.shift_end_min]);
      await qr.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6${this.staleMetricReset()} WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, b.personB, b.date, A.shift_code, A.shift_start_min, A.shift_end_min]);
      await this.mirrorShiftToAttendance(qr, t, b.personA, b.date, B.shift_code);
      await this.mirrorShiftToAttendance(qr, t, b.personB, b.date, A.shift_code);
      await qr.commitTransaction();
    } catch (e) { await qr.rollbackTransaction(); throw e; } finally { await qr.release(); }
    const adj = (r: Record<string, number>, oldC: string, newC: string) => { const o = { ...r }; o[oldC] = Math.max(0, (o[oldC] || 0) - 1); o[newC] = (o[newC] || 0) + 1; return o; };
    const impact = {
      A: { before: rateBeforeA, after: adj(rateBeforeA, this.catOf(A.shift_code), this.catOf(B.shift_code)) },
      B: { before: rateBeforeB, after: adj(rateBeforeB, this.catOf(B.shift_code), this.catOf(A.shift_code)) },
      violations,
    };
    const [log] = await this.ds.query(
      `INSERT INTO schedule_change_log (tenant_id, change_type, work_date, person_no, person_name, person_b_no, person_b_name, old_shift, new_shift, old_shift_b, new_shift_b, reason, changed_by, approval_status, impact)
       VALUES ($1,'swap',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'applied',$13) RETURNING id`,
      [t, b.date, b.personA, A.clean_name, b.personB, B.clean_name, A.shift_code, B.shift_code, B.shift_code, A.shift_code, b.reason || null, req.user.sub || 'wfm', JSON.stringify(impact)]);
    return { ok: true, id: log.id, swapped: { [A.clean_name]: `${A.shift_code}→${B.shift_code}`, [B.clean_name]: `${B.shift_code}→${A.shift_code}` }, impact };
  }

  @Get('roster-v2/schedule-changes')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Schedule change/swap history log (newest first)' })
  async scheduleChanges(@Req() req: any, @Query('limit') limit = '100', @Query('person') person?: string) {
    const t = req.user.tenantId; const p: any[] = [t]; let w = `tenant_id=$1`;
    if (person) { p.push(`%${person.toLowerCase()}%`); w += ` AND (lower(person_name) LIKE $${p.length} OR person_no ILIKE $${p.length} OR lower(person_b_name) LIKE $${p.length})`; }
    const rows = await this.ds.query(
      `SELECT id, change_type, work_date::text date, person_no, person_name, person_b_no, person_b_name,
              old_shift, new_shift, old_shift_b, new_shift_b, reason, changed_by, approval_status, reverted, impact, created_at
         FROM schedule_change_log WHERE ${w} ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`, p);
    return { count: rows.length, rows };
  }

  @Post('roster-v2/schedule-change/:id/revert')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Revert a logged schedule change/swap — restores the prior shift(s)' })
  async scheduleRevert(@Req() req: any, @Query('id') idQ?: string) {
    const t = req.user.tenantId; const id = idQ || (req.params && req.params.id);
    const [log] = await this.ds.query(`SELECT * FROM schedule_change_log WHERE tenant_id=$1 AND id=$2`, [t, id]);
    if (!log) throw new NotFoundException('Change not found');
    if (log.reverted) return { ok: true, alreadyReverted: true };
    const rt = async (code: string) => this.resolveShiftTimes(t, code);
    if (log.change_type === 'swap') {
      const a = await rt(log.old_shift), bb = await rt(log.old_shift_b);
      await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6${this.staleMetricReset()} WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, log.person_no, log.work_date, log.old_shift, a.ss, a.se]);
      await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6${this.staleMetricReset()} WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, log.person_b_no, log.work_date, log.old_shift_b, bb.ss, bb.se]);
    } else {
      const a = await rt(log.old_shift);
      await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6${this.staleMetricReset()} WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, log.person_no, log.work_date, log.old_shift, a.ss, a.se]);
    }
    await this.ds.query(`UPDATE schedule_change_log SET reverted=true, approval_status='reverted', updated_at=now() WHERE tenant_id=$1 AND id=$2`, [t, id]);
    return { ok: true, reverted: true };
  }

}
