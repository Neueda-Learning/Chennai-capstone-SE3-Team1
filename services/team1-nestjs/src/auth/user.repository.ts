import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthServiceException } from './auth-errors';
import { Role } from './dto/role';

export interface UserRecord {
  id: string;
  username: string;
  accountId: number;
  roles: Role[];
  passwordHash: string;
  paramsVersion: number;
  version: number;
  createdOn: Date;
}

export interface NewUserInput {
  username: string;
  accountId: number;
  roles: Role[];
  passwordHash: string;
  paramsVersion: number;
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`username already taken: ${username}`);
    this.name = 'DuplicateUsernameError';
  }
}

const USER_COLUMNS = `id, username, account_id, roles, password_hash, params_version, version, created_on`;

function mapRow(row: any): UserRecord {
  return {
    id: row.id,
    username: row.username,
    accountId: Number(row.account_id),
    roles: row.roles,
    passwordHash: row.password_hash,
    paramsVersion: row.params_version,
    version: row.version,
    createdOn: row.created_on,
  };
}

@Injectable()
export class UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    const r = await this.pool.query<Record<string, any>>(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
      [username],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const r = await this.pool.query<Record<string, any>>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async accountExists(accountId: number): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM clients WHERE client_id = $1`,
      [accountId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async findByAccountId(accountId: number): Promise<UserRecord | null> {
    const r = await this.pool.query<Record<string, any>>(
      `SELECT ${USER_COLUMNS} FROM users WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async create(input: NewUserInput): Promise<UserRecord> {
    const r = await this.pool.query<Record<string, any>>(
      `INSERT INTO users (username, account_id, roles, password_hash, params_version, version, created_on, updated)
       VALUES ($1, $2, $3, $4, $5, 1, now(), now())
       RETURNING ${USER_COLUMNS}`,
      [
        input.username,
        input.accountId,
        input.roles,
        input.passwordHash,
        input.paramsVersion,
      ],
    );
    return mapRow(r.rows[0]);
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
    paramsVersion: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE users
       SET password_hash = $1, params_version = $2, version = version + 1, updated = now()
       WHERE id = $3`,
      [passwordHash, paramsVersion, id],
    );
  }

  static isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505'
    );
  }
}

export function usernameTaken(): AuthServiceException {
  return AuthServiceException.usernameTaken();
}
