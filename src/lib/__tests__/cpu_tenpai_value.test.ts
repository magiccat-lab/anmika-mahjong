// CPU 打牌: テンパイ候補の手の価値 [2026-10-28 3 者合議]。
// 同シャンテン ・ 同受け入れの同点崩しだけに効く。受け入れは落とさない / 押し引き ・ 強制ツモ切り ・ テンパイ前は変えない。
import { describe, it, expect, vi } from 'vitest';
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { Game3, buildShoupai, type DiscardAdviceRow } from '../game3';
import type { PlayerId } from '../types';
import {
  CHIP_PER_POINT, TSUMO_SHARE, anmikaHuleRule, chipEnvOf, CPU_SW_KINDS, swapM7, tenpaiWinValue, winDetail, winValue,
} from '../game3/cpuValue';
import * as toolsChipValue from '../../../tools/lib/chip_value.mts';
import * as cpuValue from '../game3/cpuValue';

const P0 = 0 as PlayerId;

/** 13 枚 + ツモ 1 枚の局面。ドラ表示は手に絡まない m7 [= ドラ m9] にする */
function setup(tiles13: string[], zimo: string, indicator = 'm7'): Game3 {
  const g = new Game3();
  g.qipai();
  g.shoupai.set(P0, buildShoupai(tiles13));
  (g.shoupai.get(P0) as any).zimo(zimo);
  (g.shan as any).setBaopai([indicator], null);
  return g;
}

const rowsOf = (g: Game3) => (g as any).evaluateDiscardRows_(P0) as {
  rows: DiscardAdviceRow[]; foldMode: boolean; forced: string | null; valueOf: (r: DiscardAdviceRow) => number;
};
const rowOf = (ev: ReturnType<typeof rowsOf>, pai: string) => ev.rows.find((r) => r.pai === pai || r.pai === `${pai}_`)!;
const select = (g: Game3, rows: DiscardAdviceRow[], fold: boolean, valueOf?: (r: DiscardAdviceRow) => number) =>
  (g as any).selectBestFromRows_(rows, fold, valueOf) as string | null;

const row = (pai: string, over: Partial<DiscardAdviceRow> = {}): DiscardAdviceRow => ({
  pai, base: pai, xiangting: 0, ukeire: 4, safety: 0, hasLizhiOpponent: false, prio: 0, dropsNiji: false, forced: null, ...over,
});

// p123 p789 z66 z11 + s2345: s2 か s5 を切ればどちらも z1 / z6 のシャンポン待ち [受け入れ同じ]
const SHAMPON = ['p1', 'p2', 'p3', 'p7', 'p8', 'p9', 'z6', 'z6', 'z1', 'z1', 's2', 's3', 's4'];

