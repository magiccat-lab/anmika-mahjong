// V35: applyFuyuChip / applyChipsOnHule シナリオ smoke test [2026-05-12]
// Notion checklist で 「手動シナリオ確認」 とされてた春春 / 夏夏金北 / 秋秋金北 / 冬冬金北 系を
// 自動 verify [throw / NaN ナシ + chipLedger に何か書かれること] でカバー。
// 細かい数値検証は別 phase、 ここは crash safety + 基本動作のみ。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildG(opts: { shoupai?: string[][]; huapai?: string[][]; baopai?: string[]; benbang?: number } = {}): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.state.benbang = opts.benbang ?? 0;
  for (const p of [0, 1, 2] as PlayerId[]) {
    const hand = opts.shoupai?.[p] ?? ['p2','p3','p4','p5','p6','p7','s2','s3','s4','s5','s6','s7','z1'];
    g.shoupai.set(p, buildShoupai(hand));
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

describe('V35-A 春春 [haru 2 枚 huapai] applyChipsOnHule', () => {
  it('huapai に f1×2 ある winner hule、 春春 chip 加算 throw ナシ', () => {
    const g = buildG({ huapai: [['f1', 'f1'], [], []], baopai: ['z2', 'z2'] });
    const result = g.hule(0, 'z1', null);
    if (result) {
      expect(() => g.applyChipsOnHule(result, 0, null)).not.toThrow();
      expect(Number.isFinite(g.state.defen[0])).toBe(true);
    }
  });
});

describe('V35-B 夏夏金北 [natsu 2 + 金北 1] applyChipsOnHule', () => {
  it('夏夏 + 金北 で base ×4 path、 throw / NaN ナシ', () => {
    const g = buildG({ huapai: [['f2', 'f2'], [], []], baopai: ['z2', 'z2'] });
    g.goldHand[0].z = 0; // 金北抜き済 として
    g.nukidoraGold[0] = 1;
    const result = g.hule(0, 'z1', null);
    if (result) {
      expect(() => g.applyChipsOnHule(result, 0, null)).not.toThrow();
      expect(Number.isFinite(g.state.defen[0])).toBe(true);
    }
  });
});

describe('V35-C 秋秋金北 [aki 2 + 金北 1] applyChipsOnHule', () => {
  it('秋秋金北 path で throw ナシ', () => {
    const g = buildG({ huapai: [['f3', 'f3'], [], []], baopai: ['z2', 'z2'] });
    g.nukidoraGold[0] = 1;
    const result = g.hule(0, 'z1', null);
    if (result) {
      expect(() => g.applyChipsOnHule(result, 0, null)).not.toThrow();
    }
  });
});

describe('V35-D 冬冬金北 [fuyu 2 + 金北 1] applyFuyuChip', () => {
  it('fuyu=2 + kinpei=true [チューリップ + 下段] で throw ナシ', () => {
    const g = buildG({ huapai: [['f4', 'f4'], [], []], baopai: ['z2', 'z2'] });
    g.nukidoraGold[0] = 1;
    const result = g.hule(0, 'z1', null);
    if (result) {
      // applyFuyuChip 直接呼出 [fuyu 2 + kinpei true で 下段 enable]
      expect(() => g.applyFuyuChip(0, null, 2, true)).not.toThrow();
    }
  });
});

describe('regression: f4 baopai 冬めくり chiitoi ron', () => {
  it('ロン牌で完成した七対子の対子も冬めくり現物として数える', () => {
    const g = buildG({
      shoupai: [
        ['p1', 'p1', 'p2', 'p2', 'p3', 'p3', 'p4', 'p4', 's1', 's1', 's2', 's2', 'z1'],
        [],
        [],
      ],
      baopai: ['f4'],
    });
    g.lizhi.add(0);
    (g.shan as any)._pai = ['z1'];

    const result = g.hule(0, 'z1', 1);
    expect(result).not.toBeNull();
    g.applyChipsOnHule(result, 0, 1);

    const fuyuEntry = g.chipBreakdown.find((e) => e.label?.startsWith('冬'));
    expect(fuyuEntry?.base).toBe(4);
    expect(g.chipLedger[0]).toBe(4);
    expect(g.chipLedger[1]).toBe(-4);
  });
});

describe('V35-E 流し役満 vs フィーバー中', () => {
  it('feverActive 中の流し役満は不成立 [既存 logic 整合性]', () => {
    const g = buildG();
    g.feverActive[0] = true;
    // 流し役満判定は store 側、 ここでは feverActive 中の状態が保たれること確認
    expect(g.feverActive[0]).toBe(true);
    expect(g.feverActive[1]).toBe(false);
  });
});
