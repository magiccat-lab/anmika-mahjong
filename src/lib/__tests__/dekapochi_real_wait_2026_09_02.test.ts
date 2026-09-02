// 2026-09-02 リョー裁定「でかぽっちの本待ち」回帰固定。
//
// でかぽっち = リーチ一発中に p1/p2 をツモると緑 [p1] / 黄 [p2] ぽっち扱い
// [zimo() が shan.lastZimoPochi + 黄倍率 [逆払い] + 金北自動確定、hule() が swap 上書き +
// 「でかぽっち オールマイティ」役、applyHule が でかぽっち サイコロ base35]。
// 新裁定: ツモ前の待ち [getTingpaiListBeforeZimo] にその p1/p2 が本物の待ちとして含まれる
// [本待ち] なら通常ツモ和了。ぽっち扱いの副作用 [色 / 倍率 / 金北自動 / swap / 役 / サイコロ]
// を一切付けず、支払いも通常 [正] のまま。待ちに含まれない時は旧挙動 [p2=黄 逆払い / p1=緑] 不変。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

type Store = ReturnType<typeof createGameStore>;

/** store action は毎回 `{ ...s }` で state object を作り直すので、読む度に get する */
const read = (store: Store): any => get(store as any);

const NEUTRAL = { defen: 1, chip: 1 };
const YELLOW = { defen: -1, chip: -1 };

/** 現手番を人間、他 2 家を CPU にし、乱数配牌由来の華 / 金 / ぽっち / 嶺上状態を全て消して決定論化する */
function prepareHumanTurn(): { store: Store; game: Game3; player: PlayerId; others: PlayerId[] } {
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
  return { store, game, player, others };
}

/** 表 / 裏ドラ表示を華・ぽっち無しに固定 [神ぽっち modal / 金北候補の混入を避ける] */
function pinDora(game: Game3, baopai: string[], fubaopai: string[] = ['z2', 'z2']): void {
  const shan: any = game.shan;
  shan._baopai = [...baopai];
  shan._fubaopai = [...fubaopai];
  shan.commitDoraReveal?.();
}

/**
 * 13 枚の手牌をセット → 立直 + 一発 → 山の次ツモを pai に固定 → 本物の game.zimo() を走らせる。
 * Shan3.zimo は live wall `_pai` の末尾を pop するので末尾を差し替えれば決定論的に pai が来る。
 * でかぽっち判定 [zimo 内の色付け / 倍率 / 金北自動] は zimo() の中で走るため、
 * 手動で sp.zimo() する既存テストの形では踏めない。
 */
function riichiYifaDraw(hand: string[], pai: string) {
  const ctx = prepareHumanTurn();
  const { store, game, player } = ctx;
  game.shoupai.set(player, buildShoupai(hand));
  game.lizhi.add(player);
  game.yifaActive[player] = true;
  pinDora(game, ['z2', 'z2']);
  const shan: any = game.shan;
  shan._pai[shan._pai.length - 1] = pai;

  const tingBefore = game.getTingpaiListBeforeZimo(player);
  const multBefore = { ...game.pochiMultiplier[player] };
  const defenBefore = { ...game.state.defen };
  const kinpeiAuto = vi.spyOn(game, 'autoResolveKinpei');

  const drawn = game.zimo();
  expect(drawn).toBe(pai);
  read(store).lastZimo = drawn;
  return { ...ctx, tingBefore, multBefore, defenBefore, kinpeiAuto };
}

/** ツモ和了を store 経由で確定させ、途中 modal が開いていない事を確認して state を返す */
function tsumoThroughStore(store: Store, player: PlayerId): any {
  store.tsumo();
  const s = read(store);
  expect(s.lastWinner).toBe(player);
  expect(s.lastHuleResult).not.toBeNull();
  expect(s.message).toContain('ツモ和了');
  expect(s.pendingKinpei).toBeNull();
  expect(s.pendingFuyu).toBeNull();
  expect(s.pendingKamiPochi).toBeNull();
  expect(s.pendingPochiSwap).toBeNull();
  expect(s.roundEnded || !!s.pendingSaiKoro).toBe(true);
  return s;
}

