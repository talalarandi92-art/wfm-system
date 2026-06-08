import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@boutiqaat.wfm' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'YourStrongPassword!' })
  @IsString()
  @MinLength(8)
  password: string;
}
