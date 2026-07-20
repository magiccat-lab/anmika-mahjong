// CPU のリーチ宣言まわりの選択 [2026-07-20 リョー指示]
//
// この卓は面前ダマ和了が禁止なので「リーチするか」自体は迷わない。
// 迷うのは以下の 2 つ。
//   1. どの牌で宣言するか [= どの待ちでテンパイを固定するか]
//   2. フィーバーを乗せるか [乗せると待ちが宣言時点で固定される]
//
// 宣言牌の評価軸 [リョー 2026-07-20:
//   「待ち枚数と打点/祝儀/追いかけリーチの場合は安全度とかも加味したいよね」]:
//   - 待ち残枚数 … 種類数ではなく実際に残っている枚数
//   - 祝儀 … 宣言牌に祝儀源を出すと手から祝儀が消える
//   - 安全度 … 他家リーチへの追いかけ時のみ、放銃リスクを引く
//
// 残枚数は自分の手牌と公開情報 [河 / 副露 / ドラ表示] だけから数える。
// 他家の伏せ牌や山を覗くのは既存 CPU 方針どおり禁止。
import { getTingpaiList } from '../game3/tingpai';
import { toCorePai } from '../helpers';
import { estimateShuvariChip } from './cpuShuvari';
import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

/** 待ち 1 枚あたりの価値 */
const W_WAIT = 1.0;
/** 祝儀 1 枚あたりの価値。和了れて初めて入るので待ちより軽く見る */
const W_CHIP = 0.5;
/** 追いかけリーチで危険牌を宣言牌にした時のペナルティ */
const W_DANGER = 6.0;

/** 牌を「4 枚 1 種」に正規化した key [赤 / 金 / 虹 / ぽっちは通常牌と同じ種] */
function tileKey(pai: string): string {
  const core = toCorePai(String(pai).replace(/[+=\-_*]/g, ''));
  if (core.length < 2) return '';
  const suit = core[0];
  const num = core[1] === '0' ? '5' : core[1];
  return `${suit}${num}`;
}

/** 公開情報 [全員の河 / 全員の副露 / ドラ表示牌] に見えている枚数 */
function visibleCount(game: Game3, key: string): number {
  let seen = 0;
  for (const p of [0, 1, 2] as PlayerId[]) {
    const sp = game.shoupai.get(p);
    for (const mianzi of ((sp as any)?._fulou ?? []) as string[]) {
      const stripped = mianzi.replace(/[+=\-_*]/g, '');
      if (stripped.length < 2) continue;
      const suit = stripped[0];
      for (let i = 1; i < stripped.length; i++) {
        const n = stripped[i];
        if (n < '0' || n > '9') continue;
        if (tileKey(`${suit}${n}`) === key) seen += 1;
      }
    }
    const he = game.he.get(p);
    for (const d of ((he as any)?._pai ?? []) as string[]) {
      if (tileKey(d) === key) seen += 1;
    }
  }
  for (const b of ((game.shan as any)?.baopai ?? []) as string[]) {
    if (typeof b === 'string' && tileKey(b) === key) seen += 1;
  }
  return seen;
}

/** 手牌に持っている枚数 */
function inHandCount(shoupai: any, key: string): number {
  const bp = shoupai?._bingpai ?? {};
  const suit = key[0];
  const num = Number(key[1]);
  let n = Number(bp[suit]?.[num] ?? 0);
  // majiang-core は赤 [index 0] を 5 の枚数に含めない実装があるため足す
  if ((suit === 'p' || suit === 's') && num === 5) n += Number(bp[suit]?.[0] ?? 0);
  return n;
}

/** その牌を切った後の手牌。切れない牌なら null */
function handAfterDiscard(game: Game3, player: PlayerId, pai: string): any | null {
  const sp = game.shoupai.get(player);
  if (!sp) return null;
  try {
    const clone = sp.clone();
    clone.dapai(pai);
    return clone;
  } catch {
    return null;
  }
}

/** 待ち牌の残り総枚数 [公開情報ベースの推定] */
export function countWaitTiles(game: Game3, player: PlayerId, afterHand: any): number {
  const waits = getTingpaiList(afterHand);
  let total = 0;
  for (const w of waits) {
    const key = tileKey(w);
    if (!key) continue;
    total += Math.max(0, 4 - visibleCount(game, key) - inHandCount(afterHand, key));
  }
  return total;
}

/** 追いかけ対象 [自分以外のリーチ者] */
function lizhiOpponents(game: Game3, player: PlayerId): PlayerId[] {
  return ([0, 1, 2] as PlayerId[]).filter((p) => p !== player && game.lizhi.has(p));
}

/**
 * 宣言牌の危険度 [0 = 現物、1 = 無筋]。
 * 相手の河にある牌は通らない道理が無いので現物扱い、
 * 字牌で場に 3 枚見えていれば単騎以外は当たらないので準安全とする。
 */
