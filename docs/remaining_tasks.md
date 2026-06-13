# anmika Remaining Tasks

Updated: 2026-06-13

## Status

All short-term remaining tasks from the 2026-06-13 project sweep are complete.

## Completed Items

### 1. Svelte Warning Cleanup

Status: done

- `npm.cmd run check` now reports 0 errors and 0 warnings.
- Removed the unused `hostUserId` export from `src/lib/OnlineGameView.svelte`.
- Removed stale unused CSS from `src/App.svelte`.

### 2. Production Build Chunk Warning

Status: done

- `npm.cmd run build` succeeds without chunk-size warnings.
- `vite.config.ts` now documents the intentional large lazy-loaded dice-box physics chunks and raises the warning limit accordingly.

### 3. Debug / Console Log Audit

Status: done

- Added `dwarn` and `derror` alongside `dlog` in `src/lib/helpers.ts`.
- Moved app/game/dice debug output through debug-gated helpers.
- Added `ANMIKA_WS_LOG=0` control for `server/ws_server.ts`.
- Remaining direct console usage is limited to helper exits, DebugLogPanel console capture, CLI plumbing, and tests.

### 4. One-Command Online E2E

Status: done

- Added `tools/run_online_e2e.mjs`.
- Added package script: `npm run e2e:online`.
- The runner builds the app, starts FastAPI with test auth and isolated SQLite, runs `tests/online.spec.ts`, and stops the server.

### 5. Docs Cleanup

Status: done

- Replaced the old mixed TODO/progress notes with focused current docs:
  - `docs/todo.md`
  - `docs/progress.md`
  - `docs/remaining_tasks.md`

## Current Routine Gate

Use this as the normal pre-push/pre-release gate:

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
npm.cmd run e2e:local
npm.cmd run e2e:online
```

For `npm.cmd run e2e:online`, make sure the selected Python interpreter has `server/requirements.txt` installed. If needed:

```powershell
python -m venv .venv-online-e2e
.\.venv-online-e2e\Scripts\python.exe -m pip install -r server\requirements.txt
$env:PYTHON = (Resolve-Path -LiteralPath '.\.venv-online-e2e\Scripts\python.exe').Path
npm.cmd run e2e:online
```
