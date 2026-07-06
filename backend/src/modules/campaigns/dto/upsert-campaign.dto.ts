import { IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

/**
 * Create/update body for campaigns. All fields optional at the DTO layer —
 * the controller keeps its own required-field defaults (name fallback etc.)
 * and PATCH is partial by design. The frontend form posts its whole state
 * including a blank `id`, so `id` must stay whitelisted.
 */
export class UpsertCampaignDto {
  @IsOptional() @IsString()
  id?: string;

  @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(50)
  campaignType?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  endDate?: string;

  @IsOptional() @IsBoolean()
  restrictRequests?: boolean;

  @IsOptional() @IsArray() @IsString({ each: true })
  restrictedTypes?: string[];

  @IsOptional() @IsInt() @Min(0) @Max(200)
  requiredHcUpliftPct?: number;

  @IsOptional() @IsString() @MaxLength(20)
  color?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
