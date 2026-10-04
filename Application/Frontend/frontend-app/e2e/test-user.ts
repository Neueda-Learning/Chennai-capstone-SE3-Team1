/**
 * The account the E2E suite signs in with.
 *
 * Registration is deliberately not exercised: it ends in an email OTP, so an end-to-end run
 * cannot get past it without reading a real inbox. The suite therefore signs in as an account
 * that already exists in the local database, and the credentials come from `.env.test`
 * (loaded by `playwright.config.ts`) or from the shell. The defaults are the shared local
 * development account, which the rest of the stack also seeds.
 */
export const testUser = {
  username: process.env['TEST_USERNAME'] ?? 'nadellaroshni2',
  password: process.env['TEST_PASSWORD'] ?? 'Roshni@22036'
};

/** Where the signed-in session is cached for the authenticated projects. */
export const storageStatePath = 'e2e/.auth/user.json';

/** The key `SessionStore` persists a session under, in local or session storage. */
export const SESSION_KEY = 'trading-ui.session';

/**
 * A username that is guaranteed not to exist, and different on every call.
 *
 * The auth service locks a username out after five failed sign-ins in fifteen minutes, so
 * testing a refusal with the real account would eventually lock out every other test in the
 * suite. A name no one can hold cannot be locked out and cannot belong to anybody.
 */
export function unusedUsername(): string {
  return `e2e-no-such-user-${Date.now()}`;
}