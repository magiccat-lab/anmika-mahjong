// 白ぽっち ・ でかぽっちの絞りの演出の決まり (2026-10-14 リョー、演出のラフ 1〜3 版の答え)。
// 見せ方だけで、点数 ・ チップ ・ CPU の打ち方には触らない。
//  - めくれた後の字は「色の名前と効果」(3 版 T1 a): 青ぽっち ・ チップ ×2 など。でかぽっちは「でかぽっち」
//  - 光りは正の時ほど強く出す。虹は正の確定で、逆の時は虹を出さない (1 版 Q2 a)。2026-10-25 から絞りを止めてムービー + PUSH (下)
//  - 見えている牌 (河 ・ 鳴き ・ ドラ表示) から、まだ見えていない色が正だけ ・ 逆だけなら確定演出を出す
//    (同じ日「捨て牌とか公開情報から白ポッチの正負とか中身とか確定してるときは確定演出出していいよ」)
export type PochiColor = 'blue' | 'red' | 'green' | 'yellow';

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

// ---- 白ぽっちのムービー (2026-10-25 リョーの仕様「白ぽっち演出の作り直し」。絞りとステップアップ ・ 溜めは廃止) ----
// 牌は伏せたまま自動で流れ、結果は PUSH を押すまで一切見せない。
//  1. まず当落 (正 ・ 逆) を決める。見えている牌で決まっていれば kakutei
//  2. 次に ①〜⑥ の表から、当落に応じて「当たり時 ・ 外れ時」の列でそれぞれ独立に引く
//  3. プレミア (⑧) は当たりの時だけ上乗せで引く。告知ランプと遅れ (⑦) も別に引く
//  ムービーの長さと中身は plan (引いた演出) と kakutei だけで決まり、当落そのものでは変えない (movieTimeline)
//  表の数は仕様の「当たり時 ・ 外れ時」の列そのまま (% 単位)。演出一覧のページ (fxOdds) もこの表から数える
//  仕様から外した物 (10-25 遊真の判断): ⑧ の「PUSH が無音」(押しても何も起きないのは不具合と見分けがつかない) と
//  「卓の影のシルエット」(絵が要る上に気づかれない)。⑧ の暗転フリーズは ① と同じ物なので ① だけで引く。
//  告知ランプの先 ・ 後は 10-15 にリョーが決めた 3 割 ・ 7 割のまま (仕様の 1 割 ・ 9 割にはしない)。遅れは今のまま 20% ・ 5%
export type Opening = 'freeze_black' | 'freeze_still' | 'premium' | 'mono' | 'bolt' | 'line' | 'none';
export type GlowColor = 'white' | 'blue' | 'green' | 'red' | 'gold' | 'rainbow';
export type Pulse = 'slow' | 'fast' | 'hold' | 'blink';
export type Particle = 'none' | 'float' | 'suck' | 'rainbow';
export type Crack = 'none' | 'one' | 'two' | 'all';
export type PushLook = 'normal' | 'red' | 'gold' | 'rainbow';
export type Premium = 'kirin' | 'revive' | null;
/** 1 回の白ぽっちで引いた演出の組 (他の席へそのまま流す。色 ・ 当落は入れない) */
export type PochiPlan = { opening: Opening; glow: GlowColor; pulse: Pulse; particle: Particle; crack: Crack; push: PushLook; lamp: LampTiming | null; delay: boolean; premium: Premium };

/** 表: 項目 → [当たり時 %, 外れ時 %]。各列の合計は 100 */
export type OddsTable<K extends string> = Readonly<Record<K, readonly [number, number]>>;
/** ① 引いた瞬間 (どれか 1 つ) */
export const OPENING_TABLE: OddsTable<Opening> = {
  freeze_black: [0.8, 0], freeze_still: [2.0, 0], premium: [1.0, 0],
  mono: [26.0, 4], bolt: [40.2, 16], line: [24.0, 30], none: [6.0, 50],
};
/** ② 牌の光りの色 (最終的に到達する色)。白 → 青 → 緑 → 赤 → 金 → 虹 の順に上がって止まる */
export const GLOW_TABLE: OddsTable<GlowColor> = {
  white: [0.5, 23.5], blue: [3.8, 28.2], green: [11.2, 24.8], red: [23.2, 16.8], gold: [49.3, 6.7], rainbow: [12.0, 0],
};
export const GLOW_ORDER: readonly GlowColor[] = ['white', 'blue', 'green', 'red', 'gold', 'rainbow'];
/** ③ 脈打ち */
export const PULSE_TABLE: OddsTable<Pulse> = { slow: [30, 70], fast: [45, 28], hold: [22, 2], blink: [3, 0] };
/** ④ 粒子 (発展の時だけ見せる。発展しない時も引くが見せない) */
export const PARTICLE_TABLE: OddsTable<Particle> = { none: [40, 80], float: [40, 18], suck: [18, 2], rainbow: [2, 0] };
/** ⑤ ひび (溜め。発展の時だけ見せる) */
export const CRACK_TABLE: OddsTable<Crack> = { none: [35, 75], one: [30, 18], two: [30, 7], all: [5, 0] };
/** ⑥ PUSH ボタン */
export const PUSH_TABLE: OddsTable<PushLook> = { normal: [57, 88], red: [25, 10], gold: [14, 2], rainbow: [4, 0] };
/** ⑧ プレミア (当たりの時だけ、他の演出に上乗せ)。% は当たりの中の割合 */
export const PREMIUM_TABLE: Readonly<Record<Exclude<Premium, null>, number>> = { kirin: 0.5, revive: 0.5 };
export const ALL_TABLES = { opening: OPENING_TABLE, glow: GLOW_TABLE, pulse: PULSE_TABLE, particle: PARTICLE_TABLE, crack: CRACK_TABLE, push: PUSH_TABLE } as const;

