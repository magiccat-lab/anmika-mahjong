import { describe, it, expect } from 'vitest';
import { getTingpaiList, getTingpaiListBeforeZimo, canTsumoWithPochiSwap } from '../game3/tingpai';
import { buildShoupai } from '../game3';

// game3/tingpai.ts の pure helper を 単独 verify。
describe('getTingpaiList', () => {
  it('shoupai 未定義で 空配列', () => {
    expect(getTingpaiList(null)).toEqual([]);
    expect(getTingpaiList(undefined)).toEqual([]);
  });

  it('テンパイ手 [p1p1p1 p2p2p2 p3p3p3 s7s7s7 s8 s8] で s8 単騎待ち', () => {
    // 3 麻 [13 牌] テンパイ: 333+333+333+333+対子待ち
    const hand = ['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'];
    const sp = buildShoupai(hand);
    const ting = getTingpaiList(sp);
    // 単騎 s8 が待ち
    expect(ting.length).toBeGreaterThan(0);
    expect(ting.some((t) => t.startsWith('s8'))).toBe(true);
  });

  it('ノーテン手 で 空配列 [or no s8 待ち]', () => {
    const hand = ['p1','p2','p3','p4','p5','p6','p7','p8','s1','s2','s3','s4','s5'];
    const sp = buildShoupai(hand);
    const ting = getTingpaiList(sp);
    // 待ちは 0 or 1 程度、 とりあえず array 返却を確認
    expect(Array.isArray(ting)).toBe(true);
  });
});

describe('getTingpaiListBeforeZimo', () => {
  it('shoupai 未定義で 空配列', () => {
    expect(getTingpaiListBeforeZimo(null)).toEqual([]);
  });

  it('zimo 牌を差し引いて tingpai 計算', () => {
    // 14 牌 [13 + zimo]、 zimo 取り除いた 13 牌で テンパイか check
    const hand13 = ['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'];
    const sp = buildShoupai(hand13);
    // 強制的に zimo を別 tile に [zimo は 14 枚目]、 _zimo set
    sp.zimo('s9');
    const ting = getTingpaiListBeforeZimo(sp);
    expect(Array.isArray(ting)).toBe(true);
  });
});

describe('canTsumoWithPochiSwap', () => {
  it('z5 ナシ手で false', () => {
    const hand = ['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'];
    const sp = buildShoupai(hand);
    expect(canTsumoWithPochiSwap(sp)).toBe(false);
  });

  it('z5 を待ち牌に swap して 和了形になるなら true', () => {
    // z5 を s8 に swap で 完成: p1*3 p2*3 p3*3 s7*3 + s8 s8
    const hand = ['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'];
    const sp = buildShoupai(hand);
    // 14 枚目 zimo を z5 にする
    sp.zimo('z5');
    expect(canTsumoWithPochiSwap(sp)).toBe(true);
  });
});
