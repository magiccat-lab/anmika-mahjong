// 2026-10-09 リョー報告「打点がおかしい 夏がドラを認識してなさそう」→「表示満貫になってたしマンさん筋肉発動してたよ」。
// 5 翻 50 符の満貫を夏で跳満 [基本点 2000→3000] に上げた手で、点は跳満なのに
// 和了パネルの段は「満貫」、面前満貫 3→29 [マンさん筋肉] も発動していた。
// 夏は満貫以上だと翻を増やさず _basePointOverride だけ上げるので、翻から段を見ると取り違える。
import { describe, it, expect } from 'vitest';
import { applyChipsOnHule, type HuleChipCtx } from '../game3/huleChip';
import { effectiveLevel, natsuBasePoint, BASE_POINT_TIER } from '../helpers';

function ctxWith(calls: Array<{ chips: number; label?: string }>): HuleChipCtx {
  const hand = { _bingpai: { m: [0], p: [1, 0, 0, 0, 0, 0], s: [0], z: [0], __anmika: {} }, _fulou: [] };
  return {
    shoupai: new Map([[0, hand]]),
    he: new Map(),
    goldHand: { 0: { p: 0, s: 0, z: 0 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } },
    pochiHand: { 0: {}, 1: {}, 2: {} } as any,
    huapai: { 0: ['f2'], 1: [], 2: [] },
    nukidora: { 0: 0, 1: 0, 2: 0 },
    nukidoraGold: { 0: 0, 1: 0, 2: 0 },
    kinpeiTarget: { 0: null, 1: null, 2: null },
    lizhi: new Set(),
    openLizhi: new Set(),
    feverActive: { 0: false, 1: false, 2: false },
    fuyuConsumed: { 0: false, 1: false, 2: false },
    shan: { baopai: [], fubaopai: [], _pai: [] },
    applyChipOall: (_w, chips, opts) => calls.push({ chips, label: opts?.label }),
    applyChipFromLoser: (_w, _l, chips, opts) => calls.push({ chips, label: opts?.label }),
  } as HuleChipCtx;
}

describe('夏で上げた段 [2026-10-09 マンさん筋肉]', () => {
  it('満貫を夏で跳満に上げた手は 面前満貫 3→29 の対象外', () => {
    const calls: Array<{ chips: number; label?: string }> = [];
    applyChipsOnHule(ctxWith(calls), {
      hupai: [{ name: '一発', fanshu: 1 }, { name: '夏 [打点ランクアップ 2000→3000基本点]', fanshu: 0 }],
      fanshu: 5, fu: 50, damanguan: 0, _basePointOverride: 3000,
    }, 0, 1);
    expect(calls.some((c) => c.label === '面前満貫 3枚→29枚')).toBe(false);
  });

  it('夏で満貫に届いた手 [4 翻 25 符 → 5 翻] は対象', () => {
    const calls: Array<{ chips: number; label?: string }> = [];
    applyChipsOnHule(ctxWith(calls), {
      hupai: [{ name: '一発', fanshu: 1 }, { name: '夏 [打点ランクアップ 1600→2000基本点]', fanshu: 1 }],
      fanshu: 5, fu: 25, damanguan: 0,
    }, 0, 1);
    expect(calls).toContainEqual({ chips: 26, label: '面前満貫 3枚→29枚' });
  });

  it('段は基本点から取る。_basePointOverride が落ちても hupai の文言から読める', () => {
    expect(effectiveLevel({ fanshu: 5, fu: 50, _basePointOverride: 3000 })).toBe(5);
    expect(effectiveLevel({ fanshu: 5, fu: 50, hupai: [{ name: '夏 [打点ランクアップ 2000→3000基本点]', fanshu: 0 }] })).toBe(5);
    expect(natsuBasePoint({ hupai: [{ name: '夏夏 [打点ランクアップ 2000→4000基本点]', fanshu: 0 }] })).toBe(4000);
    expect(BASE_POINT_TIER[natsuBasePoint({ _basePointOverride: 3000 }) as number].label).toBe('跳満');
    // 夏が無い手は今までどおり翻から
    expect(effectiveLevel({ fanshu: 5, fu: 30 })).toBe(4);
    expect(natsuBasePoint({ fanshu: 5, fu: 30, hupai: [{ name: '立直', fanshu: 1 }] })).toBeNull();
  });
});
