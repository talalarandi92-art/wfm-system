import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Shared body for reject endpoints — an optional human reason. */
export class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
