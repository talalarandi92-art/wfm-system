import {
  Controller, Get, Post, Patch, Body, Param, Query,
  Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { BreaksService } from './breaks.service';

@ApiTags('Breaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('breaks')
export class BreaksController {
  constructor(private readonly breaksService: BreaksService) {}

  // ── Auto-generate break schedule ─────────────────────────────────────────────
  @Post('generate')
  @ApiOperation({ summary: 'Auto-generate break slots for a date (and optional function)' })
  generate(
    @Request() req: any,
    @Body() body: { scheduleDate: string; functionId?: string },
  ) {
    return this.breaksService.generate(req.user.tenantId, body.scheduleDate, body.functionId);
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
    return this.breaksService.getFairness(req.user.tenantId, +year, +month, functionId);
  }

  // ── Break requests: submit ────────────────────────────────────────────────────
  @Post('requests')
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
    },
  ) {
    return this.breaksService.submitRequest(req.user.tenantId, req.user.employeeId, body);
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
  @ApiOperation({ summary: 'List break types' })
  getBreakTypes(@Request() req: any) {
    return this.breaksService.getBreakTypes(req.user.tenantId);
  }

  // ── Prayer times ──────────────────────────────────────────────────────────────
  @Get('prayer-times')
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
