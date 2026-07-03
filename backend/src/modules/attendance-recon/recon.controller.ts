import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Put, Query, Req, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { shiftCategoryFromCode, shiftCategoryCaseSql } from '@common/shift-category';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';

// Source files live server-side (Ameyo export alone is ~72MB). Configure via env;
// falls back to the analyst's working folder for local verification.
const SRC_DIR = process.env.RECON_SOURCE_DIR || 'C:/Users/t.bassam/Desktop/WFM System/My work/Oddo Ameyo Sprinkler';
const SCHEDULE = process.env.RECON_SCHEDULE_FILE || 'C:/Users/t.bassam/Desktop/WFM System/My work/WFM/CC Schedule 26 V3.0 (24).xlsx';
// The CORRECTED engine (recon-refresh.js) reads its 5 monthly sources from here. In-system
// "rebuild" uploads land here (matched by filename) before the engine runs.
const RECON_NEW_DIR = process.env.RECON_NEW_DIR || 'C:/Users/t.bassam/Desktop/new roster/';

/* ── Canonical roster_days metric expressions — ONE source of truth so every report
 *  agrees (no report should silently undercount or inflate).
 *  TRUE_OT: OT lives in THREE DISJOINT buckets — ot_min (regular workday) +
 *    offday_ot_min (OT worked on the employee's OFF day) + holiday_ot_min (OT on a
 *    public holiday). Each roster_days row sits in exactly one bucket, so the real
 *    total is their SUM. Summing ot_min alone undercounts (~28% on the live data).
 *  CRED_LATE/CRED_EARLY: a credible late-in/early-out is 7..240 min (>6 min tolerated,
 *    rule 2026-06-30). Cross-midnight
 *    night shifts (MD/MN/MNR, shift_end>1440) make the post-midnight session tail
 *    read as a multi-hour false late/early — an artifact, not the agent leaving early
 *    — so values >4h are excluded from credible-tardiness counts (HR-safe).
 *  MATERNITY: the maternity-7h mothers (Haya Mohanna 12375, Shaima Saoud 12434) work a
 *    legitimate 7h day, so their ~2h/day early-out is STRUCTURAL/approved, not a
 *    violation — roster_days stores it vs the 9h end (it does not flag maternity), so we
 *    exclude these two from credible EARLY-OUT everywhere (late-in is still counted).
 *    Same fairness carve-out as the WFH HR report. */
const MATERNITY_7H = "('12375','12434')";
const TRUE_OT = '(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))';
// user rule 2026-06-30: tardiness counts only when > 6 min (<=6 tolerated); upper 240 = cross-midnight bleed guard.
const CRED_LATE = '(sys_late_min BETWEEN 7 AND 240)';
const CRED_EARLY = `(sys_early_min BETWEEN 7 AND 240 AND COALESCE(person_no,employee_no) NOT IN ${MATERNITY_7H})`;

