import { BadRequestException, Body, Controller, Get, Post, Put, Query, Req, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';

// Source files live server-side (Ameyo export alone is ~72MB). Configure via env;
// falls back to the analyst's working folder for local verification.
const SRC_DIR = process.env.RECON_SOURCE_DIR || 'C:/Users/t.bassam/Desktop/WFM System/My work/Oddo Ameyo Sprinkler';
const SCHEDULE = process.env.RECON_SCHEDULE_FILE || 'C:/Users/t.bassam/Desktop/WFM System/My work/WFM/CC Schedule 26 V3.0 (24).xlsx';

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
    @Query('includeInactive') includeInactive?: string,
    @Query('sort') sort?: string, @Query('limit') limit = '40', @Query('offset') offset = '0',
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0,7)}-01` : range?.a), dTo = to || range?.b;
    const params: any[] = [t, dFrom, dTo];
    let where = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3`;
    if (q) { params.push(`%${q.toLowerCase()}%`); where += ` AND (lower(COALESCE(r.clean_name,r.name)) LIKE $${params.length} OR r.employee_no ILIKE $${params.length} OR r.person_no ILIKE $${params.length})`; }
    if (presence) { params.push(presence); where += ` AND r.presence=$${params.length}`; }
    if (functionId) { params.push(functionId); where += ` AND r.role_function=(SELECT name FROM functions WHERE id=$${params.length})`; }
    if (includeInactive !== '1') where += ` AND r.is_active`;

    const summary = (await this.ds.query(
      `SELECT COUNT(*)::int days,
              COUNT(*) FILTER (WHERE presence='office')::int office,
              COUNT(*) FILTER (WHERE presence='wfh')::int wfh,
              COUNT(*) FILTER (WHERE presence='off')::int off,
              COUNT(*) FILTER (WHERE presence='leave')::int leave,
              COUNT(*) FILTER (WHERE presence='absent')::int absent,
              COUNT(*) FILTER (WHERE sys_late_min>0)::int late_days,
              COUNT(*) FILTER (WHERE sys_early_min>0)::int early_days,
              COUNT(*) FILTER (WHERE mismatch IS NOT NULL)::int mismatches,
              ROUND(SUM(ot_min)/60.0)::int ot_hours,
              ROUND(SUM(worked_min)/60.0)::int worked_hours,
              COUNT(*) FILTER (WHERE permission IS NOT NULL)::int permissions,
              ROUND(AVG(adherence_pct),1) conformance_pct
         FROM roster_days r WHERE ${where}`, params))[0];

    const sortMap: Record<string,string> = { date_desc:'r.work_date DESC, r.name', date_asc:'r.work_date ASC, r.name',
      late:'r.sys_late_min DESC', early:'r.sys_early_min DESC', ot:'r.ot_min DESC', name:'r.name ASC, r.work_date DESC',
      adherence:'r.adherence_pct ASC NULLS LAST', mismatch:'(r.mismatch IS NOT NULL) DESC, r.work_date DESC' };
    const order = sortMap[sort||'date_desc'] || sortMap.date_desc;
    const lim = Math.min(Number(limit)||40, 200), off = Number(offset)||0;
    const rows = await this.ds.query(
      `SELECT r.employee_no, COALESCE(r.person_no,r.employee_no) person_no, COALESCE(r.clean_name,r.name) name,
              COALESCE(r.role_function,r.function_name) function_name, r.role_category, r.expected_hours,
              r.work_date::text date, r.day_name, r.status, r.presence,
              r.punch_in_min, r.punch_out_min, r.sys_login_min, r.sys_logout_min, r.login_src,
              r.late_min, r.early_min, r.ot_min, r.permission, r.comp_off, r.sick, r.conforming,
              r.shift_code, r.shift_start_min, r.shift_end_min, r.sys_late_min, r.sys_early_min, r.adherence_pct, r.mismatch,
              r.team_manager, r.team_group, r.gender, r.worked_min, n.note
         FROM roster_days r
         LEFT JOIN roster_notes n ON n.tenant_id=r.tenant_id AND n.employee_no=r.employee_no AND n.work_date=r.work_date
        WHERE ${where} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, params);

    return { from: dFrom, to: dTo, range, total: summary.days, limit: lim, offset: off, summary, rows };
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
             COUNT(*) FILTER (WHERE sys_late_min>0)::int late_days, COALESCE(SUM(sys_late_min),0)::int late_min,
             COUNT(*) FILTER (WHERE sys_early_min>0)::int early_days, COALESCE(SUM(sys_early_min),0)::int early_min,
             COALESCE(SUM(ot_before_min),0)::int ot_before, COALESCE(SUM(ot_after_min),0)::int ot_after,
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
      rankW(wTardy, `SUM(sys_late_min)::int`, `SUM(sys_late_min) DESC`),   // tardiness: 8h roles excluded by default
      rankW(wTardy, `SUM(sys_early_min)::int`, `SUM(sys_early_min) DESC`),
      rank(`SUM(ot_after_min)::int`, `SUM(ot_after_min) DESC`),
      rank(`SUM(ot_before_min)::int`, `SUM(ot_before_min) DESC`),
      rank(`COUNT(*) FILTER (WHERE presence='absent')::int`, `COUNT(*) FILTER (WHERE presence='absent') DESC`),
      rank(`COUNT(*) FILTER (WHERE presence='sick')::int`, `COUNT(*) FILTER (WHERE presence='sick') DESC`),
      this.ds.query(`SELECT person_no employee_no, ${REP}, ROUND(AVG(adherence_pct),1) v FROM roster_days r WHERE ${wTardy} AND adherence_pct IS NOT NULL AND r.person_no IS NOT NULL GROUP BY person_no HAVING COUNT(*) FILTER (WHERE adherence_pct IS NOT NULL)>=3 ORDER BY AVG(adherence_pct) ASC LIMIT ${lim}`, p),
      rank(`COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int`, `COUNT(*) FILTER (WHERE permission_type IS NOT NULL) DESC`),
    ]);

    const dist = async (col: string) => this.ds.query(
      `SELECT COALESCE(${col},'—') k, COUNT(*)::int n, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
              ROUND(AVG(adherence_pct),1) conformance, COALESCE(SUM(sys_late_min),0)::int late, COALESCE(SUM(ot_after_min),0)::int ot_after
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
      attendanceStatus:{col:'attendance_status',label:'Attendance Status'}, hrStatus:{col:'hr_code',label:'HR Code'},
      punchIn:{col:'punch_in_min',label:'Punch In',time:true}, punchOut:{col:'punch_out_min',label:'Punch Out',time:true},
      sysLogin:{col:'sys_login_min',label:'Sys Login',time:true}, sysLogout:{col:'sys_logout_min',label:'Sys Logout',time:true},
      systemSource:{col:'login_src',label:'Sys Source'}, workedMin:{col:'worked_min',label:'Worked (min)'},
      lateMin:{col:'sys_late_min',label:'Late (min)'}, lateCategory:{col:'late_category',label:'Late Category'}, earlyMin:{col:'sys_early_min',label:'Early Out (min)'},
      otBefore:{col:'ot_before_min',label:'OT Before'}, otAfter:{col:'ot_after_min',label:'OT After'}, otTotal:{col:'ot_min',label:'OT Total'},
      offdayOt:{col:'offday_ot_min',label:'OFF-day OT'}, holidayOt:{col:'holiday_ot_min',label:'Holiday OT'},
      conformance:{col:'adherence_pct',label:'Conformance %'}, permission:{col:'permission_type',label:'Permission'},
      permissionDuration:{col:'permission_duration',label:'Permission Dur'}, dataQuality:{col:'data_quality',label:'Data Quality'}, crossesMidnight:{col:'crosses_midnight',label:'X-Midnight'},
    };
    // KPI map (key → {agg, label})
    const K: Record<string, { agg: string; label: string }> = {
      scheduledDays:{agg:'COUNT(*)',label:'Scheduled Days'}, workedDays:{agg:`COUNT(*) FILTER (WHERE presence IN ('office','wfh'))`,label:'Worked Days'},
      offDays:{agg:`COUNT(*) FILTER (WHERE presence='off')`,label:'OFF Days'}, holidayDays:{agg:`COUNT(*) FILTER (WHERE presence='holiday')`,label:'Holiday Days'},
      leaveDays:{agg:`COUNT(*) FILTER (WHERE presence='leave')`,label:'Leave Days'}, sickDays:{agg:`COUNT(*) FILTER (WHERE presence='sick')`,label:'Sick Days'},
      absenceDays:{agg:`COUNT(*) FILTER (WHERE presence='absent')`,label:'Absence Days'}, wfhDays:{agg:`COUNT(*) FILTER (WHERE presence='wfh')`,label:'WFH Days'},
      officeDays:{agg:`COUNT(*) FILTER (WHERE presence='office')`,label:'Office Days'},
      permissionCount:{agg:`COUNT(*) FILTER (WHERE permission_type IS NOT NULL)`,label:'Permissions'}, compDays:{agg:`COUNT(*) FILTER (WHERE comp_off IS NOT NULL OR comp_worked_min>0)`,label:'COMP Days'},
      lateMin:{agg:'SUM(sys_late_min)',label:'Late (min)'}, lateDays:{agg:'COUNT(*) FILTER (WHERE sys_late_min>0)',label:'Late Days'},
      earlyMin:{agg:'SUM(sys_early_min)',label:'Early Out (min)'}, otMin:{agg:'SUM(ot_min)',label:'OT (min)'},
      otBefore:{agg:'SUM(ot_before_min)',label:'OT Before (min)'}, otAfter:{agg:'SUM(ot_after_min)',label:'OT After (min)'},
      offdayOt:{agg:'SUM(offday_ot_min)',label:'OFF-day OT'}, holidayOt:{agg:'SUM(holiday_ot_min)',label:'Holiday OT'},
      avgLate:{agg:'ROUND(AVG(sys_late_min) FILTER (WHERE sys_late_min>0))',label:'Avg Late'}, avgWorked:{agg:'ROUND(AVG(worked_min) FILTER (WHERE worked_min>0))',label:'Avg Worked (min)'},
      conformance:{agg:'ROUND(AVG(adherence_pct),1)',label:'Conformance %'}, missingPunch:{agg:'COUNT(*) FILTER (WHERE missing_punch)',label:'Missing Punch'},
      missingSystem:{agg:'COUNT(*) FILTER (WHERE missing_system)',label:'Missing System'}, mismatch:{agg:'COUNT(*) FILTER (WHERE mismatch IS NOT NULL)',label:'Mismatch'},
      agents:{agg:'COUNT(DISTINCT COALESCE(person_no,employee_no))',label:'Agents'},
    };
    const G: Record<string, { col: string; label: string }> = {
      day:{col:'day_name',label:'Day'}, week:{col:'week_number',label:'Week'}, month:{col:'month_name',label:'Month'}, date:{col:'work_date::text',label:'Date'},
      agent:{col:'COALESCE(clean_name,name)',label:'Agent'}, function:{col:'COALESCE(role_function,function_name)',label:'Function'}, role:{col:'role_category',label:'Role'}, teamLeader:{col:'team_manager',label:'Team Leader'},
      group:{col:'team_group',label:'Group'}, shift:{col:'shift_code',label:'Shift'}, status:{col:'attendance_status',label:'Attendance Status'}, lateCategory:{col:'late_category',label:'Late Category'},
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

    if (q.groupBy && G[q.groupBy]) {
      const g = G[q.groupBy];
      const kpis = String(q.kpis||'scheduledDays,workedDays,lateMin,otMin,conformance').split(',').filter(k=>K[k]);
      columns = [{ key:'group', label:g.label }, ...kpis.map(k=>({ key:k, label:K[k].label }))];
      const sel = [`${g.col} AS group`, ...kpis.map(k=>`${K[k].agg} AS "${k}"`)].join(', ');
      rows = await this.ds.query(`SELECT ${sel} FROM roster_days WHERE ${w} GROUP BY ${g.col} ORDER BY 2 DESC NULLS LAST LIMIT 500`, p);
    } else {
      const fields = String(q.fields||'date,agent,function,shiftCode,attendanceStatus,lateMin,otBefore,otAfter,conformance').split(',').filter(k=>F[k]);
      columns = fields.map(k=>({ key:k, label:F[k].label }));
      const sel = fields.map(k=>`${F[k].col} AS "${k}"`).join(', ');
      const lim = q.format==='xlsx' ? 50000 : 1000;
      const raw = await this.ds.query(`SELECT ${sel} FROM roster_days WHERE ${w} ORDER BY work_date DESC, name LIMIT ${lim}`, p);
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
    const dates: string[] = []; { const d = new Date(dFrom + 'T00:00:00Z'), end = new Date(dTo + 'T00:00:00Z');
      for (; d <= end; d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10)); }
    const byEmp = new Map<string, any>();
    for (const r of data) { let e = byEmp.get(r.person_no); if (!e) { e = { no: r.person_no, name: r.name, fn: r.function_name, days: {} }; byEmp.set(r.person_no, e); } e.days[r.date] = r.code; }
    const head = ['Employee No', 'Name', 'Function', ...dates.map(d => d.slice(5))];
    const lines = [...byEmp.values()].map(e => [e.no, `"${e.name}"`, `"${e.fn||''}"`, ...dates.map(d => e.days[d] || '')].join(','));
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
      { a: 'WFH', r: 'System login + no fingerprint punch + system matches the scheduled shift = WFH (not a missing-punch anomaly).' },
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
             COUNT(*) FILTER (WHERE sys_late_min>0)::int "lateDays", COALESCE(SUM(sys_late_min),0)::int "totalLateMin",
             COUNT(*) FILTER (WHERE sys_early_min>0)::int "earlyDays", COALESCE(SUM(sys_early_min),0)::int "totalEarlyMin",
             COALESCE(SUM(ot_before_min),0)::int "otBefore", COALESCE(SUM(ot_after_min),0)::int "otAfter",
             COALESCE(SUM(ot_min),0)::int "otTotal", COALESCE(SUM(offday_ot_min),0)::int "offdayOt", COALESCE(SUM(holiday_ot_min),0)::int "holidayOt",
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
             COALESCE(SUM(sys_late_min),0)::int "lateMin", COALESCE(SUM(ot_min),0)::int "otMin", ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W} GROUP BY month_name ORDER BY MIN(work_date)`, p);
    const recent = await this.ds.query(`
      SELECT work_date::text date, day_name, shift_code, attendance_status, presence,
             sys_login_min, sys_logout_min, sys_late_min, late_category, ot_before_min, ot_after_min, adherence_pct, data_quality
        FROM roster_days WHERE ${W} ORDER BY work_date DESC LIMIT 40`, p);
    return { from: dFrom, to: dTo, employee: emp, summary, tardinessBands, shiftRate, byMonth, recent };
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
              COUNT(*) FILTER (WHERE sys_late_min>0) latedays, COALESCE(SUM(sys_late_min),0)::int latemin,
              COUNT(*) FILTER (WHERE missing_system) misssys, ROUND(AVG(adherence_pct),1) conf, COALESCE(SUM(ot_min),0)::int otmin
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

    // 2) tardiness outliers
    const late = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, COUNT(*) FILTER (WHERE sys_late_min>0) ld, COALESCE(SUM(sys_late_min),0)::int lm
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE sys_late_min>0)>=10 ORDER BY ld DESC LIMIT 5`, [t, dFrom, dTo]);
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
      `SELECT shift_code, COALESCE(SUM(ot_min),0)::int otm FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_code IS NOT NULL GROUP BY shift_code ORDER BY otm DESC LIMIT 1`, [t, dFrom, dTo]);
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
             COUNT(*) FILTER (WHERE sys_late_min>0)::int lateDays, COALESCE(SUM(sys_late_min),0)::int lateMin,
             COUNT(*) FILTER (WHERE sys_early_min>0)::int earlyDays,
             COALESCE(SUM(ot_before_min),0)::int otBefore, COALESCE(SUM(ot_after_min),0)::int otAfter, COALESCE(SUM(ot_min),0)::int otTotal,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W}`, p);
    const agents = await this.ds.query(`
      SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) function_name,
             mode() WITHIN GROUP (ORDER BY role_category) role,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE sys_late_min>0)::int lateDays, COALESCE(SUM(sys_late_min),0)::int lateMin,
             COALESCE(SUM(ot_min),0)::int otMin, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W} AND person_no IS NOT NULL GROUP BY person_no ORDER BY conformance ASC NULLS LAST`, p);
    const byShift = await this.ds.query(`SELECT shift_code k, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh') GROUP BY shift_code ORDER BY n DESC`, p);
    // team-leader picker options (verified, non-hidden)
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);
    return { teamLeader: tlName, from: dFrom, to: dTo, range, summary, agents, byShift, teamLeaders: tlOpts.map((r: any) => r.v) };
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
    const d = date || (await this.ds.query(`SELECT MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0]?.b;
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
    const d = date || (await this.ds.query(`SELECT MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0]?.b;
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

  @Post('roster-v2/schedule-change')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Apply a manual shift change to a (person, date) — logs before/after + impact' })
  async scheduleChange(@Req() req: any, @Body() b: { personNo: string; date: string; newShift: string; reason?: string }) {
    const t = req.user.tenantId;
    if (!b?.personNo || !b?.date || !b?.newShift) throw new BadRequestException('personNo, date and newShift are required');
    const [cur] = await this.ds.query(
      `SELECT person_no, clean_name, role_function, shift_code FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3 LIMIT 1`, [t, b.personNo, b.date]);
    if (!cur) throw new BadRequestException('No roster row for that person/date');
    const oldShift = cur.shift_code;
    const rateBefore = await this.shiftRate(t, b.personNo, b.date);
    const covBefore = await this.coverageByShift(t, cur.role_function, b.date);
    const { ss, se } = await this.resolveShiftTimes(t, b.newShift);
    await this.ds.query(
      `UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=COALESCE($5,shift_start_min), shift_end_min=COALESCE($6,shift_end_min)
         WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3`, [t, b.personNo, b.date, b.newShift, ss, se]);
    // after = before shifted by one day from old category to new category
    const rateAfter = { ...rateBefore }; const oc = this.catOf(oldShift), nc = this.catOf(b.newShift);
    rateAfter[oc] = Math.max(0, (rateAfter[oc] || 0) - 1); rateAfter[nc] = (rateAfter[nc] || 0) + 1;
    const covAfter = { ...covBefore }; if (oldShift) covAfter[oldShift] = Math.max(0, (covAfter[oldShift] || 0) - 1); covAfter[b.newShift] = (covAfter[b.newShift] || 0) + 1;
    const impact = { shiftRate: { before: rateBefore, after: rateAfter }, coverage: { function: cur.role_function, date: b.date, before: covBefore, after: covAfter } };
    const [log] = await this.ds.query(
      `INSERT INTO schedule_change_log (tenant_id, change_type, work_date, person_no, person_name, old_shift, new_shift, reason, changed_by, approval_status, impact)
       VALUES ($1,'edit',$2,$3,$4,$5,$6,$7,$8,'applied',$9) RETURNING id`,
      [t, b.date, b.personNo, cur.clean_name, oldShift, b.newShift, b.reason || null, req.user.sub || req.user.userId || 'wfm', JSON.stringify(impact)]);
    return { ok: true, id: log.id, oldShift, newShift: b.newShift, impact };
  }

  @Post('roster-v2/schedule-swap')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Swap shifts between two people on a date — logs both + before/after shift-rate' })
  async scheduleSwap(@Req() req: any, @Body() b: { personA: string; personB: string; date: string; reason?: string }) {
    const t = req.user.tenantId;
    if (!b?.personA || !b?.personB || !b?.date) throw new BadRequestException('personA, personB and date are required');
    const rows = await this.ds.query(
      `SELECT person_no, clean_name, role_function, shift_code, shift_start_min, shift_end_min FROM roster_days
         WHERE tenant_id=$1 AND person_no IN ($2,$3) AND work_date=$4`, [t, b.personA, b.personB, b.date]);
    const A = rows.find((r: any) => r.person_no === b.personA), B = rows.find((r: any) => r.person_no === b.personB);
    if (!A || !B) throw new BadRequestException('Both people must have a roster row on that date');
    const rateBeforeA = await this.shiftRate(t, b.personA, b.date), rateBeforeB = await this.shiftRate(t, b.personB, b.date);
    // swap shift code + times
    await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3`, [t, b.personA, b.date, B.shift_code, B.shift_start_min, B.shift_end_min]);
    await this.ds.query(`UPDATE roster_days SET shift_code=$4, original_shift_code=$4, shift_start_min=$5, shift_end_min=$6 WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3`, [t, b.personB, b.date, A.shift_code, A.shift_start_min, A.shift_end_min]);
    const adj = (r: Record<string, number>, oldC: string, newC: string) => { const o = { ...r }; o[oldC] = Math.max(0, (o[oldC] || 0) - 1); o[newC] = (o[newC] || 0) + 1; return o; };
    const impact = {
      A: { before: rateBeforeA, after: adj(rateBeforeA, this.catOf(A.shift_code), this.catOf(B.shift_code)) },
      B: { before: rateBeforeB, after: adj(rateBeforeB, this.catOf(B.shift_code), this.catOf(A.shift_code)) },
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
    return { saved, ingested: result.rows, ms: result.ms };
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
