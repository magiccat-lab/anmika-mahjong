// 通報 20261116_0「カンパーワンと冬冬の裁定 ポッチを白と認識しているので、7mで2枚 逆ぽっちや中がヒットしてる」[部屋 I2ZK rev 14]
// 嵌八萬 [m79 待ち] を正ぽっち z5g でロン。ぽっちは m8 として受けたのに、冬冬のチューリップの現物では白 z5 のまま数え、
// めくった 中 z7 [白の隣] と 逆ぽっち z5y [白] に 1 枚ずつ当たって、本来止まる所から 2 枚余計に続いていた。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildG(): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  const hand = ['m7', 'm9', 'p1', 'p2', 'p3', 'p5', 'p6', 'p7', 's4', 's0', 's6', 'z2', 'z2'];
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  // 深い側は [上1, 下1, 上2, 下2, ...]。チューリップは上段だけ開く
  shanAny._pai = ['p7', 'm1', 'm7', 'm1', 's3', 'm1', 'z7', 'm1', 'z5y', 'm1', 's8', 'm1'];
  shanAny._baopai = ['m1', 'm1'];
  shanAny._fubaopai = [];
  g.huapai[0] = ['f4', 'f4'];
  g.lizhi.add(0);
  return g;
}

describe('嵌八萬ロンの正ぽっちは冬冬の現物でも m8 [通報 20261116_0]', () => {
  it('I2ZK の形: 中で止まり、逆ぽっちまでめくらない', () => {
    const g = buildG();
    const result: any = {
      hupai: [{ name: '立直', fanshu: 1 }, { name: '嵌八萬', fanshu: 8 }],
      fanshu: 9,
      _kanpamanPochi: true,
      _ronpaiForChip: 'z5g',
    };
    g.applyChipsOnHule(result, 0, 2);
    expect(g.fuyuRevealState[0]?.fuyuLog).toEqual([
      { pai: 'p7', tier: 'upper', hit: 2 },
      { pai: 'm7', tier: 'upper', hit: 2 },
      { pai: 's3', tier: 'upper', hit: 1 },
      { pai: 'z7', tier: 'upper', hit: 0 },
    ]);
  });
});
