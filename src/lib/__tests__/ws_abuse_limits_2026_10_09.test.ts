// [2026-10-09 R3] ws の悪用対策: frame 上限 64KB / スタンプは 1 席 1 秒に 1 回 [超えた分は黙って捨てる]
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { allowStamp, createWsRuntime } from '../../../server/ws_server';

const SECRET = 'ws-abuse-limits-secret';

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

async function bootRoom(roomId: string) {
  const persistence = new RoomPersistence(':memory:');
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    wsSecret: SECRET,
    internalApiSecret: '',
    persistence,
    reactionTimeoutMs: 60_000,
    turnTimeoutMs: 60_000,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: 60_000,
    nextRoundTimeoutMs: 60_000,
    log: false,
  });
  cleanups.push(async () => runtime.close());
  const address = runtime.wss.address();
  if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const url = (uid: string, seat: number, isHost = false, spectator = false) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: roomId,
      room_instance_id: `${roomId}-instance`, is_host: isHost, ...(spectator ? { spectator: true } : {}),
      iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
  };
  const clients = await Promise.all([0, 1, 2].map((seat) => connect(url(`u${seat}`, seat, seat === 0))));
  const spectator = await connect(url('watcher', -1, false, true));
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'start'), 4000, 'start')));
  await waitUntil(() => spectator.messages.find((m) => m.type === 'sync' || m.type === 'start'), 4000, 'spectator view');
  const room = runtime.rooms.get(roomId)!;
  return { runtime, persistence, room, clients, spectator };
}


const stampsAt = (client: Client, seat: number) => client.messages.filter((m) => m.type === 'stamp' && m.seat === seat);

describe('ws の悪用対策 [2026-10-09 R3]', () => {
  it('スタンプは 1 席 1 秒に 1 回。連打は黙って捨て、1 秒空ければ通る [別の席は別枠]', async () => {
    const { clients } = await bootRoom('AB0001');
    for (let i = 0; i < 6; i += 1) clients[0].ws.send(JSON.stringify({ type: 'stamp', stampId: 'doko' }));
    clients[1].ws.send(JSON.stringify({ type: 'stamp', stampId: 'plus' }));
    await waitUntil(() => stampsAt(clients[2], 1).length >= 1 ? true : undefined, 3000, 'seat 1 stamp');
    await sleep(300);
    expect(stampsAt(clients[2], 0)).toHaveLength(1);
    expect(stampsAt(clients[2], 1)).toHaveLength(1);
    // action 封筒経由も同じ枠を使う
    clients[0].ws.send(JSON.stringify({
      type: 'action', commandId: 'stamp-via-action-1', expectedVersion: 0, matchId: 1, roundId: 1,
      action: { type: 'stamp', stampId: 'kita4' },
    }));
    await sleep(300);
    expect(stampsAt(clients[2], 0)).toHaveLength(1);
    await sleep(900);
    clients[0].ws.send(JSON.stringify({ type: 'stamp', stampId: 'saikoro' }));
    await waitUntil(() => stampsAt(clients[2], 0).length >= 2 ? true : undefined, 3000, 'stamp after interval');
    expect(stampsAt(clients[2], 0).map((m) => m.stampId)).toEqual(['doko', 'saikoro']);
  }, 20_000);

  it('allowStamp は席ごとの直近時刻で 1 秒未満を弾く', () => {
    const room = { stampLastAt: new Map<number, number>() };
    expect(allowStamp(room, 0, 1000)).toBe(true);
    expect(allowStamp(room, 0, 1999)).toBe(false);
    expect(allowStamp(room, 1, 1500)).toBe(true);
    expect(allowStamp(room, 0, 2000)).toBe(true);
  });

  it('64KB を超える frame は接続ごと閉じられ、通常サイズの frame は通る', async () => {
    const { room, clients } = await bootRoom('AB0002');
    // 通常の command / resync は数百 B。余裕を見た 8KB の frame でも落ちない
    const syncsBefore = clients[1].messages.filter((m) => m.type === 'sync').length;
    clients[1].ws.send(JSON.stringify({ type: 'resync', pad: 'x'.repeat(8 * 1024) }));
    await waitUntil(() => clients[1].messages.filter((m) => m.type === 'sync').length > syncsBefore ? true : undefined, 3000, 'resync with padding');
    const closed = new Promise<number>((resolve) => clients[2].ws.once('close', (code) => resolve(code)));
    clients[2].ws.send(JSON.stringify({ type: 'resync', pad: 'x'.repeat(70 * 1024) }));
    expect(await closed).toBe(1009);
    expect(room.snapshot.started).toBe(true);
  });
});
