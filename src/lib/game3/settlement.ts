import type { PlayerId } from '../types';

export type DefenByPlayer = Record<PlayerId, number>;

export interface WinPointInput {
  result: { fu?: number; fanshu?: number; damanguan?: number };
  winner: PlayerId;
  loser: PlayerId | null;
  oya: PlayerId;
  benbang: number;
  feverMultiplier?: number;
  pointMultiplier?: number;
  reverse?: boolean;
}

export interface WinPointEvaluation {
  base: number;
  deltas: DefenByPlayer;
  winnerGain: number;
}

/** Pure three-player base-point evaluation. */
export function computeSanmaBase(result: { fu?: number; fanshu?: number; damanguan?: number }): number {
  const fu = result.fu ?? 30;
  const fanshu = result.fanshu ?? 0;
  const damanguan = result.damanguan ?? 0;
  if (damanguan > 0) return 8000 * damanguan;
  if (fanshu >= 24) return 12000;
  if (fanshu >= 18) return 10000;
  if (fanshu >= 13) return 8000;
  if (fanshu >= 11) return 6000;
  if (fanshu >= 8) return 4000;
  if (fanshu >= 6) return 3000;
  if (fanshu >= 5) return 2000;
  const raw = fu * Math.pow(2, fanshu + 2);
  return raw === 1920 ? 2000 : Math.min(raw, 2000);
}

/**
 * Evaluate only point movement.  Deposits are deliberately absent: effects
 * such as 夏夏金北 may multiply the hand payment, honba and +1000 tsumo bonus,
 * but must never multiply riichi sticks.
 */
export function evaluateWinPoints(input: WinPointInput): WinPointEvaluation {
  const deltas: DefenByPlayer = { 0: 0, 1: 0, 2: 0 };
  const ceil100 = (n: number) => Math.ceil(n / 100) * 100;
  const feverMultiplier = Math.max(1, input.feverMultiplier ?? 1);
  const pointMultiplier = Math.max(1, input.pointMultiplier ?? 1);
  const base = computeSanmaBase(input.result) * feverMultiplier;
  const isOya = input.winner === input.oya;

  if (input.loser !== null) {
    const handPayment = isOya ? ceil100(base * 6) : ceil100(base * 4);
    const payment = (handPayment + input.benbang * 2000) * pointMultiplier;
    deltas[input.winner] += payment;
    deltas[input.loser] -= payment;
  } else if (isOya) {
    const payment = (ceil100(base * 2) + input.benbang * 1000 + 1000) * pointMultiplier;
    for (const player of [0, 1, 2] as PlayerId[]) {
      if (player === input.winner) continue;
      deltas[player] -= payment;
      deltas[input.winner] += payment;
    }
  } else {
    const oyaPayment = (ceil100(base * 2) + input.benbang * 1000 + 1000) * pointMultiplier;
    const koPayment = (ceil100(base) + input.benbang * 1000 + 1000) * pointMultiplier;
    for (const player of [0, 1, 2] as PlayerId[]) {
      if (player === input.winner) continue;
      const payment = player === input.oya ? oyaPayment : koPayment;
      deltas[player] -= payment;
      deltas[input.winner] += payment;
    }
  }

  if (input.reverse) {
    for (const player of [0, 1, 2] as PlayerId[]) deltas[player] *= -1;
  }
  return { base, deltas, winnerGain: deltas[input.winner] };
}

export interface WinClaimInput extends WinPointInput {
  result: WinPointInput['result'] & Record<string, any>;
}

/**
 * Pure batch settlement.  Claims must already be in the authoritative order;
 * the first valid claim alone receives all riichi sticks.
 */
export function settleClaims(opts: {
  defen: DefenByPlayer;
  lizhibang: number;
  claims: WinClaimInput[];
}): {
  defen: DefenByPlayer;
  lizhibang: number;
  evaluations: WinPointEvaluation[];
} {
  const defen = { ...opts.defen };
  const evaluations: WinPointEvaluation[] = [];
  let deposits = Math.max(0, opts.lizhibang);
  for (const claim of opts.claims) {
    const evaluation = evaluateWinPoints(claim);
    evaluations.push(evaluation);
    for (const player of [0, 1, 2] as PlayerId[]) defen[player] += evaluation.deltas[player];
    if (deposits > 0) {
      defen[claim.winner] += deposits * 1000;
      deposits = 0;
    }
  }
  return { defen, lizhibang: deposits, evaluations };
}
