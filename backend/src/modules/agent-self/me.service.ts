import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Self-service data for the logged-in employee only — never team-wide.
 * Every query is scoped to (tenantId, employeeId / employee_no).
 */
@Injectable()
export class MeService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getOverview(tenantId: string, employeeId: string | null) {
    if (!employeeId) {
      return { linked: false, shiftRate: null, adherence: null, score: null, schedule: [] };
    }

    const [shiftRate, adherence, score, schedule] = await Promise.all([
      this.shiftRate(tenantId, employeeId),
      this.adherence(tenantId, employeeId),
      this.score(tenantId, employeeId),
      this.upcomingSchedule(tenantId, employeeId),
    ]);

    return { linked: true, shiftRate, adherence, score, schedule };
  }

  /** YTD shift distribution by start-time category — the agent's own rotation balance. */
  private async shiftRate(tenantId: string, employeeId: string) {
    const [r] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker='present' AND EXTRACT(HOUR FROM scheduled_start) BETWEEN 5 AND 11)  AS morning,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND EXTRACT(HOUR FROM scheduled_start) BETWEEN 12 AND 16) AS evening,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND EXTRACT(HOUR FROM scheduled_start) BETWEEN 17 AND 21) AS night,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND (EXTRACT(HOUR FROM scheduled_start) >= 22 OR EXTRACT(HOUR FROM scheduled_start) < 5)) AS midnight,
         COUNT(*) FILTER (WHERE attendance_marker='present' AND scheduled_start IS NULL) AS unclassified,
         COUNT(*) FILTER (WHERE attendance_marker='off')                                 AS off_days,
         COUNT(*) FILTER (WHERE attendance_marker IN ('leave','sick','holiday'))          AS leave_days
       FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2
         AND attendance_date >= date_trunc('year', CURRENT_DATE)`,
      [tenantId, employeeId],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    const morning = n(r.morning), evening = n(r.evening), night = n(r.night), midnight = n(r.midnight);
    const working = morning + evening + night + midnight + n(r.unclassified);
    const pct = (v: number) => working ? Math.round(100 * v / working) : 0;
    return {
      working,
      morning, evening, night, midnight,
      morningPct: pct(morning), eveningPct: pct(evening), nightPct: pct(night), midnightPct: pct(midnight),
      offDays: n(r.off_days), leaveDays: n(r.leave_days),
    };
  }

  /** Adherence / conformance (التزام) — last 30 days, from the RTA adherence engine. */
  private async adherence(tenantId: string, employeeId: string) {
    const [agg] = await this.ds.query(
      `SELECT COUNT(*)                                  AS days,
              ROUND(AVG(adherence_pct)::numeric, 1)     AS avg_adherence,
              ROUND(AVG(conformance_pct)::numeric, 1)   AS avg_conformance
       FROM adherence_daily
       WHERE tenant_id = $1 AND employee_id = $2
         AND stat_date >= CURRENT_DATE - INTERVAL '30 days'`,
      [tenantId, employeeId],
    );
    const recent = await this.ds.query(
      `SELECT stat_date::text AS date, adherence_pct, conformance_pct, shift_code
       FROM adherence_daily
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY stat_date DESC LIMIT 7`,
      [tenantId, employeeId],
    );
    const f = (v: any) => v === null || v === undefined ? null : parseFloat(v);
    return {
      days: parseInt(agg?.days ?? '0', 10),
      avgAdherence: f(agg?.avg_adherence),
      avgConformance: f(agg?.avg_conformance),
      recent: recent.map((x: any) => ({
        date: x.date, adherence: f(x.adherence_pct), conformance: f(x.conformance_pct), shiftCode: x.shift_code,
      })),
    };
  }

  /** Latest scorecard result (Final week of most recent batch) for this employee. */
  private async score(tenantId: string, employeeId: string) {
    const [row] = await this.ds.query(
      `SELECT se.net_points, se.function_rank, se.function_name,
              se.quality_actual, se.aht_actual, se.fcr_actual,
              b.period_name, b.period_year, b.period_month
       FROM scorecard_entries se
       JOIN scorecard_batches b ON b.id = se.batch_id
       JOIN employees e ON e.employee_no = se.employee_no AND e.tenant_id = se.tenant_id
       WHERE se.tenant_id = $1 AND e.id = $2 AND se.week_label = 'Final'
       ORDER BY b.period_year DESC, b.period_month DESC
       LIMIT 1`,
      [tenantId, employeeId],
    );
    if (!row) return null;
    const f = (v: any) => v === null || v === undefined ? null : parseFloat(v);
    return {
      periodName: row.period_name,
      netPoints: row.net_points !== null ? parseInt(row.net_points, 10) : null,
      functionRank: row.function_rank !== null ? parseInt(row.function_rank, 10) : null,
      functionName: row.function_name,
      qualityPct: row.quality_actual !== null ? Math.round(f(row.quality_actual)! * 100) : null,
      fcrPct: row.fcr_actual !== null ? Math.round(f(row.fcr_actual)! * 100) : null,
    };
  }

  /** The agent's own shifts — recent + upcoming window (from attendance_records). */
  private async upcomingSchedule(tenantId: string, employeeId: string) {
    const rows = await this.ds.query(
      `SELECT ar.attendance_date::text AS date, ar.attendance_marker, ar.is_wfh,
              ar.scheduled_start, ar.scheduled_end, sc.code AS shift_code
       FROM attendance_records ar
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       WHERE ar.tenant_id = $1 AND ar.employee_id = $2
         AND ar.attendance_date >= CURRENT_DATE - INTERVAL '2 days'
       ORDER BY ar.attendance_date ASC
       LIMIT 14`,
      [tenantId, employeeId],
    );
    return rows.map((r: any) => ({
      date: r.date,
      marker: r.attendance_marker,
      isWfh: r.is_wfh,
      shiftCode: r.shift_code,
      start: r.scheduled_start ? String(r.scheduled_start).slice(0, 5) : null,
      end: r.scheduled_end ? String(r.scheduled_end).slice(0, 5) : null,
    }));
  }

  // ── Attendance detail: the agent's own punch/system/late/early-out/OT ──────
  // Per FINAL access model: every employee sees their own attendance detail
  // (punch in/out, system open/close, late, early-out, permissions, leave balance).

  async getAttendanceDetail(tenantId: string, employeeId: string | null) {
    if (!employeeId) {
      return { linked: false, monthly: null, ytd: null, recent: [], permissions: null, leaveBalance: [], ops: null };
    }
    const [monthly, ytd, recent, permissions, leaveBalance, ops] = await Promise.all([
      this.attendanceSummary(tenantId, employeeId, "date_trunc('month', CURRENT_DATE)"),
      this.attendanceSummary(tenantId, employeeId, "date_trunc('year', CURRENT_DATE)"),
      this.attendanceRecentDays(tenantId, employeeId),
      this.permissions(tenantId, employeeId),
      this.leaveBalance(tenantId, employeeId),
      this.opsSelf(tenantId, employeeId),
    ]);
    return { linked: true, monthly, ytd, recent, permissions, leaveBalance, ops };
  }

  /** Aggregated attendance counters since `sinceExpr` (month/year), own data only. */
  private async attendanceSummary(tenantId: string, employeeId: string, sinceExpr: string) {
    const [r] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker='present')                      AS working_days,
         COUNT(*) FILTER (WHERE attendance_marker='off')                          AS off_days,
         COUNT(*) FILTER (WHERE attendance_marker='leave')                        AS leave_days,
         COUNT(*) FILTER (WHERE attendance_marker='sick')                         AS sick_days,
         COUNT(*) FILTER (WHERE attendance_marker='holiday')                      AS holiday_days,
         COUNT(*) FILTER (WHERE attendance_marker='absent')                       AS absent_days,
         COUNT(*) FILTER (WHERE is_wfh)                                           AS wfh_days,
         COUNT(*) FILTER (WHERE COALESCE(punch_late_minutes,0)   > 0)             AS punch_late_count,
         COALESCE(SUM(punch_late_minutes), 0)                                     AS punch_late_minutes,
         COUNT(*) FILTER (WHERE COALESCE(system_late_minutes,0)  > 0)             AS system_late_count,
         COALESCE(SUM(system_late_minutes), 0)                                    AS system_late_minutes,
         COUNT(*) FILTER (WHERE COALESCE(punch_early_out_minutes,0)  > 0)         AS punch_early_count,
         COALESCE(SUM(punch_early_out_minutes), 0)                                AS punch_early_minutes,
         COUNT(*) FILTER (WHERE COALESCE(system_early_out_minutes,0) > 0)         AS system_early_count,
         COALESCE(SUM(system_early_out_minutes), 0)                               AS system_early_minutes,
         COUNT(*) FILTER (WHERE is_missing_punch)                                 AS missing_punch,
         COUNT(*) FILTER (WHERE is_missing_system)                                AS missing_system,
         COUNT(*) FILTER (WHERE COALESCE(ot_minutes,0) > 0)                       AS ot_count,
         COALESCE(SUM(ot_minutes), 0)                                             AS ot_minutes,
         -- Tardiness vs authorized permission: a late-in / early-out is TARDY only
         -- when NOT covered by an approved permission of the matching type that day.
         COUNT(*) FILTER (WHERE COALESCE(punch_late_minutes,0) > 0 AND NOT perm.perm_late)         AS tardy_late_count,
         COALESCE(SUM(punch_late_minutes) FILTER (WHERE NOT perm.perm_late), 0)                    AS tardy_late_minutes,
         COUNT(*) FILTER (WHERE COALESCE(punch_late_minutes,0) > 0 AND perm.perm_late)             AS permitted_late_count,
         COUNT(*) FILTER (WHERE (COALESCE(punch_early_out_minutes,0) > 0 OR COALESCE(system_early_out_minutes,0) > 0) AND NOT perm.perm_early) AS tardy_early_count,
         COALESCE(SUM(GREATEST(COALESCE(punch_early_out_minutes,0), COALESCE(system_early_out_minutes,0))) FILTER (WHERE NOT perm.perm_early), 0) AS tardy_early_minutes,
         COUNT(*) FILTER (WHERE (COALESCE(punch_early_out_minutes,0) > 0 OR COALESCE(system_early_out_minutes,0) > 0) AND perm.perm_early)        AS permitted_early_count,
         -- Conforming day = present with NO unauthorized tardiness → conformance score.
         COUNT(*) FILTER (WHERE attendance_marker='present'
                            AND NOT (COALESCE(punch_late_minutes,0) > 0 AND NOT perm.perm_late)
                            AND NOT ((COALESCE(punch_early_out_minutes,0) > 0 OR COALESCE(system_early_out_minutes,0) > 0) AND NOT perm.perm_early)) AS conforming_days
       FROM attendance_records ar
       LEFT JOIN LATERAL (
         SELECT COALESCE(bool_or(rp.permission_type = 'late_in'), FALSE)   AS perm_late,
                COALESCE(bool_or(rp.permission_type IN ('early_out','temp_out')), FALSE) AS perm_early
           FROM request_permissions rp
           JOIN requests rq ON rq.id = rp.request_id
          WHERE rq.tenant_id = ar.tenant_id AND rq.employee_id = ar.employee_id
            AND rq.status = 'approved' AND rp.permission_date = ar.attendance_date
       ) perm ON TRUE
       WHERE ar.tenant_id = $1 AND ar.employee_id = $2
         AND ar.attendance_date >= ${sinceExpr}`,
      [tenantId, employeeId],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    return {
      workingDays: n(r.working_days), offDays: n(r.off_days), leaveDays: n(r.leave_days),
      sickDays: n(r.sick_days), holidayDays: n(r.holiday_days), absentDays: n(r.absent_days),
      wfhDays: n(r.wfh_days),
      punchLateCount: n(r.punch_late_count), punchLateMinutes: n(r.punch_late_minutes),
      systemLateCount: n(r.system_late_count), systemLateMinutes: n(r.system_late_minutes),
      punchEarlyCount: n(r.punch_early_count), punchEarlyMinutes: n(r.punch_early_minutes),
      systemEarlyCount: n(r.system_early_count), systemEarlyMinutes: n(r.system_early_minutes),
      missingPunch: n(r.missing_punch), missingSystem: n(r.missing_system),
      otCount: n(r.ot_count), otMinutes: n(r.ot_minutes),
      // Tardiness (unauthorized) vs authorized-by-permission
      tardyLateCount: n(r.tardy_late_count), tardyLateMinutes: n(r.tardy_late_minutes),
      permittedLateCount: n(r.permitted_late_count),
      tardyEarlyCount: n(r.tardy_early_count), tardyEarlyMinutes: n(r.tardy_early_minutes),
      permittedEarlyCount: n(r.permitted_early_count),
      conformingDays: n(r.conforming_days),
      // Conformance score = conforming present-days ÷ present-days (×100).
      conformancePct: n(r.working_days) ? Math.round((n(r.conforming_days) / n(r.working_days)) * 1000) / 10 : null,
    };
  }

  /** Day-by-day detail for the last 31 days — exact punch & system timestamps. */
  private async attendanceRecentDays(tenantId: string, employeeId: string) {
    const rows = await this.ds.query(
      `SELECT ar.attendance_date::text AS date, ar.attendance_marker, ar.is_wfh,
              sc.code AS shift_code,
              ar.scheduled_start, ar.scheduled_end,
              ar.punch_in, ar.punch_out, ar.system_login, ar.system_logout,
              ar.punch_late_minutes, ar.system_late_minutes,
              ar.punch_early_out_minutes, ar.system_early_out_minutes,
              ar.ot_minutes, ar.is_missing_punch, ar.is_missing_system, ar.absence_reason,
              COALESCE(perm.perm_late, FALSE)  AS perm_late,
              COALESCE(perm.perm_early, FALSE) AS perm_early
       FROM attendance_records ar
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       LEFT JOIN LATERAL (
         SELECT bool_or(rp.permission_type = 'late_in')   AS perm_late,
                bool_or(rp.permission_type IN ('early_out','temp_out')) AS perm_early
           FROM request_permissions rp
           JOIN requests rq ON rq.id = rp.request_id
          WHERE rq.tenant_id = ar.tenant_id AND rq.employee_id = ar.employee_id
            AND rq.status = 'approved' AND rp.permission_date = ar.attendance_date
       ) perm ON TRUE
       WHERE ar.tenant_id = $1 AND ar.employee_id = $2
         AND ar.attendance_date >= CURRENT_DATE - INTERVAL '31 days'
         AND ar.attendance_date <= CURRENT_DATE
       ORDER BY ar.attendance_date DESC`,
      [tenantId, employeeId],
    );
    const hm = (v: any) => (v ? String(v).slice(0, 5) : null);
    const n = (v: any) => (v === null || v === undefined ? 0 : parseInt(v, 10));
    return rows.map((r: any) => {
      const lateMin  = n(r.punch_late_minutes);
      const earlyMin = Math.max(n(r.punch_early_out_minutes), n(r.system_early_out_minutes));
      return {
        date: r.date,
        marker: r.attendance_marker,
        isWfh: r.is_wfh,
        shiftCode: r.shift_code,
        scheduledStart: hm(r.scheduled_start), scheduledEnd: hm(r.scheduled_end),
        punchIn: hm(r.punch_in), punchOut: hm(r.punch_out),
        systemLogin: hm(r.system_login), systemLogout: hm(r.system_logout),
        punchLate: lateMin, systemLate: n(r.system_late_minutes),
        punchEarlyOut: n(r.punch_early_out_minutes), systemEarlyOut: n(r.system_early_out_minutes),
        ot: n(r.ot_minutes),
        missingPunch: r.is_missing_punch, missingSystem: r.is_missing_system,
        absenceReason: r.absence_reason,
        // Authorized by an approved permission that day, or an unauthorized tardiness?
        latePermitted:  r.perm_late,
        earlyPermitted: r.perm_early,
        lateIsTardy:  lateMin  > 0 && !r.perm_late,
        earlyIsTardy: earlyMin > 0 && !r.perm_early,
      };
    });
  }

  /** The agent's own permission/early-leave requests this year, with type + status. */
  private async permissions(tenantId: string, employeeId: string) {
    const rows = await this.ds.query(
      `SELECT rt.code AS type_code, rt.name AS type_name, rt.name_ar AS type_name_ar,
              r.status, r.submitted_at::text AS submitted_at, r.is_urgent,
              r.approved_l1_at, r.approved_l2_at, r.rejected_at
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1 AND r.employee_id = $2
         AND rt.code IN ('permission','break','break_request')
         AND r.submitted_at >= date_trunc('year', CURRENT_DATE)
       ORDER BY r.submitted_at DESC
       LIMIT 50`,
      [tenantId, employeeId],
    );
    const total = rows.length;
    const approved = rows.filter((r: any) => r.status === 'approved').length;
    const pending = rows.filter((r: any) => ['pending', 'submitted', 'in_review'].includes(r.status)).length;
    return {
      total, approved, pending,
      items: rows.map((r: any) => ({
        type: r.type_code, typeName: r.type_name, typeNameAr: r.type_name_ar,
        status: r.status, submittedAt: r.submitted_at, isUrgent: r.is_urgent,
      })),
    };
  }

  /** Leave balance per type: entitlement (from leave_balances) − taken − pending. */
  private async leaveBalance(tenantId: string, employeeId: string) {
    // Entitlement for the current calendar year.
    const ent = await this.ds.query(
      `SELECT leave_type, entitlement_days
       FROM leave_balances
       WHERE tenant_id = $1 AND employee_id = $2
         AND calendar_year = EXTRACT(YEAR FROM CURRENT_DATE)`,
      [tenantId, employeeId],
    );
    // Taken (approved leave/sick requests) this year, grouped by request type.
    const taken = await this.ds.query(
      `SELECT rt.code AS type_code,
              COUNT(*) FILTER (WHERE r.status='approved')                                  AS taken,
              COUNT(*) FILTER (WHERE r.status IN ('pending','submitted','in_review'))       AS pending
       FROM requests r
       JOIN request_types rt ON rt.id = r.request_type_id
       WHERE r.tenant_id = $1 AND r.employee_id = $2
         AND rt.code IN ('annual_leave','sick_leave','emergency_leave','death_leave','comp_off')
         AND r.submitted_at >= date_trunc('year', CURRENT_DATE)
       GROUP BY rt.code`,
      [tenantId, employeeId],
    );
    const takenMap = new Map<string, { taken: number; pending: number }>();
    for (const t of taken) takenMap.set(t.type_code, { taken: parseInt(t.taken, 10), pending: parseInt(t.pending, 10) });
    // Map leave_balances.leave_type → request type code where they differ.
    const alias: Record<string, string> = { annual: 'annual_leave', sick: 'sick_leave' };
    const fromEnt = ent.map((e: any) => {
      const key = alias[e.leave_type] ?? e.leave_type;
      const used = takenMap.get(key) ?? { taken: 0, pending: 0 };
      const entitlement = parseFloat(e.entitlement_days);
      return {
        leaveType: e.leave_type, entitlement,
        taken: used.taken, pending: used.pending,
        remaining: Math.max(0, entitlement - used.taken - used.pending),
      };
    });
    return fromEnt;
  }

  /**
   * Own operational stats from imported Sprinklr/CRM contacts (matched by name).
   * Telephony AHT/ACW/hold/idle come from Ameyo, which is still discovery-phase
   * (no per-agent talk/ACW data ingested yet) — surfaced honestly as pending,
   * never fabricated.
   */
  private async opsSelf(tenantId: string, employeeId: string) {
    const [emp] = await this.ds.query(
      `SELECT first_name_en, last_name_en FROM employees WHERE tenant_id=$1 AND id=$2`,
      [tenantId, employeeId],
    );
    let contacts = 0, surveys = 0, positive = 0, negative = 0, activeDays = 0;
    if (emp) {
      const fullName = `${emp.first_name_en ?? ''} ${emp.last_name_en ?? ''}`.trim();
      if (fullName) {
        const [r] = await this.ds.query(
          `SELECT COUNT(*)                                            AS contacts,
                  COUNT(DISTINCT contact_date)                        AS active_days,
                  COUNT(*) FILTER (WHERE survey_sent)                 AS surveys,
                  COUNT(*) FILTER (WHERE rating_sentiment='positive') AS positive,
                  COUNT(*) FILTER (WHERE rating_sentiment='negative') AS negative
           FROM ops_contacts
           WHERE tenant_id = $1 AND LOWER(TRIM(agent_name)) = LOWER($2)
             AND contact_date >= date_trunc('month', CURRENT_DATE)`,
          [tenantId, fullName],
        );
        contacts = parseInt(r?.contacts ?? '0', 10);
        activeDays = parseInt(r?.active_days ?? '0', 10);
        surveys = parseInt(r?.surveys ?? '0', 10);
        positive = parseInt(r?.positive ?? '0', 10);
        negative = parseInt(r?.negative ?? '0', 10);
      }
    }
    return {
      hasContactData: contacts > 0,
      contacts, activeDays, surveys, positive, negative,
      // Honest: these are sourced from telephony (Ameyo), not yet ingested per-agent.
      telephony: { available: false, note: 'AHT / ACW / Hold / Idle require Ameyo per-agent data (integration in progress)' },
    };
  }
}
