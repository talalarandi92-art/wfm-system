import { IsEmail, IsString, MinLength, IsOptional, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@boutiqaat.wfm' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'YourStrongPassword!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ description: '6-digit TOTP code (only when MFA is enabled)' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  mfaCode?: string;
}
