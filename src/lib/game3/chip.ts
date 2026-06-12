
// game3.ts から切り出した chip 加算 helpers
// 倍率合成 + breakdown 履歴記録は pure に近い形で context 引数化
import { dlog } from '../helpers';
import type { PochiMultiplier } from './pochi';

export type PlayerId = 0 | 1 | 2;

export type ChipBreakdownEntry = {
  label: string;
  base: number;
  multiplier: number;
  total: number;
  mode: 'oall' | 'ron';
  /** 倍率内訳 [シュバ×2 / フィーバー×N / ぽっち×M 等]、 panel に tooltip 表示 [2026-05-15 機能 D] */
  multiplierParts?: string[];
};

export type ChipState = {
  shuvariActive: Record<PlayerId, boolean>;
  feverActive: Record<PlayerId, boolean>;
  feverTier: Record<PlayerId, 1 | 2 | 3>;
  pochiMultiplier: Record<PlayerId, PochiMultiplier | number>;
  chipLedger: Record<PlayerId, number>;
  chipBreakdown: ChipBreakdownEntry[];
};

export type ChipMulOpts = {
  bypassShuvari?: boolean;
  bypassFever?: boolean;
  bypassPochi?: boolean;
  /** 和了モード: 'tsumo' / 'ron' / undefined。ぽっち chip 倍率は mode に関係なく kyoku 中は適用。 */
  mode?: 'tsumo' | 'ron';
};

export type ChipApplyOpts = ChipMulOpts & { label?: string };

function pochiChipMultiplier(v: unknown): number {
  if (v && typeof v === 'object' && typeof (v as any).chip === 'number') return (v as any).chip;
  if (typeof v === 'number') return v;
  return 1;
}

/** 倍率合成 [シュバ ×2 × フィーバー [1/2/4] × ぽっち pochiMultiplier]
 *  bypass* で個別 skip 可 */
export function computeChipMultiplier(
  st: ChipState,
  target: PlayerId,
  opts: ChipMulOpts = {}
): number {
  return computeChipMultiplierDetail(st, target, opts).multiplier;
}

/** 倍率 + 内訳 [機能 D 2026-05-15]: 上の純数値 helper を 拡張、 panel 表示用 parts も返す */
export function computeChipMultiplierDetail(
  st: ChipState,
  target: PlayerId,
  opts: ChipMulOpts = {}
): { multiplier: number; parts: string[] } {
  let m = 1;
  const parts: string[] = [];
  if (st.shuvariActive[target] && !opts.bypassShuvari) { m *= 2; parts.push('シュバ×2'); }
  if (st.feverActive[target] && !opts.bypassFever) {
    const tier = st.feverTier[target] ?? 1;
    const fm = tier === 3 ? 4 : tier === 2 ? 2 : 1;
    m *= fm; parts.push(`フィーバー tier${tier}×${fm}`);
  }
  // [2026-05-21 リョー仕様] 通常 ron は ぽっち倍率 bypass、 ただし target が
  // フィーバー中なら 「フィーバーリーチ中ぽっちツモ → 局終了まで継続、 ロン毎 payment」
  // 特例で ron 時も pochi 倍率 ON。
  const ronBypassPochi = opts.mode === 'ron' && !st.feverActive[target];
  if (!opts.bypassPochi && !ronBypassPochi) {
    const pm = pochiChipMultiplier(st.pochiMultiplier[target]);
    if (pm !== 1) { m *= pm; parts.push(`ぽっち×${pm}`); }
  }
  if (m !== 1) dlog('[chip multiplier]', { target, m, parts });
  return { multiplier: m, parts };
}

/** ツモオール: target に他家から N ずつ徴収、 倍率込みで chipLedger 更新 + breakdown 記録 */
export function applyChipOall(
  st: ChipState,
  target: PlayerId,
  n: number,
  opts: ChipApplyOpts = {}
): void {
  // [2026-05-15 bug 1 fix] ツモオール経路は ぽっち倍率 適用 [mode='tsumo' 明示]
  // ただし呼出側で mode='ron' [3 倍満ロンでもオール 等] 指定があれば 尊重する
  const tsumoOpts: ChipMulOpts = opts.mode ? opts : { ...opts, mode: 'tsumo' };
  const detail = computeChipMultiplierDetail(st, target, tsumoOpts);
  const m = detail.multiplier;
  const actualN = n * m;
  dlog('[chip oall]', { target, base: n, multiplier: m, total: actualN, label: opts.label ?? '?' });
  st.chipBreakdown.push({ label: opts.label ?? '?', base: n, multiplier: m, total: actualN, mode: 'oall', multiplierParts: detail.parts });
  for (const p of [0, 1, 2] as PlayerId[]) {
    if (p === target) st.chipLedger[p] += actualN * 2;
    else st.chipLedger[p] -= actualN;
  }
}

/** ロン時の放銃者のみから N chip 徴収 */
export function applyChipFromLoser(
  st: ChipState,
  winner: PlayerId,
  loser: PlayerId,
  n: number,
  opts: ChipApplyOpts = {}
): void {
  const ronOpts: ChipMulOpts = opts.mode ? opts : { ...opts, mode: 'ron' };
  const detail = computeChipMultiplierDetail(st, winner, ronOpts);
  const m = detail.multiplier;
  const actualN = n * m;
  dlog('[chip ron]', { winner, loser, base: n, multiplier: m, total: actualN, label: opts.label ?? '?' });
  st.chipBreakdown.push({ label: opts.label ?? '?', base: n, multiplier: m, total: actualN, mode: 'ron', multiplierParts: detail.parts });
  st.chipLedger[winner] += actualN;
  st.chipLedger[loser] -= actualN;
}
