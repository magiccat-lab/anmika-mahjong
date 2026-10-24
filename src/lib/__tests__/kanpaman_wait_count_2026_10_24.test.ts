// [2026-10-24 先輩「かんぱーまんの待ちのとき、8mが4枚残りみたいな表示になってるけど、
//  これ正ぽっち2種が合計2枚待ち、という設定だからね」]
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { getTingpaiList } from '../game3/tingpai';
import { feverWaitInfoFromLiveWall } from '../game3/feverLizhi';
import type { PlayerId } from '../types';
import { kanpamanUnseen, riichiWaitSuggestions } from '../riichiWaitSuggest';

function kanpaGame() {
  const g = new Game3();
  g.qipai();
  const player = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
  g.shoupai.set(player, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's1', 'm7', 'm9']));
  (g.shoupai.get(player) as any).zimo('s9');
  (g as any).pochiHand[player] = { blue: 0, red: 0, green: 0, yellow: 0 };
  return { g, player };
}
const waitsFor = (g: Game3, player: PlayerId) => (pai: string) => {
  const sp = (g.shoupai.get(player) as any).clone();
  sp.dapai(pai);
  return getTingpaiList(sp);
};

describe('嵌八萬の待ちは正ぽっち 2 枚', () => {
  it('m7 m9 の嵌張は m8 待ちで、残りは 4 ではなく 2', () => {
    const { g, player } = kanpaGame();
    const rows = riichiWaitSuggestions(g, player, ['s9'], waitsFor(g, player));
    const m8 = rows[0].waits.find((w) => w.tile === 'm8');
    expect(m8?.unseen).toBe(2);
  });

  it('自分の手牌の正ぽっちは引く', () => {
    const { g, player } = kanpaGame();
    (g as any).pochiHand[player].green = 1;
    expect(kanpamanUnseen(g, player)).toBe(1);
  });

  it('河に出た正ぽっちも引く (逆ぽっちは関係ない)', () => {
    const { g, player } = kanpaGame();
    const other = ((player + 1) % 3) as PlayerId;
    (g as any).discardLog[other] = [{ pochi: 'blue' }, { pochi: 'red' }];
    expect(kanpamanUnseen(g, player)).toBe(1);
  });

  it('フィーバーの待ちの残りは山の青 ・ 緑のぽっちを数える', () => {
    const rows = feverWaitInfoFromLiveWall(['m8'], ['z5b', 'z5r', 'z5y', 'p1', 'm9']);
    expect(rows).toEqual([expect.objectContaining({ tile: 'm8', remain: 1 })]);
    const both = feverWaitInfoFromLiveWall(['m8'], ['z5b', 'z5g']);
    expect(both[0].remain).toBe(2);
  });
});
