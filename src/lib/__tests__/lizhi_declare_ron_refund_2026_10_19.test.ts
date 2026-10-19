// 2026-10-19 arupu_ さん通報「リーチ宣言牌で放銃したが、リーチ棒を回収されている」[bugreport 20261019_0]。
// 宣言牌への放銃はリーチ不成立なのに、返金がシュバリーにしか付いておらず、通常リーチの棒は
// applyHule の供託総取りで winner に渡っていた。宣言 → 宣言牌の打牌 → ロン を本物の API で通す。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

// winner=0: 断幺九+平和、s7 待ち [リーチ済みにして供託は積まない。宣言者の棒だけを見る]
const WINNER_TANYAO = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 'm2', 'm2'];
// loser=1: s7 を切ってリーチ [p123 p456 p789 s11 s23 → s1/s4 待ち]
const LOSER_TENPAI = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's1', 's2', 's3'];

function setup() {
  game.reset();
  const s: any = get(game);
  const g = s.game;
  g.shoupai.set(0, buildShoupai(WINNER_TANYAO));
  g.lizhi.add(0);
  g.diyizimo = false;
  (g.shan as any)._baopai = ['z1'];
  (g.shan as any)._fubaopai = ['z2'];
  for (const p of [0, 1, 2] as const) {
    g.huapai[p] = [];
    g.goldHand[p] = { p: 0, s: 0, z: 0 };
    g.nukidora[p] = 0;
    g.nukidoraGold[p] = 0;
  }
  const sp1 = buildShoupai(LOSER_TENPAI);
  sp1.zimo('s7');
  g.shoupai.set(1, sp1);
  for (let l = 0; l < 3; l++) if (g.lunbanToPlayerId(l) === 1) g.state.lunban = l;
  return { s, g };
}

function ronOn(s: any, pai: string) {
  s.lastDapai = { player: 1, pai };
  s.awaitingRonDecision = true;
  game.ron(0);
  return get(game) as any;
}

describe('リーチ宣言牌ロン [実際の宣言 → 打牌 → ロン]', () => {
  beforeEach(() => { game.reset(); });

  it('通常リーチの宣言牌でロンされたら、宣言で払ったリーチ棒が宣言者へ戻る', () => {
    const { s, g } = setup();
    const defen = { ...g.state.defen };
    expect(g.declareLizhi({})).toBe(true);
    expect(g.state.defen[1]).toBe(defen[1] - 1000);
    g.dapai('s7');
    const after = ronOn(s, 's7');
    const ag = after.game;
    expect(after.lastWinner).toBe(0);
    expect(ag.lizhi.has(1)).toBe(false);
    expect(ag.events.some((e: any) => e.type === 'lizhiRefund' && e.player === 1)).toBe(true);
    // 宣言者は打点分だけ減り、winner は打点分だけ増える [棒 1000 は動かない]
    const loss = defen[1] - ag.state.defen[1];
    const gain = ag.state.defen[0] - defen[0];
    expect(loss).toBeGreaterThan(0);
    expect(gain).toBe(loss);
    expect(ag.state.defen[2]).toBe(defen[2]);
  });

  it('オープンリーチの宣言牌でも 2000 の棒が戻る', () => {
    const { s, g } = setup();
    const defen = { ...g.state.defen };
    expect(g.declareLizhi({ open: true })).toBe(true);
    expect(g.state.defen[1]).toBe(defen[1] - 2000);
    g.dapai('s7');
    const ag = ronOn(s, 's7').game;
    expect(ag.events.some((e: any) => e.type === 'lizhiRefund' && e.player === 1)).toBe(true);
    expect(ag.openLizhi.has(1)).toBe(false);
    expect(ag.state.defen[0] - defen[0]).toBe(defen[1] - ag.state.defen[1]);
  });

  it('宣言牌が通った後の放銃は棒を戻さない', () => {
    const { s, g } = setup();
    const defen = { ...g.state.defen };
    expect(g.declareLizhi({})).toBe(true);
    g.dapai('s7');
    // 宣言牌の窓を閉じ、次巡のツモ切りに当たったことにする
    g.pendingRonWindow = { player: 1, pai: 's7' };
    const ag = ronOn(s, 's7').game;
    expect(ag.events.some((e: any) => e.type === 'lizhiRefund')).toBe(false);
    expect(ag.state.defen[0] - defen[0]).toBe(defen[1] - ag.state.defen[1]);
  });
});
