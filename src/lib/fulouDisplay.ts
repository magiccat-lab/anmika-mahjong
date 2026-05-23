
/**
 * 副露 mianzi 表示用 parser [F2 鳴き先 表示 2026-05-15]
 *
 * majiang-core の Shoupai._fulou は文字列 mianzi を保持する:
 *   - pon  : `m11+1` / `p005-` / `s505=` 等 [3 digit + 方向 mark]
 *   - chi  : `m1-23` / `m12-3` 等 [3 digit、 mark 位置で 鳴き牌 idx を表現、 3 麻なし]
 *   - minkan: `m1111+` 等 [4 digit + mark]
 *   - ankan: `m1111` [mark 無し、 全縦表示]
 *   - kakan: `m111+1` 等 [pon mianzi + 4 枚目 加槓 tile]
 *
 * 本 game [3 麻 反時計回り] の 方向 mark semantics:
 *   - `+` = 上家 [lunban-1] から鳴いた → 左端 横倒し  [rotateIdx=0]
 *   - `-` = 下家 [lunban+1] から鳴いた → 右端 横倒し  [rotateIdx=2]
 *   - `=` = 対面 [3麻なし] → 中央 横倒し              [rotateIdx=1]
 *
 * NOTE: majiang-core 本来は 4麻 convention で `+ = -` を 別人別位置 に
 * 振るが、 game3.ts 1188 行で 3麻反時計回り用に `+`=上家 / `-`=下家 を
 * 割り当てている。 表示も この semantics に合わせる。
 */

export type FulouMianzi = {
  /** 縦表示 tile 列 [3 枚 or ankan 4 枚] */
  tiles: string[];
  /** 横倒し対象 idx [null = 全縦 = ankan or 自家ツモ kan] */
  rotateIdx: number | null;
  /** 加槓で 4 枚目に追加された牌 [rotateIdx 位置の tile に重ねる]、 nonkakan は null */
  kakanTile: string | null;
};

/**
 * mianzi 文字列 1 件を 表示用 struct に parse。
 * `m111+1` → { tiles: [m1,m1,m1], rotateIdx: 0, kakanTile: 'm1' }
 * `m11+1`  → { tiles: [m1,m1,m1], rotateIdx: 0, kakanTile: null }
 * `m1111`  → { tiles: [m1,m1,m1,m1], rotateIdx: null, kakanTile: null }
 */
export function parseMianzi(m: string): FulouMianzi {
  if (!m || m.length < 2) return { tiles: [], rotateIdx: null, kakanTile: null };
  const prefix = m[0];
  const rest = m.slice(1);
  // mark の位置と種類を取り出す
  const markMatch = rest.match(/[\+\=\-]/);
  if (!markMatch) {
    // ankan [全縦]
    const tiles = [...rest].map((d) => prefix + d);
    return { tiles, rotateIdx: null, kakanTile: null };
  }
  const markIdx = markMatch.index!;
  const markChar = markMatch[0];
  const before = rest.slice(0, markIdx);
  const after = rest.slice(markIdx + 1);

  // 鳴き先 → 横倒し idx [game3.ts 3麻 convention]
  const rotateByMark: Record<string, number> = { '+': 0, '=': 1, '-': 2 };
  let rotateIdx: number;
  // pon / minkan: mark は末尾、 before に 全 digit、 after は ''
  // chi: mark は中間、 mark 直後の digit が 鳴き牌 [3麻なし、 logic のため残す]
  // kakan: mark の後に 1 digit のみ追加、 before は 3 digit
  let kakanTile: string | null = null;
  let digits: string[];
  if (after.length === 0) {
    // pon / minkan / chi の rightmost 形 [`m123-`]
    digits = [...before];
    rotateIdx = rotateByMark[markChar];
  } else if (before.length === 3 && after.length === 1) {
    // 加槓 [`m111+1`]
    digits = [...before];
    kakanTile = prefix + after;
    rotateIdx = rotateByMark[markChar];
  } else {
    // chi [3 麻なし、 fallback として mark 直前 digit 位置] e.g. `m1-23` markIdx=1 → 鳴き牌 idx=0
    digits = [...before, ...after];
    // mark が n 番目 [0-based] にあれば 鳴き牌 idx は n、 ただし markChar による 配置は無視
    rotateIdx = rotateByMark[markChar];
  }
  const tiles = digits.map((d) => prefix + d);
  return { tiles, rotateIdx, kakanTile };
}

/** Shoupai._fulou 配列を 表示 struct 配列に変換 */
export function parseFulouList(fulou: string[] | undefined | null): FulouMianzi[] {
  if (!fulou) return [];
  return fulou.map(parseMianzi);
}

/**
 * F1 [2026-05-15]: 河の生 _pai エントリ [majiang-core He._pai 形式] に
 * 副露 marker [+/=/-] が含まれていれば true を返す。
 * He.fulou() は 「鳴かれた最後の打牌」 に 方向 mark を 末尾 付与する仕様。
 * 表示側は コレを検出して 河 tile を opacity 0.4 で 薄く残す。
 */
export function isNakiHePai(rawPai: string): boolean {
  return /[\+\=\-]/.test(rawPai);
}

/** countDora 等 logic 用に flat tile 配列を返す [kakan tile 含む] */
export function fulouFlatTiles(fulou: string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const m of parseFulouList(fulou)) {
    out.push(...m.tiles);
    if (m.kakanTile) out.push(m.kakanTile);
  }
  return out;
}
