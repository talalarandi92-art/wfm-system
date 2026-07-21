import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RtaIntradayService } from './rta-intraday.service';

@ApiTags('RTA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('rta.view')
@Controller({ path: 'rta', version: '1' })
export class RtaController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly intradayService: RtaIntradayService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'RTA live monitoring snapshot (attendance_records spine) — carries its own freshness' })
  async live(@CurrentUser() user: any) {
    const tid = user.tenantId;

    // Honesty audit 2026-07-21 (Stage 4A):
    //  a) the reference day is CAPPED at CURRENT_DATE — attendance_records carries
    //     FUTURE rows (published schedule), and the old bare MAX() could pick one,
    //     rendering a not-yet-happened day as the live board.
    //  b) the age of that day travels WITH the payload (`freshness`), so a board
    //     showing a days-old day can never be mistaken for "now".
    const [refRow] = await this.ds.query(
      `SELECT CURRENT_DATE::text AS today,
              (SELECT MAX(attendance_date)::text FROM attendance_records
                WHERE tenant_id = $1 AND attendance_date <= CURRENT_DATE) AS d`, [tid],
    );
    const refDate: string | null = refRow?.d ?? null;
    const today: string = refRow?.today;
    const ageDays = refDate
      ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${refDate}T00:00:00Z`)) / 86400000)
      : null;
    const freshness = {
      today,
      refDate,
      ageDays,
      isToday: refDate === today,
      source: 'attendance_records (published schedule + attendance markers)',
      warning: !refDate
        ? 'No attendance rows at or before today — nothing to show.'
        : refDate === today ? null
          : `Newest attendance day is ${refDate} (${ageDays} day(s) old) — these are NOT live figures.`,
    };
    // No usable day → say so, do not fabricate a board of zeros.
    if (!refDate) {
      return {
        refDate: null, freshness,
        summary: null, byFunction: [], agents: [], lateAgents: [], missingAgents: [],
      };
    }

    const [summary, byFunction, agents, lateAgents, missingAgents] = await Promise.all([

      // Overall summary
      this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE attendance_marker = 'present') AS present,
           COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_wfh) AS wfh,
           COUNT(*) FILTER (WHERE attendance_marker IN ('absent','sick')) AS absent,
           COUNT(*) FILTER (WHERE attendance_marker = 'off') AS off_day,
           COUNT(*) FILTER (WHERE attendance_marker = 'leave') AS on_leave,
           COUNT(*) FILTER (WHERE attendance_marker = 'present' AND is_missing_punch) AS missing_punch,
           COUNT(*) FILTER (WHERE punch_late_minutes > 0) AS late_in,
           COUNT(*) FILTER (WHERE punch_late_minutes > 30) AS late_over_30,
           COUNT(*) FILTER (WHERE ot_minutes > 0) AS ot_active,
           COUNT(*) AS total_scheduled
         FROM attendance_records
         WHERE tenant_id = $1 AND attendance_date = $2`,
        [tid, refDate],
      ),

      // Per function breakdown — intern-fold (2026-07-06, EXECUTION_BRIEF bug #10):
      // "Internship X" headcounts into "X" (canon_fn); function_id = the parent's id.
      this.ds.query(
        `SELECT canon_fn(f.name) AS function_name,
           (array_agg(f.id ORDER BY (canon_fn(f.name) = f.name) DESC))[1] AS function_id,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present' AND ar.is_wfh) AS wfh,
           COUNT(*) FILTER (WHERE ar.attendance_marker IN ('absent','sick')) AS absent,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'off') AS off_day,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'leave') AS on_leave,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present' AND ar.is_missing_punch) AS missing_punch,
           COUNT(*) FILTER (WHERE ar.punch_late_minutes > 0) AS late_in,
           COUNT(*) AS total
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
         GROUP BY canon_fn(f.name)
         ORDER BY present DESC`,
        [tid, refDate],
      ),

      // All agents with status
      this.ds.query(
        `SELECT e.id, e.employee_no,
           e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
           e.gender, f.name AS function_name,
           ar.attendance_marker,
           ar.is_wfh,
           ar.punch_late_minutes,
           ar.system_late_minutes,
           ar.is_missing_punch,
           ar.is_missing_system,
           ar.ot_minutes,
           ar.punch_in,
           ar.system_login,
           ar.scheduled_start,
           ar.absence_reason
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
         ORDER BY f.name, ar.attendance_marker, e.first_name_en`,
        [tid, refDate],
      ),

      // Top late arrivals
      this.ds.query(
        `SELECT e.employee_no,
           e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
           f.name AS function_name,
           ar.punch_late_minutes,
           ar.system_late_minutes
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
           AND ar.punch_late_minutes > 0
         ORDER BY ar.punch_late_minutes DESC
         LIMIT 10`,
        [tid, refDate],
      ),

      // Missing punch
      this.ds.query(
        `SELECT e.employee_no,
           e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS full_name,
           f.name AS function_name,
           ar.scheduled_start
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
           AND ar.is_missing_punch = true AND ar.attendance_marker = 'present'
         ORDER BY f.name, e.first_name_en
         LIMIT 20`,
        [tid, refDate],
      ),
    ]);

    const s = summary[0];
    const toInt = (v: any) => parseInt(v ?? '0', 10);
    // Honesty audit 2026-07-21: coveragePct used to divide by EVERY roster row of
    // the day — OFF days and annual leave included — so a normal day with a third
    // of the team on OFF read as ~65 % "coverage". The denominator is the people
    // who were EXPECTED at work (total − off − leave); null when nobody was.
    const expectedAtWork = Math.max(0, toInt(s.total_scheduled) - toInt(s.off_day) - toInt(s.on_leave));

    return {
      refDate,
      freshness,
      summary: {
        present:      toInt(s.present),
        wfh:          toInt(s.wfh),
        absent:       toInt(s.absent),
        offDay:       toInt(s.off_day),
        onLeave:      toInt(s.on_leave),
        missingPunch: toInt(s.missing_punch),
        lateIn:       toInt(s.late_in),
        lateOver30:   toInt(s.late_over_30),
        otActive:     toInt(s.ot_active),
        totalScheduled: toInt(s.total_scheduled),
        expectedAtWork,
        coveragePct: expectedAtWork > 0
          ? Math.round((toInt(s.present) / expectedAtWork) * 100)
          : null,
        coverageBasis: 'present / (roster rows − OFF − leave)',
      },
      byFunction: byFunction.map((r: any) => {
        const expected = Math.max(0, toInt(r.total) - toInt(r.off_day) - toInt(r.on_leave));
        return {
          functionId:   r.function_id,
          functionName: r.function_name,
          present:      toInt(r.present),
          wfh:          toInt(r.wfh),
          absent:       toInt(r.absent),
          offDay:       toInt(r.off_day),
          onLeave:      toInt(r.on_leave),
          missingPunch: toInt(r.missing_punch),
          lateIn:       toInt(r.late_in),
          total:        toInt(r.total),
          expectedAtWork: expected,
          coveragePct: expected > 0 ? Math.round((toInt(r.present) / expected) * 100) : null,
        };
      }),
      agents: agents.map((a: any) => ({
        id:              a.id,
        employeeNo:      a.employee_no,
        fullName:        a.full_name.trim(),
        gender:          a.gender,
        functionName:    a.function_name,
        status:          a.attendance_marker,
        isWfh:           a.is_wfh,
        lateMinutes:     toInt(a.punch_late_minutes),
        systemLateMin:   toInt(a.system_late_minutes),
        missingPunch:    a.is_missing_punch,
        missingSystem:   a.is_missing_system,
        otMinutes:       toInt(a.ot_minutes),
        punchIn:         a.punch_in,
        systemLogin:     a.system_login,
        scheduledStart:  a.scheduled_start,
        absenceReason:   a.absence_reason,
      })),
      lateAgents: lateAgents.map((a: any) => ({
        employeeNo:   a.employee_no,
        fullName:     a.full_name.trim(),
        functionName: a.function_name,
        lateMinutes:  toInt(a.punch_late_minutes),
        sysLateMin:   toInt(a.system_late_minutes),
      })),
      missingAgents: missingAgents.map((a: any) => ({
        employeeNo:    a.employee_no,
        fullName:      a.full_name.trim(),
        functionName:  a.function_name,
        scheduledStart: a.scheduled_start,
      })),
    };
  }

  /**
   * GET /v1/rta/intraday?date=YYYY-MM-DD&function=<name>&grain=15|30|60
   *
   * "Were we actually staffed to plan, hour by hour?" — per interval, per
   * function: SCHEDULED headcount (reconciled shift window, cross-midnight and
   * previous-day tails included) vs ACTUAL-ON-SYSTEM (a recon-captured system
   * session covering that interval) → adherence %, coverage gap/surplus and a
   * per-interval risk flag.
   *
   * Reads the canonical `roster_days` spine, so the plan and the actual come
   * from the SAME reconciled row. The served date, its age and the measurement
   * basis travel in the payload — a days-old reconciliation is never dressed up
   * as live, and an interval with no system evidence is `unknown`, not 0 %.
   */
  @Get('intraday')
  @ApiOperation({ summary: 'Intraday adherence: scheduled vs actual-on-system per interval per function (roster_days)' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD; capped at today, falls back to the newest reconciled day' })
  @ApiQuery({ name: 'function', required: false, description: 'Function name (intern functions fold into the parent via canon_fn)' })
  @ApiQuery({ name: 'grain', required: false, description: 'Interval minutes: 15 | 30 (default) | 60' })
  async intraday(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('function') functionName?: string,
    @Query('grain') grain?: string,
  ) {
    return this.intradayService.intraday(user.tenantId, {
      date,
      functionName: functionName?.trim() || undefined,
      grain: grain ? Number(grain) : undefined,
    });
  }

  /**
   * GET /v1/rta/alerts
   *
   * Live-ops alerts derived from REAL captured state only — no LLM, no invented
   * incidents. Three families:
   *   1. feed health   — Sprinklr snapshot age, queue-blind capture, blind agent
   *                      statuses, stale live-coverage overlay, stale roster;
   *   2. staffing gaps — the at-risk/critical intervals from /rta/intraday;
   *   3. attendance    — credible late logins / early logouts / missing system
   *                      sessions on the newest reconciled day.
   * Every alert carries {severity, type, text_en, text_ar, metric, source, asOf}.
   */
  @Get('alerts')
  @ApiOperation({ summary: 'Derived live-ops alerts (feed health, staffing gaps, attendance exceptions) — real data only' })
  async alerts(@CurrentUser() user: any) {
    return this.intradayService.alerts(user.tenantId);
  }
}
