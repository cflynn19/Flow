import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage of the one journey that has to work: sign up, build a workflow,
 * run it, and inspect what happened. It drives the real API and a real Postgres, so a
 * regression anywhere in the stack shows up here.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --prefix ..',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
  },
});
