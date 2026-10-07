import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import { TrustMeClient } from 'trustme-secrets';
import { envNameFor, openVault, readSecret } from './secrets';

const SERVICE_PORT = 3000;
const JWT_ISSUER = 'auth-service';

async function required(vault: TrustMeClient | null, name: string): Promise<string> {
  const value = await readSecret(vault, name);
  if (value === '') {
    throw new Error(
      `Secret "${name}" is not in the TrustMe vault and ${envNameFor(name)} is not set in the environment or .env`,
    );
  }
  return value;
}

export const configuration = registerAs('app', async () => {
  const vault = await openVault();
  const [jwtSecret, dbHost, dbPort, dbName, dbUser, dbPassword] = await Promise.all([
    required(vault, 'JWT_SECRET'),
    required(vault, 'PostGres_Host'),
    required(vault, 'Postgres_Port'),
    required(vault, 'Postgres_DB'),
    required(vault, 'PostGres_User'),
    required(vault, 'PostGres'),
  ]);
  const [authPrivateKey, fauxnanceKey, fauxnanceUrl] = await Promise.all([
    readSecret(vault, 'AUTH_PRIVATE_KEY'),
    readSecret(vault, 'Fauxnance'),
    readSecret(vault, 'Fauxnance_Endpoint'),
  ]);

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: SERVICE_PORT,

    jwt: {
      secret: jwtSecret,
      issuer: JWT_ISSUER,
    },

    database: {
      host: dbHost,
      port: parseInt(dbPort, 10),
      username: dbUser,
      password: dbPassword,
      name: dbName,
    },

    credentialCrypto: {
      // RSA private key (PKCS#8 PEM) that opens encrypted credentials. A vault entry may hold the
      // PEM with literal "\n" in place of line breaks; restore them.
      privateKeyPem: authPrivateKey.replace(/\\n/g, '\n').trim(),
    },

    kafka: {
      broker: process.env.KAFKA_BROKER ?? 'localhost:29092',
    },

    fauxnance: {
      baseUrl: fauxnanceUrl.replace(/\/+$/, ''),
      apiKey: fauxnanceKey,
    },
  };
});

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  KAFKA_BROKER: Joi.string().default('localhost:29092'),
}).unknown(true);
