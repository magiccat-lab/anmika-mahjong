// CPU のリーチ宣言まわりの選択 [2026-07-20 リョー指示: CPU の性能向上]
//
// この卓は面前ダマ和了が禁止なので「リーチするか」は迷わない。
// 迷うのは以下の 2 つで、どちらも今まで先頭固定 / 無条件だった。
//   1. どの牌で宣言するか [= どの待ちでテンパイを固定するか]
//   2. フィーバーを乗せるか [乗せると待ちが宣言時点で固定される]
import { getTingpaiList } from '../game3/tingpai';
import { toCorePai } from '../helpers';
import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

/** その牌を切った後の待ち牌一覧。切れない牌なら null */
function tingAfterDiscard(game: Game3, player: PlayerId, pai: string): string[] | null {
  const sp = game.shoupai.get(player);
  if (!sp) return null;
  try {
    const clone = sp.clone();
    clone.dapai(pai);
    return getTingpaiList(clone);
  } catch {
    return null;
  }
}

export interface LizhiDapaiChoice {
  pai: string | null;
  waitKinds: number;
}

/**
 * リーチ宣言牌を待ちの広さで選ぶ。
 * 旧実装は候補配列の先頭固定で、ukeire 計算があるのに宣言牌には効いていなかった。
 * 同じ待ち種類数なら、先に来た候補 [= 既存の並び順] を維持する。
 */
export function pickLizhiDapai(
  game: Game3,
  player: PlayerId,
  candidates: readonly string[],
): LizhiDapaiChoice {
  let best: string | null = null;
  let bestKinds = -1;
  for (const raw of candidates) {
    const pai = raw.replace(/[_*]$/, '');
    // 北は河に切れない [北抜き専用]
    if (toCorePai(pai) === 'z4') continue;
    const ting = tingAfterDiscard(game, player, pai);
    if (!ting) continue;
    if (ting.length > bestKinds) {
      bestKinds = ting.length;
      best = pai;
    }
  }
  if (best === null) {
    const fallback = candidates[0]?.replace(/[_*]$/, '') ?? null;
    return { pai: fallback, waitKinds: 0 };
  }
  return { pai: best, waitKinds: bestKinds };
}

/**
 * 宣言牌を切った後の待ち種類数。フィーバーを取るかどうかの判断材料にする用。
 *
 * フィーバー見送りロジックは今は入れていない。待ちが固定される代わりに
 * 他家がツモ切り強制になる利点があり、どちらが勝つかはリョーの裁定待ち
 * [四暗刻単騎のように待ち 1 種でも取るべき手がある]。
 */
export function feverWaitKinds(game: Game3, player: PlayerId, feverDapai: string): number {
  const ting = tingAfterDiscard(game, player, feverDapai.replace(/[_*]$/, ''));
  return ting?.length ?? 0;
}
