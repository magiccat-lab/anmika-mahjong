import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8790',
  },
  webServer: [
    {
      command: 'ANMIKA_TEST_AUTH=1 python -m uvicorn server.app:app --host 127.0.0.1 --port 8790',
      port: 8790,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
