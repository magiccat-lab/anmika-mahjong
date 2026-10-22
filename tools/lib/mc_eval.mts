// モンテカルロで切った後の手の和了率と、アガった時の値を数える [2026-10-14 リョー、麻雀 AI の考え方のページの答え P3「a やる」]
// 打牌の分析 (tools/room_analysis.mts --mc <回数>) が、2 シャンテン以下の候補ごとに呼ぶ。
// 1 回の試し: 打つ人から見えていない牌を山に並べ直し、残りの自分のツモの回数だけ回す。
//  - 自分のツモ: アガれば値 (ツモ)。テンパイならツモ切り (リーチの形)、テンパイ前はシャンテン → 受け入れの多い牌を切る。
//    受け入れが近い時は、赤 ・ 金 (0 の牌) と、2 枚以上ある 7 (フィーバーの種) を残す
//  - 1 巡に相手 2 人の打牌: 山から 1 枚ずつ引いた牌を打ったと見て、テンパイで待ちに当たれば RON_TAKE の割合でロン (相手は危ない牌を止める)
//  - リーチ中に白 (ぽっち) を引けばツモで局が終わる (pochiWild)。色は正 2 ・ 逆 2 で、点もチップも見込みは 0
//  - フィーバー立直になる形 (7 の確定暗刻) でテンパイしたら、他家は強制ツモ切りで誰もアガれないので、
//    残りの山に出る待ち牌を全部アガる (自分の番はツモ、他家の番はロン)。値は段の倍と段の祝儀を chip_value で
// RON_TAKE と局の終わり方は、実際のリーチ 164 回の結末に合わせた [2026-10-14、tools/calib_assumptions.mts]:
//   ロン 0.5 ・ 局の終わり = 部屋のアガリ ÷ 打牌 × END_SCALE 1.75 ・ ぽっちあり で、和了率 53.6% (実際 53.7%)、
//   リーチ 1 回あたりツモ 33.8% (30.5%) ・ ロン 19.8% (23.2%)。和了の当てっぽさ (Brier) 0.242 は、全員に同じ率を当てた 0.249 より良い
//  - 自分の河の牌で待つ形はフリテンなのでロンしない
//  - 嵌八萬 (7萬 9萬) だけのテンパイは、ぽっちのツモ (pochiWild) と、相手が切った正のぽっちのロンでアガる [10-23]
//  - 相手の番ごとに endRate の割合で局が終わる (誰かのアガリ。部屋のアガリの回数 ÷ 打牌の回数で、room_analysis が渡す)
// 値: env (chip_value の ChipEnv) があればチップ (点 × CHIP_PER_POINT + 祝儀)、無ければ点だけ (calib_assumptions 用)。
// 山は普通の牌の種類だけで、後から引く赤 ・ 金 ・ 虹 ・ 華は数えない
// cache は 1 つの打牌の判断ごとに新しく渡す (ドラ ・ 見えていない枚数が同じ間だけ使い回せる)
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { canFeverLizhi } from '../../src/lib/game3/feverLizhi';
import { winValue, unswapM1, isKanpamanTenpai, kanpamanValue, POSITIVE_POCHI_RATE, type ChipEnv } from './chip_value.mts';

export const RON_TAKE = 0.5;
export const END_SCALE = 1.75;

export type McCtx = {
  kinds: string[]; unseen: (t: string) => number; draws: number; param: any; river: Set<string>; seed: number; endRate: number;
  ronTake?: number;
  // リーチ中に白 (ぽっち) を引いたらツモで局が終わる。色は正 2 ・ 逆 2 で、点 ・ チップとも見込みは 0 として数える
  pochiWild?: boolean;
  env?: ChipEnv;
};

// 決まった並べ方で毎回同じ答えにする (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addTile(sp: any, t: string): void {
  sp._bingpai[t[0]][Number(t[1])] += 1;
  sp._zimo = t;
}

