import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ExpertService } from './expert.service';

class AskDto { @IsString() @MaxLength(600) question!: string; }

@ApiTags('Expert Advisor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'expert', version: '1' })
export class ExpertController {
  constructor(private readonly svc: ExpertService) {}

  @Get('status')
  status() { return this.svc.status(); }

  @Get('topics')
  @ApiOperation({ summary: 'List knowledge topics' })
  topics() { return this.svc.topics(); }

  @Get('knowledge')
  @ApiOperation({ summary: 'Full knowledge body (optionally by topic)' })
  knowledge(@Query('topic') topic?: string) { return this.svc.knowledge(topic); }

  @Post('ask')
  @ApiOperation({ summary: 'Ask the expert (knowledge-grounded)' })
  ask(@CurrentUser() u: any, @Body() dto: AskDto) { return this.svc.ask(u.tenantId, dto.question); }
}
