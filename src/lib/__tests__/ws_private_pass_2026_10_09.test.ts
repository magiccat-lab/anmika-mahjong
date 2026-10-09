// [2026-10-09 R1] 鳴き・ロンの見送りは、本人とサーバーの間だけで運ぶ。
// 他の席・観戦者が受け取るのは seat も「見送りがあった」事実も載らない中立の progress。
// 反応窓の待ち時間通知 [deadline kind:reaction] も、待たれている席は本人にしか渡さない。
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection, reactionCandidateMessage } from '../../../server/ws_server';
import { buildShoupai } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { toCorePai } from '../helpers';

const SECRET = 'ws-private-pass-secret';

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

async function bootRoom(roomId: string) {
  const persistence = new RoomPersistence(':memory:');
  const runtime = createWsRuntime({
    port: 0,
    internalPort: 0,
    wsSecret: SECRET,
    internalApiSecret: '',
    persistence,
    reactionTimeoutMs: 60_000,
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
  const url = (uid: string, seat: number, isHost = false, spectator = false) => {
    const token = jwt.sign({
      uid, username: uid, seat, room_id: roomId,
      room_instance_id: `${roomId}-instance`, is_host: isHost, ...(spectator ? { spectator: true } : {}),
      iat: now, exp: now + 300,
    }, SECRET, { algorithm: 'HS256' });
    return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
  };
  const clients = await Promise.all([0, 1, 2].map((seat) => connect(url(`u${seat}`, seat, seat === 0))));
  const spectator = await connect(url('watcher', -1, false, true));
  clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
  await Promise.all(clients.map((client) => waitUntil(() => client.messages.find((m) => m.type === 'start'), 4000, 'start')));
  await waitUntil(() => spectator.messages.find((m) => m.type === 'sync' || m.type === 'start'), 4000, 'spectator view');
  const room = runtime.rooms.get(roomId)!;
  return { runtime, persistence, room, clients, spectator };
}

const command = (room: any, action: Record<string, unknown>, tag: string) => JSON.stringify({
  type: 'action',
  commandId: `${tag}-${room.snapshot.revision}-${Math.random().toString(36).slice(2, 8)}`,
  expectedVersion: room.snapshot.revision,
  matchId: room.snapshot.matchId,
  roundId: room.snapshot.roundId,
  action,
});

const reactors = (room: any): number[] => {
  const a = room.authority;
  return [...new Set<number>([
    ...a.ronCandidates,
    ...a.ponCandidates.map((c: any) => c.player),
    ...a.kanCandidates.map((c: any) => c.player),
  ])];
};

/** 反応窓 [鳴き/ロンの候補が出る所] まで、現手番が打牌を重ねて進める。窓が開いたら候補席を返す */
async function playUntilReactionWindow(room: any, clients: Client[], timeoutMs = 20_000): Promise<number[] | null> {
  const end = Date.now() + timeoutMs;
  let lastSent = -1;
  while (Date.now() < end) {
    const a = room.authority;
    if (a.roundEnded) return null;
    const seats = reactors(room);
    if (seats.length > 0 && (a.awaitingFulou || a.awaitingRonDecision)) return seats;
    if (lastSent !== room.snapshot.revision) {
      const seat = a.currentPlayer();
      const hand = a.game.shoupai.get(seat);
      const pai = ((hand?.get_dapai(false) ?? []) as string[])
        .map((candidate) => candidate.replace(/_$/, ''))
        .find((candidate) => toCorePai(candidate) !== 'z4');
      if (pai) {
        clients[seat].ws.send(command(room, { type: 'discard', pai }, 'drive'));
        lastSent = room.snapshot.revision;
      }
    }
    await sleep(15);
  }
  return null;
}

const actionsAt = (client: Client, revision: number) => client.messages.filter(
  (m) => m.type === 'action' && m.revision === revision,
);

describe('見送りの秘匿 [2026-10-09 R1]', () => {
  it('見送った本人だけが seat 付きの pass を受け、他の席と観戦者は seat 無しの progress を受ける', async () => {
    let checked = false;
    for (let attempt = 0; attempt < 8 && !checked; attempt += 1) {
      const { persistence, room, clients, spectator } = await bootRoom(`PP${String(attempt).padStart(4, '0')}`);
      const seats = await playUntilReactionWindow(room, clients);
      if (!seats) continue;
      const passer = seats[0];
      const others = [0, 1, 2].filter((seat) => seat !== passer);
      const before = room.snapshot.revision;
      clients[passer].ws.send(command(room, { type: 'pass', player: passer }, 'pass'));
      await waitUntil(() => room.snapshot.revision > before ? true : undefined, 3000, 'pass accepted');
      const revision = before + 1;

      const own = await waitUntil(() => actionsAt(clients[passer], revision)[0], 3000, 'passer relay');
      expect(own.action.type).toBe('pass');
      expect(own.from_seat).toBe(passer);
      expect(own.from_user_id).toBe(`u${passer}`);

      for (const seat of others) {
        const msg = await waitUntil(() => actionsAt(clients[seat], revision)[0], 3000, `neutral relay seat ${seat}`);
        expect(msg.action.type).toBe('progress');
        expect(msg.action.player).toBeUndefined();
        expect(msg.from_user_id).toBe('');
        expect(msg.from_seat).toBe(seat); // 受信者自身の席 [= 見送った席ではない]
        expect(msg.from_seat).not.toBe(passer);
        expect(msg.commandId).toBe(`progress:${revision}`);
        expect(msg.action._state).toBeTruthy(); // client は _state の hydrate だけで進む
        expect(JSON.stringify(msg)).not.toContain(`u${passer}`);
      }
      // 反応窓の待ち時間通知は、待たれている本人にしか席を載せない
      const reactionDeadlines = (client: Client) => client.messages.filter((m) => m.type === 'deadline' && m.kind === 'reaction');
      for (const seat of seats) {
        expect(reactionDeadlines(clients[seat]).some((m) => m.seats.length === 1 && m.seats[0] === seat)).toBe(true);
      }
      for (const seat of others.filter((o) => !seats.includes(o))) {
        expect(reactionDeadlines(clients[seat])).toEqual([]);
      }
      expect(reactionDeadlines(spectator)).toEqual([]);
      const watched = await waitUntil(() => actionsAt(spectator, revision)[0], 3000, 'spectator relay');
      expect(watched.action.type).toBe('progress');
      expect(watched.action.player).toBeUndefined();
      expect(watched.from_user_id).toBe('');
      expect(watched.from_seat).toBe(0);

      // サーバー内の記録は pass のまま [replay / restore はこれで復元する]
      const logged = persistence.loadCommands(room.roomId).find((c) => c.revision === revision);
      expect(logged?.action).toMatchObject({ type: 'pass', player: passer });
      expect(logged?.actorSeat).toBe(passer);
      checked = true;
    }
    expect(checked).toBe(true);
  }, 60_000);
});

describe('反応窓の文言の秘匿 [2026-10-09 R1]', () => {
  it('ロン可能の文言は本人にだけ本人の席で届く [他席には出ない]', () => {
    const a: any = createRoomAuthority({ preShuffledPool: generateTilePool(defaultSanmaRule()).map(String), qijia: 0 });
    const discarder = a.currentPlayer();
    const winner = (discarder + 1) % 3;
    const bystander = (discarder + 2) % 3;
    for (const g of [a.game, a.canonicalState().game]) {
      const tenpai = buildShoupai(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's4', 's5', 's6', 'm4', 'm5', 'm6', 'z6']);
      g.shoupai.set(winner, tenpai);
      g.lizhi.add(winner);
      const hand = buildShoupai(['m1', 'm1', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm9', 'm9', 'p9', 'p9', 'z1']);
      hand.zimo('z6');
      g.shoupai.set(discarder, hand);
    }
    const members = [0, 1, 2].map((seat) => ({ seat, user_id: `u${seat}`, username: `u${seat}`, is_cpu: false }));
    expect(a.validateAndApply(discarder, { type: 'discard', pai: 'z6' }, members)).toBeNull();
    expect(a.ronCandidates).toEqual([winner]);
    const message = (seat: number) => (captureSeatProjection(a, seat) as any).store.message;
    expect(message(winner)).toBe(`ロン可能: player ${winner}`);
    expect(message(discarder)).toBeNull();
    expect(message(bystander)).toBeNull();
    expect(message(-1)).toBeNull(); // 観戦
  });

  it('文言の書き換えはロン候補の一覧だけ。それ以外の文言は触らない', () => {
    expect(reactionCandidateMessage('ロン可能: player 1,2', 2, true)).toBe('ロン可能: player 2');
    expect(reactionCandidateMessage('ロン可能: player 1,2', 0, false)).toBeNull();
    expect(reactionCandidateMessage('北抜きロン可能: player 1', 1, true)).toBe('北抜きロン可能: player 1');
    expect(reactionCandidateMessage('🎯 加槓 [z666=] → 槍槓 ron 候補 p1/2 の判断待ち', 1, true)).toBe('ロン可能: player 1');
    expect(reactionCandidateMessage('🎯 加槓 [z666=] → 槍槓 ron 候補 p1/2 の判断待ち', 0, false)).toBeNull();
    expect(reactionCandidateMessage('🌀 流局', 0, false)).toBe('🌀 流局');
    expect(reactionCandidateMessage(null, 0, false)).toBeNull();
  });
});