// テンパイの手 (13 枚) の待ちと、待ちごとの値 (ロン ・ ツモ)、フィーバーの段。同じ手は覚えておく
export type Waits = { waits: string[]; ron: Map<string, number>; tsumo: Map<string, number>; furiten: boolean; fever: number; pochiRon?: number };
function waitsOf(sp13: any, ctx: McCtx, cache: Map<string, Waits>): Waits {
  const key = sp13.toString();
  const hit = cache.get(key);
  if (hit) return hit;
  if (isKanpamanTenpai(sp13)) {
    const k = { waits: [], ron: new Map(), tsumo: new Map(), furiten: false, fever: 0, pochiRon: kanpamanValue(sp13, ctx.param, ctx.env, ctx.kinds, ctx.unseen) };
    cache.set(key, k);
    return k;
  }
  let waits: string[] = [];
  try { waits = (Majiang.Util.tingpai(sp13) ?? []).filter((w: string) => ctx.kinds.includes(w)); } catch { waits = []; }
  let fever = 0;
  try { const f = canFeverLizhi(unswapM1(sp13.clone())); if (f.ok) fever = f.tier; } catch { fever = 0; }
  const ron = new Map<string, number>();
  const tsumo = new Map<string, number>();
  for (const w of waits) {
    if (ctx.env) {
      ron.set(w, winValue(sp13, w, false, ctx.param, ctx.env, ctx.kinds, ctx.unseen, fever));
      tsumo.set(w, winValue(sp13, w, true, ctx.param, ctx.env, ctx.kinds, ctx.unseen, fever));
      continue;
    }
    let r = 0;
    let z = 0;
    try { r = Number(Majiang.Util.hule(sp13.clone(), `${w}-`, ctx.param)?.defen ?? 0); } catch { r = 0; }
    try {
      const t14 = sp13.clone();
      addTile(t14, w);
      z = Number(Majiang.Util.hule(t14, null, ctx.param)?.defen ?? 0);
    } catch { z = 0; }
    ron.set(w, r);
    tsumo.set(w, z);
  }
  const out = { waits, ron, tsumo, furiten: waits.some((w) => ctx.river.has(w)), fever: ctx.env ? fever : 0 };
  cache.set(key, out);
  return out;
}

// 残したい牌: 赤 ・ 金 (0)、2 枚以上ある 7 (フィーバーの種)。受け入れの枚数に直した重み
function keepWeight(sp14: any, c: string): number {
  if (/0/.test(c)) return 4;
  const s = c[0];
  if (c[1] === '7' && s !== 'z' && Number(sp14._bingpai?.[s]?.[7] ?? 0) >= 2) return 3;
  if (c.startsWith('m1') && Number(sp14._bingpai?.m?.[1] ?? 0) >= 2) return 3; // 7萬 (1萬で持っている)
  return 0;
}

// テンパイ前の打牌: シャンテンが一番少なく、その中で受け入れ (見えていない枚数) − 残したい重み が一番多い牌
function greedyDiscard(sp14: any, ctx: McCtx): string {
  const cands: string[] = [...new Set((sp14.get_dapai(false) ?? []) as string[])];
  let best: string[] = [];
  let bestXt = 99;
  for (const c of cands) {
    const a = sp14.clone();
    try { a.dapai(c); } catch { continue; }
    const xt = Majiang.Util.xiangting(a);
    if (xt < bestXt) { bestXt = xt; best = [c]; } else if (xt === bestXt) best.push(c);
  }
  if (best.length <= 1) return best[0] ?? cands[0];
  let pick = best[0];
  let pickU = -1e9;
  for (const c of best) {
    const a = sp14.clone();
    a.dapai(c);
    let u = 0;
    for (const k of ctx.kinds) {
      const rem = ctx.unseen(k);
      if (!rem) continue;
      a._bingpai[k[0]][Number(k[1])] += 1;
      if (Majiang.Util.xiangting(a) < bestXt) u += rem;
      a._bingpai[k[0]][Number(k[1])] -= 1;
    }
    const score = u - (ctx.env ? keepWeight(sp14, c) : 0);
    if (score > pickU) { pickU = score; pick = c; }
  }
  return pick;
}

