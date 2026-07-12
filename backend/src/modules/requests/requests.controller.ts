import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, UnauthorizedException,
  BadRequestException, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RequestsService } from './requests.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import {
  CreateShiftSwapDto,
  CreateLeaveDto,
  CreateOvertimeDto,
  CreateBreakDto,
  PeerRespondDto,
  ApproveRejectDto,
} from './requests.types';

// Disk storage for request attachments (schedule/appointment images, certificates).
const requestStorage = diskStorage({
  destination: './uploads/requests',
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + extname(file.originalname));
  },
});

// Images + PDF only — these are appointment/exam schedules and certificates.
const requestFileFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (ok.includes(file.mimetype)) cb(null, true);
  else cb(new BadRequestException('صيغة الملف غير مدعومة (صور أو PDF فقط)'), false);
};

@Controller('requests')
@UseGuards(JwtAuthGuard)
@RequirePermissions('requests.view_own')
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}

  private tid(user: any): string {
    const id = user?.tenantId;
    if (!id) throw new UnauthorizedException('Missing tenant context');
    return id;
  }

  /** Permission codes from the JWT user (JwtStrategy returns the User entity). */
  private perms(user: any): string[] {
    return user?.permissionCodes ?? user?.permissions ?? [];
  }

  /** Employee id to scope reads to — undefined when the caller may see team/all. */
  private scopeEmployeeId(user: any): string | undefined {
    const perms = this.perms(user);
    const canSeeAll = perms.includes('requests.view_team') || perms.includes('requests.view_all');
    return canSeeAll ? undefined : (user?.employeeId ?? '00000000-0000-0000-0000-000000000000');
  }

  /** Anti-forgery for create handlers: the subject/requester employee is ALWAYS the
   *  authenticated employee. A body-supplied employee id is honoured ONLY for approvers
   *  (requests.approve_l1) filing on an employee's behalf. Mirrors asPeer(). */
  private asRequesterId(user: any, bodyEmployeeId?: string): string {
    const canOverride = this.perms(user).includes('requests.approve_l1');
    return (canOverride && bodyEmployeeId)
      ? bodyEmployeeId
      : (user?.employeeId ?? '00000000-0000-0000-0000-000000000000');
  }

  /* ── Stats ─────────────────────────────────────────────────────────── */
  @Get('stats')
  @RequirePermissions('requests.view_team')
  stats(@CurrentUser() user: any) {
    return this.svc.getStats(this.tid(user));
  }

  /* ── Employee search (for request forms) ───────────────────────────── */
  @Get('employees')
  employees(@CurrentUser() user: any, @Query('search') search?: string) {
    return this.svc.getEmployees(this.tid(user), search);
  }

  /* ── Swap candidates ────────────────────────────────────────────────── */
  // IDOR fix 2026-07-06: non-team callers are FORCED to their own employeeId — only
  // requests.view_team/view_all may pass an arbitrary id (scopeEmployeeId returns undefined).
  @Get('swap-candidates')
  swapCandidates(
    @CurrentUser() user: any,
    @Query('employeeId') employeeId: string,
    @Query('date') date: string,
  ) {
    const scoped = this.scopeEmployeeId(user);
    return this.svc.getSwapCandidates(this.tid(user), scoped ?? employeeId, date);
  }

  /* ── Peer-pending list (for a specific employee) ───────────────────── */
  @Get('peer-pending')
  peerPending(@CurrentUser() user: any, @Query('employeeId') employeeId: string) {
    const scoped = this.scopeEmployeeId(user);
    return this.svc.getPeerPending(this.tid(user), scoped ?? employeeId);
  }

  /* ── Unified list ───────────────────────────────────────────────────── */
  @Get()
  list(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('employeeId') employeeId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    // Self-scope: callers without team/all view only ever see their own requests.
    const scoped = this.scopeEmployeeId(user);
    return this.svc.listAll(this.tid(user), {
      status,
      type,
      employeeId: scoped ?? employeeId,
      limit: lim,
      page:  offset ? Math.floor(parseInt(offset, 10) / lim) + 1 : 1,
    });
  }

  /* ── HC impact ──────────────────────────────────────────────────────── */
  @Get(':id/hc-impact')
  hcImpact(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.getHcImpact(this.tid(user), id, this.scopeEmployeeId(user));
  }

  /* ── Single request ─────────────────────────────────────────────────── */
  @Get(':id')
  getOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.getOne(this.tid(user), id, this.scopeEmployeeId(user));
  }

  /* ── Shift swap ─────────────────────────────────────────────────────── */
  // IDOR fix: requesterEmployeeId is FORCED to the caller (asRequesterId); only an
  // approver may file on another employee's behalf. targetEmployeeId is the swap
  // counterparty (peer) who must still accept via peer-accept — left as supplied.
  @Post('shift-swap')
  @RequirePermissions('requests.create')
  createSwap(@CurrentUser() user: any, @Body() dto: CreateShiftSwapDto) {
    return this.svc.createShiftSwap(this.tid(user), {
      ...dto,
      requesterEmployeeId: this.asRequesterId(user, dto.requesterEmployeeId),
    });
  }

  /* ── Leave request ──────────────────────────────────────────────────── */
  @Post('leave')
  @RequirePermissions('requests.create')
  createLeave(@CurrentUser() user: any, @Body() dto: CreateLeaveDto) {
    return this.svc.createLeave(this.tid(user), {
      ...dto,
      employeeId: this.asRequesterId(user, dto.employeeId),
    });
  }

  /* ── Overtime request ───────────────────────────────────────────────── */
  @Post('overtime')
  @RequirePermissions('requests.create')
  createOvertime(@CurrentUser() user: any, @Body() dto: CreateOvertimeDto) {
    return this.svc.createOvertime(this.tid(user), {
      ...dto,
      employeeId: this.asRequesterId(user, dto.employeeId),
    });
  }

  /* ── Manual break request ───────────────────────────────────────────── */
  @Post('break')
  @RequirePermissions('requests.create')
  createBreak(@CurrentUser() user: any, @Body() dto: CreateBreakDto) {
    return this.svc.createBreak(this.tid(user), {
      ...dto,
      employeeId: this.asRequesterId(user, dto.employeeId),
    });
  }

  /* ── Attachments (schedule/appointment image, certificate) ──────────── */
  @Get(':id/attachments')
  listAttachments(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.listAttachments(this.tid(user), id);
  }

  @Post(':id/attachments')
  @RequirePermissions('requests.create')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file', {
    storage: requestStorage,
    limits: { fileSize: 15 * 1024 * 1024 },  // 15 MB
    fileFilter: requestFileFilter,
  }))
  uploadAttachment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('لم يتم إرفاق ملف');
    // JwtStrategy returns the User entity — user.id is the users-FK for uploaded_by.
    return this.svc.addAttachment(this.tid(user), id, file, user?.id);
  }

  /* ── Peer accept / reject swap ──────────────────────────────────────── */
  @Patch(':id/peer-accept')
  @RequirePermissions('requests.create')
  peerAccept(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PeerRespondDto,
  ) {
    return this.svc.peerAccept(this.tid(user), id, this.asPeer(user, dto));
  }

  @Patch(':id/peer-reject')
  @RequirePermissions('requests.create')
  peerReject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PeerRespondDto,
  ) {
    return this.svc.peerReject(this.tid(user), id, this.asPeer(user, dto));
  }

  /** Anti-forgery: the peer is ALWAYS the authenticated employee. A body-supplied
   *  targetEmployeeId is honoured ONLY for approvers (requests.approve_l1) acting
   *  on an employee's behalf. */
  private asPeer(user: any, dto: PeerRespondDto): PeerRespondDto {
    const canOverride = this.perms(user).includes('requests.approve_l1');
    const target = (canOverride && dto?.targetEmployeeId)
      ? dto.targetEmployeeId
      : (user?.employeeId ?? '00000000-0000-0000-0000-000000000000');
    return { ...dto, targetEmployeeId: target };
  }

  /* ── Approve / reject ───────────────────────────────────────────────── */
  @Patch(':id/approve')
  @RequirePermissions('requests.approve_l1')
  approve(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ApproveRejectDto,
  ) {
    return this.svc.approve(this.tid(user), id, dto);
  }

  @Patch(':id/reject')
  @RequirePermissions('requests.approve_l1')
  reject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ApproveRejectDto,
  ) {
    return this.svc.reject(this.tid(user), id, dto);
  }

  /* ── Cancel ─────────────────────────────────────────────────────────── */
  @Patch(':id/cancel')
  @RequirePermissions('requests.cancel')
  cancel(@CurrentUser() user: any, @Param('id') id: string) {
    // svc.cancel compares against requests.employee_id — pass the caller's EMPLOYEE id
    // (user.sub/userId never exist: JwtStrategy returns the User entity).
    return this.svc.cancel(this.tid(user), id, user?.employeeId);
  }
}
