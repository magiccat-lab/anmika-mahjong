import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 見逃しフリテン [2026-09-07 リョー裁定]
//   「フィーバー中はフリテン無視だけど [強制ロン]、他は一般の麻雀ルールに従う」
// 一般ルール:
//   - ロンできる牌を見逃したら、自分の次のツモまでロン不可 [同巡内フリテン]
//   - リーチ後の見逃しは和了放棄なので局終了までロン不可 [永久フリテン]
//   - フリテンが止めるのはロンだけ。ツモ和了は妨げない
describe('Game3 見逃しフリテン', () => {
  function makeTenpaiP0(opts: { lizhi?: boolean } = {}): { g: Game3; player: PlayerId; fromPlayer: PlayerId } {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false; // 天和 path 回避
    const player = 0 as PlayerId;
    const fromPlayer = 1 as PlayerId;
    // s8 単騎待ち。ダマ禁止 check を通すため既定でリーチ済にする
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    if (opts.lizhi !== false) g.lizhi.add(player);
    (g.he.get(player) as any)._pai = ['m9', 'p4']; // 自家河フリテンは無し
    return { g, player, fromPlayer };
  }

  it('見逃す前は普通にロンできる', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    expect(g.canRon(player, 's8', fromPlayer)).toBe(true);
  });

  it('ロン受付が閉じると、見逃した player にフリテンが付いて同じ牌をロンできない', () => {
    const { g, player, fromPlayer } = makeTenpaiP0({ lizhi: false });
    g.shoupai.set(player, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(player);
    g.pendingRonWindow = { player: fromPlayer, pai: 's8' };
    g.closeRonWindow();
    expect(g.missedRonTemp[player]).toBe(true);
    expect(g.canRon(player, 's8', fromPlayer)).toBe(false);
  });

  it('打った本人にはフリテンが付かない', () => {
    const { g, fromPlayer } = makeTenpaiP0();
    g.pendingRonWindow = { player: fromPlayer, pai: 's8' };
    g.closeRonWindow();
    expect(g.missedRonTemp[fromPlayer]).toBe(false);
  });

  it('そもそもロンできない player にはフリテンが付かない', () => {
    const { g, fromPlayer } = makeTenpaiP0();
    const other = 2 as PlayerId;
    g.pendingRonWindow = { player: fromPlayer, pai: 's8' };
    g.closeRonWindow();
    expect(g.missedRonTemp[other]).toBe(false);
  });

  it('リーチしてない見逃しは同巡内だけ。自分のツモで解除される', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    g.lizhi.delete(player); // リーチなしでも役満手なら canRon は通る形にする
    g.missedRonTemp[player] = true;
    g.missedRonPermanent[player] = false;
    expect(g.canRon(player, 's8', fromPlayer)).toBe(false);
    // 自分のツモ番で同巡内フリテン解除
    g.state.lunban = (((g.currentOya - player) % 3 + 3) % 3) as any;
    g.zimo();
    expect(g.missedRonTemp[player]).toBe(false);
  });

  it('リーチ後の見逃しは永久フリテン。自分のツモでも解除されない', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    g.pendingRonWindow = { player: fromPlayer, pai: 's8' };
    g.closeRonWindow();
    expect(g.missedRonPermanent[player]).toBe(true);
    g.state.lunban = (((g.currentOya - player) % 3 + 3) % 3) as any;
    g.zimo();
    expect(g.missedRonTemp[player]).toBe(false);
    expect(g.missedRonPermanent[player]).toBe(true);
    expect(g.canRon(player, 's8', fromPlayer)).toBe(false);
  });

  it('フィーバー中は見逃しフリテンも無視される [ルール 5-3 強制ロン]', () => {
    const { g, player, fromPlayer } = makeTenpaiP0();
    g.missedRonTemp[player] = true;
    g.missedRonPermanent[player] = true;
    g.feverActive[player] = true;
    expect(g.canRon(player, 's8', fromPlayer)).toBe(true);
  });

  it('フリテン中でもツモ和了はできる', () => {
    const { g, player } = makeTenpaiP0();
    g.missedRonPermanent[player] = true;
    const sp = buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']);
    sp.zimo('s8');
    g.shoupai.set(player, sp);
    expect(g.canTsumo(player)).toBe(true);
  });

  it('dapai がロン受付を開き、次の zimo がそれを閉じる [hook の配線確認]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const drawn = g.zimo();
    expect(drawn).not.toBeNull();
    const discarder = g.lunbanToPlayerId(g.state.lunban);
    g.dapai(drawn as any);
    expect(g.pendingRonWindow).toEqual({ player: discarder, pai: drawn });
    g.zimo();
    expect(g.pendingRonWindow).toBe(null);
  });

  it('qipai で見逃しフリテンは局ごとにリセットされる', () => {
    const { g, player } = makeTenpaiP0();
    g.missedRonTemp[player] = true;
    g.missedRonPermanent[player] = true;
    g.pendingRonWindow = { player: 1 as PlayerId, pai: 's8' };
    g.qipai();
    expect(g.missedRonTemp[player]).toBe(false);
    expect(g.missedRonPermanent[player]).toBe(false);
    expect(g.pendingRonWindow).toBe(null);
  });
});
