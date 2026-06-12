import { Controller, Get, Post, Body, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { CapacityService, VoiceInputs, ChatInputs, EmailInputs } from './capacity.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

@Controller('capacity')
@UseGuards(JwtAuthGuard)
@RequirePermissions('hc.view')
export class CapacityController {
  constructor(private readonly svc: CapacityService) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  @Get('functions')
  getFunctions(@CurrentUser() user: any) {
    return this.svc.getFunctions(this.tid(user));
  }

  @Get('hc-overview')
  getHcOverview(@CurrentUser() user: any, @Query('date') date: string) {
    const d = date || new Date().toISOString().slice(0, 10);
    return this.svc.getCurrentHcOverview(this.tid(user), d);
  }

  @Get('hc-by-interval')
  getHcByInterval(
    @CurrentUser() user: any,
    @Query('functionId') functionId: string,
    @Query('date') date: string,
  ) {
    const d = date || new Date().toISOString().slice(0, 10);
    return this.svc.getHcByInterval(this.tid(user), functionId, d);
  }

  @Post('erlang')
  calculateVoice(
    @CurrentUser() user: any,
    @Body() body: { functionId: string; date: string; inputs: VoiceInputs },
  ) {
    return this.svc.calculateVoice(this.tid(user), body.functionId, body.date, body.inputs);
  }

  @Post('concurrent')
  calculateChat(
    @CurrentUser() user: any,
    @Body() body: { functionId: string; date: string; inputs: ChatInputs },
  ) {
    return this.svc.calculateChat(this.tid(user), body.functionId, body.date, body.inputs);
  }

  @Post('email')
  calculateEmail(
    @CurrentUser() user: any,
    @Body() body: { functionId: string; date: string; inputs: EmailInputs },
  ) {
    return this.svc.calculateEmail(this.tid(user), body.functionId, body.date, body.inputs);
  }
}
