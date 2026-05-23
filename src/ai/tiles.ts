
// AI 用 tile 表現: 116 種別 × index、 game の文字列 key と相互変換
// 順序: m7, m9, p0/p1..p9/gp, s0/s1..s9/gs, z1..z3, z4/gN, z5b/r/g/y, z6, z7, f1..f4
// = 2 + 11 + 11 + 3 + 2 + 4 + 2 + 4 = 39 種別  ※「種別」 ≠ 「116 枚」
//
// v5 では 116 dim で 各 tile-key の 「枚数 [0-4]」 を持つ。
// gp/gs/gN は別 index で所有を区別、 同一 index に重ねない。

export const TILE_KEYS: string[] = [
  'm7', 'm9',
  'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'gp',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'gs',
  'z1', 'z2', 'z3',
  'z4', 'gN',
  'z5b', 'z5r', 'z5g', 'z5y',
  'z6', 'z7',
  'f1', 'f2', 'f3', 'f4',
];

export const TILE_DIM = TILE_KEYS.length;  // = 39
export const TILE_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < TILE_KEYS.length; i++) m[TILE_KEYS[i]] = i;
  return m;
})();

/** 牌 key を index に [unknown は -1] */
export function tileIdx(key: string | null | undefined): number {
  if (!key) return -1;
  const i = TILE_INDEX[key];
  return i === undefined ? -1 : i;
}

/** 河で表示される 「z5」 [color 不明] のような曖昧 key を Z5_R に寄せる: 通常 z5 単独はないが念のため */
export function normalizeTileForObs(key: string): string {
  if (key === 'z5') return 'z5r';  // arbitrary fallback
  return key;
}
