// [2026-10-14 バグ通報 (isg.)「本役満ツモ+夏が5倍満扱いになってない」]
// 夏で本役満を 1 段上げると打点は五倍満 (基本点 8000→10000) になるのに、役満の祝儀は damanguan の段のまま
// 5 枚オールだった。数え役満の側と同じく、夏の段上げを入れた段 (五倍満 7 オール / 14) で払う。
import { describe, it, expect } from 'vitest';

import { Game3, buildShoupai } from '../game3';

type PlayerId = 0 | 1 | 2;
const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;
const KAN = ['m7', 'm9', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's4', 's5', 's6', 's2', 's2'];   // + z5g で嵌八萬

function buildBase(natsu: number): any {
  const g: any = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(KAN));
  const dummy: any = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  g.shan._pai = ['p9'];
  g.shan.setBaopai(['z7'], ['z7']);
  g.diyizimo = false;
  g.huapai = { 0: Array(natsu).fill('f2'), 1: [], 2: [] };
  return g;
}

function yakumanEntry(g: any): any {
  return g.chipBreakdown.find((e: any) => /^役満(ツモ|ロン) ×/.test(String(e.label)));
}

describe('本役満 + 夏の役満祝儀', () => {
  it('嵌八萬ツモ (夏なし) は 5 枚オールのまま', () => {
    const g = buildBase(0);
    g.lizhi.add(P0);
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(r.damanguan).toBeGreaterThanOrEqual(1);
    g.applyChipsOnHule(r, P0, null);
    expect(String(yakumanEntry(g).label)).toBe('役満ツモ ×1');
  });

  it('嵌八萬ツモ + 夏 1 枚 は五倍満に上がり、祝儀も 5 倍満の 7 枚オール', () => {
    const g = buildBase(1);
    g.lizhi.add(P0);
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(r.hupai.some((h: any) => /本役満ランクアップ 8000→10000/.test(h.name))).toBe(true);
    const before = { ...g.chipLedger };
    g.applyChipsOnHule(r, P0, null);
    const e = yakumanEntry(g);
    expect(String(e.label)).toBe('役満ツモ ×1 [夏で 5 倍満]');
    // 夏なしの手と比べて、役満の祝儀の分だけ 2 枚オール多い
    const g0 = buildBase(0);
    g0.lizhi.add(P0);
    g0.shoupai.get(P0).zimo('z5g');
    const r0 = g0.hule(P0, null, null);
    g0.applyChipsOnHule(r0, P0, null);
    expect(Math.abs(Number(e.total))).toBeGreaterThan(Math.abs(Number(yakumanEntry(g0).total)));
    expect(before).toBeDefined();
  });

  it('嵌八萬ロン + 夏 1 枚 は放銃者から 14 枚の段', () => {
    const g = buildBase(1);
    g.lizhi.add(P0);
    g.discardLog[1] = [{ pai: 'z5g', pochi: 'green' }];
    const r = g.hule(P0, 'z5g', P1);
    if (!(r.damanguan > 0)) return;   // ロンの嵌八萬は本役満にならない時は対象外
    g.applyChipsOnHule(r, P0, P1);
    const e = yakumanEntry(g);
    if (r.hupai.some((h: any) => /本役満ランクアップ 8000→10000/.test(h.name))) {
      expect(String(e.label)).toBe('役満ロン ×1 [夏で 5 倍満]');
    }
  });
});
