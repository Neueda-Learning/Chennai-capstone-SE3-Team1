import { UserRepository } from './user.repository';

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: jest.fn() })),
}));

import { Pool } from 'pg';
import { Role } from './dto/role';

describe('UserRepository', () => {
  let repo: UserRepository;
  let pool: { query: jest.Mock };

  const row = {
    id: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
    username: 'priya.menon',
    account_id: 1,
    roles: ['CUSTOMER', 'ADMIN'],
    password_hash: 'argon2hash',
    params_version: 1,
    version: 1,
    created_on: new Date('2026-10-05T08:00:00Z'),
  };

  beforeEach(() => {
    pool = { query: jest.fn() };
    repo = new UserRepository(pool as unknown as Pool);
  });

  describe('findByUsername', () => {
    it('maps a row to a UserRecord', async () => {
      pool.query.mockResolvedValue({ rows: [row] });
      const result = await repo.findByUsername('priya.menon');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM users WHERE username = $1'),
        ['priya.menon'],
      );
      expect(result).toEqual({
        id: row.id,
        username: 'priya.menon',
        accountId: 1,
        roles: ['CUSTOMER', 'ADMIN'],
        passwordHash: 'argon2hash',
        paramsVersion: 1,
        version: 1,
        createdOn: row.created_on,
      });
    });

    it('returns null when no user exists', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      expect(await repo.findByUsername('ghost.user')).toBeNull();
    });
  });

  describe('findById', () => {
    it('queries by id and maps the row', async () => {
      pool.query.mockResolvedValue({ rows: [row] });
      const result = await repo.findById(row.id);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        [row.id],
      );
      expect(result?.id).toBe(row.id);
    });
  });

  describe('accountExists', () => {
    it('returns true when the clients row exists', async () => {
      pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
      expect(await repo.accountExists(1)).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM clients WHERE client_id = $1'),
        [1],
      );
    });

    it('returns false when the account does not exist', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      expect(await repo.accountExists(404)).toBe(false);
    });
  });

  describe('create', () => {
    it('inserts and maps the returning row', async () => {
      pool.query.mockResolvedValue({ rows: [row] });
      const result = await repo.create({
        username: 'priya.menon',
        accountId: 1,
        roles: [Role.CUSTOMER],
        passwordHash: 'argon2hash',
        paramsVersion: 1,
      });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([
          'priya.menon',
          1,
          [Role.CUSTOMER],
          'argon2hash',
          1,
        ]),
      );
      expect(result.accountId).toBe(1);
    });
  });

  describe('updatePasswordHash', () => {
    it('increments version and stamps updated', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await repo.updatePasswordHash(row.id, 'newhash', 2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('version = version + 1'),
        ['newhash', 2, row.id],
      );
    });
  });

  describe('isUniqueViolation', () => {
    it('is true for pg code 23505', () => {
      expect(UserRepository.isUniqueViolation({ code: '23505' })).toBe(true);
    });

    it('is false for other errors or non-objects', () => {
      expect(UserRepository.isUniqueViolation({ code: '42P01' })).toBe(false);
      expect(UserRepository.isUniqueViolation(null)).toBe(false);
      expect(UserRepository.isUniqueViolation(new Error('nope'))).toBe(false);
    });
  });
});
