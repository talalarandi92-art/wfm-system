import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { User } from './user.entity';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ name: 'legal_name', length: 200, nullable: true })
  legalName: string;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ length: 100, default: 'Asia/Kuwait' })
  timezone: string;

  @Column({ name: 'default_locale', length: 10, default: 'ar' })
  defaultLocale: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ name: 'primary_color', length: 7, nullable: true })
  primaryColor: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.tenant)
  users: User[];
}
