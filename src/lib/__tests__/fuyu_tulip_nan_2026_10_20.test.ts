// 通報 20261020_0「冬冬金北 南が西に反応しない」[部屋 K4SM rev 104]
// 冬冬金北の 2 組目 [上段 中 z7 ・ 下段 南 z2] で、手牌の 西 z3 ×2 に当たらず 0 hit で止まった。
// チューリップの風は 東・西・北 だけが互いに隣で、南は「07-20 の裁定に出てこない」ので外していた。
// ルールブックは「現物＋上下牌 [±1]」、10-14 リョー「世の中のルールと同じ」なので、南も風の仲間に入れる。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { tulipNeighbors } from '../game3/tulip';
import type { PlayerId } from '../types';

function buildG(hand: string[], wall: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = wall;
  shanAny._baopai = ['m1', 'm1'];
  shanAny._fubaopai = [];
  g.huapai[0] = ['f4', 'f4'];
  return g;
}

describe('冬冬金北: 南も風のチューリップに入る [通報 20261020_0]', () => {
  it('K4SM の形: 上段 中 ・ 下段 南 の組が 西 ×2 に当たり、次の組へ進む', () => {
    const hand = ['m7', 'm7', 'm7', 'p7', 'p8', 's1', 's2', 's3', 's4', 's5', 's6', 'z3', 'z3'];
    const g = buildG(hand, ['z7', 'z2', 'm2', 'm2', 'm2', 'm2']);
    const r = g.applyFuyuChip(0, null, 2, true);
    expect(r.state.fuyuLog.slice(0, 2)).toEqual([
      { pai: 'z7', tier: 'upper', hit: 0 },
      { pai: 'z2', tier: 'lower', hit: 2 },
    ]);
    expect(r.state.fuyuLog.length).toBe(4);
  });

  it('風は 東・南・西・北 のどれがめくれても残りの 3 つに当たる', () => {
    expect(new Set(tulipNeighbors('z2'))).toEqual(new Set(['z1', 'z3', 'z4']));
    expect(new Set(tulipNeighbors('z1'))).toEqual(new Set(['z2', 'z3', 'z4']));
    expect(new Set(tulipNeighbors('z3'))).toEqual(new Set(['z1', 'z2', 'z4']));
    expect(new Set(tulipNeighbors('z4'))).toEqual(new Set(['z1', 'z2', 'z3']));
  });
});
