import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  VolumePoint, forecastRange, dailyTotals, accuracy, ForecastInterval, requiredAgents,
  ForecastEvent, eventFactor,
} from './forecasting.engine';

/**
 * Forecasting service — generates interval volume forecasts from REAL historical
 * contacts (ops_contacts: contact_date, contact_hour, channel) and measures
 * accuracy against actuals. Read-only over live data; persistence/overrides land
 * in a later increment. If no history exists it returns dataPoints=0 so the UI
 * can label the forecast as "no data" rather than presenting zeros as truth.
 */
@Injectable()
export class ForecastingService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  private shift(date: string, days: number): string {
    return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000)
      .toISOString().slice(0, 10);
  }

  /** Validate a required YYYY-MM-DD range — clean 400 instead of an Invalid-Date 500. */
  private assertRange(from?: string, to?: string) {
    const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
    if (!ok(from) || !ok(to)) throw new BadRequestException('Query params "from" and "to" (YYYY-MM-DD) are required.');
    if (from! > to!) throw new BadRequestException('"from" must not be after "to".');
  }

  /** Distinct channels present in the contact history. */
  async listChannels(tenantId: string): Promise<string[]> {
    const rows = await this.ds.query(
      `SELECT DISTINCT channel FROM ops_contacts
        WHERE tenant_id=$1 AND channel IS NOT NULL AND channel <> ''
        ORDER BY channel`, [tenantId]);
    return rows.map((r: any) => r.channel);
  }

  /** Aggregate ops_contacts into (date,hour,channel,volume) points. */
  async loadHistory(tenantId: string, from: string, to: string, channel?: string): Promise<VolumePoint[]> {
    const params: any[] = [tenantId, from, to];
    let chClause = '';
    if (channel) { params.push(channel); chClause = ` AND channel = $4`; }
    const rows = await this.ds.query(
      `SELECT channel, contact_date::text AS date, contact_hour AS hour, COUNT(*)::int AS volume
         FROM ops_contacts
        WHERE tenant_id=$1 AND contact_date BETWEEN $2 AND $3
          AND contact_hour IS NOT NULL AND channel IS NOT NULL${chClause}
        GROUP BY channel, contact_date, contact_hour`, params);
    return rows.map((r: any) => ({ date: r.date, hour: Number(r.hour), channel: r.channel, volume: Number(r.volume) }));
  }

  /** Active campaigns overlapping [from,to] → forecast events (volume multipliers). */
  async loadEvents(tenantId: string, from: string, to: string): Promise<ForecastEvent[]> {
    const rows = await this.ds.query(
      `SELECT name, start_date::text AS f, end_date::text AS t, required_hc_uplift_pct AS uplift, color
         FROM campaigns
        WHERE tenant_id = $1 AND is_active = true
          AND start_date <= $3::date AND end_date >= $2::date`,
      [tenantId, from, to]);
    return rows
      .map((r: any) => ({ from: r.f, to: r.t, multiplier: 1 + Number(r.uplift) / 100, label: r.name, color: r.color }))
      .filter((e: ForecastEvent) => e.multiplier !== 1); // 0% uplift = no volume effect
  }

  /**
   * Average AHT (seconds) over a date range.
   * Primary: agent_daily_stats.aht_seconds (Sprinklr bridge). FALLBACK (2026-07-06, bug #5 —
   * the primary was 100% NULL, which left requiredHc permanently null and the whole Erlang
   * staffing layer DEAD): derive AHT = SUM(talk_seconds)/SUM(handled) from contact_volume_daily
   * (the dense Ameyo daily history) over the window widened to 28 days — the same proven
   * fallback the Sprinklr contact-forecast uses.
   */
  async avgAht(tenantId: string, from: string, to: string): Promise<number | null> {
    const [r] = await this.ds.query(
      `SELECT AVG(aht_seconds)::numeric(10,2) AS aht
         FROM agent_daily_stats
        WHERE tenant_id=$1 AND stat_date BETWEEN $2 AND $3 AND aht_seconds > 0`,
      [tenantId, from, to]);
    if (r?.aht != null) return Number(r.aht);
    const [f] = await this.ds.query(
      `SELECT (SUM(talk_seconds)::numeric / NULLIF(SUM(handled),0))::numeric(10,2) AS aht
         FROM contact_volume_daily
        WHERE tenant_id=$1 AND vol_date BETWEEN ($2::date - 28) AND $3
          AND handled > 0 AND talk_seconds > 0`,
      [tenantId, from, to]).catch(() => [null]);
    return f?.aht != null ? Number(f.aht) : null;
  }

  /**
   * Generate an interval forecast for [from,to] using the prior `historyWeeks`
   * weeks of real history. Returns per-interval + daily totals + meta.
   */
  async generate(tenantId: string, opts: {
    from: string; to: string; channel?: string; historyWeeks?: number;
    targetSL?: number; targetSec?: number; shrinkage?: number;
  }) {
    this.assertRange(opts.from, opts.to);
    const historyWeeks = Math.min(Math.max(opts.historyWeeks ?? 8, 2), 52);
    const histFrom = this.shift(opts.from, -historyWeeks * 7);
    const histTo = this.shift(opts.from, -1);
    const history = await this.loadHistory(tenantId, histFrom, histTo, opts.channel);

    const channels = opts.channel ? [opts.channel] : [...new Set(history.map(h => h.channel))].sort();
    let base: ForecastInterval[] = [];
    for (const ch of channels) {
      base = base.concat(forecastRange(history, ch, opts.from, opts.to));
    }
    const aht = await this.avgAht(tenantId, histFrom, histTo);
    const events = await this.loadEvents(tenantId, opts.from, opts.to);

    // Apply event (campaign) multipliers to the baseline volume, THEN size staffing
    // off the adjusted volume so required HC reflects the campaign peak. requiredHc
    // is null when there's no AHT to staff against.
    const staffing = aht ? { ahtSec: aht, targetSL: opts.targetSL, targetSec: opts.targetSec, shrinkage: opts.shrinkage } : null;
    const intervals = base.map(iv => {
      const ef = eventFactor(iv.date, events);
      const adj = ef.multiplier !== 1 ? Math.round(iv.forecast * ef.multiplier * 10) / 10 : iv.forecast;
      const st = staffing && adj > 0 ? requiredAgents(adj, staffing) : null;
      return {
        ...iv,
        baseForecast: iv.forecast,
        forecast: adj,
        eventLabel: ef.labels.join(' + ') || null,
        eventColor: ef.color ?? null,
        requiredHc: st ? st.required : null,
        occupancy: st ? st.occupancy : null,
      };
    });

    // Peak required HC per (date) — the staffing a planner must cover that day.
    const peakByDay = new Map<string, number>();
    for (const iv of intervals) {
      if (iv.requiredHc == null) continue;
      peakByDay.set(iv.date, Math.max(peakByDay.get(iv.date) ?? 0, iv.requiredHc));
    }
    const daily = dailyTotals(intervals as ForecastInterval[]).map(d => ({ ...d, peakRequiredHc: peakByDay.get(d.date) ?? null }));

    return {
      range: { from: opts.from, to: opts.to },
      historyWindow: { from: histFrom, to: histTo, weeks: historyWeeks },
      channels,
      ahtSeconds: aht,
      staffing: staffing ? { targetSL: opts.targetSL ?? 0.8, targetSec: opts.targetSec ?? 20, shrinkage: opts.shrinkage ?? 0.3 } : null,
      events: events.map(e => ({ from: e.from, to: e.to, label: e.label, multiplier: e.multiplier, color: e.color ?? null })),
      dataPoints: history.length,
      model: 'seasonal-weighted-recency (deterministic baseline)',
      intervals,
      daily,
    };
  }

  /**
   * Backtest accuracy: forecast a PAST range using only data before it, then
   * compare against what actually happened. Proves the model on real history.
   */
  async backtest(tenantId: string, opts: {
    from: string; to: string; channel?: string; historyWeeks?: number;
  }) {
    this.assertRange(opts.from, opts.to);
    const historyWeeks = Math.min(Math.max(opts.historyWeeks ?? 8, 2), 52);
    const histFrom = this.shift(opts.from, -historyWeeks * 7);
    const histTo = this.shift(opts.from, -1);
    const history = await this.loadHistory(tenantId, histFrom, histTo, opts.channel);
    const actuals = await this.loadHistory(tenantId, opts.from, opts.to, opts.channel);

    const channels = opts.channel ? [opts.channel] : [...new Set(history.map(h => h.channel))].sort();
    let intervals: ForecastInterval[] = [];
    for (const ch of channels) {
      intervals = intervals.concat(forecastRange(history, ch, opts.from, opts.to));
    }
    return {
      range: { from: opts.from, to: opts.to },
      historyWindow: { from: histFrom, to: histTo, weeks: historyWeeks },
      channels,
      dataPoints: history.length,
      ...accuracy(actuals, intervals),
    };
  }

  /* ── Persistence + manual overrides (audited) ─────────────────────────────── */

  /** Generate a forecast and persist its header + every interval. */
  async save(tenantId: string, userId: string | null, opts: {
    name?: string; from: string; to: string; channel?: string; historyWeeks?: number;
    targetSL?: number; targetSec?: number; shrinkage?: number;
  }) {
    const f = await this.generate(tenantId, opts);
    const [hdr] = await this.ds.query(
      `INSERT INTO forecasts
         (tenant_id,name,range_from,range_to,channel,history_weeks,model,target_sl,target_sec,shrinkage,aht_seconds,data_points,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [tenantId, opts.name ?? null, opts.from, opts.to, opts.channel ?? null,
       f.historyWindow.weeks, f.model,
       f.staffing?.targetSL ?? null, f.staffing?.targetSec ?? null, f.staffing?.shrinkage ?? null,
       f.ahtSeconds, f.dataPoints, userId]);
    const id = hdr.id;

    // Bulk-insert intervals in chunks (keeps the parameter count well bounded).
    const rows = f.intervals as any[];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const vals: string[] = []; const params: any[] = []; let p = 1;
      for (const iv of chunk) {
        vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        params.push(id, tenantId, iv.date, iv.hour, iv.channel, iv.forecast, iv.requiredHc ?? null);
      }
      await this.ds.query(
        `INSERT INTO forecast_intervals
           (forecast_id,tenant_id,entry_date,hour,channel,forecast_volume,required_hc)
         VALUES ${vals.join(',')}`, params);
    }

    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'forecast.saved','forecasting','forecast',$3,$4)`,
      [tenantId, userId, id, `Forecast ${opts.from}→${opts.to} (${rows.length} intervals)`]).catch(() => {});

    return { id, intervals: rows.length };
  }

  /** List saved forecasts (newest first). */
  async listSaved(tenantId: string) {
    return this.ds.query(
      `SELECT f.id, f.name, f.range_from::text AS "rangeFrom", f.range_to::text AS "rangeTo",
              f.channel, f.model, f.data_points AS "dataPoints", f.created_at AS "createdAt",
              (SELECT COUNT(*) FROM forecast_intervals fi
                WHERE fi.forecast_id = f.id AND fi.override_volume IS NOT NULL) AS "overrides"
         FROM forecasts f
        WHERE f.tenant_id = $1
        ORDER BY f.created_at DESC LIMIT 100`, [tenantId]);
  }

  /** Load a saved forecast with its intervals (effective = override ?? model). */
  async getSaved(tenantId: string, id: string) {
    const [hdr] = await this.ds.query(
      `SELECT id, name, range_from::text AS "rangeFrom", range_to::text AS "rangeTo",
              channel, history_weeks AS "historyWeeks", model, target_sl AS "targetSL",
              target_sec AS "targetSec", shrinkage, aht_seconds AS "ahtSeconds",
              data_points AS "dataPoints", created_at AS "createdAt"
         FROM forecasts WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!hdr) throw new NotFoundException('Forecast not found');
    const intervals = await this.ds.query(
      `SELECT entry_date::text AS date, hour, channel,
              forecast_volume AS forecast, required_hc AS "requiredHc",
              override_volume AS "override", override_reason AS "overrideReason", override_at AS "overrideAt"
         FROM forecast_intervals
        WHERE forecast_id = $1 AND tenant_id = $2
        ORDER BY entry_date, hour, channel`, [id, tenantId]);
    return { ...hdr, intervals };
  }

  /** Manually override (or clear) one interval's volume — audited. */
  async override(tenantId: string, userId: string | null, forecastId: string, body: {
    date: string; hour: number; channel: string; value: number | null; reason?: string;
  }) {
    const [f] = await this.ds.query(
      `SELECT id FROM forecasts WHERE id = $1 AND tenant_id = $2`, [forecastId, tenantId]);
    if (!f) throw new NotFoundException('Forecast not found');

    const r = await this.ds.query(
      `UPDATE forecast_intervals
          SET override_volume = $1, override_by = $2,
              override_at = CASE WHEN $1 IS NULL THEN NULL ELSE now() END,
              override_reason = CASE WHEN $1 IS NULL THEN NULL ELSE $3 END
        WHERE forecast_id = $4 AND entry_date = $5 AND hour = $6 AND channel = $7`,
      [body.value, userId, body.reason ?? null, forecastId, body.date, body.hour, body.channel]);
    if (!r?.[1]) throw new NotFoundException('Interval not found in this forecast');

    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'forecast.override','forecasting','forecast',$3,$4)`,
      [tenantId, userId, forecastId,
       `${body.date} ${body.hour}:00 ${body.channel} → ${body.value == null ? 'cleared' : body.value}${body.reason ? ' · ' + body.reason : ''}`])
      .catch(() => {});
    return { ok: true };
  }
}
