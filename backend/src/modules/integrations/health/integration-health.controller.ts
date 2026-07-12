import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { IntegrationHealthService } from './integration-health.service';

/**
 * Auto-Ingest A4 — Bridge health surface.
 * GET /integrations/health — per-source freshness, staged-row counts, and
 * emitter readiness for the whole session-riding capture pipeline. Read-only.
 */
@ApiTags('Integrations — Bridge Health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('rta.view')
@Controller('integrations/health')
export class IntegrationHealthController {
  constructor(private readonly health: IntegrationHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Auto-ingest bridge health (Sprinklr live/reports · Odoo · Ameyo · emitters)' })
  getHealth(@Request() req: any) {
    return this.health.getHealth(req.user.tenantId);
  }
}
