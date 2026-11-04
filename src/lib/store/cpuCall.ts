// CPU の鳴き [ポン / 大明槓 / 暗槓・加槓] の判断を 1 か所にまとめる。
//
// 以前は single [store.ts] と online [server/authority.ts applyAutomaticCpuFulou /
// server/ws_server.ts turnTimeoutAction] に同じ規則が 2 本ずつ書かれていた。ここは
// 「鳴くか」だけを返す純関数で、実際の declarePon 等と state 遷移は呼び出し側に残す。
//
// 規則:
//   - チーは無い [三麻]
//   - 三元牌 [z5-z7] は常にポン / 大明槓 [11-02: 門前で対子がその 1 組だけならポンしない]
//   - 風牌 [z1-z3] は場風 or その席の自風の時だけポン / 大明槓
//   - 数牌 / オタ風はポンのみ。副露 1 つ以上 かつ 現シャンテン <= 2 かつ ポンで
//     シャンテンが下がる時だけ。7 は絶対に鳴かない [フィーバー権が飛ぶため]
//   - 大明槓は三元牌 + 役牌風だけ
//   - 手に同じ牌が 3 枚 [暗刻] ある時はポンしない [11-04 通報 20261104_0。ポンして残りの 1 枚を
//     切っていた。字牌は大明槓の判断へ回し、数牌は暗刻のまま残す]
//   - 暗槓 / 加槓は字牌 [北を除く] の 4 枚揃いだけ [11-02 から風牌も]
//   - 七対子 / 全虹の芽がある手は見送る [shouldSkipPonForFever]。
//     single も online も feverSkip: true [10-28 に online を揃えた]
import { toCorePai } from '../helpers';
import { shouldSkipPonForFever } from './cpuFever';
import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

export interface CpuCallOptions {
  /**
   * 七対子 / 全虹の芽がある手のポン・大明槓を見送るか。
   * single も online も true を渡す [10-28 に揃えた。前は online だけ false]。
   */
  feverSkip: boolean;
}

export type CpuCallReason =
  | 'sanyuan'
  | 'yakuhai-wind'
  | 'number-advance'
  | 'fever-skip'
  | 'seven'
  | 'non-yakuhai-wind'
  | 'number-no-advance'
  | 'kan-not-honor'
  | 'no-pair-left'
  | 'has-triplet';

export interface CpuCallDecision {
  call: boolean;
  reason: CpuCallReason;
}

type CallGame = Pick<Game3, 'changfengZ' | 'zifengZ' | 'shoupai' | 'estimateXiangtingWithExtra'>;

function classify(core: string): { sanyuan: boolean; fengpai: boolean; fengN: number; seven: boolean } {
  const sanyuan = core[0] === 'z' && (core[1] === '5' || core[1] === '6' || core[1] === '7');
  const fengpai = core[0] === 'z' && (core[1] === '1' || core[1] === '2' || core[1] === '3');
  const seven = (core[0] === 'm' || core[0] === 'p' || core[0] === 's') && core[1] === '7';
  return { sanyuan, fengpai, fengN: fengpai ? parseInt(core[1], 10) : -1, seven };
}

/** 三元牌、または場風 / 自風の風牌か [ポンと大明槓に共通] */
export function isCpuHonorCall(game: Pick<Game3, 'changfengZ' | 'zifengZ'>, seat: PlayerId, pai: string): boolean {
  const c = classify(toCorePai(pai));
  if (c.sanyuan) return true;
  return c.fengpai && (c.fengN === game.changfengZ || c.fengN === game.zifengZ(seat));
}

/** ポンしたら現シャンテン <= 2 のまま下がるか [推定が投げたら false] */
function ponAdvancesShanten(game: CallGame, seat: PlayerId, core: string): boolean {
  try {
    const { base, withExtra } = game.estimateXiangtingWithExtra(seat, core);
    return base <= 2 && withExtra < base;
  } catch {
    return false;
  }
}

