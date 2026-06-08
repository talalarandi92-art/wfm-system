import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';

@Entity('shift_codes')
export class ShiftCode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ length: 30 }) code: string;
  @Column({ nullable: true }) description: string;
  @Column({ name: 'description_ar', nullable: true }) descriptionAr: string;
  @Column({ name: 'category_id', nullable: true }) categoryId: string;
  @Column({ name: 'start_time', type: 'time', nullable: true }) startTime: string;
  @Column({ name: 'end_time', type: 'time', nullable: true }) endTime: string;
  @Column({ name: 'start_time_2', type: 'time', nullable: true }) startTime2: string;
  @Column({ name: 'end_time_2', type: 'time', nullable: true }) endTime2: string;
  @Column({ name: 'working_hours', type: 'numeric', precision: 4, scale: 2, nullable: true }) workingHours: number;
  @Column({ name: 'break_hours', type: 'numeric', precision: 4, scale: 2, nullable: true }) breakHours: number;
  @Column({ name: 'total_hours', type: 'numeric', precision: 4, scale: 2, nullable: true }) totalHours: number;
  @Column({ name: 'is_split_shift', default: false }) isSplitShift: boolean;
  @Column({ name: 'is_cross_midnight', default: false }) isCrossMidnight: boolean;
  @Column({ name: 'is_wfh', default: false }) isWfh: boolean;
  @Column({ name: 'is_ramadan', default: false }) isRamadan: boolean;
  @Column({ name: 'is_supervisor_shift', default: false }) isSupervisorShift: boolean;
  @Column({ name: 'is_working_shift', default: true }) isWorkingShift: boolean;
  @Column({ name: 'is_leave_code', default: false }) isLeaveCode: boolean;
  @Column({ name: 'is_absence_code', default: false }) isAbsenceCode: boolean;
  @Column({ name: 'allows_female', default: true }) allowsFemale: boolean;
  @Column({ name: 'display_color', nullable: true }) displayColor: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ name: 'sort_order', default: 0 }) sortOrder: number;
  @Column({ default: 'manual' }) source: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
