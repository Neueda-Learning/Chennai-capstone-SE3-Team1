import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as request from 'supertest';
import * as jsonwebtoken from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { UserRepository } from '../src/auth/user.repository';
import { RefreshTokenRepository } from '../src/auth/refresh-token.repository';
import { Role } from '../src/auth/dto/role';
import { ACCESS_TOKEN_TTL_SECONDS } from '../src/auth/token.constants';

// ---------------------------------------------------------------------------
// In-memory fakes: the e2e suite exercises the full HTTP pipeline (pipes,
// guards, filters, controller, service) without a live Postgres.
// ---------------------------------------------------------------------------

interface FakeUser {
  id: string;
  username: string;
  accountId: number;
  roles: Role[];
  passwordHash: string;
  paramsVersion: number;
  version: number;
  createdOn: Date;
}

interface FakeRefresh {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

class FakeUserRepo {
  usersById = new Map<string, FakeUser>();
  usersByUsername = new Map<string, FakeUser>();

  async accountExists(accountId: number): Promise<boolean> {
    return accountId === 1; // clients.client_id 1 is the only seeded account
  }

  async findByUsername(username: string): Promise<FakeUser | null> {
    return this.usersByUsername.get(username) ?? null;
  }

  async findById(id: string): Promise<FakeUser | null> {
    return this.usersById.get(id) ?? null;
  }

  async create(input: {
    username: string;
    accountId: number;
    roles: Role[];
    passwordHash: string;
    paramsVersion: number;
  }): Promise<FakeUser> {
    const u: FakeUser = {
      id: randomUUID(),
      username: input.username,
      accountId: input.accountId,
      roles: input.roles,
      passwordHash: input.passwordHash,
      paramsVersion: input.paramsVersion,
      version: 1,
      createdOn: new Date(),
    };
    this.usersById.set(u.id, u);
    this.usersByUsername.set(u.username, u);
    return u;
  }

  async updatePasswordHash(
    id: string,
    hash: string,
    version: number,
  ): Promise<void> {
    const u = this.usersById.get(id);
    if (u) {
      u.passwordHash = hash;
      u.paramsVersion = version;
      u.version += 1;
    }
  }
}

class FakeRefreshRepo {
  tokens = new Map<string, FakeRefresh>();

  async findByHash(tokenHash: string): Promise<FakeRefresh | null> {
    return this.tokens.get(tokenHash) ?? null;
  }

  async store(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.tokens.set(input.tokenHash, {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    });
  }

