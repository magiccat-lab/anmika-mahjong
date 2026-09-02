// [2026-09-02 yuma] ws_server scheduleRoomDeadline の「永久 re-arm」観測 probe。
//
// codex 監査で残った 2 つの投機的リスクを、canonical state を直接作って ws runtime
// [createWsRuntime port:0、短い timeout] で観測する:
//   (a) lizhiPending なのに宣言牌候補が 0 → turnTimeoutAction が null → 期限だけ張り直し続ける
//       [server/ws_server.ts turnTimeoutAction 末尾の `return null` と、turn deadline 内の
//        `if (!action) { scheduleRoomDeadline(room); return; }`]
//   (b) post-win pending の候補リストが空 [pendingKamiPochi.candidates=[] /
//       pendingPochiSwap.candidates=[]] → 代行 action [candidates[0]] が権威に reject →
//       `scheduleRoomDeadline(room)` で同じ期限を張り直し続ける
//
// どちらも正規の command 列では到達できない [lizhi は canLizhi=候補>0 が前提で、その後は
// 宣言牌 discard しか受理されない / getKamiPochiCandidates は 27〜31 種の固定リスト]。
// なので通常 suite からは外し [STALL_PROBE=1 で走る]、期待値は「復旧する」側に置く。
// 現状は fail = 再現、の診断テスト。fix 後に gate を外せば回帰テストになる。
//   STALL_PROBE=1 npx vitest run ws_deadline_rearm_probe
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime, turnTimeoutAction } from '../../../server/ws_server';
import { buildShoupai } from '../game3';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROBE_LOG_DIR = process.env.STALL_PROBE_LOG_DIR
  || '/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/09998d2f-bc99-45b7-919c-b976a027a663/scratchpad/anmika_stall';
