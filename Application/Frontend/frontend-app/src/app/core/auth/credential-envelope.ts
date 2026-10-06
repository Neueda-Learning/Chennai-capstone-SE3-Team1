// Only the pieces this needs (AES-GCM, RSA-OAEP, SHA-256), not the whole library: importing
// 'node-forge' pulls in X.509, TLS and PKCS code that would roughly double the initial bundle.
import forge from 'node-forge/lib/forge';
import 'node-forge/lib/aes';
import 'node-forge/lib/rsa';
import 'node-forge/lib/sha256';

/**
 * The browser half of the auth service's credential encryption (see the service's
 * credential-crypto.service.ts for the protocol and its limits).
 *
 * Built on node-forge rather than the browser's WebCrypto on purpose: `crypto.subtle` only
 * exists on HTTPS pages and on localhost, and the case this protects is a page served over plain
 * HTTP from some other host, where `crypto.subtle` is undefined. forge needs only
 * `crypto.getRandomValues`, which every context has.
 */

export interface CryptoParams {
  v: number;
  keyId: string;
  publicKey: string;
  /** Hex, from the same key as publicKey; used so no PEM/ASN.1 parser has to ship. */
  modulus: string;
  exponent: string;
  nonce: string;
  expiresInSeconds: number;
}

export interface RequestEnvelope {
  v: 1;
  nonce: string;
  ek: string;
  iv: string;
  ct: string;
}

export interface ResponseEnvelope {
  v: 1;
  iv: string;
  ct: string;
}

export interface SealedRequest {
  envelope: RequestEnvelope;
  /** Kept in memory only, to open the response to this one request. */
  key: string;
}

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function randomBinary(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  return out;
}

export function sealRequest(params: CryptoParams, body: unknown): SealedRequest {
  const key = randomBinary(AES_KEY_BYTES);
  const iv = randomBinary(GCM_IV_BYTES);

  const cipher = forge.cipher.createCipher('AES-GCM', key);
  cipher.start({ iv, additionalData: params.nonce, tagLength: GCM_TAG_BYTES * 8 });
  cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(JSON.stringify(body ?? null))));
  cipher.finish();
  const sealed = cipher.output.getBytes() + (cipher.mode as { tag: forge.util.ByteStringBuffer }).tag.getBytes();

  const publicKey = forge.pki.rsa.setPublicKey(
    new forge.jsbn.BigInteger(params.modulus, 16),
    new forge.jsbn.BigInteger(params.exponent, 16)
  );
  const wrappedKey = publicKey.encrypt(key, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() }
  });

  return {
    envelope: {
      v: 1,
      nonce: params.nonce,
      ek: forge.util.encode64(wrappedKey),
      iv: forge.util.encode64(iv),
      ct: forge.util.encode64(sealed)
    },
    key
  };
}

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['v'] === 1 && typeof candidate['iv'] === 'string' && typeof candidate['ct'] === 'string';
}

export function openResponse(request: SealedRequest, reply: ResponseEnvelope): unknown {
  const sealed = forge.util.decode64(reply.ct);
  if (sealed.length <= GCM_TAG_BYTES) {
    throw new Error('Encrypted response is too short');
  }
  const decipher = forge.cipher.createDecipher('AES-GCM', request.key);
  decipher.start({
    iv: forge.util.decode64(reply.iv),
    additionalData: request.envelope.nonce,
    tagLength: GCM_TAG_BYTES * 8,
    tag: forge.util.createBuffer(sealed.slice(sealed.length - GCM_TAG_BYTES))
  });
  decipher.update(forge.util.createBuffer(sealed.slice(0, sealed.length - GCM_TAG_BYTES)));
  if (!decipher.finish()) {
    throw new Error('Encrypted response failed its integrity check');
  }
  return JSON.parse(forge.util.decodeUtf8(decipher.output.getBytes()));
}
