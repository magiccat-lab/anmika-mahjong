// [2026-10-15 リョー ○ anmika-fuyu1 の 3] 冬冬金北の冬めくりの中継。
// 契約 [client 側が合わせる物]:
// - client→server { type:'fuyuFx', opened:<めくった枚数> }。server は送った席を seat に付けて全員と観戦へ配る
// - 流すのは枚数だけ。牌と当たりは全員の和了の結果に入っている。整数で 0〜128 の外は捨てる
// - 間引きは白ぽっちの絞りと同じ枠 (1 席 1 秒 30 通)
import jwt from 'jsonwebtoken';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime, sanitizeFuyuFx } from '../../../server/ws_server';

const SECRET = 'ws-fuyu-fx-secret';

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


describe('冬冬金北のめくりの中継 [2026-10-15]', () => {
  it('枚数だけを通し、整数でない ・ 範囲の外は捨てる', () => {
    expect(sanitizeFuyuFx({ opened: 3, pai: 'p5', hit: 9 })).toEqual({ opened: 3 });
    expect(sanitizeFuyuFx({ opened: 0 })).toEqual({ opened: 0 });
    expect(sanitizeFuyuFx({ opened: -1 })).toBeNull();
    expect(sanitizeFuyuFx({ opened: 2.5 })).toBeNull();
    expect(sanitizeFuyuFx({ opened: '3' })).toBeNull();
    expect(sanitizeFuyuFx({ opened: 999 })).toBeNull();
    expect(sanitizeFuyuFx({})).toBeNull();
  });

  it('和了った人のめくった枚数が他の席に届く (送った席の seat 付き、余計な物は落ちる)', async () => {
    const { clients } = await bootRoom('FF0001');
    for (const opened of [1, 2, 5]) clients[2].ws.send(JSON.stringify({ type: 'fuyuFx', opened, pai: 'z5y' }));
    clients[2].ws.send(JSON.stringify({ type: 'fuyuFx', opened: 'x' }));
    const got = await waitUntil(() => {
      const list = clients[0].messages.filter((m) => m.type === 'fuyuFx');
      return list.length >= 3 ? list : undefined;
    }, 3000, 'relay to seat 0');
    await sleep(150);
    expect(clients[0].messages.filter((m) => m.type === 'fuyuFx')).toHaveLength(3);
    expect(got.map((m) => m.opened)).toEqual([1, 2, 5]);
    expect(got.every((m) => m.seat === 2 && !('pai' in m))).toBe(true);
  });
});
