import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, UnauthorizedException,
  UseInterceptors, UploadedFile, BadRequestException, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { CapacityService, VoiceInputs, ChatInputs, EmailInputs } from './capacity.service';
import { StaffingService } from './staffing.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

@Controller('capacity')
@UseGuards(JwtAuthGuard)
@RequirePermissions('hc.view')
export class CapacityController {
  constructor(
    private readonly svc: CapacityService,
    private readonly staffing: StaffingService,
  ) {}

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

  /* ── Staffing Requirement Engine (forecast → Erlang → generator) ─────────── */

  /** Per-function staffing parameters (CPO/AHT/ACW/Hold/SL/occupancy/shrinkage/productivity). */
  @Get('staffing/params')
  getStaffingParams(@CurrentUser() user: any) {
    return this.staffing.getParams(this.tid(user));
  }

  @Patch('staffing/params/:functionKey')
  @RequirePermissions('hc.edit')
  updateStaffingParams(
    @CurrentUser() user: any,
    @Param('functionKey') functionKey: string,
    @Body() patch: Record<string, any>,
  ) {
    return this.staffing.updateParams(this.tid(user), functionKey, patch, user.id);
  }

  /**
   * GET /capacity/staffing/requirement?from&to&ordersScale=1.0
   * THE hourly per-function required-HC (the generator's demand basis):
   * forecast volume → effective AHT → Erlang-C @ SL/occupancy → productivity → shrinkage.
   * Full math returned per cell.
   */
  @Get('staffing/requirement')
  getStaffingRequirement(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('ordersScale') ordersScale?: string,
    @Query('functions') functions?: string,
  ) {
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return this.staffing.hourlyRequirement(this.tid(user), from || today, to || from || today, {
      ordersScale: ordersScale ? +ordersScale : undefined,
      functionKeys: functions ? functions.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    });
  }

  /* ── Event / period forecast (Excel in, hiring verdict out) ─────────────── */

  /** Download the fill-in template (Instructions + Daily_Forecast + Available_Agents). */
  @Get('staffing/event-template')
  async eventTemplate(@CurrentUser() user: any, @Res() res: Response) {
    const buf = await this.staffing.eventTemplate(this.tid(user));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="WFM_Event_Forecast_Template.xlsx"');
    res.send(buf);
  }

  /** Upload the filled template → per-function required peak, gap, interns to hire, SL now/after. */
  @Post('staffing/event-forecast')
  @RequirePermissions('hc.edit')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadEventForecast(
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { name?: string },
  ) {
    if (!file?.buffer) throw new BadRequestException('Attach the filled template as "file"');
    return this.staffing.uploadEventForecast(this.tid(user), user.id ?? null, file.originalname, file.buffer, body?.name);
  }

  @Get('staffing/event-forecasts')
  listEventForecasts(@CurrentUser() user: any) {
    return this.staffing.listEventForecasts(this.tid(user));
  }

  /** Instant "how many to hire" — forecast requirement vs the CURRENT team (no Excel).
   *  otPct = OT allowance scenario (0.10 = 10%): hires needed after OT + the OT hours it costs. */
  @Get('staffing/hiring-now')
  hiringNow(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('internProductivity') ip?: string,
    @Query('otPct') otPct?: string,
  ) {
    const d0 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const d6 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return this.staffing.hiringNow(this.tid(user), from || d0, to || d6,
      ip ? Math.min(Math.max(+ip, 0.2), 1) : 0.7,
      otPct ? Math.min(Math.max(+otPct, 0), 0.3) : 0);
  }

  /* ── Analysis layer (Stage 1A): backtest / scenarios / insights ─────────── */

  /**
   * GET /capacity/staffing/forecast-accuracy?days=28&asOf=YYYY-MM-DD
   * Backtest of the engine's own same-weekday baseline vs measured actuals —
   * per-channel WAPE/bias + per-day rows. Anchored at the last measured day.
   */
  @Get('staffing/forecast-accuracy')
  forecastAccuracy(
    @CurrentUser() user: any,
    @Query('days') days?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.staffing.forecastAccuracy(this.tid(user), days ? +days : 28, asOf || undefined);
  }

  /**
   * GET /capacity/staffing/scenario-compare?from&to&internProductivity=0.7
   * Requirement + hiring verdict under base ×1.0 / surge ×1.2 / quiet ×0.85 /
   * base+OT-10% — one call, side-by-side (no 4 round-trips).
   */
  @Get('staffing/scenario-compare')
  scenarioCompare(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('internProductivity') ip?: string,
  ) {
    const d0 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const d6 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return this.staffing.scenarioCompare(this.tid(user), from || d0, to || d6,
      ip ? Math.min(Math.max(+ip, 0.2), 1) : 0.7);
  }

  /**
   * GET /capacity/staffing/insights?from&to
   * Computed insight bullets (peak day/hour per function, tightest team, unstaffable
   * hours, learned-floor coverage, WoW volume mover, overstaff) — each with a
   * `metric` + `severity`. Pure derivations from the real numbers, no LLM.
   */
  @Get('staffing/insights')
  staffingInsights(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const d0 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const d6 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return this.staffing.staffingInsights(this.tid(user), from || d0, to || d6);
  }

  /** What the learning store has learned so far (coverage + per-channel 7×24 P90 heat). */
  @Get('staffing/learned')
  learnedSummary(@CurrentUser() user: any) {
    return this.staffing.learnedSummary(this.tid(user));
  }

  /** Manually trigger the learning-store rollup (the observer also runs hourly). */
  @Post('staffing/observations/rollup')
  @RequirePermissions('hc.edit')
  rollupObservations(@CurrentUser() user: any, @Query('hoursBack') hoursBack?: string) {
    return this.staffing.rollupObservations(this.tid(user), hoursBack ? Math.min(+hoursBack, 24 * 14) : 48);
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