/** 手の対子 [2 枚以上の種類] の数。majiang-core の [s][5] は赤 ・ 金を含む */
function pairKinds(sp: any): number {
  const bp = sp?._bingpai ?? {};
  let n = 0;
  for (const s of ['m', 'p', 's', 'z'] as const) {
    const arr = bp[s];
    if (!arr) continue;
    for (let i = 1; i < arr.length; i++) if (Number(arr[i] ?? 0) >= 2) n += 1;
  }
  return n;
}

/** 手にその牌が何枚あるか。majiang-core の [s][5] は赤 ・ 金を含む */
function countInHand(game: CallGame, seat: PlayerId, core: string): number {
  const arr = (game.shoupai.get(seat) as any)?._bingpai?.[core[0]];
  return Number(arr?.[parseInt(core[1], 10)] ?? 0);
}

/** 門前で、その対子をポンすると雀頭の候補が残らないか
 *  [cpu-lab 2026-11-02 型 6] 人の対局 [古い 80%] では門前の役牌ポンでも、対子がその 1 組だけの時は 2 割しかポンしない */
function ponLeavesNoPair(game: CallGame, seat: PlayerId): boolean {
  const sp = game.shoupai.get(seat) as any;
  const fulous = (sp?._fulou ?? []) as string[];
  if (fulous.some((m) => /[+=\-]/.test(m))) return false;
  return pairKinds(sp) <= 1;
}

/** CPU の seat が discarded をポンするか */
export function decideCpuPon(game: CallGame, seat: PlayerId, discarded: string, opts: CpuCallOptions): CpuCallDecision {
  const core = toCorePai(discarded);
  const c = classify(core);
  if (opts.feverSkip && shouldSkipPonForFever(game as Game3, seat)) {
    return { call: false, reason: 'fever-skip' };
  }
  // 暗刻からのポンは 4 枚目を河に捨てるだけになる [11-04 通報 20261104_0 白の暗刻からポンして白を切った]
  if (countInHand(game, seat, core) >= 3) return { call: false, reason: 'has-triplet' };
  if ((c.sanyuan || c.fengpai) && ponLeavesNoPair(game, seat)) {
    return { call: false, reason: 'no-pair-left' };
  }
  if (c.sanyuan) return { call: true, reason: 'sanyuan' };
  if (c.fengpai) {
    const ok = c.fengN === game.changfengZ || c.fengN === game.zifengZ(seat);
    return ok ? { call: true, reason: 'yakuhai-wind' } : { call: false, reason: 'non-yakuhai-wind' };
  }
  if (c.seven) return { call: false, reason: 'seven' };
  const fulouCount = ((game.shoupai.get(seat) as any)?._fulou?.length ?? 0) as number;
  if (fulouCount >= 1 && ponAdvancesShanten(game, seat, core)) return { call: true, reason: 'number-advance' };
  return { call: false, reason: 'number-no-advance' };
}

/** CPU の seat が discarded を大明槓するか [三元牌 + 役牌風だけ] */
export function decideCpuDaiminkan(game: CallGame, seat: PlayerId, discarded: string, opts: CpuCallOptions): CpuCallDecision {
  if (opts.feverSkip && shouldSkipPonForFever(game as Game3, seat)) {
    return { call: false, reason: 'fever-skip' };
  }
  const c = classify(toCorePai(discarded));
  if (c.sanyuan) return { call: true, reason: 'sanyuan' };
  if (isCpuHonorCall(game, seat, discarded)) return { call: true, reason: 'yakuhai-wind' };
  return { call: false, reason: 'kan-not-honor' };
}

/** getKanCandidates の結果から CPU が自動で槓する字牌の mianzi だけを残す [順序は保つ]。
 *  [cpu-lab 2026-11-02 型 5] 三元牌だけ → 風牌 [東南西] も。人の対局 [古い 80%] では風牌の暗槓 ・ 加槓を
 *  7〜8 割がしていた [オタ風も同じ]。字牌の槓は手の形を崩さない。北は抜き専用なので入れない */
export function filterCpuAutoKan(kanMianzis: readonly string[]): string[] {
  return kanMianzis.filter((m) => m[0] === 'z' && m[1] !== '4');
}
