import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ChiefService } from './chief.service';

@ApiTags('Chief')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'chief', version: '1' })
@RequirePermissions('hc.view')
export class ChiefController {
  constructor(private readonly svc: ChiefService) {}

  @Get('briefing')
  @ApiOperation({ summary: 'Executive briefing synthesized from the whole guard team' })
  briefing(@CurrentUser() u: any, @Query('date') date?: string, @Query('lang') lang?: string) {
    return this.svc.briefing(u.tenantId, date, lang === 'en' ? 'en' : 'ar');
  }
}
