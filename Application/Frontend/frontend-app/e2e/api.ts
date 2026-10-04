import { expect, type Page } from '@playwright/test';

import { SESSION_KEY } from './test-user';

/**
 * Reading the live services straight from a test, so a screen can be checked against the
 * number the backend actually holds rather than against a hard-coded one. The base paths are
 * the ones the app itself is configured with (`src/app/app.config.ts`).
 */
export const AUTH_API = process.env['AUTH_API_BASE'] ?? 'http://localhost:3000';
export const TRADE_API = process.env['TRADE_API_BASE'] ?? 'http://localhost:8081';

/** The same money format `core/format/money.ts` prints with. */
export const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** The session's bearer token, which the app keeps in local storage. */
export async function bearer(page: Page): Promise<string> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
  const token = raw === null ? null : (JSON.parse(raw) as { accessToken?: string }).accessToken;
  expect(token, 'the cached session carries no access token').toBeTruthy();
  return token as string;
}

async function get<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url, { headers: { Authorization: `Bearer ${await bearer(page)}` } });
  expect(response.ok(), `GET ${url} answered ${response.status()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

/** Who the auth service says is signed in, and which trading account they hold. */
export async function signedInAs(page: Page): Promise<{ username: string; accountId: number }> {
  const me = await get<{ username: string; accountId: number | null }>(page, `${AUTH_API}/auth/me`);
  expect(me.accountId, 'the test account has no trading account linked').not.toBeNull();
  return { username: me.username, accountId: me.accountId as number };
}

/** The wallet balance for the signed-in account. */
export function balance(page: Page): Promise<{ cashBalance: number }> {
  return signedInAs(page).then(({ accountId }) =>
    get<{ cashBalance: number }>(page, `${TRADE_API}/api/v1/accounts/${accountId}/balance`)
  );
}

/** The order and trade history for the signed-in account. */
export async function orderHistory(
  page: Page
): Promise<Array<{ orderId: string; side: string; quantity: number; status: string }>> {
  const { accountId } = await signedInAs(page);
  return get(page, `${TRADE_API}/api/v1/accounts/${accountId}/orders`);
}