import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { addAnmikaPai } from '../helpers';
import type { PlayerId } from '../types';

// 2026-10-31 通報 20261031_0 [R7YQ rev 1401]: 配牌の金北を持ったまま通常北をツモり、
// 北抜きボタン [meta なし] を押すと通常北が先に抜けて金北が 2 枚目に回っていた。
// 「金が来たから先に抜いて」。meta なしは金北から、牌の直押し [meta.gold 明示] は押した北。

function armGoldInHandNormalZimo(): { g: Game3; player: PlayerId } {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  const player = 0 as PlayerId;
  const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's7', 's8', 's9', 'z4']);
  addAnmikaPai(sp, 'gN', 1);
  g.goldHand[player].z += 1; // 手の北 1 枚は金北
  sp.zimo('z4'); // ツモは通常北
  g.shoupai.set(player, sp);
  return { g, player };
}

describe('北抜き: 金北と通常北を両方持つ時', () => {
  it('meta なし [ボタン / 自動抜き] は金北から抜く', () => {
    const { g, player } = armGoldInHandNormalZimo();
    expect(g.declareNukiBei(player)).not.toBeNull();
    expect(g.nukidoraGold[player]).toBe(1);
    expect(g.nukidora[player]).toBe(0);
    expect(g.goldHand[player].z).toBe(0);
  });

  it('通常北を直に押した [meta.gold=false] 時は通常北を抜く', () => {
    const { g, player } = armGoldInHandNormalZimo();
    expect(g.declareNukiBei(player, { gold: false })).not.toBeNull();
    expect(g.nukidora[player]).toBe(1);
    expect(g.nukidoraGold[player]).toBe(0);
    expect(g.goldHand[player].z).toBe(1);
  });

  it('金北が無ければ meta なしは通常北を抜く', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const player = 0 as PlayerId;
    const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's7', 's8', 's9', 'm9']);
    sp.zimo('z4');
    g.shoupai.set(player, sp);
    expect(g.declareNukiBei(player)).not.toBeNull();
    expect(g.nukidora[player]).toBe(1);
    expect(g.nukidoraGold[player]).toBe(0);
  });
});
