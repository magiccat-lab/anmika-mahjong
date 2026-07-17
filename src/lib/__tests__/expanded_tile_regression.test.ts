import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { applyAnmikaFulouIdentity, parseMianzi } from '../fulouDisplay';
import { Game3, buildShoupai } from '../game3';
import { applyFuyuChip, type HuleChipCtx } from '../game3/huleChip';
import { toCorePai } from '../helpers';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { applyPingjuTransition, game } from '../store';
import {
  buildCanonicalPaifuSnapshot,
  buildStateFromPaifu,
  isSafePaifuSavePoint,
} from '../store/paifuIo';
import type { PlayerId } from '../types';

const PLAYERS = [0, 1, 2] as const;

function fuyuContext(hand: string[], reveal: string, ronpai: string | null = null) {
  let paid = 0;
  const ctx: HuleChipCtx = {
    shoupai: new Map([[0 as PlayerId, buildShoupai(hand)]]),
    he: new Map(),
    goldHand: { 0: { p: 0, s: 0, z: 0 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } },
    pochiHand: { 0: { blue: 0, red: 0, green: 0, yellow: 0 }, 1: { blue: 0, red: 0, green: 0, yellow: 0 }, 2: { blue: 0, red: 0, green: 0, yellow: 0 } },
    huapai: { 0: [], 1: [], 2: [] },
    nukidora: { 0: 0, 1: 0, 2: 0 },
    nukidoraGold: { 0: 0, 1: 0, 2: 0 },
    kinpeiTarget: { 0: null, 1: null, 2: null },
    lizhi: new Set(),
    openLizhi: new Set(),
    feverActive: { 0: false, 1: false, 2: false },
    fuyuConsumed: { 0: false, 1: false, 2: false },
    shan: { _pai: [reveal], _fuyuRevealed: [] },
    ronpai,
    applyChipOall: (_target, n) => { paid += n; },
    applyChipFromLoser: (_winner, _loser, n) => { paid += n; },
  };
  return { ctx, paid: () => paid };
}

describe('expanded tile regression coverage', () => {
  beforeEach(() => {
    game.reset();
  });

  it('does not normalize a fulou pseudo-zimo that merely starts with z5', () => {
    expect(toCorePai('z555+')).toBe('z555+');
  });

  it('normalizes every three-character rainbow tile to its core tile', () => {
    expect(toCorePai('np3')).toBe('p3');
    expect(toCorePai('ns3')).toBe('s3');
    expect(toCorePai('nz3')).toBe('z3');
  });

  it('builds exactly one physical copy of each rainbow tile', () => {
    const pool = generateTilePool(defaultSanmaRule());
    for (const rainbow of ['np3', 'ns3', 'nz3']) {
      expect(pool.filter((pai) => pai === rainbow)).toHaveLength(1);
    }
    expect(pool.filter((pai) => pai === 'p3')).toHaveLength(3);
    expect(pool.filter((pai) => pai === 's3')).toHaveLength(3);
    expect(pool.filter((pai) => pai === 'z3')).toHaveLength(3);
  });

  it('preserves a rainbow physical identity in an open meld display', () => {
    const result = applyAnmikaFulouIdentity(
      'p333+',
      parseMianzi('p333+'),
      [{ mianzi: 'p333+', taken: 'np3' }],
      [],
      0,
    );

    expect(result.tiles).toEqual(['np3', 'p3', 'p3']);
  });

  it('treats a rainbow winning tile as its core tile during winter reveal', () => {
    const { ctx, paid } = fuyuContext([], 'p3', 'np3');

    applyFuyuChip(ctx, 0, 1, 1, false);

    expect(paid()).toBe(2);
    expect(ctx.shan._fuyuRevealed).toEqual(['p3']);
  });

  it('treats a rainbow revealed tile as its core tile during winter reveal', () => {
    const { ctx, paid } = fuyuContext(['s3'], 'ns3');

    applyFuyuChip(ctx, 0, 1, 1, false);

    expect(paid()).toBe(2);
    expect(ctx.shan._fuyuRevealed).toEqual(['ns3']);
  });

  it('keeps a three-character draw eligible for forced fever tsumogiri', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const opponent = 1 as PlayerId;
    g.shoupai.set(player, { _zimo: 'np3', get_dapai: () => ['p3'] } as any);
    g.feverActive[opponent] = true;

    expect(g.pickBestDiscard(player)).toBe('np3');
  });

  it('does not discard a physical gold north through a CPU fallback', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const opponent = 1 as PlayerId;
    g.shoupai.set(player, { _zimo: 'gN', get_dapai: () => ['gN'] } as any);
    g.feverActive[opponent] = true;

    expect(g.pickBestDiscard(player)).toBeNull();
  });

  it('normalizes rainbow dora indicators before calculating the next tile', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p4', 'p4', 'z4']);

    expect(g.countDoraFromIndicator(sp, 'np3')).toBe(2);
    expect(g.countDoraFromIndicator(sp, 'nz3')).toBe(1);
  });

  it('accepts a rainbow west as the ron tile for the 7m kokushi fallback', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.set(0, buildShoupai([
      'm7', 'm7', 'm9', 'p1', 'p9', 's1', 's9',
      'z1', 'z2', 'z4', 'z5', 'z6', 'z7',
    ]));

    const result = g.hule(0, 'nz3', 1);

    expect(result?.hupai?.some((h: any) => h.name?.includes('国士無双'))).toBe(true);
  });

  it('round-trips a three-character draw through a safe paifu snapshot', () => {
    // Keep the snapshot physically valid: move the unique rainbow from the
    // live wall into the current draw and return the original draw to that
    // exact wall slot.  Merely overwriting _zimo would duplicate np3 and a
    // hardened paifu importer must reject such a state.
    let state = get(game);
    for (let attempt = 0; attempt < 20 && !(state.game.shan as any)._pai.includes('np3'); attempt++) {
      game.reset();
      state = get(game);
    }
    const wall = (state.game.shan as any)._pai as string[];
    const rainbowIndex = wall.indexOf('np3');
    expect(rainbowIndex).toBeGreaterThanOrEqual(0);
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    const sp = state.game.shoupai.get(player) as any;
    const oldDraw = state.lastZimo!;
    sp.dapai(oldDraw);
    sp.zimo('np3');
    wall[rainbowIndex] = oldDraw;
    state.lastZimo = 'np3';
    state.lastDapai = null;
    state.game.lastZimoInfo = { player, pai: 'np3', pochi: null, gold: false };

    expect(isSafePaifuSavePoint(state)).toBe(true);
    const restored = buildStateFromPaifu(buildCanonicalPaifuSnapshot(state));

    expect(restored).not.toBeNull();
    expect(restored?.lastZimo).toBe('np3');
    expect(restored?.game.shoupai.get(player)?._zimo).toBe('p3');
    expect((restored?.game.shoupai.get(player) as any)?._anmikaZimo).toBe('np3');
  });

  it('counts m7 and expanded honors as terminals/honors for nagashi yakuman', () => {
    const state = get(game);
    state.game.he.get(0)!._pai = ['m7', 'gN', 'nz3', 'z5b'];
    for (const player of PLAYERS) {
      state.game.shoupai.set(player, buildShoupai([
        'm7', 'm9', 'p1', 'p4', 'p9', 's1', 's5', 's9',
        'z1', 'z2', 'z3', 'z6', 'z7',
      ]));
    }

    const result = applyPingjuTransition(state, 'test:');

    expect(result.lastWinner).toBe(0);
    expect(result.lastHuleResult?.hupai?.some((h: any) => h.name === '流し役満')).toBe(true);
  });
});
