import { Injectable, Logger } from '@nestjs/common';
import { OtpPurpose } from './otp.repository';

/** Codes are not emailed; they are written to the service log for the user to read. */
@Injectable()
export class OtpOutboxService {
  private readonly logger = new Logger(OtpOutboxService.name);

  async deliver(email: string, purpose: OtpPurpose, code: string): Promise<void> {
    this.logger.log(`[otp.outbox] ${purpose} email=${email} code=${code}`);
  }
}
