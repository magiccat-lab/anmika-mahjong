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

/** 振る前の玉の色。当たり: 虹 3 割 ・ 金 4 割 ・ 青 2 割 ・ 白 1 割。外れ: 白 7 割 ・ 青 2 割強 ・ 金 1 割弱。ゾロ目: 青 6 割 ・ 白 4 割 */
export function ballColor(outcome: RollOutcome, rnd: number): BallColor {
  if (outcome === 'hit') {
    if (rnd < 0.3) return 'rainbow';
    if (rnd < 0.7) return 'gold';
    if (rnd < 0.9) return 'blue';
    return 'white';
  }
  if (outcome === 'zoro') return rnd < 0.6 ? 'blue' : 'white';
  if (rnd < 0.7) return 'white';
  if (rnd < 0.93) return 'blue';
  return 'gold';
}

export type RollPlan = {
  /** 先に止まるサイコロ (0 = 左, 1 = 右)。宣言した目の方を先に止めてリーチにする */
  first: 0 | 1;
  reach: boolean;
  outcome: RollOutcome;
  ball: BallColor;
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
  };
}
