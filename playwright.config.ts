import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 50_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    headless: true,
    locale: 'pt-BR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: 'node tests/support/e2e-server.mjs',
    url: `${baseURL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: Boolean(process.env.TEST_BASE_URL),
    env: {
      PORT: new URL(baseURL).port || '3001',
      HOST: '127.0.0.1',
      DB_PATH: process.env.TEST_DB_PATH || `/tmp/vereda-e2e-${process.pid}.sqlite`,
    },
  },
});
