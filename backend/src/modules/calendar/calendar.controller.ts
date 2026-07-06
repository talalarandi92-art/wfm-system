import {
  Controller, Get, Post, Patch, Delete,
  Param, Query, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('schedule.view')   // deny-by-default flip 2026-07-06 — reads; management writes override below
@Controller({ path: 'calendar', version: '1' })
export class CalendarController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── List events in a date range ─────────────────────────────────────── */
  @Get('events')
  @ApiOperation({ summary: 'List calendar events for a date range' })
  async listEvents(
    @CurrentUser() user: any,
    @Query('from')  from?: string,
    @Query('to')    to?: string,
    @Query('type')  type?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const tid  = user.tenantId;
    const from_ = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to_   = to   ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const params: any[] = [tid, from_, to_];
    const filters: string[] = [];
    if (type)       { params.push(type);       filters.push(`e.event_type = $${params.length}`); }
    if (employeeId) { params.push(employeeId); filters.push(`ea.employee_id = $${params.length}`); }

    const where = filters.length ? 'AND ' + filters.join(' AND ') : '';

    const rows = await this.ds.query(
      `SELECT e.id, e.title, e.event_type, e.start_at, e.end_at,
              e.all_day, e.location, e.description, e.color, e.status,
              u.username AS created_by_name,
              COALESCE(
                json_agg(
                  json_build_object(
                    'employeeId', ea.employee_id,
                    'userId',     ea.user_id,
                    'role',       ea.role,
                    'status',     ea.status,
                    'name',       COALESCE(emp.first_name_en || ' ' || emp.last_name_en, usr.username)
                  )
                ) FILTER (WHERE ea.id IS NOT NULL), '[]'
              ) AS attendees
       FROM calendar_events e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN calendar_event_attendees ea ON ea.event_id = e.id
       LEFT JOIN employees emp ON emp.id = ea.employee_id
       LEFT JOIN users usr ON usr.id = ea.user_id
       WHERE e.tenant_id = $1
         AND e.start_at >= $2::date
         AND e.start_at <  ($3::date + INTERVAL '1 day')
         ${where}
       GROUP BY e.id, u.username
       ORDER BY e.start_at`,
      params,
    );

    return rows.map((r: any) => ({
      id:            r.id,
      title:         r.title,
      eventType:     r.event_type,
      startAt:       r.start_at,
      endAt:         r.end_at,
      allDay:        r.all_day,
      location:      r.location,
      description:   r.description,
      color:         r.color,
      status:        r.status,
      createdByName: r.created_by_name,
      attendees:     typeof r.attendees === 'string' ? JSON.parse(r.attendees) : r.attendees,
    }));
  }

  /* ── Create event ────────────────────────────────────────────────────── */
  @Post('events')
  @RequirePermissions('schedule.edit')   // creating org/company events is a management action
  @ApiOperation({ summary: 'Create a calendar event' })
  async createEvent(@CurrentUser() user: any, @Body() body: any) {
    const tid = user.tenantId;

    const colorMap: Record<string, string> = {
      coaching:     '#818cf8',
      meeting:      '#34d399',
      shift_change: '#fbbf24',
      training:     '#f472b6',
      cross_skill:  '#fb923c',
      off:          '#64748b',
      leave:        '#94a3b8',
      general:      '#60a5fa',
    };

    const [event] = await this.ds.query(
      `INSERT INTO calendar_events (tenant_id, title, event_type, start_at, end_at, all_day, location, description, color, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10) RETURNING *`,
      [
        tid, body.title, body.eventType ?? 'general',
        body.startAt, body.endAt, body.allDay ?? false,
        body.location ?? null, body.description ?? null,
        body.color ?? colorMap[body.eventType ?? 'general'] ?? '#60a5fa',
        user.id,
      ],
    );

    // Add attendees
    if (Array.isArray(body.attendees) && body.attendees.length > 0) {
      for (const att of body.attendees) {
        await this.ds.query(
          `INSERT INTO calendar_event_attendees (event_id, user_id, employee_id, role, status)
           VALUES ($1,$2,$3,$4,'pending')`,
          [event.id, att.userId ?? null, att.employeeId ?? null, att.role ?? 'attendee'],
        );
      }
      // Send notifications to attendees
      await this.sendEventNotifications(tid, event, body.attendees);
    }

    // If coaching, create coaching_session record
    if (body.eventType === 'coaching' && body.coachingData) {
      await this.ds.query(
        `INSERT INTO coaching_sessions
           (tenant_id, employee_id, coach_id, calendar_event_id, scorecard_batch_id,
            scheduled_at, duration_minutes, status, focus_areas, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9,$10)`,
        [
          tid,
          body.coachingData.employeeId,
          body.coachingData.coachId ?? user.id,
          event.id,
          body.coachingData.scorecardBatchId ?? null,
          body.startAt,
          body.coachingData.durationMinutes ?? 30,
          body.coachingData.focusAreas ?? [],
          body.coachingData.notes ?? null,
          user.id,
        ],
      );
    }

    // Coaching / meeting → notify RTA & WFM so they review coverage impact before it stands.
    if (body.eventType === 'coaching' || body.eventType === 'meeting') {
      const when = new Date(body.startAt).toLocaleString('ar-KW', { dateStyle: 'short', timeStyle: 'short' });
      const reviewers = await this.ds.query(
        `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id=$1 AND r.code IN ('rta','wfm_analyst','platform_admin')`,
        [tid],
      ).catch(() => []);
      const label = body.eventType === 'coaching' ? 'كوتشينج' : 'اجتماع';
      for (const rv of reviewers) {
        await this.ds.query(
          `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id)
           VALUES ($1,$2,'calendar.review', $3, $4, $5, $6, 'calendar_event', $7)`,
          [tid, rv.id,
           `Review coverage: ${label} required`, `راجع تغطية: ${label} مطلوب`,
           `${body.title} — ${when}. Ensure coverage is unaffected.`, `${body.title} — ${when}. تأكد أن التغطية غير متأثرة.`,
           event.id],
        ).catch(() => {});
      }
    }

    // If cross_skill move, create cross_skill_moves record
    if (body.eventType === 'cross_skill' && body.crossSkillData) {
      await this.ds.query(
        `INSERT INTO cross_skill_moves
           (tenant_id, employee_id, from_function, to_function, start_at, end_at, reason, status, requested_by, calendar_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8,$9)`,
        [
          tid,
          body.crossSkillData.employeeId,
          body.crossSkillData.fromFunction,
          body.crossSkillData.toFunction,
          body.startAt, body.endAt,
          body.crossSkillData.reason ?? null,
          user.id, event.id,
        ],
      );
    }

    return { id: event.id, success: true };
  }

  /* ── Update event status ─────────────────────────────────────────────── */
  @Patch('events/:id')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Update a calendar event' })
  async updateEvent(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    const allowed = ['title', 'start_at', 'end_at', 'location', 'description', 'status', 'color'];
    const sets: string[] = [];
    const vals: any[]    = [user.tenantId, id];
    for (const [k, v] of Object.entries(body)) {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowed.includes(col)) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
    }
    if (!sets.length) return { updated: false };
    sets.push(`updated_at = NOW()`);
    await this.ds.query(
      `UPDATE calendar_events SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2`,
      vals,
    );
    return { updated: true };
  }

  /* ── Delete event ────────────────────────────────────────────────────── */
  @Delete('events/:id')
  @RequirePermissions('schedule.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a calendar event' })
  async deleteEvent(@Param('id') id: string, @CurrentUser() user: any) {
    await this.ds.query(
      `DELETE FROM calendar_events WHERE id=$1 AND tenant_id=$2`,
      [id, user.tenantId],
    );
  }

  /* ── Today's events for current user / employee ──────────────────────── */
  @Get('today')
  @ApiOperation({ summary: "Today's events for the current user" })
  async todayEvents(@CurrentUser() user: any) {
    const tid = user.tenantId;
    const today = new Date().toISOString().slice(0, 10);

    const rows = await this.ds.query(
      `SELECT e.id, e.title, e.event_type, e.start_at, e.end_at, e.location, e.color, e.status
       FROM calendar_events e
       LEFT JOIN calendar_event_attendees ea ON ea.event_id = e.id AND (ea.user_id = $2)
       WHERE e.tenant_id = $1
         AND e.start_at >= $3::date
         AND e.start_at <  ($3::date + INTERVAL '1 day')
         AND e.status != 'cancelled'
         AND (e.created_by = $2 OR ea.id IS NOT NULL)
       ORDER BY e.start_at`,
      [tid, user.id, today],
    );
    return rows.map((r: any) => ({
      id: r.id, title: r.title, eventType: r.event_type,
      startAt: r.start_at, endAt: r.end_at,
      location: r.location, color: r.color, status: r.status,
    }));
  }

  /* ── Coaching sessions list ──────────────────────────────────────────── */
  @Get('coaching')
  @ApiOperation({ summary: 'List coaching sessions' })
  async listCoaching(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to')   to?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const tid = user.tenantId;
    const from_ = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to_   = to   ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    // Self-scope: agents (no coaching/team-scorecard view) see only their own sessions.
    const perms = user.permissionCodes ?? user.permissions ?? [];
    const canSeeAll = perms.includes('coaching.view') || perms.includes('scorecard.view_team') || perms.includes('scorecard.view_all');
    if (!canSeeAll) {
      if (!user.employeeId) return [];
      employeeId = user.employeeId;
    }
    const params: any[] = [tid, from_, to_];
    const filters: string[] = [];
    if (employeeId) { params.push(employeeId); filters.push(`cs.employee_id = $${params.length}`); }
    const where = filters.length ? 'AND ' + filters.join(' AND ') : '';

    const rows = await this.ds.query(
      `SELECT cs.id, cs.scheduled_at, cs.duration_minutes, cs.status,
              cs.focus_areas, cs.notes, cs.action_plan, cs.follow_up_date,
              cs.employee_acknowledged,
              e.first_name_en || ' ' || e.last_name_en AS employee_name,
              e.id AS employee_id,
              fn.name AS function_name,
              u.username AS coach_name,
              sb.period_name AS scorecard_period
       FROM coaching_sessions cs
       JOIN employees e ON e.id = cs.employee_id
       LEFT JOIN functions fn ON fn.id = e.function_id
       LEFT JOIN users u ON u.id = cs.coach_id
       LEFT JOIN scorecard_batches sb ON sb.id = cs.scorecard_batch_id
       WHERE cs.tenant_id = $1
         AND cs.scheduled_at >= $2::date
         AND cs.scheduled_at <  ($3::date + INTERVAL '1 day')
         ${where}
       ORDER BY cs.scheduled_at DESC`,
      params,
    );
    return rows.map((r: any) => ({
      id:                   r.id,
      scheduledAt:          r.scheduled_at,
      durationMinutes:      r.duration_minutes,
      status:               r.status,
      focusAreas:           r.focus_areas ?? [],
      notes:                r.notes,
      actionPlan:           r.action_plan,
      followUpDate:         r.follow_up_date,
      employeeAcknowledged: r.employee_acknowledged,
      employeeName:         r.employee_name?.trim(),
      employeeId:           r.employee_id,
      functionName:         r.function_name,
      coachName:            r.coach_name,
      scorecardPeriod:      r.scorecard_period,
    }));
  }

  /* ── Cross-skill gap suggestions ─────────────────────────────────────── */
  @Get('cross-skill/gaps')
  @RequirePermissions('hc.view')   // WFM cross-skill coverage analysis
  @ApiOperation({ summary: 'Detect cross-skill coverage gaps and suggest agents' })
  async crossSkillGaps(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('hour') hour?: string,
  ) {
    const tid      = user.tenantId;
    const checkDate = date ?? new Date().toISOString().slice(0, 10);
    const checkHour = hour ? parseInt(hour, 10) : new Date().getHours();

    // Get HC by function from the schedule (attendance_records) for this date/hour.
    // Uses the scheduled time window directly (cross-midnight aware) — the same
    // live source as /coverage/hourly. (Was querying a non-existent schedule_records.)
    const scheduled = await this.ds.query(
      `SELECT fn.name AS function_name, COUNT(DISTINCT ar.employee_id) AS scheduled_hc
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       JOIN functions fn ON fn.id = e.function_id
       WHERE ar.tenant_id = $1 AND ar.attendance_date = $2
         AND ar.scheduled_start IS NOT NULL
         AND ar.attendance_marker NOT IN ('off','leave','holiday','sick','absent','comp')
         AND (
           (ar.scheduled_end >  ar.scheduled_start AND $3::time >= ar.scheduled_start AND $3::time < ar.scheduled_end)
           OR (ar.scheduled_end <= ar.scheduled_start AND ($3::time >= ar.scheduled_start OR $3::time < ar.scheduled_end))
         )
       GROUP BY fn.name`,
      [tid, checkDate, `${String(checkHour).padStart(2,'0')}:00`],
    );

    // Get employees with cross-skills for each function
    const crossSkilled = await this.ds.query(
      `SELECT e.id, e.first_name_en || ' ' || e.last_name_en AS name,
              e.gender, fn.name AS current_function,
              s.name AS skill_name, s.code AS skill_code,
              sf.name AS skill_function,
              es.proficiency, es.status AS skill_status
       FROM employee_skills es
       JOIN employees e ON e.id = es.employee_id
       JOIN functions fn ON fn.id = e.function_id
       JOIN skills s ON s.id = es.skill_id
       LEFT JOIN functions sf ON sf.name ILIKE '%' || s.name || '%'
       WHERE es.tenant_id = $1 AND es.status = 'active' AND e.status = 'active'
       ORDER BY e.first_name_en`,
      [tid],
    );

    return {
      checkDate,
      checkHour,
      scheduledHC:  scheduled.map((r: any) => ({ functionName: r.function_name, hc: parseInt(r.scheduled_hc, 10) })),
      crossSkilled: crossSkilled.map((r: any) => ({
        employeeId:      r.id,
        name:            r.name?.trim(),
        gender:          r.gender,
        currentFunction: r.current_function,
        skillName:       r.skill_name,
        skillCode:       r.skill_code,
        proficiency:     r.proficiency,
      })),
    };
  }

  /* ── Private: send notifications ─────────────────────────────────────── */
  private async sendEventNotifications(tid: string, event: any, attendees: any[]) {
    for (const att of attendees) {
      if (!att.userId) continue;
      const msg = `${event.event_type === 'coaching' ? '📚 جلسة كوتشينج' : event.event_type === 'cross_skill' ? '🔄 تغيير فنكشن' : '📅 حدث جديد'}: ${event.title} — ${new Date(event.start_at).toLocaleString('ar-KW', { dateStyle: 'short', timeStyle: 'short' })}`;
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, body, entity_type, entity_id)
         VALUES ($1,$2,$3,$4,$5,'calendar_event',$6)`,
        [tid, att.userId, `calendar.${event.event_type}`, event.title, msg, event.id],
      ).catch(() => {}); // don't fail main flow if notification insert fails
    }
  }
}
