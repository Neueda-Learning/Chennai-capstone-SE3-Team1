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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Set only via the Trade API profile-update route once a bank account is linked. Null until then.',
  })
  phone: string | null;

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
