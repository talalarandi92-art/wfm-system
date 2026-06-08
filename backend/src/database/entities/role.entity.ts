import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToMany, JoinTable,
} from 'typeorm';
import { Permission } from './permission.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', nullable: true })
  tenantId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 50 })
  code: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'is_system_role', default: false })
  isSystemRole: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToMany(() => Permission, { eager: true })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: Permission[];
}
