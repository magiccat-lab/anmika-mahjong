import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { Game3, buildShoupai } from '../game3';
import { applyChipsOnHule, type HuleChipCtx } from '../game3/huleChip';
import { rainbowKanUpgradeTier } from '../game3/feverLizhi';
import { applyPingjuTransition, game as gameStore } from '../store';
import type { PlayerId } from '../types';

function quietGame(hand: string[]): { game: Game3; player: PlayerId } {
  const game = new Game3();
  game.qipai();
  const player = 0 as PlayerId;
  game.diyizimo = false;
  game.shoupai.set(player, buildShoupai(hand));
  game.huapai = { 0: [], 1: [], 2: [] };
  (game.shan as any)._baopai = ['z1'];
  (game.shan as any)._fubaopai = [];
  (game.shan as any)._pai = ['p9'];
  return { game, player };
}

const KANPAMAN_HAND = [
  'm7', 'm9',
  'p2', 'p3', 'p4', 'p5', 'p6', 'p7',
  's4', 's5', 's6',
  's2', 's2',
];

describe('rule consistency: rainbow fever promotion', () => {
  it('adds the documented extra tier only when the rainbow is newly completed by kan', () => {
    const rainbowOnly = { ok: true, tiles: [], tier: 1 as const, rainbow: true };
    expect(rainbowKanUpgradeTier(rainbowOnly, false, 1)).toBe(2);

    const oneSeven = { ok: true, tiles: ['p7'], tier: 2 as const, rainbow: true };
    expect(rainbowKanUpgradeTier(oneSeven, true, 1)).toBe(3);

    const twoSevens = { ok: true, tiles: ['p7', 's7'], tier: 3 as const, rainbow: true };
    expect(rainbowKanUpgradeTier(twoSevens, true, 2)).toBe(4);
    // 宣言時から虹を含んでいた場合は同じ暗槓で二重昇格しない。
    expect(rainbowKanUpgradeTier(oneSeven, true, 2)).toBeNull();
  });
});

describe('rule consistency: nagashi yakuman settlement', () => {
  it('uses normal yakuman-tsumo points, extracted-tile chips, and Shuba dice', () => {
    gameStore.reset();
    const state = get(gameStore);
    state.game.state.defen = { 0: 35000, 1: 35000, 2: 35000 };
    state.game.state.benbang = 2;
    state.game.he.get(0)!._pai = ['m7', 'm9', 'z1'];
    state.game.he.get(1)!._pai = ['p2'];
    state.game.he.get(2)!._pai = ['s3'];
    state.game.nukidora[0] = 2;
    state.game.huapai[0] = ['f1', 'f3'];

    applyPingjuTransition(state);

    // 親役満ツモ: 16000 + 2本場2000 + 加符1000を各家から受け取る。
    expect(state.game.state.defen).toEqual({ 0: 73000, 1: 16000, 2: 16000 });
    // 役満5 + 本役満10 + 北2 + 春(華2枚×1) = 19枚オール。
    expect(state.game.chipLedger).toEqual({ 0: 38, 1: -19, 2: -19 });
    expect(state.lastHuleResult?.chipTotal).toBe(38);
    expect(state.pendingSaiKoro?.chances[0]).toMatchObject({
      awardKey: 'yakuman:流し役満',
      alwaysShuvari: true,
      baseChip: 70,
    });
    expect(state.pendingPingju).toBe(true);
    expect(state.roundEnded).toBe(false);
  });
});

describe('rule consistency: kanpaman pochi boundary', () => {
  it('uses a drawn white pochi as the missing m8 and awards true yakuman', () => {
    const { game, player } = quietGame(KANPAMAN_HAND);
    game.shoupai.get(player)!.zimo('z5g');
    game.lizhi.add(player);

    expect(game.canTsumo(player)).toBe(true);
    const result = game.hule(player);
    expect(result).not.toBeNull();
    expect(result.hupai.some((h: any) => String(h.name).includes('嵌八萬'))).toBe(true);
    expect(result.damanguan).toBeGreaterThanOrEqual(1);
  });

  it('allows only a positive pochi for kanpaman ron', () => {
    const positive = quietGame(KANPAMAN_HAND);
    positive.game.lizhi.add(positive.player);
    positive.game.discardLog[1] = [{ pai: 'z5g', pochi: 'green' }];

    expect(positive.game.canRon(positive.player, 'z5g', 1)).toBe(true);
    const result = positive.game.hule(positive.player, 'z5g', 1);
    expect(result).not.toBeNull();
    expect(result.hupai.some((h: any) => String(h.name).includes('嵌八萬'))).toBe(true);

    const negative = quietGame(KANPAMAN_HAND);
    negative.game.lizhi.add(negative.player);
    negative.game.discardLog[1] = [{ pai: 'z5r', pochi: 'red' }];
    expect(negative.game.canRon(negative.player, 'z5r', 1)).toBe(false);
    expect(negative.game.hule(negative.player, 'z5r', 1)).toBeNull();
  });

  it('applies the deka-pochi white substitution to kanpaman too', () => {
    const { game, player } = quietGame(KANPAMAN_HAND);
    game.shoupai.get(player)!.zimo('p1');
    game.lizhi.add(player);
    game.yifaActive[player] = true;

    expect(game.canTsumo(player)).toBe(true);
    const result = game.hule(player);
    expect(result).not.toBeNull();
    expect(result._dekapochiSwap).toBe('m8');
    expect(result.hupai.some((h: any) => String(h.name).includes('嵌八萬'))).toBe(true);
  });
});

