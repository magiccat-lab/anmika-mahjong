// モンテカルロで切った後の手の和了率と打点を数える [2026-10-14 リョー、麻雀 AI の考え方のページの答え P3「a やる」]
// 打牌の分析 (tools/room_analysis.mts --mc <回数>) が、1 シャンテン以下の候補ごとに呼ぶ。
// 1 回の試し: 打つ人から見えていない牌を山に並べ直し、残りの自分のツモの回数だけ回す。
//  - 自分のツモ: アガれば打点 (ツモ)。テンパイならツモ切り (リーチの形)、テンパイ前はシャンテン → 受け入れの多い牌を切る
//  - 1 巡に相手 2 人の打牌: 山から 1 枚ずつ引いた牌を打ったと見て、テンパイで待ちに当たれば RON_TAKE の割合でロン (相手は危ない牌を止めるので半分の仮置き)
//  - 自分の河の牌で待つ形はフリテンなのでロンしない
//  - 相手の番ごとに endRate の割合で局が終わる (誰かのアガリ。部屋のアガリの回数 ÷ 打牌の回数で、room_analysis が渡す)
// 打点は room_analysis と同じ majiang-core の点数 (リーチ付き) × (1 + フィーバーの段)。華 ・ 金 ・ 虹 ・ 白ぽっちの引きは数えない (山は普通の牌の種類だけ)
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { canFeverLizhi } from '../../src/lib/game3/feverLizhi';

export const RON_TAKE = 0.5;

export type McCtx = {
  kinds: string[]; unseen: (t: string) => number; draws: number; param: any; river: Set<string>; seed: number; endRate: number;
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

// テンパイの手 (13 枚) の待ちと、待ちごとの打点 (ロン ・ ツモ)。同じ手は覚えておく
type Waits = { waits: string[]; ron: Map<string, number>; tsumo: Map<string, number>; furiten: boolean };
function waitsOf(sp13: any, ctx: McCtx, cache: Map<string, Waits>): Waits {
  const key = sp13.toString();
  const hit = cache.get(key);
  if (hit) return hit;
  let waits: string[] = [];
  try { waits = (Majiang.Util.tingpai(sp13) ?? []).filter((w: string) => ctx.kinds.includes(w)); } catch { waits = []; }
  let fever = 0;
  try { const f = canFeverLizhi(sp13); if (f.ok) fever = f.tier; } catch { fever = 0; }
  const ron = new Map<string, number>();
  const tsumo = new Map<string, number>();
  for (const w of waits) {
    let r = 0;
    let z = 0;
    try { r = Number(Majiang.Util.hule(sp13.clone(), `${w}-`, ctx.param)?.defen ?? 0); } catch { r = 0; }
    try {
      const t14 = sp13.clone();
      addTile(t14, w);
      z = Number(Majiang.Util.hule(t14, null, ctx.param)?.defen ?? 0);
    } catch { z = 0; }
    ron.set(w, r * (1 + fever));
    tsumo.set(w, z * (1 + fever));
  }
  const out = { waits, ron, tsumo, furiten: waits.some((w) => ctx.river.has(w)) };
  cache.set(key, out);
  return out;
}

// テンパイ前の打牌: シャンテンが一番少なく、その中で受け入れ (見えていない枚数) が一番多い牌
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
  let pickU = -1;
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
    if (u > pickU) { pickU = u; pick = c; }
  }
  return pick;
}

/** 切った後の手 (13 枚) を sims 回試して、和了率と、アガった時の平均打点と、期待値 (和了率 × 平均打点) を返す */
export function mcOption(sp13: any, ctx: McCtx, sims: number, cache: Map<string, Waits>): { win: number; value: number; ev: number; tsumo: number } {
  const rand = rng(ctx.seed);
  const base: string[] = [];
  for (const k of ctx.kinds) for (let i = 0; i < ctx.unseen(k); i++) base.push(k);
  let wins = 0;
  let tsumoWins = 0;
  let sum = 0;
  for (let s = 0; s < sims; s++) {
    const pool = base.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const hand = sp13.clone();
    hand._zimo = null;
    let tenpai: Waits | null = Majiang.Util.xiangting(hand) === 0 ? waitsOf(hand, ctx, cache) : null;
    let got = 0;
    let byTsumo = false;
    for (let d = 0; d < ctx.draws && pool.length; d++) {
      const t = pool.pop() as string;
      if (tenpai) {
        if (tenpai.tsumo.has(t)) { got = tenpai.tsumo.get(t) ?? 0; byTsumo = true; break; }
      } else {
        addTile(hand, t);
        const c = greedyDiscard(hand, ctx);
        hand.dapai(c);
        if (Majiang.Util.xiangting(hand) === 0) tenpai = waitsOf(hand, ctx, cache);
      }
      // 相手 2 人の番: 局が終わるか、打牌でロン
      let ron = 0;
      let ended = false;
      for (let o = 0; o < 2 && pool.length; o++) {
        if (rand() < ctx.endRate) { ended = true; break; }
        const x = pool.pop() as string;
        if (tenpai && !tenpai.furiten && tenpai.ron.has(x) && rand() < RON_TAKE) { ron = tenpai.ron.get(x) ?? 0; break; }
      }
      if (ron) { got = ron; break; }
      if (ended) break;
    }
    if (got > 0) { wins += 1; sum += got; if (byTsumo) tsumoWins += 1; }
  }
  const win = wins / sims;
  const value = wins ? sum / wins : 0;
  return { win, value, ev: win * value, tsumo: wins ? tsumoWins / wins : 0 };
}
