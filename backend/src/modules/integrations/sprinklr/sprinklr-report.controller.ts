import {
  Controller, Post, Get, Body, Query, Request,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { SprinklrReportService, IncomingReport } from './sprinklr-report.service';

/**
 * Auto-Ingest wave A0 — Sprinklr reporting-TABLE receiver.
 *
 * Separate from SprinklrController's /push (live agent-status snapshots). The chrome extension
 * POSTs captured reporting TABLES (login/logout · survey · agent-perf) here; we stage them into
 * sprinklr_report_staging idempotently. This is the enabler that ends manual Sprinklr Excel
 * uploads — later waves read the staging table and emit the recon "Login and Logout sprinklr" shape.
 *
 * Auth mirrors the existing Sprinklr push exactly: JWT + rta.view (the bridge service account).
 */
@ApiTags('Integrations — Sprinklr Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('rta.view')
@Controller('integrations/sprinklr')
export class SprinklrReportController {
  constructor(private readonly reports: SprinklrReportService) {}

  /**
   * POST /integrations/sprinklr/report-push
   * Body: a single report or { reports: [...] }. Each report = { reportType, sourceOp,
   * columns, rows:[{dims,measures,expandedKey}], rawSample }.
   */
  @Post('report-push')
  @ApiOperation({ summary: 'Receive captured Sprinklr reporting-table rows from the Chrome Extension' })
  @HttpCode(HttpStatus.OK)
  async reportPush(@Request() req: any, @Body() body: any) {
    const reports: IncomingReport[] = Array.isArray(body?.reports)
      ? body.reports
      : (body && (body.rows || body.reportType) ? [body] : []);
    if (!reports.length) return { ok: true, staged: 0, skipped: 0, byType: {}, note: 'no reports in body' };
    const result = await this.reports.ingestReports(req.user.tenantId, reports);
    return { ok: true, ...result };
  }

  /**
   * GET /integrations/sprinklr/report-staging?type&from&to&limit&normalize=1
   * Inspect staged reports; ?normalize=1 previews the parsed login_logout / survey rows.
   */
  @Get('report-staging')
  @ApiOperation({ summary: 'Inspect staged Sprinklr reports (per-type counts + rows; optional normalized preview)' })
  async reportStaging(
    @Request() req: any,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('normalize') normalize?: string,
  ) {
    return this.reports.getStaging(req.user.tenantId, {
      type,
      from: /^\d{4}-\d{2}-\d{2}/.test(from ?? '') ? from : undefined,
      to: /^\d{4}-\d{2}-\d{2}/.test(to ?? '') ? to : undefined,
      limit: limit ? +limit : undefined,
      normalize: normalize === '1' || normalize === 'true',
    });
  }
}
