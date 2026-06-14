import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { ResearcherService } from './researcher.service';

@ApiTags('Researcher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'researcher', version: '1' })
export class ResearcherController {
  constructor(private readonly svc: ResearcherService) {}

  @Get('status')
  status() { return this.svc.status(); }

  @Get('feed')
  @ApiOperation({ summary: 'Curated WFM research feed + gaps vs our platform' })
  feed() { return this.svc.feed(); }

  @Get('digest')
  @ApiOperation({ summary: 'Top improvement opportunities (LLM-synthesized when keyed)' })
  digest() { return this.svc.digest(); }
}
