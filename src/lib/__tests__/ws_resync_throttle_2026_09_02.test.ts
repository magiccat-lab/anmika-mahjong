import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';

// [2026-09-02 yuma] server/ws_server.ts の member resync 間引き [RESYNC_MIN_INTERVAL_MS = 300] の回帰テスト。
// client の hydrate 失敗 → resync → sync → 失敗 … が無間隔で往復して server が焼けた件 [8/9 6U1V] の再発防止。
// 期待挙動:
//   - 同一接続の resync 連打は「即時 1 回 + 窓の末尾で trailing 1 回」の最大 2 sync に潰れる [N 回にはならない]
//   - 窓 [300ms] が明けた後の resync は即応答に戻り、trailing は積まれない
//   - sync は要求した接続だけに返る [他席には波及しない]
// persistence は必ず ':memory:' [default path は本番 DB]。timer は実時間で待つ [fake timer は server 側の timer と干渉する]。
// test 側の計時は performance.now() [単調時計]。server 側は Date.now() なので、壁時計が後ろに飛ぶと
// sinceLast が負になり trailing が「300ms + 飛んだ分」遅れる [WSL2 の時刻補正で 1 回観測]。その場合だけ 3) が落ちる

type Received = { at: number; message: any };
type Client = { ws: WebSocket; received: Received[] };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const RESYNC_MIN_INTERVAL_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sleepUntil = async (monotonicMs: number) => {
  const remaining = monotonicMs - performance.now();
  if (remaining > 0) await sleep(remaining);
};

async function waitUntil<T>(read: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await sleep(10);
  }
  throw new Error('timed out waiting for websocket message');
}

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const received: Received[] = [];
  ws.on('message', (data) => received.push({ at: performance.now(), message: JSON.parse(data.toString()) }));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, received };
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) resolve();
    else ws.once('close', () => resolve());
  });
}

describe('member resync throttle', () => {
  it('collapses a resync burst into one immediate sync plus one trailing sync, then answers again once the window expires', async () => {
    const secret = 'ws-resync-throttle-secret';
    const runtime = createWsRuntime({
      port: 0,
      wsSecret: secret,
      internalApiSecret: '',
      persistence: new RoomPersistence(':memory:'),
      reactionTimeoutMs: 60_000,
      turnTimeoutMs: 60_000,
      disconnectGraceMs: 60_000,
      log: false,
    });
    let runtimeClosed = false;
    const closeRuntime = async () => {
      if (runtimeClosed) return;
      runtimeClosed = true;
      await runtime.close();
    };
    cleanups.push(closeRuntime);
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
    const roomId = 'R123';
    const now = Math.floor(Date.now() / 1000);
    const url = (uid: string, seat: number, isHost = false) => {
      const token = jwt.sign({
        uid, username: uid, seat, room_id: roomId,
        room_instance_id: 'resync-throttle-instance', is_host: isHost,
        iat: now, exp: now + 60,
      }, secret, { algorithm: 'HS256' });
      return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
    };

    // startRoom は 3 席揃うまで pendingStart で止まるので host + 2 席を繋いでから start する
    const clients = await Promise.all([
      connect(url('r0', 0, true)), connect(url('r1', 1)), connect(url('r2', 2)),
    ]);
    cleanups.push(async () => { for (const client of clients) client.ws.close(); });
    const host = clients[0];
    host.ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    const start = await waitUntil(() => host.received.find(({ message }) => message.type === 'start')?.message);
    expect(start).toMatchObject({ revision: 0, matchId: 1, roundId: 1 });
    expect(runtime.rooms.get(roomId)?.snapshot.started).toBe(true);

    // burst 開始以降に届いた sync だけ数える [接続時 / start 時の frame と混ぜない]
    const burstIndex = host.received.length;
    const syncsSinceBurst = () => host.received
      .slice(burstIndex)
      .filter(({ message }) => message.type === 'sync');
    const describeTimeline = () => JSON.stringify(
      host.received.slice(burstIndex).map(({ at, message }) => ({ type: message.type, atMs: Math.round(at - burstAt) })),
    );

    const burstAt = performance.now();
    for (let i = 0; i < 6; i += 1) {
      host.ws.send(JSON.stringify({ type: 'resync', expectedVersion: 0 }));
    }
    expect(performance.now() - burstAt).toBeLessThan(20);

    // 1) 窓の前半 [150ms]: 即時 sync が 1 回だけ。2 発目以降は間引かれて trailing 待ち
    await sleepUntil(burstAt + 150);
    const early = syncsSinceBurst();
    expect(early, describeTimeline()).toHaveLength(1);
    expect(early[0].message).toMatchObject({ recipientRoomSeat: 0, recipientGameSeat: 0 });
    expect(early[0].message.snapshot).toMatchObject({ revision: 0, started: true });
    expect(early[0].message.snapshot.start.blindStart).toBe(true);
    expect(early[0].message.snapshot.start.preShuffledPool).toEqual([]);
    expect(early[0].message.snapshot.start.hands[0]).toHaveLength(13);
    expect(early[0].message.snapshot.start.hands[1]).toEqual([]);
    expect(early[0].message.snapshot.start.hands[2]).toEqual([]);

    // 2) 窓の末尾 [~300ms] で trailing sync が 1 回。600ms 経っても合計 2 回 [6 回にはならない]
    await sleepUntil(burstAt + 600);
    const settled = syncsSinceBurst();
    expect(settled, describeTimeline()).toHaveLength(2);
    expect(settled[1].at - burstAt).toBeGreaterThanOrEqual(150);
    // blindStartFor の cache 経由でも席マスクと配牌は即時 sync と同一
    expect(settled[1].message.snapshot.start.hands).toEqual(settled[0].message.snapshot.start.hands);
    expect(settled[1].message.snapshot.start.preShuffledPool).toEqual([]);

    // 3) 窓が明けた後 [>300ms] の単発 resync は即応答。trailing は積まれない
    await sleep(RESYNC_MIN_INTERVAL_MS + 50);
    const lateAt = performance.now();
    host.ws.send(JSON.stringify({ type: 'resync', expectedVersion: 0 }));
    const late = await waitUntil(() => syncsSinceBurst()[2], 1000);
    expect(late.at - lateAt, describeTimeline()).toBeLessThan(150);
    await sleepUntil(lateAt + RESYNC_MIN_INTERVAL_MS + 100);
    expect(syncsSinceBurst(), describeTimeline()).toHaveLength(3);

    // 4) sync は要求した接続にだけ返る [他席は resync を送っていないので 0 回]
    for (const other of clients.slice(1)) {
      expect(other.received.filter(({ message }) => message.type === 'sync')).toHaveLength(0);
    }

    // 5) 接続を閉じて runtime を止める [pending timer 無し、ハンドルを残さない]
    for (const client of clients) client.ws.close();
    await Promise.all(clients.map((client) => closed(client.ws)));
    await waitUntil(() => runtime.rooms.get(roomId)?.members.get('r0')?.connected === false ? true : undefined);
    await closeRuntime();
    expect(runtimeClosed).toBe(true);
  });
});
