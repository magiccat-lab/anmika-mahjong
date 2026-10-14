// 打牌の分析の物差しをチップ (祝儀) で数える [2026-10-14 リョー「フィーバー効率とか祝儀効率 (裏効率、冬効率) とかも考慮したい」]
// アンミカの最後の成績はチップ (アガリの祝儀 + 順位点) なので、期待値もチップで比べる。
//  - 点 → チップ: CHIP_PER_POINT。今の順位点 (2着クビ +50/0/-50 ・ クビなし +75/-25/-50) と 8 万点以上のトップ祝儀を、
//    これまでの 24 東風 ・ 72 人分の終わりの点に当てて、点 1,000 あたりのチップを回帰で出した (1.65 枚)
//  - アガリの祝儀 (winChips): 赤 2 ・ 金 4 ・ 虹 7 ・ 抜き北 1 ・ 一発 1 ・ 裏ドラ 1 (見込み) ・ 面前ホンイツ 5 ・ 面前チンイツ 10 ・ 二盃口 15 ・
//    三倍満 3 ・ 役満 5/7/9 (ツモはオールで 2 人分、ロンは放銃者だけ。役満のロンは 10/14/18)。フィーバーは段の祝儀 (+1/+2/+4 オール) と、
//    打点 ・ 祝儀の倍 (ダブル 2 ・ トリプル 4 ・ クアドラプル 8)。シュバ中は祝儀 2 倍
//  - 裏効率: 裏ドラ表示が見えていない牌から 1 枚ずつ出るとして、手の牌が裏になる枚数の見込み (uraExpect)
//  - 冬効率: 冬を抜いていればアリス (現物、冬冬ならチューリップで ±1 も) を、外れるまでめくる見込み (aliceExpect)
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { tulipNeighbors } from '../../src/lib/game3/tulip';

export const CHIP_PER_POINT = 1.65 / 1000;

// アンミカの萬子は 7 と 9 だけで、7 は 1 として扱う (順子にならない)。majiang-core にそのまま渡すと 7萬 9萬 を嵌張と数えるので、
// 分析では 7萬 を 1萬 に置き換えた手でシャンテン ・ 待ち ・ 点数を出す [2026-10-14、昨夜の「シャンテン戻し」の多くが 9萬切りだった]
export function swapM7(sp: any): any {
  const m7 = Number(sp?._bingpai?.m?.[7] ?? 0);
  if (!m7) return sp;
  sp._bingpai.m[1] = Number(sp._bingpai.m[1] ?? 0) + m7;
  sp._bingpai.m[7] = 0;
  if (sp._zimo === 'm7') sp._zimo = 'm1';
  return sp;
}
/** swapM7 の逆 (フィーバーの 7萬 の暗刻を見る時) */
export function unswapM1(sp: any): any {
  const m1 = Number(sp?._bingpai?.m?.[1] ?? 0);
  if (!m1) return sp;
  sp._bingpai.m[7] = Number(sp._bingpai.m[7] ?? 0) + m1;
  sp._bingpai.m[1] = 0;
  if (sp._zimo === 'm1') sp._zimo = 'm7';
  return sp;
}
/** 分析の牌の種類 (7萬 は 1萬 で持つ) と、その見えていない枚数 */
export const swapKind = (t: string) => (t === 'm7' ? 'm1' : t);
export const unswapKind = (t: string) => (t === 'm1' ? 'm7' : t);

export type ChipEnv = { nuki: number; fuyu: number; hua: number; fulou: boolean; shuba: boolean; nInd: number };

/** 打つ人の今の祝儀まわり (抜き北 ・ 冬 ・ 華 ・ 鳴き ・ シュバ ・ ドラ表示の枚数) */
export function chipEnvOf(game: any, player: number): ChipEnv {
  const sp = game.shoupai.get(player);
  const hua = ((game.huapai?.[player] ?? []) as string[]);
  return {
    nuki: Number(game.nukidora?.[player] ?? 0) + Number(game.nukidoraGold?.[player] ?? 0),
    fuyu: hua.filter((p) => p === 'f4').length,
    hua: hua.length,
    fulou: ((sp?._fulou ?? []) as string[]).some((m) => /[+=\-]/.test(m)),
    shuba: !!game.shuvariActive?.[player],
    nInd: ((game.shan?.baopai ?? []) as string[]).filter((x) => typeof x === 'string' && !x.startsWith('f')).length || 1,
  };
}

export const feverMult = (tier: number) => (tier >= 4 ? 8 : tier === 3 ? 4 : tier === 2 ? 2 : 1);
const feverBonus = (tier: number) => (tier >= 4 ? 8 : tier === 3 ? 4 : tier === 2 ? 2 : 1);

// 表示牌 → ドラ (アンミカの三麻: 萬子は 7 と 9 だけで 7 ↔ 9、字牌は 風 ・ 三元で一巡)
export function doraOf(ind: string): string {
  const s = ind[0];
  const n = Number(ind[1] === '0' ? 5 : ind[1]);
  if (s === 'm') return n === 7 ? 'm9' : 'm7';
  if (s === 'z') return n <= 4 ? `z${(n % 4) + 1}` : `z${n === 7 ? 5 : n + 1}`;
  return `${s}${n === 9 ? 1 : n + 1}`;
}

