import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshRequestDto {
  @ApiProperty({
    description: 'The refresh token issued by the previous login or refresh',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
