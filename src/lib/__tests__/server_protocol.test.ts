import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import {
  appendAcceptedCommand,
  createEmptyRoomSnapshot,
  serializeCanonical,
  validateCommandEnvelope,
  type CommandAck,
} from '../../../server/protocol';

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('canonical room protocol', () => {
  it('serializes object keys deterministically', () => {
    expect(serializeCanonical({ z: 1, a: { y: 2, b: 3 } }))
      .toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it('requires command identity and optimistic version fields', () => {
    expect(validateCommandEnvelope({ type: 'action', action: { type: 'discard' } }).reason)
      .toBe('invalid commandId');
    expect(validateCommandEnvelope({
      type: 'action',
      commandId: 'room:seat:0001',
      expectedVersion: 0,
      matchId: 1,
      roundId: 1,
      action: { type: 'discard', pai: 'p1' },
    }).reason).toBeNull();
  });

  it('increments revision and round/match identity exactly once', () => {
    const initial = createEmptyRoomSnapshot('ABCD');
    const first = appendAcceptedCommand(initial, {
      commandId: 'command-0001',
      actorSeat: 0,
      fromUserId: 'u0',
      action: { type: 'nextRound' },
    }, new Date('2026-07-15T00:00:00.000Z'));
    expect(first.command).toMatchObject({ revision: 1, matchId: 1, roundId: 1 });
    expect(first.snapshot).toMatchObject({ revision: 1, matchId: 1, roundId: 2 });

    const second = appendAcceptedCommand(first.snapshot, {
      commandId: 'command-0002',
      actorSeat: 0,
      fromUserId: 'u0',
      action: { type: 'nextMatch' },
    });
    expect(second.command).toMatchObject({ revision: 2, matchId: 1, roundId: 2 });
    expect(second.snapshot).toMatchObject({ revision: 2, matchId: 2, roundId: 1 });
  });
});

describe('RoomPersistence', () => {
  it('atomically persists accepted commands, ACKs and the matching snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anmika-room-db-'));
    cleanup.push(dir);
    const db = new RoomPersistence(join(dir, 'state.sqlite3'));
    const initial = { ...createEmptyRoomSnapshot('ABCD'), updatedAt: new Date().toISOString() };
    initial.started = true;
    initial.start = { preShuffledPool: ['p1'], qijia: 0, members: [] };
    const accepted = appendAcceptedCommand(initial, {
      commandId: 'command-0001',
      actorSeat: 0,
      fromUserId: 'u0',
      action: { type: 'discard', pai: 'p1' },
    });
    const ack: CommandAck = {
      type: 'ack',
      commandId: accepted.command.commandId,
      accepted: true,
      duplicate: false,
      revision: accepted.command.revision,
      matchId: accepted.command.matchId,
      roundId: accepted.command.roundId,
    };

    db.saveAcceptedCommand(accepted.snapshot, accepted.command, ack);
    expect(db.loadSnapshot('ABCD')).toEqual(accepted.snapshot);
    expect(db.findAck('ABCD', 'command-0001')).toEqual(ack);
    db.close();
  });

  it('clears stale idempotency rows when a short room ID is recycled', () => {
    const db = new RoomPersistence(':memory:');
    const first = createEmptyRoomSnapshot('ABCD', 'instance-one');
    const accepted = appendAcceptedCommand(first, {
      commandId: 'command-0001',
      actorSeat: 0,
      fromUserId: 'u0',
      action: { type: 'stamp', stampId: 'plus' },
    });
    db.saveAcceptedCommand(accepted.snapshot, accepted.command, {
      type: 'ack', commandId: 'command-0001', accepted: true, duplicate: false,
      revision: 1, matchId: 1, roundId: 1,
    });
    db.resetRoom(createEmptyRoomSnapshot('ABCD', 'instance-two'));
    expect(db.findAck('ABCD', 'command-0001')).toBeNull();
    expect(db.loadSnapshot('ABCD')).toMatchObject({
      roomInstanceId: 'instance-two', revision: 0, started: false,
    });
    db.close();
  });
});
