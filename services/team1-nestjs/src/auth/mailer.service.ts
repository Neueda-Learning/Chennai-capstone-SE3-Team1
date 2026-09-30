import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    this.logger.log(`[otp.outbox] verify email=${email} code=${code}`);
  }

  async sendPasswordResetEmail(email: string, code: string): Promise<void> {
    this.logger.log(`[otp.outbox] reset email=${email} code=${code}`);
  }
}
