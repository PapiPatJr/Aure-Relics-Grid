import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5179',
    browserName: 'chromium',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
  ],
  // Never attach to a pre-existing dev server with unknown environment/state.
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