/** 表から 1 つ引く。rnd は 0〜1。当たりなら [0] の列、外れなら [1] の列を上から積む */
export function pickFromTable<K extends string>(table: OddsTable<K>, good: boolean, rnd: number): K {
  const keys = Object.keys(table) as K[];
  let acc = 0;
  const r = Math.min(Math.max(rnd, 0), 0.9999999) * 100;
  for (const k of keys) {
    acc += table[k][good ? 0 : 1];
    if (r < acc) return k;
  }
  return keys[keys.length - 1];
}
export function premiumRoll(good: boolean, rnd: number): Premium {
  if (!good) return null;
  const r = rnd * 100;
  let acc = 0;
  for (const k of Object.keys(PREMIUM_TABLE) as Exclude<Premium, null>[]) {
    acc += PREMIUM_TABLE[k];
    if (r < acc) return k;
  }
  return null;
}
/** 当落が決まった後の引き。rng は 0〜1 を返す (本番は Math.random、試験は種つき) */
export function rollPlan(good: boolean, rng: () => number = Math.random): PochiPlan {
  const opening = pickFromTable(OPENING_TABLE, good, rng());
  const glow = pickFromTable(GLOW_TABLE, good, rng());
  const pulse = pickFromTable(PULSE_TABLE, good, rng());
  const particle = pickFromTable(PARTICLE_TABLE, good, rng());
  const crack = pickFromTable(CRACK_TABLE, good, rng());
  const push = pickFromTable(PUSH_TABLE, good, rng());
  const lamp = lampRoll(good, rng());
  // 遅れ: フリーズの時は引いた音が鳴らないので無い
  const delay = !opening.startsWith('freeze') && delayRoll(good, rng());
  const premium = premiumRoll(good, rng());
  return { opening, glow, pulse, particle, crack, push, lamp, delay, premium };
}
/** 当落 → 引き (App が呼ぶ入口)。kakutei は見えている牌で決まっている時 */
export function pochiGood(color: PochiColor, kakutei: 'good' | 'bad' | null): boolean {
  return kakutei === 'good' || (kakutei !== 'bad' && POCHI_GOOD[color]);
}
export const DEFAULT_PLAN: PochiPlan = { opening: 'none', glow: 'white', pulse: 'slow', particle: 'none', crack: 'none', push: 'normal', lamp: null, delay: false, premium: null };
/** 中継で届いた物を plan に戻す (古い端末 ・ 欠けは既定に) */
export function planFromRelay(v: Record<string, unknown> | null | undefined): PochiPlan {
  const pick = <K extends string>(table: OddsTable<K>, x: unknown, dflt: K): K => (typeof x === 'string' && x in table ? (x as K) : dflt);
  return {
    opening: pick(OPENING_TABLE, v?.opening, 'none'), glow: pick(GLOW_TABLE, v?.glow, 'white'), pulse: pick(PULSE_TABLE, v?.pulse, 'slow'),
    particle: pick(PARTICLE_TABLE, v?.particle, 'none'), crack: pick(CRACK_TABLE, v?.crack, 'none'), push: pick(PUSH_TABLE, v?.push, 'normal'),
    lamp: v?.lamp === 'pre' || v?.lamp === 'post' ? v.lamp : null, delay: v?.delay === true,
    premium: v?.premium === 'kirin' || v?.premium === 'revive' ? v.premium : null,
  };
}

