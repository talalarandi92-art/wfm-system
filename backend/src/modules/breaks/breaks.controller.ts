import {
  Controller, Get, Post, Patch, Body, Param, Query,
  Request, Res, StreamableFile, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { BreaksService } from './breaks.service';
import { BreakPolicyService } from './break-policy.service';
import { BreakReleaseService } from './break-release.service';
import { BreakReportsService } from './break-reports.service';
import { BreakSimulationService } from './break-simulation.service';
import { ReleaseMode } from './break-release.logic';
import { BreakSimScenario } from './break-simulation.logic';

@ApiTags('Breaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('hc.view')   // WFM break planning by default; agent-facing methods relax below
@Controller('breaks')
export class BreaksController {
  constructor(
    private readonly breaksService: BreaksService,
    private readonly policyService: BreakPolicyService,
    private readonly releaseService: BreakReleaseService,
    private readonly reportsService: BreakReportsService,
    private readonly simulationService: BreakSimulationService,
  ) {}

  // ══ B5 — REPORTS (§25) + SIMULATION (§28) ══════════════════════════════════

  // ── Consolidated break reports (read-only) ────────────────────────────────
  @Get('reports')
  @ApiOperation({ summary: 'Consolidated break reports — entitlement/delays/releases/late-returns/overdue/fairness/peak-hours' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'function', required: false })
  getReports(
    @Request() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('function') functionName?: string,
  ) {
    return this.reportsService.getReports(req.user.tenantId, from, to, functionName);
  }

  // ── Excel export of the same report (one sheet per section + Summary) ─────
  @Get('reports/export')
  @ApiOperation({ summary: 'Excel export of the break reports (exceljs, one sheet per section)' })
  async exportReports(
    @Request() req: any,
    @Res({ passthrough: true }) res: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('function') functionName?: string,
  ) {
    const wb = await this.reportsService.buildWorkbook(req.user.tenantId, from, to, functionName);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="break-reports_${from}_${to}.xlsx"`,
    });
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  // ── What-if simulation — DRY-RUN of the optimizer, zero writes ────────────
  @Post('simulate')
  @ApiOperation({ summary: 'Simulate a break plan for a date/scenario (absence %, queue spike, extra staff) — never persisted' })
  simulate(
    @Request() req: any,
    @Body() body: { date: string; function?: string; scenario?: BreakSimScenario },
  ) {
    return this.simulationService.simulate(req.user.tenantId, body);
  }

  // ══ B3 — LIVE RELEASE ENGINE ═══════════════════════════════════════════════

  // ── The waiting line (command-center feed) ────────────────────────────────
  @Get('live-queue')
  @ApiOperation({ summary: 'Live break waiting line — eligible/delayed slots with score, breakdown, risk, ETA' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'function', required: false })
  getLiveQueue(
    @Request() req: any,
    @Query('date') date?: string,
    @Query('function') functionName?: string,
  ) {
    return this.releaseService.getLiveQueue(req.user.tenantId, date, functionName);
  }

  // ── Agent break card ──────────────────────────────────────────────────────
  @Get('my-break-status')
  @RequirePermissions('attendance.view_own')
  @ApiOperation({ summary: 'My break status — balance, next slot, line position, ETA, button states' })
  getMyBreakStatus(@Request() req: any, @Query('date') date?: string) {
    if (!req.user.employeeId) throw new BadRequestException('No employee profile linked to this user.');
    return this.releaseService.getMyBreakStatus(req.user.tenantId, req.user.employeeId, date);
  }

  // ── Manual supervisor release ─────────────────────────────────────────────
  @Post('slots/:id/release')
  @ApiOperation({ summary: 'Manually release a break slot (supervisor) — reason required at risk ≥ orange' })
  releaseSlot(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.releaseService.manualRelease(
      req.user.tenantId, id, { id: req.user.id, email: req.user.email }, body?.reason,
    );
  }

  // ── Agent starts the break (only when released) ───────────────────────────
  @Post('slots/:id/start')
  @RequirePermissions('attendance.view_own')
  @ApiOperation({ summary: 'Start my released break (400 when not released)' })
  startBreak(@Request() req: any, @Param('id') id: string) {
    if (!req.user.employeeId) throw new BadRequestException('No employee profile linked to this user.');
    return this.releaseService.startBreak(req.user.tenantId, id, req.user.employeeId);
  }

  // ── Agent returns from the break ──────────────────────────────────────────
  @Post('slots/:id/return')
  @RequirePermissions('attendance.view_own')
  @ApiOperation({ summary: 'Return from my break — completes the slot and posts the daily balance' })
  returnFromBreak(@Request() req: any, @Param('id') id: string) {
    if (!req.user.employeeId) throw new BadRequestException('No employee profile linked to this user.');
    return this.releaseService.returnFromBreak(req.user.tenantId, id, req.user.employeeId);
  }

  // ── Engine mode switch (emergency freeze etc.) ────────────────────────────
  @Post('engine/mode')
  @ApiOperation({ summary: 'Set release mode (auto|supervisor|hybrid|freeze) on the matching policy row — audited' })
  setEngineMode(
    @Request() req: any,
    @Body() body: { mode: ReleaseMode; function?: string },
  ) {
    return this.releaseService.setMode(
      req.user.tenantId, { id: req.user.id, email: req.user.email }, body?.mode, body?.function,
    );
  }

  // ── Engine status ─────────────────────────────────────────────────────────
  @Get('engine/status')
  @ApiOperation({ summary: 'Break engine status — last tick, per-function risk, data staleness, modes' })
  getEngineStatus(@Request() req: any) {
    return this.releaseService.getEngineStatus(req.user.tenantId);
  }

  // ── Manual tick (ops/dev — same pass the background loop runs) ────────────
  @Post('engine/tick')
  @RequirePermissions('hc.edit')
  @ApiOperation({ summary: 'Run one engine tick now (optionally for a specific planned date)' })
  engineTick(@Request() req: any, @Body() body: { date?: string }) {
    return this.releaseService.tick(body?.date);
  }

  // ── Auto-generate break schedule ─────────────────────────────────────────────
  @Post('generate')
  @ApiOperation({ summary: 'Auto-generate break slots for a date (and optional function)' })
  generate(
    @Request() req: any,
    @Body() body: { scheduleDate: string; functionId?: string },
  ) {
    return this.breaksService.generate(
      req.user.tenantId, body.scheduleDate, body.functionId,
      { id: req.user.id, email: req.user.email },
    );
  }

  // ── Break policies v2 (Smart Break Management policy matrix) ─────────────────
  @Get('policies-v2')
  @ApiOperation({ summary: 'List break policies v2 (entitlement/pattern/protected-hours matrix)' })
  listPoliciesV2(@Request() req: any) {
    return this.policyService.listPolicies(req.user.tenantId);
  }

  @Patch('policies-v2/:id')
  @RequirePermissions('hc.edit')
  @ApiOperation({ summary: 'Update a break policy v2 row (audited)' })
  async updatePolicyV2(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const res = await this.policyService.updatePolicy(req.user.tenantId, id, body);
    if (!res) throw new BadRequestException('Policy not found');
    await this.policyService.audit(
      req.user.tenantId, { id: req.user.id, email: req.user.email },
      'breaks.policy.updated', 'break_policies_v2', id,
      `changed: ${Object.keys(body).join(', ')}`,
    );
    return { success: true, policy: res.after };
  }

  // ── Daily break schedule ──────────────────────────────────────────────────────
  @Get('schedule')
  @ApiOperation({ summary: 'Get break schedule for a date' })
  @ApiQuery({ name: 'date', required: true })
  @ApiQuery({ name: 'functionId', required: false })
  getSchedule(
    @Request() req: any,
    @Query('date') date: string,
    @Query('functionId') functionId?: string,
  ) {
    return this.breaksService.getSchedule(req.user.tenantId, date, functionId);
  }

  // ── Single employee break schedule ───────────────────────────────────────────
  @Get('schedule/employee/:employeeId')
  @ApiOperation({ summary: 'Get break schedule for a specific employee on a date' })
  getEmployeeSchedule(
    @Request() req: any,
    @Param('employeeId') employeeId: string,
    @Query('date') date: string,
  ) {
    return this.breaksService.getEmployeeSchedule(req.user.tenantId, employeeId, date);
  }

  // ── My breaks (agent self-view) ───────────────────────────────────────────────
  @Get('my-breaks')
  @RequirePermissions('attendance.view_own')
  @ApiOperation({ summary: 'Get my break schedule (agent self-view)' })
  getMyBreaks(@Request() req: any, @Query('date') date: string) {
    if (!req.user.employeeId) return [];
    return this.breaksService.getEmployeeSchedule(req.user.tenantId, req.user.employeeId, date);
  }

  // ── Coverage impact ───────────────────────────────────────────────────────────
  @Get('coverage')
  @ApiOperation({ summary: 'Coverage by interval with break impact' })
  @ApiQuery({ name: 'date', required: true })
  @ApiQuery({ name: 'functionId', required: false })
  getCoverage(
    @Request() req: any,
    @Query('date') date: string,
    @Query('functionId') functionId?: string,
  ) {
    return this.breaksService.getCoverage(req.user.tenantId, date, functionId);
  }

  // ── Adherence report ──────────────────────────────────────────────────────────
  @Get('adherence')
  @ApiOperation({ summary: 'Break adherence report for a date' })
  @ApiQuery({ name: 'date', required: true })
  @ApiQuery({ name: 'functionId', required: false })
  getAdherence(
    @Request() req: any,
    @Query('date') date: string,
    @Query('functionId') functionId?: string,
  ) {
    return this.breaksService.getAdherence(req.user.tenantId, date, functionId);
  }

  // ── Fairness report ───────────────────────────────────────────────────────────
  @Get('fairness')
  @ApiOperation({ summary: 'Break fairness ledger for a month' })
  @ApiQuery({ name: 'year', required: true })
  @ApiQuery({ name: 'month', required: true })
  @ApiQuery({ name: 'functionId', required: false })
  getFairness(
    @Request() req: any,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('functionId') functionId?: string,
  ) {
    const y = parseInt(year, 10), m = parseInt(month, 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12)
      throw new BadRequestException('Query params "year" and "month" (1-12) are required.');
    return this.breaksService.getFairness(req.user.tenantId, y, m, functionId);
  }

  // ── Break requests: submit ────────────────────────────────────────────────────
  @Post('requests')
  @RequirePermissions('requests.create')
  @ApiOperation({ summary: 'Submit a break change request' })
  @HttpCode(HttpStatus.CREATED)
  submitRequest(
    @Request() req: any,
    @Body() body: {
      scheduleDate: string;
      breakTypeId: string;
      requestedStart: string;
      requestedEnd: string;
      reason?: string;
      breakSlotId?: string;
      overrideEntitlement?: boolean;
    },
  ) {
    return this.breaksService.submitRequest(
      req.user.tenantId, req.user.employeeId, body,
      { id: req.user.id, email: req.user.email },
    );
  }

  // ── Break requests: list ──────────────────────────────────────────────────────
  @Get('requests')
  @ApiOperation({ summary: 'List break requests' })
  listRequests(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('employeeId') employeeId?: string,
    @Query('functionId') functionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.breaksService.listRequests(req.user.tenantId, {
      status, employeeId, functionId, dateFrom, dateTo,
      page: page ? +page : 1,
      limit: limit ? +limit : 20,
    });
  }

  // ── Break requests: approve ───────────────────────────────────────────────────
  @Patch('requests/:id/approve')
  @ApiOperation({ summary: 'Approve a break request' })
  approveRequest(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return this.breaksService.approveRequest(req.user.tenantId, id, req.user.id, body.comment);
  }

  // ── Break requests: reject ────────────────────────────────────────────────────
  @Patch('requests/:id/reject')
  @ApiOperation({ summary: 'Reject a break request' })
  rejectRequest(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.breaksService.rejectRequest(req.user.tenantId, id, req.user.id, body.reason);
  }

  // ── Record actual break time (RTA) ────────────────────────────────────────────
  @Patch('slots/:id/actual')
  @ApiOperation({ summary: 'Record actual break start/end (RTA use)' })
  recordActual(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { actualStart?: string; actualEnd?: string; status: string; notes?: string },
  ) {
    return this.breaksService.recordActual(req.user.tenantId, id, body);
  }

  // ── Break types ───────────────────────────────────────────────────────────────
  @Get('types')
  @RequirePermissions('schedule.view')   // reference list, also used by agent break UI
  @ApiOperation({ summary: 'List break types' })
  getBreakTypes(@Request() req: any) {
    return this.breaksService.getBreakTypes(req.user.tenantId);
  }

  // ── Prayer times ──────────────────────────────────────────────────────────────
  @Get('prayer-times')
  @RequirePermissions('schedule.view')   // reference, visible to all staff
  @ApiOperation({ summary: 'Get prayer times for a date' })
  getPrayerTimes(@Request() req: any, @Query('date') date: string) {
    return this.breaksService.getPrayerTimes(req.user.tenantId, date);
  }

  @Post('prayer-times')
  @ApiOperation({ summary: 'Set prayer times for a date' })
  upsertPrayerTimes(
    @Request() req: any,
    @Body() body: { date: string; dhuhr?: string; asr?: string; maghrib?: string },
  ) {
    return this.breaksService.upsertPrayerTimes(req.user.tenantId, body);
  }
}
