import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { SmokeTestService } from './smoke-test.service';

@ApiTags('Smoke Test')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('audit.view')   // deny-by-default flip 2026-07-06 — system-wide smoke results are admin diagnostics
@Controller({ path: 'smoke-test', version: '1' })
export class SmokeTestController {
  constructor(private readonly svc: SmokeTestService) {}

  @Get()
  @ApiOperation({ summary: 'Exercise key write/feature paths to catch functional bugs' })
  run(@CurrentUser() user: any) {
    return this.svc.run(user.tenantId, user.id ?? user.sub);
  }
}
