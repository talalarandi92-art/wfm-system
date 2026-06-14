import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('chat_channel_members')
export class ChatChannelMember {
  @PrimaryColumn({ name: 'channel_id' })
  channelId: string;

  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @Column({ name: 'is_admin', default: false })
  isAdmin: boolean;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  @Column({ name: 'last_read_at', nullable: true, type: 'timestamptz' })
  lastReadAt: Date;
}
