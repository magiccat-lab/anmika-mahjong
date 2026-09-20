import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'line',
  use: {
    // [2026-09-20 堅牢性レビュー §5] 本番 API は同じホストの 8790 に居る。
    // 8790 を掴むと test login が 404 で落ち、部屋を作るテストが本番 DB に書く。
    // e2e 専用の 18790 に移し、既存サーバの再利用も切る
    baseURL: 'http://127.0.0.1:18790',
  },
  webServer: [
    {
      // ANMIKA_DB_PATH を渡さないと server/app.py:80-84 の既定で
      // server/data/anmika.db = 本番 DB を開く。ポートを変えただけでは隔離にならない
      // [codex ANMIKA-ROBUST-01 §4 の指摘]
      // 素の python には jwt が無い。本番と同じ server/.venv を使う
      // (start_prod.sh の PY と同じ)
      command: 'ANMIKA_TEST_AUTH=1 ANMIKA_DB_PATH=tmp/e2e/anmika-e2e.db server/.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 18790',
      port: 18790,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