const hupaiNames = (result: any): string[] => (result?.hupai ?? []).map((h: any) => String(h.name));
const dekaChances = (chances: any[] | null | undefined): any[] =>
  (chances ?? []).filter((c: any) => c.awardKey === 'でかぽっち');

/** 本待ち = 通常ツモ: ぽっち副作用ゼロ + 正の支払い */
function expectNormalTsumo(ctx: ReturnType<typeof riichiYifaDraw>, pai: 'p1' | 'p2') {
  const { store, game, player, others, multBefore, defenBefore, kinpeiAuto } = ctx;
  expect(game.getTingpaiListBeforeZimo(player)).toContain(pai);

  // zimo(): 色付け無し / 倍率据え置き / 金北自動確定なし
  expect(game.shan.lastZimoPochi ?? null).toBeNull();
  expect(game.lastZimoInfo).toEqual({ player, pai, pochi: null, gold: false });
  expect(game.pochiMultiplier[player]).toEqual(multBefore);
  expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
  expect(game.pochiPaymentMode[player]).toBe(false);
  expect(kinpeiAuto).not.toHaveBeenCalled();

  // hule(): swap 上書きも でかぽっち役も付かない、通常の立直一発ツモ
  expect(game.canTsumo(player)).toBe(true);
  const dry = game.hule(player);
  expect(dry).not.toBeNull();
  expect(hupaiNames(dry).some((n) => n.includes('でかぽっち'))).toBe(false);
  expect(dry._dekapochiSwap).toBeUndefined();
  expect(dry._dekapochiFrom).toBeUndefined();
  expect(hupaiNames(dry).some((n) => n.includes('一発'))).toBe(true);

  // store.tsumo(): 通常 [正] の支払い、でかぽっちサイコロ無し
  const s = tsumoThroughStore(store, player);
  const result = s.lastHuleResult;
  expect(hupaiNames(result).some((n) => n.includes('でかぽっち'))).toBe(false);
  expect(result._dekapochiSwap).toBeUndefined();
  expect(result._pochiPaymentApplied).toBeFalsy();
  expect(result.defen).toBeGreaterThan(0);
  expect(game.state.defen[player]).toBeGreaterThan(defenBefore[player]);
  for (const o of others) expect(game.state.defen[o]).toBeLessThan(defenBefore[o]);
  expect(dekaChances(result.saiKoroChances)).toHaveLength(0);
  expect(dekaChances(s.pendingSaiKoro?.chances)).toHaveLength(0);
  expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
  expect(game.pochiPaymentMode[player]).toBe(false);
  expect(game.shan.lastZimoPochi ?? null).toBeNull();
}

// M0IT journal の形: m77 p33 p5 s44 s55 s66 s88 の七対子 p5 単騎。p1/p2 は待ちに無く、
// swap [p1/p2 → p5] で初めて和了形になる = 旧来の でかぽっち が成立する対照群
const NON_WAIT_CHITOI = ['m7', 'm7', 'p3', 'p3', 'p5', 's4', 's4', 's5', 's5', 's6', 's6', 's8', 's8'];
// p1p3 嵌張 [待ち p2 のみ] + s123 s567 s999 z11
const P2_KANCHAN = ['p1', 'p3', 's1', 's2', 's3', 's5', 's6', 's7', 's9', 's9', 's9', 'z1', 'z1'];
// p2p3 両面 [待ち p1 / p4] + s123 s567 s999 z11
const P1_RYANMEN = ['p2', 'p3', 's1', 's2', 's3', 's5', 's6', 's7', 's9', 's9', 's9', 'z1', 'z1'];

