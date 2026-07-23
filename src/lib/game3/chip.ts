
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
  feverTier: Record<PlayerId, 1 | 2 | 3 | 4>;
  pochiMultiplier: Record<PlayerId, PochiMultiplier | number>;
  chipLedger: Record<PlayerId, number>;
  chipBreakdown: ChipBreakdownEntry[];
  /** [2026-07-23 4人回し Phase1] 精算確定 effect の sink。optional [テスト用の素 state 互換] */
  chipEffects?: ChipSettlementEffect[];
};

/** [2026-07-23 4人回し Phase1, Sol設計] チップ精算の確定 effect。
 *  4人回しの room-level 4-way ledger は「サイコロ精算だけ抜け番も頭数に入れる」ため、
 *  ws 層が label 文字列に頼らず精算種別を判別できる型付きの発行点が要る。
 *  perPayer = 倍率適用後の 1 人あたり支払額 [符号込み。逆ぽっち等は負]。 */
export type ChipSettlementKind = 'dice' | 'normal';
export type ChipSettlementEffect = {
  kind: ChipSettlementKind;
  form: 'oall' | 'fromLoser';
  winner: PlayerId;
  loser: PlayerId | null;
  base: number;
  multiplier: number;
  perPayer: number;
  label: string;
};

export type ChipMulOpts = {
  bypassShuvari?: boolean;
  bypassFever?: boolean;
  bypassPochi?: boolean;
  /** 和了モード: 'tsumo' / 'ron' / undefined。ぽっち chip 倍率は mode に関係なく kyoku 中は適用。 */
  mode?: 'tsumo' | 'ron';
};

export type ChipApplyOpts = ChipMulOpts & {
  label?: string;
  /** [2026-07-23 4人回し Phase1] 精算種別。サイコロ精算の呼出だけ 'dice' を明示する */
  settlementKind?: ChipSettlementKind;
};

function pochiChipMultiplier(v: unknown): number {
  if (v && typeof v === 'object' && typeof (v as any).chip === 'number') return (v as any).chip;
  if (typeof v === 'number') return v;
  return 1;
}

/** 倍率合成 [シュバ ×2 × フィーバー [1/2/4/8] × ぽっち pochiMultiplier]
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
    const fm = tier === 4 ? 8 : tier === 3 ? 4 : tier === 2 ? 2 : 1;
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
  // [2026-07-23 4人回し Phase1] ledger 確定と同時に型付き effect を発行 [1精算=1発行]
  st.chipEffects?.push({
    kind: opts.settlementKind ?? 'normal',
    form: 'oall',
    winner: target,
    loser: null,
    base: n,
    multiplier: m,
    perPayer: actualN,
    label: opts.label ?? '?',
  });
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
  // [2026-07-23 4人回し Phase1] ledger 確定と同時に型付き effect を発行 [1精算=1発行]
  st.chipEffects?.push({
    kind: opts.settlementKind ?? 'normal',
    form: 'fromLoser',
    winner,
    loser,
    base: n,
    multiplier: m,
    perPayer: actualN,
    label: opts.label ?? '?',
  });
}
