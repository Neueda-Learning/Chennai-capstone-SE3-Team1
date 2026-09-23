import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';
import { AuthServiceException } from './auth-errors';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let tokens: { verifyAccessToken: jest.Mock };

  const validClaims = {
    sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
    accountId: 1,
    roles: ['CUSTOMER'],
    iat: 1790000000,
    exp: 1790000900,
    iss: 'auth-service',
  };

  function makeContext(authorization?: string): ExecutionContext {
    const request: Record<string, any> = {};
    if (authorization !== undefined) {
      request.headers = { authorization };
    } else {
      request.headers = {};
    }
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    tokens = { verifyAccessToken: jest.fn() };
    guard = new JwtAuthGuard({
      verifyAccessToken: tokens.verifyAccessToken,
    } as unknown as TokenService);
  });

  it('attaches the verified claims to the request and allows access', () => {
    tokens.verifyAccessToken.mockReturnValue(validClaims);
    const ctx = makeContext('Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature');
    const request = ctx.switchToHttp().getRequest();
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.user).toEqual(validClaims);
  });

  it('rejects a missing Authorization header with AUTH-401', () => {
    const ctx = makeContext();
    expect(() => guard.canActivate(ctx)).toThrow(AuthServiceException);
  });

  it('rejects a malformed scheme with AUTH-401', () => {
    const ctx = makeContext('Basic dXNlcjpwYXNz');
    expect(() => guard.canActivate(ctx)).toThrow(AuthServiceException);
  });

  it('rejects an empty token after the scheme', () => {
    const ctx = makeContext('Bearer   ');
    expect(() => guard.canActivate(ctx)).toThrow(AuthServiceException);
  });

  it('rejects an expired token with AUTH-401', () => {
    tokens.verifyAccessToken.mockImplementation(() => {
      throw AuthServiceException.unauthorised();
    });
    const ctx = makeContext('Bearer expired.token.here');
    expect(() => guard.canActivate(ctx)).toThrow(AuthServiceException);
    expect(tokens.verifyAccessToken).toHaveBeenCalledWith('expired.token.here');
  });

  it('rejects a wrongly-signed token with AUTH-401 (identity taken from verified token only)', () => {
    tokens.verifyAccessToken.mockImplementation(() => {
      throw AuthServiceException.unauthorised();
    });
    const ctx = makeContext('Bearer forged.token.here');
    const request = ctx.switchToHttp().getRequest();
    expect(() => guard.canActivate(ctx)).toThrow(AuthServiceException);
    // Never trust an unverified payload: no user is ever attached on failure.
    expect(request.user).toBeUndefined();
  });
});