/** 手 (鳴き ・ 暗槓込み) の牌の種類ごとの枚数。赤は 5 に寄せる */
export function handCounts(sp: any): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of ['m', 'p', 's', 'z']) for (let n = 1; n <= 9; n++) {
    // 赤は majiang-core が _bingpai[s][5] の内数で持つので、5 を数えれば足りる
    const k = Number(sp._bingpai?.[s]?.[n] ?? 0);
    if (k) c[unswapKind(s + n)] = (c[unswapKind(s + n)] ?? 0) + k;
  }
  for (const m of (sp._fulou ?? []) as string[]) {
    const s = m[0];
    for (const ch of m.replace(/[^0-9]/g, '')) { const n = ch === '0' ? 5 : Number(ch); const k = unswapKind(s + n); c[k] = (c[k] ?? 0) + 1; }
  }
  return c;
}

/** 裏ドラの枚数の見込み: 表示牌が見えていない牌から nInd 枚出るとして */
export function uraExpect(counts: Record<string, number>, env: ChipEnv, kinds: string[], unseen: (t: string) => number): number {
  const U = kinds.reduce((a, t) => a + unseen(t), 0);
  if (!U) return 0;
  let e = 0;
  for (const i of kinds) {
    const p = unseen(i) / U;
    if (!p) continue;
    const d = doraOf(unswapKind(i));
    e += p * ((counts[d] ?? 0) + (d === 'z4' ? env.nuki : 0));
  }
  return e * env.nInd;
}

/** 冬のアリス (冬冬はチューリップ) の、受け取るチップの見込み。外れるまでめくる */
export function aliceExpect(counts: Record<string, number>, env: ChipEnv, kinds: string[], unseen: (t: string) => number, tsumo: boolean): number {
  if (!env.fuyu) return 0;
  const U = kinds.reduce((a, t) => a + unseen(t), 0);
  if (!U) return 0;
  const tulip = env.fuyu >= 2;
  let eh = 0;
  let ph = 0;
  for (const k of kinds) {
    const p = unseen(k) / U;
    if (!p) continue;
    const kk = unswapKind(k);
    let hits = counts[kk] ?? 0;
    if (tulip) for (const nb of tulipNeighbors(kk)) hits += counts[nb] ?? 0;
    eh += p * hits;
    if (hits > 0) ph += p;
  }
  const hits = eh / (1 - Math.min(0.9, ph));
  return hits * (env.fulou ? 1 : 2) * (tsumo ? 2 : 1);
}

/** アガった手 (14 枚の shoupai か、13 枚 + ロン牌の結果) の祝儀。受け取る合計 (ツモは 2 人分) */
export function winChips(spAfter: any, res: any, opts: { tsumo: boolean; env: ChipEnv; ura: number; ippatsu: boolean; feverTier: number; alice: number }): number {
  const m = opts.tsumo ? 2 : 1;
  const an = spAfter?._bingpai?.__anmika ?? {};
  const gold = Number(an.gp ?? 0) + Number(an.gs ?? 0);
  let red = 0;
  for (const s of ['m', 'p', 's']) red += Number(spAfter?._bingpai?.[s]?.[0] ?? 0);
  red = Math.max(0, red - gold);
  const niji = Number(an.np3 ?? 0) + Number(an.ns3 ?? 0) + Number(an.nz3 ?? 0);
  let c = m * (2 * red + 4 * gold + 7 * niji + opts.env.nuki + opts.ura + (opts.ippatsu ? 1 : 0));
  const names = new Set(((res?.hupai ?? []) as any[]).map((h) => String(h.name)));
  if (!opts.env.fulou) {
    if (names.has('清一色')) c += 10 * m;
    else if (names.has('混一色')) c += 5 * m;
    if (names.has('二盃口')) c += 15 * m;
  }
  const dm = Number(res?.damanguan ?? 0);
  if (dm > 0) c += opts.tsumo ? 2 * (dm >= 3 ? 9 : dm === 2 ? 7 : 5) : (dm >= 3 ? 18 : dm === 2 ? 14 : 10);
  else if (Number(res?.fanshu ?? 0) >= 11) c += opts.tsumo ? 6 : 6;
  c += opts.alice;
  if (opts.feverTier) c = c * feverMult(opts.feverTier) + 2 * feverBonus(opts.feverTier);
  if (opts.env.shuba) c *= 2;
  return c;
}

/** 点 (受け取る点) とチップを合わせた値 (枚) */
export const toChips = (points: number, chips: number) => points * CHIP_PER_POINT + chips;

/** 13 枚の手が ron 牌 / ツモ牌 w でアガった時の、点とチップ (枚)。フィーバーの段の倍は打点にも掛ける */
export function winValue(sp13: any, w: string, tsumo: boolean, param: any, env: ChipEnv, kinds: string[], unseen: (t: string) => number, feverTier: number, ippatsu = false): number {
  let res: any = null;
  let after: any = sp13.clone();
  try {
    if (tsumo) {
      after._bingpai[w[0]][Number(w[1])] += 1;
      after._zimo = w;
      res = Majiang.Util.hule(after, null, param);
    } else {
      res = Majiang.Util.hule(sp13.clone(), `${w}-`, param);
      after._bingpai[w[0]][Number(w[1])] += 1;
    }
  } catch { res = null; }
  if (!res) return 0;
  const counts = handCounts(after);
  const pts = Number(res.defen ?? 0) * (feverTier ? feverMult(feverTier) : 1);
  const chips = winChips(after, res, {
    tsumo, env, ura: uraExpect(counts, env, kinds, unseen), ippatsu, feverTier,
    alice: aliceExpect(counts, env, kinds, unseen, tsumo),
  });
  return toChips(pts, chips);
}
