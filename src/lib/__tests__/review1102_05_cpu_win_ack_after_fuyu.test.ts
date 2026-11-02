// クラウドレビュー 11-02 #5: 逆フィーバーの CPU ロンが冬の段 [下家 CPU の自動判定 → resolveFuyuSelection] を
// 通ると cpuWinAck が立たず、CPU 和了のサイコロが人間の確認 [ackCpuWin] を待たずに進んでいた。
// 期待: 普通の CPU ロンと同じく ack 待ち [cpuWinAck = false]
import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';
import { fuyuDecisionOwner } from '../store/winPipeline';

function setup(reverse: boolean, shimochaHuman = false) {
  game.reset();
  const s: any = get(game);
  const g = s.game;
  const h = g.lunbanToPlayerId(g.state.lunban);
  const F = (h + 2) % 3; // 下家は (F + 2) % 3 = (h + 1) % 3
  s.cpu = { 0: true, 1: true, 2: true };
  s.cpu[h] = false;
  if (shimochaHuman) s.cpu[(F + 2) % 3] = false;
  g.diyizimo = false;
  for (const p of [0, 1, 2]) { g.huapai[p] = []; g.nukidoraGold[p] = 0; g.goldHand[p] = { p: 0, s: 0, z: 0 }; g.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 }; g.nukidora[p] = 0; }
  g.huapai[F] = ['f4'];
  g.lizhi.add(F);
  g.feverActive[F] = true;
  g.feverDeclareTing[F] = ['s2'];
  g.pochiMultiplier[F] = reverse ? { defen: -1, chip: -1 } : { defen: 1, chip: 1 };
  g.pochiPaymentMode[F] = reverse;
  g.shoupai.set(F, buildShoupai(['m1', 'm1', 'm1', 'p9', 'p9', 'p9', 's1', 's1', 's1', 'z1', 'z1', 'z1', 's2']));
  const hsp = buildShoupai(['m9', 'm9', 'p1', 'p1', 's9', 's9', 'z2', 'z3', 'z6', 'z7', 'm9', 'p1', 'p8']);
  hsp.zimo('s2');
  g.shoupai.set(h, hsp);
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2', 's2', 's2');
  s.lastZimo = 's2';
  s.lastDapai = null;
  return { s, g, F, h };
}

describe('review 11-02 #5: CPU ロンが冬の段を通っても cpuWinAck を立てる', () => {
  it('対照: 正ぽっち [冬の段を通らない] の CPU ロンのサイコロは ack 待ち', () => {
    const { g, F } = setup(false);
    expect(fuyuDecisionOwner(g, F)).toBe(F);
    game.discard('s2');
    const r: any = get(game);
    expect(r.lastWinner).toBe(F);
    expect(!!r.pendingSaiKoro).toBe(true);
    expect(r.cpuWinAck).toBe(false);
  });

  it('逆 [下家 CPU が判定] の CPU ロンのサイコロも ack 待ち', () => {
    const { g, F } = setup(true);
    expect(g.pochiPaymentMode[F]).toBe(true);
    game.discard('s2');
    const r: any = get(game);
    expect(r.lastWinner).toBe(F);
    expect(!!r.pendingSaiKoro).toBe(true);
    expect(r.cpuWinAck).toBe(false);
  });

  it('逆 [下家が人間で selectFuyu] の CPU ロンのサイコロも ack 待ち', () => {
    const { g, F, h } = setup(true, true);
    const shimocha = (F + 2) % 3;
    expect(fuyuDecisionOwner(g, F)).toBe(shimocha);
    // 放銃者の h とは別に、下家も人間
    expect(shimocha).not.toBe(h);
    game.discard('s2');
    const mid: any = get(game);
    expect(mid.pendingFuyu?.decisionOwners).toEqual([shimocha]);
    game.selectFuyu(false);
    const r: any = get(game);
    expect(r.lastWinner).toBe(F);
    expect(!!r.pendingSaiKoro).toBe(true);
    expect(r.cpuWinAck).toBe(false);
  });
});
