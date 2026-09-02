// [2026-09-02 yuma] authority_stall_hunt が見つけた「対局続行不可能」の最小再現。
//
// 症状: 他家がオープン立直している時、手番プレイヤーの server driver
// [ws_server.ts turnTimeoutAction → game.pickBestDiscard] がオープン立直の待ち牌を
// 打牌候補に選ぶ。Game3.dapai は「オープン立直の待ち牌は、手牌全部が当たり牌の場合以外は
// 打牌不可」で throw → RoomAuthority が reject → acceptAction が restoreAuthority で
// command log から権威を組み直す [state は同じ] → scheduleRoomDeadline が同じ deadline を
// 張り直す → 永久ループ。
//   ・手番が CPU 席: 750ms ごとに reject + 全 command replay。人間は誰も操作できず卓が止まる [hard stall]
//   ・手番が人間席: 本人が別の牌を手で切れば進むが、AFK/切断中は turnTimeoutMs ごとに同じ reject
//     [切断猶予の代行が永久に効かない = 残り 2 人が待ち続ける]
//
// 再現 [22 command、HHC 部屋、seed 3428987889 の directed search]:
//   seat1 が open riichi [m9 単騎待ち]、seat2 [CPU] が s3 をツモ、pickBestDiscard が m9 を選ぶ。
//   seat2 は z6 対子や s3 など他に切れる牌があるため「全部当たり牌」の例外に当たらず reject。
//
// 通常 suite からは外してある [STALL_PROBE=1]。期待値は「復旧する」側 [= 現状 fail]。
// turnTimeoutAction / pickBestDiscard が isOpenReachWaitDiscardForbidden 相当で候補を
// 除外するよう直したら、gate を外して回帰テストにする。
//   STALL_PROBE=1 npx vitest run ws_open_riichi_wait_stall
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RoomPersistence } from '../../../server/persistence';
import { createRoomAuthority } from '../../../server/authority';
import { appendAcceptedCommand, ROOM_SNAPSHOT_SCHEMA_VERSION, type CanonicalRoomSnapshot } from '../../../server/protocol';
import { createWsRuntime, turnTimeoutAction } from '../../../server/ws_server';

// [2026-09-02] 修正 [game3 evaluateDiscardRows_ の禁止牌除外 + ws_server deadline の reject フォールバック] 後は
// 通常 suite の回帰テスト。STALL_PROBE=0 で切れる
const ENABLED = process.env.STALL_PROBE !== '0';
const PROBE_LOG_DIR = process.env.STALL_PROBE_LOG_DIR
  || '/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/09998d2f-bc99-45b7-919c-b976a027a663/scratchpad/anmika_stall';
