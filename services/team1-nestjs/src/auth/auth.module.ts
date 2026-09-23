import { Module, Global } from '@nestjs/common';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { UserRepository } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    PasswordPolicy,
    LoginRateLimiter,
    UserRepository,
    RefreshTokenRepository,
    TokenService,
    AuthService,
    JwtAuthGuard,
  ],
  exports: [
    PasswordService,
    PasswordPolicy,
    LoginRateLimiter,
    UserRepository,
    RefreshTokenRepository,
    TokenService,
    AuthService,
    JwtAuthGuard,
  ],
})
export class AuthModule {}
