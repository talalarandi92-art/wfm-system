import { Controller, Post, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { SlaEscalationService } from './sla-escalation.service';

@ApiTags('SLA Escalation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'sla', version: '1' })
export class SlaEscalationController {
  constructor(private readonly svc: SlaEscalationService) {}

  /** Manual trigger (also runs automatically every 3 min in the background). */
  @Post('escalate-overdue')
  @RequirePermissions('rta.override')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Escalate all overdue (SLA-breached) pending requests now' })
  async escalateNow() {
    const escalated = await this.svc.escalateOverdue();
    return { ok: true, escalated };
  }
}
