import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { MeService } from './me.service';

@ApiTags('Me — Self Service')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('attendance.view_own')   // every employee can see their own data
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Personal overview for the logged-in employee — shift distribution, adherence, score, schedule' })
  overview(@CurrentUser() user: any) {
    return this.me.getOverview(user.tenantId, user.employeeId ?? null);
  }

  @Get('attendance')
  @ApiOperation({ summary: 'Own attendance detail — punch/system times, late, early-out, OT, permissions, leave balance (self only)' })
  attendance(@CurrentUser() user: any) {
    return this.me.getAttendanceDetail(user.tenantId, user.employeeId ?? null);
  }
}
