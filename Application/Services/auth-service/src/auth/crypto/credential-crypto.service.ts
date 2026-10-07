import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  privateDecrypt,
  randomBytes,
} from 'crypto';
import { AuthServiceException } from '../auth-errors';

/**
 * Application-layer protection for credentials sent over plain HTTP.
 *
 * Scheme (hybrid, the same shape TLS uses for a key exchange):
 *   1. The client GETs /auth/crypto-params: the service's RSA public key and a one-time nonce.
 *   2. The client makes a random AES-256 key, encrypts the JSON body with AES-256-GCM (the nonce
 *      is the authenticated data), and wraps the AES key with RSA-OAEP (SHA-256).
 *   3. The service unwraps the key, checks and burns the nonce, decrypts, and answers with the
 *      response encrypted under the same AES key (fresh IV).
 *
 * What this stops: someone who only reads packets. What it cannot stop: someone who can change
 * the page in transit over HTTP, because they can change the code that does the encrypting. Only
 * TLS closes that gap; see README, "Credentials over plain HTTP".
 */

export const ENVELOPE_VERSION = 1;
/** How long a nonce may be used after it is issued. */
export const NONCE_TTL_MS = 60_000;
/** Bound on outstanding nonces, so an unauthenticated caller cannot grow memory without limit. */
export const MAX_OUTSTANDING_NONCES = 10_000;

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_NONCE_LENGTH = 64;

export interface RequestEnvelope {
  v: number;
  nonce: string;
  /** RSA-OAEP(SHA-256) wrapped AES key, base64. */
  ek: string;
  /** AES-GCM IV, base64 (12 bytes). */
  iv: string;
  /** AES-GCM ciphertext followed by the 16-byte tag, base64. */
  ct: string;
}

export interface ResponseEnvelope {
  v: number;
  iv: string;
  ct: string;
}

export interface CryptoParams {
  v: number;
  keyId: string;
  /** SPKI PEM of the RSA public key. */
  publicKey: string;
  /** The same key as hex modulus and exponent, for clients that cannot afford a PEM parser. */
  modulus: string;
  exponent: string;
  nonce: string;
  expiresInSeconds: number;
}

export interface UnwrappedRequest {
  body: unknown;
  /** Held for the lifetime of the request, to encrypt the response. Never logged or stored. */
  key: Buffer;
  nonce: string;
}

@Injectable()
export class CredentialCryptoService {
  private readonly logger = new Logger(CredentialCryptoService.name);
  private readonly privateKey: KeyObject;
  private readonly publicKeyPem: string;
  private readonly modulusHex: string;
  private readonly exponentHex: string;
  private readonly keyId: string;
  /** nonce -> expiry (ms since epoch). Insertion order is issue order. */
  private readonly nonces = new Map<string, number>();

  constructor(configService: ConfigService) {
    const pem =
      configService.get<string>('app.credentialCrypto.privateKeyPem') ?? '';
    if (pem !== '') {
      this.privateKey = createPrivateKey(pem);
    } else {
      // No AUTH_PRIVATE_KEY in TrustMe: fall back to a key that lives only in this process.
      // Fine for one instance on a laptop; with two instances, or across a restart, a client
      // holding the old public key gets a clean failure and simply re-fetches the params.
      this.logger.warn(
        'AUTH_PRIVATE_KEY is not set (TrustMe vault, environment or .env): using a temporary key generated at startup. ' +
          'Add an RSA private key (PKCS#8 PEM) to the vault, or AUTH_PRIVATE_KEY to .env, so every instance shares one.',
      );
      this.privateKey = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      }).privateKey;
    }
    const publicKey = createPublicKey(this.privateKey);
    this.publicKeyPem = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const jwk = publicKey.export({ format: 'jwk' });
    this.modulusHex = Buffer.from(jwk.n as string, 'base64url').toString('hex');
    this.exponentHex = Buffer.from(jwk.e as string, 'base64url').toString(
      'hex',
    );
    this.keyId = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .slice(0, 16);
  }

  issueParams(): CryptoParams {
    const now = Date.now();
    this.purgeExpired(now);
    while (this.nonces.size >= MAX_OUTSTANDING_NONCES) {
      // Drop the oldest outstanding nonce rather than refuse a new caller.
      const oldest = this.nonces.keys().next().value as string;
      this.nonces.delete(oldest);
    }
    const nonce = randomBytes(18).toString('base64url');
    this.nonces.set(nonce, now + NONCE_TTL_MS);
    return {
      v: ENVELOPE_VERSION,
      keyId: this.keyId,
      publicKey: this.publicKeyPem,
      modulus: this.modulusHex,
      exponent: this.exponentHex,
      nonce,
      expiresInSeconds: NONCE_TTL_MS / 1000,
    };
  }

  /**
   * Opens a request envelope. Every failure is the same VAL-422 "Invalid input", so the
   * response says nothing about which check failed.
   */
  unwrapRequest(envelope: unknown): UnwrappedRequest {
    const fail = (): never => {
      throw AuthServiceException.invalidInput();
    };
    if (!isRequestEnvelope(envelope)) {
      return fail();
    }

    // The nonce is burned before anything else, valid or not, so a bad envelope cannot be
    // retried against the same nonce.
    const expiresAt = this.nonces.get(envelope.nonce);
    this.nonces.delete(envelope.nonce);
    if (expiresAt === undefined || expiresAt < Date.now()) {
      return fail();
    }

    try {
      const key = privateDecrypt(
        {
          key: this.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(envelope.ek, 'base64'),
      );
      const iv = Buffer.from(envelope.iv, 'base64');
      const sealed = Buffer.from(envelope.ct, 'base64');
      if (
        key.length !== AES_KEY_BYTES ||
        iv.length !== GCM_IV_BYTES ||
        sealed.length <= GCM_TAG_BYTES
      ) {
        return fail();
      }
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(envelope.nonce, 'utf8'));
      decipher.setAuthTag(sealed.subarray(sealed.length - GCM_TAG_BYTES));
      const plain = Buffer.concat([
        decipher.update(sealed.subarray(0, sealed.length - GCM_TAG_BYTES)),
        decipher.final(),
      ]);
      return {
        body: JSON.parse(plain.toString('utf8')),
        key,
        nonce: envelope.nonce,
      };
    } catch {
      return fail();
    }
  }

  wrapResponse(
    unwrapped: Pick<UnwrappedRequest, 'key' | 'nonce'>,
    body: unknown,
  ): ResponseEnvelope {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', unwrapped.key, iv);
    cipher.setAAD(Buffer.from(unwrapped.nonce, 'utf8'));
    const sealed = Buffer.concat([
      cipher.update(JSON.stringify(body ?? null), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return {
      v: ENVELOPE_VERSION,
      iv: iv.toString('base64'),
      ct: sealed.toString('base64'),
    };
  }

  private purgeExpired(now: number): void {
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt >= now) {
        break; // issue order is expiry order, so the rest are still live
      }
      this.nonces.delete(nonce);
    }
  }
}

function isRequestEnvelope(value: unknown): value is RequestEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    e.v === ENVELOPE_VERSION &&
    typeof e.nonce === 'string' &&
    e.nonce.length > 0 &&
    e.nonce.length <= MAX_NONCE_LENGTH &&
    typeof e.ek === 'string' &&
    typeof e.iv === 'string' &&
    typeof e.ct === 'string'
  );
}
