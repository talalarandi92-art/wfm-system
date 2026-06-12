import {
  Controller, Get, Post, Patch, Delete,
  Param, Query, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Skills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'skills', version: '1' })
export class SkillsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── List all skills ─────────────────────────────────────────────────── */
  @Get()
  async listSkills(@CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT id, name, name_ar, code, channel_type, expiry_months, is_active
       FROM skills WHERE tenant_id=$1 AND is_active=TRUE ORDER BY name`,
      [user.tenantId],
    );
    return rows.map((r: any) => ({
      id: r.id, name: r.name, nameAr: r.name_ar, code: r.code,
      channelType: r.channel_type, expiryMonths: r.expiry_months, isActive: r.is_active,
    }));
  }

  /* ── Employee skills matrix ──────────────────────────────────────────── */
  @Get('matrix')
  @ApiOperation({ summary: 'Full employee × skill matrix' })
  async matrix(
    @CurrentUser() user: any,
    @Query('functionName') fn?: string,
  ) {
    const tid = user.tenantId;
    const params: any[] = [tid];
    const fnFilter = fn ? `AND f.name = $2` : '';
    if (fn) params.push(fn);

    const employees = await this.ds.query(
      `SELECT e.id, e.employee_no,
              e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS name,
              f.name AS function_name, e.gender,
              COALESCE(
                json_agg(
                  json_build_object(
                    'skillId',    es.skill_id,
                    'skillName',  s.name,
                    'skillCode',  s.code,
                    'proficiency',es.proficiency,
                    'status',     es.status,
                    'expiresAt',  es.expires_at
                  )
                ) FILTER (WHERE es.id IS NOT NULL), '[]'
              ) AS skills
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN employee_skills es ON es.employee_id = e.id AND es.tenant_id = $1
       LEFT JOIN skills s ON s.id = es.skill_id
       WHERE e.tenant_id = $1 AND e.status = 'active'
         ${fnFilter}
       GROUP BY e.id, e.employee_no, e.first_name_en, e.last_name_en, f.name, e.gender
       ORDER BY f.name, e.first_name_en`,
      params,
    );

    return employees.map((e: any) => ({
      id:           e.id,
      employeeNo:   e.employee_no,
      name:         e.name?.trim(),
      functionName: e.function_name,
      gender:       e.gender,
      skills:       typeof e.skills === 'string' ? JSON.parse(e.skills) : e.skills,
    }));
  }

  /* ── Add / update skill for employee ────────────────────────────────── */
  @Post('employee/:empId')
  @ApiOperation({ summary: 'Assign a skill to an employee' })
  async assignSkill(
    @Param('empId') empId: string,
    @CurrentUser() user: any,
    @Body() body: { skillId: string; proficiency?: string; expiresAt?: string },
  ) {
    const tid = user.tenantId;
    await this.ds.query(
      `INSERT INTO employee_skills (tenant_id, employee_id, skill_id, proficiency, status, expires_at)
       VALUES ($1,$2,$3,$4,'active',$5)
       ON CONFLICT (employee_id, skill_id)
       DO UPDATE SET proficiency=$4, status='active', expires_at=$5, updated_at=NOW()`,
      [tid, empId, body.skillId, body.proficiency ?? 'intermediate', body.expiresAt ?? null],
    );
    return { success: true };
  }

  /* ── Remove skill from employee ──────────────────────────────────────── */
  @Delete('employee/:empId/:skillId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSkill(
    @Param('empId') empId: string,
    @Param('skillId') skillId: string,
    @CurrentUser() user: any,
  ) {
    await this.ds.query(
      `DELETE FROM employee_skills WHERE tenant_id=$1 AND employee_id=$2 AND skill_id=$3`,
      [user.tenantId, empId, skillId],
    );
  }

  /* ── Coverage gap analysis ───────────────────────────────────────────── */
  @Get('gaps')
  @ApiOperation({ summary: 'Find agents who can cover a function gap' })
  async findCoverage(
    @CurrentUser() user: any,
    @Query('functionName')  targetFn?: string,
    @Query('skillCode')     skillCode?: string,
    @Query('date')          date?: string,
    @Query('fromHour')      fromHour?: string,
    @Query('toHour')        toHour?: string,
  ) {
    const tid = user.tenantId;

    // Find employees who have the required skill but are NOT in the target function
    const params: any[] = [tid];
    const skillFilter  = skillCode  ? `AND s.code = $${params.push(skillCode) && params.length}`  : '';
    const fnFilter     = targetFn   ? `AND f.name != $${params.push(targetFn) && params.length}`  : '';

    const candidates = await this.ds.query(
      `SELECT e.id, e.employee_no,
              e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS name,
              e.gender, f.name AS current_function,
              s.name AS skill_name, s.code AS skill_code, s.name_ar AS skill_name_ar,
              es.proficiency,
              -- Check if already scheduled on this date
              (SELECT se.shift_code_display FROM schedule_entries se
               WHERE se.employee_id = e.id AND se.entry_date = $${params.push(date ?? new Date().toISOString().slice(0,10)) && params.length}
               LIMIT 1) AS scheduled_shift
       FROM employee_skills es
       JOIN employees e ON e.id = es.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       JOIN skills s ON s.id = es.skill_id
       WHERE es.tenant_id = $1
         AND es.status = 'active'
         AND e.status = 'active'
         ${skillFilter}
         ${fnFilter}
       ORDER BY
         CASE es.proficiency
           WHEN 'expert'       THEN 1
           WHEN 'advanced'     THEN 2
           WHEN 'intermediate' THEN 3
           ELSE 4
         END,
         e.first_name_en`,
      params,
    );

    return {
      targetFunction: targetFn,
      skillCode,
      date: date ?? new Date().toISOString().slice(0, 10),
      fromHour: fromHour ?? null,
      toHour:   toHour   ?? null,
      candidates: candidates.map((r: any) => ({
        employeeId:      r.id,
        employeeNo:      r.employee_no,
        name:            r.name?.trim(),
        gender:          r.gender,
        currentFunction: r.current_function,
        skillName:       r.skill_name,
        skillNameAr:     r.skill_name_ar,
        skillCode:       r.skill_code,
        proficiency:     r.proficiency,
        scheduledShift:  r.scheduled_shift ?? null,
        available:       !r.scheduled_shift || !['OFF','L','H','SL','A'].includes(r.scheduled_shift ?? ''),
      })),
    };
  }

  /* ── Dispatch cross-skill move with notification ─────────────────────── */
  @Post('dispatch')
  @ApiOperation({ summary: 'Dispatch employee to cover another function + notify' })
  async dispatch(
    @CurrentUser() user: any,
    @Body() body: {
      employeeId: string;
      fromFunction: string;
      toFunction: string;
      startAt: string;
      endAt: string;
      reason?: string;
    },
  ) {
    const tid = user.tenantId;

    // Create calendar event
    const [event] = await this.ds.query(
      `INSERT INTO calendar_events
         (tenant_id, title, event_type, start_at, end_at, color, description, status, created_by)
       VALUES ($1,$2,'cross_skill',$3,$4,'#fb923c',$5,'scheduled',$6) RETURNING id`,
      [
        tid,
        `Cross-skill: ${body.fromFunction} → ${body.toFunction}`,
        body.startAt, body.endAt,
        body.reason ?? `Coverage support for ${body.toFunction}`,
        user.sub,
      ],
    );

    // Create move record
    await this.ds.query(
      `INSERT INTO cross_skill_moves
         (tenant_id, employee_id, from_function, to_function, start_at, end_at, reason, status, requested_by, calendar_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8,$9)`,
      [tid, body.employeeId, body.fromFunction, body.toFunction, body.startAt, body.endAt, body.reason ?? null, user.sub, event.id],
    );

    // Add employee as attendee
    const [emp] = await this.ds.query(
      `SELECT u.id AS user_id FROM employees e LEFT JOIN users u ON u.employee_id = e.id WHERE e.id = $1 LIMIT 1`,
      [body.employeeId],
    );

    if (emp?.user_id) {
      await this.ds.query(
        `INSERT INTO calendar_event_attendees (event_id, user_id, employee_id, role, status)
         VALUES ($1,$2,$3,'attendee','pending')`,
        [event.id, emp.user_id, body.employeeId],
      );

      // Notify employee
      const startTime = new Date(body.startAt).toLocaleTimeString('ar-KW', { hour: '2-digit', minute: '2-digit' });
      const endTime   = new Date(body.endAt).toLocaleTimeString('ar-KW', { hour: '2-digit', minute: '2-digit' });
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, body, entity_type, entity_id)
         VALUES ($1,$2,'cross_skill.dispatch',
                 'تغيير مؤقت للفنكشن',
                 $3, 'cross_skill_move', $4)`,
        [
          tid, emp.user_id,
          `تم تحويلك من ${body.fromFunction} إلى ${body.toFunction} من ${startTime} حتى ${endTime}`,
          event.id,
        ],
      ).catch(() => {});

      // Notify RTA users
      const rtaUsers = await this.ds.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id=$1 AND r.name IN ('rta','wfm_supervisor','wfm_analyst')`,
        [tid],
      );
      for (const rta of rtaUsers) {
        await this.ds.query(
          `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, body, entity_type, entity_id)
           VALUES ($1,$2,'cross_skill.dispatch',
                   'Cross-skill dispatch confirmed',
                   $3, 'cross_skill_move', $4)`,
          [tid, rta.id, `Employee dispatched: ${body.fromFunction} → ${body.toFunction} (${startTime}–${endTime})`, event.id],
        ).catch(() => {});
      }
    }

    return { success: true, eventId: event.id };
  }
}
