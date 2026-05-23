import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeChipMultiplier,
  applyChipOall,
  applyChipFromLoser,
  type ChipState,
  type PlayerId,
} from '../game3/chip';

function blankState(): ChipState {
  return {
    shuvariActive: { 0: false, 1: false, 2: false },
    feverActive: { 0: false, 1: false, 2: false },
    feverTier: { 0: 1, 1: 1, 2: 1 },
    pochiMultiplier: { 0: 1, 1: 1, 2: 1 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    chipBreakdown: [],
  };
}

describe('computeChipMultiplier [E17 シュバリ×フィーバー×pochi 累積]', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('default は ×1', () => {
    expect(computeChipMultiplier(st, 0)).toBe(1);
  });
  it('シュバリ単体 = ×2', () => {
    st.shuvariActive[0] = true;
    expect(computeChipMultiplier(st, 0)).toBe(2);
  });
  it('フィーバー tier 1/2/3 = ×1/×2/×4', () => {
    st.feverActive[0] = true;
    st.feverTier[0] = 1;
    expect(computeChipMultiplier(st, 0)).toBe(1);
    st.feverTier[0] = 2;
    expect(computeChipMultiplier(st, 0)).toBe(2);
    st.feverTier[0] = 3;
    expect(computeChipMultiplier(st, 0)).toBe(4);
  });
  it('シュバリ + フィーバー tier3 = ×2 × ×4 = ×8', () => {
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    expect(computeChipMultiplier(st, 0)).toBe(8);
  });
  it('pochiMultiplier 単体 = そのまま乗算', () => {
    st.pochiMultiplier[0] = 3;
    expect(computeChipMultiplier(st, 0)).toBe(3);
  });
  it('全乗算: シュバ×2 + フィバ tier3 ×4 + pochi ×3 = ×24', () => {
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    st.pochiMultiplier[0] = 3;
    expect(computeChipMultiplier(st, 0)).toBe(24);
  });
  it('bypass* で個別 skip', () => {
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 2;
    st.pochiMultiplier[0] = 3;
    expect(computeChipMultiplier(st, 0, { bypassShuvari: true })).toBe(6);   // 2 * 3
    expect(computeChipMultiplier(st, 0, { bypassFever: true })).toBe(6);     // 2 * 3
    expect(computeChipMultiplier(st, 0, { bypassPochi: true })).toBe(4);     // 2 * 2
    expect(
      computeChipMultiplier(st, 0, { bypassShuvari: true, bypassFever: true, bypassPochi: true })
    ).toBe(1);
  });
});

describe('applyChipOall [E16 流し役満 +5 オール 等]', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('+5 オール: target +10、 他家 -5 ずつ', () => {
    applyChipOall(st, 0, 5, { label: '流し役満' });
    expect(st.chipLedger).toEqual({ 0: 10, 1: -5, 2: -5 });
  });
  it('シュバ active で ×2 倍 [+5 → +10 オール]', () => {
    st.shuvariActive[0] = true;
    applyChipOall(st, 0, 5);
    expect(st.chipLedger).toEqual({ 0: 20, 1: -10, 2: -10 });
  });
  it('breakdown 履歴に oall mode 1 件追加', () => {
    applyChipOall(st, 0, 5, { label: '流し役満' });
    expect(st.chipBreakdown).toHaveLength(1);
    expect(st.chipBreakdown[0]).toMatchObject({ label: '流し役満', base: 5, mode: 'oall' });
  });
  it('bypass 系で 流し役満は倍率非適用 [流し役満は bypassShuvari/Fever/Pochi 想定]', () => {
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    applyChipOall(st, 0, 5, { bypassShuvari: true, bypassFever: true, bypassPochi: true });
    expect(st.chipLedger).toEqual({ 0: 10, 1: -5, 2: -5 });
  });
});

describe('applyChipFromLoser [ロン chip / 北抜き等]', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('winner +N / loser -N', () => {
    applyChipFromLoser(st, 0, 1, 3, { label: '北抜き' });
    expect(st.chipLedger).toEqual({ 0: 3, 1: -3, 2: 0 });
  });
  it('シュバ ×2 で 1→2 chip', () => {
    st.shuvariActive[0] = true;
    applyChipFromLoser(st, 0, 1, 1);
    expect(st.chipLedger).toEqual({ 0: 2, 1: -2, 2: 0 });
  });
  it('E18 北抜き 連続: chip 累計が正しく加算', () => {
    // 5 回北抜き (loser=放銃者の代わりに 仮に player1 から +1 ずつ)
    for (let i = 0; i < 5; i++) applyChipFromLoser(st, 0, 1, 1, { label: `北抜き ${i + 1}` });
    expect(st.chipLedger[0]).toBe(5);
    expect(st.chipLedger[1]).toBe(-5);
    expect(st.chipBreakdown).toHaveLength(5);
  });
});
