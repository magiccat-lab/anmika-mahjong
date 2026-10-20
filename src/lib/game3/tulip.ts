// 冬チューリップ [冬2枚] の隣接牌集合。[2026-07-20 リョー裁定 + 2026-10-14 両方向]
//   m7↔m9 / 三元牌 白z5・發z6・中z7 は互いに隣 / 風 東z1・南z2・西z3・北z4 は互いに隣 / 数牌±1循環
//   10-14 リョー「普通に世の中のルールと同じだよ」: 白めくりだけ廣がる片方向をやめ、どの牌がめくれても残りに当たる
//   [通報 20261014_2「冬冬金北で白持ってるのに中と發が滑ってる」]
//   10-20 南も風に入れた [通報 20261020_0「冬冬金北 南が西に反応しない」。ルールブックは上下牌 ±1 で、南を外す根拠が無い]
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
    const DRAGONS = [5, 6, 7];
    const WINDS = [1, 2, 3, 4];
    if (DRAGONS.includes(n)) return DRAGONS.filter((x) => x !== n).map((x) => `z${x}`);
    if (WINDS.includes(n)) return WINDS.filter((x) => x !== n).map((x) => `z${x}`);
    return [];
  }
  return [`${s}${n > 1 ? n - 1 : 9}`, `${s}${n < 9 ? n + 1 : 1}`];
}
