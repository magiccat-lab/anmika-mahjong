import { describe, expect, it } from 'vitest';
import {
  computeRoomChipDelta,
  foldRoomState,
  mappingFor,
  mappingForPresent,
  nextMappingForPresent,
  presentRoomSeats,
  roomToGameSeat,
  gameToRoomSeat,
} from '../../../server/rotation';
import {
  appendAcceptedCommand,
  applyRoomChipCommand,
  createEmptyRoomSnapshot,
  type AcceptedRoomCommand,
  type RoomSeatMapping,
  type RoomStartSnapshot,
} from '../../../server/protocol';
import type { ChipSettlementEffect } from '../game3/chip';

// [2026-10-24 リョー「途中で誰か抜けて3人打ちもできるようにして」] 4人回しの部屋で 1 人が抜けた後、
// 残り 3 人が抜け番なし [inactiveRoomSeat = -1] の普通の 3 人打ちとして続ける mapping 層のテスト。

const ROOM_MEMBERS_4 = [
  { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
  { seat: 1, user_id: 'u1', username: 'b', is_cpu: false },
  { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
  { seat: 3, user_id: 'u3', username: 'd', is_cpu: false },
];

function rotationStart(extra: Partial<RoomStartSnapshot> = {}): RoomStartSnapshot {
  return {
    preShuffledPool: [],
    qijia: 0,
    members: ROOM_MEMBERS_4.slice(0, 3),
    rotationEnabled: true,
    roomMembers: ROOM_MEMBERS_4,
    initialMapping: mappingFor(1, [0, 1, 2, 3]),
    ...extra,
  };
}

function cmd(action: Record<string, unknown>, revision: number): AcceptedRoomCommand {
  return {
    commandId: `c${revision}`, revision, matchId: 1, roundId: 1, actorSeat: 0, fromUserId: 'u0',
    action, acceptedAt: '2026-10-24T00:00:00.000Z',
  };
}

const THREE_MAPPING: RoomSeatMapping = { gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 };

describe('presentRoomSeats / mappingForPresent', () => {
  it('居る人の room seat を start.roomMembers の並びで返す [CPU は常に居る]', () => {
    const start = rotationStart({
      roomMembers: [
        ROOM_MEMBERS_4[0], ROOM_MEMBERS_4[1], { ...ROOM_MEMBERS_4[2], is_cpu: true, user_id: 'CPU_2' }, ROOM_MEMBERS_4[3],
      ],
    });
    // u1 が抜けた、CPU_2 は members に載っていなくても居る扱い
    expect(presentRoomSeats(start, (uid) => uid !== 'u1')).toEqual([0, 2, 3]);
    expect(presentRoomSeats(rotationStart(), () => true)).toEqual([0, 1, 2, 3]);
  });

  it('3 人居る: 居る 3 席が roomMembers の順で game seat 0..2、抜け番は -1', () => {
    expect(mappingForPresent(rotationStart(), [0, 1, 3])).toEqual({ gameToRoom: [0, 1, 3], inactiveRoomSeat: -1 });
    expect(mappingForPresent(rotationStart(), [3, 2, 0])).toEqual({ gameToRoom: [0, 2, 3], inactiveRoomSeat: -1 });
    expect(mappingForPresent(rotationStart(), [1, 2, 3])).toEqual({ gameToRoom: [1, 2, 3], inactiveRoomSeat: -1 });
  });

  it('3 人でない / rotation 無効 / roster 不整合は null', () => {
    expect(mappingForPresent(rotationStart(), [0, 1])).toBeNull();
    expect(mappingForPresent(rotationStart(), [0, 1, 2, 3])).toBeNull();
    expect(mappingForPresent(rotationStart({ rotationEnabled: undefined }), [0, 1, 2])).toBeNull();
    expect(mappingForPresent(rotationStart({ roomMembers: ROOM_MEMBERS_4.slice(0, 3) }), [0, 1, 2])).toBeNull();
  });

  it('roomMembers に無い席が混ざっても数えない [3 人に見せかけない]', () => {
    expect(mappingForPresent(rotationStart(), [0, 1, 9])).toBeNull();
  });
});

describe('nextMappingForPresent [nextMatch 用]', () => {
  it('4 人居る: 従来の rotation と同じ [抜け番が一巡する]', () => {
    const start = rotationStart();
    expect(nextMappingForPresent(start, [0, 1, 2, 3], 2)).toEqual(mappingFor(2, [0, 1, 2, 3]));
    expect(nextMappingForPresent(start, [0, 1, 2, 3], 2)!.inactiveRoomSeat).toBe(0);
  });

  it('3 人居る: 試合の番号に関わらず抜け番なしの 3 人打ち', () => {
    const start = rotationStart();
    for (const ordinal of [2, 3, 4, 5]) {
      expect(nextMappingForPresent(start, [0, 1, 3], ordinal)).toEqual(THREE_MAPPING);
    }
  });

  it('2 人以下は null [呼出側が nextMatch を reject する]', () => {
    expect(nextMappingForPresent(rotationStart(), [0, 3], 2)).toBeNull();
    expect(nextMappingForPresent(rotationStart(), [], 2)).toBeNull();
  });

  it('rotation 無効は null [3人部屋は mapping 無しのまま]', () => {
    expect(nextMappingForPresent(rotationStart({ rotationEnabled: undefined }), [0, 1, 2], 2)).toBeNull();
  });
});

describe('inactiveRoomSeat -1 の安全性', () => {
  it('seat 変換: -1 mapping は 3 席すべてが active、抜け番を指す room seat は無い', () => {
    expect(roomToGameSeat(THREE_MAPPING, 0)).toBe(0);
    expect(roomToGameSeat(THREE_MAPPING, 3)).toBe(2);
    expect(roomToGameSeat(THREE_MAPPING, 2)).toBeNull(); // 抜けた席
    expect(roomToGameSeat(THREE_MAPPING, -1)).toBeNull();
    expect(gameToRoomSeat(THREE_MAPPING, 2)).toBe(3);
  });

  it('dice-oall: 抜け番に課金せず seat -1 のキーを作らない [払う側は 2 人]', () => {
    const effects: ChipSettlementEffect[] = [
      { kind: 'dice', form: 'oall', winner: 0, loser: null, base: 5, multiplier: 1, perPayer: 5, label: '🎲' },
    ];
    const delta = computeRoomChipDelta(effects, THREE_MAPPING)!;
    expect(delta).toEqual({ '0': 10, '1': -5, '3': -5 });
    expect(Object.keys(delta)).not.toContain('-1');
    expect(Object.values(delta).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('逆ぽっち dice [perPayer 負] も 3 人の間だけで動く', () => {
    const effects: ChipSettlementEffect[] = [
      { kind: 'dice', form: 'oall', winner: 2, loser: null, base: 7, multiplier: -2, perPayer: -14, label: '逆' },
    ];
    // winner game2 → room3 が -28、payers room0/room1 が +14
    expect(computeRoomChipDelta(effects, THREE_MAPPING)).toEqual({ '3': -28, '0': 14, '1': 14 });
  });

  it('normal-oall / fromLoser は 4 人回しの mapping と同じ [3 人の間だけ]', () => {
    const normal: ChipSettlementEffect[] = [
      { kind: 'normal', form: 'oall', winner: 1, loser: null, base: 5, multiplier: 1, perPayer: 5, label: 'hule' },
      { kind: 'normal', form: 'fromLoser', winner: 2, loser: 0, base: 3, multiplier: 1, perPayer: 3, label: 'ron' },
    ];
    expect(computeRoomChipDelta(normal, THREE_MAPPING)).toEqual({ '1': 10, '0': -8, '3': -2 });
  });

  it('applyRoomChipCommand: -1 mapping の _nextMapping を受け、重複席や範囲外は拒否する', () => {
    const ledger = { '0': 5, '1': 0, '2': -5, '3': 0 };
    const folded = applyRoomChipCommand(ledger, mappingFor(2, [0, 1, 2, 3]), { type: 'nextMatch', _nextMapping: THREE_MAPPING });
    expect(folded.mapping).toEqual(THREE_MAPPING);
    // 抜けた席 2 の最終残高は ledger に残ったまま
    expect(folded.ledger).toEqual(ledger);
    expect(() => applyRoomChipCommand(ledger, THREE_MAPPING, {
      type: 'nextMatch', _nextMapping: { gameToRoom: [0, 0, 3], inactiveRoomSeat: -1 },
    })).toThrow(/distinct/);
    expect(() => applyRoomChipCommand(ledger, THREE_MAPPING, {
      type: 'nextMatch', _nextMapping: { gameToRoom: [0, 1, 4], inactiveRoomSeat: -1 },
    })).toThrow(/out of range/);
    expect(() => applyRoomChipCommand(ledger, THREE_MAPPING, {
      type: 'nextMatch', _nextMapping: { gameToRoom: [0, 1, 2], inactiveRoomSeat: -2 },
    })).toThrow(/out of range/);
    // 従来の 4 席 mapping の検証は変わらない [抜け番が active と重なる]
    expect(() => applyRoomChipCommand(ledger, THREE_MAPPING, {
      type: 'nextMatch', _nextMapping: { gameToRoom: [0, 1, 2], inactiveRoomSeat: 2 },
    })).toThrow(/distinct/);
  });

  it('appendAcceptedCommand + foldRoomState: 4 人 → 3 人打ちへ跨いでも ledger が一致する', () => {
    const start = rotationStart({ roomChipLedger: { '0': 0, '1': 0, '2': 0, '3': 0 } });
    const commands = [
      cmd({ type: 'discard', _roomChipDelta: { '0': 15, '1': -5, '2': -5, '3': -5 } }, 1), // 試合1 [抜け番 3 の dice 込み]
      cmd({ type: 'nextMatch', resetChip: false, _nextMapping: THREE_MAPPING }, 2), // 2 が抜けて 3 人打ち
      cmd({ type: 'discard', _roomChipDelta: { '3': 10, '0': -5, '1': -5 } }, 3),
    ];
    let snapshot = { ...createEmptyRoomSnapshot('room-a', 'inst'), started: true, roomChipLedger: start.roomChipLedger, activeMapping: start.initialMapping };
    for (const command of commands) {
      snapshot = appendAcceptedCommand(snapshot, {
        commandId: command.commandId, actorSeat: 0, fromUserId: 'u0', action: command.action,
      }).snapshot;
    }
    const folded = foldRoomState(start, commands);
    expect(folded.roomChipLedger).toEqual({ '0': 10, '1': -10, '2': -5, '3': 5 });
    expect(folded.activeMapping).toEqual(THREE_MAPPING);
    expect(snapshot.roomChipLedger).toEqual(folded.roomChipLedger);
    expect(snapshot.activeMapping).toEqual(folded.activeMapping);
    expect(snapshot.matchId).toBe(2);
  });

  it('既存の 4 席 mapping を焼いた旧 command 列は従来どおり fold できる [後方互換]', () => {
    const start = rotationStart({ roomChipLedger: { '0': 0, '1': 0, '2': 0, '3': 0 } });
    const commands = [
      cmd({ type: 'nextMatch', _nextMapping: mappingFor(2, [0, 1, 2, 3]) }, 1),
      cmd({ type: 'nextMatch', _nextMapping: mappingFor(3, [0, 1, 2, 3]) }, 2),
    ];
    expect(foldRoomState(start, commands).activeMapping).toEqual({ gameToRoom: [0, 2, 3], inactiveRoomSeat: 1 });
  });
});
