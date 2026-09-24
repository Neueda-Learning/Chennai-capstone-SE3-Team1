// e2e-test stand-in for the real trustme-secrets package (see test/jest-e2e.json's
// moduleNameMapper). Two reasons this exists instead of hitting the real vault:
//   1. trustme-secrets is ESM-only; Jest's CommonJS module host can't load it directly
//      (`Cannot use import statement outside a module`), same class of problem Java solves
//      for its test profile with application-test.properties' `trustme.enabled=false`.
//   2. e2e tests shouldn't depend on a developer's machine having the vault unlocked.
// Fixed values only - never anything a real secret could be mistaken for.
const SECRETS = {
  JWT_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
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
