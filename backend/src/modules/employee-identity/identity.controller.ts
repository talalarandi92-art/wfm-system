import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { IdentityService } from './identity.service';

/**
 * Employee Identity (Scorecard program wave B2, spec §10).
 * Read gated by `employees.view`; manual resolve/ignore mutate the queue and
 * are audited. ADDITIVE: nothing in the live path reads this map yet.
 */
@ApiTags('Employee Identity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('employees.view')
@Controller({ path: 'employee-identity', version: '1' })
export class IdentityController {
  constructor(private readonly svc: IdentityService) {}

  @Get()
  @ApiOperation({ summary: 'List resolved identities (filters: resolved=true|false, q=)' })
  list(@CurrentUser() user: any, @Query('resolved') resolved?: string, @Query('q') q?: string) {
    return this.svc.list(user.tenantId, { resolved, q });
  }

  @Get('unresolved')
  @ApiOperation({ summary: 'The unresolved-identity review queue (status=open|resolved|ignored)' })
  unresolved(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.svc.unresolved(user.tenantId, status || 'open');
  }

  @Post('refresh')
  @RequirePermissions('employees.edit')
  @ApiOperation({ summary: 'Rebuild the identity map from all sources (idempotent)' })
  refresh(@CurrentUser() user: any) {
    return this.svc.refresh(user.tenantId);
  }

  @Post(':rawId/resolve')
  @RequirePermissions('employees.edit')
  @ApiOperation({ summary: 'Manually link a queued signal to a person_no (audited)' })
  resolve(@CurrentUser() user: any, @Param('rawId') rawId: string, @Body() body: any) {
    return this.svc.resolveManual(user.tenantId, rawId, String(body?.person_no ?? ''), user);
  }

  @Post(':rawId/ignore')
  @RequirePermissions('employees.edit')
  @ApiOperation({ summary: 'Mark a queued signal as ignored (audited)' })
  ignore(@CurrentUser() user: any, @Param('rawId') rawId: string) {
    return this.svc.ignore(user.tenantId, rawId, user);
  }
}
