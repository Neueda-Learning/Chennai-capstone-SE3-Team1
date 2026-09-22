import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const configuration = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  jwt: {
    secret: process.env.JWT_SECRET ?? 'local-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
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
}));

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  KAFKA_BROKER: Joi.string().default('localhost:9092'),

  FAUXNANCE_BASE_URL: Joi.string()
    .uri()
    .default('https://y4t9nq2bqf.execute-api.eu-west-2.amazonaws.com/v1'),
  FAUXNANCE_API_KEY: Joi.string().allow('').optional(),
});
