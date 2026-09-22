import {
  Injectable,
  Inject,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PasswordService } from './password.service';
import { PasswordPolicy } from './password-policy';
import { LoginRateLimiter } from './rate-limiter';
import { CredentialRepository } from './credential.repository';
import { MultiFileLogger } from '../logging/logger.service';

@Injectable()
export class CredentialService {
  private readonly CURRENT_PARAMS_VERSION = 1;
  // Pre-computed valid argon2id hash for dummy verification (prevents user enumeration)
  // argon2id hash of "dummy" with m=65536,t=3,p=4, salt="dummy_salt_16by"
  private readonly DUMMY_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlfc2FsdF8xNmJ5$Uu3oqR1zeXZUQXEVme3U5DfdcY3G5TmW79MFNbkPtqI';

  constructor(
    private readonly password: PasswordService,
    private readonly policy: PasswordPolicy,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly repo: CredentialRepository,
    @Inject('MULTI_FILE_LOGGER') private readonly logger: MultiFileLogger,
  ) {}

  async register(
    email: string,
    password: string,
  ): Promise<{ message: string }> {
    const policyResult = this.policy.evaluate(password);
    if (!policyResult.valid) {
      throw new BadRequestException({ errors: policyResult.errors });
    }

    // Ensure client exists first (required by foreign key constraint)
    await this.repo.ensureClientExists(email);

    const hash = await this.password.hash(password);
    await this.repo.upsert(email, hash, this.CURRENT_PARAMS_VERSION);

    this.logger.logFromSource('auth', 'log', 'credential_created', 'register', {
      email: this.redactEmail(email),
    });
    return { message: 'Credential created successfully' };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ message: string; verified: boolean; retryAfterMs?: number }> {
    const rateCheck = this.rateLimiter.check(email);
    if (!rateCheck.allowed) {
      this.logger.logFromSource('auth', 'warn', 'rate_limited', 'login', {
        email: this.redactEmail(email),
      });
      throw new HttpException(
        { message: 'Too many attempts', retryAfterMs: rateCheck.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const record = await this.repo.findByEmail(email);

    if (!record) {
      // Constant-time dummy verification to prevent user enumeration
      await this.password.verify(password, this.DUMMY_HASH);
      this.rateLimiter.recordFailure(email);
      this.logger.logFromSource('auth', 'warn', 'login_failed', 'login', {
        email: this.redactEmail(email),
      });
      return { message: 'Invalid credentials', verified: false };
    }

    const verified = await this.password.verify(password, record.password_hash);

    if (verified) {
      this.rateLimiter.recordSuccess(email);

      if (this.password.needsRehash(record.password_hash)) {
        const newHash = await this.password.hash(password);
        await this.repo.updateHash(email, newHash, this.CURRENT_PARAMS_VERSION);
        this.logger.logFromSource('auth', 'log', 'password_rehashed', 'login', {
          email: this.redactEmail(email),
        });
      }

      this.logger.logFromSource('auth', 'log', 'login_success', 'login', {
        email: this.redactEmail(email),
      });
      return { message: 'Login successful', verified: true };
    }

    this.rateLimiter.recordFailure(email);
    this.logger.logFromSource('auth', 'warn', 'login_failed', 'login', {
      email: this.redactEmail(email),
    });
    return { message: 'Invalid credentials', verified: false };
  }

  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local[0]}***@${domain}`;
  }
}
