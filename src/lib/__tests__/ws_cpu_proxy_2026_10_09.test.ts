// [2026-10-09 遊真 A2] 切断した人間席を CPU が代わりに打つ [cpuProxy]。
//
// 契約 [client 側が合わせる物]:
// - lobby / sync.currentMembers の各 member に cpu_proxy: boolean
// - 切断から cpuProxyGraceMs 後に cpuProxy=true [lobby 再配信]、同じ席が戻ると false
// - client→server { type:'setCpuProxy', seat:<room seat>, on:boolean }
//   host は自分以外の人間席を双方向に、本人は自席の on:false だけ。他は無視
// - 代行中の本人が受理されるコマンドを送ると cpuProxy=false
// 試験は 3 人間部屋 [member API 無し = 接続した者が member] と rotation 部屋 [stub member API] の 2 系統。
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';
import { toCorePai } from '../helpers';

const NO_HUMAN_KEY = 'ANMIKA_NO_HUMAN_NEXT_ROUND_MS';
const NO_HUMAN_MS = 150;
const previousNoHuman = process.env[NO_HUMAN_KEY];
process.env[NO_HUMAN_KEY] = String(NO_HUMAN_MS);
afterAll(() => {
  if (previousNoHuman === undefined) delete process.env[NO_HUMAN_KEY];
  else process.env[NO_HUMAN_KEY] = previousNoHuman;
});

const SECRET = 'ws-cpu-proxy-secret';
const GRACE_MS = 200;

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
  ws.on('error', () => { /* server 側の close [4001 replaced 等] を error 扱いにしない */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

const closeClient = (client: Client) => new Promise<void>((resolve) => {
  if (client.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
  client.ws.once('close', () => resolve());
  client.ws.close();
});

/** lobby の最新 member 行 [seat 指定] */
const lastLobbyRow = (client: Client, seat: number) => {
  for (let i = client.messages.length - 1; i >= 0; i -= 1) {
    const message = client.messages[i];
    if (message.type === 'lobby') return message.members.find((member: any) => member.seat === seat);
  }
  return undefined;
};

/** 3 人間部屋 [u0 = host / u1 / u2] を起動して host が start した状態 */
async function bootRoom(roomId: string, overrides: Record<string, unknown> = {}) {
  const persistence = new RoomPersistence(':memory:');
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    wsSecret: SECRET,
    internalApiSecret: '',
    persistence,
    reactionTimeoutMs: 150,
    turnTimeoutMs: 60_000,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: GRACE_MS,
    nextRoundTimeoutMs: 60_000,
    log: false,
    ...overrides,
  });
  cleanups.push(async () => runtime.close());
  const address = runtime.wss.address();
  if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const url = (uid: string, seat: number, isHost = false) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: roomId,
      room_instance_id: `${roomId}-instance`, is_host: isHost,
      iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
  };
  const seatsToUid = ['u0', 'u1', 'u2'];
  const connectSeat = (seat: number) => connect(url(seatsToUid[seat], seat, seat === 0));
  const clients = await Promise.all([0, 1, 2].map(connectSeat));
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'start'), 4000, 'start')));
  const room = runtime.rooms.get(roomId);
  if (!room?.authority || !room.snapshot.started) throw new Error('room did not start');
  return { runtime, persistence, room, clients, connectSeat };
}

/** 現手番の人間が合法な打牌を 1 つ送る [reaction 窓が空いている間は待つ] */
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

/** stop(seat) が true になるまで、`skipSeat` 以外の接続中の人間の手番を手動で進める */
async function driveOthers(
  room: any,
  clients: Client[],
  skipSeats: number[],
  done: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSentRevision = -1;
  while (Date.now() < deadline) {
    if (done() || room.authority.roundEnded) return;
    if (!reactionOpen(room)) {
      const seat = room.authority.currentPlayer();
      if (!skipSeats.includes(seat) && lastSentRevision !== room.snapshot.revision) {
        if (sendManualDiscard(room, clients[seat])) lastSentRevision = room.snapshot.revision;
      }
    }
    await sleep(25);
  }
  throw new Error('driveOthers timed out');
}

const srvActionsFor = (client: Client, roomSeat: number) => client.messages.filter(
  (m) => m.type === 'action' && String(m.commandId).startsWith('srv:') && m.from_room_seat === roomSeat,
);