describe('でかぽっち 本待ち裁定 [2026-09-02]: 待ちに本物の p1/p2 が含まれれば通常ツモ', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it('本待ち p2 [p1p3 嵌張] を一発ツモ → 黄ぽっち扱いにならず通常の正払いツモ和了', () => {
    const ctx = riichiYifaDraw(P2_KANCHAN, 'p2');
    expect(ctx.tingBefore).toEqual(['p2']);
    expectNormalTsumo(ctx, 'p2');
  });

  it('対照: 待ちに無い p2 [七対子 p5 単騎] を一発ツモ → 従来通り黄ぽっち [逆払い] + でかぽっち役 + サイコロ', () => {
    const ctx = riichiYifaDraw(NON_WAIT_CHITOI, 'p2');
    const { store, game, player, others, tingBefore, defenBefore, kinpeiAuto } = ctx;
    expect(tingBefore).toContain('p5');
    expect(tingBefore).not.toContain('p2');
    expect(game.getTingpaiListBeforeZimo(player)).not.toContain('p2');

    // zimo(): 黄扱い + 黄倍率 [defen -1 = 逆払い] + 金北自動確定の呼出
    expect(game.shan.lastZimoPochi).toBe('yellow');
    expect(game.lastZimoInfo).toEqual({ player, pai: 'p2', pochi: 'yellow', gold: false });
    expect(game.pochiMultiplier[player]).toEqual(YELLOW);
    expect(game.pochiPaymentMode[player]).toBe(true);
    expect(kinpeiAuto).toHaveBeenCalledTimes(1);

    // hule(): swap [p2→p5] 上書き + でかぽっち役 (黄)
    expect(game.canTsumo(player)).toBe(true);
    const s = tsumoThroughStore(store, player);
    const result = s.lastHuleResult;
    expect(hupaiNames(result)).toContain('でかぽっち オールマイティ [p5] (黄)');
    expect(result._dekapochiSwap).toBe('p5');
    expect(result._dekapochiFrom).toBe('p2');

    // applyHule(): 逆払い [和了者の点が減り他家が増える] + でかぽっちサイコロ base35
    expect(result._pochiPaymentApplied).toBe(true);
    expect(result.defen).toBeLessThan(0);
    expect(game.state.defen[player]).toBeLessThan(defenBefore[player]);
    for (const o of others) expect(game.state.defen[o]).toBeGreaterThan(defenBefore[o]);
    expect(dekaChances(result.saiKoroChances)).toEqual([
      expect.objectContaining({ awardKey: 'でかぽっち', baseChip: 35, plusMinus: '+', mode: 'tsumo' }),
    ]);
    expect(s.pendingSaiKoro).not.toBeNull();
    expect(dekaChances(s.pendingSaiKoro.chances)).toHaveLength(1);
  });

  it('本待ち p1 [p2p3 両面] を一発ツモ → 緑ぽっち扱いにならず通常ツモ和了', () => {
    const ctx = riichiYifaDraw(P1_RYANMEN, 'p1');
    expect(ctx.tingBefore).toEqual(expect.arrayContaining(['p1', 'p4']));
    expectNormalTsumo(ctx, 'p1');
  });

  it('対照: 待ちに無い p1 [七対子 p5 単騎] を一発ツモ → 従来通り緑ぽっち [正払い] + でかぽっち役', () => {
    const ctx = riichiYifaDraw(NON_WAIT_CHITOI, 'p1');
    const { store, game, player, defenBefore, kinpeiAuto } = ctx;
    expect(game.getTingpaiListBeforeZimo(player)).not.toContain('p1');

    // zimo(): 緑扱い。緑は倍率中立で金北自動確定も呼ばない
    expect(game.shan.lastZimoPochi).toBe('green');
    expect(game.lastZimoInfo).toEqual({ player, pai: 'p1', pochi: 'green', gold: false });
    expect(game.pochiMultiplier[player]).toEqual(NEUTRAL);
    expect(game.pochiPaymentMode[player]).toBe(false);
    expect(kinpeiAuto).not.toHaveBeenCalled();

    expect(game.canTsumo(player)).toBe(true);
    const s = tsumoThroughStore(store, player);
    const result = s.lastHuleResult;
    expect(hupaiNames(result)).toContain('でかぽっち オールマイティ [p5] (緑)');
    expect(result._dekapochiSwap).toBe('p5');
    expect(result._pochiPaymentApplied).toBeFalsy();
    expect(game.state.defen[player]).toBeGreaterThan(defenBefore[player]);
    expect(dekaChances(result.saiKoroChances)).toHaveLength(1);
  });
});
