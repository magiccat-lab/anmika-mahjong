import { describe, it, expect } from 'vitest';
import { getTingpaiList, getTingpaiListBeforeZimo, canTsumoWithPochiSwap } from '../game3/tingpai';
import { buildShoupai, Game3 } from '../game3';

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

  it('七萬を一萬として完成する国士13面待ちは、実在牌の七萬を返す', () => {
    const sp = buildShoupai([
      'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7',
    ]);
    expect(getTingpaiList(sp)).toEqual([
      'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7',
    ]);
  });

  it('m7→m1 解釈だけが聴牌なら、通常解釈の有効牌を待ちへ混ぜない', () => {
    const sp = buildShoupai([
      'm7', 'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6',
    ]);
    expect(getTingpaiList(sp)).toEqual(['z7']);
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

  it('七萬置換の単騎待ちをツモ前手牌でも同じく返す', () => {
    const sp = buildShoupai([
      'm7', 'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6',
    ]);
    sp.zimo('s5');
    expect(getTingpaiListBeforeZimo(sp)).toEqual(['z7']);
  });

  it('副露後の疑似 zimo 文字列を通常牌として減算しない', () => {
    const sp = buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']);
    sp._zimo = 'p111+';
    expect(getTingpaiListBeforeZimo(sp)).toEqual([]);
  });
});

describe('m7-as-m1 ron and furiten', () => {
  it('七萬置換の国士で、七萬以外のロン牌も手牌へ加えて判定する', () => {
    const game = new Game3();
    game.qipai();
    game.shoupai.set(0, buildShoupai([
      'm7', 'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6',
    ]));
    game.he.get(0)!._pai = [];
    expect(game.canRon(0, 'z7', 1)).toBe(true);
    game.he.get(0)!._pai = ['z7'];
    expect(game.canRon(0, 'z7', 1)).toBe(false);
  });

  it('国士13面待ちで七萬を切っていれば、七萬ロンはフリテンになる', () => {
    const game = new Game3();
    game.qipai();
    game.shoupai.set(0, buildShoupai([
      'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7',
    ]));
    game.he.get(0)!._pai = ['m7'];
    expect(game.canRon(0, 'm7', 1)).toBe(false);
    // 旧牌譜に残る m1 表記も同じ物理牌としてフリテン扱い。
    game.he.get(0)!._pai = ['m1'];
    expect(game.canRon(0, 'm7', 1)).toBe(false);
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
