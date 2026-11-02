// [2026-11-02 クラウドレビュー 11-02 #15] 山の目盛りの数 [WallMeter の total] を決める。
// 以前は山 (shan) オブジェクトが替わったら数え直していたが、オンラインの投影 (hydrateProjectionState)
// は投影のたびに Shan3.createBlind で新しい shan を作るため、毎回 total = 残り枚数 になり
// 目盛りが一つも消えなかった。局の鍵 (changbang-jushu-benbang) が替わった時だけ数え直す。
// 局の途中から繋いでも、その時の残りより小さくはならない
export type WallTotalState = { roundKey: string | null; total: number };

export function nextWallTotal(prev: WallTotalState, roundKey: string, paishu: number): WallTotalState {
  if (prev.roundKey !== roundKey) return { roundKey, total: paishu };
  if (paishu > prev.total) return { roundKey, total: paishu };
  return prev;
}
