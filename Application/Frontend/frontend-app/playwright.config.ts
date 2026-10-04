import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for the Trading UI.
 *
 * The suite runs against the real stack, so two things have to be up before it starts:
 *
 *   - the backend, brought up from the repo root with `.\run-local.ps1`
 *     (Kafka, Postgres, auth service on :3000, Trade API on :8081, executor on :8083)
 *   - the Angular dev server on :4200, started here by `webServer` unless one is
 *     already running
 *
 * Credentials and the UI address come from `.env.test` (git-ignored; see `.env.test.example`),
 * falling back to the defaults below so a fresh clone works with no setup at all.
 *
 * Commands:
 *   npm run test:e2e          headless, every project
 *   npm run test:e2e:ui       the interactive inspector
 *   npm run test:e2e:debug    same, paused on the first action
 *   npm run test:e2e:report   re-open the last HTML report
 */
try {
  process.loadEnvFile('.env.test');
} catch {
  // No .env.test on this machine - the defaults below are used instead.
}

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    // Signs in once and leaves the session in `e2e/.auth/user.json` for the projects below,
    // so no journey pays for a sign-in it does not care about.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' }
    },
    {
      name: 'firefox',
      dependencies: ['setup'],
      use: { ...devices['Desktop Firefox'], storageState: 'e2e/.auth/user.json' }
    }
  ],

  webServer: {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000
  }
});