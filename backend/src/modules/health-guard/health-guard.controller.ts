import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { HealthGuardService } from './health-guard.service';

/**
 * System Integrity & Health Guard — verifies the platform is healthy AND that the
 * live schedule obeys the codified business rules. Deterministic, on-demand.
 */
@ApiTags('Health Guard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'health-guard', version: '1' })
export class HealthGuardController {
  constructor(private readonly svc: HealthGuardService) {}

  @Get()
  @ApiOperation({ summary: 'Run the full integrity + health battery for the current tenant' })
  async run(@CurrentUser() user: any) {
    return this.svc.run(user.tenantId);
  }
}
