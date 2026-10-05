import { expect, test, type Page } from '@playwright/test';

import { SESSION_KEY, testUser, unusedUsername } from './test-user';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByTestId('username').fill(username);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('submit').click();
}

test.describe('Sign in', () => {
  test('the guard turns a signed-out visitor away from a protected page and keeps the destination', async ({
    page
  }) => {
    await page.goto('/app/orders');

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/app/orders');
    await expect(page.getByTestId('username')).toBeVisible();
  });

  test('an unknown username is refused and leaves no session behind', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, unusedUsername(), 'Whatever-Password-1');

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('trading-ui.session'))).toBeNull();
  });

  test('an empty form is not sent to the auth service', async ({ page }) => {
    await page.goto('/login');

    const signInAttempts: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/auth/login')) {
        signInAttempts.push(request.url());
      }
    });

    await page.getByTestId('submit').click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-error')).toBeHidden();
    expect(signInAttempts).toEqual([]);
  });

  test('the right credentials reach the dashboard with the account in the shell', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, testUser.username, testUser.password);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByTestId('navbar-name')).toHaveText(testUser.username);
  });

  test('signing in returns the visitor to the page the guard turned them away from', async ({ page }) => {
    await page.goto('/app/blotter');
    await expect(page).toHaveURL(/\/login\?/);

    await signIn(page, testUser.username, testUser.password);

    await expect(page).toHaveURL(/\/app\/blotter$/);
    await expect(page.getByRole('heading', { name: 'Blotter' })).toBeVisible();
  });

  test('the session is kept in local storage and survives a reload', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, testUser.username, testUser.password);
    await expect(page).toHaveURL(/\/dashboard$/);

    const stored = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
    expect(stored).not.toBeNull();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();

    await page.reload();
    await expect(page.getByTestId('navbar-name')).toHaveText(testUser.username);
  });

  test('the password can be revealed and hidden again', async ({ page }) => {
    await page.goto('/login');

    const password = page.getByTestId('password');
    await expect(password).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });
});