  async revoke(id: string): Promise<void> {
    for (const t of this.tokens.values()) {
      if (t.id === id && !t.revokedAt) t.revokedAt = new Date();
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const t of this.tokens.values()) {
      if (t.userId === userId && !t.revokedAt) t.revokedAt = new Date();
    }
  }
}

const fakeUsers = new FakeUserRepo();
const fakeRefresh = new FakeRefreshRepo();

describe('Auth service (e2e)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UserRepository)
      .useValue(fakeUsers)
      .overrideProvider(RefreshTokenRepository)
      .useValue(fakeRefresh)
      .compile();

    app = moduleFixture.createNestApplication();

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Auth service')
      .setDescription(
        'Registration, login, token refresh and current-user lookup.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/json',
    });

    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeUsers.usersById.clear();
    fakeUsers.usersByUsername.clear();
    fakeRefresh.tokens.clear();
  });

  const registerBody = {
    username: 'priya.menon',
    password: 'correct horse battery staple',
    accountId: 1,
  };

  describe('register', () => {
    it('creates a user against an existing account and returns NO tokens', async () => {
      const res = await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        username: 'priya.menon',
        accountId: 1,
        roles: ['CUSTOMER'],
      });
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
    });

    it('rejects registering against an unknown accountId with VAL-422', async () => {
      const res = await request(server)
        .post('/auth/register')
        .send({ ...registerBody, accountId: 999 })
        .expect(422);

      expect(res.body).toEqual({
        errorCode: 'VAL-422',
        message: 'Invalid input',
      });
    });

    it('rejects a short password with VAL-422', async () => {
      const res = await request(server)
        .post('/auth/register')
        .send({ ...registerBody, password: 'short' })
        .expect(422);

      expect(res.body.errorCode).toBe('VAL-422');
    });

    it('rejects extra fields on the body (additionalProperties: false)', async () => {
      const res = await request(server)
        .post('/auth/register')
        .send({ ...registerBody, corporateSecret: 'leak' })
        .expect(422);

      expect(res.body.errorCode).toBe('VAL-422');
    });

    it('returns AUTH-409 when the username is already taken', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);

      const res = await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(409);

      expect(res.body).toEqual({
        errorCode: 'AUTH-409',
        message: 'Registration failed',
      });
    });
  });

  describe('login', () => {
    it('returns the same AUTH-401 body for an unknown user and a wrong password', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);

      const unknown = await request(server)
        .post('/auth/login')
        .send({
          username: 'ghost.user',
          password: 'correct horse battery staple',
        })
        .expect(401);

      const wrongPass = await request(server)
        .post('/auth/login')
        .send({ username: 'priya.menon', password: 'wrong password here!' })
        .expect(401);

      expect(unknown.body).toEqual({
        errorCode: 'AUTH-401',
        message: 'Unauthorised',
      });
      expect(wrongPass.body).toEqual(unknown.body);
    });

    it('issues a Bearer access token and opaque refresh token on success', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);

      const res = await request(server)
        .post('/auth/login')
        .send({
          username: 'priya.menon',
          password: 'correct horse battery staple',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
      expect(res.body.accessToken.split('.')).toHaveLength(3);

      const payload = JSON.parse(
        Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
      );
      expect(payload).toMatchObject({
        sub: expect.stringMatching(/^[0-9a-f-]{36}$/),
        accountId: 1,
        roles: ['CUSTOMER'],
        iss: 'auth-service',
      });
      expect(payload.exp - payload.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('rejects a malformed login body with VAL-422', async () => {
      const res = await request(server)
        .post('/auth/login')
        .send({ username: 'priya.menon' })
        .expect(422);
      expect(res.body.errorCode).toBe('VAL-422');
    });
  });

  describe('me', () => {
    it('returns the authenticated user for a valid token', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);
      const login = await request(server)
        .post('/auth/login')
        .send({
          username: 'priya.menon',
          password: 'correct horse battery staple',
        })
        .expect(200);

      const res = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        username: 'priya.menon',
        accountId: 1,
        roles: ['CUSTOMER'],
      });
    });

    it('rejects a missing Authorization header with AUTH-401', async () => {
      const res = await request(server).get('/auth/me').expect(401);
      expect(res.body).toEqual({
        errorCode: 'AUTH-401',
        message: 'Unauthorised',
      });
    });

    it('rejects a garbage token with AUTH-401', async () => {
      await request(server)
        .get('/auth/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('rejects an expired token with AUTH-401', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);
      const now = Math.floor(Date.now() / 1000);
      const expired = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          accountId: 1,
          roles: ['CUSTOMER'],
          iat: now - 2 * ACCESS_TOKEN_TTL_SECONDS,
          exp: now - ACCESS_TOKEN_TTL_SECONDS,
          iss: 'auth-service',
        },
        process.env.JWT_SECRET!,
        { algorithm: 'HS256' },
      );
      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('rejects a wrongly-signed token with AUTH-401', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);
      const now = Math.floor(Date.now() / 1000);
      const forged = jsonwebtoken.sign(
        {
          sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
          accountId: 1,
          roles: ['ADMIN'],
          iat: now,
          exp: now + ACCESS_TOKEN_TTL_SECONDS,
          iss: 'auth-service',
        },
        'attacker-controlled-secret-that-is-way-too-long-yes-12345678',
        { algorithm: 'HS256' },
      );
      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token on every use', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);
      const login = await request(server)
        .post('/auth/login')
        .send({
          username: 'priya.menon',
          password: 'correct horse battery staple',
        })
        .expect(200);

      const first = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      // The refresh token MUST rotate. (The access token is a deterministic
      // signature of claims + iat, so a same-second refresh can legitimately
      // return an identical access token.)
      expect(first.body.refreshToken).not.toBe(login.body.refreshToken);

      // Presenting the consumed token again is theft.
      const reuse = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
      expect(reuse.body).toEqual({
        errorCode: 'AUTH-401',
        message: 'Unauthorised',
      });
    });

    it('rejects an unknown refresh token with AUTH-401', async () => {
      const res = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: 'never-issued-token' })
        .expect(401);
      expect(res.body).toEqual({
        errorCode: 'AUTH-401',
        message: 'Unauthorised',
      });
    });

    it('accepts a token and keeps the session valid for /me', async () => {
      await request(server)
        .post('/auth/register')
        .send(registerBody)
        .expect(201);
      const login = await request(server)
        .post('/auth/login')
        .send({
          username: 'priya.menon',
          password: 'correct horse battery staple',
        })
        .expect(200);
      const refreshed = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);
    });
  });

  describe('openapi', () => {
    it('serves the OpenAPI JSON at /docs/json', async () => {
      const res = await request(server).get('/docs/json').expect(200);
      expect(res.body.openapi).toBeDefined();
      expect(res.body.paths['/auth/register']).toBeDefined();
      expect(res.body.paths['/auth/login']).toBeDefined();
      expect(res.body.paths['/auth/refresh']).toBeDefined();
      expect(res.body.paths['/auth/me']).toBeDefined();
    });

    it('serves the Swagger UI at /docs', async () => {
      await request(server).get('/docs').expect(200);
    });
  });
});
