// 2026-10-26 通報「ダブロんしたときに冬冬きんぺーが出なかった」[room T6BF rev 89-91、20261026_0] の回帰固定。
//
// 経路: 冬冬 + 金北の人間が先にロン → 2 人目のロン候補 [人間] が残るので snapshotLocked が立つ。
// その間の selectKinpei('fuyu') は saveHuleSnapshot が no-op になり、snapshot の kinpeiTarget は null のまま。
// 2 人目がロンすると ron() が pre-discard snapshot に巻き戻し、選んだ金北の先 [fuyu] も消えていた。
// 冬めくりは hasKinpei=false [冬冬 = 上段だけ] で走り、冬冬金北の上下めくりが出なかった。
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

function setupDoubleRonWithFuyuKinpei() {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  store.setCpuSeats([]);
  const discarder = game.lunbanToPlayerId(game.state.lunban);
  const first = ((discarder + 1) % 3) as PlayerId;
  const second = ((discarder + 2) % 3) as PlayerId;
  game.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
  }
  // 1 人目: 断么 p5/p8 待ち、冬 2 枚 + 金北
  game.shoupai.set(first, buildShoupai(['p2', 'p3', 'p4', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's8']));
  game.huapai[first] = ['f4', 'f4'];
  game.nukidoraGold[first] = 1;
  // 2 人目: 断么 p2/p5 待ち、華牌なし
  game.shoupai.set(second, buildShoupai(['p2', 'p3', 'p4', 'p3', 'p4', 's3', 's4', 's5', 's6', 's7', 's8', 'p6', 'p6']));
  const dsp = buildShoupai(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'm1', 'z5', 'z6', 'z7']);
  dsp.zimo('p5');
  game.shoupai.set(discarder, dsp);
  // ダマ禁止なので 2 人ともリーチ済み
  game.lizhi.add(first);
  game.lizhi.add(second);
  read(store).lastZimo = 'p5';
  return { store, game, first, second };
}

describe('ダブロンで先に選んだ冬冬金北が 2 人目のロンで消えない [2026-10-26 通報 20261026_0]', () => {
  it('1 人目が金北→冬を選んだ後に 2 人目がロンしても、冬めくりは冬冬金北 [上下] で走る', () => {
    const { store, game, first, second } = setupDoubleRonWithFuyuKinpei();
    store.discard('p5');
    expect(read(store).awaitingRonDecision).toBe(true);

    store.ron(first);
    expect(read(store).pendingKinpei?.winner).toBe(first);
    store.selectKinpei('fuyu');
    expect(read(store).pendingKinpei).toBeNull();
    expect(game.kinpeiTarget[first]).toBe('fuyu');

    store.ron(second);
    const reveal = game.fuyuRevealState[first];
    expect(reveal).not.toBeNull();
    expect(reveal!.fuyuCount).toBe(2);
    expect(reveal!.hasKinpei).toBe(true);
    expect(reveal!.fuyuLog.some((e: any) => e.tier === 'lower')).toBe(true);
  });
});