describe('CPU proxy [2026-10-09 A2]', () => {
  it('切断した席は猶予後に cpu_proxy になり、手番は CPU が自動で打つ [60 秒待たない]', async () => {
    const { room, clients } = await bootRoom('PX0001');
    const x = room.authority!.currentPlayer(); // 最初の手番の人を落とす
    const observer = clients[(x + 1) % 3];
    const startedAt = Date.now();
    await closeClient(clients[x]);

    const lobbyRow = await waitUntil(() => {
      const row = lastLobbyRow(observer, x);
      return row?.cpu_proxy === true ? row : undefined;
    }, 3000, 'cpu_proxy lobby');
    expect(lobbyRow).toMatchObject({ seat: x, connected: false, cpu_proxy: true, is_cpu: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(GRACE_MS - 20);

    // 代行席の手番は 750ms で CPU ロジックが打つ [turnTimeoutMs / disconnectGraceMs は 60 秒]
    const first = await waitUntil(() => srvActionsFor(observer, x)[0], 4000, 'proxy first action');
    expect(first.from_user_id).toBe(`u${x}`);
    expect(Date.now() - startedAt).toBeLessThan(4000);

    // 手番が一周して戻ってきても、また自動で打つ [他の 2 人は手動で進める]
    await driveOthers(room, clients, [x], () => srvActionsFor(observer, x).length >= 2);
    if (!room.authority!.roundEnded) expect(srvActionsFor(observer, x).length).toBeGreaterThanOrEqual(2);
    expect(room.members.get(`u${x}`)?.cpuProxy).toBe(true);
  });

  it('同じ席が戻ると cpu_proxy が外れ、その人の手番は本人を待つ', async () => {
    const { room, clients, connectSeat } = await bootRoom('PX0002');
    const current = room.authority!.currentPlayer();
    const x = (current + 1) % 3; // 手番でない席を落とす [次に手番が回る席]
    await closeClient(clients[x]);
    const observer = clients[current];
    await waitUntil(() => lastLobbyRow(observer, x)?.cpu_proxy === true ? true : undefined, 3000, 'proxy on');

    const returned = await connectSeat(x);
    await waitUntil(() => returned.messages.find((m) => m.type === 'sync'), 3000, 'resync');
    const lobbyBack = await waitUntil(() => {
      const row = lastLobbyRow(observer, x);
      return row && row.cpu_proxy === false && row.connected === true ? row : undefined;
    }, 3000, 'proxy off');
    expect(lobbyBack.cpu_proxy).toBe(false);
    expect(room.members.get(`u${x}`)?.cpuProxy).toBe(false);
    // 再接続した本人にも currentMembers に cpu_proxy が載る
    const sync = returned.messages.find((m) => m.type === 'sync');
    expect(sync.snapshot.currentMembers.every((row: any) => typeof row.cpu_proxy === 'boolean')).toBe(true);

    // x の手番まで進めると、サーバーは勝手に打たず本人を待つ
    await driveOthers(room, clients.map((c, seat) => seat === x ? returned : c), [x], () => room.authority.currentPlayer() === x && !reactionOpen(room));
    if (room.authority!.roundEnded) return; // 局がここで終わった乱数目は判定対象外
    const revision = room.snapshot.revision;
    await sleep(1500);
    expect(room.snapshot.revision).toBe(revision);
    expect(srvActionsFor(observer, x)).toHaveLength(0);
    // 本人が打てばそのまま受理される
    expect(sendManualDiscard(room, returned)).toBe(true);
    await waitUntil(() => room.snapshot.revision > revision ? true : undefined, 3000, 'manual accepted');
  });

  it('host は接続中の人間席を CPU 代行に切り替え / 戻せる。host 以外には切り替えられない', async () => {
    const { room, clients } = await bootRoom('PX0003');
    const [host, p1, p2] = clients;
    const rowAtP2 = (seat: number) => lastLobbyRow(p2, seat);

    // host → seat 1 を代行に
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 1, on: true }));
    await waitUntil(() => rowAtP2(1)?.cpu_proxy === true ? true : undefined, 3000, 'host proxies seat 1');
    expect(rowAtP2(1)).toMatchObject({ connected: true, cpu_proxy: true });

    // host 以外が他人の席を触っても無視される
    p2.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 1, on: false }));
    p2.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 0, on: true }));
    p1.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 2, on: true }));
    // host が自席を代行にするのも無視 [自分以外のみ]
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 0, on: true }));
    await sleep(300);
    expect(room.members.get('u1')?.cpuProxy).toBe(true);
    expect(room.members.get('u0')?.cpuProxy).toBe(false);
    expect(room.members.get('u2')?.cpuProxy).toBe(false);

    // 本人は on:true を送れない [すでに true の席でも on:false だけ]。on:false で「自分で打つ」
    p1.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 1, on: false }));
    await waitUntil(() => rowAtP2(1)?.cpu_proxy === false ? true : undefined, 3000, 'self reclaim');
    p1.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 1, on: true }));
    await sleep(300);
    expect(room.members.get('u1')?.cpuProxy).toBe(false);

    // host は戻す方向も切り替えられる
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 2, on: true }));
    await waitUntil(() => room.members.get('u2')?.cpuProxy === true ? true : undefined, 3000, 'host proxies seat 2');
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 2, on: false }));
    await waitUntil(() => room.members.get('u2')?.cpuProxy === false ? true : undefined, 3000, 'host returns seat 2');
    // 不正な形は黙って無視
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: '1', on: true }));
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 1, on: 'yes' }));
    host.ws.send(JSON.stringify({ type: 'setCpuProxy', seat: 9, on: true }));
    await sleep(200);
    expect(room.members.get('u1')?.cpuProxy).toBe(false);
  });

  it('host が接続中の人に切り替えた席は、その人の手番を CPU が自動で打つ', async () => {
    const { room, clients } = await bootRoom('PX0004');
    const x = room.authority!.currentPlayer();
    // host 自身は切り替えられないので、手番が host の席なら先に host が 1 手打って回す
    let target = x;
    if (x === 0) {
      expect(sendManualDiscard(room, clients[0])).toBe(true);
      await waitUntil(() => room.authority!.currentPlayer() !== 0 && !reactionOpen(room) ? true : undefined, 3000, 'turn passes');
      target = room.authority!.currentPlayer();
      if (target === 0) return; // 局が終わる等の乱数目
    }
    clients[0].ws.send(JSON.stringify({ type: 'setCpuProxy', seat: target, on: true }));
    const auto = await waitUntil(() => srvActionsFor(clients[0], target)[0], 4000, 'proxied connected seat auto-plays');
    expect(auto.from_user_id).toBe(`u${target}`);
  });

  it('代行中の本人が受理されるコマンドを送ると cpu_proxy が外れる [lobby 再配信]', async () => {
    const { room, clients } = await bootRoom('PX0005');
    const x = room.authority!.currentPlayer();
    const observer = clients[(x + 1) % 3];
    // 手番の本人を代行状態にする [timer は触らない = 60 秒待ち。本人が先に指す]
    room.members.get(`u${x}`)!.cpuProxy = true;
    const seen = observer.messages.length;
    expect(sendManualDiscard(room, clients[x])).toBe(true);
    const row = await waitUntil(() => {
      const lobby = observer.messages.slice(seen).find((m) => m.type === 'lobby');
      return lobby?.members.find((member: any) => member.seat === x);
    }, 3000, 'proxy cleared by own command');
    expect(row.cpu_proxy).toBe(false);
    expect(row.connected).toBe(true);
    expect(room.members.get(`u${x}`)?.cpuProxy).toBe(false);
    expect(room.snapshot.revision).toBeGreaterThanOrEqual(1);
  });

  it('人間が全員切断した部屋は、代行席があっても自動で打ち続けない', async () => {
    const { room, clients } = await bootRoom('PX0006');
    for (const client of clients) await closeClient(client);
    await waitUntil(() => [...room.members.values()].every((m) => m.cpuProxy) ? true : undefined, 3000, 'all proxied');
    const revision = room.snapshot.revision;
    await sleep(1800); // CPU 代行の刻み [750ms] を 2 周以上待つ
    expect(room.snapshot.revision).toBe(revision);
    expect(room.authority!.currentPlayer()).toBeDefined();
  });
});

