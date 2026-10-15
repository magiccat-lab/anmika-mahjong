// 白ぽっち ・ でかぽっちの絞りの演出の決まり (2026-10-14 リョー、演出のラフ 1〜3 版の答え)。
// 見せ方だけで、点数 ・ チップ ・ CPU の打ち方には触らない。
//  - めくれた後の字は「色の名前と効果」(3 版 T1 a): 青ぽっち ・ チップ ×2 など。でかぽっちは「でかぽっち」
//  - 枠の光り (期待度) は、正の時ほど強く出す。虹は正の確定で、逆の時は虹を出さない (1 版 Q2 a)
//  - 見えている牌 (河 ・ 鳴き ・ ドラ表示) から、まだ見えていない色が正だけ ・ 逆だけなら確定演出を出す
//    (同じ日「捨て牌とか公開情報から白ポッチの正負とか中身とか確定してるときは確定演出出していいよ」)
export type PochiColor = 'blue' | 'red' | 'green' | 'yellow';
export type Glow = 'white' | 'gold' | 'rainbow';

export const POCHI_COLORS: readonly PochiColor[] = ['blue', 'red', 'green', 'yellow'];
export const POCHI_GOOD: Record<PochiColor, boolean> = { blue: true, green: true, red: false, yellow: false };
const COLOR_JA: Record<PochiColor, string> = { blue: '青', green: '緑', red: '赤', yellow: '黄' };
const EFFECT: Record<PochiColor, string> = { blue: 'チップ ×2', green: 'チップ ×1', red: '逆払い ×2', yellow: '逆払い ×1' };
/** 牌の点の色 (public/tiles/Haku-*.svg と同じ) */
export const POCHI_DOT: Record<PochiColor, string> = { blue: '#133382', green: '#1e8a3c', red: '#c8102e', yellow: '#e8b400' };

/** めくれた後の帯の字 (大きい字と、右下の黒い札) */
export function pochiRevealText(color: PochiColor, deka = false): { word: string; tag: string } {
  if (deka) return { word: 'でかぽっち', tag: EFFECT[color] };
  return { word: `${COLOR_JA[color]}ぽっち`, tag: EFFECT[color] };
}

/** 枠の光りの 2 段 (絞りの途中で 1 段目、色の手前で 2 段目)。rnd は 0〜1 の乱数。
 *  正: 3 割で 金 → 虹、4 割半で 白 → 金、残りは白のまま。逆: 2 割で 白 → 金、残りは白のまま。逆で虹は出さない */
export function expectationGlow(good: boolean, rnd: number): [Glow, Glow] {
  if (good) {
    if (rnd < 0.3) return ['gold', 'rainbow'];
    if (rnd < 0.75) return ['white', 'gold'];
    return ['white', 'white'];
  }
  if (rnd < 0.2) return ['white', 'gold'];
  return ['white', 'white'];
}

function colorOfPai(pai: unknown): PochiColor | null {
  const p = String(pai ?? '').replace(/[+=\-_*]/g, '');
  if (p.startsWith('z5b')) return 'blue';
  if (p.startsWith('z5r')) return 'red';
  if (p.startsWith('z5g')) return 'green';
  if (p.startsWith('z5y')) return 'yellow';
  return null;
}

/** 見えている牌 (全員の河 ・ 鳴き ・ ドラ表示) に出ている白ぽっちの色を除いた、まだ見えていない色 */
export function publicPochiCandidates(game: any): PochiColor[] {
  const seen = new Set<PochiColor>();
  for (const p of [0, 1, 2]) {
    for (const d of (game?.discardLog?.[p] ?? []) as Array<{ pochi?: string }>) {
      const c = d?.pochi as PochiColor | undefined;
      if (c && POCHI_COLORS.includes(c)) seen.add(c);
    }
    const sp = game?.shoupai?.get?.(p);
    for (const m of (sp?._anmikaFulouPhysical ?? []) as Array<{ consumed?: string[] }>) {
      for (const x of m?.consumed ?? []) { const c = colorOfPai(x); if (c) seen.add(c); }
    }
  }
  for (const x of (game?.shan?.baopai ?? []) as string[]) { const c = colorOfPai(x); if (c) seen.add(c); }
  return POCHI_COLORS.filter((c) => !seen.has(c));
}

