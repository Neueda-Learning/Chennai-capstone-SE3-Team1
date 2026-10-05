export const testUser = {
  username: process.env['TEST_USERNAME'] ?? 'nadellaroshni2',
  password: process.env['TEST_PASSWORD'] ?? 'Roshni@22036'
};

export const storageStatePath = 'e2e/.auth/user.json';

export const SESSION_KEY = 'trading-ui.session';

export function unusedUsername(): string {
  return `e2e-no-such-user-${Date.now()}`;
}