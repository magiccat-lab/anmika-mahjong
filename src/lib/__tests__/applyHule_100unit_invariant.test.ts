// applyHule 全 path で defen delta が 100 倍数であることを enforcement 確認
// リョー指示 2026-05-15: 「8000 以下打点 100 の位 必ず切り上げ」
// 各 fanshu × fu × isOya × isRon × isPochiReverse × benbang の 組合せで 100 単位確認
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

function freshGame(): Game3 {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  g.zimo();
  return g;
}

function defenSnapshot(g: Game3): Record<PlayerId, number> {
  return { 0: g.state.defen[0], 1: g.state.defen[1], 2: g.state.defen[2] };
}

function expectAll100(before: Record<PlayerId, number>, after: Record<PlayerId, number>) {
  for (const p of [0, 1, 2] as PlayerId[]) {
    const delta = after[p] - before[p];
    // -0 / +0 区別回避で Math.abs % 100
    expect(Math.abs(delta) % 100, `player ${p} delta=${delta} 100 単位 違反`).toBe(0);
  }
}

function expectZeroSum(before: Record<PlayerId, number>, after: Record<PlayerId, number>) {
  let sum = 0;
  for (const p of [0, 1, 2] as PlayerId[]) sum += after[p] - before[p];
  expect(sum, `ゼロサム違反 sum=${sum}`).toBe(0);
}

describe('applyHule 100 単位 invariant', () => {
  // 子ロン全 fanshu × fu 組合せ
  const fanshuList = [1, 2, 3, 4, 5, 6, 7, 8, 11, 13];
  const fuList = [20, 25, 30, 40, 50, 60, 70];

  for (const fanshu of fanshuList) {
    for (const fu of fuList) {
      it(`子ロン fanshu=${fanshu} fu=${fu} → 100 単位 + ゼロサム`, () => {
        const g = freshGame();
        const before = defenSnapshot(g);
        const winner: PlayerId = 1;
        const loser: PlayerId = 2;
        g.applyHule({ fanshu, fu, hupai: [] }, winner, loser);
        const after = defenSnapshot(g);
        expectAll100(before, after);
        expectZeroSum(before, after);
      });
    }
  }

  for (const fanshu of fanshuList) {
    for (const fu of fuList) {
      it(`親ロン fanshu=${fanshu} fu=${fu} → 100 単位 + ゼロサム`, () => {
        const g = freshGame();
        const before = defenSnapshot(g);
        const winner: PlayerId = 0; // qijia=0 で 親
        const loser: PlayerId = 1;
        g.applyHule({ fanshu, fu, hupai: [] }, winner, loser);
        const after = defenSnapshot(g);
        expectAll100(before, after);
        expectZeroSum(before, after);
      });
    }
  }

  for (const fanshu of fanshuList) {
    for (const fu of fuList) {
      it(`子ツモ fanshu=${fanshu} fu=${fu} → 100 単位 + ゼロサム`, () => {
        const g = freshGame();
        const before = defenSnapshot(g);
        const winner: PlayerId = 1;
        g.applyHule({ fanshu, fu, hupai: [] }, winner, null);
        const after = defenSnapshot(g);
        expectAll100(before, after);
        expectZeroSum(before, after);
      });
    }
  }

  for (const fanshu of fanshuList) {
    for (const fu of fuList) {
      it(`親ツモ fanshu=${fanshu} fu=${fu} → 100 単位 + ゼロサム`, () => {
        const g = freshGame();
        const before = defenSnapshot(g);
        const winner: PlayerId = 0; // 親
        g.applyHule({ fanshu, fu, hupai: [] }, winner, null);
        const after = defenSnapshot(g);
        expectAll100(before, after);
        expectZeroSum(before, after);
      });
    }
  }

  // 本場込み
  const benbangList = [0, 1, 3, 8];
  for (const benbang of benbangList) {
    it(`子ロン 30符 2翻 + 本場 ${benbang} → 100 単位 + ゼロサム`, () => {
      const g = freshGame();
      g.state.benbang = benbang;
      const before = defenSnapshot(g);
      g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1, 2);
      const after = defenSnapshot(g);
      expectAll100(before, after);
      expectZeroSum(before, after);
    });

    it(`子ツモ 40符 2翻 + 本場 ${benbang} → 100 単位 + ゼロサム`, () => {
      const g = freshGame();
      g.state.benbang = benbang;
      const before = defenSnapshot(g);
      g.applyHule({ fanshu: 2, fu: 40, hupai: [] }, 1, null);
      const after = defenSnapshot(g);
      expectAll100(before, after);
      expectZeroSum(before, after);
    });
  }

  // フィーバー tier
  for (const tier of [1, 2, 3] as const) {
    it(`子ロン 40符 4翻 + フィーバー tier${tier} → 100 単位 + ゼロサム`, () => {
      const g = freshGame();
      g.feverActive = { 0: false, 1: true, 2: false };
      g.feverTier = { 0: 1, 1: tier, 2: 1 };
      const before = defenSnapshot(g);
      g.applyHule({ fanshu: 4, fu: 40, hupai: [] }, 1, 2);
      const after = defenSnapshot(g);
      expectAll100(before, after);
      expectZeroSum(before, after);
    });
  }

  // 逆ぽっち [pochiPaymentMode reverse]
  it('逆ぽっち 子ロン 30符 3翻 → 100 単位 + ゼロサム', () => {
    const g = freshGame();
    (g as any).pochiPaymentMode = { 0: false, 1: true, 2: false };
    const before = defenSnapshot(g);
    g.applyHule({ fanshu: 3, fu: 30, hupai: [] }, 1, 2);
    const after = defenSnapshot(g);
    expectAll100(before, after);
    expectZeroSum(before, after);
  });
});
