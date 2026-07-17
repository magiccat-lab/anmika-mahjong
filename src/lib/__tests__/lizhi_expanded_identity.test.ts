import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { Game3 } from '../game3';
import { buildShoupai, toCorePai } from '../helpers';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { game as gameStore } from '../store';
import { cpuStepImpl } from '../store/cpuActions';
import type { PlayerId } from '../types';

const MEMBERS = [
  { seat: 0, is_cpu: false },
  { seat: 1, is_cpu: false },
  { seat: 2, is_cpu: false },
];

// Discarding the fourteenth tile leaves four fixed triplets and an s8 tanki.
// The s7 triplet also makes every listed discard a legal single-FEVER
// declaration candidate.
const FEVER_TENPAI = [
  'p1', 'p1', 'p1',
  'p2', 'p2', 'p2',
  'p3', 'p3', 'p3',
  's7', 's7', 's7',
  'z1',
];

function handWithPhysicalDraw(pai: string): any {
  const sp = buildShoupai(FEVER_TENPAI);
  sp.zimo(pai);
  return sp;
}

function installCurrentHand(game: Game3, pai: string): PlayerId {
  const player = game.lunbanToPlayerId(game.state.lunban);
  game.shoupai.set(player, handWithPhysicalDraw(pai));
  game.diyizimo = false;
  game.lastZimoInfo = {
    player,
    pai: pai as any,
    pochi: pai.startsWith('z5') ? 'blue' : null,
    gold: pai === 'gp' || pai === 'gs' || pai === 'gN',
  };
  return player;
}

function gameWithPlainAndRainbowDraw(): { game: Game3; player: PlayerId; sp: any } {
  const game = new Game3();
  game.qipai();
  const player = game.lunbanToPlayerId(game.state.lunban);
  const sp = buildShoupai([
    'p1', 'p2', 'p3', 'p4', 'p5', 'p6',
    's1', 's2', 's3', 's4', 's5', 's6', 'z1',
  ]);
  sp.zimo('np3');
  game.shoupai.set(player, sp);
  game.lastZimoInfo = { player, pai: 'np3', pochi: null, gold: false };
  return { game, player, sp };
}

function authorityWithCurrentDraw(pai: string): { authority: RoomAuthority; player: PlayerId } {
  const authority = createRoomAuthority({
    preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
    qijia: 0,
  });
  const player = installCurrentHand(authority.game, pai);
  authority.lastZimo = pai as any;

  const canonical = authority.canonicalState();
  installCurrentHand(canonical.game, pai);
  canonical.lastZimo = pai as any;
  canonical.lastDapai = null;
  canonical.lizhiPending = null;
  canonical.lizhiPendingFlags = null;
  canonical.roundEnded = false;

  return { authority, player };
}

