import { Controller, Get, Post, Body, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { LeaveBalancesService } from './leave-balances.service';

@ApiTags('Leave Balances')
@ApiBearerAuth()
@Controller({ path: 'leave-balances', version: '1' })
@UseGuards(JwtAuthGuard)
export class LeaveBalancesController {
  constructor(private readonly svc: LeaveBalancesService) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  /** Non-supervisors may only query their own balance — prevents reading peers' balances. */
  private scopeEmployee(user: any, requested: string): string {
    const perms = user?.permissionCodes ?? user?.permissions ?? [];
    if (perms.includes('requests.view_team') || perms.includes('requests.view_all')) return requested;
    return user?.employeeId ?? '00000000-0000-0000-0000-000000000000';
  }

  @Get()
  @RequirePermissions('requests.view_own')
  @ApiOperation({ summary: 'Leave balances (entitlement/taken/pending/remaining) for an employee' })
  list(@CurrentUser() user: any, @Query('employeeId') employeeId: string, @Query('year') year?: string) {
    return this.svc.listForEmployee(this.tid(user), this.scopeEmployee(user, employeeId), year ? parseInt(year, 10) : undefined);
  }

  @Get('one')
  @RequirePermissions('requests.view_own')
  @ApiOperation({ summary: 'Single leave-type balance for an employee' })
  one(
    @CurrentUser() user: any,
    @Query('employeeId') employeeId: string,
    @Query('leaveType') leaveType: string,
    @Query('year') year?: string,
  ) {
    return this.svc.getBalance(this.tid(user), this.scopeEmployee(user, employeeId), leaveType, year ? parseInt(year, 10) : undefined);
  }

  @Get('all')
  @RequirePermissions('requests.view_team')
  @ApiOperation({ summary: 'Admin grid: every active employee with their leave balances for a year' })
  all(@CurrentUser() user: any, @Query('year') year?: string) {
    return this.svc.listAllEmployees(this.tid(user), year ? parseInt(year, 10) : undefined);
  }

  @Post('entitlement')
  @RequirePermissions('requests.approve_l1')
  @ApiOperation({ summary: 'Set/replace the annual entitlement for an employee/type (audited)' })
  setEntitlement(@CurrentUser() user: any, @Body() body: {
    employeeId: string; leaveType: string; year?: number; days: number; notes?: string;
  }) {
    return this.svc.setEntitlement(this.tid(user), user?.id ?? user?.sub ?? null, body);
  }

  @Post('entitlement/bulk')
  @RequirePermissions('requests.approve_l1')
  @ApiOperation({ summary: 'Bulk set entitlements from pasted/imported rows (matched by employee_no)' })
  bulk(@CurrentUser() user: any, @Body() body: {
    year?: number;
    rows: Array<{ employeeNo: string; annual_leave?: number; comp_off?: number; sick_leave?: number }>;
  }) {
    return this.svc.bulkSetEntitlements(this.tid(user), user?.id ?? user?.sub ?? null, body?.year ?? new Date().getFullYear(), Array.isArray(body?.rows) ? body.rows : []);
  }
}