@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class ReconController {
  constructor(
    private readonly svc: ReconService,
    private readonly ingestion: RosterIngestionService,
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
    if (functionId) { params.push(functionId); where += ` AND r.role_function=(SELECT name FROM functions WHERE id=$${params.length})`; }
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
      `SELECT COALESCE(r.role_function, r.function_name, '—') fn,
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
    if (functionName) w += ` AND ${add('r.role_function=$$', functionName)}`;
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
             COALESCE(SUM(ot_before_min),0)::int ot_before, COALESCE(SUM(ot_after_min),0)::int ot_after, COALESCE(SUM(${TRUE_OT}),0)::int ot_total,
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
      dist('shift_code'), dist('role_function'), dist('role_category'), dist('team_manager'), dist('presence'),
    ]);

    // filter dropdown options (real function + role from the clean layer)
    const opts = (col: string) => this.ds.query(`SELECT DISTINCT ${col} v FROM roster_days WHERE tenant_id=$1 AND ${col} IS NOT NULL ORDER BY 1`, [t]);
    const [functions, roles, shifts, teams, days] = await Promise.all([
      opts('role_function'), opts('role_category'), opts('shift_code'), opts('team_group'), opts('day_name'),
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
    const { tlStatus } = await this.tlResolver(t);
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
    const FILT: Record<string, string> = { function:'role_function', role:'role_category', teamLeader:'team_manager', group:'team_group', shift:'shift_code',
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

  /** Shift FAIRNESS over the canonical roster (roster_days): per-person morning/
   *  evening/night/midnight load + weekend-OFF fairness, with an optional dedicated
   *  NIGHT TEAM carve-out (the user's choice — fixed team vs fair distribution), and a
   *  rebalance proposal for the fair-rotation pool (female-midnight aware). Source =
   *  the uploaded schedule (roster_days), deduped by person_no via is_active. */
  @Get('roster-v2/fairness')
  @RequirePermissions('attendance.view_team')
  async fairness(
    @Req() req: any, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') functionName?: string, @Query('teamLeader') teamLeader?: string,
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo];
    let w = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3 AND r.is_active`;
    const add = (cond: string, val: any) => { p.push(val); return cond.replace('$$', `$${p.length}`); };
    if (functionName) w += ` AND ${add('r.role_function=$$', functionName)}`;
    if (teamLeader)   w += ` AND ${add('r.team_manager=$$', teamLeader)}`;

    // THE ONE canonical shift-category mapping (rules §3, common/shift-category.ts) —
    // was a local CASE that mis-bucketed C into evening (canonical: morning/day).
    const catExpr = shiftCategoryCaseSql('shift_category,shift_code');
    const work = `r.presence IN ('office','wfh')`;
    const rows: any[] = await this.ds.query(`
      WITH r AS (SELECT *, ${catExpr} cat FROM roster_days)
      SELECT r.person_no, MAX(r.clean_name) name, MAX(r.role_function) fn, MAX(r.gender) gender,
             COUNT(*) FILTER (WHERE ${work})::int wd,
             COUNT(*) FILTER (WHERE ${work} AND cat='morning')::int morning,
             COUNT(*) FILTER (WHERE ${work} AND cat='evening')::int evening,
             COUNT(*) FILTER (WHERE ${work} AND cat='night')::int night,
             COUNT(*) FILTER (WHERE ${work} AND cat='midnight')::int midnight,
             COUNT(*) FILTER (WHERE r.presence='off')::int off_days,
             COUNT(*) FILTER (WHERE r.presence='off' AND EXTRACT(DOW FROM r.work_date) IN (4,5))::int weekend_off,
             COUNT(*) FILTER (WHERE r.presence='off' AND EXTRACT(DOW FROM r.work_date) NOT IN (4,5))::int weekday_off,
             (nt.person_no IS NOT NULL) night_team
        FROM r LEFT JOIN fairness_night_team nt ON nt.tenant_id=$1 AND nt.person_no=r.person_no
       WHERE ${w}
       GROUP BY r.person_no, nt.person_no
      HAVING COUNT(*) FILTER (WHERE ${work}) >= 1`, p);

    const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    const sdev = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
    // currently-employed persons (employee_identity.is_active = any employee row active) — used to
    // keep the FORWARD rebalance proposal to schedulable staff while the report keeps full history.
    const activeNow = new Set((await this.ds.query(`SELECT person_no FROM employee_identity WHERE tenant_id=$1 AND is_active`, [t])).map((x: any) => x.person_no));
    // total weekend (THU/FRI — Director's ruling 2026-07-02) dates in the window — the denominator for "what share of
    // available weekends did this person actually get off".
    const totalWeekendDays = Number((await this.ds.query(
      `SELECT COUNT(DISTINCT work_date)::int n FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND EXTRACT(DOW FROM work_date) IN (4,5)`, [t, dFrom, dTo]))[0]?.n || 0);
    const agents = rows.map(r => {
      const wd = r.wd || 1, nm = r.night + r.midnight, off = r.off_days || 0;
      // dominant shift category + how "stuck" on it (never rotates) — rotation health
      const cats: [string, number][] = [['morning', r.morning], ['evening', r.evening], ['night', r.night], ['midnight', r.midnight]];
      const dom = cats.reduce((a, b) => b[1] > a[1] ? b : a, ['none', 0] as [string, number]);
      const distinctCats = cats.filter(c => c[1] > 0).length;
      return {
        personNo: r.person_no, name: r.name, fn: r.fn, gender: r.gender, nightTeam: r.night_team,
        currentlyActive: activeNow.has(r.person_no),
        workedDays: r.wd, morning: r.morning, evening: r.evening, night: r.night, midnight: r.midnight,
        // shift mix (% of working days) — for the per-person distribution / heatmap bar
        morningPct: Math.round(100 * r.morning / wd), eveningPct: Math.round(100 * r.evening / wd),
        nightPct: Math.round(100 * r.night / wd), midOnlyPct: Math.round(100 * r.midnight / wd),
        // rotation health: which category dominates, by how much, and how many categories they touch
        dominantCat: dom[0], dominantPct: Math.round(100 * dom[1] / wd), distinctCats,
        nightMidPct: Math.round(100 * nm / wd), midnightPct: Math.round(100 * r.midnight / wd),
        // OFF distribution: weekday vs weekend split + share of all weekends in the period
        off, weekdayOff: r.weekday_off, weekendOff: r.weekend_off,
        weekdayOffPct: off ? Math.round(100 * r.weekday_off / off) : 0,
        weekendOffPct: off ? Math.round(100 * r.weekend_off / off) : 0,
        weekendOffShare: totalWeekendDays ? Math.round(100 * r.weekend_off / totalWeekendDays) : 0,
      };
    }).sort((a, b) => b.nightMidPct - a.nightMidPct);

    const fairPool = agents.filter(a => !a.nightTeam);
    const team = agents.filter(a => a.nightTeam);
    const poolPcts = fairPool.map(a => a.nightMidPct);
    const poolAvg = Math.round(mean(poolPcts) * 10) / 10;
    const sd = sdev(poolPcts);
    const woff = agents.map(a => a.weekendOff);
    const woffSd = sdev(woff);

    // The rebalance proposal is FORWARD-looking → only currently-employed people
    // (a leaver's historical load stays in the report, but we won't propose re-balancing them).
    const withDelta = fairPool.filter(a => a.currentlyActive).map(a => ({ ...a, delta: Math.round(a.nightMidPct - poolAvg) }));
    const reduceNights = withDelta.filter(a => a.delta >= 15).sort((a, b) => b.delta - a.delta).slice(0, 10)
      .map(a => ({ name: a.name, fn: a.fn, nightMidPct: a.nightMidPct, midnight: a.midnight, over: a.delta }));
    const addNights = withDelta.filter(a => a.delta <= -15).sort((a, b) => a.delta - b.delta).slice(0, 10)
      .map(a => ({ name: a.name, fn: a.fn, gender: a.gender, nightMidPct: a.nightMidPct, under: -a.delta, canMidnight: String(a.gender || '').toLowerCase().startsWith('m') }));
    const weekendOffDeprived = agents.filter(a => a.off > 0 && activeNow.has(a.personNo)).sort((a, b) => a.weekendOff - b.weekendOff).slice(0, 8)
      .map(a => ({ name: a.name, fn: a.fn, weekendOff: a.weekendOff, off: a.off, weekendOffPct: a.weekendOffPct, weekendOffShare: a.weekendOffShare }));

    // OFF distribution — weekday vs weekend split per current person, most weekend-deprived first.
    const poolWeekendShares = fairPool.filter(a => a.currentlyActive).map(a => a.weekendOffShare);
    const weekendShareAvg = Math.round(mean(poolWeekendShares) * 10) / 10;
    const offDistribution = agents.filter(a => a.currentlyActive && a.off > 0)
      .sort((a, b) => a.weekendOffShare - b.weekendOffShare)
      .map(a => ({ name: a.name, fn: a.fn, nightTeam: a.nightTeam, off: a.off, weekdayOff: a.weekdayOff, weekendOff: a.weekendOff, weekdayOffPct: a.weekdayOffPct, weekendOffPct: a.weekendOffPct, weekendOffShare: a.weekendOffShare }));

    // JUSTICE INDEX — who deserves relief in the NEXT schedule: carrying MORE night/mid than the fair
    // average AND getting FEWER weekends off than average. Higher debt = compensate first.
    const justice = fairPool.filter(a => a.currentlyActive).map(a => {
      const nightExcess = Math.max(0, a.nightMidPct - poolAvg);
      const weekendDeficit = Math.max(0, weekendShareAvg - a.weekendOffShare);
      return { name: a.name, fn: a.fn, nightMidPct: a.nightMidPct, weekendOffShare: a.weekendOffShare, nightExcess: Math.round(nightExcess), weekendDeficit: Math.round(weekendDeficit), debt: Math.round(nightExcess + weekendDeficit) };
    }).filter(a => a.debt > 0).sort((a, b) => b.debt - a.debt).slice(0, 12);

    // ROTATION HEALTH — fair-pool current staff stuck ≥80% on ONE shift category (rarely rotate).
    const stuckOnOneShift = fairPool.filter(a => a.currentlyActive && a.dominantPct >= 80)
      .sort((a, b) => b.dominantPct - a.dominantPct)
      .map(a => ({ name: a.name, fn: a.fn, dominantCat: a.dominantCat, dominantPct: a.dominantPct, distinctCats: a.distinctCats, workedDays: a.workedDays }));

    // REBALANCE PLAN — concrete "apply" suggestion: pair the most over-loaded with the most under-loaded
    // (night/mid), female-aware (females take NIGHT only), and pair weekend-deprived with weekend-rich.
    const over = fairPool.filter(a => a.currentlyActive && a.nightMidPct - poolAvg >= 15).sort((a, b) => b.nightMidPct - a.nightMidPct);
    const under = fairPool.filter(a => a.currentlyActive && poolAvg - a.nightMidPct >= 15).sort((a, b) => a.nightMidPct - b.nightMidPct);
    const nightMoves = Array.from({ length: Math.min(over.length, under.length, 8) }, (_, i) => {
      const o = over[i], u = under[i];
      const female = !String(u.gender || '').toLowerCase().startsWith('m');
      // suggested # of night/mid days to shift = half the gap between them, in working-day terms
      const shifts = Math.max(1, Math.round((o.nightMidPct - u.nightMidPct) / 100 * Math.min(o.workedDays, u.workedDays) / 2));
      return { fromName: o.name, fromFn: o.fn, fromPct: o.nightMidPct, toName: u.name, toFn: u.fn, toPct: u.nightMidPct, take: female ? 'night-only' : 'night/midnight', shifts };
    });
    const wkRich = fairPool.filter(a => a.currentlyActive && a.weekendOffShare > weekendShareAvg).sort((a, b) => b.weekendOffShare - a.weekendOffShare);
    const weekendMoves = weekendOffDeprived.slice(0, 6).map((dep: any, i: number) => ({
      giveName: dep.name, giveFn: dep.fn, giveShare: dep.weekendOffShare,
      fromName: wkRich[i]?.name || null, fromShare: wkRich[i]?.weekendOffShare ?? null,
    })).filter((m: any) => m.fromName);
    const rebalancePlan = { nightMoves, weekendMoves };

    return {
      from: dFrom, to: dTo,
      summary: {
        activeAgents: agents.length, nightTeamCount: team.length, fairPoolCount: fairPool.length,
        fairPoolAvgNightMidPct: poolAvg, nightMidStdev: Math.round(sd * 10) / 10,
        fairnessScore: Math.max(0, Math.round(100 - sd)),               // lower spread = fairer
        weekendOffAvg: Math.round(mean(woff) * 10) / 10,
        weekendOffMin: woff.length ? Math.min(...woff) : 0, weekendOffMax: woff.length ? Math.max(...woff) : 0,
        weekendFairnessScore: Math.max(0, Math.round(100 - woffSd * 3)),
        totalWeekendDays, weekendShareAvg,                              // weekend-OFF share denominators
      },
      agents, nightTeam: team,
      proposal: { poolAvgNightMidPct: poolAvg, weekendShareAvg, reduceNights, addNights, weekendOffDeprived },
      offDistribution, justice, stuckOnOneShift, rebalancePlan,
    };
  }

  /** List the designated night-team members. */
  @Get('roster-v2/fairness/night-team')
  @RequirePermissions('attendance.view_team')
  async fairnessNightTeamList(@Req() req: any) {
    const rows = await this.ds.query(`SELECT person_no, clean_name FROM fairness_night_team WHERE tenant_id=$1 ORDER BY clean_name`, [req.user.tenantId]);
    return { members: rows };
  }

  /** Add/remove a person from the night team (the user's choice: fixed team vs fair pool). */
  @Put('roster-v2/fairness/night-team')
  @RequirePermissions('attendance.view_team')
  async fairnessNightTeamSet(@Req() req: any, @Body() body: { personNo: string; name?: string; member: boolean }) {
    const t = req.user.tenantId;
    if (!body?.personNo) throw new BadRequestException('personNo required');
    if (body.member)
      await this.ds.query(`INSERT INTO fairness_night_team(tenant_id,person_no,clean_name) VALUES($1,$2,$3)
        ON CONFLICT (tenant_id,person_no) DO UPDATE SET clean_name=EXCLUDED.clean_name`, [t, body.personNo, body.name || null]);
    else
      await this.ds.query(`DELETE FROM fairness_night_team WHERE tenant_id=$1 AND person_no=$2`, [t, body.personNo]);
    return { ok: true };
  }

  /** Excel export of the full shift-fairness picture (reuses the fairness() compute):
   *  per-agent load+mix+OFF split, relief priority, stuck-on-one-shift, night team. */
  @Get('roster-v2/fairness/export')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Shift Fairness → multi-sheet Excel (load/mix/OFF split + relief + stuck + night team)' })
  async fairnessExport(
    @Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') functionName?: string, @Query('teamLeader') teamLeader?: string,
  ) {
    const d: any = await this.fairness(req, from, to, functionName, teamLeader);
    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const sheet = (name: string, cols: { header: string; key: string; width?: number }[], rows: any[], color = 'FF6366F1') => {
      const ws = wb.addWorksheet(name); ws.columns = cols.map(c => ({ ...c, width: c.width || 14 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
      rows.forEach(r => ws.addRow(r));
    };
    sheet('Shift_Fairness', [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 },
      { header: 'Active', key: 'currentlyActive', width: 8 }, { header: 'Night Team', key: 'nightTeam', width: 10 },
      { header: 'Worked', key: 'workedDays', width: 8 }, { header: 'Morning%', key: 'morningPct' }, { header: 'Evening%', key: 'eveningPct' },
      { header: 'Night%', key: 'nightPct' }, { header: 'Midnight%', key: 'midOnlyPct' }, { header: 'Night+Mid%', key: 'nightMidPct' },
      { header: 'Dominant', key: 'dominantCat' }, { header: 'Dominant%', key: 'dominantPct' }, { header: '#Cats', key: 'distinctCats' },
      { header: 'OFF', key: 'off' }, { header: 'Weekday OFF', key: 'weekdayOff' }, { header: 'Weekend OFF', key: 'weekendOff' },
      { header: 'Weekday OFF%', key: 'weekdayOffPct' }, { header: 'Weekend OFF%', key: 'weekendOffPct' }, { header: 'Weekend Share%', key: 'weekendOffShare' },
    ], d.agents);
    sheet('Relief_Priority', [
      { header: 'Rank', key: 'rank', width: 6 }, { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 },
      { header: 'Night+Mid%', key: 'nightMidPct' }, { header: 'Weekend Share%', key: 'weekendOffShare' },
      { header: 'Night Excess', key: 'nightExcess' }, { header: 'Weekend Deficit', key: 'weekendDeficit' }, { header: 'Debt', key: 'debt' },
    ], d.justice.map((r: any, i: number) => ({ ...r, rank: i + 1 })), 'FFA78BFA');
    sheet('Stuck_On_One_Shift', [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 },
      { header: 'Stuck On', key: 'dominantCat', width: 12 }, { header: 'Share%', key: 'dominantPct' }, { header: '#Cats', key: 'distinctCats' }, { header: 'Worked', key: 'workedDays' },
    ], d.stuckOnOneShift, 'FFF59E0B');
    sheet('Night_Team', [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 }, { header: 'Night+Mid%', key: 'nightMidPct' }, { header: 'Midnight days', key: 'midnight' },
    ], d.nightTeam, 'FF0EA5E9');
    sheet('Summary', [{ header: 'Metric', key: 'k', width: 32 }, { header: 'Value', key: 'v', width: 18 }],
      Object.entries(d.summary).map(([k, v]) => ({ k, v })), 'FF22C55E');

    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Shift_Fairness_${d.from}_${d.to}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /** HOURLY analytics (0-23) per function over the canonical roster (roster_days):
   *  coverage (scheduled/working/%), permissions, shrinkage (count/%), tardiness count,
   *  and OT (before/after) per hour — with a TOTAL row. Cross-midnight aware. The
   *  professional hour-by-hour staffing + exception picture HR/RTA asks for. */
  @Get('roster-v2/hourly')
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
    if (functionName) wBase += ` AND ${add('COALESCE(role_function,function_name)=$$', functionName)}`;
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
    const stdStart = `CASE regexp_replace(upper(COALESCE(attendance_code,shift_code,'')),'([SA])$','')
      WHEN 'M' THEN 420 WHEN 'AM' THEN 420 WHEN 'M20' THEN 480 WHEN 'B' THEN 540 WHEN 'B20' THEN 600
      WHEN 'C' THEN 660 WHEN 'C20' THEN 720 WHEN 'N' THEN 780 WHEN 'N20' THEN 840 WHEN 'E' THEN 960
      WHEN 'EE' THEN 1080 WHEN 'EE20' THEN 1080 WHEN 'MD' THEN 1320 WHEN 'MN' THEN 1380 END`;
    const stdEnd = `CASE regexp_replace(upper(COALESCE(attendance_code,shift_code,'')),'([SA])$','')
      WHEN 'M' THEN 960 WHEN 'AM' THEN 900 WHEN 'M20' THEN 960 WHEN 'B' THEN 1080 WHEN 'B20' THEN 1080
      WHEN 'C' THEN 1200 WHEN 'C20' THEN 1200 WHEN 'N' THEN 1320 WHEN 'N20' THEN 1320 WHEN 'E' THEN 1500
      WHEN 'EE' THEN 1560 WHEN 'EE20' THEN 1620 WHEN 'MD' THEN 1860 WHEN 'MN' THEN 1920 END`;
    const wR = `${wBase} AND (shift_start_min IS NOT NULL OR (presence IN ('sick','absent','leave') AND (${stdStart}) IS NOT NULL))`;
    const GRP = (level === 'agent' || agent)
      ? `COALESCE(clean_name,name) || ' · ' || COALESCE(person_no,employee_no)`
      : `COALESCE(role_function,function_name)`;

    // a person covers hour h (its [h*60,h*60+60) bucket) if the window [start,start+len)
    // — normalized to minute-of-day, cross-midnight & negative aware — overlaps it. One
    // helper for EVERY window: the shift, the OT-before/after extensions, and the
    // late-arrival / early-departure gaps. So the headcount truly reflects who is at seat.
    const cov = (start: string, len: string) => {
      const a0 = `(((${start})%1440+1440)%1440)`, b0 = `(${a0}+(${len}))`;
      return `((${a0} < h.hh*60+60 AND LEAST(${b0},1440) > h.hh*60) OR (${b0}>1440 AND (${b0}-1440) > h.hh*60))`;
    };
    // overlap MINUTES of a window [start,start+len) with hour h's bucket — exact "how many
    // OT / permission minutes happened in this hour" (cross-midnight wrap handled as two segments).
    const covMin = (start: string, len: string) => {
      const a0 = `(((${start})%1440+1440)%1440)`, e = `(${a0}+(${len}))`, h0 = `h.hh*60`, h1 = `(h.hh*60+60)`;
      const s1 = `GREATEST(0, LEAST(LEAST(${e},1440), ${h1}) - GREATEST(${a0}, ${h0}))`;
      const s2 = `(CASE WHEN ${e}>1440 THEN GREATEST(0, LEAST(${e}-1440, ${h1}) - ${h0}) ELSE 0 END)`;
      return `(${s1} + ${s2})`;
    };
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
                   se.employee_id, se.entry_date, e.employee_no, COALESCE(f.name,'—') fn,
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
    if (!agent && level !== 'agent') for (const g of planGrid) {
      const fn = g.fn || '—'; if (!fnMap[fn]) fnMap[fn] = blank();
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
    if (functionName) { fp.push(functionName); fnFilter = ` AND COALESCE(role_function,function_name)=$${fp.length}`; }
    let fnFilterPlan = '';
    let otFnJoin = '', otFnWhere = '';
    if (functionName) {
      fnFilterPlan = ` AND COALESCE(f.name,'—')=$4`;   // same param slot ($4)
      // finding #6/#8: a function-scoped forecast must NOT add company-wide approved OT — scope the
      // ot CTE to the same function via request_overtimes.function_id.
      otFnJoin = ` LEFT JOIN functions fo ON fo.id = ro.function_id`;
      otFnWhere = ` AND fo.name = $4`;
    }

    const cov = (start: string, len: string) => {
      const a0 = `(((${start})%1440+1440)%1440)`, b0 = `(${a0}+(${len}))`;
      return `((${a0} < h.hh*60+60 AND LEAST(${b0},1440) > h.hh*60) OR (${b0}>1440 AND (${b0}-1440) > h.hh*60))`;
    };
    const covWin = (ps: string, pe: string) => // an [start,end) minute window (no wrap) covers hour bucket
      `(${ps} < h.hh*60+60 AND ${pe} > h.hh*60)`;
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
    const covAbs = (s: string, l: string) => `((${s}) < b.bi*1440 + b.hh*60 + 60 AND ((${s})+(${l})) > b.bi*1440 + b.hh*60)`;
    const actual = await this.ds.query(`
      WITH b AS (SELECT bi, hh FROM generate_series(0,6) bi CROSS JOIN generate_series(0,23) hh),
      r AS (SELECT (work_date - $2::date) AS di, person_no, employee_no, shift_start_min ss,
                   (CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440 ELSE shift_end_min END) se_c,
                   presence, permission_type, sys_late_min, sys_early_min, ot_before_min, ot_after_min
              FROM roster_days
             WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3 AND shift_start_min IS NOT NULL${fnFilter})
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
             WHERE se.tenant_id=$1 AND se.entry_date BETWEEN $2 AND $3 AND sc.start_time IS NOT NULL${fnFilterPlan}
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
    const fnFilterBase = functionName ? (bp.push(functionName), ` AND COALESCE(role_function,function_name)=$${bp.length}`) : '';
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

  /** DEMAND-DRIVEN shift-mix generator over the canonical roster (roster_days): measure the
   *  hourly need per function, then greedy set-cover the standard shift windows (real start/end
   *  taken from the data) to cover every hour — and check we have enough active staff. The
   *  "build a schedule that covers all hours" core. Read-only proposal. */
  @Get('roster-v2/generate')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Demand-driven shift-mix that covers the hourly need per function (set-cover)' })
  async generateMix(@Req() req: any, @Query('function') functionName?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    // pick the function (busiest if not given)
    let fn = functionName;
    if (!fn) {
      const top = await this.ds.query(`SELECT COALESCE(role_function,function_name) fn, COUNT(*) n FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_start_min IS NOT NULL AND presence IN ('office','wfh') GROUP BY 1 ORDER BY n DESC LIMIT 1`, [t, dFrom, dTo]);
      fn = top[0]?.fn;
    }
    const p = [t, dFrom, dTo, fn];
    const w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_start_min IS NOT NULL AND COALESCE(role_function,function_name)=$4`;
    const cov = (start: string, len: string) => {
      const a0 = `(((${start})%1440+1440)%1440)`, b0 = `(${a0}+(${len}))`;
      return `((${a0} < h.hh*60+60 AND LEAST(${b0},1440) > h.hh*60) OR (${b0}>1440 AND (${b0}-1440) > h.hh*60))`;
    };
    const [{ days }] = await this.ds.query(`SELECT COUNT(DISTINCT work_date)::int days FROM roster_days WHERE ${w}`, p);
    // 1) DEMAND = avg daily scheduled headcount covering each hour (the need to replicate).
    const dem = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh), r AS (SELECT shift_start_min ss, shift_end_min se FROM roster_days WHERE ${w})
      SELECT h.hh, COUNT(*) FILTER (WHERE ${cov('r.ss', '(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END)')}) sched FROM r CROSS JOIN h GROUP BY h.hh ORDER BY h.hh`, p);
    const demand = Array(24).fill(0); dem.forEach((r: any) => { demand[r.hh] = days ? Math.round(r.sched / days) : 0; });
    // 2) SHIFT DEFINITIONS = the function's real shift windows (mode start/end per code).
    const defs = await this.ds.query(`
      SELECT UPPER(shift_code) code, MODE() WITHIN GROUP (ORDER BY shift_start_min) ss, MODE() WITHIN GROUP (ORDER BY shift_end_min) se, COUNT(*) n
      FROM roster_days WHERE ${w} AND presence IN ('office','wfh')
        AND UPPER(shift_code) !~ '^(OFF|H|L|SL|DL|RES|TER|TRANSFER|COMP|UPL|A)$'
      GROUP BY UPPER(shift_code) HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 12`, p);
    const covHours = (ss: number, se: number) => { const a = (((ss % 1440) + 1440) % 1440), e = a + (se - ss), out: number[] = []; for (let h = 0; h < 24; h++) { const h0 = h * 60; if ((a < h0 + 60 && Math.min(e, 1440) > h0) || (e > 1440 && e - 1440 > h0)) out.push(h); } return out; };
    const shifts = defs.map((d: any) => ({ code: d.code, ss: d.ss, se: d.se, hrs: covHours(d.ss, d.se), used: d.n }));
    // 3) GREEDY set-cover: add the shift that covers the most still-under-covered demand.
    const assigned = Array(24).fill(0); const mix: Record<string, number> = {}; let guard = 0;
    while (guard++ < 600) {
      let best: any = null, bestGain = 0;
      for (const s of shifts) { const gain = s.hrs.reduce((g: number, h: number) => g + (demand[h] - assigned[h] > 0 ? 1 : 0), 0); if (gain > bestGain) { bestGain = gain; best = s; } }
      if (!best || bestGain <= 0) break;
      mix[best.code] = (mix[best.code] || 0) + 1; best.hrs.forEach((h: number) => assigned[h]++);
    }
    // 4) coverage result + verdict + staff availability
    const coverageByHour = demand.map((d, h) => ({ hour: h, demand: d, covered: assigned[h], gap: assigned[h] - d }));
    const openHours = coverageByHour.filter(c => c.demand > 0);
    const shortHours = openHours.filter(c => c.gap < 0);
    const totalUnits = Object.values(mix).reduce((s, n) => s + n, 0);
    const [{ active }] = await this.ds.query(`SELECT COUNT(DISTINCT person_no)::int active FROM roster_days WHERE ${w}`, p);
    const tFn = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const mixRows = Object.entries(mix).map(([code, count]) => { const s = shifts.find((x: any) => x.code === code); return { code, count, start: tFn(s.ss), end: tFn(s.se % 1440) }; }).sort((a, b) => b.count - a.count);
    const allFns = await this.ds.query(`SELECT DISTINCT COALESCE(role_function,function_name) fn FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_start_min IS NOT NULL AND presence IN ('office','wfh') ORDER BY 1`, [t, dFrom, dTo]);
    return {
      from: dFrom, to: dTo, function: fn, functions: allFns.map((r: any) => r.fn).filter(Boolean), days,
      // honest disclosure: "demand" here = the CURRENT schedule's hourly headcount (circular),
      // not an Erlang/workload-derived requirement — the UI must say so.
      basis: 'replicates current schedule (not workload-derived)',
      demand, coverageByHour,
      shiftMix: mixRows, shiftDefs: shifts.map((s: any) => ({ code: s.code, start: tFn(s.ss), end: tFn(s.se % 1440), used: s.used })),
      staffing: { shiftsPerDay: totalUnits, activeStaff: active, needWithOff: Math.ceil(totalUnits * 7 / 6), enough: active >= Math.ceil(totalUnits * 7 / 6) },
      verdict: { coversAllHours: shortHours.length === 0, shortHours: shortHours.map(c => ({ hour: c.hour, demand: c.demand, covered: c.covered, gap: c.gap })), worstGap: openHours.length ? Math.min(...openHours.map(c => c.gap)) : 0 },
    };
  }

  /** PER-EMPLOYEE weekly assignment over the demand mix (the final piece): assign each active
   *  person in the function a WEEKLY shift code + an OFF day so the daily mix is covered, females
   *  never take midnight, night/midnight goes to the LEAST historically-loaded (fair rotation),
   *  and weekend-OFF goes to the most weekend-deprived. Weekly rotation ⇒ ≥10h rest by construction.
   *  Read-only proposal (writing into the editable grid is a separate, confirmed step). */
  @Get('roster-v2/generate-week')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-employee weekly shift + OFF assignment covering the demand mix (fair, female-aware)' })
  async generateWeek(@Req() req: any, @Query('function') functionName?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const mixData: any = await this.generateMix(req, functionName, from, to);
    const fn = mixData.function, dFrom = mixData.from, dTo = mixData.to;
    // canonical classifier (common/shift-category.ts) collapsed to the 3 buckets this planner needs
    const cat = (code: string) => { const c = shiftCategoryFromCode(code); return c === 'midnight' ? 'midnight' : c === 'night' ? 'night' : 'day'; };

    // active people in the function with gender + historical night/mid load + weekend-off share
    const emps = (await this.ds.query(`
      WITH r AS (SELECT person_no, clean_name, gender, presence, work_date, UPPER(COALESCE(shift_category,shift_code,'')) sc FROM roster_days
                  WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND COALESCE(role_function,function_name)=$4)
      SELECT person_no, MAX(clean_name) name, MAX(gender) gender,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh')) wd,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND sc ~ '^(N|MD|MN)') nm,
             COUNT(*) FILTER (WHERE presence='off' AND EXTRACT(DOW FROM work_date) IN (4,5)) woff
        FROM r WHERE person_no IS NOT NULL GROUP BY person_no
       HAVING COUNT(*) FILTER (WHERE presence IN ('office','wfh')) >= 1`, [t, dFrom, dTo, fn]))
      .map((e: any) => ({ personNo: e.person_no, name: e.name, male: String(e.gender || '').toLowerCase().startsWith('m'),
        nightLoad: e.wd ? e.nm / e.wd : 0, weekendOff: +e.woff, code: null as string | null, off: null as number[] | null }));

    // order shift codes: fill midnight → night → day (hardest constraint first)
    const order = (c: string) => cat(c) === 'midnight' ? 0 : cat(c) === 'night' ? 1 : 2;
    const codes = [...mixData.shiftMix].sort((a: any, b: any) => order(a.code) - order(b.code));
    const offDays = 2;   // weekly OFF days per person (business rule: 2 OFF / week)
    const need = (count: number) => Math.ceil(count * 7 / (7 - offDays));   // people per code to keep `count` working with `offDays` OFF each
    let pool = emps.slice();
    const groups: any[] = [];
    for (const m of codes) {
      const c = cat(m.code), want = need(m.count);
      let cands = pool.filter(e => c === 'midnight' ? e.male : true);
      // night/midnight → least-loaded first (fair rotation); day → most-loaded first (relieve them).
      // NIGHT is additionally MALES-FIRST (rule 6.4): a female gets N only once the male pool is exhausted.
      cands.sort((a, b) => (c === 'night' && a.male !== b.male) ? (a.male ? -1 : 1)
        : c === 'day' ? b.nightLoad - a.nightLoad : a.nightLoad - b.nightLoad);
      let take = cands.slice(0, want);
      const femaleNight = c === 'night' ? take.filter(e => !e.male).length : 0;
      take.forEach(e => { e.code = m.code; });
      pool = pool.filter(e => !e.code);
      groups.push({ code: m.code, category: c, perDay: m.count, assigned: take.length, want, femaleNight, members: take });
    }
    // leftover pool → spare (extra OFF / standby)
    const spares = pool.map(e => ({ ...e, code: 'OFF/Spare' }));

    // OFF days: within each group round-robin `offDays` day-slots 0-6 (Sat-based), spaced apart
    // so each day keeps `perDay` working. bias: give weekend (idx 5,6) OFF to the most
    // weekend-deprived in the group first.
    for (const g of groups) {
      const sorted = [...g.members].sort((a, b) => a.weekendOff - b.weekendOff);
      const spacing = Math.floor(7 / offDays);   // 2 OFF → 3 days apart
      sorted.forEach((e, i) => { e.off = Array.from({ length: offDays }, (_, k) => (i + k * spacing) % 7); });
      g.dailyCovered = Array.from({ length: 7 }, (_, d) => g.members.filter((e: any) => !(e.off || []).includes(d)).length);
      g.coversEveryDay = g.dailyCovered.every((n: number) => n >= g.perDay);
    }

    const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const assignments = [...groups.flatMap(g => g.members.map((e: any) => ({ personNo: e.personNo, name: e.name, code: e.code, category: g.category, off: (e.off ?? [0]).map((d: number) => dayNames[d]).join('+'), nightLoadPct: Math.round(100 * e.nightLoad) }))),
      ...spares.map(e => ({ personNo: e.personNo, name: e.name, code: 'OFF/Spare', category: 'spare', off: '—', nightLoadPct: Math.round(100 * e.nightLoad) }))]
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const peopleNeeded = codes.reduce((s: number, m: any) => s + need(m.count), 0);
    const warnings: string[] = [];
    for (const g of groups) { if (g.assigned < g.want) warnings.push(`${g.code}: need ${g.want}, only ${g.assigned} eligible`); if (!g.coversEveryDay) warnings.push(`${g.code}: OFF buffer too thin — some day drops below ${g.perDay}`); if (g.femaleNight > 0) warnings.push(`${g.code}: ${g.femaleNight} female(s) on N — males were assigned first and the male pool is exhausted (rule 6.4) — flag`); }

    // ── ROSTER HEALTH CHECK (Director 2026-07-03): the generator must never leave the
    //    user blind — prove the assignment covers the demand hour-by-hour BEFORE publish. ──
    const health = await this.computeWeekHealth(t, fn, mixData.demand, mixData.shiftDefs, groups, warnings);

    return {
      from: dFrom, to: dTo, function: fn,
      staffing: { ...mixData.staffing, peopleNeeded, spares: spares.length },
      groups: groups.map(g => ({ code: g.code, category: g.category, perDay: g.perDay, assigned: g.assigned, want: g.want, femaleNight: g.femaleNight, coversEveryDay: g.coversEveryDay, dailyCovered: g.dailyCovered })),
      assignments, spares: spares.map(e => ({ name: e.name })),
      warnings, coversDemand: mixData.verdict.coversAllHours, shiftMix: mixData.shiftMix,
      health,
    };
  }

  /** Post-generation coverage proof: per day × hour Required / Scheduled / Effective
   *  (shrinkage-adjusted from the function's last-28-day reality), status colors,
   *  weekend (Thu+Fri) & night focus, totals and rule-based recommended actions.
   *  Demand basis = mixData.demand (avg hourly HC of the source window — disclosed). */
  private async computeWeekHealth(t: string, fn: string, demand: number[], shiftDefs: any[], groups: any[], warnings: string[]) {
    const toMin = (s: string) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
    // shift windows from the mix's real definitions; cross-midnight when end ≤ start
    const win: Record<string, { ss: number; se: number }> = {};
    for (const d of shiftDefs || []) { const ss = toMin(d.start), seRaw = toMin(d.end); win[d.code] = { ss, se: seRaw <= ss ? seRaw + 1440 : seRaw }; }
    const hoursOf = (ss: number, se: number) => { const a = ((ss % 1440) + 1440) % 1440, e = a + (se - ss), out: number[] = []; for (let h = 0; h < 24; h++) { const h0 = h * 60; if ((a < h0 + 60 && Math.min(e, 1440) > h0) || (e > 1440 && e - 1440 > h0)) out.push(h); } return out; };

    // projected shrinkage = the function's own recent unplanned+planned lost-day rate
    let shrinkRate = 0, shrinkParts = { sick: 0, absent: 0, leave: 0, base: 0 };
    try {
      const [s] = await this.ds.query(`
        SELECT COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent,
               COUNT(*) FILTER (WHERE presence='leave')::int leave, COUNT(*) FILTER (WHERE presence <> 'off')::int base
          FROM roster_days WHERE tenant_id=$1 AND COALESCE(role_function,function_name)=$2 AND is_active
           AND work_date >= (SELECT MAX(work_date) FROM roster_days WHERE tenant_id=$1) - INTERVAL '27 days'`, [t, fn]);
      shrinkParts = s; shrinkRate = s.base > 0 ? (s.sick + s.absent + s.leave) / s.base : 0;
    } catch { /* projection unavailable → 0, disclosed below */ }

    const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const days = dayNames.map((name, di) => {
      const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, required: demand[h] || 0, scheduled: 0, effective: 0, gap: 0, status: 'grey' as string }));
      for (const g of groups) {
        const w = win[g.code]; if (!w) continue;
        const working = g.members.filter((m: any) => !(m.off || []).includes(di)).length;
        for (const h of hoursOf(w.ss, w.se)) hours[h].scheduled += working;
      }
      for (const c of hours) {
        c.effective = Math.round(c.scheduled * (1 - shrinkRate) * 10) / 10;
        c.gap = Math.round((c.effective - c.required) * 10) / 10;
        c.status = c.required === 0 ? (c.scheduled > 0 ? 'blue' : 'grey')
          : c.effective >= c.required * 1.3 ? 'yellow'          // notable overstaffing
          : c.effective >= c.required ? 'green'
          : c.effective >= c.required * 0.85 ? 'yellow' : 'red';
      }
      const open = hours.filter(c => c.required > 0);
      const covered = open.reduce((s, c) => s + Math.min(c.effective, c.required), 0);
      const req = open.reduce((s, c) => s + c.required, 0);
      return { day: name, hours, coveragePct: req ? Math.round(1000 * covered / req) / 10 : 100, red: open.filter(c => c.status === 'red').length, yellow: open.filter(c => c.status === 'yellow').length };
    });

    const all = days.flatMap(d => d.hours.filter(c => c.required > 0));
    const sum = (f: (c: any) => number) => Math.round(all.reduce((s, c) => s + f(c), 0) * 10) / 10;
    const requiredHrs = sum(c => c.required), scheduledHrs = sum(c => c.scheduled), effectiveHrs = sum(c => c.effective);
    const shortageHrs = sum(c => Math.max(0, c.required - c.effective)), surplusHrs = sum(c => Math.max(0, c.effective - c.required));
    const coveragePct = requiredHrs ? Math.round(1000 * sum(c => Math.min(c.effective, c.required)) / requiredHrs) / 10 : 100;
    const critical = all.filter(c => c.status === 'red').length, warning = all.filter(c => c.status === 'yellow').length;
    const nightHrs = all.filter(c => c.hour >= 22 || c.hour < 6);
    const nightCoverage = nightHrs.length ? Math.round(1000 * nightHrs.reduce((s, c) => s + Math.min(c.effective, c.required), 0) / Math.max(1, nightHrs.reduce((s, c) => s + c.required, 0))) / 10 : 100;
    const weekend = { thu: days[5].coveragePct, fri: days[6].coveragePct };

    // rule-based recommended actions — concrete, ranked worst-first
    const recs: string[] = [];
    const worstRed = new Map<number, number>();
    for (const d of days) for (const c of d.hours) if (c.status === 'red') worstRed.set(c.hour, Math.min(worstRed.get(c.hour) ?? 0, c.gap));
    [...worstRed.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5)
      .forEach(([h, gap]) => recs.push(`RED ${String(h).padStart(2, '0')}:00 — short ${Math.abs(gap)} HC: add OT, shift a start time into this hour, or move cross-skilled staff`));
    if (surplusHrs > requiredHrs * 0.15) recs.push(`Overstaffing ${surplusHrs}h vs need — consider trimming the heaviest surplus hours or re-timing shifts`);
    for (const g of groups) if (g.assigned < g.want) recs.push(`${g.code}: ${g.want - g.assigned} more people needed — cross-skill move, hire, or accept the gap with OT`);
    if (shrinkRate > 0.12) recs.push(`Projected shrinkage ${Math.round(shrinkRate * 1000) / 10}% is high — review sick/absence/leave before trusting the effective numbers`);
    if (weekend.thu < 95 || weekend.fri < 95) recs.push(`Weekend (Thu/Fri) coverage ${weekend.thu}% / ${weekend.fri}% — rebalance weekend OFFs`);

    return {
      basis: 'demand = avg hourly HC of the source window (see generate basis); effective = scheduled × (1 − projected shrinkage)',
      projectedShrinkagePct: Math.round(shrinkRate * 1000) / 10,
      shrinkageParts: shrinkParts,
      totals: { requiredHrs, scheduledHrs, effectiveHrs, shortageHrs, surplusHrs, coveragePct, criticalIntervals: critical, warningIntervals: warning, nightCoveragePct: nightCoverage, weekend },
      days,
      acceptable: critical === 0 && coveragePct >= 95,
      verdictText: critical === 0 && coveragePct >= 95
        ? `ACCEPTABLE — ${coveragePct}% coverage, no red hours`
        : `NEEDS ATTENTION — ${coveragePct}% coverage, ${critical} red interval(s), ${warning} warning(s)`,
      recommendations: recs.length ? recs : ['No action needed — coverage holds across all demand hours'],
      generatorWarnings: warnings,
    };
  }

  private weekDays = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  /** Expand the weekly assignment into a 7-day grid (employee × Sat→Fri → code/OFF). */
  private weekGrid(wk: any) {
    return wk.assignments.map((a: any) => ({
      personNo: a.personNo, name: a.name, code: a.code, category: a.category, off: a.off, nightLoadPct: a.nightLoadPct,
      // off is "Sat+Wed" (2 OFF days per week) — mark every listed day OFF
      days: this.weekDays.map(dn => (String(a.off || '').split('+').includes(dn) || a.code === 'OFF/Spare') ? 'OFF' : a.code),
    }));
  }

  /** SAVE the generated weekly roster as a reviewable DRAFT (held outside the live grid). */
  @Post('roster-v2/generate-week/save')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Save the demand-driven weekly roster as a reviewable draft' })
  async saveWeekDraft(@Req() req: any, @Body() body: { function?: string; from?: string; to?: string; weekStart?: string; label?: string }) {
    const t = req.user.tenantId;
    const wk: any = await this.generateWeek(req, body?.function, body?.from, body?.to);
    const grid = this.weekGrid(wk);
    // default week-start = the Saturday AFTER the data horizon (a fresh future week).
    let weekStart = body?.weekStart;
    if (!weekStart) {
      const [{ mx }] = await this.ds.query(`SELECT MAX(work_date)::text mx FROM roster_days WHERE tenant_id=$1`, [t]);
      const dt = new Date(`${mx}T00:00:00Z`); let add = (6 - dt.getUTCDay() + 7) % 7; if (add === 0) add = 7;
      dt.setUTCDate(dt.getUTCDate() + add); weekStart = dt.toISOString().slice(0, 10);
    }
    const label = body?.label || `${wk.function} · ${weekStart}`;
    const payload = { weekStart, function: wk.function, days: this.weekDays, mix: wk.shiftMix, staffing: wk.staffing, warnings: wk.warnings, grid, health: wk.health };
    const [row] = await this.ds.query(
      `INSERT INTO schedule_drafts(tenant_id, function, week_start, label, payload, created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [t, wk.function, weekStart, label, JSON.stringify(payload), req.user.sub || null]);
    return { ok: true, id: row.id, weekStart, label, function: wk.function, days: this.weekDays, grid, staffing: wk.staffing, warnings: wk.warnings, mix: wk.shiftMix, health: wk.health };
  }

  /** List recent saved roster drafts. */
  @Get('roster-v2/drafts')
  @RequirePermissions('attendance.view_team')
  async listDrafts(@Req() req: any) {
    const drafts = await this.ds.query(`SELECT id, function, week_start::text "weekStart", label, created_at FROM schedule_drafts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user.tenantId]);
    return { drafts };
  }

  /** Fetch one saved draft (the full week grid) by id. */
  @Get('roster-v2/draft')
  @RequirePermissions('attendance.view_team')
  async getDraft(@Req() req: any, @Query('id') id: string) {
    if (!id) throw new BadRequestException('id required');
    const [row] = await this.ds.query(`SELECT id, function, week_start::text "weekStart", label, payload, created_at FROM schedule_drafts WHERE tenant_id=$1 AND id=$2`, [req.user.tenantId, id]);
    if (!row) throw new BadRequestException('draft not found');
    return { id: row.id, ...row.payload, label: row.label, createdAt: row.created_at };
  }

  /** PUBLISH the generated weekly roster into the live editable grid (attendance_records).
   *  SAFE BY DESIGN: targets an EMPTY future week by default (the Saturday after the last existing
   *  schedule), and uses ON CONFLICT DO NOTHING so it NEVER overwrites an existing schedule — it only
   *  fills empty employee×date cells. Rows are tagged in `notes` so unpublish can cleanly remove them. */
  @Post('roster-v2/publish')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Publish the generated weekly roster into attendance_records (empty week, non-overwriting)' })
  async publishWeek(@Req() req: any, @Body() body: { function?: string; from?: string; to?: string; weekStart?: string }) {
    const t = req.user.tenantId;
    const wk: any = await this.generateWeek(req, body?.function, body?.from, body?.to);
    let weekStart = body?.weekStart;
    if (!weekStart) {
      const [{ mx }] = await this.ds.query(`SELECT MAX(attendance_date)::text mx FROM attendance_records WHERE tenant_id=$1`, [t]);
      const dt = new Date(`${mx || new Date().toISOString().slice(0, 10)}T00:00:00Z`); let add = (6 - dt.getUTCDay() + 7) % 7; if (add === 0) add = 7;
      dt.setUTCDate(dt.getUTCDate() + add); weekStart = dt.toISOString().slice(0, 10);
    }
    // resolve canonical person_no → employees.id, and shift code → shift_codes (id/start/end)
    const persons = [...new Set(wk.assignments.map((a: any) => a.personNo).filter(Boolean))] as string[];
    const empMap: Record<string, string> = {};
    (await this.ds.query(`SELECT employee_no, id FROM employees WHERE tenant_id=$1 AND employee_no = ANY($2)`, [t, persons])).forEach((r: any) => { empMap[r.employee_no] = r.id; });
    const codes = [...new Set(wk.assignments.map((a: any) => a.code).filter((c: string) => c && c !== 'OFF/Spare'))] as string[];
    const scMap: Record<string, any> = {};
    (await this.ds.query(`SELECT UPPER(code) code, id, start_time ss, end_time se FROM shift_codes WHERE tenant_id=$1 AND UPPER(code)=ANY($2)`, [t, codes.map((c: string) => c.toUpperCase())])).forEach((r: any) => { scMap[r.code] = r; });
    const note = `[generated ${weekStart}]`;
    const addDays = (iso: string, n: number) => { const dd = new Date(`${iso}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate() + n); return dd.toISOString().slice(0, 10); };
    const rows: any[][] = []; let noEmp = 0;
    for (const a of wk.assignments) {
      const eid = empMap[a.personNo]; if (!eid) { noEmp++; continue; }
      for (let dI = 0; dI < 7; dI++) {
        const off = String(a.off || '').split('+').includes(this.weekDays[dI]) || a.code === 'OFF/Spare';
        const sc = off ? null : scMap[String(a.code).toUpperCase()];
        rows.push([t, eid, addDays(weekStart, dI), sc?.id || null, sc?.ss || null, sc?.se || null, off ? 'off' : 'present', note]);
      }
    }
    let written = 0;
    if (rows.length) {
      const C = 8;
      const values = rows.map((_, i) => `($${i * C + 1},$${i * C + 2},$${i * C + 3},$${i * C + 4},$${i * C + 5},$${i * C + 6},$${i * C + 7},false,$${i * C + 8})`).join(',');
      const res = await this.ds.query(
        `INSERT INTO attendance_records (tenant_id, employee_id, attendance_date, scheduled_shift_code_id, scheduled_start, scheduled_end, attendance_marker, is_wfh, notes)
         VALUES ${values} ON CONFLICT (tenant_id, employee_id, attendance_date) DO NOTHING RETURNING employee_id`, rows.flat());
      // TypeORM .query() returns the RETURNING rows array — its length = rows actually inserted (ON CONFLICT skips don't return).
      written = Array.isArray(res) ? res.length : (res?.rowCount || 0);
    }
    const skipped = rows.length - written;
    return { ok: true, weekStart, function: wk.function, written, skipped, unmappedPeople: noEmp, note,
      message: skipped > 0 ? `${skipped} cell(s) already had a schedule and were preserved (not overwritten).` : (written ? `published ${written} cells into week ${weekStart}.` : 'nothing to publish.') };
  }

  /** Reverse a publish: delete ONLY the generated rows for a week (tagged in notes). Safe. */
  @Post('roster-v2/unpublish')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Remove the generated rows for a week (only rows this engine wrote)' })
  async unpublishWeek(@Req() req: any, @Body() body: { weekStart: string }) {
    if (!body?.weekStart) throw new BadRequestException('weekStart required');
    const t = req.user.tenantId;
    // approved/soft-locked weeks are IMMUTABLE to unpublish — no override, because this deletes
    // rows wholesale; the only way to change the approved range is re-uploading the schedule
    // (same soft-lock as assertScheduleEditable, but with the supervisor bypass removed).
    const lock = await this.getScheduleLock(t);
    const we = new Date(`${body.weekStart}T00:00:00Z`); we.setUTCDate(we.getUTCDate() + 6);
    const weekEnd = we.toISOString().slice(0, 10);
    if (lock && body.weekStart <= lock.to && weekEnd >= lock.from) {
      throw new ForbiddenException(`Week ${body.weekStart} overlaps the approved/locked schedule range (${lock.from} → ${lock.to}) — unpublish is not allowed; re-upload the schedule to change it.`);
    }
    const r = await this.ds.query(
      `DELETE FROM attendance_records WHERE tenant_id=$1 AND attendance_date BETWEEN $2::date AND ($2::date + 6) AND notes LIKE '[generated %' RETURNING employee_id`,
      [t, body.weekStart]);
    // TypeORM returns DELETE..RETURNING as a [rows[], affectedCount] tuple — read the count off whichever shape we got.
    const deleted = Array.isArray(r)
      ? (typeof r[1] === 'number' ? r[1] : (Array.isArray(r[0]) ? r[0].length : r.length))
      : (r?.rowCount || 0);
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, new_value, notes)
       VALUES ($1,$2,$3,'schedule.unpublish','attendance-recon','schedule_week',$4::jsonb,$5)`,
      [t, req.user.id || req.user.sub || null, req.user.email || null,
       JSON.stringify({ weekStart: body.weekStart, deleted }),
       `Removed ${deleted} generated row(s) for week ${body.weekStart}`]).catch(() => {});
    return { ok: true, deleted };
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
    const { tlStatus } = await this.tlResolver(t);
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

  /** Agent 360 — one agent's complete WFM card from the clean roster_days:
   *  attendance mix, tardiness bands, OT detail, shift-rate distribution, monthly
   *  trend, and recent days. Resolve by person_no or name search. */
  @Get('roster-v2/agent-360')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Agent 360 profile — attendance, tardiness bands, OT, shift-rate, monthly trend' })
  async agent360(@Req() req: any, @Query('person') person?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person (no or name) is required');
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const [emp] = await this.ds.query(
      `SELECT person_no, clean_name, function_name, role_category, expected_hours, include_tardiness, is_active, is_supervisor, gender, team_leader, team_group, employment_type
         FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND (person_no=$2 OR lower(clean_name) LIKE lower($3)) ORDER BY (person_no=$2) DESC LIMIT 1`,
      [t, person, `%${person}%`]);
    if (!emp) throw new BadRequestException('No such agent');
    const pn = emp.person_no; const p = [t, pn, dFrom, dTo];
    const W = `tenant_id=$1 AND person_no=$2 AND work_date BETWEEN $3 AND $4`;
    const [summary] = await this.ds.query(`
      SELECT COUNT(*)::int "scheduledDays",
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int "workedDays",
             COUNT(*) FILTER (WHERE presence='office')::int "officeDays", COUNT(*) FILTER (WHERE presence='wfh')::int "wfhDays",
             COUNT(*) FILTER (WHERE presence='off')::int "offDays", COUNT(*) FILTER (WHERE presence='leave')::int "leaveDays",
             COUNT(*) FILTER (WHERE presence='sick')::int "sickDays", COUNT(*) FILTER (WHERE presence='absent')::int "absenceDays",
             COUNT(*) FILTER (WHERE presence='holiday')::int "holidayDays",
             COUNT(*) FILTER (WHERE comp_off IS NOT NULL OR comp_worked_min>0)::int "compDays",
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int "lateDays", COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int "totalLateMin",
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int "earlyDays", COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int "totalEarlyMin",
             COALESCE(SUM(ot_before_min),0)::int "otBefore", COALESCE(SUM(ot_after_min),0)::int "otAfter",
             COALESCE(SUM(${TRUE_OT}),0)::int "otTotal", COALESCE(SUM(offday_ot_min),0)::int "offdayOt", COALESCE(SUM(holiday_ot_min),0)::int "holidayOt",
             ROUND(AVG(adherence_pct),1) conformance,
             COUNT(*) FILTER (WHERE missing_punch)::int "missingPunch", COUNT(*) FILTER (WHERE missing_system)::int "missingSystem",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions
        FROM roster_days WHERE ${W}`, p);
    const tardinessBands = await this.ds.query(`SELECT COALESCE(late_category,'On time') band, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh') GROUP BY 1`, p);
    const sr = await this.ds.query(`SELECT ${this.SHIFT_CAT} cat, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh','sick','absent') GROUP BY 1`, p);
    const shiftRate: Record<string, number> = { Morning: 0, Night: 0, Evening: 0, Midnight: 0, Other: 0 };
    for (const r of sr) shiftRate[r.cat] = r.n;
    const byMonth = await this.ds.query(`
      SELECT month_name "month", COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int "lateMin", COALESCE(SUM(${TRUE_OT}),0)::int "otMin", ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W} GROUP BY month_name ORDER BY MIN(work_date)`, p);
    const recent = await this.ds.query(`
      SELECT work_date::text date, day_name, shift_code, attendance_status, presence,
             sys_login_min, sys_logout_min, sys_late_min, late_category, ot_before_min, ot_after_min, adherence_pct, data_quality
        FROM roster_days WHERE ${W} ORDER BY work_date DESC LIMIT 40`, p);
    return { from: dFrom, to: dTo, employee: emp, summary, tardinessBands, shiftRate, byMonth, recent };
  }

  /** Team Progress — month-over-month for a whole team (team leader): is the team
   *  improving or declining? Mirrors agent-progress but aggregated across the team. */
  @Get('roster-v2/team-progress')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Team month-over-month progress + improving/declining verdict' })
  async teamProgress(@Req() req: any, @Query('teamLeader') tl?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const tlName = tl || (await this.ds.query(`SELECT team_manager FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' GROUP BY team_manager ORDER BY COUNT(*) DESC LIMIT 1`, [t]))[0]?.team_manager;
    if (!tlName) throw new BadRequestException('No team leaders found');
    const dFrom = from || range?.a, dTo = to || range?.b;
    const rosterM = await this.ds.query(`
      SELECT EXTRACT(YEAR FROM work_date)::int yr, EXTRACT(MONTH FROM work_date)::int mo, MIN(month_name) month_name,
             COUNT(DISTINCT person_no)::int agents, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conf,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin, COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick
        FROM roster_days WHERE tenant_id=$1 AND team_manager=$2 AND work_date BETWEEN $3 AND $4 AND is_active
        GROUP BY 1,2 ORDER BY 1,2`, [t, tlName, dFrom, dTo]);
    const netM = await this.ds.query(`
      SELECT year yr, month mo, ROUND(AVG(avg_net_points::numeric),1) net FROM scorecard_monthly
        WHERE tenant_id=$1 AND team_manager=$2 AND make_date(year,month,1) BETWEEN date_trunc('month',$3::date) AND $4::date
        GROUP BY year,month`, [t, tlName, dFrom, dTo]);
    const netMap = new Map<string, number>(netM.map((r: any) => [`${r.yr}-${r.mo}`, Number(r.net)]));
    const months = rosterM.map((r: any) => ({ yr: r.yr, mo: r.mo, label: `${r.month_name || r.mo} ${String(r.yr).slice(2)}`,
      agents: r.agents, worked: r.worked, conf: r.conf == null ? null : Number(r.conf), lateDays: r.latedays, lateMin: r.latemin,
      otMin: r.otmin, absent: r.absent, sick: r.sick, net: netMap.has(`${r.yr}-${r.mo}`) ? netMap.get(`${r.yr}-${r.mo}`) : null }));
    months.forEach((m: any, i: number) => { const pr: any = i > 0 ? months[i - 1] : null;
      m.d = pr ? { conf: m.conf != null && pr.conf != null ? Math.round((m.conf - pr.conf) * 10) / 10 : null,
        net: m.net != null && pr.net != null ? Math.round((m.net - pr.net) * 10) / 10 : null,
        lateDays: m.lateDays - pr.lateDays, absent: m.absent - pr.absent } : null; });
    const fl = (key: string) => { const v = months.filter((m: any) => m[key] != null); return v.length >= 2 ? { first: v[0][key], last: v[v.length - 1][key], change: Math.round((v[v.length - 1][key] - v[0][key]) * 10) / 10 } : null; };
    const confV = fl('conf'), netV = fl('net');
    const dir = (c: number | null | undefined, th = 2) => c == null ? 'flat' : c > th ? 'up' : c < -th ? 'down' : 'flat';
    let overall = 'stable'; const cd = confV ? dir(confV.change) : null, nd = netV ? dir(netV.change, 3) : null;
    if (cd === 'up' || nd === 'up') overall = (cd === 'down' || nd === 'down') ? 'mixed' : 'improving';
    if ((cd === 'down' || nd === 'down') && overall !== 'mixed' && overall !== 'improving') overall = 'declining';
    return { teamLeader: tlName, from: dFrom, to: dTo, months, verdict: { conformance: confV && { ...confV, dir: dir(confV.change) }, net: netV && { ...netV, dir: dir(netV.change, 3) }, overall } };
  }

  /** Trends — center-wide KPI movement over weeks or months (conformance, tardiness,
   *  OT, absence, headcount), filterable by function / team leader. */
  @Get('roster-v2/trends')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Weekly/monthly KPI trends (conformance, late, OT, absence, headcount)' })
  async trends(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') fn?: string, @Query('teamLeader') tl?: string, @Query('interval') interval = 'week') {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    if (fn) { p.push(fn); w += ` AND role_function=$${p.length}`; }
    if (tl) { p.push(tl); w += ` AND team_manager=$${p.length}`; }
    const bucket = interval === 'month' ? 'month_name' : 'week_number';
    const rows = await this.ds.query(
      `SELECT ${bucket} bucket, MIN(work_date)::text start, MAX(work_date)::text "end",
              COUNT(DISTINCT person_no)::int agents,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
              COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick,
              COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
              COALESCE(SUM(${TRUE_OT}),0)::int otmin, ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conf
         FROM roster_days r WHERE ${w} GROUP BY ${bucket} ORDER BY MIN(work_date)`, p);
    // options for the filters
    const [functions, teamLeaders] = await Promise.all([
      this.ds.query(`SELECT DISTINCT role_function v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t]),
      this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]),
    ]);
    const label = (r: any) => interval === 'month' ? r.bucket : `W${r.bucket}`;
    return { from: dFrom, to: dTo, interval, range,
             points: rows.map((r: any) => ({ ...r, label: label(r) })),
             filterOptions: { functions: functions.map((x: any) => x.v), teamLeaders: teamLeaders.map((x: any) => x.v) } };
  }

  /** Attendance & Adherence Score — a transparent composite (0-100, grade A-D) per
   *  agent from conformance + absence + tardiness. NOT the official performance
   *  scorecard (which uses AHT/quality/quiz) — this is attendance/adherence only.
   *  Default: tardiness-eligible roles with >=5 worked days. */
  @Get('roster-v2/agent-scores')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Composite attendance/adherence score + grade per agent (ranked leaderboard)' })
  async agentScores(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('includeExcludedRoles') incRoles?: string, @Query('person') person?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    if (incRoles !== '1') w += ` AND include_tardiness`;
    if (person) { p.push(person); w += ` AND person_no=$${p.length}`; }
    const rows = await this.ds.query(
      `SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) fn,
              mode() WITHIN GROUP (ORDER BY role_category) role, mode() WITHIN GROUP (ORDER BY team_manager) tl,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh')) worked,
              COUNT(*) FILTER (WHERE presence='absent') absent, COUNT(*) FILTER (WHERE presence='sick') sick,
              COUNT(*) FILTER (WHERE ${CRED_LATE}) latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
              COUNT(*) FILTER (WHERE missing_system) misssys, ROUND(AVG(adherence_pct),1) conf, COALESCE(SUM(${TRUE_OT}),0)::int otmin
         FROM roster_days r WHERE ${w} AND person_no IS NOT NULL
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE presence IN ('office','wfh'))>=5`, p);
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    const scored = rows.map((r: any) => {
      const worked = r.worked, scheduled = worked + r.absent + r.sick;
      const conf = r.conf == null ? 0 : Number(r.conf);
      const attend = clamp(100 - (scheduled ? (r.absent / scheduled) * 100 : 0));      // absence reliability
      const punct = clamp(100 - (worked ? (r.latedays / worked) * 100 : 0));            // punctuality
      const score = Math.round(0.55 * conf + 0.30 * attend + 0.15 * punct);
      const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
      return { person_no: r.person_no, name: r.name, fn: r.fn, role: r.role, tl: r.tl, worked, absent: r.absent, sick: r.sick,
               lateDays: r.latedays, lateMin: r.latemin, missSys: r.misssys, otMin: r.otmin, conf, attend, punct, score, grade };
    }).sort((a: any, b: any) => b.score - a.score).map((r: any, i: number) => ({ rank: i + 1, ...r }));
    // attach each person's latest official Net Points (scorecard), alias-aware
    const netRows = await this.ds.query(
      `SELECT DISTINCT ON (i.person_no) i.person_no, sm.avg_net_points::numeric net, sm.year, sm.month
         FROM scorecard_monthly sm JOIN employee_identity i ON i.tenant_id=sm.tenant_id AND i.employee_no=sm.employee_no
        WHERE sm.tenant_id=$1 ORDER BY i.person_no, sm.year DESC, sm.month DESC`, [t]);
    const netMap = new Map<string, { net: number; period: string }>(netRows.map((r: any) => [r.person_no, { net: Number(r.net), period: `${r.year}-${String(r.month).padStart(2, '0')}` }] as [string, { net: number; period: string }]));
    for (const a of scored) { const n = netMap.get(a.person_no); a.netPoints = n ? n.net : null; a.netPeriod = n ? n.period : null; }
    const dist = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>; for (const r of scored) dist[r.grade]++;
    const avg = scored.length ? Math.round(scored.reduce((a: number, r: any) => a + r.score, 0) / scored.length) : 0;
    return { from: dFrom, to: dTo, count: scored.length, average: avg, distribution: dist,
             formula: 'score = 0.55×conformance + 0.30×attendance(absence) + 0.15×punctuality(lateness); grades A≥85 B≥70 C≥55 D<55',
             agents: person ? scored : scored.slice(0, 200) };
  }

  /** WFM Insights — auto-prioritized, actionable findings over the clean roster_days:
   *  coaching candidates (low conformance), tardiness/absence outliers, coverage-risk
   *  functions, OT concentration, conformance trend vs the previous period, and data
   *  quality. Each insight carries a severity + a deep-link target. */
  @Get('roster-v2/insights')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Auto-prioritized WFM insights/alerts (coaching, coverage, OT, trend, data quality)' })
  async insights(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0, 7)}-01` : range?.a), dTo = to || range?.b;
    const days = Math.max(1, Math.round((+new Date(dTo) - +new Date(dFrom)) / 86400000) + 1);
    const prevTo = new Date(new Date(dFrom).getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(dFrom).getTime() - days * 86400000).toISOString().slice(0, 10);
    const out: any[] = [];
    const push = (severity: string, kind: string, title: string, detail: string, link?: string, value?: any) => out.push({ severity, kind, title, detail, link, value });

    // 1) coaching candidates — low conformance, enough working days, tardiness-eligible roles
    const lowConf = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, ROUND(AVG(adherence_pct),1) conf, COUNT(*) FILTER (WHERE presence IN ('office','wfh')) wd
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness AND adherence_pct IS NOT NULL
         GROUP BY person_no HAVING AVG(adherence_pct)<70 AND COUNT(*) FILTER (WHERE presence IN ('office','wfh'))>=10 ORDER BY conf ASC LIMIT 6`, [t, dFrom, dTo]);
    if (lowConf.length) push('critical', 'coaching', `${lowConf.length} ${lowConf.length === 1 ? 'agent needs' : 'agents need'} coaching (conformance < 70%)`,
      lowConf.map((r: any) => `${r.name} ${r.conf}%`).join(' · '), '/data-quality');

    // 1b) DECLINING agents — conformance dropped sharply in the 2nd half of the period (proactive coaching)
    const mid = new Date(new Date(dFrom).getTime() + Math.floor(days / 2) * 86400000).toISOString().slice(0, 10);
    const declining = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name,
              ROUND(AVG(adherence_pct) FILTER (WHERE work_date < $4),1) h1,
              ROUND(AVG(adherence_pct) FILTER (WHERE work_date >= $4),1) h2
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness AND adherence_pct IS NOT NULL
         GROUP BY person_no
        HAVING COUNT(*) FILTER (WHERE work_date < $4) >= 5 AND COUNT(*) FILTER (WHERE work_date >= $4) >= 5
           AND AVG(adherence_pct) FILTER (WHERE work_date >= $4) - AVG(adherence_pct) FILTER (WHERE work_date < $4) < -15
        ORDER BY AVG(adherence_pct) FILTER (WHERE work_date >= $4) - AVG(adherence_pct) FILTER (WHERE work_date < $4) ASC LIMIT 6`, [t, dFrom, dTo, mid]);
    if (declining.length) push('warning', 'declining', `${declining.length} agent(s) declining (conformance dropped ≥15 pts)`,
      declining.map((r: any) => `${r.name} ${r.h1}%→${r.h2}%`).join(' · '), '/agent-360');

    // 2) tardiness outliers
    const late = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, COUNT(*) FILTER (WHERE ${CRED_LATE}) ld, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int lm
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE ${CRED_LATE})>=10 ORDER BY ld DESC LIMIT 5`, [t, dFrom, dTo]);
    if (late.length) push('warning', 'tardiness', `${late.length} agent(s) late ≥ 10 days`, late.map((r: any) => `${r.name} (${r.ld}d)`).join(' · '), '/roster-dashboard');

    // 3) absence outliers
    const abs = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, COUNT(*) FILTER (WHERE presence='absent') ab
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE presence='absent')>=5 ORDER BY ab DESC LIMIT 5`, [t, dFrom, dTo]);
    if (abs.length) push('warning', 'absence', `${abs.length} agent(s) absent ≥ 5 days`, abs.map((r: any) => `${r.name} (${r.ab})`).join(' · '), '/roster-dashboard');

    // 4) coverage-risk functions — high sick+absent share of planned-working
    const cov = await this.ds.query(
      `SELECT role_function fn,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent')) planned,
              COUNT(*) FILTER (WHERE presence IN ('sick','absent')) lost
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND role_function IS NOT NULL
         GROUP BY role_function HAVING COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent'))>=20
         AND COUNT(*) FILTER (WHERE presence IN ('sick','absent'))::float / NULLIF(COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent')),0) > 0.12
         ORDER BY COUNT(*) FILTER (WHERE presence IN ('sick','absent'))::float / NULLIF(COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent')),0) DESC LIMIT 4`, [t, dFrom, dTo]);
    for (const r of cov) push('warning', 'coverage', `${r.fn}: ${Math.round(100 * r.lost / r.planned)}% of planned days lost to sick/absent`, `${r.lost} of ${r.planned} planned days`, '/interval-headcount');

    // 5) OT concentration — top shift by OT
    const ot = await this.ds.query(
      `SELECT shift_code, COALESCE(SUM(${TRUE_OT}),0)::int otm FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_code IS NOT NULL GROUP BY shift_code ORDER BY otm DESC LIMIT 1`, [t, dFrom, dTo]);
    if (ot[0]?.otm > 0) push('info', 'overtime', `OT concentrated on the ${ot[0].shift_code} shift`, `${Math.round(ot[0].otm / 60)}h total overtime`, '/report-builder');

    // 6) conformance trend vs previous equal-length period
    const [cur] = await this.ds.query(`SELECT ROUND(AVG(adherence_pct),1) v FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness`, [t, dFrom, dTo]);
    const [prev] = await this.ds.query(`SELECT ROUND(AVG(adherence_pct),1) v FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness`, [t, prevFrom, prevTo]);
    if (cur?.v != null && prev?.v != null) { const delta = Math.round((cur.v - prev.v) * 10) / 10;
      push(delta < -3 ? 'warning' : 'info', 'trend', `Conformance ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)} pts vs previous period`, `${prev.v}% → ${cur.v}%`, '/roster-dashboard', delta); }

    // 7) data quality
    const [dq] = await this.ds.query(`SELECT COUNT(*) FILTER (WHERE data_quality IS NOT NULL)::int flagged FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [t, dFrom, dTo]);
    if (dq?.flagged) push('info', 'quality', `${dq.flagged.toLocaleString()} rows carry a data-quality flag`, 'Review in System Audit', '/system-audit');

    const rank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    out.sort((a, b) => (rank[b.severity] - rank[a.severity]));
    return { from: dFrom, to: dTo, count: out.length, insights: out };
  }

  /** Team 360 — a whole team's WFM card for a team leader: team aggregate KPIs +
   *  per-agent breakdown + shift distribution. Excludes hidden TLs' scrubbed labels. */
  @Get('roster-v2/team-360')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Team 360 — team-leader aggregate + per-agent breakdown + shift distribution' })
  async team360(@Req() req: any, @Query('teamLeader') tl?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    // default to the team leader with the most reports if none given
    const tlName = tl || (await this.ds.query(`SELECT team_manager FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' GROUP BY team_manager ORDER BY COUNT(*) DESC LIMIT 1`, [t]))[0]?.team_manager;
    if (!tlName) throw new BadRequestException('No team leaders found');
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p = [t, tlName, dFrom, dTo]; const W = `tenant_id=$1 AND team_manager=$2 AND work_date BETWEEN $3 AND $4 AND is_active`;
    const [summary] = await this.ds.query(`
      SELECT COUNT(DISTINCT person_no)::int agents, COUNT(*)::int records,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int workedDays,
             COUNT(*) FILTER (WHERE presence='off')::int offDays,
             COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent,
             COUNT(*) FILTER (WHERE presence='leave')::int leave,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int lateDays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int lateMin,
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int earlyDays,
             COALESCE(SUM(ot_before_min),0)::int otBefore, COALESCE(SUM(ot_after_min),0)::int otAfter, COALESCE(SUM(${TRUE_OT}),0)::int otTotal,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W}`, p);
    const agents = await this.ds.query(`
      SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) function_name,
             mode() WITHIN GROUP (ORDER BY role_category) role,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int lateDays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int lateMin,
             COALESCE(SUM(${TRUE_OT}),0)::int otMin, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W} AND person_no IS NOT NULL GROUP BY person_no ORDER BY conformance ASC NULLS LAST`, p);
    const byShift = await this.ds.query(`SELECT shift_code k, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh') GROUP BY shift_code ORDER BY n DESC`, p);
    // team-leader picker options (verified, non-hidden)
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);
    return { teamLeader: tlName, from: dFrom, to: dTo, range, summary, agents, byShift, teamLeaders: tlOpts.map((r: any) => r.v) };
  }

  /** Scorecard Board — the official scorecard at its TRUE grain (agent × week), not
   *  smeared per day. By-agent = avg across the agent's weeks for every KPI; pass
   *  ?person= for the W1–W5 weekly drill. Alias-aware via employee_identity. */
  @Get('roster-v2/scorecard')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Official scorecard board — per-agent (avg of weeks) + weekly W1–W5 drill, all KPIs' })
  async scorecardBoard(@Req() req: any, @Query('function') fn?: string, @Query('teamLeader') tl?: string, @Query('person') person?: string) {
    const t = req.user.tenantId;
    // KPI metadata + max points (cap = top observed score per KPI)
    const [mx] = await this.ds.query(
      `SELECT MAX(quality_score) quality, MAX(aht_score) aht, MAX(fcr_score) fcr, MAX(productivity_score) productivity,
              MAX(ctr_score) ctr, MAX(quiz_score) quiz, MAX(prr_points) prr, MAX(response_time_score) resptime,
              MAX(mistakes_score) mistakes, MAX(incidents_score) incidents, MAX(attendance_score) attendance
         FROM scorecard_entries WHERE tenant_id=$1`, [t]);
    const kpiMeta = [
      ['quality', 'Quality', 'pct'], ['fcr', 'FCR', 'pct'], ['productivity', 'Productivity', 'pct'], ['mistakes', 'Mistakes', 'count'], ['resptime', 'Response Time', 'min'],
      ['ctr', 'CTR', 'pct'], ['quiz', 'Quiz', 'pct'], ['aht', 'AHT', 'min'], ['prr', 'PRR', 'pct'], ['incidents', 'Incidents', 'count'], ['attendance', 'Attendance', 'pct'],
    ].map(([k, l, unit]) => ({ key: k, label: l, unit, max: mx?.[k] != null ? Number(mx[k]) : null }))
      .filter((m) => m.max != null && m.max > 0);   // hide KPIs with no data this period (e.g. Incidents/Attendance)
    // actual measure per KPI (alongside points): pct ×100, AHT in minutes, response-time day-fraction ×1440 = minutes, counts as-is
    const ACT = `ROUND(AVG(se.quality_actual::numeric)*100,1) quality_act, ROUND(AVG(se.aht_actual::numeric),2) aht_act,
      ROUND(AVG(se.fcr_actual::numeric)*100,1) fcr_act, ROUND(AVG(se.productivity_actual::numeric)*100,1) productivity_act,
      ROUND(AVG(se.ctr_actual::numeric)*100,1) ctr_act, ROUND(AVG(se.quiz_actual::numeric)*100,1) quiz_act,
      ROUND(AVG(se.prr_rate::numeric)*100,1) prr_act, ROUND(AVG(se.response_time_actual::numeric)*1440,1) resptime_act,
      ROUND(AVG(se.mistakes_actual::numeric),1) mistakes_act`;

    if (person) { // weekly drill for one agent
      const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, person])).map((r: any) => r.employee_no);
      const weeks = await this.ds.query(
        `SELECT week_label, net_points net, function_rank rank, quality_score quality, aht_score aht, fcr_score fcr,
                productivity_score productivity, ctr_score ctr, quiz_score quiz, prr_points prr, response_time_score resptime,
                mistakes_score mistakes, incidents_score incidents, attendance_score attendance,
                ROUND(quality_actual::numeric*100,1) quality_act, ROUND(aht_actual::numeric,2) aht_act, ROUND(fcr_actual::numeric*100,1) fcr_act,
                ROUND(productivity_actual::numeric*100,1) productivity_act, ROUND(ctr_actual::numeric*100,1) ctr_act, ROUND(quiz_actual::numeric*100,1) quiz_act,
                ROUND(prr_rate::numeric*100,1) prr_act, ROUND(response_time_actual::numeric*1440,1) resptime_act, ROUND(mistakes_actual::numeric,1) mistakes_act,
                ROUND(response_rate::numeric*100,1) res, ROUND(working_days_pct::numeric*100,1) wd
           FROM scorecard_entries WHERE tenant_id=$1 AND employee_no = ANY($2) ORDER BY week_label`, [t, ids.length ? ids : [person]]);
      return { person, kpiMeta, weeks };
    }

    const p: any[] = [t]; let w = `se.tenant_id=$1`;
    if (fn) { p.push(fn); w += ` AND se.function_name=$${p.length}`; }
    if (tl) { p.push(tl); w += ` AND se.team_leader=$${p.length}`; }
    const agents = await this.ds.query(
      `SELECT i.person_no, mode() WITHIN GROUP (ORDER BY i.clean_name) name, mode() WITHIN GROUP (ORDER BY se.function_name) fn,
              mode() WITHIN GROUP (ORDER BY se.team_leader) tl, COUNT(*)::int weeks,
              ROUND(AVG(se.net_points),1) net, ROUND(AVG(se.function_rank),1) rank,
              ROUND(AVG(se.quality_score),1) quality, ROUND(AVG(se.aht_score),1) aht, ROUND(AVG(se.fcr_score),1) fcr,
              ROUND(AVG(se.productivity_score),1) productivity, ROUND(AVG(se.ctr_score),1) ctr, ROUND(AVG(se.quiz_score),1) quiz,
              ROUND(AVG(se.prr_points),1) prr, ROUND(AVG(se.response_time_score),1) resptime, ROUND(AVG(se.mistakes_score),1) mistakes,
              ROUND(AVG(se.incidents_score),1) incidents, ROUND(AVG(se.attendance_score),1) attendance, ROUND(AVG(se.response_rate::numeric)*100,1) res, ${ACT}
         FROM scorecard_entries se JOIN employee_identity i ON i.tenant_id=se.tenant_id AND i.employee_no=se.employee_no
        WHERE ${w} GROUP BY i.person_no ORDER BY net DESC NULLS LAST`, p);
    // "where short" — the KPI losing the most points vs its max (biggest gap)
    for (const a of agents) { let worst: any = null;
      for (const k of kpiMeta) { const v = a[k.key] == null ? null : Number(a[k.key]); if (v == null || !k.max) continue; const gap = Math.round((k.max - v) * 10) / 10; if (gap > 0 && (!worst || gap > worst.gap)) worst = { key: k.key, label: k.label, gap, score: v, max: k.max }; }
      a.weakest = worst; }
    const fnOpts = await this.ds.query(`SELECT DISTINCT function_name v FROM scorecard_entries WHERE tenant_id=$1 AND function_name IS NOT NULL ORDER BY 1`, [t]);
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_leader v FROM scorecard_entries WHERE tenant_id=$1 AND team_leader IS NOT NULL ORDER BY 1`, [t]);
    const avgNet = agents.length ? Math.round(agents.reduce((a: number, r: any) => a + Number(r.net || 0), 0) / agents.length * 10) / 10 : 0;
    return { kpiMeta, agents, avgNet, count: agents.length, filterOptions: { functions: fnOpts.map((r: any) => r.v), teamLeaders: tlOpts.map((r: any) => r.v) } };
  }

  /** Agent Progress — month-over-month self-comparison: did this agent improve or
   *  decline? Merges roster KPIs (conformance/late/OT/absence) with official Net
   *  Points per month, computes deltas vs the prior month, and a verdict. */
  @Get('roster-v2/agent-progress')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-agent month-over-month progress + improving/declining verdict' })
  async agentProgress(@Req() req: any, @Query('person') person?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person is required');
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, person])).map((r: any) => r.employee_no);
    const idList = ids.length ? ids : [person];
    const rosterM = await this.ds.query(`
      SELECT EXTRACT(YEAR FROM work_date)::int yr, EXTRACT(MONTH FROM work_date)::int mo, MIN(month_name) month_name,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conf,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int earlydays, COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int earlymin,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE missing_punch)::int missingpunch, COUNT(*) FILTER (WHERE missing_system)::int missingsystem,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions
        FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date BETWEEN $3 AND $4
        GROUP BY 1,2 ORDER BY 1,2`, [t, person, dFrom, dTo]);
    const netM = await this.ds.query(`
      SELECT year yr, month mo, ROUND(AVG(avg_net_points::numeric),1) net
        FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no = ANY($2)
          AND make_date(year,month,1) BETWEEN date_trunc('month',$3::date) AND $4::date
        GROUP BY year,month`, [t, idList, dFrom, dTo]);
    const netMap = new Map(netM.map((r: any) => [`${r.yr}-${r.mo}`, Number(r.net)]));
    const months = rosterM.map((r: any) => ({ yr: r.yr, mo: r.mo, label: `${r.month_name || r.mo} ${String(r.yr).slice(2)}`,
      worked: r.worked, conf: r.conf == null ? null : Number(r.conf), lateDays: r.latedays, lateMin: r.latemin,
      earlyDays: r.earlydays, earlyMin: r.earlymin, otMin: r.otmin, absent: r.absent, sick: r.sick,
      missingPunch: r.missingpunch, missingSystem: r.missingsystem, permissions: r.permissions,
      net: netMap.has(`${r.yr}-${r.mo}`) ? netMap.get(`${r.yr}-${r.mo}`) : null }));
    // deltas vs previous month — every customizable metric, so the UI can pick any column
    const DKEYS = ['conf', 'net', 'worked', 'lateDays', 'lateMin', 'earlyDays', 'earlyMin', 'otMin', 'absent', 'sick', 'missingPunch', 'missingSystem', 'permissions'];
    months.forEach((m: any, i: number) => { const p: any = i > 0 ? months[i - 1] : null;
      m.d = p ? Object.fromEntries(DKEYS.map((k) => [k, m[k] != null && p[k] != null ? Math.round((m[k] - p[k]) * 10) / 10 : null])) : null; });
    // verdict: first vs last non-null
    const firstLast = (key: string) => { const vals = months.filter((m: any) => m[key] != null); return vals.length >= 2 ? { first: vals[0][key], last: vals[vals.length - 1][key], change: Math.round((vals[vals.length - 1][key] - vals[0][key]) * 10) / 10 } : null; };
    const confV = firstLast('conf'), netV = firstLast('net');
    const dir = (c: number | null | undefined, th = 2) => c == null ? 'flat' : c > th ? 'up' : c < -th ? 'down' : 'flat';
    let overall = 'stable';
    const cd = confV ? dir(confV.change) : null, nd = netV ? dir(netV.change, 3) : null;
    if (cd === 'up' || nd === 'up') overall = (cd === 'down' || nd === 'down') ? 'mixed' : 'improving';
    if ((cd === 'down' || nd === 'down') && overall !== 'mixed' && overall !== 'improving') overall = 'declining';
    return { person, ids: idList, from: dFrom, to: dTo, months,
             verdict: { conformance: confV && { ...confV, dir: dir(confV.change) }, net: netV && { ...netV, dir: dir(netV.change, 3) }, overall } };
  }

  /** Agent Performance — joins the official monthly scorecard (Net Points), Ameyo
   *  productivity (AHT / occupancy / calls from talk+ACW) and FCR to the roster
   *  identity (alias-aware: old+new IDs). Complements the attendance/adherence score. */
  @Get('roster-v2/agent-performance')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Agent performance: official Net Points + AHT/occupancy + FCR joined to roster identity' })
  async agentPerformance(@Req() req: any, @Query('person') person?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person is required');
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    // every raw id this person has had (old intern + new full-time)
    const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, person])).map((r: any) => r.employee_no);
    const idList = ids.length ? ids : [person];
    // official scorecard — monthly Net Points
    const scorecard = await this.ds.query(
      `SELECT year, month, ROUND(AVG(avg_net_points::numeric),1) net, ROUND(AVG(best_net::numeric),0) best, ROUND(AVG(worst_net::numeric),0) worst, SUM(weeks_scored)::int weeks
         FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no = ANY($2) GROUP BY year, month ORDER BY year, month`, [t, idList]);
    // Ameyo productivity → AHT / occupancy / calls
    const [prod] = await this.ds.query(
      `SELECT COALESCE(SUM(talk_seconds),0)::bigint talk, COALESCE(SUM(acw_seconds),0)::bigint acw,
              COALESCE(SUM(staffed_seconds),0)::bigint staffed, COALESCE(SUM(ready_seconds),0)::bigint ready,
              COALESCE(SUM(wrapped_calls),0)::int calls, COALESCE(SUM(inbound_received),0)::int received,
              COUNT(DISTINCT work_date)::int days
         FROM agent_productivity_daily WHERE tenant_id=$1 AND employee_no = ANY($2) AND work_date BETWEEN $3 AND $4`, [t, idList, dFrom, dTo]);
    const handled = prod.calls > 0 ? prod.calls : prod.received;
    const ahtSec = handled > 0 ? Math.round((Number(prod.talk) + Number(prod.acw)) / handled) : null;
    const occupancy = Number(prod.staffed) > 0 ? Math.round(100 * (Number(prod.talk) + Number(prod.acw)) / Number(prod.staffed)) : null;
    const productivity = { ahtSec, occupancy, calls: handled, days: prod.days, talkH: Math.round(Number(prod.talk) / 360) / 10, acwH: Math.round(Number(prod.acw) / 360) / 10, staffedH: Math.round(Number(prod.staffed) / 360) / 10, hasData: prod.days > 0 };
    // FCR (best-effort match by employee id)
    const [fcr] = await this.ds.query(
      `SELECT ROUND(AVG(fcr_pct::numeric),1) pct, COALESCE(SUM(total),0)::int total FROM survey_fcr_monthly WHERE tenant_id=$1 AND employee_id = ANY($2)`, [t, idList]).catch(() => [{ pct: null, total: 0 }]);
    // detailed scorecard KPIs (per-week breakdown averaged) from scorecard_entries
    const [sc] = await this.ds.query(
      `SELECT COUNT(*)::int weeks, ROUND(AVG(net_points),1) net, ROUND(AVG(function_rank),1) rank,
              ROUND(AVG(quality_score),1) quality_s, ROUND(AVG(quality_actual::numeric),4) quality_a,
              ROUND(AVG(aht_score),1) aht_s, ROUND(AVG(aht_actual::numeric),4) aht_a,
              ROUND(AVG(fcr_score),1) fcr_s, ROUND(AVG(fcr_actual::numeric),4) fcr_a,
              ROUND(AVG(productivity_score),1) prod_s, ROUND(AVG(productivity_actual::numeric),4) prod_a,
              ROUND(AVG(ctr_score),1) ctr_s, ROUND(AVG(ctr_actual::numeric),4) ctr_a,
              ROUND(AVG(quiz_score),1) quiz_s, ROUND(AVG(quiz_actual::numeric),4) quiz_a,
              ROUND(AVG(prr_points),1) prr_s, ROUND(AVG(prr_rate::numeric),4) prr_a,
              ROUND(AVG(response_time_score),1) rt_s, ROUND(AVG(response_time_actual::numeric),5) rt_a,
              ROUND(AVG(mistakes_score),1) mist_s, ROUND(AVG(mistakes_actual::numeric),1) mist_a,
              ROUND(AVG(attendance_score),1) att_s, ROUND(AVG(working_days_pct::numeric),4) wd_a
         FROM scorecard_entries WHERE tenant_id=$1 AND employee_no = ANY($2)`, [t, idList]);
    // unit: pct (actual is a 0-1 fraction → ×100), min (minutes → m:ss), count.
    // AHT actual is already minutes; Response Time actual is an Excel day-fraction → ×1440 = minutes.
    const num = (v: any) => v == null ? null : Number(v);
    const kpiList = sc && sc.weeks > 0 ? [
      { key: 'quality', label: 'Quality', score: sc.quality_s, actual: num(sc.quality_a), unit: 'pct' },
      { key: 'aht', label: 'AHT', score: sc.aht_s, actual: num(sc.aht_a), unit: 'min' },
      { key: 'fcr', label: 'FCR', score: sc.fcr_s, actual: num(sc.fcr_a), unit: 'pct' },
      { key: 'productivity', label: 'Productivity', score: sc.prod_s, actual: num(sc.prod_a), unit: 'pct' },
      { key: 'ctr', label: 'CTR', score: sc.ctr_s, actual: num(sc.ctr_a), unit: 'pct' },
      { key: 'quiz', label: 'Quiz', score: sc.quiz_s, actual: num(sc.quiz_a), unit: 'pct' },
      { key: 'prr', label: 'PRR', score: sc.prr_s, actual: num(sc.prr_a), unit: 'pct' },
      { key: 'responseTime', label: 'Response Time', score: sc.rt_s, actual: sc.rt_a == null ? null : Math.round(Number(sc.rt_a) * 1440 * 100) / 100, unit: 'min' },
      { key: 'mistakes', label: 'Mistakes', score: sc.mist_s, actual: num(sc.mist_a), unit: 'count' },
      { key: 'attendance', label: 'Attendance', score: sc.att_s, actual: num(sc.wd_a), unit: 'pct' },
    ].filter(k => k.score != null) : [];
    const latest = scorecard.length ? scorecard[scorecard.length - 1] : null;
    return { person, ids: idList, from: dFrom, to: dTo,
             scorecard, latestNet: latest?.net ?? null, scorecardMonths: scorecard.length,
             scorecardDetail: sc && sc.weeks > 0 ? { weeks: sc.weeks, net: sc.net, rank: sc.rank, kpis: kpiList } : null,
             productivity, fcr: { pct: fcr?.pct ?? null, total: fcr?.total ?? 0 } };
  }

  /** Agent Period Compare — "compare the agent to himself" across two ARBITRARY
   *  periods A and B (e.g. last month vs the prior 3 months). The periods may be
   *  different lengths, so every compared metric is a RATE or an AVERAGE
   *  (length-independent) — never a raw count, which would just track period length.
   *  Returns both snapshots, per-metric deltas with an improved/declined/flat trend,
   *  and an overall verdict the TL can read out to the agent. Alias-aware. */
  @Get('roster-v2/agent-period-compare')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Self-comparison across two arbitrary periods (improvement/decline verdict)' })
  async agentPeriodCompare(@Req() req: any, @Query('person') person?: string,
    @Query('aFrom') aFrom?: string, @Query('aTo') aTo?: string, @Query('bFrom') bFrom?: string, @Query('bTo') bTo?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person is required');
    if (!aFrom || !aTo || !bFrom || !bTo) throw new BadRequestException('aFrom, aTo, bFrom, bTo are all required');
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    if (![aFrom, aTo, bFrom, bTo].every(isDate)) throw new BadRequestException('dates must be YYYY-MM-DD');
    if (aFrom > aTo) throw new BadRequestException('aFrom must be on or before aTo');
    if (bFrom > bTo) throw new BadRequestException('bFrom must be on or before bTo');
    const [emp] = await this.ds.query(
      `SELECT person_no, clean_name, function_name, role_category, team_leader, is_active
         FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND (person_no=$2 OR lower(clean_name) LIKE lower($3)) ORDER BY (person_no=$2) DESC LIMIT 1`,
      [t, person, `%${person}%`]);
    if (!emp) throw new BadRequestException('No such agent');
    const pn = emp.person_no;
    const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, pn])).map((r: any) => r.employee_no);
    const idList = ids.length ? ids : [pn];

    // one period snapshot → raw aggregates + length-independent rates/averages
    const snap = async (f: string, to: string) => {
      const [a] = await this.ds.query(`
        SELECT COUNT(*)::int "scheduledDays",
               COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int "workedDays",
               COUNT(*) FILTER (WHERE presence='sick')::int "sickDays",
               COUNT(*) FILTER (WHERE presence='absent')::int "absenceDays",
               COUNT(*) FILTER (WHERE ${CRED_LATE})::int "lateDays", COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int "totalLateMin",
               COUNT(*) FILTER (WHERE ${CRED_EARLY})::int "earlyDays", COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int "totalEarlyMin",
               COALESCE(SUM(${TRUE_OT}),0)::int "otTotal",
               COUNT(*) FILTER (WHERE missing_punch)::int "missingPunch", COUNT(*) FILTER (WHERE missing_system)::int "missingSystem",
               COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
               ROUND(AVG(adherence_pct),1) conformance
          FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date BETWEEN $3 AND $4`, [t, pn, f, to]);
      const [net] = await this.ds.query(`
        SELECT ROUND(AVG(avg_net_points::numeric),1) net, COUNT(*)::int months
          FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no = ANY($2)
            AND make_date(year,month,1) BETWEEN date_trunc('month',$3::date) AND $4::date`, [t, idList, f, to]);
      const [prod] = await this.ds.query(`
        SELECT COALESCE(SUM(talk_seconds),0)::bigint talk, COALESCE(SUM(acw_seconds),0)::bigint acw,
               COALESCE(SUM(staffed_seconds),0)::bigint staffed, COALESCE(SUM(wrapped_calls),0)::int calls,
               COALESCE(SUM(inbound_received),0)::int received, COUNT(DISTINCT work_date)::int days
          FROM agent_productivity_daily WHERE tenant_id=$1 AND employee_no = ANY($2) AND work_date BETWEEN $3 AND $4`, [t, idList, f, to]);
      const handled = prod.calls > 0 ? prod.calls : prod.received;
      const ahtSec = handled > 0 ? Math.round((Number(prod.talk) + Number(prod.acw)) / handled) : null;
      const occupancy = Number(prod.staffed) > 0 ? Math.round(100 * (Number(prod.talk) + Number(prod.acw)) / Number(prod.staffed)) : null;
      const [fcr] = await this.ds.query(`
        SELECT ROUND(AVG(fcr_pct::numeric),1) pct, COALESCE(SUM(total),0)::int total FROM survey_fcr_monthly
          WHERE tenant_id=$1 AND employee_id IN (SELECT id FROM employees WHERE tenant_id=$1 AND employee_no = ANY($2))
            AND year_month BETWEEN date_trunc('month',$3::date) AND $4::date`, [t, idList, f, to]).catch(() => [{ pct: null, total: 0 }]);
      const sched = a.scheduledDays || 0, worked = a.workedDays || 0;
      const rate = (n: number, d: number) => d > 0 ? Math.round(1000 * n / d) / 10 : null;
      return { from: f, to, lengthDays: Math.round((Date.parse(to) - Date.parse(f)) / 86400000) + 1,
        scheduledDays: sched, workedDays: worked, otTotal: a.otTotal, permissions: a.permissions,
        absenceDays: a.absenceDays, sickDays: a.sickDays, lateDays: a.lateDays, calls: handled, prodDays: prod.days, netMonths: net.months,
        // length-independent comparison metrics:
        conformance: a.conformance == null ? null : Number(a.conformance),
        lateRate: rate(a.lateDays, sched), lateMinPerDay: sched > 0 ? Math.round(10 * a.totalLateMin / sched) / 10 : null,
        earlyRate: rate(a.earlyDays, sched), absenceRate: rate(a.absenceDays, sched), sickRate: rate(a.sickDays, sched),
        missingPunchRate: rate(a.missingPunch, worked), missingSystemRate: rate(a.missingSystem, worked),
        otPerDay: worked > 0 ? Math.round(10 * a.otTotal / worked) / 10 : null,
        netPoints: net.net == null ? null : Number(net.net), ahtSec, occupancy, fcr: fcr?.pct == null ? null : Number(fcr.pct) };
    };

    const [A, B] = await Promise.all([snap(aFrom, aTo), snap(bFrom, bTo)]);
    // metric catalogue — up=true means higher is better. flat = threshold below which a change is "no real change".
    // up=true → higher is better; up=false → lower is better; up=null → context only
    // (shown for awareness but NOT judged as improved/declined — e.g. sickness isn't a
    // coachable performance failing, and OT volume is a workload signal, not a verdict).
    const M: { key: string; label: string; labelAr: string; unit: string; up: boolean | null; flat: number }[] = [
      { key: 'conformance', label: 'Conformance', labelAr: 'الكونفورمانس', unit: 'pct', up: true, flat: 1 },
      { key: 'netPoints', label: 'Net Points', labelAr: 'Net Points', unit: 'pts', up: true, flat: 1 },
      { key: 'lateRate', label: 'Late-day rate', labelAr: 'نسبة أيام التأخير', unit: 'pct', up: false, flat: 1 },
      { key: 'lateMinPerDay', label: 'Late min / day', labelAr: 'دقائق التأخير/يوم', unit: 'min', up: false, flat: 0.5 },
      { key: 'earlyRate', label: 'Early-out rate', labelAr: 'نسبة الخروج المبكر', unit: 'pct', up: false, flat: 1 },
      { key: 'absenceRate', label: 'Absence rate', labelAr: 'نسبة الغياب', unit: 'pct', up: false, flat: 1 },
      { key: 'missingPunchRate', label: 'Missing-punch rate', labelAr: 'نسبة البصمة الناقصة', unit: 'pct', up: false, flat: 1 },
      { key: 'missingSystemRate', label: 'Missing-system rate', labelAr: 'نسبة السيستم الناقص', unit: 'pct', up: false, flat: 1 },
      { key: 'ahtSec', label: 'AHT', labelAr: 'متوسط المعالجة (AHT)', unit: 'sec', up: false, flat: 3 },
      { key: 'occupancy', label: 'Occupancy', labelAr: 'الإشغال', unit: 'pct', up: true, flat: 1 },
      { key: 'fcr', label: 'FCR', labelAr: 'FCR', unit: 'pct', up: true, flat: 1 },
      { key: 'sickRate', label: 'Sick-day rate', labelAr: 'نسبة أيام المرض', unit: 'pct', up: null, flat: 1 },
      { key: 'otPerDay', label: 'OT min / worked day', labelAr: 'دقائق OT/يوم عمل', unit: 'min', up: null, flat: 1 },
    ];
    let improved = 0, declined = 0;
    const metrics = M.map((m) => { const av = (A as any)[m.key], bv = (B as any)[m.key];
      const delta = (av != null && bv != null) ? Math.round((av - bv) * 10) / 10 : null;
      let trend: 'improved' | 'declined' | 'flat' | 'context' | 'na' = 'na';
      if (delta != null) {
        if (m.up === null) trend = 'context';                       // displayed, not judged
        else if (Math.abs(delta) < m.flat) trend = 'flat';
        else { const good = m.up ? delta > 0 : delta < 0; trend = good ? 'improved' : 'declined'; if (good) improved++; else declined++; }
      }
      return { key: m.key, label: m.label, labelAr: m.labelAr, unit: m.unit, goodWhenUp: m.up, context: m.up === null, a: av ?? null, b: bv ?? null, delta, trend };
    });
    const overall = improved > 0 && declined > 0 ? 'mixed' : improved > 0 ? 'improving' : declined > 0 ? 'declining' : 'stable';
    return { person: pn, employee: emp, a: A, b: B, metrics,
      verdict: { improvements: metrics.filter((x) => x.trend === 'improved'), declines: metrics.filter((x) => x.trend === 'declined'), improved, declined, overall } };
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  WFH HR ACTION REPORT  (weekly HR ask: who worked from home late/short)
   *  WFH = scheduled shift + system login/logout (Ameyo/Sprinklr) + NO Odoo
   *  fingerprint + reasonable shift match. Send to HR ONLY a WFH agent who was
   *  late-in OR early-out, with no approved permission/COMP/OT, who did NOT cover
   *  the full scheduled shift span, shortage ≥ 5 min, and is not an excluded role.
   *  CONSERVATIVE: weak/ambiguous evidence → audit / data-quality, NEVER HR.
   *  Locked decision: "completed" = consolidated system span (earliest login →
   *  latest logout, cross-midnight aligned) ≥ scheduled GROSS shift duration.
   *  16 Jun 2026 = Hijri-New-Year public holiday → holiday work, no lateness action.
   *  Note: roster_days stores minutes → HH:MM:SS shows :00 seconds; raw-file run
   *  can preserve seconds. Permission/COMP read from the DB — validate vs the
   *  authoritative Odoo files before final HR submission. ══════════════════════ */
  private readonly WFH_EXCLUDE_RE = /team ?lead|leader|senior|\brta\b|customer\s*care|resolution|specialist|support/i;
  private readonly WFH_MOTHERS = ['haya', 'shaima', 'shaimaa'];
  private wfhHms(min: number | null): string {
    if (min == null || Number.isNaN(min)) return '';
    const neg = min < 0; const m = Math.abs(Math.round(min));
    return `${neg ? '-' : ''}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  }
  private wfhClk(min: number | null): string {
    if (min == null || Number.isNaN(min)) return '';
    const m = (((Math.round(min) % 1440) + 1440) % 1440);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  private async buildWfhReport(t: string, from: string, to: string, includeExcluded: boolean) {
    const rows = await this.ds.query(
      `SELECT work_date::text date, day_name, person_no, employee_no, clean_name,
              role_function, role_category, team_manager, shift_code, shift_start_min, shift_end_min,
              sys_login_min, sys_logout_min, login_src, presence, permission_type, permission_duration,
              comp_off, comp_worked_min, ot_min, ot_before_min, ot_after_min, offday_ot_min, holiday_ot_min, include_tardiness
         FROM roster_days
        WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3
          AND punch_in_min IS NULL AND sys_login_min IS NOT NULL
          AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL
        ORDER BY work_date, clean_name`, [t, from, to]);

    const alignTo = (v: number, ref: number) => { let x = v; while (x < ref - 720) x += 1440; while (x > ref + 720) x -= 1440; return x; };
    // official holidays come from the editable `holidays` table (synced from recon-config.json) — NOT a single
    // hardcoded date, so WFH work on Arafat/Eid/National-Day etc. is correctly treated as holiday work, never HR.
    const holSet = new Set((await this.ds.query(`SELECT holiday_date::text d FROM holidays WHERE tenant_id=$1`, [t])).rows.map((x: any) => x.d));
    const out: any[] = [];
    for (const r of rows) {
      const start = Number(r.shift_start_min), end = Number(r.shift_end_min);
      const code = (r.shift_code || '').toString();
      const nameLc = (r.clean_name || '').toLowerCase();
      const mother = /7$/.test(code.toLowerCase()) || this.WFH_MOTHERS.some(m => nameLc.includes(m));
      // mothers work a 7h shift even if the roster code reads a 9h one → measure
      // against a 7h window (6h net) so they aren't wrongly flagged for the last 2h.
      const gross = mother ? Math.min(end - start, 420) : end - start;
      const effEnd = start + gross;
      const breakMin = 60;
      const requiredNet = Math.max(0, gross - breakMin);
      const excludedRole = !r.include_tardiness || this.WFH_EXCLUDE_RE.test(`${r.role_category || ''} ${r.role_function || ''}`);
      const holiday = holSet.has(r.date);
      // any presence other than a clean 'wfh' (sick/absent/leave/off/holiday/office…) +
      // no fingerprint is an internal contradiction → route to Data Quality, never HR.
      const onLeave = r.presence != null && r.presence !== 'wfh';
      const hasPerm = r.permission_type != null;
      const hasComp = r.comp_off != null || Number(r.comp_worked_min || 0) > 0;
      const hasOT = Number(r.ot_min || 0) > 0 || Number(r.ot_before_min || 0) > 0 || Number(r.ot_after_min || 0) > 0
        || Number(r.offday_ot_min || 0) > 0 || Number(r.holiday_ot_min || 0) > 0;

      const login = alignTo(Number(r.sys_login_min), start);
      const logout = r.sys_logout_min == null ? null : alignTo(Number(r.sys_logout_min), effEnd);
      let dq: string | null = null;
      if (logout == null) dq = 'Missing system logout';
      else if (logout <= login) dq = 'Incoherent session (logout ≤ login after midnight alignment)';
      else if (logout - login > gross + 720) dq = 'Implausible system span';

      const span = (logout != null && !dq) ? logout - login : null;
      const lateLogin = !dq ? Math.max(0, login - start) : null;
      const earlyLogout = (logout != null && !dq) ? Math.max(0, effEnd - logout) : null;
      const shortage = span != null ? Math.max(0, gross - span) : null;
      const completed = span != null ? span >= gross : false;
      // FAIRNESS GUARD: a genuine WFH lateness is minutes to ~2h. A >3h late-in /
      // early-out, or a tiny (<60min) session, is almost always a split or missing
      // overnight session in the daily roster (esp. cross-midnight MD/MN) — never
      // flag HR on that; send to data-quality to validate against the raw files.
      const crossMid = effEnd > 1440;
      if (!dq && span != null) {
        if (crossMid && !completed && ((lateLogin || 0) > 0 || (earlyLogout || 0) > 0)) {
          dq = 'Cross-midnight (MD/MN) — overnight session is split across days in the daily roster; validate vs raw Ameyo/Sprinklr before any HR action';
        } else if ((lateLogin || 0) > 180 || (earlyLogout || 0) > 180 || span < 60) {
          dq = 'Login/logout off by >3h or <1h session — likely missing/duplicate session — validate vs raw files';
        }
      }

      let bucket: string, hrAction = false, reason = '';
      if (dq) { bucket = 'data_quality'; reason = dq; }
      else if (onLeave) { bucket = 'data_quality'; reason = `Worked while ${r.presence} — review as exception`; }
      else if (excludedRole && !includeExcluded) { bucket = 'excluded_valid'; reason = 'Excluded role (TL / Senior / RTA / Customer Care / Resolution)'; }
      else if (holiday) { bucket = 'excluded_valid'; reason = 'Public holiday 16 Jun (Hijri New Year) — holiday work'; }
      else if (hasPerm) { bucket = 'excluded_valid'; reason = `Approved permission${r.permission_type ? ': ' + r.permission_type : ''}`; }
      else if (hasComp) { bucket = 'excluded_valid'; reason = 'Approved COMP'; }
      else if (hasOT) { bucket = 'excluded_valid'; reason = 'Overtime / compensated same day'; }
      else if (completed) { bucket = 'excluded_valid'; reason = 'Completed full scheduled hours'; }
      else if ((lateLogin || 0) === 0 && (earlyLogout || 0) === 0) { bucket = 'excluded_valid'; reason = 'No lateness / early logout'; }
      else if ((shortage || 0) < 5) { bucket = 'excluded_valid'; reason = 'Shortage below 5 minutes'; }
      else { bucket = 'hr_action'; hrAction = true; reason = `Short ${this.wfhHms(shortage)} (late-in ${this.wfhHms(lateLogin)}, early-out ${this.wfhHms(earlyLogout)})`; }

      out.push({
        date: r.date, day: r.day_name, name: r.clean_name, employeeNo: r.employee_no, person: r.person_no,
        function: r.role_function || '—', role: r.role_category || '—', teamLeader: r.team_manager || '—', shiftCode: code,
        schedStart: this.wfhClk(start), schedEnd: this.wfhClk(effEnd), schedGross: this.wfhHms(gross), breakDeduct: this.wfhHms(breakMin),
        requiredNet: this.wfhHms(requiredNet), source: r.login_src || '', loginTime: this.wfhClk(login), logoutTime: this.wfhClk(logout),
        lateLogin: this.wfhHms(lateLogin), earlyLogout: this.wfhHms(earlyLogout), systemSpan: this.wfhHms(span), shortage: this.wfhHms(shortage),
        mother, holiday, permission: hasPerm ? (r.permission_type || 'yes') : '', permissionDur: r.permission_duration || '',
        comp: hasComp ? 'yes' : '', fingerprint: 'none', wfh: 'WFH', excludedRole, hrAction, bucket, reason,
        _shortageMin: shortage || 0, _lateMin: lateLogin || 0,
      });
    }

    const action = out.filter((r) => r.bucket === 'hr_action').sort((a, b) => b._shortageMin - a._shortageMin);
    const excludedValid = out.filter((r) => r.bucket === 'excluded_valid');
    const dataQuality = out.filter((r) => r.bucket === 'data_quality');
    const groupSum = (key: string) => { const m = new Map<string, any>();
      for (const r of out) { const k = r[key] || '—'; const g = m.get(k) || { key: k, total: 0, hr: 0, excluded: 0, dq: 0, shortageMin: 0 };
        g.total++; if (r.bucket === 'hr_action') { g.hr++; g.shortageMin += r._shortageMin; } else if (r.bucket === 'excluded_valid') g.excluded++; else g.dq++; m.set(k, g); }
      return [...m.values()].sort((a, b) => b.hr - a.hr || b.total - a.total); };
    const cnt = (re: RegExp) => excludedValid.filter((r) => re.test(r.reason)).length;
    const totals = {
      wfhRecords: out.length, hrAction: action.length, excludedValid: excludedValid.length, dataQuality: dataQuality.length,
      byReason: { completed: cnt(/Completed/), permission: cnt(/permission/i), comp: cnt(/COMP/), role: cnt(/Excluded role/),
        below5: cnt(/below 5/), ot: cnt(/Overtime/), holiday: cnt(/holiday/i), noLateness: cnt(/No lateness/) },
      topAgents: groupSum('name').filter((g) => g.hr > 0).slice(0, 10),
      topDates: groupSum('date').filter((g) => g.hr > 0).slice(0, 10),
    };
    return { from, to, includeExcluded, rows: out, action, excludedValid, dataQuality,
      summaryByAgent: groupSum('name'), summaryByTeamLeader: groupSum('teamLeader'),
      summaryByFunction: groupSum('function'), summaryByDate: groupSum('date'), totals };
  }

  /** WFH HR action report — JSON (8 views). Default range 1 May → 20 Jun 2026. */
  @Get('roster-v2/wfh-hr-report')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'WFH HR action report — conservative late/early-out WFH detection + 8 views' })
  async wfhHrReport(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('includeExcludedRoles') inc?: string) {
    return this.buildWfhReport(req.user.tenantId, from || '2026-05-01', to || '2026-06-20', inc === '1');
  }

  /** WFH HR report → Excel workbook (8 sheets). */
  @Get('roster-v2/wfh-hr-report/export')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'WFH HR report → .xlsx (HR_Action, Audit_All, Excluded_Valid, Data_Quality + 4 summaries)' })
  async wfhHrExport(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('includeExcludedRoles') inc?: string) {
    const dFrom = from || '2026-05-01', dTo = to || '2026-06-20';
    const rep = await this.buildWfhReport(req.user.tenantId, dFrom, dTo, inc === '1');
    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const COLS = [
      { h: 'Day', k: 'day' }, { h: 'Date', k: 'date' }, { h: 'Employee', k: 'name', w: 20 }, { h: 'Emp ID', k: 'employeeNo' },
      { h: 'Function', k: 'function', w: 14 }, { h: 'Role', k: 'role', w: 14 }, { h: 'Team Leader', k: 'teamLeader', w: 16 }, { h: 'Shift', k: 'shiftCode' },
      { h: 'Sched Start', k: 'schedStart' }, { h: 'Sched End', k: 'schedEnd' }, { h: 'Source', k: 'source', w: 14 }, { h: 'Login', k: 'loginTime' },
      { h: 'Logout', k: 'logoutTime' }, { h: 'Late In', k: 'lateLogin' }, { h: 'Early Out', k: 'earlyLogout' }, { h: 'System Hours', k: 'systemSpan' },
      { h: 'Required Net', k: 'requiredNet' }, { h: 'Shortage', k: 'shortage' }, { h: 'Permission', k: 'permission', w: 14 }, { h: 'Perm Dur', k: 'permissionDur' },
      { h: 'COMP', k: 'comp' }, { h: 'Fingerprint', k: 'fingerprint' }, { h: 'WFH', k: 'wfh' }, { h: 'HR Action', k: 'hrAction' }, { h: 'Reason', k: 'reason', w: 44 },
    ];
    const sheet = (name: string, data: any[]) => { const ws = wb.addWorksheet(name);
      ws.columns = COLS.map((c) => ({ header: c.h, key: c.k, width: c.w || 11 }));
      data.forEach((r) => ws.addRow({ ...r, hrAction: r.hrAction ? 'Yes' : 'No' }));
      ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
    sheet('WFH_HR_Action', rep.action); sheet('WFH_Audit_All', rep.rows);
    sheet('WFH_Excluded_Valid', rep.excludedValid); sheet('WFH_Data_Quality', rep.dataQuality);
    const sumCols = [{ h: 'Name', k: 'key', w: 24 }, { h: 'Total', k: 'total' }, { h: 'HR Action', k: 'hr' }, { h: 'Excluded', k: 'excluded' }, { h: 'Data Quality', k: 'dq' }];
    const sumSheet = (name: string, label: string, data: any[]) => { const ws = wb.addWorksheet(name);
      ws.columns = sumCols.map((c) => ({ header: c.k === 'key' ? label : c.h, key: c.k, width: c.w || 12 }));
      data.forEach((r) => ws.addRow(r)); ws.getRow(1).font = { bold: true }; };
    sumSheet('Summary_By_Agent', 'Agent', rep.summaryByAgent); sumSheet('Summary_By_TeamLeader', 'Team Leader', rep.summaryByTeamLeader);
    sumSheet('Summary_By_Function', 'Function', rep.summaryByFunction); sumSheet('Summary_By_Date', 'Date', rep.summaryByDate);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="WFH_HR_Report_${dFrom}_${dTo}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

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

  /* ── Approved-schedule SOFT LOCK ───────────────────────────────────────────
   *  The uploaded schedule is the authoritative baseline. Inside its date range,
   *  manual cell edits are blocked for everyone EXCEPT a supervisor with the
   *  `schedule.publish` permission (who may edit, fully audited). The only normal
   *  way to change it is re-uploading the schedule. Range auto-set on upload;
   *  stored in tenant_settings (no migration). Future dates stay editable. */
  private async getScheduleLock(t: string): Promise<{ from: string; to: string; lockedAt?: string; lockedBy?: string } | null> {
    const [r] = await this.ds.query(`SELECT setting_value FROM tenant_settings WHERE tenant_id=$1 AND setting_key='schedule_lock'`, [t]);
    const v = r?.setting_value; return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null;
  }
  private async setScheduleLock(t: string, val: any) {
    await this.ds.query(
      `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_group, updated_at)
         VALUES ($1,'schedule_lock',$2::jsonb,'schedule', now())
       ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=$2::jsonb, updated_at=now()`,
      [t, JSON.stringify(val)]);
  }
  private async assertScheduleEditable(req: any, date: string) {
    const lock = await this.getScheduleLock(req.user.tenantId);
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
    const lock = await this.getScheduleLock(req.user.tenantId);
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
    await this.setScheduleLock(t, val); return { lock: val };
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
    if (fn) { p.push(fn); w += ` AND role_function=$${p.length}`; }
    if (tl) { p.push(tl); w += ` AND team_manager=$${p.length}`; }

    // Tardiness plausibility cap (240 min). Cross-midnight night shifts (MD/MN/MNR,
    // shift_end_min>1440) make the post-midnight session tail read as a multi-HOUR
    // "early-out" — a measurement artifact, not the agent leaving early. A real
    // late-in/early-out is bounded, so values >4h are excluded from the counts and
    // surfaced as `excludedDq` instead of being held against night agents (HR-safe;
    // mirrors the WFH report's ">3h short → data quality" rule).
    const [s] = await this.ds.query(`
      SELECT COALESCE(SUM(ot_min),0)::int ot, COALESCE(SUM(holiday_ot_min),0)::int "holOt",
             COALESCE(SUM(offday_ot_min),0)::int "offOt", COALESCE(SUM(ot_before_min),0)::int "befOt",
             COALESCE(SUM(ot_after_min),0)::int "aftOt",
             COUNT(*) FILTER (WHERE ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0)::int "otDays",
             COUNT(DISTINCT person_no) FILTER (WHERE ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0)::int "otAgents",
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
             COALESCE(SUM(ot_min+holiday_ot_min+offday_ot_min),0)::int "otMin",
             COALESCE(SUM(ot_min),0)::int "regOtMin", COALESCE(SUM(holiday_ot_min),0)::int "holOtMin", COALESCE(SUM(offday_ot_min),0)::int "offOtMin",
             COUNT(*) FILTER (WHERE ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0)::int "otDays",
             COALESCE(SUM(COALESCE(expected_hours,9)*60) FILTER (WHERE presence IN ('office','wfh')),0)::int "workMin",
             COUNT(*) FILTER (WHERE ${CRED_LATE} AND permission_type IS NULL)::int "lateDays",
             COUNT(*) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NULL)::int "earlyDays",
             COUNT(*) FILTER (WHERE presence='absent')::int "absentDays",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int perms
        FROM roster_days WHERE ${w} GROUP BY person_no ORDER BY "otMin" DESC`, p);
    const byFn = await this.ds.query(`
      SELECT role_function fn, COALESCE(SUM(ot_min+holiday_ot_min+offday_ot_min),0)::int "otMin",
             COALESCE(SUM(holiday_ot_min),0)::int "holOtMin", COALESCE(SUM(offday_ot_min),0)::int "offOtMin",
             COUNT(*) FILTER (WHERE ot_min>0 OR holiday_ot_min>0 OR offday_ot_min>0)::int "otDays",
             COUNT(DISTINCT person_no)::int people,
             COUNT(*) FILTER (WHERE ${CRED_LATE} AND permission_type IS NULL)::int "lateDays",
             COUNT(*) FILTER (WHERE ${CRED_EARLY} AND permission_type IS NULL)::int "earlyDays",
             COUNT(*) FILTER (WHERE presence='absent')::int "absentDays", COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int perms
        FROM roster_days WHERE ${w} GROUP BY role_function ORDER BY "otMin" DESC`, p);
    const permByType = await this.ds.query(`SELECT permission_type k, COUNT(*)::int n FROM roster_days WHERE ${w} AND permission_type IS NOT NULL GROUP BY permission_type ORDER BY n DESC`, p);
    const permByShift = await this.ds.query(`SELECT COALESCE(shift_code,'—') k, COUNT(*)::int n FROM roster_days WHERE ${w} AND permission_type IS NOT NULL GROUP BY shift_code ORDER BY n DESC LIMIT 12`, p);
    const permByDate = await this.ds.query(`SELECT work_date::text k, COUNT(*)::int n FROM roster_days WHERE ${w} AND permission_type IS NOT NULL GROUP BY work_date ORDER BY n DESC LIMIT 12`, p);
    const absByDate = await this.ds.query(`SELECT work_date::text k, COUNT(*)::int n FROM roster_days WHERE ${w} AND presence='absent' GROUP BY work_date ORDER BY n DESC LIMIT 12`, p);
    // permission hours (parse the TEXT time-window)
    const perms = await this.ds.query(`SELECT permission_duration d FROM roster_days WHERE ${w} AND permission_type IS NOT NULL AND permission_duration IS NOT NULL`, p);
    const permMin = perms.reduce((a: number, r: any) => a + this.parsePermMin(r.d), 0);
    const fnOpts = await this.ds.query(`SELECT DISTINCT role_function v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t]);
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);

    const r1 = (n: number) => Math.round(n * 10) / 10;
    // OT buckets are DISJOINT in roster_days: ot_min = regular workday OT, offday_ot_min
    // = OT on the agent's OFF day, holiday_ot_min = OT on a public holiday (each row sits
    // in exactly one bucket). True total = sum of all three. Non-holiday = regular + off-day.
    const totalOt = s.ot + s.offOt + s.holOt;
    const nonHolOt = s.ot + s.offOt;
    return {
      from: dFrom, to: dTo, function: fn || null, teamLeader: tl || null,
      ot: { totalHrs: r1(totalOt / 60), regularHrs: r1(s.ot / 60), offdayHrs: r1(s.offOt / 60), holidayHrs: r1(s.holOt / 60),
            nonHolidayHrs: r1(nonHolOt / 60),
            holidayPct: totalOt > 0 ? r1(100 * s.holOt / totalOt) : 0, nonHolidayPct: totalOt > 0 ? r1(100 * nonHolOt / totalOt) : 0,
            beforeShiftHrs: r1(s.befOt / 60), afterShiftHrs: r1(s.aftOt / 60),
            days: s.otDays, agents: s.otAgents },
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
     ['OT days', d.ot.days], ['Agents with OT', d.ot.agents],
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
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="OT_Exceptions_${d.from}_${d.to}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  @Get('roster-v2/schedule-analysis')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Consolidated schedule analysis — shrinkage, shift-rate, OFF/leave/weekend-OFF %, hourly HC, permission hours' })
  async scheduleAnalysis(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('function') fn?: string, @Query('teamLeader') tl?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    if (fn) { p.push(fn); w += ` AND role_function=$${p.length}`; }
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
             COUNT(*) FILTER (WHERE EXTRACT(DOW FROM work_date) IN (4,5))::int weekend,
             COUNT(*) FILTER (WHERE presence='off' AND EXTRACT(DOW FROM work_date) IN (4,5))::int "weekendOff",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             COUNT(DISTINCT person_no)::int people, COUNT(DISTINCT work_date)::int days
        FROM roster_days WHERE ${w}`, p);
    const cats = await this.ds.query(`SELECT ${this.SHIFT_CAT} cat, COUNT(*)::int n FROM roster_days WHERE ${w} AND presence IN ('office','wfh') GROUP BY 1`, p);
    const shiftRate: Record<string, number> = { Morning: 0, Night: 0, Evening: 0, Midnight: 0, Other: 0 };
    for (const c of cats) shiftRate[c.cat] = c.n;
    const byFn = await this.ds.query(`
      SELECT role_function fn, COUNT(*)::int scheduled,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='off')::int "off",
             COUNT(*) FILTER (WHERE presence IN ('leave','sick','absent','holiday'))::int lost,
             COUNT(*) FILTER (WHERE presence='off' AND EXTRACT(DOW FROM work_date) IN (4,5))::int "weekendOff",
             COUNT(DISTINCT person_no)::int people
        FROM roster_days WHERE ${w} GROUP BY role_function ORDER BY scheduled DESC`, p);
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);
    const fnOpts = await this.ds.query(`SELECT DISTINCT role_function v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t]);

    // hourly scheduled headcount (avg concurrent by clock-hour, cross-midnight aware)
    const shifts = await this.ds.query(`SELECT shift_start_min ss, shift_end_min se FROM roster_days WHERE ${w} AND presence IN ('office','wfh') AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL`, p);
    const mins = new Array(24).fill(0);
    for (const sh of shifts) { for (let m = Number(sh.ss); m < Number(sh.se); m += 30) { mins[Math.floor((((m % 1440) + 1440) % 1440)) / 60 | 0] += 30; } }
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
    if (fn) { p.push(fn); w += ` AND role_function=$${p.length}`; }
    const rows = await this.ds.query(
      `SELECT work_date::text d, role_function fn, is_active, shift_start_min ss, shift_end_min se,
              sys_login_min li, sys_logout_min lo FROM roster_days WHERE ${w} AND is_active`, p);

    const fnSet = new Set<string>();
    const N = Math.floor(1440 / stepMin);
    // per interval: function → {scheduled, present}
    const grid: Record<string, { sched: Record<string, number>; pres: Record<string, number> }> = {};
    for (let i = 0; i < N; i++) grid[i] = { sched: {}, pres: {} };
    const covers = (rowDate: string, lo: number, hi: number, i0: number) => {
      // does an interval starting at minute i0 (on date d) fall in this agent's window?
      // window [lo,hi) is on the row's own date; for a previous-day row, its tail [1440,hi) maps to [0,hi-1440) on d.
      if (lo == null || hi == null) return false;
      if (rowDate === d) return i0 >= lo && i0 < Math.min(hi, 1440);
      // previous day: only the overnight tail (hi>1440) reaches date d
      return hi > 1440 && i0 < (hi - 1440);
    };
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
    if (fn) { p.push(fn); w += ` AND role_function=$${p.length}`; }
    const rows = await this.ds.query(`
      SELECT role_function fn,
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
        FROM roster_days r WHERE ${w} GROUP BY role_function ORDER BY planned DESC NULLS LAST`, p);
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
  /** SQL classifier: a shift code → broad category (for shift-rate distribution). */
  private readonly SHIFT_CAT = `CASE
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^(MD|MN)' THEN 'Midnight'
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^(EE|E)' THEN 'Evening'
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^N' THEN 'Night'
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^(M|B|C|AM)' THEN 'Morning'
      ELSE 'Other' END`;
  private catOf(code: string): string {
    const c = (code || '').toUpperCase();
    if (/^(MD|MN)/.test(c)) return 'Midnight';
    if (/^(EE|E)/.test(c)) return 'Evening';
    if (/^N/.test(c)) return 'Night';
    if (/^(M|B|C|AM)/.test(c)) return 'Morning';
    return 'Other';
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
      `SELECT ${this.SHIFT_CAT} cat, COUNT(*)::int n FROM roster_days
         WHERE tenant_id=$1 AND person_no=$2 AND work_date<=$3 GROUP BY 1`, [t, personNo, toDate]);
    const out: Record<string, number> = { Morning: 0, Night: 0, Evening: 0, Midnight: 0, Other: 0 };
    for (const r of rows) out[r.cat] = r.n; return out;
  }
  /** Headcount-by-shift for a function on a date (coverage view). */
  private async coverageByShift(t: string, fn: string, date: string): Promise<Record<string, number>> {
    const rows = await this.ds.query(
      `SELECT shift_code, COUNT(DISTINCT person_no)::int n FROM roster_days
         WHERE tenant_id=$1 AND role_function=$2 AND work_date=$3 AND is_active AND presence IN ('office','wfh') GROUP BY shift_code`, [t, fn, date]);
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
        `SELECT work_date::text d, shift_start_min ss, shift_end_min se FROM roster_days
           WHERE tenant_id=$1 AND person_no=$2 AND is_active AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL
             AND work_date IN ($3::date - 1, $3::date + 1)`, [t, personNo, date]);
      for (const a of adj) {
        const rest = a.d < date ? (1440 + Number(ss)) - Number(a.se) : (1440 + Number(a.ss)) - Number(se);
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
        `UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=COALESCE($5,shift_start_min), shift_end_min=COALESCE($6,shift_end_min)
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
      await qr.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, b.personA, b.date, B.shift_code, B.shift_start_min, B.shift_end_min]);
      await qr.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 AND is_active`, [t, b.personB, b.date, A.shift_code, A.shift_start_min, A.shift_end_min]);
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
  async scheduleRevert(@Req() req: any, @Body() _b: any, @Query('id') idQ?: string) {
    const t = req.user.tenantId; const id = idQ || (req.params && req.params.id);
    const [log] = await this.ds.query(`SELECT * FROM schedule_change_log WHERE tenant_id=$1 AND id=$2`, [t, id]);
    if (!log) throw new BadRequestException('Change not found');
    if (log.reverted) return { ok: true, alreadyReverted: true };
    const rt = async (code: string) => this.resolveShiftTimes(t, code);
    if (log.change_type === 'swap') {
      const a = await rt(log.old_shift), bb = await rt(log.old_shift_b);
      await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3`, [t, log.person_no, log.work_date, log.old_shift, a.ss, a.se]);
      await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3`, [t, log.person_b_no, log.work_date, log.old_shift_b, bb.ss, bb.se]);
    } else {
      const a = await rt(log.old_shift);
      await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3`, [t, log.person_no, log.work_date, log.old_shift, a.ss, a.se]);
    }
    await this.ds.query(`UPDATE schedule_change_log SET reverted=true, approval_status='reverted', updated_at=now() WHERE tenant_id=$1 AND id=$2`, [t, id]);
    return { ok: true, reverted: true };
  }

  /** Team-leader resolution driven by the editable `team_leader_status` table.
   *  status: active | director | left ; hidden ⇒ suppressed everywhere. Falls back
   *  to matching an active Team-Leader employee (spelling-tolerant) for unlisted labels. */
  private async tlResolver(t: string) {
    const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '');
    const TL_ALIAS: Record<string, string> = { 'fatmehassan': 'fatma hasan' };
    const statusRows = await this.ds.query(`SELECT name, status, hidden, note FROM team_leader_status WHERE tenant_id=$1`, [t]);
    const byName = new Map<string, any>(statusRows.map((r: any) => [norm(r.name), r]));
    const hidden = new Set<string>(statusRows.filter((r: any) => r.hidden).map((r: any) => norm(r.name)));
    const tlActive = new Set((await this.ds.query(
      `SELECT clean_name FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND role_category='Team Leader' AND is_active`, [t]
    )).map((r: any) => norm(r.clean_name)));
    const tlStatus = (name: string, matchedActive?: boolean) => {
      const n = norm(name); const st = byName.get(n);
      if (st) {
        if (st.hidden) return { verified: false, status: 'left', hidden: true, note: st.note || 'removed' };
        if (st.status === 'director') return { verified: true, status: 'director', hidden: false, note: st.note || 'director / management (present)' };
        if (st.status === 'left') return { verified: false, status: 'left', hidden: false, note: st.note || 'left' };
        return { verified: true, status: 'current', hidden: false, note: null };
      }
      const active = !!matchedActive || tlActive.has(n) || tlActive.has(norm(TL_ALIAS[n] || ''));
      return { verified: active, status: active ? 'current' : 'unverified', hidden: false, note: active ? null : 'team label not matched to an active Team-Leader employee — verify if this person left' };
    };
    return { tlActive, tlStatus, hidden, norm };
  }

  /** Executive Summary export — ONE management-ready Excel combining the headline
   *  KPIs, prioritized insights, the score leaderboard, monthly trends and a
   *  by-function summary. Reuses the insights/score/trend engines. */
  @Get('roster-v2/executive-export')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Executive Summary Excel — KPIs + Insights + Leaderboard + Trends + by-function' })
  async executiveExport(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0, 7)}-01` : range?.a), dTo = to || range?.b;
    // reuse the engines
    const [ins, scores, trend] = await Promise.all([
      this.insights(req, dFrom, dTo), this.agentScores(req, dFrom, dTo), this.trends(req, dFrom, dTo, undefined, undefined, 'month'),
    ]);
    const [kpi] = await this.ds.query(`
      SELECT COUNT(DISTINCT person_no)::int agents, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='off')::int off, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='leave')::int leave,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin, COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conformance
        FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`, [t, dFrom, dTo]);
    const byFn = await this.ds.query(`
      SELECT role_function fn, COUNT(DISTINCT person_no)::int agents, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conformance, COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin, COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent
        FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND role_function IS NOT NULL
        GROUP BY role_function ORDER BY agents DESC`, [t, dFrom, dTo]);

    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const hrs = (m: number) => Math.round((m || 0) / 60);
    const sheet = (name: string, cols: any[], rows: any[], color = 'FF4F46E5') => {
      const ws = wb.addWorksheet(name); ws.columns = cols.map((c: any) => ({ ...c, width: c.width || 18 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.views = [{ state: 'frozen', ySplit: 1 }]; rows.forEach(r => ws.addRow(r)); return ws;
    };

    // 1) Executive Summary cover
    const cover = wb.addWorksheet('Executive Summary');
    cover.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }];
    cover.mergeCells('A1:D1'); cover.getCell('A1').value = `WFM Executive Summary — ${dFrom} → ${dTo}`;
    cover.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; cover.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    cover.addRow([]);
    const kv = (k: string, v: any) => { const r = cover.addRow([k, v]); r.getCell(1).font = { bold: true, color: { argb: 'FF94A3B8' } }; };
    cover.addRow(['HEADLINE KPIs']).getCell(1).font = { bold: true, size: 12 };
    kv('Active agents', kpi.agents); kv('Conformance %', kpi.conformance); kv('Worked days', kpi.worked);
    kv('Late days', `${kpi.latedays} (${hrs(kpi.latemin)}h)`); kv('Overtime (hrs)', hrs(kpi.otmin));
    kv('Sick days', kpi.sick); kv('Absence days', kpi.absent); kv('Permissions', kpi.permissions);
    cover.addRow([]);
    cover.addRow(['SCORE OVERVIEW']).getCell(1).font = { bold: true, size: 12 };
    kv('Average score', scores.average); kv('Grade A / B / C / D', `${scores.distribution.A} / ${scores.distribution.B} / ${scores.distribution.C} / ${scores.distribution.D}`);
    const top = scores.agents.slice(0, 3).map((a: any) => `${a.name} (${a.score})`).join(', ');
    const bot = scores.agents.slice(-3).map((a: any) => `${a.name} (${a.score})`).join(', ');
    kv('Top performers', top); kv('Needs attention', bot);
    cover.addRow([]);
    cover.addRow(['KEY INSIGHTS']).getCell(1).font = { bold: true, size: 12 };
    for (const i of ins.insights.slice(0, 8)) { const r = cover.addRow([`[${i.severity.toUpperCase()}] ${i.title}`, i.detail]); r.getCell(1).font = { color: { argb: i.severity === 'critical' ? 'FFDC2626' : i.severity === 'warning' ? 'FFD97706' : 'FF0EA5E9' } }; }

    // 2) Insights, 3) Leaderboard, 4) Trends, 5) By function
    sheet('Insights', [{ header: 'Severity', key: 'severity' }, { header: 'Title', key: 'title', width: 50 }, { header: 'Detail', key: 'detail', width: 60 }], ins.insights, 'FF7C3AED');
    sheet('Leaderboard', [
      { header: 'Rank', key: 'rank', width: 6 }, { header: 'Agent', key: 'name', width: 24 }, { header: 'Role', key: 'role' }, { header: 'Team Leader', key: 'tl', width: 18 },
      { header: 'Score', key: 'score', width: 8 }, { header: 'Grade', key: 'grade', width: 7 }, { header: 'Conf %', key: 'conf' }, { header: 'Worked', key: 'worked' },
      { header: 'Late days', key: 'lateDays' }, { header: 'Absent', key: 'absent' }, { header: 'Sick', key: 'sick' },
    ], scores.agents, 'FFF59E0B');
    sheet('Trends (Monthly)', [
      { header: 'Period', key: 'label' }, { header: 'From', key: 'start' }, { header: 'Agents', key: 'agents' }, { header: 'Worked', key: 'worked' },
      { header: 'Conformance %', key: 'conf' }, { header: 'Late days', key: 'latedays' }, { header: 'Late (min)', key: 'latemin' },
      { header: 'OT (hrs)', key: 'othrs' }, { header: 'Sick', key: 'sick' }, { header: 'Absent', key: 'absent' },
    ], trend.points.map((p: any) => ({ ...p, othrs: hrs(p.otmin) })), 'FF059669');
    sheet('By Function', [
      { header: 'Function', key: 'fn', width: 22 }, { header: 'Agents', key: 'agents' }, { header: 'Worked', key: 'worked' }, { header: 'Conformance %', key: 'conformance' },
      { header: 'Late days', key: 'latedays' }, { header: 'OT (hrs)', key: 'othrs' }, { header: 'Sick', key: 'sick' }, { header: 'Absent', key: 'absent' },
    ], byFn.map((r: any) => ({ ...r, othrs: hrs(r.otmin) })), 'FF0EA5E9');

    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="WFM_Executive_${dFrom}_${dTo}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /** File-based recon reads server-side source workbooks; fail clean (400) if absent. */
  private assertSources() {
    if (!fs.existsSync(SCHEDULE) || !fs.existsSync(SRC_DIR)) {
      throw new BadRequestException(
        'Reconciliation source files are not available on the server. Configure RECON_SOURCE_DIR and RECON_SCHEDULE_FILE, or use the DB-backed /attendance-recon/dashboard (run /ingest first).',
      );
    }
  }

  // ── DB-backed roster (scales to years): parse once via /ingest, then query fast ──
  @Post('ingest')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Parse the source exports once and store the roster in the DB (run after new data lands)' })
  async ingest(@Req() req: any) {
    this.svc.clearCache();   // always recompute from source (don't serve a stale cached run)
    return this.ingestion.ingest(req.user.tenantId, SRC_DIR, SCHEDULE);
  }

  @Get('roster')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Query the stored roster (indexed, sub-second) — auto-ingests on first use if empty' })
  async roster(
    @Req() req: any,
    @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string,
    @Query('func') func?: string, @Query('presence') presence?: string, @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    const tenantId = req.user.tenantId;
    if ((await this.ingestion.count(tenantId)) === 0) await this.ingestion.ingest(tenantId, SRC_DIR, SCHEDULE);
    return this.ingestion.query(tenantId, { from, to, q, func, presence, sort, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get('run')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Reconcile Odoo+Ameyo+Sprinklr vs schedule (server-side sources)' })
  run(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('func') func?: string,
    @Query('presence') presence?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertSources();
    const result = this.svc.run(SRC_DIR, SCHEDULE);
    let rows = result.rows;
    if (from) rows = rows.filter(r => r.date >= from);
    if (to) rows = rows.filter(r => r.date <= to);
    if (func) rows = rows.filter(r => r.func === func);
    if (presence) rows = rows.filter(r => r.presence === presence);
    if (q) { const s = q.toLowerCase(); rows = rows.filter(r => r.name.toLowerCase().includes(s) || r.employeeId.includes(s)); }
    const lim = Math.min(parseInt(limit ?? '500', 10) || 500, 5000);
    return { summary: result.summary, total: rows.length, rows: rows.slice(0, lim), unmapped: result.unmapped.slice(0, 50) };
  }

  @Get('dashboard')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Deep roster analytics — KPIs, by function/shift, top late/absent/OT, weekday & monthly trends' })
  async dashboard(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('func') func?: string, @Query('support') support?: string) {
    const tenantId = req.user.tenantId;
    if ((await this.ingestion.count(tenantId)) === 0) await this.ingestion.ingest(tenantId, SRC_DIR, SCHEDULE);
    return this.ingestion.dashboard(tenantId, from, to, func, support === '1' || support === 'true');
  }

  @Get('ot-cap')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Annual OT cap (180h/employee/year) with approaching/exceeded alerts' })
  async otCap(@Req() req: any, @Query('year') year?: string) {
    return this.ingestion.otCap(req.user.tenantId, year || '2026');
  }

  @Get('employee')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-employee performance + commitment profile (rating, OT%, per-day OT window) — search by ID/name/email' })
  async employee(@Req() req: any, @Query('q') q: string, @Query('from') from?: string, @Query('to') to?: string, @Query('func') func?: string) {
    return this.ingestion.employeeProfile(req.user.tenantId, q || '', from, to, func);
  }

  @Get('ot-bonus')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Days with ≥ minHours overtime (default 5) for the manager bonus list — who/day/window/before-after' })
  async otBonus(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('minHours') minHours?: string, @Query('q') q?: string) {
    return this.ingestion.otBonus(req.user.tenantId, from, to, minHours ? parseFloat(minHours) : 5, q);
  }

  @Get('metric')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Detailed metric view (late/early/absence/conformance/sick) — summary, by function/month, top, detail rows' })
  async metric(@Req() req: any, @Query('metric') metric: string, @Query('from') from?: string, @Query('to') to?: string, @Query('func') func?: string, @Query('q') q?: string) {
    return this.ingestion.metricDetail(req.user.tenantId, metric || 'late', from, to, func, q);
  }

  @Get('overtime')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Detailed overtime — before/after/holiday split, by function/month, top employees (180h cap), filterable detail rows' })
  async overtime(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('func') func?: string, @Query('q') q?: string) {
    return this.ingestion.overtime(req.user.tenantId, from, to, func, q);
  }

  @Get('permissions-detail')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Permission details — type/window/status per (employee, day), filterable by date and name/ID/email' })
  async permissionsDetail(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string, @Query('status') status?: string) {
    return this.ingestion.permissionDetails(req.user.tenantId, from, to, q, status);
  }

  @Get('coverage-intervals')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Half-hourly headcount by function for a date — scheduled vs present vs shrinkage vs in-OT' })
  async coverageIntervals(@Req() req: any, @Query('date') date: string, @Query('func') func?: string, @Query('q') q?: string) {
    return this.ingestion.coverageIntervals(req.user.tenantId, date, func, q);
  }

  @Get('hr-weekly')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Weekly attendance for HR (past week actual / next week planned) — HR shift codes + system details' })
  async hrWeekly(@Req() req: any, @Query('from') from: string, @Query('to') to: string) {
    return { rows: await this.ingestion.hrWeekly(req.user.tenantId, from, to) };
  }

  @Post('upload')
  @RequirePermissions('attendance.view_team')
  @UseInterceptors(FilesInterceptor('files', 12, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
    fileFilter: (_req, file, cb) => {
      // Roster sources are spreadsheets/CSV only — reject anything else.
      if (/\.(xlsx|xls|xlsm|csv)$/i.test(file.originalname)) cb(null, true);
      else cb(new BadRequestException(`File type not allowed: ${file.originalname}`), false);
    },
  }))
  @ApiOperation({ summary: 'Upload source files (Odoo/Ameyo/Sprinklr/schedule) → saved server-side + roster re-ingested' })
  async upload(@Req() req: any, @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>) {
    const saved: { name: string; type: string }[] = [];
    for (const f of files || []) {
      const n = f.originalname;
      let type = 'other', dest = path.join(SRC_DIR, n);
      if (/schedule|cc schedule|shifts/i.test(n)) { type = 'schedule'; dest = SCHEDULE; }
      else if (/ameyo|agent_session/i.test(n)) type = 'Ameyo';
      else if (/loginlogout/i.test(n)) type = 'Sprinklr occupancy';
      else if (/att summary/i.test(n)) type = 'Odoo attendance';
      else if (/permission/i.test(n)) type = 'Permissions';
      else if (/comp/i.test(n)) type = 'Comp off';
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.buffer);
      saved.push({ name: n, type });
    }
    this.svc.clearCache();
    const result = await this.ingestion.ingest(req.user.tenantId, SRC_DIR, SCHEDULE);
    // If a schedule file was uploaded, it becomes the AUTHORITATIVE baseline → auto
    // soft-lock its date range so manual edits are blocked (supervisor override only).
    let lock: any = null;
    if (saved.some((s) => s.type === 'schedule')) {
      const [rng] = await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [req.user.tenantId]);
      if (rng?.a && rng?.b) { lock = { from: rng.a, to: rng.b, lockedAt: new Date().toISOString(), lockedBy: req.user.id || req.user.sub || 'upload' };
        await this.setScheduleLock(req.user.tenantId, lock); }
    }
    return { saved, ingested: result.rows, ms: result.ms, scheduleLock: lock };
  }

  /* ── THE corrected base, from inside the system ──────────────────────────────────
   * Runs the validated reconciliation engine (foundation → corrected engine → ingest)
   * and refreshes roster_days, the SAME pipeline as `node scripts/recon-refresh.js`.
   * Every business rule lives in the engine, so each run re-applies them all — nothing
   * a later refresh can silently wipe. Optional uploaded files replace the engine's
   * monthly sources first (matched by filename). Reversible: scripts/recon-ingest.js --restore. */
  @Post('recon-refresh')
  @RequirePermissions('schedule.publish')
  @UseInterceptors(FilesInterceptor('files', 12, {
    limits: { fileSize: 160 * 1024 * 1024 }, // CC Schedule / Ameyo exports are large
    fileFilter: (_req, file, cb) => {
      if (/\.(xlsx|xls|xlsm|csv)$/i.test(file.originalname)) cb(null, true);
      else cb(new BadRequestException(`File type not allowed: ${file.originalname}`), false);
    },
  }))
  @ApiOperation({ summary: 'Run the CORRECTED reconciliation engine and refresh roster_days (optional source files replace the engine inputs first; optional sysMode overrides the session-source mode for this run)' })
  async reconRefresh(@Req() req: any, @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>, @Body() body?: { sysMode?: string }) {
    // Per-run session-source mode (D-076): 'ameyo-first' (June calibration) | 'sprinklr-first' | 'sprinklr-only'.
    // Omitted → the engine falls back to recon-config.json "sysMode", then 'ameyo-first'.
    const sysMode = (body?.sysMode || '').toLowerCase().trim();
    if (sysMode && !['ameyo-first', 'sprinklr-first', 'sprinklr-only'].includes(sysMode)) {
      throw new BadRequestException(`sysMode must be one of ameyo-first | sprinklr-first | sprinklr-only (got "${sysMode}")`);
    }
    // 1) Optional: drop uploaded files into the engine's source folder, matched by name → canonical name.
    //    NOTE: the "June" in these stored names is a fixed storage ALIAS, not the data month — a July
    //    upload overwrites the same canonical slot and the engine reports the ACTUAL ingested range.
    const targets = [
      { rx: /cc schedule|shifts/i, name: 'CC Schedule 26 June..xlsx', role: 'Roster (authority)' },
      { rx: /odoo|fingerprint/i, name: 'Odoo Fingerprint June.xlsx', role: 'Odoo fingerprints' },
      { rx: /permission|compo/i, name: 'Permission & Compo June.xlsx', role: 'Permissions + comp' },
      { rx: /ameyo/i, name: 'Ameyo login and logout.xlsx', role: 'Ameyo sessions' },
      { rx: /sprinklr/i, name: 'Login and Logout sprinklr.xlsx', role: 'Sprinklr sessions' },
    ];
    const saved: { uploaded: string; storedAs: string; role: string }[] = [];
    const unmatched: string[] = [];
    fs.mkdirSync(RECON_NEW_DIR, { recursive: true });
    for (const f of files || []) {
      const t = targets.find((x) => x.rx.test(f.originalname));
      if (!t) { unmatched.push(f.originalname); continue; }
      fs.writeFileSync(path.join(RECON_NEW_DIR, t.name), f.buffer);
      saved.push({ uploaded: f.originalname, storedAs: t.name, role: t.role });
    }
    // 2) Locate + run the pipeline (foundation → engine → ingest).
    const scriptsDir = [path.join(process.cwd(), 'scripts'), path.join(__dirname, '../../../scripts'), path.join(__dirname, '../../../../scripts')]
      .find((d) => fs.existsSync(path.join(d, 'recon-refresh.js')));
    if (!scriptsDir) throw new BadRequestException('recon-refresh.js not found on the server');
    let log = '', ok = false, error: string | null = null;
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath,
        ['--max-old-space-size=4096', path.join(scriptsDir, 'recon-refresh.js')],
        { cwd: path.dirname(scriptsDir), timeout: 8 * 60 * 1000, maxBuffer: 48 * 1024 * 1024,
          env: sysMode ? { ...process.env, RECON_SYS_MODE: sysMode } : process.env });
      const lines = (stdout + '\n' + stderr).split('\n');
      log = lines.filter((l) => /▶|INGEST OK|✅|❌|FAILED|horizon/.test(l)).slice(-24).join('\n');
      ok = /INGEST OK/.test(stdout) && /✅ DONE/.test(stdout);
    } catch (e: any) {
      error = String(e?.message || e).slice(0, 600);
      log = String((e?.stdout || '') + '\n' + (e?.stderr || '')).split('\n').slice(-24).join('\n');
    }
    // 3) Clear caches + report the freshly-ingested roster_days summary (the ACTUAL range that was written,
    //    parsed from the engine log "ingest range: X .. Y" — NOT a hardcoded month, so any month reports correctly).
    this.svc.clearCache();
    const m = /ingest range:\s*(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})/.exec(log);
    const rFrom = m ? m[1] : '2000-01-01', rTo = m ? m[2] : '2999-12-31';
    const [roster] = await this.ds.query(
      `SELECT COUNT(*)::int rows, COUNT(DISTINCT person_no)::int people, MIN(work_date)::text "from", MAX(work_date)::text "to",
              ROUND(SUM(${TRUE_OT})/60.0)::int ot_hours
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [req.user.tenantId, rFrom, rTo]);
    return { ok, error, saved, unmatched, sourceDir: RECON_NEW_DIR, log, roster, sysMode: sysMode || null };
  }

  @Get('hr-matrix')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'HR attendance matrix .xlsx — Update (past week actual) + Advance (next week planned) sheets' })
  async hrMatrix(@Req() req: any, @Res() res: Response, @Query('ref') ref?: string) {
    const r = ref || new Date().toISOString().slice(0, 10);
    const buf = await this.ingestion.hrMatrix(req.user.tenantId, r);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="HR_attendance_${r}.xlsx"`,
    });
    res.end(buf);
  }

  @Put('note')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Save a manager note on one (employee, day) — e.g. power cut / technical issue. Persists across re-ingestion.' })
  async setNote(@Req() req: any, @Body() body: { employeeId: string; date: string; note: string }) {
    await this.ingestion.setNote(req.user.tenantId, body.employeeId, body.date, body.note);
    return { ok: true };
  }

  @Get('compare')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Compare computed figures vs the analyst manual values (accuracy proof)' })
  compare(@Query('from') from?: string, @Query('to') to?: string) {
    this.assertSources();
    const result = this.svc.run(SRC_DIR, SCHEDULE);
    let rows = result.rows;
    if (from) rows = rows.filter(r => r.date >= from);
    if (to) rows = rows.filter(r => r.date <= to);
    return this.svc.compare(rows);
  }
}
