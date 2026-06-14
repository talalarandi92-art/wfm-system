import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ChatChannel } from './entities/chat-channel.entity';
import { ChatChannelMember } from './entities/chat-channel-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { UserPresence } from './entities/user-presence.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatChannel)        private channelRepo:  Repository<ChatChannel>,
    @InjectRepository(ChatChannelMember)  private memberRepo:   Repository<ChatChannelMember>,
    @InjectRepository(ChatMessage)        private messageRepo:  Repository<ChatMessage>,
    @InjectRepository(UserPresence)       private presenceRepo: Repository<UserPresence>,
    private dataSource: DataSource,
  ) {}

  // ── Channels ──────────────────────────────────────────────────────────────

  async getChannelsForUser(userId: string, tenantId: string) {
    return this.dataSource.query(`
      SELECT
        c.id, c.name, c.name_ar, c.channel_type, c.icon, c.description, c.is_system,
        cm.last_read_at, cm.is_admin,
        (SELECT COUNT(*) FROM chat_messages m
          WHERE m.channel_id = c.id AND m.deleted_at IS NULL
            AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
        )::int AS unread_count,
        (SELECT row_to_json(last_msg) FROM (
          SELECT m.content, m.created_at, m.attachment_type,
                 u.first_name || ' ' || u.last_name AS sender_name
          FROM chat_messages m
          JOIN users u ON u.id = m.sender_id
          WHERE m.channel_id = c.id AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC LIMIT 1
        ) last_msg) AS last_message
      FROM chat_channels c
      JOIN chat_channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
      WHERE c.tenant_id = $2 AND c.is_active = TRUE
      ORDER BY c.is_system DESC, c.name ASC
    `, [userId, tenantId]);
  }

  async createGroupChannel(tenantId: string, name: string, nameAr: string, icon: string, creatorId: string, memberIds: string[]) {
    const ch = this.channelRepo.create({
      tenantId, name, nameAr: nameAr || name,
      channelType: 'group', isSystem: false,
      icon: icon || '💬', createdBy: creatorId,
    });
    const saved = await this.channelRepo.save(ch);

    const uniqueMembers = [...new Set([creatorId, ...memberIds])];
    await this.memberRepo.save(
      uniqueMembers.map(uid =>
        this.memberRepo.create({ channelId: saved.id, userId: uid, isAdmin: uid === creatorId })
      )
    );
    return saved;
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async getMessages(channelId: string, userId: string, limit = 80, before?: string) {
    const isMember = await this.memberRepo.findOne({ where: { channelId, userId } });
    if (!isMember) throw new Error('Not a member');

    let query = `
      SELECT
        m.id, m.content, m.message_type, m.created_at, m.is_edited, m.reply_to_id,
        m.attachment_url, m.attachment_type, m.attachment_name, m.attachment_size,
        u.id   AS sender_id,
        u.first_name || ' ' || u.last_name AS sender_name,
        u.first_name || ' ' || u.last_name AS sender_name_ar,
        (SELECT json_build_object(
          'id', rm.id, 'content', rm.content,
          'sender_name', ru.first_name || ' ' || ru.last_name
        ) FROM chat_messages rm JOIN users ru ON ru.id = rm.sender_id
        WHERE rm.id = m.reply_to_id) AS reply_to
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.channel_id = $1 AND m.deleted_at IS NULL
    `;
    const params: any[] = [channelId];

    if (before) {
      params.push(before);
      query += ` AND m.created_at < (SELECT created_at FROM chat_messages WHERE id = $${params.length})`;
    }
    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const rows = await this.dataSource.query(query, params);
    return rows.reverse();
  }

  async sendMessage(
    channelId: string,
    senderId: string,
    content: string,
    replyToId?: string,
    attachmentUrl?: string,
    attachmentType?: string,
    attachmentName?: string,
    attachmentSize?: number,
  ) {
    const msgType = attachmentUrl ? (attachmentType === 'image' ? 'image' :
                    attachmentType === 'video' ? 'video' :
                    attachmentType === 'audio' ? 'audio' : 'file') : 'text';

    // Explicit INSERT so attachment columns are guaranteed to persist
    // (entity .save() was silently dropping them — attachments vanished on refresh).
    const [inserted] = await this.dataSource.query(
      `INSERT INTO chat_messages
         (channel_id, sender_id, content, message_type, reply_to_id,
          attachment_url, attachment_type, attachment_name, attachment_size, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
       RETURNING id`,
      [channelId, senderId, content || '', msgType, replyToId ?? null,
       attachmentUrl ?? null, attachmentType ?? null, attachmentName ?? null, attachmentSize ?? null],
    );
    const saved = { id: inserted.id };

    const [full] = await this.dataSource.query(`
      SELECT m.id, m.content, m.message_type, m.created_at, m.reply_to_id,
             m.attachment_url, m.attachment_type, m.attachment_name, m.attachment_size,
             u.id AS sender_id,
             u.first_name || ' ' || u.last_name AS sender_name,
             u.first_name || ' ' || u.last_name AS sender_name_ar
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.id = $1
    `, [saved.id]);
    return full;
  }

  async postSystemMessage(channelId: string, content: string) {
    const msg = this.messageRepo.create({
      channelId,
      senderId: 'd0000000-0000-0000-0000-000000000001',
      content,
      messageType: 'system_event',
    });
    return this.messageRepo.save(msg);
  }

  async markRead(channelId: string, userId: string) {
    await this.memberRepo.update({ channelId, userId }, { lastReadAt: new Date() });
  }

  // ── Members ───────────────────────────────────────────────────────────────

  async joinChannel(channelId: string, userId: string) {
    const existing = await this.memberRepo.findOne({ where: { channelId, userId } });
    if (existing) return existing;
    const m = this.memberRepo.create({ channelId, userId });
    return this.memberRepo.save(m);
  }

  async getChannelMembers(channelId: string) {
    return this.dataSource.query(`
      SELECT cm.user_id AS id, cm.is_admin, cm.joined_at,
             u.first_name || ' ' || u.last_name AS name,
             COALESCE(p.status, 'offline') AS presence
      FROM chat_channel_members cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN user_presence p ON p.user_id = cm.user_id
      WHERE cm.channel_id = $1
      ORDER BY cm.is_admin DESC, name ASC
    `, [channelId]);
  }

  async removeMember(channelId: string, userId: string) {
    await this.memberRepo.delete({ channelId, userId });
    return { ok: true };
  }

  async setMemberAdmin(channelId: string, userId: string, isAdmin: boolean) {
    await this.memberRepo.update({ channelId, userId }, { isAdmin });
    return { ok: true };
  }

  // ── Direct Messages ───────────────────────────────────────────────────────

  async createDirectChannel(tenantId: string, userA: string, userB: string) {
    const existing = await this.dataSource.query(`
      SELECT c.id FROM chat_channels c
      JOIN chat_channel_members ma ON ma.channel_id = c.id AND ma.user_id = $1
      JOIN chat_channel_members mb ON mb.channel_id = c.id AND mb.user_id = $2
      WHERE c.channel_type = 'direct' AND c.tenant_id = $3
      LIMIT 1
    `, [userA, userB, tenantId]);

    if (existing.length) return { id: existing[0].id };

    const ch = this.channelRepo.create({ tenantId, name: 'direct', channelType: 'direct' });
    const saved = await this.channelRepo.save(ch);
    await this.memberRepo.save([
      this.memberRepo.create({ channelId: saved.id, userId: userA }),
      this.memberRepo.create({ channelId: saved.id, userId: userB }),
    ]);
    return saved;
  }

  // ── Presence ──────────────────────────────────────────────────────────────

  async setPresence(userId: string, tenantId: string, status: 'online' | 'away' | 'offline') {
    await this.dataSource.query(`
      INSERT INTO user_presence(user_id, tenant_id, status, last_seen_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) DO UPDATE SET status = $3, last_seen_at = NOW()
    `, [userId, tenantId, status]);
  }

  async getPresenceMap(tenantId: string): Promise<Record<string, string>> {
    const rows = await this.dataSource.query(
      `SELECT user_id, status FROM user_presence WHERE tenant_id = $1`, [tenantId]
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.user_id] = r.status;
    return map;
  }

  async getSystemChannelId(name: string, tenantId: string): Promise<string | null> {
    const ch = await this.channelRepo.findOne({ where: { name, tenantId, isSystem: true } });
    return ch?.id ?? null;
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async getAllUsers(tenantId: string) {
    return this.dataSource.query(`
      SELECT u.id,
             u.first_name || ' ' || u.last_name AS name,
             u.first_name || ' ' || u.last_name AS name_ar,
             COALESCE(p.status, 'offline') AS presence
      FROM users u
      LEFT JOIN user_presence p ON p.user_id = u.id
      WHERE u.tenant_id = $1 AND u.status = 'active'
      ORDER BY name ASC
    `, [tenantId]);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async exportChannelMessages(channelId: string, userId: string) {
    const isMember = await this.memberRepo.findOne({ where: { channelId, userId } });
    if (!isMember) throw new Error('Not a member');

    const [channel] = await this.dataSource.query(
      `SELECT name, name_ar FROM chat_channels WHERE id = $1`, [channelId]
    );
    const messages = await this.dataSource.query(`
      SELECT m.created_at, m.content, m.message_type,
             m.attachment_url, m.attachment_type, m.attachment_name,
             u.first_name || ' ' || u.last_name AS sender_name
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.channel_id = $1 AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `, [channelId]);

    return { channel, messages };
  }
}
