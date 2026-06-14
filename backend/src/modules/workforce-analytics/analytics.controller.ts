import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('Workforce Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('reports.view')
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('functions')
  @ApiOperation({ summary: 'Function (department) list for the analytics filter' })
  functions(@CurrentUser() u: any) {
    return this.svc.functions(u.tenantId);
  }

  @Get('shift-breakdown')
  @ApiOperation({ summary: 'Per-shift breakdown: present/absent/sick/leave/OT/late/missing/permissions + shrinkage' })
  shiftBreakdown(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('functionId') functionId?: string) {
    return this.svc.shiftBreakdown(u.tenantId, from, to, functionId);
  }

  @Get('shrinkage')
  @ApiOperation({ summary: 'Shrinkage — planned vs unplanned, overall + weekend vs weekday' })
  shrinkage(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('functionId') functionId?: string) {
    return this.svc.shrinkage(u.tenantId, from, to, functionId);
  }

  @Get('shrinkage-trend')
  @ApiOperation({ summary: 'Shrinkage trend bucketed by ISO week and by month' })
  shrinkageTrend(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('functionId') functionId?: string) {
    return this.svc.shrinkageTrend(u.tenantId, from, to, functionId);
  }

  @Get('weekend-fairness')
  @ApiOperation({ summary: 'Per-employee % of weekend days (Thu/Fri/Sat) given off' })
  weekendFairness(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('functionId') functionId?: string) {
    return this.svc.weekendFairness(u.tenantId, from, to, functionId);
  }

  @Get('sick-pattern')
  @ApiOperation({ summary: 'Per-employee sick days — weekend vs weekday split' })
  sickPattern(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('functionId') functionId?: string) {
    return this.svc.sickPattern(u.tenantId, from, to, functionId);
  }

  @Get('hourly-headcount')
  @ApiOperation({ summary: 'Scheduled vs present headcount per hour of day (coverage + shrinkage)' })
  hourlyHeadcount(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('functionId') functionId?: string) {
    return this.svc.hourlyHeadcount(u.tenantId, from, to, functionId);
  }

  @Get('coverage-forecast')
  @ApiOperation({ summary: 'Forecast present headcount per hour for upcoming days (historical weekday×hour avg)' })
  coverageForecast(@CurrentUser() u: any, @Query('weeks') weeks?: string, @Query('horizon') horizon?: string) {
    return this.svc.coverageForecast(u.tenantId, weeks ? parseInt(weeks, 10) : 8, horizon ? parseInt(horizon, 10) : 7);
  }

  @Post('notify-gaps')
  @ApiOperation({ summary: 'Scan coverage gaps and notify RTA/WFM of under-covered hours' })
  notifyGaps(@CurrentUser() u: any, @Query('from') from?: string, @Query('to') to?: string, @Query('threshold') threshold?: string) {
    return this.svc.notifyGaps(u.tenantId, from, to, threshold ? parseInt(threshold, 10) : 10);
  }
}
