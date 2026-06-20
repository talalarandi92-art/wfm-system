import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ScorecardGuardService } from './scorecard-guard.service';

@ApiTags('Scorecard Guard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'scorecard-guard', version: '1' })
@RequirePermissions('hc.view')
export class ScorecardGuardController {
  constructor(private readonly svc: ScorecardGuardService) {}

  @Get('weeks')
  weeks(@CurrentUser() u: any) { return this.svc.weeks(u.tenantId); }

  @Get('review')
  @ApiOperation({ summary: 'Build + review the scorecard for a week/function' })
  review(@CurrentUser() u: any, @Query('week') week?: string, @Query('functionName') fn?: string) {
    return this.svc.review(u.tenantId, week, fn);
  }

  @Post('scan')
  @ApiOperation({ summary: 'Flag repeat under-performers into coaching' })
  scan(@CurrentUser() u: any) { return this.svc.scan(u.tenantId); }
}
