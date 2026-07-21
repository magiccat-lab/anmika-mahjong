import { describe, it, expect } from 'vitest';
import { canFeverLizhi, feverWaitInfoFromLiveWall, isFeverWaitExhausted } from '../game3/feverLizhi';
import { buildShoupai } from '../game3';

// shoupai mock: _bingpai[suit][num] と _fulou
function mkSp(bingpai: Record<string, number[]>, fulou: string[] = []): any {
  return { _bingpai: bingpai, _fulou: fulou };
}

describe('canFeverLizhi [m7/p7/s7 暗刻 tier 判定]', () => {
  it('m7 暗刻 1 種 → tier 1', () => {
    const r = canFeverLizhi(mkSp({ m: [0, 0, 0, 0, 0, 0, 0, 3], p: [0], s: [0] }));
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(1);
    expect(r.tiles).toEqual(['m7']);
  });
  it('m7 + p7 暗刻 2 種 → tier 2', () => {
    const r = canFeverLizhi(mkSp({
      m: [0, 0, 0, 0, 0, 0, 0, 3],
      p: [0, 0, 0, 0, 0, 0, 0, 3],
      s: [0],
    }));
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(2);
    expect(r.tiles).toEqual(['m7', 'p7']);
  });
  it('m7 + p7 + s7 暗刻 3 種 → tier 3', () => {
    const r = canFeverLizhi(mkSp({
      m: [0, 0, 0, 0, 0, 0, 0, 3],
      p: [0, 0, 0, 0, 0, 0, 0, 3],
      s: [0, 0, 0, 0, 0, 0, 0, 3],
    }));
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(3);
    expect(r.tiles).toEqual(['m7', 'p7', 's7']);
  });
  it('7 枚目が 2 枚 [刻子未満] は不成立', () => {
    const r = canFeverLizhi(mkSp({ m: [0, 0, 0, 0, 0, 0, 0, 2], p: [0], s: [0] }));
    expect(r.ok).toBe(false);
  });
  it('副露あれば不成立 [面前 only]', () => {
    const r = canFeverLizhi(mkSp({ m: [0, 0, 0, 0, 0, 0, 0, 3], p: [0], s: [0] }, ['m7m7m7=']));
    expect(r.ok).toBe(false);
  });
  it('shoupai が undefined なら不成立', () => {
    expect(canFeverLizhi(undefined).ok).toBe(false);
    expect(canFeverLizhi(null).ok).toBe(false);
  });
});

describe('isFeverWaitExhausted [待ち枯渇 → 1 人テンパイ流局]', () => {
  it('待ち 0 件は true', () => {
    expect(isFeverWaitExhausted([], new Map(), new Map(), [])).toBe(true);
  });
  it('白ぽっちしか残っていない待ちは枯渇扱い', () => {
    expect(isFeverWaitExhausted(['z5'], new Map(), new Map(), [])).toBe(true);
  });
  it('m1 待ち、 全 4 枚どこにも見えてない → not exhausted [remain=4]', () => {
    expect(isFeverWaitExhausted(['m1'], new Map(), new Map(), [])).toBe(false);
  });
  it('m1 待ち、 m1 が 4 枚 他家手牌に見えてる → exhausted', () => {
    const sp = mkSp({ m: [0, 4] });
    const map = new Map<number, any>([[1, sp]]);
    expect(isFeverWaitExhausted(['m1'], map, new Map(), [])).toBe(true);
  });
  it('m1 待ち、 河に 2 + ドラ表に 1 + 他家暗刻 1 = 4 visible → exhausted', () => {
    const he = { _pai: ['m1', 'm1+'] };
    const sp = mkSp({ m: [0, 1] });
    const heMap = new Map<number, any>([[2, he]]);
    const spMap = new Map<number, any>([[1, sp]]);
    expect(isFeverWaitExhausted(['m1'], spMap, heMap, ['m1'])).toBe(true);
  });
  it('m1 / p1 マルチ待ち、 m1 4 visible、 p1 4 visible → exhausted', () => {
    const sp = mkSp({ m: [0, 4], p: [0, 4] });
    const spMap = new Map<number, any>([[1, sp]]);
    expect(isFeverWaitExhausted(['m1', 'p1'], spMap, new Map(), [])).toBe(true);
  });
  it('m1 / p1 マルチ待ち、 m1 4 visible だが p1 0 visible → not exhausted', () => {
    const sp = mkSp({ m: [0, 4], p: [0] });
    const spMap = new Map<number, any>([[1, sp]]);
    expect(isFeverWaitExhausted(['m1', 'p1'], spMap, new Map(), [])).toBe(false);
  });

  it('副露面子 m111 は m1 visible 3 枚として数える', () => {
    const sp = mkSp({ m: [0, 1] }, ['m111+']);
    const spMap = new Map<number, any>([[1, sp]]);
    expect(isFeverWaitExhausted(['m1'], spMap, new Map(), [])).toBe(true);
  });

  it('副露面子 z555 は z5 visible 3 枚として数える', () => {
    const sp = mkSp({ z: [0, 0, 0, 0, 0, 1] }, ['z555-']);
    const spMap = new Map<number, any>([[1, sp]]);
    expect(isFeverWaitExhausted(['z5'], spMap, new Map(), [])).toBe(true);
  });

  it('expanded wait names are normalized before visible-tile counting', () => {
    const p = Array(10).fill(0);
    p[3] = 4;
    const spMap = new Map<number, any>([[1, mkSp({ p })]]);
    expect(isFeverWaitExhausted(['np3'], spMap, new Map(), [])).toBe(true);
  });

  it('旧 m1 待ちと現行の物理 m7 を同じ牌として山残数判定する', () => {
    expect(isFeverWaitExhausted(['m1'], new Map(), new Map(), [], ['m7'])).toBe(false);
    expect(isFeverWaitExhausted(['m1'], new Map(), new Map(), [], ['m9'])).toBe(true);
  });
});

