import { Module, Global } from '@nestjs/common';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { CredentialRepository } from './credential.repository';
import { CredentialService } from './credential.service';
import { AuthController } from './auth.controller';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    PasswordPolicy,
    LoginRateLimiter,
    CredentialRepository,
    CredentialService,
  ],
  exports: [
    PasswordService,
    PasswordPolicy,
    LoginRateLimiter,
    CredentialRepository,
    CredentialService,
  ],
})
export class AuthModule {}