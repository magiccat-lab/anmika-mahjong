import { toCorePai } from '../helpers';
import type { PlayerId } from '../types';

export type GoldSuit = 'p' | 's' | 'z';
export type GoldHand = Record<GoldSuit, number>;

export type LastZimoGoldInfo = {
  player: PlayerId | null;
  pai: string | null;
  gold: boolean;
};

export function emptyGoldHand(): GoldHand {
  return { p: 0, s: 0, z: 0 };
}

export function goldSuitFromPhysicalPai(pai: string): GoldSuit | null {
  if (pai === 'gp') return 'p';
  if (pai === 'gs') return 's';
  if (pai === 'gN') return 'z';
  return null;
}

export function isGoldPhysicalPai(pai: string): boolean {
  return goldSuitFromPhysicalPai(pai) !== null;
}

export function goldSuitFromCorePai(corePai: string): GoldSuit | null {
  if (corePai === 'p0') return 'p';
  if (corePai === 's0') return 's';
  if (corePai === 'z4') return 'z';
  return null;
}

export function goldPaiFromCorePai(corePai: string): 'gp' | 'gs' | 'gN' | null {
  const suit = goldSuitFromCorePai(corePai);
  if (suit === 'p') return 'gp';
  if (suit === 's') return 'gs';
  if (suit === 'z') return 'gN';
  return null;
}

export function trackGoldDraw(lastZimoGold: boolean, pai: string, hand: GoldHand): GoldSuit | null {
  if (!lastZimoGold) return null;
  const suit = goldSuitFromPhysicalPai(pai);
  if (!suit) return null;
  hand[suit] += 1;
  return suit;
}

export function consumeGold(hand: GoldHand, suit: GoldSuit): boolean {
  if (hand[suit] <= 0) return false;
  hand[suit] -= 1;
  return true;
}

export function hasGoldKita(ctx: {
  goldHand: Record<PlayerId, GoldHand>;
  nukidoraGold?: Record<PlayerId, number>;
}, player: PlayerId): boolean {
  return (ctx.goldHand[player]?.z ?? 0) > 0 || ((ctx.nukidoraGold?.[player] ?? 0) > 0);
}

export function shouldPreserveGoldPai(corePai: string, hand: GoldHand): boolean {
  const suit = goldSuitFromCorePai(corePai);
  return suit !== null && hand[suit] > 0;
}

export function resolveGoldDiscardFlag(opts: {
  player: PlayerId;
  corePai: string;
  paiForHand: string;
  metaGold?: boolean;
  initialGold?: boolean;
  hand: GoldHand;
  lastZimoInfo: LastZimoGoldInfo;
}): boolean {
  const suit = goldSuitFromCorePai(opts.corePai);
  if (!suit) return opts.initialGold ?? false;

  let isGold = opts.initialGold ?? false;
  const physicalSuit = goldSuitFromPhysicalPai(opts.paiForHand);
  if (physicalSuit === suit) isGold = true;

  // 判定経路が複数成立しても手持ち金の消費は1枚まで。
  // (物理金牌 + metaGold/lastZimo 一致が重なると2枚減っていた)
  let shouldConsume = false;
  if (typeof opts.metaGold === 'boolean') {
    isGold = opts.metaGold;
    shouldConsume = opts.metaGold;
  } else if (
    opts.lastZimoInfo.player === opts.player
    && toCorePai(opts.lastZimoInfo.pai as string) === opts.corePai
  ) {
    isGold = !!opts.lastZimoInfo.gold;
    shouldConsume = isGold;
  } else if (opts.hand[suit] > 0) {
    isGold = true;
    shouldConsume = true;
  }

  if (physicalSuit === suit) {
    isGold = true;
    shouldConsume = true;
  }
  if (shouldConsume) consumeGold(opts.hand, suit);
  return isGold;
}

export function resolveGoldPaiForDiscard(opts: {
  requestedPai: string;
  corePai: string;
  metaGold?: boolean;
  expanded?: Record<string, number> | null;
}): string {
  const expanded = opts.expanded;
  if (!expanded || opts.metaGold === false) return opts.requestedPai;
  const physical = goldPaiFromCorePai(opts.corePai);
  if (!physical || opts.requestedPai === physical) return opts.requestedPai;
  return (expanded[physical] ?? 0) > 0 ? physical : opts.requestedPai;
}
