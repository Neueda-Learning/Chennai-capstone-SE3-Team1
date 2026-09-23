import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ description: 'Signed JWT carrying the claims contract' })
  accessToken: string;

  @ApiProperty({
    description: 'Opaque, stored server-side, revocable, rotated on every use',
  })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({
    example: 900,
    description: 'Access token lifetime in seconds',
  })
  expiresIn: number;
}
