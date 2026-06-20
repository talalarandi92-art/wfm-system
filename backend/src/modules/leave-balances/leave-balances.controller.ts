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

  @Get()
  @RequirePermissions('requests.view_own')
  @ApiOperation({ summary: 'Leave balances (entitlement/taken/pending/remaining) for an employee' })
  list(@CurrentUser() user: any, @Query('employeeId') employeeId: string, @Query('year') year?: string) {
    return this.svc.listForEmployee(this.tid(user), employeeId, year ? parseInt(year, 10) : undefined);
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
    return this.svc.getBalance(this.tid(user), employeeId, leaveType, year ? parseInt(year, 10) : undefined);
  }

  @Post('entitlement')
  @RequirePermissions('requests.approve_l1')
  @ApiOperation({ summary: 'Set/replace the annual entitlement for an employee/type (audited)' })
  setEntitlement(@CurrentUser() user: any, @Body() body: {
    employeeId: string; leaveType: string; year?: number; days: number; notes?: string;
  }) {
    return this.svc.setEntitlement(this.tid(user), user?.id ?? user?.sub ?? null, body);
  }
}
