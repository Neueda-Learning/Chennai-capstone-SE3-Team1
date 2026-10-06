import { expect, test, type Page } from '@playwright/test';

import { balance, rupees, signedInAs } from './api';
import { SESSION_KEY } from './test-user';

test.describe('Signed-in shell', () => {
  test('the sidebar names the account that is signed in', async ({ page }) => {
    await page.goto('/app/dashboard');

    const { username } = await signedInAs(page);
    await expect(page.getByTestId('sidebar-name')).toHaveText(username);
    await expect(page.getByTestId('sidebar-email')).toContainText('@');
  });

  test('signing out ends the session and guards the app again', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(page.getByTestId('navbar-name')).toBeVisible();

    await page.locator('.navbar-profile-btn').click();
    await page.getByTestId('logout').click();

    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY)).toBeNull();

    await page.goto('/app/orders');
    await expect(page).toHaveURL(/\/login\?/);
  });
});

test.describe('Dashboard', () => {
  test('it reports the cash the trading service actually holds', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(page.getByTestId('cash')).toBeVisible();

    const { username } = await signedInAs(page);
    const { cashBalance } = await balance(page);

    await expect(page.getByTestId('cash')).toHaveText(rupees.format(cashBalance));
    await expect(page.getByTestId('navbar-name')).toHaveText(username);
  });

  test('it shows the recent orders, the watchlist and the price alerts instead of failing to load', async ({ page }) => {
    await page.goto('/app/dashboard');

    await expect(page.getByTestId('load-failed')).toBeHidden();
    await expect(page.getByTestId('no-account')).toBeHidden();
    await expect(page.getByTestId('recent-order').first()).toBeVisible();
    await expect(page.getByTestId('dashboard-watchlists')).toBeVisible();
    await expect(page.getByTestId('dashboard-alerts')).toBeVisible();
  });
});

test.describe('Portfolio', () => {
  test('it loads the holdings and the cash beside them', async ({ page }) => {
    await page.goto('/app/portfolio');

    await expect(page.getByTestId('load-failed')).toBeHidden();
    await expect(page.getByTestId('holdings-empty')).toBeHidden();
    await expect(page.getByTestId('holdings-table')).toBeVisible();
    await expect(page.getByTestId('cash')).toHaveText(rupees.format((await balance(page)).cashBalance));
  });

  test('the sidebar moves between the trading pages', async ({ page }) => {
    await page.goto('/app/dashboard');

    await page.getByRole('link', { name: 'Market & Trade' }).click();
    await expect(page).toHaveURL(/\/app\/orders$/);

    await page.getByRole('link', { name: 'Blotter' }).click();
    await expect(page).toHaveURL(/\/app\/blotter$/);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
  });
});