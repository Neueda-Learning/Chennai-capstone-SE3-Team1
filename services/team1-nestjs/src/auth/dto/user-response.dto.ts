import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from './role';

export class UserResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The value carried in the sub claim',
  })
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ description: 'The numeric trading account key, ACCOUNTS.id' })
  accountId: number;

  @ApiProperty({ enum: Role, isArray: true })
  roles: Role[];

  @ApiPropertyOptional({ format: 'date-time' })
  createdOn?: Date;
}
