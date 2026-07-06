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

// request model → excuse kind
function kindOf(r: any): string {
  const m = String(r.model || '');
  if (/sick/.test(m)) return 'sick';
  if (/leave/.test(m)) return 'leave';
  if (/extra|overtime/.test(m)) return 'overtime';
  if (/comp/.test(m)) return 'comp';
  if (/official/.test(m)) return 'official_task';
  if (/permission/.test(m)) return r.type === 'early' ? 'permission_early' : 'permission_late';
  return 'other';
}
const ymdBack = (days: number) => { const d = new Date(Date.now() - days * 86400000); return d.toISOString().slice(0, 10); };

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

  /**
   * Reconcile Odoo requests + validated technical issues against the roster (Director's rules):
   *  - APPROVED request  → an EXCUSE (excludes the deviation from conformance/penalty).
   *  - VALIDATED technical issue → an EXCUSE kind='technical' ("late due to a technical issue").
   *  - PENDING/WAITING  → a standing notification (until it is approved or refused).
   *  - REFUSED          → a notification to the agent (fix & resubmit).
   *  - missing punch/system on a worked day with NO request → a notification to submit a justification.
   * Dry-run by default; ?apply=1 writes the excuses + notifications (idempotent, no duplicate unread).
   */
  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('rta.override')
  @ApiOperation({ summary: 'Reconcile Odoo requests + technical issues → roster excuses + agent notifications' })
  async reconcile(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('apply') apply?: string) {
    const tid = req.user.tenantId;
    const dFrom = from || ymdBack(45), dTo = to || ymdBack(0);
    const doApply = apply === '1' || apply === 'true';

    // mapped, dated, employee-linked requests inside the window
    const staged = await this.ds.query(`SELECT model, data FROM odoo_staging WHERE tenant_id=$1`, [tid]).catch(() => []);
    const reqs = staged.filter((r: any) => !NON_REQUEST.test(r.model)).map((r: any) => mapOdooRequest(r.model, r.data))
      .filter((m: any) => m.personNo && m.dateFrom && m.dateFrom >= dFrom && m.dateFrom <= dTo);

    // WFM-validated technical issues → person-day excuses (reported_by → employee, on the issue date)
    const tech = await this.ds.query(
      `SELECT ti.id, ti.created_at::date::text d, e.employee_no person_no
         FROM technical_issues ti JOIN users u ON u.id = ti.reported_by JOIN employees e ON e.id = u.employee_id
        WHERE ti.tenant_id=$1 AND ti.validated_at IS NOT NULL AND ti.created_at::date BETWEEN $2 AND $3`,
      [tid, dFrom, dTo]).catch(() => []);

    // roster days in range — for the missing-evidence-with-no-request alert
    const roster = await this.ds.query(
      `SELECT person_no, work_date::text d, missing_punch, missing_system, presence
         FROM roster_days WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3`,
      [tid, dFrom, dTo]).catch(() => []);
    const reqDays = new Set(reqs.map((r: any) => r.personNo + '|' + r.dateFrom));

    // classify → excuses + notifications
    const excuses: any[] = [];
    const notifs: any[] = [];
    for (const r of reqs) {
      const eid = (r.ref || (r.model + ':' + r.odooId));
      if (r.status === 'approved') {
        excuses.push({ personNo: r.personNo, date: r.dateFrom, kind: kindOf(r), ref: eid, wf: r.timeFrom, wt: r.timeTo, hours: r.hours, source: 'odoo',
          reason: `Approved ${kindOf(r)} (Odoo${r.leaveType ? ' — ' + r.leaveType : ''})` });
      } else if (r.status === 'refused') {
        notifs.push({ personNo: r.personNo, type: 'request_refused', entity: 'odoo_request', eid,
          titleAr: 'طلبك اترفض', title: 'Your request was refused',
          bodyAr: `طلب ${r.model} بتاريخ ${r.dateFrom} اترفض — راجع الوقت/الساعات وأعد التقديم.`, body: `${r.model} on ${r.dateFrom} was refused — check the time/hours and resubmit.` });
      } else if (r.status === 'pending') {
        notifs.push({ personNo: r.personNo, type: 'request_pending', entity: 'odoo_request', eid,
          titleAr: 'طلب بانتظار الموافقة', title: 'Request awaiting approval',
          bodyAr: `طلب ${r.model} بتاريخ ${r.dateFrom} لسه بانتظار الموافقة.`, body: `${r.model} on ${r.dateFrom} is still awaiting approval.` });
      }
    }
    for (const t of tech) excuses.push({ personNo: t.person_no, date: t.d, kind: 'technical', ref: 'TI:' + t.id, source: 'technical_issue',
      reason: 'Late/absent due to a WFM-validated technical issue — excluded from conformance & penalty' });
    for (const rd of roster) {
      if ((rd.missing_punch || rd.missing_system) && (rd.presence === 'office' || rd.presence === 'wfh') && !reqDays.has(rd.person_no + '|' + rd.d)) {
        notifs.push({ personNo: rd.person_no, type: 'attendance_gap', entity: 'attendance_gap', eid: rd.person_no + '|' + rd.d,
          titleAr: 'نقص بصمة/تسجيل دخول', title: 'Missing punch / system login',
          bodyAr: `عندك نقص بصمة أو دخول بتاريخ ${rd.d} وما في طلب مقدّم — لازم تقدّم مبرّر.`, body: `You have a missing punch/login on ${rd.d} with no request — please submit a justification.` });
      }
    }

    const summary = {
      range: [dFrom, dTo], applied: doApply,
      excuses: { total: excuses.filter((e) => e.kind !== 'other').length, byKind: tally(excuses.filter((e) => e.kind !== 'other').map((e) => e.kind)) },
      notifications: { total: notifs.length, byType: tally(notifs.map((n) => n.type)) },
      // the alert list — usable NOW on the roster (RTA/WFM) even before agents have individual WFM logins
      alerts: notifs.slice(0, 300).map((n) => ({ personNo: n.personNo, type: n.type, ref: n.eid, ar: n.bodyAr, en: n.body })),
    };
    if (!doApply) return { ...summary, note: 'dry-run — add ?apply=1 to write excuses + notifications' };

    // ── APPLY ──
    let exW = 0, ntW = 0;
    for (const e of excuses) {
      if (e.kind === 'other') continue;   // hr.back.vacation etc. are separation/resumption records, not attendance excuses
      await this.ds.query(
        `INSERT INTO attendance_excuses (tenant_id, person_no, work_date, kind, source, ref, window_from, window_to, hours, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, person_no, work_date, kind, COALESCE(ref,''))
           DO UPDATE SET window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, hours=EXCLUDED.hours, reason=EXCLUDED.reason, updated_at=now()`,
        [tid, e.personNo, e.date, e.kind, e.source, e.ref, e.wf || null, e.wt || null, e.hours ?? null, e.reason]).catch(() => {});
      exW++;
    }
    // resolve person_no → recipient user id (only notify people who have a WFM user)
    const pnos = [...new Set(notifs.map((n) => n.personNo))];
    const urows = pnos.length ? await this.ds.query(
      `SELECT e.employee_no pno, u.id uid FROM employees e JOIN users u ON u.employee_id = e.id WHERE u.tenant_id=$1 AND e.employee_no = ANY($2)`,
      [tid, pnos]).catch(() => []) : [];
    const uidByPno = new Map(urows.map((r: any) => [String(r.pno), r.uid]));
    for (const n of notifs) {
      const uid = uidByPno.get(String(n.personNo));
      if (!uid) continue;   // no WFM account to notify (agent-facing notification needs a user)
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, created_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
         WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE tenant_id=$1 AND recipient_id=$2 AND entity_type=$8 AND entity_id=$9 AND is_read=false)`,
        [tid, uid, n.type, n.title, n.titleAr, n.body, n.bodyAr, n.entity, n.eid]).catch(() => {});
      ntW++;
    }
    return { ...summary, wrote: { excuses: exW, notificationsTried: ntW, recipientsResolved: uidByPno.size } };
  }
}
