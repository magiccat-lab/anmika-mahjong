// 2026-05-15 audit: 祝儀倍率 全 path 精査 [リョー指示]
// 2026-05-21 改訂: 「通常 ron は ぽっち倍率 bypass、 ただし target が フィーバー中なら適用」
// 仕様に合わせて 全 assertion 更新。 旧 「ron でも ぽっち適用」 は誤りだった。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeChipMultiplier,
  computeChipMultiplierDetail,
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

describe('audit: ぽっち倍率 mode 依存 [2026-05-21 改訂]', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('緑ぽっち ×1 はツモ・ロンとも変化なし', () => {
    st.pochiMultiplier[0] = 1;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo' })).toBe(1);
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(1);
  });

  it('青ぽっち ×2: ツモ時 ×2 / ロン時 ×1 [非フィーバー bypass]', () => {
    st.pochiMultiplier[0] = 2;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo' })).toBe(2);
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(1);
  });

  it('黄ぽっち ×-1: ツモ時 -1 / ロン時 ×1 [非フィーバー bypass]', () => {
    st.pochiMultiplier[0] = -1;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo' })).toBe(-1);
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(1);
  });

  it('赤ぽっち ×-2: ツモ時 -2 / ロン時 ×1 [非フィーバー bypass]', () => {
    st.pochiMultiplier[0] = -2;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo' })).toBe(-2);
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(1);
  });

  it('青ぽっち ×2 + フィーバー active: ロン時も ×2 [フィーバー特例]', () => {
    st.pochiMultiplier[0] = 2;
    st.feverActive[0] = true;
    // tier 1 → fever 倍率 1 のまま、 ぽっち ×2 が ロン時も乗る
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(2);
  });

  it('赤ぽっち ×-2 + フィーバー active: ロン時も -2 [フィーバー特例]', () => {
    st.pochiMultiplier[0] = -2;
    st.feverActive[0] = true;
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(-2);
  });

  it('mode 未指定は legacy [tsumo 扱い、 ぽっち適用]', () => {
    st.pochiMultiplier[0] = -2;
    expect(computeChipMultiplier(st, 0)).toBe(-2);
  });
});

describe('audit: シュバ × フィー × ぽっち 重ね適用 [sign / 順序]', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('赤×-2 + シュバ + フィー tier3 ツモ: -2 × 2 × 4 = -16', () => {
    st.pochiMultiplier[0] = -2;
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo' })).toBe(-16);
  });

  it('赤×-2 + シュバ + フィー tier3 ロン: フィーバー中なので ぽっち適用 -16', () => {
    st.pochiMultiplier[0] = -2;
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(-16);
  });

  it('黄×-1 + シュバ ツモ: -1 × 2 = -2', () => {
    st.pochiMultiplier[0] = -1;
    st.shuvariActive[0] = true;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo' })).toBe(-2);
  });

  it('黄×-1 + シュバ ロン [非フィーバー]: ぽっち bypass、 シュバのみ ×2', () => {
    st.pochiMultiplier[0] = -1;
    st.shuvariActive[0] = true;
    expect(computeChipMultiplier(st, 0, { mode: 'ron' })).toBe(2);
  });
});

describe('audit: applyChipFromLoser default は ron 扱い、 非フィーバーで ぽっち bypass', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('赤ぽっち active applyChipFromLoser default ron → ぽっち bypass', () => {
    st.pochiMultiplier[0] = -2;
    applyChipFromLoser(st, 0, 1, 5, { label: 'test' });
    // ぽっち bypass、 倍率 1、 base 5 → +5 / -5
    expect(st.chipLedger[0]).toBe(5);
    expect(st.chipLedger[1]).toBe(-5);
  });

  it('シュバ active なら applyChipFromLoser でも ×2 [非フィーバーでも シュバは適用]', () => {
    st.pochiMultiplier[0] = -2;
    st.shuvariActive[0] = true;
    applyChipFromLoser(st, 0, 1, 5);
    // ぽっち bypass、 シュバ ×2、 base 5 → +10 / -10
    expect(st.chipLedger[0]).toBe(10);
    expect(st.chipLedger[1]).toBe(-10);
  });

  it('opts.mode=tsumo 明示なら ぽっち倍率 適用 [トビ賞ツモ等]', () => {
    st.pochiMultiplier[0] = -2;
    applyChipFromLoser(st, 0, 1, 5, { mode: 'tsumo' } as any);
    expect(st.chipLedger[0]).toBe(-10);
    expect(st.chipLedger[1]).toBe(10);
  });

  it('フィーバー中なら applyChipFromLoser default ron でも ぽっち適用', () => {
    st.pochiMultiplier[0] = -2;
    st.feverActive[0] = true;
    applyChipFromLoser(st, 0, 1, 5);
    // ぽっち ×-2 + フィー tier1 (1) = -2、 base 5 → -10 / +10
    expect(st.chipLedger[0]).toBe(-10);
    expect(st.chipLedger[1]).toBe(10);
  });
});

