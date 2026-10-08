// [2026-10-09 遊真 A1 回帰] 壊れた WebSocket frame で process が落ちない。
//
// 旧実装は wss.on('connection') に ws.on('error') が無く、token 無しの接続が RSV1 立ちの frame を
// 1 つ送るだけで WS_ERR_UNEXPECTED_RSV_1 が uncaught になり、全部屋ごと server が落ちた。
// ここでは生 TCP socket で valid な upgrade を通してから RSV1 frame を書き、その後も同じ runtime が
// 新しい接続を捌けること [= process が生きている] を確かめる。
// uncaught が出ると vitest がテストを fail にするので、listener 抜きでは赤くなる。
import { connect as netConnect, type Socket } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** valid な upgrade handshake を通した生 socket を返す [101 まで読む] */
async function rawUpgrade(port: number, path: string): Promise<Socket> {
  const socket = netConnect({ host: '127.0.0.1', port });
  cleanups.push(async () => { socket.destroy(); });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  socket.on('error', () => { /* server 側の terminate [ECONNRESET] を error 扱いにしない */ });
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '', '',
  ].join('\r\n'));
  await new Promise<void>((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('upgrade did not complete')), 3000);
    socket.on('data', function onData(chunk) {
      buffered += chunk.toString('latin1');
      if (buffered.includes('\r\n\r\n')) {
        clearTimeout(timer);
        socket.off('data', onData);
        if (!buffered.startsWith('HTTP/1.1 101')) reject(new Error(`unexpected handshake: ${buffered.split('\r\n')[0]}`));
        else resolve();
      }
    });
  });
  return socket;
}

describe('malformed websocket frame [2026-10-09 A1]', () => {
  it('RSV1 立ちの frame を token 無し接続から送られても runtime は落ちず、次の接続を捌ける', async () => {
    const runtime = createWsRuntime({
      port: 0,
      internalPort: 0,
      wsSecret: 'ws-malformed-secret',
      internalApiSecret: '',
      persistence: new RoomPersistence(':memory:'),
      log: false,
    });
    cleanups.push(async () => runtime.close());
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');

    const socket = await rawUpgrade(address.port, '/ws/room/E123');
    // FIN + RSV1 + text [0xC1]、mask あり・長さ 0 [0x80] + mask key 4 byte。permessage-deflate は未交渉なので
    // ws の receiver は WS_ERR_UNEXPECTED_RSV_1 を emit する
    socket.write(Buffer.from([0xc1, 0x80, 0x01, 0x02, 0x03, 0x04]));
    await sleep(200);

    // 生きている: 新しい正規の接続が受理され、token 無しは従来どおり 4401 で閉じられる
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/room/E123`);
      const timer = setTimeout(() => reject(new Error('no close from live runtime')), 3000);
      ws.on('error', () => { /* close code で判定する */ });
      ws.on('close', (code) => { clearTimeout(timer); resolve(code); });
    });
    expect(closeCode).toBe(4401);
    expect(runtime.wss.clients.size).toBeLessThanOrEqual(1);
  });

  it('upgrade 後に壊れた frame を送る接続は terminate され、wss は新規接続を受け続ける', async () => {
    const runtime = createWsRuntime({
      port: 0,
      internalPort: 0,
      wsSecret: 'ws-malformed-secret-2',
      internalApiSecret: '',
      persistence: new RoomPersistence(':memory:'),
      log: false,
    });
    cleanups.push(async () => runtime.close());
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');

    // 3 回続けて壊れた frame を送っても落ちない
    for (let i = 0; i < 3; i += 1) {
      const socket = await rawUpgrade(address.port, '/ws/room/E123');
      socket.write(Buffer.from([0xc1, 0x80, 0x0a, 0x0b, 0x0c, 0x0d]));
    }
    await sleep(200);
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/room/E123`);
    ws.on('error', () => { /* noop */ });
    const code = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no close from live runtime')), 3000);
      ws.on('close', (closeCode) => { clearTimeout(timer); resolve(closeCode); });
    });
    expect(code).toBe(4401);
  });
});
