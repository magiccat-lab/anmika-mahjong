// 2026-09-14 リョー裁定 1「はらう」: 本役満でも 13 翻超過の祝儀を払う。
// majiang-core は役満が出ると通常役を捨てるので母数が 0 になっていた。
// norosh1 の牌譜 20260708043900-y4o0kk [四暗刻単騎ツモ 18 翻] で向こう 10 枚、うち 0 枚。
// 裁定 2「つける」: 裏ドラ表示の西で増える北ドラにも裏ドラの祝儀を付ける。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildBase(hand: string[], baopai: string[], fubaopai: string[] | null): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  (g.shan as any)._pai = [];
  g.shan.setBaopai(baopai, fubaopai);
  g.diyizimo = false;   // 配牌直後のままだと天和になる
  return g;
}

describe('本役満の 13 翻超過祝儀 [裁定 1]', () => {
  it('四暗刻ツモで通常役が 13 翻を超えたら超過分の祝儀が出る', () => {
    // p111 p222 p333 s11 z11 + s1 ツモ = 四暗刻。立直 + 一発 + ツモ + 対々和 + 三暗刻。
    // 裏 p1 → p2 が 3 枚、裏 p2 → p3 が 3 枚、裏 s9 → s1 が 3 枚 [裏ドラ 9]
    const g = buildBase(
      ['p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p3', 'p3', 'p3', 's1', 's1', 'z1', 'z1'],
      ['z7'], ['p1', 'p2', 's9'],
    );
    g.lizhi.add(0 as PlayerId);
    g.yifaActive[0 as PlayerId] = true;
    (g.shoupai.get(0 as PlayerId) as any).zimo('s1');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    expect(result.damanguan).toBeGreaterThanOrEqual(1);
    // 通常役の母数が載っている [立直1 一発1 ツモ1 対々2 三暗2 + 裏9 = 16]
    expect((result as any)._excessHanBase).toBeGreaterThan(13);
    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels.some((l) => l.includes('13翻超過'))).toBe(true);
  });

  it('通常役が 13 翻に届かない役満では超過祝儀は出ない', () => {
    const g = buildBase(
      ['p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p3', 'p3', 'p3', 's1', 's1', 'z1', 'z1'],
      ['z7'], ['z6'],   // 裏は当たらない
    );
    g.lizhi.add(0 as PlayerId);
    (g.shoupai.get(0 as PlayerId) as any).zimo('s1');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    expect(result.damanguan).toBeGreaterThanOrEqual(1);
    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels.some((l) => l.includes('13翻超過'))).toBe(false);
  });
});

describe('裏表示の西で増える北ドラの祝儀 [裁定 2]', () => {
  it('裏に西が出ていれば 抜き北の枚数分だけ裏ドラの祝儀が増える', () => {
    // 一気通貫の手。裏表示 z3 [西] → 北ドラ。北を 2 枚抜いている
    const g = buildBase(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's2', 'z1', 'z1'],
      ['z7'], ['z3'],
    );
    g.lizhi.add(0 as PlayerId);
    g.nukidora[0 as PlayerId] = 2;
    (g.shoupai.get(0 as PlayerId) as any).zimo('s3');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    const names = (result.hupai ?? []).map((h: any) => String(h.name));
    expect(names.some((n: string) => n.startsWith('北ドラ'))).toBe(true);
    expect((result as any)._chipUradoraFromNuki).toBe(2);
    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels.some((l) => l.startsWith('裏ドラ ×2'))).toBe(true);
  });

  it('表示が表だけなら裏ドラの祝儀は増えない', () => {
    const g = buildBase(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's2', 'z1', 'z1'],
      ['z3'], ['z6'],
    );
    g.lizhi.add(0 as PlayerId);
    g.nukidora[0 as PlayerId] = 2;
    (g.shoupai.get(0 as PlayerId) as any).zimo('s3');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    expect((result as any)._chipUradoraFromNuki ?? 0).toBe(0);
    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels.some((l) => l.startsWith('裏ドラ'))).toBe(false);
  });
});
