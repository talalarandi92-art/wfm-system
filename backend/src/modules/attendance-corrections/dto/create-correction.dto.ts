import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCorrectionDto {
  @IsString()
  employeeId!: string;

  @IsDateString()
  attendanceDate!: string;

  @IsString() @MaxLength(50)
  correctionType!: string;

  // Same whitelist the controller enforces (FIELDS set) — validated early here.
  @IsOptional() @IsIn(['punch_in', 'punch_out', 'system_login', 'system_logout'])
  field?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  requestedValue?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  currentValue?: string | null;

  @IsString() @MaxLength(2000)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
