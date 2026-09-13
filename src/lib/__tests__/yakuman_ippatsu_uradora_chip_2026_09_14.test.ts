// 2026-09-14 norosh 監査で発覚: 本役満を和了ると 一発 と 裏ドラ の祝儀が黙って落ちる。
// majiang-core は役満成立時に hupai を役満の entry だけへ差し替えるので、
// huleChip が見ている '一発' / '裏ドラ' の entry が消えるのが原因。
// 赤 5 / 金 5 / 虹 / 抜きドラ は手牌から直接数えているため役満でも残っており、
// 同じ祝儀の中で一発と裏ドラだけが消えるのは筋が通らない。
// 向こうの実装 [norosh1] は役満でも一発・裏ドラの祝儀を払う (牌譜 39 局面で確認)。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

/** 四暗刻 [p111 p222 p333 s11 z11 + s1 ツモ] を作る。裏表示 p1 → 裏ドラ p2 ×3 */
function buildSuanko(): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.shoupai.set(p, buildShoupai(['p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p3', 'p3', 'p3', 's1', 's1', 'z1', 'z1']));
  }
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  (g.shan as any)._pai = [];
  g.shan.setBaopai(['z7'], ['p1']);   // 表は当たらない / 裏 p1 → p2 が 3 枚
  g.diyizimo = false;                 // 配牌直後のままだと天和になってしまう
  return g;
}

describe('本役満でも 一発 と 裏ドラ の祝儀は付く', () => {
  it('リーチ一発ツモの四暗刻で 一発 1 枚と 裏ドラ 3 枚が出る', () => {
    const g = buildSuanko();
    g.lizhi.add(0 as PlayerId);
    g.yifaActive[0 as PlayerId] = true;
    (g.shoupai.get(0 as PlayerId) as any).zimo('s1');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    expect(result.damanguan).toBeGreaterThanOrEqual(1);
    // 翻には出ない [役満は hupai が差し替わる]
    const names = (result.hupai ?? []).map((h: any) => String(h.name));
    expect(names.some((n: string) => n.includes('四暗刻'))).toBe(true);
    expect(names).not.toContain('一発');
    expect(names).not.toContain('裏ドラ');

    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels).toContain('一発');
    expect(labels.some((l) => l.startsWith('裏ドラ ×3'))).toBe(true);
  });

  it('一発が消えていれば一発の祝儀は付かない [裏ドラだけ出る]', () => {
    const g = buildSuanko();
    g.lizhi.add(0 as PlayerId);
    g.yifaActive[0 as PlayerId] = false;   // 副露などで一発が消えた後
    (g.shoupai.get(0 as PlayerId) as any).zimo('s1');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels).not.toContain('一発');
    expect(labels.some((l) => l.startsWith('裏ドラ ×3'))).toBe(true);
  });

  it('役満でない和了は従来どおり [hupai の entry から 1 回だけ払う]', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    for (const p of [0, 1, 2] as PlayerId[]) {
      g.shoupai.set(p, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's2', 'z1', 'z1']));
    }
    const dummy = new Game3();
    dummy.qipai();
    const HeCtor = dummy.he.get(0).constructor as any;
    for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
    (g.shan as any)._pai = [];
    g.shan.setBaopai(['z7'], ['p1']);   // 裏 p1 → p2 は手牌に 1 枚
    g.diyizimo = false;
    g.lizhi.add(0 as PlayerId);
    g.yifaActive[0 as PlayerId] = true;
    (g.shoupai.get(0 as PlayerId) as any).zimo('s3');
    const result = g.hule(0 as PlayerId, null, null);
    expect(result).toBeTruthy();
    expect(result.damanguan ?? 0).toBe(0);
    g.applyChipsOnHule(result, 0 as PlayerId, null);
    const labels = g.chipBreakdown.map((e) => e.label);
    expect(labels.filter((l) => l === '一発')).toHaveLength(1);
    expect(labels.filter((l) => l.startsWith('裏ドラ'))).toHaveLength(1);
  });
});
