import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const localBin = (name) => path.join(root, 'node_modules', '.bin', `${name}${isWin ? '.cmd' : ''}`);
const viteCmd = localBin('vite');
const playwrightCmd = localBin('playwright');
// [2026-10-09 遊真 D1] 既定ポートを本番 [8790 api / 8791 ws / 8792 ws internal / 8080 static] から離す。
// 旧既定 8790 は本番 API で、本番が動いている間は「使用中」で落ちるか、環境次第で本番に test login/部屋作成を打ち得た。
// api 18990 / ws 18991 / ws internal 18992 [e2e 専用。18790 は playwright.config、18890-18893 は rotation_cycle]
const port = Number(process.env.ANMIKA_E2E_PORT || 18990);
const wsPort = Number(process.env.ANMIKA_E2E_WS_PORT || (port + 1));
const wsInternalPort = Number(process.env.ANMIKA_E2E_WS_INTERNAL_PORT || (wsPort + 1));
const host = process.env.ANMIKA_E2E_HOST || '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const PRODUCTION_PORTS = [8790, 8791, 8792, 8080];

function run(cmd, args, opts = {}) {
  const useCmdShim = isWin && cmd.endsWith('.cmd');
  const res = spawnSync(useCmdShim ? (process.env.ComSpec || 'cmd.exe') : cmd, useCmdShim ? ['/d', '/s', '/c', cmd, ...args] : args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...opts.env },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit ${res.status}`);
  }
}

function canRunPython(cmd, args) {
  const res = spawnSync(cmd, [...args, '-c', 'import fastapi, uvicorn, jwt'], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
  });
  return res.status === 0;
}

function resolvePython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
  candidates.push(['python', []]);
  candidates.push(['python3', []]);
  if (isWin) candidates.push(['py', ['-3']]);
  for (const [cmd, args] of candidates) {
    if (canRunPython(cmd, args)) return { cmd, args };
  }
  throw new Error(
    'Python with server deps not found. Install server/requirements.txt or run with PYTHON pointing at that interpreter.',
  );
}

function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.status < 500) {
          resolve();
          return;
        }
      } catch {}
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

function isPortOpen(portNo) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: portNo });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  if (isWin) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function main() {
  // 環境変数で本番ポートを指されても走らせない [本番 DB / 本番 ws に test login を打たない]
  for (const p of [port, wsPort, wsInternalPort]) {
    if (PRODUCTION_PORTS.includes(p)) {
      throw new Error(`Port ${p} is a production port; refusing to run the e2e stack on it`);
    }
  }
  for (const p of [port, wsPort, wsInternalPort]) {
    if (await isPortOpen(p)) {
      throw new Error(`Port ${p} is already in use`);
    }
  }

  const python = resolvePython();
  run(viteCmd, ['build']);

  // [2026-10-09 遊真 D1] api [server/app.py] と ws [server/persistence.ts] は別々の sqlite を使う
  // [本番も別ファイル]。旧版は同じ ANMIKA_DB_PATH を両方に渡し、起動時に 4 回中 2 回前後
  // `database is locked` になった。両者とも ANMIKA_DB_PATH を読むので、プロセスごとに別の値を渡す
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'anmika-online-e2e-'));
  const apiDbPath = path.join(tmpDir, 'api.sqlite3');
  const wsDbPath = path.join(tmpDir, 'ws.sqlite3');

  const secret = process.env.ANMIKA_E2E_SECRET || 'anmika-online-e2e-secret-2026-06-13';
  const env = {
    ...process.env,
    ANMIKA_TEST_AUTH: '1',
    ANMIKA_REQUIRE_SECRET: '0',
    ANMIKA_SESSION_SECRET: secret,
    ANMIKA_WS_SECRET: secret,
    ANMIKA_INTERNAL_SECRET: secret,
    ANMIKA_PUBLIC_BASE_URL: baseUrl,
    ANMIKA_WS_PUBLIC_URL: `ws://${host}:${wsPort}`,
    ANMIKA_API_BASE: baseUrl,
    ANMIKA_WS_PORT: String(wsPort),
    ANMIKA_WS_INTERNAL_PORT: String(wsInternalPort),
    ANMIKA_WS_INTERNAL_BASE: `http://${host}:${wsInternalPort}`,
  };
  const wsServer = spawn(
    process.execPath,
    ['--import', 'tsx', 'server/ws_server.ts'],
    { cwd: root, env: { ...env, ANMIKA_DB_PATH: wsDbPath }, stdio: 'inherit', shell: false },
  );
  const server = spawn(
    python.cmd,
    [...python.args, '-m', 'uvicorn', 'server.app:app', '--host', host, '--port', String(port)],
    { cwd: root, env: { ...env, ANMIKA_DB_PATH: apiDbPath }, stdio: 'inherit', shell: false },
  );

  let exitCode = 0;
  try {
    await waitForHttp(baseUrl);
    run(playwrightCmd, ['test', 'tests/online.spec.ts', 'tests/lizhi_bugs.spec.ts', 'tests/rotation_4p.spec.ts', 'tests/rotation_cycle.spec.ts'], {
      // [2026-07-24 4人回し] rotation_4p の negative test [test seam が通常起動で 404] 用に
      // runner の ws internal port と secret を渡す。rotation_cycle は自前 harness stack を張る
      env: {
        ANMIKA_BASE_URL: baseUrl,
        ANMIKA_E2E_SERVER_AUTH: '1',
        ANMIKA_E2E_WS_INTERNAL: `http://${host}:${wsInternalPort}`,
        ANMIKA_E2E_INTERNAL_SECRET: secret,
      },
    });
  } catch (e) {
    exitCode = 1;
    console.error(e?.stack || e);
  } finally {
    await stopProcess(server);
    await stopProcess(wsServer);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
  process.exit(exitCode);
}

main();
