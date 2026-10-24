// [2026-10-24 リョー「部屋チップといまの所持チップを揃えるようにしてね」]
// 4人回しの部屋で、試合の終わりの順位チップ [ウマ等] が room ledger に入り、
// 次の試合の game chipLedger が新しい mapping で room ledger から引き直されることの試験。
// - rotation.ts の finalizeRoomChipDelta / mergeRoomChipDelta / gameLedgerFromRoom の単体
// - ws 統合: force-finish → match-result → nextMatch → room ledger / game ledger / 再起動復元
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime, restoreAuthority } from '../../../server/ws_server';
import { finalizeRoomChipDelta, gameLedgerFromRoom, mergeRoomChipDelta } from '../../../server/rotation';
import type { RoomSeatMapping } from '../../../server/protocol';

// ---- 単体 ----

const M012: RoomSeatMapping = { gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 };
const M123: RoomSeatMapping = { gameToRoom: [1, 2, 3], inactiveRoomSeat: 0 };
const M013: RoomSeatMapping = { gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 };

/** getFinalScore / chipLedger / state.finished だけ持つ game の替え玉 */
function fakeGame(finished: boolean, totals: [number, number, number], ledger: [number, number, number]) {
  return {
    state: { finished },
    chipLedger: { 0: ledger[0], 1: ledger[1], 2: ledger[2] } as Record<number, number>,
    getFinalScore: () => totals.map((total, player) => ({ player, total })),
  };
}

