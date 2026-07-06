import {
  Controller, Get, Post, Patch, Delete,
  Param, Query, Body, UseGuards, UseInterceptors, UploadedFile,
  BadRequestException, UnauthorizedException, ForbiddenException, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'technical-issues');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req,  file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `ti-${unique}${extname(file.originalname)}`);
  },
});
const fileFilter = (_req: any, file: any, cb: any) => {
  const ok = /^(image\/|video\/|application\/pdf)/.test(file.mimetype);
  cb(ok ? null : new BadRequestException('Only images, videos, and PDFs are allowed'), ok);
};

@Controller({ path: 'technical-issues', version: '1' })
@UseGuards(JwtAuthGuard)
export class TechnicalIssuesController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  // ── Dashboard stats (for RTA / Admin) ─────────────────────────────────────
  @Get('stats')
  @RequirePermissions('rta.view')
  async stats(@CurrentUser() user: any) {
    const tid = this.tid(user);
    const [rows] = await this.ds.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE status = 'pending_rta')       AS pending,
        COUNT(*) FILTER (WHERE status = 'validated')         AS validated,
        COUNT(*) FILTER (WHERE status = 'escalated_to_outage') AS escalated,
        COUNT(*) FILTER (WHERE status = 'resolved')          AS resolved,
        COUNT(*) FILTER (WHERE status = 'rejected')          AS rejected,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last7d,
        COUNT(*) FILTER (WHERE sla_due_at < NOW() AND status NOT IN ('resolved','rejected')) AS sla_breached,
        COUNT(*) FILTER (WHERE is_cx_issue)                              AS cx_issues
      FROM agent_tech_reports WHERE tenant_id = $1
    `, [tid]);
    return {
      total:       +rows.total,
      pending:     +rows.pending,
      validated:   +rows.validated,
      escalated:   +rows.escalated,
      resolved:    +rows.resolved,
      rejected:    +rows.rejected,
      last24h:     +rows.last24h,
      last7d:      +rows.last7d,
      slaBreached: +rows.sla_breached,
      cxIssues:    +rows.cx_issues,
    };
  }

  // ── List ───────────────────────────────────────────────────────────────────
  @Get()
  @RequirePermissions('tech_issues.view')
  async list(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('limit') limitQ?: string,
    @Query('offset') offsetQ?: string,
  ) {
    const tid    = this.tid(user);
    const limit  = Math.min(parseInt(limitQ  ?? '50', 10), 200);
    const offset = parseInt(offsetQ ?? '0', 10);
    const wheres = ['ti.tenant_id = $1'];
    const params: any[] = [tid];
    let p = 2;
    if (status)   { wheres.push(`ti.status = $${p++}`);   params.push(status); }
    if (severity) { wheres.push(`ti.severity = $${p++}`); params.push(severity); }
    // Self-scope: agents (no tech_issues.view) see only the reports they filed.
    const perms = user?.permissionCodes ?? user?.permissions ?? [];
    if (!perms.includes('tech_issues.view')) {
      wheres.push(`ti.reporter_id = $${p++}`);
      params.push(user?.userId ?? user?.sub ?? '00000000-0000-0000-0000-000000000000');
    }

    const where = wheres.join(' AND ');
    const [rows, cntRows] = await Promise.all([
      this.ds.query(`
        SELECT ti.*,
          (SELECT COUNT(*) FROM agent_tech_report_attachments WHERE report_id = ti.id) AS attachments_count
        FROM agent_tech_reports ti
        WHERE ${where}
        ORDER BY ti.created_at DESC
        LIMIT $${p++} OFFSET $${p++}
      `, [...params, limit, offset]),
      this.ds.query(`SELECT COUNT(*) AS cnt FROM agent_tech_reports ti WHERE ${where}`, params),
    ]);

    return { total: +cntRows[0].cnt, data: rows.map(this.map) };
  }

  // ── Create (with optional first attachment) ───────────────────────────────
  @Post()
  @RequirePermissions('tech_issues.create')
  @UseInterceptors(FileInterceptor('file', { storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } }))
  async create(
    @CurrentUser() user: any,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const tid = this.tid(user);
    const actor = user?.userId ?? user?.sub;

    const { title, description, severity = 'medium', functionName, channel } = body;
    if (!title?.trim()) throw new BadRequestException('Title is required');

    // Repeat / systemic-CX detection: how many same-titled issues for the same
    // function in the last 30 days. 20+ of the same reason → flag as a CX issue.
    const [rep] = await this.ds.query(`
      SELECT COUNT(*)::int AS cnt FROM agent_tech_reports
       WHERE tenant_id = $1 AND LOWER(TRIM(title)) = LOWER(TRIM($2))
         AND COALESCE(function_name,'') = COALESCE($3,'')
         AND status <> 'rejected' AND created_at >= NOW() - INTERVAL '30 days'
    `, [tid, title.trim(), functionName || null]);
    const priorCount = rep?.cnt ?? 0;
    const isCx = priorCount + 1 >= 20;

    const [issue] = await this.ds.query(`
      INSERT INTO agent_tech_reports
        (tenant_id, title, description, severity, function_name, channel, reporter_id, reporter_name,
         sla_due_at, repeat_count, is_cx_issue)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() + INTERVAL '48 hours', $9, $10)
      RETURNING *
    `, [tid, title.trim(), description || null, severity, functionName || null, channel || null,
        actor || null, user?.name || user?.email || null, priorCount, isCx]);

    if (file) {
      await this.ds.query(`
        INSERT INTO agent_tech_report_attachments
          (report_id, tenant_id, uploaded_by, uploader_name, original_name, stored_name, mime_type, file_size)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [issue.id, tid, actor || null, user?.name || null,
          file.originalname, file.filename, file.mimetype, file.size]);
    }

    return this.getOne(user, issue.id);
  }

  // ── Detail ─────────────────────────────────────────────────────────────────
  @Get(':id')
  @RequirePermissions('tech_issues.view')
  async getOne(@CurrentUser() user: any, @Param('id') id: string) {
    const tid = this.tid(user);
    const [issue] = await this.ds.query(
      `SELECT * FROM agent_tech_reports WHERE id = $1 AND tenant_id = $2`, [id, tid],
    );
    if (!issue) throw new BadRequestException('Issue not found');
    // Non-viewers (agents) may only open their own report.
    const perms = user?.permissionCodes ?? user?.permissions ?? [];
    if (!perms.includes('tech_issues.view') && issue.reporter_id !== (user?.userId ?? user?.sub)) {
      throw new ForbiddenException('Not allowed to view this report');
    }

    const attachments = await this.ds.query(
      `SELECT * FROM agent_tech_report_attachments WHERE report_id = $1 ORDER BY created_at ASC`, [id],
    );

    return {
      ...this.map(issue),
      attachments: attachments.map((a: any) => ({
        id: a.id, uploaderName: a.uploader_name,
        originalName: a.original_name, storedName: a.stored_name,
        mimeType: a.mime_type, fileSize: +a.file_size,
        url:     `/uploads/technical-issues/${a.stored_name}`,
        isImage: /^image\//.test(a.mime_type ?? ''),
        isVideo: /^video\//.test(a.mime_type ?? ''),
        createdAt: a.created_at,
      })),
    };
  }

  // ── Add attachment ─────────────────────────────────────────────────────────
  @Post(':id/attachments')
  @RequirePermissions('tech_issues.create')
  @UseInterceptors(FileInterceptor('file', { storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } }))
  async addAttachment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const tid   = this.tid(user);
    const actor = user?.userId ?? user?.sub;
    if (!file) throw new BadRequestException('No file provided');

    const [issue] = await this.ds.query(
      `SELECT id FROM agent_tech_reports WHERE id = $1 AND tenant_id = $2`, [id, tid],
    );
    if (!issue) throw new BadRequestException('Issue not found');

    await this.ds.query(`
      INSERT INTO agent_tech_report_attachments
        (report_id, tenant_id, uploaded_by, uploader_name, original_name, stored_name, mime_type, file_size)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [id, tid, actor || null, user?.name || null,
        file.originalname, file.filename, file.mimetype, file.size]);

    return { ok: true };
  }

  // ── Delete attachment ──────────────────────────────────────────────────────
  @Delete(':id/attachments/:aid')
  @RequirePermissions('tech_issues.create')
  async deleteAttachment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('aid') aid: string,
  ) {
    const tid = this.tid(user);
    const [row] = await this.ds.query(
      `SELECT stored_name FROM agent_tech_report_attachments WHERE id = $1 AND report_id = $2 AND tenant_id = $3`,
      [aid, id, tid],
    );
    if (!row) throw new BadRequestException('Attachment not found');

    const filePath = join(UPLOAD_DIR, row.stored_name);
    if (existsSync(filePath)) unlinkSync(filePath);
    await this.ds.query(`DELETE FROM agent_tech_report_attachments WHERE id = $1 AND tenant_id = $2`, [aid, tid]);
    return { ok: true };
  }

  // ── RTA Validate ──────────────────────────────────────────────────────────
  @Patch(':id/validate')
  @RequirePermissions('rta.view')
  async validate(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { notes?: string; convertToOutage?: boolean; outageTitle?: string; severity?: string; outageTypeId?: string },
  ) {
    const tid   = this.tid(user);
    const actor = user?.userId ?? user?.sub;

    const [issue] = await this.ds.query(
      `SELECT * FROM agent_tech_reports WHERE id = $1 AND tenant_id = $2`, [id, tid],
    );
    if (!issue) throw new BadRequestException('Issue not found');
    if (issue.status !== 'pending_rta') throw new BadRequestException('Issue is not pending RTA validation');

    if (body.convertToOutage) {
      // Create outage from this issue
      const outageTitle  = body.outageTitle || issue.title;
      const outageSev    = body.severity    || issue.severity;
      const slaDefaults: Record<string, number> = { critical: 30, high: 60, medium: 120, low: 240 };
      const slaMins      = slaDefaults[outageSev] ?? 60;

      const [outage] = await this.ds.query(`
        INSERT INTO outages
          (tenant_id, title, description, severity, status,
           outage_type_id, impacted_function_ids,
           started_at, reported_by, impact_description,
           sla_target_minutes, sla_due_at)
        VALUES ($1,$2,$3,$4,'reported',$5,'{}'::uuid[],NOW(),$6,$7,$8,NOW() + ($8 || ' minutes')::interval)
        RETURNING id
      `, [tid, outageTitle, issue.description, outageSev,
          body.outageTypeId || null, actor, issue.description || null, slaMins]);

      await this.ds.query(`
        UPDATE agent_tech_reports
        SET status = 'escalated_to_outage', outage_id = $1,
            validated_by_id = $2, validated_by_name = $3,
            validated_at = NOW(), escalated_at = NOW(),
            resolution_notes = $4, updated_at = NOW()
        WHERE id = $5
      `, [outage.id, actor, user?.name || null, body.notes || null, id]);

      return { ok: true, convertedToOutage: true, outageId: outage.id };
    }

    await this.ds.query(`
      UPDATE agent_tech_reports
      SET status = 'validated',
          validated_by_id = $1, validated_by_name = $2,
          validated_at = NOW(), resolution_notes = $3, updated_at = NOW()
      WHERE id = $4
    `, [actor, user?.name || null, body.notes || null, id]);

    return { ok: true, convertedToOutage: false };
  }

  // ── RTA Reject ────────────────────────────────────────────────────────────
  @Patch(':id/reject')
  @RequirePermissions('rta.view')
  async reject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const tid   = this.tid(user);
    const actor = user?.userId ?? user?.sub;

    await this.ds.query(`
      UPDATE agent_tech_reports
      SET status = 'rejected',
          validated_by_id = $1, validated_by_name = $2,
          validated_at = NOW(), rejection_reason = $3, updated_at = NOW()
      WHERE id = $4 AND tenant_id = $5
    `, [actor, user?.name || null, body.reason || null, id, tid]);

    return { ok: true };
  }

  // ── Resolve ────────────────────────────────────────────────────────────────
  @Patch(':id/resolve')
  @RequirePermissions('tech_issues.resolve')
  async resolve(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    const tid = this.tid(user);
    await this.ds.query(`
      UPDATE agent_tech_reports
      SET status = 'resolved', resolution_notes = $1, resolved_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
    `, [body.notes || null, id, tid]);
    return { ok: true };
  }

  // ── HTML Report for sharing ────────────────────────────────────────────────
  @Get(':id/report')
  @RequirePermissions('tech_issues.view')
  async htmlReport(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const tid = this.tid(user);
    const [issue] = await this.ds.query(
      `SELECT * FROM agent_tech_reports WHERE id = $1 AND tenant_id = $2`, [id, tid],
    );
    if (!issue) throw new BadRequestException('Issue not found');
    const perms = user?.permissionCodes ?? user?.permissions ?? [];
    if (!perms.includes('tech_issues.view') && issue.reporter_id !== (user?.userId ?? user?.sub)) {
      throw new ForbiddenException('Not allowed to view this report');
    }

    const attachments = await this.ds.query(
      `SELECT * FROM agent_tech_report_attachments WHERE report_id = $1 ORDER BY created_at ASC`, [id],
    );

    const html = buildIssueReportHtml(issue, attachments);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ti-report-${id.slice(0,8)}.html"`);
    res.send(html);
  }

  // ── Mapper ─────────────────────────────────────────────────────────────────
  private map(r: any) {
    return {
      id: r.id, title: r.title, description: r.description,
      status: r.status, severity: r.severity,
      functionName: r.function_name, channel: r.channel,
      reporterName: r.reporter_name,
      validatedByName: r.validated_by_name, validatedAt: r.validated_at,
      rejectionReason: r.rejection_reason,
      outageId: r.outage_id, escalatedAt: r.escalated_at,
      resolutionNotes: r.resolution_notes, resolvedAt: r.resolved_at,
      repeatCount: +r.repeat_count,
      isCxIssue: r.is_cx_issue ?? false,
      slaDueAt: r.sla_due_at,
      slaTargetMinutes: r.sla_target_minutes != null ? +r.sla_target_minutes : null,
      slaBreached: r.sla_due_at ? (new Date(r.sla_due_at) < new Date() && !['resolved','rejected'].includes(r.status)) : false,
      attachmentsCount: +(r.attachments_count ?? 0),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
}

// ── Beautiful HTML Report Builder ─────────────────────────────────────────────
function buildIssueReportHtml(issue: any, attachments: any[]): string {
  const fmtDt = (d: string) => d ? new Date(d).toLocaleString('ar-KW') : '—';
  const sevColors: Record<string, string> = {
    low: '#34d399', medium: '#fbbf24', high: '#fb923c', critical: '#f87171',
  };
  const stColors: Record<string, string> = {
    pending_rta: '#f87171', validated: '#fb923c',
    escalated_to_outage: '#818cf8', resolved: '#34d399', rejected: '#64748b',
  };
  const stAr: Record<string, string> = {
    pending_rta: 'قيد مراجعة RTA', validated: 'تم التحقق',
    escalated_to_outage: 'تحوّل لعطل', resolved: 'محلول', rejected: 'مرفوض',
  };
  const imgAttachments = attachments.filter(a => /^image\//.test(a.mime_type ?? ''));
  const vidAttachments = attachments.filter(a => /^video\//.test(a.mime_type ?? ''));

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تقرير مشكلة تقنية — ${issue.title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Tajawal',sans-serif;background:#0a0f1e;color:#e2e8f0;min-height:100vh;padding:24px}
  .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px;margin-bottom:16px}
  .header{background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.1));border:1px solid rgba(99,102,241,0.25);border-radius:20px;padding:32px;margin-bottom:20px;text-align:center}
  .brand{font-size:13px;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px}
  h1{font-size:26px;font-weight:900;color:#f1f5f9;line-height:1.3;margin-bottom:16px}
  .badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:8px}
  .badge{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .field{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px}
  .field-label{font-size:11px;color:#475569;margin-bottom:6px;letter-spacing:.5px}
  .field-value{font-size:14px;font-weight:500;color:#e2e8f0}
  .section-title{font-size:13px;font-weight:700;color:#94a3b8;margin-bottom:12px;display:flex;align-items:center;gap:6px}
  .img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
  .img-grid img{width:100%;border-radius:10px;border:1px solid rgba(255,255,255,0.08);aspect-ratio:4/3;object-fit:cover}
  .video-list a{display:block;padding:10px 14px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:10px;color:#c084fc;text-decoration:none;margin-bottom:8px;font-size:13px}
  .footer{text-align:center;font-size:11px;color:#334155;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.05)}
  @media print{body{background:#fff;color:#1e293b}.card,.header,.field{background:#f8fafc;border-color:#e2e8f0}h1{color:#1e293b}.field-value{color:#1e293b}.field-label{color:#64748b}}
</style>
</head>
<body>
<div class="header">
  <div class="brand">Boutiqaat Contact Center · WFM Platform</div>
  <h1>${issue.title}</h1>
  <div class="badges">
    <span class="badge" style="color:${sevColors[issue.severity]??'#fbbf24'};border-color:${sevColors[issue.severity]??'#fbbf24'}40;background:${sevColors[issue.severity]??'#fbbf24'}18">
      ${issue.severity === 'critical' ? 'حرج' : issue.severity === 'high' ? 'عالي' : issue.severity === 'medium' ? 'متوسط' : 'منخفض'}
    </span>
    <span class="badge" style="color:${stColors[issue.status]??'#818cf8'};border-color:${stColors[issue.status]??'#818cf8'}40;background:${stColors[issue.status]??'#818cf8'}18">
      ${stAr[issue.status] ?? issue.status}
    </span>
  </div>
</div>

<div class="card">
  <div class="section-title">📋 تفاصيل المشكلة</div>
  <div class="grid">
    <div class="field"><div class="field-label">المُبلِّغ</div><div class="field-value">${issue.reporter_name ?? '—'}</div></div>
    <div class="field"><div class="field-label">الوظيفة / القسم</div><div class="field-value">${issue.function_name ?? '—'}</div></div>
    <div class="field"><div class="field-label">القناة</div><div class="field-value">${issue.channel ?? '—'}</div></div>
    <div class="field"><div class="field-label">وقت الإبلاغ</div><div class="field-value">${fmtDt(issue.created_at)}</div></div>
    ${issue.validated_by_name ? `<div class="field"><div class="field-label">تحقق بواسطة RTA</div><div class="field-value">${issue.validated_by_name}</div></div>` : ''}
    ${issue.validated_at ? `<div class="field"><div class="field-label">وقت التحقق</div><div class="field-value">${fmtDt(issue.validated_at)}</div></div>` : ''}
  </div>
  ${issue.description ? `<div class="field" style="margin-top:12px"><div class="field-label">وصف المشكلة</div><div class="field-value" style="line-height:1.7">${issue.description}</div></div>` : ''}
  ${issue.resolution_notes ? `<div class="field" style="margin-top:12px;border-color:rgba(52,211,153,0.2)"><div class="field-label">ملاحظات RTA</div><div class="field-value" style="color:#34d399;line-height:1.7">${issue.resolution_notes}</div></div>` : ''}
  ${issue.rejection_reason ? `<div class="field" style="margin-top:12px;border-color:rgba(239,68,68,0.2)"><div class="field-label">سبب الرفض</div><div class="field-value" style="color:#f87171">${issue.rejection_reason}</div></div>` : ''}
</div>

${imgAttachments.length > 0 ? `
<div class="card">
  <div class="section-title">🖼 الصور المرفقة (${imgAttachments.length})</div>
  <div class="img-grid">
    ${imgAttachments.map(a => `<img src="/uploads/technical-issues/${a.stored_name}" alt="${a.original_name}" />`).join('')}
  </div>
</div>` : ''}

${vidAttachments.length > 0 ? `
<div class="card">
  <div class="section-title">🎥 مقاطع الفيديو (${vidAttachments.length})</div>
  <div class="video-list">
    ${vidAttachments.map(a => `<a href="/uploads/technical-issues/${a.stored_name}" target="_blank">▶ ${a.original_name}</a>`).join('')}
  </div>
</div>` : ''}

<div class="footer">
  تم إنشاء هذا التقرير تلقائياً بواسطة منصة WFM — Boutiqaat Contact Center<br>
  ${new Date().toLocaleString('ar-KW')}
</div>
</body>
</html>`;
}
