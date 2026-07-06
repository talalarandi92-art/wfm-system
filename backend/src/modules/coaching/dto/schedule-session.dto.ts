import { IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

export class ScheduleSessionDto {
  /** ISO local datetime, e.g. 2026-07-10T10:00 */
  @IsOptional() @IsString() @MaxLength(30)
  scheduledAt?: string;

  @IsOptional() @IsInt() @Min(5) @Max(480)
  durationMinutes?: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
