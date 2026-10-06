import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from 'crypto';
import { AppModule } from '../src/app.module';
import { UserRepository } from '../src/auth/user.repository';
import { OtpRepository } from '../src/auth/otp.repository';
import { RefreshTokenRepository } from '../src/auth/refresh-token.repository';
import { MailerService } from '../src/auth/mailer.service';

interface Params {
  publicKey: string;
  nonce: string;
}

/** The browser's half, written against Node's crypto so it checks the wire format, not our own helper. */
function seal(params: Params, body: unknown) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(params.nonce));
  const ct = Buffer.concat([
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
    key,
  );
  return {
    key,
    envelope: {
      v: 1,
      nonce: params.nonce,
      ek: ek.toString('base64'),
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
    },
  };
}

function open(
  key: Buffer,
  nonce: string,
  reply: { iv: string; ct: string },
): unknown {
  const sealed = Buffer.from(reply.ct, 'base64');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(reply.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(nonce));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - 16)),
      decipher.final(),
    ]).toString(),
  );
}

describe('Credential encryption (e2e, real crypto)', () => {
  let app: INestApplication;
  const users = {
    findByEmail: jest.fn().mockResolvedValue(null),
    findByUsername: jest.fn().mockResolvedValue(null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UserRepository)
      .useValue(users)
      .overrideProvider(OtpRepository)
      .useValue({})
      .overrideProvider(RefreshTokenRepository)
      .useValue({})
      .overrideProvider(MailerService)
      .useValue({ send: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const params = async (): Promise<Params> =>
    (await request(app.getHttpServer()).get('/auth/crypto-params')).body;

  it('publishes a public key and a nonce, and nothing private', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/crypto-params')
      .expect(200);
    expect(res.body.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(res.body.nonce).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
  });

  it('refuses a plaintext body on every POST under /auth', async () => {
    for (const path of [
      'login',
      'register',
      'verify-otp',
      'forgot-password',
      'refresh',
    ]) {
      const res = await request(app.getHttpServer())
        .post(`/auth/${path}`)
        .send({
          username: 'priya',
          password: 'Correct-Horse-Battery-9',
          email: 'p@example.com',
        })
        .expect(422);
      expect(res.body).toEqual({
        errorCode: 'VAL-422',
        message: 'Invalid input',
      });
    }
  });

  it('accepts an encrypted request and answers with an encrypted response', async () => {
    const p = await params();
    const { key, envelope } = seal(p, { email: 'nobody@example.com' });
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(envelope)
      .expect(200);

    expect(res.body).toEqual({
      v: 1,
      iv: expect.any(String),
      ct: expect.any(String),
    });
    expect(open(key, p.nonce, res.body)).toEqual({ sent: true });
    expect(users.findByEmail).toHaveBeenCalledWith('nobody@example.com');
  });

  it('refuses the same envelope a second time (replay)', async () => {
    const p = await params();
    const { envelope } = seal(p, { email: 'nobody@example.com' });
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(envelope)
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(envelope)
      .expect(422);
  });

  it('still validates the decrypted body', async () => {
    const p = await params();
    const { envelope } = seal(p, { email: 'not-an-email' });
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(envelope)
      .expect(422);
    expect(res.body.errorCode).toBe('VAL-422');
  });
});
