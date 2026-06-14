import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('user_presence')
export class UserPresence {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ default: 'offline' })
  status: string;

  @UpdateDateColumn({ name: 'last_seen_at' })
  lastSeenAt: Date;
}
