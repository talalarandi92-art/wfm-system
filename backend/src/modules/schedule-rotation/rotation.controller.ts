import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RotationService } from './rotation.service';
import { CreateGroupDto, AssignMembersDto } from './rotation.types';

@ApiTags('Schedule Rotation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('schedule.view')
@Controller('schedule-rotation')
export class RotationController {
  constructor(private readonly svc: RotationService) {}

  // ── Shift rates ──────────────────────────────────────────────────────────────
  @Get('shift-rates')
  @ApiOperation({ summary: 'YTD shift rate distribution per employee' })
  getShiftRates(
    @Request() req: any,
    @Query('year') year?: string,
    @Query('functionId') functionId?: string,
  ) {
    const tenantId = req.user.tenantId;
    const yr = parseInt(year ?? String(new Date().getFullYear()), 10);
    return this.svc.getShiftRates(tenantId, yr, functionId);
  }

  // ── Rotation groups ───────────────────────────────────────────────────────────
  @Get('groups')
  @ApiOperation({ summary: 'List rotation groups' })
  getGroups(@Request() req: any) {
    return this.svc.getGroups(req.user.tenantId);
  }

  @Post('groups')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Create rotation group' })
  createGroup(@Request() req: any, @Body() dto: CreateGroupDto) {
    return this.svc.createGroup(req.user.tenantId, dto);
  }

  @Put('groups/:id')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Update rotation group' })
  updateGroup(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateGroupDto>,
  ) {
    return this.svc.updateGroup(req.user.tenantId, id, dto);
  }

  @Delete('groups/:id')
  @RequirePermissions('schedule.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete rotation group' })
  deleteGroup(@Request() req: any, @Param('id') id: string) {
    return this.svc.deleteGroup(req.user.tenantId, id);
  }

  @Post('groups/:id/members')
  @RequirePermissions('schedule.edit')
  @ApiOperation({ summary: 'Assign employees to rotation group' })
  assignMembers(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AssignMembersDto,
  ) {
    return this.svc.assignMembers(req.user.tenantId, id, dto);
  }

  @Delete('groups/:id/members/:employeeId')
  @RequirePermissions('schedule.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove employee from rotation group' })
  removeMember(
    @Request() req: any,
    @Param('id') id: string,
    @Param('employeeId') empId: string,
  ) {
    return this.svc.removeMember(req.user.tenantId, id, empId);
  }
}
