import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AutoModeService } from './automode.service';

class SettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() autoApprove?: boolean;
  @IsOptional() @IsBoolean() autoReject?: boolean;
  @IsOptional() @IsArray() allowedTypes?: string[];
}

@ApiTags('Auto Mode')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'automode', version: '1' })
export class AutoModeController {
  constructor(private readonly svc: AutoModeService) {}

  @Get('settings')
  settings(@CurrentUser() u: any) { return this.svc.getSettings(u.tenantId); }

  @Post('settings')
  @ApiOperation({ summary: 'Update Auto Mode switches (off by default; reject opt-in)' })
  save(@CurrentUser() u: any, @Body() dto: SettingsDto) { return this.svc.saveSettings(u.tenantId, u.id ?? u.sub, dto); }

  @Get('decisions')
  decisions(@CurrentUser() u: any) { return this.svc.listDecisions(u.tenantId); }

  @Post('decisions/:id/revert')
  @ApiOperation({ summary: 'Undo an automated decision (back to pending)' })
  revert(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.revert(u.tenantId, id, u.id ?? u.sub); }

  @Post('run')
  @ApiOperation({ summary: 'Run an Auto Mode pass now' })
  run(@CurrentUser() u: any) { return this.svc.tick(u.tenantId); }
}
