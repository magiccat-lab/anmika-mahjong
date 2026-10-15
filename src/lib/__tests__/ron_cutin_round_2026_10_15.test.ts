// [2026-10-15 リョー「cpu対戦したけどロンのカットインが次局になってない？」]
// 煽り ・ 役の名前 ・ ロンの帯は続けて流れる (中 1.7 秒 × 枚数)。和了の板の「次局へ」が先に出て、押すと残りの帯が次の局の頭で出ていた。
// 次局へ進んだら前の局の帯は捨てる (板を帯の後に出すのは App の wait-cutin、e2e は tests/fx13_ron_cutin_round.spec.ts)
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

const KOKUSHI = ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z6'];
const YAKUHAI = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's2', 's3', 's4', 'z6', 'z6', 'z6', 'z7'];
// 2 シャンテン以上 (ばらばら) と 1 シャンテン以下 (ほぼ揃っている) の振り込む人の手
const FAR = ['p1', 'p4', 'p7', 's2', 's5', 's8', 'p2', 'p5', 's3', 's6', 'z1', 'z2', 'z3'];
const NEAR = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'm1'];

function ronWith(winnerHand: string[], discarderHand: string[]) {
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
  return { seen, discarder, winner, game, store };
}


describe('ロンの帯が次の局へ持ち越されない', () => {
  it('煽り → ロンの帯が残っている間に次局へ進むと、残りの帯は捨てる', () => {
    const { seen, store } = ronWith(YAKUHAI, FAR);
    const ids = seen.map((c) => c.id);
    expect(ids).toContain('aori');
    expect(ids).toContain('ron');
    const before = read(store);
    expect(before.roundEnded).toBe(true);
    // 煽りが流れている途中: ロンの帯はまだ待ち行列にいる
    expect(before.cutin?.id).toBe('aori');
    expect((before.cutinQueue ?? []).map((c: any) => c.id)).toContain('ron');
    const rk = `${before.game.state.jushu}-${before.game.state.benbang}`;
    store.nextRound();
    const after = read(store);
    expect(`${after.game.state.jushu}-${after.game.state.benbang}`).not.toBe(rk);
    expect(after.cutin).toBeNull();
    expect(after.cutinQueue ?? []).toEqual([]);
  });
});
