// [2026-10-09 遊真 C1 server] 「誰を・あと何 ms 待っているか」の通知。
//
// 契約: scheduleRoomDeadline が人間待ちの期限を張るたび、全接続へ
//   { type:'deadline', kind:'turn'|'reaction'|'postWin', seats:[room seat], remainingMs, revision }
// を配る。人間待ちが無い [CPU / CPU 代行の手番・局終了 等] 時は kind:'none', seats:[], remainingMs:0。
// 再接続した member / 観戦者には sync の直後に現在の残り時間も送る。
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';

const SECRET = 'ws-deadline-info-secret';
const TURN_MS = 5000;

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

const deadlines = (client: Client, from = 0) => client.messages.slice(from).filter((m) => m.type === 'deadline');

async function bootRoom(roomId: string, overrides: Record<string, unknown> = {}) {
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    wsSecret: SECRET,
    internalApiSecret: '',
    persistence: new RoomPersistence(':memory:'),
    reactionTimeoutMs: TURN_MS,
    turnTimeoutMs: TURN_MS,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: 60_000,
    nextRoundTimeoutMs: 60_000,
    log: false,
    ...overrides,
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
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'start'), 4000, 'start')));
  const room = runtime.rooms.get(roomId)!;
  return { runtime, room, clients, url };
}

describe('deadline 通知 [2026-10-09 C1]', () => {
  it('人間の手番は kind:turn・正しい room seat・残り ≈ turnTimeoutMs で全員に配られる', async () => {
    const { room, clients } = await bootRoom('DL0001');
    const current = room.authority!.currentPlayer();
    for (const client of clients) {
      const first = await waitUntil(() => deadlines(client)[0], 3000, 'first deadline');
      expect(first).toMatchObject({ type: 'deadline', kind: 'turn', seats: [current], revision: 0 });
      expect(first.remainingMs).toBeGreaterThan(TURN_MS - 1000);
      expect(first.remainingMs).toBeLessThanOrEqual(TURN_MS);
    }
    expect(room.deadlineInfo).toMatchObject({ kind: 'turn', seats: [current], revision: 0 });

    // 打牌が通ると、次の人 [revision 1] の期限が改めて配られる
    const hand = room.authority!.game.shoupai.get(current);
    const pai = ((hand?.get_dapai(false) ?? []) as string[]).map((c) => c.replace(/_$/, '')).find((c) => c !== 'z4')!;
    const seen = clients[0].messages.length;
    clients[current].ws.send(JSON.stringify({
      type: 'action', commandId: 'dl-discard', expectedVersion: 0, matchId: 1, roundId: 1,
      action: { type: 'discard', pai },
    }));
    const next = await waitUntil(() => deadlines(clients[0], seen).find((m) => m.revision === 1), 3000, 'deadline after discard');
    expect(next.revision).toBe(1);
    if (next.kind === 'turn') {
      expect(next.seats).toEqual([room.authority!.currentPlayer()]);
      expect(next.seats[0]).not.toBe(current);
    } else {
      // 他家に反応の余地があると reaction 窓 [その席を待つ] になる
      expect(['reaction', 'none']).toContain(next.kind);
    }
  });

  it('再接続した member と観戦者には sync の直後に現在の残り時間が届く', async () => {
    const { room, clients, url } = await bootRoom('DL0002');
    const current = room.authority!.currentPlayer();
    await waitUntil(() => deadlines(clients[0])[0], 3000, 'first deadline');
    await sleep(600);

    // member 再接続: sync → deadline の順で、残りは turnTimeoutMs より少し減った値 [explicit 送信] を含む
    const seat = (current + 1) % 3;
    const returned = await connect(url(`u${seat}`, seat, seat === 0));
    const syncIndex = await waitUntil(() => {
      const index = returned.messages.findIndex((m) => m.type === 'sync');
      return index >= 0 ? index : undefined;
    }, 3000, 'sync');
    const afterSync = await waitUntil(() => deadlines(returned, syncIndex)[0], 3000, 'deadline after sync');
    expect(afterSync).toMatchObject({ kind: 'turn', seats: [current] });
    expect(afterSync.remainingMs).toBeGreaterThan(0);
    expect(afterSync.remainingMs).toBeLessThanOrEqual(TURN_MS);

    // 観戦者: sync の直後に現在の期限 [観戦者の接続は期限を張り直さない。上の再接続で張り直した分から減っていく]
    await sleep(600);
    const spectator = await connect(url('watcher', -1, false, true));
    const specSyncIndex = await waitUntil(() => {
      const index = spectator.messages.findIndex((m) => m.type === 'sync');
      return index >= 0 ? index : undefined;
    }, 3000, 'spectator sync');
    const specDeadline = await waitUntil(() => deadlines(spectator, specSyncIndex)[0], 3000, 'spectator deadline');
    expect(specDeadline).toMatchObject({ kind: 'turn', seats: [current] });
    expect(specDeadline.remainingMs).toBeLessThanOrEqual(TURN_MS - 400);
  });

  it('反応窓は kind:reaction で待たれている人間席だけを room seat で示す', async () => {
    const { room, clients, url } = await bootRoom('DL0003');
    const current = room.authority!.currentPlayer();
    const reactor = (current + 1) % 3;
    // 反応窓を直接立てる [実際の牌の巡りに依存しない]。再接続が scheduleRoomDeadline を通す
    room.authority!.ronCandidates = [reactor as 0 | 1 | 2];
    const seen = clients[current].messages.length;
    const trigger = await connect(url(`u${current}`, current, current === 0));
    await waitUntil(() => trigger.messages.find((m) => m.type === 'sync'), 3000, 'sync');
    const reaction = await waitUntil(
      () => deadlines(clients[(current + 2) % 3]).find((m) => m.kind === 'reaction'),
      3000, 'reaction deadline',
    );
    expect(reaction.seats).toEqual([reactor]);
    expect(reaction.remainingMs).toBeGreaterThan(TURN_MS - 1000);
    expect(reaction.remainingMs).toBeLessThanOrEqual(TURN_MS);
    expect(room.deadlineInfo).toMatchObject({ kind: 'reaction', seats: [reactor] });
    expect(seen).toBeGreaterThanOrEqual(0);
  });

  it('CPU 代行席だけの反応窓は kind:none で、reactionTimeoutMs を待たず 750ms 級で処理される', async () => {
    const { room, clients, url } = await bootRoom('DL0004');
    const current = room.authority!.currentPlayer();
    const reactor = (current + 1) % 3;
    room.members.get(`u${reactor}`)!.cpuProxy = true;
    room.authority!.ronCandidates = [reactor as 0 | 1 | 2];
    const observer = clients[(current + 2) % 3];
    const seen = observer.messages.length;
    const trigger = await connect(url(`u${current}`, current, current === 0));
    await waitUntil(() => trigger.messages.find((m) => m.type === 'sync'), 3000, 'sync');
    const none = await waitUntil(() => deadlines(observer, seen)[0], 3000, 'deadline none');
    expect(none).toMatchObject({ kind: 'none', seats: [], remainingMs: 0 });
    expect(room.deadlineInfo).toBeNull();
    // reactionTimeoutMs [5000] を待たず、短い刻みで一度処理されて期限が張り直される [= 次の deadline 通知]
    const startedAt = Date.now();
    await waitUntil(() => deadlines(observer, seen)[1], 3000, 'rearm after proxy reaction');
    expect(Date.now() - startedAt).toBeLessThan(2500);
  });

  it('本人操作の人間席が混ざる反応窓は従来どおり reactionTimeoutMs まで待つ', async () => {
    const { room, clients, url } = await bootRoom('DL0005');
    const current = room.authority!.currentPlayer();
    const reactor = (current + 1) % 3;
    room.authority!.ronCandidates = [reactor as 0 | 1 | 2];
    const observer = clients[(current + 2) % 3];
    const seen = observer.messages.length;
    const trigger = await connect(url(`u${current}`, current, current === 0));
    await waitUntil(() => trigger.messages.find((m) => m.type === 'sync'), 3000, 'sync');
    await waitUntil(() => deadlines(observer, seen)[0], 3000, 'reaction deadline');
    await sleep(1600);
    expect(deadlines(observer, seen)).toHaveLength(1);
  });
});

