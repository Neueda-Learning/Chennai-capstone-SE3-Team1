import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CredentialCryptoService } from './credential-crypto.service';
import { EncryptedRequest } from './credential-crypto.middleware';

/**
 * Answers an encrypted request with an encrypted response (token pairs and user records would
 * otherwise cross the wire in the clear). Error bodies stay plain: they carry a code and a fixed
 * message, nothing secret.
 */
@Injectable()
export class CredentialCryptoInterceptor implements NestInterceptor {
  constructor(private readonly crypto: CredentialCryptoService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<EncryptedRequest>();
    const session = request.credentialCrypto;
    if (!session) {
      return next.handle();
    }
    return next
      .handle()
      .pipe(map((body) => this.crypto.wrapResponse(session, body)));
  }
}
