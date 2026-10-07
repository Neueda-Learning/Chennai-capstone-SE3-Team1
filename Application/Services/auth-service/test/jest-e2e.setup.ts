process.env.NODE_ENV = 'test';
process.env.KAFKA_BROKER = 'localhost:29092';

process.env.JWT_SECRET = 'e2e-secret-that-is-at-least-32-characters-long';
// The e2e vault mock refuses to open, so every secret comes through the environment fallback.
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_DB = 'trading_platform';
process.env.POSTGRES_USER = 'postgres';
process.env.POSTGRES_PASSWORD = 'postgres';
