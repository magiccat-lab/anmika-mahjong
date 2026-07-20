// CPU のシュバリーチ判断 [2026-07-20 リョー指示: ちゃんと高い手はシュバろう]
//
// シュバリーチは半荘 1 回きりの切り札で、効果は「当局の祝儀 ×2」[docs/chip_spec.md]。
// 素点は 1 点も動かないので、判断軸は打点ではなく「その手が和了れた時に
// 何枚の祝儀が付くか」。重みは chip_spec の牌種ボーナスをそのまま使う。
//
// 見えている確定材料 [手牌の赤金虹 / 抜き北 / 華] だけで評価する。
// 他家の伏せ牌や山の残りを覗くのは既存 CPU 方針どおり禁止。
import { countGoldInHand, countNijiInHand } from '../helpers';
import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

/** chip_spec.md の牌種ボーナス [枚 / 1 枚あたり] */
const CHIP_PER_RED = 2;
const CHIP_PER_GOLD = 4;
const CHIP_PER_NIJI = 7;
const CHIP_PER_NUKI = 1;
const CHIP_PER_FUYU = 2;

/** シュバを切る基準 [見込み祝儀 枚]。虹 1 枚 [7] + α で届く水準 */
export const SHUVARI_THRESHOLD = 8;
/** 終盤は使い残しが一番損なので基準を下げる */
export const SHUVARI_LATE_RELIEF = 4;
/** この局数以降を終盤とみなす [東 3 局 = jushu 2] */
export const SHUVARI_LATE_JUSHU = 2;

export interface ShuvariEstimate {
  /** 見込み祝儀 [枚]。シュバるとこの分がもう一度乗る */
  score: number;
  reasons: string[];
}

export interface ShuvariDecision extends ShuvariEstimate {
  shuvari: boolean;
  threshold: number;
}

/** 宣言牌を除いた手牌で、確定している祝儀源を枚数換算する */
export function estimateShuvariChip(
  game: Game3,
  player: PlayerId,
  discardPai: string | null = null,
): ShuvariEstimate {
  const sp = game.shoupai.get(player);
  if (!sp) return { score: 0, reasons: [] };
  const reasons: string[] = [];
  const gold = countGoldInHand(sp);
  const niji = countNijiInHand(sp);
  const bp = (sp as any)._bingpai ?? {};
  // _bingpai[suit][0] は赤 + 金の合計。金を差し引いた残りが純粋な赤 5
  let redCount = Math.max(0, (bp.p?.[0] ?? 0) - gold.p)
    + Math.max(0, (bp.s?.[0] ?? 0) - gold.s);
  let goldCount = gold.p + gold.s + gold.z;
  let nijiCount = niji.total;

  // 宣言牌はこの直後に手を離れるので祝儀源から外す
  const discard = discardPai ? discardPai.replace(/[_*]$/, '') : null;
  if (discard === 'gp' || discard === 'gs' || discard === 'gN') {
    goldCount = Math.max(0, goldCount - 1);
  } else if (discard === 'np3' || discard === 'ns3' || discard === 'nz3') {
    nijiCount = Math.max(0, nijiCount - 1);
  } else if (discard === 'p0' || discard === 's0') {
    redCount = Math.max(0, redCount - 1);
  }

  let score = 0;
  if (redCount > 0) {
    score += redCount * CHIP_PER_RED;
    reasons.push(`赤 ${redCount} 枚`);
  }
  if (goldCount > 0) {
    score += goldCount * CHIP_PER_GOLD;
    reasons.push(`金 ${goldCount} 枚`);
  }
  if (nijiCount > 0) {
    score += nijiCount * CHIP_PER_NIJI;
    reasons.push(`虹 ${nijiCount} 枚`);
  }

  const nuki = (game.nukidora[player] ?? 0) + (game.nukidoraGold[player] ?? 0);
  if (nuki > 0) {
    score += nuki * CHIP_PER_NUKI;
    reasons.push(`抜き北 ${nuki} 枚`);
  }

  // 華は和了時に「抜いている華」として集計される [表示牌の華 / リーチ時は裏も含む]
  const hua = game.effectiveHuapaiAtHule(player);
  const haru = hua.filter((p) => p === 'f1').length;
  const fuyu = hua.filter((p) => p === 'f4').length;
  if (haru > 0) {
    const mult = haru >= 2 ? 2 : 1;
    score += hua.length * mult;
    reasons.push(`春${haru >= 2 ? '春' : ''} [華 ${hua.length} 枚 ×${mult}]`);
  }
  if (fuyu > 0) {
    // 冬冬のチューリップ実額は山の並び次第で読めない。冬単体換算を下限として積む
    score += fuyu * CHIP_PER_FUYU;
    reasons.push(`冬 ${fuyu} 枚`);
  }
  return { score, reasons };
}

/** CPU がこのリーチでシュバを切るか決める */
export function decideCpuShuvari(
  game: Game3,
  player: PlayerId,
  opts: { discardPai?: string | null; feverTier?: number | null } = {},
): ShuvariDecision {
  if (game.shuvariUsed[player]) {
    return { shuvari: false, score: 0, threshold: 0, reasons: ['シュバ使用済'] };
  }
  const est = estimateShuvariChip(game, player, opts.discardPai ?? null);
  const reasons = [...est.reasons];
  let score = est.score;

  // フィーバーは祝儀そのものに tier 倍率 [1/2/4/8] が乗る。
  // シュバはその上に ×2 なので、フィーバー中ほどシュバの価値が跳ね上がる
  const tier = opts.feverTier ?? null;
  if (tier && tier > 1) {
    score *= tier;
    reasons.push(`フィーバー tier ${tier}`);
  }

  const jushu = game.state?.jushu ?? 0;
  const late = jushu >= SHUVARI_LATE_JUSHU;
  const threshold = late ? SHUVARI_THRESHOLD - SHUVARI_LATE_RELIEF : SHUVARI_THRESHOLD;
  if (late) reasons.push('終盤で基準を下げた');

  return { shuvari: score >= threshold, score, threshold, reasons };
}
