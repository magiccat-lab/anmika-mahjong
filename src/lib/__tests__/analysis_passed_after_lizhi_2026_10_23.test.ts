// 分析の放銃率: リーチ後に他家が通した牌はリーチ者のフリテンなので現物に数える
// [10-23 先輩「リーチ後に切られた牌を現物安牌として認識されてなくて安全度計算みすってそう」]
import { describe, expect, it } from 'vitest';
import { comboBreakdown, comboDanger, passedTracker } from '../../../tools/lib/combo_danger.mts';

function fakeGame() {
  const he = new Map<number, { _pai: string[] }>([[0, { _pai: [] }], [1, { _pai: [] }], [2, { _pai: [] }]]);
  const shoupai = new Map<number, any>([0, 1, 2].map((p) => [p, { _bingpai: { m: [], p: [], s: [], z: [] }, _fulou: [] }]));
  return { he, shoupai, lizhi: new Set<number>(), shan: { baopai: [] } };
}

describe('リーチ後に通った牌', () => {
  it('リーチの後に他家が切った牌は現物になり、前に切った牌は入らない', () => {
    const g = fakeGame();
    const t = passedTracker();
    const step = (p: number, pai: string, lizhi = false) => {
      t.before(g);
      g.he.get(p)!._pai.push(pai);
      if (lizhi) g.lizhi.add(p);
      t.after(g);
    };
    step(2, 's4');          // リーチ前に 2 が切った s4 は 1 のフリテンにならない
    step(1, 'p9*', true);   // 1 がリーチ
    step(2, 's6');          // リーチ後に通った
    step(0, 'p5');
    expect([...(t.passed.get(1) ?? [])].sort()).toEqual(['p5', 's6']);
    expect(comboBreakdown(g, 0, 's6', t.passed)).toBe('現物');
    expect(comboBreakdown(g, 0, 's6')).not.toBe('現物');
    expect(comboDanger(g, 0, t.passed).get('s6')).toBe(0);
    expect(comboDanger(g, 0, t.passed).get('s4')).toBeGreaterThan(0);
  });

  it('局が替わって河が縮んだら空に戻す', () => {
    const g = fakeGame();
    const t = passedTracker();
    t.before(g); g.he.get(1)!._pai.push('p9*'); g.lizhi.add(1); t.after(g);
    t.before(g); g.he.get(2)!._pai.push('s6'); t.after(g);
    expect(t.passed.get(1)?.has('s6')).toBe(true);
    t.before(g);
    for (const p of [0, 1, 2]) g.he.get(p)!._pai = [];
    g.lizhi.clear();
    t.after(g);
    expect(t.passed.size).toBe(0);
  });
});
