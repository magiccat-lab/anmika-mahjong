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
import { tulipNeighbors } from './tulip';
import { americanChitoiComplete, countAmericanChitoiQuads } from './tingpai';

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
/** 嵌八萬 (7萬 9萬 の嵌張。8萬は無い): 門前でリーチした後、ぽっちのツモ (どの色でも) か正のぽっち (緑 ・ 青) のロンでだけアガれる。
 *  7萬を 1萬にした手では形にならないので、元の手の通常形のシャンテンで別に数える。門前でなければ 99
 *  [2026-10-23 先輩「間8mを含めた効率の精査」] */
export function kanpamanXt(spSw: any): number {
  if (!(Number(spSw?._bingpai?.m?.[1] ?? 0) > 0 && Number(spSw?._bingpai?.m?.[9] ?? 0) > 0)) return 99;
  if (((spSw._fulou ?? []) as string[]).some((m) => /[-+=]/.test(m))) return 99;
  try { return Majiang.Util.xiangting_yiban(unswapM1(spSw.clone())); } catch { return 99; }
}
/** 13 枚の手 (7萬を 1萬にした手) が嵌八萬だけのテンパイか */
export function isKanpamanTenpai(spSw13: any): boolean {
  if (kanpamanXt(spSw13) !== 0) return false;
  try { return Majiang.Util.xiangting(spSw13) !== 0; } catch { return false; }
}
/** 嵌八萬のロンの値 (8萬でアガった形で数える)。正のぽっちは白 4 枚のうち 2 枚 */
export const POSITIVE_POCHI_RATE = 0.5;
export function kanpamanValue(spSw13: any, param: any, env: ChipEnv | undefined, kinds: string[], unseen: (t: string) => number): number {
  const sp = unswapM1(spSw13.clone());
  if (env) return winValue(sp, 'm8', false, param, env, kinds, unseen, 0);
  try { return Number(Majiang.Util.hule(sp, 'm8-', param)?.defen ?? 0); } catch { return 0; }
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

/** 13 枚の手が ron 牌 / ツモ牌 w でアガった時の、点とチップ (枚)。フィーバーの段の倍は打点にも掛ける。
 *  役が無ければ (res に hupai が無い) アガれないので 0 [CPU の打牌で開いた手の役なしを弾く、2026-10-28] */
export function winValue(sp13: any, w: string, tsumo: boolean, param: any, env: ChipEnv, kinds: string[], unseen: (t: string) => number, feverTier: number, ippatsu = false): number {
  return winDetail(sp13, w, tsumo, param, env, kinds, unseen, feverTier, ippatsu).value;
}

/** winValue の中身。役満かどうか (damanguan) も返す [北単騎は役満でしかアガれない判定用] */
export function winDetail(sp13: any, w: string, tsumo: boolean, param: any, env: ChipEnv, kinds: string[], unseen: (t: string) => number, feverTier: number, ippatsu = false): { value: number; damanguan: number } {
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
  // majiang-core は役なしだと { defen: 0 } を返す [hupai 無し]。アメリカ七対子は core が組めないので別に見る
  if (!res || !Array.isArray(res.hupai) || !(Number(res.defen ?? 0) > 0)) {
    res = americanChitoiWin(after, tsumo, param);
    if (!res) return { value: 0, damanguan: 0 };
  }
  const counts = handCounts(after);
  const pts = Number(res.defen ?? 0) * (feverTier ? feverMult(feverTier) : 1);
  const chips = winChips(after, res, {
    tsumo, env, ura: uraExpect(counts, env, kinds, unseen), ippatsu, feverTier,
    alice: aliceExpect(counts, env, kinds, unseen, tsumo),
  });
  return { value: toChips(pts, chips), damanguan: Number(res.damanguan ?? 0) };
}

/** アメリカ七対子 (4 枚使いを 2 対子に数える) は core の hule が組めないので、七対子 25 符の素点で見積もる。
 *  翻は 七対子 2 + 4 枚使い 1 種ごとに 4 + 立直 + ツモ。ドラは見ない (CPU の同点崩しなので粗くてよい) */
function americanChitoiWin(after14: any, tsumo: boolean, param: any): any {
  try {
    if (!americanChitoiComplete(after14)) return null;
    const closed = !((after14._fulou ?? []) as string[]).some((m) => /[-+=]/.test(m));
    let han = 2 + 4 * countAmericanChitoiQuads(after14);
    if (closed && Number(param?.hupai?.lizhi ?? 0) > 0) han += Number(param.hupai.lizhi) >= 2 ? 2 : 1;
    if (tsumo && closed) han += 1;
    const base = han >= 13 ? 8000 : han >= 11 ? 6000 : han >= 8 ? 4000 : han >= 6 ? 3000 : han >= 5 ? 2000 : Math.min(2000, 25 * 2 ** (2 + han));
    const dealer = Number(param?.menfeng ?? 1) === 0;
    return {
      hupai: [{ name: '七対子', fanshu: 2 }], fanshu: han, fu: 25, damanguan: 0,
      defen: Math.ceil(base * (dealer ? 6 : 4) / 100) * 100,
    };
  } catch { return null; }
}

// ---- CPU の打牌: テンパイ候補の手の価値 (同シャンテン ・ 同受け入れの同点崩し) [2026-10-28 3 者合議] ----

/** 点の計算に渡すルール (game3.hule と同じ設定) */
export function anmikaHuleRule(): any {
  return Majiang.rule({
    '配給原点': 35000, '順位点': ['30.0', '0', '-30.0'], '場数': 1, '連荘方式': 3, 'ノーテン罰あり': false,
    'クイタンあり': true, '途中流局あり': false, '一発あり': true, '裏ドラあり': true,
  });
}

/** 山にある牌の種類 (7萬は 1萬 で持つ分析の形)。受け入れの数え方と同じ並び */
export const CPU_SW_KINDS: string[] = (() => {
  const ks: string[] = [];
  for (let n = 1; n <= 9; n++) {
    if (n === 7 || n === 9) ks.push(swapKind(`m${n}`));
    ks.push(`p${n}`, `s${n}`);
  }
  for (let n = 1; n <= 7; n++) ks.push(`z${n}`);
  return ks;
})();

/** ツモの重み。待ち牌は山から 3 人が順に引くので、自分で引く (ツモ) のは 1/3、残り 2/3 は他家が切った牌でのロン */
export const TSUMO_SHARE = 1 / 3;

export type TenpaiWait = { tile: string; remaining: number };
export type TenpaiValueOpts = {
  param: any; env: ChipEnv; unseen: (swKind: string) => number; feverTier: number;
  /** 待ち牌のどれかが自分の河にある ・ 見逃し済み: ロンできない (ツモだけ) */
  furiten: boolean;
};

/** テンパイ 13 枚 (7萬を 1萬にした手) の「アガりの期待値」 Σ 残り枚数 × (ツモ重み × ツモの値 + ロン重み × ロンの値) (チップ枚)。
 *  役なし ・ フリテンのロン ・ 北単騎 (役満以外はアガれない) は 0。
 *  平均でなく合計: 同点崩しで比べる手は受け入れ (残り枚数の合計) が等しく、合計なら「アガれない待ち」が薄めずに効く */
export function tenpaiWinValue(sp13Sw: any, waits: TenpaiWait[], o: TenpaiValueOpts): number {
  const onlyNorth = waits.length > 0 && waits.every((w) => w.tile === 'z4');
  let sum = 0;
  for (const w of waits) {
    if (w.remaining <= 0) continue;
    const t = winDetail(sp13Sw, w.tile, true, o.param, o.env, CPU_SW_KINDS, o.unseen, o.feverTier);
    const r = o.furiten ? { value: 0, damanguan: 0 } : winDetail(sp13Sw, w.tile, false, o.param, o.env, CPU_SW_KINDS, o.unseen, o.feverTier);
    const tv = onlyNorth && t.damanguan <= 0 ? 0 : t.value;
    const rv = onlyNorth && r.damanguan <= 0 ? 0 : r.value;
    sum += w.remaining * (TSUMO_SHARE * tv + (1 - TSUMO_SHARE) * rv);
  }
  return sum;
}
