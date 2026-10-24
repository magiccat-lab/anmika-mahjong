// [2026-10-24 リョー「途中で誰か抜けて3人打ちもできるようにして」]
// 4人回しの部屋 [人間 4 人] で 1 人が抜けた時の ws 統合試験。
// - 対局の合間に抜けたら、次の試合は抜け番なしの 3 人打ち [inactiveRoomSeat -1]
// - 2 人以下になったら nextMatch を断る
// - 対局中に active の人が抜けたら、その席は CPU 代行と同じに自動で打たれて試合が終われる
// - 抜け番の人が抜けても卓 [期限 timer / revision] は触らない
// - ws 再起動: 名簿に居ない人を start.members [game seat 契約] から復活させない
// 名簿 [member API] は stub。leave は python の POST /api/rooms/{id}/leave が叩く /internal/evict-member を直接叩く。
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';
import { toCorePai } from '../helpers';

const SECRET = 'ws-rotation-leave-secret';
const ROOM = 'RL0001';
const INSTANCE = 'rl-instance';

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
  ws.on('error', () => { /* evict の close [4410] を error 扱いにしない */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

const UIDS = ['rl0', 'rl1', 'rl2', 'rl3'];
const rosterOf = (uids: string[]) => UIDS
  .map((user_id, seat) => ({ seat, user_id, username: user_id }))
  .filter((member) => uids.includes(member.user_id));

/** stub member API [名簿は roster.uids を書き換えて leave を表す] */
async function bootStubApi(roster: { uids: string[] }) {
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ members: rosterOf(roster.uids), match_mode: 'tonpu', rotation_enabled: true }));
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('stub member API did not bind');
  return `http://127.0.0.1:${address.port}`;
}

function makeRuntime(apiBase: string, persistence: RoomPersistence) {
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    apiBase,
    wsSecret: SECRET,
    internalApiSecret: SECRET,
    persistence,
    reactionTimeoutMs: 150,
    turnTimeoutMs: 60_000,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: 60_000,
    nextRoundTimeoutMs: 60_000,
    testControlsEnabled: true,
    log: false,
  });
  // 再起動の試験は途中で明示的に close するので、後始末の二重 close [database is not open] は握る
  cleanups.push(async () => { try { await runtime.close(); } catch { /* 閉じ済み */ } });
  return runtime;
}

function urlFor(runtime: ReturnType<typeof makeRuntime>, uid: string) {
  const address = runtime.wss.address();
  if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({
    uid, username: uid, seat: UIDS.indexOf(uid), room_id: ROOM, room_instance_id: INSTANCE,
    is_host: uid === 'rl0', iat: now, exp: now + 300,
  }, SECRET, { algorithm: 'HS256' });
  return `ws://127.0.0.1:${address.port}/ws/room/${ROOM}?token=${encodeURIComponent(token)}`;
}

async function internalPortOf(runtime: ReturnType<typeof makeRuntime>): Promise<number> {
  return waitUntil(() => {
    const address = runtime.internalHttp.address();
    return address && typeof address === 'object' ? address.port : undefined;
  }, 4000, 'internal port');
}

async function post(runtime: ReturnType<typeof makeRuntime>, route: string, body: unknown) {
  const port = await internalPortOf(runtime);
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** 4 人全員接続して start、試合 1 が走っている状態 [抜け番 = room seat 3 の rl3] */
async function bootRotation(roster: { uids: string[] }, persistence = new RoomPersistence(':memory:')) {
  const apiBase = await bootStubApi(roster);
  const runtime = makeRuntime(apiBase, persistence);
  const clients: Client[] = [];
  for (const uid of UIDS) {
    const client = await connect(urlFor(runtime, uid));
    await waitUntil(() => client.messages.find((m) => m.type === 'lobby'), 4000, `${uid} registered`);
    clients.push(client);
  }
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((c) => waitUntil(() => c.messages.find((m) => m.type === 'start'), 4000, 'start')));
  const room = runtime.rooms.get(ROOM)!;
  expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 });
  return { runtime, room, clients, persistence, apiBase };
}

const forceFinish = async (runtime: ReturnType<typeof makeRuntime>) => {
  expect(await post(runtime, '/internal/test/force-finish-match', { room_id: ROOM })).toEqual({ ok: true });
};

