import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { get } from 'svelte/store';
import { serializeCanonical } from '../canonicalJson';
import { game } from '../store';
import { buildCanonicalPaifuSnapshot, buildStateFromPaifu } from '../store/paifuIo';
import type { PlayerId } from '../types';

// 11-12 リョー裁定「2」: フリテンで宣言したフィーバーはツモのみ。見逃しフリテンの無視は残す。
// 元: isg. 通報 FQC9 2 試合目 東1局2本場 rev 347 [リーチ前に自分で 8p を切った 2-5-8p 待ちのフィーバーに 2p で自動ロン]
describe('フリテンで宣言したフィーバー', () => {
  function setup(river: string[]) {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    // p34566778 s777 s99 → 2p ・ 5p ・ 8p 待ち [通報の手]
    g.shoupai.set(player, buildShoupai(['p3','p4','p5','p6','p6','p7','p7','p8','s7','s7','s7','s9','s9']));
    g.lizhi.add(player);
    (g.he.get(player) as any)._pai = [...river];
    g.feverActive[player] = true;
    g.feverDeclareTing[player] = g.getTingpaiList(player);
    return { g, player, from: 1 as PlayerId };
  }

  it('宣言前の河に待ち牌 [8p] → ロン不可 [ツモのみ]', () => {
    const { g, player, from } = setup(['m9', 'p8']);
    g.markFeverFuritenAtDeclare(player);
    expect(g.feverFuritenAtDeclare[player]).toBe(true);
    expect(g.canRon(player, 'p2', from)).toBe(false);
    expect(g.canRon(player, 'p5', from)).toBe(false);
  });

  it('宣言牌そのものが待ち牌 → フリテン宣言', () => {
    const { g, player } = setup(['m9']);
    g.markFeverFuritenAtDeclare(player, 'p5');
    expect(g.feverFuritenAtDeclare[player]).toBe(true);
  });

  it('宣言時はフリテンでない → 宣言後に河へ待ち牌が来てもロン可 [ルール 5-3]', () => {
    const { g, player, from } = setup(['m9']);
    g.markFeverFuritenAtDeclare(player);
    expect(g.feverFuritenAtDeclare[player]).toBe(false);
    (g.he.get(player) as any)._pai.push('p2');
    expect(g.canRon(player, 'p2', from)).toBe(true);
  });

  it('見逃しフリテンはフィーバー中は無視のまま', () => {
    const { g, player, from } = setup(['m9']);
    g.markFeverFuritenAtDeclare(player);
    g.missedRonTemp[player] = true;
    g.missedRonPermanent[player] = true;
    expect(g.canRon(player, 'p8', from)).toBe(true);
  });

  it('フィーバーが終わると消える', () => {
    const { g, player } = setup(['p8']);
    g.markFeverFuritenAtDeclare(player);
    g.endFever(player);
    expect(g.feverFuritenAtDeclare[player]).toBe(false);
  });

  it('牌譜の保存 ・ 復元で残る', () => {
    const source = get(game);
    source.game.feverFuritenAtDeclare = { 0: false, 1: true, 2: false };
    const snap = buildCanonicalPaifuSnapshot(source, '2026-11-12T00:00:00.000Z');
    const restored = buildStateFromPaifu(JSON.parse(serializeCanonical(snap)));
    expect(restored!.game.feverFuritenAtDeclare[1]).toBe(true);
    source.game.feverFuritenAtDeclare = { 0: false, 1: false, 2: false };
  });
});
