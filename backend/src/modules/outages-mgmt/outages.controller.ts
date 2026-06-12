import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, UseInterceptors,
  UploadedFile, NotFoundException, BadRequestException,
  StreamableFile, Res, Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsOptional, IsString, IsArray, IsUUID, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { JwtAuthGuard }  from '@common/guards/jwt-auth.guard';
import { CurrentUser }   from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

// ── DTOs ──────────────────────────────────────────────────────────────────────

class CreateOutageDto {
  @IsOptional() @IsUUID()    outageTypeId?: string;
  @IsString()                title: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsString()  severity?: string;
  @IsOptional() @IsArray()   impactedFunctionIds?: string[];
  @IsOptional() @IsString()  impactDescription?: string;
  @IsOptional() @IsString()  startedAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1440) slaTargetMinutes?: number;
}

class UpdateOutageDto {
  @IsOptional() @IsString()  status?: string;
  @IsOptional() @IsString()  rootCause?: string;
  @IsOptional() @IsString()  resolution?: string;
  @IsOptional() @IsString()  severity?: string;
  @IsOptional() @IsString()  endedAt?: string;
  @IsOptional() @IsString()  impactDescription?: string;
  @IsOptional() @IsUUID()    assignedTo?: string;
  @IsOptional() @IsInt()     slaTargetMinutes?: number;
}

class AddNoteDto {
  @IsString() content: string;
  @IsOptional() @IsBoolean() isInternal?: boolean;
}

class AssignDto {
  @IsUUID() assignedTo: string;
}

// ── SLA default by severity ───────────────────────────────────────────────────
const SLA_DEFAULTS: Record<string, number> = {
  critical: 30, high: 60, medium: 120, low: 240,
};