/** まだ見えていない色が正だけなら 'good'、逆だけなら 'bad'、混ざっていれば null */
export function kakuteiOf(candidates: PochiColor[]): 'good' | 'bad' | null {
  if (!candidates.length) return null;
  if (candidates.every((c) => POCHI_GOOD[c])) return 'good';
  if (candidates.every((c) => !POCHI_GOOD[c])) return 'bad';
  return null;
}

/** 手牌の表示の鍵 (bu ・ br ・ bg ・ by と z5b 〜 z5y) から白ぽっちの色 */
export function pochiColorOfKey(key: string): PochiColor | null {
  const map: Record<string, PochiColor> = { bu: 'blue', br: 'red', bg: 'green', by: 'yellow' };
  return map[key] ?? colorOfPai(key);
}
/** フィーバー中に見せる「ぽっちの残り」(2026-10-14 リョー「フィーバー時にポッチの残り状況も待ちと一緒に見せたい」
 *  「これは他家の手牌はいれずにね」)。見えている牌 (河 ・ 鳴き ・ ドラ表示) と自分の手牌に出た色を除いた色。
 *  他の人の手牌は数えない (持っていても残りに入る) */
export function pochiLeftForViewer(game: any, ownTiles: string[]): PochiColor[] {
  const own = new Set(ownTiles.map(pochiColorOfKey).filter((c): c is PochiColor => !!c));
  return publicPochiCandidates(game).filter((c) => !own.has(c));
}

// ---- 4 版の答え (2026-10-14 リョー「ポッチの演出もうちょっと強化したい」→ ステップアップ ・ 溜め ・ プレミアを入れる) ----
/** ステップアップの 5 段 (白 → 青 → 緑 → 金 → 虹)。絞った割合が STEP_AT を越えるたびに 1 段上がる (点がのぞく 0.44 より前に終わる) */
export type StepGlow = 'white' | 'blue' | 'green' | 'gold' | 'rainbow';
export const STEP_GLOW: readonly StepGlow[] = ['white', 'blue', 'green', 'gold', 'rainbow'];
export const STEP_WORD: readonly string[] = ['チャンス', '熱', '激熱', '超激熱', '確定'];
export const STEP_AT: readonly number[] = [0.1, 0.2, 0.29, 0.36, 0.43];
/** 溜め: この間は暗くして牌に寄り、指を動かしても半分しかめくれない (スロー)。心臓の音も速くなる */
export const TAME_FROM = 0.37;
export const TAME_TO = 0.465;
export const TAME_BEATS: readonly number[] = [0.385, 0.405, 0.42, 0.435, 0.447, 0.456, 0.462];

/** どこまで上がるか (0〜4)。rnd は 0〜1。正: 虹 3 割 ・ 金 4 割 ・ 緑 2 割 ・ 青 1 割。逆: 金 1 割 ・ 緑 4 割 ・ 青 3 割半 ・ 白 1 割半 (逆で虹は出さない) */
export function expectationStep(good: boolean, rnd: number): number {
  if (good) return rnd < 0.3 ? 4 : rnd < 0.7 ? 3 : rnd < 0.9 ? 2 : 1;
  return rnd < 0.1 ? 3 : rnd < 0.5 ? 2 : rnd < 0.85 ? 1 : 0;
}
/** 見えている牌で正が決まっていれば虹まで、逆が決まっていれば白で止める。決まっていなければ expectationStep */
export function pochiTopStep(good: boolean, kakutei: 'good' | 'bad' | null, rnd: number): number {
  if (kakutei === 'good') return 4;
  if (kakutei === 'bad') return 0;
  return expectationStep(good, rnd);
}
/** プレミア: 虹まで上がる (= 正の確定) 時の 1 割。引いた瞬間に虹の光線とアンミカーニバルのサビ 3 秒 */
export const PREMIUM_RATE = 0.1;
export function premiumRoll(topStep: number, rnd: number): boolean {
  return topStep >= 4 && rnd < PREMIUM_RATE;
}

