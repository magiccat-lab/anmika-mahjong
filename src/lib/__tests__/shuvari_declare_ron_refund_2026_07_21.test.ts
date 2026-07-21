// 2026-07-21 リョー報告 [再発]: シュバ宣言牌でロンされるとシュバ棒が消える。
// applyHule はシュバ権 [shuvariActive] を落とすだけで、宣言で供託した棒
// [defen -1000 / lizhibang +1] を宣言者へ戻さず、下段の供託総取り
// [defen[winner] += lizhibang*1000] で winner が持っていっていた。
//
// payment を相殺するため「シュバ無しの通常ロン」と「シュバ宣言牌ロン」で
// 放銃者 [loser] の最終 defen を比較する。宣言牌ロンは供託が完全返却される
// ので、両者の loser defen は一致するのが正しい [バグ版は 1000 低い]。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

// winner=0: 断幺九+平和でダマロン可 [リーチ不要 = winner 側の供託を混ぜない]。s7 ロン
const WINNER_TANYAO = ['p2','p3','p4','p5','p6','p7','s2','s3','s4','s5','s6','m2','m2'];

function ronScenario(declareShuvari: boolean) {
  game.reset();
  const s: any = get(game);
  const g = s.game;
  g.shoupai.set(0, buildShoupai(WINNER_TANYAO));
  g.lizhi.add(0); // アンミカは完全ダマ禁止 [面前はリーチ必須]。両ケース同条件で供託は積まない
  g.diyizimo = false;
  if (declareShuvari) {
    // loser=1 がシュバ宣言牌 [s7] を打った状態を再現
    g.shuvariActive[1] = true;
    g.shuvariUsed[1] = true;
    g.lizhiDeclareDapai[1] = true;
    g.lizhi.add(1);
    g.state.defen[1] -= 1000;
    g.state.lizhibang += 1;
  }
  s.lastDapai = { player: 1, pai: 's7' };
  s.awaitingRonDecision = true;
  game.ron(0);
  const after: any = get(game);
  return {
    defen1: after.game.state.defen[1],
    shuvari1: after.game.shuvariActive[1],
    winner: after.lastWinner,
  };
}

describe('シュバ宣言牌ロンでシュバ棒が宣言者へ戻る', () => {
  beforeEach(() => { game.reset(); });

  it('宣言牌ロンは供託が完全返却され、放銃者 defen は通常ロンと一致・シュバ権も落ちる', () => {
    const plain = ronScenario(false);
    const declared = ronScenario(true);
    expect(plain.winner).toBe(0);
    expect(declared.winner).toBe(0);
    // 供託が宣言者へ戻るので、宣言払い 1000 は放銃者の最終 defen に残らない
    expect(declared.defen1).toBe(plain.defen1);
    // シュバ権も返金で落ちる [不成立]
    expect(declared.shuvari1).toBe(false);
  });
});
