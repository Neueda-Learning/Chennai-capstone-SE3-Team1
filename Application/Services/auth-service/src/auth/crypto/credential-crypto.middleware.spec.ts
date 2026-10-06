import { of, lastValueFrom } from 'rxjs';
import { CredentialCryptoInterceptor } from './credential-crypto.interceptor';
import {
  CredentialCryptoMiddleware,
  EncryptedRequest,
} from './credential-crypto.middleware';
import { CredentialCryptoService } from './credential-crypto.service';

describe('CredentialCryptoMiddleware', () => {
  it('replaces the body with the decrypted one and remembers the key for the reply', () => {
    const key = Buffer.alloc(32, 1);
    const svc = {
      unwrapRequest: jest
        .fn()
        .mockReturnValue({ body: { u: 1 }, key, nonce: 'n' }),
    };
    const req = { body: { v: 1 } } as unknown as EncryptedRequest;
    const next = jest.fn();

    new CredentialCryptoMiddleware(
      svc as unknown as CredentialCryptoService,
    ).use(req, {} as never, next);

    expect(svc.unwrapRequest).toHaveBeenCalledWith({ v: 1 });
    expect(req.body).toEqual({ u: 1 });
    expect(req.credentialCrypto).toEqual({ key, nonce: 'n' });
    expect(next).toHaveBeenCalledWith();
  });

  it('passes a refusal on to the exception filter and leaves the body untouched', () => {
    const boom = new Error('refused');
    const svc = {
      unwrapRequest: jest.fn(() => {
        throw boom;
      }),
    };
    const req = {
      body: { username: 'x', password: 'y' },
    } as unknown as EncryptedRequest;
    const next = jest.fn();

    new CredentialCryptoMiddleware(
      svc as unknown as CredentialCryptoService,
    ).use(req, {} as never, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(req.credentialCrypto).toBeUndefined();
  });
});

describe('CredentialCryptoInterceptor', () => {
  const context = (req: Partial<EncryptedRequest>) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

  it('encrypts the response of an encrypted request', async () => {
    const svc = {
      wrapResponse: jest.fn().mockReturnValue({ v: 1, iv: 'i', ct: 'c' }),
    };
    const session = { key: Buffer.alloc(32), nonce: 'n' };
    const result = await lastValueFrom(
      new CredentialCryptoInterceptor(
        svc as unknown as CredentialCryptoService,
      ).intercept(context({ credentialCrypto: session }), {
        handle: () => of({ accessToken: 't' }),
      }),
    );

    expect(svc.wrapResponse).toHaveBeenCalledWith(session, {
      accessToken: 't',
    });
    expect(result).toEqual({ v: 1, iv: 'i', ct: 'c' });
  });

  it('leaves other responses alone (GETs such as /auth/me, /auth/crypto-params)', async () => {
    const svc = { wrapResponse: jest.fn() };
    const result = await lastValueFrom(
      new CredentialCryptoInterceptor(
        svc as unknown as CredentialCryptoService,
      ).intercept(context({}), { handle: () => of({ plain: true }) }),
    );

    expect(result).toEqual({ plain: true });
    expect(svc.wrapResponse).not.toHaveBeenCalled();
  });
});