describe('finalizeRoomChipDelta', () => {
  it('終わっていない試合は null', () => {
    expect(finalizeRoomChipDelta(fakeGame(false, [75, -25, -50], [0, 0, 0]), M012)).toBeNull();
  });

  it('total - chipLedger を mapping で room seat に写す', () => {
    // game seat 0,1,2 → room seat 1,2,3 [抜け番 0]。ledger 持ち越し分は引く
    const delta = finalizeRoomChipDelta(fakeGame(true, [80, -20, -60], [5, 5, -10]), M123);
    expect(delta).toEqual({ '1': 75, '2': -25, '3': -50 });
    expect(Object.values(delta!).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('0 の席は落とす、全員 0 なら null', () => {
    expect(finalizeRoomChipDelta(fakeGame(true, [10, 0, -10], [0, 0, 0]), M012)).toEqual({ '0': 10, '2': -10 });
    expect(finalizeRoomChipDelta(fakeGame(true, [3, 4, 5], [3, 4, 5]), M012)).toBeNull();
  });

  it('3人打ち [inactiveRoomSeat -1] の mapping でも写せる', () => {
    expect(finalizeRoomChipDelta(fakeGame(true, [50, 0, -50], [0, 0, 0]), M013)).toEqual({ '0': 50, '3': -50 });
  });
});

describe('mergeRoomChipDelta', () => {
  it('席ごとに足し、0 になった席は落とす', () => {
    expect(mergeRoomChipDelta({ '0': 5, '1': -5 }, { '1': 5, '2': 3, '3': -3 })).toEqual({ '0': 5, '2': 3, '3': -3 });
  });

  it('片方だけ / 両方無しの時', () => {
    expect(mergeRoomChipDelta(null, { '2': 4 })).toEqual({ '2': 4 });
    expect(mergeRoomChipDelta({ '2': 4 }, undefined)).toEqual({ '2': 4 });
    expect(mergeRoomChipDelta(null, null)).toBeNull();
    expect(mergeRoomChipDelta({ '1': 2 }, { '1': -2 })).toBeNull();
  });

  it('入力を書き換えない', () => {
    const a = { '0': 1 };
    mergeRoomChipDelta(a, { '0': 2 });
    expect(a).toEqual({ '0': 1 });
  });
});

describe('gameLedgerFromRoom', () => {
  const room = { '0': 10, '1': -20, '2': 30, '3': -20 };

  it('game seat g に room seat gameToRoom[g] の残高を引く', () => {
    expect(gameLedgerFromRoom(room, M012)).toEqual({ 0: 10, 1: -20, 2: 30 });
    expect(gameLedgerFromRoom(room, M123)).toEqual({ 0: -20, 1: 30, 2: -20 });
  });

  it('inactiveRoomSeat -1 [3人打ち] の mapping で引ける', () => {
    expect(gameLedgerFromRoom(room, M013)).toEqual({ 0: 10, 1: -20, 2: -20 });
  });

  it('room ledger に無い席は 0', () => {
    expect(gameLedgerFromRoom({ '1': 7 }, M012)).toEqual({ 0: 0, 1: 7, 2: 0 });
  });
});

// ---- ws 統合 [ws_rotation_leave_2026_10_24.test.ts と同じ harness] ----

const SECRET = 'ws-rotation-chip-align-secret';
const ROOM = 'RC0001';
const INSTANCE = 'rc-instance';

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
  ws.on('error', () => { /* close を error 扱いにしない */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

const UIDS = ['rc0', 'rc1', 'rc2', 'rc3'];

/** stub member API [4 人そろった名簿を返す] */
async function bootStubApi() {
  const members = UIDS.map((user_id, seat) => ({ seat, user_id, username: user_id }));
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ members, match_mode: 'tonpu', rotation_enabled: true }));
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
  cleanups.push(async () => { try { await runtime.close(); } catch { /* 閉じ済み */ } });
  return runtime;
}

function urlFor(runtime: ReturnType<typeof makeRuntime>, uid: string) {
  const address = runtime.wss.address();
  if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({
    uid, username: uid, seat: UIDS.indexOf(uid), room_id: ROOM, room_instance_id: INSTANCE,
    is_host: uid === 'rc0', iat: now, exp: now + 300,
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

/** 4 人全員接続して start、試合 1 が走っている状態 [抜け番 = room seat 3] */
async function bootRotation(persistence = new RoomPersistence(':memory:')) {
  const apiBase = await bootStubApi();
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
  expect(room.snapshot.activeMapping).toEqual(M012);
  return { runtime, room, clients, persistence };
}

const forceFinish = async (runtime: ReturnType<typeof makeRuntime>) => {
  expect(await post(runtime, '/internal/test/force-finish-match', { room_id: ROOM })).toEqual({ ok: true });
};

let seq = 0;
async function advanceMatch(clients: Client[], room: any) {
  const commandId = `rc-next-${seq += 1}`;
  clients[1].ws.send(JSON.stringify({
    type: 'action', commandId,
    expectedVersion: room.snapshot.revision, matchId: room.snapshot.matchId, roundId: room.snapshot.roundId,
    action: { type: 'nextMatch' },
  }));
  await waitUntil(() => clients[0].messages.find((m) => m.type === 'action' && m.commandId === commandId), 4000, 'nextMatch relay');
}

/** 終わった試合の順位チップを、独立に room seat へ写した期待値 */
function expectedFinalize(room: any): Record<string, number> {
  const game = room.authority.canonicalState().game;
  const mapping: RoomSeatMapping = room.snapshot.activeMapping;
  const out: Record<string, number> = {};
  for (const row of game.getFinalScore()) {
    const value = row.total - (game.chipLedger[row.player] ?? 0);
    if (value !== 0) out[String(mapping.gameToRoom[row.player])] = value;
  }
  return out;
}

const gameLedgerOf = (authority: any) => {
  const ledger = authority.canonicalState().game.chipLedger;
  return { 0: ledger[0], 1: ledger[1], 2: ledger[2] };
};

/** game seat g のチップ = roomChipLedger[gameToRoom[g]] */
function expectedGameLedger(room: any) {
  const mapping: RoomSeatMapping = room.snapshot.activeMapping;
  const roomLedger = room.snapshot.roomChipLedger as Record<string, number>;
  return {
    0: roomLedger[String(mapping.gameToRoom[0])] ?? 0,
    1: roomLedger[String(mapping.gameToRoom[1])] ?? 0,
    2: roomLedger[String(mapping.gameToRoom[2])] ?? 0,
  };
}

const sumOf = (ledger: Record<string, number>) => Object.values(ledger).reduce((a, b) => a + b, 0);

describe('4人回し 部屋チップと所持チップの整合 [2026-10-24]', () => {
  it('試合の終わりの順位チップが room ledger に入り、次の試合の game chip が新 mapping で引き直される', async () => {
    const { runtime, room, clients, persistence } = await bootRotation();
    const before = { ...room.snapshot.roomChipLedger };
    await forceFinish(runtime);
    const finalize = expectedFinalize(room);
    // 順位チップが 0 だと何も確かめられない [ウマは必ず付く]
    expect(Object.keys(finalize).length).toBeGreaterThan(0);
    expect(sumOf(finalize)).toBe(0);

    // match-result [nextMatch の前] にも同じ値が room ledger delta として出る
    const result = await post(runtime, '/internal/match-result', { room_id: ROOM });
    expect(result.finished).toBe(true);
    expect(result.roomLedgerDeltaBySeat).toEqual(finalize);
    for (const [seat, value] of Object.entries(finalize)) {
      expect(result.roomLedgerDelta[UIDS[Number(seat)]]).toBe(value);
    }

    await advanceMatch(clients, room);
    expect(room.snapshot.matchId).toBe(2);
    expect(room.snapshot.activeMapping).toEqual(M123);

    // (a) room ledger = 前 + finalize、合計 0
    const after = room.snapshot.roomChipLedger as Record<string, number>;
    for (const seat of ['0', '1', '2', '3']) {
      expect(after[seat]).toBe((before[seat] ?? 0) + (finalize[seat] ?? 0));
    }
    expect(sumOf(after)).toBe(0);

    // (b) 新しい試合の game chip は新 mapping [1,2,3] で room ledger から引く
    const seeded = expectedGameLedger(room);
    expect(gameLedgerOf(room.authority)).toEqual(seeded);
    expect(room.authority.currentMatchStartChipLedger()).toEqual(seeded);
    // 席番号のまま持ち越した時と違う値になっていること [= 試験が効いている]
    const carriedBySeat = { 0: after['0'], 1: after['1'], 2: after['2'] };
    expect(seeded).not.toEqual(carriedBySeat);
    const commands = persistence.loadCommands(ROOM);
    const nextMatchCommand = [...commands].reverse().find((c) => (c.action as any).type === 'nextMatch')!;
    expect((nextMatchCommand.action as any)._startChipLedger).toEqual(seeded);
    expect((nextMatchCommand.action as any)._roomChipDelta).toEqual(finalize);
  });

  it('2 試合続けても整合が崩れず、match-result の delta は 2 試合目の分だけ', async () => {
    const { runtime, room, clients } = await bootRotation();
    await forceFinish(runtime);
    const first = expectedFinalize(room);
    await advanceMatch(clients, room);
    const midLedger = { ...room.snapshot.roomChipLedger };

    await forceFinish(runtime);
    const second = expectedFinalize(room);
    expect(sumOf(second)).toBe(0);
    const result = await post(runtime, '/internal/match-result', { room_id: ROOM });
    expect(result.roomLedgerDeltaBySeat).toEqual(second);

    await advanceMatch(clients, room);
    expect(room.snapshot.matchId).toBe(3);
    const after = room.snapshot.roomChipLedger as Record<string, number>;
    for (const seat of ['0', '1', '2', '3']) {
      expect(after[seat]).toBe((midLedger[seat] ?? 0) + (second[seat] ?? 0));
    }
    expect(sumOf(after)).toBe(0);
    expect(room.snapshot.activeMapping).not.toEqual(M123);
    expect(gameLedgerOf(room.authority)).toEqual(expectedGameLedger(room));
    // 1 試合目の分が残っていて、2 試合目で積み上がっている [中途半端に消えていない]
    expect(sumOf(first)).toBe(0);
    expect(Object.values(after).some((v) => v !== 0)).toBe(true);
  });

  it('(c) ws 再起動の復元でも、新しい試合の game chip は room ledger と揃ったまま', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'anmika-rc-'));
    cleanups.push(async () => { rmSync(dir, { recursive: true, force: true }); });
    const dbPath = path.join(dir, 'rooms.sqlite3');
    const first = await bootRotation(new RoomPersistence(dbPath));
    await forceFinish(first.runtime);
    await advanceMatch(first.clients, first.room);
    const seeded = expectedGameLedger(first.room);
    const roomLedger = { ...first.room.snapshot.roomChipLedger };
    expect(gameLedgerOf(first.room.authority)).toEqual(seeded);
    // 純関数の復元 [区切りの _startChipLedger から]
    const restored = restoreAuthority(first.persistence.loadSnapshot(ROOM)!, first.persistence.loadCommands(ROOM));
    expect(gameLedgerOf(restored)).toEqual(seeded);

    for (const c of first.clients) c.ws.terminate();
    await sleep(100);
    await first.runtime.close();
    const secondApi = await bootStubApi();
    const second = makeRuntime(secondApi, new RoomPersistence(dbPath));
    const client = await connect(urlFor(second, 'rc0'));
    await waitUntil(() => client.messages.find((m) => m.type === 'lobby'), 4000, 'rc0 registered');
    const room = second.rooms.get(ROOM)!;
    expect(room.snapshot.matchId).toBe(2);
    expect(room.snapshot.activeMapping).toEqual(M123);
    expect(room.snapshot.roomChipLedger).toEqual(roomLedger);
    const authority = await waitUntil(() => room.authority ?? undefined, 4000, 'authority restored');
    expect(gameLedgerOf(authority)).toEqual(seeded);
    expect(gameLedgerOf(authority)).toEqual(expectedGameLedger(room));
  }, 30_000);
});
