import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'channel_id' })
  channelId: string;

  @Column({ name: 'sender_id' })
  senderId: string;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ name: 'message_type', default: 'text' })
  messageType: string;

  @Column({ name: 'reply_to_id', nullable: true })
  replyToId: string;

  @Column({ name: 'is_edited', default: false })
  isEdited: boolean;

  @Column({ name: 'edited_at', nullable: true, type: 'timestamptz' })
  editedAt: Date;

  @Column({ name: 'deleted_at', nullable: true, type: 'timestamptz' })
  deletedAt: Date;

  @Column({ name: 'attachment_url', nullable: true, type: 'text', default: null })
  attachmentUrl: string | null;

  @Column({ name: 'attachment_type', nullable: true, type: 'varchar', length: 20, default: null })
  attachmentType: string | null;

  @Column({ name: 'attachment_name', nullable: true, type: 'varchar', length: 500, default: null })
  attachmentName: string | null;

  @Column({ name: 'attachment_size', nullable: true, type: 'int', default: null })
  attachmentSize: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