// ── Multer storage ────────────────────────────────────────────────────────────
const storage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'outages');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('Outages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('outages.view')
@Controller({ path: 'outages', version: '1' })
export class OutagesController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ── Dashboard ──────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Outage dashboard metrics' })
  async dashboard(@CurrentUser() u: any) {
    const tid = u.tenantId;

    const [totals] = await this.ds.query(`
      SELECT
        COUNT(*)                                                            AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))         AS active,
        COUNT(*) FILTER (WHERE severity = 'critical'
                           AND status NOT IN ('resolved','closed'))         AS critical_active,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed'))             AS resolved_total,
        ROUND(AVG(duration_minutes) FILTER (WHERE duration_minutes IS NOT NULL))::int AS avg_duration_min,
        COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL
                           AND (status NOT IN ('resolved','closed') AND sla_due_at < NOW())
                           OR  (status IN ('resolved','closed')     AND resolved_at > sla_due_at)) AS sla_breached,
        COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL)                      AS sla_tracked,
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days')    AS last_7d,
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days')   AS last_30d
      FROM outages WHERE tenant_id = $1`, [tid]);

    const bySeverity = await this.ds.query(`
      SELECT severity, COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed')) AS active
      FROM outages WHERE tenant_id = $1
      GROUP BY severity ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`,
      [tid]);

    const byStatus = await this.ds.query(`
      SELECT status, COUNT(*) AS total FROM outages
      WHERE tenant_id = $1 GROUP BY status ORDER BY status`, [tid]);

    const byType = await this.ds.query(`
      SELECT ot.name, ot.name_ar, COUNT(o.id) AS total,
             COUNT(o.id) FILTER (WHERE o.status NOT IN ('resolved','closed')) AS active,
             ROUND(AVG(o.duration_minutes))::int AS avg_duration_min
      FROM outages o
      LEFT JOIN outage_types ot ON ot.id = o.outage_type_id
      WHERE o.tenant_id = $1
      GROUP BY ot.name, ot.name_ar ORDER BY total DESC LIMIT 10`, [tid]);

    const trend = await this.ds.query(`
      SELECT DATE_TRUNC('day', started_at)::date AS day,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE severity = 'critical') AS critical
      FROM outages
      WHERE tenant_id = $1 AND started_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1`, [tid]);

    const topHandlers = await this.ds.query(`
      SELECT u.first_name || ' ' || COALESCE(u.last_name,'') AS name,
             COUNT(o.id) AS handled,
             ROUND(AVG(o.duration_minutes))::int AS avg_duration_min
      FROM outages o
      JOIN users u ON u.id = o.assigned_to
      WHERE o.tenant_id = $1 AND o.assigned_to IS NOT NULL
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY handled DESC LIMIT 10`, [tid]);

    const activeOutages = await this.ds.query(`
      SELECT o.id, o.title, o.severity, o.status, o.started_at, o.sla_due_at,
             ot.name AS type_name, ot.name_ar AS type_name_ar,
             EXTRACT(EPOCH FROM (NOW() - o.started_at))/60 AS elapsed_minutes,
             u.first_name || ' ' || COALESCE(u.last_name,'') AS handler_name
      FROM outages o
      LEFT JOIN outage_types ot ON ot.id = o.outage_type_id
      LEFT JOIN users u ON u.id = o.assigned_to
      WHERE o.tenant_id = $1 AND o.status NOT IN ('resolved','closed')
      ORDER BY CASE o.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               o.started_at ASC`, [tid]);

    const t = totals;
    return {
      summary: {
        total:           parseInt(t.total),
        active:          parseInt(t.active),
        criticalActive:  parseInt(t.critical_active),
        resolvedTotal:   parseInt(t.resolved_total),
        avgDurationMin:  t.avg_duration_min ? parseInt(t.avg_duration_min) : null,
        slaBreached:     parseInt(t.sla_breached),
        slaTracked:      parseInt(t.sla_tracked),
        slaBreachRate:   t.sla_tracked > 0 ? Math.round(t.sla_breached / t.sla_tracked * 100) : 0,
        last7d:          parseInt(t.last_7d),
        last30d:         parseInt(t.last_30d),
      },
      bySeverity: bySeverity.map((r: any) => ({ severity: r.severity, total: parseInt(r.total), active: parseInt(r.active) })),
      byStatus:   byStatus.map((r: any) => ({ status: r.status, total: parseInt(r.total) })),
      byType:     byType.map((r: any) => ({
        name: r.name, nameAr: r.name_ar,
        total: parseInt(r.total), active: parseInt(r.active),
        avgDurationMin: r.avg_duration_min ? parseInt(r.avg_duration_min) : null,
      })),
      trend: trend.map((r: any) => ({ day: r.day, total: parseInt(r.total), critical: parseInt(r.critical) })),
      topHandlers: topHandlers.map((r: any) => ({ name: r.name?.trim(), handled: parseInt(r.handled), avgDurationMin: r.avg_duration_min })),
      activeOutages: activeOutages.map((r: any) => ({
        id: r.id, title: r.title, severity: r.severity, status: r.status,
        startedAt: r.started_at, slaDueAt: r.sla_due_at,
        typeName: r.type_name, typeNameAr: r.type_name_ar,
        elapsedMinutes: Math.round(parseFloat(r.elapsed_minutes ?? '0')),
        handlerName: r.handler_name?.trim() || null,
        slaBreached: r.sla_due_at ? new Date(r.sla_due_at) < new Date() : false,
      })),
    };
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  @Get('report')
  @ApiOperation({ summary: 'Detailed outage report with filters' })
  async report(
    @CurrentUser() u: any,
    @Query('from')        from?: string,
    @Query('to')          to?: string,
    @Query('status')      status?: string,
    @Query('severity')    severity?: string,
    @Query('typeId')      typeId?: string,
    @Query('handlerId')   handlerId?: string,
    @Query('limit')       limitQ = '200',
    @Query('offset')      offsetQ = '0',
  ) {
    const tid = u.tenantId;
    const params: any[] = [tid];
    const conds: string[] = ['o.tenant_id = $1'];

    if (from)      { params.push(from);      conds.push(`o.started_at >= $${params.length}::timestamptz`); }
    if (to)        { params.push(to);        conds.push(`o.started_at <= $${params.length}::timestamptz`); }
    if (status)    { params.push(status);    conds.push(`o.status = $${params.length}`); }
    if (severity)  { params.push(severity);  conds.push(`o.severity = $${params.length}`); }
    if (typeId)    { params.push(typeId);     conds.push(`o.outage_type_id = $${params.length}`); }
    if (handlerId) { params.push(handlerId); conds.push(`o.assigned_to = $${params.length}`); }

    const where = conds.join(' AND ');

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM outages o WHERE ${where}`, params);

    params.push(parseInt(limitQ), parseInt(offsetQ));
    const rows = await this.ds.query(`
      SELECT o.*,
        ot.name AS type_name, ot.name_ar AS type_name_ar,
        ru.first_name || ' ' || COALESCE(ru.last_name,'') AS reported_by_name,
        rr.first_name || ' ' || COALESCE(rr.last_name,'') AS resolved_by_name,
        ua.first_name || ' ' || COALESCE(ua.last_name,'') AS handler_name,
        uv.first_name || ' ' || COALESCE(uv.last_name,'') AS validated_by_name,
        (SELECT COUNT(*) FROM outage_notes n WHERE n.outage_id = o.id)        AS notes_count,
        (SELECT COUNT(*) FROM outage_attachments a WHERE a.outage_id = o.id)  AS attachments_count,
        (SELECT COALESCE(ARRAY_AGG(f.name ORDER BY f.name), '{}')
         FROM functions f WHERE f.id = ANY(o.impacted_function_ids)
         AND f.tenant_id = o.tenant_id) AS impacted_function_names
      FROM outages o
      LEFT JOIN outage_types ot ON ot.id = o.outage_type_id
      LEFT JOIN users ru ON ru.id = o.reported_by
      LEFT JOIN users rr ON rr.id = o.resolved_by
      LEFT JOIN users ua ON ua.id = o.assigned_to
      LEFT JOIN users uv ON uv.id = o.validated_by
      WHERE ${where}
      ORDER BY o.started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

    return {
      total: parseInt(total),
      data: rows.map(this.mapOutage),
    };
  }

  // ── Types ──────────────────────────────────────────────────────────────────

  @Get('types')
  async types(@CurrentUser() u: any) {
    return this.ds.query(
      `SELECT id, name, name_ar, code FROM outage_types WHERE tenant_id = $1 AND is_active ORDER BY sort_order`,
      [u.tenantId]);
  }

  // ── List ───────────────────────────────────────────────────────────────────

  @Get()
  async list(
    @CurrentUser() u: any,
    @Query('status')   status?: string,
    @Query('severity') severity?: string,
    @Query('limit')    limitQ = '50',
    @Query('offset')   offsetQ = '0',
  ) {
    const tid = u.tenantId;
    const params: any[] = [tid];
    const conds = ['o.tenant_id = $1'];

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        params.push(statuses[0]);
        conds.push(`o.status = $${params.length}::outage_status_enum`);
      } else {
        params.push(statuses);
        conds.push(`o.status = ANY($${params.length}::outage_status_enum[])`);
      }
    }
    if (severity) { params.push(severity); conds.push(`o.severity = $${params.length}`); }
    const where = conds.join(' AND ');

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM outages o WHERE ${where}`, params);

    params.push(parseInt(limitQ), parseInt(offsetQ));
    const rows = await this.ds.query(`
      SELECT o.*,
        ot.name AS type_name, ot.name_ar AS type_name_ar,
        ru.first_name || ' ' || COALESCE(ru.last_name,'') AS reported_by_name,
        rr.first_name || ' ' || COALESCE(rr.last_name,'') AS resolved_by_name,
        ua.first_name || ' ' || COALESCE(ua.last_name,'') AS handler_name,
        (SELECT COUNT(*) FROM outage_notes n WHERE n.outage_id = o.id)       AS notes_count,
        (SELECT COUNT(*) FROM outage_attachments a WHERE a.outage_id = o.id) AS attachments_count,
        (SELECT COALESCE(ARRAY_AGG(f.name ORDER BY f.name), '{}')
         FROM functions f WHERE f.id = ANY(o.impacted_function_ids)
         AND f.tenant_id = o.tenant_id) AS impacted_function_names
      FROM outages o
      LEFT JOIN outage_types ot ON ot.id = o.outage_type_id
      LEFT JOIN users ru ON ru.id = o.reported_by
      LEFT JOIN users rr ON rr.id = o.resolved_by
      LEFT JOIN users ua ON ua.id = o.assigned_to
      WHERE ${where}
      ORDER BY o.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

    return { total: parseInt(total), data: rows.map(this.mapOutage) };
  }

  // ── Get One (with notes + attachments) ────────────────────────────────────

  @Get(':id')
  async findOne(@CurrentUser() u: any, @Param('id') id: string) {
    const rows = await this.ds.query(`
      SELECT o.*,
        ot.name AS type_name, ot.name_ar AS type_name_ar,
        ru.first_name || ' ' || COALESCE(ru.last_name,'') AS reported_by_name,
        rr.first_name || ' ' || COALESCE(rr.last_name,'') AS resolved_by_name,
        ua.first_name || ' ' || COALESCE(ua.last_name,'') AS handler_name,
        uv.first_name || ' ' || COALESCE(uv.last_name,'') AS validated_by_name,
        (SELECT COALESCE(ARRAY_AGG(f.name ORDER BY f.name), '{}')
         FROM functions f WHERE f.id = ANY(o.impacted_function_ids)
         AND f.tenant_id = o.tenant_id) AS impacted_function_names
      FROM outages o
      LEFT JOIN outage_types ot ON ot.id = o.outage_type_id
      LEFT JOIN users ru ON ru.id = o.reported_by
      LEFT JOIN users rr ON rr.id = o.resolved_by
      LEFT JOIN users ua ON ua.id = o.assigned_to
      LEFT JOIN users uv ON uv.id = o.validated_by
      WHERE o.id = $1 AND o.tenant_id = $2`, [id, u.tenantId]);

    if (!rows.length) throw new NotFoundException();
    const outage = this.mapOutage(rows[0]);

    const notes = await this.ds.query(
      `SELECT id, author_name, content, is_internal, created_at
       FROM outage_notes WHERE outage_id = $1 ORDER BY created_at ASC`, [id]);

    const attachments = await this.ds.query(
      `SELECT id, uploader_name, original_name, stored_name, mime_type, file_size, created_at
       FROM outage_attachments WHERE outage_id = $1 ORDER BY created_at ASC`, [id]);

    return {
      ...outage,
      notes,
      attachments: attachments.map((a: any) => ({
        ...a,
        url: `/uploads/outages/${a.stored_name}`,
        isImage: (a.mime_type ?? '').startsWith('image/'),
        isVideo: (a.mime_type ?? '').startsWith('video/'),
      })),
    };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions('outages.create')
  async create(@CurrentUser() actor: any, @Body() dto: CreateOutageDto) {
    const slaMin = dto.slaTargetMinutes ?? SLA_DEFAULTS[dto.severity ?? 'medium'] ?? 60;
    const startTs = dto.startedAt ?? new Date().toISOString();
    const slaDueAt = new Date(new Date(startTs).getTime() + slaMin * 60000).toISOString();

    const [row] = await this.ds.query(`
      INSERT INTO outages (
        id, tenant_id, outage_type_id, title, description, severity, status,
        impacted_function_ids, impact_description, started_at, sla_target_minutes,
        sla_due_at, reported_by, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, 'reported',
        $6, $7, $8, $9, $10, $11, NOW(), NOW()
      ) RETURNING id`,
      [
        actor.tenantId,
        dto.outageTypeId ?? null,
        dto.title,
        dto.description ?? null,
        dto.severity ?? 'medium',
        dto.impactedFunctionIds?.length ? `{${dto.impactedFunctionIds.join(',')}}` : '{}',
        dto.impactDescription ?? null,
        startTs,
        slaMin,
        slaDueAt,
        actor.userId ?? actor.id ?? null,
      ]);

    await this.ds.query(`
      INSERT INTO audit_logs (id, tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, new_value, created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,'outage.create','outages','outage',$4,$5::jsonb,NOW())`,
      [actor.tenantId, actor.userId ?? actor.id, actor.email, row.id, JSON.stringify(dto)]);

    return { id: row.id, slaTargetMinutes: slaMin, slaDueAt };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @RequirePermissions('outages.edit')
  async update(@CurrentUser() actor: any, @Param('id') id: string, @Body() dto: UpdateOutageDto) {
    const [existing] = await this.ds.query(
      `SELECT id FROM outages WHERE id = $1 AND tenant_id = $2`, [id, actor.tenantId]);
    if (!existing) throw new NotFoundException();

    const sets: string[] = ['updated_at = NOW()'];
    const params: any[]  = [];

    if (dto.status)            { params.push(dto.status);            sets.push(`status = $${params.length}`); }
    if (dto.severity)          { params.push(dto.severity);          sets.push(`severity = $${params.length}`); }
    if (dto.rootCause)         { params.push(dto.rootCause);         sets.push(`root_cause = $${params.length}`); }
    if (dto.resolution)        { params.push(dto.resolution);        sets.push(`resolution = $${params.length}`); }
    if (dto.impactDescription) { params.push(dto.impactDescription); sets.push(`impact_description = $${params.length}`); }
    if (dto.assignedTo)        { params.push(dto.assignedTo);        sets.push(`assigned_to = $${params.length}`); }
    if (dto.slaTargetMinutes)  { params.push(dto.slaTargetMinutes);  sets.push(`sla_target_minutes = $${params.length}`); }

    if (dto.status === 'validated') {
      params.push(actor.userId ?? actor.id);
      sets.push(`validated_by = $${params.length}`, `validated_at = NOW()`);
    }
    if (dto.status === 'resolved') {
      const endTs = dto.endedAt ?? new Date().toISOString();
      params.push(actor.userId ?? actor.id, endTs);
      sets.push(
        `resolved_by = $${params.length - 1}`,
        `resolved_at = $${params.length}`,
        `ended_at = $${params.length}`,
      );
    }
    if (dto.endedAt && dto.status !== 'resolved') {
      params.push(dto.endedAt); sets.push(`ended_at = $${params.length}`);
    }

    params.push(id, actor.tenantId);
    await this.ds.query(
      `UPDATE outages SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
      params);

    return { success: true };
  }

  // ── Assign RTA Handler ─────────────────────────────────────────────────────

  @Patch(':id/assign')
  @RequirePermissions('outages.validate')
  async assign(@CurrentUser() actor: any, @Param('id') id: string, @Body() dto: AssignDto) {
    const [existing] = await this.ds.query(
      `SELECT id FROM outages WHERE id = $1 AND tenant_id = $2`, [id, actor.tenantId]);
    if (!existing) throw new NotFoundException();

    await this.ds.query(
      `UPDATE outages SET assigned_to = $1, status = CASE WHEN status = 'reported' THEN 'validated' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [dto.assignedTo, id, actor.tenantId]);

    return { success: true };
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  @Get(':id/notes')
  async getNotes(@CurrentUser() u: any, @Param('id') id: string) {
    await this.assertOutageAccess(id, u.tenantId);
    return this.ds.query(
      `SELECT id, author_name, content, is_internal, created_at
       FROM outage_notes WHERE outage_id = $1 ORDER BY created_at ASC`, [id]);
  }

  @Post(':id/notes')
  async addNote(@CurrentUser() actor: any, @Param('id') id: string, @Body() dto: AddNoteDto) {
    await this.assertOutageAccess(id, actor.tenantId);
    const authorName = [actor.firstName, actor.lastName].filter(Boolean).join(' ') || actor.email;

    const [row] = await this.ds.query(`
      INSERT INTO outage_notes (id, outage_id, tenant_id, author_id, author_name, content, is_internal, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW()) RETURNING id, created_at`,
      [id, actor.tenantId, actor.userId ?? actor.id, authorName, dto.content, dto.isInternal ?? true]);

    return { id: row.id, authorName, content: dto.content, isInternal: dto.isInternal ?? true, createdAt: row.created_at };
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  @Get(':id/attachments')
  async getAttachments(@CurrentUser() u: any, @Param('id') id: string) {
    await this.assertOutageAccess(id, u.tenantId);
    const rows = await this.ds.query(
      `SELECT id, uploader_name, original_name, stored_name, mime_type, file_size, created_at
       FROM outage_attachments WHERE outage_id = $1 ORDER BY created_at ASC`, [id]);
    return rows.map((a: any) => ({
      ...a,
      url: `/uploads/outages/${a.stored_name}`,
      isImage: (a.mime_type ?? '').startsWith('image/'),
      isVideo: (a.mime_type ?? '').startsWith('video/'),
    }));
  }

  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('outages.edit')
  @UseInterceptors(FileInterceptor('file', {
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|mkv|webm|pdf)$/i;
      if (allowed.test(file.originalname)) cb(null, true);
      else cb(new BadRequestException('File type not allowed'), false);
    },
  }))
  async uploadAttachment(
    @CurrentUser() actor: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    await this.assertOutageAccess(id, actor.tenantId);
    const uploaderName = [actor.firstName, actor.lastName].filter(Boolean).join(' ') || actor.email;

    const [row] = await this.ds.query(`
      INSERT INTO outage_attachments
        (id, outage_id, tenant_id, uploaded_by, uploader_name, original_name, stored_name, mime_type, file_size, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id, created_at`,
      [id, actor.tenantId, actor.userId ?? actor.id, uploaderName,
       file.originalname, file.filename, file.mimetype, file.size]);

    return {
      id: row.id,
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      fileSize: file.size,
      url: `/uploads/outages/${file.filename}`,
      isImage: file.mimetype.startsWith('image/'),
      isVideo: file.mimetype.startsWith('video/'),
      createdAt: row.created_at,
    };
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions('outages.edit')
  async deleteAttachment(
    @CurrentUser() actor: any,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const [att] = await this.ds.query(
      `SELECT stored_name FROM outage_attachments WHERE id = $1 AND outage_id = $2 AND tenant_id = $3`,
      [attachmentId, id, actor.tenantId]);
    if (!att) throw new NotFoundException();

    const filePath = require('path').join(process.cwd(), 'uploads', 'outages', att.stored_name);
    if (require('fs').existsSync(filePath)) require('fs').unlinkSync(filePath);

    await this.ds.query(
      `DELETE FROM outage_attachments WHERE id = $1`, [attachmentId]);
    return { success: true };
  }

  // ── Share Report (HTML) ────────────────────────────────────────────────────

  @Get(':id/share-report')
  async shareReport(
    @CurrentUser() actor: any,
    @Param('id') id: string,
    @Res() res: any,
    @Req() req: any,
  ) {
    await this.assertOutageAccess(id, actor.tenantId);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const [o] = await this.ds.query(`
      SELECT o.*,
        ot.name AS type_name, ot.name_ar AS type_name_ar,
        rb.first_name || ' ' || COALESCE(rb.last_name,'') AS reported_by_name,
        rv.first_name || ' ' || COALESCE(rv.last_name,'') AS resolved_by_name,
        ah.first_name || ' ' || COALESCE(ah.last_name,'') AS handler_name,
        EXTRACT(EPOCH FROM (COALESCE(o.ended_at, NOW()) - o.started_at))/60 AS duration_minutes
      FROM outages o
      LEFT JOIN outage_types ot ON ot.id = o.outage_type_id
      LEFT JOIN users rb ON rb.id = o.reported_by
      LEFT JOIN users rv ON rv.id = o.resolved_by
      LEFT JOIN users ah ON ah.id = o.assigned_to
      WHERE o.id = $1 AND o.tenant_id = $2
    `, [id, actor.tenantId]);

    const notes = await this.ds.query(
      `SELECT * FROM outage_notes WHERE outage_id = $1 ORDER BY created_at ASC`, [id]);
    const attachments = await this.ds.query(
      `SELECT * FROM outage_attachments WHERE outage_id = $1 ORDER BY created_at ASC`, [id]);

    const html = buildOutageShareHtml(o, notes, attachments, baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="outage-${id.slice(0,8)}.html"`);
    res.send(html);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertOutageAccess(id: string, tenantId: string) {
    const [r] = await this.ds.query(
      `SELECT id FROM outages WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!r) throw new NotFoundException('Outage not found');
  }

  private mapOutage(r: any) {
    const now = new Date();
    const slaDue = r.sla_due_at ? new Date(r.sla_due_at) : null;
    const isResolved = ['resolved', 'closed'].includes(r.status);
    const slaBreached = slaDue
      ? (isResolved ? (r.resolved_at ? new Date(r.resolved_at) > slaDue : false) : slaDue < now)
      : false;
    const slaRemainingMin = slaDue && !isResolved
      ? Math.round((slaDue.getTime() - now.getTime()) / 60000)
      : null;

    return {
      id:               r.id,
      title:            r.title,
      description:      r.description,
      typeName:         r.type_name   ?? null,
      typeNameAr:       r.type_name_ar ?? null,
      severity:         r.severity,
      status:           r.status,
      impactedFunctions: r.impacted_function_names ?? r.impacted_function_ids ?? [],
      impactDescription: r.impact_description,
      startedAt:        r.started_at,
      endedAt:          r.ended_at,
      durationMinutes:  r.duration_minutes ? parseInt(r.duration_minutes) : null,
      reportedByName:   r.reported_by_name?.trim()   || null,
      resolvedByName:   r.resolved_by_name?.trim()   || null,
      handlerName:      r.handler_name?.trim()       || null,
      validatedByName:  r.validated_by_name?.trim()  || null,
      validatedAt:      r.validated_at,
      rootCause:        r.root_cause,
      resolution:       r.resolution,
      hcImpact:         r.hc_impact,
      slaTargetMinutes: r.sla_target_minutes,
      slaDueAt:         r.sla_due_at,
      slaBreached,
      slaRemainingMin,
      notesCount:       r.notes_count       ? parseInt(r.notes_count)       : 0,
      attachmentsCount: r.attachments_count ? parseInt(r.attachments_count) : 0,
      createdAt:        r.created_at,
    };
  }
}

// ── Beautiful HTML Share Report ────────────────────────────────────────────────
function buildOutageShareHtml(o: any, notes: any[], attachments: any[], baseUrl = ''): string {
  const fmtDt  = (d: string) => d ? new Date(d).toLocaleString('ar-KW', { dateStyle:'medium', timeStyle:'short' }) : '—';
  const fmtDur = (min: number) => !min ? '—' : min < 60 ? `${Math.round(min)}m` : `${Math.floor(min/60)}h ${Math.round(min%60)}m`;

  const SEV_AR: Record<string, string>   = { low:'منخفض', medium:'متوسط', high:'عالي', critical:'حرج' };
  const SEV_CLR: Record<string, string>  = { low:'#34d399', medium:'#fbbf24', high:'#fb923c', critical:'#f87171' };
  const ST_AR: Record<string, string>    = { reported:'مُبلَّغ', validated:'تم التحقق', in_progress:'جاري العلاج', resolved:'محلول', closed:'مغلق' };
  const ST_CLR: Record<string, string>   = { reported:'#f87171', validated:'#fb923c', in_progress:'#fbbf24', resolved:'#34d399', closed:'#64748b' };

  const imgs = attachments.filter(a => /^image\//.test(a.mime_type ?? ''));
  const vids = attachments.filter(a => /^video\//.test(a.mime_type ?? ''));
  const docs = attachments.filter(a => !/^image\/|^video\//.test(a.mime_type ?? ''));
  const sev  = o.severity ?? 'medium';
  const st   = o.status   ?? 'reported';
  const dur  = o.duration_minutes ? parseFloat(o.duration_minutes) : null;
  const isBreached = o.sla_due_at && new Date(o.sla_due_at) < new Date();
  const genTime = new Date().toLocaleString('ar-KW', { dateStyle: 'full', timeStyle: 'short' });

  const SEV_BG: Record<string,string>  = { low:'#022c22', medium:'#422006', high:'#431407', critical:'#2d0a0a' };

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير عطل — ${o.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#030712;--surface:#0c1628;--surface2:#111827;--border:#1e2d45;
  --text:#f1f5f9;--muted:#64748b;--subtle:#94a3b8;
}
body{font-family:'Tajawal',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px;line-height:1.6}

/* ── COVER ── */
.cover{background:linear-gradient(160deg,#060f1e 0%,#0d1b33 40%,#060f1e 100%);position:relative;overflow:hidden;padding:52px 48px 44px;border-bottom:1px solid var(--border)}
.cover::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,${SEV_CLR[sev]}18 0%,transparent 70%);pointer-events:none}
.cover-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:36px}
.brand{display:flex;align-items:center;gap:12px}
.brand-icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${SEV_CLR[sev]}18;border:1px solid ${SEV_CLR[sev]}40;font-size:18px}
.brand-name{font-size:13px;font-weight:700;color:var(--subtle);letter-spacing:.5px}
.brand-sub{font-size:11px;color:var(--muted);margin-top:1px}
.report-id{font-size:10px;font-family:monospace;color:var(--muted);background:rgba(255,255,255,0.04);border:1px solid var(--border);padding:4px 10px;border-radius:6px;letter-spacing:.5px}
.cover-title{font-size:30px;font-weight:900;color:#fff;line-height:1.25;margin-bottom:24px;max-width:800px}
.cover-title .sev-line{display:block;font-size:12px;font-weight:500;color:${SEV_CLR[sev]};letter-spacing:2px;text-transform:uppercase;margin-bottom:10px}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px}
.badge{padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid}
.badge-sev{color:${SEV_CLR[sev]};border-color:${SEV_CLR[sev]}50;background:${SEV_CLR[sev]}15}
.badge-st{color:${ST_CLR[st]};border-color:${ST_CLR[st]}50;background:${ST_CLR[st]}15}
.badge-type{color:#94a3b8;border-color:#94a3b840;background:#94a3b810}
.badge-breach{color:#f87171;border-color:#f8717150;background:#f8717115;animation:pulse .8s ease-in-out infinite alternate}
@keyframes pulse{from{opacity:.7}to{opacity:1}}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px;padding:16px 18px}
.kpi-label{font-size:10px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px}
.kpi-val{font-size:18px;font-weight:800;color:var(--text)}
.kpi-sub{font-size:10px;color:var(--muted);margin-top:3px}

/* ── CONTENT ── */
.page{max-width:960px;margin:0 auto;padding:32px 40px 48px}
.section{margin-bottom:28px}
.section-hd{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.section-hd .dot{width:6px;height:6px;border-radius:50%;background:${SEV_CLR[sev]}}
.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.info-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.info-label{font-size:10px;color:var(--muted);letter-spacing:.3px;margin-bottom:5px;text-transform:uppercase}
.info-val{font-size:13px;font-weight:600;color:var(--text)}
.text-block{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:10px}
.text-block.orange{border-color:#7c2d1240;background:#1c0e0580}
.text-block.yellow{border-color:#78350f40;background:#1c110080}
.text-block.green{border-color:#064e3b40;background:#0a1f1580}
.text-block-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;color:var(--subtle)}
.text-block.orange .text-block-label{color:#fb923c}
.text-block.yellow .text-block-label{color:#fbbf24}
.text-block.green  .text-block-label{color:#34d399}
.text-block p{font-size:13px;line-height:1.8;color:var(--subtle)}
.fn-tags{display:flex;flex-wrap:wrap;gap:7px}
.fn-tag{background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);color:#fb923c;padding:4px 12px;border-radius:8px;font-size:12px;font-weight:500}

/* ── NOTES ── */
.note{border-radius:12px;padding:14px 16px;margin-bottom:10px}
.note-internal{background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.18)}
.note-public{background:rgba(34,197,94,0.04);border:1px solid rgba(34,197,94,0.15)}
.note-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px}
.note-author{font-size:12px;font-weight:700}
.note-internal .note-author{color:#818cf8}
.note-public  .note-author{color:#4ade80}
.note-badge{font-size:10px;padding:2px 8px;border-radius:4px;font-weight:600}
.note-internal .note-badge{background:rgba(99,102,241,0.15);color:#818cf8}
.note-public  .note-badge{background:rgba(34,197,94,0.12);color:#4ade80}
.note-time{font-size:10px;color:var(--muted)}
.note-body{font-size:13px;line-height:1.75;color:var(--subtle)}

/* ── MEDIA ── */
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.img-item{border-radius:12px;overflow:hidden;border:1px solid var(--border);aspect-ratio:16/9;background:var(--surface)}
.img-item img{width:100%;height:100%;object-fit:cover;display:block}
.video-item,.doc-item{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;text-decoration:none;margin-bottom:8px}
.video-item{border-color:rgba(168,85,247,0.25)}
.media-icon-v{color:#c084fc;font-size:20px}
.media-icon-d{color:#60a5fa;font-size:20px}
.media-name{font-size:13px;font-weight:500;color:var(--text)}
.media-size{font-size:10px;color:var(--muted);margin-top:1px}

/* ── SIGNATURES + FOOTER ── */
.signature-box{border:1px solid var(--border);border-radius:12px;padding:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:28px}
.sig-item{text-align:center}
.sig-line{border-bottom:1px dashed var(--border);height:32px;margin-bottom:8px}
.sig-label{font-size:10px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}
.footer{border-top:1px solid var(--border);margin-top:40px;padding:24px 0 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.footer-brand{font-size:12px;font-weight:700;color:var(--muted)}
.footer-time{font-size:11px;color:var(--muted)}

/* ── PRINT ── */
@media print{
  @page{size:A4;margin:12mm 14mm}
  body{background:#fff !important;color:#1e293b !important;font-size:12px}
  .cover{background:#1e293b !important;page-break-after:avoid}
  .cover-title{color:#fff !important}
  .kpi,.info-item,.text-block,.note,.img-item{background:#f8fafc !important;border-color:#e2e8f0 !important}
  .info-val,.note-body,.text-block p,.media-name{color:#1e293b !important}
  .section-hd,.info-label,.note-time,.footer-brand,.footer-time,.sig-label{color:#64748b !important}
  .section{page-break-inside:avoid}
  .img-grid{grid-template-columns:repeat(3,1fr) !important}
  .kpis{grid-template-columns:repeat(4,1fr) !important}
  .info-grid{grid-template-columns:repeat(3,1fr) !important}
  .badge-breach{animation:none !important}
  a{color:inherit !important;text-decoration:none !important}
}
@media(max-width:640px){
  .cover{padding:32px 20px 28px}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .info-grid{grid-template-columns:1fr 1fr}
  .page{padding:20px 16px 32px}
  .cover-title{font-size:22px}
}
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-top">
    <div class="brand">
      <div class="brand-icon">&#9889;</div>
      <div>
        <div class="brand-name">Boutiqaat Contact Center</div>
        <div class="brand-sub">WFM Platform — Incident Report</div>
      </div>
    </div>
    <div class="report-id">REF: OTG-${(o.id ?? '').slice(0,8).toUpperCase()}</div>
  </div>
  <div class="cover-title">
    <span class="sev-line">تقرير عطل — ${SEV_AR[sev] ?? sev} / ${ST_AR[st] ?? st}</span>
    ${o.title}
  </div>
  <div class="badges">
    <span class="badge badge-sev">${SEV_AR[sev] ?? sev}</span>
    <span class="badge badge-st">${ST_AR[st] ?? st}</span>
    ${o.type_name_ar || o.type_name ? `<span class="badge badge-type">${o.type_name_ar ?? o.type_name}</span>` : ''}
    ${isBreached ? `<span class="badge badge-breach">SLA تجاوز</span>` : ''}
  </div>
  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">وقت البداية</div>
      <div class="kpi-val" style="font-size:14px">${fmtDt(o.started_at)}</div>
      <div class="kpi-sub">${o.ended_at ? 'انتهى: ' + fmtDt(o.ended_at) : 'مستمر حتى الآن'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">مدة العطل</div>
      <div class="kpi-val" style="color:${dur && dur > 60 ? '#f87171' : '#34d399'}">${fmtDur(dur ?? 0)}</div>
      <div class="kpi-sub">${dur && dur > 60 ? 'تجاوز الساعة' : 'ضمن النطاق'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">SLA</div>
      <div class="kpi-val" style="color:${isBreached ? '#f87171' : '#34d399'}">${isBreached ? 'تجاوز' : 'ضمن الهدف'}</div>
      <div class="kpi-sub">${o.sla_target_minutes ? `الهدف: ${o.sla_target_minutes} دقيقة` : 'غير محدد'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">الملاحظات</div>
      <div class="kpi-val">${notes.length}</div>
      <div class="kpi-sub">${attachments.length} مرفق</div>
    </div>
  </div>
</div>

<!-- PAGE CONTENT -->
<div class="page">

  <div class="section">
    <div class="section-hd"><span class="dot"></span>بيانات الحادثة</div>
    <div class="info-grid">
      ${[
        { l:'مُبلَّغ بواسطة', v: (o.reported_by_name ?? '').trim() || '—' },
        { l:'المعالج (RTA)',   v: (o.handler_name ?? '').trim() || 'غير محدد' },
        { l:'وقت البداية',    v: fmtDt(o.started_at) },
        { l:'وقت الانتهاء',   v: o.ended_at ? fmtDt(o.ended_at) : '—' },
        { l:'المدة الفعلية',  v: fmtDur(dur ?? 0) },
        { l:'هدف SLA',        v: o.sla_target_minutes ? `${o.sla_target_minutes} دقيقة` : '—' },
      ].map(d => `<div class="info-item"><div class="info-label">${d.l}</div><div class="info-val">${d.v}</div></div>`).join('')}
    </div>
  </div>

  ${o.description || o.impact_description || o.root_cause || o.resolution ? `
  <div class="section">
    <div class="section-hd"><span class="dot"></span>تفاصيل المشكلة والحل</div>
    ${o.description        ? `<div class="text-block"><div class="text-block-label">وصف المشكلة</div><p>${o.description}</p></div>` : ''}
    ${o.impact_description ? `<div class="text-block orange"><div class="text-block-label">تأثير العطل على العمليات</div><p>${o.impact_description}</p></div>` : ''}
    ${o.root_cause         ? `<div class="text-block yellow"><div class="text-block-label">السبب الجذري</div><p>${o.root_cause}</p></div>` : ''}
    ${o.resolution         ? `<div class="text-block green"><div class="text-block-label">الحل المتخذ</div><p>${o.resolution}</p></div>` : ''}
  </div>` : ''}

  ${imgs.length > 0 ? `
  <div class="section">
    <div class="section-hd"><span class="dot"></span>صور الحادثة (${imgs.length})</div>
    <div class="img-grid">
      ${imgs.map(a => `<div class="img-item"><img src="${baseUrl}/uploads/outages/${a.stored_name}" alt="${a.original_name}" loading="lazy"></div>`).join('')}
    </div>
  </div>` : ''}

  ${vids.length > 0 ? `
  <div class="section">
    <div class="section-hd"><span class="dot"></span>مقاطع الفيديو (${vids.length})</div>
    ${vids.map(a => `
    <a class="video-item" href="${baseUrl}/uploads/outages/${a.stored_name}" target="_blank">
      <span class="media-icon-v">&#9654;</span>
      <div><div class="media-name">${a.original_name}</div><div class="media-size">${Math.round((a.file_size ?? 0)/1024)} KB</div></div>
    </a>`).join('')}
  </div>` : ''}

  ${docs.length > 0 ? `
  <div class="section">
    <div class="section-hd"><span class="dot"></span>مرفقات أخرى (${docs.length})</div>
    ${docs.map(a => `
    <a class="doc-item" href="${baseUrl}/uploads/outages/${a.stored_name}" target="_blank">
      <span class="media-icon-d">&#128196;</span>
      <div><div class="media-name">${a.original_name}</div><div class="media-size">${Math.round((a.file_size ?? 0)/1024)} KB</div></div>
    </a>`).join('')}
  </div>` : ''}

  ${notes.length > 0 ? `
  <div class="section">
    <div class="section-hd"><span class="dot"></span>سجل الملاحظات (${notes.length})</div>
    ${notes.map(n => `
    <div class="note ${n.is_internal ? 'note-internal' : 'note-public'}">
      <div class="note-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="note-author">${n.author_name ?? '—'}</span>
          <span class="note-badge">${n.is_internal ? 'داخلي' : 'عام'}</span>
        </div>
        <span class="note-time">${fmtDt(n.created_at)}</span>
      </div>
      <div class="note-body">${n.content}</div>
    </div>`).join('')}
  </div>` : ''}

  <div class="signature-box">
    <div class="sig-item"><div class="sig-line"></div><div class="sig-label">المُبلَّغ</div></div>
    <div class="sig-item"><div class="sig-line"></div><div class="sig-label">المعالج / RTA</div></div>
    <div class="sig-item"><div class="sig-line"></div><div class="sig-label">مدير العمليات</div></div>
  </div>

  <div class="footer">
    <div class="footer-brand">Boutiqaat Contact Center — WFM Platform</div>
    <div class="footer-time">تم الإنشاء: ${genTime}</div>
  </div>

</div>
</body>
</html>`;
}
