import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResearcherService } from './researcher.service';

@ApiTags('Researcher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'researcher', version: '1' })
@RequirePermissions('hc.view')
export class ResearcherController {
  constructor(private readonly svc: ResearcherService) {}

  @Get('status')
  status(@Request() req: any) { return this.svc.status(req.user.tenantId); }

  @Get('feed')
  @ApiOperation({ summary: 'WFM research feed + gaps, live-detected vs our platform' })
  feed(@Request() req: any) { return this.svc.feed(req.user.tenantId); }

  @Get('digest')
  @ApiOperation({ summary: 'Top improvement opportunities (live gaps; LLM-synthesized when keyed)' })
  digest(@Request() req: any) {
    const lang = req.query?.lang === 'en' ? 'en' : 'ar';
    return this.svc.digest(req.user.tenantId, lang);
  }
}
