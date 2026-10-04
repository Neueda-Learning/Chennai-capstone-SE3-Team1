import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { EmailRequestDto } from './email-request.dto';

export class VerifyOtpRequestDto extends EmailRequestDto {
  @ApiProperty({
    example: '123456',
    minLength: 6,
    maxLength: 6,
    writeOnly: true,
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp: string;
}
