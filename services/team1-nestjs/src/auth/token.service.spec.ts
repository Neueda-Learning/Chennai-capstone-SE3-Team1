import { ConfigService } from '@nestjs/config';
import { TokenService, AccessTokenClaims } from './token.service';
import { AuthServiceException } from './auth-errors';
import { ACCESS_TOKEN_TTL_SECONDS } from './token.constants';

const SECRET = 'test-secret-that-is-at-least-32-characters-long!';
const ISSUER = 'auth-service';

function makeTokenService(): TokenService {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'app.jwt.secret') return SECRET;
      if (key === 'app.jwt.issuer') return ISSUER;
      return undefined;
    }),
  } as unknown as ConfigService;
  return new TokenService(config);
}

function splitToken(token: string): {
  header: string;
  payload: string;
} {
  const parts = token.split('.');
  return { header: parts[0], payload: parts[1] };
}

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    service = makeTokenService();
  });

  describe('signAccessToken', () => {
    it('produces exactly the claim set: sub, accountId, roles, iat, exp, iss', () => {
      const before = Math.floor(Date.now() / 1000);
      const token = service.signAccessToken({
        sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
        accountId: 1,
        roles: ['CUSTOMER'],
      });
      const after = Math.floor(Date.now() / 1000);

      const { payload } = splitToken(token);
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as AccessTokenClaims;

      expect(Object.keys(decoded).sort()).toEqual([
        'accountId',
        'exp',
        'iat',
        'iss',
        'roles',
        'sub',
      ]);
      expect(decoded.sub).toBe('8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f');
      expect(decoded.accountId).toBe(1);
      expect(decoded.roles).toEqual(['CUSTOMER']);
      expect(decoded.iss).toBe('auth-service');
      expect(decoded.iat).toBeGreaterThanOrEqual(before);
      expect(decoded.iat).toBeLessThanOrEqual(after);
      expect(decoded.exp - decoded.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('uses HS256 with typ JWT header', () => {
      const token = service.signAccessToken({
        sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
        accountId: 5,
        roles: ['ADMIN'],
      });
      const { header } = splitToken(token);
      const decodedHeader = JSON.parse(
        Buffer.from(header, 'base64url').toString('utf8'),
      );
      expect(decodedHeader.alg).toBe('HS256');
      expect(decodedHeader.typ).toBe('JWT');
    });
  });

  describe('verifyAccessToken', () => {
    it('accepts a validly-signed token and returns the exact claims', () => {
      const token = service.signAccessToken({
        sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
        accountId: 2,
        roles: ['CUSTOMER', 'ADMIN'],
      });
      const claims = service.verifyAccessToken(token);
      expect(claims.sub).toBe('8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f');
      expect(claims.accountId).toBe(2);
      expect(claims.roles).toEqual(['CUSTOMER', 'ADMIN']);
      expect(claims.iss).toBe('auth-service');
      expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('round-trips a null accountId for a user with no linked bank account', () => {
      const token = service.signAccessToken({
        sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
        accountId: null,
        roles: ['CUSTOMER'],
      });
      const { payload } = splitToken(token);
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      // Present and null, not absent: the claim set stays exact.
      expect(decoded).toHaveProperty('accountId', null);
      expect(service.verifyAccessToken(token).accountId).toBeNull();
    });

    it('rejects a token with no accountId claim at all', () => {
      const jsonwebtoken = jest.requireActual('jsonwebtoken');
      const noAccount = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          roles: ['CUSTOMER'],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
          iss: ISSUER,
        },
        SECRET,
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyAccessToken(noAccount)).toThrow(
        AuthServiceException,
      );
    });

    it('rejects an expired token with AUTH-401', () => {
      // Sign with an explicit past expiry using the same library/secret.
      const jsonwebtoken = jest.requireActual('jsonwebtoken');
      const expiredToken = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          accountId: 1,
          roles: ['CUSTOMER'],
          iat: Math.floor(Date.now() / 1000) - ACCESS_TOKEN_TTL_SECONDS * 2,
          exp: Math.floor(Date.now() / 1000) - ACCESS_TOKEN_TTL_SECONDS,
          iss: ISSUER,
        },
        SECRET,
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyAccessToken(expiredToken)).toThrow(
        AuthServiceException,
      );
    });

    it('rejects a token signed with a different key', () => {
      const jsonwebtoken = jest.requireActual('jsonwebtoken');
      const forgedToken = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          accountId: 1,
          roles: ['ADMIN'],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
          iss: ISSUER,
        },
        'a-different-secret-that-we-do-not-control-at-all-123',
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyAccessToken(forgedToken)).toThrow(
        AuthServiceException,
      );
    });

    it('rejects a token from a different issuer', () => {
      const jsonwebtoken = jest.requireActual('jsonwebtoken');
      const wrongIssuer = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          accountId: 1,
          roles: ['CUSTOMER'],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
          iss: 'evil-service',
        },
        SECRET,
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyAccessToken(wrongIssuer)).toThrow(
        AuthServiceException,
      );
    });

    it('rejects a token missing required claims', () => {
      const jsonwebtoken = jest.requireActual('jsonwebtoken');
      const incomplete = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
          iss: ISSUER,
        },
        SECRET,
        { algorithm: 'HS256' },
      );

      expect(() => service.verifyAccessToken(incomplete)).toThrow(
        AuthServiceException,
      );
    });
  });

  describe('refresh tokens', () => {
    it('generates opaque refresh tokens', () => {
      const a = service.generateRefreshToken();
      const b = service.generateRefreshToken();
      expect(a).not.toBe(b);
      expect(a).toBeTruthy();
      // base64url, no padding
      expect(a).not.toContain('+');
      expect(a).not.toContain('/');
      expect(a).not.toContain('=');
    });

    it('hashes the same token to the same 64-char hex digest', () => {
      const token = 'some-opaque-refresh-token-value';
      const h1 = service.hashRefreshToken(token);
      const h2 = service.hashRefreshToken(token);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
