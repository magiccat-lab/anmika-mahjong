// [2026-09-02 codex監査 P0 回帰] active 3席に人間が一人もいない部屋の局終了を server が進める
//
// 対象: server/ws_server.ts scheduleRoomDeadline の canonical.roundEnded 分岐。
// 4人回しで host が抜け番 [試合2: inactiveRoomSeat=0] + active 3席が全部 CPU の部屋は、
// 全員ready gate の required [activeHumanMembers] が空で誰も nextRound を出せず、
// 局が終わった瞬間に永久停止していた。修正後は noActiveHumanNextRoundMs
// [env ANMIKA_NO_HUMAN_NEXT_ROUND_MS] 後に from_role='no-active-human' の nextRound を
// server が issueServerNextRound で発行する。
//
// 局終了状態の作り方 [妥協点]: CPU 3席の正規進行で局を終えると 750ms/手 × 数十手で予算
// [10s] を超え、山を削って山切れ流局させても初打が么九牌だと流し役満 [post-win pending
// → CPU 代行 1.5〜2.5s 刻み] に化けて所要時間が読めない。そのため試合2開始直後に
// canonical store と validation mirror の roundEnded を直接立て [ws_runtime.test.ts が
// pendingSaiKoro を直接置くのと同じ手口]、host の再接続 [監査 D-15 の deadline 張り直し
// 経路] で scheduleRoomDeadline を通す。nextRound 自体は正規の acceptAction →
// 両 reducer → persist → broadcast を通り、command log にも残る。
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';

const ENV_KEY = 'ANMIKA_NO_HUMAN_NEXT_ROUND_MS';
const NO_HUMAN_MS = 150;
// createWsRuntime が起動時に読む env。runtime を作る前 [module 評価時] に固定する
const previousEnv = process.env[ENV_KEY];
process.env[ENV_KEY] = String(NO_HUMAN_MS);

const SECRET = 'ws-no-active-human-secret';
const ROOM_ID = 'NH0902';
const INSTANCE_ID = 'no-active-human-instance';
const HOST_UID = 'nh-host';

// rotation 部屋 [4席]: host だけ人間、残り 3 席は CPU [user_id の CPU_ prefix で is_cpu 判定]
const ROOM_MEMBERS = [
  { seat: 0, user_id: HOST_UID, username: 'host' },
  { seat: 1, user_id: 'CPU_NH_1', username: 'CPU 1' },
  { seat: 2, user_id: 'CPU_NH_2', username: 'CPU 2' },
  { seat: 3, user_id: 'CPU_NH_3', username: 'CPU 3' },
];

type Client = { ws: WebSocket; messages: any[] };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

