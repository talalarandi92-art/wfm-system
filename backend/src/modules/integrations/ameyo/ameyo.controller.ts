import { Controller, Post, Get, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

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
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Post('push')
  @UseGuards(JwtAuthGuard)
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
  @ApiOperation({ summary: 'Latest Ameyo snapshot' })
  async live(@Request() req: any) {
    const [row] = await this.ds.query(
      `SELECT captured_at, queues_json, agents_json, queue_count, agent_count
         FROM integration_snapshots WHERE tenant_id=$1 AND source='ameyo'
        ORDER BY captured_at DESC LIMIT 1`, [req.user.tenantId]).catch(() => []);
    if (!row) return { capturedAt: null, kpis: {}, agents: [], queues: [] };
    const qj = row.queues_json ?? {};
    return {
      capturedAt: row.captured_at,
      kpis: qj.kpis ?? {},
      queues: qj.queues ?? [],
      agents: row.agents_json ?? [],
      staleSec: Math.round((Date.now() - new Date(row.captured_at).getTime()) / 1000),
    };
  }
}