// ---- rotation 部屋: 抜け番の人間だけが pilot の時の局終了 ------------------------------------------------
const ROT_ROOM = 'RP0001';
const ROT_INSTANCE = 'rp-instance';
const ROT_MEMBERS = [
  { seat: 0, user_id: 'rp-host', username: 'host' },
  { seat: 1, user_id: 'rp-h1', username: 'h1' },
  { seat: 2, user_id: 'CPU_RP_2', username: 'CPU 2' },
  { seat: 3, user_id: 'CPU_RP_3', username: 'CPU 3' },
];

async function bootRotation() {
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ members: ROT_MEMBERS, match_mode: 'tonpu', rotation_enabled: true }));
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
  const apiAddress = api.address();
  if (!apiAddress || typeof apiAddress === 'string') throw new Error('stub member API did not bind');
  const persistence = new RoomPersistence(':memory:');
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    apiBase: `http://127.0.0.1:${apiAddress.port}`,
    wsSecret: SECRET,
    internalApiSecret: SECRET,
    persistence,
    reactionTimeoutMs: 60_000,
    turnTimeoutMs: 60_000,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: GRACE_MS,
    nextRoundTimeoutMs: 60_000,
    testControlsEnabled: true,
    log: false,
  });
  cleanups.push(async () => runtime.close());
  const wsAddress = runtime.wss.address();
  if (!wsAddress || typeof wsAddress === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const url = (uid: string, seat: number, isHost: boolean) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: ROT_ROOM, room_instance_id: ROT_INSTANCE,
      is_host: isHost, iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${wsAddress.port}/ws/room/${ROT_ROOM}?token=${encodeURIComponent(token)}`;
  };
  const host = await connect(url('rp-host', 0, true));
  const h1 = await connect(url('rp-h1', 1, false));
  // member API 照会 [非同期] が終わり、server 側の登録が済んだ合図 = lobby を待ってから start する
  await waitUntil(() => host.messages.find((m) => m.type === 'lobby'), 4000, 'host registered');
  await waitUntil(() => h1.messages.find((m) => m.type === 'lobby'), 4000, 'h1 registered');
  host.ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await waitUntil(() => host.messages.find((m) => m.type === 'start'), 4000, 'start');
  await waitUntil(() => h1.messages.find((m) => m.type === 'start'), 4000, 'start h1');
  const room = runtime.rooms.get(ROT_ROOM)!;
  const internalPort = await waitUntil(() => {
    const address = runtime.internalHttp.address();
    return address && typeof address === 'object' ? address.port : undefined;
  }, 4000, 'internal port');
  const forced = await fetch(`http://127.0.0.1:${internalPort}/internal/test/force-finish-match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
    body: JSON.stringify({ room_id: ROT_ROOM }),
  });
  expect(await forced.json()).toEqual({ ok: true });
  // 試合 1 は host/h1 とも active。非 host の h1 が次の試合へ [A3: host 限定ではない] → 試合 2 は host が抜け番
  h1.ws.send(JSON.stringify({
    type: 'action', commandId: 'rp-next-match', expectedVersion: 0, matchId: 1, roundId: 1,
    action: { type: 'nextMatch' },
  }));
  await waitUntil(() => host.messages.find((m) => m.type === 'action' && m.commandId === 'rp-next-match'), 4000, 'nextMatch relay');
  expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [1, 2, 3], inactiveRoomSeat: 0 });
  // 局終了 [post-win 無し、試合は継続] を canonical と mirror の両方に立てる
  const canonical = room.authority!.canonicalState();
  canonical.roundEnded = true;
  room.authority!.roundEnded = true;
  expect(room.authority!.isPostWinResolved()).toBe(true);
  return { room, host, h1 };
}

