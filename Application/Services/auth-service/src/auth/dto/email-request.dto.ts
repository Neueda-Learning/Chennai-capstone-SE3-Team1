import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class EmailRequestDto {
  @ApiProperty({ example: 'priya.menon@example.com', maxLength: 150 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(150, { message: 'email must be at most 150 characters' })
  email: string;
}
