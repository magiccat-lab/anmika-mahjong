import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-07-23 リョー要望 観戦モード] seat=-1 [席なし] projection:
// - privateHand が無い / 全席 publicHands [伏せ + 公開待ち牌のみ]
// - 金/ぽっち手内情報が全席マスク
// - client は myOnlineSeat=-1 で hydrate でき、全席が伏せ手のまま盤面になる

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

describe('観戦 projection [seat=-1]', () => {
  it('private 情報を一切含まない', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const projection: any = captureSeatProjection(a, -1);
    expect(projection.privateHand).toBeNull();
    for (const seat of [0, 1, 2]) {
      const ph = projection.publicHands[seat];
      expect(ph).toBeTruthy();
      // 配牌直後: 伏せ枚数だけが見え、公開牌 [リーチ公開等] は無い
      expect(ph.concealedCount).toBeGreaterThan(0);
      expect(ph.revealedWaitTiles ?? []).toEqual([]);
    }
    const flat = JSON.stringify(projection.fields ?? {});
    // 金/ぽっち [手内の非公開所持数] が漏れていない [maskedGold/maskedPochi 経路]
    expect(projection.goldHand ?? null).not.toBeTruthy();
  });

  it('client は seat=-1 のまま hydrate でき、全席が伏せ手になる', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 2 });
    const projection: any = captureSeatProjection(a, -1);
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: -1,
      changshu: 2,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] },
        firstZimo: '',
        paishu: projection.shan.paishu,
        baopai: projection.shan.baopai,
        fubaopai: null,
      },
    });
    expect(game.hydrateOnlineProjection(projection)).toBe(true);
    const state: any = get(game);
    for (const seat of [0, 1, 2] as const) {
      const sp = state.game.shoupai.get(seat);
      // 具体牌は 1 枚も知らない [全部 _ = 伏せ]
      const known = ['m', 'p', 's', 'z'].reduce(
        (total, suit) => total + (sp?._bingpai?.[suit] ?? []).reduce((x: number, n: number) => x + (n ?? 0), 0),
        0,
      );
      expect(known).toBe(0);
      expect(sp._bingpai._).toBeGreaterThan(0);
    }
    // changshu も projection.gameConfig から採用される
    expect(state.game.changshu).toBe(2);
  });

  it('別席への projection とは違い、観戦 projection は lastZimo を配らない', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const projection: any = captureSeatProjection(a, -1);
    // 親の第一ツモは非公開 [seat 0 宛なら privateHand.zimo に載る]
    expect(projection.store?.lastZimo ?? null).toBeNull();
  });
});
