import { describe, expect, it } from 'vitest';
import { applyChipsOnHule, type HuleChipCtx } from '../game3/huleChip';

type ChipCall = {
  mode: 'oall' | 'ron';
  winner: number;
  loser?: number;
  chips: number;
  label?: string;
};

function applyMenzenYaku(names: string[], loser: 1 | null): ChipCall[] {
  const calls: ChipCall[] = [];
  const emptyHand = {
    _bingpai: { m: [0], p: [0], s: [0], z: [0] },
    _fulou: [],
  };
  const ctx: HuleChipCtx = {
    shoupai: new Map([[0, emptyHand]]),
    he: new Map(),
    goldHand: { 0: { p: 0, s: 0, z: 0 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } },
    pochiHand: { 0: {}, 1: {}, 2: {} } as any,
    huapai: { 0: [], 1: [], 2: [] },
    nukidora: { 0: 0, 1: 0, 2: 0 },
    nukidoraGold: { 0: 0, 1: 0, 2: 0 },
    kinpeiTarget: { 0: null, 1: null, 2: null },
    lizhi: new Set(),
    openLizhi: new Set(),
    feverActive: { 0: false, 1: false, 2: false },
    fuyuConsumed: { 0: false, 1: false, 2: false },
    shan: { baopai: [], fubaopai: [], _pai: [] },
    applyChipOall: (winner, chips, opts) => {
      calls.push({ mode: 'oall', winner, chips, label: opts?.label });
    },
    applyChipFromLoser: (winner, from, chips, opts) => {
      calls.push({ mode: 'ron', winner, loser: from, chips, label: opts?.label });
    },
  };
  const result = {
    hupai: names.map((name) => ({ name, fanshu: 1 })),
    fanshu: 8,
    damanguan: 0,
  };

  applyChipsOnHule(ctx, result, 0, loser);
  return calls.filter((call) => call.label === 'ホンイツ等 面前役');
}

describe('WSA-A5 additive menzen yaku chips', () => {
  it('pays honitsu plus ryanpeikou as 20 chips o-all on tsumo', () => {
    expect(applyMenzenYaku(['混一色', '二盃口'], null)).toEqual([
      { mode: 'oall', winner: 0, chips: 20, label: 'ホンイツ等 面前役' },
    ]);
  });

  it('pays honitsu plus ryanpeikou as 20 chips o-all on ron', () => {
    expect(applyMenzenYaku(['混一色', '二盃口'], 1)).toEqual([
      { mode: 'oall', winner: 0, chips: 20, label: 'ホンイツ等 面前役' },
    ]);
  });

  it('pays chinitsu plus ryanpeikou as 25 chips o-all on tsumo', () => {
    expect(applyMenzenYaku(['清一色', '二盃口'], null)).toEqual([
      { mode: 'oall', winner: 0, chips: 25, label: 'ホンイツ等 面前役' },
    ]);
  });

  it('pays chinitsu plus ryanpeikou as 25 chips o-all on ron', () => {
    expect(applyMenzenYaku(['清一色', '二盃口'], 1)).toEqual([
      { mode: 'oall', winner: 0, chips: 25, label: 'ホンイツ等 面前役' },
    ]);
  });
});
