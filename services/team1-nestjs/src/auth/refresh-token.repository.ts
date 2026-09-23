import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface StoreRefreshTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

const TOKEN_COLUMNS = `id, user_id, token_hash, expires_at, revoked_at, created_at`;

function mapRow(row: any): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly pool: Pool) {}

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const r = await this.pool.query<Record<string, any>>(
      `SELECT ${TOKEN_COLUMNS} FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async store(input: StoreRefreshTokenInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, now())`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}
