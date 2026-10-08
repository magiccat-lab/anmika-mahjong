// 2026-10-09 isg. さん通報「前からだが、シュバ宣言牌をロンされるとシュバ消える」[bugreport 20261009_1]。
// 07-21 の返金 [applyHule の shuvariRefund] は lizhiDeclareDapai[loser] で宣言牌への放銃を見ていたが、
// dapai() が宣言牌を打った瞬間に lizhiDeclareDapai を false に戻すため、実際の流れでは一度も効いていなかった
// [07-21 のテストは lizhiDeclareDapai を手で立てていた]。宣言 → 宣言牌の打牌 → ロン を本物の API で通す。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

// winner=0: 断幺九+平和、s7 待ち [リーチ済みにして供託は積まない。宣言者の棒だけを見る]
const WINNER_TANYAO = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 'm2', 'm2'];
// loser=1: s7 を切ってリーチ [p123 p456 p789 s11 s23 → s1/s4 待ち]
const LOSER_TENPAI = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's1', 's2', 's3'];

function scenario() {
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
  const defenBefore = g.state.defen[1];
  const bangBefore = g.state.lizhibang;
  expect(g.declareLizhi({ shuvari: true })).toBe(true);
  expect(g.shuvariUsed[1]).toBe(true);
  expect(g.state.defen[1]).toBe(defenBefore - 1000);
  g.dapai('s7');
  s.lastDapai = { player: 1, pai: 's7' };
  s.awaitingRonDecision = true;
  game.ron(0);
  const after: any = get(game);
  return { after, defenBefore, bangBefore };
}

describe('シュバ宣言牌ロン [実際の宣言 → 打牌 → ロン]', () => {
  beforeEach(() => { game.reset(); });

  it('宣言牌でロンされたら、シュバ権と宣言で払ったリーチ棒が宣言者へ戻る', () => {
    const { after } = scenario();
    const g = after.game;
    expect(after.lastWinner).toBe(0);
    expect(g.shuvariUsed[1]).toBe(false);
    expect(g.shuvariActive[1]).toBe(false);
    expect(g.lizhi.has(1)).toBe(false);
    expect(g.events.some((e: any) => e.type === 'shuvariRefund' && e.player === 1)).toBe(true);
  });
});
