import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { applyChipsOnHule, type HuleChipCtx } from '../game3/huleChip';
import { Shan3, defaultSanmaRule } from '../shan3';
import { game } from '../store';
import type { PlayerId } from '../types';
import { get } from 'svelte/store';

function chipContext(overrides: Partial<HuleChipCtx> = {}) {
  const calls: Array<{ mode: 'oall' | 'ron'; chips: number; label?: string }> = [];
  const hand = { _bingpai: { m: [0], p: [0], s: [0], z: [0] }, _fulou: [] };
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
    ...overrides,
  };
  return { ctx, calls };
}

function autumnWinnerGame(): Game3 {
  const g = new Game3();
  g.qipai();
  g.shoupai.set(0, buildShoupai([
    'p1', 'p1', 'p1',
    'p2', 'p2', 'p2',
    'p3', 'p3', 'p3',
    's7', 's7', 's7',
    's8',
  ]));
  (g.shoupai.get(0) as any).zimo('s8');
  g.huapai[0] = ['f3'];
  g.lizhi.add(0);
  g.diyizimo = false;
  // 秋回数・役計算をランダムな初期表示華に左右させない。
  (g.shan as any)._baopai = ['z1', 'z1'];
  (g.shan as any)._fubaopai = ['z1', 'z1'];
  return g;
}