const evict = async (runtime: ReturnType<typeof makeRuntime>, uid: string) => {
  expect(await post(runtime, '/internal/evict-member', { room_id: ROOM, user_id: uid })).toEqual({ ok: true });
};

let seq = 0;
function sendNextMatch(client: Client, room: any) {
  const commandId = `rl-next-${seq += 1}`;
  client.ws.send(JSON.stringify({
    type: 'action', commandId,
    expectedVersion: room.snapshot.revision, matchId: room.snapshot.matchId, roundId: room.snapshot.roundId,
    action: { type: 'nextMatch' },
  }));
  return commandId;
}

function sendManualDiscard(room: any, client: Client): boolean {
  const authority = room.authority;
  const seat = authority.currentPlayer();
  const hand = authority.game.shoupai.get(seat);
  const pai = ((hand?.get_dapai(false) ?? []) as string[])
    .map((candidate) => candidate.replace(/_$/, ''))
    .find((candidate) => toCorePai(candidate) !== 'z4');
  if (!pai) return false;
  client.ws.send(JSON.stringify({
    type: 'action',
    commandId: `manual-${room.snapshot.revision}-${seat}-${Math.random().toString(36).slice(2, 8)}`,
    expectedVersion: room.snapshot.revision,
    matchId: room.snapshot.matchId,
    roundId: room.snapshot.roundId,
    action: { type: 'discard', pai },
  }));
  return true;
}

const reactionOpen = (room: any) => {
  const a = room.authority;
  return a.awaitingRonDecision || a.awaitingFulou || a.ronCandidates.length > 0
    || a.ponCandidates.length > 0 || a.kanCandidates.length > 0;
};