function probeLog(label: string, payload: unknown): void {
  const line = `[rearm-probe ${label}] ${JSON.stringify(payload)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    mkdirSync(PROBE_LOG_DIR, { recursive: true });
    appendFileSync(join(PROBE_LOG_DIR, 'rearm_probe.jsonl'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* log dir unavailable */ }
}

const ENABLED = process.env.STALL_PROBE === '1';
// scheduleRoomDeadline が呼び出し時に process.env から読む [人間 owner の post-win 代行待ち]
const POST_WIN_KEY = 'ANMIKA_POST_WIN_TIMEOUT_MS';
const previousPostWin = process.env[POST_WIN_KEY];
process.env[POST_WIN_KEY] = '100';

const SECRET = 'ws-rearm-probe-secret';
const TURN_MS = 200;
const OBSERVE_MS = 1500;

type Client = { ws: WebSocket; messages: any[] };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

afterAll(() => {
  if (previousPostWin === undefined) delete process.env[POST_WIN_KEY];
  else process.env[POST_WIN_KEY] = previousPostWin;
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
  ws.on('error', () => { /* replaced [4001] 等を error 扱いにしない */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

/** 3 人間部屋を起動して host が start した状態。room は runtime.rooms から直接触る */
async function bootRoom(roomId: string) {
  const persistence = new RoomPersistence(':memory:');
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    wsSecret: SECRET,
    internalApiSecret: '',
    persistence,
    reactionTimeoutMs: TURN_MS,
    turnTimeoutMs: TURN_MS,
    disconnectGraceMs: TURN_MS,
    nextRoundTimeoutMs: 60_000,
    log: false,
  });
  cleanups.push(async () => runtime.close());
  const address = runtime.wss.address();
  if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const url = (uid: string, seat: number, isHost = false) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: roomId,
      room_instance_id: `${roomId}-instance`, is_host: isHost,
      iat: now, exp: now + 120,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
  };
  const clients = await Promise.all([connect(url('p0', 0, true)), connect(url('p1', 1)), connect(url('p2', 2))]);
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((message) => message.type === 'start'), 4000, 'start')));
  const room = runtime.rooms.get(roomId);
  if (!room?.authority || !room.snapshot.started) throw new Error('room did not start');
  // start 直後の手番 deadline [TURN_MS] が state 細工より先に発火しないよう、細工の間は止めておく
  if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
  room.deadlineTimer = null;
  return { runtime, persistence, room, clients, url };
}

/** 再接続 [監査 D-15 の張り直し経路] で scheduleRoomDeadline を通し、その後 OBSERVE_MS の間
 *  deadlineTimer の identity 変化 [= re-arm 回数] と revision の推移を観測する */
async function observeRearm(room: any, reconnect: () => Promise<Client>) {
  const revisionBefore = room.snapshot.revision;
  const reconnected = await reconnect();
  await waitUntil(() => reconnected.messages.find((message) => message.type === 'sync'), 4000, 'reconnect sync');
  const startedAt = Date.now();
  const timers = new Set<object>();
  let firstTimer: object | null = null;
  while (Date.now() - startedAt < OBSERVE_MS) {
    const timer = room.deadlineTimer;
    if (timer) {
      if (!firstTimer) firstTimer = timer;
      timers.add(timer);
    }
    await sleep(5);
  }
  const relayed = reconnected.messages.filter((message) => message.type === 'action').map((message) => message.action?.type);
  return {
    revisionBefore,
    revisionAfter: room.snapshot.revision as number,
    rearms: timers.size,
    timerArmedAtEnd: room.deadlineTimer !== null,
    relayedActionTypes: relayed,
    rejects: reconnected.messages.filter((message) => message.type === 'reject').map((message) => message.reason),
  };
}

describe.skipIf(!ENABLED)('ws deadline re-arm probe [STALL_PROBE=1]', { timeout: 30_000 }, () => {
  it('(a) lizhiPending with zero declaration candidates: turn deadline must not re-arm forever', async () => {
    const { room, url } = await bootRoom('RA0902');
    const authority = room.authority!;
    const canonical: any = authority.canonicalState();
    const current = authority.currentPlayer();
    // 聴牌から遠い手 [候補 0] を canonical と validation mirror の両方に置く
    const tiles = ['m7', 'm9', 'p1', 'p4', 'p7', 's2', 's5', 's8', 'z1', 'z2', 'z3', 'z5', 'z6'];
    for (const game of [canonical.game, authority.game]) {
      const sp = buildShoupai(tiles);
      sp.zimo('z7');
      game.shoupai.set(current, sp);
      game.lastZimoInfo = { player: current, pai: 'z7', pochi: null, gold: false };
    }
    canonical.lastZimo = 'z7';
    authority.lastZimo = 'z7';
    canonical.lizhiPending = current;
    canonical.lizhiPendingFlags = { open: false, shuvari: false, fever: false };
    canonical._lizhiOpen = false;
    canonical._lizhiShuvari = false;
    canonical._lizhiFever = false;
    expect(authority.game.getLizhiCandidates(current)).toEqual([]);
    expect(turnTimeoutAction(authority, false)).toBeNull();
    expect(turnTimeoutAction(authority, true)).toBeNull();

    const seatUid = `p${current}`;
    const observed = await observeRearm(room, () => connect(url(seatUid, current, current === 0)));
    probeLog('a lizhiPending zero candidates', observed);
    // 期待 [復旧]: 観測窓の間に何かが accept されて revision が進む。
    // 現状 [再現]: rearms が OBSERVE_MS/TURN_MS 程度まで増え、revision は不変
    expect(observed.revisionAfter, `re-armed ${observed.rearms} times in ${OBSERVE_MS}ms without progress`).toBeGreaterThan(observed.revisionBefore);
  });

  it('(b1) pendingKamiPochi with empty candidates: post-win deadline must not re-arm forever', async () => {
    const { room, url } = await bootRoom('RB0902');
    const authority = room.authority!;
    const canonical: any = authority.canonicalState();
    canonical.roundEnded = true;
    canonical.lastWinner = 1;
    authority.roundEnded = true;
    authority.lastWinner = 1;
    canonical.pendingKamiPochi = {
      winner: 1, context: 'dora', occurrenceKey: 'baopai:0', candidates: [],
      decisionOwners: [1], decisionOwnerIndex: 0, isRon: false, ronfrom: null,
    };
    expect(authority.isPostWinResolved()).toBe(false);

    const observed = await observeRearm(room, () => connect(url('p1', 1)));
    probeLog('b1 pendingKamiPochi empty candidates', observed);
    expect(observed.revisionAfter, `re-armed ${observed.rearms} times in ${OBSERVE_MS}ms without progress`).toBeGreaterThan(observed.revisionBefore);
  });

  it('(b2) pendingPochiSwap with empty candidates: post-win deadline must not re-arm forever', async () => {
    const { room, url } = await bootRoom('RC0902');
    const authority = room.authority!;
    const canonical: any = authority.canonicalState();
    canonical.roundEnded = true;
    canonical.lastWinner = 2;
    authority.roundEnded = true;
    authority.lastWinner = 2;
    canonical.pendingPochiSwap = {
      winner: 2, kind: 'white', candidates: [],
      decisionOwners: [2], decisionOwnerIndex: 0, isRon: false, ronfrom: null,
    };
    expect(authority.isPostWinResolved()).toBe(false);

    const observed = await observeRearm(room, () => connect(url('p2', 2)));
    probeLog('b2 pendingPochiSwap empty candidates', observed);
    expect(observed.revisionAfter, `re-armed ${observed.rearms} times in ${OBSERVE_MS}ms without progress`).toBeGreaterThan(observed.revisionBefore);
  });

  it('(b3) post-win owner is not a real seat: deadline must not re-arm forever', async () => {
    const { room, url } = await bootRoom('RD0902');
    const authority = room.authority!;
    const canonical: any = authority.canonicalState();
    canonical.roundEnded = true;
    canonical.lastWinner = 0;
    authority.roundEnded = true;
    authority.lastWinner = 0;
    canonical.pendingFuyu = { winner: 0, decisionOwners: [3], decisionOwnerIndex: 0, isRon: false, ronfrom: null };
    expect(authority.isPostWinResolved()).toBe(false);

    const observed = await observeRearm(room, () => connect(url('p0', 0, true)));
    probeLog('b3 pendingFuyu owner=3', observed);
    expect(observed.revisionAfter, `re-armed ${observed.rearms} times in ${OBSERVE_MS}ms without progress`).toBeGreaterThan(observed.revisionBefore);
  });

  it('(c) open-riichi wait tile picked by turnTimeoutAction: CPU deadline must not re-arm forever', async () => {
    // authority_stall_hunt が見つけた実到達可能な stall [seed 0x956ad354 step 1885 等] の最小再現:
    // seat0 がオープン立直 [待ち s3/s6 の p123456 s12 s55 s66 形]、CPU 席 [seat2] が待ち牌 s3 を
    // ツモり、pickBestDiscard がその s3 を選ぶ → dapai の「オープン立直の待ち牌は打牌不可」で reject
    const { room, url } = await bootRoom('RE0902');
    const authority = room.authority!;
    const canonical: any = authority.canonicalState();
    // seat 2 を CPU 扱いにする [member flag]。deadline driver は is_cpu で 750ms / isCpu=true 分岐
    const member2 = [...room.members.values()].find((member) => member.seat === 2)!;
    member2.is_cpu = true;
    canonical.cpu = { 0: false, 1: false, 2: true };

    // 手番を seat 2 にし、seat 0 をオープン立直状態にする
    const game: any = canonical.game;
    const mirror: any = authority.game;
    for (const g of [game, mirror]) {
      g.state.lunban = (((g.currentOya - 2) % 3) + 3) % 3;
      const open = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's5', 's5', 's6', 's6', 's0']);
      g.shoupai.set(0, open);
      g.lizhi.add(0);
      g.openLizhi.add(0);
      const cpu = buildShoupai(['m7', 'm7', 'p2', 'p3', 'p4', 'p4', 'p6', 'p8', 'p9', 's7', 's8', 's9', 'z3']);
      cpu.zimo('s3');
      g.shoupai.set(2, cpu);
      g.lastZimoInfo = { player: 2, pai: 's3', pochi: null, gold: false };
    }
    canonical.lastZimo = 's3';
    authority.lastZimo = 's3';
    expect(authority.currentPlayer()).toBe(2);
    const driver = turnTimeoutAction(authority, true);
    probeLog('c CPU driver action', driver);

    const observed = await observeRearm(room, () => connect(url('p0', 0, true)));
    probeLog('c open-riichi wait tile', observed);
    expect(observed.revisionAfter, `re-armed ${observed.rearms} times in ${OBSERVE_MS}ms without progress; driver=${JSON.stringify(driver)} rejects=${JSON.stringify(observed.rejects)}`).toBeGreaterThan(observed.revisionBefore);
  });
});
