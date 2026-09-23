import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  username: string;

  @ApiProperty({ maxLength: 128, writeOnly: true })
  @IsString()
  @MaxLength(128)
  password: string;
}
