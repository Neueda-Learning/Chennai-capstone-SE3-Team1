process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.JWT_ISSUER = 'auth-service';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_USERNAME = 'postgres';
process.env.DB_NAME = 'trading_platform';
process.env.KAFKA_BROKER = 'localhost:9092';

// JWT_SECRET and DB_PASSWORD are no longer environment variables that configuration.ts reads -
// it fetches them from the TrustMe vault. e2e tests never touch the real vault:
// test/jest-e2e.json maps trustme-secrets to test/__mocks__/trustme-secrets.js, which returns
// fixed test values, the same way Java's application-test.properties sets trustme.enabled=false
// and uses its own fixed test secret instead of the real vault.
//
// auth.e2e-spec.ts still reads process.env.JWT_SECRET directly, to hand-sign a token for the
// "expired token" test case - that's independent of configuration.ts and needs to match
// __mocks__/trustme-secrets.js's JWT_SECRET value exactly, or the app would reject the test's
// token as a bad signature instead of as expired.
process.env.JWT_SECRET = 'e2e-secret-that-is-at-least-32-characters-long';
