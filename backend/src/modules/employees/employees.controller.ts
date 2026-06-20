import {
  Controller, Get, Patch, Param, Body, Query, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsOptional, IsIn, IsNumberString } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

class UpdateEmployeeDto {
  @IsOptional() status?: string;
  @IsOptional() employmentType?: string;
  @IsOptional() notes?: string;
  @IsOptional() isSupervisor?: boolean;
  @IsOptional() productivityFactor?: number;
}

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('employees.view')
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** List employees with function, team, and linked-user info */
  @Get()
  @ApiOperation({ summary: 'List employees with filters' })
  @ApiQuery({ name: 'search',         required: false })
  @ApiQuery({ name: 'status',         required: false })
  @ApiQuery({ name: 'functionId',     required: false })
  @ApiQuery({ name: 'employmentType', required: false })
  @ApiQuery({ name: 'gender',         required: false })
  @ApiQuery({ name: 'limit',          required: false })
  @ApiQuery({ name: 'offset',         required: false })
  async list(
    @CurrentUser() user: any,
    @Query('search')         search?: string,
    @Query('status')         status?: string,
    @Query('functionId')     functionId?: string,
    @Query('employmentType') employmentType?: string,
    @Query('gender')         gender?: string,
    @Query('limit')          limitQ?: string,
    @Query('offset')         offsetQ?: string,
  ) {
    const limit  = Math.min(Math.max(parseInt(limitQ  ?? '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(offsetQ ?? '0', 10) || 0, 0);

    const params: any[] = [user.tenantId];
    const conditions: string[] = ['e.tenant_id = $1'];

    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) LIKE ${p}
          OR e.employee_no LIKE ${p}
          OR LOWER(COALESCE(e.first_name_ar,'') || ' ' || COALESCE(e.last_name_ar,'')) LIKE ${p})`,
      );
    }
    if (status)         { params.push(status);         conditions.push(`e.status = $${params.length}`); }
    if (functionId)     { params.push(functionId);     conditions.push(`e.function_id = $${params.length}`); }
    if (employmentType) { params.push(employmentType); conditions.push(`e.employment_type = $${params.length}`); }
    if (gender)         { params.push(gender);         conditions.push(`e.gender = $${params.length}`); }

    const where = conditions.join(' AND ');

    // Total count
    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM employees e WHERE ${where}`, params,
    );

    // Data
    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT
         e.id, e.employee_no, e.first_name_en, e.last_name_en,
         e.first_name_ar, e.last_name_ar,
         e.gender, e.status, e.employment_type, e.hire_date,
         e.is_supervisor, e.productivity_factor, e.notes,
         e.function_id, f.name AS function_name,
         u.id AS user_id, u.email AS user_email,
         (SELECT COUNT(*) FROM attendance_records ar
           WHERE ar.employee_id = e.id) AS attendance_count,
         (SELECT COUNT(*) FROM schedule_entries se
           WHERE se.employee_id = e.id) AS schedule_count
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN users u ON u.employee_id = e.id AND u.tenant_id = e.tenant_id
       WHERE ${where}
       ORDER BY e.first_name_en, e.last_name_en
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      total: parseInt(total, 10),
      limit,
      offset,
      data: rows.map((r: any) => ({
        id:                r.id,
        employeeNo:        r.employee_no,
        fullName:          `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
        firstNameEn:       r.first_name_en,
        lastNameEn:        r.last_name_en,
        firstNameAr:       r.first_name_ar,
        lastNameAr:        r.last_name_ar,
        gender:            r.gender,
        status:            r.status,
        employmentType:    r.employment_type,
        hireDate:          r.hire_date,
        isSupervisor:      r.is_supervisor,
        productivityFactor:parseFloat(r.productivity_factor),
        notes:             r.notes,
        functionId:        r.function_id,
        functionName:      r.function_name,
        userId:            r.user_id,
        userEmail:         r.user_email,
        attendanceCount:   parseInt(r.attendance_count, 10),
        scheduleCount:     parseInt(r.schedule_count, 10),
      })),
    };
  }

  /** Get one employee */
  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    const rows = await this.ds.query(
      `SELECT e.*, f.name AS function_name,
              u.id AS user_id, u.email AS user_email
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN users u ON u.employee_id = e.id AND u.tenant_id = e.tenant_id
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [id, user.tenantId],
    );
    if (!rows.length) throw new NotFoundException('Employee not found');
    const r = rows[0];
    return {
      id: r.id, employeeNo: r.employee_no,
      fullName: `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
      firstNameEn: r.first_name_en, lastNameEn: r.last_name_en,
      firstNameAr: r.first_name_ar, lastNameAr: r.last_name_ar,
      gender: r.gender, status: r.status,
      employmentType: r.employment_type, hireDate: r.hire_date,
      isSupervisor: r.is_supervisor, productivityFactor: parseFloat(r.productivity_factor),
      notes: r.notes, functionId: r.function_id, functionName: r.function_name,
      userId: r.user_id, userEmail: r.user_email,
    };
  }

  /** Update employee fields (status, notes, productivity, etc.) */
  @Patch(':id')
  @RequirePermissions('employees.edit')
  @ApiOperation({ summary: 'Update employee' })
  async update(
    @CurrentUser() actor: any,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const existing = await this.ds.query(
      `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`, [id, actor.tenantId],
    );
    if (!existing.length) throw new NotFoundException('Employee not found');

    const sets: string[] = [];
    const params: any[] = [];

    if (dto.status !== undefined) {
      params.push(dto.status); sets.push(`status = $${params.length}`);
    }
    if (dto.employmentType !== undefined) {
      params.push(dto.employmentType); sets.push(`employment_type = $${params.length}`);
    }
    if (dto.notes !== undefined) {
      params.push(dto.notes); sets.push(`notes = $${params.length}`);
    }
    if (dto.isSupervisor !== undefined) {
      params.push(dto.isSupervisor); sets.push(`is_supervisor = $${params.length}`);
    }
    if (dto.productivityFactor !== undefined) {
      const pf = Math.min(Math.max(dto.productivityFactor, 0.1), 2.0);
      params.push(pf); sets.push(`productivity_factor = $${params.length}`);
    }

    if (!sets.length) throw new BadRequestException('No fields to update');

    params.push(id, actor.tenantId);
    sets.push(`updated_at = NOW()`);

    await this.ds.query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
      params,
    );

    await this.ds.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_id, actor_email, action, module,
                               entity_type, entity_id, new_value, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'employee.update', 'employees',
               'employee', $4, $5::jsonb, NOW())`,
      [actor.tenantId, actor.id, actor.email, id, JSON.stringify(dto)],
    );

    return { success: true };
  }

  /** List all functions (for filter dropdown) */
  @Get('meta/functions')
  @ApiOperation({ summary: 'List all functions' })
  async functions(@CurrentUser() user: any) {
    return this.ds.query(
      `SELECT id, name FROM functions WHERE tenant_id = $1 ORDER BY name`,
      [user.tenantId],
    );
  }
}
