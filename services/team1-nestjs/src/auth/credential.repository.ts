import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export interface CredentialRow {
  email: string;
  password_hash: string;
  version: number;
  params_version: number;
}

@Injectable()
export class CredentialRepository {
  constructor(private pool: Pool) {}

  async findByEmail(email: string): Promise<CredentialRow | null> {
    const r = await this.pool.query<CredentialRow>(
      `SELECT email, password_hash, version, params_version FROM auth WHERE email = $1`,
      [email],
    );
    return r.rows[0] ?? null;
  }

  async ensureClientExists(email: string): Promise<void> {
    // Check if client already exists
    const existingClient = await this.pool.query(
      `SELECT client_id FROM clients WHERE email = $1`,
      [email],
    );

    if (existingClient.rows.length > 0) {
      return; // Client already exists
    }

    // Create client with email as name
    const name = email.split('@')[0]; // Use email prefix as default name
    await this.pool.query(
      `INSERT INTO clients (name, email, account_state, wallet_balance)
       VALUES ($1, $2, 'ACTIVE', 0)`,
      [name, email],
    );
  }

  async upsert(
    email: string,
    hash: string,
    paramsVersion: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth (email, password_hash, params_version, version, updated)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         params_version = EXCLUDED.params_version,
         version = auth.version + 1,
         updated = now()`,
      [email, hash, paramsVersion],
    );
  }

  async updateHash(
    email: string,
    hash: string,
    paramsVersion: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE auth SET password_hash = $1, params_version = $2, version = version + 1, rotated_at = now(), updated = now()
       WHERE email = $3`,
      [hash, paramsVersion, email],
    );
  }
}
