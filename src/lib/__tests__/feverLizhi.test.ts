import { describe, it, expect } from 'vitest';
import { canFeverLizhi, isFeverWaitExhausted } from '../game3/feverLizhi';

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
});