describe('4人回しで途中から3人打ち [2026-10-24]', () => {
  it('対局の合間に active の人が抜けたら、次の試合は抜け番なしの3人打ち [最終残高は残る]', async () => {
    const roster = { uids: [...UIDS] };
    const { runtime, room, clients } = await bootRotation(roster);
    await forceFinish(runtime);
    roster.uids = roster.uids.filter((uid) => uid !== 'rl2');
    await evict(runtime, 'rl2');
    expect([...room.members.keys()].sort()).toEqual(['rl0', 'rl1', 'rl3']);

    const commandId = sendNextMatch(clients[1], room);
    await waitUntil(() => clients[0].messages.find((m) => m.type === 'action' && m.commandId === commandId), 4000, 'nextMatch relay');
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 });
    // 抜けた人の ledger の行は残る [最終残高が見える]
    expect(Object.keys(room.snapshot.roomChipLedger!).sort()).toEqual(['0', '1', '2', '3']);
    // 3 人の game seat は room seat 0,1,3 へ。rl3 [これまで抜け番] が game seat 2 で打つ
    const relay = clients[3].messages.find((m) => m.type === 'action' && m.commandId === commandId);
    expect(relay.recipientGameSeat).toBe(2);
    expect(relay.activeMapping).toEqual({ gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 });
    expect(room.snapshot.matchId).toBe(2);

    // 続けて次の試合へ進んでも 3 人打ちのまま
    await forceFinish(runtime);
    const second = sendNextMatch(clients[0], room);
    await waitUntil(() => clients[3].messages.find((m) => m.type === 'action' && m.commandId === second), 4000, 'second nextMatch');
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 });
    expect(room.snapshot.matchId).toBe(3);
  });

  it('抜け番の人が抜けると次の試合は残り 3 人 [元の active] の3人打ち', async () => {
    const roster = { uids: [...UIDS] };
    const { runtime, room, clients } = await bootRotation(roster);
    await forceFinish(runtime);
    await evict(runtime, 'rl3');
    const commandId = sendNextMatch(clients[0], room);
    await waitUntil(() => clients[1].messages.find((m) => m.type === 'action' && m.commandId === commandId), 4000, 'nextMatch relay');
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 2], inactiveRoomSeat: -1 });
  });

  it('居るのが 2 人以下になったら nextMatch を断る [mapping を進めない]', async () => {
    const roster = { uids: [...UIDS] };
    const { runtime, room, clients } = await bootRotation(roster);
    await forceFinish(runtime);
    await evict(runtime, 'rl2');
    await evict(runtime, 'rl3');
    const commandId = sendNextMatch(clients[1], room);
    const reject = await waitUntil(
      () => clients[1].messages.find((m) => m.type === 'reject' && m.commandId === commandId),
      4000, 'nextMatch reject',
    );
    expect(reject.reason).toMatch(/fewer than 3 players/);
    expect(room.snapshot.matchId).toBe(1);
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 });
  });

  it('対局中に active の人が抜けても、その席は自動で打たれて試合が進む [60 秒待たない]', async () => {
    const roster = { uids: [...UIDS] };
    const { runtime, room, clients } = await bootRotation(roster);
    const startedAt = Date.now();
    await evict(runtime, 'rl2'); // game seat 2
    expect(room.members.has('rl2')).toBe(false);

    // 他の人間 [rl0 / rl1] は手動で進める。rl2 の手番は server が CPU ロジックで打つ
    const observer = clients[0];
    const srvFromSeat2 = () => observer.messages.filter(
      (m) => m.type === 'action' && String(m.commandId).startsWith('srv:') && m.from_room_seat === 2,
    );
    let lastSent = -1;
    const deadline = Date.now() + 15_000;
    while (srvFromSeat2().length === 0 && !room.authority.roundEnded && Date.now() < deadline) {
      if (!reactionOpen(room)) {
        const seat = room.authority.currentPlayer();
        if ((seat === 0 || seat === 1) && lastSent !== room.snapshot.revision) {
          if (sendManualDiscard(room, clients[seat])) lastSent = room.snapshot.revision;
        }
      }
      await sleep(25);
    }
    expect(srvFromSeat2().length).toBeGreaterThan(0);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    // 抜けた席は CPU の rl2 [uid は deadline-seat 側に落ちる]、room からは居ないまま
    expect(room.members.has('rl2')).toBe(false);

    // 試合が終わった後、次の試合は 3 人打ち
    await forceFinish(runtime);
    const commandId = sendNextMatch(clients[0], room);
    await waitUntil(() => clients[1].messages.find((m) => m.type === 'action' && m.commandId === commandId), 4000, 'nextMatch relay');
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 });
  });

  it('抜け番の人が対局中に抜けても卓は触られない [期限 timer も revision もそのまま]', async () => {
    const roster = { uids: [...UIDS] };
    const { runtime, room } = await bootRotation(roster);
    const timerBefore = room.deadlineTimer;
    const revisionBefore = room.snapshot.revision;
    expect(timerBefore).not.toBeNull();
    await evict(runtime, 'rl3'); // 抜け番
    expect(room.deadlineTimer).toBe(timerBefore);
    expect(room.snapshot.revision).toBe(revisionBefore);
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 });
  });

  it('ws 再起動: 名簿から消えた人を start.members から復活させず、残りは room seat を持つ', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'anmika-rl-'));
    cleanups.push(async () => { rmSync(dir, { recursive: true, force: true }); });
    const dbPath = path.join(dir, 'rooms.sqlite3');
    const roster = { uids: [...UIDS] };
    const first = await bootRotation(roster, new RoomPersistence(dbPath));
    // start.members は試合 1 の active trio [game seat 契約]。rl2 はその中に居る
    expect(first.room.snapshot.start!.members.map((m: any) => m.user_id)).toEqual(['rl0', 'rl1', 'rl2']);
    roster.uids = roster.uids.filter((uid) => uid !== 'rl2');
    await evict(first.runtime, 'rl2');
    // wss.close は接続が残ると返らない。先に全員切ってから閉じる [同じ DB を次の runtime が開く]
    for (const c of first.clients) c.ws.terminate();
    await sleep(100);
    await first.runtime.close();
    // 閉じた stub API を差し替える
    const secondApi = await bootStubApi(roster);
    const second = makeRuntime(secondApi, new RoomPersistence(dbPath));
    const client = await connect(urlFor(second, 'rl0'));
    await waitUntil(() => client.messages.find((m) => m.type === 'lobby'), 4000, 'rl0 registered');
    const room = second.rooms.get(ROOM)!;
    expect(room.snapshot.started).toBe(true);
    expect([...room.members.values()].map((m) => [m.user_id, m.seat]).sort()).toEqual([['rl0', 0], ['rl1', 1], ['rl3', 3]]);
  }, 30_000);
});
