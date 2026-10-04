import { RefreshTokenRepository } from './refresh-token.repository';

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: jest.fn() })),
}));

import { Pool } from 'pg';

describe('RefreshTokenRepository', () => {
  let repo: RefreshTokenRepository;
  let pool: { query: jest.Mock };

  const row = {
    id: 'rt-1',
    user_id: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
    token_hash: 'a'.repeat(64),
    expires_at: new Date('2026-10-12T08:00:00Z'),
    revoked_at: null,
    created_at: new Date('2026-10-05T08:00:00Z'),
  };

  beforeEach(() => {
    pool = { query: jest.fn() };
    repo = new RefreshTokenRepository(pool as unknown as Pool);
  });

  describe('findByHash', () => {
    it('maps a row to a RefreshTokenRecord', async () => {
      pool.query.mockResolvedValue({ rows: [row] });
      const result = await repo.findByHash('a'.repeat(64));
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM refresh_tokens WHERE token_hash = $1'),
        ['a'.repeat(64)],
      );
      expect(result).toEqual({
        id: 'rt-1',
        userId: row.user_id,
        tokenHash: row.token_hash,
        expiresAt: row.expires_at,
        revokedAt: null,
        createdAt: row.created_at,
      });
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      expect(await repo.findByHash('missing')).toBeNull();
    });
  });

  describe('store', () => {
    it('inserts a refresh token row', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await repo.store({
        userId: row.user_id,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-10-12T08:00:00Z'),
      });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        [row.user_id, 'a'.repeat(64), expect.any(Date)],
      );
    });
  });

  describe('revoke', () => {
    it('stamps revoked_at only when not already revoked', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await repo.revoke('rt-1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND revoked_at IS NULL'),
        ['rt-1'],
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active token for the user', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await repo.revokeAllForUser(row.user_id);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND revoked_at IS NULL'),
        [row.user_id],
      );
    });
  });
});
