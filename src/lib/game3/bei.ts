import { addAnmikaPai, toCorePai } from '../helpers';
import type { PlayerId } from '../types';
import type { GoldHand } from './gold';

export function canNukiBeiFromState(
  sp: any,
  player: PlayerId,
  feverActive: Record<PlayerId, boolean>,
): boolean {
  if (!sp) return false;
  if (!sp._zimo) return false;
  if (sp._zimo.length > 2) return false;
  const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => feverActive[p]);
  if (someoneFever && !feverActive[player]) {
    return toCorePai(sp._zimo) === 'z4';
  }
  return sp._bingpai?.z?.[4] >= 1;
}

export function consumeNukiBei(opts: {
  sp: any;
  metaGold?: boolean;
  totalZ4: number;
  goldHand: GoldHand;
  nukidora: { value: number };
  nukidoraGold: { value: number };
}): 'gold' | 'normal' {
  const goldZ4 = opts.goldHand.z;
  const normalZ4 = opts.totalZ4 - goldZ4;
  if (opts.metaGold === true && goldZ4 > 0) {
    opts.goldHand.z -= 1;
    addAnmikaPai(opts.sp, 'gN', -1);
    opts.nukidoraGold.value += 1;
    return 'gold';
  }
  if (normalZ4 > 0) {
    opts.nukidora.value += 1;
    return 'normal';
  }
  if (goldZ4 > 0) {
    opts.goldHand.z -= 1;
    addAnmikaPai(opts.sp, 'gN', -1);
    opts.nukidoraGold.value += 1;
    return 'gold';
  }
  opts.nukidora.value += 1;
  return 'normal';
}
