// 2026-07-21 裁定9 / D-13: 冬チューリップの隣接集合を単一 helper に統一し、
// 実精算 [huleChip.checkHit] と自動高目 estimator [estimateFuyuChipForSwap] を
// 同じ集合で計算させる。旧 estimator は m7m9↔z5 連結・z4/z5 欠落で高目がズレていた。
import { describe, it, expect } from 'vitest';
import { tulipNeighbors } from '../game3/tulip';

describe('tulipNeighbors [チューリップ隣接、リョー裁定 2026-07-20]', () => {
  it('萬子は m7↔m9 のみ [白 z5 は連結しない = 旧仕様の撤去]', () => {
    expect(tulipNeighbors('m7')).toEqual(['m9']);
    expect(tulipNeighbors('m9')).toEqual(['m7']);
  });

  it('白 z5 → 發 z6・中 z7', () => {
    expect(new Set(tulipNeighbors('z5'))).toEqual(new Set(['z6', 'z7']));
  });

  it('北 z4 → 西 z3・東 z1 [旧 estimator は欠落していた]', () => {
    expect(new Set(tulipNeighbors('z4'))).toEqual(new Set(['z3', 'z1']));
  });

  it('西 z3 → 東 z1・北 z4', () => {
    expect(new Set(tulipNeighbors('z3'))).toEqual(new Set(['z1', 'z4']));
  });

  it('發 z6・中 z7 など他の字牌は隣接なし', () => {
    expect(tulipNeighbors('z6')).toEqual([]);
    expect(tulipNeighbors('z7')).toEqual([]);
    expect(tulipNeighbors('z1')).toEqual([]);
    expect(tulipNeighbors('z2')).toEqual([]);
  });

  it('数牌は ±1、端は循環 [1↔9]', () => {
    expect(new Set(tulipNeighbors('p5'))).toEqual(new Set(['p4', 'p6']));
    expect(new Set(tulipNeighbors('p1'))).toEqual(new Set(['p9', 'p2']));
    expect(new Set(tulipNeighbors('s9'))).toEqual(new Set(['s8', 's1']));
    expect(new Set(tulipNeighbors('p0'))).toEqual(new Set(['p4', 'p6'])); // 0 は 5 正規化
  });
});
