import {
  Controller, Get, Patch, Query, Param, Body,
  UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, MinLength, IsBoolean } from 'class-validator';
import { JwtAuthGuard }  from '../../common/guards/jwt-auth.guard';
import { CurrentUser }   from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ScheduleService } from './schedule.service';
import { rosterCacheInvalidate } from '../../common/ttl-cache.interceptor';

const EDIT_TYPES = [
  'employee_request', 'business_need', 'wfm_adjustment', 'correction',
  'sick_leave', 'absence', 'swap_correction', 'emergency', 'import',
  'manual_adjustment',
] as const;

class EditCellDto {
  @IsString()
  employeeId!: string;

  @IsString()
  date!: string;

  @IsString()
  @MinLength(1)
  newShiftCode!: string;

  @IsString()
  @IsIn(EDIT_TYPES)
  editType!: string;

  @IsString()
  @MinLength(3)
  reason!: string;

  /** Force past rule violations (female-late / rest) — audited. Without this the
   *  service's documented "resubmit with override:true" path was unreachable. */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

@ApiTags('Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('schedule.view')
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly svc: ScheduleService) {}

  /** Weekly/multi-week schedule grid — employees × N days */
  @Get('grid')
  @ApiOperation({ summary: 'Get schedule grid (1–4 weeks)' })
  @ApiQuery({ name: 'weekStart',   required: false, description: 'YYYY-MM-DD (Saturday). Defaults to current week.' })
  @ApiQuery({ name: 'functionId',  required: false })
  @ApiQuery({ name: 'teamId',      required: false })
  @ApiQuery({ name: 'weeks',       required: false, description: 'Number of weeks: 1–4. Default 1.' })
  grid(
    @CurrentUser() user: any,
    @Query('weekStart')  weekStart?: string,
    @Query('functionId') functionId?: string,
    @Query('teamId')     teamId?: string,
    @Query('weeks', new DefaultValuePipe(1), ParseIntPipe) weeks = 1,
  ) {
    const ws = weekStart ?? ScheduleService.weekStartFor(
      new Date().toISOString().split('T')[0],
    );
    return this.svc.getGrid(user.tenantId, ws, functionId, teamId, weeks);
  }

  /** All functions with employee count */
  @Get('functions')
  @ApiOperation({ summary: 'List functions for filter' })
  functions(@CurrentUser() user: any) {
    return this.svc.getFunctions(user.tenantId);
  }

  /** Weeks that have attendance data */
  @Get('available-weeks')
  @ApiOperation({ summary: 'List weeks with data' })
  availableWeeks(@CurrentUser() user: any) {
    return this.svc.getAvailableWeeks(user.tenantId);
  }

  /** Coverage summary by function for the week */
  @Get('coverage')
  @ApiOperation({ summary: 'Daily HC coverage summary by function' })
  @ApiQuery({ name: 'weekStart', required: false })
  coverage(
    @CurrentUser() user: any,
    @Query('weekStart') weekStart?: string,
  ) {
    const ws = weekStart ?? ScheduleService.weekStartFor(
      new Date().toISOString().split('T')[0],
    );
    return this.svc.getCoverageSummary(user.tenantId, ws);
  }

  /** Single employee + day detail */
  @Get('day/:employeeId/:date')
  @ApiOperation({ summary: 'Employee day detail card' })
  dayDetail(
    @CurrentUser() user: any,
    @Param('employeeId') employeeId: string,
    @Param('date')       date: string,
  ) {
    return this.svc.getDayDetail(user.tenantId, employeeId, date);
  }

  /** Edit a single schedule cell with audit trail */
  @Patch('cell')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Edit schedule cell — stores full audit in notes' })
  @ApiBody({ type: EditCellDto })
  /* The write must clear the read cache, or the edit is invisible for up to 90 seconds and
     looks like it silently failed. The roster grids sit behind an in-process TTL cache; every
     other writer (recon upload, ingest, schedule-change, swap, revert) already invalidates it,
     and this one — the most-used write in the product — did not. The row changed in the
     database and the screen kept showing the old shift, which reads as "the edit does nothing"
     and invites the user to do it again. */
  async editCell(
    @CurrentUser() user: any,
    @Body() body: EditCellDto,
  ) {
    const res = await this.svc.editCell(
      user.tenantId,
      user.userId ?? user.id,
      user.email,
      body.employeeId,
      body.date,
      body.newShiftCode,
      body.editType,
      body.reason,
      body.override === true,
    );
    rosterCacheInvalidate();
    return res;
  }

  /** Available shift codes catalogue */
  @Get('shift-codes')
  @ApiOperation({ summary: 'List all supported shift codes for the edit modal' })
  shiftCodes() {
    return this.svc.getShiftCodes();
  }

