// [2026-10-14 リョー、演出のラフ 2 版「他の人の画面」] 白ぽっちの絞りの進みの中継。
// 契約 [client 側が合わせる物]:
// - client→server { type:'pochiFx', phase:'open'|'peel'|'reveal'|'close', ... }。server は送った席を seat に付けて全員と観戦へ配る
// - 色は peel 0.4 から ・ reveal の時だけ通す [点がのぞく前に色を流さない]。reveal に色が無ければ捨てる
// - 1 席 1 秒 30 通まで、open は 2 秒に 1 回 [連打で他の画面を塞がない]
import jwt from 'jsonwebtoken';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { allowPochiFx, createWsRuntime, sanitizePochiFx } from '../../../server/ws_server';

const SECRET = 'ws-pochi-fx-secret';

type Client = { ws: WebSocket; messages: any[] };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, timeoutMs = 4000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await sleep(10);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.on('error', () => { /* noop */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

async function startFakeApi() {
  const members = [
    { seat: 0, user_id: 'u0', username: 'u0' },
    { seat: 1, user_id: 'u1', username: 'u1' },
    { seat: 2, user_id: 'u2', username: 'u2' },
  ];
  const api: Server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ members, match_mode: 'tonpu', rotation_enabled: false }));
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('fake API did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function bootRoom(roomId: string) {
  const apiBase = await startFakeApi();
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    apiBase,
    wsSecret: SECRET,
    internalApiSecret: SECRET,
    persistence: new RoomPersistence(':memory:'),
    reactionTimeoutMs: 60_000,
    turnTimeoutMs: 60_000,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: 60_000,
    nextRoundTimeoutMs: 60_000,
    testControlsEnabled: true,
    log: false,
  });
  cleanups.push(async () => runtime.close());
  const wsAddress = runtime.wss.address();
  if (!wsAddress || typeof wsAddress === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const url = (uid: string, seat: number, isHost = false) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: roomId, room_instance_id: `${roomId}-instance`,
      is_host: isHost, iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${wsAddress.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
  };
  const clients: Client[] = [];
  for (let seat = 0; seat < 3; seat += 1) {
    const client = await connect(url(`u${seat}`, seat, seat === 0));
    await waitUntil(() => client.messages.find((m) => m.type === 'lobby'), 4000, 'registered');
    clients.push(client);
  }
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'start'), 4000, 'start')));
  const room = runtime.rooms.get(roomId)!;
  return { room, clients };
}


describe('白ぽっちの絞りの中継 [2026-10-14]', () => {
  it('色は 0.4 より前は落とし、reveal は色が無ければ捨てる', () => {
    expect(sanitizePochiFx({ phase: 'peel', peel: 0.2, color: 'red' })).toEqual({ phase: 'peel', peel: 0.2 });
    expect(sanitizePochiFx({ phase: 'peel', peel: 0.45, color: 'red' })).toEqual({ phase: 'peel', peel: 0.45, color: 'red' });
    expect(sanitizePochiFx({ phase: 'reveal', color: 'blue' })).toEqual({ phase: 'reveal', peel: 1, color: 'blue' });
    expect(sanitizePochiFx({ phase: 'reveal' })).toBeNull();
    expect(sanitizePochiFx({ phase: 'peel', peel: 2 })).toBeNull();
    expect(sanitizePochiFx({ phase: 'peel', peel: 0.5, color: 'purple' })).toEqual({ phase: 'peel', peel: 0.5 });
    expect(sanitizePochiFx({ phase: 'hack' })).toBeNull();
    expect(sanitizePochiFx({ phase: 'open', deka: 'p1', kakutei: 'good', glow: ['gold', 'rainbow'] }))
      .toEqual({ phase: 'open', deka: 'p1', kakutei: 'good', glow: ['gold', 'rainbow'] });
    expect(sanitizePochiFx({ phase: 'open', deka: 'x', glow: ['<b>', 1] })).toEqual({ phase: 'open', deka: null, kakutei: null, glow: ['white', 'white'] });
    // 4 版: 段 (0〜4) とプレミアも通す。範囲の外 ・ 型違いは落とす
    expect(sanitizePochiFx({ phase: 'open', step: 4, premium: true })).toMatchObject({ step: 4, premium: true });
    expect(sanitizePochiFx({ phase: 'open', step: 7, premium: 'yes' })).not.toHaveProperty('step');
    expect(sanitizePochiFx({ phase: 'open', step: 2.5, premium: 'yes' })).not.toHaveProperty('premium');
    // 予告の種類 (稲妻 ・ 決め台詞) も通す。知らない値は落とす
    expect(sanitizePochiFx({ phase: 'open', teaser: 'line' })).toMatchObject({ teaser: 'line' });
    expect(sanitizePochiFx({ phase: 'open', teaser: '<script>' })).not.toHaveProperty('teaser');
  });

  it('1 秒 30 通まで、open は 2 秒に 1 回', () => {
    const room = {};
    let ok = 0;
    for (let i = 0; i < 50; i++) if (allowPochiFx(room, 0, 'peel', 1000 + i)) ok++;
    expect(ok).toBe(30);
    expect(allowPochiFx(room, 0, 'peel', 2100)).toBe(true);
    expect(allowPochiFx(room, 1, 'open', 2100)).toBe(true);
    expect(allowPochiFx(room, 1, 'open', 3000)).toBe(false);
    expect(allowPochiFx(room, 1, 'open', 4200)).toBe(true);
  });

  it('引いた人の進みが他の席に届く (送った席の seat 付き、色は 0.4 から)', async () => {
    const { clients } = await bootRoom('PF0001');
    clients[0].ws.send(JSON.stringify({ type: 'pochiFx', phase: 'open', deka: null, kakutei: null, glow: ['white', 'gold'] }));
    clients[0].ws.send(JSON.stringify({ type: 'pochiFx', phase: 'peel', peel: 0.3, color: 'green' }));
    clients[0].ws.send(JSON.stringify({ type: 'pochiFx', phase: 'peel', peel: 0.5, color: 'green' }));
    clients[0].ws.send(JSON.stringify({ type: 'pochiFx', phase: 'reveal', color: 'green' }));
    const got = await waitUntil(() => {
      const list = clients[1].messages.filter((m) => m.type === 'pochiFx');
      return list.length >= 4 ? list : undefined;
    }, 3000, 'relay to seat 1');
    expect(got.map((m) => m.phase)).toEqual(['open', 'peel', 'peel', 'reveal']);
    expect(got.every((m) => m.seat === 0)).toBe(true);
    expect(got[0].glow).toEqual(['white', 'gold']);
    expect(got[1].color).toBeUndefined();
    expect(got[2].color).toBe('green');
    expect(got[3]).toMatchObject({ peel: 1, color: 'green' });
  });
});
