import { describe, expect, it } from 'vitest';
import { currentMatchRoomDelta, ledgerByUserId } from '../../../server/ws_server';
import { mappingFor } from '../../../server/rotation';
import { createEmptyRoomSnapshot, type AcceptedRoomCommand, type CanonicalRoomSnapshot } from '../../../server/protocol';

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
  it('現 matchId の delta だけ畳み、抜け番の dice 分が user 込みで出る', () => {
    const snapshot = snapshotWith({ matchId: 2, activeMapping: mappingFor(2, [0, 1, 2, 3], 3) });
    const commands = [
      cmd(1, 1, { '0': 10, '1': -10 }), // 前試合分 [混ぜない]
      cmd(2, 2, { '1': 15, '2': -5, '3': -5, '0': -5 }), // dice: 抜け番 room0 も払う
      cmd(2, 3, null),
      cmd(2, 4, { '1': -7, '2': 7 }),
    ];
    const result = currentMatchRoomDelta(snapshot, commands);
    expect(result.bySeat).toEqual({ '1': 8, '2': 2, '3': -5, '0': -5 });
    expect(result.byUser).toEqual({ u1: 8, u2: 2, u3: -5, u0: -5 });
  });

  it('delta の無い試合は空 [ゼロ捏造しない]', () => {
    const snapshot = snapshotWith({ matchId: 3 });
    expect(currentMatchRoomDelta(snapshot, [cmd(2, 1, { '0': 1, '1': -1 })])).toEqual({ bySeat: {}, byUser: {} });
  });
});
