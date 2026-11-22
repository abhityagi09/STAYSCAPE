import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real API, MongoDB, Redis and Mailpit.
 *
 *   npm run services:up      # MongoDB replica set, Redis, Mailpit
 *   npm run test:e2e         # starts API + web automatically unless already running
 *
 * Set E2E_BASE_URL (e.g. http://localhost:8080 for the Docker stack) to test an existing
 * deployment; no servers are started in that case.
 */
const external = process.env.E2E_BASE_URL;
const baseURL = external || 'http://localhost:5173';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive/ },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'npm run dev:api',
          url: 'http://localhost:4000/health/ready',
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'npm run dev -w @stayscape/web',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
