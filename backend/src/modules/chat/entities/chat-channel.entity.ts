import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';

@Entity('chat_channels')
export class ChatChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 80 })
  name: string;

  @Column({ name: 'name_ar', length: 80, nullable: true })
  nameAr: string;

  @Column({ name: 'channel_type', default: 'group' })
  channelType: string;

  @Column({ length: 10, nullable: true })
  icon: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
