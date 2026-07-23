import { describe, expect, it, vi } from 'vitest';
import {
  computeRoomChipDelta,
  foldRoomState,
  gameToRoomSeat,
  initialRoomChipLedger,
  mappingFor,
  roomToGameSeat,
} from '../../../server/rotation';
import {
  appendAcceptedCommand,
  applyRoomChipCommand,
  createEmptyRoomSnapshot,
  parseCanonicalRoomSnapshot,
  type AcceptedRoomCommand,
  type RoomSeatMapping,
  type RoomStartSnapshot,
} from '../../../server/protocol';
import { createRoomAuthority, RoomAuthority } from '../../../server/authority';
import { restoreAuthority, sanitizeIncomingAction, upgradeLegacySnapshotRoomLedger } from '../../../server/ws_server';
import { applyChipFromLoser, applyChipOall, type ChipSettlementEffect, type ChipState } from '../game3/chip';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-07-23 4人回し Phase2, Sol設計] mapping 層 + 4-way room ledger fold のテスト。
// 設計の柱: (a) delta は accept 時の mapping で room seat へ写像して command に焼く
// (b) fold 規則は live accept / rewind / restore で単一 [applyRoomChipCommand]
// (c) mapping 無し [3人部屋] の fold は game ledger と常に一致 [既存部屋の後方互換]
// (d) dice-oall だけ抜け番が頭数に入る。逆ぽっち [perPayer 負] は抜け番が受け取る

const MAPPING_M1: RoomSeatMapping = { gameToRoom: [0, 1, 2], inactiveRoomSeat: 3 };

