import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
// trustme-secrets is ESM-only; Node >=22.12 loads it via require() natively (verified: the
// package's real `default` export lands on trustme.default). A dynamic import() here instead
// would fail under ts-jest/Jest's CommonJS module host with "Cannot use import statement
// outside a module" - require() goes through Jest's normal module resolution and works.
import trustme from 'trustme-secrets';

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

// Same vault, same secret names Java (application.properties: ${trustme.secret.X}) and
// Python (scripts/db_config.py's ENV_KEYS) already read from: "JWT_SECRET" for the HS256
// signing key, "PostGres" for the database password. No env-var or hardcoded fallback here
// on purpose - the config factory below throws if the vault can't supply them, exactly like
// Spring refuses to start without ${trustme.secret.JWT_SECRET}.
export const configuration = registerAs('app', async () => {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),

    jwt: {
      secret: await trustme.get('JWT_SECRET'),
      issuer: process.env.JWT_ISSUER ?? 'auth-service',
    },

    database: {
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: await trustme.get('PostGres'),
      name: process.env.DB_NAME ?? 'trading_platform',
    },

    kafka: {
      broker: process.env.KAFKA_BROKER ?? 'localhost:9092',
    },

    fauxnance: {
      baseUrl:
        process.env.FAUXNANCE_BASE_URL ??
        'https://y4t9nq2bqf.execute-api.eu-west-2.amazonaws.com/v1',
      apiKey: process.env.FAUXNANCE_API_KEY ?? '',
    },

    smtp: {
      enabled: asBool(process.env.SMTP_ENABLED, false),
      host: process.env.SMTP_HOST ?? '',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: asBool(process.env.SMTP_SECURE, false),
      requireTls: asBool(process.env.SMTP_REQUIRE_TLS, true),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      from: process.env.SMTP_FROM ?? '',
    },
  };
});

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  // JWT_SECRET and DB_PASSWORD are no longer read from the environment - they come from
  // the TrustMe vault (see the config factory above).
  JWT_ISSUER: Joi.string().default('auth-service'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  KAFKA_BROKER: Joi.string().default('localhost:9092'),

  FAUXNANCE_BASE_URL: Joi.string()
    .uri()
    .default('https://y4t9nq2bqf.execute-api.eu-west-2.amazonaws.com/v1'),
  FAUXNANCE_API_KEY: Joi.string().allow('').optional(),

  SMTP_ENABLED: Joi.boolean().truthy('1').truthy('true').falsy('0').falsy('false').default(false),
  SMTP_HOST: Joi.when('SMTP_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().truthy('1').truthy('true').falsy('0').falsy('false').default(false),
  SMTP_REQUIRE_TLS: Joi.boolean().truthy('1').truthy('true').falsy('0').falsy('false').default(true),
  SMTP_USER: Joi.when('SMTP_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  SMTP_PASS: Joi.when('SMTP_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  SMTP_FROM: Joi.when('SMTP_ENABLED', {
    is: true,
    then: Joi.string().email().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
});
