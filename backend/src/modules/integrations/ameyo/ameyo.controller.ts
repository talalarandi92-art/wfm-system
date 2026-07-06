import { Controller, Post, Get, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { AmeyoService } from './ameyo.service';

/**
 * Ameyo bridge ingest — receives live-monitoring snapshots scraped by the Ameyo
 * Chrome extension (agents list + KPI cards + queue summary) and stores them as
 * integration_snapshots (source='ameyo'), mirroring the Sprinklr bridge.
 *
 * `discovery` carries raw intercepted network payloads so the exact Ameyo API
 * shape can be confirmed and the parser refined (same iterative approach used to
 * build the Sprinklr connector).
 */
interface AmeyoSnapshot {
  capturedAt?: string;
  captureMethod?: string;
  kpis?: Record<string, any>;
  agents?: any[];
  queues?: any[];
  discovery?: { op: string; sample: any }[];
}

@ApiTags('Ameyo')
@Controller({ path: 'integrations/ameyo', version: '1' })
export class AmeyoController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ameyo: AmeyoService,
  ) {}

  @Post('push')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('rta.view')   // bridge service account (role rta) — mirrors the Sprinklr push gating
  @ApiOperation({ summary: 'Receive an Ameyo live-monitoring snapshot from the extension' })
  async push(@Request() req: any, @Body() snap: AmeyoSnapshot) {
    const tid = req.user.tenantId;
    const capturedAt = snap.capturedAt ?? new Date().toISOString();
    const agents = Array.isArray(snap.agents) ? snap.agents : [];
    const queues = Array.isArray(snap.queues) ? snap.queues : [];
    await this.ds.query(
      `INSERT INTO integration_snapshots
         (tenant_id, source, captured_at, queues_json, agents_json, queue_count, agent_count)
       VALUES ($1, 'ameyo', $2::timestamptz, $3::jsonb, $4::jsonb, $5, $6)`,
      [tid, capturedAt, JSON.stringify({ kpis: snap.kpis ?? {}, queues }), JSON.stringify(agents), queues.length, agents.length],
    ).catch(() => {});
    // Prune raw snapshots older than 48h (bounded, like Sprinklr).
    if (Math.random() < 0.05) {
      await this.ds.query(
        `DELETE FROM integration_snapshots WHERE tenant_id=$1 AND source='ameyo' AND captured_at < NOW() - INTERVAL '48 hours'`, [tid],
      ).catch(() => {});
    }
    return { ok: true, agents: agents.length, queues: queues.length, discovery: snap.discovery?.length ?? 0 };
  }

  @Get('live')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('rta.view')   // live telephony wallboard — RTA/WFM, not agents
  @ApiOperation({ summary: 'Latest Ameyo snapshot — normalized states + computed KPIs + employee links + stale flag' })
  async live(@Request() req: any) {
    return this.ameyo.getLive(req.user.tenantId);
  }
}