// ---- 予告の割合 (演出一覧のページも同じ数を読む) ----
/** 3 つ目の予告「白黒」(fx5 V3): 当たりで 25%、外れでも 6% (ガセ予告)。残りは稲妻と決め台詞を半々 */
export const TEASER_MONO_RATE = { good: 0.25, bad: 0.06 } as const;
/** 無演出 (2026-10-15 fx9 B7 a、先輩「無演出でもあたるように」): 予告が何も出ないまま絞りに入る。
 *  当たりの 2%、外れの 38% (無演出の時に当たる割合は約 4%)。白黒の次に決め、残りが稲妻と決め台詞の半々 */
export const TEASER_NONE_RATE = { good: 0.02, bad: 0.38 } as const;
export type Teaser = 'bolt' | 'line' | 'mono' | 'none';
export function teaserRoll(good: boolean, rnd1: number, rnd2: number): Teaser {
  const mono = good ? TEASER_MONO_RATE.good : TEASER_MONO_RATE.bad;
  if (rnd1 < mono) return 'mono';
  if (rnd1 < mono + (good ? TEASER_NONE_RATE.good : TEASER_NONE_RATE.bad)) return 'none';
  return rnd2 < 0.5 ? 'line' : 'bolt';
}

// ---- 告知ランプと遅れ (2026-10-15 fx10 の答え L1 a ・ B1 a。演出一覧のページも同じ数を読む) ----
/** 告知ランプ: 当たりなら必ず画面の外周が金に光る。引いた瞬間 (先告知) が 3 割、めくれた後 (後告知) が 7 割。外れは光らない
 *  (fx9 B2 の「ぽっちランプがダサすぎる、画面の外周が光るとかで」から作り直した形) */
export type LampTiming = 'pre' | 'post';
export const LAMP_PRE_RATE = 0.3;
export function lampRoll(good: boolean, rnd: number): LampTiming | null { return good ? (rnd < LAMP_PRE_RATE ? 'pre' : 'post') : null; }
/** 遅れ: 引いた時の「ピキーン」だけが 0.3 秒遅れる (牌と画面は普通に動く)。当たりの 20%、外れの 5%。
 *  フリーズの時は引いた音が鳴らないので遅れも無い */
export const DELAY_RATE = { good: 0.2, bad: 0.05 } as const;
export const DELAY_MS = 300;
export function delayRoll(good: boolean, rnd: number): boolean { return rnd < (good ? DELAY_RATE.good : DELAY_RATE.bad); }

// ---- フリーズ (2026-10-15 fx7 の答え「これぽっちの演出に入れたい」、暗転 a ・ 止め絵) ----
/** 引いた瞬間に画面と音が 1.3 秒止まり、明けにキュイン。当たりの確定で、外れでは出さない。
 *  出た時は予告の代わりで、光りは虹まで上がる (プレミアとは重ならない)。当たりの 3% が暗転、6% が止め絵 */
export type PochiFreeze = 'black' | 'still';
export const FREEZE_RATE: Record<PochiFreeze, number> = { black: 0.03, still: 0.06 };
export const FREEZE_MS = 1300;
export function freezeRoll(good: boolean, rnd: number): PochiFreeze | null {
  if (!good) return null;
  if (rnd < FREEZE_RATE.black) return 'black';
  if (rnd < FREEZE_RATE.black + FREEZE_RATE.still) return 'still';
  return null;
}
/** 今の段 (-1 はまだ光っていない) */
export function stepAt(peel: number, topStep: number): number {
  let k = -1;
  for (let i = 0; i <= Math.min(4, topStep); i++) if (peel >= STEP_AT[i]) k = i;
  return k;
}
/** 他の席へ流す時、前の型 (光り 2 段) の端末にも近い物を渡す */
export function legacyGlowOfStep(topStep: number): [Glow, Glow] {
  return topStep >= 4 ? ['gold', 'rainbow'] : topStep >= 3 ? ['white', 'gold'] : ['white', 'white'];
}
