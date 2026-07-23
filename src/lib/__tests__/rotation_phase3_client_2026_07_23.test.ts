import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { mappingFor } from '../../../server/rotation';
import { createGameStore } from '../store';
import {
  activeCpuGameSeats,
  hostGameSeat,
  memberAtGameSeat,
} from '../onlineSeats';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-07-23 4人回し Phase3, Sol P1-1/P1-2] client 側 seat 契約の回帰:
// (1) mapping 交換で自席 game seat が変わる時、setOnlineSeat で受信席契約を
//     先に更新すれば新席の _state を hydrate できる [active→active/→inactive/→active]
// (2) onlineMembers [room seat 契約] から盤面表示/CPU/host を mapping 写像で導出する

const MEMBERS_4 = [
  { seat: 0, user_id: 'u0', username: 'あるふぁ', is_cpu: false },
  { seat: 1, user_id: 'u1', username: 'ぶらぼー', is_cpu: false },
  { seat: 2, user_id: 'u2', username: 'ちゃーりー', is_cpu: true },
  { seat: 3, user_id: 'u3', username: 'でるた', is_cpu: false },
];

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

describe('store.setOnlineSeat [Sol P1-1: mapping 交換の atomic seat transition]', () => {
  function onlineStore(mySeat: 0 | 1 | 2 | -1) {
    const store = createGameStore();
    store.initOnlineGame({
      ws: { send() { /* test stub */ } } as unknown as WebSocket,
      qijia: 0,
      mySeat,
      preShuffledPool: pool(),
    } as never);
    return store;
  }

  it('active→active: 旧席のままだと新席 projection は拒否、setOnlineSeat 後は受理', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const store = onlineStore(0);
    const forSeat2 = captureSeatProjection(authority, 2);
    expect(store.hydrateOnlineProjection(forSeat2)).toBe(false); // 受信席契約 0 のまま
    store.setOnlineSeat(2);
    expect(store.hydrateOnlineProjection(forSeat2)).toBe(true);
  });

  it('active→inactive: -1 [観戦投影] へ移行して spectator projection を受理', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const store = onlineStore(1);
    const spectatorProjection = captureSeatProjection(authority, -1);
    expect(store.hydrateOnlineProjection(spectatorProjection)).toBe(false);
    store.setOnlineSeat(-1);
    expect(store.hydrateOnlineProjection(spectatorProjection)).toBe(true);
  });

  it('inactive→active: -1 から実席へ戻って自席 projection を受理', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const store = onlineStore(-1);
    const forSeat0 = captureSeatProjection(authority, 0);
    expect(store.hydrateOnlineProjection(forSeat0)).toBe(false);
    store.setOnlineSeat(0);
    expect(store.hydrateOnlineProjection(forSeat0)).toBe(true);
  });
});

describe('onlineSeats [Sol P1-2: room seat 契約からの盤面導出]', () => {
  it('mapping を一巡させても各 game seat の表示名が gameToRoom 先の member と一致する', () => {
    for (const matchOrdinal of [1, 2, 3, 4]) {
      const mapping = mappingFor(matchOrdinal, [0, 1, 2, 3], 3);
      for (const gameSeat of [0, 1, 2]) {
        const expectedRoomSeat = mapping.gameToRoom[gameSeat];
        const member = memberAtGameSeat(MEMBERS_4, mapping, gameSeat);
        expect(member?.seat).toBe(expectedRoomSeat);
        expect(member?.username).toBe(MEMBERS_4.find((m) => m.seat === expectedRoomSeat)!.username);
      }
    }
  });

  it('mapping 無し [3人部屋] は恒等で従来表示', () => {
    const trio = MEMBERS_4.slice(0, 3);
    expect(memberAtGameSeat(trio, null, 1)?.username).toBe('ぶらぼー');
    expect(activeCpuGameSeats(trio, null)).toEqual([2]);
    expect(hostGameSeat(trio, null, 'u0')).toBe(0);
  });

  it('CPU の game seat は mapping で写像され、抜け番 CPU は含まれない', () => {
    // 試合3: inactive=1, actives は order 並び維持で gameToRoom=[0,2,3] → CPU [room2] は game1
    const m3 = mappingFor(3, [0, 1, 2, 3], 3);
    expect(m3.inactiveRoomSeat).toBe(1);
    expect(m3.gameToRoom).toEqual([0, 2, 3]);
    expect(activeCpuGameSeats(MEMBERS_4, m3)).toEqual([1]);
    // 試合5: inactive=3。CPU room2 は gameToRoom=[0,1,2] の index2 → game2
    const m5 = mappingFor(5, [0, 1, 2, 3], 3);
    expect(m5.inactiveRoomSeat).toBe(3);
    expect(activeCpuGameSeats(MEMBERS_4, m5)).toEqual([2]);
    // CPU 自身が抜け番の試合 [inactive=2] では空
    const m4 = mappingFor(4, [0, 1, 2, 3], 3);
    expect(m4.inactiveRoomSeat).toBe(2);
    expect(activeCpuGameSeats(MEMBERS_4, m4)).toEqual([]);
  });

  it('host が抜け番の試合は hostGameSeat が null [store の host gate は無効化される]', () => {
    const m2 = mappingFor(2, [0, 1, 2, 3], 3); // inactive=0 = host u0
    expect(hostGameSeat(MEMBERS_4, m2, 'u0')).toBeNull();
    const m3 = mappingFor(3, [0, 1, 2, 3], 3); // inactive=1、u0 は gameToRoom=[0,2,3] の index0 → game0
    expect(hostGameSeat(MEMBERS_4, m3, 'u0')).toBe(0);
  });
});
