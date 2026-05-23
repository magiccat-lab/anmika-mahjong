import { describe, it, expect } from 'vitest';
import { buildStateFromPaifu } from '../store/paifuIo';

describe('buildStateFromPaifu [牌譜 v2 復元]', () => {
  it('type 不一致で null', () => {
    expect(buildStateFromPaifu({ type: 'random', version: 2 })).toBeNull();
  });

  it('version 1 以下で null [v2 以降 限定]', () => {
    expect(buildStateFromPaifu({ type: 'anmika-mahjong-paifu', version: 1 })).toBeNull();
    expect(buildStateFromPaifu({ type: 'anmika-mahjong-paifu' })).toBeNull(); // 未指定 = 1 扱い
  });

  it('最小 v2 paifu で StoreState を復元 [message に timestamp 含む]', () => {
    const paifu = {
      type: 'anmika-mahjong-paifu',
      version: 2,
      timestamp: 'TS-TEST',
      shan: { currentPai: [], initialPai: [], baopai: [], fubaopai: [], rinshanUsed: 0 },
      state: { qijia: 0, lunban: 0, jushu: 0, changbang: 0, benbang: 0, defen: { 0: 35000, 1: 35000, 2: 35000 }, lizhibang: 0, finished: false },
      shoupai: null,
      he: null,
    };
    const s = buildStateFromPaifu(paifu);
    expect(s).not.toBeNull();
    expect(s!.message).toMatch(/牌譜 v2 復元完了/);
    expect(s!.message).toContain('TS-TEST');
    expect(s!.roundEnded).toBe(false);
    expect(s!.pendingFuyu).toBeNull();
  });

  it('nukidoraGold migration: paifu に nukidoraGold ナシ + goldHand.z 余剰 で 振替', () => {
    // 旧 v2 paifu: goldHand.z=1 (gN 残ってる扱い) + bingpai.z[4]=0 + nukidora[0]=1
    // → migration で 1 件 nukidora → nukidoraGold へ振替
    const paifu = {
      type: 'anmika-mahjong-paifu',
      version: 2,
      timestamp: 'T',
      shan: { currentPai: [], initialPai: [], baopai: [], fubaopai: [], rinshanUsed: 0 },
      state: { qijia: 0, lunban: 0, jushu: 0, changbang: 0, benbang: 0, defen: { 0: 35000, 1: 35000, 2: 35000 }, lizhibang: 0, finished: false },
      shoupai: {
        0: { bingpai: { _: 13, m: [0,0,0,0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0,0,0,0], s: [0,0,0,0,0,0,0,0,0,0], z: [0,0,0,0,0,0,0,0] }, fulou: [], zimo: null },
      },
      he: null,
      goldHand: { 0: { p: 0, s: 0, z: 1 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } },
      nukidora: { 0: 1, 1: 0, 2: 0 },
      // nukidoraGold ナシ で migration trigger
    };
    const s = buildStateFromPaifu(paifu);
    expect(s).not.toBeNull();
    expect(s!.game.nukidora[0]).toBe(0);
    expect(s!.game.nukidoraGold[0]).toBe(1);
    expect(s!.game.goldHand[0].z).toBe(0);
  });

  it('2026-05-15 fix: shoupai._zimo がある状態で reload すると lastZimo が復元される [stuck 防止]', () => {
    // リョー報告: リーチ player のツモ済 state を reload すると ツモ button も autoLizhi も
    // 発火せず 進行不能 になる。 fix: currentPlayer の _zimo を lastZimo に復元
    const paifu = {
      type: 'anmika-mahjong-paifu',
      version: 2,
      timestamp: 'T',
      shan: { currentPai: [], initialPai: [], baopai: [], fubaopai: [], rinshanUsed: 0 },
      state: { qijia: 0, lunban: 0, jushu: 0, changbang: 0, benbang: 0, defen: { 0: 35000, 1: 35000, 2: 35000 }, lizhibang: 0, finished: false },
      shoupai: {
        0: { bingpai: { _: 0, m: [0,0,0,0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0,0,0,0], s: [0,2,1,1,2,1,2,2,1,1], z: [0,0,0,0,0,1,0,0] }, fulou: [], zimo: 'z5' },
        1: { bingpai: { _: 0, m: [0,0,0,0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0,0,0,0], s: [0,0,0,0,0,0,0,0,0,0], z: [0,0,0,0,0,0,0,0] }, fulou: [], zimo: null },
        2: { bingpai: { _: 0, m: [0,0,0,0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0,0,0,0], s: [0,0,0,0,0,0,0,0,0,0], z: [0,0,0,0,0,0,0,0] }, fulou: [], zimo: null },
      },
      he: null,
      lizhi: [0],
    };
    const s = buildStateFromPaifu(paifu);
    expect(s).not.toBeNull();
    expect(s!.lastZimo).toBe('z5');
  });

  it('shoupai._zimo が null なら lastZimo は null のまま [打牌直後 state]', () => {
    const paifu = {
      type: 'anmika-mahjong-paifu',
      version: 2,
      timestamp: 'T',
      shan: { currentPai: [], initialPai: [], baopai: [], fubaopai: [], rinshanUsed: 0 },
      state: { qijia: 0, lunban: 0, jushu: 0, changbang: 0, benbang: 0, defen: { 0: 35000, 1: 35000, 2: 35000 }, lizhibang: 0, finished: false },
      shoupai: {
        0: { bingpai: { _: 13, m: [0,0,0,0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0,0,0,0], s: [0,0,0,0,0,0,0,0,0,0], z: [0,0,0,0,0,0,0,0] }, fulou: [], zimo: null },
      },
      he: null,
    };
    const s = buildStateFromPaifu(paifu);
    expect(s).not.toBeNull();
    expect(s!.lastZimo).toBeNull();
  });

  it('nukidoraGold migration: 既に nukidoraGold ある paifu は触らない', () => {
    const paifu = {
      type: 'anmika-mahjong-paifu',
      version: 2,
      timestamp: 'T',
      shan: { currentPai: [], initialPai: [], baopai: [], fubaopai: [], rinshanUsed: 0 },
      state: { qijia: 0, lunban: 0, jushu: 0, changbang: 0, benbang: 0, defen: { 0: 35000, 1: 35000, 2: 35000 }, lizhibang: 0, finished: false },
      shoupai: null,
      he: null,
      goldHand: { 0: { p: 0, s: 0, z: 1 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } },
      nukidora: { 0: 1, 1: 0, 2: 0 },
      nukidoraGold: { 0: 0, 1: 0, 2: 0 }, // 明示 0
    };
    const s = buildStateFromPaifu(paifu);
    expect(s).not.toBeNull();
    // migration skip、 nukidora そのまま
    expect(s!.game.nukidora[0]).toBe(1);
    expect(s!.game.nukidoraGold[0]).toBe(0);
    expect(s!.game.goldHand[0].z).toBe(1);
  });
});