describe('rule consistency: pochi high selection', () => {
  it('includes the complete Winter reveal when choosing the forced high tile', () => {
    const { game, player } = quietGame([
      'p1', 'p2', 'p3',
      'p4', 'p5', 'p6',
      'p7', 'p8', 'p9',
      's1', 's1', 's2', 's3',
    ]);
    game.shoupai.get(player)!.zimo('z5g');
    game.lizhi.add(player);
    game.huapai[player] = ['f4'];
    (game.shan as any)._pai = ['s4'];

    const result = game.hule(player);
    expect(result).not.toBeNull();
    expect(result._allmightyPochi).toBe('s4');
    expect((game.shan as any)._pai).toEqual(['s4']);
    expect(game.chipLedger).toEqual({ 0: 0, 1: 0, 2: 0 });
  });
});

describe('rule consistency: menzen mangan 3 to 29', () => {
  it('treats four han as mangan for the 3-chip upgrade', () => {
    const calls: Array<{ mode: 'oall' | 'ron'; chips: number; label?: string }> = [];
    const hand = {
      _bingpai: {
        m: [0], p: [1, 0, 0, 0, 0, 0], s: [0], z: [0],
        __anmika: {},
      },
      _fulou: [],
    };
    const ctx: HuleChipCtx = {
      shoupai: new Map([[0, hand]]),
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
      applyChipOall: (_winner, chips, opts) => calls.push({ mode: 'oall', chips, label: opts?.label }),
      applyChipFromLoser: (_winner, _loser, chips, opts) => calls.push({ mode: 'ron', chips, label: opts?.label }),
    };

    applyChipsOnHule(ctx, {
      hupai: [{ name: '一発', fanshu: 1 }],
      fanshu: 4,
      fu: 30,
      damanguan: 0,
    }, 0, 1);

    expect(calls).toContainEqual({ mode: 'ron', chips: 26, label: '面前満貫 3枚→29枚' });
  });
});

describe('rule consistency: autumn-autumn gold north', () => {
  function runAutumnGold(akiRevealCount: number): number[] {
    const calls: number[] = [];
    const hand = {
      _bingpai: { m: [0], p: [1], s: [0], z: [0], __anmika: {} },
      _fulou: [],
    };
    const ctx: HuleChipCtx = {
      shoupai: new Map([[0, hand]]),
      he: new Map(),
      goldHand: { 0: { p: 0, s: 0, z: 0 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } },
      pochiHand: { 0: {}, 1: {}, 2: {} } as any,
      huapai: { 0: ['f2', 'f3', 'f3'], 1: [], 2: [] },
      nukidora: { 0: 0, 1: 0, 2: 0 },
      nukidoraGold: { 0: 1, 1: 0, 2: 0 },
      kinpeiTarget: { 0: 'aki', 1: null, 2: null },
      lizhi: new Set(),
      openLizhi: new Set(),
      feverActive: { 0: false, 1: false, 2: false },
      fuyuConsumed: { 0: false, 1: false, 2: false },
      shan: { baopai: [], fubaopai: [], _pai: [] },
      applyChipOall: (_winner, chips) => calls.push(chips),
      applyChipFromLoser: (_winner, _loser, chips) => calls.push(chips),
    };
    applyChipsOnHule(ctx, {
      hupai: [
        { name: '立直', fanshu: 1 },
        { name: 'ドラ', fanshu: 3 },
        { name: '夏 [打点ランクアップ]', fanshu: 2 },
      ],
      fanshu: 6,
      fu: 30,
      damanguan: 0,
      _akiRevealCount: akiRevealCount,
    }, 0, 1);
    return calls;
  }

  it('requires both new dora reveals and counts each summer as exactly two han', () => {
    // 金北自身の抜きドラ1枚に加え、元の4翻 + 夏2翻 = 6枚を加算。
    expect(runAutumnGold(2)).toEqual(expect.arrayContaining([1, 6]));
    // 新ドラが1枚しか開けなければ秋秋金北そのものが不成立。
    expect(runAutumnGold(1)).not.toContain(6);
  });
});

describe('rule consistency: Tontonbu', () => {
  it('does not award Tontonbu when a child wins in East 1 and the hand ends by bust', () => {
    const game = new Game3({ qijia: 0 });
    game.qipai();
    game.state.jushu = 0;
    game.state.changbang = 0;
    game.state.defen = { 0: 50000, 1: -100, 2: 55100 };
    game.events.push({
      type: 'hule',
      player: 2,
      changbang: 0,
      jushu: 0,
    } as any);

    expect(game.getFinalScore().every((row) => row.tontonbuBonus === 0)).toBe(true);
  });

  it('keeps Tontonbu for an East 1 bust with no child win', () => {
    const game = new Game3({ qijia: 0 });
    game.qipai();
    game.state.jushu = 0;
    game.state.changbang = 0;
    game.state.defen = { 0: -100, 1: 55100, 2: 50000 };
    game.events.push({
      type: 'hule',
      player: 0,
      changbang: 0,
      jushu: 0,
    } as any);

    const score = game.getFinalScore();
    expect(score.find((row) => row.player === 0)?.tontonbuBonus).toBe(12);
    expect(score.filter((row) => row.player !== 0).every((row) => row.tontonbuBonus === -6)).toBe(true);
  });
});
