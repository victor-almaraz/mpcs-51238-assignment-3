import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3100);

/*
 * End-to-end tests run against the static export served by scripts/serve-out.mjs.
 * Set BASE_URL to test a deployment instead; the local server is then not started.
 * Browsers install under .tools/ms-playwright (PLAYWRIGHT_BROWSERS_PATH, package.json).
 */
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /perf\.spec\.js/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /perf\.spec\.js/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /perf\.spec\.js/ },
    // The CPU benchmark runs alone, after the browser projects, so no other worker shares the CPU.
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /perf\.spec\.js/,
      dependencies: ['chromium', 'firefox', 'webkit'],
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'pnpm build && node scripts/serve-out.mjs',
        url: baseURL,
        env: { PORT: String(PORT) },
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
