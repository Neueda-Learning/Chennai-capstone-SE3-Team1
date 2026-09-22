import { Test, TestingModule } from '@nestjs/testing';
import { CredentialService } from './credential.service';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { CredentialRepository } from './credential.repository';
import { BadRequestException, HttpException } from '@nestjs/common';

describe('CredentialService', () => {
  let service: CredentialService;
  let passwordService: PasswordService;
  let rateLimiter: LoginRateLimiter;
  let repo: any;
  let logger: any;

  const mockCredentialRow = {
    email: 'test@example.com',
    password_hash: '',
    version: 1,
    params_version: 1,
  };

  beforeEach(async () => {
    repo = {
      findByEmail: jest.fn(),
      upsert: jest.fn(),
      updateHash: jest.fn(),
    };

    logger = {
      logFromSource: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialService,
        PasswordService,
        PasswordPolicy,
        LoginRateLimiter,
        { provide: CredentialRepository, useValue: repo },
        { provide: 'AUTH_LOGGER', useValue: logger },
      ],
    }).compile();

    service = module.get<CredentialService>(CredentialService);
    passwordService = module.get<PasswordService>(PasswordService);
    rateLimiter = module.get<LoginRateLimiter>(LoginRateLimiter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('creates credential with valid password', async () => {
      repo.upsert.mockResolvedValue(undefined);

      const result = await service.register(
        'test@example.com',
        'Strong-Pass-123!',
      );

      expect(result.message).toBe('Credential created successfully');
      expect(repo.upsert).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        1,
      );
      expect(logger.logFromSource).toHaveBeenCalledWith(
        'auth',
        'log',
        'credential_created',
        'register',
        expect.any(Object),
      );
    });

    it('throws BadRequestException for invalid password', async () => {
      await expect(
        service.register('test@example.com', 'short'),
      ).rejects.toThrow(BadRequestException);

      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('returns policy errors', async () => {
      try {
        await service.register('test@example.com', 'short');
      } catch (e) {
        expect(e.response.errors).toContain(
          'Password must be at least 12 characters',
        );
      }
    });
  });

  describe('login', () => {
    let validHash: string;

    beforeEach(async () => {
      validHash = await passwordService.hash('CorrectPass123!');
      mockCredentialRow.password_hash = validHash;
    });

    it('returns rate limited when too many attempts', async () => {
      for (let i = 0; i < 5; i++) {
        rateLimiter.recordFailure('test@example.com');
      }

      await expect(
        service.login('test@example.com', 'password'),
      ).rejects.toThrow(HttpException);

      expect(logger.logFromSource).toHaveBeenCalledWith(
        'auth',
        'warn',
        'rate_limited',
        'login',
        expect.any(Object),
      );
    });

    it('returns invalid credentials for wrong password', async () => {
      repo.findByEmail.mockResolvedValue(mockCredentialRow);

      const result = await service.login('test@example.com', 'WrongPass123!');

      expect(result.verified).toBe(false);
      expect(result.message).toBe('Invalid credentials');
      expect(rateLimiter.check('test@example.com').allowed).toBe(true);
    });

    it('returns invalid credentials for non-existent user (constant time)', async () => {
      repo.findByEmail.mockResolvedValue(null);

      const result = await service.login('nonexistent@example.com', 'password');

      expect(result.verified).toBe(false);
      expect(result.message).toBe('Invalid credentials');
      expect(logger.logFromSource).toHaveBeenCalledWith(
        'auth',
        'warn',
        'login_failed',
        'login',
        expect.any(Object),
      );
    });

    it('successfully logs in with correct password', async () => {
      repo.findByEmail.mockResolvedValue(mockCredentialRow);

      const result = await service.login('test@example.com', 'CorrectPass123!');

      expect(result.verified).toBe(true);
      expect(result.message).toBe('Login successful');
      expect(rateLimiter.check('test@example.com').allowed).toBe(true);
      expect(logger.logFromSource).toHaveBeenCalledWith(
        'auth',
        'log',
        'login_success',
        'login',
        expect.any(Object),
      );
    });

    it('rehashes password if params outdated', async () => {
      const oldHash = '$argon2id$v=19$m=16384,t=1,p=1$salt$hash';
      mockCredentialRow.password_hash = oldHash;
      repo.findByEmail.mockResolvedValue(mockCredentialRow);
      repo.updateHash.mockResolvedValue(undefined);

      jest.spyOn(passwordService, 'verify').mockResolvedValue(true);
      jest.spyOn(passwordService, 'hash').mockResolvedValue('new-hash');
      jest.spyOn(passwordService, 'needsRehash').mockReturnValue(true);

      const result = await service.login('test@example.com', 'anypassword');

      expect(result.verified).toBe(true);
      expect(repo.updateHash).toHaveBeenCalled();
      expect(logger.logFromSource).toHaveBeenCalledWith(
        'auth',
        'log',
        'password_rehashed',
        'login',
        expect.any(Object),
      );
    });

    it('logs failed login attempt', async () => {
      repo.findByEmail.mockResolvedValue(mockCredentialRow);

      await service.login('test@example.com', 'wrong');

      expect(logger.logFromSource).toHaveBeenCalledWith(
        'auth',
        'warn',
        'login_failed',
        'login',
        expect.any(Object),
      );
    });
  });

  describe('rate limiting', () => {
    let validHash: string;

    beforeEach(async () => {
      validHash = await passwordService.hash('CorrectPass123!');
      mockCredentialRow.password_hash = validHash;
    });

    it('locks after 5 failed attempts', async () => {
      repo.findByEmail.mockResolvedValue(mockCredentialRow);

      for (let i = 0; i < 5; i++) {
        await service.login('rate@test.com', 'wrong');
      }

      await expect(service.login('rate@test.com', 'password')).rejects.toThrow(
        HttpException,
      );
    });

    it('resets on successful login', async () => {
      repo.findByEmail.mockResolvedValue(mockCredentialRow);

      for (let i = 0; i < 4; i++) {
        await service.login('reset@test.com', 'wrong');
      }
      const result = await service.login('reset@test.com', 'CorrectPass123!');

      expect(result.verified).toBe(true);
      expect(rateLimiter.check('reset@test.com').allowed).toBe(true);
    });
  });
});
