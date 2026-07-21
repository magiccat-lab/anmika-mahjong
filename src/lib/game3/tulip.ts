// 冬チューリップ [冬2枚] の隣接牌集合。[2026-07-20 リョー裁定]
//   m7↔m9 / 白z5→發z6・中z7 / 北z4→西z3・東z1 / 西z3→東z1・北z4 / 数牌±1循環
// 実精算 [huleChip.ts checkHit] と自動高目 estimator [game3.ts
// estimateFuyuChipForSwap] が同一集合を使うための単一定義。
// [2026-07-21 裁定9 / D-13]: estimator が旧仕様 [m7m9↔z5 連結・z4/z5 欠落]
// のままで、高目自動選択が実 hit 最大とズレていたのを揃える。
// 引数 norm は 0 正規化済みの core 牌 [p5/s5/z4 等]。自牌そのものは含めない。
export function tulipNeighbors(norm: string): string[] {
  const s = norm[0];
  const n = parseInt(norm[1] === '0' ? '5' : norm[1], 10);
  if (s === 'm') {
    if (n === 7) return ['m9'];
    if (n === 9) return ['m7'];
    return [];
  }
  if (s === 'z') {
    if (n === 5) return ['z6', 'z7'];
    if (n === 4) return ['z3', 'z1'];
    if (n === 3) return ['z1', 'z4'];
    return [];
  }
  return [`${s}${n > 1 ? n - 1 : 9}`, `${s}${n < 9 ? n + 1 : 1}`];
}
