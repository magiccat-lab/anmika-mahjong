// CPU の打牌の同点崩し [cpu-lab 2026-11-02、人の対局ログから]
//
// pickBestDiscard は「シャンテン最小 → 受け入れ最大 → (テンパイなら手の価値) → prio 最大」で選ぶ。
// 前は prio の土台が「字牌 3 ・ 1 9 牌 2 ・ 2 8 牌 1 ・ 他 0」だけで、字牌どうし ・ 端牌どうしは
// 候補の並び [萬 → 筒 → 索 → 字] の先勝ちだった。そのため場風で役牌の東を真っ先に切り、
// 孤立した中や發を残していた。
//
// 人の対局 [古い 80% の試合、収支が上の人を 2 倍に重み] で、シャンテンと受け入れが同じ候補の
// どれを切ったかを条件付きロジットで当てはめた重み [log-odds]。大きいほど先に切る:
//   - 孤立字牌は 發 ・ 中 → オタ風 → 役風 ・ 白 の順。対子の字牌は残す
//   - 数牌は 1 9 → 2 8 → 7 → 3〜6。隣 [±1] や嵌張 [±2] の牌があれば残す
//   - 場に見えている枚数が多い牌ほど先に切る [使い道が少ない]
//   - 巡目が進むと孤立字牌を安全牌として残し、先に端牌を切る
// 金 ・ 赤 ・ 虹 ・ 7 の暗刻の芽 ・ ぽっち倍率 ・ リーチ者への安全度 [既存の prio の加減点] は残し、
// TIE_RESID を掛けて同じ log-odds の物差しに載せる。
// 公開情報 [自分の手 ・ 河 ・ 副露 ・ ドラ表示] だけを見る。

export const TIE_RESID = 0.15;

const W = {
  hatsu: 1.16,
  chun: 0.97,
  windOtaku: 0.95,
  windYaku: 0.58,
  haku: 0.5,
  m19: 0.35,
  ps19: 0.24,
  ps28: -0.28,
  m7: -0.66,
  ps7: -0.71,
  mid: -1.01,
  pairNumber: -0.74,
  pairHonor: -1.36,
  seen: 0.23,
  adj: -1.46,
  gap: -0.87,
  lateSingleHonor: -1.13,
} as const;

export interface DiscardTieInput {
  /** 牌の種類 [m7 / p5 / z1 ...、赤 ・ 金 ・ 虹は 5 / 3 に寄せた物] */
  kind: string;
  /** 打つ前の手 [14 枚側] のその種類の枚数 */
  count: number;
  /** 自分以外に見えている枚数 [河 ・ 副露 ・ ドラ表示] */
  seen: number;
  /** 数牌の隣 [±1] / 一つ飛び [±2] を手に持つか */
  adjacent: boolean;
  gapped: boolean;
  /** 場風か自風の風牌か */
  yakuWind: boolean;
  /** 自分の河の枚数 [巡目] */
  turn: number;
}

/** 牌の種類だけで決まっていた旧 prio の土台 [この表で置き換える分] */
export function legacyKindBase(kind: string, count: number): number {
  const s = kind[0];
  const n = Number(kind[1]);
  let b = 0;
  if (s === 'z') b = 3;
  else if (n === 1 || n === 9) b = 2;
  else if (n === 2 || n === 8) b = 1;
  if (n === 7 && s !== 'z' && count <= 1) b -= 1;
  if (s === 'm' && n === 9) b -= count >= 2 ? 2 : 1;
  if (s === 'z' && n === 5) b -= 1;
  return b;
}

/** 同点の候補のうち先に切りたい度合い [log-odds] */
export function discardTieScore(t: DiscardTieInput): number {
  const s = t.kind[0];
  const n = Number(t.kind[1]);
  let v = W.seen * t.seen;
  if (t.count >= 2) {
    v += s === 'z' ? W.pairHonor : W.pairNumber;
  } else if (s === 'z') {
    if (n === 6) v += W.hatsu;
    else if (n === 7) v += W.chun;
    else if (n === 5) v += W.haku;
    else v += t.yakuWind ? W.windYaku : W.windOtaku;
    v += W.lateSingleHonor * Math.min(t.turn, 12) / 12;
  } else if (s === 'm') {
    v += n === 7 ? W.m7 : W.m19;
  } else if (n === 1 || n === 9) v += W.ps19;
  else if (n === 2 || n === 8) v += W.ps28;
  else if (n === 7) v += W.ps7;
  else v += W.mid;
  // 萬子は 7 と 9 しか無く [8 も無い]、搭子にならない
  if (s === 'p' || s === 's') {
    if (t.adjacent) v += W.adj;
    else if (t.gapped) v += W.gap;
  }
  return v;
}
