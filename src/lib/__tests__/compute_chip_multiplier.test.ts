import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// Game3 instance method computeChipMultiplier wrap を unit 固定。
// helper [chip.test.ts] でカバー済、 ここは class 経由 path 担保 + memory 由来 spec の verify。
describe('Game3 computeChipMultiplier', () => {
  it('default で ×1', () => {
    const g = new Game3();
    g.qipai();
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(1);
  });

  it('シュバ active で ×2', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(2);
  });

  it('フィーバー tier 1/2/3 で 1/2/4 倍', () => {
    const g = new Game3();
    g.qipai();
    g.feverActive[0] = true;
    g.feverTier[0] = 1;
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(1);
    g.feverTier[0] = 2;
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(2);
    g.feverTier[0] = 3;
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(4);
  });

  it('シュバ + フィーバー tier3 で ×8', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.feverActive[0] = true;
    g.feverTier[0] = 3;
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(8);
  });

  it('pochiMultiplier ×-2 [赤ぽっち] で 倍率に乗る', () => {
    const g = new Game3();
    g.qipai();
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(-2);
  });

  it('bypassShuvari でシュバ非適用', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    expect(g.computeChipMultiplier(0 as PlayerId, { bypassShuvari: true })).toBe(1);
  });

  it('bypassFever でフィーバー非適用', () => {
    const g = new Game3();
    g.qipai();
    g.feverActive[0] = true;
    g.feverTier[0] = 3;
    expect(g.computeChipMultiplier(0 as PlayerId, { bypassFever: true })).toBe(1);
  });

  it('bypassPochi でぽっち倍率非適用', () => {
    const g = new Game3();
    g.qipai();
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    expect(g.computeChipMultiplier(0 as PlayerId, { bypassPochi: true })).toBe(1);
  });

  it('全 bypass で ×1 [シュバ + フィバ + ぽっち 全 skip]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.feverActive[0] = true;
    g.feverTier[0] = 3;
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    expect(g.computeChipMultiplier(0 as PlayerId, { bypassShuvari: true, bypassFever: true, bypassPochi: true })).toBe(1);
  });
});
