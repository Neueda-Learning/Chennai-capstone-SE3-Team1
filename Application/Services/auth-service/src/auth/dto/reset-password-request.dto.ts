import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { VerifyOtpRequestDto } from './verify-otp-request.dto';

export class ResetPasswordRequestDto extends VerifyOtpRequestDto {
  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
    description:
      'The replacement password. Held to the same policy as at registration; the code is only consumed once the password passes.',
  })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  newPassword: string;
}
