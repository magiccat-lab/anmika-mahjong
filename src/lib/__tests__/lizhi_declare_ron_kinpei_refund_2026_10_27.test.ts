// 2026-10-27 isg. さん通報「またリーチ宣言と同時放銃でリー棒取られてないか？」[bugreport 20261027_1、room 5YMV rev 1575-1578]。
// 宣言牌へのロンで一度は棒が戻る [10-19 の修正] が、和了者が金北を持っていると selectKinpei が
// restoreSnapshot → 再 hule で精算し直す。snapshot はリーチの持ち主 [lizhi / openLizhi / シュバ] を
// 戻していなかったので、1 回目の返金で lizhi から外れた宣言者は 2 回目で返金されず、
// 巻き戻った供託 1000 が winner へ渡っていた。宣言 → 宣言牌 → ロン → 金北 [春] を store で通す。
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

// winner: 断幺九+平和、s1/s4/s7 待ち
const WINNER_TANYAO = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 'p8', 'p8'];
// discarder: s7 を切ってリーチ [p123 p456 p789 s11 s23 → s1/s4 待ち]
const LOSER_TENPAI = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's1', 's2', 's3'];

function setup(opts: { shuvari?: boolean; open?: boolean } = {}) {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  store.setCpuSeats([]);
  const discarder = game.lunbanToPlayerId(game.state.lunban);
  const winner = ((discarder + 1) % 3) as PlayerId;
  const third = ((discarder + 2) % 3) as PlayerId;
  game.diyizimo = false;
  game.state.benbang = 0;
  game.state.lizhibang = 0;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
  }
  const shan: any = game.shan;
  shan._baopai = ['z1'];
  shan._fubaopai = ['z2'];
  shan.commitDoraReveal?.();
  game.shoupai.set(winner, buildShoupai(WINNER_TANYAO));
  // ダマ禁止なので winner はリーチ済みにする [供託は積まない。宣言者の棒だけを見る]
  game.lizhi.add(winner);
  game.huapai[winner] = ['f1'];
  game.nukidoraGold[winner] = 1;
  game.shoupai.set(third, buildShoupai(['m1', 'm1', 'm9', 'p1', 'p9', 's9', 'z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z6']));
  const dsp = buildShoupai(LOSER_TENPAI);
  dsp.zimo('s7');
  game.shoupai.set(discarder, dsp);
  read(store).lastZimo = 's7';
  const defen = { ...game.state.defen };
  store.lizhi({ shuvari: opts.shuvari, open: opts.open });
  store.discard('s7');
  return { store, game, discarder, winner, third, defen };
}

function ronAndPickHaru(store: Store, winner: PlayerId) {
  expect(read(store).awaitingRonDecision).toBe(true);
  store.ron(winner);
  expect(read(store).pendingKinpei?.winner).toBe(winner);
  store.selectKinpei('haru');
  expect(read(store).pendingKinpei).toBeNull();
  expect(read(store).message ?? '').not.toContain('再計算失敗');
}

describe('リーチ宣言牌ロン + 金北の選び直し [2026-10-27 通報 20261027_1]', () => {
  it('通常リーチ: 金北を選んで精算し直しても宣言者の棒は戻ったまま', () => {
    const { store, game, discarder, winner, third, defen } = setup();
    expect(game.state.defen[discarder]).toBe(defen[discarder] - 1000);
    ronAndPickHaru(store, winner);
    expect(game.lizhi.has(discarder)).toBe(false);
    expect(game.state.lizhibang).toBe(0);
    expect(game.events.filter((e: any) => e.type === 'lizhiRefund' && e.player === discarder)).toHaveLength(1);
    // 宣言者は打点だけ払い、winner は打点だけ受け取る [棒 1000 は動かない]
    const points = Number(read(store).lastHuleResult?.defen);
    expect(points).toBeGreaterThan(0);
    expect(defen[discarder] - game.state.defen[discarder]).toBe(points);
    expect(game.state.defen[winner] - defen[winner]).toBe(points);
    expect(game.state.defen[third]).toBe(defen[third]);
  });

  it('シュバリー: 金北の選び直しでもシュバ権と棒が戻る', () => {
    const { store, game, discarder, winner, defen } = setup({ shuvari: true });
    expect(game.shuvariActive[discarder]).toBe(true);
    ronAndPickHaru(store, winner);
    expect(game.shuvariActive[discarder]).toBe(false);
    expect(game.shuvariUsed[discarder]).toBe(false);
    expect(game.state.lizhibang).toBe(0);
    const points = Number(read(store).lastHuleResult?.defen);
    expect(defen[discarder] - game.state.defen[discarder]).toBe(points);
  });
});