const nextRoundRelays = (client: Client) => client.messages.filter(
  (m) => m.type === 'action' && m.action?.type === 'nextRound',
);

describe('局終了の自動進行 [A2: 抜け番の pilot だけが居る部屋]', () => {
  it('active 席の人間が切断・代行になり、残る pilot が抜け番だけでも次局へ進む', async () => {
    const { room, host, h1 } = await bootRotation();
    // 接続中の active 人間 [h1] が居る間は進まない
    await sleep(NO_HUMAN_MS * 3);
    expect(nextRoundRelays(host)).toHaveLength(0);
    await closeClient(h1);
    const relay = await waitUntil(() => nextRoundRelays(host)[0], 4000, 'no-active-human nextRound');
    expect(relay.action.from_role).toBe('no-active-human');
    expect(room.members.get('rp-h1')?.cpuProxy).toBe(true);
  });

  it('人間が全員切断した部屋は進まない [全員いない卓を自動で回さない]', async () => {
    const { room, host, h1 } = await bootRotation();
    await closeClient(h1);
    await closeClient(host);
    await waitUntil(() => room.members.get('rp-h1')?.cpuProxy && room.members.get('rp-host')?.cpuProxy ? true : undefined, 3000, 'both proxied');
    const revision = room.snapshot.revision;
    await sleep(NO_HUMAN_MS * 6 + 400);
    expect(room.snapshot.revision).toBe(revision);
    expect(room.snapshot.roundId).toBe(1);
  });
});
