import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { UserRepository, UserRecord } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService, TokenPair } from './token.service';
import { AuthServiceException } from './auth-errors';
import { Role } from './dto/role';

describe('AuthService', () => {
  let service: AuthService;
  let password: {
    hash: jest.Mock;
    verify: jest.Mock;
    needsRehash: jest.Mock;
  };
  let policy: { evaluate: jest.Mock };
  let rateLimiter: {
    check: jest.Mock;
    recordFailure: jest.Mock;
    recordSuccess: jest.Mock;
  };
  let users: {
    findByUsername: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    updatePasswordHash: jest.Mock;
  };
  let refreshTokens: {
    findByHash: jest.Mock;
    store: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let tokens: {
    createTokenPair: jest.Mock;
    hashRefreshToken: jest.Mock;
    refreshTokenExpiry: jest.Mock;
  };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  const user: UserRecord = {
    id: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
    username: 'priya.menon',
    email: 'priya.menon@example.com',
    accountId: 1,
    roles: [Role.CUSTOMER],
    passwordHash: 'argon2-hash-here',
    paramsVersion: 1,
    version: 1,
    createdOn: new Date('2026-10-05T08:00:00Z'),
  };

  const pair: TokenPair = {
    accessToken: 'header.payload.sig',
    refreshToken: 'opaque-refresh-token',
    expiresIn: 900,
  };

  beforeEach(async () => {
    password = {
      hash: jest.fn(),
      verify: jest.fn(),
      needsRehash: jest.fn(),
    };
    policy = { evaluate: jest.fn() };
    rateLimiter = {
      check: jest.fn(),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };
    users = {
      findByUsername: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updatePasswordHash: jest.fn(),
    };
    refreshTokens = {
      findByHash: jest.fn(),
      store: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    tokens = {
      createTokenPair: jest.fn(),
      hashRefreshToken: jest.fn(),
      refreshTokenExpiry: jest.fn(),
    };
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PasswordService, useValue: password },
        { provide: PasswordPolicy, useValue: policy },
        { provide: LoginRateLimiter, useValue: rateLimiter },
        { provide: UserRepository, useValue: users },
        { provide: RefreshTokenRepository, useValue: refreshTokens },
        { provide: TokenService, useValue: tokens },
        { provide: 'AUTH_LOGGER', useValue: logger },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    const body = {
      username: 'priya.menon',
      email: 'priya.menon@example.com',
      password: 'correct horse battery staple',
    };

    function registrationPasses() {
      policy.evaluate.mockReturnValue({ valid: true, errors: [] });
      users.findByUsername.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(null);
      password.hash.mockResolvedValue('new-argon2-hash');
    }

    async function registerError(request = body): Promise<AuthServiceException> {
      let caught: unknown;
      try {
        await service.register(request);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AuthServiceException);
      return caught as AuthServiceException;
    }

    it('creates a CUSTOMER user with no trading account, ignoring supplied roles', async () => {
      registrationPasses();
      users.create.mockImplementation(
        async (input: { username: string; email: string; roles: Role[] }) => ({
          ...user,
          username: input.username,
          email: input.email,
          roles: input.roles,
          accountId: null,
        }),
      );

      const result = await service.register({ ...body, roles: [Role.ADMIN] });

      expect(users.create).toHaveBeenCalledWith({
        username: 'priya.menon',
        email: 'priya.menon@example.com',
        roles: [Role.CUSTOMER],
        passwordHash: 'new-argon2-hash',
        paramsVersion: 1,
      });
      // No tokens on registration.
      expect(tokens.createTokenPair).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: user.id,
        username: 'priya.menon',
        email: 'priya.menon@example.com',
        accountId: null,
        roles: [Role.CUSTOMER],
        createdOn: user.createdOn,
      });
      expect(logger.log).toHaveBeenCalledWith(
        'credential_created',
        'register',
        expect.any(Object),
      );
    });

    it('fails with VAL-422 when the password policy rejects the password', async () => {
      policy.evaluate.mockReturnValue({
        valid: false,
        errors: ['Password must be at least 12 characters'],
      });

      const error = await registerError({ ...body, password: 'short' });

      expect(error.getStatus()).toBe(422);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('fails with AUTH-409 when the username is already taken', async () => {
      registrationPasses();
      users.findByUsername.mockResolvedValue(user);

      const error = await registerError();

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        message: 'Username already registered',
      });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('fails with AUTH-409 when the email is already registered', async () => {
      registrationPasses();
      users.findByEmail.mockResolvedValue(user);

      const error = await registerError({ ...body, username: 'someone.else' });

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        message: 'Email already registered',
      });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('maps a username unique-violation from a concurrent registration to AUTH-409', async () => {
      registrationPasses();
      users.create.mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'users_username_key',
        }),
      );

      const error = await registerError();

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        message: 'Username already registered',
      });
    });

    it('maps an email unique-violation from a concurrent registration to AUTH-409', async () => {
      registrationPasses();
      users.create.mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_users_email',
        }),
      );

      const error = await registerError();

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        message: 'Email already registered',
      });
    });
  });

  describe('login', () => {
    it('issues a token pair for a valid password, storing the refresh token', async () => {
      rateLimiter.check.mockReturnValue({ allowed: true });
      users.findByUsername.mockResolvedValue(user);
      password.verify.mockResolvedValue(true);
      password.needsRehash.mockReturnValue(false);
      tokens.createTokenPair.mockReturnValue(pair);
      tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
      tokens.refreshTokenExpiry.mockReturnValue(
        new Date('2026-10-12T08:00:00Z'),
      );
      refreshTokens.store.mockResolvedValue(undefined);

      const result = await service.login({
        username: 'priya.menon',
        password: 'correct horse battery staple',
      });

      expect(rateLimiter.recordSuccess).toHaveBeenCalledWith('priya.menon');
      expect(refreshTokens.store).toHaveBeenCalledWith({
        userId: user.id,
        tokenHash: 'a'.repeat(64),
        expiresAt: expect.any(Date),
      });
      expect(result).toEqual({
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      expect(logger.log).toHaveBeenCalledWith(
        'login_success',
        'login',
        expect.any(Object),
      );
    });

    it('lets a user with no linked bank account log in, with a null accountId claim', async () => {
      rateLimiter.check.mockReturnValue({ allowed: true });
      users.findByUsername.mockResolvedValue({ ...user, accountId: null });
      password.verify.mockResolvedValue(true);
      password.needsRehash.mockReturnValue(false);
      tokens.createTokenPair.mockReturnValue(pair);
      tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
      tokens.refreshTokenExpiry.mockReturnValue(
        new Date('2026-10-12T08:00:00Z'),
      );

      await service.login({
        username: 'priya.menon',
        password: 'correct horse battery staple',
      });

      expect(tokens.createTokenPair).toHaveBeenCalledWith({
        sub: user.id,
        accountId: null,
        roles: [Role.CUSTOMER],
      });
    });

    it('returns the identical AUTH-401 for an unknown username and a wrong password', async () => {
      // Unknown user
      rateLimiter.check.mockReturnValue({ allowed: true });
      users.findByUsername.mockResolvedValue(null);
      password.verify.mockResolvedValue(false);

      let unknownCaught: unknown;
      try {
        await service.login({
          username: 'ghost.user',
          password: 'whatever-password-ok',
        });
      } catch (e) {
        unknownCaught = e;
      }

      // Also confirm a dummy verify still ran (constant-time attempt)
      expect(password.verify).toHaveBeenCalled();
      expect(rateLimiter.recordFailure).toHaveBeenCalledWith('ghost.user');
      expect(unknownCaught).toBeInstanceOf(AuthServiceException);
      expect((unknownCaught as AuthServiceException).getStatus()).toBe(401);
      expect((unknownCaught as AuthServiceException).getResponse()).toEqual({
        errorCode: 'AUTH-401',
        message: 'Unauthorised',
      });

      // Wrong password
      rateLimiter.check.mockReturnValue({ allowed: true });
      users.findByUsername.mockResolvedValue(user);
      password.verify.mockResolvedValue(false);

      let wrongCaught: unknown;
      try {
        await service.login({
          username: 'priya.menon',
          password: 'wrong-password-value',
        });
      } catch (e) {
        wrongCaught = e;
      }

      expect(wrongCaught).toBeInstanceOf(AuthServiceException);
      expect((wrongCaught as AuthServiceException).getResponse()).toEqual(
        (unknownCaught as AuthServiceException).getResponse(),
      );
      expect((wrongCaught as AuthServiceException).getStatus()).toBe(
        (unknownCaught as AuthServiceException).getStatus(),
      );
    });

    it('rehashes an outdated argon2 hash on successful login', async () => {
      rateLimiter.check.mockReturnValue({ allowed: true });
      users.findByUsername.mockResolvedValue(user);
      password.verify.mockResolvedValue(true);
      password.needsRehash.mockReturnValue(true);
      password.hash.mockResolvedValue('rehashed-hash');
      tokens.createTokenPair.mockReturnValue(pair);
      refreshTokens.store.mockResolvedValue(undefined);

      await service.login({
        username: 'priya.menon',
        password: 'correct horse battery staple',
      });

      expect(users.updatePasswordHash).toHaveBeenCalledWith(
        user.id,
        'rehashed-hash',
        1,
      );
    });

    it('returns AUTH-401 when the account is rate limited (never 429)', async () => {
      rateLimiter.check.mockReturnValue({
        allowed: false,
        retryAfterMs: 10000,
      });

      let caught: unknown;
      try {
        await service.login({
          username: 'priya.menon',
          password: 'correct horse battery staple',
        });
      } catch (e) {
        caught = e;
      }

      expect((caught as AuthServiceException).getStatus()).toBe(401);
      expect((caught as AuthServiceException).getResponse()).toEqual({
        errorCode: 'AUTH-401',
        message: 'Unauthorised',
      });
    });
  });

  describe('refresh', () => {
    const active = {
      id: 'rt-1',
      userId: user.id,
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date('2026-10-12T08:00:00Z'),
      revokedAt: null,
      createdAt: new Date('2026-10-05T08:00:00Z'),
    };

    it('rotates: revokes the presented token and stores a new pair', async () => {
      refreshTokens.findByHash.mockResolvedValue(active);
      users.findById.mockResolvedValue(user);
      refreshTokens.revoke.mockResolvedValue(undefined);
      tokens.createTokenPair.mockReturnValue(pair);
      tokens.hashRefreshToken.mockReturnValue('b'.repeat(64));
      tokens.refreshTokenExpiry.mockReturnValue(
        new Date('2026-10-12T08:00:00Z'),
      );
      refreshTokens.store.mockResolvedValue(undefined);

      const result = await service.refresh({ refreshToken: 'presented-token' });

      expect(refreshTokens.revoke).toHaveBeenCalledWith('rt-1');
      expect(refreshTokens.store).toHaveBeenCalledWith({
        userId: user.id,
        tokenHash: 'b'.repeat(64),
        expiresAt: expect.any(Date),
      });
      expect(result.accessToken).toBe(pair.accessToken);
      expect(result.refreshToken).toBe(pair.refreshToken);
    });

    it('re-reads the user, so a refresh after linking a bank account carries the new accountId', async () => {
      refreshTokens.findByHash.mockResolvedValue(active);
      users.findById.mockResolvedValue({ ...user, accountId: 42 });
      tokens.createTokenPair.mockReturnValue(pair);
      tokens.hashRefreshToken.mockReturnValue('b'.repeat(64));
      tokens.refreshTokenExpiry.mockReturnValue(
        new Date('2026-10-12T08:00:00Z'),
      );

      await service.refresh({ refreshToken: 'presented-token' });

      expect(tokens.createTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 42 }),
      );
    });

    it('treats reuse of a consumed token as theft and revokes the whole chain', async () => {
      refreshTokens.findByHash.mockResolvedValue({
        ...active,
        revokedAt: new Date('2026-10-06T08:00:00Z'),
      });
      refreshTokens.revokeAllForUser.mockResolvedValue(undefined);

      let caught: unknown;
      try {
        await service.refresh({ refreshToken: 'replayed-token' });
      } catch (e) {
        caught = e;
      }

      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect((caught as AuthServiceException).getStatus()).toBe(401);
    });

    it('rejects an unknown refresh token', async () => {
      refreshTokens.findByHash.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'unknown-token' }),
      ).rejects.toBeInstanceOf(AuthServiceException);
    });

    it('rejects an expired refresh token and revokes it', async () => {
      refreshTokens.findByHash.mockResolvedValue({
        ...active,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      refreshTokens.revoke.mockResolvedValue(undefined);

      let caught: unknown;
      try {
        await service.refresh({ refreshToken: 'expired-token' });
      } catch (e) {
        caught = e;
      }

      expect(refreshTokens.revoke).toHaveBeenCalledWith('rt-1');
      expect((caught as AuthServiceException).getStatus()).toBe(401);
    });
  });

  describe('me', () => {
    it('returns the user identified by the verified token', async () => {
      users.findById.mockResolvedValue(user);

      const result = await service.me({
        sub: user.id,
        accountId: 1,
        roles: [Role.CUSTOMER],
        iat: 1790000000,
        exp: 1790000900,
        iss: 'auth-service',
      });

      expect(users.findById).toHaveBeenCalledWith(user.id);
      expect(result.username).toBe('priya.menon');
    });

    it('returns AUTH-401 when the token names a missing user', async () => {
      users.findById.mockResolvedValue(null);

      await expect(
        service.me({
          sub: 'missing-uuid-0000-0000-0000-000000000000',
          accountId: 1,
          roles: [Role.CUSTOMER],
          iat: 1790000000,
          exp: 1790000900,
          iss: 'auth-service',
        }),
      ).rejects.toBeInstanceOf(AuthServiceException);
    });
  });
});
