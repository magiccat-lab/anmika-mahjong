// [2026-10-26 リョー「今の局のフィーバーも白アンカンしたせいで祝儀逆とかの扱いになってた」 T6BF rev 4345-4350]
// リーチ後に引いた赤ぽっちを暗槓しても、そのツモで付いた倍率 [打点 -1 ・ 祝儀 -2] が残り、
// 後の白中ロンが逆払い (-12000 ・ 祝儀 -30) になっていた。ぽっちを和了に使わず暗槓したら倍率を戻す。
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

function lizhiDraw(hand: string[], draw: string, yifa: boolean): { g: Game3; player: 0 | 1 | 2 } {
  const g = new Game3();
  g.qipai();
  const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
  g.shoupai.set(player, buildShoupai(hand));
  g.lizhi.add(player);
  g.lizhiDeclareDapai[player] = false;
  g.yifaActive[player] = yifa;
  const shan = g.shan as any;
  shan._pai.push(draw);
  shan._rinshan[0] = 'm1';
  expect(g.zimo()).toBe(draw);
  return { g, player };
}

const WHITE_HAND = [
  'z5', 'z5', 'z5',
  'p2', 'p3', 'p4',
  'p4', 'p5', 'p6',
  's7', 's8', 's9',
  'm9',
];

describe('リーチ後に引いたぽっちを暗槓したら倍率を戻す', () => {
  it('赤ぽっちの白暗槓: 打点 ・ 祝儀の逆が消える', () => {
    const { g, player } = lizhiDraw(WHITE_HAND, 'z5r', false);
    expect(g.pochiMultiplier[player]).toEqual({ defen: -1, chip: -2 });
    expect(g.pochiPaymentMode[player]).toBe(true);

    expect(g.declareKan(player, 'z5555')).not.toBeNull();
    expect(g.pochiMultiplier[player]).toEqual({ defen: 1, chip: 1 });
    expect(g.pochiPaymentMode[player]).toBe(false);
    expect(g.pochiChipDouble[player]).toBe(false);
  });

  it('黄ぽっちの白暗槓も戻す', () => {
    const { g, player } = lizhiDraw(WHITE_HAND, 'z5y', false);
    expect(g.pochiMultiplier[player]).toEqual({ defen: -1, chip: -1 });
    expect(g.declareKan(player, 'z5555')).not.toBeNull();
    expect(g.pochiMultiplier[player]).toEqual({ defen: 1, chip: 1 });
    expect(g.pochiPaymentMode[player]).toBe(false);
  });

  it('一発の 2p (でかぽっち黄) を暗槓したら戻す', () => {
    const { g, player } = lizhiDraw([
      'p2', 'p2', 'p2',
      'm1', 'm1', 'm1',
      'p4', 'p5', 'p6',
      's7', 's8', 's9',
      'z4',
    ], 'p2', true);
    expect(g.pochiMultiplier[player]).toEqual({ defen: -1, chip: -1 });
    expect(g.declareKan(player, 'p2222')).not.toBeNull();
    expect(g.pochiMultiplier[player]).toEqual({ defen: 1, chip: 1 });
    expect(g.pochiPaymentMode[player]).toBe(false);
  });

  it('暗槓しなければ赤の倍率は残る (逆ツモは今まで通り)', () => {
    const { g, player } = lizhiDraw(WHITE_HAND, 'z5r', false);
    expect(g.canTsumo(player)).toBe(true);
    expect(g.pochiMultiplier[player]).toEqual({ defen: -1, chip: -2 });
  });
});
