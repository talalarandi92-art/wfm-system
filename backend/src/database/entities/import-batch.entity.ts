import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { User } from './user.entity';

@Entity('import_batches')
export class ImportBatch {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'import_type' }) importType: string;
  @Column({ name: 'original_filename' }) originalFilename: string;
  @Column({ name: 'stored_filename', nullable: true }) storedFilename: string;
  @Column({ name: 'file_path', nullable: true }) filePath: string;
  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true }) fileSizeBytes: number;
  @Column({ default: 'uploaded' }) status: string;
  @Column({ name: 'total_rows', nullable: true }) totalRows: number;
  @Column({ name: 'valid_rows', nullable: true }) validRows: number;
  @Column({ name: 'error_rows', nullable: true }) errorRows: number;
  @Column({ name: 'warning_rows', nullable: true }) warningRows: number;
  @Column({ name: 'skipped_rows', nullable: true }) skippedRows: number;
  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true }) committedAt: Date;
  @Column({ name: 'committed_by', nullable: true }) committedById: string;
  @Column({ name: 'error_summary', type: 'jsonb', nullable: true }) errorSummary: any;
  @Column({ type: 'jsonb', nullable: true }) metadata: any;
  @Column({ nullable: true }) notes: string;
  @Column({ name: 'created_by' }) createdById: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => User) @JoinColumn({ name: 'created_by' }) createdBy: User;
}
