import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const localBin = (name) => path.join(root, 'node_modules', '.bin', `${name}${isWin ? '.cmd' : ''}`);
const viteCmd = localBin('vite');
const playwrightCmd = localBin('playwright');
const port = Number(process.env.ANMIKA_E2E_PORT || 8790);
const wsPort = Number(process.env.ANMIKA_E2E_WS_PORT || (port + 1));
const host = process.env.ANMIKA_E2E_HOST || '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const tmpDir = path.join(root, '.tmp');
const dbPath = path.join(tmpDir, 'online-e2e.sqlite3');

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
  if (await isPortOpen(port)) {
    throw new Error(`Port ${port} is already in use`);
  }
  if (await isPortOpen(wsPort)) {
    throw new Error(`Port ${wsPort} is already in use`);
  }
  mkdirSync(tmpDir, { recursive: true });
  rmSync(dbPath, { force: true });

  const python = resolvePython();
  run(viteCmd, ['build']);

  const secret = process.env.ANMIKA_E2E_SECRET || 'anmika-online-e2e-secret-2026-06-13';
  const env = {
    ...process.env,
    ANMIKA_TEST_AUTH: '1',
    ANMIKA_REQUIRE_SECRET: '0',
    ANMIKA_SESSION_SECRET: secret,
    ANMIKA_WS_SECRET: secret,
    ANMIKA_INTERNAL_SECRET: secret,
    ANMIKA_DB_PATH: dbPath,
    ANMIKA_PUBLIC_BASE_URL: baseUrl,
    ANMIKA_WS_PUBLIC_URL: `ws://${host}:${wsPort}`,
    ANMIKA_API_BASE: baseUrl,
    ANMIKA_WS_PORT: String(wsPort),
  };
  const wsServer = spawn(
    process.execPath,
    ['--import', 'tsx', 'server/ws_server.ts'],
    { cwd: root, env, stdio: 'inherit', shell: false },
  );
  const server = spawn(
    python.cmd,
    [...python.args, '-m', 'uvicorn', 'server.app:app', '--host', host, '--port', String(port)],
    { cwd: root, env, stdio: 'inherit', shell: false },
  );

  let exitCode = 0;
  try {
    await waitForHttp(baseUrl);
    run(playwrightCmd, ['test', 'tests/online.spec.ts', 'tests/lizhi_bugs.spec.ts'], {
      env: { ANMIKA_BASE_URL: baseUrl, ANMIKA_E2E_SERVER_AUTH: '1' },
    });
  } catch (e) {
    exitCode = 1;
    console.error(e?.stack || e);
  } finally {
    await stopProcess(server);
    await stopProcess(wsServer);
  }
  process.exit(exitCode);
}

main();
