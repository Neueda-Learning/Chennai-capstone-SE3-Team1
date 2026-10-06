import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import {
  CredentialCryptoService,
  UnwrappedRequest,
} from './credential-crypto.service';

export type EncryptedRequest = Request & {
  credentialCrypto?: Pick<UnwrappedRequest, 'key' | 'nonce'>;
};

/**
 * Every POST under /auth must carry an encrypted envelope. The envelope is opened here, before
 * validation and before the request logger, so nothing downstream ever sees or records the
 * ciphertext's plain content, and a plaintext body is refused rather than quietly accepted.
 */
@Injectable()
export class CredentialCryptoMiddleware implements NestMiddleware {
  constructor(private readonly crypto: CredentialCryptoService) {}

  use(req: EncryptedRequest, _res: Response, next: NextFunction): void {
    try {
      const { body, key, nonce } = this.crypto.unwrapRequest(req.body);
      req.body = body;
      req.credentialCrypto = { key, nonce };
      next();
    } catch (error) {
      next(error);
    }
  }
}
