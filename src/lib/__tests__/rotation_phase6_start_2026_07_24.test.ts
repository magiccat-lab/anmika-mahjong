import { describe, expect, it } from 'vitest';
import { activeTrioForStart, mappingFor } from '../../../server/rotation';

// [2026-07-24 4人回し Phase6] rotation 部屋の start 構築:
// start.members は active trio を game seat 契約で持つ [設計 §2、seat3 を混ぜない]。

const ROOM_MEMBERS = [
  { seat: 0, user_id: 'u0', username: 'host', is_cpu: false },
  { seat: 1, user_id: 'u1', username: 'friend', is_cpu: false },
  { seat: 2, user_id: 'CPU_X_2', username: 'CPU2', is_cpu: true },
  { seat: 3, user_id: 'CPU_X_3', username: 'CPU3', is_cpu: true },
];

describe('activeTrioForStart', () => {
  it('試合1 [4人目が抜け番] は room 0/1/2 が game 0/1/2 に恒等で座る', () => {
    const trio = activeTrioForStart(ROOM_MEMBERS, mappingFor(1, [0, 1, 2, 3]));
    expect(trio.map((m) => [m.seat, m.user_id])).toEqual([
      [0, 'u0'], [1, 'u1'], [2, 'CPU_X_2'],
    ]);
  });

  it('試合2 [room0 が抜け番] は room 1/2/3 が game 0/1/2 に座り、seat は game seat で刻印される', () => {
    const trio = activeTrioForStart(ROOM_MEMBERS, mappingFor(2, [0, 1, 2, 3]));
    expect(trio.map((m) => [m.seat, m.user_id])).toEqual([
      [0, 'u1'], [1, 'CPU_X_2'], [2, 'CPU_X_3'],
    ]);
    // 全 entry の seat が 0-2 [room seat 3 が漏れない]
    for (const m of trio) expect(m.seat).toBeLessThanOrEqual(2);
  });

  it('member 欠落 [壊れた roster] は黙って詰めずに throw する', () => {
    expect(() => activeTrioForStart(ROOM_MEMBERS.slice(0, 3), mappingFor(2, [0, 1, 2, 3])))
      .toThrow(/no member at room seat 3/);
  });
});
