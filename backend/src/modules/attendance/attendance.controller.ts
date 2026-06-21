import {
  Controller, Get, Param, Query,
  UseGuards, DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AttendanceService, PeriodType } from './attendance.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('attendance.view_team')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  /** Overall summary cards */
  @Get('summary')
  @ApiOperation({ summary: 'Attendance summary cards for admin dashboard' })
  @ApiQuery({ name: 'period', enum: ['today', 'week', 'month', 'custom'], required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to',   required: false })
  summary(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from')  from?: string,
    @Query('to')    to?: string,
  ) {
    return this.svc.getSummary(user.tenantId, period, from, to);
  }

  /** Top late employees */
  @Get('top-late')
  @ApiOperation({ summary: 'Top late employees ranking' })
  @ApiQuery({ name: 'period', enum: ['today', 'week', 'month', 'custom'], required: false })
  @ApiQuery({ name: 'type',   enum: ['punch', 'system', 'both'], required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  topLate(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('type',   new DefaultValuePipe('punch'))  type: 'punch' | 'system' | 'both',
    @Query('limit',  new DefaultValuePipe('15'))     limit: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.svc.getTopLate(user.tenantId, period, from, to, Number(limit), type);
  }

  /** Tardiness vs authorized permission per employee + attendance conformance */
  @Get('tardiness')
  @ApiOperation({ summary: 'Per-employee tardiness (unauthorized) vs permitted + attendance conformance %' })
  @ApiQuery({ name: 'period', enum: ['today', 'week', 'month', 'custom'], required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to',   required: false })
  tardiness(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.svc.getTardiness(user.tenantId, period, from, to);
  }

  /** Tardiness by scheduled-start hour / shift (HC tracker view) */
  @Get('tardiness/by-hour')
  @ApiOperation({ summary: 'By scheduled-start hour & shift: scheduled / present / tardy' })
  @ApiQuery({ name: 'period', enum: ['today', 'week', 'month', 'custom'], required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to',   required: false })
  tardinessByHour(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.svc.getTardinessByHour(user.tenantId, period, from, to);
  }

  /** Attrition by year — resignations vs terminations, rate, leaver list */
  @Get('attrition')
  @ApiOperation({ summary: 'Attrition by year (RES=resignation, TER=termination): leavers, last working day, rate' })
  attrition(@CurrentUser() user: any) {
    return this.svc.getAttrition(user.tenantId);
  }

  /** Peak/holiday OT event calendar (demand signal for forecasting) */
  @Get('peak-events')
  @ApiOperation({ summary: 'Peak/holiday OT events: date range, headcount, OT hours' })
  @ApiQuery({ name: 'year', required: false })
  peakEvents(@CurrentUser() user: any, @Query('year') year?: string) {
    return this.svc.getPeakEvents(user.tenantId, year ? Number(year) : undefined);
  }

  /** Approved OT by month + top OT employees */
  @Get('ot-monthly')
  @ApiOperation({ summary: 'Approved overtime by month (trend) + top OT employees' })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'limit', required: false })
  otMonthly(
    @CurrentUser() user: any,
    @Query('year') year?: string,
    @Query('limit', new DefaultValuePipe('20')) limit?: string,
  ) {
    return this.svc.getOtMonthly(user.tenantId, year ? Number(year) : undefined, Number(limit));
  }

  /** Breakdown by function */
  @Get('by-function')
  @ApiOperation({ summary: 'Attendance metrics grouped by function' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  byFunction(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.svc.getByFunction(user.tenantId, period, from, to);
  }

  /** Attendance markers distribution */
  @Get('markers')
  @ApiOperation({ summary: 'Distribution of attendance markers (present/sick/leave/off...)' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  markers(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.svc.getMarkersDistribution(user.tenantId, period, from, to);
  }

  /** Daily trend (last N days) */
  @Get('daily-trend')
  @ApiOperation({ summary: 'Daily attendance trend' })
  @ApiQuery({ name: 'days', required: false })
  dailyTrend(
    @CurrentUser() user: any,
    @Query('days', new DefaultValuePipe('30')) days: string,
  ) {
    return this.svc.getDailyTrend(user.tenantId, Number(days));
  }

  /** Missing punch/system ranking */
  @Get('missing-ranking')
  @ApiOperation({ summary: 'Top employees with missing punch or system login' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'type',   enum: ['punch', 'system'], required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  missingRanking(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month'))  period: PeriodType,
    @Query('type',   new DefaultValuePipe('punch'))  type: 'punch' | 'system',
    @Query('limit',  new DefaultValuePipe('15'))     limit: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.svc.getMissingRanking(user.tenantId, period, from, to, type, Number(limit));
  }

  /** OT ranking */
  @Get('ot-ranking')
  @ApiOperation({ summary: 'Top OT employees' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  otRanking(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('limit',  new DefaultValuePipe('15'))    limit: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.svc.getOtRanking(user.tenantId, period, from, to, Number(limit));
  }

  /** WFH vs Office breakdown */
  @Get('wfh-breakdown')
  @ApiOperation({ summary: 'WFH vs Office distribution' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  wfhBreakdown(
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.svc.getWfhBreakdown(user.tenantId, period, from, to);
  }

  /** Full employee attendance list */
  @Get('employees')
  @ApiOperation({ summary: 'All employees with attendance stats' })
  @ApiQuery({ name: 'period',     required: false })
  @ApiQuery({ name: 'functionId', required: false })
  @ApiQuery({ name: 'limit',      required: false })
  @ApiQuery({ name: 'offset',     required: false })
  @ApiQuery({ name: 'from',       required: false })
  @ApiQuery({ name: 'to',         required: false })
  employeeList(
    @CurrentUser() user: any,
    @Query('period',     new DefaultValuePipe('month')) period: PeriodType,
    @Query('functionId') functionId?: string,
    @Query('limit',      new DefaultValuePipe('50'))    limit?: string,
    @Query('offset',     new DefaultValuePipe('0'))     offset?: string,
    @Query('from')       from?: string,
    @Query('to')         to?: string,
  ) {
    return this.svc.getEmployeeAttendanceList(
      user.tenantId, period, from, to, functionId,
      Number(limit), Number(offset),
    );
  }

  /** Single agent metrics */
  @Get('agent/:employeeId')
  @RequirePermissions('attendance.view_own')
  @ApiOperation({ summary: 'Personal attendance metrics for one employee' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  agentMetrics(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: any,
    @Query('period', new DefaultValuePipe('month')) period: PeriodType,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.svc.getAgentMetrics(user.tenantId, employeeId, period, from, to);
  }
}
