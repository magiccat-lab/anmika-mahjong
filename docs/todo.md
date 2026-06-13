# anmika TODO

Updated: 2026-06-13

## Short-Term Status

No known short-term cleanup blockers remain after the 2026-06-13 sweep.

The previous cleanup list is tracked in `docs/remaining_tasks.md` and has been completed:

- Svelte warnings reduced to 0.
- Production build chunk warning is intentionally managed in `vite.config.ts`.
- Browser/server debug logging is centralized behind debug/log gates.
- Online E2E can be run with one command: `npm run e2e:online`.
- Old docs were refreshed into this shorter TODO and `docs/progress.md`.

## Release Gate

Run these before release or deployment:

- `npm.cmd run check`
- `npm.cmd run build`
- `npm.cmd test`
- `npm.cmd run e2e:local`
- `npm.cmd run e2e:online`

For online E2E, use a Python interpreter with `server/requirements.txt` installed and set `PYTHON` if it is not on PATH.

## Maintenance Backlog

These are not current blockers, but are worth doing when the project has a cleanup window.

- Add `npm run e2e:online` to CI once the CI runner has Python server dependencies.
- Add `npm run e2e:local` to CI for browser regression coverage that does not need the FastAPI server.
- Revisit bundle splitting if the dice-box lazy chunks grow substantially beyond the current intentional size.
- Keep `rg -n "console\\.(log|debug|warn|error)" src server tools` limited to logging wrappers, test code, and CLI plumbing.
- Keep old rule/spec notes in focused docs instead of growing one large mixed TODO.
- Periodically run the online E2E after touching room, auth, websocket, nextRound, nextMatch, or SaiKoro flows.
