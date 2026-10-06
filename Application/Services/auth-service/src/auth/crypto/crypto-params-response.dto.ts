import { ApiProperty } from '@nestjs/swagger';

export class CryptoParamsResponseDto {
  @ApiProperty({ example: 1 })
  v!: number;

  @ApiProperty({ description: 'Short fingerprint of the public key' })
  keyId!: string;

  @ApiProperty({
    description:
      'RSA public key, SPKI PEM. Wrap the AES key with RSA-OAEP / SHA-256.',
  })
  publicKey!: string;

  @ApiProperty({ description: 'The same public key as a hex modulus' })
  modulus!: string;

  @ApiProperty({
    description: 'The same public key as a hex exponent',
    example: '010001',
  })
  exponent!: string;

  @ApiProperty({
    description:
      'One-time value: bind it into the AES-GCM additional data, send it back in the envelope',
  })
  nonce!: string;

  @ApiProperty({ example: 60 })
  expiresInSeconds!: number;
}
