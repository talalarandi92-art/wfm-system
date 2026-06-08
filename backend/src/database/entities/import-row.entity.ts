import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { ImportBatch } from './import-batch.entity';

@Entity('import_rows')
export class ImportRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'import_batch_id' }) importBatchId: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'row_number' }) rowNumber: number;
  @Column({ name: 'sheet_name', nullable: true }) sheetName: string;
  @Column({ name: 'raw_data', type: 'jsonb' }) rawData: any;
  @Column({ name: 'parsed_data', type: 'jsonb', nullable: true }) parsedData: any;
  @Column({ default: 'valid' }) status: string;
  @Column({ type: 'jsonb', nullable: true }) errors: any;
  @Column({ type: 'jsonb', nullable: true }) warnings: any;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => ImportBatch) @JoinColumn({ name: 'import_batch_id' }) batch: ImportBatch;
}
