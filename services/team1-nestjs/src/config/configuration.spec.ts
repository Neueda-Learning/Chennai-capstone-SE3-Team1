const secrets: Record<string, string> = {};

// The real package is ESM-only (see configuration.ts), so Jest never loads it; the factory
// stands in for the vault, answering from `secrets` and refusing what it does not hold - which is
// what the real client does for a missing entry.
jest.mock('trustme-secrets', () => ({
  __esModule: true,
  default: {
    get: async (name: string) => {
      if (name in secrets) {
        return secrets[name];
      }
      throw new Error(`No such secret: ${name}`);
    },
  },
}));

import { configuration, validationSchema } from './configuration';

const VAULT = {
  JWT_SECRET: 'a-vault-jwt-secret-of-at-least-32-chars',
  PostGres_Host: 'db.vault.test',
  Postgres_Port: '6543',
  Postgres_DB: 'vault_db',
  PostGres_User: 'vault_user',
  PostGres: 'vault-password',
  Fauxnance: 'vault-fauxnance-key',
  Fauxnance_Endpoint: 'https://fauxnance.vault.test/v1/',
  SMTP_HOST: 'smtp.vault.test',
  SMTP_USER: 'mailer@vault.test',
  SMTP_PASS: 'vault-smtp-pass',
  SMTP_FROM: 'noreply@vault.test',
};

async function load() {
  return configuration();
}

describe('configuration', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(secrets)) {
      delete secrets[key];
    }
    Object.assign(secrets, VAULT);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('takes the signing key and every database setting from the vault', async () => {
    const config = await load();

    expect(config.jwt.secret).toBe(VAULT.JWT_SECRET);
    expect(config.database).toEqual({
      host: 'db.vault.test',
      port: 6543,
      username: 'vault_user',
      password: 'vault-password',
      name: 'vault_db',
    });
  });

  it('takes the market-data key and endpoint from the vault, without a trailing slash', async () => {
    const config = await load();

    expect(config.fauxnance).toEqual({ apiKey: 'vault-fauxnance-key', baseUrl: 'https://fauxnance.vault.test/v1' });
  });

  it('takes the mail server from the vault, and fixes the port and TLS mode in code', async () => {
    const config = await load();

    expect(config.smtp).toEqual({
      enabled: true,
      host: 'smtp.vault.test',
      port: 587,
      secure: false,
      requireTls: true,
      user: 'mailer@vault.test',
      pass: 'vault-smtp-pass',
      from: 'noreply@vault.test',
    });
  });

  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'])(
    'turns mail off, rather than half-configuring it, when %s is not in the vault',
    async (missing) => {
      delete secrets[missing];

      const config = await load();

      expect(config.smtp.enabled).toBe(false);
    },
  );

  it('still starts with no mail and no market-data secrets at all', async () => {
    for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'Fauxnance', 'Fauxnance_Endpoint']) {
      delete secrets[name];
    }

    const config = await load();

    expect(config.smtp.enabled).toBe(false);
    expect(config.fauxnance).toEqual({ apiKey: '', baseUrl: '' });
    expect(config.jwt.secret).toBe(VAULT.JWT_SECRET);
  });

  it.each(['JWT_SECRET', 'PostGres_Host', 'Postgres_Port', 'Postgres_DB', 'PostGres_User', 'PostGres'])(
    'refuses to start without %s, naming it',
    async (name) => {
      delete secrets[name];

      await expect(load()).rejects.toThrow(name);
    },
  );

  it('refuses a secret that exists but is empty', async () => {
    secrets['PostGres'] = '';

    await expect(load()).rejects.toThrow('PostGres');
  });

  it('ignores the environment variables it used to read, so a stray one cannot override the vault', async () => {
    Object.assign(process.env, {
      JWT_SECRET: 'env-secret-that-must-be-ignored-0123456789',
      DB_HOST: 'env-host',
      DB_PORT: '1111',
      DB_USERNAME: 'env-user',
      DB_PASSWORD: 'env-password',
      DB_NAME: 'env-db',
      FAUXNANCE_API_KEY: 'env-key',
      FAUXNANCE_BASE_URL: 'https://env.test',
      SMTP_HOST: 'env-smtp',
      SMTP_ENABLED: 'false',
      PORT: '9999',
      JWT_ISSUER: 'env-issuer',
    });

    const config = await load();

    expect(config.jwt).toEqual({ secret: VAULT.JWT_SECRET, issuer: 'auth-service' });
    expect(config.database.host).toBe('db.vault.test');
    expect(config.database.password).toBe('vault-password');
    expect(config.fauxnance.apiKey).toBe('vault-fauxnance-key');
    expect(config.smtp.host).toBe('smtp.vault.test');
    expect(config.smtp.enabled).toBe(true);
    expect(config.port).toBe(3000);
  });

  it('still honours NODE_ENV and KAFKA_BROKER, the two things the runtime and the deployment set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKER = 'kafka.example:9092';

    const config = await load();

    expect(config.nodeEnv).toBe('production');
    expect(config.kafka.broker).toBe('kafka.example:9092');
  });
});

describe('validationSchema', () => {
  it('asks for nothing: no secret is an environment variable any more', () => {
    const { error, value } = validationSchema.validate({});

    expect(error).toBeUndefined();
    expect(value).toEqual({ NODE_ENV: 'development', KAFKA_BROKER: 'localhost:9092' });
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(validationSchema.validate({ NODE_ENV: 'staging' }).error).toBeDefined();
  });
});
