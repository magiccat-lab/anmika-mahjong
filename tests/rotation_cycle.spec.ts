// [2026-07-24 4人回し, Sol最終レビュー指定] 2試合サイクルの protocol 統合テスト。
// create→4席→start→初期抜け番[CPU3]→force finish→試合1POST→nextMatch→mapping交換
// [host が抜け番へ]→force finish→試合2POST→DB検証→両者 reload sync、を browser 無しの
// 生 ws envelope で回す。
//
// 試合の終了は正規進行でなく test-only control seam [/internal/test/force-finish-match、
// testControlsEnabled 起動限定] で terminal 化する [Sol設計: 正規 tsumokiri で東風1試合を
// 終えると seed/返り東依存で rotation 回帰の信号が埋もれる。ゲームロジック検証ではなく
// 「終了済み authority fixture」を作る道具]。force 状態は command log に残らないため、
// server restart/restore を跨ぐ検証はここではしない [正規 replay は vitest 側で担保]。
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';

const ROOT = process.cwd(); // playwright は repo root から起動される
const API_PORT = 18890;
const WS_PORT = 18892;
const WS_INTERNAL_PORT = WS_PORT + 1;
const BASE = `http://127.0.0.1:${API_PORT}`;
const SECRET = 'anmika-rotation-cycle-secret';
const DB_PATH = path.join(ROOT, '.tmp', 'rotation-cycle.sqlite3');

const STACK_ENV = {
  ...process.env,
  ANMIKA_TEST_AUTH: '1',
  ANMIKA_REQUIRE_SECRET: '0',
  ANMIKA_SESSION_SECRET: SECRET,
  ANMIKA_WS_SECRET: SECRET,
  ANMIKA_INTERNAL_SECRET: SECRET,
  ANMIKA_DB_PATH: DB_PATH,
  ANMIKA_PUBLIC_BASE_URL: BASE,
  ANMIKA_WS_PUBLIC_URL: `ws://127.0.0.1:${WS_PORT}`,
  ANMIKA_API_BASE: BASE,
  ANMIKA_WS_PORT: String(WS_PORT),
  ANMIKA_WS_INTERNAL_BASE: `http://127.0.0.1:${WS_INTERNAL_PORT}`,
  ANMIKA_WS_LOG: '0',
};

async function waitHttp(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* boot 中 */ }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

type BotState = {
  ws: WebSocket;
  uid: string;
  cookie: string;
  revision: number;
  matchId: number;
  roundId: number;
  lastRecipientGameSeat: number | null | undefined;
  lastActiveMapping: { gameToRoom: number[]; inactiveRoomSeat: number } | null;
  lastRoomChipLedger: Record<string, number> | null;
};

async function login(uid: string, name: string): Promise<string> {
  const r = await fetch(`${BASE}/auth/test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: uid, username: name }),
  });
  if (!r.ok) throw new Error(`login ${uid}: ${r.status}`);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const pair = setCookie.split(';')[0]?.trim(); // starlette SessionMiddleware [既定 name=session]
  if (!pair || !pair.includes('=')) throw new Error(`no session cookie for ${uid}: ${setCookie.slice(0, 80)}`);
  return pair;
}

async function api(cookie: string, method: string, pathName: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${pathName}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function absorb(bot: BotState, source: any, topLevel: any): void {
  if (typeof source.revision === 'number' && source.revision > bot.revision) bot.revision = source.revision;
  if (typeof source.matchId === 'number') bot.matchId = source.matchId;
  if (typeof source.roundId === 'number') bot.roundId = source.roundId;
  if ('recipientGameSeat' in topLevel) bot.lastRecipientGameSeat = topLevel.recipientGameSeat;
  const mapping = topLevel.activeMapping ?? source.activeMapping;
  if (mapping !== undefined) bot.lastActiveMapping = mapping;
  const ledger = topLevel.roomChipLedger ?? source.roomChipLedger;
  if (ledger) bot.lastRoomChipLedger = ledger;
}

async function connectBot(uid: string, cookie: string, roomId: string): Promise<BotState> {
  const tokenResp = await api(cookie, 'POST', '/api/ws-token', { room_id: roomId });
  if (!tokenResp.ok) throw new Error(`ws-token ${uid}: ${tokenResp.status}`);
  const { token } = await tokenResp.json() as { token: string };
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/ws/room/${roomId}?token=${encodeURIComponent(token)}`);
  const bot: BotState = {
    ws, uid, cookie, revision: 0, matchId: 1, roundId: 1,
    lastRecipientGameSeat: undefined, lastActiveMapping: null, lastRoomChipLedger: null,
  };
  ws.on('message', (raw) => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'action') absorb(bot, msg, msg);
    else if (msg.type === 'sync') absorb(bot, msg.snapshot ?? {}, msg);
    else if (msg.type === 'start') absorb(bot, msg, msg);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e));
  });
  return bot;
}

