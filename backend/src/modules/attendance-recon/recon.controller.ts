import { BadRequestException, Body, Controller, Get, Post, Put, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { TRUE_OT } from '@common/wfm-metrics';
import { rosterCacheInvalidate } from '@common/ttl-cache.interceptor';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';
import { RosterSharedService } from './roster-shared.service';
import { kwToday } from '@common/kw-date';

// Source files live server-side (Ameyo export alone is ~72MB). EVERY path is
// env-driven so nothing Windows-specific is baked in for a server deploy; the
// defaults below resolve to the analyst's local working folders so the current
// local run is unaffected. Override on a server via (documented in
// deploy/prod.env.example): RECON_SOURCE_DIR, RECON_SCHEDULE_FILE, RECON_NEW_DIR.
// assertSources() below fails clean (400) if a configured path is absent.
const SRC_DIR = process.env.RECON_SOURCE_DIR || 'C:/Users/t.bassam/Desktop/WFM System/My work/Oddo Ameyo Sprinkler';
const SCHEDULE = process.env.RECON_SCHEDULE_FILE || 'C:/Users/t.bassam/Desktop/WFM System/My work/WFM/CC Schedule 26 V3.0 (24).xlsx';
// The CORRECTED engine (recon-refresh.js) reads its 5 monthly sources from here. In-system
// "rebuild" uploads land here (matched by filename) before the engine runs.
const RECON_NEW_DIR = process.env.RECON_NEW_DIR || 'C:/Users/t.bassam/Desktop/new roster/';

/* Canonical roster_days metric expressions (TRUE_OT / CRED_LATE / CRED_EARLY / MATERNITY_7H)
 * moved to @common/wfm-metrics (2026-07-06, one-spine fix — EXECUTION_BRIEF bug #2): ONE
 * definition, imported by every consumer. Never redefine locally. */

@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class ReconController {
  constructor(
    private readonly svc: ReconService,
    private readonly ingestion: RosterIngestionService,
    private readonly shared: RosterSharedService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

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
    rosterCacheInvalidate();
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
    rosterCacheInvalidate();
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
        await this.shared.setScheduleLock(req.user.tenantId, lock); }
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
    const r = ref || kwToday();
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
