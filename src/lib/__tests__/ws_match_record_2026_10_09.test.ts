// [2026-10-09 遊真 A3 ws 側] host が落ちても次の試合へ進める / 終わった試合をサーバー自身が保存する。
//
// - nextMatch は CPU でない room member なら誰でも通す [観戦者は不可]
// - 試合が終わり切った [state.finished かつ post-win 解決済み] 時点で、サーバーが
//   POST {apiBase}/api/internal/matches/record を 1 試合 1 回だけ出す
//   [match_uuid = srv:<roomInstanceId>:<matchId>、5xx/ネットワーク失敗は再試行、4xx は打ち切り]
// - 終わった試合は nextMatch が新しい試合に置き換える前に捕まえる
// 終了状態は test 専用 seam [/internal/test/force-finish-match、testControlsEnabled] で作る。
import jwt from 'jsonwebtoken';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { buildMatchResult, createWsRuntime } from '../../../server/ws_server';
import { ANMIKA_RULE_VERSION } from '../ruleVersion';
import { ANMIKA_RULE_VERSION as RULE_VERSION_VIA_PREFS } from '../prefs';

const SECRET = 'ws-match-record-secret';

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

type Recorded = { headers: IncomingMessage['headers']; body: any };

/** member API + 保存 API を兼ねる stub。statuses は保存 POST への応答 status を順に返す [尽きたら 200] */
async function startFakeApi(statuses: number[] = []) {
  const posts: Recorded[] = [];
  const queue = [...statuses];
  const members = [
    { seat: 0, user_id: 'u0', username: 'u0' },
    { seat: 1, user_id: 'u1', username: 'u1' },
    { seat: 2, user_id: 'u2', username: 'u2' },
  ];
  const api: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/api/internal/matches/record') {
        let body: any = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* keep null */ }
        posts.push({ headers: request.headers, body });
        const status = queue.shift() ?? 200;
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: status < 400 }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ members, match_mode: 'tonpu', rotation_enabled: false }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('fake API did not bind');
  return { posts, apiBase: `http://127.0.0.1:${address.port}` };
}