describe('FEVER live-wall wait display', () => {
  it('宣言待ちは固定しつつ、生牌領域だけから残数と赤金虹の現物を表示する', () => {
    expect(feverWaitInfoFromLiveWall(
      ['p5', 'np3', 'z5', 'p5'],
      ['p5', 'p0', 'gp', 'np3', 'p3', 'z5b'],
    )).toEqual([
      { tile: 'p5', remain: 3, hasRed: true, hasGold: true, hasNiji: false },
      { tile: 'p3', remain: 2, hasRed: false, hasGold: false, hasNiji: true },
      { tile: 'z5', remain: 0, hasRed: false, hasGold: false, hasNiji: false },
    ]);
  });

  it('待ち表示でも旧 m1 は物理 m7 に統一する', () => {
    expect(feverWaitInfoFromLiveWall(['m1'], ['m7', 'm9'])).toEqual([
      { tile: 'm7', remain: 1, hasRed: false, hasGold: false, hasNiji: false },
    ]);
  });
});

// [2026-07-21 リョー報告] 7 が 4 枚あっても暗刻が確定しない形はフィーバー不可。
// 677889+77頭 = 678+789 の順子2つに7を2枚振り、残り2枚を頭にできる。
describe('canFeverLizhi 7×4 の確定暗刻判定 [順子振り分け]', () => {
  it('s677889 + s7s7頭 [678+789+77] は7暗刻確定でない → 不可', () => {
    // s7×4 + s6 s8×2 s9 [順子2本に7を2枚+頭77] + m123 + z1z1
    const sp = buildShoupai(['s6', 's7', 's7', 's7', 's7', 's8', 's8', 's9', 'm1', 'm2', 'm3', 'z1', 'z1']);
    expect(canFeverLizhi(sp).ok).toBe(false);
  });

  it('s789789 + s7s7頭 [789+789+77] も7暗刻確定でない → 不可', () => {
    const sp = buildShoupai(['s7', 's7', 's7', 's7', 's8', 's8', 's9', 's9', 'm1', 'm2', 'm3', 'z1', 'z1']);
    expect(canFeverLizhi(sp).ok).toBe(false);
  });

  it('隣接がなく7が全解で暗刻になる形は可', () => {
    // s7×3 [隣接 5/6/8/9 なし] + 独立面子 → 確定暗刻
    const sp = buildShoupai(['s7', 's7', 's7', 'm1', 'm2', 'm3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'z1']);
    expect(canFeverLizhi(sp).ok).toBe(true);
  });
});
