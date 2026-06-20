import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, UnauthorizedException, Res, Header, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ForecastingService } from './forecasting.service';

@ApiTags('Forecasting')
@ApiBearerAuth()
@Controller({ path: 'forecasting', version: '1' })
@UseGuards(JwtAuthGuard)
@RequirePermissions('hc.view')
export class ForecastingController {
  constructor(private readonly svc: ForecastingService) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  @Get('channels')
  @ApiOperation({ summary: 'Channels present in the contact history' })
  channels(@CurrentUser() user: any) {
    return this.svc.listChannels(this.tid(user));
  }

  @Get('volume')
  @ApiOperation({ summary: 'Interval volume forecast + required HC (Erlang) for [from,to] from real history' })
  volume(
    @CurrentUser() user: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('channel') channel?: string,
    @Query('historyWeeks') historyWeeks?: string,
    @Query('targetSL') targetSL?: string,
    @Query('targetSec') targetSec?: string,
    @Query('shrinkage') shrinkage?: string,
  ) {
    return this.svc.generate(this.tid(user), {
      from, to, channel: channel || undefined,
      historyWeeks: historyWeeks ? parseInt(historyWeeks, 10) : undefined,
      targetSL: targetSL ? parseFloat(targetSL) : undefined,
      targetSec: targetSec ? parseInt(targetSec, 10) : undefined,
      shrinkage: shrinkage ? parseFloat(shrinkage) : undefined,
    });
  }

  @Get('export')
  @RequirePermissions('reports.export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Export the forecast (daily + intervals + required HC) as Excel' })
  async export(
    @CurrentUser() user: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('channel') channel?: string,
    @Query('historyWeeks') historyWeeks?: string,
    @Query('targetSL') targetSL?: string,
    @Query('shrinkage') shrinkage?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    const f = await this.svc.generate(this.tid(user), {
      from, to, channel: channel || undefined,
      historyWeeks: historyWeeks ? parseInt(historyWeeks, 10) : undefined,
      targetSL: targetSL ? parseFloat(targetSL) : undefined,
      shrinkage: shrinkage ? parseFloat(shrinkage) : undefined,
    });

    const wb = XLSX.utils.book_new();
    const meta = XLSX.utils.aoa_to_sheet([
      ['WFM Volume Forecast'],
      ['Range', `${f.range.from} → ${f.range.to}`],
      ['History window', `${f.historyWindow.from} → ${f.historyWindow.to} (${f.historyWindow.weeks}w)`],
      ['Model', f.model],
      ['History points', f.dataPoints],
      ['Avg AHT (s)', f.ahtSeconds ?? '—'],
      ['Staffing', f.staffing ? `SL ${Math.round(f.staffing.targetSL * 100)}%/${f.staffing.targetSec}s, shrinkage ${Math.round(f.staffing.shrinkage * 100)}%` : 'no AHT → HC not computed'],
    ]);
    XLSX.utils.book_append_sheet(wb, meta, 'Summary');

    const daily = XLSX.utils.aoa_to_sheet([
      ['Date', 'Channel', 'Forecast volume', 'Peak required HC'],
      ...f.daily.map((d: any) => [d.date, d.channel, d.total, d.peakRequiredHc ?? '—']),
    ]);
    XLSX.utils.book_append_sheet(wb, daily, 'Daily');

    const intervals = XLSX.utils.aoa_to_sheet([
      ['Date', 'Hour', 'Channel', 'Forecast', 'Required HC', 'Occupancy %', 'History samples'],
      ...f.intervals.map((i: any) => [i.date, i.hour, i.channel, i.forecast, i.requiredHc ?? '—', i.occupancy ?? '—', i.basis]),
    ]);
    XLSX.utils.book_append_sheet(wb, intervals, 'Intervals');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res?.set('Content-Disposition', `attachment; filename="forecast-${from}_${to}.xlsx"`);
    return new StreamableFile(Readable.from(buf));
  }

  @Post('save')
  @ApiOperation({ summary: 'Generate and persist a forecast (header + intervals)' })
  save(@CurrentUser() user: any, @Body() body: {
    name?: string; from: string; to: string; channel?: string; historyWeeks?: number;
    targetSL?: number; targetSec?: number; shrinkage?: number;
  }) {
    return this.svc.save(this.tid(user), user?.id ?? user?.sub ?? null, body);
  }

  @Get('saved')
  @ApiOperation({ summary: 'List saved forecasts' })
  saved(@CurrentUser() user: any) {
    return this.svc.listSaved(this.tid(user));
  }

  @Get('saved/:id')
  @ApiOperation({ summary: 'Load a saved forecast with its intervals + overrides' })
  loadSaved(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.getSaved(this.tid(user), id);
  }

  @Patch('saved/:id/override')
  @ApiOperation({ summary: 'Override (or clear) one interval — value null clears it. Audited.' })
  override(@CurrentUser() user: any, @Param('id') id: string, @Body() body: {
    date: string; hour: number; channel: string; value: number | null; reason?: string;
  }) {
    return this.svc.override(this.tid(user), user?.id ?? user?.sub ?? null, id, body);
  }

  @Get('accuracy')
  @ApiOperation({ summary: 'Backtest accuracy (MAPE/WAPE/bias) over a past range' })
  accuracy(
    @CurrentUser() user: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('channel') channel?: string,
    @Query('historyWeeks') historyWeeks?: string,
  ) {
    return this.svc.backtest(this.tid(user), {
      from, to, channel: channel || undefined,
      historyWeeks: historyWeeks ? parseInt(historyWeeks, 10) : undefined,
    });
  }
}
