import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, Max, ValidateNested,
} from 'class-validator';

class EventAttendeeDto {
  @IsOptional() @IsString()
  userId?: string;

  @IsOptional() @IsString()
  employeeId?: string;

  @IsOptional() @IsString() @MaxLength(50)
  role?: string;
}

class CoachingDataDto {
  @IsOptional() @IsString()
  employeeId?: string;

  @IsOptional() @IsString()
  coachId?: string;

  @IsOptional() @IsString()
  scorecardBatchId?: string;

  @IsOptional() @IsInt() @Min(5) @Max(480)
  durationMinutes?: number;

  @IsOptional() @IsArray() @IsString({ each: true })
  focusAreas?: string[];

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

class CrossSkillDataDto {
  @IsOptional() @IsString()
  employeeId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  fromFunction?: string;

  @IsOptional() @IsString() @MaxLength(100)
  toFunction?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class CreateCalendarEventDto {
  @IsString() @MaxLength(300)
  title!: string;

  @IsOptional() @IsString() @MaxLength(50)
  eventType?: string;

  @IsOptional() @IsString() @MaxLength(30)
  startAt?: string;

  @IsOptional() @IsString() @MaxLength(30)
  endAt?: string;

  @IsOptional() @IsBoolean()
  allDay?: boolean;

  @IsOptional() @IsString() @MaxLength(300)
  location?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(20)
  color?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => EventAttendeeDto)
  attendees?: EventAttendeeDto[];

  @IsOptional() @ValidateNested() @Type(() => CoachingDataDto)
  coachingData?: CoachingDataDto;

  @IsOptional() @ValidateNested() @Type(() => CrossSkillDataDto)
  crossSkillData?: CrossSkillDataDto;
}

/** Partial update — the controller additionally whitelists columns. */
export class UpdateCalendarEventDto {
  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  @IsOptional() @IsString() @MaxLength(30)
  startAt?: string;

  @IsOptional() @IsString() @MaxLength(30)
  endAt?: string;

  @IsOptional() @IsString() @MaxLength(300)
  location?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(30)
  status?: string;

  @IsOptional() @IsString() @MaxLength(20)
  color?: string;
}
