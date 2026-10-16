// [2026-10-15 リョー「ロンするときの煽り演出も入れたいな。2シャンテン以上からの放銃で…どっから切っとんねーん！」
//  「役満放銃とかにもなんかあってもいいかも」、声の 2 回目のページで 煽り 1 ・ 役満放銃 a ・ えらいこっちゃ を選んだ]
// 本物の卓でロンさせて、振り込んだ人の向聴数で煽り / 役満放銃 / 何も出ない、を確かめる
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore, CUTIN_TIER } from '../store';
import { FX_LABELS } from '../fxArtwork';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

const KOKUSHI = ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z6'];
const YAKUHAI = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's2', 's3', 's4', 'z6', 'z6', 'z6', 'z7'];
// 2 シャンテン以上 (ばらばら) と 1 シャンテン以下 (ほぼ揃っている) の振り込む人の手
const FAR = ['p1', 'p4', 'p7', 's2', 's5', 's8', 'p2', 'p5', 's3', 's6', 'z1', 'z2', 'z3'];
const NEAR = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'm1'];

function ronWith(winnerHand: string[], discarderHand: string[], feverSeat?: 'winner') {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  store.setCpuSeats([]);
  const discarder = game.lunbanToPlayerId(game.state.lunban);
  const winner = ((discarder + 1) % 3) as PlayerId;
  const third = ((discarder + 2) % 3) as PlayerId;
  game.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
  }
  const shan: any = game.shan;
  shan._baopai = ['z2', 'z2'];
  shan._fubaopai = ['z2', 'z2'];
  shan.commitDoraReveal?.();
  game.shoupai.set(winner, buildShoupai(winnerHand));
  // ダマ禁止 (副露 ・ リーチなしは役満以外ロンできない) なので、和了る人はリーチ済みにする
  (game as any).lizhi.add(winner);
  game.shoupai.set(third, buildShoupai(['p2', 'p3', 'p5', 'p7', 'p8', 's2', 's4', 's6', 's7', 'm1', 'm9', 'p9', 's9']));
  if (feverSeat) (game as any).feverActive[winner] = true;
  const dsp = buildShoupai(discarderHand);
  dsp.zimo('z7');
  game.shoupai.set(discarder, dsp);
  read(store).lastZimo = 'z7';
  // 出た演出を全部拾う (積まれた順)
  const seen: { id: string; seat?: number; label?: string }[] = [];
  const tsSeen = new Set<number>();
  const unsub = (store as any).subscribe((s: any) => {
    for (const c of [s.cutin, ...(s.cutinQueue ?? [])]) {
      if (c && !tsSeen.has(c.ts)) { tsSeen.add(c.ts); seen.push({ id: c.id, seat: c.seat, label: c.label }); }
    }
  });
  store.discard('z7');
  expect(read(store).awaitingRonDecision).toBe(true);
  store.ron(winner);
  for (let step = 0; step < 60; step += 1) {
    const s = read(store);
    if (s.pendingSaiKoro) {
      const p = s.pendingSaiKoro;
      if (!p.selectedCombo) store.selectSaiKoroCombo(1, 4);
      else if (!p.finalized) store.rollSaiKoroDice([6, 3]);
      else store.advanceSaiKoro();
      continue;
    }
    break;
  }
  unsub();
  return { seen, discarder, winner, game };
}

describe('煽り演出 (2 シャンテン以上からの放銃) と役満放銃', () => {
  it('2 シャンテン以上から振り込むと、ロンの前に振り込んだ人へ煽り', () => {
    const { seen, discarder, game } = ronWith(YAKUHAI, FAR);
    expect(game.xiangting(discarder)).toBeGreaterThanOrEqual(2);
    const ids = seen.map((c) => c.id);
    expect(ids).toContain('aori');
    expect(ids.indexOf('aori')).toBeLessThan(ids.indexOf('ron'));
    const ao = seen.find((c) => c.id === 'aori')!;
    expect(ao.seat).toBe(discarder);
    expect(ao.label).toBe('どっから切っとんねーん！');
    expect(ids).not.toContain('yakumanHoju');
  });
  it('1 シャンテン以下からの放銃では出ない', () => {
    const { seen, discarder, game } = ronWith(YAKUHAI, NEAR);
    expect(game.xiangting(discarder)).toBeLessThan(2);
    const ids = seen.map((c) => c.id);
    expect(ids).toContain('ron');
    expect(ids).not.toContain('aori');
    expect(ids).not.toContain('yakumanHoju');
  });
  it('役満に振り込むと、煽りの代わりに役満放銃 (向聴数は見ない)', () => {
    for (const hand of [FAR, NEAR]) {
      const { seen, discarder } = ronWith(KOKUSHI, hand);
      const ids = seen.map((c) => c.id);
      expect(ids.filter((i) => i === 'yakumanHoju')).toHaveLength(1);
      expect(ids).not.toContain('aori');
      expect(seen.find((c) => c.id === 'yakumanHoju')!.seat).toBe(discarder);
      expect(ids.indexOf('yakumanHoju')).toBeLessThan(ids.indexOf('ron'));
    }
  });
  it('誰かがフィーバー中なら 2 シャンテン以上からの放銃でも煽りは出さない (10-16)', () => {
    // フィーバー中に他家はロンできないので、和了るのはフィーバー中の人
    const { seen, discarder, game } = ronWith(YAKUHAI, FAR, 'winner');
    expect(game.xiangting(discarder)).toBeGreaterThanOrEqual(2);
    const ids = seen.map((c) => c.id);
    expect(ids).toContain('ron');
    expect(ids).not.toContain('aori');
  });
  it('フィーバー中でも役満放銃は出す', () => {
    const { seen } = ronWith(KOKUSHI, FAR, 'winner');
    expect(seen.map((c) => c.id)).toContain('yakumanHoju');
  });
  it('尺は中、帯の字は決め台詞', () => {
    expect(CUTIN_TIER.aori).toBe('mid');
    expect(CUTIN_TIER.yakumanHoju).toBe('mid');
    expect(FX_LABELS.aori).toBe('どっから切っとんねーん！');
    expect(FX_LABELS.yakumanHoju).toBe('役満放銃');
  });
});