describe('テンパイ候補の価値: 同点崩し', () => {
  it('同じ待ちでも、ドラを残す方を切らずに残す [従来は prio で s2 切り]', () => {
    const g = setup(SHAMPON, 's5', 's1'); // 表示 s1 → ドラ s2
    const ev = rowsOf(g);
    const s2 = rowOf(ev, 's2');
    const s5 = rowOf(ev, 's5');
    expect([s2.xiangting, s5.xiangting]).toEqual([0, 0]);
    expect(s2.ukeire).toBe(s5.ukeire);
    expect(ev.valueOf(s5)).toBeGreaterThan(ev.valueOf(s2));
    // 従来ロジック [valueOf 無し] は prio の高い s2 [2 は +1]
    expect(select(g, ev.rows, false)).toBe(s2.pai);
    expect(g.pickBestDiscard(P0)).toBe(s5.pai);
  });

  it('ドラが関係しなければ従来どおり [prio → 候補順]', () => {
    const g = setup(SHAMPON, 's5', 'm7');
    const ev = rowsOf(g);
    expect(ev.valueOf(rowOf(ev, 's5'))).toBeCloseTo(ev.valueOf(rowOf(ev, 's2')), 6);
    expect(g.pickBestDiscard(P0)).toBe(select(g, ev.rows, false));
  });

  it('adviseDiscard の recommended は pickBestDiscard と同じで、先頭に並ぶ', () => {
    const g = setup(SHAMPON, 's5', 's1');
    const adv = g.adviseDiscard(P0, 5);
    expect(adv[0].recommended).toBe(true);
    expect(adv[0].pai).toBe(g.pickBestDiscard(P0));
  });

  it('受け入れは落とさない: 価値が高くても受け入れが少ない方は選ばない', () => {
    const g = setup(SHAMPON, 's5');
    const rows = [row('a', { ukeire: 4 }), row('b', { ukeire: 3 })];
    const valueOf = (r: DiscardAdviceRow) => (r.pai === 'b' ? 1000 : 1);
    expect(select(g, rows, false, valueOf)).toBe('a');
  });

  it('シャンテンも落とさない: 価値はテンパイ [xt 0] 同士の比べにだけ使う', () => {
    const g = setup(SHAMPON, 's5');
    const valueOf = vi.fn((r: DiscardAdviceRow) => (r.pai === 'b' ? 1000 : 1));
    const rows = [row('a', { xiangting: 0, ukeire: 4 }), row('b', { xiangting: 1, ukeire: 20 })];
    expect(select(g, rows, false, valueOf)).toBe('a');
  });

  it('価値が同じなら従来の prio → 候補順', () => {
    const g = setup(SHAMPON, 's5');
    const same = () => 7;
    expect(select(g, [row('a', { prio: 0 }), row('b', { prio: 2 }), row('c', { prio: 2 })], false, same)).toBe('b');
    expect(select(g, [row('a'), row('b')], false, same)).toBe('a');
  });

  it('テンパイ前 [xt >= 1] は価値を呼ばず、従来どおり', () => {
    const g = setup(SHAMPON, 's5');
    const valueOf = vi.fn(() => 999);
    const rows = [row('a', { xiangting: 1, prio: 3 }), row('b', { xiangting: 1, prio: 1 }), row('c', { xiangting: 1, prio: 3 })];
    expect(select(g, rows, false, valueOf)).toBe(select(g, rows, false));
    expect(valueOf).not.toHaveBeenCalled();
  });

  it('押し引き [foldMode] は価値で動かない', () => {
    const g = setup(SHAMPON, 's5');
    const rows = [row('a', { safety: 10 }), row('b', { safety: 10 }), row('c', { safety: -5 })];
    const favorC = (r: DiscardAdviceRow) => (r.pai === 'c' ? 1000 : r.pai === 'b' ? 500 : 0);
    expect(select(g, rows, true, favorC)).toBe(select(g, rows, true));
    expect(select(g, rows, true, favorC)).toBe('a');
  });

  it('実局面の押し引き: 他家リーチ中で 2 シャンテン以上なら従来の安全度優先のまま', () => {
    const g = setup(['p1', 'p4', 'p7', 's1', 's4', 's7', 'z1', 'z2', 'z3', 'z5', 'z6', 'm7', 'm9'], 'z7');
    g.lizhi.add(1 as PlayerId);
    const ev = rowsOf(g);
    expect(ev.foldMode).toBe(true);
    expect(g.pickBestDiscard(P0)).toBe(select(g, ev.rows, ev.foldMode));
  });

  it('立直済みのツモ切り強制は従来どおり', () => {
    const g = setup(SHAMPON, 's5');
    g.lizhi.add(P0);
    (g as any).lizhiDeclareDapai = { 0: false, 1: false, 2: false };
    const ev = rowsOf(g);
    expect(ev.forced).toBe('lizhi');
    expect(g.pickBestDiscard(P0)).toBe('s5');
  });
});

