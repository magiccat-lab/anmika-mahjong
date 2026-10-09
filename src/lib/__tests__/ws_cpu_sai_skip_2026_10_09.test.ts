// [2026-10-09 shun] リョー「CPUのサイコロは即結果が出るようにスキップできるボタンもつけて」。
//
// 契約 [client 側が合わせる物]:
// - client→server { type:'skipCpuSai' }。今のサイコロの持ち主が CPU [CPU 席か CPU 代行] の時だけ受ける
// - 受けたら server は { type:'cpuSaiFast' } を全員に配り、今のサイコロが終わるまで CPU の出目宣言と振りの刻みを詰める
//   [次のチャンスへ進む前だけ結果を読めるように待つ]。人間のサイコロでは何もしない
// サイコロの pending は ws_match_record の試験と同じく canonical に直接立て、CPU 代行 [setCpuProxy] で持ち主を CPU にする。
import jwt from 'jsonwebtoken';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';

const SECRET = 'ws-cpu-sai-skip-secret';

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

/** 終わった試合にサイコロの pending を立てる [持ち主 winner、4 投] */
function plantSai(room: any, winner: number) {
  const internal = room.authority!.canonicalState();
  internal.pendingSaiKoro = {
    winner,
    chances: [{ name: 'skip-test', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+', winner, rollCount: 4 }],
    currentIdx: 0,
    selectedCombo: null,
    rolls: [],
    finalized: false,
    summary: null,
  } as any;
}

describe('CPU のサイコロのスキップ [2026-10-09]', () => {
  it('持ち主が CPU 代行なら、スキップで出目宣言と 4 投が 1 秒以内に終わり、全員に cpuSaiFast が届く', async () => {
    const { room, clients } = await bootRoom('SK0001');
    plantSai(room, 1);
    // host が席 1 を CPU に替える → server が post-win の刻み [出目宣言 1.5 秒] を張る
    clients[0].ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 1, on: true }));
    await waitUntil(() => (room.members.get('u1') as any)?.cpuProxy === true || undefined, 2000, 'cpu proxy on');
    const t0 = Date.now();
    clients[2].ws.send(JSON.stringify({ type: 'skipCpuSai' }));
    await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'cpuSaiFast'), 2000, 'cpuSaiFast')));
    await waitUntil(() => room.authority!.canonicalState().pendingSaiKoro?.finalized === true || undefined, 1000, 'finalized after skip');
    expect(Date.now() - t0).toBeLessThan(1000);
    const pending = room.authority!.canonicalState().pendingSaiKoro as any;
    expect(pending.rolls.filter((r: any) => !r.zoro)).toHaveLength(4);
    // 結果は読めるように、次へ [advance] はすぐには進まない
    await sleep(300);
    expect(room.authority!.canonicalState().pendingSaiKoro?.finalized).toBe(true);
    // 終わったら刻みは元に戻る
    await waitUntil(() => room.authority!.canonicalState().pendingSaiKoro === null || undefined, 3000, 'advanced');
    expect((room as any).cpuSaiFast).toBe(false);
  });

  it('人間のサイコロではスキップを受けない [刻みも変わらない]', async () => {
    const { room, clients } = await bootRoom('SK0002');
    plantSai(room, 1);
    clients[2].ws.send(JSON.stringify({ type: 'skipCpuSai' }));
    await sleep(400);
    expect((room as any).cpuSaiFast).toBe(false);
    expect(clients.some((client) => client.messages.some((m) => m.type === 'cpuSaiFast'))).toBe(false);
    expect(room.authority!.canonicalState().pendingSaiKoro?.selectedCombo ?? null).toBeNull();
  });
});
