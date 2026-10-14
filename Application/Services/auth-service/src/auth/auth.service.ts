import { Injectable, Inject } from '@nestjs/common';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { UserRepository, UserRecord } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService, AccessTokenClaims, TokenPair } from './token.service';
import { AuthServiceException } from './auth-errors';
import { OtpService } from './otp.service';
import { Role } from './dto/role';
import { UserResponseDto } from './dto/user-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { EmailRequestDto } from './dto/email-request.dto';
import { VerifyOtpRequestDto } from './dto/verify-otp-request.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import {
  OtpSentResponseDto,
  OtpVerifiedResponseDto,
  PasswordResetResponseDto,
} from './dto/otp-response.dto';

interface AuthLogger {
  log: (
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ) => void;
  warn: (
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ) => void;
  error: (
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, any>,
  ) => void;
}

@Injectable()
export class AuthService {
  private readonly CURRENT_PARAMS_VERSION = 1;
  private readonly DUMMY_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlfc2FsdF8xNmJ5$Uu3oqR1zeXZUQXEVme3U5DfdcY3G5TmW79MFNbkPtqI';

  private readonly POLICY_MESSAGE =
    'Password does not meet security requirements (minimum 12 characters, at least one number or special character, and no "password" or run of 4 sequential or keyboard characters)';

  constructor(
    private readonly password: PasswordService,
    private readonly policy: PasswordPolicy,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    @Inject('AUTH_LOGGER') private readonly logger: AuthLogger,
  ) {}

  async register(request: RegisterRequestDto): Promise<UserResponseDto> {
    const policyResult = this.policy.evaluate(request.password);
    if (!policyResult.valid) {
      throw AuthServiceException.invalidInput(this.POLICY_MESSAGE);
    }

    const existing = await this.users.findByUsername(request.username);
    if (existing) {
      throw AuthServiceException.usernameTaken();
    }

    const emailUser = await this.users.findByEmail(request.email);
    if (emailUser) {
      throw AuthServiceException.emailTaken();
    }

    const hash = await this.password.hash(request.password);
    const user = await this.createUser(request, hash, [Role.CUSTOMER]);

    this.logger.log('credential_created', 'register', {
      userId: user.id,
      username: user.username,
    });

    await this.otp.issue(user.email, 'REGISTER');
    this.logger.log('registration_otp_issued', 'register', { userId: user.id });

    return this.toUserResponse(user);
  }

  async login(request: LoginRequestDto): Promise<TokenResponseDto> {
    const rateCheck = this.rateLimiter.check(request.username);
    if (!rateCheck.allowed) {
      this.logger.warn('rate_limited', 'login', { username: request.username });
      throw AuthServiceException.unauthorised();
    }

    const user = await this.users.findByUsername(request.username);

    if (!user) {
      await this.timingSafeVerify(request, this.DUMMY_HASH);
      this.rateLimiter.recordFailure(request.username);
      this.logger.warn('login_failed', 'login', { username: request.username });
      throw AuthServiceException.unauthorised();
    }

    const verified = await this.password.verify(
      request.password,
      user.passwordHash,
    );

    if (!verified) {
      this.rateLimiter.recordFailure(request.username);
      this.logger.warn('login_failed', 'login', { username: request.username });
      throw AuthServiceException.unauthorised();
    }

    this.rateLimiter.recordSuccess(request.username);

    if (user.status === 'PENDING') {
      this.logger.warn('login_blocked_pending_verification', 'login', {
        userId: user.id,
      });
      throw AuthServiceException.unauthorised(
        'Account created - check your email for the verification code and sign in once verified',
      );
    }

    if (this.password.needsRehash(user.passwordHash)) {
      const newHash = await this.password.hash(request.password);
      await this.users.updatePasswordHash(
        user.id,
        newHash,
        this.CURRENT_PARAMS_VERSION,
      );
      this.logger.log('password_rehashed', 'login', {
        username: request.username,
      });
    }

    this.logger.log('login_success', 'login', {
      userId: user.id,
      username: user.username,
    });
    return this.issueTokens(user);
  }

  async refresh(request: RefreshRequestDto): Promise<TokenResponseDto> {
    const tokenHash = this.tokens.hashRefreshToken(request.refreshToken);
    const record = await this.refreshTokens.findByHash(tokenHash);

    if (!record) {
      throw AuthServiceException.unauthorised();
    }

    const now = new Date();

    if (record.revokedAt) {
      await this.refreshTokens.revokeAllForUser(record.userId);
      this.logger.warn('refresh_token_theft_detected', 'refresh', {
        userId: record.userId,
      });
      throw AuthServiceException.unauthorised();
    }

    if (record.expiresAt <= now) {
      await this.refreshTokens.revoke(record.id);
      this.logger.warn('refresh_token_expired', 'refresh', {
        userId: record.userId,
      });
      throw AuthServiceException.unauthorised();
    }

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw AuthServiceException.unauthorised();
    }

    await this.refreshTokens.revoke(record.id);

