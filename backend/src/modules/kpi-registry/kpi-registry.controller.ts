import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { KpiRegistryService } from './kpi-registry.service';

/**
 * KPI Registry (Scorecard program wave B1). Read = anyone who can see all
 * scorecards; mutate = scorecard.edit (admin/WFM) — mirrors scorecard.controller
 * gating. Additive: nothing reads the registry in the scoring path yet.
 */
@ApiTags('KPI Registry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('scorecard.view_all')
@Controller({ path: 'kpi-registry', version: '1' })
export class KpiRegistryController {
  constructor(private readonly svc: KpiRegistryService) {}

  @Get()
  @ApiOperation({ summary: 'List every registered KPI with function configs (the rulebook)' })
  list(@CurrentUser() user: any, @Query('activeOnly') activeOnly?: string) {
    return this.svc.list(user.tenantId, activeOnly !== 'true');
  }

  @Get(':code')
  @ApiOperation({ summary: 'One KPI by code, with configs + full formula-version history' })
  get(@CurrentUser() user: any, @Param('code') code: string) {
    return this.svc.getByCode(user.tenantId, code);
  }

  @Patch(':code')
  @RequirePermissions('scorecard.edit')
  @ApiOperation({ summary: 'Update a KPI / its band config — audited + appends an immutable formula version' })
  patch(@CurrentUser() user: any, @Param('code') code: string, @Body() body: any) {
    return this.svc.patch(user.tenantId, code, body ?? {}, user);
  }
}
