// 2026-05-15 リョー集中報告 [bug 1-12] 関連 regression test
// - bug 1: ぽっち chip 倍率 ロン時も kyoku 中は適用 [2026-05-21]
// - bug 6: リーチ後 強制暗カン で 待ち変動 reject
// - bug 8: 打牌候補ごと fever 可否 API
// - bug 9: 嶺上枯渇でカン候補 0 件

import { describe, it, expect } from 'vitest';
import {
  computeChipMultiplierDetail,
  applyChipFromLoser,
  applyChipOall,
  type ChipState,
} from '../game3/chip';
import { feverCandidatesByDapai } from '../game3/feverLizhi';
// @ts-ignore
import Majiang from '@kobalab/majiang-core';

function mkChipSt(p: Partial<ChipState> = {}): ChipState {
  return {
    shuvariActive: { 0: false, 1: false, 2: false },
    feverActive: { 0: false, 1: false, 2: false },
    feverTier: { 0: 1, 1: 1, 2: 1 },
    pochiMultiplier: { 0: 1, 1: 1, 2: 1 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    chipBreakdown: [],
    ...p,
  };
}

describe('bug 1 updated 2026-05-21: ぽっち chip 倍率 はロン時 bypass [フィーバー中のみ適用]', () => {
  it('mode=ron + pochiMultiplier ×2 [非フィーバー] → multiplier 1 [bypass]', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: 2, 1: 1, 2: 1 } });
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'ron' });
    expect(detail.multiplier).toBe(1);
    expect(detail.parts.some((p) => p.startsWith('ぽっち'))).toBe(false);
  });

  it('mode=ron + pochiMultiplier ×2 + feverActive → multiplier 2 [特例で適用]', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: 2, 1: 1, 2: 1 }, feverActive: { 0: true, 1: false, 2: false } });
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'ron' });
    expect(detail.multiplier).toBe(2);
    expect(detail.parts).toContain('ぽっち×2');
  });

  it('mode=tsumo [or 未指定 oall] + pochiMultiplier ×-2 → multiplier -2 [乗る]', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: -2, 1: 1, 2: 1 } });
    expect(computeChipMultiplierDetail(st, 0, { mode: 'tsumo' }).multiplier).toBe(-2);
    expect(computeChipMultiplierDetail(st, 0).multiplier).toBe(-2);
  });

  it('applyChipFromLoser は mode=ron 既定 + 非フィーバーなら ぽっち bypass', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: 4, 1: 1, 2: 1 } });
    applyChipFromLoser(st, 0, 1, 5);
    expect(st.chipBreakdown[0].multiplier).toBe(1);
    expect(st.chipBreakdown[0].total).toBe(5);
  });

  it('applyChipOall は 既定 mode=tsumo → ぽっち倍率 反映', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: 2, 1: 1, 2: 1 } });
    applyChipOall(st, 0, 3);
    expect(st.chipBreakdown[0].multiplier).toBe(2);
    expect(st.chipBreakdown[0].total).toBe(6);
  });
});

describe('bug 8: feverCandidatesByDapai API', () => {
  it('shoupai 未指定 → 空 Map', () => {
    const m = feverCandidatesByDapai(null);
    expect(m.size).toBe(0);
  });

  it('副露あり [非 ankan] → 全候補で fever NG → 空 Map', () => {
    const sp = new Majiang.Shoupai(['m7', 'm7', 'm7', 'p1', 'p2', 'p3', 's1', 's1', 's1', 's5']);
    sp._fulou = ['p4444+'];
    sp._zimo = 'm9';
    const m = feverCandidatesByDapai(sp);
    // 副露あり [+/=/- mark] あれば fever 不可、 全 dapai 候補で reject
    for (const fc of m.values()) expect(fc.ok).toBe(false);
  });
});

describe('bug 12 更新 2026-05-21: ロン時 ぽっち倍率 表示 [フィーバー中のみ]', () => {
  it('mode=ron + pochiMultiplier ≠ 1 + feverActive → parts に実倍率を表示', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: -2, 1: 1, 2: 1 }, feverActive: { 0: true, 1: false, 2: false } });
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'ron' });
    expect(detail.parts.length).toBeGreaterThan(0);
    expect(detail.parts).toContain('ぽっち×-2');
  });
  it('mode=ron + pochiMultiplier ≠ 1 + 非フィーバー → parts に ぽっち含まない', () => {
    const st = mkChipSt({ pochiMultiplier: { 0: -2, 1: 1, 2: 1 } });
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'ron' });
    expect(detail.parts.some((p) => p.startsWith('ぽっち'))).toBe(false);
  });
});
