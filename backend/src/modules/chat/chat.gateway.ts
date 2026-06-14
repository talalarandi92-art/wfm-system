import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';

// CORS whitelist — same origins as the REST API (CORS_ORIGINS env, comma-separated).
// Never use '*' here: the gateway authenticates via JWT and must not accept arbitrary origins.
const WS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean);

@WebSocketGateway({ cors: { origin: WS_ORIGINS, credentials: true }, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private socketUser = new Map<string, { userId: string; tenantId: string }>();

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token?.replace('Bearer ', '') ||
                    client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      this.socketUser.set(client.id, { userId: payload.sub, tenantId: payload.tenantId });

      await this.chatService.setPresence(payload.sub, payload.tenantId, 'online');
      this.server.emit('presence_update', { userId: payload.sub, status: 'online' });

      // Auto-join channels user is a member of
      try {
        const channels = await this.chatService.getChannelsForUser(payload.sub, payload.tenantId);
        for (const ch of channels) {
          client.join(`channel:${ch.id}`);
        }
      } catch { /* non-fatal */ }
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const info = this.socketUser.get(client.id);
    if (info) {
      try {
        await this.chatService.setPresence(info.userId, info.tenantId, 'offline');
        this.server.emit('presence_update', { userId: info.userId, status: 'offline' });
      } catch { /* non-fatal */ }
      this.socketUser.delete(client.id);
    }
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      channelId: string; content: string; replyToId?: string;
      attachmentUrl?: string; attachmentType?: string;
      attachmentName?: string; attachmentSize?: number;
    },
  ) {
    try {
      const info = this.socketUser.get(client.id);
      if (!info) return { error: 'not authenticated' };

      const message = await this.chatService.sendMessage(
        data.channelId, info.userId, data.content ?? '', data.replyToId,
        data.attachmentUrl, data.attachmentType, data.attachmentName, data.attachmentSize,
      );

      const payload = { ...message, channelId: data.channelId };
      // Broadcast to all room members (others)
      this.server.to(`channel:${data.channelId}`).emit('new_message', payload);
      // Also emit directly to sender — guarantees delivery even if they missed the room join
      client.emit('new_message', payload);
      return message;
    } catch (err) {
      client.emit('error', { message: err?.message ?? 'send failed' });
      return { error: err?.message ?? 'send failed' };
    }
  }

  @SubscribeMessage('join_channel')
  async handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    try {
      const info = this.socketUser.get(client.id);
      if (!info) return { error: 'not authenticated' };
      await this.chatService.joinChannel(data.channelId, info.userId);
      client.join(`channel:${data.channelId}`);
      return { ok: true };
    } catch (err) {
      return { error: err?.message ?? 'join failed' };
    }
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    try {
      const info = this.socketUser.get(client.id);
      if (!info) return;
      await this.chatService.markRead(data.channelId, info.userId);
      return { ok: true };
    } catch { return { ok: false }; }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string; isTyping: boolean },
  ) {
    try {
      const info = this.socketUser.get(client.id);
      if (!info) return;
      client.to(`channel:${data.channelId}`).emit('typing', {
        userId: info.userId,
        channelId: data.channelId,
        isTyping: data.isTyping,
      });
    } catch { /* ignore */ }
  }

  // Called internally by other modules (outage, tech-issues)
  async broadcastSystemMessage(channelName: string, tenantId: string, content: string) {
    try {
      const channelId = await this.chatService.getSystemChannelId(channelName, tenantId);
      if (!channelId) return;
      const msg = await this.chatService.postSystemMessage(channelId, content);
      this.server.to(`channel:${channelId}`).emit('new_message', { ...msg, channelId });
    } catch { /* non-fatal */ }
  }
}
