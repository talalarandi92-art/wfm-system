import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AnalystService } from './analyst.service';

class FeedbackDto {
  @IsString() recId!: string;
  @IsIn(['accepted', 'rejected']) decision!: 'accepted' | 'rejected';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@ApiTags('Analyst')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'analyst', version: '1' })
export class AnalystController {
  constructor(private readonly svc: AnalystService) {}

  @Get('assessment')
  @ApiOperation({ summary: 'Full WFM/RTA situation assessment + recommendations' })
  async assessment(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.svc.assess(user.tenantId, date);
  }

  @Post('feedback')
  @ApiOperation({ summary: 'Accept/reject a recommendation — tunes the analyst (learning)' })
  async feedback(@CurrentUser() user: any, @Body() dto: FeedbackDto) {
    return this.svc.feedback(user.tenantId, dto.recId, dto.decision, user.id ?? user.sub, dto.note);
  }

  @Get('history')
  @ApiOperation({ summary: 'Past recommendations + operator decisions' })
  async history(@CurrentUser() user: any) {
    return this.svc.history(user.tenantId);
  }
}
