// 2026-10-30 リョー「対人戦の下家CPUは祝儀効率良さそうな方で自動で判定してくれ」
// 逆の時の冬のやめ権は下家が持つ。下家が CPU なら、使う / 保留 を自分の祝儀の見込みで決める。
//   useNow  = 冬を使った時の、下家のこの和了の祝儀の増減 [アリス / チューリップ込み]
//   holdNow = 保留した時の同じ増減
//   使う ⇔ useNow > holdNow + holdNow × pMore   [同点は保留]
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  game,
  fuyuOwnerChipDelta,
  fuyuWaitRemainCount,
  shimochaFuyuDecision,
  cpuShimochaFuyuPending,
} from '../store';
import { buildShoupai } from '../game3';

/** 逆ぽっち中のフィーバー者が冬を持ってツモ和了する直前の卓。待ちは m5 */
function arm(reverse: boolean, opts: { extraWaitInWall?: number; headReveals?: string[]; gold?: boolean } = {}): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = ['f4'];
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  g.pochiMultiplier[cur] = reverse ? { defen: -1, chip: -1 } : { defen: 1, chip: 1 };
  g.pochiPaymentMode[cur] = reverse;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  const wall = g.shan as any;
  // 冬の公開は _pai の先頭から。先頭に手牌と同じ牌を並べると当たり [アリス]。
  wall._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (let i = 0; i < (opts.extraWaitInWall ?? 0); i++) wall._pai.push('m5');
  if (opts.headReveals) wall._pai.unshift(...opts.headReveals);
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  const shimocha = (cur + 2) % 3;
  return { s, g, cur, shimocha };
}

describe('shimochaFuyuDecision [純関数]', () => {
  it('使った方が多くても、保留して続けた時の見込みの方が大きければ保留', () => {
    const d = shimochaFuyuDecision({ useNow: 23, holdNow: 17, waitRemain: 5, shanRemain: 60 });
    expect(d.pMore).toBeGreaterThan(0.8);
    expect(d.continuation).toBeCloseTo(17 * d.pMore, 6);
    expect(d.use).toBe(false);
  });
  it('待ちが少なく、使う方が大きく上回れば使う', () => {
    const d = shimochaFuyuDecision({ useNow: 35, holdNow: 17, waitRemain: 1, shanRemain: 60 });
    expect(d.pMore).toBeLessThan(0.35);
    expect(d.use).toBe(true);
  });
  it('同点は保留、待ちが 0 なら続きの見込みも 0', () => {
    expect(shimochaFuyuDecision({ useNow: 17, holdNow: 17, waitRemain: 0, shanRemain: 60 })).toMatchObject({ use: false, pMore: 0 });
    expect(shimochaFuyuDecision({ useNow: 18, holdNow: 17, waitRemain: 0, shanRemain: 60 }).use).toBe(true);
  });
  it('山が 0 でも落ちない', () => {
    expect(() => shimochaFuyuDecision({ useNow: 5, holdNow: 5, waitRemain: 2, shanRemain: 0 })).not.toThrow();
  });
});

