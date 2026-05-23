import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// canRon の フリテン判定 + フィーバー中 skip を unit 固定。
describe('Game3 canRon フリテン', () => {
  function makeTenpaiP0(): { g: Game3; player: PlayerId; fromPlayer: PlayerId } {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false; // 天和 path 回避
    const player = 0 as PlayerId;
    const fromPlayer = 1 as PlayerId;
    // s8 単騎待ち + リーチ済 [ダマ禁止 path skip]
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(player);
    return { g, player, fromPlayer };
  }

  it('自家河に 待ち牌 [s8] あり → フリテンで false', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    const he = g.he.get(player);
    (he as any)._pai = ['s8']; // 自家河に s8 ある = フリテン
    expect(g.canRon(player, 's8', fromPlayer)).toBe(false);
  });

  it('自家河に 待ち牌 ナシ → フリテンじゃない → true', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    const he = g.he.get(player);
    (he as any)._pai = ['m9', 'p4']; // 待ち牌 ナシ
    expect(g.canRon(player, 's8', fromPlayer)).toBe(true);
  });

  it('フィーバー中 はフリテン判定 skip [ルール 5-3 何度でも アガリ可能]', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    const he = g.he.get(player);
    (he as any)._pai = ['s8']; // 自家河に s8 [本来フリテン]
    g.feverActive[player] = true;
    expect(g.canRon(player, 's8', fromPlayer)).toBe(true);
  });

  it('河 tile の副露 mark [+/=/-] を strip して比較 [マーカー紛れ込まない]', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    const he = g.he.get(player);
    (he as any)._pai = ['s8+']; // 副露マーカー付き
    expect(g.canRon(player, 's8', fromPlayer)).toBe(false); // base tile s8 同じ → フリテン
  });
});
