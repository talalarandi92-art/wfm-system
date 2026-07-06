import { Controller, Post, Get, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

/**
 * Odoo BROWSER-bridge ingest — the API-free path to Odoo.
 *
 * Instead of the XML-RPC connector (OdooService, needs a URL + API key we don't have yet),
 * the chrome-extension-odoo bridge rides the supervisor's own Odoo web session: it intercepts
 * the Odoo web client's data calls (/web/dataset/call_kw · search_read · web_search_read) and
 * POSTs the returned records here. We stage them idempotently by (tenant, model, odoo_id) so
 * the recon pipeline / requests module can consume live Odoo data (leave/OT/comp/permission/
 * attendance) without any credentials — exactly the Sprinklr/Ameyo browser-bridge pattern.
 *
 * The exact Studio model/field names are confirmed from a real "copy samples" capture; nothing
 * here assumes them — every model is stored generically and mapped downstream.
 */
interface OdooCapture { model?: string; method?: string; records?: any[] }
interface OdooPush { capturedAt?: string; captures?: OdooCapture[]; discovery?: any[] }

@ApiTags('Odoo')
@Controller({ path: 'integrations/odoo', version: '1' })
export class OdooBridgeController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Post('push')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Ingest Odoo records scraped from the browser session (extension bridge)' })
  async push(@Request() req: any, @Body() body: OdooPush) {
    const tid = req.user.tenantId;
    const captures = Array.isArray(body.captures) ? body.captures : [];
    let upserts = 0;
    const perModel: Record<string, number> = {};
    for (const cap of captures) {
      const model = String(cap?.model || '').trim();
      const records = Array.isArray(cap?.records) ? cap.records : [];
      if (!model || !records.length) continue;
      for (const rec of records) {
        const oid = rec && (rec.id ?? rec.Id ?? rec.ID);
        if (oid == null || typeof oid !== 'number') continue;   // Odoo rows always carry a numeric id
        const wd = rec.write_date || rec.__last_update || null;
        await this.ds.query(
          `INSERT INTO odoo_staging (tenant_id, model, odoo_id, data, write_date, captured_at)
             VALUES ($1,$2,$3,$4::jsonb,$5,NOW())
           ON CONFLICT (tenant_id, model, odoo_id)
             DO UPDATE SET data = EXCLUDED.data, write_date = EXCLUDED.write_date, captured_at = NOW()`,
          [tid, model, oid, JSON.stringify(rec), wd],
        ).catch(() => {});
        upserts++; perModel[model] = (perModel[model] || 0) + 1;
      }
    }
    return { ok: true, upserts, perModel, models: Object.keys(perModel) };
  }

  @Get('captured')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('rta.view')
  @ApiOperation({ summary: 'What Odoo data the bridge has captured (per-model counts + freshness)' })
  async captured(@Request() req: any) {
    const rows = await this.ds.query(
      `SELECT model, COUNT(*)::int rows, MAX(captured_at) last_captured, MAX(write_date) last_write
         FROM odoo_staging WHERE tenant_id=$1 GROUP BY model ORDER BY rows DESC`, [req.user.tenantId]).catch(() => []);
    const total = rows.reduce((s: number, r: any) => s + (r.rows || 0), 0);
    const newest = rows.reduce((m: any, r: any) => (!m || new Date(r.last_captured) > new Date(m)) ? r.last_captured : m, null);
    return { total, models: rows, staleSec: newest ? Math.round((Date.now() - new Date(newest).getTime()) / 1000) : null };
  }
}
