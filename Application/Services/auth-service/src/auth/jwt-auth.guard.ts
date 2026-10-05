import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { TokenService, AccessTokenClaims } from './token.service';
import { AuthServiceException } from './auth-errors';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AccessTokenClaims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<
        AuthenticatedRequest & { headers: { authorization?: string } }
      >();

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AuthServiceException.unauthorised();
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw AuthServiceException.unauthorised();
    }

    try {
      const claims = this.tokens.verifyAccessToken(token);
      request.user = claims;
      return true;
    } catch {
      throw AuthServiceException.unauthorised();
    }
  }
}
