import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  // R14 follow-up: 一括 run で context 間干渉の flaky [force_paths 等]、
  // retry=1 で 2 回目 isolation 試行、 game logic regression は vitest で覆われる
  retries: 1,
  reporter: 'line',
});
