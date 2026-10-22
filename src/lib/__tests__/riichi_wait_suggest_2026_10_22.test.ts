import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game3, buildShoupai } from '../game3';
import { getTingpaiList } from '../game3/tingpai';
import type { PlayerId } from '../types';
import { riichiWaitSuggestions, visibleTileCounts, waitCoreOf } from '../riichiWaitSuggest';

// リーチ宣言牌の候補ごとの待ち + 自分から見た残り枚数 [2026-10-22 先輩要望]
function makeGame() {
  const g = new Game3();
  g.qipai();
  const player = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
  // p123 p456 p789 s11 s22 + s3 を持ち、s3 を引いて 14 枚 [s1 s1 s2 s2 の 2 面子待ちの形は避け、単純な形にする]
  g.shoupai.set(player, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's1', 's2', 's2']));
  (g.shoupai.get(player) as any).zimo('s9');
  return { g, player };
}
const waitsFor = (g: Game3, player: PlayerId) => (pai: string) => {
  const sp = (g.shoupai.get(player) as any).clone();
  sp.dapai(pai);
  return getTingpaiList(sp);
};

describe('riichiWaitSuggestions', () => {
  it('waitCoreOf: 赤は 5、金 ・ 虹 ・ m1 は寄せる', () => {
    expect(waitCoreOf('p0')).toBe('p5');
    expect(waitCoreOf('gp')).toBe('p5');
    expect(waitCoreOf('np3')).toBe('p3');
    expect(waitCoreOf('gN')).toBe('z4');
    expect(waitCoreOf('m1')).toBe('m7');
    expect(waitCoreOf('p3+')).toBe('p3');
  });

  it('s9 を切ると s1 s2 の双碰待ち、残りは自分の手牌分を引いた枚数', () => {
    const { g, player } = makeGame();
    const rows = riichiWaitSuggestions(g, player, ['s9'], waitsFor(g, player));
    expect(rows).toHaveLength(1);
    expect(rows[0].pai).toBe('s9');
    const byTile = Object.fromEntries(rows[0].waits.map((w) => [w.tile, w.unseen]));
    // 手牌に s1 が 2 枚 ・ s2 が 2 枚 -> どちらも残り 2
    expect(byTile).toEqual({ s1: 2, s2: 2 });
    expect(rows[0].total).toBe(4);
  });

  it('河 ・ 副露 ・ ドラ表示牌 ・ 抜き北が残り枚数から引かれる', () => {
    const { g, player } = makeGame();
    const other = ((player + 1) % 3) as PlayerId;
    // 他家の河に s1 を 1 枚 [鳴かれていない]、鳴かれた s2 は副露側で数える
    g.he.get(other)?.dapai?.('s1');
    const heOther = g.he.get(other) as any;
    if (!heOther._pai.includes('s1')) heOther._pai.push('s1');
    (g.shoupai.get(other) as any)._fulou = ['s222+'];
    heOther._pai.push('s2+'); // 鳴かれた牌は河側では数えない
    (g.shan as any)._baopai = ['s1'];
    (g.shan as any).commitDoraReveal();
    const counts = visibleTileCounts(g, player);
    // s1: 手牌 2 + 河 1 + ドラ表示 1 = 4 / s2: 手牌 2 + 副露 3 = 5 (人為的な状況だが引き算は 0 で止まる)
    expect(counts.s1).toBe(4);
    expect(counts.s2).toBe(5);
    const rows = riichiWaitSuggestions(g, player, ['s9'], waitsFor(g, player));
    const byTile = Object.fromEntries(rows[0].waits.map((w) => [w.tile, w.unseen]));
    expect(byTile).toEqual({ s1: 0, s2: 0 });
  });

  it('候補が複数ある時は候補ごとに別の待ちを出す', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
    // p234 p567 p789 s22 s55 + 切り候補 z1 [s2 / s5 のシャンポン待ち]
    g.shoupai.set(player, buildShoupai(['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p7', 'p8', 'p9', 's2', 's2', 's5', 's5']));
    (g.shoupai.get(player) as any).zimo('z1');
    const rows = riichiWaitSuggestions(g, player, ['z1', 's5'], waitsFor(g, player));
    expect(rows.map((r) => r.pai)).toEqual(['z1', 's5']);
    const first = Object.fromEntries(rows[0].waits.map((w) => [w.tile, w.unseen]));
    expect(first).toEqual({ s2: 2, s5: 2 });
    // s5 を切ると s5 単騎ではなく s2 の単騎になる形ではないので、待ちが変わる (少なくとも z1 切りとは別)
    expect(JSON.stringify(rows[1].waits)).not.toBe(JSON.stringify(rows[0].waits));
  });

  it('待ちが取れない時 [計算が投げる] は空の待ちで返す', () => {
    const { g, player } = makeGame();
    const rows = riichiWaitSuggestions(g, player, ['s9'], () => { throw new Error('x'); });
    expect(rows).toEqual([{ pai: 's9', waits: [], total: 0 }]);
  });

  it('ぽっち [z5] の待ちは枚数を数えず null', () => {
    const { g, player } = makeGame();
    const rows = riichiWaitSuggestions(g, player, ['s9'], () => ['z5', 's1']);
    expect(rows[0].waits).toEqual([{ tile: 'z5', unseen: null }, { tile: 's1', unseen: 2 }]);
    expect(rows[0].total).toBe(2);
  });
});

describe('riichi wait panel wiring', () => {
  const app = readFileSync(new URL('../../App.svelte', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../RiichiWaitPanel.svelte', import.meta.url), 'utf8');
  it('App は宣言牌を選ぶ間だけパネルを出す', () => {
    expect(app).toMatch(/import RiichiWaitPanel from '\.\/lib\/RiichiWaitPanel\.svelte'/);
    // 候補は宣言牌の選択中 [lizhiPending] かつ自分の席 [srv0] の時だけ作る
    expect(app).toMatch(/\$: riichiSuggestions = \(\$game\.lizhiPending !== null && \$game\.lizhiPending === currentPlayer && currentPlayer === srv0\)/);
    expect(app).toMatch(/\{#if riichiSuggestions\.length > 0\}[\s\S]{0,200}<RiichiWaitPanel/);
  });
  it('パネルは待ち牌と残り枚数を data 属性付きで出す', () => {
    expect(panel).toContain('data-riichi-wait');
    expect(panel).toContain('data-unseen');
  });
});