/** 画面に出す光りの色。確定の予告 (フリーズ ・ プレミア) と見えている牌の正の確定は虹、逆の確定は白。それ以外は引いた色のまま */
export function shownGlow(plan: PochiPlan, kakutei: 'good' | 'bad' | null): GlowColor {
  if (kakutei === 'bad') return 'white';
  if (kakutei === 'good' || plan.opening === 'freeze_black' || plan.opening === 'freeze_still' || plan.opening === 'premium') return 'rainbow';
  return plan.glow;
}
/** 発展 (暗転 → 粒子 → 溜めのひび) に入るのは光りが赤以上の時だけ */
export function develops(plan: PochiPlan, kakutei: 'good' | 'bad' | null): boolean {
  return GLOW_ORDER.indexOf(shownGlow(plan, kakutei)) >= GLOW_ORDER.indexOf('red');
}

// ---- 尺 (ms)。plan と kakutei だけで決まり、当落では変えない ----
export const FREEZE_MS = 1300;
export const PREMIUM_MS = 2800;
/** 予告 (稲妻 ・ 決め台詞 ・ 白黒) の尺 [2026-10-15 リョー「出てくるのが高速すぎて」で延ばした値のまま] */
export const TEASER_MS = { bolt: 2600, line: 3300, mono: 3000 } as const;
export const KAKUTEI_MS = 1100;
/** ② 光りの段階: 白から 1 色ずつ上がる (1 色 400 ms)、残りは着いた色で脈打つ。合計は色に関係なく一定 */
export const GLOW_STAGE_MS = 2400;
export const GLOW_STEP_MS = 400;
/** ③ 発展 (暗転して牌だけが浮かび粒子) と ④ 溜め (光りが止まりひび) */
export const DEVELOP_MS = 1200;
export const TAME_MS = 1000;
/** ⑥ 結果: PUSH の後にめくれて帯 1.6 秒。復活は外れの帯 1.2 秒 → 「まだや！」0.8 秒の後に本当の帯 */
export const RESULT_MS = 1600;
export const REVIVE_MISS_MS = 1200;
export const REVIVE_WORD_MS = 800;
/** PUSH を押されないままの自動 PUSH (他の人を待たせない) と、他の席がめくれを受け取れない時の閉じ */
export const PUSH_IDLE_MS = 20000;
export const REMOTE_IDLE_MS = 60000;
export type MovieTimeline = { openingMs: number; kakuteiMs: number; glowMs: number; developMs: number; tameMs: number; untilPushMs: number };
export function openingMs(opening: Opening): number {
  if (opening === 'freeze_black' || opening === 'freeze_still') return FREEZE_MS;
  if (opening === 'premium') return PREMIUM_MS;
  if (opening === 'none') return 0;
  return TEASER_MS[opening];
}
/** PUSH が出るまでの各段の尺。外れ寄り (緑以下) は ② から PUSH へ直行、赤以上は発展と溜めが入る */
export function movieTimeline(plan: PochiPlan, kakutei: 'good' | 'bad' | null): MovieTimeline {
  const dev = develops(plan, kakutei);
  const t = { openingMs: openingMs(plan.opening), kakuteiMs: kakutei ? KAKUTEI_MS : 0, glowMs: GLOW_STAGE_MS, developMs: dev ? DEVELOP_MS : 0, tameMs: dev ? TAME_MS : 0 };
  return { ...t, untilPushMs: t.openingMs + t.kakuteiMs + t.glowMs + t.developMs + t.tameMs };
}
/** 光りの段階の中で、色が 1 つ上がる時刻 (ms、段階の頭から)。白のままなら空 */
export function glowSteps(target: GlowColor): { at: number; color: GlowColor }[] {
  const n = GLOW_ORDER.indexOf(target);
  return GLOW_ORDER.slice(1, n + 1).map((color, i) => ({ at: GLOW_STEP_MS * (i + 1), color }));
}

// ---- 告知ランプと遅れ (2026-10-15 fx10 の答え L1 a ・ B1 a。演出一覧のページも同じ数を読む) ----
/** 告知ランプ: 当たりなら必ず画面の外周が金に光る。引いた瞬間 (先告知) が 3 割、めくれた後 (後告知) が 7 割。外れは光らない */
export type LampTiming = 'pre' | 'post';
export const LAMP_PRE_RATE = 0.3;
export function lampRoll(good: boolean, rnd: number): LampTiming | null { return good ? (rnd < LAMP_PRE_RATE ? 'pre' : 'post') : null; }
/** 遅れ: 引いた時の「ピキーン」だけが 0.3 秒遅れる (牌と画面は普通に動く)。当たりの 20%、外れの 5% */
export const DELAY_RATE = { good: 0.2, bad: 0.05 } as const;
export const DELAY_MS = 300;
export function delayRoll(good: boolean, rnd: number): boolean { return rnd < (good ? DELAY_RATE.good : DELAY_RATE.bad); }