function probeLog(label: string, payload: unknown): void {
  const line = `[open-riichi-stall ${label}] ${JSON.stringify(payload)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    mkdirSync(PROBE_LOG_DIR, { recursive: true });
    appendFileSync(join(PROBE_LOG_DIR, 'rearm_probe.jsonl'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* log dir unavailable */ }
}

// directed search [scratch find_open_riichi_repro.mts] の出力。seed 3428987889、東風、起家 2
const REPRO = {
  qijia: 2,
  changshu: 1,
  pool: ['p7', 's6', 's5', 's6', 'z2', 's3', 'f4', 's3', 's4', 'z1', 'nz3', 'z5b', 'f2', 'p6', 'p1', 'p6', 'p8', 'z7', 'np3', 'p2', 's1', 's6', 's7', 'z7', 's8', 'm7', 'z2', 'p1', 'f4', 'p1', 'z5g', 'p9', 's8', 'z7', 'z6', 'm7', 'z2', 's1', 'z6', 's9', 'f1', 'p5', 'm9', 'p4', 's8', 'f2', 'p7', 'm9', 'm7', 'z4', 's2', 'p8', 'p8', 's1', 's4', 's2', 'p6', 's6', 'ns3', 's2', 's8', 'p9', 'p4', 'z3', 's7', 'z1', 'p3', 'z7', 'gs', 's0', 's9', 'p9', 'p8', 'm9', 'f3', 'f3', 'z2', 'z6', 's3', 'p3', 's4', 'z5r', 'z5y', 'p2', 'p5', 's9', 's5', 's7', 'p3', 'z3', 'm7', 'z3', 'p1', 'p7', 'z1', 'p0', 's2', 'z1', 'gN', 'm9', 'p7', 's9', 's1', 's7', 'gp', 'p6', 'f1', 'z4', 'p4', 'p9', 'p2', 's4', 'p4', 'z6', 'p2', 'z4'],
  commands: [
    { actorSeat: 2, action: { type: 'nukiBei', meta: { gold: false } } },
    { actorSeat: 2, action: { type: 'nukiBei', meta: { gold: true } } },
    { actorSeat: 2, action: { type: 'discard', pai: 'z2' } },
    { actorSeat: 1, action: { type: 'discard', pai: 'z5' } },
    { actorSeat: 0, action: { type: 'discard', pai: 'z5' } },
    { actorSeat: 2, action: { type: 'discard', pai: 'z3' } },
    { actorSeat: 1, action: { type: 'discard', pai: 'p2' } },
    { actorSeat: 0, action: { type: 'discard', pai: 'z3' } },
    { actorSeat: 2, action: { type: 'discard', pai: 'p1' } },
    { actorSeat: 1, action: { type: 'discard', pai: 's1' } },
    { actorSeat: 0, action: { type: 'discard', pai: 's9' } },
    { actorSeat: 2, action: { type: 'discard', pai: 'z7_' } },
    { actorSeat: 1, action: { type: 'lizhi', opts: { open: true, shuvari: false, fever: false } } },
    { actorSeat: 1, action: { type: 'discard', pai: 'm7' } },
    { actorSeat: 0, action: { type: 'discard', pai: 's7' } },
    { actorSeat: 2, action: { type: 'discard', pai: 's7_' } },
    { actorSeat: 1, action: { type: 'tsumokiri' } },
    { actorSeat: 0, action: { type: 'discard', pai: 'z1' } },
    { actorSeat: 2, action: { type: 'discard', pai: 'p9_' } },
    { actorSeat: 0, action: { type: 'pass', player: 0 } },
    { actorSeat: 1, action: { type: 'tsumokiri' } },
    { actorSeat: 0, action: { type: 'discard', pai: 's2_' } },
  ] as Array<{ actorSeat: number; action: Record<string, unknown> }>,
};
const MEMBERS = [
  { seat: 0, user_id: 'p0', username: 'p0', is_cpu: false },
  { seat: 1, user_id: 'p1', username: 'p1', is_cpu: false },
  { seat: 2, user_id: 'CPU_2', username: 'CPU 2', is_cpu: true },
];
const SECRET = 'ws-open-riichi-stall-secret';
const ROOM_ID = 'OR0902';
const INSTANCE_ID = 'open-riichi-instance';
const OBSERVE_MS = 3200; // CPU 手番 deadline は 750ms 固定 [ws_server.ts] なので 4 発ぶん

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
  ws.on('error', () => { /* ignore close races */ });
  cleanups.push(() => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  }));
  return { ws, messages };
}

/** 本番と同じ経路で command log を積んだ persistence を作る [appendAcceptedCommand で fold] */
function seedPersistence(): RoomPersistence {
  const persistence = new RoomPersistence(':memory:');
  const start = { preShuffledPool: REPRO.pool, qijia: REPRO.qijia, members: MEMBERS, changshu: REPRO.changshu };
  let snapshot: CanonicalRoomSnapshot = {
    schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION,
    roomId: ROOM_ID,
    roomInstanceId: INSTANCE_ID,
    matchId: 1,
    roundId: 1,
    revision: 0,
    started: true,
    start,
    commands: [],
    updatedAt: new Date().toISOString(),
    activeMapping: null,
    roomChipLedger: { 0: 0, 1: 0, 2: 0 },
  };
  persistence.resetRoom(snapshot);
  REPRO.commands.forEach((entry, index) => {
    const appended = appendAcceptedCommand(snapshot, {
      commandId: `repro-${index + 1}`,
      actorSeat: entry.actorSeat,
      actorRoomSeat: entry.actorSeat,
      fromUserId: entry.actorSeat === 2 ? 'deadline-seat-2' : `p${entry.actorSeat}`,
      action: { ...entry.action },
    });
    persistence.saveAcceptedCommand(appended.snapshot, appended.command, {
      type: 'ack', commandId: appended.command.commandId, accepted: true, duplicate: false,
      revision: appended.snapshot.revision, matchId: appended.snapshot.matchId, roundId: appended.snapshot.roundId,
    });
    snapshot = appended.snapshot;
  });
  return persistence;
}

describe.skipIf(!ENABLED)('open-riichi wait tile picked by the server driver [STALL_PROBE=1]', { timeout: 30_000 }, () => {
  it('authority: replaying the 22 commands leaves the CPU driver action rejected [stall root cause]', () => {
    const authority = createRoomAuthority({ preShuffledPool: REPRO.pool, qijia: REPRO.qijia, changshu: REPRO.changshu });
    const members = MEMBERS.map((member) => ({ seat: member.seat, is_cpu: member.is_cpu }));
    for (const [index, entry] of REPRO.commands.entries()) {
      expect(authority.validateAndApply(entry.actorSeat, { ...entry.action }, members), `replay command #${index + 1}`).toBeNull();
    }
    const game: any = authority.game;
    expect(authority.currentPlayer()).toBe(2);
    expect([...game.openLizhi]).toEqual([1]);
    expect(game.getTingpaiList(1)).toContain('m9');
    const driver = turnTimeoutAction(authority, true);
    const reason = authority.validateAndApply(2, driver ?? { type: 'noop' }, members);
    probeLog('authority', {
      driver, reason,
      hands: [0, 1, 2].map((seat) => ({ seat, text: game.shoupai.get(seat)?.toString(), zimo: game.shoupai.get(seat)?._zimo })),
      openRiichiWaits: game.getTingpaiList(1),
    });
    // 期待 [復旧]: driver が合法手 [待ち牌以外] を選び accept される。現状: 「オープン立直の待ち牌は…打牌不可」で reject
    expect(reason, `driver=${JSON.stringify(driver)}`).toBeNull();
  });

  it('ws: restored room with a CPU on turn re-arms the 750ms deadline forever and nobody can act', async () => {
    const api = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ members: MEMBERS.map(({ seat, user_id, username }) => ({ seat, user_id, username })), match_mode: 'tonpu' }));
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === 'string') throw new Error('stub member API did not bind');

    const persistence = seedPersistence();
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
      log: false,
    });
    cleanups.push(async () => runtime.close());
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
    const now = Math.floor(Date.now() / 1000);
    const url = (uid: string, seat: number, isHost: boolean) => {
      const token = jwt.sign({
        uid, username: uid, seat, room_id: ROOM_ID, room_instance_id: INSTANCE_ID, is_host: isHost,
        iat: now, exp: now + 120,
      }, SECRET, { algorithm: 'HS256' });
      return `ws://127.0.0.1:${address.port}/ws/room/${ROOM_ID}?token=${encodeURIComponent(token)}`;
    };
    // 本番の Node 再起動後と同じ「persistence からの復元」経路で部屋を立ち上げる
    const host = await connect(url('p0', 0, true));
    const sync = await waitUntil(() => host.messages.find((message) => message.type === 'sync'), 4000, 'restore sync');
    expect(sync.snapshot).toMatchObject({ revision: REPRO.commands.length, started: true });
    const room = runtime.rooms.get(ROOM_ID)!;
    const authorityAtStart = room.authority!;
    expect(authorityAtStart.currentPlayer()).toBe(2);
    expect([...room.members.values()].find((member) => member.seat === 2)?.is_cpu).toBe(true);
    const driver = turnTimeoutAction(authorityAtStart, true);

    const startedAt = Date.now();
    const timers = new Set<object>();
    const authorities = new Set<object>([authorityAtStart]);
    while (Date.now() - startedAt < OBSERVE_MS) {
      if (room.deadlineTimer) timers.add(room.deadlineTimer);
      if (room.authority) authorities.add(room.authority);
      await sleep(5);
    }
    const observed = {
      driver,
      revisionBefore: REPRO.commands.length,
      revisionAfter: room.snapshot.revision,
      rearms: timers.size,
      authorityRebuilds: authorities.size - 1,
      relayedActionTypes: host.messages.filter((message) => message.type === 'action').map((message) => message.action?.type),
      timerArmedAtEnd: room.deadlineTimer !== null,
      currentPlayerAtEnd: room.authority?.currentPlayer(),
    };
    probeLog('ws', observed);
    // 期待 [復旧]: 観測窓の間に CPU の打牌が accept されて revision が進む。
    // 現状: rearms ≈ OBSERVE_MS/750、authorityRebuilds も同数 [reject → restoreAuthority]、revision 不変
    expect(observed.revisionAfter, `re-armed ${observed.rearms} times / rebuilt authority ${observed.authorityRebuilds} times in ${OBSERVE_MS}ms without progress; driver=${JSON.stringify(driver)}`).toBeGreaterThan(observed.revisionBefore);
  });
});
