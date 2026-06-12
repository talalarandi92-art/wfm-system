import {
  Controller, Get, Post, Put, Body, Query, Param,
  Request, UseGuards, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { SprinklrService } from './sprinklr.service';
import { SprinklrSnapshot, SprinklrApiConfig } from './sprinklr.types';

@ApiTags('Integrations — Sprinklr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('rta.view')   // default: every Sprinklr endpoint needs RTA access
@Controller('integrations/sprinklr')
export class SprinklrController {
  constructor(private readonly sprinklr: SprinklrService) {}

  /**
   * POST /integrations/sprinklr/push
   * Chrome Extension sends normalized snapshot here every 30s.
   */
  @Post('push')
  @ApiOperation({ summary: 'Receive Sprinklr snapshot from Chrome Extension' })
  @HttpCode(HttpStatus.OK)
  async push(@Request() req: any, @Body() snapshot: SprinklrSnapshot) {
    await this.sprinklr.ingestSnapshot(req.user.tenantId, snapshot);
    return { ok: true, queues: snapshot.queues.length, agents: snapshot.agents.length };
  }

  /**
   * GET /integrations/sprinklr/live
   * RTA dashboard polls this to show live Sprinklr data.
   */
  @Get('live')
  @ApiOperation({ summary: 'Get latest Sprinklr live data (queues + agents)' })
  getLive(@Request() req: any) {
    return this.sprinklr.getQueueSummary(req.user.tenantId);
  }

  /**
   * GET /integrations/sprinklr/snapshot
   * Raw latest snapshot.
   */
  @Get('snapshot')
  getSnapshot(@Request() req: any) {
    return this.sprinklr.getLatestSnapshot(req.user.tenantId);
  }

  /**
   * POST /integrations/sprinklr/poll
   * Trigger a manual poll from the direct Sprinklr API (when key is configured).
   */
  @Post('poll')
  @RequirePermissions('rta.override')
  @ApiOperation({ summary: 'Poll Sprinklr API directly (requires API key in settings)' })
  @HttpCode(HttpStatus.OK)
  async pollNow(@Request() req: any) {
    await this.sprinklr.pollFromApi(req.user.tenantId);
    return { ok: true, snapshot: await this.sprinklr.getLatestSnapshot(req.user.tenantId) };
  }

  /**
   * GET /integrations/sprinklr/config
   * Get current API config.
   */
  @Get('config')
  @ApiOperation({ summary: 'Get Sprinklr API configuration' })
  async getConfig(@Request() req: any) {
    const cfg = await this.sprinklr.getApiConfig(req.user.tenantId);
    // Mask the API key
    if (cfg?.apiKey) cfg.apiKey = cfg.apiKey.slice(0, 6) + '••••••••';
    return cfg;
  }

  /**
   * PUT /integrations/sprinklr/config
   * Save Sprinklr API credentials.
   */
  @Put('config')
  @RequirePermissions('settings.edit')
  @ApiOperation({ summary: 'Save Sprinklr API credentials' })
  async saveConfig(@Request() req: any, @Body() config: SprinklrApiConfig) {
    await this.sprinklr.saveApiConfig(req.user.tenantId, config);
    return { ok: true };
  }

  /**
   * GET /integrations/sprinklr/history
   * Last N hours of snapshot metadata (for audit / trend).
   */
  @Get('history')
  @ApiOperation({ summary: 'Snapshot ingestion history' })
  getHistory(@Request() req: any, @Query('hours') hours = '24') {
    return this.sprinklr.getHistory(req.user.tenantId, +hours);
  }

  /**
   * GET /integrations/sprinklr/break-tracker
   * Who is on break, authorized vs not, break count and duration per agent today.
   */
  @Get('break-tracker')
  @ApiOperation({ summary: 'Real-time break analysis — who is on break, authorized, history' })
  getBreakTracker(@Request() req: any) {
    return this.sprinklr.getBreakTracker(req.user.tenantId);
  }

  /**
   * GET /integrations/sprinklr/agent-timeline
   * Working hours tracker per agent from Sprinklr status history.
   */
  @Get('agent-timeline')
  @ApiOperation({ summary: 'Agent working hours and status breakdown from status history' })
  getAgentTimeline(@Request() req: any, @Query('hours') hours = '10') {
    return this.sprinklr.getAgentTimeline(req.user.tenantId, +hours);
  }

  /**
   * GET /integrations/sprinklr/permissions-active
   * Active approved permissions right now (reducing HC).
   */
  @Get('permissions-active')
  @ApiOperation({ summary: 'Active permissions currently reducing available HC' })
  getActivePermissions(@Request() req: any) {
    return this.sprinklr.getActivePermissions(req.user.tenantId);
  }

  /**
   * GET /integrations/sprinklr/coverage
   * Schedule vs Sprinklr live HC comparison.
   */
  @Get('coverage')
  @ApiOperation({ summary: 'Coverage comparison: scheduled vs actual vs live Sprinklr' })
  getCoverage(@Request() req: any) {
    return this.sprinklr.getCoverageComparison(req.user.tenantId);
  }

  /**
   * GET /integrations/sprinklr/queue/:queueId
   * Detail for a specific queue: agents, overflow suggestions.
   */
  @Get('queue/:queueId')
  @ApiOperation({ summary: 'Detailed view for a specific queue (agents, overflow)' })
  getQueueDetail(@Request() req: any, @Param('queueId') queueId: string) {
    return this.sprinklr.getQueueDetail(req.user.tenantId, queueId);
  }

  /**
   * GET /integrations/sprinklr/agent-daily?from=YYYY-MM-DD&to=YYYY-MM-DD&refresh=1
   * Per-agent per-day report: first login, last logout, working hours,
   * idle (no case / with case), AHT, response time, contacts.
   * Agents are linked to system employees via email (users.email → employees).
   */
  @Get('agent-daily')
  @ApiOperation({ summary: 'Daily per-agent performance report (linked to employees by email)' })
  async getAgentDaily(
    @Request() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('refresh') refresh?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    const f = /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') ? from! : today;
    const t = /^\d{4}-\d{2}-\d{2}$/.test(to   ?? '') ? to!   : today;
    const report = await this.sprinklr.getAgentDailyReport(req.user.tenantId, f, t, refresh === '1');

    if (format === 'csv') {
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const tm  = (v: any) => (v ? new Date(v).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' }) : '');
      const headers = ['Date', 'Agent', 'Employee No', 'Email', 'First Login', 'Last Logout',
        'Working Min', 'Idle (no case) Min', 'Idle (with case) Min', 'Busy Min',
        'Break Total Min', 'Tea', 'Lunch', 'Bio', 'Prayer',
        'AHT Sec', 'Response Sec', 'Contacts'];
      const lines = report.rows.map((r: any) => {
        const b = typeof r.break_breakdown === 'object' ? (r.break_breakdown || {}) : {};
        return [
          String(r.stat_date).slice(0, 10), esc(r.employee_name || r.agent_name), esc(r.employee_no),
          esc(r.agent_email), tm(r.first_login), tm(r.last_logout),
          r.total_working_minutes, r.idle_no_case_minutes, r.idle_with_case_minutes, r.busy_minutes,
          b.total_break ?? r.break_minutes, b.tea_break ?? 0, b.lunch_break ?? 0, b.bio_break ?? 0, b.prayer_break ?? 0,
          r.aht_seconds ?? '', r.avg_response_seconds ?? '', r.contacts_received ?? '',
        ].join(',');
      });
      const csv = [headers.join(','), ...lines].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="agent_daily_${f}_${t}.csv"`);
      return res!.send('﻿' + csv); // BOM for Excel Arabic
    }

    return report;
  }

  /**
   * GET /integrations/sprinklr/contact-forecast?days=7
   * Contact volume forecast from daily history (weekday-seasonal average).
   */
  @Get('contact-forecast')
  @ApiOperation({ summary: 'Contact volume forecast based on daily agent stats' })
  getContactForecast(@Request() req: any, @Query('days') days = '7') {
    const n = Math.min(31, Math.max(1, +days || 7));
    return this.sprinklr.getContactForecast(req.user.tenantId, n);
  }

  /**
   * GET /integrations/sprinklr/violations?from&to
   * Compliance report: excess breaks (>1h), late login, early logout,
   * off-schedule activity, unauthorized meetings, unauthorized manual dial.
   */
  @Get('violations')
  @ApiOperation({ summary: 'Compliance violations report (breaks, late/early, off-schedule, meetings, manual dial)' })
  async getViolations(
    @Request() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    const f = /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') ? from! : today;
    const t = /^\d{4}-\d{2}-\d{2}$/.test(to   ?? '') ? to!   : today;
    const report = await this.sprinklr.getViolationsReport(req.user.tenantId, f, t);

    if (format === 'csv') {
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const tm  = (v: any) => (v ? new Date(v).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' }) : '');
      const headers = ['Date', 'Agent', 'Employee No', 'Violation', 'Severity', 'Minutes',
        'Shift Start', 'Shift End', 'Actual Time', 'Status'];
      const lines = report.rows.map((r: any) => [
        String(r.violation_date).slice(0, 10), esc(r.employee_name || r.agent_name), esc(r.employee_no),
        r.violation_type, r.severity, r.minutes ?? '',
        tm(r.shift_start), tm(r.shift_end), tm(r.actual_at), r.status,
      ].join(','));
      const csv = [headers.join(','), ...lines].join('\n');
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="violations_${f}_${t}.csv"`);
      return res!.send('﻿' + csv); // BOM for Excel Arabic
    }

    return report;
  }

  /**
   * GET /integrations/sprinklr/compliance-config
   * Current violation thresholds (break limit, grace periods…).
   */
  @Get('compliance-config')
  @ApiOperation({ summary: 'Get compliance thresholds' })
  getComplianceConfig(@Request() req: any) {
    return this.sprinklr.getComplianceConfig(req.user.tenantId);
  }

  /**
   * PUT /integrations/sprinklr/compliance-config
   * Update violation thresholds. Takes effect on next recompute.
   */
  @Put('compliance-config')
  @RequirePermissions('settings.edit')
  @ApiOperation({ summary: 'Update compliance thresholds' })
  saveComplianceConfig(@Request() req: any, @Body() body: Record<string, number>) {
    return this.sprinklr.saveComplianceConfig(req.user.tenantId, body ?? {});
  }

  /**
   * PUT /integrations/sprinklr/violations/:id/status
   * Mark a violation reviewed / justified.
   */
  @Put('violations/:id/status')
  @RequirePermissions('rta.override')
  @ApiOperation({ summary: 'Update violation review status' })
  setViolationStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    // req.user is the full User entity attached by JwtStrategy — id, not sub
    return this.sprinklr.setViolationStatus(req.user.tenantId, id, body?.status, req.user.id);
  }
}
