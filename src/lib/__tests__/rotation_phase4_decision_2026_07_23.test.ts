import { describe, expect, it } from 'vitest';
import { mappingFor, nextMappingForMatch } from '../../../server/rotation';
import { resolveActorSeat } from '../../../server/ws_server';
import type { RoomStartSnapshot } from '../../../server/protocol';

// [2026-07-23 4人回し Phase4] rotation 決定則の server 焼き込みと
// 抜け番 host の nextMatch 代行 [room control] のテスト。

function rotationStart(overrides: Partial<RoomStartSnapshot> = {}): RoomStartSnapshot {
  return {
    preShuffledPool: [],
    qijia: 0,
    members: [
      { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
      { seat: 1, user_id: 'u1', username: 'b', is_cpu: false },
      { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
    ],
    rotationEnabled: true,
    roomMembers: [
      { seat: 0, user_id: 'u0', username: 'a', is_cpu: false },
      { seat: 1, user_id: 'u1', username: 'b', is_cpu: false },
      { seat: 2, user_id: 'u2', username: 'c', is_cpu: false },
      { seat: 3, user_id: 'u3', username: 'd', is_cpu: false },
    ],
    initialMapping: mappingFor(1, [0, 1, 2, 3], 3),
    ...overrides,
  };
}

describe('nextMappingForMatch [nextMatch accept 直前の server 決定]', () => {
  it('rotation 無効 [3人部屋] は常に null', () => {
    const start = rotationStart({ rotationEnabled: undefined, roomMembers: undefined, initialMapping: undefined });
    expect(nextMappingForMatch(start, 2)).toBeNull();
  });

  it('試合 ordinal に応じて抜け番が一巡する [初期抜け番 = initialMapping の席]', () => {
    const start = rotationStart();
    // initialMapping の inactive=3 [order index 3] → 試合2=0, 3=1, 4=2, 5=3
    expect(nextMappingForMatch(start, 2)!.inactiveRoomSeat).toBe(0);
    expect(nextMappingForMatch(start, 3)!.inactiveRoomSeat).toBe(1);
    expect(nextMappingForMatch(start, 4)!.inactiveRoomSeat).toBe(2);
    expect(nextMappingForMatch(start, 5)!.inactiveRoomSeat).toBe(3);
    // active は order 並びで game seat 0..2
    expect(nextMappingForMatch(start, 2)!.gameToRoom).toEqual([1, 2, 3]);
  });

  it('initialMapping 無しは 4人目 [order 末尾] が初期抜け番', () => {
    const start = rotationStart({ initialMapping: undefined });
    expect(nextMappingForMatch(start, 1)!.inactiveRoomSeat).toBe(3);
    expect(nextMappingForMatch(start, 2)!.inactiveRoomSeat).toBe(0);
  });

  it('roomMembers が 4 人でなければ null [壊れた start で回さない]', () => {
    const start = rotationStart({ roomMembers: rotationStart().roomMembers!.slice(0, 3) });
    expect(nextMappingForMatch(start, 2)).toBeNull();
  });
});

describe('抜け番 host の nextMatch 代行 [Phase4 room control]', () => {
  const MAPPING = mappingFor(2, [0, 1, 2, 3], 3); // inactive=0

  function room(hostUserId: string): any {
    return { hostUserId, snapshot: { activeMapping: MAPPING }, members: new Map() };
  }

  it('host が抜け番でも nextMatch は active game seat 0 の代行で通る', () => {
    const resolved = resolveActorSeat(room('host-uid'), 'host-uid', 0, { type: 'nextMatch' });
    expect(resolved.reason).toBeNull();
    expect(resolved.actorSeat).toBe(0);
    expect(resolved.actorRoomSeat).toBe(0); // 監査痕跡は host の room seat
  });

  it('host 以外の抜け番の nextMatch は拒否のまま', () => {
    const resolved = resolveActorSeat(room('host-uid'), 'other-uid', 0, { type: 'nextMatch' });
    expect(resolved.reason).toMatch(/inactive/);
  });

  it('抜け番 host でも game action [discard 等] は拒否される', () => {
    const resolved = resolveActorSeat(room('host-uid'), 'host-uid', 0, { type: 'discard', pai: 'm1' });
    expect(resolved.reason).toMatch(/inactive/);
  });
});
