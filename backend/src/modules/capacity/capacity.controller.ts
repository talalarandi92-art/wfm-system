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

  /**
   * GET /capacity/live-plan?date=YYYY-MM-DD&sl=0.8&answerSec=60&aht=300&shrinkage=0.25
   * Capacity plan from MEASURED Sprinklr workload (Erlang-C on concurrent load),
   * per 30-min interval vs scheduled HC.
   */
  @Get('live-plan')
  getLivePlan(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('sl') sl?: string,
    @Query('answerSec') answerSec?: string,
    @Query('aht') aht?: string,
    @Query('shrinkage') shrinkage?: string,
    @Query('occupancy') occupancy?: string,
    @Query('concurrency') concurrency?: string,
  ) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
      ? date!
      : new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return this.svc.getLivePlan(this.tid(user), d, {
      targetSL:        sl          ? Math.min(0.99, Math.max(0.5, +sl))        : undefined,
      targetAnswerSec: answerSec   ? Math.max(5, +answerSec)                   : undefined,
      ahtSec:          aht         ? Math.max(30, +aht)                        : undefined,
      shrinkage:       shrinkage   ? Math.min(0.9, Math.max(0, +shrinkage))    : undefined,
      occupancyCap:    occupancy   ? Math.min(0.95, Math.max(0.5, +occupancy)) : undefined,
      concurrency:     concurrency ? Math.max(1, +concurrency)                 : undefined,
    });
  }

  /**
   * GET /capacity/function-hourly?date=YYYY-MM-DD
   * HC per function per hour: scheduled / actual (live) / required by channel.
   */
  @Get('function-hourly')
  getFunctionHourly(@CurrentUser() user: any, @Query('date') date?: string) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
      ? date!
      : new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return this.svc.getFunctionHourly(this.tid(user), d);
  }

  /** Saved scenarios */
  @Get('scenarios')
  listScenarios(@CurrentUser() user: any, @Query('channel') channel?: string) {
    return this.svc.listScenarios(this.tid(user), channel);
  }

  @Post('scenarios')
  @RequirePermissions('hc.edit')
  saveScenario(
    @CurrentUser() user: any,
    @Body() body: { name: string; channel: string; scenarioType?: string; inputs: any; results: any; notes?: string },
  ) {
    return this.svc.saveScenario(this.tid(user), user.id, body);
  }

  @Post('scenarios/delete')
  @RequirePermissions('hc.edit')
  deleteScenario(@CurrentUser() user: any, @Body() body: { id: string }) {
    return this.svc.deleteScenario(this.tid(user), body.id);
  }
}
