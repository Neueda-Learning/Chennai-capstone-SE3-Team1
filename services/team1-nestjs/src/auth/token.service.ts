import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign, verify, JwtPayload } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { AuthServiceException } from './auth-errors';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_ISSUER,
  REFRESH_TOKEN_TTL_SECONDS,
} from './token.constants';

export interface AccessTokenClaims {
  sub: string;
  accountId: number;
  roles: string[];
  iat: number;
  exp: number;
  iss: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly issuer: string;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('app.jwt.secret') ?? '';
    this.issuer = configService.get<string>('app.jwt.issuer') ?? DEFAULT_ISSUER;
  }

  /**
   * Signs an exact-claim-set access token: sub, accountId, roles, iat, exp, iss.
   * No `expiresIn` option is passed so `jsonwebtoken` cannot add extra claims;
   * iat/exp are set explicitly, exp == iat + 900.
   */
  signAccessToken(claims: {
    sub: string;
    accountId: number;
    roles: string[];
  }): string {
    const iat = Math.floor(Date.now() / 1000);
    const payload: AccessTokenClaims = {
      sub: claims.sub,
      accountId: claims.accountId,
      roles: claims.roles,
      iat,
      exp: iat + ACCESS_TOKEN_TTL_SECONDS,
      iss: this.issuer,
    };
    return sign(payload, this.secret, {
      algorithm: 'HS256',
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const decoded = verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
      }) as JwtPayload;
      return this.assertClaims(decoded);
    } catch {
      throw AuthServiceException.unauthorised();
    }
  }

  private assertClaims(decoded: Partial<AccessTokenClaims>): AccessTokenClaims {
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.accountId !== 'number' ||
      !Array.isArray(decoded.roles) ||
      decoded.roles.length === 0 ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number' ||
      typeof decoded.iss !== 'string'
    ) {
      throw AuthServiceException.unauthorised();
    }
    return {
      sub: decoded.sub,
      accountId: decoded.accountId,
      roles: decoded.roles,
      iat: decoded.iat,
      exp: decoded.exp,
      iss: decoded.iss,
    };
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  createTokenPair(claims: {
    sub: string;
    accountId: number;
    roles: string[];
  }): TokenPair {
    return {
      accessToken: this.signAccessToken(claims),
      refreshToken: this.generateRefreshToken(),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  refreshTokenExpiry(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }
}
