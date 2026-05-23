import { describe, it, expect } from 'vitest';
import { canFeverLizhi } from '../game3/feverLizhi';
import { computeChipMultiplierDetail, applyChipOall, type ChipState } from '../game3/chip';

// 2026-05-15 リョー報告 4 件 [bug A/B/C + 機能 D] regression
// A: サイコロ chance 描画 / skip → svelte UI 直接 test 不能、 store 操作のみ touch [手動 e2e]
// B: s7 暗刻 4 枚保持 [ankan 宣言なし] でも fever OK [ツモ牌 種類 無関係]
// C: lastDapai / awaitingRonDecision 中の ツモ button 抑制 → svelte UI gate、 store 経路は変更なし
// D: 倍率内訳 [シュバ / フィーバー / ぽっち] を chipBreakdown.multiplierParts に格納

function mkSp(bingpai: Record<string, number[]>, fulou: string[] = []): any {
  return { _bingpai: bingpai, _fulou: fulou };
}

function mkChipSt(over: Partial<ChipState> = {}): ChipState {
  return {
    shuvariActive: { 0: false, 1: false, 2: false },
    feverActive: { 0: false, 1: false, 2: false },
    feverTier: { 0: 1, 1: 1, 2: 1 },
    pochiMultiplier: { 0: 1, 1: 1, 2: 1 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    chipBreakdown: [],
    ...over,
  };
}

describe('bug B: s7 が 手牌 4 枚 ある時点で fever OK [ankan 宣言なくても]', () => {
  it('ケース: 手牌 s7×4 + s4 + s5 + s6 [567 余地あり] でも 4 枚あれば順子 1 消費後 残 3 枚で 確定刻子', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [0],
        // s[4]=1, s[5]=1, s[6]=1, s[7]=4
        s: [0, 0, 0, 0, 1, 1, 1, 4],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('s7');
  });

  it('ケース 2: 手牌 m7×4 のみ → ok', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0, 0, 0, 0, 0, 0, 0, 4],
        p: [0],
        s: [0],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('m7');
  });

  it('regression 維持: 7×3 のみ + 567 余地 → fever 不可 [4 枚 fix で over-permissive にならない]', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [0, 0, 0, 0, 0, 1, 1, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe('機能 D: 倍率内訳 multiplierParts', () => {
  it('シュバ + フィーバー tier3 + ぽっち×2 → parts: [シュバ×2, フィーバー tier3×4, ぽっち×2]', () => {
    const st = mkChipSt({
      shuvariActive: { 0: true, 1: false, 2: false },
      feverActive: { 0: true, 1: false, 2: false },
      feverTier: { 0: 3, 1: 1, 2: 1 },
      pochiMultiplier: { 0: 2, 1: 1, 2: 1 },
    });
    const detail = computeChipMultiplierDetail(st, 0);
    expect(detail.multiplier).toBe(2 * 4 * 2);
    expect(detail.parts).toEqual(['シュバ×2', 'フィーバー tier3×4', 'ぽっち×2']);
  });

  it('素点 [全 modifier OFF] → multiplier 1, parts 空', () => {
    const st = mkChipSt();
    const detail = computeChipMultiplierDetail(st, 0);
    expect(detail.multiplier).toBe(1);
    expect(detail.parts).toEqual([]);
  });

  it('applyChipOall が breakdown.multiplierParts に内訳を格納する', () => {
    const st = mkChipSt({
      shuvariActive: { 0: true, 1: false, 2: false },
      feverActive: { 0: true, 1: false, 2: false },
      feverTier: { 0: 2, 1: 1, 2: 1 },
    });
    applyChipOall(st, 0, 4, { label: '金 5' });
    expect(st.chipBreakdown).toHaveLength(1);
    expect(st.chipBreakdown[0].multiplier).toBe(4);
    expect(st.chipBreakdown[0].multiplierParts).toEqual(['シュバ×2', 'フィーバー tier2×2']);
    expect(st.chipBreakdown[0].total).toBe(16);
  });
});
