import {
  Controller, Get, Post, Delete, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, ParseFilePipe,
  MaxFileSizeValidator, HttpCode, HttpStatus,
  StreamableFile, Header, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { OpsUploadService } from './ops-upload.service';

@ApiTags('Operations Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('reports.view')
@Controller({ path: 'ops-analytics', version: '1' })
export class OpsController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly uploadSvc: OpsUploadService,
  ) {}

  /* ── Upload ─────────────────────────────────────────────────────────────── */

  @Post('upload/preview')
  @RequirePermissions('scorecard.import')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse operations data file — preview only' })
  uploadPreview(
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 })],
    })) file: Express.Multer.File,
  ) {
    return this.uploadSvc.parsePreview(file.buffer, file.originalname);
  }

  @Post('upload/commit')
  @RequirePermissions('scorecard.import')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse and commit operations data to the database' })
  async uploadCommit(
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 })],
    })) file: Express.Multer.File,
    @CurrentUser() user: any,
    @Query('notes') notes?: string,
  ) {
    const result = await this.uploadSvc.commitUpload(
      file.buffer, file.originalname, user.tenantId, user.id, notes,
    );
    return { success: true, ...result };
  }

  /* ── Batches ────────────────────────────────────────────────────────────── */

  @Get('batches')
  @ApiOperation({ summary: 'List operations data batches' })
  async listBatches(@CurrentUser() user: any) {
    return this.ds.query(
      `SELECT b.id, b.file_name, b.period_from, b.period_to, b.total_rows,
              b.uploaded_at, b.notes, u.username AS uploaded_by_name
       FROM ops_batches b
       LEFT JOIN users u ON u.id = b.uploaded_by
       WHERE b.tenant_id = $1
       ORDER BY b.uploaded_at DESC`,
      [user.tenantId],
    );
  }

  @Delete('batches/:id')
  @RequirePermissions('scorecard.import')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an operations batch' })
  async deleteBatch(@Param('id') id: string, @CurrentUser() user: any) {
    await this.ds.query(
      `DELETE FROM ops_batches WHERE id = $1 AND tenant_id = $2`,
      [id, user.tenantId],
    );
  }

  /* ── Orders analytics (order mix, returns/refunds, country/tier) ────────── */

  /** Order dimensional analytics for a labelled window (from order_aggregates). */
  @Get('orders')
  @ApiOperation({ summary: 'Order mix: status / type / returns / country / tier / payment' })
  async orders(@CurrentUser() user: any, @Query('period') period?: string) {
    const periods = await this.ds.query(
      `SELECT DISTINCT period_label FROM order_aggregates WHERE tenant_id = $1 ORDER BY period_label DESC`,
      [user.tenantId],
    );
    const sel = period || periods[0]?.period_label;
    if (!sel) return { periods: [], period: null, total: 0, dimensions: {} };
    const rows = await this.ds.query(
      `SELECT dimension, bucket, count FROM order_aggregates
        WHERE tenant_id = $1 AND period_label = $2 ORDER BY dimension, count DESC`,
      [user.tenantId, sel],
    );
    const total = Number(rows.find((r: any) => r.dimension === '_total')?.count || 0);
    const dimensions: Record<string, { bucket: string; count: number; pct: number }[]> = {};
    for (const r of rows) {
      if (r.dimension === '_total') continue;
      (dimensions[r.dimension] ||= []).push({
        bucket: r.bucket, count: Number(r.count),
        pct: total ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
      });
    }
    return { periods: periods.map((p: any) => p.period_label), period: sel, total, dimensions };
  }

  /* ── Contact volume (real Ameyo interval data) ──────────────────────────── */

  /** Daily contact volume + AHT + SLA + intraday profile, with a CPO snapshot. */
  @Get('volume')
  @ApiOperation({ summary: 'Contact volume by day/channel, AHT, abandon%, intraday profile, CPO' })
  async volume(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channel') channel?: string,
  ) {
    const t = user.tenantId;
    const range = await this.ds.query(
      `SELECT MIN(vol_date)::text a, MAX(vol_date)::text b FROM contact_volume_daily WHERE tenant_id=$1`, [t]);
    const dTo = to || range[0]?.b;
    const dFrom = from || range[0]?.a;
    const params: any[] = [t, dFrom, dTo];
    const chFilter = channel ? `AND channel = $4` : '';
    if (channel) params.push(channel);

    const byChannel = await this.ds.query(
      `SELECT channel, SUM(offered)::int offered, SUM(handled)::int handled, SUM(abandoned)::int abandoned,
              SUM(in_target)::int in_target, SUM(talk_seconds)::bigint talk_seconds
         FROM contact_volume_daily WHERE tenant_id=$1 AND vol_date BETWEEN $2 AND $3 ${chFilter}
        GROUP BY channel ORDER BY offered DESC`, params);
    const daily = await this.ds.query(
      `SELECT vol_date::text date, SUM(offered)::int offered, SUM(handled)::int handled, SUM(abandoned)::int abandoned
         FROM contact_volume_daily WHERE tenant_id=$1 AND vol_date BETWEEN $2 AND $3 ${chFilter}
        GROUP BY vol_date ORDER BY vol_date`, params);
    const profile = await this.ds.query(
      `SELECT interval_idx, SUM(offered)::bigint offered FROM contact_volume_profile
        WHERE tenant_id=$1 ${channel ? 'AND channel=$2' : ''} GROUP BY interval_idx ORDER BY interval_idx`,
      channel ? [t, channel] : [t]);

    const totals = byChannel.reduce((a: any, c: any) => ({
      offered: a.offered + Number(c.offered), handled: a.handled + Number(c.handled),
      abandoned: a.abandoned + Number(c.abandoned), talk: a.talk + Number(c.talk_seconds),
    }), { offered: 0, handled: 0, abandoned: 0, talk: 0 });
    const ahtSec = totals.handled ? Math.round(totals.talk / totals.handled) : 0;
    const abandonPct = totals.offered ? Math.round((totals.abandoned / totals.offered) * 1000) / 10 : 0;

    // CPO snapshot: contacts in the orders window ÷ orders in that window.
    const ordersRow = await this.ds.query(
      `SELECT period_label, count FROM order_aggregates WHERE tenant_id=$1 AND dimension='_total' ORDER BY period_label DESC LIMIT 1`, [t]);
    let cpo: any = null;
    if (ordersRow[0]) {
      const m = String(ordersRow[0].period_label).match(/(\d{4})-(\d{2}).*?\((\d+)-(\d+)\)/);
      if (m) {
        const [, y, mo, d1, d2] = m;
        const wFrom = `${y}-${mo}-${String(d1).padStart(2,'0')}`, wTo = `${y}-${mo}-${String(d2).padStart(2,'0')}`;
        const cv = await this.ds.query(
          `SELECT SUM(offered)::int c FROM contact_volume_daily WHERE tenant_id=$1 AND vol_date BETWEEN $2 AND $3`, [t, wFrom, wTo]);
        const contacts = Number(cv[0]?.c || 0), orders = Number(ordersRow[0].count);
        const chRows = await this.ds.query(
          `SELECT DISTINCT channel FROM contact_volume_daily WHERE tenant_id=$1 AND vol_date BETWEEN $2 AND $3 ORDER BY channel`, [t, wFrom, wTo]);
        cpo = { window: ordersRow[0].period_label, contacts, orders,
                cpo: orders ? Math.round((contacts / orders) * 1000) / 1000 : null,
                channels: chRows.map((r: any) => r.channel),
                note: 'contacts ÷ orders across all ingested channels in the orders window' };
      }
    }
    return { range: range[0], from: dFrom, to: dTo, byChannel,
             totals: { ...totals, ahtSec, abandonPct }, daily, profile, cpo };
  }

  /* ── Analytics ──────────────────────────────────────────────────────────── */

  /** Summary cards: totals, channels, survey funnel, sentiment split */
  @Get('batches/:id/summary')
  @ApiOperation({ summary: 'Batch summary — totals, channels, survey, sentiment' })
  async summary(@Param('id') id: string, @CurrentUser() user: any) {
    const tid = user.tenantId;

    const [totals] = await this.ds.query(
      `SELECT COUNT(*)                                          AS total_contacts,
              COUNT(DISTINCT agent_login)                       AS agents,
              COUNT(DISTINCT contact_date)                      AS days,
              COUNT(*) FILTER (WHERE survey_sent)               AS survey_sent,
              COUNT(*) FILTER (WHERE survey_clicked)            AS survey_clicked,
              COUNT(*) FILTER (WHERE rating_sentiment='positive') AS positive,
              COUNT(*) FILTER (WHERE rating_sentiment='negative') AS negative,
              COUNT(*) FILTER (WHERE rating_sentiment='neutral')  AS neutral
       FROM ops_contacts WHERE tenant_id=$1 AND batch_id=$2`,
      [tid, id],
    );

    const channels = await this.ds.query(
      `SELECT COALESCE(channel,'(unknown)') AS channel, COUNT(*) AS cnt
       FROM ops_contacts WHERE tenant_id=$1 AND batch_id=$2
       GROUP BY channel ORDER BY cnt DESC`,
      [tid, id],
    );

    const n = (v: any) => parseInt(v ?? '0', 10);
    const rated = n(totals.positive) + n(totals.negative) + n(totals.neutral);

    return {
      totalContacts: n(totals.total_contacts),
      agents:        n(totals.agents),
      days:          n(totals.days),
      survey: {
        sent:     n(totals.survey_sent),
        clicked:  n(totals.survey_clicked),
        clickRate: n(totals.survey_sent) ? Math.round(100 * n(totals.survey_clicked) / n(totals.survey_sent)) : null,
      },
      sentiment: {
        positive: n(totals.positive),
        negative: n(totals.negative),
        neutral:  n(totals.neutral),
        positivePct: rated ? Math.round(100 * n(totals.positive) / rated) : null,
        negativePct: rated ? Math.round(100 * n(totals.negative) / rated) : null,
      },
      channels: channels.map((c: any) => ({ channel: c.channel, count: n(c.cnt) })),
    };
  }

  /** Hourly heatmap: contacts per date × hour + per-hour totals */
  @Get('batches/:id/hourly')
  @ApiOperation({ summary: 'Hourly contact volume (heatmap: date × hour)' })
  async hourly(@Param('id') id: string, @CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT contact_date, contact_hour, COUNT(*) AS cnt
       FROM ops_contacts
       WHERE tenant_id=$1 AND batch_id=$2 AND contact_hour IS NOT NULL
       GROUP BY contact_date, contact_hour
       ORDER BY contact_date, contact_hour`,
      [user.tenantId, id],
    );
    const hourTotals = await this.ds.query(
      `SELECT contact_hour, COUNT(*) AS cnt
       FROM ops_contacts
       WHERE tenant_id=$1 AND batch_id=$2 AND contact_hour IS NOT NULL
       GROUP BY contact_hour ORDER BY contact_hour`,
      [user.tenantId, id],
    );
    return {
      cells: rows.map((r: any) => ({
        date: r.contact_date instanceof Date ? r.contact_date.toISOString().slice(0,10) : r.contact_date,
        hour: r.contact_hour,
        count: parseInt(r.cnt, 10),
      })),
      hourTotals: hourTotals.map((r: any) => ({ hour: r.contact_hour, count: parseInt(r.cnt, 10) })),
    };
  }

  /** Payment methods breakdown */
  @Get('batches/:id/payments')
  @ApiOperation({ summary: 'Payment method breakdown' })
  async payments(@Param('id') id: string, @CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT COALESCE(payment_method,'(unknown)') AS method, COUNT(*) AS cnt
       FROM ops_contacts WHERE tenant_id=$1 AND batch_id=$2
       GROUP BY payment_method ORDER BY cnt DESC`,
      [user.tenantId, id],
    );
    return rows.map((r: any) => ({ method: r.method, count: parseInt(r.cnt, 10) }));
  }

  /** Top contact reasons */
  @Get('batches/:id/reasons')
  @ApiOperation({ summary: 'Top contact reasons (default 10)' })
  async reasons(
    @Param('id') id: string, @CurrentUser() user: any,
    @Query('limit') limitQ?: string,
  ) {
    const limit = Math.min(parseInt(limitQ ?? '10', 10) || 10, 50);
    const rows = await this.ds.query(
      `SELECT contact_reason AS reason, COUNT(*) AS cnt,
              COUNT(*) FILTER (WHERE rating_sentiment='negative') AS negative_cnt
       FROM ops_contacts
       WHERE tenant_id=$1 AND batch_id=$2 AND contact_reason IS NOT NULL
       GROUP BY contact_reason ORDER BY cnt DESC LIMIT $3`,
      [user.tenantId, id, limit],
    );
    return rows.map((r: any, i: number) => ({
      rank: i + 1,
      reason: r.reason,
      count: parseInt(r.cnt, 10),
      negativeCount: parseInt(r.negative_cnt, 10),
    }));
  }

  /** Per-agent volume + sentiment → ranking */
  @Get('batches/:id/agents')
  @ApiOperation({ summary: 'Per-agent contact volume, sentiment, and ranking' })
  async agents(@Param('id') id: string, @CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT COALESCE(agent_name, agent_login, '(unknown)') AS agent,
              agent_login,
              COUNT(*)                                            AS contacts,
              COUNT(DISTINCT contact_date)                        AS active_days,
              COUNT(*) FILTER (WHERE survey_sent)                 AS survey_sent,
              COUNT(*) FILTER (WHERE rating_sentiment='positive') AS positive,
              COUNT(*) FILTER (WHERE rating_sentiment='negative') AS negative
       FROM ops_contacts
       WHERE tenant_id=$1 AND batch_id=$2
         AND (agent_name IS NOT NULL OR agent_login IS NOT NULL)
       GROUP BY agent_name, agent_login
       ORDER BY contacts DESC`,
      [user.tenantId, id],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    return rows.map((r: any, i: number) => {
      const rated = n(r.positive) + n(r.negative);
      return {
        rank: i + 1,
        agent: r.agent,
        agentLogin: r.agent_login,
        contacts: n(r.contacts),
        activeDays: n(r.active_days),
        avgPerDay: n(r.active_days) ? Math.round(10 * n(r.contacts) / n(r.active_days)) / 10 : null,
        surveySent: n(r.survey_sent),
        positive: n(r.positive),
        negative: n(r.negative),
        positivePct: rated ? Math.round(100 * n(r.positive) / rated) : null,
      };
    });
  }

  /** Week-over-week trend within batch (ISO weeks) */
  @Get('batches/:id/trends')
  @ApiOperation({ summary: 'Weekly contact volume and sentiment trend' })
  async trends(@Param('id') id: string, @CurrentUser() user: any) {
    const rows = await this.ds.query(
      `SELECT TO_CHAR(contact_date, 'IYYY-"W"IW') AS week,
              MIN(contact_date) AS week_start,
              COUNT(*) AS contacts,
              COUNT(*) FILTER (WHERE rating_sentiment='positive') AS positive,
              COUNT(*) FILTER (WHERE rating_sentiment='negative') AS negative
       FROM ops_contacts
       WHERE tenant_id=$1 AND batch_id=$2 AND contact_date IS NOT NULL
       GROUP BY 1 ORDER BY week_start`,
      [user.tenantId, id],
    );
    const n = (v: any) => parseInt(v ?? '0', 10);
    return rows.map((r: any, i: number) => {
      const prev = i > 0 ? n(rows[i-1].contacts) : null;
      const cur = n(r.contacts);
      return {
        week: r.week,
        weekStart: r.week_start instanceof Date ? r.week_start.toISOString().slice(0,10) : r.week_start,
        contacts: cur,
        positive: n(r.positive),
        negative: n(r.negative),
        deltaPct: prev ? Math.round(100 * (cur - prev) / prev) : null,
      };
    });
  }

  /** Export agent ranking as Excel */
  @Get('batches/:id/export')
  @RequirePermissions('reports.export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Export batch analytics as Excel' })
  async exportBatch(
    @Param('id') id: string, @CurrentUser() user: any,
    @Res({ passthrough: true }) res?: any,
  ) {
    const [agents, reasons, payments] = await Promise.all([
      this.agents(id, user), this.reasons(id, user, '50'), this.payments(id, user),
    ]);

    const wb = XLSX.utils.book_new();

    const agentSheet = XLSX.utils.aoa_to_sheet([
      ['Rank', 'Agent', 'Login', 'Contacts', 'Active Days', 'Avg/Day', 'Surveys Sent', 'Positive', 'Negative', 'Positive %'],
      ...agents.map((a: any) => [a.rank, a.agent, a.agentLogin, a.contacts, a.activeDays, a.avgPerDay, a.surveySent, a.positive, a.negative, a.positivePct]),
    ]);
    XLSX.utils.book_append_sheet(wb, agentSheet, 'Agent Ranking');

    const reasonSheet = XLSX.utils.aoa_to_sheet([
      ['Rank', 'Reason', 'Count', 'Negative Count'],
      ...reasons.map((r: any) => [r.rank, r.reason, r.count, r.negativeCount]),
    ]);
    XLSX.utils.book_append_sheet(wb, reasonSheet, 'Contact Reasons');

    const paySheet = XLSX.utils.aoa_to_sheet([
      ['Payment Method', 'Count'],
      ...payments.map((p: any) => [p.method, p.count]),
    ]);
    XLSX.utils.book_append_sheet(wb, paySheet, 'Payments');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res?.set('Content-Disposition', `attachment; filename="ops-analytics-${id.slice(0, 8)}.xlsx"`);
    return new StreamableFile(Readable.from(buf));
  }
}
