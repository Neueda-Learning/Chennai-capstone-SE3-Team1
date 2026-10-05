import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthServiceException } from './auth-errors';
import { Role } from './dto/role';

export type UserStatus = 'PENDING' | 'ACTIVE';

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  phone: string | null;
  accountId: number | null;
  roles: Role[];
  passwordHash: string;
  paramsVersion: number;
  version: number;
  createdOn: Date;
  status: UserStatus;
}

export interface NewUserInput {
  username: string;
  email: string;
  roles: Role[];
  passwordHash: string;
  paramsVersion: number;
  status: UserStatus;
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`username already taken: ${username}`);
    this.name = 'DuplicateUsernameError';
  }
}

const USER_COLUMNS = `id, username, email, phone, account_id, roles, password_hash, params_version, version, created_on, status`;

function mapRow(row: any): UserRecord {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    accountId: row.account_id === null ? null : Number(row.account_id),
    roles: row.roles,
    passwordHash: row.password_hash,
    paramsVersion: row.params_version,
    version: row.version,
    createdOn: row.created_on,
    status: row.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
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

  async findByEmail(email: string): Promise<UserRecord | null> {
    const r = await this.pool.query<Record<string, any>>(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
      [email],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async create(input: NewUserInput): Promise<UserRecord> {
    const r = await this.pool.query<Record<string, any>>(
      `INSERT INTO users (username, email, roles, password_hash, params_version, status, version, created_on, updated)
       VALUES ($1, $2, $3, $4, $5, $6, 1, now(), now())
       RETURNING ${USER_COLUMNS}`,
      [
        input.username,
        input.email,
        input.roles,
        input.passwordHash,
        input.paramsVersion,
        input.status,
      ],
    );
    return mapRow(r.rows[0]);
  }

  async setStatus(id: string, status: UserStatus): Promise<void> {
    await this.pool.query(
      `UPDATE users SET status = $1, version = version + 1, updated = now() WHERE id = $2`,
      [status, id],
    );
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

  static violatedConstraint(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null
      ? (error as { constraint?: string }).constraint
      : undefined;
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
