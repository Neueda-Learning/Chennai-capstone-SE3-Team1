import { Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { AuthServiceException } from './auth-errors';
import { MailerService } from './mailer.service';
import { OtpPurpose, OtpRepository } from './otp.repository';

export const OTP_TTL_SECONDS = 600;

export const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(
    private readonly repository: OtpRepository,
    private readonly mailer: MailerService,
  ) {}

  async issue(email: string, purpose: OtpPurpose): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.repository.consumeAllActive(email, purpose);
    await this.repository.create({
      email,
      purpose,
      codeHash: this.hash(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });

    if (purpose === 'REGISTER') {
      await this.mailer.sendVerificationEmail(email, code);
    } else {
      await this.mailer.sendPasswordResetEmail(email, code);
    }
    return code;
  }

  async verify(
    email: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<void> {
    const record = await this.repository.findActive(email, purpose);
    if (record === null || record.attempts >= OTP_MAX_ATTEMPTS) {
      if (record !== null) {
        await this.repository.markConsumed(record.id);
      }
      throw AuthServiceException.otpInvalid();
    }

    if (!this.matches(code, record.codeHash)) {
      const attempts = record.attempts + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.repository.markConsumed(record.id);
      } else {
        await this.repository.setAttempts(record.id, attempts);
      }
      throw AuthServiceException.otpInvalid();
    }

    await this.repository.markConsumed(record.id);
  }

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private matches(code: string, expectedHash: string): boolean {
    const left = Buffer.from(this.hash(code));
    const right = Buffer.from(expectedHash);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
