import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** multipart/form-data text fields (the `file` part is handled by Multer, not the body). */
export class CreateTechIssueDto {
  @IsString() @MaxLength(300)
  title!: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsIn(['low', 'medium', 'high', 'critical'])
  severity?: string;

  @IsOptional() @IsString() @MaxLength(100)
  functionName?: string;

  @IsOptional() @IsString() @MaxLength(50)
  channel?: string;
}
