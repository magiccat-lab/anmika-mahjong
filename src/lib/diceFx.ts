// サイコロチャンスの演出の決まり (2026-10-14 リョー、演出のラフ 2 ・ 3 版の答え)。
// 見せ方だけで、出目 ・ 当たり ・ チップには触らない。
//  - 残りの振りを玉で見せる。振る時に玉が色を変える (期待度)。虹は当たりの確定で、外れには出さない
//  - 宣言した目が 1 個目に出たら「リーチ」。2 個目はゆっくり回り、当たれば「大当り」
//  - ゾロ目は「ゾロ目 / リプレイ」(3 版 V2 の答えの書き方)。玉は戻る
//  - 色は出目と何振り目かから決める。オンラインでも全員の画面で同じ色になる
export type BallColor = 'white' | 'blue' | 'gold' | 'rainbow';
export type RollOutcome = 'hit' | 'zoro' | 'miss';

export const ZORO_WORD = 'ゾロ目 / リプレイ';

/** 0〜1 の決まった数 (同じ入力なら同じ値) */
export function rollSeed(parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= (p | 0) + 0x9e37;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/** 振る前の玉の色。[2026-11-02 リョー「無演出とかでも一定の確率でちゃんと当たるように」で均した]
 *  当たり: 虹 1.5 割 ・ 金 3 割 ・ 青 3 割 ・ 白 2.5 割 (前は白 1 割で、白の玉の当たりは 0.9%)。
 *  外れ: 白 6.8 割 ・ 青 2.5 割 ・ 金 0.7 割。ゾロ目: 金 1 割 ・ 青 5 割 ・ 白 4 割 */
export function ballColor(outcome: RollOutcome, rnd: number): BallColor {
  if (outcome === 'hit') {
    if (rnd < 0.15) return 'rainbow';
    if (rnd < 0.45) return 'gold';
    if (rnd < 0.75) return 'blue';
    return 'white';
  }
  if (outcome === 'zoro') return rnd < 0.1 ? 'gold' : rnd < 0.6 ? 'blue' : 'white';
  if (rnd < 0.68) return 'white';
  if (rnd < 0.93) return 'blue';
  return 'gold';
}

/** [2026-11-02 リョー「サイコロとかの演出も足すとかね」] 強リーチ (赤の帯「激アツ」・ 鼓動が長い)。リーチの時だけ。
 *  当たり 55% ・ ゾロ目 25% ・ 外れ 12% で強になる。リーチの当たりは 1 割なので、強リーチは約 3 割 ・ 普通のリーチは約 5% */
export const STRONG_REACH_RATE: Readonly<Record<RollOutcome, number>> = { hit: 0.55, zoro: 0.25, miss: 0.12 };
export function strongReach(outcome: RollOutcome, rnd: number): boolean { return rnd < STRONG_REACH_RATE[outcome]; }

/** ゾロ目連続特典の基本の枚数 (store の rollSaiKoroDice と同じ: 1・1 は 111、ほかは目 × 11) */
export function zoroBonusBase(n: number): number { return n === 1 ? 111 : n * 11; }
/** rolls の i 番目までに続いたゾロ目の数 (i 番目がゾロ目でなければ 0) */
export function zoroStreakAt(rolls: ReadonlyArray<{ zoro: boolean }>, i: number): number {
  let n = 0;
  for (let k = i; k >= 0 && rolls[k]?.zoro; k -= 1) n += 1;
  return n;
}

export type RollPlan = {
  /** 先に止まるサイコロ (0 = 左, 1 = 右)。宣言した目の方を先に止めてリーチにする */
  first: 0 | 1;
  reach: boolean;
  outcome: RollOutcome;
  ball: BallColor;
  /** 強リーチ (リーチの時だけ true になり得る) */
  strong: boolean;
};

export function planRoll(
  combo: [number, number] | null,
  roll: { dice: [number, number]; hit: boolean; zoro: boolean },
  seedParts: number[],
): RollPlan {
  const [d1, d2] = roll.dice;
  const inCombo = (d: number) => !!combo && (combo[0] === d || combo[1] === d);
  const first: 0 | 1 = inCombo(d1) ? 0 : inCombo(d2) ? 1 : 0;
  const outcome: RollOutcome = roll.zoro ? 'zoro' : roll.hit ? 'hit' : 'miss';
  return {
    first,
    reach: inCombo(first === 0 ? d1 : d2),
    outcome,
    ball: ballColor(outcome, rollSeed(seedParts)),
    strong: inCombo(first === 0 ? d1 : d2) && strongReach(outcome, rollSeed([...seedParts, 7])),
  };
}