describe('逆の下家 CPU は冬を祝儀の見込みで決める', () => {
  beforeEach(() => { game.reset(); });

  it('(a) 待ちが山にたっぷり残る [使っても大差なし] → 保留してフィーバー継続', () => {
    const { s, g, cur, shimocha } = arm(true, { extraWaitInWall: 4, headReveals: ['z1', 'z2'] });
    s.cpu[shimocha] = true;
    expect(cpuShimochaFuyuPending(s, cur)).toBe(true);
    const useNow = fuyuOwnerChipDelta(s, cur, null, true)!;
    const holdNow = fuyuOwnerChipDelta(s, cur, null, false)!;
    expect(useNow).toBeGreaterThan(holdNow);
    const w = fuyuWaitRemainCount(g, cur);
    expect(w).toBeGreaterThanOrEqual(5);
    expect(shimochaFuyuDecision({ useNow, holdNow, waitRemain: w, shanRemain: g.shan.paishu }).use).toBe(false);
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.lastWinner).toBe(cur);
    expect(after.game.feverActive[cur]).toBe(true);
    expect(String(after.message)).toContain('下家 CPU が冬を保留');
  });

  it('(b) 待ちが残り 1 枚で冬の当たりが大きい → 使う [アリス発動 + フィーバー終了]', () => {
    const { s, g, cur, shimocha } = arm(true, { headReveals: ['z1', 'z1', 'z1', 'z1', 'z1', 'z1'] });
    s.cpu[shimocha] = true;
    const useNow = fuyuOwnerChipDelta(s, cur, null, true)!;
    const holdNow = fuyuOwnerChipDelta(s, cur, null, false)!;
    expect(useNow).toBeGreaterThan(holdNow * 2);
    expect(fuyuWaitRemainCount(g, cur)).toBe(1);
    const before = g.chipLedger[shimocha];
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.game.fuyuConsumed[cur]).toBe(true);
    expect(after.lastWinner).toBe(cur);
    expect(after.game.chipLedger[shimocha] - before).toBe(useNow);
    expect(String(after.message)).toContain('下家 CPU が冬を使う');
  });

  it('見込みの計算は盤面を変えない [chipLedger / defen / events / fuyuConsumed / 山]', () => {
    const { s, g, cur, shimocha } = arm(true, { headReveals: ['z1', 'z1'] });
    s.cpu[shimocha] = true;
    const snap = () => JSON.stringify({
      chip: g.chipLedger,
      defen: g.state.defen,
      events: g.events.length,
      consumed: g.fuyuConsumed,
      shan: g.shan.paishu,
      pai: [...(g.shan as any)._pai],
      fever: g.feverActive,
      baopai: g.shan.baopai,
    });
    const before = snap();
    fuyuOwnerChipDelta(s, cur, null, true);
    fuyuOwnerChipDelta(s, cur, null, false);
    expect(snap()).toBe(before);
  });

  it('(c) 正ぽっちの CPU 和了者は今まで通り聞かずに保留 [当たりが大きくても]', () => {
    const { s, g, cur } = arm(false, { headReveals: ['z1', 'z1', 'z1', 'z1', 'z1', 'z1'] });
    for (const p of [0, 1, 2]) s.cpu[p] = p === cur;
    expect(cpuShimochaFuyuPending(s, cur)).toBe(false);
    game.cpuStep();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.lastWinner).toBe(cur);
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(g.feverActive[cur]).toBe(true);
  });

  it('下家が人間なら CPU の判定は動かず、下家に聞く', () => {
    const { s, cur, shimocha } = arm(true, { headReveals: ['z1', 'z1', 'z1'] });
    s.cpu[shimocha] = false;
    expect(cpuShimochaFuyuPending(s, cur)).toBe(false);
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.decisionOwners).toEqual([shimocha]);
  });

  it('CPU の和了者 [逆] と CPU の下家: 見込みで決める [大きい当たりなら使う]', () => {
    const { s, cur, shimocha } = arm(true, { headReveals: ['z1', 'z1', 'z1', 'z1', 'z1', 'z1'] });
    for (const p of [0, 1, 2]) s.cpu[p] = p === cur || p === shimocha;
    game.cpuStep();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.lastWinner).toBe(cur);
    expect(after.game.fuyuConsumed[cur]).toBe(true);
  });

  it('(d) 金北の自動選択は、下家 CPU が保留と判定した冬を使わない', () => {
    const { s, g, cur, shimocha } = arm(true, { extraWaitInWall: 4, headReveals: ['z1', 'z2'] });
    g.nukidoraGold[cur] = 1;
    for (const p of [0, 1, 2]) s.cpu[p] = p !== cur;
    expect(s.cpu[shimocha]).toBe(true);
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingFuyu).toBeNull();
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.game.kinpeiTarget[cur]).not.toBe('fuyu');
    expect(after.game.feverActive[cur]).toBe(true);
  });
});