describe('riichi declaration candidates preserve expanded physical identity', () => {
  beforeEach(() => gameStore.reset());

  for (const [physical, core] of [
    ['p0', 'p0'],
    ['gp', 'p0'],
    ['np3', 'p3'],
    ['z5b', 'z5'],
    ['z5r', 'z5'],
    ['z5g', 'z5'],
    ['z5y', 'z5'],
  ] as const) {
    it(`${physical} remains selectable through the ${core} candidate`, () => {
      const game = new Game3();
      game.qipai();
      const player = installCurrentHand(game, physical);

      const normal = game.getLizhiCandidates(player)
        .map((candidate) => toCorePai(candidate.replace(/[_*]$/, '')));
      const fever = [...game.feverCandidatesByDapai(player).keys()]
        .map((candidate) => toCorePai(candidate.replace(/[_*]$/, '')));

      expect(normal).toContain(core);
      expect(fever).toContain(core);
      expect(game.getLizhiCandidates(player)).toContain(physical);
      expect(game.feverCandidatesByDapai(player).has(physical)).toBe(true);
    });
  }

  it('keeps plain p3 legal but rejects np3 when only the rainbow discard breaks Rainbow FEVER', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = buildShoupai([
      'p1', 'p2', 'np3',
      's1', 's2', 'ns3',
      'z3', 'z3', 'nz3',
      'p4', 'p5', 'p6',
      'z1',
    ]);
    sp.zimo('p3');
    game.shoupai.set(player, sp);
    game.diyizimo = false;

    expect(game.getLizhiCandidates(player)).toEqual(expect.arrayContaining(['p3', 'np3']));
    const fever = game.feverCandidatesByDapai(player);
    expect(fever.get('p3')).toMatchObject({ ok: true, rainbow: true });
    expect(fever.has('np3')).toBe(false);
  });

  it('riichi tsumogiri requires the drawn rainbow, not a core-equal plain tile', () => {
    const { game, player, sp } = gameWithPlainAndRainbowDraw();
    game.lizhi.add(player);
    game.lizhiDeclareDapai[player] = false;

    expect(() => game.dapai('p3')).toThrow(/ツモ切り/);
    expect(sp._bingpai.__anmika.np3).toBe(1);
    expect(() => game.dapai('np3')).not.toThrow();
    expect(game.discardLog[player].at(-1)?.pai).toBe('np3');
  });

  it('riichi tsumogiri distinguishes a drawn gold five from a held red five', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = buildShoupai([
      'p0', 'p1', 'p2', 'p3', 'p4', 'p6', 'p7',
      's1', 's2', 's3', 's4', 's5', 'z1',
    ]);
    sp.zimo('gp');
    game.shoupai.set(player, sp);
    game.goldHand[player].p = 1;
    game.lastZimoInfo = { player, pai: 'gp', pochi: null, gold: true };
    game.lizhi.add(player);
    game.lizhiDeclareDapai[player] = false;

    expect(() => game.dapai('p0', { gold: false })).toThrow(/ツモ切り/);
    expect(() => game.dapai('p0', { gold: true })).not.toThrow();
    expect(game.discardLog[player].at(-1)?.pai).toBe('gp');
  });

  it('a non-declarer during FEVER must tsumogiri the exact rainbow identity', () => {
    const { game, player, sp } = gameWithPlainAndRainbowDraw();
    const feverPlayer = ((player + 1) % 3) as PlayerId;
    game.feverActive[feverPlayer] = true;

    expect(() => game.dapai('p3')).toThrow(/ツモ切り/);
    expect(sp._bingpai.__anmika.np3).toBe(1);
    expect(game.pickBestDiscard(player)).toBe('np3');
    expect(() => game.dapai('np3')).not.toThrow();
    expect(game.discardLog[player].at(-1)?.pai).toBe('np3');
  });

  for (const north of ['z4', 'gN'] as const) {
    it(`does not enter riichi pending when ${north} is the sole core-tenpai discard`, () => {
      const game = new Game3();
      game.qipai();
      const player = game.lunbanToPlayerId(game.state.lunban);
      const sp = buildShoupai([
        'p1', 'p1', 'p1',
        'p2', 'p2', 'p2',
        'p3', 'p3', 'p3',
        's8', 's8',
        'z1', 'z1',
      ]);
      sp.zimo(north);
      game.shoupai.set(player, sp);
      game.diyizimo = false;

      expect(game.getLizhiCandidates(player)).toEqual([]);
      expect(game.canLizhi(player)).toBe(false);
    });
  }

  for (const physical of ['gp', 'np3', 'z5b'] as const) {
    it(`online authority accepts ${physical} as the physical FEVER declaration tile`, () => {
      const { authority, player } = authorityWithCurrentDraw(physical);

      expect(authority.validateAndApply(player, {
        type: 'lizhi',
        opts: { fever: true },
      }, MEMBERS)).toBeNull();
      expect(authority.validateAndApply(player, {
        type: 'discard',
        pai: physical,
      }, MEMBERS)).toBeNull();

      expect(authority.game.discardLog[player].at(-1)?.pai).toBe(physical);
    });
  }

  it('online authority resolves the UI p0+gold payload to the physical gp candidate', () => {
    const { authority, player } = authorityWithCurrentDraw('gp');

    expect(authority.validateAndApply(player, {
      type: 'lizhi',
      opts: {},
    }, MEMBERS)).toBeNull();
    expect(authority.validateAndApply(player, {
      type: 'discard',
      pai: 'p0',
      meta: { gold: true },
    }, MEMBERS)).toBeNull();

    expect(authority.game.discardLog[player].at(-1)?.pai).toBe('gp');
    expect(authority.canonicalState().game.discardLog[player].at(-1)?.pai).toBe('gp');
  });

  it('rejects a gold-north assertion when the hand owns only ordinary north', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = handWithPhysicalDraw('z4');
    game.shoupai.set(player, sp);
    game.lastZimoInfo = { player, pai: 'z4', pochi: null, gold: false };
    const before = {
      north: sp._bingpai.z[4],
      goldNorth: sp._bingpai.__anmika.gN,
      nukidora: game.nukidora[player],
      nukidoraGold: game.nukidoraGold[player],
    };

    expect(() => game.dapai('gN')).toThrow(/requested physical tile is not in hand/);
    expect(() => game.dapai('z4', { gold: true })).toThrow(/requested gold tile is not in hand/);
    expect({
      north: sp._bingpai.z[4],
      goldNorth: sp._bingpai.__anmika.gN,
      nukidora: game.nukidora[player],
      nukidoraGold: game.nukidoraGold[player],
    }).toEqual(before);
  });

  it('rejects an ordinary-north assertion when the hand owns only gold north', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = handWithPhysicalDraw('gN');
    game.shoupai.set(player, sp);
    game.goldHand[player].z = 1;
    game.lastZimoInfo = { player, pai: 'gN', pochi: null, gold: true };
    const before = {
      north: sp._bingpai.z[4],
      goldNorth: sp._bingpai.__anmika.gN,
      goldStock: game.goldHand[player].z,
      nukidora: game.nukidora[player],
      nukidoraGold: game.nukidoraGold[player],
    };

    expect(() => game.dapai('z4', { gold: false })).toThrow(/requested non-gold tile is not in hand/);
    expect({
      north: sp._bingpai.z[4],
      goldNorth: sp._bingpai.__anmika.gN,
      goldStock: game.goldHand[player].z,
      nukidora: game.nukidora[player],
      nukidoraGold: game.nukidoraGold[player],
    }).toEqual(before);
  });

  it('CPU uses _anmikaZimo and commits the exact expanded FEVER declaration tile', () => {
    const state = get(gameStore) as any;
    const player = state.game.lunbanToPlayerId(state.game.state.lunban) as PlayerId;
    const sp = handWithPhysicalDraw('np3');
    state.game.shoupai.set(player, sp);
    state.game.diyizimo = false;
    state.game.lastZimoInfo = { player, pai: 'np3', pochi: null, gold: false };
    state.lastZimo = 'np3';
    state.cpu = { 0: false, 1: false, 2: false };
    state.cpu[player] = true;

    const after = cpuStepImpl(state);

    expect(after.game.feverActive[player]).toBe(true);
    expect(after.game.discardLog[player].at(-1)?.pai).toBe('np3');
  });

  it('CPU preserves np3 by committing plain p3 when that is the Rainbow FEVER candidate', () => {
    const state = get(gameStore) as any;
    const player = state.game.lunbanToPlayerId(state.game.state.lunban) as PlayerId;
    const sp = buildShoupai([
      'p1', 'p2', 'np3',
      's1', 's2', 'ns3',
      'z3', 'z3', 'nz3',
      'p4', 'p5', 'p6',
      'z1',
    ]);
    sp.zimo('p3');
    state.game.shoupai.set(player, sp);
    state.game.diyizimo = false;
    state.game.lastZimoInfo = { player, pai: 'p3', pochi: null, gold: false };
    state.lastZimo = 'p3';
    state.cpu = { 0: false, 1: false, 2: false };
    state.cpu[player] = true;

    const after = cpuStepImpl(state);

    expect(after.game.feverActive[player]).toBe(true);
    expect(after.game.discardLog[player].at(-1)?.pai).toBe('p3');
    expect(after.game.shoupai.get(player)?._bingpai?.__anmika?.np3).toBe(1);
  });
});
