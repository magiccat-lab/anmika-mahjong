// [2026-10-16 先輩「偽ラグ」a: 3 回に 1 回、0.5〜1.5 秒止める]
// 誰かが鳴ける時だけ次のツモが止まると、止まった事で鳴ける人が居ると分かる。
// 誰も鳴けない打牌でも、サーバーが印を付けた打牌は次のツモを止め、本物の鳴き待ちと同じ見え方で配る:
// 打牌の投影は awaitingFulou、期限は kind:none、止めを解くのは全員に中立の progress。
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';
import { createRoomAuthority } from '../../../server/authority';
import { toCorePai } from '../helpers';
import { defaultSanmaRule, generateTilePool } from '../shan3';

const SECRET = 'ws-fake-lag-secret';

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

async function bootRoom(roomId: string, fakeLagRate: number) {
  const persistence = new RoomPersistence(':memory:');
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    wsSecret: SECRET,
    internalApiSecret: '',
    persistence,
    reactionTimeoutMs: 60_000,
    fakeLagRate,
    turnTimeoutMs: 60_000,
    disconnectGraceMs: 60_000,
    cpuProxyGraceMs: 60_000,
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
      iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
  };
  const clients = await Promise.all([0, 1, 2].map((seat) => connect(url(`u${seat}`, seat, seat === 0))));
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'start'), 4000, 'start')));
  const room = runtime.rooms.get(roomId)!;
  return { room, clients };
}

const command = (room: any, action: Record<string, unknown>, tag: string) => JSON.stringify({
  type: 'action',
  commandId: `${tag}-${room.snapshot.revision}-${Math.random().toString(36).slice(2, 8)}`,
  expectedVersion: room.snapshot.revision,
  matchId: room.snapshot.matchId,
  roundId: room.snapshot.roundId,
  action,
});

const actionsAt = (client: Client, revision: number) => client.messages.filter(
  (m) => m.type === 'action' && m.revision === revision,
);

function pickDiscard(room: any): { seat: number; pai: string } | null {
  const a = room.authority;
  const seat = a.currentPlayer();
  const hand = a.game.shoupai.get(seat);
  const pai = ((hand?.get_dapai(false) ?? []) as string[])
    .map((candidate) => candidate.replace(/_$/, ''))
    .find((candidate) => toCorePai(candidate) !== 'z4');
  return pai ? { seat, pai } : null;
}

