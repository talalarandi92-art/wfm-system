import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Deep workforce analytics over attendance_records.
 * Weekend = Thursday(DOW 4) + Friday(5) + Saturday(6) — Boutiqaat work week.
 * (Thu/Fri are the standard weekend; Sat is included because it is in heavy
 *  OFF demand. Must stay in sync with generator.service isWeekend / the OFF
 *  distribution's WEEKEND_DAY_INDICES.)
 * Shrinkage model:
 *   scheduled-to-work day = marker in (present, absent, sick, leave, holiday)  [excludes 'off' rest days]
 *   planned shrinkage     = leave + holiday        (known in advance)
 *   unplanned shrinkage   = absent + sick          (not planned)
 *   late shrinkage        = late minutes / scheduled minutes
 */
@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async range(tenantId: string, from?: string, to?: string) {
    const [r] = await this.ds.query(
      `SELECT MAX(attendance_date) AS latest FROM attendance_records WHERE tenant_id=$1`, [tenantId],
    );
    const latest = (r.latest instanceof Date ? r.latest.toISOString() : (r.latest ?? new Date().toISOString())).slice(0, 10);
    return { from: from ?? latest.slice(0, 7) + '-01', to: to ?? latest };
  }

  /**
   * Optional function (department) filter. Every analytics query parameterises
   * $1=tenant, $2=from, $3=to, so the function id is always $4 when present.
   * `clause(alias)` restricts an attendance-row alias to that function's
   * employees; `params` is spread into the query's parameter array.
   */
  private fnFilter(functionId?: string): { clause: (alias: string) => string; params: string[] } {
    if (!functionId) return { clause: () => '', params: [] };
    return {
      clause: (alias) => ` AND EXISTS (SELECT 1 FROM employees _fe WHERE _fe.id = ${alias}.employee_id AND _fe.function_id = $4)`,
      params: [functionId],
    };
  }

  /** Function list for the analytics filter dropdown. */
  async functions(tenantId: string) {
    return this.ds.query(
      `SELECT id, name FROM functions WHERE tenant_id=$1 ORDER BY name`,
      [tenantId],
    ).catch(() => []);
  }

  /* ── 1. Per-shift breakdown — everything that happened on each shift window ── */
  async shiftBreakdown(tenantId: string, from?: string, to?: string, functionId?: string) {
    const { from: f, to: t } = await this.range(tenantId, from, to);
    const ff = this.fnFilter(functionId);
    const rows = await this.ds.query(
      `WITH att AS (
         SELECT ar.*, sc.code AS shift_code, EXTRACT(EPOCH FROM (
                  CASE WHEN ar.scheduled_end < ar.scheduled_start
                       THEN ar.scheduled_end + INTERVAL '1 day' ELSE ar.scheduled_end END - ar.scheduled_start)) / 3600.0 AS shift_hours
         FROM attendance_records ar
         LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id AND sc.tenant_id = ar.tenant_id
         WHERE ar.tenant_id=$1 AND ar.attendance_date BETWEEN $2 AND $3 AND ar.scheduled_start IS NOT NULL${ff.clause('ar')}
       )
       SELECT to_char(scheduled_start,'HH24:MI') AS start, to_char(scheduled_end,'HH24:MI') AS "end",
              string_agg(DISTINCT shift_code, '/' ORDER BY shift_code) AS code,
              ROUND(AVG(shift_hours)::numeric,1) AS shift_hours,
              COUNT(*) AS scheduled,
              COUNT(*) FILTER (WHERE attendance_marker='present')                       AS present,
              COUNT(*) FILTER (WHERE attendance_marker='absent')                        AS absent,
              COUNT(*) FILTER (WHERE attendance_marker='sick')                          AS sick,
              COUNT(*) FILTER (WHERE attendance_marker='leave')                         AS leave,
              COUNT(*) FILTER (WHERE attendance_marker='holiday')                       AS holiday,
              COUNT(*) FILTER (WHERE attendance_marker='off')                           AS off_days,
              COUNT(*) FILTER (WHERE is_wfh AND attendance_marker='present')            AS wfh,
              COUNT(*) FILTER (WHERE ot_minutes>0)                                      AS ot_count,
              COALESCE(SUM(ot_minutes),0)                                               AS ot_minutes,
              COUNT(*) FILTER (WHERE punch_late_minutes>0)                              AS late_count,
              COALESCE(SUM(punch_late_minutes),0)                                       AS late_minutes,
              COUNT(*) FILTER (WHERE is_missing_punch AND attendance_marker='present')  AS missing_punch
       FROM att
       GROUP BY scheduled_start, scheduled_end
       ORDER BY scheduled_start`,
      [tenantId, f, t, ...ff.params],
    );

    // Permissions (استئذان) by shift window — join approved permission requests on employee+date
    const perms = await this.ds.query(
      `SELECT to_char(ar.scheduled_start,'HH24:MI') AS start, to_char(ar.scheduled_end,'HH24:MI') AS "end",
              COUNT(*) AS permissions
       FROM requests r
       JOIN request_types rt ON rt.id=r.request_type_id AND rt.code='permission'
       JOIN attendance_records ar ON ar.employee_id=r.employee_id
            AND ar.attendance_date = r.submitted_at::date AND ar.tenant_id=r.tenant_id
       WHERE r.tenant_id=$1 AND r.submitted_at::date BETWEEN $2 AND $3 AND ar.scheduled_start IS NOT NULL${ff.clause('ar')}
       GROUP BY ar.scheduled_start, ar.scheduled_end`,
      [tenantId, f, t, ...ff.params],
    ).catch(() => []);
    const permMap: Record<string, number> = {};
    for (const p of perms) permMap[`${p.start}-${p.end}`] = parseInt(p.permissions, 10);

    // Breaks per shift window — join break_slots to that day's attendance shift
    const breaks = await this.ds.query(
      `SELECT to_char(ar.scheduled_start,'HH24:MI') AS start, to_char(ar.scheduled_end,'HH24:MI') AS "end",
              COUNT(*) AS breaks,
              COALESCE(SUM(EXTRACT(EPOCH FROM (bs.planned_end - bs.planned_start)) / 60.0), 0) AS break_minutes,
              COUNT(*) FILTER (WHERE bs.is_missed) AS missed_breaks
       FROM break_slots bs
       JOIN attendance_records ar ON ar.employee_id = bs.employee_id
            AND ar.attendance_date = bs.schedule_date AND ar.tenant_id = bs.tenant_id
       WHERE bs.tenant_id=$1 AND bs.schedule_date BETWEEN $2 AND $3 AND ar.scheduled_start IS NOT NULL${ff.clause('ar')}
       GROUP BY ar.scheduled_start, ar.scheduled_end`,
      [tenantId, f, t, ...ff.params],
    ).catch(() => []);
    const breakMap: Record<string, { breaks: number; minutes: number; missed: number }> = {};
    for (const b of breaks) breakMap[`${b.start}-${b.end}`] = { breaks: parseInt(b.breaks, 10), minutes: Math.round(parseFloat(b.break_minutes)), missed: parseInt(b.missed_breaks, 10) };

    const n = (v: any) => parseInt(v ?? '0', 10);
    return {
      period: { from: f, to: t },
      shifts: rows.map((r: any) => {
        const scheduledToWork = n(r.present) + n(r.absent) + n(r.sick) + n(r.leave) + n(r.holiday);
        const present = n(r.present);
        const planned = n(r.leave) + n(r.holiday);     // known in advance
        const unplanned = n(r.absent) + n(r.sick);      // not planned
        return {
          window: `${r.start}–${r.end}`,
          code: r.code ?? '—',
          start: r.start, end: r.end,
          shiftHours: parseFloat(r.shift_hours),
          scheduled: n(r.scheduled),
          present, absent: n(r.absent), sick: n(r.sick), leave: n(r.leave),
          holiday: n(r.holiday), off: n(r.off_days), wfh: n(r.wfh),
          otCount: n(r.ot_count), otHours: Math.round(n(r.ot_minutes) / 6) / 10,
          lateCount: n(r.late_count), lateMinutes: n(r.late_minutes),
          missingPunch: n(r.missing_punch),
          permissions: permMap[`${r.start}-${r.end}`] ?? 0,
          breaks: breakMap[`${r.start}-${r.end}`]?.breaks ?? 0,
          breakMinutes: breakMap[`${r.start}-${r.end}`]?.minutes ?? 0,
          missedBreaks: breakMap[`${r.start}-${r.end}`]?.missed ?? 0,
          plannedShrinkage: planned,
          unplannedShrinkage: unplanned,
          plannedShrinkagePct: scheduledToWork ? Math.round(100 * planned / scheduledToWork) : 0,
          unplannedShrinkagePct: scheduledToWork ? Math.round(100 * unplanned / scheduledToWork) : 0,
          attendanceRate: scheduledToWork ? Math.round(100 * present / scheduledToWork) : null,
          shrinkagePct: scheduledToWork ? Math.round(100 * (planned + unplanned) / scheduledToWork) : 0,
        };
      }),
    };
  }

  /* ── 2. Shrinkage — planned vs unplanned, overall + weekend split ──────────── */
  async shrinkage(tenantId: string, from?: string, to?: string, functionId?: string) {
    const { from: f, to: t } = await this.range(tenantId, from, to);
    const ff = this.fnFilter(functionId);
    const compute = (extraWhere: string) => this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE attendance_marker IN ('present','absent','sick','leave','holiday')) AS scheduled,
         COUNT(*) FILTER (WHERE attendance_marker='leave')   AS leave,
         COUNT(*) FILTER (WHERE attendance_marker='holiday') AS holiday,
         COUNT(*) FILTER (WHERE attendance_marker='absent')  AS absent,
         COUNT(*) FILTER (WHERE attendance_marker='sick')    AS sick,
         COALESCE(SUM(punch_late_minutes) FILTER (WHERE punch_late_minutes>0),0) AS late_minutes,
         COUNT(*) FILTER (WHERE attendance_marker='present') AS present
       FROM attendance_records
       WHERE tenant_id=$1 AND attendance_date BETWEEN $2 AND $3 ${extraWhere}${ff.clause('attendance_records')}`,
      [tenantId, f, t, ...ff.params],
    );
    const pack = (row: any) => {
      const n = (v: any) => parseInt(v ?? '0', 10);
      const scheduled = n(row.scheduled) || 1;
      const planned = n(row.leave) + n(row.holiday);
      const unplanned = n(row.absent) + n(row.sick);
      const lateDays = n(row.late_minutes) / (9 * 60); // late minutes → equiv days (9h shift)
      return {
        scheduledDays: n(row.scheduled),
        plannedPct:   Math.round(1000 * planned / scheduled) / 10,
        unplannedPct: Math.round(1000 * unplanned / scheduled) / 10,
        latePct:      Math.min(100, Math.round(1000 * lateDays / scheduled) / 10),
        totalPct:     Math.min(100, Math.round(1000 * (planned + unplanned + lateDays) / scheduled) / 10),
        breakdown: { leave: n(row.leave), holiday: n(row.holiday), absent: n(row.absent), sick: n(row.sick), lateMinutes: n(row.late_minutes) },
      };
    };
    const [overall] = await compute('');
    const [weekend] = await compute(`AND EXTRACT(DOW FROM attendance_date) IN (4,5,6)`);
    const [weekday] = await compute(`AND EXTRACT(DOW FROM attendance_date) NOT IN (4,5,6)`);
    return { period: { from: f, to: t }, overall: pack(overall), weekend: pack(weekend), weekday: pack(weekday) };
  }

  /* ── 2b. Shrinkage trend — bucketed by ISO week and by month ───────────────── */
  async shrinkageTrend(tenantId: string, from?: string, to?: string, functionId?: string) {
    const { from: f, to: t } = await this.range(tenantId, from, to);
    const ff = this.fnFilter(functionId);
    const bucket = (expr: string) => this.ds.query(
      `SELECT ${expr} AS bucket,
              MIN(attendance_date) AS first_day,
              COUNT(*) FILTER (WHERE attendance_marker IN ('present','absent','sick','leave','holiday')) AS scheduled,
              COUNT(*) FILTER (WHERE attendance_marker IN ('leave','holiday'))  AS planned,
              COUNT(*) FILTER (WHERE attendance_marker IN ('absent','sick'))    AS unplanned
       FROM attendance_records
       WHERE tenant_id=$1 AND attendance_date BETWEEN $2 AND $3${ff.clause('attendance_records')}
       GROUP BY bucket ORDER BY MIN(attendance_date)`,
      [tenantId, f, t, ...ff.params],
    );
    const pack = (rows: any[]) => rows.map((r: any) => {
      const sched = parseInt(r.scheduled, 10) || 1;
      const planned = parseInt(r.planned, 10), unplanned = parseInt(r.unplanned, 10);
      return {
        bucket: r.bucket,
        firstDay: r.first_day instanceof Date ? r.first_day.toISOString().slice(0, 10) : r.first_day,
        scheduled: parseInt(r.scheduled, 10),
        plannedPct: Math.round(1000 * planned / sched) / 10,
        unplannedPct: Math.round(1000 * unplanned / sched) / 10,
        totalPct: Math.round(1000 * (planned + unplanned) / sched) / 10,
      };
    });
    const [weekly, monthly] = await Promise.all([
      bucket(`TO_CHAR(attendance_date, 'IYYY-"W"IW')`),
      bucket(`TO_CHAR(attendance_date, 'YYYY-MM')`),
    ]);
    return { period: { from: f, to: t }, weekly: pack(weekly), monthly: pack(monthly) };
  }

  /* ── 3. Weekend-off fairness — per employee, % of weekends they got off ────── */
  async weekendFairness(tenantId: string, from?: string, to?: string, functionId?: string) {
    const { from: f, to: t } = await this.range(tenantId, from, to);
    const ff = this.fnFilter(functionId);
    const rows = await this.ds.query(
      `SELECT e.id, e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS name,
              f.name AS function_name,
              COUNT(*) FILTER (WHERE EXTRACT(DOW FROM ar.attendance_date) IN (4,5,6))                              AS weekend_days,
              COUNT(*) FILTER (WHERE EXTRACT(DOW FROM ar.attendance_date) IN (4,5,6) AND ar.attendance_marker='off') AS weekend_off,
              COUNT(*) FILTER (WHERE ar.attendance_marker='off')                                                  AS total_off
       FROM employees e
       JOIN attendance_records ar ON ar.employee_id=e.id AND ar.tenant_id=e.tenant_id AND ar.attendance_date BETWEEN $2 AND $3
       LEFT JOIN functions f ON f.id=e.function_id
       WHERE e.tenant_id=$1 AND e.status='active'${ff.clause('ar')}
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name
       HAVING COUNT(*) FILTER (WHERE EXTRACT(DOW FROM ar.attendance_date) IN (4,5,6)) > 0
       ORDER BY (COUNT(*) FILTER (WHERE EXTRACT(DOW FROM ar.attendance_date) IN (4,5,6) AND ar.attendance_marker='off'))::float
              / NULLIF(COUNT(*) FILTER (WHERE EXTRACT(DOW FROM ar.attendance_date) IN (4,5,6)),0) DESC`,
      [tenantId, f, t, ...ff.params],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    return {
      period: { from: f, to: t },
      employees: rows.map((r: any) => ({
        id: r.id, employeeNo: r.employee_no, name: r.name.trim(), functionName: r.function_name,
        weekendDays: n(r.weekend_days), weekendOff: n(r.weekend_off), totalOff: n(r.total_off),
        // % of weekend days (Thu/Fri/Sat) the employee got off — fairness of weekend rest
        weekendOffPct: n(r.weekend_days) ? Math.round(100 * n(r.weekend_off) / n(r.weekend_days)) : 0,
        // of ALL the employee's OFF days, the share that landed on a weekend
        weekendOffShare: n(r.total_off) ? Math.round(100 * n(r.weekend_off) / n(r.total_off)) : 0,
      })),
    };
  }

  /* ── 4. Sick pattern — weekend vs weekday sick days per employee ───────────── */
  async sickPattern(tenantId: string, from?: string, to?: string, functionId?: string) {
    const { from: f, to: t } = await this.range(tenantId, from, to);
    const ff = this.fnFilter(functionId);
    const rows = await this.ds.query(
      `SELECT e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS name, f.name AS function_name,
              COUNT(*) FILTER (WHERE ar.attendance_marker='sick')                                                 AS total_sick,
              COUNT(*) FILTER (WHERE ar.attendance_marker='sick' AND EXTRACT(DOW FROM ar.attendance_date) IN (4,5,6)) AS weekend_sick,
              COUNT(*) FILTER (WHERE ar.attendance_marker='sick' AND EXTRACT(DOW FROM ar.attendance_date) NOT IN (4,5,6)) AS weekday_sick
       FROM employees e
       JOIN attendance_records ar ON ar.employee_id=e.id AND ar.tenant_id=e.tenant_id AND ar.attendance_date BETWEEN $2 AND $3
       LEFT JOIN functions f ON f.id=e.function_id
       WHERE e.tenant_id=$1 AND e.status='active'${ff.clause('ar')}
       GROUP BY e.employee_no, e.first_name_en, e.last_name_en, f.name
       HAVING COUNT(*) FILTER (WHERE ar.attendance_marker='sick') > 0
       ORDER BY weekend_sick DESC, total_sick DESC`,
      [tenantId, f, t, ...ff.params],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    return {
      period: { from: f, to: t },
      employees: rows.map((r: any) => ({
        employeeNo: r.employee_no, name: r.name.trim(), functionName: r.function_name,
        totalSick: n(r.total_sick), weekendSick: n(r.weekend_sick), weekdaySick: n(r.weekday_sick),
        weekendSickPct: n(r.total_sick) ? Math.round(100 * n(r.weekend_sick) / n(r.total_sick)) : 0,
      })),
    };
  }

  /* ── Coverage forecast — predict present HC per hour for an upcoming horizon ──
     Method: for each (day-of-week, hour) compute the historical average present
     headcount over the lookback window, then project it onto the next `horizon` days. */
  async coverageForecast(tenantId: string, lookbackWeeks = 8, horizonDays = 7) {
    const lookbackDays = lookbackWeeks * 7;
    // Historical avg present HC by DOW × hour (shift window covers the hour, cross-midnight aware)
    const rows = await this.ds.query(
      `WITH hours AS (SELECT generate_series(0,23) AS h),
       att AS (
         SELECT attendance_date,
                EXTRACT(DOW FROM attendance_date)::int AS dow,
                EXTRACT(HOUR FROM scheduled_start)::int AS sh,
                EXTRACT(HOUR FROM scheduled_end)::int   AS eh,
                attendance_marker
         FROM attendance_records
         WHERE tenant_id=$1 AND scheduled_start IS NOT NULL
           AND attendance_date >= CURRENT_DATE - ($2 || ' days')::interval
       )
       SELECT att.dow, h.h AS hour,
              COUNT(DISTINCT att.attendance_date) AS days_seen,
              COUNT(*) FILTER (WHERE att.attendance_marker='present' AND (
                (att.sh < att.eh AND h.h >= att.sh AND h.h < att.eh) OR
                (att.sh >= att.eh AND (h.h >= att.sh OR h.h < att.eh))
              )) AS present
       FROM hours h CROSS JOIN att
       GROUP BY att.dow, h.h`,
      [tenantId, lookbackDays],
    );
    // avg present per dow+hour
    const avg: Record<string, number> = {};
    for (const r of rows) {
      const daysSeen = Math.max(1, parseInt(r.days_seen, 10));
      avg[`${r.dow}-${r.hour}`] = parseInt(r.present, 10) / daysSeen;
    }

    const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const forecast: any[] = [];
    for (let d = 0; d < horizonDays; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d + 1);              // start tomorrow
      const dow = date.getDay();
      const hours: { hour: number; forecastHc: number }[] = [];
      for (let h = 0; h < 24; h++) {
        const v = avg[`${dow}-${h}`] ?? 0;
        hours.push({ hour: h, forecastHc: Math.round(v * 10) / 10 });
      }
      forecast.push({
        date: date.toISOString().slice(0, 10),
        dow, dayName: dayNamesEn[dow], dayNameAr: dayNamesAr[dow],
        peakHc: Math.max(0, ...hours.map(x => x.forecastHc)),
        hours,
      });
    }
    return { lookbackWeeks, horizonDays, generatedAt: new Date().toISOString(), forecast };
  }

  /* ── Notify RTA of under-covered hours (threshold = % shrinkage) ───────────── */
  async notifyGaps(tenantId: string, from?: string, to?: string, threshold = 10) {
    const cov = await this.hourlyHeadcount(tenantId, from, to);
    const gaps = cov.hours.filter(h => h.shrinkagePct > threshold && h.scheduledTotal > 0);
    if (!gaps.length) return { gaps: 0, notified: 0, hours: [] };

    const rtaUsers = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id=$1 AND r.code IN ('rta','wfm_analyst','platform_admin')`,
      [tenantId],
    ).catch(() => []);

    const summary = gaps.map(g => `${g.hour}:00 (${g.shrinkagePct}%)`).join('، ');
    let notified = 0;
    for (const u of rtaUsers) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, body, entity_type, entity_id)
         VALUES ($1,$2,'coverage.gap', $3, $4, 'coverage', NULL)`,
        [tenantId, u.id,
         `⚠️ فجوات تغطية: ${gaps.length} ساعة`,
         `ساعات تحتاج تغطية (${cov.period.from} → ${cov.period.to}): ${summary}. راجع تحليلات القوى العاملة لتكليف ايجنت.`],
      ).catch(() => {});
      notified++;
    }
    return { gaps: gaps.length, notified, hours: gaps.map(g => ({ hour: g.hour, shrinkagePct: g.shrinkagePct })) };
  }

  /* ── 5. Hourly headcount coverage — scheduled & present per hour of day ────── */
  async hourlyHeadcount(tenantId: string, from?: string, to?: string, functionId?: string) {
    const { from: f, to: t } = await this.range(tenantId, from, to);
    const ff = this.fnFilter(functionId);
    // For each hour 0-23, count attendance rows whose shift window covers that hour
    // (handles cross-midnight). Averaged across the days in range.
    // Per-hour cascade: scheduled roster → −permission → −sick → +overtime.
    // covers(sh,eh,h) is the cross-midnight shift-window test.
    const rows = await this.ds.query(
      `WITH hours AS (SELECT generate_series(0,23) AS h),
       att AS (
         SELECT employee_id, attendance_date,
                EXTRACT(HOUR FROM scheduled_start)::int AS sh,
                EXTRACT(HOUR FROM scheduled_end)::int   AS eh,
                (EXTRACT(HOUR FROM scheduled_end)::int + CEIL(ot_minutes/60.0)::int) AS ot_eh,
                ot_minutes, attendance_marker AS marker
         FROM attendance_records
         WHERE tenant_id=$1 AND attendance_date BETWEEN $2 AND $3 AND scheduled_start IS NOT NULL${ff.clause('attendance_records')}
       ),
       perm AS (
         SELECT r.employee_id, rp.permission_date::date AS attendance_date,
                EXTRACT(HOUR FROM rp.start_time)::int AS p_sh,
                EXTRACT(HOUR FROM rp.end_time)::int   AS p_eh
         FROM requests r
         JOIN request_permissions rp ON rp.request_id = r.id
         WHERE r.tenant_id=$1 AND rp.permission_date BETWEEN $2 AND $3
               AND rp.start_time IS NOT NULL AND rp.end_time IS NOT NULL
       )
       SELECT h.h AS hour,
              COUNT(*) FILTER (WHERE COV) AS scheduled,
              COUNT(*) FILTER (WHERE COV AND att.marker='present') AS present,
              COUNT(*) FILTER (WHERE COV AND att.marker='sick')    AS sick,
              COUNT(*) FILTER (WHERE COV AND att.marker='absent')  AS absent,
              COUNT(*) FILTER (WHERE COV AND p.p_sh IS NOT NULL AND h.h >= p.p_sh AND h.h < p.p_eh) AS on_permission,
              COUNT(*) FILTER (WHERE att.marker='present' AND att.ot_minutes>0 AND h.h >= att.eh AND h.h < att.ot_eh) AS ot_added
       FROM hours h
       CROSS JOIN att
       LEFT JOIN perm p ON p.employee_id=att.employee_id AND p.attendance_date=att.attendance_date
       GROUP BY h.h ORDER BY h.h`.replace(/COV/g,
         '((att.sh < att.eh AND h.h >= att.sh AND h.h < att.eh) OR (att.sh >= att.eh AND (h.h >= att.sh OR h.h < att.eh)))'),
      [tenantId, f, t, ...ff.params],
    );
    const [{ days }] = await this.ds.query(
      `SELECT COUNT(DISTINCT attendance_date) AS days FROM attendance_records WHERE tenant_id=$1 AND attendance_date BETWEEN $2 AND $3${ff.clause('attendance_records')}`,
      [tenantId, f, t, ...ff.params],
    );
    const d = Math.max(1, parseInt(days, 10));
    const n = (v: any) => parseInt(v ?? '0', 10);
    return {
      period: { from: f, to: t }, days: d,
      hours: rows.map((r: any) => {
        const scheduled = n(r.scheduled);
        const onPermission = n(r.on_permission);
        const sick = n(r.sick);
        const otAdded = n(r.ot_added);
        const afterPermission = scheduled - onPermission;
        const afterSick = afterPermission - sick;
        const afterOt = afterSick + otAdded;
        const avg = (v: number) => Math.round(10 * v / d) / 10;
        return {
          hour: r.hour,
          // back-compat fields (used by notifyGaps + existing coverage chart)
          scheduledTotal: scheduled,
          presentTotal: n(r.present),
          avgScheduled: avg(scheduled),
          avgPresent: avg(n(r.present)),
          shrinkagePct: scheduled ? Math.round(100 * (scheduled - n(r.present)) / scheduled) : 0,
          // ── HC cascade: normal → after permission → after sick → after overtime ──
          normalHc: scheduled,
          onPermission, afterPermission,
          sick, absent: n(r.absent), afterSick,
          otAdded, afterOt,
          // daily averages of the cascade (rounded to 1 dp)
          avgNormal: avg(scheduled),
          avgAfterPermission: avg(afterPermission),
          avgAfterSick: avg(afterSick),
          avgAfterOt: avg(afterOt),
        };
      }),
    };
  }
}
