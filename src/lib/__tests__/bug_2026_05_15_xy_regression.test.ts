// Regression: ユーザー報告 [2026-05-15] bug X/Y
//   X: 倍率 8 [シュバなだけのはず ×2] — 倍率積 breakdown 可視化、 通常 path で ×8 になる組合せ
//      [シュバ ×2 × フィーバー tier3 ×4、 シュバ ×2 × ぽっち連鎖 ×4 等] が 仕様通り であることを test で固定
//   Y: 点数移動 100 点代 [+10,100] — 夏夏金北 path で result.fenpei [4麻] を ×3 加算してた bug、
//      applyHule 反映済 delta [3麻実点] を ×3 加算 に修正、 100 単位 ズレ が出ない こと確認
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import { computeChipMultiplier } from '../game3/chip';
import type { PlayerId } from '../game3/chip';

describe('bug X: chip 倍率 ×8 経路の仕様確認 [シュバ単独では ×2 のみ]', () => {
  it('シュバ単独 → 倍率 ×2 [user 期待値]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    expect(computeChipMultiplier(
      {
        shuvariActive: g.shuvariActive,
        feverActive: g.feverActive,
        feverTier: g.feverTier,
        pochiMultiplier: g.pochiMultiplier,
        chipLedger: g.chipLedger,
        chipBreakdown: g.chipBreakdown,
      },
      0
    )).toBe(2);
  });

  it('シュバ + フィーバー tier3 → ×8 [仕様通り]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.feverActive[0] = true;
    g.feverTier[0] = 3;
    expect(computeChipMultiplier(
      {
        shuvariActive: g.shuvariActive,
        feverActive: g.feverActive,
        feverTier: g.feverTier,
        pochiMultiplier: g.pochiMultiplier,
        chipLedger: g.chipLedger,
        chipBreakdown: g.chipBreakdown,
      },
      0
    )).toBe(8);
  });

  it('シュバ + ぽっち pochiMultiplier=4 [青ぽっち累積] → ×8 [仕様通り]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.pochiMultiplier[0] = { defen: 1, chip: 4 };
    expect(computeChipMultiplier(
      {
        shuvariActive: g.shuvariActive,
        feverActive: g.feverActive,
        feverTier: g.feverTier,
        pochiMultiplier: g.pochiMultiplier,
        chipLedger: g.chipLedger,
        chipBreakdown: g.chipBreakdown,
      },
      0
    )).toBe(8);
  });

  it('シュバなし、 feverActive=false、 pochiMultiplier=1 → ×1 [完全 base]', () => {
    const g = new Game3();
    g.qipai();
    expect(computeChipMultiplier(
      {
        shuvariActive: g.shuvariActive,
        feverActive: g.feverActive,
        feverTier: g.feverTier,
        pochiMultiplier: g.pochiMultiplier,
        chipLedger: g.chipLedger,
        chipBreakdown: g.chipBreakdown,
      },
      0
    )).toBe(1);
  });
});

describe('bug Y: 夏夏金北 ×4 path で state.defen に 100 単位 ズレ が混入しない', () => {
  it('applyChipsOnHule 直接呼出: 4麻 fenpei 由来の 100 単位 残差が state.defen に 加算されない', () => {
    // 直接 huleChip helper を 呼び、 result.fenpei に 4麻計算で 中途半端な 100 単位値 を渡しても、
    // 修正後 logic は applyHule で動いた realDelta [beforeDefen との 差分、 3麻計算 = 1000 倍数] を ×3 加算する
    const g = new Game3();
    g.qipai();
    // 状況再現: f2 (夏) を winner に 2 枚、 kinpeiTarget=natsu、 hand に z4 [金北]
    const winner: PlayerId = 0;
    g.huapai[winner] = ['f2', 'f2'];
    g.kinpeiTarget[winner] = 'natsu';
    g.goldHand[winner].z = 1;
    // 仮の result: fenpei は 中途半端な 100 単位値 [4麻 majiang-core 由来 simulate]
    const result: any = {
      hupai: [],
      fenpei: [5200, -2600, -2600, 0], // 中途半端な 100 単位 [旧 bug: ×3 で state.defen に 加算 → ズレ発生]
      defen: 5200,
      defen3: 5200,
      fanshu: 5,
    };
    // applyHule 反映済 と 仮定: state.defen = before + [+10000, -5000, -5000] [3麻 1000 倍数]
    const beforeDefen: Record<PlayerId, number> = { 0: 35000, 1: 35000, 2: 35000 };
    g.state.defen = { 0: 45000, 1: 30000, 2: 30000 };
    // applyChipsOnHule に beforeDefen 渡す
    g.applyChipsOnHule(result, winner, null, beforeDefen);
    // ×4 化 後の state.defen は all 1000 倍数 のはず [中途半端な 100 単位なし]
    for (const p of [0, 1, 2] as PlayerId[]) {
      expect(g.state.defen[p] % 1000).toBe(0);
    }
    // sum 不変 [chip は別 ledger なので state.defen sum は ±0 維持]
    const sumAfter = g.state.defen[0] + g.state.defen[1] + g.state.defen[2];
    const sumBefore = 35000 * 3;
    expect(sumAfter).toBe(sumBefore);
  });

  it('夏夏金北 path 不発時 [kinpeiTarget≠natsu] は state.defen 触らない', () => {
    const g = new Game3();
    g.qipai();
    const winner: PlayerId = 0;
    g.huapai[winner] = ['f2', 'f2']; // 夏 2 枚あるが kinpei は natsu じゃない
    g.kinpeiTarget[winner] = null;
    g.goldHand[winner].z = 0; // 金北なし
    const result: any = {
      hupai: [],
      fenpei: [5200, -2600, -2600, 0],
      defen: 5200,
      defen3: 5200,
      fanshu: 5,
    };
    const beforeDefen: Record<PlayerId, number> = { 0: 35000, 1: 35000, 2: 35000 };
    g.state.defen = { 0: 45000, 1: 30000, 2: 30000 };
    const snapshotDefen = { ...g.state.defen };
    g.applyChipsOnHule(result, winner, null, beforeDefen);
    // 夏夏金北 path 不発 → state.defen 不変
    expect(g.state.defen[0]).toBe(snapshotDefen[0]);
    expect(g.state.defen[1]).toBe(snapshotDefen[1]);
    expect(g.state.defen[2]).toBe(snapshotDefen[2]);
  });
});
