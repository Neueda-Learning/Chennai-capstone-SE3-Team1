import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export const OTP_PURPOSES = ['REGISTER', 'RESET'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export interface OtpCodeRecord {
  id: string;
  email: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

function mapRow(row: Record<string, unknown>): OtpCodeRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    purpose: row.purpose as OtpPurpose,
    codeHash: String(row.code_hash),
    expiresAt: row.expires_at as Date,
    consumedAt: (row.consumed_at as Date | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class OtpRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    email: string;
    purpose: OtpPurpose;
    codeHash: string;
    expiresAt: Date;
  }): Promise<OtpCodeRecord> {
    const result = await this.pool.query(
      `INSERT INTO otp_codes (email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, purpose, code_hash, expires_at, consumed_at, attempts, created_at`,
      [input.email, input.purpose, input.codeHash, input.expiresAt],
    );
    return mapRow(result.rows[0]);
  }

  /**
   * The newest code for an email+purpose that is neither consumed nor expired.
   * Expiry is asked of the database clock rather than the Node clock so a code
   * cannot be stretched by a skewed application host.
   */
  async findActive(
    email: string,
    purpose: OtpPurpose,
  ): Promise<OtpCodeRecord | null> {
    const result = await this.pool.query(
      `SELECT id, email, purpose, code_hash, expires_at, consumed_at, attempts, created_at
         FROM otp_codes
        WHERE email = $1
          AND purpose = $2
          AND consumed_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [email, purpose],
    );
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
  }

  async markConsumed(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
      [id],
    );
  }

  async setAttempts(id: string, attempts: number): Promise<void> {
    await this.pool.query(`UPDATE otp_codes SET attempts = $1 WHERE id = $2`, [
      attempts,
      id,
    ]);
  }

  /**
   * Burns every code still waiting for an email+purpose. Issuing a replacement
   * must invalidate the previous one, otherwise an old email keeps working after
   * the user asked for a new code.
   */
  async consumeAllActive(email: string, purpose: OtpPurpose): Promise<void> {
    await this.pool.query(
      `UPDATE otp_codes
          SET consumed_at = now()
        WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [email, purpose],
    );
  }
}
