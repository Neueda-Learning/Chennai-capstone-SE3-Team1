const secrets: Record<string, string> = {};

let vaultOpens = true;

jest.mock('trustme-secrets', () => ({
  __esModule: true,
  default: {
    using: async () => {
      if (!vaultOpens) {
        throw new Error('Incorrect password');
      }
      return {
        appId: 'test',
        fetch: async (name: string) => {
          if (name in secrets) {
            return secrets[name];
          }
          throw new Error(`No such secret: ${name}`);
        },
      };
    },
  },
}));

import { configuration, validationSchema } from './configuration';
import { ENV_NAMES } from './secrets';

const VAULT = {
  JWT_SECRET: 'a-vault-jwt-secret-of-at-least-32-chars',
  PostGres_Host: 'db.vault.test',
  Postgres_Port: '6543',
  Postgres_DB: 'vault_db',
  PostGres_User: 'vault_user',
  PostGres: 'vault-password',
  Fauxnance: 'vault-fauxnance-key',
  Fauxnance_Endpoint: 'https://fauxnance.vault.test/v1/',
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
    vaultOpens = true;
    for (const name of Object.values(ENV_NAMES)) {
      delete process.env[name];
    }
    process.env.TRUSTME_KEY_FILE = __filename;
    process.env.TRUSTME_PASSWORD = 'test-password';
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

  it('takes the credential-encryption key from the vault and restores escaped line breaks', async () => {
    secrets.AUTH_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';
    process.env.AUTH_PRIVATE_KEY = 'ignored';

    const config = await load();

    expect(config.credentialCrypto.privateKeyPem).toBe(
      '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
    );
  });

  it('runs without the credential-encryption key, leaving the service to make a temporary one', async () => {
    const config = await load();

    expect(config.credentialCrypto.privateKeyPem).toBe('');
  });

  it('takes the market-data key and endpoint from the vault, without a trailing slash', async () => {
    const config = await load();

    expect(config.fauxnance).toEqual({ apiKey: 'vault-fauxnance-key', baseUrl: 'https://fauxnance.vault.test/v1' });
  });

  it('still starts with no market-data secrets at all', async () => {
    for (const name of ['Fauxnance', 'Fauxnance_Endpoint']) {
      delete secrets[name];
    }

    const config = await load();

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

  it('refuses a secret that exists but is empty, naming the variable that could stand in for it', async () => {
    secrets['PostGres'] = '';

    await expect(load()).rejects.toThrow(/PostGres.*POSTGRES_PASSWORD/);
  });

  it('falls back to the environment variable for a secret the vault does not hold', async () => {
    delete secrets['PostGres_Host'];
    process.env.POSTGRES_HOST = 'db.env.test';

    const config = await load();

    expect(config.database.host).toBe('db.env.test');
    expect(config.database.password).toBe('vault-password');
  });

  it('takes every secret from the environment when the vault cannot be opened', async () => {
    vaultOpens = false;
    Object.assign(process.env, {
      JWT_SECRET: 'an-env-jwt-secret-of-at-least-32-characters',
      POSTGRES_HOST: 'db.env.test',
      POSTGRES_PORT: '5433',
      POSTGRES_DB: 'env_db',
      POSTGRES_USER: 'env_user',
      POSTGRES_PASSWORD: 'env-password',
      FAUXNANCE_API_KEY: 'env-key',
      FAUXNANCE_BASE_URL: 'https://fauxnance.env.test/',
    });

    const config = await load();

    expect(config.jwt.secret).toBe('an-env-jwt-secret-of-at-least-32-characters');
    expect(config.database).toEqual({
      host: 'db.env.test',
      port: 5433,
      username: 'env_user',
      password: 'env-password',
      name: 'env_db',
    });
    expect(config.fauxnance).toEqual({ apiKey: 'env-key', baseUrl: 'https://fauxnance.env.test' });
  });

  it('skips the vault when there is no key file, without prompting', async () => {
    process.env.TRUSTME_KEY_FILE = 'no-such-key-file.TM';
    delete secrets['JWT_SECRET'];

    await expect(load()).rejects.toThrow(/JWT_SECRET/);
  });

  it('prefers the vault over the environment, so a stray variable cannot override it', async () => {
    Object.assign(process.env, {
      JWT_SECRET: 'env-secret-that-must-be-ignored-0123456789',
      POSTGRES_HOST: 'env-host',
      POSTGRES_PASSWORD: 'env-password',
      FAUXNANCE_API_KEY: 'env-key',
      FAUXNANCE_BASE_URL: 'https://env.test',
      PORT: '9999',
      JWT_ISSUER: 'env-issuer',
    });

    const config = await load();

    expect(config.jwt).toEqual({ secret: VAULT.JWT_SECRET, issuer: 'auth-service' });
    expect(config.database.host).toBe('db.vault.test');
    expect(config.database.password).toBe('vault-password');
    expect(config.fauxnance.apiKey).toBe('vault-fauxnance-key');
    expect(config.port).toBe(3000);
  });

  it('still honours NODE_ENV and KAFKA_BROKER, the two things the runtime and the deployment set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKER = 'kafka.example:29092';

    const config = await load();

    expect(config.nodeEnv).toBe('production');
    expect(config.kafka.broker).toBe('kafka.example:29092');
  });
});

describe('validationSchema', () => {
  it('asks for nothing: secrets are resolved by configuration(), not validated here', () => {
    const { error, value } = validationSchema.validate({});

    expect(error).toBeUndefined();
    expect(value).toEqual({ NODE_ENV: 'development', KAFKA_BROKER: 'localhost:29092' });
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(validationSchema.validate({ NODE_ENV: 'staging' }).error).toBeDefined();
  });
});
