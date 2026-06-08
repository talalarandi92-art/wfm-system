import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150, unique: true })
  code: string;

  @Column({ length: 50 })
  module: string;

  @Column({ length: 50 })
  action: string;

  @Column({ nullable: true })
  description: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
