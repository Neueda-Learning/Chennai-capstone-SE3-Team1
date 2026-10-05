import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  pass: string;
  from: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly smtp: SmtpConfig;
  private readonly transporter: Transporter | null;

  constructor(private readonly configService: ConfigService) {
    this.smtp =
      this.configService.get<SmtpConfig>('app.smtp') ??
      ({ enabled: false } as SmtpConfig);

    this.transporter = this.smtp.enabled
      ? nodemailer.createTransport({
          host: this.smtp.host,
          port: this.smtp.port,
          secure: this.smtp.secure,
          requireTLS: this.smtp.requireTls,
          auth: {
            user: this.smtp.user,
            pass: this.smtp.pass,
          },
          connectionTimeout: 10_000,
          socketTimeout: 10_000,
        })
      : null;
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify your account',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: this.htmlTemplate(
        'Verify your account',
        code,
        'Use this one-time code to activate your account. It expires in 10 minutes.',
      ),
      purpose: 'verify',
      code,
    });
  }

  async sendPasswordResetEmail(email: string, code: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Reset your password',
      text: `Your password reset code is ${code}. It expires in 10 minutes.`,
      html: this.htmlTemplate(
        'Reset your password',
        code,
        'Use this one-time code to reset your password. It expires in 10 minutes.',
      ),
      purpose: 'reset',
      code,
    });
  }

  private async sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    purpose: 'verify' | 'reset';
    code: string;
  }): Promise<void> {
    if (this.transporter === null) {
      this.logger.warn(
        'SMTP is disabled; logging OTP to outbox fallback. Configure SMTP_* env vars for real delivery.',
      );
      this.logger.log(
        `[otp.outbox] ${input.purpose} email=${input.to} code=${input.code}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.smtp.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    this.logger.log(`[otp.smtp] sent ${input.purpose} email to ${input.to}`);
  }

  private htmlTemplate(title: string, code: string, body: string): string {
    return `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111">
  <h2 style="margin:0 0 12px">${title}</h2>
  <p style="margin:0 0 12px">${body}</p>
  <p style="margin:0 0 6px">Your code:</p>
  <p style="font-size:28px;letter-spacing:4px;font-weight:700;margin:0 0 16px">${code}</p>
  <p style="margin:0;color:#555">If you did not request this, you can ignore this email.</p>
</div>`;
  }
}
