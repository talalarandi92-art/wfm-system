import { BadRequestException, Body, Controller, Get, Put, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { MATERNITY_7H, TRUE_OT, CRED_LATE, CRED_EARLY } from '@common/wfm-metrics';
import { RosterSharedService } from './roster-shared.service';

/* roster_days reports: the roster-v2 grid, roster dashboard, custom report
 * builder, manager notes, HR matrix CSV, integrity audit, team-leader table,
 * employee master, system audit and the multi-sheet MASTER Excel export — split
 * VERBATIM out of the monolithic ReconController (2026-07-07, EXECUTION_BRIEF
 * Phase-4). Same route prefix — zero route renames. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class RosterReportsController {
  constructor(
    private readonly shared: RosterSharedService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** Correct combined roster from roster_days (FingerPrint + Ameyo+Sprinklr +
   *  Odoo permission/comp/sick). Summary + paginated rows + filters. */
  @Get('roster-v2')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Correct combined daily roster (roster_days): summary + filtered, paginated rows' })
  async rosterV2(
    @Req() req: any,
    @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string,
    @Query('functionId') functionId?: string, @Query('presence') presence?: string,
    @Query('shift') shift?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('sort') sort?: string, @Query('limit') limit = '40', @Query('offset') offset = '0',
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0,7)}-01` : range?.a), dTo = to || range?.b;
    const params: any[] = [t, dFrom, dTo];
    let where = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3`;
    if (q) {
      // prefix-friendly: name matches at start-of-word (so "w" → "Aya Wahab"), username matches anywhere
      // ("wahab" → a.wahab), employee/person no match as prefix ("118…"). Lets typing a first letter list everyone.
      const ql = q.toLowerCase();
      const esc = ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      params.push(`(^|[\\s.])${esc}`); const pName = params.length;          // name / word-start regex
      params.push(`%${ql}%`);          const pHas  = params.length;          // username contains
      params.push(`${ql}%`);           const pPre  = params.length;          // id prefix
      where += ` AND (lower(COALESCE(r.clean_name,r.name)) ~ $${pName} OR r.username ILIKE $${pHas} OR r.employee_no ILIKE $${pPre} OR r.person_no ILIKE $${pPre})`;
    }
    if (presence) { params.push(presence); where += ` AND r.presence=$${params.length}`; }
    if (functionId) { params.push(functionId); where += ` AND canon_fn(r.role_function)=canon_fn((SELECT name FROM functions WHERE id=$${params.length}))`; }
    if (includeInactive !== '1') where += ` AND r.is_active`;

    // distinct shift codes available in the current scope (for the shift filter dropdown) — before the shift filter itself
    const shiftCodes = (await this.ds.query(
      `SELECT DISTINCT shift_code FROM roster_days r WHERE ${where} AND shift_code IS NOT NULL AND shift_code <> '' ORDER BY shift_code`, params)).map((r: any) => r.shift_code);
    // now apply the shift filter to summary + rows
    if (shift) { params.push(shift.toUpperCase()); where += ` AND upper(r.shift_code) = $${params.length}`; }

    const summary = (await this.ds.query(
      `SELECT COUNT(*)::int days,
              COUNT(*) FILTER (WHERE presence='office')::int office,
              COUNT(*) FILTER (WHERE presence='wfh')::int wfh,
              COUNT(*) FILTER (WHERE presence='off')::int off,
              COUNT(*) FILTER (WHERE presence='leave')::int leave,
              COUNT(*) FILTER (WHERE presence='absent')::int absent,
              COUNT(*) FILTER (WHERE ${CRED_LATE})::int late_days,
              COUNT(*) FILTER (WHERE ${CRED_EARLY})::int early_days,
              COUNT(*) FILTER (WHERE mismatch IS NOT NULL)::int mismatches,
              ROUND(SUM(${TRUE_OT})/60.0)::int ot_hours,
              ROUND(SUM(COALESCE(ot_min,0))/60.0)::int regular_ot_hours,
              ROUND(SUM(COALESCE(offday_ot_min,0))/60.0)::int offday_ot_hours,
              ROUND(SUM(COALESCE(holiday_ot_min,0))/60.0)::int holiday_ot_hours,
              COUNT(*) FILTER (WHERE COALESCE(offday_ot_min,0) > 0)::int offday_ot_days,
              COUNT(*) FILTER (WHERE (${TRUE_OT}) > 0)::int ot_days,
              ROUND(SUM(worked_min)/60.0)::int worked_hours,
              COUNT(*) FILTER (WHERE permission IS NOT NULL)::int permissions,
              COUNT(*) FILTER (WHERE sick IS NOT NULL)::int sick_days,
              ROUND(AVG(adherence_pct),1) conformance_pct
         FROM roster_days r WHERE ${where}`, params))[0];

    // OT by function (so the OT spotlight can highlight the heavy teams — e.g. Refund this month)
    const otByFunction = await this.ds.query(
      `SELECT canon_fn(COALESCE(r.role_function, r.function_name, '—')) fn,
              ROUND(SUM(${TRUE_OT})/60.0)::int ot_h,
              ROUND(SUM(COALESCE(offday_ot_min,0))/60.0)::int offday_h,
              COUNT(*) FILTER (WHERE (${TRUE_OT}) > 0)::int ot_days
         FROM roster_days r WHERE ${where} GROUP BY 1 HAVING SUM(${TRUE_OT}) > 0 ORDER BY ot_h DESC LIMIT 8`, params);

    // per-day trend for the hero sparkline: conformance% + present-count over the selected range
    const dailyTrend = await this.ds.query(
      `SELECT r.work_date::text date, ROUND(AVG(r.adherence_pct),1)::float conformance,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int present
         FROM roster_days r WHERE ${where} GROUP BY 1 ORDER BY 1`, params);

    const sortMap: Record<string,string> = { date_desc:'r.work_date DESC, r.name', date_asc:'r.work_date ASC, r.name',
      late:'r.sys_late_min DESC', early:'r.sys_early_min DESC', ot:'r.ot_min DESC', name:'r.name ASC, r.work_date DESC',
      adherence:'r.adherence_pct ASC NULLS LAST', mismatch:'(r.mismatch IS NOT NULL) DESC, r.work_date DESC' };
    const order = sortMap[sort||'date_desc'] || sortMap.date_desc;
    const lim = Math.min(Number(limit)||40, 50000), off = Number(offset)||0; // cap raised so "Export" can pull the full filtered range, not just one page
    const rows = await this.ds.query(
      `SELECT r.employee_no, COALESCE(r.person_no,r.employee_no) person_no, COALESCE(r.clean_name,r.name) name, r.username,
              COALESCE(r.role_function,r.function_name) function_name, r.role_category, r.expected_hours,
              r.work_date::text date, COALESCE(r.day_name, TRIM(TO_CHAR(r.work_date,'Day'))) day_name, r.status, r.presence,
              r.punch_in_min, r.punch_out_min, r.sys_login_min, r.sys_logout_min, r.sys_login2_min, r.sys_logout2_min, r.total_work_sys_min, r.login_src,
              r.late_min, r.early_min, r.ot_min, r.offday_ot_min, r.holiday_ot_min,
              (COALESCE(r.ot_min,0)+COALESCE(r.offday_ot_min,0)+COALESCE(r.holiday_ot_min,0)) total_ot,
              r.permission, r.permission_type, r.permission_duration, r.comp_off, r.sick, r.conforming,
              r.shift_code, r.attendance_code, r.hr_code, r.shift_category, r.shift_start_min, r.shift_end_min, r.sys_late_min, r.sys_early_min, r.adherence_pct, r.mismatch, r.data_quality, r.daily_note,
              r.team_manager, r.team_group, r.gender, r.worked_min, n.note
         FROM roster_days r
         LEFT JOIN roster_notes n ON n.tenant_id=r.tenant_id AND n.employee_no=r.employee_no AND n.work_date=r.work_date
        WHERE ${where} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, params);

    return { from: dFrom, to: dTo, range, total: summary.days, limit: lim, offset: off, summary, otByFunction, dailyTrend, shiftCodes, rows };
  }

  /** Highly-dynamic agent dashboard over roster_days: KPIs + rankings by every
   *  metric + distributions, with filters (date range, function, shift, team
   *  leader, team, presence, day, search). */
  @Get('roster-dashboard')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Dynamic roster dashboard: KPIs, rankings, distributions, filters' })
  async rosterDashboard(
    @Req() req: any,
    @Query('from') from?: string, @Query('to') to?: string, @Query('functionName') functionName?: string,
    @Query('shift') shift?: string, @Query('teamManager') teamManager?: string, @Query('team') team?: string,
    @Query('presence') presence?: string, @Query('day') day?: string, @Query('search') search?: string,
    @Query('role') role?: string, @Query('includeInactive') includeInactive?: string,
    @Query('includeExcludedRoles') includeExcludedRoles?: string, @Query('limit') limit = '10',
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0,7)}-01` : range?.a), dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo];
    let w = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3`;
    const add = (cond: string, val: any) => { p.push(val); return cond.replace('$$', `$${p.length}`); };
    // clean identity layer: real function (not the polluted column), role, and active state
    if (functionName) w += ` AND ${add('canon_fn(r.role_function)=canon_fn($$)', functionName)}`;
    if (role)         w += ` AND ${add('r.role_category=$$', role)}`;
    if (shift)        w += ` AND ${add('upper(r.shift_code) LIKE upper($$)', shift + '%')}`;
    if (teamManager)  w += ` AND ${add('r.team_manager=$$', teamManager)}`;
    if (team)         w += ` AND ${add('r.team_group=$$', team)}`;
    if (presence)     w += ` AND ${add('r.presence=$$', presence)}`;
    if (day)          w += ` AND ${add('r.day_name=$$', day)}`;
    if (search)       { p.push(`%${search.toLowerCase()}%`); w += ` AND (lower(r.clean_name) LIKE $${p.length} OR r.person_no ILIKE $${p.length})`; }
    // DEFAULT: exclude inactive/resigned humans from current KPIs (toggle to include).
    if (includeInactive !== '1') w += ` AND r.is_active`;
    // tardiness/adherence KPIs exclude 8h roles (RTA/Customer Care/Resolution/TL) by default — kept as records.
    const wTardy = w + (includeExcludedRoles === '1' ? '' : ' AND r.include_tardiness');
    const lim = Math.min(Number(limit) || 10, 50);

    const summary = (await this.ds.query(`
      SELECT COUNT(*)::int records, COUNT(DISTINCT person_no)::int agents, COUNT(DISTINCT work_date)::int days,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='office')::int office, COUNT(*) FILTER (WHERE presence='wfh')::int wfh,
             COUNT(*) FILTER (WHERE presence='off')::int off, COUNT(*) FILTER (WHERE presence='leave')::int leave,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int late_days, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int late_min,
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int early_days, COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int early_min,
             COALESCE(SUM(ot_before_min),0)::int ot_before, COALESCE(SUM(ot_after_min),0)::int ot_after,
             /* PAYABLE OT — the same definition the OT & Exceptions report uses.
                This summed ALL OT including supervisory rows flagged ot_record_only
                (BR-ROL-002: recorded, never paid), so the dashboard read 16,440h
                against the report's 16,388h for the identical period. Two roster
                screens quoting two OT totals is precisely what dashboard principle
                P-3 forbids. The record-only minutes are not hidden — they are
                returned beside it so the difference is visible, not silent. */
             COALESCE(SUM(${TRUE_OT}) FILTER (WHERE NOT COALESCE(ot_record_only,false)),0)::int ot_total,
             COALESCE(SUM(${TRUE_OT}) FILTER (WHERE COALESCE(ot_record_only,false)),0)::int ot_record_only_min,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days r WHERE ${w}`, p))[0];

    // Rank by the canonical PERSON (person_no) so an old/new intern-id pair or a
    // leaked shift-code-in-function can NEVER split one human into two rows. Names
    // and functions come from the clean identity layer (clean_name / role_function).
    const REP = `mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) function_name, mode() WITHIN GROUP (ORDER BY role_category) role, mode() WITHIN GROUP (ORDER BY team_manager) team_manager`;
    const rankW = (where: string, sel: string, order: string) => this.ds.query(
      `SELECT person_no employee_no, ${REP}, ${sel} v FROM roster_days r WHERE ${where} AND r.person_no IS NOT NULL
        GROUP BY person_no HAVING ${order.split(' ')[0]}<>0 ORDER BY ${order} LIMIT ${lim}`, p)
      .catch(() => this.ds.query(`SELECT person_no employee_no, ${REP}, ${sel} v FROM roster_days r WHERE ${where} AND r.person_no IS NOT NULL GROUP BY person_no ORDER BY ${order} LIMIT ${lim}`, p));
    const rank = (sel: string, order: string) => rankW(w, sel, order);

    const [mostLate, mostEarly, otAfter, otBefore, mostAbsent, mostSick, lowestConf, mostPerm] = await Promise.all([
      rankW(wTardy, `COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int`, `SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}) DESC NULLS LAST`),   // 8h roles excluded + cross-midnight bleed capped at 240min
      rankW(wTardy, `COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int`, `SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}) DESC NULLS LAST`),
      rank(`SUM(ot_after_min)::int`, `SUM(ot_after_min) DESC`),
      rank(`SUM(ot_before_min)::int`, `SUM(ot_before_min) DESC`),
      rank(`COUNT(*) FILTER (WHERE presence='absent')::int`, `COUNT(*) FILTER (WHERE presence='absent') DESC`),
      rank(`COUNT(*) FILTER (WHERE presence='sick')::int`, `COUNT(*) FILTER (WHERE presence='sick') DESC`),
      this.ds.query(`SELECT person_no employee_no, ${REP}, ROUND(AVG(adherence_pct),1) v FROM roster_days r WHERE ${wTardy} AND adherence_pct IS NOT NULL AND r.person_no IS NOT NULL GROUP BY person_no HAVING COUNT(*) FILTER (WHERE adherence_pct IS NOT NULL)>=3 ORDER BY AVG(adherence_pct) ASC LIMIT ${lim}`, p),
      rank(`COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int`, `COUNT(*) FILTER (WHERE permission_type IS NOT NULL) DESC`),
    ]);

    const dist = async (col: string) => this.ds.query(
      `SELECT COALESCE(${col},'—') k, COUNT(*)::int n, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
              ROUND(AVG(adherence_pct),1) conformance, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int late, COALESCE(SUM(ot_after_min),0)::int ot_after
         FROM roster_days r WHERE ${w} GROUP BY ${col} ORDER BY n DESC`, p);
    const [byShift, byFunction, byRole, byTeamManager, byPresence] = await Promise.all([
      dist('shift_code'), dist('canon_fn(role_function)'), dist('role_category'), dist('team_manager'), dist('presence'),
    ]);

    // filter dropdown options (real function + role from the clean layer)
    const opts = (col: string) => this.ds.query(`SELECT DISTINCT ${col} v FROM roster_days WHERE tenant_id=$1 AND ${col} IS NOT NULL ORDER BY 1`, [t]);
    const [functions, roles, shifts, teams, days] = await Promise.all([
      opts('canon_fn(role_function)'), opts('role_category'), opts('shift_code'), opts('team_group'), opts('day_name'),
    ]);

    // Team-leader audit: a team_manager label is a VERIFIED current TL only if it maps
    // (spelling-tolerant) to an active canonical employee. Unmatched labels (e.g. a TL
    // who left, or a non-agent owner label) are surfaced as a data-quality exception and
    // kept OUT of the current-TL dropdown — fixes "people who left still shown as TL".
    const tlRows = await this.ds.query(
      `SELECT r.team_manager name, COUNT(DISTINCT r.person_no)::int reports,
              MIN(r.work_date)::text first_seen, MAX(r.work_date)::text last_seen,
              i.person_no matched, i.is_active matched_active
         FROM roster_days r
         LEFT JOIN employee_identity i
           ON i.tenant_id=r.tenant_id AND i.is_canonical AND i.role_category='Team Leader'
          AND replace(lower(i.clean_name),' ','') = replace(lower(r.team_manager),' ','')
        WHERE r.tenant_id=$1 AND r.team_manager IS NOT NULL AND r.team_manager<>''
        GROUP BY r.team_manager, i.person_no, i.is_active ORDER BY reports DESC`, [t]);
    const { tlStatus } = await this.shared.tlResolver(t);
    const teamLeaders = tlRows.map((r:any)=>{ const s = tlStatus(r.name, r.matched_active);
      return { name: r.name, reports: r.reports, firstSeen: r.first_seen, lastSeen: r.last_seen, ...s }; }).filter((x:any)=>!x.hidden);
    const teamManagers = teamLeaders.filter((x:any)=>x.verified).map((x:any)=>x.name);

    return {
      from: dFrom, to: dTo, range, summary,
      rankings: { mostLate, mostEarly, otAfter, otBefore, mostAbsent, mostSick, lowestConformance: lowestConf, mostPermissions: mostPerm },
      distributions: { byShift, byFunction, byRole, byTeamManager, byPresence },
      filterOptions: { functions: functions.map((r:any)=>r.v), roles: roles.map((r:any)=>r.v), shifts: shifts.map((r:any)=>r.v), teamManagers, teams: teams.map((r:any)=>r.v), days: days.map((r:any)=>r.v) },
      teamLeaders,
    };
  }

  /** Custom Report Builder — pick fields OR (groupBy + KPIs), any filters, date
   *  range; returns {columns, rows}. format=xlsx streams an Excel file. */
  @Get('report-builder')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Custom report builder: choose fields/KPIs/groupBy/filters; JSON or xlsx' })
  async reportBuilder(@Req() req: any, @Res({ passthrough: true }) res: any, @Query() q: any) {
    const t = req.user.tenantId;
    // detail field map (key → {col, label, kind})
    const F: Record<string, { col: string; label: string; time?: boolean }> = {
      date:{col:'work_date::text',label:'Date'}, day:{col:'day_name',label:'Day'}, week:{col:'week_number',label:'Week'},
      month:{col:'month_name',label:'Month'}, agent:{col:'COALESCE(clean_name,name)',label:'Agent'}, agentId:{col:'COALESCE(person_no,employee_no)',label:'Agent ID'},
      function:{col:'COALESCE(role_function,function_name)',label:'Function'}, role:{col:'role_category',label:'Role'}, expectedHours:{col:'expected_hours',label:'Expected Hrs'},
      active:{col:`CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END`,label:'Status'},
      teamLeader:{col:'team_manager',label:'Team Leader'}, group:{col:'team_group',label:'Group'},
      gender:{col:'gender',label:'Gender'}, location:{col:'location',label:'Location'},
      shiftCode:{col:'shift_code',label:'Shift'}, originalShift:{col:'original_shift_code',label:'Original Shift'},
      shiftStart:{col:'shift_start_min',label:'Shift Start',time:true}, shiftEnd:{col:'shift_end_min',label:'Shift End',time:true},
      shiftStartHour:{col:'FLOOR((shift_start_min%1440)/60.0)::int',label:'Shift Start Hour'},
      attendanceStatus:{col:'attendance_status',label:'Attendance Status'}, hrStatus:{col:'hr_code',label:'HR Code'},
      punchIn:{col:'punch_in_min',label:'Punch In',time:true}, punchOut:{col:'punch_out_min',label:'Punch Out',time:true},
      sysLogin:{col:'sys_login_min',label:'Sys Login',time:true}, sysLogout:{col:'sys_logout_min',label:'Sys Logout',time:true},
      systemSource:{col:'login_src',label:'Sys Source'}, workedMin:{col:'worked_min',label:'Worked (min)'},
      lateMin:{col:'sys_late_min',label:'Late (min)'}, lateCategory:{col:'late_category',label:'Late Category'}, earlyMin:{col:'sys_early_min',label:'Early Out (min)'},
      otBefore:{col:'ot_before_min',label:'OT Before'}, otAfter:{col:'ot_after_min',label:'OT After'}, otTotal:{col:'(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))',label:'OT Total'},
      offdayOt:{col:'offday_ot_min',label:'OFF-day OT'}, holidayOt:{col:'holiday_ot_min',label:'Holiday OT'},
      conformance:{col:'adherence_pct',label:'Conformance %'}, permission:{col:'permission_type',label:'Permission'},
      permissionDuration:{col:'permission_duration',label:'Permission Dur'}, dataQuality:{col:'data_quality',label:'Data Quality'}, crossesMidnight:{col:'crosses_midnight',label:'X-Midnight'},
      // official scorecard scores (per-person, joined) — available as detail columns too
      netPoints:{col:'ROUND(sc.net,1)',label:'Net Points'}, scQuality:{col:'ROUND(sc.quality,1)',label:'Quality (pts)'}, scAht:{col:'ROUND(sc.aht,1)',label:'AHT (pts)'},
      scFcr:{col:'ROUND(sc.fcr,1)',label:'FCR (pts)'}, scProductivity:{col:'ROUND(sc.prod,1)',label:'Productivity (pts)'}, scCtr:{col:'ROUND(sc.ctr,1)',label:'CTR (pts)'},
      scQuiz:{col:'ROUND(sc.quiz,1)',label:'Quiz (pts)'}, scPrr:{col:'ROUND(sc.prr,1)',label:'PRR (pts)'}, scRes:{col:'ROUND(sc.res,1)',label:'RES %'},
      scResponseTime:{col:'ROUND(sc.rt,1)',label:'Resp Time (pts)'}, scMistakes:{col:'ROUND(sc.mist,1)',label:'Mistakes (pts)'}, scIncidents:{col:'ROUND(sc.inc,1)',label:'Incidents (pts)'}, scAttendance:{col:'ROUND(sc.att,1)',label:'Attendance (pts)'},
    };
    // KPI map (key → {agg, label})
    const K: Record<string, { agg: string; label: string }> = {
      scheduledDays:{agg:'COUNT(*)',label:'Scheduled Days'}, workedDays:{agg:`COUNT(*) FILTER (WHERE presence IN ('office','wfh'))`,label:'Worked Days'},
      offDays:{agg:`COUNT(*) FILTER (WHERE presence='off')`,label:'OFF Days'}, holidayDays:{agg:`COUNT(*) FILTER (WHERE presence='holiday')`,label:'Holiday Days'},
      leaveDays:{agg:`COUNT(*) FILTER (WHERE presence='leave')`,label:'Leave Days'}, sickDays:{agg:`COUNT(*) FILTER (WHERE presence='sick')`,label:'Sick Days'},
      absenceDays:{agg:`COUNT(*) FILTER (WHERE presence='absent')`,label:'Absence Days'}, wfhDays:{agg:`COUNT(*) FILTER (WHERE presence='wfh')`,label:'WFH Days'},
      officeDays:{agg:`COUNT(*) FILTER (WHERE presence='office')`,label:'Office Days'},
      shrinkageDays:{agg:`COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))`,label:'Shrinkage Days'},
      earlyDays:{agg:`COUNT(*) FILTER (WHERE ${CRED_EARLY})`,label:'Early-Out Days'},
      coveragePct:{agg:`ROUND(100.0*COUNT(*) FILTER (WHERE presence IN ('office','wfh'))/NULLIF(COUNT(*) FILTER (WHERE shift_start_min IS NOT NULL),0),1)`,label:'Coverage %'},
      shrinkagePct:{agg:`ROUND(100.0*COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))/NULLIF(COUNT(*) FILTER (WHERE shift_start_min IS NOT NULL),0),1)`,label:'Shrinkage %'},
      permissionCount:{agg:`COUNT(*) FILTER (WHERE permission_type IS NOT NULL)`,label:'Permissions'}, compDays:{agg:`COUNT(*) FILTER (WHERE comp_off IS NOT NULL OR comp_worked_min>0)`,label:'COMP Days'},
      lateMin:{agg:'SUM(sys_late_min) FILTER (WHERE sys_late_min BETWEEN 7 AND 240)',label:'Late (min)'}, lateDays:{agg:'COUNT(*) FILTER (WHERE sys_late_min BETWEEN 7 AND 240)',label:'Late Days'},
      earlyMin:{agg:`SUM(sys_early_min) FILTER (WHERE sys_early_min BETWEEN 7 AND 240 AND COALESCE(person_no,employee_no) NOT IN ${MATERNITY_7H})`,label:'Early Out (min)'}, otMin:{agg:'SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))',label:'OT (min)'},
      otBefore:{agg:'SUM(ot_before_min)',label:'OT Before (min)'}, otAfter:{agg:'SUM(ot_after_min)',label:'OT After (min)'},
      offdayOt:{agg:'SUM(offday_ot_min)',label:'OFF-day OT'}, holidayOt:{agg:'SUM(holiday_ot_min)',label:'Holiday OT'},
      avgLate:{agg:'ROUND(AVG(sys_late_min) FILTER (WHERE sys_late_min BETWEEN 7 AND 240))',label:'Avg Late'}, avgWorked:{agg:'ROUND(AVG(worked_min) FILTER (WHERE worked_min>0))',label:'Avg Worked (min)'},
      conformance:{agg:'ROUND(AVG(adherence_pct),1)',label:'Conformance %'}, missingPunch:{agg:'COUNT(*) FILTER (WHERE missing_punch)',label:'Missing Punch'},
      missingSystem:{agg:'COUNT(*) FILTER (WHERE missing_system)',label:'Missing System'}, mismatch:{agg:'COUNT(*) FILTER (WHERE mismatch IS NOT NULL)',label:'Mismatch'},
      agents:{agg:'COUNT(DISTINCT COALESCE(person_no,employee_no))',label:'Agents'},
      // official scorecard (joined per-person via the sc CTE) — Net Points + KPI scores.
      // PERSON-weighted, not day-weighted: sc values are constant per person, so averaging over
      // every roster day made a 22-day agent count 22×. The grouped query adds sc_rn = ROW_NUMBER()
      // per (person, group); FILTER (sc_rn=1) counts each person exactly ONCE per group.
      netPoints:{agg:'ROUND(AVG(sc.net) FILTER (WHERE sc_rn=1),1)',label:'Net Points'}, scQuality:{agg:'ROUND(AVG(sc.quality) FILTER (WHERE sc_rn=1),1)',label:'Quality (pts)'},
      scAht:{agg:'ROUND(AVG(sc.aht) FILTER (WHERE sc_rn=1),1)',label:'AHT (pts)'}, scFcr:{agg:'ROUND(AVG(sc.fcr) FILTER (WHERE sc_rn=1),1)',label:'FCR (pts)'},
      scProductivity:{agg:'ROUND(AVG(sc.prod) FILTER (WHERE sc_rn=1),1)',label:'Productivity (pts)'}, scCtr:{agg:'ROUND(AVG(sc.ctr) FILTER (WHERE sc_rn=1),1)',label:'CTR (pts)'}, scQuiz:{agg:'ROUND(AVG(sc.quiz) FILTER (WHERE sc_rn=1),1)',label:'Quiz (pts)'},
      scPrr:{agg:'ROUND(AVG(sc.prr) FILTER (WHERE sc_rn=1),1)',label:'PRR (pts)'}, scRes:{agg:'ROUND(AVG(sc.res) FILTER (WHERE sc_rn=1),1)',label:'RES %'}, scResponseTime:{agg:'ROUND(AVG(sc.rt) FILTER (WHERE sc_rn=1),1)',label:'Response Time (pts)'},
      scMistakes:{agg:'ROUND(AVG(sc.mist) FILTER (WHERE sc_rn=1),1)',label:'Mistakes (pts)'}, scIncidents:{agg:'ROUND(AVG(sc.inc) FILTER (WHERE sc_rn=1),1)',label:'Incidents (pts)'}, scAttendance:{agg:'ROUND(AVG(sc.att) FILTER (WHERE sc_rn=1),1)',label:'Attendance (pts)'},
    };
    const G: Record<string, { col: string; label: string }> = {
      day:{col:'day_name',label:'Day'}, week:{col:'week_number',label:'Week'}, month:{col:'month_name',label:'Month'}, date:{col:'work_date::text',label:'Date'},
      agent:{col:'COALESCE(clean_name,name)',label:'Agent'}, function:{col:'COALESCE(role_function,function_name)',label:'Function'}, role:{col:'role_category',label:'Role'}, teamLeader:{col:'team_manager',label:'Team Leader'},
      group:{col:'team_group',label:'Group'}, shift:{col:'shift_code',label:'Shift'}, status:{col:'attendance_status',label:'Attendance Status'}, lateCategory:{col:'late_category',label:'Late Category'},
      shiftStartHour:{col:'FLOOR((shift_start_min%1440)/60.0)::int',label:'Shift Start Hour'},
    };

    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const p: any[] = [t, q.from || range?.a, q.to || range?.b];
    let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3`;
    // function filter folds interns into the parent (headcount rule); strip the incoming label too so
    // a raw "Internship …" still matches. (The groupBy/detail function COLUMN stays raw — analysts keep the breakdown.)
    if (q.function) q.function = String(q.function).replace(/^\s*[Ii]nternship\s+/, '');
    const FILT: Record<string, string> = { function:'canon_fn(role_function)', role:'role_category', teamLeader:'team_manager', group:'team_group', shift:'shift_code',
      attendanceStatus:'attendance_status', hrStatus:'hr_code', presence:'presence', lateCategory:'late_category', systemSource:'login_src',
      day:'day_name', month:'month_name', dataQuality:'data_quality', person:'person_no' };
    for (const [k, col] of Object.entries(FILT)) if (q[k]) { p.push(q[k]); w += ` AND ${col}=$${p.length}`; }
    if (q.week) { p.push(Number(q.week)); w += ` AND week_number=$${p.length}`; }
    for (const b of ['wfh','sick','absent']) if (q[b]==='1') w += ` AND presence='${b}'`;
    if (q.permission==='1') w += ` AND permission_type IS NOT NULL`;
    if (q.comp==='1') w += ` AND (comp_off IS NOT NULL OR comp_worked_min>0)`;
    // DEFAULT: exclude inactive/superseded ids; tardiness filter excludes 8h roles unless asked.
    if (q.includeInactive !== '1') w += ` AND is_active`;
    if (q.onlyTardiness === '1') w += ` AND include_tardiness`;
    if (q.search) { p.push(`%${String(q.search).toLowerCase()}%`); w += ` AND (lower(COALESCE(clean_name,name)) LIKE $${p.length} OR employee_no ILIKE $${p.length} OR person_no ILIKE $${p.length})`; }

    const timeFn = (m: number|null) => m==null?'':`${String(Math.floor((((m%1440)+1440)%1440)/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    let columns: { key: string; label: string }[] = []; let rows: any[] = [];
    // per-person official scorecard aggregate (Net Points + KPI scores), 1:1 joinable to roster_days
    // by person_no via a clash-free alias (sc_person) so existing aggregates are unaffected.
    const SC = `WITH sc AS (SELECT i.person_no sc_person, AVG(se.net_points) net, AVG(se.quality_score) quality,
        AVG(se.aht_score) aht, AVG(se.fcr_score) fcr, AVG(se.productivity_score) prod, AVG(se.ctr_score) ctr, AVG(se.quiz_score) quiz,
        AVG(se.prr_points) prr, AVG(se.response_rate::numeric)*100 res, AVG(se.response_time_score) rt,
        AVG(se.mistakes_score) mist, AVG(se.incidents_score) inc, AVG(se.attendance_score) att
      FROM scorecard_entries se JOIN employee_identity i ON i.tenant_id=se.tenant_id AND i.employee_no=se.employee_no
      WHERE se.tenant_id=$1 GROUP BY i.person_no)`;
    const FROM = `roster_days LEFT JOIN sc ON sc.sc_person = roster_days.person_no`;

    if (q.groupBy && G[q.groupBy]) {
      const g = G[q.groupBy];
      const kpis = String(q.kpis||'scheduledDays,workedDays,lateMin,otMin,conformance').split(',').filter(k=>K[k]);
      columns = [{ key:'group', label:g.label }, ...kpis.map(k=>({ key:k, label:K[k].label }))];
      const sel = [`${g.col} AS "group"`, ...kpis.map(k=>`${K[k].agg} AS "${k}"`)].join(', ');
      // sc_rn = one row per (person, group) so the sc-CTE scorecard KPIs are PERSON-weighted; the
      // filters move inside the subquery (they reference roster_days columns only), everything else identical.
      const FROM_G = `(SELECT rd.*, ROW_NUMBER() OVER (PARTITION BY rd.person_no, ${g.col.replace(/\broster_days\./g, 'rd.')}) AS sc_rn FROM roster_days rd WHERE ${w}) roster_days LEFT JOIN sc ON sc.sc_person = roster_days.person_no`;
      rows = await this.ds.query(`${SC} SELECT ${sel} FROM ${FROM_G} GROUP BY ${g.col} ORDER BY 2 DESC NULLS LAST LIMIT 500`, p);
    } else {
      const fields = String(q.fields||'date,agent,function,shiftCode,attendanceStatus,lateMin,otBefore,otAfter,conformance').split(',').filter(k=>F[k]);
      columns = fields.map(k=>({ key:k, label:F[k].label }));
      const sel = fields.map(k=>`${F[k].col} AS "${k}"`).join(', ');
      const lim = q.format==='xlsx' ? 50000 : 1000;
      const raw = await this.ds.query(`${SC} SELECT ${sel} FROM ${FROM} WHERE ${w} ORDER BY work_date DESC, name LIMIT ${lim}`, p);
      rows = raw.map((r: any) => { const o:any={}; for (const k of fields) o[k] = F[k].time ? timeFn(r[k]) : r[k]; return o; });
    }

    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Custom Report');
      ws.columns = columns.map(c => ({ header: c.label, key: c.key, width: 16 }));
      ws.getRow(1).font = { bold:true, color:{argb:'FFFFFFFF'} }; ws.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF4F46E5'} };
      ws.views = [{ state:'frozen', ySplit:1 }]; rows.forEach(r => ws.addRow(r));
      res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="custom-report.xlsx"`);
      return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    return { from: p[1], to: p[2], mode: q.groupBy?'summary':'detail', count: rows.length, columns, rows,
      catalog: { fields: Object.entries(F).map(([k,v])=>({key:k,label:v.label})), kpis: Object.entries(K).map(([k,v])=>({key:k,label:v.label})), groups: Object.entries(G).map(([k,v])=>({key:k,label:v.label})) } };
  }

  /** Save a manager note for a roster day (survives roster_days re-imports). */
  @Put('roster-v2/note')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Set/clear a manager note on a roster day' })
  async rosterNote(@Req() req: any, @Body() b: { employeeNo: string; date: string; note: string }) {
    await this.ds.query(
      `INSERT INTO roster_notes (tenant_id, employee_no, work_date, note, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (tenant_id, employee_no, work_date) DO UPDATE SET note=EXCLUDED.note, updated_at=now()`,
      [req.user.tenantId, b.employeeNo, b.date, b.note || null]);
    return { ok: true };
  }




  /** HR matrix: employee rows × date columns → presence/status code, as CSV. */
  @Get('roster-v2/hr-matrix')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'HR matrix (employee × date → status) CSV for the window' })
  async rosterHrMatrix(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0,7)}-01` : range?.a), dTo = to || range?.b;
    const data = await this.ds.query(
      `SELECT COALESCE(person_no, employee_no) person_no, COALESCE(clean_name, name) name, role_function function_name, work_date::text date,
              COALESCE(hr_code, attendance_code, shift_code, 'OFF') code   -- master HR code (SL/A/shift/OFF/L/H/WFH/DL/COMP) — never invents P
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active   -- exclude superseded/inactive ids (dedupes old↔new intern IDs)
         ORDER BY name, work_date`, [t, dFrom, dTo]);
    // Per-employee OT & exceptions roll-up over the window — same canonical rules as
    // every other report: TRUE_OT (regular+off-day+holiday) and credible (≤4h) tardiness.
    const agg = await this.ds.query(
      `SELECT COALESCE(person_no, employee_no) person_no,
              ROUND(SUM(${TRUE_OT})/60.0,1) ot_h,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked_d,
              COUNT(*) FILTER (WHERE ${CRED_LATE})::int late_d,
              COUNT(*) FILTER (WHERE ${CRED_EARLY})::int early_d,
              COUNT(*) FILTER (WHERE presence='absent')::int absent_d,
              COUNT(*) FILTER (WHERE presence='sick')::int sick_d,
              COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int perm_d
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active GROUP BY 1`, [t, dFrom, dTo]);
    const aggMap = new Map<string, any>(agg.map((r: any) => [r.person_no, r]));
    const dates: string[] = []; { const d = new Date(dFrom + 'T00:00:00Z'), end = new Date(dTo + 'T00:00:00Z');
      for (; d <= end; d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10)); }
    const byEmp = new Map<string, any>();
    for (const r of data) { let e = byEmp.get(r.person_no); if (!e) { e = { no: r.person_no, name: r.name, fn: r.function_name, days: {} }; byEmp.set(r.person_no, e); } e.days[r.date] = r.code; }
    const head = ['Employee No', 'Name', 'Function', ...dates.map(d => d.slice(5)), 'OT (h)', 'Worked', 'Late', 'Early', 'Absent', 'Sick', 'Perm'];
    const lines = [...byEmp.values()].map(e => { const a = aggMap.get(e.no) || {};
      return [e.no, `"${e.name}"`, `"${e.fn||''}"`, ...dates.map(d => e.days[d] || ''),
              a.ot_h ?? 0, a.worked_d ?? 0, a.late_d ?? 0, a.early_d ?? 0, a.absent_d ?? 0, a.sick_d ?? 0, a.perm_d ?? 0].join(','); });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="hr-matrix_${dFrom}_${dTo}.csv"`);
    res.send('﻿' + [head.join(','), ...lines].join('\n'));
  }

  /** Data-integrity & exceptions audit over the clean identity layer:
   *  duplicate humans merged, inactive/superseded ids, roster orphans, function
   *  pollution, role-hours lookup, and the team-leader verification audit. */
  @Get('roster-v2/integrity')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Data integrity audit: duplicates, inactive, orphans, role-hours, TL verification' })
  async integrity(@Req() req: any) {
    const t = req.user.tenantId;
    const [headline] = await this.ds.query(
      `SELECT (SELECT COUNT(*)::int FROM employee_identity WHERE tenant_id=$1) raw_ids,
              (SELECT COUNT(DISTINCT person_no)::int FROM employee_identity WHERE tenant_id=$1) persons,
              (SELECT COUNT(*)::int FROM employee_identity WHERE tenant_id=$1 AND NOT is_canonical) aliases,
              (SELECT COUNT(DISTINCT person_no)::int FROM employee_identity WHERE tenant_id=$1 AND NOT is_active) inactive_persons,
              (SELECT COUNT(*)::int FROM roster_days WHERE tenant_id=$1) roster_rows,
              (SELECT COUNT(*)::int FROM roster_days WHERE tenant_id=$1 AND person_no IS NULL) unstamped`, [t]);
    // Duplicate_Agent_Audit — one row per merged human, listing every raw id
    const duplicates = await this.ds.query(
      `SELECT person_no, clean_name,
              json_agg(json_build_object('employee_no',employee_no,'status',status,'is_canonical',is_canonical) ORDER BY is_canonical DESC) ids,
              COUNT(*)::int id_count
         FROM employee_identity WHERE tenant_id=$1
         GROUP BY person_no, clean_name HAVING COUNT(*)>1 ORDER BY id_count DESC, clean_name`, [t]);
    // Inactive_Employee_Exceptions — raw ids whose own status is inactive/superseded
    const inactiveIds = await this.ds.query(
      `SELECT employee_no, clean_name, person_no, status, alias_of FROM employee_identity
        WHERE tenant_id=$1 AND (status<>'active' OR NOT is_canonical) ORDER BY clean_name`, [t]);
    // roster ids never matched to the master
    const orphans = await this.ds.query(
      `SELECT DISTINCT r.employee_no, r.name FROM roster_days r LEFT JOIN employees e
         ON e.tenant_id=r.tenant_id AND e.employee_no=r.employee_no
        WHERE r.tenant_id=$1 AND e.id IS NULL ORDER BY r.employee_no`, [t]);
    // function-name pollution: how often the source column held a shift/leave code
    const [pollution] = await this.ds.query(
      `SELECT COUNT(*)::int rows,
              COUNT(*) FILTER (WHERE function_name <> COALESCE(role_function,'') )::int mismatched,
              COUNT(*) FILTER (WHERE role_function IS NULL)::int no_clean_function
         FROM roster_days WHERE tenant_id=$1`, [t]);
    const roleHours = await this.ds.query(
      `SELECT role_category, default_hours, include_tardiness, include_overtime, include_adherence, include_kpi, notes
         FROM role_working_hours WHERE tenant_id=$1 ORDER BY default_hours DESC, role_category`, [t]);
    // Team-leader verification (same alias-tolerant logic as the dashboard audit)
    const tlRows = await this.ds.query(
      `SELECT r.team_manager name, COUNT(DISTINCT r.person_no)::int reports,
              MIN(r.work_date)::text first_seen, MAX(r.work_date)::text last_seen,
              bool_or(i.is_active) matched
         FROM roster_days r
         LEFT JOIN employee_identity i ON i.tenant_id=r.tenant_id AND i.is_canonical AND i.role_category='Team Leader'
           AND replace(lower(i.clean_name),' ','')=replace(lower(r.team_manager),' ','')
        WHERE r.tenant_id=$1 AND r.team_manager IS NOT NULL AND r.team_manager<>''
        GROUP BY r.team_manager ORDER BY reports DESC`, [t]);
    const { tlStatus } = await this.shared.tlResolver(t);
    const teamLeaders = tlRows.map((r: any) => ({ name: r.name, reports: r.reports, first_seen: r.first_seen, last_seen: r.last_seen, ...tlStatus(r.name, r.matched) })).filter((x: any) => !x.hidden);
    return { headline, duplicates, inactiveIds, orphans, pollution, roleHours, teamLeaders };
  }

  /** List the editable team-leader status table (with live report counts). */
  @Get('roster-v2/team-leaders')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Team-leader status table (active/director/left, hidden) + report counts' })
  async teamLeaderStatus(@Req() req: any) {
    const t = req.user.tenantId;
    // every label ever seen on the roster, joined to its editable status
    const rows = await this.ds.query(
      `SELECT COALESCE(lbl.name, s.name) name,
              COALESCE(s.status, 'unset') status,
              COALESCE(s.hidden, false) hidden, s.note,
              COALESCE(lbl.reports, 0) reports, lbl.first_seen, lbl.last_seen
         FROM (SELECT team_manager name, COUNT(DISTINCT person_no)::int reports,
                      MIN(work_date)::text first_seen, MAX(work_date)::text last_seen
                 FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>''
                 GROUP BY team_manager) lbl
         FULL JOIN team_leader_status s ON s.tenant_id=$1 AND s.name=lbl.name
        WHERE COALESCE(lbl.name, s.name) IS NOT NULL ORDER BY reports DESC, 1`, [t]);
    return { rows };
  }

  /** Set a team-leader's status; hiding immediately scrubs the label from roster_days. */
  @Put('roster-v2/team-leaders')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Upsert a team-leader status (active/director/left + hidden). Hiding removes the label everywhere.' })
  async setTeamLeaderStatus(@Req() req: any, @Body() b: { name: string; status?: string; hidden?: boolean; note?: string }) {
    const t = req.user.tenantId;
    if (!b?.name) throw new BadRequestException('name is required');
    const status = ['active', 'director', 'left'].includes(b.status || '') ? b.status : 'active';
    await this.ds.query(
      `INSERT INTO team_leader_status (tenant_id, name, status, hidden, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (tenant_id, name) DO UPDATE SET status=EXCLUDED.status, hidden=EXCLUDED.hidden, note=EXCLUDED.note, updated_at=now()`,
      [t, b.name, status, !!b.hidden, b.note || null]);
    let scrubbed = 0;
    if (b.hidden) {  // remove the label from the roster so it isn't mentioned anywhere
      const r = await this.ds.query(`UPDATE roster_days SET team_manager=NULL WHERE tenant_id=$1 AND team_manager=$2`, [t, b.name]);
      scrubbed = r.rowCount || 0;
    }
    return { ok: true, name: b.name, status, hidden: !!b.hidden, scrubbedRows: scrubbed };
  }

  /** Employee_Master_Clean — one row per canonical human with role-hours rules. */
  @Get('roster-v2/employee-master')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Employee_Master_Clean: canonical humans + role/hours/active' })
  async employeeMaster(@Req() req: any, @Query('includeInactive') inc?: string, @Query('q') q?: string) {
    const t = req.user.tenantId; const p: any[] = [t]; let w = `tenant_id=$1 AND is_canonical`;
    if (inc !== '1') w += ` AND is_active`;
    if (q) { p.push(`%${q.toLowerCase()}%`); w += ` AND (lower(clean_name) LIKE $${p.length} OR person_no ILIKE $${p.length})`; }
    const rows = await this.ds.query(
      `SELECT person_no, clean_name, status, is_active, employment_type, function_name, role_category,
              expected_hours, include_tardiness, include_overtime, include_adherence, is_supervisor,
              gender, team_leader, team_group, last_working_date::text last_working_date,
              (SELECT COUNT(*)::int FROM employee_identity a WHERE a.tenant_id=$1 AND a.person_no=i.person_no AND NOT a.is_canonical) alias_count
         FROM employee_identity i WHERE ${w} ORDER BY clean_name`, p);
    return { count: rows.length, rows };
  }

  /** System Audit — Page/Code/Assistant governance tables + LIVE health signals
   *  (applied migrations, roster row/date span, data-quality flag counts, recent
   *  schedule-change audit trail). */
  @Get('roster-v2/system-audit')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'System audit: page/code/assistant tables + live migrations/health/audit-trail' })
  async systemAudit(@Req() req: any) {
    const t = req.user.tenantId;
    const [pages, code, assistants, migrations, health, dq, recentChanges] = await Promise.all([
      this.ds.query(`SELECT name, purpose, status, issues, notes FROM page_module_audit WHERE tenant_id=$1 ORDER BY name`, [t]),
      this.ds.query(`SELECT component, code_type, status, risk, notes FROM code_audit_log WHERE tenant_id=$1 ORDER BY component`, [t]),
      this.ds.query(`SELECT step_no, assistant, responsibility, input, output, status, notes FROM assistant_workflow_audit WHERE tenant_id=$1 ORDER BY step_no`, [t]),
      this.ds.query(`SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 12`).catch(() => []),
      this.ds.query(`SELECT COUNT(*)::int rows, COUNT(DISTINCT person_no)::int people, MIN(work_date)::text mn, MAX(work_date)::text mx, COUNT(*) FILTER (WHERE data_quality IS NOT NULL)::int flagged FROM roster_days WHERE tenant_id=$1`, [t]),
      this.ds.query(`SELECT data_quality issue, COUNT(*)::int n FROM roster_days WHERE tenant_id=$1 AND data_quality IS NOT NULL GROUP BY data_quality ORDER BY n DESC`, [t]),
      this.ds.query(`SELECT change_type, work_date::text date, person_name, old_shift, new_shift, reverted, created_at FROM schedule_change_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`).catch(() => []),
    ]);
    return { pages, code, assistants, migrations: migrations.map((m: any) => m.filename), health: health[0], dataQuality: dq, recentChanges };
  }

  /* ── Roster data-quality taxonomy (Stage-3A). One CASE folds the free-text
   *    `data_quality` column + the structured flag booleans/mismatch into a small
   *    set of named categories. REVIEW = an actionable data gap a human should
   *    verify (never an HR/disciplinary trigger). INFO = an artefact the recon
   *    engine ALREADY handled correctly (cross-midnight bleed capped, excluded-role
   *    record-only OT, transfer marker) — surfaced for transparency, not action. */
  private static readonly DQ_CAT = `
    CASE
      WHEN COALESCE(r.missing_punch,false) AND COALESCE(r.missing_system,false) THEN 'missing-both'
      WHEN r.data_quality ILIKE '%no-show%' OR r.data_quality ILIKE 'No punch & no system%' THEN 'no-show'
      WHEN COALESCE(r.missing_system,false) OR r.mismatch='no-system' OR r.data_quality='missing-system' THEN 'missing-system'
      WHEN COALESCE(r.missing_punch,false) OR r.mismatch='no-punch' THEN 'missing-punch'
      WHEN r.mismatch='punch<>system' OR r.data_quality='punch-system-mismatch' THEN 'punch-system-mismatch'
      WHEN r.data_quality ILIKE '%bleed%' OR r.data_quality ILIKE '%capped%' THEN 'tardiness-bleed-capped'
      WHEN r.data_quality ILIKE 'roster-shift!=actual%' OR r.data_quality ILIKE '%no-shift-match%' THEN 'shift-mismatch'
      WHEN COALESCE(r.off_worked_hr_review,false) OR r.data_quality ILIKE 'Scheduled OFF but worked%' THEN 'off-worked-review'
      WHEN r.data_quality ILIKE 'ot-suspect%' OR r.data_quality ILIKE 'OFF/holiday OT on system-login%' THEN 'ot-suspect'
      WHEN COALESCE(r.ot_record_only,false) OR r.data_quality ILIKE 'OT record-only%' THEN 'ot-record-only'
      WHEN r.data_quality='transfer-marker' THEN 'transfer-marker'
      WHEN r.data_quality IS NOT NULL THEN 'other-flagged'
      ELSE NULL
    END`;
  private static readonly DQ_META: Record<string, { severity: 'review' | 'info'; label: string }> = {
    'missing-both':           { severity: 'review', label: 'No punch & no system login — verify (not auto-absent)' },
    'no-show':                { severity: 'review', label: 'Scheduled but no attendance evidence — verify' },
    'missing-system':         { severity: 'review', label: 'Fingerprint present, no Ameyo/Sprinklr session' },
    'missing-punch':          { severity: 'review', label: 'System session present, no biometric punch' },
    'punch-system-mismatch':  { severity: 'review', label: 'Punch and system times disagree' },
    'shift-mismatch':         { severity: 'review', label: 'Roster-scheduled shift ≠ shift actually worked' },
    'off-worked-review':      { severity: 'review', label: 'Worked a scheduled OFF day — HR clarify (not auto-paid)' },
    'ot-suspect':             { severity: 'review', label: 'Suspicious OT tail (likely forgotten logout) — not credited' },
    'other-flagged':          { severity: 'review', label: 'Other engine data-quality note — verify' },
    'tardiness-bleed-capped': { severity: 'info',   label: 'Cross-midnight bleed — tardiness already capped at 240m (handled)' },
    'ot-record-only':         { severity: 'info',   label: 'Excluded-role OT — recorded, not payable (handled)' },
    'transfer-marker':        { severity: 'info',   label: 'Internal transfer marker (not an error)' },
  };
  private static readonly DQ_REVIEW_SET =
    `('missing-both','no-show','missing-system','missing-punch','punch-system-mismatch','shift-mismatch','off-worked-review','ot-suspect','other-flagged')`;

  /** Roster HEALTH / data-quality summary over roster_days — "how clean is the
   *  roster?". Folds the free-text data_quality + structured flags into named
   *  categories (review vs engine-handled info), with a clean-% score, per-function
   *  and per-week breakdowns, an OT>300-min/day watch-list, and the top offending
   *  person-days FOR VERIFICATION ONLY (never an HR/disciplinary action). */
  @Get('roster-v2/data-quality')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Roster data-quality / health: clean-% score, flag categories, per-function & per-week, OT>300 watch, top offending person-days (review only)' })
  async dataQuality(
    @Req() req: any,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('functionName') functionName?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('limit') limit = '50',
  ) {
    const t = req.user.tenantId;
    const CAT = RosterReportsController.DQ_CAT, REV = RosterReportsController.DQ_REVIEW_SET;
    // date anchors capped <= CURRENT_DATE (roster_days is reconciled history; defensive cap)
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, LEAST(MAX(work_date), CURRENT_DATE)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = (to && to <= range?.b ? to : range?.b);
    const p: any[] = [t, dFrom, dTo];
    let w = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3 AND r.work_date <= CURRENT_DATE`;
    if (includeInactive !== '1') w += ` AND r.is_active`;
    if (functionName) { p.push(functionName); w += ` AND canon_fn(r.role_function)=canon_fn($${p.length})`; }
    const lim = Math.min(Number(limit) || 50, 500);

    // headline: rows / clean / review / info / ot>300 person-days
    const [tot] = await this.ds.query(
      `SELECT COUNT(*)::int rows,
              COUNT(*) FILTER (WHERE (${CAT}) IS NULL)::int clean_rows,
              COUNT(*) FILTER (WHERE (${CAT}) IN ${REV})::int review_rows,
              COUNT(*) FILTER (WHERE (${CAT}) IS NOT NULL AND (${CAT}) NOT IN ${REV})::int info_rows,
              COUNT(*) FILTER (WHERE (${TRUE_OT}) > 300)::int ot300_days
         FROM roster_days r WHERE ${w}`, p);
    const pct = (n: number) => tot.rows ? Math.round((1000 * n) / tot.rows) / 10 : 0;

    // by category
    const cats = await this.ds.query(
      `SELECT (${CAT}) category, COUNT(*)::int n, COUNT(*) FILTER (WHERE (${TRUE_OT}) > 300)::int ot300
         FROM roster_days r WHERE ${w} AND (${CAT}) IS NOT NULL GROUP BY 1 ORDER BY n DESC`, p);
    const categories = cats.map((c: any) => {
      const m = RosterReportsController.DQ_META[c.category] || { severity: 'review', label: c.category };
      return { category: c.category, severity: m.severity, label: m.label, n: c.n, pct: pct(c.n), ot300: c.ot300 };
    });

    // per function: clean-% among that function's rows
    const byFunction = await this.ds.query(
      `SELECT canon_fn(COALESCE(r.role_function, r.function_name, '—')) fn, COUNT(*)::int rows,
              COUNT(*) FILTER (WHERE (${CAT}) IN ${REV})::int review_flags,
              COUNT(*) FILTER (WHERE (${CAT}) IS NOT NULL AND (${CAT}) NOT IN ${REV})::int info_flags,
              ROUND(100.0 * COUNT(*) FILTER (WHERE (${CAT}) IS NULL) / NULLIF(COUNT(*),0), 1)::float clean_pct
         FROM roster_days r WHERE ${w} GROUP BY 1 ORDER BY clean_pct ASC, rows DESC`, p);

    // per week (Saturday-week number carried on the row)
    const byWeek = await this.ds.query(
      `SELECT r.week_number week, MIN(r.work_date)::text start, MAX(r.work_date)::text "end", COUNT(*)::int rows,
              COUNT(*) FILTER (WHERE (${CAT}) IN ${REV})::int review_flags,
              ROUND(100.0 * COUNT(*) FILTER (WHERE (${CAT}) IS NULL) / NULLIF(COUNT(*),0), 1)::float clean_pct
         FROM roster_days r WHERE ${w} AND r.week_number IS NOT NULL GROUP BY r.week_number ORDER BY MIN(r.work_date)`, p);

    // OT > 300 min/day watch-list (may be legitimate holiday/off-day OT — verify, not action)
    const ot300Top = await this.ds.query(
      `SELECT COALESCE(r.person_no, r.employee_no) person_no, COALESCE(r.clean_name, r.name) name,
              canon_fn(COALESCE(r.role_function,'—')) fn, r.work_date::text date, r.shift_code,
              ROUND((${TRUE_OT})/60.0,1)::float ot_hrs,
              CASE WHEN COALESCE(r.holiday_ot_min,0)>0 THEN 'holiday' WHEN COALESCE(r.offday_ot_min,0)>0 THEN 'off-day' ELSE 'regular' END ot_kind,
              r.data_quality dq
         FROM roster_days r WHERE ${w} AND (${TRUE_OT}) > 300 ORDER BY (${TRUE_OT}) DESC LIMIT ${lim}`, p);
    const [ot300Agg] = await this.ds.query(
      `SELECT COUNT(*)::int days, COUNT(DISTINCT COALESCE(r.person_no,r.employee_no))::int agents FROM roster_days r WHERE ${w} AND (${TRUE_OT}) > 300`, p);

    // top offending person-days — REVIEW list only (verify vs raw files; never HR action)
    const topOffenders = await this.ds.query(
      `SELECT COALESCE(r.person_no, r.employee_no) person_no, COALESCE(r.clean_name, r.name) name,
              canon_fn(COALESCE(r.role_function,'—')) fn, r.work_date::text date, r.day_name,
              (${CAT}) category, r.shift_code, r.presence, r.sys_late_min, r.sys_early_min,
              ROUND((${TRUE_OT})/60.0,1)::float ot_hrs, r.data_quality dq
         FROM roster_days r WHERE ${w} AND (${CAT}) IN ${REV}
        ORDER BY r.work_date DESC, r.person_no LIMIT ${lim}`, p);

    // people with the most review flags (coaching the DATA, not the person)
    const byPerson = await this.ds.query(
      `SELECT COALESCE(r.person_no, r.employee_no) person_no, mode() WITHIN GROUP (ORDER BY COALESCE(r.clean_name,r.name)) name,
              mode() WITHIN GROUP (ORDER BY canon_fn(r.role_function)) fn,
              COUNT(*) FILTER (WHERE (${CAT}) IN ${REV})::int review_flags
         FROM roster_days r WHERE ${w} AND (${CAT}) IN ${REV} AND COALESCE(r.person_no,r.employee_no) IS NOT NULL
         GROUP BY 1 ORDER BY review_flags DESC LIMIT ${lim}`, p);

    const functionOpts = (await this.ds.query(`SELECT DISTINCT canon_fn(role_function) v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t])).map((x: any) => x.v);

    return {
      from: dFrom, to: dTo, range,
      totals: {
        rows: tot.rows, cleanRows: tot.clean_rows, cleanPct: pct(tot.clean_rows),
        reviewRows: tot.review_rows, reviewPct: pct(tot.review_rows),
        infoRows: tot.info_rows, infoPct: pct(tot.info_rows), ot300Days: tot.ot300_days,
      },
      categories, byFunction, byWeek,
      ot300: { days: ot300Agg?.days || 0, agents: ot300Agg?.agents || 0, top: ot300Top },
      topOffenders, byPerson,
      filterOptions: { functions: functionOpts },
      note: 'REVIEW-ONLY: data-quality flags are for verification against the raw Ameyo/Sprinklr/Odoo files — never an HR or disciplinary action. cleanPct = rows with no flag at all; INFO categories (tardiness-bleed-capped / ot-record-only / transfer-marker) are artefacts the recon engine already handled correctly and are excluded from the review score. OT>300min/day is a watch-list (may be legitimate holiday/off-day OT).',
    };
  }

  /** Multi-sheet Excel MASTER export — the connected star-schema workbook:
   *  assumptions, Employee_Master_Clean, Role_Working_Hours, Duplicate/Inactive
   *  audits, Fact_Attendance_Daily, Data_Quality, Weekly_Validation_Log, plus
   *  shift/HR-status summaries and KPI definitions. One file, all connected. */
  @Get('roster-v2/master-export')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Multi-sheet Excel master (facts + dims + clean + audit + validation + definitions)' })
  async masterExport(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const tFn = (m: number | null) => m == null ? '' : `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
    const sheet = (name: string, cols: { header: string; key: string; width?: number }[], rows: any[], color = 'FF4F46E5') => {
      const ws = wb.addWorksheet(name); ws.columns = cols.map(c => ({ ...c, width: c.width || 16 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
      rows.forEach(r => ws.addRow(r));
    };

    // 1) Assumptions_and_Rules
    sheet('Assumptions_and_Rules', [{ header: 'Area', key: 'a', width: 22 }, { header: 'Rule', key: 'r', width: 90 }], [
      { a: 'Week', r: 'Workforce week starts Saturday.' },
      { a: 'Standard shift', r: 'Agent = 9h incl. 1h break. RTA/Customer Care/Resolution Specialist/Team Leader = 8h. Mothers (M7/B7/C7/N7) = 7h.' },
      { a: 'HR codes', r: 'SL = Sick Leave, A = Absence. "P" is NOT an approved code — never emitted; any source "P" is a data-quality exception.' },
      { a: 'Sick by shift', r: 'MS/BS/CS/NS/ES/EES/MDS/MNS = Sick on that shift; keep original shift start/end for reporting.' },
      { a: 'Absent by shift', r: 'MA/BA/CA/NA/EA/EEA/MDA/MNA = Absent on that shift; keep original shift start/end.' },
      { a: 'WFH', r: 'WFH = a WFH shift code OR an explicit WFH location only. It is NEVER inferred from "system login + no punch" — an office-located shift with a system session but no fingerprint is a MISSING PUNCH (counts as office), not WFH.' },
      { a: 'Identity', r: 'Old internship ID (6xxx) and new full-time ID (13xxx) for the same person are collapsed to one canonical person_no.' },
      { a: 'Active', r: 'Inactive/superseded IDs are excluded from default KPIs (toggle to include); kept for historical audit.' },
      { a: 'Tardiness KPI', r: '8h roles (RTA/Customer Care/Resolution/TL) excluded from default tardiness/adherence; records kept.' },
      { a: 'Overtime', r: 'Captured separately: before-shift, after-shift, OFF-day, holiday, COMP-day, cross-midnight; approved vs unapproved.' },
      { a: 'Tardiness bands', r: 'On time / 1-5 / 6-15 / 16-20 / 21-29 / 30-59 / 60+ / No-show.' },
      { a: 'Time zone', r: 'Ameyo & Sprinklr logins are Kuwait LOCAL (no +3 offset) — verified punch≈login to the minute.' },
    ], 'FF334155');

    // 2) Employee_Master_Clean
    const emp = await this.ds.query(
      `SELECT person_no, clean_name, status, employment_type, function_name, role_category, expected_hours,
              include_tardiness, is_supervisor, gender, team_leader, team_group, last_working_date::text last_working_date
         FROM employee_identity WHERE tenant_id=$1 AND is_canonical ORDER BY clean_name`, [t]);
    sheet('Employee_Master_Clean', [
      { header: 'Person No', key: 'person_no' }, { header: 'Name', key: 'clean_name', width: 24 }, { header: 'Status', key: 'status' },
      { header: 'Type', key: 'employment_type' }, { header: 'Function', key: 'function_name', width: 20 }, { header: 'Role', key: 'role_category', width: 20 },
      { header: 'Expected Hrs', key: 'expected_hours' }, { header: 'In Tardiness KPI', key: 'include_tardiness' }, { header: 'Supervisor', key: 'is_supervisor' },
      { header: 'Gender', key: 'gender' }, { header: 'Team Leader', key: 'team_leader', width: 18 }, { header: 'Group', key: 'team_group' }, { header: 'Last Working', key: 'last_working_date' },
    ], emp, 'FF0EA5E9');

    // 3) Role_Working_Hours
    const roleHours = await this.ds.query(`SELECT role_category, default_hours, include_tardiness, include_overtime, include_adherence, include_kpi, notes FROM role_working_hours WHERE tenant_id=$1 ORDER BY default_hours DESC, role_category`, [t]);
    sheet('Role_Working_Hours', [
      { header: 'Role', key: 'role_category', width: 22 }, { header: 'Default Hours', key: 'default_hours' }, { header: 'Tardiness KPI', key: 'include_tardiness' },
      { header: 'Overtime KPI', key: 'include_overtime' }, { header: 'Adherence KPI', key: 'include_adherence' }, { header: 'Dashboard KPI', key: 'include_kpi' }, { header: 'Notes', key: 'notes', width: 50 },
    ], roleHours, 'FF059669');

    // 4) Duplicate_Agent_Audit
    const dups = await this.ds.query(
      `SELECT person_no, clean_name, string_agg(employee_no || CASE WHEN is_canonical THEN ' (canonical)' WHEN status<>'active' THEN ' ('||status||')' ELSE '' END, ', ' ORDER BY is_canonical DESC) ids, COUNT(*)::int id_count
         FROM employee_identity WHERE tenant_id=$1 GROUP BY person_no, clean_name HAVING COUNT(*)>1 ORDER BY id_count DESC, clean_name`, [t]);
    sheet('Duplicate_Agent_Audit', [{ header: 'Canonical No', key: 'person_no' }, { header: 'Name', key: 'clean_name', width: 24 }, { header: 'All IDs', key: 'ids', width: 50 }, { header: 'ID Count', key: 'id_count' }], dups, 'FF7C3AED');

    // 5) Inactive_Employee_Exceptions
    const inact = await this.ds.query(`SELECT employee_no, clean_name, person_no, status, alias_of FROM employee_identity WHERE tenant_id=$1 AND (status<>'active' OR NOT is_canonical) ORDER BY clean_name`, [t]);
    sheet('Inactive_Exceptions', [{ header: 'Employee No', key: 'employee_no' }, { header: 'Name', key: 'clean_name', width: 24 }, { header: 'Canonical', key: 'person_no' }, { header: 'Status', key: 'status' }, { header: 'Alias Of', key: 'alias_of' }], inact, 'FFD97706');

    // 6) Fact_Attendance_Daily (the connected fact)
    const fact = await this.ds.query(
      `SELECT work_date::text date, day_name, week_number, month_name, person_no, clean_name, role_function, role_category,
              team_manager, team_group, gender, shift_code, original_shift_code, shift_start_min, shift_end_min,
              attendance_status, hr_code, presence, punch_in_min, punch_out_min, sys_login_min, sys_logout_min, login_src,
              worked_min, sys_late_min, late_category, sys_early_min, ot_before_min, ot_after_min, offday_ot_min, holiday_ot_min,
              comp_worked_min, crosses_midnight, adherence_pct, permission_type, missing_punch, missing_system, mismatch, is_active, data_quality
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active ORDER BY work_date, clean_name LIMIT 50000`, [t, dFrom, dTo]);
    const factCols = [
      ['date', 'Date'], ['day_name', 'Day'], ['week_number', 'Week'], ['month_name', 'Month'], ['person_no', 'Person No'], ['clean_name', 'Agent'],
      ['role_function', 'Function'], ['role_category', 'Role'], ['team_manager', 'Team Leader'], ['team_group', 'Group'], ['gender', 'Gender'],
      ['shift_code', 'Shift'], ['original_shift_code', 'Orig Shift'], ['shift_start', 'Shift Start'], ['shift_end', 'Shift End'],
      ['attendance_status', 'Status'], ['hr_code', 'HR Code'], ['presence', 'Presence'], ['punch_in', 'Punch In'], ['punch_out', 'Punch Out'],
      ['sys_login', 'Sys Login'], ['sys_logout', 'Sys Logout'], ['login_src', 'Sys Src'], ['worked_min', 'Worked (min)'], ['sys_late_min', 'Late (min)'],
      ['late_category', 'Late Band'], ['sys_early_min', 'Early (min)'], ['ot_before_min', 'OT Before'], ['ot_after_min', 'OT After'],
      ['offday_ot_min', 'OFF OT'], ['holiday_ot_min', 'Holiday OT'], ['comp_worked_min', 'COMP Worked'], ['crosses_midnight', 'X-Mid'],
      ['adherence_pct', 'Conformance %'], ['permission_type', 'Permission'], ['missing_punch', 'Miss Punch'], ['missing_system', 'Miss Sys'], ['mismatch', 'Mismatch'], ['data_quality', 'Data Quality'],
    ];
    sheet('Fact_Attendance_Daily', factCols.map(([k, h]) => ({ header: h, key: k, width: 13 })),
      fact.map((r: any) => ({ ...r, shift_start: tFn(r.shift_start_min), shift_end: tFn(r.shift_end_min), punch_in: tFn(r.punch_in_min), punch_out: tFn(r.punch_out_min), sys_login: tFn(r.sys_login_min), sys_logout: tFn(r.sys_logout_min) })));

    // 7) Data_Quality exceptions
    const dq = await this.ds.query(`SELECT work_date::text date, clean_name, role_function, shift_code, attendance_status, data_quality FROM roster_days WHERE tenant_id=$1 AND data_quality IS NOT NULL AND work_date BETWEEN $2 AND $3 ORDER BY work_date LIMIT 20000`, [t, dFrom, dTo]);
    sheet('Data_Quality', [{ header: 'Date', key: 'date' }, { header: 'Agent', key: 'clean_name', width: 22 }, { header: 'Function', key: 'role_function', width: 18 }, { header: 'Shift', key: 'shift_code' }, { header: 'Status', key: 'attendance_status', width: 16 }, { header: 'Issue', key: 'data_quality', width: 28 }], dq, 'FFDC2626');

    // 8) Weekly_Validation_Log
    const wv = await this.ds.query(`SELECT * FROM roster_validation_log WHERE tenant_id=$1 ORDER BY week_start`, [t]).catch(() => []);
    if (wv.length) sheet('Weekly_Validation_Log', Object.keys(wv[0]).filter(k => k !== 'tenant_id').map(k => ({ header: k, key: k, width: 14 })), wv, 'FF334155');

    // 9) Shift_Distribution + 10) HR_by_Status
    const byShift = await this.ds.query(`SELECT shift_code, COUNT(*)::int days, COUNT(DISTINCT person_no)::int agents FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active GROUP BY shift_code ORDER BY days DESC`, [t, dFrom, dTo]);
    sheet('Shift_Distribution', [{ header: 'Shift', key: 'shift_code' }, { header: 'Days', key: 'days' }, { header: 'Agents', key: 'agents' }], byShift, 'FF6366F1');
    const byStatus = await this.ds.query(`SELECT COALESCE(attendance_status,'—') status, COUNT(*)::int days, COUNT(DISTINCT person_no)::int agents FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active GROUP BY 1 ORDER BY days DESC`, [t, dFrom, dTo]);
    sheet('HR_by_Status', [{ header: 'Attendance Status', key: 'status', width: 20 }, { header: 'Days', key: 'days' }, { header: 'Agents', key: 'agents' }], byStatus, 'FF0EA5E9');

    // 11) KPI_Definitions
    sheet('KPI_Definitions', [{ header: 'KPI', key: 'k', width: 22 }, { header: 'Definition', key: 'd', width: 80 }], [
      { k: 'Conformance %', d: 'Avg adherence_pct = overlap of actual system time with the scheduled shift window.' },
      { k: 'Late (min)', d: 'System login minutes after scheduled shift start (sys_late_min). 8h roles excluded by default.' },
      { k: 'Early out (min)', d: 'System logout minutes before scheduled shift end (sys_early_min).' },
      { k: 'OT before/after', d: 'Worked minutes before shift start / after shift end, from system+punch, capped to remove persistent-session noise.' },
      { k: 'OFF/Holiday/COMP OT', d: 'Worked time on an OFF / Holiday / COMP day, tracked separately.' },
      { k: 'Missing punch / system', d: 'Scheduled working day with no fingerprint / no system login (after WFH rule applied).' },
      { k: 'Worked (min)', d: 'Reconciled worked minutes combining fingerprint and system, deduped.' },
    ], 'FF334155');

    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="WFM_Master_${dFrom}_${dTo}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }


}
