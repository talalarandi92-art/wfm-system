import {
  Controller, Get, Post, Delete, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile, ParseFilePipe,
  MaxFileSizeValidator, FileTypeValidator, HttpCode, HttpStatus,
  StreamableFile, Header, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ScorecardUploadService } from './scorecard-upload.service';
import { ScorecardScoringService } from './scorecard-scoring.service';
import { AutoScoringReadinessService } from './auto-scoring-readiness.service';
import { kwToday, fmtLocalDate } from '@common/kw-date';
import { PUNCH_LATE } from '@common/wfm-metrics';

/* ─── incentive tiers per function (KD) ─────────────────────────────────── */
const INCENTIVE_TIERS = [
  { rank: 1, reward: 70 },
  { rank: 2, reward: 45 },
  { rank: 3, reward: 35 },
  { rank: 4, reward: 30 },
];

@ApiTags('Scorecard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('scorecard.view_own')
@Controller({ path: 'scorecard', version: '1' })
export class ScorecardController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly uploadSvc: ScorecardUploadService,
    private readonly scoringSvc: ScorecardScoringService,
    private readonly readinessSvc: AutoScoringReadinessService,
  ) {}

  /**
   * Row-level visibility for scorecards:
   *  - scorecard.view_all (WFM/HR/admin) → everyone (all=true)
   *  - team leader → their own + anyone they manage (direct reports or a team they own)
   *  - agent → only themselves
   */
  private async resolveScope(user: any): Promise<{ all: boolean; empIds: string[]; empNos: string[] }> {
    const perms: string[] = user?.permissionCodes ?? user?.permissions ?? [];
    if (perms.includes('scorecard.view_all')) return { all: true, empIds: [], empNos: [] };
    const tid = user.tenantId;
    const selfId = user.employeeId;
    if (!selfId) return { all: false, empIds: [], empNos: [] };
    const rows = await this.ds.query(
      `SELECT id, employee_no FROM employees
        WHERE tenant_id = $1 AND (
          id = $2
          OR direct_manager_id = $2
          OR team_id IN (SELECT id FROM teams WHERE tenant_id = $1 AND manager_id = $2)
        )`, [tid, selfId]);
    return {
      all: false,
      empIds: rows.map((r: any) => r.id),
      empNos: rows.map((r: any) => r.employee_no).filter(Boolean),
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
     Attendance-based scorecard (legacy — used by old Scorecard.tsx tabs)
  ════════════════════════════════════════════════════════════════════════ */

  @Get('employees')
  @ApiOperation({ summary: 'Per-employee attendance scorecard for a period' })
  async employees(
    @CurrentUser() user: any,
    @Query('from')        from?: string,
    @Query('to')          to?: string,
    @Query('functionId')  functionId?: string,
    @Query('gender')      gender?: string,
    @Query('sortBy')      sortBy?: string,
    @Query('limit')       limitQ?: string,
    @Query('offset')      offsetQ?: string,
  ) {
    const tid    = user.tenantId;
    const limit  = parseInt(limitQ  ?? '100', 10);
    const offset = parseInt(offsetQ ?? '0',   10);

    const [dateRow] = await this.ds.query(
      `SELECT MAX(attendance_date) AS latest FROM attendance_records WHERE tenant_id = $1`, [tid],
    );
    // BR-TIM-001: a pg `date` arrives as LOCAL midnight — toISOString() would name yesterday
    const latest = fmtLocalDate(dateRow.latest) ?? kwToday();
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const params: any[] = [tid, fromDate, toDate];
    const empFilters: string[] = [];
    if (functionId) { params.push(functionId); empFilters.push(`e.function_id = $${params.length}`); }
    if (gender)     { params.push(gender);      empFilters.push(`e.gender = $${params.length}`); }
    const scope = await this.resolveScope(user);
    if (!scope.all) { params.push(scope.empIds); empFilters.push(`e.id = ANY($${params.length}::uuid[])`); }
    const empWhere = empFilters.length ? 'AND ' + empFilters.join(' AND ') : '';

    const validSortCols: Record<string, string> = {
      late_count:      'late_count DESC',
      absent_count:    'absent_count DESC',
      missing_punch:   'missing_punch DESC',
      ot_hours:        'ot_hours DESC',
      attendance_rate: 'attendance_rate DESC',
      name:            'full_name ASC',
    };
    const orderBy = validSortCols[sortBy ?? ''] ?? 'attendance_rate DESC';

    const rows = await this.ds.query(
      `SELECT
         e.id, e.employee_no,
         e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
         e.gender, f.name AS function_name,
         COUNT(ar.id) AS working_days,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'present') AS present_days,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker IN ('absent','sick')) AS absent_count,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'leave') AS leave_days,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'off') AS off_days,
         COUNT(ar.id) FILTER (WHERE ar.punch_late_minutes > 0 AND ar.attendance_marker='present') AS late_count,
         COALESCE(SUM(ar.punch_late_minutes) FILTER (WHERE ar.punch_late_minutes > 0), 0) AS total_late_minutes,
         COUNT(ar.id) FILTER (WHERE ar.is_missing_punch AND ar.attendance_marker='present') AS missing_punch,
         COUNT(ar.id) FILTER (WHERE ar.is_missing_system AND ar.attendance_marker='present') AS missing_system,
         COALESCE(SUM(ar.ot_minutes) FILTER (WHERE ar.ot_minutes > 0), 0) AS total_ot_minutes,
         COUNT(ar.id) FILTER (WHERE ar.ot_minutes > 0) AS ot_count,
         COUNT(ar.id) FILTER (WHERE ar.is_wfh AND ar.attendance_marker='present') AS wfh_days,
         ROUND(
           100.0 * COUNT(ar.id) FILTER (WHERE ar.attendance_marker='present') /
           NULLIF(COUNT(ar.id) FILTER (WHERE ar.attendance_marker IN ('present','absent','sick')), 0)
         , 1) AS attendance_rate
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN attendance_records ar
         ON ar.employee_id = e.id AND ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
       WHERE e.tenant_id = $1 AND e.status = 'active' ${empWhere}
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, e.gender, f.name
       HAVING COUNT(ar.id) > 0
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const toN = (v: any) => parseInt(v ?? '0', 10);
    const toF = (v: any) => parseFloat(v ?? '0');

    return {
      period: { from: fromDate, to: toDate },
      data: rows.map((r: any, idx: number) => ({
        rank:            offset + idx + 1,
        id:              r.id,
        employeeNo:      r.employee_no,
        fullName:        r.full_name.trim(),
        gender:          r.gender,
        functionName:    r.function_name,
        workingDays:     toN(r.working_days),
        presentDays:     toN(r.present_days),
        absentCount:     toN(r.absent_count),
        leaveDays:       toN(r.leave_days),
        offDays:         toN(r.off_days),
        lateCount:       toN(r.late_count),
        totalLateMin:    toN(r.total_late_minutes),
        missingPunch:    toN(r.missing_punch),
        missingSystem:   toN(r.missing_system),
        otCount:         toN(r.ot_count),
        totalOtMin:      toN(r.total_ot_minutes),
        wfhDays:         toN(r.wfh_days),
        attendanceRate:  r.attendance_rate !== null ? toF(r.attendance_rate) : null,
      })),
    };
  }

  @Get('functions')
  @ApiOperation({ summary: 'Aggregated scorecard by function' })
  async byFunction(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    const tid = user.tenantId;
    const [dateRow] = await this.ds.query(
      `SELECT MAX(attendance_date) AS latest FROM attendance_records WHERE tenant_id = $1`, [tid],
    );
    // BR-TIM-001 — same as above; this is the second call site of the identical bug
    const latest = fmtLocalDate(dateRow.latest) ?? kwToday();
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const fParams: any[] = [tid, fromDate, toDate];
    const scope = await this.resolveScope(user);
    let fScope = '';
    if (!scope.all) { fParams.push(scope.empIds); fScope = `AND e.id = ANY($${fParams.length}::uuid[])`; }
    /* NOTE — `ot_minutes` below is the THIN single-column legacy source on
       attendance_records. It structurally cannot reach TRUE_OT (ot + offday +
       holiday, BR-OT-001) and runs ~28% short of every other OT surface. This
       endpoint currently has no UI consumer; retargeting it to roster_days is
       tracked separately rather than changed silently here. */
    const rows = await this.ds.query(
      `SELECT f.name AS function_name,
         COUNT(DISTINCT e.id) AS headcount,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'present') AS present_total,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker IN ('absent','sick')) AS absent_total,
         COUNT(ar.id) FILTER (WHERE ${PUNCH_LATE} AND ar.attendance_marker='present') AS late_total,
         COALESCE(SUM(ar.punch_late_minutes) FILTER (WHERE ${PUNCH_LATE}),0) AS late_minutes_total,
         COUNT(ar.id) FILTER (WHERE ar.is_missing_punch AND ar.attendance_marker='present') AS missing_punch_total,
         COALESCE(SUM(ar.ot_minutes) FILTER (WHERE ar.ot_minutes > 0),0) AS ot_minutes_total,
         ROUND(100.0 * COUNT(ar.id) FILTER (WHERE ar.attendance_marker='present') /
           NULLIF(COUNT(ar.id) FILTER (WHERE ar.attendance_marker IN ('present','absent','sick')),0), 1) AS attendance_rate
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN attendance_records ar
         ON ar.employee_id = e.id AND ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
       WHERE e.tenant_id = $1 AND e.status = 'active' ${fScope}
       GROUP BY f.name ORDER BY attendance_rate DESC`,
      fParams,
    );

    return {
      period: { from: fromDate, to: toDate },
      data: rows.map((r: any) => ({
        functionName:      r.function_name,
        headcount:         parseInt(r.headcount, 10),
        presentTotal:      parseInt(r.present_total, 10),
        absentTotal:       parseInt(r.absent_total, 10),
        lateTotal:         parseInt(r.late_total, 10),
        lateMinsTotal:     parseInt(r.late_minutes_total, 10),
        missingPunchTotal: parseInt(r.missing_punch_total, 10),
        otMinsTotal:       parseInt(r.ot_minutes_total, 10),
        attendanceRate:    r.attendance_rate !== null ? parseFloat(r.attendance_rate) : null,
      })),
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
     KPI Scorecard — upload + batch management
  ════════════════════════════════════════════════════════════════════════ */

  /** Parse preview without saving */
  @Post('upload/preview')
  @RequirePermissions('scorecard.import')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse scorecard Excel — preview only, no DB write' })
  async uploadPreview(
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 })],
    })) file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.uploadSvc.parsePreview(file.buffer, file.originalname);
  }

  /** Commit upload → save to DB */
  @Post('upload/commit')
  @RequirePermissions('scorecard.import')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse and commit scorecard Excel to the database' })
  async uploadCommit(
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 })],
    })) file: Express.Multer.File,
    @CurrentUser() user: any,
    @Query('notes') notes?: string,
  ) {
    const result = await this.uploadSvc.commitUpload(
      file.buffer,
      file.originalname,
      user.tenantId,
      user.id,
      { notes },
    );
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,$3,'scorecard.committed','scorecard','scorecard_batch',$4,$5)`,
      [user.tenantId, user.id, user.email ?? null, result.batchId, `Committed ${result.totalEntries} entries from ${file.originalname}`],
    ).catch(() => {});
    return { success: true, ...result };
  }

  /** List all batches */
  @Get('batches')
  @ApiOperation({ summary: 'List scorecard upload batches' })
  async listBatches(@CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT b.id, b.period_name, b.period_year, b.period_month,
              b.total_employees, b.uploaded_at, b.status, b.notes,
              u.username AS uploaded_by_name,
              (SELECT COUNT(*) FROM scorecard_entries WHERE batch_id = b.id AND week_label = 'Final') AS final_count
       FROM scorecard_batches b
       LEFT JOIN users u ON u.id = b.uploaded_by
       WHERE b.tenant_id = $1
       ORDER BY b.period_year DESC, b.period_month DESC`,
      [user.tenantId],
    );
    return rows.map((r: any) => ({
      id:              r.id,
      periodName:      r.period_name,
      periodYear:      r.period_year,
      periodMonth:     r.period_month,
      totalEmployees:  r.total_employees,
      uploadedAt:      r.uploaded_at,
      status:          r.status,
      notes:           r.notes,
      uploadedByName:  r.uploaded_by_name,
      finalCount:      parseInt(r.final_count, 10),
    }));
  }

  /** Rankings for a batch — Final week, per function */
  @Get('batches/:id/rankings')
  @ApiOperation({ summary: 'Final rankings per function for a batch' })
  async rankings(
    @Param('id') batchId: string,
    @CurrentUser() user: any,
    @Query('function') fn?: string,
    @Query('week')     week?: string,
  ) {
    const weekLabel = week ?? 'Final';
    const params: any[] = [user.tenantId, batchId, weekLabel];
    let fnFilter = '';
    if (fn) { params.push(fn); fnFilter = `AND se.function_name = $${params.length}`; }
    const scope = await this.resolveScope(user);
    let scopeFilter = '';
    if (!scope.all) { params.push(scope.empNos); scopeFilter = `AND se.employee_no = ANY($${params.length}::text[])`; }

    const rows = await this.ds.query(
      `SELECT se.employee_name, se.employee_no, se.user_id_login,
              se.function_name, se.team_leader, se.week_label,
              se.working_days_pct, se.net_points, se.function_rank,
              se.quality_actual, se.quality_score,
              se.aht_actual, se.aht_score,
              se.fcr_actual, se.fcr_score,
              se.productivity_actual, se.productivity_score,
              se.ctr_actual, se.ctr_score,
              se.quiz_actual, se.quiz_score,
              se.mistakes_actual, se.mistakes_score,
              se.incidents_actual, se.incidents_score,
              se.response_time_actual, se.response_time_score,
              se.prr_rate, se.prr_points, se.prr_bonus,
              se.response_rate
       FROM scorecard_entries se
       WHERE se.tenant_id = $1 AND se.batch_id = $2 AND se.week_label = $3
       ${fnFilter} ${scopeFilter}
       ORDER BY se.function_name, COALESCE(se.function_rank, 9999), se.net_points DESC NULLS LAST`,
      params,
    );

    const toN = (v: any) => v === null || v === undefined ? null : parseInt(v, 10);
    const toF = (v: any) => v === null || v === undefined ? null : parseFloat(v);

    return rows.map((r: any) => ({
      employeeName:        r.employee_name,
      employeeNo:          r.employee_no,
      loginId:             r.user_id_login,
      functionName:        r.function_name,
      teamLeader:          r.team_leader,
      weekLabel:           r.week_label,
      workingDaysPct:      toF(r.working_days_pct),
      netPoints:           toN(r.net_points),
      functionRank:        toN(r.function_rank),
      qualityActual:       toF(r.quality_actual),   qualityScore:       toN(r.quality_score),
      ahtActual:           toF(r.aht_actual),        ahtScore:           toN(r.aht_score),
      fcrActual:           toF(r.fcr_actual),        fcrScore:           toN(r.fcr_score),
      productivityActual:  toF(r.productivity_actual), productivityScore: toN(r.productivity_score),
      ctrActual:           toF(r.ctr_actual),        ctrScore:           toN(r.ctr_score),
      quizActual:          toF(r.quiz_actual),        quizScore:          toN(r.quiz_score),
      mistakesActual:      toN(r.mistakes_actual),   mistakesScore:      toN(r.mistakes_score),
      incidentsActual:     toN(r.incidents_actual),  incidentsScore:     toN(r.incidents_score),
      rtActual:            toF(r.response_time_actual), rtScore:          toN(r.response_time_score),
      prrRate:             toF(r.prr_rate),
      prrPoints:           toN(r.prr_points),
      prrBonus:            toN(r.prr_bonus),
      responseRate:        toF(r.response_rate),
      incentiveKd:         this.getIncentive(toN(r.function_rank)),
    }));
  }

  /** Weekly breakdown for a single employee in a batch */
  @Get('batches/:id/employee/:loginId')
  @ApiOperation({ summary: 'All-weeks data for one employee in a batch' })
  async employeeWeeks(
    @Param('id')      batchId: string,
    @Param('loginId') loginId: string,
    @CurrentUser()    user: any,
  ) {
    const scope = await this.resolveScope(user);
    const params: any[] = [user.tenantId, batchId, loginId];
    let scopeFilter = '';
    if (!scope.all) { params.push(scope.empNos); scopeFilter = `AND employee_no = ANY($${params.length}::text[])`; }
    const rows = await this.ds.query(
      `SELECT * FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND user_id_login=$3 ${scopeFilter}
       ORDER BY CASE week_label WHEN 'W1' THEN 1 WHEN 'W2' THEN 2 WHEN 'W3' THEN 3 WHEN 'W4' THEN 4 ELSE 5 END`,
      params,
    );
    return rows;
  }

  /** Delete a batch */
  @Delete('batches/:id')
  @RequirePermissions('scorecard.import')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a scorecard batch' })
  async deleteBatch(@Param('id') batchId: string, @CurrentUser() user: any) {
    await this.ds.query(
      `DELETE FROM scorecard_batches WHERE id=$1 AND tenant_id=$2`,
      [batchId, user.tenantId],
    );
  }

  /** Dashboard summary — totals, function averages, top 3, coaching list */
  @Get('batches/:id/dashboard')
  @ApiOperation({ summary: 'Dashboard summary for a scorecard batch' })
  async batchDashboard(@Param('id') batchId: string, @CurrentUser() user: any) {
    const tid = user.tenantId;
    const scope = await this.resolveScope(user);
    const sc = scope.all ? '' : `AND employee_no = ANY($3::text[])`;
    const p: any[] = scope.all ? [tid, batchId] : [tid, batchId, scope.empNos];

    const [totals] = await this.ds.query(
      `SELECT COUNT(*) AS total_employees,
              COUNT(*) FILTER (WHERE net_points >= 0) AS passing,
              COUNT(*) FILTER (WHERE net_points < 0)  AS failing,
              ROUND(AVG(net_points)::numeric, 1)        AS overall_avg,
              MAX(net_points)                            AS highest,
              MIN(net_points)                            AS lowest
       FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final' ${sc}`,
      p,
    );

    const fnAvgs = await this.ds.query(
      `SELECT function_name,
              COUNT(*)                                                         AS emp_count,
              ROUND(AVG(net_points)::numeric, 1)                              AS avg_net_points,
              ROUND((AVG(quality_actual) * 100)::numeric, 1)                  AS avg_quality_pct,
              ROUND((AVG(aht_actual) * 1440)::numeric, 1)                     AS avg_aht_mins,
              ROUND((AVG(fcr_actual) * 100)::numeric, 1)                      AS avg_fcr_pct,
              ROUND((AVG(working_days_pct) * 100)::numeric, 1)                AS avg_wd_pct,
              COUNT(*) FILTER (WHERE net_points < 0)                          AS below_zero_count,
              COUNT(*) FILTER (WHERE net_points >= 0)                         AS passing_count
       FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final' ${sc}
       GROUP BY function_name ORDER BY avg_net_points DESC`,
      p,
    );

    const top3 = await this.ds.query(
      `SELECT employee_name, function_name, net_points, function_rank,
              quality_actual, aht_actual, fcr_actual, working_days_pct,
              user_id_login, employee_no, rn
       FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY function_name ORDER BY net_points DESC NULLS LAST
         ) AS rn
         FROM scorecard_entries
         WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final'
           AND net_points > 0 ${sc}
       ) sub WHERE rn <= 3
       ORDER BY function_name, rn`,
      p,
    );

    const coaching = await this.ds.query(
      `SELECT employee_name, employee_no, user_id_login, function_name, team_leader,
              net_points, quality_actual, quality_score, aht_score, fcr_score,
              quiz_score, mistakes_actual, mistakes_score, incidents_actual, function_rank
       FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final'
         AND (net_points < 0 OR net_points IS NULL) ${sc}
       ORDER BY net_points ASC NULLS LAST`,
      p,
    );

    const toN = (v: any) => v === null || v === undefined ? null : parseInt(v, 10);
    const toF = (v: any) => v === null || v === undefined ? null : parseFloat(v);

    /* COUNTs are genuinely zero when nothing matched — "no employees passed" is a
       measurement. AVG/MIN/MAX over an empty set are NOT: `?? 0` reported an
       average score of 0 for a period with no scored rows, which reads as the
       whole centre failing. Those stay null and render as "—". */
    return {
      totals: {
        totalEmployees: toN(totals?.total_employees) ?? 0,
        passing:        toN(totals?.passing) ?? 0,
        failing:        toN(totals?.failing) ?? 0,
        overallAvg:     toF(totals?.overall_avg),
        highest:        toN(totals?.highest),
        lowest:         toN(totals?.lowest),
      },
      functionAverages: fnAvgs.map((r: any) => ({
        functionName:    r.function_name,
        empCount:        toN(r.emp_count),
        avgNetPoints:    toF(r.avg_net_points),
        avgQualityPct:   toF(r.avg_quality_pct),
        avgAhtMins:      toF(r.avg_aht_mins),
        avgFcrPct:       toF(r.avg_fcr_pct),
        avgWdPct:        toF(r.avg_wd_pct),
        belowZeroCount:  toN(r.below_zero_count),
        passingCount:    toN(r.passing_count),
      })),
      top3PerFunction: top3.map((r: any) => ({
        employeeName:   r.employee_name,
        functionName:   r.function_name,
        netPoints:      toN(r.net_points),
        podiumRank:     toN(r.rn),
        qualityActual:  toF(r.quality_actual),
        ahtActual:      toF(r.aht_actual),
        fcrActual:      toF(r.fcr_actual),
        workingDaysPct: toF(r.working_days_pct),
        loginId:        r.user_id_login,
        employeeNo:     r.employee_no,
      })),
      coachingList: coaching.map((r: any) => ({
        employeeName:  r.employee_name,
        employeeNo:    r.employee_no,
        loginId:       r.user_id_login,
        functionName:  r.function_name,
        teamLeader:    r.team_leader,
        netPoints:     toN(r.net_points),
        qualityActual: toF(r.quality_actual),
        qualityScore:  toN(r.quality_score),
        ahtScore:      toN(r.aht_score),
        fcrScore:      toN(r.fcr_score),
        quizScore:     toN(r.quiz_score),
        mistakesActual: toN(r.mistakes_actual),
        mistakesScore:  toN(r.mistakes_score),
        incidentsActual: toN(r.incidents_actual),
        functionRank:  toN(r.function_rank),
      })),
    };
  }

  /** Compare employee scores vs previous batch */
  @Get('batches/:id/trends')
  @ApiOperation({ summary: 'Period-over-period trend comparison' })
  async batchTrends(
    @Param('id') batchId: string,
    @CurrentUser() user: any,
    @Query('week') week?: string,
  ) {
    const tid       = user.tenantId;
    const weekLabel = week ?? 'Final';

    const [thisBatch] = await this.ds.query(
      `SELECT period_year, period_month FROM scorecard_batches WHERE id=$1 AND tenant_id=$2`,
      [batchId, tid],
    );
    if (!thisBatch) return { entries: [], prevBatch: null };

    const [prevBatch] = await this.ds.query(
      `SELECT id, period_year, period_month, period_name FROM scorecard_batches
       WHERE tenant_id=$1
         AND (period_year < $2 OR (period_year = $2 AND period_month < $3))
       ORDER BY period_year DESC, period_month DESC LIMIT 1`,
      [tid, thisBatch.period_year, thisBatch.period_month],
    );

    const scope = await this.resolveScope(user);
    const sc = scope.all ? '' : `AND employee_no = ANY($4::text[])`;
    const cp: any[] = scope.all ? [tid, batchId, weekLabel] : [tid, batchId, weekLabel, scope.empNos];

    const current = await this.ds.query(
      `SELECT user_id_login, employee_name, function_name, net_points, function_rank,
              quality_actual, aht_actual, fcr_actual, working_days_pct
       FROM scorecard_entries WHERE tenant_id=$1 AND batch_id=$2 AND week_label=$3 ${sc}`,
      cp,
    );

    if (!prevBatch) return { entries: current.map((r: any) => ({ loginId: r.user_id_login, employeeName: r.employee_name, functionName: r.function_name, netPoints: r.net_points !== null ? parseInt(r.net_points, 10) : null, prevNetPoints: null, delta: null, rankDelta: null })), prevBatch: null };

    const previous = await this.ds.query(
      `SELECT user_id_login, net_points, function_rank FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label=$3 ${sc}`,
      scope.all ? [tid, prevBatch.id, weekLabel] : [tid, prevBatch.id, weekLabel, scope.empNos],
    );

    const prevMap: Record<string, any> = {};
    for (const p of previous) prevMap[p.user_id_login] = p;

    const toN = (v: any) => v === null || v === undefined ? null : parseInt(v, 10);

    return {
      prevBatch: { periodYear: prevBatch.period_year, periodMonth: prevBatch.period_month, periodName: prevBatch.period_name },
      entries: current.map((r: any) => {
        const prev    = prevMap[r.user_id_login];
        const curPts  = toN(r.net_points);
        const prevPts = prev ? toN(prev.net_points) : null;
        const curRank = toN(r.function_rank);
        const prevRank = prev ? toN(prev.function_rank) : null;
        return {
          loginId:       r.user_id_login,
          employeeName:  r.employee_name,
          functionName:  r.function_name,
          netPoints:     curPts,
          prevNetPoints: prevPts,
          delta:         curPts !== null && prevPts !== null ? curPts - prevPts : null,
          rankDelta:     curRank !== null && prevRank !== null ? prevRank - curRank : null,
        };
      }),
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
     PERFORMANCE ANALYZE — cumulative across ALL months: trend, KPI gaps,
     coaching-need (+ why), intern keep/let-go. Frontline ranked; interns review-only.
     Cross-month series = canonical scorecard_monthly (Net Points per employee×month,
     imported from the real SCORED workbooks). scorecard_entries holds ONE month and
     only supplies the per-KPI breakdown + attendance of its batch.
  ════════════════════════════════════════════════════════════════════════ */
  @Get('analyze')
  @ApiOperation({ summary: 'Cumulative performance analysis across all scored months (scorecard_monthly)' })
  async analyze(@CurrentUser() user: any, @Query('function') fn?: string) {
    const tid = user.tenantId;
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthsAxis = await this.ds.query(
      `SELECT year, month FROM scorecard_monthly WHERE tenant_id=$1
       GROUP BY year, month ORDER BY year, month`, [tid]);
    if (!monthsAxis.length) return { months: [], employees: [], interns: [], insights: {} };
    const order: Record<string, number> = {};
    monthsAxis.forEach((m: any, i: number) => (order[`${m.year}-${m.month}`] = i));

    const aParams: any[] = [tid];
    let aFn = '', aScope = '';
    if (fn) { aParams.push(fn); aFn = `AND sm.function_name = $${aParams.length}`; }
    const scope = await this.resolveScope(user);
    if (!scope.all) {
      // alias-aware scope: an agent's old intern id maps to the same person_no
      const persons = (await this.ds.query(
        `SELECT DISTINCT person_no FROM employee_identity
         WHERE tenant_id=$1 AND employee_no = ANY($2::text[])`, [tid, scope.empNos]))
        .map((p: any) => p.person_no);
      aParams.push(scope.empNos, persons);
      aScope = `AND (sm.employee_no = ANY($${aParams.length - 1}::text[]) OR i.person_no = ANY($${aParams.length}::text[]))`;
    }
    const rows = await this.ds.query(
      `SELECT sm.year, sm.month, sm.employee_no, COALESCE(i.person_no, sm.employee_no) AS person_no,
              sm.name AS employee_name, sm.function_name, sm.team_manager AS team_leader,
              sm.avg_net_points
       FROM scorecard_monthly sm
       LEFT JOIN employee_identity i ON i.tenant_id = sm.tenant_id AND i.employee_no = sm.employee_no
       WHERE sm.tenant_id=$1 ${aFn} ${aScope}
       ORDER BY sm.year, sm.month`,
      aParams);

    // per-KPI breakdown + attendance live only in the latest uploaded batch (one month)
    const [kpiBatch] = await this.ds.query(
      `SELECT id, period_year, period_month, period_name FROM scorecard_batches
       WHERE tenant_id=$1 AND status='active'
       ORDER BY period_year DESC, period_month DESC LIMIT 1`, [tid]);
    const kpiByPerson = new Map<string, any>();
    if (kpiBatch) {
      const kRows = await this.ds.query(
        `SELECT COALESCE(i.person_no, se.employee_no) AS person_no, se.user_id_login,
                se.quality_score, se.aht_score, se.fcr_score, se.prr_points, se.productivity_score,
                se.ctr_score, se.quiz_score, se.mistakes_score, se.response_time_score,
                se.working_days_pct
         FROM scorecard_entries se
         LEFT JOIN employee_identity i ON i.tenant_id = se.tenant_id AND i.employee_no = se.employee_no
         WHERE se.tenant_id=$1 AND se.batch_id=$2 AND se.week_label='Final'`, [tid, kpiBatch.id]);
      for (const r of kRows) kpiByPerson.set(r.person_no, r);
    }

    const toN = (v: any) => (v === null || v === undefined ? null : parseInt(v, 10));
    const round1 = (v: number) => Math.round(v * 10) / 10;
    const KPI: [string, string][] = [['Quality', 'quality_score'], ['AHT', 'aht_score'], ['FCR', 'fcr_score'],
      ['PRR', 'prr_points'], ['Productivity', 'productivity_score'], ['CTR', 'ctr_score'],
      ['Quiz', 'quiz_score'], ['Common Mistakes', 'mistakes_score'], ['Response Time', 'response_time_score']];
    const isIntern = (f: string) => /intern/i.test(f || '');

    // deterministic coaching content per weak KPI (below bar). Actionable + target.
    const ADVICE: Record<string, { issue: string; action: string; target: string }> = {
      Quality: { issue: 'Quality below the 80% bar', action: 'Review the QA rubric on recent contacts; focus on accuracy, process adherence and empathy; shadow a top performer', target: 'Quality ≥ 95%' },
      AHT: { issue: 'Handling time above target', action: 'Use canned responses / knowledge base, reduce dead-air and after-call work, avoid unnecessary holds', target: 'AHT ≤ 48h equivalent' },
      FCR: { issue: 'First-contact resolution low', action: 'Confirm the full issue is resolved before closing; use resolution checklists; reduce re-contacts', target: 'FCR ≥ 85%' },
      CTR: { issue: 'Call-to-ticket ratio off target', action: 'Log every actionable contact as a ticket; align tagging with policy', target: 'CTR ≥ 95%' },
      Quiz: { issue: 'Weekly training quiz below 90%', action: 'Complete the weekly quiz on time; review the training material before attempting', target: 'Quiz ≥ 90%' },
      Productivity: { issue: 'Productivity below 91%', action: 'Manage break timing (stay within Short/Tea/Lunch/Bio limits), reduce idle/unavailable time', target: 'Productivity ≥ 91%' },
      'Common Mistakes': { issue: 'Repeated common mistakes', action: 'Address the flagged recurring errors; pair with TL on the specific cases', target: '0 mistakes' },
      'Response Time': { issue: 'First-response time too high', action: 'Reply to the first message faster; manage concurrent chats; use greetings/templates', target: 'FRT ≤ 1h' },
      PRR: { issue: 'Positive response rate low', action: 'Improve closing and CSAT-driving behaviours; ask for feedback', target: 'PRR ≥ 80%' },
    };
    const coachingFor = (weak: string[]) => weak.map(k => ({ kpi: k, ...(ADVICE[k] || { issue: `${k} below bar`, action: 'Review with TL', target: 'meet the bar' }) }));

    // group by person (intern id + full-time id fold into one series)
    const emps: Record<string, any> = {};
    for (const r of rows) {
      const e = (emps[r.person_no] = emps[r.person_no] || { personNo: r.person_no, empNo: r.employee_no, name: r.employee_name, func: r.function_name, tl: r.team_leader, byMonth: new Map<number, number[]>() });
      // latest month row wins for identity/function labels (rows are month-ordered)
      e.empNo = r.employee_no; e.name = r.employee_name || e.name;
      e.func = r.function_name || e.func; e.tl = r.team_leader || e.tl;
      const idx = order[`${r.year}-${r.month}`];
      const net = r.avg_net_points == null ? null : Number(r.avg_net_points);
      if (net != null) { const arr = e.byMonth.get(idx) || []; arr.push(net); e.byMonth.set(idx, arr); }
    }

    const employees = Object.values(emps).map((e: any) => {
      // one net per month; two raw ids in the same month (id change) → mean
      const series = [...e.byMonth.entries()]
        .map(([idx, arr]: [number, number[]]) => ({ idx, net: round1(arr.reduce((a, b) => a + b, 0) / arr.length) }))
        .sort((a, b) => a.idx - b.idx);
      const nets = series.map(s => s.net);
      const trend = nets.length >= 2 ? round1(nets[nets.length - 1] - nets[0]) : 0;
      const avgNet = nets.length ? Math.round(nets.reduce((a, b) => a + b, 0) / nets.length) : null;
      const latestNet = nets.length ? Math.round(nets[nets.length - 1]) : null;
      const kpi = kpiByPerson.get(e.personNo);
      const weak = kpi ? KPI.filter(([, c]) => (toN(kpi[c]) ?? 0) < 0).map(([n]) => n) : [];
      const needsCoaching = weak.length > 0 || (latestNet ?? 0) <= 0;
      return {
        loginId: kpi?.user_id_login ?? e.empNo, name: e.name, empNo: e.empNo, func: e.func, tl: e.tl, intern: isIntern(e.func),
        months: nets, latestNet, avgNet, trend,
        direction: trend > 0 ? 'improving' : trend < 0 ? 'declining' : 'flat',
        weakKpis: weak, needsCoaching, coaching: needsCoaching ? coachingFor(weak) : [],
        attendance: kpi && kpi.working_days_pct != null ? Number(kpi.working_days_pct) : null,
      };
    });

    const interns = employees.filter((e: any) => e.intern).map((e: any) => {
      const att = e.attendance, net = e.latestNet || 0;
      // no attendance evidence (not in the latest KPI batch) → never recommend Let go on score alone
      const recommendation = att == null ? (net >= 80 ? 'Keep' : 'Review')
        : att >= 0.85 && net >= 80 ? 'Keep' : att < 0.7 || net < 50 ? 'Let go' : 'Review';
      const why = att == null ? `score ${net} (no attendance data in latest KPI batch)`
        : recommendation === 'Keep' ? `attendance ${Math.round(att * 100)}% + score ${net}`
        : recommendation === 'Let go' ? `low ${att < 0.7 ? 'attendance ' + Math.round(att * 100) + '%' : ''}${att < 0.7 && net < 50 ? ' & ' : ''}${net < 50 ? 'score ' + net : ''}`
        : `attendance ${Math.round(att * 100)}%, score ${net}`;
      return { ...e, recommendation, why };
    }).sort((a: any, b: any) => ((b.attendance ?? 0) + (b.latestNet ?? 0) / 130) - ((a.attendance ?? 0) + (a.latestNet ?? 0) / 130));

    const frontline = employees.filter((e: any) => !e.intern);
    const insights = {
      totalEmployees: employees.length, frontline: frontline.length, internCount: interns.length,
      improving: frontline.filter((e: any) => e.direction === 'improving').length,
      declining: frontline.filter((e: any) => e.direction === 'declining').length,
      needCoaching: frontline.filter((e: any) => e.needsCoaching).length,
      topImprovers: [...frontline].sort((a, b) => b.trend - a.trend).slice(0, 5).map((e: any) => ({ name: e.name, func: e.func, trend: e.trend })),
      topDecliners: [...frontline].sort((a, b) => a.trend - b.trend).slice(0, 5).map((e: any) => ({ name: e.name, func: e.func, trend: e.trend })),
      internLetGo: interns.filter((i: any) => i.recommendation === 'Let go').length,
      kpiSource: kpiBatch ? { periodName: kpiBatch.period_name, year: kpiBatch.period_year, month: kpiBatch.period_month } : null,
    };
    return {
      months: monthsAxis.map((m: any) => ({ id: `${m.year}-${String(m.month).padStart(2, '0')}`, name: `${MONTH_NAMES[m.month - 1]} ${m.year}`, year: m.year, month: m.month })),
      employees, interns, insights,
    };
  }

  /** Download rankings as Excel */
  @Get('batches/:id/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Export batch rankings as Excel file' })
  async exportBatch(
    @Param('id') batchId: string,
    @CurrentUser() user: any,
    @Query('week') week?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    const tid       = user.tenantId;
    const weekLabel = week ?? 'Final';

    const [batch] = await this.ds.query(
      `SELECT period_name FROM scorecard_batches WHERE id=$1 AND tenant_id=$2`,
      [batchId, tid],
    );
    const periodName = batch?.period_name ?? 'Scorecard';

    // Row-level visibility — mirror rankings/verify: agents/TLs may only export
    // their own scope; scorecard.view_all (WFM/HR/admin) exports everyone.
    const params: any[] = [tid, batchId, weekLabel];
    const scope = await this.resolveScope(user);
    let scopeFilter = '';
    if (!scope.all) { params.push(scope.empNos); scopeFilter = `AND se.employee_no = ANY($${params.length}::text[])`; }

    const rows = await this.ds.query(
      `SELECT se.function_name, se.employee_name, se.employee_no, se.user_id_login,
              se.team_leader, se.week_label, se.function_rank, se.net_points,
              se.working_days_pct,
              se.quality_actual, se.quality_score,
              se.aht_actual, se.aht_score,
              se.fcr_actual, se.fcr_score,
              se.productivity_actual, se.productivity_score,
              se.ctr_actual, se.ctr_score,
              se.quiz_actual, se.quiz_score,
              se.mistakes_actual, se.mistakes_score,
              se.incidents_actual, se.incidents_score,
              se.response_time_actual, se.response_time_score,
              se.prr_rate, se.prr_points, se.prr_bonus
       FROM scorecard_entries se
       WHERE se.tenant_id=$1 AND se.batch_id=$2 AND se.week_label=$3 ${scopeFilter}
       ORDER BY se.function_name, COALESCE(se.function_rank, 9999), se.net_points DESC NULLS LAST`,
      params,
    );

    const pct  = (v: any) => v == null ? '' : `${Math.round(parseFloat(v) * 100)}%`;
    const mins = (v: any) => v == null ? '' : `${Math.round(parseFloat(v) * 1440)}m`;

    const sheetData = [
      ['Rank', 'Function', 'Employee', 'Emp#', 'Login', 'TL', 'WD%', 'Net Pts',
       'Quality%', 'Q Score', 'AHT', 'AHT Score', 'FCR%', 'FCR Score',
       'Prod%', 'Prod Score', 'CTR%', 'CTR Score', 'Quiz%', 'Quiz Score',
       'Mistakes', 'Mist Score', 'Incidents', 'Inc Score', 'RT', 'RT Score',
       'PRR Rate', 'PRR Pts', 'PRR Bonus'],
      ...rows.map((r: any) => [
        r.function_rank ?? '',
        r.function_name ?? '',
        r.employee_name ?? '',
        r.employee_no ?? '',
        r.user_id_login ?? '',
        r.team_leader ?? '',
        pct(r.working_days_pct),
        r.net_points ?? '',
        pct(r.quality_actual), r.quality_score ?? '',
        mins(r.aht_actual), r.aht_score ?? '',
        pct(r.fcr_actual), r.fcr_score ?? '',
        pct(r.productivity_actual), r.productivity_score ?? '',
        pct(r.ctr_actual), r.ctr_score ?? '',
        pct(r.quiz_actual), r.quiz_score ?? '',
        r.mistakes_actual ?? '', r.mistakes_score ?? '',
        r.incidents_actual ?? '', r.incidents_score ?? '',
        mins(r.response_time_actual), r.response_time_score ?? '',
        pct(r.prr_rate), r.prr_points ?? '', r.prr_bonus ?? '',
      ]),
    ];

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = sheetData[0].map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, ws, weekLabel);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = periodName.replace(/[^a-zA-Z0-9_\- ]/g, '') + ` ${weekLabel}`;
    res?.set('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    return new StreamableFile(Readable.from(buf));
  }

  /* ════════════════════════════════════════════════════════════════════════
     VALIDATED-ENGINE ALIGNMENT (read-only) — the live module ingests the
     Director's already-scored workbook; these two endpoints let it compute /
     verify Net Points with the SAME kpi-registry engine the historical harness
     proved at 98.47%. Neither mutates data nor auto-scores a month — AUTO-scoring
     activation stays the Director's call.
  ════════════════════════════════════════════════════════════════════════ */

  /**
   * Can the engine score WITHOUT a human uploading a workbook — and if not, what
   * exactly is missing and what is it worth in Net Points?
   *
   * B7 proved the engine is correct (98.95%); this proves whether it has anything
   * to be correct ABOUT. Every verdict is a live COUNT over the real tables, so it
   * re-answers itself the day a feed lands. READ-ONLY.
   */
  @Get('auto-scoring-readiness')
  // The class gate is scorecard.view_own (an AGENT-level permission) because most
  // endpoints here are row-scoped per person. This one is not: it has no per-person
  // rows to scope, and it exposes table names, row counts and the size of the
  // workforce. That is operational detail an agent has no business reading, so it
  // is raised to the WFM/admin permission explicitly.
  @RequirePermissions('scorecard.view_all')
  @ApiOperation({ summary: 'Per-KPI live-feed readiness for auto-scoring, with each missing feed priced in Net Points (read-only, WFM/admin)' })
  async autoScoringReadiness(@CurrentUser() user: any, @Query('months') months?: string) {
    const m = Math.min(12, Math.max(1, Number(months) || 3));
    return this.readinessSvc.report(user.tenantId, m);
  }

  /** Read-only rulebook for the Scoring-Rules transparency viewer. */
  @Get('scoring-rules')
  @ApiOperation({ summary: 'The scoring rulebook (per-KPI weights + per-function bands + QA not-evaluated rule) from the validated kpi-registry' })
  async scoringRules(@CurrentUser() user: any) {
    return this.scoringSvc.getRulebook(user.tenantId);
  }

  /**
   * Recompute a committed batch's Net Points from its stored actuals through the
   * validated engine and reconcile against the Director's workbook scores.
   * READ-ONLY — proves the live path reproduces the 98.47%-validated output.
   */
  @Get('batches/:id/verify')
  @ApiOperation({ summary: 'Reconcile stored workbook scores vs the validated-engine recompute (read-only, never writes)' })
  async verifyBatch(
    @Param('id') batchId: string,
    @CurrentUser() user: any,
    @Query('week') week?: string,
    @Query('function') fn?: string,
  ) {
    const tid = user.tenantId;
    const weekLabel = week ?? 'Final';
    const [batch] = await this.ds.query(
      `SELECT id, period_name, period_year, period_month FROM scorecard_batches WHERE id=$1 AND tenant_id=$2`,
      [batchId, tid],
    );
    if (!batch) return { batch: null, summary: null, rows: [] };

    const params: any[] = [tid, batchId, weekLabel];
    let fnFilter = '';
    if (fn) { params.push(fn); fnFilter = `AND se.function_name = $${params.length}`; }
    const scope = await this.resolveScope(user);
    let scopeFilter = '';
    if (!scope.all) { params.push(scope.empNos); scopeFilter = `AND se.employee_no = ANY($${params.length}::text[])`; }

    const entries = await this.ds.query(
      `SELECT se.employee_name, se.employee_no, se.user_id_login, se.function_name,
              se.net_points,
              se.quality_actual, se.quality_score,
              se.prr_rate, se.response_rate, se.prr_points, se.prr_bonus,
              se.aht_actual, se.aht_score,
              se.fcr_actual, se.fcr_score,
              se.productivity_actual, se.productivity_score,
              se.ctr_actual, se.ctr_score,
              se.quiz_actual, se.quiz_score,
              se.mistakes_actual, se.mistakes_score,
              se.response_time_actual, se.response_time_score
         FROM scorecard_entries se
        WHERE se.tenant_id=$1 AND se.batch_id=$2 AND se.week_label=$3 ${fnFilter} ${scopeFilter}
        ORDER BY se.function_name, se.net_points DESC NULLS LAST`,
      params,
    );

    const toF = (v: any) => (v === null || v === undefined ? null : parseFloat(v));
    const toN = (v: any) => (v === null || v === undefined ? null : parseInt(v, 10));
    // Sheet Net sums blank score cells as 0 — normalise a stored NULL Net the same way.
    const wbNet = (v: any) => (v === null || v === undefined ? 0 : parseInt(v, 10));

    const rows = entries.map((e: any) => {
      const computed = this.scoringSvc.computeScores({
        functionName: e.function_name,
        qualityActual: toF(e.quality_actual),
        prrRate: toF(e.prr_rate),
        responseRate: toF(e.response_rate),
        ahtActual: toF(e.aht_actual),
        fcrActual: toF(e.fcr_actual),
        productivityActual: toF(e.productivity_actual),
        ctrActual: toF(e.ctr_actual),
        quizActual: toF(e.quiz_actual),
        mistakesActual: toF(e.mistakes_actual),
        responseTimeActual: toF(e.response_time_actual),
      });
      const workbookNet = wbNet(e.net_points);
      const engineNet = computed.netPoints;
      // per-cell workbook vs engine (workbook prr = points + bonus for a fair compare)
      const cells = {
        quality:      { workbook: toN(e.quality_score),      engine: computed.points.quality },
        prr:          { workbook: (toN(e.prr_points) ?? 0) + (toN(e.prr_bonus) ?? 0), engine: (computed.points.prrPoints ?? 0) + (computed.points.prrBonus ?? 0) },
        aht:          { workbook: toN(e.aht_score),           engine: computed.points.aht },
        fcr:          { workbook: toN(e.fcr_score),           engine: computed.points.fcr },
        productivity: { workbook: toN(e.productivity_score),  engine: computed.points.productivity },
        ctr:          { workbook: toN(e.ctr_score),           engine: computed.points.ctr },
        quiz:         { workbook: toN(e.quiz_score),          engine: computed.points.quiz },
        mistakes:     { workbook: toN(e.mistakes_score),      engine: computed.points.mistakes },
        responseTime: { workbook: toN(e.response_time_score), engine: computed.points.responseTime },
      };
      return {
        employeeName: e.employee_name,
        employeeNo:   e.employee_no,
        loginId:      e.user_id_login,
        functionName: e.function_name,
        workbookNet,
        engineNet,
        netMatch:     workbookNet === engineNet,
        netDelta:     engineNet - workbookNet,
        cells,
      };
    });

    const matching = rows.filter((r: any) => r.netMatch).length;
    return {
      batch: { id: batch.id, periodName: batch.period_name, year: batch.period_year, month: batch.period_month },
      readOnly: true,
      engine: 'kpi-registry score-band (validated 98.47%)',
      summary: {
        week: weekLabel,
        totalRows: rows.length,
        netMatching: matching,
        netMismatched: rows.length - matching,
        matchRatePct: rows.length ? Math.round((matching / rows.length) * 1000) / 10 : null,
      },
      rows,
    };
  }

  /* ── private ─────────────────────────────────────────────────────────── */
  private getIncentive(rank: number | null): number | null {
    if (!rank) return null;
    return INCENTIVE_TIERS.find(t => t.rank === rank)?.reward ?? null;
  }
}
