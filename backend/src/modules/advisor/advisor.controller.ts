import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AdvisorService } from './advisor.service';

class AskDto {
  @IsString() @MaxLength(600) question!: string;
  @IsOptional() @IsString() date?: string;
}

@ApiTags('Advisor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'advisor', version: '1' })
@RequirePermissions('hc.view')
export class AdvisorController {
  constructor(private readonly svc: AdvisorService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the LLM advisor is configured' })
  status() { return this.svc.status(); }

  @Get('brief')
  @ApiOperation({ summary: 'Narrate the current situation' })
  brief(@CurrentUser() u: any, @Query('date') date?: string) { return this.svc.brief(u.tenantId, date); }

  @Post('ask')
  @ApiOperation({ summary: 'Ask the advisor a free-form question' })
  ask(@CurrentUser() u: any, @Body() dto: AskDto) { return this.svc.ask(u.tenantId, dto.question, dto.date); }

  @Get('improvements')
  @ApiOperation({ summary: 'Proposed system / design / process improvements' })
  improvements(@CurrentUser() u: any) { return this.svc.improvements(u.tenantId); }
}
