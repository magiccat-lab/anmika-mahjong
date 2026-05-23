import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// Game3 instance method 経由の chip 加算 wrap が正しく helper を呼ぶか verify。
// helper 層は chip.test.ts でカバー済、 ここは class 経由 path 担保。
describe('Game3 applyChipOall', () => {
  it('オール chip: target +2N、 他家 -N', () => {
    const g = new Game3();
    g.qipai();
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    g.applyChipOall(0 as PlayerId, 3, { label: 'test' });
    expect(g.chipLedger[0]).toBe(6);
    expect(g.chipLedger[1]).toBe(-3);
    expect(g.chipLedger[2]).toBe(-3);
  });

  it('シュバ active で ×2 倍適用', () => {
    const g = new Game3();
    g.qipai();
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    g.shuvariActive[0] = true;
    g.applyChipOall(0 as PlayerId, 2, { label: 'shuvari test' });
    expect(g.chipLedger[0]).toBe(8); // 2 * 2 * 2 = 8
  });

  it('bypassShuvari=true でシュバ active でも 倍率なし', () => {
    const g = new Game3();
    g.qipai();
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    g.shuvariActive[0] = true;
    g.applyChipOall(0 as PlayerId, 2, { bypassShuvari: true, label: 'bypass test' });
    expect(g.chipLedger[0]).toBe(4); // 2 * 2 = 4 [シュバ skip]
  });

  it('breakdown に履歴記録', () => {
    const g = new Game3();
    g.qipai();
    g.chipBreakdown = [];
    g.applyChipOall(0 as PlayerId, 1, { label: 'b test' });
    expect(g.chipBreakdown.length).toBe(1);
    expect(g.chipBreakdown[0].mode).toBe('oall');
    expect(g.chipBreakdown[0].label).toBe('b test');
  });
});

describe('Game3 applyChipFromLoser', () => {
  it('ロン chip: winner +N、 loser -N、 他家変化なし', () => {
    const g = new Game3();
    g.qipai();
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    g.applyChipFromLoser(0 as PlayerId, 1 as PlayerId, 5);
    expect(g.chipLedger[0]).toBe(5);
    expect(g.chipLedger[1]).toBe(-5);
    expect(g.chipLedger[2]).toBe(0);
  });

  it('シュバ active winner で ×2', () => {
    const g = new Game3();
    g.qipai();
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    g.shuvariActive[0] = true;
    g.applyChipFromLoser(0 as PlayerId, 1 as PlayerId, 2);
    expect(g.chipLedger[0]).toBe(4);
    expect(g.chipLedger[1]).toBe(-4);
  });

  it('breakdown に ron mode 記録', () => {
    const g = new Game3();
    g.qipai();
    g.chipBreakdown = [];
    g.applyChipFromLoser(0 as PlayerId, 1 as PlayerId, 1, { label: 'ron test' });
    expect(g.chipBreakdown.length).toBe(1);
    expect(g.chipBreakdown[0].mode).toBe('ron');
  });
});
