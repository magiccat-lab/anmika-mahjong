// CPU の鳴き [ポン / 大明槓 / 暗槓・加槓] の判断を 1 か所にまとめる。
//
// 以前は single [store.ts] と online [server/authority.ts applyAutomaticCpuFulou /
// server/ws_server.ts turnTimeoutAction] に同じ規則が 2 本ずつ書かれていた。ここは
// 「鳴くか」だけを返す純関数で、実際の declarePon 等と state 遷移は呼び出し側に残す。
//
// 規則:
//   - チーは無い [三麻]
//   - 三元牌 [z5-z7] は常にポン / 大明槓
//   - 風牌 [z1-z3] は場風 or その席の自風の時だけポン / 大明槓
//   - 数牌 / オタ風はポンのみ。副露 1 つ以上 かつ 現シャンテン <= 2 かつ ポンで
//     シャンテンが下がる時だけ。7 は絶対に鳴かない [フィーバー権が飛ぶため]
//   - 大明槓は三元牌 + 役牌風だけ
//   - 暗槓 / 加槓は三元牌の 4 枚揃いだけ
//   - 七対子 / 全虹の芽がある手は見送る [shouldSkipPonForFever]。
//     ※ online はこの見送りを今まで通していない。差分は opts.feverSkip で保つ
import { toCorePai } from '../helpers';
import { shouldSkipPonForFever } from './cpuFever';
import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

export interface CpuCallOptions {
  /**
   * 七対子 / 全虹の芽がある手のポン・大明槓を見送るか。
   * single は true。online [authority.ts] は従来これを通していないので false を渡す。
   * 2 つを揃えるかどうかは別判断なのでここでは既定値を置かない。
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
  | 'kan-not-honor';

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

/** CPU の seat が discarded をポンするか */
export function decideCpuPon(game: CallGame, seat: PlayerId, discarded: string, opts: CpuCallOptions): CpuCallDecision {
  const core = toCorePai(discarded);
  const c = classify(core);
  if (opts.feverSkip && shouldSkipPonForFever(game as Game3, seat)) {
    return { call: false, reason: 'fever-skip' };
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

/** getKanCandidates の結果から CPU が自動で槓する三元牌の mianzi だけを残す [順序は保つ] */
export function filterCpuAutoKan(kanMianzis: readonly string[]): string[] {
  return kanMianzis.filter((m) => {
    const head = `${m[0]}${m[1]}`;
    return head === 'z5' || head === 'z6' || head === 'z7';
  });
}
