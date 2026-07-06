import {
  Controller, Get, Post, Patch, Delete,
  Param, Query, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Campaign / Blackout Calendar.
 * Ops adds peak windows by date range + type. During a window, selected request
 * types are restricted/flagged and Required-HC can be uplifted to protect peak.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('hc.view')   // deny-by-default flip 2026-07-06 — campaign windows drive Required-HC; writes override below
@Controller({ path: 'campaigns', version: '1' })
export class CampaignsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private shape(r: any) {
    const today = new Date().toISOString().slice(0, 10);
    const start = String(r.start_date).slice(0, 10);
    const end   = String(r.end_date).slice(0, 10);
    const status = today < start ? 'upcoming' : today > end ? 'past' : 'active';
    return {
      id:                 r.id,
      name:               r.name,
      campaignType:       r.campaign_type,
      startDate:          start,
      endDate:            end,
      restrictRequests:   r.restrict_requests,
      restrictedTypes:    typeof r.restricted_types === 'string' ? JSON.parse(r.restricted_types) : (r.restricted_types ?? []),
      requiredHcUpliftPct:r.required_hc_uplift_pct,
      color:              r.color,
      notes:              r.notes,
      isActive:           r.is_active,
      createdByName:      r.created_by_name ?? null,
      status,
    };
  }

  /* ── List campaigns (optional date overlap + active filter) ───────────── */
  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  async list(
    @CurrentUser() user: any,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
    @Query('active') active?: string,
  ) {
    const params: any[] = [user.tenantId];
    const conds: string[] = [];
    if (from && to) {
      params.push(from, to);
      conds.push(`c.start_date <= $${params.length} AND c.end_date >= $${params.length - 1}`);
    }
    if (active === 'true') conds.push(`c.is_active = TRUE`);
    const where = conds.length ? 'AND ' + conds.join(' AND ') : '';

    const rows = await this.ds.query(
      `SELECT c.*, ${'COALESCE(NULLIF(TRIM(COALESCE(u.first_name,\'\')||\' \'||COALESCE(u.last_name,\'\')),\'\'), u.username, u.email)'} AS created_by_name
       FROM campaigns c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.tenant_id = $1 ${where}
       ORDER BY c.start_date DESC`,
      params,
    ).catch(() => []);
    return rows.map((r: any) => this.shape(r));
  }

  /* ── Campaigns active on a given date ─────────────────────────────────── */
  @Get('active')
  @ApiOperation({ summary: 'Campaigns covering a date' })
  async activeOn(@CurrentUser() user: any, @Query('date') date?: string) {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const rows = await this.ds.query(
      `SELECT c.*, NULL AS created_by_name FROM campaigns c
       WHERE c.tenant_id = $1 AND c.is_active = TRUE AND $2::date BETWEEN c.start_date AND c.end_date
       ORDER BY c.start_date`,
      [user.tenantId, d],
    ).catch(() => []);
    return rows.map((r: any) => this.shape(r));
  }

  /* ── Blackout check: is a request type restricted on a date? ──────────── */
  @Get('check')
  @ApiOperation({ summary: 'Check whether a request type is restricted on a date' })
  async check(
    @CurrentUser() user: any,
    @Query('date') date: string,
    @Query('type') type?: string,
  ) {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const rows = await this.ds.query(
      `SELECT * FROM campaigns
       WHERE tenant_id = $1 AND is_active = TRUE AND restrict_requests = TRUE
         AND $2::date BETWEEN start_date AND end_date`,
      [user.tenantId, d],
    ).catch(() => []);
    for (const r of rows) {
      const types = typeof r.restricted_types === 'string' ? JSON.parse(r.restricted_types) : (r.restricted_types ?? []);
      if (!type || types.length === 0 || types.includes(type)) {
        return { restricted: true, campaign: this.shape(r), restrictedTypes: types };
      }
    }
    return { restricted: false, campaign: null };
  }

  /* ── Create ───────────────────────────────────────────────────────────── */
  @Post()
  @RequirePermissions('hc.edit')
  @ApiOperation({ summary: 'Create a campaign' })
  async create(@CurrentUser() user: any, @Body() body: any) {
    const [row] = await this.ds.query(
      `INSERT INTO campaigns
         (tenant_id, name, campaign_type, start_date, end_date, restrict_requests,
          restricted_types, required_hc_uplift_pct, color, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       RETURNING *`,
      [
        user.tenantId,
        String(body.name ?? '').trim() || 'Campaign',
        body.campaignType ?? 'flash_sale',
        body.startDate, body.endDate,
        body.restrictRequests ?? true,
        JSON.stringify(Array.isArray(body.restrictedTypes) ? body.restrictedTypes : ['annual', 'shift_swap', 'off_swap', 'wfh']),
        Math.max(0, Math.min(200, parseInt(body.requiredHcUpliftPct ?? 0, 10) || 0)),
        body.color ?? '#f59e0b',
        body.notes ?? null,
        user.id,
      ],
    );
    return this.shape(row);
  }

  /* ── Update ───────────────────────────────────────────────────────────── */
  @Patch(':id')
  @RequirePermissions('hc.edit')
  @ApiOperation({ summary: 'Update a campaign' })
  async update(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    const map: Record<string, string> = {
      name: 'name', campaignType: 'campaign_type', startDate: 'start_date', endDate: 'end_date',
      restrictRequests: 'restrict_requests', requiredHcUpliftPct: 'required_hc_uplift_pct',
      color: 'color', notes: 'notes', isActive: 'is_active',
    };
    const sets: string[] = [];
    const vals: any[] = [user.tenantId, id];
    for (const [k, col] of Object.entries(map)) {
      if (body[k] !== undefined) { vals.push(body[k]); sets.push(`${col} = $${vals.length}`); }
    }
    if (body.restrictedTypes !== undefined) {
      vals.push(JSON.stringify(body.restrictedTypes));
      sets.push(`restricted_types = $${vals.length}::jsonb`);
    }
    if (!sets.length) return { updated: false };
    sets.push('updated_at = NOW()');
    const [row] = await this.ds.query(
      `UPDATE campaigns SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      vals,
    );
    return row ? this.shape(row) : { updated: false };
  }

  /* ── Delete ───────────────────────────────────────────────────────────── */
  @Delete(':id')
  @RequirePermissions('hc.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a campaign' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.ds.query(`DELETE FROM campaigns WHERE id = $1 AND tenant_id = $2`, [id, user.tenantId]);
  }
}
