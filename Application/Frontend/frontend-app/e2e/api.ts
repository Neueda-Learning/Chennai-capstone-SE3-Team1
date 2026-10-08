import { expect, type Page } from '@playwright/test';

import { loadServiceConfig, serviceUrl } from '../scripts/service-config.mjs';
import { SESSION_KEY } from './test-user';

// Where the services are comes from Application/Config/services.env (AUTH_API_BASE / TRADE_API_BASE still override).
const services = loadServiceConfig();
export const AUTH_API = process.env['AUTH_API_BASE'] ?? serviceUrl(services, 'AUTH_SERVICE');
export const TRADE_API = process.env['TRADE_API_BASE'] ?? serviceUrl(services, 'TRADE_API');

export const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

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

export async function signedInAs(page: Page): Promise<{ username: string; accountId: number }> {
  const me = await get<{ username: string; accountId: number | null }>(page, `${AUTH_API}/auth/me`);
  expect(me.accountId, 'the test account has no trading account linked').not.toBeNull();
  return { username: me.username, accountId: me.accountId as number };
}

export function balance(page: Page): Promise<{ cashBalance: number }> {
  return signedInAs(page).then(({ accountId }) =>
    get<{ cashBalance: number }>(page, `${TRADE_API}/api/v1/accounts/${accountId}/balance`)
  );
}

export async function orderHistory(
  page: Page
): Promise<Array<{ orderId: string; side: string; quantity: number; status: string }>> {
  const { accountId } = await signedInAs(page);
  return get(page, `${TRADE_API}/api/v1/accounts/${accountId}/orders`);
}