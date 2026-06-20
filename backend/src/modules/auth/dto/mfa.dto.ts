import { IsString, Length } from 'class-validator';

export class MfaTokenDto {
  @IsString()
  @Length(6, 6, { message: 'Code must be 6 digits.' })
  token: string;
}

export class MfaDisableDto {
  @IsString()
  password: string;

  @IsString()
  @Length(6, 6, { message: 'Code must be 6 digits.' })
  token: string;
}
