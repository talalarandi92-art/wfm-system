import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsOptional } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions, AuthOnly } from '@common/decorators/permissions.decorator';

class UpdateSettingDto {
  @IsOptional() value: any;
}

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Get all tenant settings' })
  async getAll(@CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT setting_key, setting_value, setting_group, description
       FROM tenant_settings WHERE tenant_id = $1
       ORDER BY setting_group, setting_key`,
      [user.tenantId],
    );
    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const r of rows) {
      const g = r.setting_group ?? 'general';
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push({ key: r.setting_key, value: r.setting_value, description: r.description });
    }
    return grouped;
  }

  @Patch(':key')
  @RequirePermissions('settings.edit')
  @ApiOperation({ summary: 'Update a setting value' })
  async update(
    @CurrentUser() actor: any,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ) {
    await this.ds.query(
      `UPDATE tenant_settings SET setting_value = $1::jsonb, updated_at = NOW()
       WHERE tenant_id = $2 AND setting_key = $3`,
      [JSON.stringify(dto.value), actor.tenantId, key],
    );
    await this.ds.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'setting.update', 'settings', 'setting', $4, $5::jsonb, NOW())`,
      [actor.tenantId, actor.id, actor.email, key, JSON.stringify({ key, value: dto.value })],
    );
    return { success: true };
  }

  @Get('shift-codes')
  @AuthOnly()   // reference lookup used by dropdowns across the app (all roles)
  @ApiOperation({ summary: 'Shift code dictionary' })
  async shiftCodes(@CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT sc.code, sc.description, sc.description_ar,
         sc.start_time, sc.end_time, sc.start_time_2, sc.end_time_2,
         sc.working_hours, sc.break_hours, sc.total_hours,
         sc.is_split_shift, sc.is_cross_midnight, sc.is_wfh, sc.is_ramadan,
         sc.is_supervisor_shift, sc.is_working_shift, sc.is_leave_code, sc.is_absence_code,
         sc.allows_female, sc.is_active, sc.display_color, sc.source,
         cat.name AS category_name
       FROM shift_codes sc
       LEFT JOIN shift_categories cat ON cat.id = sc.category_id
       WHERE sc.tenant_id = $1
       ORDER BY sc.is_working_shift DESC, sc.sort_order, sc.code`,
      [user.tenantId],
    );
    return rows.map((r: any) => ({
      code:            r.code,
      description:     r.description,
      descriptionAr:   r.description_ar,
      startTime:       r.start_time,
      endTime:         r.end_time,
      startTime2:      r.start_time_2,
      endTime2:        r.end_time_2,
      workingHours:    parseFloat(r.working_hours ?? 0),
      breakHours:      parseFloat(r.break_hours   ?? 0),
      totalHours:      parseFloat(r.total_hours   ?? 0),
      isSplitShift:    r.is_split_shift,
      isCrossMidnight: r.is_cross_midnight,
      isWfh:           r.is_wfh,
      isRamadan:       r.is_ramadan,
      isSupervisor:    r.is_supervisor_shift,
      isWorkingShift:  r.is_working_shift,
      isLeaveCode:     r.is_leave_code,
      isAbsenceCode:   r.is_absence_code,
      allowsFemale:    r.allows_female,
      isActive:        r.is_active,
      displayColor:    r.display_color,
      source:          r.source,
      categoryName:    r.category_name,
    }));
  }

  @Get('functions')
  @AuthOnly()   // reference lookup used by dropdowns across the app (all roles)
  @ApiOperation({ summary: 'Functions list with headcount' })
  async functions(@CurrentUser() user: any) {
    return this.ds.query(
      `SELECT f.id, f.name,
         COUNT(e.id) AS headcount,
         COUNT(e.id) FILTER (WHERE e.status='active') AS active_count
       FROM functions f
       LEFT JOIN employees e ON e.function_id = f.id AND e.tenant_id = f.tenant_id
       WHERE f.tenant_id = $1
       GROUP BY f.id, f.name ORDER BY f.name`,
      [user.tenantId],
    );
  }
}
