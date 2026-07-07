import {
  Controller, Get, Post, Param, Body, Query,
  UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { PermissionRequestService } from './permission-request.service';
import { CreatePermissionRequestDto } from './permission-request.types';

@ApiTags('Permission Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('requests.view_own')
@Controller('permission-requests')
export class PermissionRequestController {
  constructor(private readonly svc: PermissionRequestService) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  @Get()
  @RequirePermissions('requests.view_team')   // WFM permission-impact queue; agents see own via /me/attendance
  @ApiOperation({ summary: 'List permission requests' })
  list(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('employeeId') employeeId?: string,
    @Query('functionId') functionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.getRequests(this.tid(user), {
      status,
      employeeId,
      functionId,
      dateFrom,
      dateTo,
      limit:  limit  ? parseInt(limit,  10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('employees')
  @RequirePermissions('requests.view_team')   // employee selector — supervisors only
  @ApiOperation({ summary: 'Get active employees for selector' })
  employees(@CurrentUser() user: any) {
    return this.svc.getEmployees(this.tid(user));
  }

  @Get('weekly-usage')
  @RequirePermissions('requests.view_team')   // any-employee quota lookup — supervisors only
  @ApiOperation({ summary: 'Get weekly permission quota usage for an employee' })
  weeklyUsage(
    @CurrentUser() user: any,
    @Query('employeeId') employeeId: string,
    @Query('date') date?: string,
  ) {
    // Kuwait "today" (+03) — bare toISOString() returns YESTERDAY before 03:00 local (bug #14)
    const targetDate = date ?? new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return this.svc.getWeeklyUsage(this.tid(user), employeeId, targetDate);
  }

  @Get('hc-dashboard')
  @RequirePermissions('requests.view_team')
  @ApiOperation({ summary: 'HC coverage dashboard for a date' })
  hcDashboard(
    @CurrentUser() user: any,
    @Query('date') date?: string,
  ) {
    const targetDate = date ?? new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return this.svc.getHcDashboard(this.tid(user), targetDate);
  }

  @Post('calculate-impact')
  @ApiOperation({ summary: 'Calculate HC impact before submitting a request' })
  calcImpact(
    @CurrentUser() user: any,
    @Body() body: { date: string; startTime: string; endTime: string; functionId?: string },
  ) {
    return this.svc.calculateHcImpact(this.tid(user), {
      date:       body.date,
      startTime:  body.startTime,
      endTime:    body.endTime,
      functionId: body.functionId,
    });
  }

  @Post()
  @RequirePermissions('requests.create')
  @ApiOperation({ summary: 'Submit a new permission request' })
  create(@CurrentUser() user: any, @Body() dto: CreatePermissionRequestDto) {
    return this.svc.createRequest(this.tid(user), dto);
  }

  @Get(':id/impact')
  @ApiOperation({ summary: 'Get request details + live HC impact' })
  getWithImpact(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.getRequestWithImpact(this.tid(user), id);
  }

  /* ── Lifecycle mutations RETIRED (EXECUTION_BRIEF bug #6, 2026-07-08) ──────────
   * approve/reject/cancel had ZERO consumers here and formed a PARALLEL decision
   * path that bypassed the unified owner's idempotency claim and roster apply.
   * ONE owner now: PATCH /requests/:id/approve|reject|cancel (RequestsService —
   * atomic first-wins claim, applyPermissionToRoster, audit, notify).
   * This module keeps what it uniquely owns: CREATE (weekly-quota + 6h-cycle
   * balance checks) and the read/analytics surface (impact, weekly-usage,
   * hc-dashboard). The 2-level L1/L2 approval logic lives on, unexposed, in
   * permission-request.service — re-wire it through the unified owner if/when
   * 2-level approval ships. */
}
