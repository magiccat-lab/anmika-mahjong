import { describe, expect, it } from 'vitest';
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { get } from 'svelte/store';
import { game } from '../store';
import { Game3, buildShoupai } from '../game3';
import { computeTileInventory, diffInventory, expectedInventory } from '../game3/inventory';

function fillWallToExpectedInventory(g: Game3): void {
  const shan = g.shan as any;
  shan._pai = [];
  shan._rinshan = [];
  shan._baopai = [];
  shan._fubaopai = [];
  shan._fuyuRevealed = [];

  const got = computeTileInventory(g);
  const exp = expectedInventory();
  const wall: string[] = [];
  for (const pai of Object.keys(exp).sort()) {
    const missing = exp[pai] - (got[pai] ?? 0);
    if (missing < 0) throw new Error(`synthetic fixture overuses ${pai}: got=${got[pai]} exp=${exp[pai]}`);
    for (let i = 0; i < missing; i++) wall.push(pai);
  }
  shan._pai = wall;
}

function shoupaiSnapshot(sp: any) {
  return {
    bingpai: {
      _: sp._bingpai._ ?? 0,
      m: [...sp._bingpai.m],
      p: [...sp._bingpai.p],
      s: [...sp._bingpai.s],
      z: [...sp._bingpai.z],
    },
    fulou: [...(sp._fulou ?? [])],
    zimo: sp._zimo ?? null,
  };
}

function buildWinningLizhiPaifu(): any {
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.state = {
    changbang: 0,
    jushu: 0,
    benbang: 0,
    lizhibang: 0,
    qijia: 0,
    defen: { 0: 62800, 1: 21200, 2: 21000 },
    lunban: 0,
    finished: false,
  };
  g.diyizimo = false;
  g.huapai = { 0: [], 1: [], 2: [] };
  g.lizhi.add(0);
  g.yifaActive = { 0: false, 1: false, 2: false };
  g.lizhiDeclareDapai = { 0: false, 1: false, 2: false };

  const p0 = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's2', 's3', 's6', 's7', 's8', 'z1', 'z1']);
  p0.zimo('s4');
  g.shoupai.set(0, p0);
  g.shoupai.set(1, buildShoupai([]));
  g.shoupai.set(2, buildShoupai([]));
  for (const p of [0, 1, 2] as const) g.he.set(p, new Majiang.He());
  g.lastZimoInfo = { player: 0, pai: 's4', pochi: null, gold: false };

  fillWallToExpectedInventory(g);
  expect(diffInventory(g)).toEqual([]);
  expect(g.canTsumo(0)).toBe(true);

  return {
    type: 'anmika-mahjong-paifu',
    version: 2,
    timestamp: 'synthetic-2026-05-21-lizhi-autotsumokiri',
    state: g.state,
    shan: {
      currentPai: [...(g.shan as any)._pai],
      initialPai: [...(g.shan as any)._pai],
      baopai: [],
      fubaopai: [],
      rinshan: [],
      fuyuRevealed: [],
      weikaigang: false,
      lastDrawnHuapai: [],
      lastZimoGold: false,
      lastZimoPochi: null,
      rinshanUsed: 0,
    },
    shoupai: {
      0: shoupaiSnapshot(g.shoupai.get(0)),
      1: shoupaiSnapshot(g.shoupai.get(1)),
      2: shoupaiSnapshot(g.shoupai.get(2)),
    },
    he: { 0: [], 1: [], 2: [] },
    huapai: g.huapai,
    goldHand: g.goldHand,
    pochiHand: g.pochiHand,
    nukidora: g.nukidora,
    nukidoraGold: g.nukidoraGold,
    kinpeiTarget: g.kinpeiTarget,
    lizhi: [0],
    openLizhi: [],
    feverActive: g.feverActive,
    feverTier: g.feverTier,
    pochiMultiplier: g.pochiMultiplier,
    pochiPaymentMode: g.pochiPaymentMode,
    shuvariUsed: g.shuvariUsed,
    shuvariActive: g.shuvariActive,
    chipLedger: g.chipLedger,
    akiUsedCount: g.akiUsedCount,
    yifaActive: g.yifaActive,
    lizhiDeclareDapai: g.lizhiDeclareDapai,
    lingshangActive: g.lingshangActive,
    qianggangPending: false,
    diyizimo: false,
    fuyuConsumed: g.fuyuConsumed,
    fuyuSkip: g.fuyuSkip,
    lastZimoInfo: g.lastZimoInfo,
    feverDeclareTing: g.feverDeclareTing,
    feverWinCount: g.feverWinCount,
    justNukidBei: g.justNukidBei,
    discardLog: g.discardLog,
    events: [],
  };
}

describe('lizhi auto-tsumokiri winning zimo freeze 2026-05-21', () => {
  it('restores a winning lizhi draw and blocks auto-tsumokiri so tsumo remains available', () => {
    const paifu = buildWinningLizhiPaifu();
    game.loadFromPaifu(paifu);

    const before: any = get(game);
    const player = before.game.lunbanToPlayerId(before.game.state.lunban);

    expect(player).toBe(0);
    expect(before.lastZimo).toBe('s4');
    expect(before.lastWinner).toBeNull();
    expect(before.pendingKinpei).toBeNull();
    expect(before.pendingFuyu).toBeNull();
    expect(before.game.lizhi.has(0)).toBe(true);
    expect(before.game.shoupai.get(0)?._zimo).toBe('s4');
    expect(before.game.canTsumo(0)).toBe(true);

    game.tsumokiri();
    const afterAutoTsumokiri: any = get(game);
    expect(afterAutoTsumokiri.game.lunbanToPlayerId(afterAutoTsumokiri.game.state.lunban)).toBe(0);
    expect(afterAutoTsumokiri.game.shoupai.get(0)?._zimo).toBe('s4');
    expect(afterAutoTsumokiri.game.canTsumo(0)).toBe(true);
    expect(afterAutoTsumokiri.game.he.get(0)?._pai).not.toContain('s4');

    game.tsumo();

    const after: any = get(game);
    expect(after.pendingKinpei).toBeNull();
    expect(after.lastWinner).toBe(0);
    expect(after.lastHuleResult).toBeTruthy();
    expect(after.roundEnded || after.pendingSaiKoro || after.pendingFuyu).toBeTruthy();
  });
});