async function forceFinish(roomId: string): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${WS_INTERNAL_PORT}/internal/test/force-finish-match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
    body: JSON.stringify({ room_id: roomId }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || (data as any)?.ok !== true) {
    throw new Error(`force-finish failed: ${r.status} ${JSON.stringify(data)}`);
  }
}

async function postFinish(bot: BotState, roomId: string, matchUuid: string): Promise<any> {
  const r = await api(bot.cookie, 'POST', '/api/matches', {
    room_id: roomId,
    paifu: [],
    chip_delta: {},
    duration_sec: 1,
    match_uuid: matchUuid,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`finish POST ${matchUuid}: ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function sendNextMatch(bot: BotState): void {
  bot.ws.send(JSON.stringify({
    type: 'action',
    commandId: `cyc:${bot.uid}:${bot.revision + 1}:${Math.random().toString(36).slice(2, 10)}`,
    expectedVersion: bot.revision,
    matchId: bot.matchId,
    roundId: bot.roundId,
    action: { type: 'nextMatch' },
  }));
}

test.describe('4人回し 2試合サイクル [protocol + test control seam]', () => {
  let apiProc: ChildProcess | null = null;
  let wsProc: ChildProcess | null = null;

  test.beforeAll(async () => {
    mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
    // test harness entry [testControlsEnabled 明示]。production entry では endpoint は生えない
    wsProc = spawn(process.execPath, ['--import', 'tsx', 'server/ws_server_test_harness.ts'], { cwd: ROOT, env: STACK_ENV, stdio: 'ignore' });
    apiProc = spawn(
      path.join(ROOT, '.venv', 'bin', 'python3'),
      ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', String(API_PORT)],
      { cwd: ROOT, env: STACK_ENV, stdio: 'ignore' },
    );
    await waitHttp(`${BASE}/api/rooms`);
  });

  test.afterAll(async () => {
    // [memory: infra-pkill-prod-collision] 停止は必ず自前 child の PID 限定
    for (const proc of [apiProc, wsProc]) {
      if (proc && !proc.killed) proc.kill('SIGTERM');
    }
  });

  test('試合1[CPU3抜け]→POST→nextMatch→試合2[host抜け]→POST→DB/reload検証', async () => {
    test.setTimeout(120_000);
    const hostCookie = await login('cyc-host', 'サイクルホスト');
    const friendCookie = await login('cyc-friend', 'サイクルフレンド');

    // 部屋作成 [rotation + CPU2 → CPU が room seat 3,2]、friend join [seat 1]
    const create = await api(hostCookie, 'POST', '/api/rooms', { cpu_count: 2, match_mode: 'tonpu', rotation: true });
    expect(create.ok).toBeTruthy();
    const { room_id: roomId } = await create.json();
    expect((await api(friendCookie, 'POST', `/api/rooms/${roomId}/join`, {})).ok).toBeTruthy();
    const startResp = await api(hostCookie, 'POST', `/api/rooms/${roomId}/start`, {});
    expect(startResp.ok, `start API: ${startResp.status}`).toBeTruthy();

    const host = await connectBot('cyc-host', hostCookie, roomId);
    const friend = await connectBot('cyc-friend', friendCookie, roomId);
    host.ws.send(JSON.stringify({ type: 'start', qijia: 0 }));

    // 試合1: 初期抜け番 = room seat 3 [CPU3]、human 両方 active [host=game0, friend=game1]
    await expect.poll(() => host.lastActiveMapping?.inactiveRoomSeat, { timeout: 30_000 }).toBe(3);
    expect(host.lastActiveMapping!.gameToRoom).toEqual([0, 1, 2]);
    expect(host.lastRecipientGameSeat).toBe(0);
    await expect.poll(() => friend.lastRecipientGameSeat, { timeout: 15_000 }).toBe(1);

    // 試合1を terminal 化して host が POST [server roomLedgerDelta が SSoT]
    await forceFinish(roomId);
    const finish1 = await postFinish(host, roomId, 'cycle-match-1');
    expect(finish1.ok).toBeTruthy();

    // nextMatch [mapping 交換の唯一の境界]。revision 追従で通るまで送る
    await expect.poll(async () => {
      sendNextMatch(host);
      await new Promise((resolve) => setTimeout(resolve, 700));
      return host.matchId;
    }, { timeout: 30_000 }).toBe(2);

    // 試合2: 抜け番 = room seat 0 [host]。gameToRoom は order 並びで [1,2,3]
    await expect.poll(() => host.lastActiveMapping?.inactiveRoomSeat, { timeout: 30_000 }).toBe(0);
    expect(host.lastActiveMapping!.gameToRoom).toEqual([1, 2, 3]);
    // host は観戦投影 [recipientGameSeat null]、friend は game seat 0 [room1 が先頭 active]
    await expect.poll(() => host.lastRecipientGameSeat, { timeout: 30_000 }).toBeNull();
    await expect.poll(() => friend.lastRecipientGameSeat, { timeout: 30_000 }).toBe(0);

    // 試合2も terminal 化 → 抜け番 host が POST [API は host gate のみ]
    await forceFinish(roomId);
    const finish2 = await postFinish(host, roomId, 'cycle-match-2');
    expect(finish2.ok).toBeTruthy();

    // reload 相当: 両者とも新規 ws の sync が rotation 契約を復元する
    host.ws.close();
    friend.ws.close();
    const hostReload = await connectBot('cyc-host', hostCookie, roomId);
    const friendReload = await connectBot('cyc-friend', friendCookie, roomId);
    for (const bot of [hostReload, friendReload]) {
      await expect.poll(() => bot.lastActiveMapping !== null, { timeout: 20_000 }).toBeTruthy();
      expect(bot.lastActiveMapping!.inactiveRoomSeat).toBe(0);
      expect(bot.matchId).toBe(2);
      expect(bot.lastRoomChipLedger).not.toBeNull();
      expect(Object.keys(bot.lastRoomChipLedger!).sort()).toEqual(['0', '1', '2', '3']);
    }
    await expect.poll(() => hostReload.lastRecipientGameSeat, { timeout: 15_000 }).toBeNull();
    await expect.poll(() => friendReload.lastRecipientGameSeat, { timeout: 15_000 }).toBe(0);
    hostReload.ws.close();
    friendReload.ws.close();

    // DB 検証: matches 2行 / members trio 交代 / chip 4-key zero-sum / stats は active のみ /
    // games_played は打った試合数だけ
    const db = new DatabaseSync(DB_PATH);
    try {
      const matches = db.prepare(
        'SELECT match_no, members_json, chip_delta_json FROM matches WHERE room_id=? ORDER BY match_no',
      ).all(roomId) as Array<{ match_no: number; members_json: string; chip_delta_json: string }>;
      expect(matches).toHaveLength(2);
      const members1 = JSON.parse(matches[0].members_json) as Array<{ user_id: string; seat: number }>;
      expect(members1.map((m) => m.user_id).sort()).toEqual([`CPU_${roomId}_2`, 'cyc-friend', 'cyc-host'].sort());
      const members2 = JSON.parse(matches[1].members_json) as Array<{ user_id: string; seat: number }>;
      expect(members2).toHaveLength(3);
      expect(members2.map((m) => m.user_id)).not.toContain('cyc-host');
      for (const m of members2) expect(m.seat).toBeLessThanOrEqual(2);
      for (const row of matches) {
        const delta = JSON.parse(row.chip_delta_json) as Record<string, number>;
        expect(Object.keys(delta).sort()).toEqual([`CPU_${roomId}_2`, `CPU_${roomId}_3`, 'cyc-friend', 'cyc-host'].sort());
        expect(Object.values(delta).reduce((a, b) => a + b, 0)).toBe(0);
      }
      const stats2 = db.prepare(
        `SELECT s.user_id FROM match_player_stats s
         JOIN matches m ON m.match_id = s.match_id
         WHERE m.room_id=? AND m.match_no=2`,
      ).all(roomId) as Array<{ user_id: string }>;
      expect(stats2).toHaveLength(3);
      expect(stats2.map((r) => r.user_id)).not.toContain('cyc-host');
      const played = db.prepare(
        'SELECT user_id, games_played FROM users WHERE user_id IN (?, ?)',
      ).all('cyc-host', 'cyc-friend') as Array<{ user_id: string; games_played: number }>;
      const playedBy = Object.fromEntries(played.map((r) => [r.user_id, r.games_played]));
      expect(playedBy['cyc-host']).toBe(1);   // 試合1だけ打った
      expect(playedBy['cyc-friend']).toBe(2); // 両方打った
    } finally {
      db.close();
    }
  });
});
