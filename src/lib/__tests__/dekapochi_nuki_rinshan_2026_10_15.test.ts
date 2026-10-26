// 2026-10-15 通報「一局前、2pが逆になってなかった」(33NU rev 1542) の回帰固定。
//
// リーチ一発の巡目に北をツモって抜き、その補充で p2 を引いて一発ツモした。hule() は補充牌でも
// でかぽっち オールマイティ (黄) で和了らせるのに、倍率 (黄 = 逆払い) は zimo() の中でしか付けて
// おらず、北抜き ・ 華の補充 (applyRinshanZimoEffects) では抜けていた。和了は +11000 の正払いになった。
// 補充牌でも通常ツモと同じく、待ちに無い p2 は黄 (逆払い)、本待ちの p2 は通常ツモ。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;
const read = (store: Store): any => get(store as any);

const NEUTRAL = { defen: 1, chip: 1 };
const YELLOW = { defen: -1, chip: -1 };

/** 通報の手: m99 p111 p45 s456 s789 (待ち p3 ・ p6)。p2 は待ちに無い */
const REPORT_HAND = ['m9', 'm9', 'p1', 'p1', 'p1', 'p4', 'p5', 's4', 's5', 's6', 's7', 's8', 's9'];
/** p1p3 嵌張 (待ち p2 のみ) */
const P2_KANCHAN = ['p1', 'p3', 's1', 's2', 's3', 's5', 's6', 's7', 's9', 's9', 's9', 'z1', 'z1'];

/** リーチ一発の巡目に北をツモ → 北抜き → 補充で replacement を引くところまで進める */
function riichiYifaNukiReplacement(hand: string[], replacement: string) {
  const store = createGameStore();
  const game: Game3 = read(store).game;
  const player = game.lunbanToPlayerId(game.state.lunban);
  const others = ([0, 1, 2] as PlayerId[]).filter((p) => p !== player);
  store.setCpuSeats(others);
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
  game.shoupai.set(player, buildShoupai(hand));
  game.lizhi.add(player);
  game.yifaActive[player] = true;
  const shan: any = game.shan;
  shan._baopai = ['z2', 'z2'];
  shan._fubaopai = ['z2', 'z2'];
  shan.commitDoraReveal?.();
  shan._pai[shan._pai.length - 1] = 'z4';
  shan._rinshan[0] = replacement;

  expect(game.zimo()).toBe('z4');
  const defenBefore = { ...game.state.defen };
  const kinpeiAuto = vi.spyOn(game, 'autoResolveKinpei');
  const drawn = game.declareNukiBei(player);
  expect(drawn).toBe(replacement);
  read(store).lastZimo = drawn;
  return { store, game, player, others, defenBefore, kinpeiAuto };
}

describe('でかぽっち: 北抜きの補充で引いた 1p ・ 2p も通常ツモと同じ色 (2026-10-15 通報)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it('待ちに無い p2 を北抜きの補充で一発ツモ → 黄 (逆払い) で和了者が払う', () => {
    const { store, game, player, others, defenBefore, kinpeiAuto } = riichiYifaNukiReplacement(REPORT_HAND, 'p2');
    expect(game.yifaActive[player]).toBe(true);
    expect(game.getTingpaiListBeforeZimo(player)).not.toContain('p2');

    expect(game.shan.lastZimoPochi).toBe('yellow');
    expect(game.lastZimoInfo).toMatchObject({ player, pai: 'p2', pochi: 'yellow', gold: false });
    expect(game.pochiMultiplier[player]).toEqual(YELLOW);
    expect(game.pochiPaymentMode[player]).toBe(true);
    expect(kinpeiAuto).toHaveBeenCalledTimes(1);

    expect(game.canTsumo(player)).toBe(true);
    store.tsumo();
    const s = read(store);
    expect(s.lastWinner).toBe(player);
    const result = s.lastHuleResult;
    expect((result.hupai ?? []).map((h: any) => h.name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^でかぽっち オールマイティ \[p[36]\] \(黄\)$/)]),
    );
    expect(result._pochiPaymentApplied).toBe(true);
    expect(result.defen).toBeLessThan(0);
    expect(game.state.defen[player]).toBeLessThan(defenBefore[player]);
    for (const o of others) expect(game.state.defen[o]).toBeGreaterThan(defenBefore[o]);
  });

  it('待ちに無い p1 を北抜きの補充で一発ツモ → 緑 (正払いのまま)', () => {
    const { game, player, kinpeiAuto } = riichiYifaNukiReplacement(REPORT_HAND, 'p1');
    expect(game.shan.lastZimoPochi).toBe('green');
    expect(game.lastZimoInfo).toEqual({ player, pai: 'p1', pochi: 'green', gold: false });
    expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
    expect(kinpeiAuto).not.toHaveBeenCalled();
  });

  it('本待ちの p2 を北抜きの補充で一発ツモ → 色は付かず通常の正払い', () => {
    const { store, game, player, defenBefore, kinpeiAuto } = riichiYifaNukiReplacement(P2_KANCHAN, 'p2');
    expect(game.getTingpaiListBeforeZimo(player)).toEqual(['p2']);
    expect(game.shan.lastZimoPochi ?? null).toBeNull();
    expect(game.lastZimoInfo).toEqual({ player, pai: 'p2', pochi: null, gold: false });
    expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
    expect(kinpeiAuto).not.toHaveBeenCalled();

    store.tsumo();
    const s = read(store);
    expect(s.lastWinner).toBe(player);
    expect(s.lastHuleResult.defen).toBeGreaterThan(0);
    expect(game.state.defen[player]).toBeGreaterThan(defenBefore[player]);
  });
});
