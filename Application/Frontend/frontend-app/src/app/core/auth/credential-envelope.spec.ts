import { constants, createDecipheriv, createCipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';

import { CryptoParams, ResponseEnvelope, isResponseEnvelope, openResponse, sealRequest } from './credential-envelope';

/**
 * The auth service runs on Node's crypto and this client on node-forge, so these tests open
 * what the client produces with Node's own primitives, and seal replies the way the service
 * does: a mismatch in padding, hash, tag handling or AAD would show up here.
 */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const NONCE = 'nonce_ABC-123';
const PARAMS: CryptoParams = {
  v: 1,
  keyId: 'test',
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  modulus: Buffer.from(publicKey.export({ format: 'jwk' }).n as string, 'base64url').toString('hex'),
  exponent: '010001',
  nonce: NONCE,
  expiresInSeconds: 60
};

/** The service's unwrapRequest, reduced to the crypto. */
function serverOpen(envelope: { nonce: string; ek: string; iv: string; ct: string }): { body: unknown; key: Buffer } {
  const key = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelope.ek, 'base64')
  );
  const sealed = Buffer.from(envelope.ct, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(envelope.nonce));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  return { body: JSON.parse(plain.toString('utf8')), key };
}

/** The service's wrapResponse. */
function serverSeal(key: Buffer, nonce: string, body: unknown): ResponseEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(nonce));
  const sealed = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64'), ct: sealed.toString('base64') };
}

describe('credential envelope (client side)', () => {
  it('produces an envelope the service can open', () => {
    const { envelope } = sealRequest(PARAMS, { username: 'priya.menon', password: 'Correct-Horse-Battery-9' });

    expect(serverOpen(envelope).body).toEqual({ username: 'priya.menon', password: 'Correct-Horse-Battery-9' });
  });

  it('carries the nonce it was given', () => {
    expect(sealRequest(PARAMS, {}).envelope.nonce).toBe(NONCE);
  });

  it('keeps non-ASCII passwords intact', () => {
    const { envelope } = sealRequest(PARAMS, { password: 'pässwörd-密码-🔑' });

    expect(serverOpen(envelope).body).toEqual({ password: 'pässwörd-密码-🔑' });
  });

  it('never puts the plaintext in the envelope', () => {
    const { envelope } = sealRequest(PARAMS, { password: 'Correct-Horse-Battery-9' });

    expect(JSON.stringify(envelope)).not.toContain('Correct-Horse');
    expect(JSON.stringify(envelope)).not.toContain('password');
  });

  it('uses a fresh AES key and IV every time', () => {
    const a = sealRequest(PARAMS, { x: 1 });
    const b = sealRequest(PARAMS, { x: 1 });

    expect(a.key).not.toBe(b.key);
    expect(a.envelope.iv).not.toBe(b.envelope.iv);
    expect(a.envelope.ct).not.toBe(b.envelope.ct);
  });

  it('opens a reply the service sealed under the request key', () => {
    const sealed = sealRequest(PARAMS, { a: 1 });
    const { key } = serverOpen(sealed.envelope);

    const reply = serverSeal(key, NONCE, { accessToken: 'tok', refreshToken: 'ref' });

    expect(openResponse(sealed, reply)).toEqual({ accessToken: 'tok', refreshToken: 'ref' });
  });

  it('rejects a reply that was altered in transit', () => {
    const sealed = sealRequest(PARAMS, { a: 1 });
    const reply = serverSeal(serverOpen(sealed.envelope).key, NONCE, { accessToken: 'tok' });
    const bytes = Buffer.from(reply.ct, 'base64');
    bytes[0] ^= 1;

    expect(() => openResponse(sealed, { ...reply, ct: bytes.toString('base64') })).toThrow(/integrity/);
  });

  it('rejects a reply sealed for a different request', () => {
    const sealed = sealRequest(PARAMS, { a: 1 });
    const other = serverOpen(sealRequest(PARAMS, { a: 2 }).envelope);

    expect(() => openResponse(sealed, serverSeal(other.key, NONCE, {}))).toThrow();
  });

  it('recognises a response envelope and nothing else', () => {
    expect(isResponseEnvelope({ v: 1, iv: 'a', ct: 'b' })).toBe(true);
    expect(isResponseEnvelope({ accessToken: 't' })).toBe(false);
    expect(isResponseEnvelope(null)).toBe(false);
    expect(isResponseEnvelope('text')).toBe(false);
  });
});
