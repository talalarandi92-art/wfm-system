import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { SecurityGuardService, Lang } from './security-guard.service';

@ApiTags('Security Guard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'security-guard', version: '1' })
export class SecurityGuardController {
  constructor(private readonly svc: SecurityGuardService) {}

  @Get()
  @ApiOperation({ summary: 'Run the security/compliance battery for the current tenant' })
  async run(@CurrentUser() user: any, @Query('lang') lang?: string) {
    return this.svc.run(user.tenantId, lang === 'en' ? 'en' : 'ar');
  }
}
