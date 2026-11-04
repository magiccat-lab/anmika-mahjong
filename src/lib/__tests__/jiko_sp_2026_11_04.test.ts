// [2026-11-04 リョー 隠し演出] フィーバー中の逆で 50 枚以上消えた時だけ暗転して曲を流す [lib/jikoSp.ts]
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';
import { jikoSpFor, JIKO_SP_MIN_LOSS } from '../jikoSp';
import { pochiOpeningRows } from '../fxOdds';

function armFeverTsumo(reverse: boolean, fever = true): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.lizhi.add(cur);
  g.feverActive[cur] = fever;
  g.feverDeclareTing[cur] = fever ? ['m5'] : [];
  g.pochiMultiplier[cur] = reverse ? { defen: -1, chip: -1 } : { defen: 1, chip: 1 };
  g.pochiPaymentMode[cur] = reverse;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  return { s, g, cur };
}

const hit = (player: number, result: any) => jikoSpFor([{ player, result }], '0-0-0');

describe('隠し演出 jikoSp: 出る条件', () => {
  const base = { _feverAtHule: true, _pochiPaymentApplied: true };
  it('フィーバー中 ・ 逆 ・ 50 枚以上減ったら出る', () => {
    expect(hit(1, { ...base, chipTransfer: { delta: { 0: 25, 1: -50, 2: 25 } } })).toEqual({ key: '0-0-0-1-50', player: 1, loss: 50, pochi: 'yellow' });
  });
  it('49 枚なら出ない', () => {
    expect(hit(1, { ...base, chipTransfer: { delta: { 0: 25, 1: -49, 2: 24 } } })).toBeNull();
  });
  it('フィーバーでない逆 ・ フィーバー中の正では出ない', () => {
    const d = { chipTransfer: { delta: { 0: 30, 1: -60, 2: 30 } } };
    expect(hit(1, { ...d, _pochiPaymentApplied: true })).toBeNull();
    expect(hit(1, { ...d, _feverAtHule: true })).toBeNull();
  });
  it('チップの移動が無い結果では出ない', () => {
    expect(hit(1, { ...base })).toBeNull();
  });
  it('ダブロンは条件に合う和了を拾う', () => {
    const r = jikoSpFor([
      { player: 0, result: { chipTransfer: { delta: { 0: 10, 1: -10, 2: 0 } } } },
      { player: 2, result: { ...base, chipTransfer: { delta: { 0: 40, 1: 40, 2: -80 } } } },
    ], 'k');
    expect(r?.player).toBe(2);
    expect(r?.loss).toBe(80);
  });
  it('演出一覧には載せない', () => {
    expect(JSON.stringify(pochiOpeningRows())).not.toMatch(/事故|jiko/);
    expect(JIKO_SP_MIN_LOSS).toBe(50);
  });
});

describe('隠し演出 jikoSp: 和了の結果にフィーバーの印が付く', () => {
  beforeEach(() => { game.reset(); });
  it('フィーバー中の逆のツモは _feverAtHule と _pochiPaymentApplied が立ち、和了者のチップが減る', () => {
    const { cur } = armFeverTsumo(true);
    game.tsumo();
    const st: any = get(game);
    const r = st.lastHuleResult;
    expect(st.lastWinner).toBe(cur);
    expect(r._feverAtHule).toBe(true);
    expect(r._pochiPaymentApplied).toBe(true);
    expect(r.chipTransfer.delta[cur]).toBeLessThanOrEqual(0);
    expect(r._pochiReverseColor).toBe('yellow');
  });
  it('赤の逆 (チップ -2 倍) なら浮かべるぽっちは赤', () => {
    const { g, cur } = armFeverTsumo(true);
    g.pochiMultiplier[cur] = { defen: -1, chip: -2 };
    game.tsumo();
    const r: any = get(game).lastHuleResult;
    expect(r._pochiReverseColor).toBe('red');
    expect(jikoSpFor([{ player: cur, result: { ...r, chipTransfer: { delta: { [cur]: -60 } } } }], 'k')?.pochi).toBe('red');
  });
  it('フィーバーでない時は _feverAtHule が false', () => {
    armFeverTsumo(true, false);
    game.tsumo();
    const r: any = get(game).lastHuleResult;
    expect(r?._feverAtHule).toBe(false);
  });
});
