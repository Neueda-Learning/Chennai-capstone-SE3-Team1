import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import trustme from 'trustme-secrets';

const SERVICE_PORT = 3000;
const JWT_ISSUER = 'auth-service';
const SMTP_PORT = 587;
const SMTP_IMPLICIT_TLS = false;
const SMTP_REQUIRE_STARTTLS = true;

async function required(name: string): Promise<string> {
  const value = await trustme.get(name);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`TrustMe secret "${name}" is empty`);
  }
  return value;
}

async function optional(name: string): Promise<string> {
  try {
    const value = await trustme.get(name);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export const configuration = registerAs('app', async () => {
  const [jwtSecret, dbHost, dbPort, dbName, dbUser, dbPassword] = await Promise.all([
    required('JWT_SECRET'),
    required('PostGres_Host'),
    required('Postgres_Port'),
    required('Postgres_DB'),
    required('PostGres_User'),
    required('PostGres'),
  ]);
  const [authPrivateKey, fauxnanceKey, fauxnanceUrl, smtpHost, smtpUser, smtpPass, smtpFrom] = await Promise.all([
    optional('AUTH_PRIVATE_KEY'),
    optional('Fauxnance'),
    optional('Fauxnance_Endpoint'),
    optional('SMTP_HOST'),
    optional('SMTP_USER'),
    optional('SMTP_PASS'),
    optional('SMTP_FROM'),
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

    smtp: {
      enabled: [smtpHost, smtpUser, smtpPass, smtpFrom].every((v) => v !== ''),
      host: smtpHost,
      port: SMTP_PORT,
      secure: SMTP_IMPLICIT_TLS,
      requireTls: SMTP_REQUIRE_STARTTLS,
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom,
    },
  };
});

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  KAFKA_BROKER: Joi.string().default('localhost:29092'),
}).unknown(true);
