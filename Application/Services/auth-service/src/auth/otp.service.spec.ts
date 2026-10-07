import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { AuthServiceException } from './auth-errors';
import { OtpOutboxService } from './otp-outbox.service';
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
  let outbox: { deliver: jest.Mock };

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
    outbox = { deliver: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: OtpRepository, useValue: repository },
        { provide: OtpOutboxService, useValue: outbox },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  describe('issue', () => {
    it('stores only the digest, hands the plaintext to the outbox and burns earlier codes', async () => {
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

      expect(outbox.deliver).toHaveBeenCalledWith(
        'priya.menon@example.com',
        'REGISTER',
        code,
      );
    });

    it('passes the RESET purpose through for a reset code', async () => {
      await service.issue('priya.menon@example.com', 'RESET');

      expect(outbox.deliver).toHaveBeenCalledWith(
        'priya.menon@example.com',
        'RESET',
        expect.stringMatching(/^\d{6}$/),
      );
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