async function bootRoom(roomId: string, apiBase: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  });
  cleanups.push(async () => runtime.close());
  const wsAddress = runtime.wss.address();
  if (!wsAddress || typeof wsAddress === 'string') throw new Error('test websocket did not bind');
  const now = Math.floor(Date.now() / 1000);
  const url = (uid: string, seat: number, isHost = false, spectator = false) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: roomId, room_instance_id: `${roomId}-instance`,
      is_host: isHost, ...(spectator ? { spectator: true } : {}), iat: now, exp: now + 300,
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
  const internalPort = await waitUntil(() => {
    const address = runtime.internalHttp.address();
    return address && typeof address === 'object' ? address.port : undefined;
  }, 4000, 'internal port');
  const internalPost = (path: string) => fetch(`http://127.0.0.1:${internalPort}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
    body: JSON.stringify({ room_id: roomId }),
  });
  const forceFinish = async () => {
    expect(await (await internalPost('/internal/test/force-finish-match')).json()).toEqual({ ok: true });
  };
  const nextMatch = (client: Client, commandId: string, expectedVersion = 0) => client.ws.send(JSON.stringify({
    type: 'action', commandId, expectedVersion, matchId: 1, roundId: 1, action: { type: 'nextMatch' },
  }));
  return { runtime, room, clients, url, internalPost, forceFinish, nextMatch };
}

describe('server-side match record [2026-10-09 A3]', () => {
  it('非 host の nextMatch が通り、終わった試合は新試合に替わる前に 1 回だけ保存 POST される', async () => {
    const { posts, apiBase } = await startFakeApi();
    const { runtime, room, clients, url, internalPost, forceFinish, nextMatch } = await bootRoom('MR0001', apiBase);
    await forceFinish();
    expect(posts).toHaveLength(0); // force-finish 自体は command を作らない = まだ保存しない

    // 観戦者は nextMatch を出せない
    const spectator = await connect(url('watcher', -1, false, true));
    await waitUntil(() => spectator.messages.find((m) => m.type === 'sync'), 3000, 'spectator sync');
    nextMatch(spectator, 'mr-spectator-next');
    await sleep(250);
    expect(room.snapshot.matchId).toBe(1);
    expect(room.snapshot.revision).toBe(0);

    // endpoint [/internal/match-result] の応答 = buildMatchResult の結果
    const viaEndpoint = await (await internalPost('/internal/match-result')).json();
    expect(viaEndpoint).toMatchObject({ ok: true, finished: true, matchId: 1, roomInstanceId: 'MR0001-instance' });
    const viaPure = buildMatchResult(room.snapshot, room.authority!, runtime.persistence.loadCommands('MR0001'));
    expect(JSON.parse(JSON.stringify(viaPure))).toEqual(viaEndpoint);

    // 非 host [u1] が次の試合へ
    nextMatch(clients[1], 'mr-next-by-u1');
    const relay = await waitUntil(
      () => clients[2].messages.find((m) => m.type === 'action' && m.commandId === 'mr-next-by-u1'),
      4000, 'nextMatch relay',
    );
    expect(relay).toMatchObject({ matchId: 2, roundId: 1, revision: 1, from_user_id: 'u1' });
    expect(room.snapshot.matchId).toBe(2);

    const post = await waitUntil(() => posts[0], 4000, 'record POST');
    expect(post.headers['x-anmika-internal-secret']).toBe(SECRET);
    expect(post.headers['content-type']).toContain('application/json');
    expect(post.body).toMatchObject({
      room_id: 'MR0001',
      match_uuid: 'srv:MR0001-instance:1',
      rule_version: ANMIKA_RULE_VERSION,
      finished: true,
      rotationEnabled: false,
    });
    expect(Object.keys(post.body.ledger).sort()).toEqual(['u0', 'u1', 'u2']);
    expect(Object.keys(post.body.roomLedgerDelta).sort()).toEqual(['u0', 'u1', 'u2']);
    expect(post.body.activeMembers).toEqual([
      { user_id: 'u0', seat: 0 }, { user_id: 'u1', seat: 1 }, { user_id: 'u2', seat: 2 },
    ]);
    expect(Array.isArray(post.body.events)).toBe(true);
    expect(post.body.events.length).toBeGreaterThan(0);
    // 保存した内容は「新試合に替わる前」の結果 [endpoint が nextMatch 前に返した物と同じ]
    expect(post.body.ledger).toEqual(viaEndpoint.ledger);
    expect(post.body.events).toEqual(viaEndpoint.events);

    // 以後の action でも二重に出ない
    await sleep(400);
    expect(posts).toHaveLength(1);
    expect(room.recordedMatchKeys.has('MR0001-instance:1')).toBe(true);
  });

  it('試合の最後の post-win 判断が解決した action の末尾で保存される [解決前は出さない]', async () => {
    const { posts, apiBase } = await startFakeApi();
    const { room, clients, forceFinish } = await bootRoom('MR0002', apiBase);
    await forceFinish();
    // 終了済みの試合に、サイコロの pending を直接立てる [ws_runtime.test の細工と同じ手口]
    const canonical = room.authority!.canonicalState();
    canonical.pendingSaiKoro = {
      winner: 0,
      // rollCount: 1 = 非ゾロ目 1 投で finalize [ゾロ目は回数外のやり直し]
      chances: [{ name: 'record-test', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+', winner: 0, rollCount: 1 }],
      currentIdx: 0,
      selectedCombo: null,
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    expect(room.authority!.isPostWinResolved()).toBe(false);
    let seq = 0;
    const send = async (label: string, action: Record<string, unknown>) => {
      const commandId = `mr-${label}-${seq += 1}-${Math.random().toString(36).slice(2, 8)}`;
      clients[0].ws.send(JSON.stringify({
        type: 'action', commandId, expectedVersion: room.snapshot.revision, matchId: 1, roundId: 1, action,
      }));
      await waitUntil(() => clients[0].messages.find((m) => m.type === 'action' && m.commandId === commandId), 3000, label);
    };
    await send('select', { type: 'selectSaiKoroCombo', small: 1, large: 6 });
    for (let guard = 0; guard < 12 && !room.authority!.canonicalState().pendingSaiKoro?.finalized; guard += 1) {
      await send('roll', { type: 'rollSaiKoroDice' });
    }
    expect(room.authority!.canonicalState().pendingSaiKoro?.finalized).toBe(true);
    await sleep(250);
    expect(posts).toHaveLength(0); // 「次へ」の判断がまだ残っている = 解決前は出さない
    await send('advance', { type: 'advanceSaiKoro' });
    const post = await waitUntil(() => posts[0], 4000, 'record POST after resolve');
    expect(post.body).toMatchObject({ room_id: 'MR0002', match_uuid: 'srv:MR0002-instance:1', finished: true });
    // nextMatch が続いても同じ試合は二重に保存されない
    const before = room.snapshot.revision;
    clients[1].ws.send(JSON.stringify({
      type: 'action', commandId: 'mr-next-match-2', expectedVersion: before, matchId: 1, roundId: 1, action: { type: 'nextMatch' },
    }));
    await waitUntil(() => clients[0].messages.find((m) => m.type === 'action' && m.commandId === 'mr-next-match-2'), 3000, 'nextMatch');
    await sleep(400);
    expect(posts).toHaveLength(1);
  });

  it('5xx は再試行し、成功したら止まる [同じ payload を送り直す]', async () => {
    const { posts, apiBase } = await startFakeApi([500, 503, 200]);
    const { clients, forceFinish, nextMatch } = await bootRoom('MR0003', apiBase, { matchRecordRetryDelaysMs: [0, 40, 80] });
    await forceFinish();
    nextMatch(clients[0], 'mr-retry-next');
    await waitUntil(() => posts.length >= 3 ? true : undefined, 4000, 'three attempts');
    await sleep(400);
    expect(posts).toHaveLength(3);
    expect(posts[1].body).toEqual(posts[0].body);
    expect(posts[2].body).toEqual(posts[0].body);
  });

  it('4xx は記録して打ち切る [再試行しない]', async () => {
    const { posts, apiBase } = await startFakeApi([409]);
    const { clients, forceFinish, nextMatch } = await bootRoom('MR0004', apiBase, { matchRecordRetryDelaysMs: [0, 40, 80] });
    await forceFinish();
    nextMatch(clients[0], 'mr-4xx-next');
    await waitUntil(() => posts[0], 4000, 'first attempt');
    await sleep(500);
    expect(posts).toHaveLength(1);
  });

  it('internal secret が空なら保存 POST は一切出さない', async () => {
    const { posts, apiBase } = await startFakeApi();
    // secret 空では member API も引かない = 3 人は接続順に member になる
    const runtime = createWsRuntime({
      port: 0, internalPort: 0, apiBase, wsSecret: SECRET, internalApiSecret: '',
      persistence: new RoomPersistence(':memory:'),
      reactionTimeoutMs: 60_000, turnTimeoutMs: 60_000, disconnectGraceMs: 60_000, cpuProxyGraceMs: 60_000,
      testControlsEnabled: true, log: false,
    });
    cleanups.push(async () => runtime.close());
    const wsAddress = runtime.wss.address();
    if (!wsAddress || typeof wsAddress === 'string') throw new Error('test websocket did not bind');
    const now = Math.floor(Date.now() / 1000);
    const url = (uid: string, seat: number) => `ws://127.0.0.1:${wsAddress.port}/ws/room/MR0005?token=${encodeURIComponent(jwt.sign({
      uid, username: uid, seat, room_id: 'MR0005', room_instance_id: 'mr5', is_host: seat === 0,
      iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' }))}`;
    const clients = await Promise.all([0, 1, 2].map((seat) => connect(url(`u${seat}`, seat))));
    clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    await waitUntil(() => clients[0].messages.find((m) => m.type === 'start'), 4000, 'start');
    const room = runtime.rooms.get('MR0005')!;
    room.authority!.forceFinishMatchForTest();
    clients[1].ws.send(JSON.stringify({
      type: 'action', commandId: 'mr-nosecret-next', expectedVersion: 0, matchId: 1, roundId: 1, action: { type: 'nextMatch' },
    }));
    await waitUntil(() => clients[0].messages.find((m) => m.type === 'action' && m.commandId === 'mr-nosecret-next'), 4000, 'nextMatch');
    await sleep(400);
    expect(posts).toHaveLength(0);
    expect(room.recordedMatchKeys.size).toBe(0);
  });

  it('ANMIKA_RULE_VERSION は ruleVersion.ts が唯一の定義で、prefs.ts は再 export する', () => {
    expect(ANMIKA_RULE_VERSION).toBe('anmika-1.0.0');
    expect(RULE_VERSION_VIA_PREFS).toBe(ANMIKA_RULE_VERSION);
  });
});
