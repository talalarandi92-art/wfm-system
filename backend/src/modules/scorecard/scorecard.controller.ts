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
  ) {}

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
    const latestRaw = dateRow.latest instanceof Date ? dateRow.latest.toISOString() : (dateRow.latest ?? new Date().toISOString());
    const latest = latestRaw.slice(0, 10);
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const params: any[] = [tid, fromDate, toDate];
    const empFilters: string[] = [];
    if (functionId) { params.push(functionId); empFilters.push(`e.function_id = $${params.length}`); }
    if (gender)     { params.push(gender);      empFilters.push(`e.gender = $${params.length}`); }
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
    const latestRaw2 = dateRow.latest instanceof Date ? dateRow.latest.toISOString() : (dateRow.latest ?? new Date().toISOString());
    const latest = latestRaw2.slice(0, 10);
    const fromDate = from ?? latest.slice(0, 7) + '-01';
    const toDate   = to   ?? latest;

    const rows = await this.ds.query(
      `SELECT f.name AS function_name,
         COUNT(DISTINCT e.id) AS headcount,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker = 'present') AS present_total,
         COUNT(ar.id) FILTER (WHERE ar.attendance_marker IN ('absent','sick')) AS absent_total,
         COUNT(ar.id) FILTER (WHERE ar.punch_late_minutes > 0 AND ar.attendance_marker='present') AS late_total,
         COALESCE(SUM(ar.punch_late_minutes) FILTER (WHERE ar.punch_late_minutes > 0),0) AS late_minutes_total,
         COUNT(ar.id) FILTER (WHERE ar.is_missing_punch AND ar.attendance_marker='present') AS missing_punch_total,
         COALESCE(SUM(ar.ot_minutes) FILTER (WHERE ar.ot_minutes > 0),0) AS ot_minutes_total,
         ROUND(100.0 * COUNT(ar.id) FILTER (WHERE ar.attendance_marker='present') /
           NULLIF(COUNT(ar.id) FILTER (WHERE ar.attendance_marker IN ('present','absent','sick')),0), 1) AS attendance_rate
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN attendance_records ar
         ON ar.employee_id = e.id AND ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
       WHERE e.tenant_id = $1 AND e.status = 'active'
       GROUP BY f.name ORDER BY attendance_rate DESC`,
      [tid, fromDate, toDate],
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
    const fnFilter = fn ? `AND se.function_name = $4` : '';
    if (fn) params.push(fn);

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
       ${fnFilter}
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
    const rows = await this.ds.query(
      `SELECT * FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND user_id_login=$3
       ORDER BY CASE week_label WHEN 'W1' THEN 1 WHEN 'W2' THEN 2 WHEN 'W3' THEN 3 WHEN 'W4' THEN 4 ELSE 5 END`,
      [user.tenantId, batchId, loginId],
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

    const [totals] = await this.ds.query(
      `SELECT COUNT(*) AS total_employees,
              COUNT(*) FILTER (WHERE net_points >= 0) AS passing,
              COUNT(*) FILTER (WHERE net_points < 0)  AS failing,
              ROUND(AVG(net_points)::numeric, 1)        AS overall_avg,
              MAX(net_points)                            AS highest,
              MIN(net_points)                            AS lowest
       FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final'`,
      [tid, batchId],
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
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final'
       GROUP BY function_name ORDER BY avg_net_points DESC`,
      [tid, batchId],
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
           AND net_points > 0
       ) sub WHERE rn <= 3
       ORDER BY function_name, rn`,
      [tid, batchId],
    );

    const coaching = await this.ds.query(
      `SELECT employee_name, employee_no, user_id_login, function_name, team_leader,
              net_points, quality_actual, quality_score, aht_score, fcr_score,
              quiz_score, mistakes_actual, mistakes_score, incidents_actual, function_rank
       FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label='Final'
         AND (net_points < 0 OR net_points IS NULL)
       ORDER BY net_points ASC NULLS LAST`,
      [tid, batchId],
    );

    const toN = (v: any) => v === null || v === undefined ? null : parseInt(v, 10);
    const toF = (v: any) => v === null || v === undefined ? null : parseFloat(v);

    return {
      totals: {
        totalEmployees: toN(totals?.total_employees) ?? 0,
        passing:        toN(totals?.passing) ?? 0,
        failing:        toN(totals?.failing) ?? 0,
        overallAvg:     toF(totals?.overall_avg) ?? 0,
        highest:        toN(totals?.highest) ?? 0,
        lowest:         toN(totals?.lowest) ?? 0,
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

    const current = await this.ds.query(
      `SELECT user_id_login, employee_name, function_name, net_points, function_rank,
              quality_actual, aht_actual, fcr_actual, working_days_pct
       FROM scorecard_entries WHERE tenant_id=$1 AND batch_id=$2 AND week_label=$3`,
      [tid, batchId, weekLabel],
    );

    if (!prevBatch) return { entries: current.map((r: any) => ({ loginId: r.user_id_login, employeeName: r.employee_name, functionName: r.function_name, netPoints: r.net_points !== null ? parseInt(r.net_points, 10) : null, prevNetPoints: null, delta: null, rankDelta: null })), prevBatch: null };

    const previous = await this.ds.query(
      `SELECT user_id_login, net_points, function_rank FROM scorecard_entries
       WHERE tenant_id=$1 AND batch_id=$2 AND week_label=$3`,
      [tid, prevBatch.id, weekLabel],
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
       WHERE se.tenant_id=$1 AND se.batch_id=$2 AND se.week_label=$3
       ORDER BY se.function_name, COALESCE(se.function_rank, 9999), se.net_points DESC NULLS LAST`,
      [tid, batchId, weekLabel],
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

  /* ── private ─────────────────────────────────────────────────────────── */
  private getIncentive(rank: number | null): number | null {
    if (!rank) return null;
    return INCENTIVE_TIERS.find(t => t.rank === rank)?.reward ?? null;
  }
}
