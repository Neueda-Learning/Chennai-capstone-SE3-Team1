import { Injectable, Inject } from '@nestjs/common';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { UserRepository, UserRecord } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService, AccessTokenClaims, TokenPair } from './token.service';
import { AuthServiceException } from './auth-errors';
import { Role } from './dto/role';
import { UserResponseDto } from './dto/user-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { TokenResponseDto } from './dto/token-response.dto';

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
  // Pre-computed valid argon2id hash used for dummy verification so an unknown
  // username costs the same as a wrong password (prevents user enumeration).
  // argon2id hash of "dummy" with m=65536,t=3,p=4, salt="dummy_salt_16by"
  private readonly DUMMY_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlfc2FsdF8xNmJ5$Uu3oqR1zeXZUQXEVme3U5DfdcY3G5TmW79MFNbkPtqI';

  constructor(
    private readonly password: PasswordService,
    private readonly policy: PasswordPolicy,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    @Inject('AUTH_LOGGER') private readonly logger: AuthLogger,
  ) {}

  async register(request: RegisterRequestDto): Promise<UserResponseDto> {
    const policyResult = this.policy.evaluate(request.password);
    if (!policyResult.valid) {
      throw AuthServiceException.invalidInput(
        'Password does not meet security requirements (minimum 12 characters, must include uppercase, lowercase, number, special character)',
      );
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
    // Public registration: never accept a self-declared role. No trading account is
    // created here; account_id stays null until the user links a bank account.
    const user = await this.createUser(request, hash, [Role.CUSTOMER]);

    this.logger.log('credential_created', 'register', {
      userId: user.id,
      username: user.username,
    });
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
      // Constant-time dummy verification to prevent user enumeration
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
      // A consumed token was presented again: theft. Revoke the whole chain.
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

    // Rotate: the presented token stops working immediately.
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

  /**
   * Revokes only the presented refresh token, so other sessions the user is logged into
   * elsewhere stay signed in. The access token (via JwtAuthGuard) proves who is calling;
   * the refresh token must be theirs, or this looks the same as an unknown token - AUTH-401
   * either way, so a caller can't probe whose session a given token belongs to.
   */
  async logout(
    identity: AccessTokenClaims,
    request: RefreshRequestDto,
  ): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(request.refreshToken);
    const record = await this.refreshTokens.findByHash(tokenHash);

    if (!record || record.userId !== identity.sub) {
      throw AuthServiceException.unauthorised();
    }

    // revoke() only touches a row still revoked_at IS NULL, so logging out twice with the
    // same token is a harmless no-op the second time, not an error.
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
      });
    } catch (error) {
      if (UserRepository.isUniqueViolation(error)) {
        // Lost a race with a concurrent registration after the pre-checks passed.
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
    };
  }
}
