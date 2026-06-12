# anmika Progress

Updated: 2026-06-13

## Current State

The project is green on the local quality gates used for the cleanup sweep.

- Unit/regression tests: green.
- Svelte/TypeScript check: 0 errors, 0 warnings.
- Production build: success with no Svelte or chunk-size warnings.
- Playwright smoke: green.
- Online E2E: green through `npm run e2e:online`.

## 2026-06-13 Cleanup

Completed the remaining cleanup tasks from `docs/remaining_tasks.md`.

- Removed stale Svelte warning sources:
  - deleted unused `OnlineGameView.hostUserId` prop.
  - removed dead CSS selectors for old center/dora/side-player/agari-right layouts.
- Centralized debug logging:
  - added `dwarn` and `derror` next to `dlog`.
  - moved browser gameplay logs through debug-gated helpers.
  - added `ANMIKA_WS_LOG=0` control for Node websocket server logs.
- Managed intentional dice-box lazy chunk size:
  - added `build.chunkSizeWarningLimit` with an explanatory comment.
- Added online E2E runner:
  - `tools/run_online_e2e.mjs`
  - `npm run e2e:online`
  - runs build, starts FastAPI with test auth and an isolated SQLite DB, runs `tests/online.spec.ts`, then stops the server.
- Refreshed docs:
  - `docs/todo.md`
  - `docs/progress.md`
  - `docs/remaining_tasks.md`

## Useful Commands

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
$env:PYTHON = (Resolve-Path -LiteralPath '.\.venv-online-e2e\Scripts\python.exe').Path
npm.cmd run e2e:online
```

