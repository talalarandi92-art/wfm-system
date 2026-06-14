import {
  Controller, Get, Post, Delete, Patch, Body, Param, Query,
  Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

// Allowlist — only safe document/media types may be uploaded to chat.
// Executables, scripts, and HTML are rejected to prevent stored-XSS / malware sharing.
const ALLOWED_MIME = new Set<string>([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // xlsx
  'application/vnd.ms-excel',                                           // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword',                                                 // doc
  'text/csv', 'text/plain',
  'application/zip',
]);
const BLOCKED_EXT = new Set<string>([
  '.exe', '.bat', '.cmd', '.sh', '.com', '.msi', '.scr', '.js', '.jse',
  '.vbs', '.ps1', '.jar', '.html', '.htm', '.svg', '.php', '.dll', '.app',
]);

const chatFileFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  const ext = extname(file.originalname).toLowerCase();
  if (BLOCKED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
    return cb(new BadRequestException(`File type not allowed: ${file.mimetype || ext}`), false);
  }
  cb(null, true);
};

const chatStorage = diskStorage({
  destination: './uploads/chat',
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + extname(file.originalname));
  },
});

function mimeToType(mime: string): string {
  if (mime.startsWith('image/'))  return 'image';
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('audio/'))  return 'audio';
  return 'file';
}

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  // ── File Upload ───────────────────────────────────────────────────────────

  @Post('upload')
  @Throttle({ default: { ttl: 60000, limit: 30 } })   // 30 uploads/minute per user
  @UseInterceptors(FileInterceptor('file', {
    storage: chatStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: chatFileFilter,
  }))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file or file type rejected');
    return {
      url:  `/uploads/chat/${file.filename}`,
      name: file.originalname,
      size: file.size,
      type: mimeToType(file.mimetype),
    };
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  @Get('channels')
  getChannels(@Req() req: any) {
    return this.chatService.getChannelsForUser(req.user.id, req.user.tenantId);
  }

  @Post('channels')
  createChannel(
    @Body() body: { name: string; name_ar?: string; icon?: string; memberIds: string[] },
    @Req() req: any,
  ) {
    return this.chatService.createGroupChannel(
      req.user.tenantId,
      body.name,
      body.name_ar ?? body.name,
      body.icon ?? '💬',
      req.user.id,
      body.memberIds ?? [],
    );
  }

  @Get('channels/:id/messages')
  getMessages(
    @Param('id') channelId: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chatService.getMessages(channelId, req.user.id, limit ? +limit : 80, before);
  }

  @Post('channels/:id/read')
  markRead(@Param('id') channelId: string, @Req() req: any) {
    return this.chatService.markRead(channelId, req.user.id);
  }

  @Get('channels/:id/members')
  getMembers(@Param('id') channelId: string) {
    return this.chatService.getChannelMembers(channelId);
  }

  @Post('channels/:id/members')
  addMember(@Param('id') channelId: string, @Body() body: { userId: string }) {
    return this.chatService.joinChannel(channelId, body.userId);
  }

  @Delete('channels/:id/members/:userId')
  removeMember(@Param('id') channelId: string, @Param('userId') userId: string) {
    return this.chatService.removeMember(channelId, userId);
  }

  @Patch('channels/:id/members/:userId/admin')
  setAdmin(
    @Param('id') channelId: string,
    @Param('userId') userId: string,
    @Body() body: { isAdmin: boolean },
  ) {
    return this.chatService.setMemberAdmin(channelId, userId, body.isAdmin);
  }

  @Get('channels/:id/export')
  exportChannel(@Param('id') channelId: string, @Req() req: any) {
    return this.chatService.exportChannelMessages(channelId, req.user.id);
  }

  // ── Direct Messages ───────────────────────────────────────────────────────

  @Post('direct')
  createDirect(@Body() body: { targetUserId: string }, @Req() req: any) {
    return this.chatService.createDirectChannel(req.user.tenantId, req.user.id, body.targetUserId);
  }

  // ── Users & Presence ──────────────────────────────────────────────────────

  @Get('users')
  getUsers(@Req() req: any) {
    return this.chatService.getAllUsers(req.user.tenantId);
  }

  @Get('presence')
  getPresence(@Req() req: any) {
    return this.chatService.getPresenceMap(req.user.tenantId);
  }
}
