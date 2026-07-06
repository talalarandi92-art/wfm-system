import { Controller, Get, Post, Param, Query, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { CoachingService } from './coaching.service';
import { ScheduleSessionDto } from './dto/schedule-session.dto';

@ApiTags('Coaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('coaching.view')   // coaching management (flags/sessions) = TL/WFM; agents see own coaching via /calendar/coaching
@Controller({ path: 'coaching', version: '1' })
export class CoachingController {
  constructor(private readonly svc: CoachingService) {}

  /** Auto-detected coaching flags (default: open). */
  @Get('flags')
  @ApiOperation({ summary: 'List coaching flags' })
  listFlags(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.svc.listFlags(user.tenantId, status ?? 'open');
  }

  /** Run the trigger scan for this tenant now. */
  @Post('scan')
  @RequirePermissions('coaching.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scan attendance for coaching triggers now' })
  async scan(@CurrentUser() user: any) {
    const flags = await this.svc.scan(user.tenantId);
    return { ok: true, flags };
  }

  @Post('flags/:id/address')
  @RequirePermissions('coaching.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a flag as addressed (coached)' })
  address(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.resolveFlag(user.tenantId, id, 'addressed', user.id);
  }

  @Post('flags/:id/dismiss')
  @RequirePermissions('coaching.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss a flag' })
  dismiss(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.resolveFlag(user.tenantId, id, 'dismissed', user.id);
  }

  @Post('flags/:id/schedule-session')
  @RequirePermissions('coaching.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Schedule a 1:1 coaching session from a flag' })
  scheduleSession(@Param('id') id: string, @CurrentUser() user: any, @Body() body: ScheduleSessionDto) {
    return this.svc.scheduleSession(user.tenantId, id, user.id, {
      scheduledAt: body?.scheduledAt, durationMinutes: body?.durationMinutes, notes: body?.notes,
    });
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List coaching 1:1 sessions' })
  listSessions(@CurrentUser() user: any) {
    return this.svc.listSessions(user.tenantId);
  }
}
