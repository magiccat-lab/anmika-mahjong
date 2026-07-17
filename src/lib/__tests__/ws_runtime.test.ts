import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { createWsRuntime } from '../../../server/ws_server';
import { toCorePai } from '../helpers';

type Client = { ws: WebSocket; messages: any[] };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function waitUntil<T>(read: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for websocket message');
}

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, messages };
}

describe('authoritative websocket runtime', () => {
  it('does not lose a start frame sent while the member lookup is still pending', async () => {
    const api = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          members: [
            { seat: 0, user_id: 'early-host', username: 'early-host' },
            { seat: 1, user_id: 'CPU_EARLY_1', username: 'CPU 1' },
            { seat: 2, user_id: 'CPU_EARLY_2', username: 'CPU 2' },
          ],
        }));
      }, 75);
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())));
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === 'string') throw new Error('test API did not bind');

    const secret = 'ws-early-frame-secret';
    const runtime = createWsRuntime({
      port: 0,
      apiBase: `http://127.0.0.1:${apiAddress.port}`,
      wsSecret: secret,
      internalApiSecret: secret,
      persistence: new RoomPersistence(':memory:'),
      reactionTimeoutMs: 60_000,
      turnTimeoutMs: 60_000,
      disconnectGraceMs: 60_000,
      log: false,
    });
    cleanups.push(async () => runtime.close());
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({
      uid: 'early-host', username: 'early-host', seat: 0, room_id: 'E123',
      room_instance_id: 'early-frame-instance', is_host: true,
      iat: now, exp: now + 60,
    }, secret, { algorithm: 'HS256' });
    const client = await connect(
      `ws://127.0.0.1:${address.port}/ws/room/E123?token=${encodeURIComponent(token)}`,
    );
    cleanups.push(async () => client.ws.close());

    // This is deliberately sent before the delayed HTTP member lookup returns.
    client.ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    const start = await waitUntil(() => client.messages.find((message) => message.type === 'start'));
    expect(start).toMatchObject({ revision: 0, matchId: 1, roundId: 1 });
    expect(runtime.rooms.get('E123')?.snapshot.started).toBe(true);
  });

  it('versions commands, deduplicates retries and reconnects from a persisted sync snapshot', async () => {
    const secret = 'ws-runtime-test-secret';
    const persistence = new RoomPersistence(':memory:');
    const runtime = createWsRuntime({
      port: 0,
      wsSecret: secret,
      internalApiSecret: '',
      persistence,
      reactionTimeoutMs: 60_000,
      turnTimeoutMs: 60_000,
      disconnectGraceMs: 60_000,
      log: false,
    });
    cleanups.push(async () => runtime.close());
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
    const roomId = 'T123';
    const now = Math.floor(Date.now() / 1000);
    const token = (uid: string, seat: number, isHost: boolean, instanceId = 'room-instance-test-1') => jwt.sign({
      uid,
      username: uid,
      seat,
      room_id: roomId,
      room_instance_id: instanceId,
      is_host: isHost,
      iat: now,
      exp: now + 60,
    }, secret, { algorithm: 'HS256' });
    const url = (uid: string, seat: number, host = false, instanceId?: string) =>
      `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token(uid, seat, host, instanceId))}`;

    const clients = await Promise.all([
      connect(url('u0', 0, true)),
      connect(url('u1', 1)),
      connect(url('u2', 2)),
    ]);
    cleanups.push(async () => { for (const client of clients) client.ws.close(); });
    clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    const start = await waitUntil(() => clients[0].messages.find((message) => message.type === 'start'));
    expect(start).toMatchObject({ revision: 0, matchId: 1, roundId: 1 });
    const starts = await Promise.all(clients.map((client) => waitUntil(
      () => client.messages.find((message) => message.type === 'start'),
    )));
    for (const [seat, privateStart] of starts.entries()) {
      expect(privateStart.privateSeat).toBe(seat);
      expect(privateStart.hands[seat]).toHaveLength(13);
      for (const other of [0, 1, 2].filter((value) => value !== seat)) {
        expect(privateStart.hands[other]).toEqual([]);
        expect(privateStart.goldHand[other]).toEqual({ p: 0, s: 0, z: 0 });
        expect(privateStart.pochiHand[other]).toEqual({ blue: 0, red: 0, green: 0, yellow: 0 });
      }
      expect(privateStart.fubaopai).toBeNull();
      expect(privateStart.state.recipientSeat).toBe(seat);
      expect(privateStart.state.privateHand).toBeTruthy();
      expect(privateStart.state.publicEvents.every((event: any) =>
        event.type !== 'qipai' || event.tiles === undefined)).toBe(true);
      expect(privateStart.state.publicEvents.every((event: any) =>
        event.type !== 'zimo' || event.player === seat || event.pai === null)).toBe(true);
      if (privateStart.firstZimoPlayer === seat) expect(privateStart.firstZimo).toBeTruthy();
      else expect(privateStart.firstZimo).toBeNull();
    }

    const room = runtime.rooms.get(roomId)!;
    const current = room.authority!.currentPlayer();
    const hand = room.authority!.game.shoupai.get(current);
    const discard = ((hand?.get_dapai(false) ?? []) as string[])
      .map((pai) => pai.replace(/_$/, ''))
      .find((pai) => toCorePai(pai) !== 'z4');
    expect(discard).toBeTruthy();
    const command = {
      type: 'action',
      commandId: 'client-command-0001',
      expectedVersion: 0,
      matchId: 1,
      roundId: 1,
      action: { type: 'discard', pai: discard },
    };
    clients[current].ws.send(JSON.stringify(command));
    const accepted = await waitUntil(() => clients[0].messages.find(
      (message) => message.type === 'action' && message.commandId === command.commandId,
    ));
    expect(accepted.revision).toBe(1);
    expect(persistence.loadSnapshot(roomId)?.revision).toBe(1);
    const acceptedAtEverySeat = await Promise.all(clients.map((client) => waitUntil(
      () => client.messages.find((message) => message.type === 'action' && message.commandId === command.commandId),
    )));
    for (const [seat, relayed] of acceptedAtEverySeat.entries()) {
      expect(relayed.action.preShuffledPool).toBeUndefined();
      expect(relayed.action._state.recipientSeat).toBe(seat);
      expect(relayed.action._state.privateHand).toBeTruthy();
      const draw = relayed.action._draw;
      if (draw?.player === seat) expect(draw.lastZimo).toBeTruthy();
      else if (draw) expect(draw.lastZimo).toBeNull();
    }

    clients[current].ws.send(JSON.stringify(command));
    const duplicate = await waitUntil(() => clients[current].messages.find(
      (message) => message.type === 'ack' && message.commandId === command.commandId,
    ));
    expect(duplicate).toMatchObject({ duplicate: true, revision: 1 });
    expect(runtime.rooms.get(roomId)?.snapshot.revision).toBe(1);

    clients[current].ws.send(JSON.stringify({
      ...command,
      commandId: 'client-command-stale',
    }));
    const rejected = await waitUntil(() => clients[current].messages.find(
      (message) => message.type === 'reject' && message.commandId === 'client-command-stale',
    ));
    expect(rejected).toMatchObject({ reason: 'version conflict', revision: 1 });

    const previousGeneration = runtime.rooms.get(roomId)?.members.get('u0')?.generation ?? 0;
    const replacement = await connect(url('u0', 0, true));
    cleanups.push(async () => replacement.ws.close());
    const sync = await waitUntil(() => replacement.messages.find((message) => message.type === 'sync'));
    expect(sync.snapshot).toMatchObject({ revision: 1, started: true });
    expect(sync.snapshot.commands).toHaveLength(1);
    expect(sync.snapshot.start.preShuffledPool).toEqual([]);
    expect(sync.snapshot.start.hands[0]).toHaveLength(13);
    expect(sync.snapshot.start.hands[1]).toEqual([]);
    expect(sync.snapshot.start.hands[2]).toEqual([]);
    expect(sync.snapshot.start.fubaopai).toBeNull();
    expect(sync.snapshot.state.recipientSeat).toBe(0);
    expect(sync.snapshot.state.privateHand).toBeTruthy();
    await waitUntil(() => runtime.rooms.get(roomId)?.members.get('u0')?.connected ? true : undefined);
    expect(runtime.rooms.get(roomId)?.members.get('u0')?.generation).toBeGreaterThan(previousGeneration);

    // Put the in-memory authority at a post-win dice decision. This isolates
    // transport behavior: the client-provided roll is replaced by one server
    // result and the exact same result is broadcast to every connected view.
    const canonical = room.authority!.canonicalState();
    canonical.pendingSaiKoro = {
      winner: 0,
      chances: [{
        name: 'transport-test', baseChip: 1, shuvariApplicable: true,
        count: 1, plusMinus: '+', winner: 0,
      }],
      currentIdx: 0,
      selectedCombo: null,
      rolls: [],
      finalized: false,
      summary: null,
    };
    replacement.ws.send(JSON.stringify({
      type: 'action', commandId: 'client-dice-select', expectedVersion: 1,
      matchId: 1, roundId: 1,
      action: { type: 'selectSaiKoroCombo', small: 1, large: 6 },
    }));
    await waitUntil(() => clients[1].messages.find(
      (message) => message.type === 'action' && message.commandId === 'client-dice-select',
    ));
    replacement.ws.send(JSON.stringify({
      type: 'action', commandId: 'client-dice-roll', expectedVersion: 2,
      matchId: 1, roundId: 1,
      action: { type: 'rollSaiKoroDice', override: [0, 99] },
    }));
    const diceAtSeat1 = await waitUntil(() => clients[1].messages.find(
      (message) => message.type === 'action' && message.commandId === 'client-dice-roll',
    ));
    const diceAtSeat2 = await waitUntil(() => clients[2].messages.find(
      (message) => message.type === 'action' && message.commandId === 'client-dice-roll',
    ));
    expect(diceAtSeat1.action.override).toEqual(diceAtSeat2.action.override);
    expect(diceAtSeat1.action.override).toHaveLength(2);
    for (const die of diceAtSeat1.action.override) {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(6);
    }
    // Selecting/rolling post-win dice must not re-feed the old turn draw.
    expect(diceAtSeat1.action._draw?.lastZimo ?? null).toBeNull();

    const recycled = await connect(url('new-host', 0, true, 'room-instance-test-2'));
    cleanups.push(async () => recycled.ws.close());
    await waitUntil(() => runtime.rooms.get(roomId)?.snapshot.roomInstanceId === 'room-instance-test-2' ? true : undefined);
    expect(runtime.rooms.get(roomId)?.snapshot).toMatchObject({ revision: 0, started: false, commands: [] });
    expect(persistence.findAck(roomId, command.commandId)).toBeNull();
  });

  it('persists and broadcasts a server fallback when a connected player times out', async () => {
    const secret = 'ws-deadline-test-secret';
    const persistence = new RoomPersistence(':memory:');
    const runtime = createWsRuntime({
      port: 0,
      wsSecret: secret,
      internalApiSecret: '',
      persistence,
      reactionTimeoutMs: 25,
      turnTimeoutMs: 25,
      disconnectGraceMs: 25,
      log: false,
    });
    cleanups.push(async () => runtime.close());
    const address = runtime.wss.address();
    if (!address || typeof address === 'string') throw new Error('test websocket did not bind');
    const roomId = 'D123';
    const now = Math.floor(Date.now() / 1000);
    const url = (uid: string, seat: number, isHost = false) => {
      const token = jwt.sign({
        uid, username: uid, seat, room_id: roomId,
        room_instance_id: 'deadline-instance', is_host: isHost,
        iat: now, exp: now + 60,
      }, secret, { algorithm: 'HS256' });
      return `ws://127.0.0.1:${address.port}/ws/room/${roomId}?token=${encodeURIComponent(token)}`;
    };
    const clients = await Promise.all([
      connect(url('d0', 0, true)), connect(url('d1', 1)), connect(url('d2', 2)),
    ]);
    cleanups.push(async () => { for (const client of clients) client.ws.close(); });
    clients[0].ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    await waitUntil(() => clients[0].messages.find((message) => message.type === 'start'));
    const fallback = await waitUntil(() => clients[0].messages.find(
      (message) => message.type === 'action' && String(message.commandId).startsWith(`srv:${roomId}:`),
    ));
    expect(fallback.action.type).toMatch(/^(discard|tsumo|nukiBei)$/);
    expect(persistence.loadCommands(roomId).some(
      (command) => command.commandId === fallback.commandId,
    )).toBe(true);
  });
});
