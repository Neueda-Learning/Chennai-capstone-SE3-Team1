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

  @ApiProperty()
  email: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The numeric trading account key, clients.client_id. Null until the user links a bank account.',
  })
  accountId: number | null;

  @ApiProperty({ enum: Role, isArray: true })
  roles: Role[];

  @ApiPropertyOptional({ format: 'date-time' })
  createdOn?: Date;
}
