import {
  Controller, Get, Patch, Param, Body, Query, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsOptional, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

class LinkEmployeeDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** List users with their linked employee (for the linking admin screen) */
  @Get()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'List users with linked employee info' })
  @ApiQuery({ name: 'search', required: false })
  async list(
    @CurrentUser() user: any,
    @Query('search') search?: string,
  ) {
    const params: any[] = [user.tenantId];
    let where = `u.tenant_id = $1`;
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where += ` AND (LOWER(u.email) LIKE $2
                   OR LOWER(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) LIKE $2)`;
    }
    const rows = await this.ds.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.status,
              u.employee_id,
              e.employee_no, e.first_name_en || ' ' || e.last_name_en AS employee_name,
              f.name AS function_name,
              ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                     WHERE ur.user_id = u.id) AS roles
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT 200`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      status: r.status,
      roles: r.roles ?? [],
      employeeId: r.employee_id,
      employee: r.employee_id
        ? { employeeNo: r.employee_no, fullName: r.employee_name, functionName: r.function_name }
        : null,
    }));
  }

  /** Suggest employee matches for a user (by name similarity) — suggestion only, human confirms */
  @Get(':id/employee-suggestions')
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'Suggest employees to link to this user (name match)' })
  async suggestions(@CurrentUser() user: any, @Param('id') id: string) {
    const u = await this.ds.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, user.tenantId],
    );
    if (!u.length) throw new NotFoundException('User not found');
    const name = `${u[0].first_name ?? ''} ${u[0].last_name ?? ''}`.trim().toLowerCase();
    if (!name) return [];

    const rows = await this.ds.query(
      `SELECT e.id, e.employee_no,
              e.first_name_en || ' ' || e.last_name_en AS full_name,
              f.name AS function_name,
              similarity(LOWER(e.first_name_en || ' ' || e.last_name_en), $2) AS score
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE e.tenant_id = $1 AND e.status = 'active'
         AND e.id NOT IN (SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND tenant_id = $1)
       ORDER BY similarity(LOWER(e.first_name_en || ' ' || e.last_name_en), $2) DESC
       LIMIT 5`,
      [user.tenantId, name],
    ).catch(async () => {
      // pg_trgm not installed — fall back to simple ILIKE on name words
      const firstWord = name.split(' ')[0];
      return this.ds.query(
        `SELECT e.id, e.employee_no,
                e.first_name_en || ' ' || e.last_name_en AS full_name,
                f.name AS function_name, 0 AS score
         FROM employees e
         LEFT JOIN functions f ON f.id = e.function_id
         WHERE e.tenant_id = $1 AND e.status = 'active'
           AND LOWER(e.first_name_en || ' ' || e.last_name_en) LIKE $2
           AND e.id NOT IN (SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND tenant_id = $1)
         LIMIT 5`,
        [user.tenantId, `%${firstWord}%`],
      );
    });
    return rows;
  }

  /** Link (or unlink with employeeId = null) a user to an employee record */
  @Patch(':id/employee')
  @RequirePermissions('users.edit')
  @ApiOperation({ summary: 'Link/unlink a user to an employee record' })
  async linkEmployee(
    @CurrentUser() actor: any,
    @Param('id') id: string,
    @Body() dto: LinkEmployeeDto,
  ) {
    const u = await this.ds.query(
      `SELECT id, employee_id FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, actor.tenantId],
    );
    if (!u.length) throw new NotFoundException('User not found');

    if (dto.employeeId) {
      // Employee must exist, be in tenant, and not be linked to another user
      const emp = await this.ds.query(
        `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`,
        [dto.employeeId, actor.tenantId],
      );
      if (!emp.length) throw new BadRequestException('الموظف غير موجود');

      const taken = await this.ds.query(
        `SELECT id, email FROM users WHERE employee_id = $1 AND tenant_id = $2 AND id != $3`,
        [dto.employeeId, actor.tenantId, id],
      );
      if (taken.length) {
        throw new BadRequestException(`هذا الموظف مرتبط بحساب آخر: ${taken[0].email}`);
      }
    }

    await this.ds.query(
      `UPDATE users SET employee_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [dto.employeeId ?? null, id, actor.tenantId],
    );

    // Audit (append-only)
    await this.ds.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_id, actor_email, action, module,
                               entity_type, entity_id, old_value, new_value, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'user.employee_link', 'users',
               'user', $4, $5::jsonb, $6::jsonb, NOW())`,
      [
        actor.tenantId,
        actor.id ?? null,
        actor.email ?? null,
        id,
        JSON.stringify({ employeeId: u[0].employee_id }),
        JSON.stringify({ employeeId: dto.employeeId ?? null }),
      ],
    );

    return { success: true, message: dto.employeeId ? 'تم ربط الحساب بالموظف' : 'تم فك الربط' };
  }
}
