// 2026-10-30 リョー「逆引きで辞められなくなったことへの救済措置として、
// 逆の後に逆を引いた場合、1倍正転とする(一発2pを含む)」
// 逆 [黄 / 赤] の状態で逆 [黄 / 赤 / でかぽっちの 2p] を引いたら、赤の祝儀倍も付けず 1 倍の正に戻る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, nextPochiMultiplier, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

const NEUTRAL = { defen: 1, chip: 1 };
const YELLOW = { defen: -1, chip: -1 };
const RED = { defen: -1, chip: -2 };

/** 通報の手: m99 p111 p45 s456 s789 (待ち p3 ・ p6)。p2 は待ちに無い */
const HAND = ['m9', 'm9', 'p1', 'p1', 'p1', 'p4', 'p5', 's4', 's5', 's6', 's7', 's8', 's9'];

describe('逆の後に逆を引いたら 1 倍正転 [nextPochiMultiplier]', () => {
  const colors = ['yellow', 'red'] as const;
  for (const before of [YELLOW, RED]) {
    for (const color of colors) {
      it(`(${before.defen},${before.chip}) + ${color} = (1,1)`, () => {
        expect(nextPochiMultiplier(before, color)).toEqual(NEUTRAL);
      });
    }
  }
  it('黄 → 黄 / 赤 → 黄 / 黄 → 赤 / 赤 → 赤 を順に引いても毎回 (1,1)', () => {
    expect(nextPochiMultiplier(nextPochiMultiplier(NEUTRAL, 'yellow'), 'yellow')).toEqual(NEUTRAL);
    expect(nextPochiMultiplier(nextPochiMultiplier(NEUTRAL, 'red'), 'yellow')).toEqual(NEUTRAL);
    expect(nextPochiMultiplier(nextPochiMultiplier(NEUTRAL, 'yellow'), 'red')).toEqual(NEUTRAL);
    expect(nextPochiMultiplier(nextPochiMultiplier(NEUTRAL, 'red'), 'red')).toEqual(NEUTRAL);
  });
  it('逆 → 正 [緑 / 青] の ×2 救済は変わらない', () => {
    expect(nextPochiMultiplier(YELLOW, 'green')).toEqual({ defen: 1, chip: 2 });
    expect(nextPochiMultiplier(YELLOW, 'blue')).toEqual({ defen: 1, chip: 4 });
    expect(nextPochiMultiplier(RED, 'blue')).toEqual({ defen: 1, chip: 8 });
  });
  it('正 → 逆は掛け算のまま、正 → 正は大きい方のまま', () => {
    expect(nextPochiMultiplier({ defen: 1, chip: 2 }, 'red')).toEqual({ defen: -1, chip: -4 });
    expect(nextPochiMultiplier({ defen: 1, chip: 2 }, 'green')).toEqual({ defen: 1, chip: 2 });
  });
});

function prepare(): { store: Store; game: Game3; player: PlayerId } {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  const player = game.lunbanToPlayerId(game.state.lunban);
  store.setCpuSeats(([0, 1, 2] as PlayerId[]).filter((p) => p !== player));
  game.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    game.huapai[p] = [];
    game.goldHand[p] = { p: 0, s: 0, z: 0 };
    game.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    game.nukidora[p] = 0;
    game.nukidoraGold[p] = 0;
    game.kinpeiTarget[p] = null;
    game.lingshangActive[p] = false;
    game.lingshangFromKan[p] = false;
  }
  game.shoupai.set(player, buildShoupai(HAND));
  game.lizhi.add(player);
  game.yifaActive[player] = true;
  const shan: any = game.shan;
  shan._baopai = ['z2', 'z2'];
  shan._fubaopai = ['z2', 'z2'];
  shan.commitDoraReveal?.();
  return { store, game, player };
}

describe('一発 2p [でかぽっち] も逆の後なら 1 倍正転', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); vi.restoreAllMocks(); });

  for (const before of [YELLOW, RED]) {
    it(`通常ツモ: 逆 (${before.defen},${before.chip}) の後に一発 2p → (1,1) で正払い`, () => {
      const { game, player } = prepare();
      (game as any).setPochiMultiplier(player, before);
      expect(game.pochiPaymentMode[player]).toBe(true);
      const shan: any = game.shan;
      shan._pai[shan._pai.length - 1] = 'p2';
      expect(game.getTingpaiListBeforeZimo(player)).not.toContain('p2');
      expect(game.zimo()).toBe('p2');
      expect(game.shan.lastZimoPochi).toBe('yellow');
      expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
      expect(game.pochiPaymentMode[player]).toBe(false);
    });
  }

  it('対照: 正の状態の一発 2p は今まで通り逆になる', () => {
    const { game, player } = prepare();
    const shan: any = game.shan;
    shan._pai[shan._pai.length - 1] = 'p2';
    expect(game.zimo()).toBe('p2');
    expect(game.pochiMultiplier[player]).toEqual(YELLOW);
    expect(game.pochiPaymentMode[player]).toBe(true);
  });

  it('嶺上 ・ 北抜きの補充: 逆の後に一発 2p → (1,1)', () => {
    const { game, player } = prepare();
    (game as any).setPochiMultiplier(player, YELLOW);
    const shan: any = game.shan;
    shan._pai[shan._pai.length - 1] = 'z4';
    shan._rinshan[0] = 'p2';
    expect(game.zimo()).toBe('z4');
    expect(game.declareNukiBei(player)).toBe('p2');
    expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
    expect(game.pochiPaymentMode[player]).toBe(false);
  });

  it('正転した 2p を暗槓して戻すと、直前の逆 [元の倍率] に戻る', () => {
    const { game, player } = prepare();
    (game as any).setPochiMultiplier(player, RED);
    const shan: any = game.shan;
    shan._pai[shan._pai.length - 1] = 'p2';
    game.zimo();
    expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
    expect(game.lastZimoInfo.pochiUndo?.multiplier).toEqual(RED);
  });
});