    const pair = this.tokens.createTokenPair(this.claimsFrom(user));
    await this.refreshTokens.store({
      userId: user.id,
      tokenHash: this.tokens.hashRefreshToken(pair.refreshToken),
      expiresAt: this.tokens.refreshTokenExpiry(),
    });

    this.logger.log('token_refreshed', 'refresh', { userId: user.id });
    return this.toTokenResponse(pair);
  }

  async logout(
    identity: AccessTokenClaims,
    request: RefreshRequestDto,
  ): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(request.refreshToken);
    const record = await this.refreshTokens.findByHash(tokenHash);

    if (!record || record.userId !== identity.sub) {
      throw AuthServiceException.unauthorised();
    }

    await this.refreshTokens.revoke(record.id);

    this.logger.log('logout', 'logout', { userId: identity.sub });
  }

  async me(identity: AccessTokenClaims): Promise<UserResponseDto> {
    const user = await this.users.findById(identity.sub);
    if (!user) {
      throw AuthServiceException.unauthorised();
    }
    return this.toUserResponse(user);
  }

  async verifyOtp(
    request: VerifyOtpRequestDto,
  ): Promise<OtpVerifiedResponseDto> {
    const user = await this.users.findByEmail(request.email);
    if (!user || user.status !== 'PENDING') {
      throw AuthServiceException.otpInvalid();
    }

    await this.otp.verify(request.email, 'REGISTER', request.otp);
    await this.users.setStatus(user.id, 'ACTIVE');

    this.logger.log('registration_verified', 'verify-otp', { userId: user.id });
    return { verified: true };
  }

  async forgotPassword(request: EmailRequestDto): Promise<OtpSentResponseDto> {
    const user = await this.users.findByEmail(request.email);
    if (user) {
      await this.otp.issue(request.email, 'RESET');
      this.logger.log('password_reset_otp_issued', 'forgot-password', {
        userId: user.id,
      });
    }
    return { sent: true };
  }

  async resendOtp(request: EmailRequestDto): Promise<OtpSentResponseDto> {
    const user = await this.users.findByEmail(request.email);
    if (user && user.status === 'PENDING') {
      await this.otp.issue(request.email, 'REGISTER');
      this.logger.log('registration_otp_reissued', 'resend-otp', {
        userId: user.id,
      });
    }
    return { sent: true };
  }

  async resetPassword(
    request: ResetPasswordRequestDto,
  ): Promise<PasswordResetResponseDto> {
    const policyResult = this.policy.evaluate(request.newPassword);
    if (!policyResult.valid) {
      throw AuthServiceException.invalidInput(this.POLICY_MESSAGE);
    }

    const user = await this.users.findByEmail(request.email);
    if (!user) {
      throw AuthServiceException.otpInvalid();
    }

    await this.otp.verify(request.email, 'RESET', request.otp);

    const hash = await this.password.hash(request.newPassword);
    await this.users.updatePasswordHash(
      user.id,
      hash,
      this.CURRENT_PARAMS_VERSION,
    );
    await this.refreshTokens.revokeAllForUser(user.id);

    this.logger.log('password_reset', 'reset-password', { userId: user.id });
    return { reset: true };
  }

  private async createUser(
    request: RegisterRequestDto,
    passwordHash: string,
    roles: Role[],
  ): Promise<UserRecord> {
    try {
      return await this.users.create({
        username: request.username,
        email: request.email,
        roles,
        passwordHash,
        paramsVersion: this.CURRENT_PARAMS_VERSION,
        status: 'PENDING',
      });
    } catch (error) {
      if (UserRepository.isUniqueViolation(error)) {
        throw UserRepository.violatedConstraint(error) === 'uq_users_email'
          ? AuthServiceException.emailTaken()
          : AuthServiceException.usernameTaken();
      }
      throw error;
    }
  }

  private async timingSafeVerify(
    request: LoginRequestDto,
    hash: string,
  ): Promise<void> {
    await this.password.verify(request.password, hash);
  }

  private claimsFrom(user: UserRecord): {
    sub: string;
    accountId: number | null;
    roles: string[];
  } {
    return {
      sub: user.id,
      accountId: user.accountId,
      roles: user.roles,
    };
  }

  private async issueTokens(user: UserRecord): Promise<TokenResponseDto> {
    const pair = this.tokens.createTokenPair(this.claimsFrom(user));
    await this.refreshTokens.store({
      userId: user.id,
      tokenHash: this.tokens.hashRefreshToken(pair.refreshToken),
      expiresAt: this.tokens.refreshTokenExpiry(),
    });
    return this.toTokenResponse(pair);
  }

  private toTokenResponse(pair: TokenPair): TokenResponseDto {
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      tokenType: 'Bearer',
      expiresIn: pair.expiresIn,
    };
  }

  private toUserResponse(user: UserRecord): UserResponseDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      accountId: user.accountId,
      roles: user.roles,
      createdOn: user.createdOn,
      status: user.status,
    };
  }
}