describe('2026-07-15確定裁定', () => {
  it('初期の表・裏ドラに華を表示でき、華自体はその位置から物理的に切り出す', () => {
    const pool = Array.from({ length: 40 }, (_, i) => `p${(i % 9) + 1}`);
    pool[4] = 'f1';
    pool[5] = 'p2';
    pool[6] = 'f4';
    pool[7] = 's3';
    const shan = new Shan3(defaultSanmaRule(), pool as any);
    expect(shan.baopai).toEqual(['f1', 'p2']);
    expect(shan.fubaopai).toEqual(['f4', 's3']);
    expect((shan as any)._pai).not.toContain('f1');
    expect((shan as any)._pai).not.toContain('f4');
  });

  it('表示華は抜いた扱いかつ金北候補、裏表示華はリーチ和了時だけ有効', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = [];
    (g.shan as any)._baopai = ['f1'];
    (g.shan as any)._fubaopai = ['f4'];
    g.goldHand[player].z = 1;
    expect(g.effectiveHuapaiAtHule(player)).toEqual(['f1']);
    expect(g.setKinpeiChoice(player, 'fuyu')).toBe(false);
    g.clearKinpeiChoice(player);
    g.lizhi.add(player);
    expect(g.effectiveHuapaiAtHule(player)).toEqual(['f1', 'f4']);
    expect(g.setKinpeiChoice(player, 'fuyu')).toBe(true);
  });

  it('秋表示華はsnapshot復元後も金北候補として検証できる', () => {
    const g = new Game3();
    g.qipai();
    // [2026-07-21 flaky fix] ランダム配牌の華 f4 が huapai/表示に混入して
    // not.toContain('f4') が揺れる。effectiveHuapaiAtHule の全読み元
    // [huapai / baopai / fubaopai] を固定して決定化する
    (g.shan as any)._baopai = ['m1'];
    (g.shan as any)._fubaopai = ['m2'];
    g.huapai[0] = [];
    g.huapai[1] = [];
    g.huapai[2] = [];
    const player = 0 as PlayerId;
    g.goldHand[player].z = 1;
    expect(g.effectiveHuapaiAtHule(player)).not.toContain('f4');
    expect(g.setKinpeiChoice(player, 'fuyu', ['f3', 'f4'])).toBe(true);
    expect(g.kinpeiTarget[player]).toBe('fuyu');
  });

  it('表示された春も総華枚数に含めて春祝儀を計算する', () => {
    const { ctx, calls } = chipContext({
      huapai: { 0: ['f2'], 1: [], 2: [] },
      shan: { baopai: ['f1'], fubaopai: [], _pai: [] },
    });
    applyChipsOnHule(ctx, { hupai: [], fanshu: 1, damanguan: 0 }, 0, null);
    expect(calls).toContainEqual({ mode: 'oall', chips: 2, label: '春 [2枚×1]' });
  });

  it('秋で表示した華は枠を占め、秋ならその季節効果だけを1回連鎖する', () => {
    const g = autumnWinnerGame();
    const visibleBefore = g.shan.baopai.length;
    const hiddenBefore = g.shan.fubaopai?.length ?? 0;
    // 深い側から f3(表) → p8(裏) → p7(連鎖した表) → p9(裏)。
    // Keep a complete second front/back pair. A lone lower tile cannot be
    // used for the Autumn that was just revealed.
    (g.shan as any)._pai = ['f3', 'p8', 'p7', 'p9'];
    expect(g.hule(0)).not.toBeNull();
    expect(g.shan.baopai.slice(visibleBefore)).toEqual(['f3', 'p7']);
    expect(g.shan.fubaopai?.slice(hiddenBefore)).toEqual(['p8', 'p9']);
  });

  it('非リーチ秋秋でも固定ペアの上段2枚を表、下段2枚を裏枠へ切り出す', () => {
    const g = autumnWinnerGame();
    g.lizhi.delete(0);
    g.huapai[0] = ['f3', 'f3'];
    const visibleBefore = g.shan.baopai.length;
    const hiddenBefore = g.shan.fubaopai?.length ?? 0;
    (g.shan as any)._pai = ['p1', 's1', 'p2', 's2'];

    g.hule(0);
    expect(g.shan.baopai.slice(visibleBefore)).toEqual(['p1', 'p2']);
    expect(g.shan.fubaopai?.slice(hiddenBefore)).toEqual(['s1', 's2']);
    expect((g.shan as any)._pai).toEqual([]);
  });

  it('非リーチ時の秘匿下段が秋でも追加の秋連鎖を起こさない', () => {
    const g = autumnWinnerGame();
    g.lizhi.delete(0);
    g.huapai[0] = ['f3'];
    const visibleBefore = g.shan.baopai.length;
    const hiddenBefore = g.shan.fubaopai?.length ?? 0;
    (g.shan as any)._pai = ['p1', 'f3', 'p2', 's2'];

    g.hule(0);
    expect(g.shan.baopai.slice(visibleBefore)).toEqual(['p1']);
    expect(g.shan.fubaopai?.slice(hiddenBefore)).toEqual(['f3']);
    expect((g.shan as any)._pai).toEqual(['p2', 's2']);
  });

  it('秋で冬が表示されても通常牌まで飛ばさず、冬を抜いた扱いにする', () => {
    const g = autumnWinnerGame();
    const visibleBefore = g.shan.baopai.length;
    (g.shan as any)._pai = ['f4', 'p9'];
    expect(g.hule(0)).not.toBeNull();
    expect(g.shan.baopai.slice(visibleBefore)).toEqual(['f4']);
    expect(g.effectiveHuapaiAtHule(0)).toContain('f4');
  });

  it('ツモ時も秋で新たに表示された華を金北選択へ引き継いで再計算する', () => {
    game.reset();
    const s0: any = get(game);
    const player = 0 as PlayerId;
    s0.game.state.lunban = 0;
    s0.game.diyizimo = false;
    s0.game.shoupai.set(player, buildShoupai([
      'p1', 'p1', 'p1',
      'p2', 'p2', 'p2',
      'p3', 'p3', 'p3',
      's7', 's7', 's7',
      's8',
    ]));
    (s0.game.shoupai.get(player) as any).zimo('s8');
    s0.game.huapai[player] = ['f3'];
    s0.game.goldHand[player].z = 1;
    s0.game.lizhi.add(player);
    (s0.game.shan as any)._pai = ['f1', 'p9'];
    s0.lastZimo = 's8';
    s0.lastDapai = null;
    s0.lastWinner = null;
    s0.roundEnded = false;
    s0.cpu[player] = false;

    expect(s0.game.canTsumo(player)).toBe(true);
    game.tsumo();
    const pending: any = get(game).pendingKinpei;
    expect(pending?.winner).toBe(player);
    expect(pending?.availableHuapai).toContain('f1');

    game.selectKinpei('haru');
    const after: any = get(game);
    expect(after.pendingKinpei).toBeNull();
    expect(after.game.kinpeiTarget[player]).toBe('haru');
    expect(after.lastWinner).toBe(player);
  });

  it('CPU also chooses a flower first revealed by Autumn for Gold North', () => {
    game.reset();
    const s0: any = get(game);
    const player = 0 as PlayerId;
    s0.game.state.lunban = 0;
    s0.game.diyizimo = false;
    s0.game.shoupai.set(player, buildShoupai([
      'p1', 'p1', 'p1',
      'p2', 'p2', 'p2',
      'p3', 'p3', 'p3',
      's7', 's7', 's7',
      's8',
    ]));
    (s0.game.shoupai.get(player) as any).zimo('s8');
    s0.game.huapai[player] = ['f3'];
    s0.game.goldHand[player].z = 1;
    s0.game.lizhi.add(player);
    (s0.game.shan as any)._pai = ['f4', 'p9'];
    s0.lastZimo = 's8';
    s0.lastDapai = null;
    s0.lastWinner = null;
    s0.roundEnded = false;
    s0.cpu[player] = true;

    expect(s0.game.canTsumo(player)).toBe(true);
    game.cpuStep();

    const after: any = get(game);
    expect(after.game.kinpeiTarget[player]).toBe('fuyu');
    expect(after.lastWinner).toBe(player);
    expect(after.roundEnded).toBe(true);
  });

  it('リーチ後の待ち不変暗槓を候補に残し、カン前の打牌を拒否する', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.shoupai.set(player, buildShoupai([
      'p1', 'p1', 'p1',
      'p2', 'p3', 'p4',
      'p4', 'p5', 'p6',
      's7', 's8', 's9',
      'z4',
    ]));
    (g.shoupai.get(player) as any).zimo('p1');
    g.lizhi.add(player);
    g.lizhiDeclareDapai[player] = true;
    expect(g.getForcedLizhiKanCandidates(player)).toEqual([]);
    expect(g.declareKan(player, 'p1111')).toBeNull();
    g.lizhiDeclareDapai[player] = false;
    expect(g.getForcedLizhiKanCandidates(player)).toContain('p1111');
    expect(g.canNukiBei(player)).toBe(false);
    expect(() => g.dapai('z4')).toThrow(/待ち不変カンが必須/);
    expect(g.declareKan(player, 'p1111')).not.toBeNull();
  });

  it('返り東でもシュバ使用権を復活させない', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 2;
    g.state.defen = { 0: 33000, 1: 34000, 2: 33000 };
    g.shuvariUsed[0] = true;
    g.nextRound({ winner: 2 });
    expect(g.state.changbang).toBe(0);
    expect(g.state.jushu).toBe(0);
    expect(g.shuvariUsed[0]).toBe(true);
  });

  it('本役満ロンと面前の清一色・二盃口祝儀を併算する', () => {
    const { ctx, calls } = chipContext();
    applyChipsOnHule(ctx, {
      hupai: [{ name: '清一色', fanshu: 6 }, { name: '二盃口', fanshu: 3 }],
      damanguan: 1,
    }, 0, 1);
    expect(calls).toContainEqual({ mode: 'ron', chips: 10, label: '役満ロン ×1' });
    expect(calls).toContainEqual({ mode: 'oall', chips: 25, label: 'ホンイツ等 面前役' });
  });

  it('本役満の13翻超過祝儀をロンでも放銃者払いにする', () => {
    const { ctx, calls } = chipContext();
    applyChipsOnHule(ctx, {
      hupai: [{ name: '役A', fanshu: 10 }, { name: '役B', fanshu: 6 }],
      damanguan: 1,
    }, 0, 1);
    expect(calls).toContainEqual({ mode: 'ron', chips: 3, label: '役満ロン 13翻超過 ×3 [夏除く]' });
  });
});
