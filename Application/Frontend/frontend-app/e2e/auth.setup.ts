import { expect, test as setup } from '@playwright/test';

import { storageStatePath, testUser } from './test-user';

/**
 * Signs the test user in once and caches the session for the authenticated projects.
 *
 * "Remember Me" is ticked on purpose: an unticked sign-in lives in `sessionStorage`, which a
 * storage state does not carry between browser contexts, so the cached session would be empty
 * and every downstream test would be bounced to the login screen.
 */
setup('sign in as the test user', async ({ page }) => {
  await page.goto('/login');

  await page.getByTestId('username').fill(testUser.username);
  await page.getByTestId('password').fill(testUser.password);
  await page.getByTestId('remember-me').check();
  await page.getByTestId('submit').click();

  // Whichever way the sign-in goes, one of these two happens first.
  const outcome = await Promise.race([
    page.waitForURL(/\/dashboard$/, { timeout: 20_000 }).then(() => 'signed-in' as const),
    page
      .getByTestId('login-error')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'refused' as const)
  ]);

  if (outcome === 'refused') {
    const reason = await page.getByTestId('login-error').innerText();
    throw new Error(
      `Could not sign in as "${testUser.username}": ${reason}\n` +
        'Check the credentials in .env.test, and that the backend is up (run .\\run-local.ps1 from the repo root).'
    );
  }

  await expect(page.getByTestId('navbar-name')).toHaveText(testUser.username);

  await page.context().storageState({ path: storageStatePath });
});