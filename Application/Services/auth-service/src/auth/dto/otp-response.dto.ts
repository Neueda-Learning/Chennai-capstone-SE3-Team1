import { ApiProperty } from '@nestjs/swagger';

export class OtpSentResponseDto {
  @ApiProperty({ example: true })
  sent: boolean;
}

export class OtpVerifiedResponseDto {
  @ApiProperty({ example: true })
  verified: boolean;
}

export class PasswordResetResponseDto {
  @ApiProperty({ example: true })
  reset: boolean;
}
