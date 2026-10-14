// 2026-10-14 リョー通報「本役満のサイコロ2回やってない？」[room 90PJ rev 2210-2224] の回帰固定。
//
// 経路: 金北持ちの人間が国士でロン → ロンの経路はサイコロを積んでから金北 modal を開いていた。
// 先にサイコロを振り切ってから金北を選ぶと、selectKinpei の再 hule が同じ和了の本役満サイコロを
// もう一度積み、1 回の和了で 2 回振っていた [積まれたままなら差し替えで済んでいた]。
// ツモの経路と同じく、金北 modal を開く時はサイコロを selectKinpei の後に回す。
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

function setupKokushiRonWithKinpei() {
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
  game.shoupai.set(winner, buildShoupai(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z6']));
  game.huapai[winner] = ['f2'];
  game.nukidoraGold[winner] = 1;
  game.shoupai.set(third, buildShoupai(['p2', 'p3', 'p5', 'p7', 'p8', 's2', 's4', 's6', 's7', 'm1', 'm9', 'p9', 's9']));
  const dsp = buildShoupai(['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'm1']);
  dsp.zimo('z7');
  game.shoupai.set(discarder, dsp);
  read(store).lastZimo = 'z7';
  return { store, game, discarder, winner };
}

describe('金北持ちの本役満ロンでサイコロは 1 和了 1 回 [2026-10-14 通報 20261014_3]', () => {
  it('サイコロを先に振り切ってから金北を選んでも、本役満サイコロは積み直さない', () => {
    const { store, game, winner } = setupKokushiRonWithKinpei();
    store.discard('z7');
    expect(read(store).awaitingRonDecision).toBe(true);
    expect(game.canRon(winner, 'z7', read(store).lastDapai.player)).toBe(true);

    store.ron(winner);
    expect(read(store).pendingKinpei?.winner).toBe(winner);

    // 通報の順: 出ている物はサイコロから片付け、金北はその後
    const yakumanSessions: string[] = [];
    let kinpeiSelected = false;
    for (let step = 0; step < 60; step += 1) {
      const s = read(store);
      if (s.pendingSaiKoro) {
        const p = s.pendingSaiKoro;
        if (!p.selectedCombo) store.selectSaiKoroCombo(1, 4);
        else if (!p.finalized) store.rollSaiKoroDice([6, 3]);
        else {
          const name = String(p.chances[p.currentIdx ?? 0]?.name ?? '');
          if (name.includes('本役満')) yakumanSessions.push(name);
          store.advanceSaiKoro();
        }
        continue;
      }
      if (s.pendingKinpei) {
        store.selectKinpei('natsu');
        kinpeiSelected = true;
        continue;
      }
      break;
    }

    expect(kinpeiSelected).toBe(true);
    expect(read(store).pendingSaiKoro).toBeNull();
    expect(read(store).message).not.toContain('再計算失敗');
    expect(yakumanSessions).toHaveLength(1);
  });
});
