import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications for current user' })
  async list(
    @CurrentUser() user: any,
    @Query('unread') unread?: string,
    @Query('limit')  limitQ?: string,
  ) {
    const limit = parseInt(limitQ ?? '50', 10);
    const unreadOnly = unread === 'true';
    const rows = await this.ds.query(
      `SELECT id, notification_type, title, body, entity_type, entity_id,
              is_read, created_at
       FROM notifications
       WHERE tenant_id=$1 AND recipient_id=$2
         ${unreadOnly ? 'AND is_read=FALSE' : ''}
       ORDER BY created_at DESC
       LIMIT $3`,
      [user.tenantId, user.id, limit],
    );
    return rows.map((r: any) => ({
      id:               r.id,
      type:             r.notification_type,
      title:            r.title,
      body:             r.body,
      entityType:       r.entity_type,
      entityId:         r.entity_id,
      isRead:           r.is_read,
      createdAt:        r.created_at,
    }));
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  async unreadCount(@CurrentUser() user: any) {
    const [row] = await this.ds.query(
      `SELECT COUNT(*) AS cnt FROM notifications WHERE tenant_id=$1 AND recipient_id=$2 AND is_read=FALSE`,
      [user.tenantId, user.id],
    );
    return { count: parseInt(row.cnt, 10) };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markRead(@Param('id') id: string, @CurrentUser() user: any) {
    await this.ds.query(
      `UPDATE notifications SET is_read=TRUE WHERE id=$1 AND recipient_id=$2`,
      [id, user.id],
    );
    return { success: true };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@CurrentUser() user: any) {
    await this.ds.query(
      `UPDATE notifications SET is_read=TRUE WHERE tenant_id=$1 AND recipient_id=$2 AND is_read=FALSE`,
      [user.tenantId, user.id],
    );
    return { success: true };
  }
}