// ---- rotation 部屋: game seat → room seat の変換 --------------------------------------------------------
describe('deadline 通知の seat 変換 [4人回し]', () => {
  it('試合 2 [game seat 0 = room seat 1] の人間の手番は room seat 1 で通知される', async () => {
    const members = [
      { seat: 0, user_id: 'dl-host', username: 'host' },
      { seat: 1, user_id: 'dl-h1', username: 'h1' },
      { seat: 2, user_id: 'CPU_DL_2', username: 'CPU 2' },
      { seat: 3, user_id: 'CPU_DL_3', username: 'CPU 3' },
    ];
    const api = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ members, match_mode: 'tonpu', rotation_enabled: true }));
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === 'string') throw new Error('stub API did not bind');
    const runtime = createWsRuntime({
      port: 0,
      internalPort: 0,
      apiBase: `http://127.0.0.1:${apiAddress.port}`,
      wsSecret: SECRET,
      internalApiSecret: SECRET,
      persistence: new RoomPersistence(':memory:'),
      reactionTimeoutMs: 300,
      turnTimeoutMs: TURN_MS,
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
    const url = (uid: string, seat: number, isHost: boolean) => `ws://127.0.0.1:${wsAddress.port}/ws/room/DL0006?token=${encodeURIComponent(jwt.sign({
      uid, username: uid, seat, room_id: 'DL0006', room_instance_id: 'dl-rot', is_host: isHost,
      iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' }))}`;
    const host = await connect(url('dl-host', 0, true));
    const h1 = await connect(url('dl-h1', 1, false));
    await waitUntil(() => host.messages.find((m) => m.type === 'lobby'), 4000, 'host registered');
    await waitUntil(() => h1.messages.find((m) => m.type === 'lobby'), 4000, 'h1 registered');
    host.ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    await waitUntil(() => host.messages.find((m) => m.type === 'start'), 4000, 'start');
    const internalPort = await waitUntil(() => {
      const address = runtime.internalHttp.address();
      return address && typeof address === 'object' ? address.port : undefined;
    }, 4000, 'internal port');
    await fetch(`http://127.0.0.1:${internalPort}/internal/test/force-finish-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
      body: JSON.stringify({ room_id: 'DL0006' }),
    });
    const seen = host.messages.length;
    host.ws.send(JSON.stringify({
      type: 'action', commandId: 'dl-next-match', expectedVersion: 0, matchId: 1, roundId: 1,
      action: { type: 'nextMatch' },
    }));
    await waitUntil(() => host.messages.find((m) => m.type === 'action' && m.commandId === 'dl-next-match'), 4000, 'nextMatch');
    const room = runtime.rooms.get('DL0006')!;
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [1, 2, 3], inactiveRoomSeat: 0 });
    // CPU 2 手のあと h1 [game seat 0] の手番 → room seat 1
    const humanTurn = await waitUntil(
      () => deadlines(host, seen).find((m) => m.kind === 'turn'),
      9000, 'human turn deadline',
    );
    expect(humanTurn.seats).toEqual([1]);
    expect(room.authority!.currentPlayer()).toBe(0);
    // CPU の手番では none
    expect(deadlines(host, seen).some((m) => m.kind === 'none')).toBe(true);
  });
});