describe('audit: applyChipOall mode 未指定はデフォルト tsumo', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('赤ぽっち + applyChipOall mode 未指定 → ぽっち適用 [-2、 tsumo default]', () => {
    st.pochiMultiplier[0] = -2;
    applyChipOall(st, 0, 1);
    expect(st.chipLedger[0]).toBe(-4);
    expect(st.chipLedger[1]).toBe(2);
    expect(st.chipLedger[2]).toBe(2);
  });

  it('赤ぽっち + applyChipOall mode=ron [非フィーバー] → ぽっち bypass、 base 1', () => {
    st.pochiMultiplier[0] = -2;
    applyChipOall(st, 0, 1, { mode: 'ron' });
    // ぽっち bypass、 倍率 1、 base 1 → 自分 +2、 他家 -1 ずつ
    expect(st.chipLedger[0]).toBe(2);
    expect(st.chipLedger[1]).toBe(-1);
    expect(st.chipLedger[2]).toBe(-1);
  });
});

describe('audit: bypass* と mode の独立性', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('mode=ron でも bypassShuvari は別軸 [シュバ off / ぽっち bypass 非フィーバー]', () => {
    st.pochiMultiplier[0] = 2;
    st.shuvariActive[0] = true;
    // ron + 非フィーバーで pochi bypass、 bypassShuvari で シュバ off → 1
    expect(computeChipMultiplier(st, 0, { mode: 'ron', bypassShuvari: true })).toBe(1);
  });

  it('mode=tsumo + bypassPochi → ぽっち off [tsumo でも明示 skip]', () => {
    st.pochiMultiplier[0] = 2;
    expect(computeChipMultiplier(st, 0, { mode: 'tsumo', bypassPochi: true })).toBe(1);
  });

  it('mode=ron + bypassPochi: 二重指定でも 1 [副作用なし]', () => {
    st.pochiMultiplier[0] = -2;
    expect(computeChipMultiplier(st, 0, { mode: 'ron', bypassPochi: true })).toBe(1);
  });
});

describe('audit: breakdown.multiplierParts に mode 情報を反映', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('青ぽっちロン時 [非フィーバー] parts に 「ぽっち」 含まない', () => {
    st.pochiMultiplier[0] = 2;
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'ron' });
    expect(detail.multiplier).toBe(1);
    expect(detail.parts.some((p) => p.startsWith('ぽっち'))).toBe(false);
  });

  it('青ぽっちロン時 [フィーバー中] parts に 「ぽっち×2」', () => {
    st.pochiMultiplier[0] = 2;
    st.feverActive[0] = true;
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'ron' });
    expect(detail.multiplier).toBe(2);
    expect(detail.parts.some((p) => p === 'ぽっち×2')).toBe(true);
  });

  it('青ぽっちツモ時 parts に 「ぽっち×2」', () => {
    st.pochiMultiplier[0] = 2;
    const detail = computeChipMultiplierDetail(st, 0, { mode: 'tsumo' });
    expect(detail.multiplier).toBe(2);
    expect(detail.parts.some((p) => p === 'ぽっち×2')).toBe(true);
  });
});

describe('audit: 鳴き 冬 chip ×0.5 + tier3 fever × shuvari', () => {
  let st: ChipState;
  beforeEach(() => { st = blankState(); });

  it('副露ありで 冬 1 hit、 シュバ + フィー tier3 ツモ → 8 chip oall', () => {
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    applyChipOall(st, 0, 1);
    expect(st.chipLedger[0]).toBe(16);
    expect(st.chipLedger[1]).toBe(-8);
  });

  it('門前で 冬 1 hit、 シュバ + フィー tier3 ロン → 16 chip from loser [フィーバー中で ぽっち も適用、 ただし pochi=1 なので 影響なし]', () => {
    st.shuvariActive[0] = true;
    st.feverActive[0] = true;
    st.feverTier[0] = 3;
    applyChipFromLoser(st, 0, 1, 2);
    expect(st.chipLedger[0]).toBe(16);
    expect(st.chipLedger[1]).toBe(-16);
  });
});
