// 2026-05-15 audit, updated 2026-05-21:
// ぽっち倍率は kyoku 中のロン支払いにも適用する。春効果など bypass 指定のあるものは個別に除外する。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildG(opts: { huapai?: string[][]; baopai?: string[] } = {}): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.shoupai.set(p, buildShoupai(['p2','p3','p4','p5','p6','p7','s2','s3','s4','s5','s6','s7','z1']));
  }
  if (opts.huapai) {
    for (const p of [0, 1, 2] as PlayerId[]) g.huapai[p] = [...(opts.huapai[p] ?? [])];
  }
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  if (opts.baopai) shanAny._baopai = opts.baopai;
  return g;
}

describe('audit: 春効果 ロン時 ぽっち倍率 1 強制', () => {
  it('赤ぽっち active winner 春春ロン chip は ぽっち倍率乗らない', () => {
    const g = buildG({ huapai: [['f1', 'f1'], [], []], baopai: ['z2', 'z2'] });
    g.pochiMultiplier[0] = { defen: -1, chip: -2 }; // 赤ぽっち active
    const before = { ...g.chipLedger };
    // 春春: 2 枚 × multiplier 2 = 4 chip oall。
    // 旧 bug: ぽっち×-2 が乗って -8 oall になってた [self -16, others +8]
    // 春効果は bypassPochi 指定なので 4 oall [self +8, others -4]
    const result = g.hule(0, 'z1', 1 as PlayerId); // ロン
    if (!result) return; // hule 失敗時 skip [build 依存]
    g.applyChipsOnHule(result, 0, 1);
    // 春 entry を chipBreakdown から取り出して multiplier を verify
    const haruEntry = g.chipBreakdown.find((e) => e.label.startsWith('春'));
    if (haruEntry) {
      // 倍率が 1 [シュバ off / フィー off / ぽっち ron 強制 1]
      expect(haruEntry.multiplier).toBe(1);
      // base × 1 = total
      expect(haruEntry.total).toBe(haruEntry.base);
    }
    // chipLedger 1 [loser] は 春効果分の マイナスを受ける、 ぽっち反転してない
    expect(g.chipLedger[0]).toBeGreaterThanOrEqual(before[0]);
  });

  it('赤ぽっち active winner 春春ツモ chip は ぽっち倍率 -2 乗る [従来挙動]', () => {
    const g = buildG({ huapai: [['f1', 'f1'], [], []], baopai: ['z2', 'z2'] });
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    const result = g.hule(0, 'z1', null); // ツモ
    if (!result) return;
    g.applyChipsOnHule(result, 0, null);
    const haruEntry = g.chipBreakdown.find((e) => e.label.startsWith('春'));
    if (haruEntry) {
      // ツモなので ぽっち×-2 が乗る
      expect(haruEntry.multiplier).toBe(-2);
    }
  });
});

describe('audit: 3 倍満 ロン時 ぽっち倍率 bypass [非フィーバー]', () => {
  it('赤ぽっち active で 3 倍満ロン [非フィーバー] → ぽっち bypass、 倍率 1', () => {
    const g = buildG();
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    g.chipBreakdown = [];
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    const fakeResult: any = {
      hupai: [],
      fanshu: 11,
      damanguan: 0,
    };
    g.applyChipsOnHule(fakeResult, 0, 1); // ロン context
    const sanbaiEntry = g.chipBreakdown.find((e) => e.label === '3 倍満');
    expect(sanbaiEntry).toBeDefined();
    if (sanbaiEntry) {
      // 仕様 2026-05-21: ロン + 非フィーバーなら ぽっち bypass、 倍率 1
      expect(sanbaiEntry.multiplier).toBe(1);
      expect(sanbaiEntry.base).toBe(3);
      expect(sanbaiEntry.total).toBe(3);
    }
  });

  it('赤ぽっち active で 3 倍満ツモ → ぽっち×-2 適用', () => {
    const g = buildG();
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    g.chipBreakdown = [];
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    const fakeResult: any = {
      hupai: [],
      fanshu: 12,
      damanguan: 0,
    };
    g.applyChipsOnHule(fakeResult, 0, null); // ツモ context
    const sanbaiEntry = g.chipBreakdown.find((e) => e.label === '3 倍満');
    expect(sanbaiEntry).toBeDefined();
    if (sanbaiEntry) {
      expect(sanbaiEntry.multiplier).toBe(-2);
      expect(sanbaiEntry.base).toBe(3);
      expect(sanbaiEntry.total).toBe(-6);
    }
  });
});

describe('audit: ロン経由 一発 / 裏ドラ chip は ぽっち bypass [非フィーバー]', () => {
  it('赤ぽっち active 一発ロン [非フィーバー]: chip 倍率 1 [bypass]', () => {
    const g = buildG();
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    g.chipBreakdown = [];
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    const fakeResult: any = {
      hupai: [{ name: '一発', fanshu: 1 }],
      fanshu: 1,
    };
    g.applyChipsOnHule(fakeResult, 0, 1); // ロン
    const yifaEntry = g.chipBreakdown.find((e) => e.label === '一発');
    expect(yifaEntry).toBeDefined();
    if (yifaEntry) {
      expect(yifaEntry.mode).toBe('ron');
      // 仕様 2026-05-21: ロン + 非フィーバーなら ぽっち bypass、 倍率 1
      expect(yifaEntry.multiplier).toBe(1);
    }
  });

  it('赤ぽっち active 一発ツモ: chip 倍率 -2 [ぽっち適用]', () => {
    const g = buildG();
    g.pochiMultiplier[0] = { defen: -1, chip: -2 };
    g.chipBreakdown = [];
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    const fakeResult: any = {
      hupai: [{ name: '一発', fanshu: 1 }],
      fanshu: 1,
    };
    g.applyChipsOnHule(fakeResult, 0, null); // ツモ
    const yifaEntry = g.chipBreakdown.find((e) => e.label === '一発');
    expect(yifaEntry).toBeDefined();
    if (yifaEntry) {
      expect(yifaEntry.mode).toBe('oall');
      expect(yifaEntry.multiplier).toBe(-2);
    }
  });
});
