import { describe, expect, it } from 'vitest';
import { currentMatchRoomDelta, ledgerByUserId } from '../../../server/ws_server';
import { mappingFor } from '../../../server/rotation';
import { RoomPersistence } from '../../../server/persistence';
import { appendAcceptedCommand, createEmptyRoomSnapshot, type AcceptedRoomCommand, type CanonicalRoomSnapshot, type CommandAck } from '../../../server/protocol';

// [2026-07-23 4人回し Phase5] matches POST が食う /internal/match-result の
// server 確定値: game seat ledger の user 写像 [mapping-aware] と、
// 抜け番 dice 分を含む現試合 room ledger delta の fold。

const ROOM_MEMBERS = [
  { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
  { seat: 1, user_id: 'u1', username: 'b', is_cpu: false },
  { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
  { seat: 3, user_id: 'u3', username: 'd', is_cpu: false },
];

function snapshotWith(overrides: Partial<CanonicalRoomSnapshot>): CanonicalRoomSnapshot {
  return {
    ...createEmptyRoomSnapshot('room-x', 'inst'),
    started: true,
    start: {
      preShuffledPool: [],
      qijia: 0,
      members: ROOM_MEMBERS.slice(0, 3),
      rotationEnabled: true,
      roomMembers: ROOM_MEMBERS,
      initialMapping: mappingFor(1, [0, 1, 2, 3], 3),
    },
    ...overrides,
  };
}

function cmd(matchId: number, revision: number, delta: Record<string, number> | null): AcceptedRoomCommand {
  return {
    commandId: `c${revision}`,
    revision,
    matchId,
    roundId: 1,
    actorSeat: 0,
    fromUserId: 'u0',
    action: delta ? { type: 'discard', _roomChipDelta: delta } : { type: 'discard' },
    acceptedAt: '2026-07-23T00:00:00.000Z',
  };
}

describe('ledgerByUserId [mapping-aware な user 写像]', () => {
  it('mapping 無し [3人部屋] は従来どおり seat=user 直対応', () => {
    const snapshot = snapshotWith({ activeMapping: null });
    snapshot.start!.rotationEnabled = undefined;
    snapshot.start!.roomMembers = undefined;
    expect(ledgerByUserId(snapshot, { 0: 5, 1: -2, 2: -3 })).toEqual({ u0: 5, u1: -2, u2: -3 });
  });

  it('試合2 [inactive=0, gameToRoom=[1,2,3]] では game seat が room member u1/u2/u3 に写る', () => {
    const snapshot = snapshotWith({ activeMapping: mappingFor(2, [0, 1, 2, 3], 3) });
    expect(ledgerByUserId(snapshot, { 0: 7, 1: -3, 2: -4 })).toEqual({ u1: 7, u2: -3, u3: -4 });
  });
});

describe('currentMatchRoomDelta [現試合の 4-way delta fold]', () => {
  it('最後の nextMatch より後 [現試合] の delta だけ畳み、抜け番の dice 分が user 込みで出る', () => {
    const snapshot = snapshotWith({ matchId: 2, activeMapping: mappingFor(2, [0, 1, 2, 3], 3) });
    const boundary = cmd(1, 2, null);
    boundary.action = { type: 'nextMatch', resetChip: false };
    const commands = [
      cmd(1, 1, { '0': 10, '1': -10 }), // 前試合分 [境界より前なので混ぜない]
      boundary,
      cmd(2, 3, { '1': 15, '2': -5, '3': -5, '0': -5 }), // dice: 抜け番 room0 も払う
      cmd(2, 4, null),
      cmd(2, 5, { '1': -7, '2': 7 }),
    ];
    const result = currentMatchRoomDelta(snapshot, commands);
    expect(result.bySeat).toEqual({ '1': 8, '2': 2, '3': -5, '0': -5 });
    expect(result.byUser).toEqual({ u1: 8, u2: 2, u3: -5, u0: -5 });
  });

  it('delta の無い試合: bySeat は空、byUser は roster 全員の 0 埋め完全 map [Sol (c) SSoT 形式]', () => {
    const snapshot = snapshotWith({ matchId: 3 });
    // 前試合 command は nextMatch 境界より前 [現試合には畳まれない]
    const commands = [cmd(2, 1, { '0': 1, '1': -1 }), cmd(2, 2, null)];
    commands[1].action = { type: 'nextMatch' };
    expect(currentMatchRoomDelta(snapshot, commands)).toEqual({
      bySeat: {},
      byUser: { u0: 0, u1: 0, u2: 0, u3: 0 },
    });
  });

  it('[Sol Phase5 P0] 実 persistence 経由 [matchId 0 復元] でも現試合 delta が畳める', () => {
    // 本番配線の再現: appendAcceptedCommand → saveAcceptedCommand → loadCommands。
    // loadCommands は matchId/roundId を 0 固定で返すため、matchId フィルタでは常に空になる
    const persistence = new RoomPersistence(':memory:');
    try {
      let snapshot = snapshotWith({ activeMapping: mappingFor(1, [0, 1, 2, 3], 3) });
      persistence.resetRoom(snapshot);
      const append = (action: Record<string, unknown>) => {
        const result = appendAcceptedCommand(snapshot, {
          commandId: `it-${snapshot.revision + 1}`,
          actorSeat: 0,
          fromUserId: 'u0',
          action,
        });
        const ack: CommandAck = {
          type: 'ack', commandId: result.command.commandId, accepted: true, duplicate: false,
          revision: result.snapshot.revision, matchId: result.snapshot.matchId, roundId: result.snapshot.roundId,
        };
        persistence.saveAcceptedCommand(result.snapshot, result.command, ack);
        snapshot = result.snapshot;
      };
      // 試合1: dice delta [抜け番 room3 も払う]
      append({ type: 'discard', _roomChipDelta: { '0': 15, '1': -5, '2': -5, '3': -5 } });
      // 試合境界
      append({ type: 'nextMatch', resetChip: false, _nextMapping: mappingFor(2, [0, 1, 2, 3], 3) });
      // 試合2 [現試合]: 2精算
      append({ type: 'discard', _roomChipDelta: { '1': 9, '2': -3, '3': -3, '0': -3 } });
      append({ type: 'discard', _roomChipDelta: { '2': 4, '1': -4 } });
      const loaded = persistence.loadCommands('room-x');
      expect(loaded).toHaveLength(4);
      expect(loaded.every((command) => command.matchId === 0)).toBe(true); // 前提の確認
      const result = currentMatchRoomDelta(snapshot, loaded);
      expect(result.bySeat).toEqual({ '1': 5, '2': 1, '3': -3, '0': -3 });
      expect(result.byUser).toEqual({ u1: 5, u2: 1, u3: -3, u0: -3 });
    } finally {
      persistence.close();
    }
  });
});

describe('rotation roster 破損の fail-closed [Sol Phase4/5 P1]', () => {
  it('roster 重複 / initialMapping 矛盾は nextMappingForMatch が null [呼出側で明示 reject]', async () => {
    const { nextMappingForMatch } = await import('../../../server/rotation');
    const base = snapshotWith({}).start!;
    // 重複 seat
    const dup = { ...base, roomMembers: [
      { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
      { seat: 0, user_id: 'u1', username: 'b', is_cpu: false },
      { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
      { seat: 3, user_id: 'u3', username: 'd', is_cpu: false },
    ] };
    expect(nextMappingForMatch(dup, 2)).toBeNull();
    // initialMapping の抜け番が roster に居ない
    const mismatch = { ...base, initialMapping: { gameToRoom: [0, 1, 2] as [number, number, number], inactiveRoomSeat: 9 } };
    expect(nextMappingForMatch(mismatch, 2)).toBeNull();
    // 正常 roster は従来どおり
    expect(nextMappingForMatch(base, 2)).not.toBeNull();
  });
});
