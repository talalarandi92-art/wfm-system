import { Controller, Post, Get, Body, Query, Request, UseGuards } from '@nestjs/common';
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

// Models Odoo loads incidentally (never a Supervisor Request) — don't stage/map them.
const NON_REQUEST = /^(res\.|ir\.|bus\.|mail\.|web|base|website|crm)/i;

const num = (v: any) => (typeof v === 'number' ? v : (v != null && v !== '' && !isNaN(+v) ? +v : null));
const m2oLabel = (v: any) => (Array.isArray(v) ? v[1] : (typeof v === 'string' ? v : null));   // Odoo many2one = [id,"label"]
const pickF = (d: any, keys: string[]) => { for (const k of keys) if (d && d[k] != null && d[k] !== '') return d[k]; return null; };
// the employee display label carries our employee_no as "[ 13311 ] NAME"
const personNoFrom = (label: any) => { const m = String(label || '').match(/\[\s*(\d{3,7})\s*\]/); return m ? m[1] : null; };

function normStatus(raw: any): string {
  const s = String(raw || '').toLowerCase();
  // real Odoo states seen: draft · confirm · approve · approved · validate · done · refuse ·
  //   portal_refuse · first_approval · second_approval · resumption_approval
  if (/refuse|reject|cancel|decline/.test(s)) return 'refused';                                   // portal_refuse too
  // in-chain / not-yet-final states first, so they don't get caught by the generic "approv"
  if (/draft|confirm|submit|waiting|pending|to.?approv|first|second|resumption/.test(s)) return 'pending';
  if (/approv|validate|valid|done|accept/.test(s)) return 'approved';
  return s || 'unknown';
}

/** Generic Odoo Supervisor-Request → clean WFM shape. One mapper for sick / OT / comp / permission. */
function mapOdooRequest(model: string, d: any) {
  const empLabel = m2oLabel(d.employee_id ?? d.x_employee_id ?? d.employee);
  return {
    model, odooId: d.id, ref: (pickF(d, ['name', 'display_name', 'x_name']) || '').toString().trim() || null,
    personNo: personNoFrom(empLabel) || personNoFrom(pickF(d, ['x_employee', 'employee_name'])),
    employeeName: (empLabel ? String(empLabel).replace(/^\[\s*\d+\s*\]\s*/, '').trim() : pickF(d, ['x_employee', 'employee_name'])) || null,
    dateFrom: pickF(d, ['date_from', 'request_date_from', 'x_date_from', 'x_date', 'date', 'start_date', 'back_vacation_date', 'request_date']),
    dateTo: pickF(d, ['date_to', 'request_date_to', 'x_date_to', 'end_date', 'expected_date']) || pickF(d, ['date_from', 'request_date_from', 'x_date', 'date', 'back_vacation_date']),
    days: num(pickF(d, ['days', 'number_of_days', 'number_of_days_net', 'x_days', 'duration_days'])),
    hours: num(pickF(d, ['hours', 'x_hours', 'duration_hours', 'number_of_hours', 'x_total_hours', 'total_hours'])),
    timeFrom: pickF(d, ['x_from', 'time_from', 'x_time_from', 'from']),
    timeTo: pickF(d, ['x_to', 'time_to', 'x_time_to', 'to']),
    type: pickF(d, ['permission_type', 'type']),                                   // late / early / full
    leaveType: m2oLabel(d.holiday_status_id ?? d.leave_type_id),                   // ANNUAL LEAVE / UNPAID …
    employeeStatus: pickF(d, ['employee_status']),                                 // resignation / transfer / termination (hr.back.vacation)
    status: normStatus(pickF(d, ['x_status', 'status', 'state_label']) ?? d.state),
    rawState: d.state ?? pickF(d, ['x_status', 'status']) ?? null,
    department: m2oLabel(d.department_id), section: m2oLabel(d.section_id),
  };
}
const tally = (arr: string[]) => arr.reduce((o: Record<string, number>, s) => { o[s] = (o[s] || 0) + 1; return o; }, {});

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
      if (!model || !records.length || NON_REQUEST.test(model)) continue;   // skip incidental non-request models (res.company etc.)
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

  @Get('requests')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('rta.view')
  @ApiOperation({ summary: 'Staged Odoo Supervisor-Requests mapped to the WFM shape (person_no + dates + status)' })
  async requests(@Request() req: any, @Query('model') model?: string, @Query('status') status?: string) {
    const params: any[] = [req.user.tenantId];
    let where = 'tenant_id=$1';
    if (model) { params.push(model); where += ` AND model=$${params.length}`; }
    const rows = await this.ds.query(
      `SELECT model, data FROM odoo_staging WHERE ${where} ORDER BY captured_at DESC LIMIT 3000`, params).catch(() => []);
    let mapped = rows.filter((r: any) => !NON_REQUEST.test(r.model)).map((r: any) => mapOdooRequest(r.model, r.data));
    if (status) mapped = mapped.filter((m) => m.status === status);
    return {
      total: mapped.length,
      linkedToEmployee: mapped.filter((m) => m.personNo).length,
      byModel: tally(mapped.map((m) => m.model)),
      byStatus: tally(mapped.map((m) => m.status)),
      rows: mapped.slice(0, 500),
    };
  }
}