  /** Absence / sick analysis by shift category (NS, NA, MS, MA, etc.) */
  @Get('absence-analysis')
  @ApiOperation({ summary: 'Absence & sick analysis grouped by shift category' })
  @ApiQuery({ name: 'weekStart',  required: false })
  @ApiQuery({ name: 'weeks',      required: false })
  @ApiQuery({ name: 'functionId', required: false })
  absenceAnalysis(
    @CurrentUser() user: any,
    @Query('weekStart') weekStart?: string,
    @Query('weeks', new DefaultValuePipe(1), ParseIntPipe) weeks = 1,
    @Query('functionId') functionId?: string,
  ) {
    const ws = weekStart ?? ScheduleService.weekStartFor(
      new Date().toISOString().split('T')[0],
    );
    return this.svc.getAbsenceAnalysis(user.tenantId, ws, weeks, functionId);
  }

  /** Schedule edit audit log for a period */
  @Get('audit-log')
  @ApiOperation({ summary: 'Schedule edit audit log (all manual changes)' })
  @ApiQuery({ name: 'weekStart', required: false })
  @ApiQuery({ name: 'weeks',     required: false })
  auditLog(
    @CurrentUser() user: any,
    @Query('weekStart') weekStart?: string,
    @Query('weeks', new DefaultValuePipe(1), ParseIntPipe) weeks = 1,
  ) {
    const ws = weekStart ?? ScheduleService.weekStartFor(
      new Date().toISOString().split('T')[0],
    );
    return this.svc.getAuditLog(user.tenantId, ws, weeks);
  }

  /** Full audit report with filters */
  @Get('audit-report')
  @ApiOperation({ summary: 'Full schedule edit audit report with filters & summary' })
  @ApiQuery({ name: 'dateFrom',        required: false })
  @ApiQuery({ name: 'dateTo',          required: false })
  @ApiQuery({ name: 'employeeId',      required: false })
  @ApiQuery({ name: 'functionId',      required: false })
  @ApiQuery({ name: 'editedBy',        required: false })
  @ApiQuery({ name: 'editType',        required: false })
  @ApiQuery({ name: 'sourceOfChange',  required: false })
  @ApiQuery({ name: 'hasViolation',    required: false })
  @ApiQuery({ name: 'requiresApproval',required: false })
  @ApiQuery({ name: 'limit',           required: false })
  @ApiQuery({ name: 'offset',          required: false })
  auditReport(
    @CurrentUser() user: any,
    @Query('dateFrom')         dateFrom?: string,
    @Query('dateTo')           dateTo?: string,
    @Query('employeeId')       employeeId?: string,
    @Query('functionId')       functionId?: string,
    @Query('editedBy')         editedBy?: string,
    @Query('editType')         editType?: string,
    @Query('sourceOfChange')   sourceOfChange?: string,
    @Query('hasViolation')     hasViolation?: string,
    @Query('requiresApproval') requiresApproval?: string,
    @Query('limit',  new DefaultValuePipe(100), ParseIntPipe) limit = 100,
    @Query('offset', new DefaultValuePipe(0),   ParseIntPipe) offset = 0,
  ) {
    return this.svc.getAuditReport(user.tenantId, {
      dateFrom, dateTo, employeeId, functionId, editedBy, editType, sourceOfChange,
      hasViolation:     hasViolation     !== undefined ? hasViolation     === 'true' : undefined,
      requiresApproval: requiresApproval !== undefined ? requiresApproval === 'true' : undefined,
      limit, offset,
    });
  }

  /** Cell change timeline (full edit history for one employee+date) */
  @Get('timeline/:employeeId/:date')
  @ApiOperation({ summary: 'Full change timeline for one schedule cell' })
  cellTimeline(
    @CurrentUser() user: any,
    @Param('employeeId') employeeId: string,
    @Param('date')       date: string,
  ) {
    return this.svc.getCellTimeline(user.tenantId, employeeId, date);
  }

  /** Get publish/lock status for a week */
  @Get('week-status')
  @ApiOperation({ summary: 'Get publish/lock status of a schedule week' })
  @ApiQuery({ name: 'weekStart', required: true })
  weekStatus(
    @CurrentUser() user: any,
    @Query('weekStart') weekStart: string,
  ) {
    return this.svc.getWeekStatus(user.tenantId, weekStart);
  }

  /** Publish, lock, or revert a schedule week */
  @Patch('week-status')
  @ApiOperation({ summary: 'Publish, lock, or revert a schedule week' })
  @RequirePermissions('schedule.publish')
  async setWeekStatus(
    @CurrentUser() user: any,
    @Body() body: { weekStart: string; action: 'publish' | 'lock' | 'unlock' | 'revert_to_draft'; notes?: string },
  ) {
    const res = await this.svc.setWeekStatus(user.tenantId, body.weekStart, user.userId, body.action, body.notes);
    rosterCacheInvalidate();   // publishing or reverting a week changes what every grid shows
    return res;
  }
}
