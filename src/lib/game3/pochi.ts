import { pochiColorFromPai, toCorePai } from '../helpers';
import type { PlayerId } from '../types';

export type PochiColor = 'blue' | 'red' | 'green' | 'yellow';
export type PochiMultiplier = { defen: number; chip: number };
export type PochiHand = Record<PochiColor, number>;

export type LastZimoPochiInfo = {
  player: PlayerId | null;
  pai: string | null;
  pochi: string | null;
};

export const POCHI_COLORS: readonly PochiColor[] = ['blue', 'red', 'green', 'yellow'];
export const NEUTRAL_POCHI_MULTIPLIER: PochiMultiplier = { defen: 1, chip: 1 };
const POCHI_PAI_BY_COLOR: Record<PochiColor, 'z5b' | 'z5r' | 'z5g' | 'z5y'> = {
  blue: 'z5b',
  red: 'z5r',
  green: 'z5g',
  yellow: 'z5y',
};

export function emptyPochiHand(): PochiHand {
  return { blue: 0, red: 0, green: 0, yellow: 0 };
}

export function normalizePochiMultiplier(v: unknown): PochiMultiplier {
  if (v && typeof v === 'object') {
    const pm = v as Partial<PochiMultiplier>;
    const defen = typeof pm.defen === 'number' ? pm.defen : 1;
    const chip = typeof pm.chip === 'number' ? pm.chip : 1;
    return { defen, chip };
  }
  if (typeof v === 'number') return { defen: v < 0 ? -1 : 1, chip: v };
  return { ...NEUTRAL_POCHI_MULTIPLIER };
}

export function pochiMultiplierForColor(color: PochiColor): PochiMultiplier {
  if (color === 'blue') return { defen: 1, chip: 2 };
  if (color === 'green') return { defen: 1, chip: 1 };
  if (color === 'red') return { defen: -1, chip: -2 };
  return { defen: -1, chip: -1 };
}

export function nextPochiMultiplier(currentValue: unknown, color: PochiColor): PochiMultiplier {
  const current = normalizePochiMultiplier(currentValue);
  const incoming = pochiMultiplierForColor(color);
  if (current.defen === 1 && current.chip === 1) return incoming;

  const currentPositive = current.defen > 0;
  const incomingPositive = incoming.defen > 0;
  if (currentPositive === incomingPositive) {
    const sign = currentPositive ? 1 : -1;
    return {
      defen: sign * Math.max(Math.abs(current.defen), Math.abs(incoming.defen)),
      chip: sign * Math.max(Math.abs(current.chip), Math.abs(incoming.chip)),
    };
  }
  if (!currentPositive && incomingPositive) {
    return {
      defen: current.defen * -1 * incoming.defen,
      chip: current.chip * -2 * incoming.chip,
    };
  }
  return {
    defen: current.defen * incoming.defen,
    chip: current.chip * incoming.chip,
  };
}

export function consumePochiColor(hand: PochiHand, color: PochiColor): boolean {
  if (hand[color] <= 0) return false;
  hand[color] -= 1;
  return true;
}

export function firstAvailablePochiColor(hand: PochiHand): PochiColor | null {
  return POCHI_COLORS.find((color) => hand[color] > 0) ?? null;
}

export function pochiPaiFromColor(color: string | null | undefined): 'z5b' | 'z5r' | 'z5g' | 'z5y' | null {
  if (!color) return null;
  return POCHI_PAI_BY_COLOR[color as PochiColor] ?? null;
}

export function trackPochiDraw(rawPai: unknown, corePai: string, hand: PochiHand): PochiColor | null {
  const color = pochiColorFromPai(String(rawPai));
  if (!color || corePai !== 'z5') return null;
  hand[color] += 1;
  return color;
}

export function shouldApplyPochiDrawMultiplier(opts: {
  color: PochiColor | null;
  corePai: string;
  isLizhi: boolean;
  isWhiteWaiting: boolean;
}): opts is {
  color: PochiColor;
  corePai: 'z5';
  isLizhi: true;
  isWhiteWaiting: false;
} {
  return !!opts.color && opts.corePai === 'z5' && opts.isLizhi && !opts.isWhiteWaiting;
}

export function isReversePochiColor(color: PochiColor | null | undefined): boolean {
  return color === 'red' || color === 'yellow';
}

export function resolvePochiPaiForDiscard(opts: {
  requestedPai: string;
  corePai: string;
  expanded?: Record<string, number> | null;
  lastZimoInfo: LastZimoPochiInfo;
  player: PlayerId;
}): string {
  const expanded = opts.expanded;
  if (!expanded || opts.corePai !== 'z5' || pochiColorFromPai(opts.requestedPai)) {
    return opts.requestedPai;
  }
  const zimoRaw = opts.lastZimoInfo.player === opts.player && toCorePai(opts.lastZimoInfo.pai as string) === 'z5'
    ? (opts.lastZimoInfo.pai as string)
    : null;
  if (zimoRaw && pochiColorFromPai(zimoRaw) && (expanded[zimoRaw] ?? 0) > 0) return zimoRaw;
  for (const color of POCHI_COLORS) {
    const physical = POCHI_PAI_BY_COLOR[color];
    if ((expanded[physical] ?? 0) > 0) return physical;
  }
  return opts.requestedPai;
}

export function resolvePochiDiscardColor(opts: {
  player: PlayerId;
  paiForHand: string;
  metaColor?: PochiColor;
  hand: PochiHand;
  lastZimoInfo: LastZimoPochiInfo;
}): PochiColor | undefined {
  const rawColor = pochiColorFromPai(opts.paiForHand);
  if (rawColor) {
    consumePochiColor(opts.hand, rawColor);
    return rawColor;
  }
  if (opts.metaColor) {
    consumePochiColor(opts.hand, opts.metaColor);
    return opts.metaColor;
  }
  if (
    opts.lastZimoInfo.player === opts.player
    && toCorePai(opts.lastZimoInfo.pai as string) === 'z5'
    && opts.lastZimoInfo.pochi
  ) {
    const color = opts.lastZimoInfo.pochi as PochiColor;
    consumePochiColor(opts.hand, color);
    return color;
  }
  const fallback = firstAvailablePochiColor(opts.hand);
  if (!fallback) return undefined;
  consumePochiColor(opts.hand, fallback);
  return fallback;
}
