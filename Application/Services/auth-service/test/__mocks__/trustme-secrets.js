const SECRETS = {
  JWT_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
  PostGres_Host: 'localhost',
  Postgres_Port: '5432',
  Postgres_DB: 'trading_platform',
  PostGres_User: 'postgres',
  PostGres: 'postgres',
};

async function get(secretName) {
  if (Object.prototype.hasOwnProperty.call(SECRETS, secretName)) {
    return SECRETS[secretName];
  }
  throw new Error(`No e2e mock configured for TrustMe secret "${secretName}"`);
}

async function using() {
  throw new Error('trustme.using() is not mocked for e2e tests; use trustme.get() instead.');
}

async function forget() {
  return true;
}

class TrustMeError extends Error {}

module.exports = { get, using, forget, TrustMeError };
module.exports.default = module.exports;
