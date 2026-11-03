// [2026-11-03 通報 20261103_0] 「つもきんうーそーなのに表示があかうーそーつも」
// 部屋 PYOL rev 1815 で金5索 [gs] をツモって和了 → 和了画面のツモ牌が赤5索 [s0] で出た。
// 和了画面は sp._zimo [core 名] を出していた。物理牌名 _anmikaZimo を先に見る
import { describe, it, expect } from 'vitest';
import { agariZimoPai, buildShoupai } from '../helpers';

const hand13 = ['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's3', 's4', 'z1', 'z1', 'z1', 'z2', 'z2'];

describe('agariZimoPai', () => {
  it('金5索をツモったら gs [赤5索 s0 にしない]', () => {
    const sp = buildShoupai(hand13);
    sp.zimo('gs');
    expect(sp._zimo).toBe('s0');
    expect(agariZimoPai(sp)).toBe('gs');
  });
  it('金5筒 ・ 金北 ・ 虹 ・ 色付きの白も物理牌名', () => {
    for (const pai of ['gp', 'gN', 'ns3', 'z5r']) {
      const sp = buildShoupai(hand13);
      sp.zimo(pai);
      expect(agariZimoPai(sp)).toBe(pai);
    }
  });
  it('普通の赤5索 ・ 普通の牌はそのまま', () => {
    for (const pai of ['s0', 's5', 'm7']) {
      const sp = buildShoupai(hand13);
      sp.zimo(pai);
      expect(agariZimoPai(sp)).toBe(pai);
    }
  });
  it('ツモが無ければ null', () => {
    expect(agariZimoPai(buildShoupai(hand13))).toBeNull();
    expect(agariZimoPai(null)).toBeNull();
  });
});
