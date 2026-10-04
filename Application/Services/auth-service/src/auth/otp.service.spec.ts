import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { AuthServiceException } from './auth-errors';
import { MailerService } from './mailer.service';
import { OtpRepository, OtpCodeRecord } from './otp.repository';
import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, OtpService } from './otp.service';

describe('OtpService', () => {
  let service: OtpService;
  let repository: {
    create: jest.Mock;
    findActive: jest.Mock;
    markConsumed: jest.Mock;
    setAttempts: jest.Mock;
    consumeAllActive: jest.Mock;
  };
  let mailer: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };

  const record = (overrides: Partial<OtpCodeRecord> = {}): OtpCodeRecord => ({
    id: 'otp-1',
    email: 'priya.menon@example.com',
    purpose: 'REGISTER',
    codeHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  });

  /** The digest OtpService would store for a known plaintext code. */
  const hashOf = (code: string) =>
    createHash('sha256').update(code).digest('hex');

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      findActive: jest.fn(),
      markConsumed: jest.fn(),
      setAttempts: jest.fn(),
      consumeAllActive: jest.fn(),
    };
    mailer = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: OtpRepository, useValue: repository },
        { provide: MailerService, useValue: mailer },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  describe('issue', () => {
    it('stores only the digest, mails the plaintext and burns earlier codes', async () => {
      const code = await service.issue('priya.menon@example.com', 'REGISTER');

      expect(code).toMatch(/^\d{6}$/);
      expect(repository.consumeAllActive).toHaveBeenCalledWith(
        'priya.menon@example.com',
        'REGISTER',
      );

      const createArg = repository.create.mock.calls[0][0];
      expect(createArg.codeHash).toBe(hashOf(code));
      expect(createArg.codeHash).not.toBe(code);
      expect(createArg.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(createArg.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + OTP_TTL_SECONDS * 1000,
      );

      expect(mailer.sendVerificationEmail).toHaveBeenCalledWith(
        'priya.menon@example.com',
        code,
      );
      expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('sends the reset wording for a RESET code', async () => {
      await service.issue('priya.menon@example.com', 'RESET');

      expect(mailer.sendPasswordResetEmail).toHaveBeenCalledWith(
        'priya.menon@example.com',
        expect.stringMatching(/^\d{6}$/),
      );
      expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('consumes the code when the digits match', async () => {
      repository.findActive.mockResolvedValue(
        record({ codeHash: hashOf('123456') }),
      );

      await service.verify('priya.menon@example.com', 'REGISTER', '123456');

      expect(repository.markConsumed).toHaveBeenCalledWith('otp-1');
      expect(repository.setAttempts).not.toHaveBeenCalled();
    });

    it('throws AUTH-410 when no code is waiting', async () => {
      repository.findActive.mockResolvedValue(null);

      await expect(
        service.verify('priya.menon@example.com', 'REGISTER', '123456'),
      ).rejects.toMatchObject({ status: 410 });
      expect(repository.markConsumed).not.toHaveBeenCalled();
    });

    it('counts a wrong guess and rejects', async () => {
      repository.findActive.mockResolvedValue(
        record({ codeHash: hashOf('123456'), attempts: 1 }),
      );

      await expect(
        service.verify('priya.menon@example.com', 'REGISTER', '000000'),
      ).rejects.toMatchObject({ status: 410 });
      expect(repository.setAttempts).toHaveBeenCalledWith('otp-1', 2);
      expect(repository.markConsumed).not.toHaveBeenCalled();
    });

    it('burns the code on the last allowed attempt, so it cannot be walked', async () => {
      repository.findActive.mockResolvedValue(
        record({
          codeHash: hashOf('123456'),
          attempts: OTP_MAX_ATTEMPTS - 1,
        }),
      );

      await expect(
        service.verify('priya.menon@example.com', 'REGISTER', '000000'),
      ).rejects.toMatchObject({ status: 410 });
      expect(repository.setAttempts).not.toHaveBeenCalled();
      expect(repository.markConsumed).toHaveBeenCalledWith('otp-1');
    });

    it('rejects a code whose allowance is already spent, even if the digits are right', async () => {
      repository.findActive.mockResolvedValue(
        record({
          codeHash: hashOf('123456'),
          attempts: OTP_MAX_ATTEMPTS,
        }),
      );

      await expect(
        service.verify('priya.menon@example.com', 'REGISTER', '123456'),
      ).rejects.toBeInstanceOf(AuthServiceException);
      expect(repository.markConsumed).toHaveBeenCalledWith('otp-1');
    });
  });
});
