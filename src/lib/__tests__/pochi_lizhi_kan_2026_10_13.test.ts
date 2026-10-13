// [2026-10-13 リョー「リーチ後のカンッて選択制になってたりする？白ポッチ積もったときに白アンカンするかとかさ」
//  →「ポッチは選択できるよ、一発1p2pと白だけね」]
// リーチ後の待ち不変暗槓は強制 (7/15 の裁定) のまま。ただしぽっちを引いた時
// (白 = 4 枚とも色付きのぽっち、リーチ一発の 1p ・ 2p = でかぽっち) はカンするかを選べる。
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

function lizhiWith(hand: string[], draw: string, yifa: boolean): { g: Game3; player: 0 | 1 | 2 } {
  const g = new Game3();
  g.qipai();
  const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
  g.shoupai.set(player, buildShoupai(hand));
  (g.shoupai.get(player) as any).zimo(draw);
  g.lizhi.add(player);
  g.lizhiDeclareDapai[player] = false;
  g.yifaActive[player] = yifa;
  return { g, player };
}

describe('リーチ後のぽっちのカンは選べる', () => {
  it('白を引いた時の白暗槓は強制にしない (候補には残る)', () => {
    const { g, player } = lizhiWith([
      'z5', 'z5', 'z5',
      'p2', 'p3', 'p4',
      'p4', 'p5', 'p6',
      's7', 's8', 's9',
      'm9',
    ], 'z5', false);
    expect(g.isLizhiPochiDraw(player)).toBe(true);
    expect(g.getForcedLizhiKanCandidates(player)).toEqual([]);
    expect(g.getKanCandidates(player)).toContain('z5555');
  });

  it('一発の 1p はカンを選べる、一発でなければ今まで通り強制', () => {
    const hand = [
      'p1', 'p1', 'p1',
      'p2', 'p3', 'p4',
      'p4', 'p5', 'p6',
      's7', 's8', 's9',
      'z4',
    ];
    const yifa = lizhiWith(hand, 'p1', true);
    expect(yifa.g.getForcedLizhiKanCandidates(yifa.player)).toEqual([]);
    expect(yifa.g.getKanCandidates(yifa.player)).toContain('p1111');

    const later = lizhiWith(hand, 'p1', false);
    expect(later.g.getForcedLizhiKanCandidates(later.player)).toContain('p1111');
  });

  it('ぽっちでない牌のカンは一発でも強制のまま', () => {
    const { g, player } = lizhiWith([
      's7', 's7', 's7',
      'p2', 'p3', 'p4',
      'p4', 'p5', 'p6',
      'p7', 'p8', 'p9',
      'm9',
    ], 's7', true);
    expect(g.isLizhiPochiDraw(player)).toBe(false);
    expect(g.getForcedLizhiKanCandidates(player)).toContain('s7777');
  });
});
