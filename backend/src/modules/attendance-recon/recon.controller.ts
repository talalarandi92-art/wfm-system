import { BadRequestException, Body, Controller, Get, Post, Put, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
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
    @Query('sort') sort?: string, @Query('limit') limit = '40', @Query('offset') offset = '0',
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0,7)}-01` : range?.a), dTo = to || range?.b;
    const params: any[] = [t, dFrom, dTo];
    let where = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3`;
    if (q) { params.push(`%${q.toLowerCase()}%`); where += ` AND (lower(r.name) LIKE $${params.length} OR r.employee_no ILIKE $${params.length})`; }
    if (presence) { params.push(presence); where += ` AND r.presence=$${params.length}`; }
    if (functionId) { params.push(functionId); where += ` AND r.function_name=(SELECT name FROM functions WHERE id=$${params.length})`; }

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
      `SELECT r.employee_no, r.name, r.function_name, r.work_date::text date, r.day_name, r.status, r.presence,
              r.punch_in_min, r.punch_out_min, r.sys_login_min, r.sys_logout_min, r.login_src,
              r.late_min, r.early_min, r.ot_min, r.permission, r.comp_off, r.sick, r.conforming,
              r.shift_code, r.shift_start_min, r.shift_end_min, r.sys_late_min, r.sys_early_min, r.adherence_pct, r.mismatch,
              r.team_manager, r.team_group, r.gender, r.worked_min, n.note
         FROM roster_days r
         LEFT JOIN roster_notes n ON n.tenant_id=r.tenant_id AND n.employee_no=r.employee_no AND n.work_date=r.work_date
        WHERE ${where} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, params);

    return { from: dFrom, to: dTo, range, total: summary.days, limit: lim, offset: off, summary, rows };
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
      `SELECT employee_no, name, function_name, work_date::text date,
              CASE presence WHEN 'office' THEN COALESCE(shift_code,'P') WHEN 'wfh' THEN 'WFH'
                   WHEN 'off' THEN 'OFF' WHEN 'leave' THEN 'L' WHEN 'absent' THEN 'A' ELSE 'P' END code
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 ORDER BY name, work_date`, [t, dFrom, dTo]);
    const dates: string[] = []; { const d = new Date(dFrom + 'T00:00:00Z'), end = new Date(dTo + 'T00:00:00Z');
      for (; d <= end; d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10)); }
    const byEmp = new Map<string, any>();
    for (const r of data) { let e = byEmp.get(r.employee_no); if (!e) { e = { no: r.employee_no, name: r.name, fn: r.function_name, days: {} }; byEmp.set(r.employee_no, e); } e.days[r.date] = r.code; }
    const head = ['Employee No', 'Name', 'Function', ...dates.map(d => d.slice(5))];
    const lines = [...byEmp.values()].map(e => [e.no, `"${e.name}"`, `"${e.fn||''}"`, ...dates.map(d => e.days[d] || '')].join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="hr-matrix_${dFrom}_${dTo}.csv"`);
    res.send('﻿' + [head.join(','), ...lines].join('\n'));
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
