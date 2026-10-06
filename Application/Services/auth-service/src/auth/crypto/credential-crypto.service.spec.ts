import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'crypto';
import {
  CredentialCryptoService,
  CryptoParams,
  MAX_OUTSTANDING_NONCES,
  NONCE_TTL_MS,
  RequestEnvelope,
} from './credential-crypto.service';

function service(pem = ''): CredentialCryptoService {
  const config = {
    get: (k: string) =>
      k === 'app.credentialCrypto.privateKeyPem' ? pem : undefined,
  };
  return new CredentialCryptoService(config as unknown as ConfigService);
}

/** What the browser does, written independently of the service's own code. */
function clientEncrypt(
  params: CryptoParams,
  body: unknown,
  key = randomBytes(32),
  wrappedKey = key,
): { envelope: RequestEnvelope; key: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(params.nonce));
  const sealed = Buffer.concat([
    cipher.update(JSON.stringify(body)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const ek = publicEncrypt(
    {
      key: createPublicKey(params.publicKey),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedKey,
  );
  return {
    envelope: {
      v: 1,
      nonce: params.nonce,
      ek: ek.toString('base64'),
      iv: iv.toString('base64'),
      ct: sealed.toString('base64'),
    },
    key,
  };
}

describe('CredentialCryptoService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('says so when it has to make up its own key', () => {
    service();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AUTH_PRIVATE_KEY'),
    );
  });

  it('opens an envelope a client built from the published params', () => {
    const svc = service();
    const { envelope } = clientEncrypt(svc.issueParams(), {
      username: 'priya',
      password: 'S3cret!pass',
    });
    expect(svc.unwrapRequest(envelope).body).toEqual({
      username: 'priya',
      password: 'S3cret!pass',
    });
  });

  it('keeps non-ASCII text intact', () => {
    const svc = service();
    const { envelope } = clientEncrypt(svc.issueParams(), {
      password: 'pässwörd-密码-🔑',
    });
    expect(svc.unwrapRequest(envelope).body).toEqual({
      password: 'pässwörd-密码-🔑',
    });
  });

  it('uses the key from the vault when there is one, so the public key is stable across instances', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const a = service(pem).issueParams();
    const b = service(pem).issueParams();
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.keyId).toBe(b.keyId);
    expect(service().issueParams().publicKey).not.toBe(a.publicKey);
  });

  it('publishes the same key as PEM and as modulus and exponent', () => {
    const params = service().issueParams();
    const jwk = createPublicKey(params.publicKey).export({ format: 'jwk' });
    expect(params.modulus).toBe(
      Buffer.from(jwk.n as string, 'base64url').toString('hex'),
    );
    expect(parseInt(params.exponent, 16)).toBe(65537);
  });

  it('never publishes private key material', () => {
    const params = service().issueParams();
    expect(JSON.stringify(params)).not.toContain('PRIVATE');
    expect(params.publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('accepts a nonce once: a captured request cannot be replayed', () => {
    const svc = service();
    const { envelope } = clientEncrypt(svc.issueParams(), { a: 1 });
    expect(svc.unwrapRequest(envelope).body).toEqual({ a: 1 });
    expect(() => svc.unwrapRequest(envelope)).toThrow();
  });

  it('rejects a nonce this service never issued', () => {
    const svc = service();
    const params = svc.issueParams();
    const { envelope } = clientEncrypt(
      { ...params, nonce: 'made-up-by-the-client' },
      { a: 1 },
    );
    expect(() => svc.unwrapRequest(envelope)).toThrow();
  });

  it('rejects a nonce after its lifetime', () => {
    jest.useFakeTimers();
    const svc = service();
    const { envelope } = clientEncrypt(svc.issueParams(), { a: 1 });
    jest.advanceTimersByTime(NONCE_TTL_MS + 1);
    expect(() => svc.unwrapRequest(envelope)).toThrow();
  });

  it('burns the nonce even when decryption fails, so a bad attempt cannot be retried', () => {
    const svc = service();
    const { envelope } = clientEncrypt(svc.issueParams(), { a: 1 });
    const tampered = {
      ...envelope,
      ct: Buffer.from('x'.repeat(40)).toString('base64'),
    };
    expect(() => svc.unwrapRequest(tampered)).toThrow();
    expect(() => svc.unwrapRequest(envelope)).toThrow();
  });

  it('rejects ciphertext that was altered in transit (GCM tag)', () => {
    const svc = service();
    const { envelope } = clientEncrypt(svc.issueParams(), { password: 'x' });
    const bytes = Buffer.from(envelope.ct, 'base64');
    bytes[0] ^= 0x01;
    expect(() =>
      svc.unwrapRequest({ ...envelope, ct: bytes.toString('base64') }),
    ).toThrow();
  });

  it('rejects a ciphertext moved onto a different nonce', () => {
    const svc = service();
    const first = svc.issueParams();
    const second = svc.issueParams();
    const { envelope } = clientEncrypt(first, { a: 1 });
    expect(() =>
      svc.unwrapRequest({ ...envelope, nonce: second.nonce }),
    ).toThrow();
  });

  it('rejects a wrapped key of the wrong size', () => {
    const svc = service();
    const { envelope } = clientEncrypt(
      svc.issueParams(),
      { a: 1 },
      randomBytes(32),
      randomBytes(16),
    );
    expect(() => svc.unwrapRequest(envelope)).toThrow();
  });

  it.each([
    ['null', null],
    ['a plaintext login body', { username: 'priya', password: 'S3cret!pass' }],
    ['an unknown version', { v: 2, nonce: 'n', ek: 'a', iv: 'b', ct: 'c' }],
    ['a missing field', { v: 1, nonce: 'n', ek: 'a', iv: 'b' }],
    [
      'an over-long nonce',
      { v: 1, nonce: 'n'.repeat(65), ek: 'a', iv: 'b', ct: 'c' },
    ],
  ])('refuses %s with the same generic validation error', (_name, value) => {
    expect(() => service().unwrapRequest(value)).toThrow(
      expect.objectContaining({
        response: { errorCode: 'VAL-422', message: 'Invalid input' },
      }),
    );
  });

  it('encrypts a response that only the client holding the AES key can read', () => {
    const svc = service();
    const params = svc.issueParams();
    const { envelope, key } = clientEncrypt(params, { a: 1 });
    const opened = svc.unwrapRequest(envelope);
    const reply = svc.wrapResponse(opened, {
      accessToken: 'tok',
      refreshToken: 'ref',
    });

    expect(JSON.stringify(reply)).not.toContain('tok');
    const sealed = Buffer.from(reply.ct, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(reply.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(params.nonce));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - 16)),
      decipher.final(),
    ]);
    expect(JSON.parse(plain.toString())).toEqual({
      accessToken: 'tok',
      refreshToken: 'ref',
    });
  });

  it('uses a fresh IV for every response', () => {
    const svc = service();
    const opened = svc.unwrapRequest(
      clientEncrypt(svc.issueParams(), {}).envelope,
    );
    expect(svc.wrapResponse(opened, 1).iv).not.toBe(
      svc.wrapResponse(opened, 1).iv,
    );
  });

  it('bounds outstanding nonces, dropping the oldest', () => {
    const svc = service();
    const oldest = svc.issueParams();
    for (let i = 0; i < MAX_OUTSTANDING_NONCES; i += 1) {
      svc.issueParams();
    }
    const { envelope } = clientEncrypt(oldest, { a: 1 });
    expect(() => svc.unwrapRequest(envelope)).toThrow();
  });
});
