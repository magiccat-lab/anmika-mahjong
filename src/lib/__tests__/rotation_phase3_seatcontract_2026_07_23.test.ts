import { describe, expect, it } from 'vitest';
import { memberByGameSeat, membersForAuthority, resolveActorSeat } from '../../../server/ws_server';
import { mappingFor } from '../../../server/rotation';
import type { RoomSeatMapping } from '../../../server/protocol';

// [2026-07-23 4人回し Phase3] ws 接続層の seat 契約分離:
// member.seat / JWT seat = room seat、canonical command actorSeat / projection = game seat。
// 3人部屋 [mapping null] は全経路で恒等 [既存部屋の後方互換]。

const MAPPING: RoomSeatMapping = mappingFor(2, [0, 1, 2, 3], 3); // inactive=0, gameToRoom=[1,2,3]

function roomWith(mapping: RoomSeatMapping | null, seats: number[]): any {
  return {
    snapshot: { activeMapping: mapping },
    members: new Map(seats.map((seat) => [
      `u${seat}`,
      { seat, user_id: `u${seat}`, username: `p${seat}`, is_cpu: seat === 2, ws: null, generation: 0, connected: true },
    ])),
  };
}

describe('resolveActorSeat [client envelope 境界の room→game 変換]', () => {
  it('mapping 無し [3人部屋] は恒等で従来動作', () => {
    const room = roomWith(null, [0, 1, 2]);
    const resolved = resolveActorSeat(room, 'u1', 1, { type: 'discard' });
    expect(resolved.reason).toBeNull();
    expect(resolved.actorSeat).toBe(1);
    expect(resolved.actorRoomSeat).toBe(1);
  });

  it('mapping あり: room seat が game seat へ写像され、actorRoomSeat に元の席が残る', () => {
    const room = roomWith(MAPPING, [0, 1, 2, 3]);
    const resolved = resolveActorSeat(room, 'u3', 3, { type: 'discard' });
    expect(resolved.reason).toBeNull();
    expect(resolved.actorSeat).toBe(2); // gameToRoom=[1,2,3] → room3 は game2
    expect(resolved.actorRoomSeat).toBe(3);
  });

  it('抜け番 [game seat 無し] の game action は境界で拒否される', () => {
    const room = roomWith(MAPPING, [0, 1, 2, 3]);
    const resolved = resolveActorSeat(room, 'u0', 0, { type: 'discard' });
    expect(resolved.reason).toMatch(/inactive/);
  });

  it('cpuRelay 廃止の既存拒否は変換後も維持される', () => {
    const room = roomWith(null, [0, 1, 2]);
    const resolved = resolveActorSeat(room, 'u1', 1, { type: 'discard', cpuRelay: true });
    expect(resolved.reason).toMatch(/cpuRelay/);
  });
});

describe('membersForAuthority [authority へは game seat の active trio だけ]', () => {
  it('mapping 無しは全員そのまま', () => {
    const room = roomWith(null, [0, 1, 2]);
    expect(membersForAuthority(room)).toEqual([
      { seat: 0, is_cpu: false },
      { seat: 1, is_cpu: false },
      { seat: 2, is_cpu: true },
    ]);
  });

  it('mapping あり: 抜け番は渡さず、残り3人が game seat で渡る', () => {
    const room = roomWith(MAPPING, [0, 1, 2, 3]);
    const members = membersForAuthority(room);
    expect(members).toHaveLength(3);
    expect(members.map((m) => m.seat).sort()).toEqual([0, 1, 2]);
    // room1→game0 [human], room2→game1 [cpu], room3→game2 [human]
    expect(members.find((m) => m.seat === 1)?.is_cpu).toBe(true);
  });
});

describe('memberByGameSeat [権威 game seat → room member]', () => {
  it('mapping 無しは恒等、mapping ありは逆写像で member を引く', () => {
    const identity = roomWith(null, [0, 1, 2]);
    expect(memberByGameSeat(identity, 2)?.user_id).toBe('u2');
    const mapped = roomWith(MAPPING, [0, 1, 2, 3]);
    expect(memberByGameSeat(mapped, 0)?.user_id).toBe('u1');
    expect(memberByGameSeat(mapped, 2)?.user_id).toBe('u3');
  });
});