export function dangerOf(game: Game3, player: PlayerId, pai: string): number {
  const opponents = lizhiOpponents(game, player);
  if (opponents.length === 0) return 0;
  const key = tileKey(pai);
  if (!key) return 0;
  let worst = 0;
  for (const opp of opponents) {
    const he = game.he.get(opp);
    const discards = ((he as any)?._pai ?? []) as string[];
    if (discards.some((d) => tileKey(d) === key)) continue; // 現物
    if (key[0] === 'z' && visibleCount(game, key) >= 3) {
      worst = Math.max(worst, 0.3);
      continue;
    }
    worst = 1;
  }
  return worst;
}

export interface LizhiDapaiChoice {
  pai: string | null;
  waitKinds: number;
  waitTiles: number;
  score: number;
}

/**
 * リーチ宣言牌を待ち枚数 / 祝儀 / 安全度で選ぶ。
 * 旧実装は候補配列の先頭固定で、ukeire 計算があるのに宣言牌へ効いていなかった。
 */
export function pickLizhiDapai(
  game: Game3,
  player: PlayerId,
  candidates: readonly string[],
): LizhiDapaiChoice {
  let best: LizhiDapaiChoice | null = null;
  for (const raw of candidates) {
    const pai = raw.replace(/[_*]$/, '');
    // 北は河に切れない [北抜き専用]
    if (toCorePai(pai) === 'z4') continue;
    const after = handAfterDiscard(game, player, pai);
    if (!after) continue;
    const waits = getTingpaiList(after);
    if (waits.length === 0) continue;
    const waitTiles = countWaitTiles(game, player, after);
    const chip = estimateShuvariChip(game, player, pai).score;
    const danger = dangerOf(game, player, pai);
    const score = waitTiles * W_WAIT + chip * W_CHIP - danger * W_DANGER;
    if (!best || score > best.score) {
      best = { pai, waitKinds: waits.length, waitTiles, score };
    }
  }
  if (!best) {
    const fallback = candidates[0]?.replace(/[_*]$/, '') ?? null;
    return { pai: fallback, waitKinds: 0, waitTiles: 0, score: 0 };
  }
  return best;
}

/** 何巡目か [自分が何回捨てたか]。配牌直後は 0 */
export function currentTurn(game: Game3, player: PlayerId): number {
  return (((game.he.get(player) as any)?._pai ?? []) as string[]).length;
}

/** これ以降は手を戻す余裕が無いとみなす巡目 */
export const FEVER_LATE_TURN = 8;
/** この待ち枚数を割ったら細いとみなす */
export const FEVER_THIN_WAIT = 4;
/** この tier 以上なら待ちを問わず取る */
export const FEVER_FORCE_TIER = 3;
/** 暗刻がこれだけあれば高打点とみなして待ちを問わず取る */
export const FEVER_FORCE_ANKO = 3;

/** 手牌の暗刻数 [副露は含まない] */
function ankoCount(shoupai: any): number {
  const bp = shoupai?._bingpai ?? {};
  let n = 0;
  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const arr = bp[suit];
    if (!arr) continue;
    const len = suit === 'z' ? 8 : 10;
    for (let i = 1; i < len; i++) {
      if (Number(arr[i] ?? 0) >= 3) n += 1;
    }
  }
  return n;
}

export interface FeverChoice {
  takeFever: boolean;
  waitTiles: number;
  turn: number;
  reason: string;
}

/**
 * フィーバーを乗せるか決める。
 *
 * フィーバーは宣言時点の待ち [feverDeclareTing] に固定される。
 * 待ちが細いなら 1 シャンテン戻して形を作り直す手はあるが、
 * それが成立するのは戻す時間が残っている序盤だけ
 * [リョー 2026-07-20: 「巡目との比較がいるよね」]。
 *
 * 全虹 / 高 tier / 高打点は待ちの細さに関係なく取る
 * [四暗刻単騎のように待ち 1 種でも取るべき手がある]。
 */
export function decideFever(
  game: Game3,
  player: PlayerId,
  feverDapai: string,
  tier: number,
  opts: { rainbow?: boolean } = {},
): FeverChoice {
  const pai = feverDapai.replace(/[_*]$/, '');
  const after = handAfterDiscard(game, player, pai);
  const waitTiles = after ? countWaitTiles(game, player, after) : 0;
  const turn = currentTurn(game, player);

  if (opts.rainbow) {
    return { takeFever: true, waitTiles, turn, reason: '全虹なので取る' };
  }
  if (tier >= FEVER_FORCE_TIER) {
    return { takeFever: true, waitTiles, turn, reason: `tier ${tier} なので取る` };
  }
  if (after && ankoCount(after) >= FEVER_FORCE_ANKO) {
    return { takeFever: true, waitTiles, turn, reason: '暗刻が厚いので取る' };
  }
  if (waitTiles >= FEVER_THIN_WAIT) {
    return { takeFever: true, waitTiles, turn, reason: `待ち ${waitTiles} 枚で十分` };
  }
  if (turn >= FEVER_LATE_TURN) {
    return { takeFever: true, waitTiles, turn, reason: `${turn} 巡目、戻す余裕が無いので取る` };
  }
  return {
    takeFever: false,
    waitTiles,
    turn,
    reason: `待ち ${waitTiles} 枚は細く ${turn} 巡目なら戻せる`,
  };
}