/** 切った後の手 (13 枚) を sims 回試して、和了率と、アガった時の平均の値と、期待値 (1 回あたりの値の平均) を返す。
 *  fever はフィーバーになった割合。フィーバーの局は何度もアガるので、値はその局の合計。
 *  samples は 1 回ずつの値。同じ seed の候補どうしは同じ山の並びなので、差の揺れ (標準誤差) を出すのに使う */
export function mcOption(sp13: any, ctx: McCtx, sims: number, cache: Map<string, Waits>): { win: number; value: number; ev: number; tsumo: number; fever: number; samples: Float64Array } {
  const rand = rng(ctx.seed);
  const base: string[] = [];
  for (const k of ctx.kinds) for (let i = 0; i < ctx.unseen(k); i++) base.push(k);
  let wins = 0;
  let tsumoWins = 0;
  let fevers = 0;
  let sum = 0;
  const samples = new Float64Array(sims);
  for (let s = 0; s < sims; s++) {
    const pool = base.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const hand = sp13.clone();
    hand._zimo = null;
    let tenpai: Waits | null = Majiang.Util.xiangting(hand) === 0 || isKanpamanTenpai(hand) ? waitsOf(hand, ctx, cache) : null;
    let got = 0;
    let byTsumo = false;
    let pochiWin = false;
    let feverRun = false;
    for (let d = 0; d < ctx.draws && pool.length; d++) {
      if (tenpai?.fever) {
        // フィーバー: 残りの山 (自分の番から数えて) に出る待ち牌を全部アガる
        feverRun = true;
        let slot = 0;
        for (let left = (ctx.draws - d) * 3; left > 0 && pool.length; left--, slot++) {
          const x = pool.pop() as string;
          if (!tenpai.tsumo.has(x)) continue;
          const own = slot % 3 === 0;
          got += own ? (tenpai.tsumo.get(x) ?? 0) : (tenpai.ron.get(x) ?? 0);
          if (own) byTsumo = true;
        }
        break;
      }
      const t = pool.pop() as string;
      if (tenpai) {
        if (tenpai.tsumo.has(t)) { got = tenpai.tsumo.get(t) ?? 0; byTsumo = true; break; }
        if (ctx.pochiWild && t === 'z5') { pochiWin = true; byTsumo = true; break; }
      } else {
        addTile(hand, t);
        const c = greedyDiscard(hand, ctx);
        hand.dapai(c);
        if (Majiang.Util.xiangting(hand) === 0 || isKanpamanTenpai(hand)) tenpai = waitsOf(hand, ctx, cache);
        if (tenpai?.fever) continue;
      }
      // 相手 2 人の番: 局が終わるか、打牌でロン
      let ron = 0;
      let ended = false;
      for (let o = 0; o < 2 && pool.length; o++) {
        if (rand() < ctx.endRate) { ended = true; break; }
        const x = pool.pop() as string;
        if (tenpai && !tenpai.furiten && tenpai.ron.has(x) && rand() < (ctx.ronTake ?? RON_TAKE)) { ron = tenpai.ron.get(x) ?? 0; break; }
        if (tenpai?.pochiRon && x === 'z5' && rand() < POSITIVE_POCHI_RATE && rand() < (ctx.ronTake ?? RON_TAKE)) { ron = tenpai.pochiRon; break; }
      }
      if (ron) { got = ron; break; }
      if (ended) break;
    }
    if (feverRun) fevers += 1;
    samples[s] = got;
    if (got > 0 || pochiWin) { wins += 1; sum += got; if (byTsumo) tsumoWins += 1; }
  }
  const win = wins / sims;
  const value = wins ? sum / wins : 0;
  return { win, value, ev: sum / sims, tsumo: wins ? tsumoWins / wins : 0, fever: fevers / sims, samples };
}