describe('偽ラグ [2026-10-16 先輩 a]', () => {
  it('誰も鳴けない打牌で次のツモを 0.5〜1.5 秒止め、本物の鳴き待ちと同じ形で配って、中立の progress で解く', async () => {
    let checked = false;
    for (let attempt = 0; attempt < 6 && !checked; attempt += 1) {
      const { room, clients } = await bootRoom(`FL${String(attempt).padStart(4, '0')}`, 1);
      for (let turn = 0; turn < 12 && !checked; turn += 1) {
        const a = room.authority;
        if (a.roundEnded) break;
        const pick = pickDiscard(room);
        if (!pick) break;
        const before = room.snapshot.revision;
        const sentAt = Date.now();
        clients[pick.seat].ws.send(command(room, { type: 'discard', pai: pick.pai, _hold: false }, 'drive'));
        await waitUntil(() => room.snapshot.revision > before ? true : undefined, 3000, 'discard accepted');
        if (!a.isHoldPending()) {
          // 本物の鳴き待ち [候補あり] や局の終わりに当たった時は、この部屋はここまで
          break;
        }
        const discardRev = before + 1;
        const next = a.currentPlayer();
        // 打牌の relay: 印は誰にも渡らず、投影は鳴き待ちと同じ awaitingFulou、次の人のツモはまだ無い
        for (const client of clients) {
          const relay = await waitUntil(() => actionsAt(client, discardRev)[0], 3000, 'discard relay');
          expect(relay.action.type).toBe('discard');
          expect('_hold' in relay.action).toBe(false);
          expect(relay.action._state.store.awaitingFulou).toBe(true);
          expect(relay.action._state.store.pendingHold).toBeUndefined();
          expect(relay.action._state.store.ponCandidates).toEqual([]);
          expect(relay.action._state.store.kanCandidates).toEqual([]);
        }
        const nextRelay = actionsAt(clients[next], discardRev)[0];
        expect(nextRelay.action._state.store.lastZimo ?? null).toBeNull();
        // 止めている間: client の releaseHold と次の人の drawNext は通らない
        clients[next].ws.send(command(room, { type: 'releaseHold' }, 'cheat'));
        clients[next].ws.send(command(room, { type: 'drawNext' }, 'early'));
        await sleep(150);
        expect(room.snapshot.revision).toBe(discardRev);
        expect(a.isHoldPending()).toBe(true);
        // 0.5〜1.5 秒でサーバーが解く。全員が受けるのは player の無い progress
        const releaseRev = discardRev + 1;
        await waitUntil(() => room.snapshot.revision >= releaseRev ? true : undefined, 3000, 'release');
        const elapsed = Date.now() - sentAt;
        expect(elapsed).toBeGreaterThanOrEqual(450);
        expect(elapsed).toBeLessThan(2200);
        for (const client of clients) {
          const relay = await waitUntil(() => actionsAt(client, releaseRev)[0], 3000, 'release relay');
          expect(relay.action.type).toBe('progress');
          expect(relay.action.player).toBeUndefined();
          expect(relay.from_user_id).toBe('');
          expect(relay.action._state.store.awaitingFulou).toBe(false);
        }
        const drawn = actionsAt(clients[next], releaseRev)[0];
        expect(drawn.action._state.store.lastZimo).toBeTruthy();
        expect(a.isHoldPending()).toBe(false);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  }, 60_000);

  it('印の無い打牌は今まで通りすぐ次のツモ。印は client から付けられない', async () => {
    const { room, clients } = await bootRoom('FL0100', 0);
    let checked = false;
    for (let turn = 0; turn < 12 && !checked; turn += 1) {
      const a = room.authority;
      if (a.roundEnded) break;
      const pick = pickDiscard(room);
      if (!pick) break;
      const before = room.snapshot.revision;
      // client が _hold を付けても、サーバーが落とす
      clients[pick.seat].ws.send(command(room, { type: 'discard', pai: pick.pai, _hold: true }, 'drive'));
      await waitUntil(() => room.snapshot.revision > before ? true : undefined, 3000, 'discard accepted');
      expect(a.isHoldPending()).toBe(false);
      if (a.awaitingFulou || a.awaitingRonDecision) break;
      checked = true;
    }
    expect(checked).toBe(true);
  }, 30_000);

  it('権威: 印付きの打牌で止まり、止めている間は他の手が通らず、releaseHold で次の人がツモる', () => {
    const members = [0, 1, 2].map((seat) => ({ seat, is_cpu: false }));
    for (let seed = 0; seed < 20; seed += 1) {
      const auth = createRoomAuthority({ preShuffledPool: generateTilePool(defaultSanmaRule()).map(String), qijia: 0 });
      const seat = auth.currentPlayer();
      const pai = ((auth.game.shoupai.get(seat)?.get_dapai(false) ?? []) as string[])
        .map((candidate) => candidate.replace(/_$/, ''))
        .find((candidate) => toCorePai(candidate) !== 'z4');
      if (!pai) continue;
      expect(auth.validateAndApply(seat, { type: 'discard', pai, _hold: true }, members)).toBeNull();
      const state = auth.canonicalState();
      if (state.awaitingFulou || state.awaitingRonDecision || state.roundEnded) continue;
      expect(auth.isHoldPending()).toBe(true);
      const next = auth.currentPlayer();
      expect(auth.game.shoupai.get(next)?._zimo ?? null).toBeNull();
      expect(auth.validateAndApply(next, { type: 'drawNext' }, members)).toMatch(/pending/);
      expect(auth.validateAndApply(next, { type: 'releaseHold' }, members)).toBeNull();
      expect(auth.isHoldPending()).toBe(false);
      expect(auth.canonicalState().game.shoupai.get(next)?._zimo).toBeTruthy();
      // 止めていない時の releaseHold は通らない
      expect(auth.validateAndApply(next, { type: 'releaseHold' }, members)).toMatch(/no hold/);
      return;
    }
    throw new Error('no hold case reached');
  });
});