afterAll(() => {
  if (previousEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previousEnv;
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
  ws.on('error', () => { /* server 側の close [4001 replaced 等] を error 扱いにしない */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

/** stub member API + in-memory runtime で rotation 部屋を起動し、host が試合1を start した状態を返す */
async function bootRotationRoom() {
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ members: ROOM_MEMBERS, match_mode: 'tonpu', rotation_enabled: true }));
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
    nextRoundTimeoutMs: 60_000,
    testControlsEnabled: true,
    log: false,
  });
  cleanups.push(async () => runtime.close());
  const wsAddress = runtime.wss.address();
  if (!wsAddress || typeof wsAddress === 'string') throw new Error('test websocket did not bind');

  const now = Math.floor(Date.now() / 1000);
  const hostUrl = () => {
    const token = jwt.sign({
      uid: HOST_UID, username: HOST_UID, seat: 0, room_id: ROOM_ID,
      room_instance_id: INSTANCE_ID, is_host: true,
      iat: now, exp: now + 120,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${wsAddress.port}/ws/room/${ROOM_ID}?token=${encodeURIComponent(token)}`;
  };
  const connectHost = () => connect(hostUrl());

  const host = await connectHost();
  host.ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  const start = await waitUntil(() => host.messages.find((message) => message.type === 'start'), 4000, 'start frame');
  // 試合1: 初期抜け番 = room seat 3 [CPU 3]、host は game seat 0 [active human]
  expect(start).toMatchObject({ matchId: 1, roundId: 1, revision: 0, recipientRoomSeat: 0, recipientGameSeat: 0 });
  expect(start.activeMapping).toEqual({ gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 });
  const room = runtime.rooms.get(ROOM_ID);
  if (!room?.authority || !room.snapshot.started) throw new Error('room did not start');
  expect(room.members.size).toBe(4);
  return { runtime, persistence, room, host, connectHost };
}

/** 局終了 [post-win pending 無し、試合は継続] を canonical store と validation mirror の両方に立てる */
function endRoundSynthetically(room: { authority: { canonicalState(): any; roundEnded: boolean; isPostWinResolved(): boolean } | null }) {
  const authority = room.authority!;
  const canonical = authority.canonicalState();
  expect(canonical.game.state.finished).toBe(false);
  expect(canonical.roundEnded).toBe(false);
  expect(authority.isPostWinResolved()).toBe(false);
  canonical.roundEnded = true;
  authority.roundEnded = true;
  expect(authority.isPostWinResolved()).toBe(true);
}

const loggedNextRounds = (persistence: RoomPersistence) =>
  persistence.loadCommands(ROOM_ID).filter((command) => command.action?.type === 'nextRound');

const isNextRoundRelay = (message: any) => message.type === 'action' && message.action?.type === 'nextRound';

describe('no-active-human next round [2026-09-02 codex監査 P0]', () => {
  it('抜け番 host + CPU 3席の局終了は server が from_role=no-active-human の nextRound を代行する', async () => {
    const { runtime, persistence, room, host, connectHost } = await bootRotationRoom();

    // 試合1 を test control seam で terminal 化 → host の nextMatch で試合2へ
    // [rotation 決定則: 試合2の抜け番 = room seat 0 = host。active 3席 = CPU 1/2/3]
    const internalPort = await waitUntil(() => {
      const address = runtime.internalHttp.address();
      return address && typeof address === 'object' ? address.port : undefined;
    }, 4000, 'internal API port');
    const forced = await fetch(`http://127.0.0.1:${internalPort}/internal/test/force-finish-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
      body: JSON.stringify({ room_id: ROOM_ID }),
    });
    expect(await forced.json()).toEqual({ ok: true });

    host.ws.send(JSON.stringify({
      type: 'action', commandId: 'nh-next-match-0001', expectedVersion: 0,
      matchId: 1, roundId: 1, action: { type: 'nextMatch' },
    }));
    const nextMatch = await waitUntil(
      () => host.messages.find((message) => message.type === 'action' && message.commandId === 'nh-next-match-0001'),
      4000, 'nextMatch relay',
    );
    expect(nextMatch).toMatchObject({ matchId: 2, roundId: 1, revision: 1, recipientRoomSeat: 0, recipientGameSeat: null });
    expect(nextMatch.activeMapping).toEqual({ gameToRoom: [1, 2, 3], inactiveRoomSeat: 0 });
    // activeHumanMembers が空である事の裏取り: active 3席の member は全員 CPU
    const activeMembers = room.snapshot.activeMapping!.gameToRoom
      .map((roomSeat) => [...room.members.values()].find((member) => member.seat === roomSeat));
    expect(activeMembers.map((member) => member?.user_id)).toEqual(['CPU_NH_1', 'CPU_NH_2', 'CPU_NH_3']);
    expect(activeMembers.every((member) => member?.is_cpu === true)).toBe(true);
    expect(room.snapshot.revision).toBe(1);

    endRoundSynthetically(room);

    // host 再接続 [D-15: 再接続時に scheduleRoomDeadline を張り直す正規経路] で分岐を通す
    const reconnectedAt = Date.now();
    const reconnected = await connectHost();
    await waitUntil(() => reconnected.messages.find((message) => message.type === 'sync'), 4000, 'reconnect sync');
    const auto = await waitUntil(() => reconnected.messages.find(isNextRoundRelay), 1500, 'no-active-human nextRound relay');
    const elapsedMs = Date.now() - reconnectedAt;

    expect(auto.action.from_role).toBe('no-active-human');
    expect(auto).toMatchObject({ revision: 2, matchId: 2, roundId: 2 });
    expect(String(auto.commandId).startsWith(`srv:${ROOM_ID}:`)).toBe(true);
    expect(elapsedMs).toBeLessThan(1500);
    expect(elapsedMs).toBeGreaterThanOrEqual(NO_HUMAN_MS);

    const logged = loggedNextRounds(persistence);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ revision: 2, action: { type: 'nextRound', from_role: 'no-active-human' } });
    expect(room.snapshot.revision).toBeGreaterThanOrEqual(2);
    expect(persistence.loadSnapshot(ROOM_ID)?.revision).toBeGreaterThanOrEqual(2);
    expect(room.snapshot.roundId).toBeGreaterThanOrEqual(2);
    // 次局が実際に始まっている [試合は継続、局は未終了]
    expect(room.authority!.canonicalState().game.state.finished).toBe(false);
  });

  it('active 席に人間がいれば [試合1: host active] 自動 nextRound は出ず、全員ready gate だけが進める', async () => {
    const { persistence, room, host, connectHost } = await bootRotationRoom();
    // 試合1: host = game seat 0 [active human]、CPU 1/2 が active、CPU 3 が抜け番
    expect([...room.members.values()].filter((member) => !member.is_cpu).map((member) => member.seat)).toEqual([0]);
    expect(room.snapshot.activeMapping).toEqual({ gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 });

    endRoundSynthetically(room);

    const reconnected = await connectHost();
    await waitUntil(() => reconnected.messages.find((message) => message.type === 'sync'), 4000, 'reconnect sync');
    // 同じ待ち時間 [150ms] の 4 倍待っても server は動かない [ready gate の仕様通り]
    await sleep(NO_HUMAN_MS * 4);
    expect(reconnected.messages.some(isNextRoundRelay)).toBe(false);
    expect(host.messages.some(isNextRoundRelay)).toBe(false);
    expect(loggedNextRounds(persistence)).toHaveLength(0);
    expect(room.snapshot.revision).toBe(0);
    expect(room.deadlineTimer).toBeNull();
    expect(room.nextRoundTimer).toBeNull();

    // 裏取り: 同じ局終了 state でも ready gate は生きている [state が進行不能なのではない]
    reconnected.ws.send(JSON.stringify({ type: 'readyNextRound', revision: 0 }));
    await waitUntil(() => reconnected.messages.find((message) => message.type === 'readyNextRoundAck'), 4000, 'ready ack');
    const byReady = await waitUntil(() => reconnected.messages.find(isNextRoundRelay), 1500, 'all-ready nextRound relay');
    expect(byReady.action.from_role).toBe('all-ready');
    expect(byReady).toMatchObject({ revision: 1, matchId: 1, roundId: 2 });
    expect(loggedNextRounds(persistence).map((command) => command.action.from_role)).toEqual(['all-ready']);
  });
});
