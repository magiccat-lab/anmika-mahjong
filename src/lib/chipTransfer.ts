// [2026-07-23 Sol設計 chipTransfer DTO] 和了1件の祝儀移動の確定値と、表示用の送金行分解。
// UI は live chipLedger から再計算しない [サイコロ/ダブロン後処理で after が動き
// 「この和了の before」と「現在の after」が混ざるため]。値は game3.applyHule が
// chipTotal 確定と同時に result.chipTransfer として焼き込む。
import type { PlayerId } from './types';

export type ChipTransferDto = {
  v: 1;
  before: Record<PlayerId, number>;
  after: Record<PlayerId, number>;
  delta: Record<PlayerId, number>;
};

export type ChipTransferRow = { from: PlayerId; to: PlayerId; count: number };

// delta [ゼロサム前提の支払い(-)/受取(+)] から「誰→誰: 何枚」の行を作る。
// 旧実装は payer×payee の全組合せに min(|p|,|q|) を出していて、複数支払い×複数受取で
// 合計が過大表示になっていた [例: (-2,-2,+3,+1) が 6 枚分の行になる]。
// greedy 割当 [seat 順] で行合計 = 実移動枚数を保証する。
// ゼロサムでない入力 [想定外] は割当できた分だけ行にする [捏造行は作らない]。
export function buildChipTransferRows(delta: Partial<Record<PlayerId, number>>): ChipTransferRow[] {
  const payers: Array<{ seat: PlayerId; rest: number }> = [];
  const payees: Array<{ seat: PlayerId; rest: number }> = [];
  for (const seat of [0, 1, 2] as PlayerId[]) {
    const d = delta[seat] ?? 0;
    if (d < 0) payers.push({ seat, rest: -d });
    else if (d > 0) payees.push({ seat, rest: d });
  }
  const rows: ChipTransferRow[] = [];
  let pi = 0;
  let qi = 0;
  while (pi < payers.length && qi < payees.length) {
    const p = payers[pi];
    const q = payees[qi];
    const x = Math.min(p.rest, q.rest);
    if (x > 0) rows.push({ from: p.seat, to: q.seat, count: x });
    p.rest -= x;
    q.rest -= x;
    if (p.rest === 0) pi += 1;
    if (q.rest === 0) qi += 1;
  }
  return rows;
}
