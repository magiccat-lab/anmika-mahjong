import { describe, expect, it, vi } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-09-02] 8/9 の 6U1V: 東風終了の nextRound 直後、canonical は finished=true で配牌前 [shoupai 空]。
// 旧 server は自席 privateHand=null を配り、client の hydrate が「席ありなのに手牌無し」で拒否 →
// resync → 同じ投影 → 拒否 の無限往復で 3 人とも固まった [結果画面も「次の試合へ」も出ない]。
// server は空手牌を配り、client は finished なら null でも受ける、の両面を固定する。
function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

function finishedAuthority() {
  const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
  const state = authority.canonicalState();
  // 試合終了直後の形: finished を立て、配牌前の空 shoupai にする
  state.game.state.finished = true;
  state.game.shoupai = new Map();
  return authority;
}

describe('finished match projection hydrates on every seat', () => {
  it('server: 席あり投影は shoupai 未生成でも privateHand を空手牌で配る', () => {
    const authority = finishedAuthority();
    for (const seat of [0, 1, 2] as const) {
      const projection = captureSeatProjection(authority, seat) as any;
      expect(projection.gameState.finished).toBe(true);
      expect(projection.privateHand).not.toBeNull();
      expect(projection.privateHand.bingpai._).toBe(0);
      expect(projection.privateHand.bingpai.m).toHaveLength(10);
      expect(projection.privateHand.bingpai.z).toHaveLength(8);
      expect(projection.privateHand.fulou).toEqual([]);
    }
    // 観戦 [席なし] は従来どおり privateHand を持たない
    expect((captureSeatProjection(authority, -1) as any).privateHand).toBeNull();
  });

  it('client: 新 server の空手牌投影を hydrate できる', () => {
    const authority = finishedAuthority();
    for (const seat of [0, 1, 2] as const) {
      const projection = captureSeatProjection(authority, seat);
      const store = createGameStore();
      store.setOnlineSeat(seat);
      expect(store.hydrateOnlineProjection(projection)).toBe(true);
    }
  });

  it('client: 旧 server の privateHand=null も finished のときだけ受け入れる', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const authority = finishedAuthority();
      const projection = captureSeatProjection(authority, 1) as any;
      const legacy = { ...projection, privateHand: null };
      const store = createGameStore();
      store.setOnlineSeat(1);
      expect(store.hydrateOnlineProjection(legacy)).toBe(true);

      // 進行中 [finished=false] で手牌が無いのは壊れた投影なので従来どおり拒否
      const broken = { ...projection, privateHand: null, gameState: { ...projection.gameState, finished: false } };
      const store2 = createGameStore();
      store2.setOnlineSeat(1);
      expect(store2.hydrateOnlineProjection(broken)).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
