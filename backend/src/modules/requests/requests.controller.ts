import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import {
  CreateShiftSwapDto,
  CreateLeaveDto,
  CreateOvertimeDto,
  PeerRespondDto,
  ApproveRejectDto,
} from './requests.types';

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
  @Get('swap-candidates')
  swapCandidates(
    @CurrentUser() user: any,
    @Query('employeeId') employeeId: string,
    @Query('date') date: string,
  ) {
    return this.svc.getSwapCandidates(this.tid(user), employeeId, date);
  }

  /* ── Peer-pending list (for a specific employee) ───────────────────── */
  @Get('peer-pending')
  peerPending(@CurrentUser() user: any, @Query('employeeId') employeeId: string) {
    return this.svc.getPeerPending(this.tid(user), employeeId);
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
    return this.svc.listAll(this.tid(user), {
      status,
      type,
      employeeId,
      limit: limit ? parseInt(limit, 10) : 50,
      page:  offset ? Math.floor(parseInt(offset, 10) / (limit ? parseInt(limit, 10) : 50)) : 1,
    });
  }

  /* ── HC impact ──────────────────────────────────────────────────────── */
  @Get(':id/hc-impact')
  hcImpact(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.getHcImpact(this.tid(user), id);
  }

  /* ── Single request ─────────────────────────────────────────────────── */
  @Get(':id')
  getOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.svc.getOne(this.tid(user), id);
  }

  /* ── Shift swap ─────────────────────────────────────────────────────── */
  @Post('shift-swap')
  @RequirePermissions('requests.create')
  createSwap(@CurrentUser() user: any, @Body() dto: CreateShiftSwapDto) {
    return this.svc.createShiftSwap(this.tid(user), dto);
  }

  /* ── Leave request ──────────────────────────────────────────────────── */
  @Post('leave')
  @RequirePermissions('requests.create')
  createLeave(@CurrentUser() user: any, @Body() dto: CreateLeaveDto) {
    return this.svc.createLeave(this.tid(user), dto);
  }

  /* ── Overtime request ───────────────────────────────────────────────── */
  @Post('overtime')
  @RequirePermissions('requests.create')
  createOvertime(@CurrentUser() user: any, @Body() dto: CreateOvertimeDto) {
    return this.svc.createOvertime(this.tid(user), dto);
  }

  /* ── Peer accept / reject swap ──────────────────────────────────────── */
  @Patch(':id/peer-accept')
  @RequirePermissions('requests.create')
  peerAccept(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PeerRespondDto,
  ) {
    return this.svc.peerAccept(this.tid(user), id, dto);
  }

  @Patch(':id/peer-reject')
  @RequirePermissions('requests.create')
  peerReject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PeerRespondDto,
  ) {
    return this.svc.peerReject(this.tid(user), id, dto);
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
    return this.svc.cancel(this.tid(user), id, user?.sub ?? user?.userId);
  }
}
