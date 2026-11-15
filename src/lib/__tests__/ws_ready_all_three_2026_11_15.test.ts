// [2026-11-15 リョー「次局にいくときに3人が押さないと次にいけないようにして、オンラインで」]
//
// 対象: server/ws_server.ts maybeAdvanceAllReady / markReadyForNextRound。
// 旧仕様は (1) 最初の 1 押しから nextRoundTimeoutMs で自動で進む
// (2) 切断中の人間を gate から外す、の 2 つで、押していない人を置いて次局へ進んでいた。
// 新仕様: active の人間 3 人が全員押すまで進まない。押していない席が全員切断中 /
// CPU 代行の時だけ、nextRoundTimeoutMs 後に from_role='timeout' で進む [抜けた人で卓が止まらない様に]。
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';

const SECRET = 'ws-ready-all-three-secret';
const ROOM_ID = 'RA1115';
const INSTANCE_ID = 'ready-all-three-instance';
const NEXT_ROUND_MS = 150;
const MEMBERS = [
  { seat: 0, user_id: 'ra-a', username: 'A' },
  { seat: 1, user_id: 'ra-b', username: 'B' },
  { seat: 2, user_id: 'ra-c', username: 'C' },
];

type Client = { ws: WebSocket; messages: any[] };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function waitUntil<T>(read: () => T | undefined, timeoutMs = 4000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.on('error', () => { /* server 側の close を error 扱いにしない */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

/** 3 人間部屋 [member API 無し = 接続した者が member]。host が start し、局終了を立てた状態 */
async function bootThreeHumanRoom() {
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
    nextRoundTimeoutMs: NEXT_ROUND_MS,
    cpuProxyGraceMs: 60_000,
    log: false,
  });
  cleanups.push(async () => runtime.close());
  const wsAddress = runtime.wss.address();
  if (!wsAddress || typeof wsAddress === 'string') throw new Error('test websocket did not bind');

  const now = Math.floor(Date.now() / 1000);
  const urlFor = (seat: number) => {
    const member = MEMBERS[seat];
    const token = jwt.sign({
      uid: member.user_id, username: member.username, seat, room_id: ROOM_ID,
      room_instance_id: INSTANCE_ID, is_host: seat === 0,
      iat: now, exp: now + 120,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${wsAddress.port}/ws/room/${ROOM_ID}?token=${encodeURIComponent(token)}`;
  };

  const clients: Client[] = [];
  for (const seat of [0, 1, 2]) clients.push(await connect(urlFor(seat)));
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  for (const client of clients) {
    await waitUntil(() => client.messages.find((message) => message.type === 'start'), 4000, 'start frame');
  }
  const room = runtime.rooms.get(ROOM_ID);
  if (!room?.authority || !room.snapshot.started) throw new Error('room did not start');
  // 局終了 [post-win pending 無し] を canonical と validation mirror の両方に立てる
  const canonical = room.authority.canonicalState();
  canonical.roundEnded = true;
  room.authority.roundEnded = true;
  expect(room.authority.isPostWinResolved()).toBe(true);
  return { room, clients, persistence };
}

const isNextRoundRelay = (message: any) => message.type === 'action' && message.action?.type === 'nextRound';
const loggedNextRounds = (persistence: RoomPersistence) =>
  persistence.loadCommands(ROOM_ID).filter((command) => command.action?.type === 'nextRound');

async function pressReady(client: Client) {
  const before = client.messages.filter((message) => message.type === 'readyNextRoundAck').length;
  client.ws.send(JSON.stringify({ type: 'readyNextRound', revision: 0 }));
  await waitUntil(
    () => client.messages.filter((message) => message.type === 'readyNextRoundAck').length > before ? true : undefined,
    4000, 'ready ack',
  );
}

describe('次局は 3 人全員が押すまで進まない [2026-11-15]', () => {
  it('2 人押しただけでは時間切れでも進まず、3 人目が押した時に進む', async () => {
    const { room, clients, persistence } = await bootThreeHumanRoom();
    await pressReady(clients[0]);
    await pressReady(clients[1]);
    const ready = clients[2].messages.filter((message) => message.type === 'nextRoundReady').at(-1);
    expect(ready).toMatchObject({ seats: [0, 1], total: 3 });

    await sleep(NEXT_ROUND_MS * 4);
    expect(clients.some((client) => client.messages.some(isNextRoundRelay))).toBe(false);
    expect(loggedNextRounds(persistence)).toHaveLength(0);
    expect(room.nextRoundTimer).toBeNull();

    await pressReady(clients[2]);
    const relay = await waitUntil(() => clients[0].messages.find(isNextRoundRelay), 1500, 'all-ready nextRound');
    expect(relay.action.from_role).toBe('all-ready');
    expect(loggedNextRounds(persistence).map((command) => command.action.from_role)).toEqual(['all-ready']);
  });

  it('押していない人が切断中なら gate から外さず、時間切れの fallback だけで進む', async () => {
    const { clients, persistence } = await bootThreeHumanRoom();
    await pressReady(clients[0]);
    await pressReady(clients[1]);
    clients[2].ws.close();
    // 切断直後には進まない [旧仕様は切断者を外して即 all-ready で進めていた]
    await sleep(NEXT_ROUND_MS / 3);
    expect(clients[0].messages.some(isNextRoundRelay)).toBe(false);
    const relay = await waitUntil(() => clients[0].messages.find(isNextRoundRelay), 2000, 'timeout nextRound');
    expect(relay.action.from_role).toBe('timeout');
    expect(loggedNextRounds(persistence)).toHaveLength(1);
  });
});
