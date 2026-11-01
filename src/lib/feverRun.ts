// [2026-11-02 リョー「フィーバーの連続の時に通算何点何枚きたかとか出してほしい」]
// フィーバーに入った時の点とチップを席ごとに覚え、フィーバーの間は「今 − 入った時」を通算として見せる。
// 見せるだけで点数 ・ チップには触らない。画面ごとに持つので、フィーバーの途中で開き直した画面には出ない。
// フィーバーが終わっても局が変わるまでは最後の通算を残す (局の結果を見ながら読めるように)。
export type FeverRun = { baseDefen: number; baseChip: number; rk: string; ended: boolean; lastDefen: number; lastChip: number };
export type FeverRuns = Record<0 | 1 | 2, FeverRun | null>;

export const EMPTY_FEVER_RUNS: FeverRuns = { 0: null, 1: null, 2: null };

export function trackFeverRuns(
  prev: FeverRuns,
  now: { feverActive: Record<number, boolean>; defen: number[]; chip: Record<number, number>; rk: string },
): FeverRuns {
  const next: FeverRuns = { ...prev };
  for (const p of [0, 1, 2] as const) {
    const on = !!now.feverActive?.[p];
    const defen = Number(now.defen?.[p] ?? 0);
    const chip = Number(now.chip?.[p] ?? 0);
    const r = prev[p];
    if (on) {
      if (!r || r.ended) next[p] = { baseDefen: defen, baseChip: chip, rk: now.rk, ended: false, lastDefen: defen, lastChip: chip };
      else next[p] = { ...r, rk: now.rk, lastDefen: defen, lastChip: chip };
    } else if (r && !r.ended) {
      // 終わった瞬間の値で止める (この後の局の精算を混ぜない)
      next[p] = { ...r, ended: true, lastDefen: defen, lastChip: chip };
    } else if (r && r.ended && r.rk !== now.rk) {
      next[p] = null;
    }
  }
  return next;
}

/** 通算 (点 ・ 枚)。動きが無ければ null */
export function feverRunTotal(r: FeverRun | null): { defen: number; chip: number } | null {
  if (!r) return null;
  const defen = r.lastDefen - r.baseDefen;
  const chip = r.lastChip - r.baseChip;
  return defen === 0 && chip === 0 ? null : { defen, chip };
}

export function signed(n: number): string { return `${n > 0 ? '+' : ''}${n.toLocaleString()}`; }
