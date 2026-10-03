import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
// trustme-secrets is ESM-only; Node >=22.12 loads it via require() natively (verified: the
// package's real `default` export lands on trustme.default). A dynamic import() here instead
// would fail under ts-jest/Jest's CommonJS module host with "Cannot use import statement
// outside a module" - require() goes through Jest's normal module resolution and works.
import trustme from 'trustme-secrets';

/**
 * Where every setting comes from.
 *
 * Secrets and connection details live in the TrustMe vault - the same entries Java reads as
 * `${trustme.secret.X}` and Python reads in scripts/db_config.py:
 *
 *   JWT_SECRET                                    the HS256 signing key
 *   PostGres_Host, Postgres_Port, Postgres_DB,
 *   PostGres_User, PostGres                       the database
 *   Fauxnance, Fauxnance_Endpoint                 the market-data API key and base URL
 *   SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM    the mail server that sends OTP codes
 *
 * There is deliberately no environment-variable or `.env` fallback for any of them: a second
 * place a secret could live is a second place for it to leak from or to disagree with the vault.
 * What the vault does not hold is fixed below as a plain value (the port, the issuer, the SMTP
 * port and TLS mode) - none of it is sensitive. The one thing still read from the environment is
 * NODE_ENV, which the runtime and Jest set themselves, and KAFKA_BROKER, a deployment address
 * (see kafka below).
 */
const SERVICE_PORT = 3000;
const JWT_ISSUER = 'auth-service';
// Gmail-style submission: connect in the clear on 587, then upgrade with STARTTLS (required).
const SMTP_PORT = 587;
const SMTP_IMPLICIT_TLS = false;
const SMTP_REQUIRE_STARTTLS = true;

/** A secret the service cannot start without: a missing one is an error naming it. */
async function required(name: string): Promise<string> {
  const value = await trustme.get(name);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`TrustMe secret "${name}" is empty`);
  }
  return value;
}

/** A secret the service can run without (mail, market data): absent means "feature off". */
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
  const [fauxnanceKey, fauxnanceUrl, smtpHost, smtpUser, smtpPass, smtpFrom] = await Promise.all([
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

    // Not in the vault, and not hardcoded: where Kafka is differs between a laptop (localhost)
    // and a shared broker (run-local.ps1 -KafkaHosted). Only the health check reads it.
    kafka: {
      broker: process.env.KAFKA_BROKER ?? 'localhost:9092',
    },

    fauxnance: {
      baseUrl: fauxnanceUrl.replace(/\/+$/, ''),
      apiKey: fauxnanceKey,
    },

    smtp: {
      // Mail is on exactly when the vault holds a complete set of credentials. With any of the
      // four missing the service logs the OTP code instead of sending it, as it always has.
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

/** The only environment variables the service looks at; everything else is above. */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  KAFKA_BROKER: Joi.string().default('localhost:9092'),
}).unknown(true);
