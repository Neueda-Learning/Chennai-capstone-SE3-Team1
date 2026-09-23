import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
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

  @ApiProperty({ example: 1, description: 'The numeric trading account key' })
  @Type(() => Number)
  @IsInt({ message: 'accountId must be an integer' })
  @Min(1, { message: 'accountId must be a positive integer' })
  accountId: number;

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
