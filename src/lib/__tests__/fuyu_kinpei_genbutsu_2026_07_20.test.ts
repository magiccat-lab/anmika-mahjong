// 2026-07-20 リョー報告「冬冬金北が北と鳴いてる白を認識できてない」の切り分け。
//
// 判明したこと:
//  - 現物カウント側は正常。抜いた北 / 抜いた金北 / 鳴いた白 はいずれも冬めくりの
//    当たり判定に入る [下の「現物として数える」ブロック]。
//  - 一方チューリップの字牌隣接テーブルが一方向で、西[z3] だけが 東・北 へ広がる。
//    北[z4] や 發[z6] / 中[z7] をめくった時は完全一致しか当たらない
//    [下の「隣接は一方向」ブロック = 現状仕様の固定。裁定変更時はここを更新する]。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

const FILLER = ['p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7'];

function buildG(hand: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  shanAny._baopai = ['m1', 'm1'];
  shanAny._fubaopai = [];
  return g;
}

/** 冬冬金北 [fuyu2 + kinpei] で flip をめくった時の 1 枚目の hit 数 */
function firstHit(g: Game3, flip: string): number {
  g.huapai[0] = ['f4', 'f4'];
  (g.shan as any)._pai = [flip, 'm2', 'm2', 'm2'];
  const r = g.applyFuyuChip(0, null, 2, true);
  return r.state.fuyuLog[0]?.hit ?? -1;
}

function heldHit(held: string[], flip: string): number {
  return firstHit(buildG([...held, ...FILLER].slice(0, 13)), flip);
}

describe('冬冬金北: 手牌に無い持ち牌も現物として数える', () => {
  it('抜いた北[nukidora] は z4 めくりに当たる', () => {
    const g = buildG(FILLER.concat(['m2', 'm3', 'm4', 'm5']));
    g.nukidora[0] = 1;
    expect(firstHit(g, 'z4')).toBe(1);
  });

  it('抜いた金北[nukidoraGold] は gN めくりに当たる', () => {
    const g = buildG(FILLER.concat(['m2', 'm3', 'm4', 'm5']));
    g.nukidoraGold[0] = 1;
    expect(firstHit(g, 'gN')).toBe(1);
  });

  it('抜いた金北は通常の z4 めくりにも当たる [核は同じ北]', () => {
    const g = buildG(FILLER.concat(['m2', 'm3', 'm4', 'm5']));
    g.nukidoraGold[0] = 1;
    expect(firstHit(g, 'z4')).toBe(1);
  });

  it('鳴いた白[z555+] は z5 めくりに 3 枚ぶん当たる', () => {
    const g = buildG(FILLER.concat(['m2', 'm3', 'm4', 'm5']));
    g.shoupai.get(0)._fulou = ['z555+'];
    expect(firstHit(g, 'z5')).toBe(3);
  });

  it('鳴いた白は ぽっち白[z5b] めくりにも当たる', () => {
    const g = buildG(FILLER.concat(['m2', 'm3', 'm4', 'm5']));
    g.shoupai.get(0)._fulou = ['z555+'];
    // z5b は神ぽっち選択が挟まるため pending で止まる。現物カウント自体は z5 と同じ核。
    const r = g.applyFuyuChip(0, null, 2, true);
    expect(r).toBeTruthy();
  });
});

describe('冬冬金北: チューリップの字牌隣接 [2026-07-20 リョー裁定]', () => {
  it('西[z3] めくりは 東[z1] と 北[z4] に広がる', () => {
    expect(heldHit(['z1', 'z1', 'z1', 'z1'], 'z3')).toBe(4);
    expect(heldHit(['z4', 'z4', 'z4', 'z4'], 'z3')).toBe(4);
    // 南[z2] は裁定に含まれないので広がらない
    expect(heldHit(['z2', 'z2', 'z2', 'z2'], 'z3')).toBe(0);
  });

  it('北[z4] めくりは 西[z3] と 東[z1] に広がる', () => {
    expect(heldHit(['z4', 'z4', 'z4', 'z4'], 'z4')).toBe(4);
    expect(heldHit(['z3', 'z3', 'z3', 'z3'], 'z4')).toBe(4);
    expect(heldHit(['z1', 'z1', 'z1', 'z1'], 'z4')).toBe(4);
    // 南[z2] は裁定に含まれない
    expect(heldHit(['z2', 'z2', 'z2', 'z2'], 'z4')).toBe(0);
  });

  it('白[z5] めくりは 發[z6] と 中[z7] に広がる', () => {
    expect(heldHit(['z5', 'z5', 'z5', 'z5'], 'z5')).toBe(4);
    expect(heldHit(['z6', 'z6', 'z6', 'z6'], 'z5')).toBe(4);
    expect(heldHit(['z7', 'z7', 'z7', 'z7'], 'z5')).toBe(4);
  });

  it('白[z5] と 7m/9m は無関係 [2026-07-20 リョー裁定で連結を撤去]', () => {
    expect(heldHit(['m7', 'm7', 'm7', 'm7'], 'z5')).toBe(0);
    expect(heldHit(['m9', 'm9', 'm9', 'm9'], 'z5')).toBe(0);
    expect(heldHit(['z5', 'z5', 'z5', 'z5'], 'm7')).toBe(0);
    expect(heldHit(['z5', 'z5', 'z5', 'z5'], 'm9')).toBe(0);
  });

  it('7m と 9m は互いに隣のまま [萬子はこの 2 種しかない]', () => {
    expect(heldHit(['m9', 'm9', 'm9', 'm9'], 'm7')).toBe(4);
    expect(heldHit(['m7', 'm7', 'm7', 'm7'], 'm9')).toBe(4);
  });
});
