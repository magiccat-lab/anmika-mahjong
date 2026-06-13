import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const port = Number(process.env.ANMIKA_LOCAL_E2E_PORT || 4273);
const host = process.env.ANMIKA_LOCAL_E2E_HOST || '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const tmpDir = path.join(root, '.tmp');

function cmdShimArgs(cmd, args) {
  return isWin && cmd.endsWith('.cmd')
    ? { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', [cmd, ...args].join(' ')] }
    : { cmd, args };
}

function run(cmd, args, opts = {}) {
  const shim = cmdShimArgs(cmd, args);
  const res = spawnSync(shim.cmd, shim.args, {
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

function spawnManaged(cmd, args, opts = {}) {
  const shim = cmdShimArgs(cmd, args);
  return spawn(shim.cmd, shim.args, {
    cwd: root,
    shell: false,
    ...opts,
  });
}

function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) {
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

async function localSpecFiles() {
  const names = await readdir(path.join(root, 'tests'));
  return names
    .filter((name) => name.endsWith('.spec.ts') && name !== 'online.spec.ts')
    .map((name) => `tests/${name}`);
}

async function main() {
  if (await isPortOpen(port)) {
    throw new Error(`Port ${port} is already in use`);
  }
  mkdirSync(tmpDir, { recursive: true });
  run(npmCmd, ['run', 'build']);

  const env = {
    ...process.env,
    ANMIKA_BASE_URL: baseUrl,
    ANMIKA_E2E_SERVER_AUTH: '0',
    ANMIKA_N_MATCHES: process.env.ANMIKA_N_MATCHES || '2',
  };
  const preview = spawnManaged(npxCmd, ['vite', 'preview', '--host', host, '--port', String(port)], {
    env,
    stdio: 'inherit',
  });

  let exitCode = 0;
  try {
    await waitForHttp(baseUrl);
    run(npxCmd, ['playwright', 'test', ...(await localSpecFiles())], { env });
  } catch (e) {
    exitCode = 1;
    console.error(e?.stack || e);
  } finally {
    await stopProcess(preview);
  }
  process.exit(exitCode);
}

main();
