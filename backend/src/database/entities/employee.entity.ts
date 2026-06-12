import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'employee_no', length: 50 })
  employeeNo: string;

  @Column({ name: 'first_name_en', length: 100 })
  firstNameEn: string;

  @Column({ name: 'last_name_en', type: 'varchar', length: 100, nullable: true })
  lastNameEn: string | null;

  @Column({ name: 'first_name_ar', type: 'varchar', length: 100, nullable: true })
  firstNameAr: string | null;

  @Column({ name: 'last_name_ar', type: 'varchar', length: 100, nullable: true })
  lastNameAr: string | null;

  @Column({ type: 'varchar', length: 10, default: 'male' })
  gender: string;

  @Column({ name: 'function_id', type: 'uuid', nullable: true })
  functionId: string | null;

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  teamId: string | null;

  @Column({ name: 'employment_type', type: 'varchar', default: 'full_time' })
  employmentType: string;

  @Column({ type: 'varchar', default: 'active' })
  status: string;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate: string | null;

  @Column({ name: 'is_supervisor', default: false })
  isSupervisor: boolean;

  @Column({ name: 'productivity_factor', type: 'numeric', default: 1.0 })
  productivityFactor: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
