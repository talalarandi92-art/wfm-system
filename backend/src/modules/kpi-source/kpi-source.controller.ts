import {
  Controller, Get, Post, Delete,
  Param, Query, Body, UploadedFile,
  UseInterceptors, UseGuards, HttpCode, HttpStatus,
  UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { KpiSourceService } from './kpi-source.service';

@UseGuards(JwtAuthGuard)
@RequirePermissions('scorecard.view_all')
@Controller('kpi-source')
export class KpiSourceController {
  constructor(private readonly svc: KpiSourceService) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  private uid(user: any): string {
    return user?.userId ?? user?.sub ?? user?.id;
  }

  /* ── Upload preview (no DB write) ─────────────────────────────────────── */
  @Post('upload/preview')
  @RequirePermissions('scorecard.import')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  async preview(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    this.tid(user); // enforce auth context even on preview
    const result = this.svc.parse(file.buffer, file.originalname);
    return {
      periodName:   result.periodName,
      periodYear:   result.periodYear,
      periodMonth:  result.periodMonth,
      totalRows:    result.totalRows,
      totalAgents:  result.totalAgents,
      channelType:  result.channelType,
      functions:    result.functions,
      weekCounts:   result.weekCounts,
      sampleRows:   result.weekSummaries.slice(0, 20),
    };
  }

  /* ── Commit upload to DB ──────────────────────────────────────────────── */
  @Post('upload/commit')
  @RequirePermissions('scorecard.import')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  async commit(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Body() body: {
      periodName?: string; periodYear?: string; periodMonth?: string;
      channelType?: string; notes?: string;
    },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const result = await this.svc.commit(
      file.buffer,
      file.originalname,
      this.tid(user),
      this.uid(user),
      {
        periodName:  body.periodName,
        periodYear:  body.periodYear  ? parseInt(body.periodYear,  10) : undefined,
        periodMonth: body.periodMonth ? parseInt(body.periodMonth, 10) : undefined,
        channelType: body.channelType,
        notes:       body.notes,
      },
    );
    return { success: true, ...result };
  }

  /* ── List batches ─────────────────────────────────────────────────────── */
  @Get('batches')
  async listBatches(@CurrentUser() user: any) {
    const tenantId = this.tid(user);
    return this.svc['ds'].query(
      `SELECT id, period_name, period_year, period_month, channel_type,
              total_rows, total_agents, uploaded_at, status, notes
       FROM kpi_source_batches WHERE tenant_id=$1 ORDER BY period_year DESC, period_month DESC`,
      [tenantId],
    );
  }

  /* ── Get summaries for a batch ────────────────────────────────────────── */
  @Get('batches/:id/summaries')
  async getSummaries(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('week') week?: string,
    @Query('function') fn?: string,
    @Query('agent') agent?: string,
  ) {
    const tenantId = this.tid(user);
    // Verify the batch belongs to this tenant
    const owned = await this.svc['ds'].query(
      `SELECT id FROM kpi_source_batches WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (!owned.length) throw new UnauthorizedException('Batch not found');

    let sql = `SELECT * FROM kpi_weekly_summaries WHERE batch_id=$1`;
    const params: any[] = [id];
    let p = 2;
    if (week)  { sql += ` AND week_label=$${p++}`;    params.push(week); }
    if (fn)    { sql += ` AND function_name=$${p++}`; params.push(fn); }
    if (agent) { sql += ` AND (agent_login ILIKE $${p} OR agent_name ILIKE $${p})`; params.push(`%${agent}%`); p++; }
    sql += ' ORDER BY function_name, agent_name, week_label';
    return this.svc['ds'].query(sql, params);
  }

  /* ── Get agent detail across all weeks ───────────────────────────────── */
  @Get('batches/:id/agent/:login')
  async getAgent(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('login') login: string,
  ) {
    const tenantId = this.tid(user);
    const owned = await this.svc['ds'].query(
      `SELECT id FROM kpi_source_batches WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (!owned.length) throw new UnauthorizedException('Batch not found');

    return this.svc['ds'].query(
      `SELECT * FROM kpi_weekly_summaries WHERE batch_id=$1 AND agent_login=$2 ORDER BY week_label`,
      [id, login],
    );
  }

  /* ── Delete batch ─────────────────────────────────────────────────────── */
  @Delete('batches/:id')
  @RequirePermissions('scorecard.import')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBatch(@CurrentUser() user: any, @Param('id') id: string) {
    await this.svc['ds'].query(
      `DELETE FROM kpi_source_batches WHERE id=$1 AND tenant_id=$2`,
      [id, this.tid(user)],
    );
  }

  /* ── CPO settings ─────────────────────────────────────────────────────── */
  @Get('cpo')
  @RequirePermissions('hc.view')
  getCpo(@CurrentUser() user: any) {
    return this.svc.getCpoSettings(this.tid(user));
  }

  @Post('cpo')
  @RequirePermissions('hc.view')
  async upsertCpo(
    @CurrentUser() user: any,
    @Body() body: { functionName: string; channelType: string; cpoPct: number; notes?: string },
  ) {
    await this.svc.upsertCpoSetting(
      this.tid(user),
      this.uid(user),
      body.functionName ?? 'all',
      body.channelType  ?? 'voice',
      body.cpoPct,
      body.notes,
    );
    return { success: true };
  }

  /* ── Calculate forecast from orders ──────────────────────────────────── */
  @Post('cpo/forecast')
  @RequirePermissions('hc.view')
  async calcForecast(
    @CurrentUser() user: any,
    @Body() body: { orders: number; cpoPct?: number; functionName?: string; channelType?: string },
  ) {
    const tenantId = this.tid(user);
    let cpoPct = body.cpoPct;

    if (cpoPct === undefined) {
      const fn   = body.functionName ?? 'all';
      const ch   = body.channelType  ?? 'voice';
      const rows = await this.svc['ds'].query(
        `SELECT cpo_pct FROM cpo_settings
         WHERE tenant_id=$1 AND function_name=$2 AND channel_type=$3
         ORDER BY effective_from DESC LIMIT 1`,
        [tenantId, fn, ch],
      );
      if (!rows.length) {
        const global = await this.svc['ds'].query(
          `SELECT cpo_pct FROM cpo_settings
           WHERE tenant_id=$1 AND function_name='all'
           ORDER BY effective_from DESC LIMIT 1`,
          [tenantId],
        );
        cpoPct = global.length ? parseFloat(global[0].cpo_pct) : 0.15;
      } else {
        cpoPct = parseFloat(rows[0].cpo_pct);
      }
    }

    const forecastedCalls = Math.round(body.orders * cpoPct);
    return { orders: body.orders, cpoPct, forecastedCalls };
  }
}