function bareState(): ChipState {
  return {
    shuvariActive: { 0: false, 1: false, 2: false },
    feverActive: { 0: false, 1: false, 2: false },
    feverTier: { 0: 1, 1: 1, 2: 1 },
    pochiMultiplier: { 0: 1, 1: 1, 2: 1 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    chipBreakdown: [],
    chipEffects: [],
  };
}

function startWith(extra: Partial<RoomStartSnapshot> = {}): RoomStartSnapshot {
  return {
    preShuffledPool: [],
    qijia: 0,
    members: [
      { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
      { seat: 1, user_id: 'u1', username: 'b', is_cpu: false },
      { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
    ],
    ...extra,
  };
}

const ROOM_MEMBERS_4 = [
  { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
  { seat: 1, user_id: 'u1', username: 'b', is_cpu: false },
  { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
  { seat: 3, user_id: 'u3', username: 'd', is_cpu: false },
];

function cmd(action: Record<string, unknown>, revision: number): AcceptedRoomCommand {
  return {
    commandId: `c${revision}`,
    revision,
    matchId: 1,
    roundId: 1,
    actorSeat: 0,
    fromUserId: 'u0',
    action,
    acceptedAt: '2026-07-23T00:00:00.000Z',
  };
}

describe('rotation mapping [決定則 + seat 変換]', () => {
  it('mappingFor: 抜け番が order 順に一巡し、active は order の並びで game seat に座る', () => {
    const order = [0, 1, 2, 3];
    // initialInactiveIndex=3 [4人目が最初に抜け番] → 試合1=seat3, 2=seat0, 3=seat1, 4=seat2, 5=seat3
    const inactives = [1, 2, 3, 4, 5].map((m) => mappingFor(m, order, 3).inactiveRoomSeat);
    expect(inactives).toEqual([3, 0, 1, 2, 3]);
    const m2 = mappingFor(2, order, 3);
    expect(m2.gameToRoom).toEqual([1, 2, 3]);
  });

  it('mappingFor: 4人でない order は拒否する', () => {
    expect(() => mappingFor(1, [0, 1, 2])).toThrow(/4 room seats/);
  });

  it('seat 変換: mapping 無しは恒等、mapping ありは抜け番→null', () => {
    expect(gameToRoomSeat(null, 2)).toBe(2);
    expect(roomToGameSeat(null, 1)).toBe(1);
    expect(roomToGameSeat(null, 3)).toBeNull();
    const m = mappingFor(2, [0, 1, 2, 3], 3); // inactive=0, gameToRoom=[1,2,3]
    expect(gameToRoomSeat(m, 0)).toBe(1);
    expect(gameToRoomSeat(m, 2)).toBe(3);
    expect(roomToGameSeat(m, 3)).toBe(2);
    expect(roomToGameSeat(m, 0)).toBeNull(); // 抜け番に game seat は無い
  });
});

describe('computeRoomChipDelta', () => {
  it('mapping 無し: 任意の精算列で fold が game ledger の動きと一致する [不変条件]', () => {
    const st = bareState();
    st.feverActive[1] = true;
    st.feverTier[1] = 2;
    applyChipOall(st, 1, 5, { label: 'hule祝儀', mode: 'tsumo' });
    applyChipFromLoser(st, 2, 0, 7, { label: 'ロン祝儀' });
    applyChipOall(st, 0, 3, { label: '🎲', settlementKind: 'dice' });
    const delta = computeRoomChipDelta(st.chipEffects!, null)!;
    for (const seat of [0, 1, 2]) {
      expect(delta[String(seat)] ?? 0).toBe(st.chipLedger[seat as 0 | 1 | 2]);
    }
  });

  it('dice-oall は抜け番も頭数に入る [winner ×3、抜け番 -N]、normal-oall は入らない', () => {
    const effects: ChipSettlementEffect[] = [
      { kind: 'dice', form: 'oall', winner: 0, loser: null, base: 5, multiplier: 1, perPayer: 5, label: '🎲' },
    ];
    expect(computeRoomChipDelta(effects, MAPPING_M1)).toEqual({ '0': 15, '1': -5, '2': -5, '3': -5 });
    const normal: ChipSettlementEffect[] = [
      { kind: 'normal', form: 'oall', winner: 0, loser: null, base: 5, multiplier: 1, perPayer: 5, label: 'hule' },
    ];
    expect(computeRoomChipDelta(normal, MAPPING_M1)).toEqual({ '0': 10, '1': -5, '2': -5 });
  });

  it('逆ぽっち dice [perPayer 負] は抜け番が受け取る側になる', () => {
    const effects: ChipSettlementEffect[] = [
      { kind: 'dice', form: 'oall', winner: 2, loser: null, base: 7, multiplier: -2, perPayer: -14, label: '逆' },
    ];
    const mapping = mappingFor(2, [0, 1, 2, 3], 3); // inactive=0, gameToRoom=[1,2,3]
    // winner game2 → room3 が -42、payers room1/room2 [actives] + room0 [抜け番] が +14 ずつ
    expect(computeRoomChipDelta(effects, mapping)).toEqual({ '3': -42, '1': 14, '2': 14, '0': 14 });
  });

  it('fromLoser は mapping があっても 1:1 のまま [抜け番は関与しない]', () => {
    const effects: ChipSettlementEffect[] = [
      { kind: 'normal', form: 'fromLoser', winner: 1, loser: 0, base: 7, multiplier: 1, perPayer: 7, label: 'ロン' },
    ];
    const mapping = mappingFor(2, [0, 1, 2, 3], 3); // gameToRoom=[1,2,3]
    expect(computeRoomChipDelta(effects, mapping)).toEqual({ '2': 7, '1': -7 });
  });

  it('空列と net 0 は null [command に空 delta を焼かない]', () => {
    expect(computeRoomChipDelta([], MAPPING_M1)).toBeNull();
    const cancel: ChipSettlementEffect[] = [
      { kind: 'normal', form: 'fromLoser', winner: 1, loser: 0, base: 3, multiplier: 1, perPayer: 3, label: 'a' },
      { kind: 'normal', form: 'fromLoser', winner: 0, loser: 1, base: 3, multiplier: 1, perPayer: 3, label: 'b' },
    ];
    expect(computeRoomChipDelta(cancel, null)).toBeNull();
  });
});

describe('room ledger fold [applyRoomChipCommand / appendAcceptedCommand / foldRoomState]', () => {
  it('appendAcceptedCommand が delta を snapshot の roomChipLedger に fold する', () => {
    let snapshot = { ...createEmptyRoomSnapshot('room-a', 'inst'), started: true, roomChipLedger: { '0': 0, '1': 0, '2': 0, '3': 0 }, activeMapping: MAPPING_M1 };
    const a1 = appendAcceptedCommand(snapshot, { commandId: 'x1', actorSeat: 0, fromUserId: 'u0', action: { type: 'discard', _roomChipDelta: { '0': 15, '1': -5, '2': -5, '3': -5 } } });
    expect(a1.snapshot.roomChipLedger).toEqual({ '0': 15, '1': -5, '2': -5, '3': -5 });
    const a2 = appendAcceptedCommand(a1.snapshot, { commandId: 'x2', actorSeat: 0, fromUserId: 'u0', action: { type: 'discard', _roomChipDelta: { '3': 10, '0': -10 } } });
    expect(a2.snapshot.roomChipLedger).toEqual({ '0': 5, '1': -5, '2': -5, '3': 5 });
  });

  it('nextMatch: resetChip=true で全席 0、_nextMapping で mapping が交換される', () => {
    const before = { ledger: { '0': 5, '1': -5, '2': -5, '3': 5 }, mapping: MAPPING_M1 };
    const nextMapping = mappingFor(2, [0, 1, 2, 3], 3);
    const folded = applyRoomChipCommand(before.ledger, before.mapping, {
      type: 'nextMatch',
      resetChip: true,
      _nextMapping: nextMapping,
    });
    expect(folded.ledger).toEqual({ '0': 0, '1': 0, '2': 0, '3': 0 });
    expect(folded.mapping).toEqual(nextMapping);
    // resetChip 無しは ledger 維持で mapping だけ交換
    const kept = applyRoomChipCommand(before.ledger, before.mapping, { type: 'nextMatch', resetChip: false, _nextMapping: nextMapping });
    expect(kept.ledger).toEqual(before.ledger);
  });

  it('foldRoomState [rewind 用の全 fold] と increment 適用が一致する', () => {
    const start = startWith({
      rotationEnabled: true,
      roomMembers: ROOM_MEMBERS_4,
      initialMapping: MAPPING_M1,
      roomChipLedger: { '0': 0, '1': 0, '2': 0, '3': 0 },
    });
    const commands = [
      cmd({ type: 'discard', _roomChipDelta: { '0': 15, '1': -5, '2': -5, '3': -5 } }, 1),
      cmd({ type: 'nextMatch', resetChip: false, _nextMapping: mappingFor(2, [0, 1, 2, 3], 3) }, 2),
      cmd({ type: 'discard', _roomChipDelta: { '3': 21, '1': -7, '2': -7, '0': -7 } }, 3),
    ];
    const folded = foldRoomState(start, commands);
    expect(folded.roomChipLedger).toEqual({ '0': 8, '1': -12, '2': -12, '3': 16 });
    expect(folded.activeMapping).toEqual(mappingFor(2, [0, 1, 2, 3], 3));
    // rewind で末尾 command を捨てた fold [spread 持ち越しではなく再計算になること]
    const rewound = foldRoomState(start, commands.slice(0, 2));
    expect(rewound.roomChipLedger).toEqual({ '0': 15, '1': -5, '2': -5, '3': -5 });
  });

  it('initialRoomChipLedger: rotation 部屋は roomMembers 4 席、3人部屋は members 3 席で 0 埋め', () => {
    expect(initialRoomChipLedger(startWith({ roomMembers: ROOM_MEMBERS_4 }))).toEqual({ '0': 0, '1': 0, '2': 0, '3': 0 });
    expect(initialRoomChipLedger(startWith())).toEqual({ '0': 0, '1': 0, '2': 0 });
  });

  it('schema v2 の旧 snapshot [rotation field 無し] を読める', () => {
    const legacy = JSON.stringify({ ...createEmptyRoomSnapshot('room-b', 'inst'), schemaVersion: 2 });
    const parsed = parseCanonicalRoomSnapshot(legacy);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.roomChipLedger).toBeUndefined();
    expect(parsed.activeMapping).toBeUndefined();
  });
});

describe('偽装防御 [Sol Phase2 P1-①]', () => {
  it('sanitizeIncomingAction が server 予約 field を剥がし、正規 field は残す', () => {
    const forged = sanitizeIncomingAction({
      type: 'discard',
      pai: 'm1',
      meta: { a: 1 },
      _roomChipDelta: { '0': 100, '1': -100 },
      _nextMapping: MAPPING_M1,
      _blindState: { fake: true },
      _draw: { fake: true },
      _state: { fake: true },
    });
    expect(forged).toEqual({ type: 'discard', pai: 'm1', meta: { a: 1 } });
  });

  it('sanitize 済み action は appendAcceptedCommand で ledger を動かせない', () => {
    const snapshot = {
      ...createEmptyRoomSnapshot('room-e', 'inst'),
      started: true,
      roomChipLedger: { '0': 3, '1': -3, '2': 0 },
      activeMapping: null,
    };
    const action = sanitizeIncomingAction({ type: 'discard', pai: 'm1', _roomChipDelta: { '0': 999, '1': -999 } });
    const appended = appendAcceptedCommand(snapshot, { commandId: 'f1', actorSeat: 0, fromUserId: 'u0', action });
    expect(appended.snapshot.roomChipLedger).toEqual({ '0': 3, '1': -3, '2': 0 });
    expect(appended.command.action._roomChipDelta).toBeUndefined();
  });

  it('fold は不正 delta / 不正 mapping を fail closed で拒否する [黙って汚さない]', () => {
    const ledger = { '0': 0, '1': 0, '2': 0, '3': 0 };
    // zero-sum 破れ [偽装 or 永続破損]
    expect(() => applyRoomChipCommand(ledger, MAPPING_M1, { type: 'discard', _roomChipDelta: { '0': 100, '1': -1 } })).toThrow(/zero-sum/);
    // seat key 範囲外
    expect(() => applyRoomChipCommand(ledger, MAPPING_M1, { type: 'discard', _roomChipDelta: { '9': 1, '0': -1 } })).toThrow(/seat key/);
    // 非整数
    expect(() => applyRoomChipCommand(ledger, MAPPING_M1, { type: 'discard', _roomChipDelta: { '0': 0.5, '1': -0.5 } })).toThrow(/non-integer/);
    // mapping の重複席
    expect(() => applyRoomChipCommand(ledger, MAPPING_M1, { type: 'nextMatch', _nextMapping: { gameToRoom: [0, 0, 1], inactiveRoomSeat: 2 } })).toThrow(/distinct/);
    // 正常 delta は通る
    const ok = applyRoomChipCommand(ledger, MAPPING_M1, { type: 'discard', _roomChipDelta: { '0': 2, '1': -1, '2': -1 } });
    expect(ok.ledger).toEqual({ '0': 2, '1': -1, '2': -1, '3': 0 });
  });
});

describe('legacy snapshot 移行 [Sol Phase2 P1-②]', () => {
  function poolL(): string[] {
    return generateTilePool(defaultSanmaRule()).map(String);
  }

  it('roomChipLedger 未定義の進行中部屋は canonical game ledger から seed される', () => {
    const authority = createRoomAuthority({ preShuffledPool: poolL(), qijia: 0 });
    // 既に chip 残高がある v2 部屋を再現
    const game = authority.canonicalState().game;
    game.chipLedger[0] = 12;
    game.chipLedger[1] = -5;
    game.chipLedger[2] = -7;
    const legacy = { ...createEmptyRoomSnapshot('room-f', 'inst'), started: true };
    delete (legacy as Record<string, unknown>).roomChipLedger;
    const upgraded = upgradeLegacySnapshotRoomLedger(legacy, authority);
    expect(upgraded).not.toBeNull();
    expect(upgraded!.roomChipLedger).toEqual({ '0': 12, '1': -5, '2': -7 });
    expect(upgraded!.activeMapping).toBeNull();
    // 移行後の次精算 delta は既存残高の上に fold される [残高が消えない]
    const after = applyRoomChipCommand(upgraded!.roomChipLedger, upgraded!.activeMapping, { type: 'discard', _roomChipDelta: { '1': 4, '0': -2, '2': -2 } });
    expect(after.ledger).toEqual({ '0': 10, '1': -1, '2': -9 });
  });

  it('移行済み [roomChipLedger あり] / 未開始の部屋は再 seed しない', () => {
    const authority = createRoomAuthority({ preShuffledPool: poolL(), qijia: 0 });
    const seeded = { ...createEmptyRoomSnapshot('room-g', 'inst'), started: true, roomChipLedger: { '0': 1, '1': -1, '2': 0 } };
    expect(upgradeLegacySnapshotRoomLedger(seeded, authority)).toBeNull();
    const notStarted = { ...createEmptyRoomSnapshot('room-h', 'inst') };
    expect(upgradeLegacySnapshotRoomLedger(notStarted, authority)).toBeNull();
  });
});

describe('authority sink 配線 [canonical drain + restore 再課金防止]', () => {
  function pool(): string[] {
    return generateTilePool(defaultSanmaRule()).map(String);
  }

  it('takeCanonicalChipEffects は canonical sink を 1 回で drain し、mirror 側も同時に空にする', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const game = authority.canonicalState().game;
    game.applyChipOall(0, 2, { label: 'test', settlementKind: 'dice' });
    authority.game.chipEffects.push({ kind: 'normal', form: 'oall', winner: 0, loser: null, base: 1, multiplier: 1, perPayer: 1, label: 'mirror stale copy' });
    const effects = authority.takeCanonicalChipEffects();
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe('dice');
    expect(authority.takeCanonicalChipEffects()).toHaveLength(0);
    // [Sol Phase1レビュー] drain 契約は validation mirror の stale copy も残さない
    expect(authority.game.chipEffects).toHaveLength(0);
  });

  it('restoreAuthority は replay 後に sink を空にして返す [直後の accept が二重に焼かない]', () => {
    const shuffled = pool();
    const start = startWith({ preShuffledPool: shuffled });
    const source = createRoomAuthority({ preShuffledPool: shuffled, qijia: 0 });
    // 実 command として最小の1手 [現手番の tsumokiri] を積む
    const actor = source.currentPlayer();
    const reason = source.validateAndApply(actor, { type: 'tsumokiri' }, start.members);
    expect(reason).toBeNull();
    const snapshot = {
      ...createEmptyRoomSnapshot('room-c', 'inst'),
      started: true,
      start,
    };
    const commands = [cmd({ type: 'tsumokiri' }, 1)];
    commands[0].actorSeat = actor;
    const restored = restoreAuthority(snapshot, commands);
    expect(restored).not.toBeNull();
    expect(restored!.takeCanonicalChipEffects()).toHaveLength(0);
    // restore 後に新たな精算が起きれば通常どおり 1 回だけ拾える
    restored!.canonicalState().game.applyChipOall(1, 3, { label: 'after', settlementKind: 'dice' });
    expect(restored!.takeCanonicalChipEffects()).toHaveLength(1);
  });

  it('replay 中に精算 effect が出る復元でも sink は空で返る [Sol Phase1 P1 の回帰仕様]', () => {
    const shuffled = pool();
    const start = startWith({ preShuffledPool: shuffled });
    const source = createRoomAuthority({ preShuffledPool: shuffled, qijia: 0 });
    const actor = source.currentPlayer();
    expect(source.validateAndApply(actor, { type: 'tsumokiri' }, start.members)).toBeNull();
    const snapshot = { ...createEmptyRoomSnapshot('room-d', 'inst'), started: true, start };
    const commands = [cmd({ type: 'tsumokiri' }, 1)];
    commands[0].actorSeat = actor;
    // 適用成功のたびに canonical sink へ dice effect を積ませ、
    // 「replay がチップ精算を再実行した」状況を本物の配線の上で再現する
    const original = RoomAuthority.prototype.validateAndApply;
    const spy = vi.spyOn(RoomAuthority.prototype, 'validateAndApply').mockImplementation(function (this: RoomAuthority, ...args: Parameters<RoomAuthority['validateAndApply']>) {
      const reason = original.apply(this, args);
      if (!reason) {
        this.canonicalState().game.chipEffects.push({ kind: 'dice', form: 'oall', winner: 0, loser: null, base: 1, multiplier: 1, perPayer: 1, label: 'replayed settlement' });
      }
      return reason;
    });
    let restored: RoomAuthority | null;
    try {
      restored = restoreAuthority(snapshot, commands);
    } finally {
      spy.mockRestore();
    }
    expect(restored).not.toBeNull();
    // restoreAuthority 末尾の discard drain が無いと、この履歴分が次の live accept で
    // そのまま command に焼かれて 4-way ledger の二重反映になる
    expect(restored!.takeCanonicalChipEffects()).toHaveLength(0);
    restored!.canonicalState().game.applyChipOall(2, 5, { label: '次のdice', settlementKind: 'dice' });
    const next = restored!.takeCanonicalChipEffects();
    expect(next).toHaveLength(1);
    expect(next[0].label).toBe('次のdice');
  });
});
