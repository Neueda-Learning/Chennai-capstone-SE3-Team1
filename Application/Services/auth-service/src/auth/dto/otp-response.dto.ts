import { ApiProperty } from '@nestjs/swagger';

/**
 * Answer to both send-a-code routes. Always true: an address with no account
 * gets the same 200 with the same body, so the response says nothing about
 * which emails exist.
 */
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
