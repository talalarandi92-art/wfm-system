import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateScheduleChangeDto {
  @IsString()
  employeeId!: string;

  @IsDateString()
  changeDate!: string;

  @IsOptional() @IsString() @MaxLength(20)
  currentShiftCode?: string | null;

  @IsString() @MaxLength(20)
  requestedShiftCode!: string;

  @IsString() @MaxLength(2000)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
