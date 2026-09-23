import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from './role';

export class RegisterRequestDto {
  @ApiProperty({ example: 'priya.menon', minLength: 3, maxLength: 64 })
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'username must contain only letters, numbers, dots, dashes and underscores',
  })
  @MinLength(3)
  @MaxLength(64)
  username: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  password: string;

  @ApiProperty({ example: 'priya.menon@example.com', maxLength: 150 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(150, { message: 'email must be at most 150 characters' })
  email: string;

  @ApiPropertyOptional({
    enum: Role,
    isArray: true,
    description:
      'Ignored on a public registration route; the user is always created as CUSTOMER.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(Role, { each: true })
  roles?: Role[];
}
