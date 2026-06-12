import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'attendance_date', type: 'date' })
  attendanceDate: string;

  @Column({ name: 'scheduled_shift_code_id', type: 'uuid', nullable: true })
  scheduledShiftCodeId: string | null;

  @Column({ name: 'scheduled_start', type: 'time', nullable: true })
  scheduledStart: string | null;

  @Column({ name: 'scheduled_end', type: 'time', nullable: true })
  scheduledEnd: string | null;

  @Column({ name: 'scheduled_start_2', type: 'time', nullable: true })
  scheduledStart2: string | null;

  @Column({ name: 'scheduled_end_2', type: 'time', nullable: true })
  scheduledEnd2: string | null;

  @Column({ name: 'punch_in', type: 'timestamptz', nullable: true })
  punchIn: Date | null;

  @Column({ name: 'punch_out', type: 'timestamptz', nullable: true })
  punchOut: Date | null;

  @Column({ name: 'system_login', type: 'timestamptz', nullable: true })
  systemLogin: Date | null;

  @Column({ name: 'system_logout', type: 'timestamptz', nullable: true })
  systemLogout: Date | null;

  @Column({ name: 'punch_late_minutes', type: 'int', default: 0 })
  punchLateMinutes: number;

  @Column({ name: 'punch_early_out_minutes', type: 'int', default: 0 })
  punchEarlyOutMinutes: number;

  @Column({ name: 'system_late_minutes', type: 'int', default: 0 })
  systemLateMinutes: number;

  @Column({ name: 'system_early_out_minutes', type: 'int', default: 0 })
  systemEarlyOutMinutes: number;

  @Column({ name: 'ot_minutes', type: 'int', default: 0 })
  otMinutes: number;

  @Column({ name: 'is_missing_punch', default: false })
  isMissingPunch: boolean;

  @Column({ name: 'is_missing_system', default: false })
  isMissingSystem: boolean;

  @Column({ name: 'is_wfh', default: false })
  isWfh: boolean;

  @Column({ name: 'attendance_marker', type: 'varchar', default: 'unknown' })
  attendanceMarker: string;

  @Column({ name: 'absence_reason', type: 'varchar', length: 255, nullable: true })
  absenceReason: string | null;

  @Column({ name: 'import_batch_id', type: 'uuid', nullable: true })
  importBatchId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
