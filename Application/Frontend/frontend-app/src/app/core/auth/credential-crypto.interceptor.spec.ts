import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';

import { credentialCryptoInterceptor } from './credential-crypto.interceptor';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const NONCE = 'one-time-nonce';
const PARAMS = {
  v: 1,
  keyId: 'k',
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  modulus: Buffer.from(publicKey.export({ format: 'jwk' }).n as string, 'base64url').toString('hex'),
  exponent: '010001',
  nonce: NONCE,
  expiresInSeconds: 60
};

describe('credentialCryptoInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialCryptoInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('encrypts a login, then decrypts the encrypted reply', () => {
    let result: unknown;
    http
      .post('http://auth.test:3000/auth/login', { username: 'priya', password: 'Correct-Horse-Battery-9' })
      .subscribe((body) => (result = body));

    httpTesting.expectOne('http://auth.test:3000/auth/crypto-params').flush(PARAMS);
    const login = httpTesting.expectOne('http://auth.test:3000/auth/login');

    const envelope = login.request.body as { nonce: string; ek: string; iv: string; ct: string };
    expect(JSON.stringify(envelope)).not.toContain('Correct-Horse');
    const key = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(envelope.ek, 'base64')
    );
    const sealed = Buffer.from(envelope.ct, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(NONCE));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const sent = JSON.parse(
      Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]).toString()
    );
    expect(sent).toEqual({ username: 'priya', password: 'Correct-Horse-Battery-9' });

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(NONCE));
    const reply = Buffer.concat([
      cipher.update(JSON.stringify({ accessToken: 'tok', refreshToken: 'ref' })),
      cipher.final(),
      cipher.getAuthTag()
    ]);
    login.flush({ v: 1, iv: iv.toString('base64'), ct: reply.toString('base64') });

    expect(result).toEqual({ accessToken: 'tok', refreshToken: 'ref' });
  });

  it('asks for fresh params on every request, since a nonce works once', () => {
    http.post('http://auth.test:3000/auth/refresh', { refreshToken: 'a' }).subscribe();
    httpTesting.expectOne('http://auth.test:3000/auth/crypto-params').flush(PARAMS);
    httpTesting.expectOne('http://auth.test:3000/auth/refresh');

    http.post('http://auth.test:3000/auth/refresh', { refreshToken: 'b' }).subscribe();
    httpTesting.expectOne('http://auth.test:3000/auth/crypto-params').flush(PARAMS);
    httpTesting.expectOne('http://auth.test:3000/auth/refresh');
  });

  it('passes an error reply straight through, since errors are not encrypted', () => {
    let status = 0;
    http.post('http://auth.test:3000/auth/login', { username: 'x', password: 'y' }).subscribe({
      error: (failure) => (status = failure.status)
    });

    httpTesting.expectOne('http://auth.test:3000/auth/crypto-params').flush(PARAMS);
    httpTesting
      .expectOne('http://auth.test:3000/auth/login')
      .flush({ errorCode: 'AUTH-401', message: 'Unauthorised' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
  });

  it('fails the call when the params cannot be fetched, rather than sending in the clear', () => {
    let failed = false;
    http.post('http://auth.test:3000/auth/login', { username: 'x', password: 'y' }).subscribe({
      error: () => (failed = true)
    });

    httpTesting
      .expectOne('http://auth.test:3000/auth/crypto-params')
      .flush('down', { status: 503, statusText: 'Unavailable' });

    httpTesting.expectNone('http://auth.test:3000/auth/login');
    expect(failed).toBe(true);
  });

  it.each([
    ['a GET to the auth service', 'GET', 'http://auth.test:3000/auth/me'],
    ['the params request itself', 'GET', 'http://auth.test:3000/auth/crypto-params'],
    ['a POST to another service', 'POST', 'http://trade.test:8081/api/v1/orders']
  ])('leaves %s alone', (_name, method, url) => {
    http.request(method, url, { body: method === 'POST' ? { a: 1 } : undefined }).subscribe();

    const request = httpTesting.expectOne(url);
    expect(request.request.body).toEqual(method === 'POST' ? { a: 1 } : null);
    request.flush({});
  });
});