describe('テンパイ候補の価値: 中身', () => {
  const sw = (s: string) => swapM7(Majiang.Shoupai.fromString(s));
  const param = (lizhi: number) => Majiang.Util.hule_param({ rule: anmikaHuleRule(), lizhi });
  const env = { nuki: 0, fuyu: 0, hua: 0, fulou: false, shuba: false, nInd: 1 };
  const unseen = () => 3;

  it('フリテン: ロンは 0 でツモだけ数える', () => {
    const h = sw('p123p789s456z66z11');
    const waits = [{ tile: 'z6', remaining: 2 }, { tile: 'z1', remaining: 2 }];
    const o = { param: param(1), env, unseen, feverTier: 0, furiten: false };
    const normal = tenpaiWinValue(h, waits, o);
    const fur = tenpaiWinValue(h, waits, { ...o, furiten: true });
    const tsumoOnly = waits.reduce((a, w) => a + w.remaining * TSUMO_SHARE * winValue(h, w.tile, true, param(1), env, CPU_SW_KINDS, unseen, 0), 0);
    expect(fur).toBeCloseTo(tsumoOnly, 6);
    expect(fur).toBeGreaterThan(0);
    expect(fur).toBeLessThan(normal);
    // ロンの値そのものが 0 の扱いではなく、ロンを含めた通常は「ツモ 1/3 + ロン 2/3」
    const full = waits.reduce((a, w) => a + w.remaining * (TSUMO_SHARE * winValue(h, w.tile, true, param(1), env, CPU_SW_KINDS, unseen, 0)
      + (1 - TSUMO_SHARE) * winValue(h, w.tile, false, param(1), env, CPU_SW_KINDS, unseen, 0)), 0);
    expect(normal).toBeCloseTo(full, 6);
  });

  it('実局面のフリテン: 待ち牌が自分の河にあると価値が下がる', () => {
    const g = setup(SHAMPON, 's5');
    const ev = rowsOf(g);
    const r = rowOf(ev, 's5');
    const before = ev.valueOf(r);
    const g2 = setup(SHAMPON, 's5');
    (g2.he.get(P0) as any)._pai = ['z6'];
    const ev2 = rowsOf(g2);
    const r2 = rowOf(ev2, 's5');
    expect(r2.ukeire).toBeLessThanOrEqual(r.ukeire);
    expect(ev2.valueOf(r2)).toBeLessThan(before);
    expect(ev2.valueOf(r2)).toBeGreaterThan(0);
  });

  it('役なし [鳴いたタンヤオ無しヤクハイ無し] は 0、閉じた手は立直前提で 0 より大きい', () => {
    const open = sw('m99p12345s123,p777-');
    const closed = sw('m99p12345777s123');
    const waits = [{ tile: 'p3', remaining: 3 }, { tile: 'p6', remaining: 4 }];
    const mk = (menzen: boolean) => ({ param: param(menzen ? 1 : 0), env: { ...env, fulou: !menzen }, unseen, feverTier: 0, furiten: false });
    expect(tenpaiWinValue(open, waits, mk(false))).toBe(0);
    expect(tenpaiWinValue(closed, waits, mk(true))).toBeGreaterThan(0);
    expect(winDetail(open, 'p6', false, param(0), env, CPU_SW_KINDS, unseen, 0).value).toBe(0);
  });

  it('実局面の役なし: 鳴いた手の役なし待ちは価値 0、同じ形の閉じた手は価値あり', () => {
    const g = new Game3();
    g.qipai();
    g.shoupai.set(P0, Majiang.Shoupai.fromString('m99p12345s123s9,p777-'));
    (g.shan as any).setBaopai(['m7'], null);
    const evO = rowsOf(g);
    const rO = evO.rows.find((r) => r.xiangting === 0)!;
    expect(rO).toBeTruthy();
    expect(evO.valueOf(rO)).toBe(0);
    const g2 = setup(['m9', 'm9', 'p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p7', 'p7', 's1', 's2', 's3'], 's9');
    const ev2 = rowsOf(g2);
    const r2 = ev2.rows.find((r) => r.xiangting === 0)!;
    expect(ev2.valueOf(r2)).toBeGreaterThan(0);
  });

  it('北単騎は役満でなければ 0', () => {
    const h = sw('p123p789s456z66z4');
    const o = { param: param(1), env, unseen, feverTier: 0, furiten: false };
    expect(tenpaiWinValue(h, [{ tile: 'z4', remaining: 3 }], o)).toBe(0);
  });

  const withTiles = (mid: string, a: string[]): number => {
    // p123 [mid 3 枚が 4 5 6 の形] + z66 z11 + s234、s9 を切ってテンパイ [p 部分だけ差し替える]
    const g = setup(['p1', 'p2', 'p3', 'p4', mid, 'p6', ...a, 's2', 's3', 's4'], 's9');
    const ev = rowsOf(g);
    return ev.valueOf(ev.rows.find((r) => r.xiangting === 0)!);
  };
  const HONORS = ['z6', 'z6', 'z1', 'z1'];

  it('赤 5 < 金 5 の順にチップが乗る [既存の winChips と同じ数え方]', () => {
    const plain = withTiles('p5', HONORS);
    const red = withTiles('p0', HONORS);
    const gold = withTiles('gp', HONORS);
    expect(red).toBeGreaterThan(plain);
    expect(gold).toBeGreaterThan(red);
  });

  it('虹 [np3] を持つとチップが乗る', () => {
    const g = setup(['p1', 'p2', 'np3', 'p4', 'p5', 'p6', ...HONORS, 's2', 's3', 's4'], 's9');
    const ev = rowsOf(g);
    const v = ev.valueOf(ev.rows.find((r) => r.xiangting === 0)!);
    expect(v).toBeGreaterThan(withTiles('p5', HONORS));
  });

  it('ぽっち z5 の対子は他の三元牌の対子と同じ値 [z5 だけ特別扱いしない]', () => {
    const z6 = withTiles('p5', ['z6', 'z6', 'z1', 'z1']);
    const z5 = withTiles('p5', ['z5', 'z5', 'z1', 'z1']);
    expect(z5).toBeCloseTo(z6, 6);
  });

  it('北を抜いてあると祝儀に乗る [chipEnvOf の nuki]', () => {
    const g = setup(SHAMPON, 's5');
    const ev0 = rowsOf(g);
    const v0 = ev0.valueOf(rowOf(ev0, 's5'));
    const g2 = setup(SHAMPON, 's5');
    g2.nukidora[P0] = 2;
    expect(chipEnvOf(g2, P0).nuki).toBe(2);
    const ev1 = rowsOf(g2);
    expect(ev1.valueOf(rowOf(ev1, 's5'))).toBeGreaterThan(v0);
  });
});

describe('cpuValue への移設: tools の chip_value は同じ物を返す', () => {
  it('re-export が同一', () => {
    for (const k of ['winValue', 'winChips', 'swapM7', 'unswapM1', 'chipEnvOf', 'kanpamanValue', 'CHIP_PER_POINT', 'doraOf', 'uraExpect', 'aliceExpect', 'handCounts']) {
      expect((toolsChipValue as any)[k]).toBe((cpuValue as any)[k]);
    }
    expect(CHIP_PER_POINT).toBeCloseTo(0.00165, 8);
  });
});
