// CPU のフィーバー権保護 [2026-07-20 リョー指摘]
//
// フィーバーの成立条件は feverLizhi.ts の canFeverLizhi にあるとおり
// 「暗槓以外の副露が 1 つも無いこと」。牌の種類は一切関係ない。
// つまり 7 のポンを禁じるだけでは足りず、7 対子でフィーバーを狙える手なら
// 役牌だろうが数牌だろうが、どこをポンした時点でも権利が飛ぶ。
//
// ここでは「まだフィーバーの芽が残っている手か」を軽く判定して、
// 芽がある間は CPU にポンを見送らせる。
import { countNijiInHand } from '../helpers';
import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

/** フィーバーの種になる 7 牌 [アンミカの萬子は 7 と 9 だけ] */
const SEVEN_SUITS = ['m', 'p', 's'] as const;

/** 暗刻まで残り 1 枚。ここを芽とみなす下限 */
const SEVEN_SEED_MIN = 2;
/** 全虹は 3 種。2 種持ちを芽とみなす */
const NIJI_SEED_MIN = 2;

export interface FeverPotential {
  /** 副露するとフィーバー権を失う手か */
  hasPotential: boolean;
  /** 2 枚以上持っている 7 の種類数 */
  sevenSeeds: number;
  /** 所持している虹の種類数 */
  nijiKinds: number;
  reason: string;
}

/**
 * その player がまだフィーバーを狙える手かどうか。
 * 既に暗槓以外の副露があるなら権利は無いので false [= 普通にポンしてよい]。
 */
export function evaluateFeverPotential(game: Game3, player: PlayerId): FeverPotential {
  const sp = game.shoupai.get(player);
  const none: FeverPotential = { hasPotential: false, sevenSeeds: 0, nijiKinds: 0, reason: '' };
  if (!sp) return none;

  // 既に副露済みならフィーバー権は最初から無い。守るものが無いので通常判断へ
  const fulous = ((sp as any)._fulou ?? []) as string[];
  if (fulous.some((m) => /[+=\-]/.test(m))) {
    return { ...none, reason: '副露済でフィーバー権は既に無い' };
  }

  const bp = (sp as any)._bingpai ?? {};
  let sevenSeeds = 0;
  for (const s of SEVEN_SUITS) {
    if ((bp[s]?.[7] ?? 0) >= SEVEN_SEED_MIN) sevenSeeds += 1;
  }

  const niji = countNijiInHand(sp);
  const nijiKinds = (niji.p > 0 ? 1 : 0) + (niji.s > 0 ? 1 : 0) + (niji.z > 0 ? 1 : 0);

  if (sevenSeeds > 0) {
    return {
      hasPotential: true,
      sevenSeeds,
      nijiKinds,
      reason: `7 の暗刻の芽 ${sevenSeeds} 種`,
    };
  }
  if (nijiKinds >= NIJI_SEED_MIN) {
    return {
      hasPotential: true,
      sevenSeeds,
      nijiKinds,
      reason: `全虹の芽 ${nijiKinds} 種`,
    };
  }
  return { ...none, sevenSeeds, nijiKinds, reason: 'フィーバーの芽なし' };
}

/**
 * CPU がこのポンを見送るべきか。
 * フィーバーの芽が残っている手では、どの牌のポンでも権利が飛ぶので見送る。
 */
export function shouldSkipPonForFever(game: Game3, player: PlayerId): boolean {
  return evaluateFeverPotential(game, player).hasPotential;
}
