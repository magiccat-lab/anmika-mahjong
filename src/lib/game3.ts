
// 三麻の game loop 最小実装
// majiang-core の Shoupai / xiangting / hule を使い、 山とプレイヤー数だけ自前で 3 人化する

// @ts-ignore - majiang-core は型定義なし、 後で d.ts 用意
import Majiang from '@kobalab/majiang-core';

import type { GameEvent, GameState, Lunban, Pai, PlayerId } from './types';
import { Shan3, defaultSanmaRule, type ShanRule } from './shan3';

// 共通 helper は helpers.ts に分離 [code clean-up 2026-05-10]
import { DEBUG_LOG, dlog, normalizePai, toCorePai, isGoldPai, buildShoupai, normalizeBaopaiForMajiang, pochiColorFromPai, addAnmikaPai, patchAnmikaShoupai, countGoldInHand, countPochiInHand, isPositiveZ5, isNegativeZ5, fanshuLevel, LEVEL_TO_FANSHU, isValidAnmikaTile } from './helpers';

/** debug helper [P0-6b 調査用、 2026-05-12]: 指定牌が fulou に何枚あるか集計、
 *  赤 5 [s0/p0] と 通常 5 [s5/p5] は同視 */
function countTileInFulou(sp: any, pai: string): number {
  if (!pai) return 0;
  const target = pai.replace('0', '5');
  let count = 0;
  for (const m of (sp._fulou ?? [])) {
    const stripped = String(m).replace(/[\+\=\-_*]/g, '');
    const suit = stripped[0];
    if (suit !== target[0]) continue;
    const digits = stripped.slice(1).replace(/0/g, '5');
    for (const d of digits) {
      if (suit + d === target) count++;
    }
  }
  return count;
}
import { canFeverLizhi as canFeverLizhiHelper, isFeverWaitExhausted as isFeverWaitExhaustedHelper, feverCandidatesByDapai as feverCandidatesByDapaiHelper, type FeverCheck } from './game3/feverLizhi';
import { isKanpaman as isKanpamanHelper, doraIndicatorOf as doraIndicatorOfHelper } from './game3/yaku';
import { computeChipMultiplier as computeChipMultiplierHelper, applyChipOall as applyChipOallHelper, applyChipFromLoser as applyChipFromLoserHelper, type ChipState as ChipStateT, type ChipBreakdownEntry } from './game3/chip';
import { getTingpaiList as getTingpaiListHelper, getTingpaiListBeforeZimo as getTingpaiListBeforeZimoHelper, canTsumoWithPochiSwap as canTsumoWithPochiSwapHelper, americanChitoiXiangting, americanChitoiComplete, countAmericanChitoiQuads } from './game3/tingpai';
import { saveSnapshot as saveSnapshotHelper, restoreSnapshot as restoreSnapshotHelper, type PreHuleSnapshot } from './game3/snapshot';
import { applyFuyuChip as applyFuyuChipHelper, applyChipsOnHule as applyChipsOnHuleHelper, type HuleChipCtx } from './game3/huleChip';
export { DEBUG_LOG, normalizePai, toCorePai, isGoldPai, buildShoupai, normalizeBaopaiForMajiang, pochiColorFromPai, countGoldInHand, countPochiInHand, isPositiveZ5, isNegativeZ5 };

export interface Game3Init {
  shanRule?: ShanRule;
  qijia?: PlayerId;
  startingDefen?: number;
  /** 場数: 0=一局戦、 1=東風、 2=東南 */
  changshu?: number;
  /** オンライン対戦用: 全 client で同じ pool を渡して同期 qipai [リョー指示 2026-05-13] */
  preShuffledPool?: any[];
}

export type PochiMultiplier = { defen: number; chip: number };
type PochiColor = 'blue' | 'red' | 'green' | 'yellow';

export const NEUTRAL_POCHI_MULTIPLIER: PochiMultiplier = { defen: 1, chip: 1 };

export function normalizePochiMultiplier(v: unknown): PochiMultiplier {
  if (v && typeof v === 'object') {
    const pm = v as Partial<PochiMultiplier>;
    const defen = typeof pm.defen === 'number' ? pm.defen : 1;
    const chip = typeof pm.chip === 'number' ? pm.chip : 1;
    return { defen, chip };
  }
  if (typeof v === 'number') return { defen: v < 0 ? -1 : 1, chip: v };
  return { ...NEUTRAL_POCHI_MULTIPLIER };
}

export function pochiMultiplierForColor(color: PochiColor): PochiMultiplier {
  if (color === 'blue') return { defen: 1, chip: 2 };
  if (color === 'green') return { defen: 1, chip: 1 };
  if (color === 'red') return { defen: -1, chip: -2 };
  return { defen: -1, chip: -1 };
}

export function nextPochiMultiplier(currentValue: unknown, color: PochiColor): PochiMultiplier {
  const current = normalizePochiMultiplier(currentValue);
  const incoming = pochiMultiplierForColor(color);
  if (current.defen === 1 && current.chip === 1) return incoming;

  const currentPositive = current.defen > 0;
  const incomingPositive = incoming.defen > 0;
  if (currentPositive === incomingPositive) {
    const sign = currentPositive ? 1 : -1;
    return {
      defen: sign * Math.max(Math.abs(current.defen), Math.abs(incoming.defen)),
      chip: sign * Math.max(Math.abs(current.chip), Math.abs(incoming.chip)),
    };
  }
  if (!currentPositive && incomingPositive) {
    return {
      defen: current.defen * -1 * incoming.defen,
      chip: current.chip * -2 * incoming.chip,
    };
  }
  return {
    defen: current.defen * incoming.defen,
    chip: current.chip * incoming.chip,
  };
}

/** アンミカ独自: 7m を 1m 同等扱いで国士 / 清老頭判定 [簡略版]
 *  手牌の「m7」 を「m1」 として一時複製、 国士無双 / 清老頭の構造判定 */
function anmikaTry7mYakuman(sp: any, ronpai: string | null): any {
  const bp = sp._bingpai;
  if (!bp) return null;
  // R8 P1 #4 fix: _ronpai を実際に使う、 ロン牌込みで 14 枚 国士判定。
  // 旧 code は pre-ron 13 枚の sp._bingpai で total === 14 を要求してて、
  // ロン牌 m7 / m1 で完成する国士を取りこぼしてた
  const yaochu = [
    ['m', 1], ['m', 9],
    ['p', 1], ['p', 9],
    ['s', 1], ['s', 9],
    ['z', 1], ['z', 2], ['z', 3], ['z', 4], ['z', 5], ['z', 6], ['z', 7],
  ];
  if (sp._fulou && sp._fulou.length > 0) return null;
  // ronpai を 解析 [方向 marker 除去]、 yaochu に加算
  let ronpaiBase: string | null = null;
  if (ronpai) {
    const stripped = ronpai.replace(/[\+\=\-_*]/g, '');
    if (stripped.length >= 2) ronpaiBase = stripped.slice(0, 2);
  }
  const count: Record<string, number> = {};
  let total = 0;
  for (const [s, n] of yaochu) {
    let c = bp[s][n] ?? 0;
    if (s === 'm' && n === 1) c += bp.m[7] ?? 0; // 7m を 1m に合算
    count[`${s}${n}`] = c;
    total += c;
  }
  // ロン牌込み加算 [pre-ron 13 枚 + ronpai 1 枚 = 14 枚 の国士判定]
  if (ronpaiBase) {
    const rb = ronpaiBase === 'm7' ? 'm1' : ronpaiBase;
    if (count[rb] !== undefined) {
      count[rb] += 1;
      total += 1;
    }
  }
  if (total !== 14) return null;
  for (const k of Object.keys(count)) if (count[k] === 0) return null;
  const pairs = Object.values(count).filter((c) => c >= 2).length;
  if (pairs !== 1) return null;
  // 13 面待ちか単騎かは省略、 単純国士無双扱い
  return {
    hupai: [{ name: '国士無双 [7m=1m アンミカ]', fanshu: '*' }],
    fu: undefined,
    fanshu: undefined,
    damanguan: 1,
    defen: 8000, // base、 applyHule で再計算される
    fenpei: [0, 0, 0, 0],
  };
}

/** 三麻 base 点計算 [fu × 2^(fanshu+2)、 切上満貫あり [4 翻 30 符等もマンガン]、 役満上限] */
function computeSanmaBase(result: any): number {
  const fu = result.fu ?? 30;
  const fanshu = result.fanshu ?? 0;
  const damanguan = result.damanguan ?? 0;
  // 役満系 [damanguan セット時 or fanshu>=13]: damanguan 倍率を掛ける、 数え役満は damanguan=1 扱い
  if (damanguan && damanguan > 0) return 8000 * damanguan;
  if (fanshu >= 24) return 12000; // 6 倍満
  if (fanshu >= 18) return 10000; // 5 倍満
  if (fanshu >= 13) return 8000;  // 数え役満 [複数役満は damanguan で表現]
  if (fanshu >= 11) return 6000;  // 三倍満
  if (fanshu >= 8) return 4000;   // 倍満
  if (fanshu >= 6) return 3000;  // 跳満
  if (fanshu >= 5) return 2000;  // 満貫
  // 切上満貫: raw が 1920 [4 翻 30 符 / 3 翻 60 符等] ならマンガン扱い
  const raw = fu * Math.pow(2, fanshu + 2);
  if (raw === 1920) return 2000;
  return Math.min(raw, 2000);
}

function resultHasYakuman(result: any): boolean {
  return (result?.damanguan ?? 0) > 0
    || (result?.hupai ?? []).some((h: any) => h?.fanshu === '*' || h?.fanshu === '**');
}

function handUsesBeiMaterial(sp: any, ronpai: Pai | null = null): boolean {
  const inHand = (sp?._bingpai?.z?.[4] ?? 0) > 0;
  if (inHand) return true;
  if (!ronpai) return false;
  const stripped = String(ronpai).replace(/[\+\=\-_*]/g, '').slice(0, 2);
  return toCorePai(stripped) === 'z4';
}

// fanshuLevel / LEVEL_TO_FANSHU は helpers.ts に移動 [import 済]

export class Game3 {
  state: GameState;
  shan: Shan3;
  shoupai: Map<PlayerId, any>;        // PlayerId → Majiang.Shoupai
  he: Map<PlayerId, any>;              // PlayerId → Majiang.He
  events: GameEvent[];                 // 牌譜出力用 event log
  lizhi: Set<PlayerId>;                // リーチ中のプレイヤー
  shanRule: ShanRule;                  // 山生成 rule [次局用に保持]
  startingDefen: number;
  changshu: number;

  constructor(init: Game3Init = {}) {
    this.shanRule = init.shanRule ?? defaultSanmaRule();
    const qijia = init.qijia ?? 0;
    this.startingDefen = init.startingDefen ?? 35000;
    this.state = {
      changbang: 0,
      jushu: 0,
      benbang: 0,
      lizhibang: 0,
      qijia,
      defen: { 0: this.startingDefen, 1: this.startingDefen, 2: this.startingDefen },
      lunban: 0,
      finished: false,
    };
    this.changshu = init.changshu ?? 1;  // 東風戦 デフォルト
    this.shan = new Shan3(this.shanRule, init.preShuffledPool);
    this.shoupai = new Map();
    this.he = new Map();
    this.events = [];
    this.lizhi = new Set();
    this.nukidora = { 0: 0, 1: 0, 2: 0 };
    this.nukidoraGold = { 0: 0, 1: 0, 2: 0 };
  }

  /** 各プレイヤーの北抜き数 [抜きドラ、 通常 z4 分のみ] */
  nukidora: Record<PlayerId, number>;

  /** 金北抜き数 [gN を 抜いた回数、 抜きドラ翻計算では nukidora と合算扱い] */
  nukidoraGold: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };

  /** 一発有効フラグ [リーチ宣言〜次の自分のツモ前まで]、 副露介入で消失。 */
  yifaActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** リーチ宣言牌の dapai 待ち [この dapai では yifaActive を消さない]。 */
  lizhiDeclareDapai: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** カン直後のツモ和了で嶺上開花、 declareKan / declareDamingang で true、 dapai or
   *  zimo (通常) で false に戻す */
  lingshangActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 配牌・第一打が終わってない state、 天和 / 地和 判定用 [diyizimo フラグ] */
  diyizimo: boolean = true;

  /** 加槓直後で「他家ロン取れる」 window、 加槓 declare で true / 嶺上ツモ後 false */
  qianggangPending: boolean = false;

  /** フィーバー player のアガリ回数 [流局時のノーテン罰符 skip 判定用] */
  feverWinCount: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };

  /** プレイヤー別の金牌保持数 [アンミカ独自レイヤー、 majiang-core は赤として認識]
   *  各プレイヤーの 5p / 5s / z4 の金牌の保有枚数。 配牌・ツモで +、 dapai / fulou で -。 */
  goldHand: Record<PlayerId, { p: number; s: number; z: number }> = {
    0: { p: 0, s: 0, z: 0 },
    1: { p: 0, s: 0, z: 0 },
    2: { p: 0, s: 0, z: 0 },
  };

  /** プレイヤー別の華牌 [春夏秋冬 f1-f4] 保有 */
  huapai: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };

  /** プレイヤー別の白ぽっち色保有数 [青/赤/緑/黄]、 z5 4 枚それぞれの色を track */
  pochiHand: Record<PlayerId, { blue: number; red: number; green: number; yellow: number }> = {
    0: { blue: 0, red: 0, green: 0, yellow: 0 },
    1: { blue: 0, red: 0, green: 0, yellow: 0 },
    2: { blue: 0, red: 0, green: 0, yellow: 0 },
  };

  /** 直前のツモ牌情報 [player, pai, pochiColor]、 ツモ切りの色判定用 */
  lastZimoInfo: { player: PlayerId | null; pai: string | null; pochi: string | null; gold: boolean } = {
    player: null, pai: null, pochi: null, gold: false,
  };

  /** ぽっち倍率 [2026-05-21]: 打点 [defen] と祝儀 [chip] を別管理、 局終了で neutral reset。 */
  pochiMultiplier: Record<PlayerId, PochiMultiplier> = {
    0: { ...NEUTRAL_POCHI_MULTIPLIER },
    1: { ...NEUTRAL_POCHI_MULTIPLIER },
    2: { ...NEUTRAL_POCHI_MULTIPLIER },
  };
  /** 逆ぽっち payment state: defen multiplier が負なら true [点数反転]。 */
  pochiPaymentMode: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** 後方互換表示 flag: chip multiplier に sign を含めるため、 実処理では使わない。 */
  pochiChipReverse: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** 後方互換表示 flag: chip multiplier の絶対値が 1 超なら true。 */
  pochiChipDouble: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 祝儀 [チップ] ledger、 局中変動 [春発動 / 抜きドラ etc] + アガリ時集計 [赤金 / 役満等]
   *  +N = 受取 / -N = 支払い、 半荘終了でも reset しない [累積] */
  chipLedger: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };

  /** 春発動済 (= 春を 1 枚抜き、 局中変動効果が active) flag */
  haruActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** applyHule 前 snapshot [金北選択変更時の巻き戻し用] */
  preHuleSnapshot: PreHuleSnapshot | null = null;
  /** ダブロン / modal 再計算中に preHuleSnapshot を上書きしないための lock */
  snapshotLocked = false;
  private _snapshotRefs() {
    return {
      defen: this.state.defen,
      chipLedger: this.chipLedger,
      akiUsedCount: this.akiUsedCount,
      feverActive: this.feverActive,
      shan: this.shan,
      // 2026-05-14 codex review fix: lizhibang / qianggangPending / events / chipBreakdown 追加
      state: this.state,
      game: this,
    };
  }
  saveSnapshot(): void {
    if (this.snapshotLocked) return;
    this.preHuleSnapshot = saveSnapshotHelper(this._snapshotRefs());
  }
  restoreSnapshot(): void {
    restoreSnapshotHelper(this._snapshotRefs(), this.preHuleSnapshot);
  }

  /** フィーバー中の冬保留 flag [true なら冬発動 skip、 アガリ毎にリセット、 廃止予定] */
  fuyuSkip: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** フィーバー中の冬「使う」 選択 flag [true で冬発動 + フィーバー終了] */
  fuyuConsumed: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 秋効果使用済枚数 [使い切ると huapai は残るが effect は発動しない] */
  akiUsedCount: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };

  /** 金北強化選択 [局中固定、 1 回選んだら変更不可、 null=未選択 / 保留] */
  kinpeiTarget: Record<PlayerId, 'haru' | 'natsu' | 'aki' | 'fuyu' | null> = { 0: null, 1: null, 2: null };

  /** 金北強化を選択 [外部 UI から 1 回のみ呼ぶ、 既に選択済なら無視] */
  setKinpeiChoice(player: PlayerId, target: 'haru' | 'natsu' | 'aki' | 'fuyu'): boolean {
    if (this.kinpeiTarget[player] !== null) return false;
    // 金北の強化は 手牌 or 抜き で持ってる時に適用 [リョー指示 2026-05-12]
    if (this.goldHand[player].z === 0 && (this.nukidoraGold[player] ?? 0) === 0) return false;
    // 抜いてる華と一致確認
    const has = this.huapai[player].includes(`f${ {haru:1,natsu:2,aki:3,fuyu:4}[target] }`);
    if (!has) return false;
    this.kinpeiTarget[player] = target;
    return true;
  }

  /** 金北選択を 一旦 reset [bug E4 fix 2026-05-15]
   *  selectKinpei modal で再選択する時 の 前提として、 既設定 target を null に戻す。
   *  setKinpeiChoice は 既選択 [!=null] では reject するので、 modal の re-pick 前に呼ぶ。
   *  単純 setter [validation 不要]、 game state 副作用は kinpeiTarget だけ */
  clearKinpeiChoice(player: PlayerId): void {
    this.kinpeiTarget[player] = null;
  }

  /** 強制自動: 抜いてる華 [手牌] + ドラ表示牌 / 裏ドラ表示牌 の華 から 冬>秋>夏>春 priority で選ぶ
   *  [リョー指示 2026-05-12: 手牌 0 + 金北抜きの場合 ドラ表示の華で自動強化、 完全 0 ならスキップ] */
  autoResolveKinpei(player: PlayerId): void {
    if (this.kinpeiTarget[player] !== null) return;
    if (this.goldHand[player].z === 0 && (this.nukidoraGold[player] ?? 0) === 0) return;
    const huaSources: string[] = [...this.huapai[player]];
    // ドラ表示牌 / 裏ドラ表示牌の 華 [f1-f4] も candidate
    const baopai = (this.shan as any)?.baopai ?? [];
    const fubaopai = (this.shan as any)?.fubaopai ?? [];
    for (const p of [...baopai, ...fubaopai]) {
      if (typeof p === 'string' && p.startsWith('f')) huaSources.push(p);
    }
    const counts = {
      haru: huaSources.filter((p) => p === 'f1').length,
      natsu: huaSources.filter((p) => p === 'f2').length,
      aki: huaSources.filter((p) => p === 'f3').length,
      fuyu: huaSources.filter((p) => p === 'f4').length,
    };
    if (counts.fuyu >= 2) this.kinpeiTarget[player] = 'fuyu';
    else if (counts.aki >= 2) this.kinpeiTarget[player] = 'aki';
    else if (counts.natsu >= 2) this.kinpeiTarget[player] = 'natsu';
    else if (counts.haru >= 2) this.kinpeiTarget[player] = 'haru';
    else if (counts.fuyu >= 1) this.kinpeiTarget[player] = 'fuyu';
    else if (counts.aki >= 1) this.kinpeiTarget[player] = 'aki';
    else if (counts.natsu >= 1) this.kinpeiTarget[player] = 'natsu';
    else if (counts.haru >= 1) this.kinpeiTarget[player] = 'haru';
    // 完全 0 の場合 kinpeiTarget は null のまま [skip]
  }

  /** N チップ オール [target に他家から N ずつ徴収、 target +2N、 他家 -N each]
   *  シュバリーチ active なら適用 chip × 2 [当局のみ]、 ただし bypassShuvari=true なら ×2 しない */
  /** chip 倍率計算 [シュバ + フィーバー + ぽっち統合]
   *  - bypassShuvari: シュバリ ×2 を skip
   *  - bypassFever: フィーバー倍率 [1/2/4] を skip
   *  - bypassPochi: ぽっち pochiMultiplier を skip
   *  シュバはアガリ chip のみ ×2、 局中 chip は bypassShuvari=true で呼ぶこと */
  computeChipMultiplier(target: PlayerId, opts: { bypassShuvari?: boolean; bypassFever?: boolean; bypassPochi?: boolean; mode?: 'tsumo' | 'ron' } = {}): number {
    return computeChipMultiplierHelper(this._chipState(), target, opts);
  }

  /** chip 加算 breakdown [局結果 panel 表示用、 アガリ毎にリセット] */
  chipBreakdown: ChipBreakdownEntry[] = [];

  /** chip helper 用の state ビュー [readonly では無く、 helper が直接 mutate] */
  private _chipState(): ChipStateT {
    return {
      shuvariActive: this.shuvariActive,
      feverActive: this.feverActive,
      feverTier: this.feverTier,
      pochiMultiplier: this.pochiMultiplier,
      chipLedger: this.chipLedger,
      chipBreakdown: this.chipBreakdown,
    };
  }

  private setPochiMultiplier(player: PlayerId, value: unknown): void {
    const pm = normalizePochiMultiplier(value);
    this.pochiMultiplier[player] = pm;
    this.pochiPaymentMode[player] = pm.defen < 0;
    this.pochiChipReverse[player] = false;
    this.pochiChipDouble[player] = Math.abs(pm.chip) > 1;
  }

  private applyPochiColorMultiplier(player: PlayerId, color: PochiColor): void {
    this.setPochiMultiplier(player, nextPochiMultiplier(this.pochiMultiplier[player], color));
  }

  applyChipOall(target: PlayerId, n: number, opts: { bypassShuvari?: boolean; bypassFever?: boolean; bypassPochi?: boolean; label?: string; mode?: 'tsumo' | 'ron' } = {}): void {
    applyChipOallHelper(this._chipState(), target, n, opts);
  }

  /** ロン時の放銃者のみから N chip 徴収 [面前役系 / 一発 / 裏ドラ等] */
  applyChipFromLoser(winner: PlayerId, loser: PlayerId, n: number, opts: { bypassShuvari?: boolean; bypassFever?: boolean; bypassPochi?: boolean; label?: string; mode?: 'tsumo' | 'ron' } = {}): void {
    applyChipFromLoserHelper(this._chipState(), winner, loser, n, opts);
  }

  /** hule chip helper 用の context [13 field + 2 method bridge を helper に渡す] */
  private _huleChipCtx(): HuleChipCtx {
    return {
      shoupai: this.shoupai,
      he: this.he,
      goldHand: this.goldHand,
      pochiHand: this.pochiHand,
      huapai: this.huapai,
      nukidora: this.nukidora,
      nukidoraGold: this.nukidoraGold,
      discardLog: this.discardLog,
      kinpeiTarget: this.kinpeiTarget,
      lizhi: this.lizhi,
      openLizhi: this.openLizhi,
      feverActive: this.feverActive,
      fuyuConsumed: this.fuyuConsumed,
      shan: this.shan,
      // R23 #1 fix: state 参照、 夏夏金北 ×4 の差分を state.defen に直接補正
      state: { defen: this.state.defen as any },
      applyChipOall: (t, n, o) => this.applyChipOall(t, n, o),
      applyChipFromLoser: (w, l, n, o) => this.applyChipFromLoser(w, l, n, o),
    };
  }

  /** 河の各打牌の色情報 [z5 のぽっち色 / 金牌マーカー]、 表示専用 */
  discardLog: Record<PlayerId, Array<{ pai: string; gold?: boolean; pochi?: string; tsumogiri?: boolean }>> = {
    0: [], 1: [], 2: [],
  };

  /** 現家が北抜きできるか [手牌に z4 が 1 枚以上 + 単独 zimo 済]
   *  ポン / 副露直後は _zimo が mianzi 文字列で「擬似ツモ済 state」 になるが、
   *  この状態では北抜き不可 [アンミカ独自仕様: 副露直後は抜き牌できない]
   *  フィーバー中の非フィーバー player は ツモ牌が z4 の時のみ抜き可 [手牌から不可] */
  canNukiBei(player: PlayerId): boolean {
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    if (!sp._zimo) return false;
    if (sp._zimo.length > 2) return false; // 副露直後の擬似 zimo は除外
    // フィーバー中の非フィーバー player は ツモ牌 z4 のみ抜ける、 手牌の z4 は不可
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) {
      return toCorePai(sp._zimo) === 'z4';
    }
    return sp._bingpai?.z?.[4] >= 1;
  }

  /** 北抜き実行 [z4 を 1 枚抜き、 抜きドラ +1、 王牌から代替ツモ + 王牌サイズ -1]
   *  ルール: 北抜き / 華牌抜きで王牌が縮む [16 → 12 まで]
   *  2026-05-14 codex review fix: 失敗時 partial mutate を rollback、 huapai / 白待ち回避 も処理 */
  declareNukiBei(player: PlayerId, meta?: { gold?: boolean }): Pai | null {
    const sp = this.shoupai.get(player);
    if (!sp || !this.canNukiBei(player)) return null;
    // rollback 用 snapshot [partial mutate 防止]
    const _origZ4 = sp._bingpai.z[4];
    const _origZimo = sp._zimo;
    const _origGoldZ = this.goldHand[player].z;
    const _origNukidoraGold = this.nukidoraGold[player];
    const _origNukidora = this.nukidora[player];
    const _origJustNukid = this.justNukidBei[player];
    sp._bingpai.z[4] -= 1;
    sp._zimo = null;
    // 金北 / 通常 z4 区別 [リョー指示 2026-05-12 + R12 P2 #5 fix 2026-05-14]
    // 旧: goldHand.z>0 なら常に金北優先 → 通常北クリックでも金北が抜かれる bug
    // 新: meta.gold で明示、 meta なしなら 通常北優先 [通常北ナシなら 金北 fallback]
    const goldZ4 = this.goldHand[player].z;
    const totalZ4 = _origZ4;
    const normalZ4 = totalZ4 - goldZ4;
    if (meta?.gold === true && goldZ4 > 0) {
      this.goldHand[player].z -= 1;
      addAnmikaPai(sp, 'gN', -1);
      this.nukidoraGold[player] += 1;
    } else if (normalZ4 > 0) {
      this.nukidora[player] += 1;
    } else if (goldZ4 > 0) {
      this.goldHand[player].z -= 1;
      addAnmikaPai(sp, 'gN', -1);
      this.nukidoraGold[player] += 1;
    } else {
      this.nukidora[player] += 1;
    }
    this.justNukidBei[player] = true; // 次の dapai までポン抑制
    // 王牌から代替ツモ
    if (this.shan.paishu === 0) {
      // rollback
      sp._bingpai.z[4] = _origZ4; sp._zimo = _origZimo;
      this.goldHand[player].z = _origGoldZ; this.nukidoraGold[player] = _origNukidoraGold;
      this.nukidora[player] = _origNukidora; this.justNukidBei[player] = _origJustNukid;
      return null;
    }
    // R3 P0 #3 fix: shan.zimo 前に shan 内部 state を snapshot、 sp.zimo 失敗時に全 rollback
    const shanAny0 = this.shan as any;
    const _shanPaiLen = shanAny0._pai.length;
    const _shanLastDrawnHuapai = [...this.shan.lastDrawnHuapai];
    const _shanLastZimoGold = this.shan.lastZimoGold;
    const _shanLastZimoPochi = this.shan.lastZimoPochi;
    let rawReplacement: any;
    try {
      rawReplacement = this.shan.zimo();
    } catch (e: any) {
      dlog('[declareNukiBei] shan exhausted', e?.message);
      sp._bingpai.z[4] = _origZ4; sp._zimo = _origZimo;
      this.goldHand[player].z = _origGoldZ; this.nukidoraGold[player] = _origNukidoraGold;
      this.nukidora[player] = _origNukidora; this.justNukidBei[player] = _origJustNukid;
      return null;
    }
    const replacement = rawReplacement as Pai;
    const coreReplacement = toCorePai(replacement);
    try {
      sp.zimo(replacement);
    } catch (e: any) {
      // P0-6b: sp.zimo が bingpai[n]==4 拒否で throw [既に 4 枚消費済の牌が rinshan に来た state corruption]
      // eslint-disable-next-line no-console
      console.log('!!!P0-6b nukibei sp.zimo throw', { player, replacement, rawReplacement, err: e?.message, bingpai: { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] }, fulou: [...sp._fulou] });
      // R3 P0 #3 fix: shan / hand state 全 rollback、 partial mutate を残さない
      sp._bingpai.z[4] = _origZ4; sp._zimo = _origZimo;
      this.goldHand[player].z = _origGoldZ; this.nukidoraGold[player] = _origNukidoraGold;
      this.nukidora[player] = _origNukidora; this.justNukidBei[player] = _origJustNukid;
      // R4 P1 #13 fix: shan.zimo 中に skip された 華牌 [今回 新規 push 分] を _pai に戻す。
      // 旧 code は snapshot 前 lastDrawnHuapai を使ってて 今回 skip 分を取りこぼした
      // 新規 skip 分 = 現 shan.lastDrawnHuapai - snapshot 時点の差分
      const skippedThisZimo = this.shan.lastDrawnHuapai.slice(_shanLastDrawnHuapai.length);
      // _pai を 元位置順で復元: replacement を末尾 push、 skip 華牌 を 末尾 順 push [次回 zimo で再度 skip される]
      shanAny0._pai.push(rawReplacement);
      for (const hp of skippedThisZimo) {
        shanAny0._pai.push(hp);
      }
      this.shan.lastDrawnHuapai = _shanLastDrawnHuapai;
      this.shan.lastZimoGold = _shanLastZimoGold;
      this.shan.lastZimoPochi = _shanLastZimoPochi;
      return null;
    }
    // 金 / pochi tracking [通常 zimo 同じ処理]
    if (this.shan.lastZimoGold) {
      if (replacement === 'gp') this.goldHand[player].p += 1;
      else if (replacement === 'gs') this.goldHand[player].s += 1;
      else if (replacement === 'gN') this.goldHand[player].z += 1;
    }
    const pochiColor = pochiColorFromPai(rawReplacement);
    if (pochiColor && coreReplacement === 'z5') {
      this.pochiHand[player][pochiColor] += 1;
    }
    // R10 P0 #5 #6 fix: 北抜き代替ツモ でも ぽっち効果 + lastZimoInfo 反映
    this.applyRinshanZimoEffects(player, replacement, rawReplacement);
    this.lingshangActive[player] = true;
    // P0-6b 検出 [2026-05-12]: nukibei rinshan で 既に ankan 済の牌が混入してないか
    const fulouCounts = countTileInFulou(sp, coreReplacement);
    if (fulouCounts >= 4) {
      // eslint-disable-next-line no-console
      console.log('!!!P0-6b nukibei rinshan 矛盾', { player, replacement, rawReplacement, fulouCounts, fulou: [...sp._fulou] });
    }
    // 2026-05-14 codex review fix: 通常 zimo と同じく lastDrawnHuapai 反映 + 白待ち回避
    if (this.shan.lastDrawnHuapai.length > 0) {
      for (const hp of this.shan.lastDrawnHuapai) {
        this.huapai[player].push(hp);
      }
    }
    // 王牌 1 枚消費 [16→15→14→13→12 まで]
    this.shan.consumeWangpai();
    return replacement;
  }
  /** 北抜き直後 [次 dapai までポン抑制]、 dapai で false に reset */
  justNukidBei: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 半荘終了判定: トビ + 局数消化 + 返り東チェック [全員 40000 未達なら継続]
   *  2026-05-14 codex review note: 戻り false が 「終了 ない → 継続」 を意味、 返り東 state へ
   *  実際に巻き戻すのは nextRound 側 [changbang=0 / jushu=0 + 'pingju' event push]。
   *  caller contract: isGameEnd() で false なら必ず nextRound() を続けて呼ぶ事 [単独使用禁止] */
  isGameEnd(opts: { ignoreTobiFor?: PlayerId } = {}): boolean {
    // tobi check: winner 例外 [親ツモで自家マイナスでも 連荘継続、 リョー指示 2026-05-12]
    for (const p of [0, 1, 2] as PlayerId[]) {
      if (opts.ignoreTobiFor !== undefined && p === opts.ignoreTobiFor) continue;
      if (this.state.defen[p] < 0) return true;
    }
    const requiredChang = this.changshu;
    if (this.state.changbang > requiredChang - 1) {
      // オーラス終了時、 誰か 40000 以上ならゲーム終了、 なければ返り東 [継続]
      const top = Math.max(...[0, 1, 2].map((p) => this.state.defen[p as PlayerId]));
      if (top >= 40000) return true;
      // 返り東: changbang を 1 つ巻き戻して継続 [次の nextRound で再度 changbang 0 から]
      return false;
    }
    return false;
  }

  /** 順位 [defen 降順] */
  getRanking(): Array<{ player: PlayerId; defen: number; rank: number }> {
    const arr = ([0, 1, 2] as PlayerId[]).map((p) => ({
      player: p,
      defen: this.state.defen[p],
    }));
    // R23 #6 fix: 同点タイブレーク = 起家順 [qijia から距離が近い順、 アンミカ三麻仕様]、
    // 旧 sort は stability 依存で player id 順 [0/1/2] になってた、 qijia=1 だと
    // 同点時 P0 が上位になって 起家規則と齟齬。 第二 key で qijia 距離を比較
    const qijia = this.state.qijia;
    arr.sort((a, b) => {
      if (b.defen !== a.defen) return b.defen - a.defen;
      const da = (a.player - qijia + 3) % 3;
      const db = (b.player - qijia + 3) % 3;
      return da - db;
    });
    return arr.map((x, i) => ({ ...x, rank: i + 1 }));
  }

  /** アンミカ三麻最終ポイント計算 [ウマ + 終了時トップ祝儀]
   *  ルール 1.1 + 7-1: 35000 持ち 40000 返し
   *  - **ウマ判定の閾値は 「2着 40,000+」 [トップ基準ではない、 リョー 2026-05-21 厳命]**
   *    - 2着 40,000+ → +30 / 0 / -30 [2着 = 0 ポイント、 「2着クビ」]
   *    - 未達 (2着 < 40,000) → +45 / -15 / -30 [2着 = -15、 「2着クビなし」]
   *  - 「クビ」 = 2着 が 0 ポイントの地位、 アンミカ rule book 由来
   *  - 終了時トップ n 万点 = (2n-10) 枚オール chip [例 8万=6 / 9万=8 / 10万=10]
   *  - ウマ + 累積 chip でトータル */
  getFinalScore(): Array<{ player: PlayerId; defen: number; rank: number; chipBase: number; uma: number; topNBonus: number; tobiBonus: number; tontonbuBonus: number; chip: number; total: number }> {
    const ranking = this.getRanking();
    const top = ranking[0];
    // ウマ判定 [リョー指示 2026-05-12 + 2026-05-21 補足]:
    // **判定の主役は 2着 の点数**、 トップではない。
    // 2着 40,000+ 到達 = 「2着クビ」 (2着 が 0 ポイント) → +30/0/-30
    // 2着 40,000 未達 = 「2着クビなし」 (2着 -15) → +45/-15/-30
    const secondReached = ranking[1].defen >= 40000;
    const umaList = secondReached ? [30, 0, -30] : [45, -15, -30];
    // 内訳保存 [リョー指示 2026-05-12: panel で個別列表示]
    const breakdown: Record<PlayerId, { topN: number; tobi: number; tontonbu: number }> = {
      0: { topN: 0, tobi: 0, tontonbu: 0 },
      1: { topN: 0, tobi: 0, tontonbu: 0 },
      2: { topN: 0, tobi: 0, tontonbu: 0 },
    };
    // chipLedger snapshot [bonus apply 前]
    const chipBase: Record<PlayerId, number> = {
      0: this.chipLedger[0], 1: this.chipLedger[1], 2: this.chipLedger[2],
    };
    // 2026-05-14 codex review fix: 旧 実装は applyChipOall で chipLedger を mutate していた、
    // getFinalScore 再表示で 二重加算 する bug。 mutate 削除して 純粋計算 にし、 breakdown のみで返す
    // 終了時トップ祝儀: defen が 8万 以上なら 1 位に (2n-10) chip オール [シュバ非適用]
    if (top.defen >= 80000) {
      const n = Math.floor(top.defen / 10000);
      const bonus = 2 * n - 10;
      // オール: top +2*bonus、 他 2 人 -bonus ずつ [リョー指示 2026-05-12]
      for (const p of [0, 1, 2] as PlayerId[]) {
        breakdown[p].topN = (p === top.player) ? bonus * 2 : -bonus;
      }
      // 旧: this.applyChipOall(top.player, bonus, ...) を削除
    }
    // トビ賞 [chip 支払い自体は hule 時に applyChipFromLoser 経由で済み、 ここは表示のみ]
    // breakdown 用に re-construct: 飛んだ player から winner [= top] に対し 5 base × mult
    // 実額は chipBase に既に含まれてるので、 ここの値は 表示参照用 [合計には含めない]
    // トントンブー [リョー指示 2026-05-12]: 東 1 局 で 親アガリ + 飛び発生で終了
    if (this.state.jushu === 0 && this.state.changbang === 0) {
      const oya = this.currentOya;
      const tobi = ([0, 1, 2] as PlayerId[]).some(p => p !== oya && this.state.defen[p] < 0);
      const oyaWon = this.events.some((e: any) => e.type === 'hule' && e.player === oya);
      if (tobi && oyaWon) {
        for (const p of [0, 1, 2] as PlayerId[]) {
          breakdown[p].tontonbu = (p === oya) ? 12 : -6;
        }
        // 旧: this.applyChipOall(oya, 6, ...) を削除
      }
    }
    return ranking.map((r, i) => {
      const uma = umaList[i];
      const bd = breakdown[r.player];
      // 2026-05-14 codex review fix: chip 表示は chipBase + bonus breakdown で純粋計算、
      // chipLedger の mutate を見ずに 同じ表示を 二重 call でも 安定 再現
      const chip = chipBase[r.player] + bd.topN + bd.tontonbu;
      const total = chipBase[r.player] + uma + bd.topN + bd.tontonbu;
      return { ...r, chipBase: chipBase[r.player], uma, topNBonus: bd.topN, tobiBonus: bd.tobi, tontonbuBonus: bd.tontonbu, chip, total };
    });
  }

  /** 配牌 [13 枚 × 3 人]、 同時に金牌 / 華牌の player 別カウント */
  qipai(): void {
    const tiles: Record<PlayerId, Pai[]> = { 0: [], 1: [], 2: [] };
    this.goldHand = {
      0: { p: 0, s: 0, z: 0 },
      1: { p: 0, s: 0, z: 0 },
      2: { p: 0, s: 0, z: 0 },
    };
    this.huapai = { 0: [], 1: [], 2: [] };
    this.pochiHand = {
      0: { blue: 0, red: 0, green: 0, yellow: 0 },
      1: { blue: 0, red: 0, green: 0, yellow: 0 },
      2: { blue: 0, red: 0, green: 0, yellow: 0 },
    };
    for (let i = 0; i < 13; i++) {
      for (const p of [0, 1, 2] as PlayerId[]) {
        const rawPai = this.shan.zimo();
        // 拡張牌は手牌内に raw key のまま保持し、majiang-core 境界でだけ toCorePai へ落とす。
        const pai = rawPai as Pai;
        tiles[p].push(pai);
        if (this.shan.lastDrawnHuapai.length > 0) {
          for (const hp of this.shan.lastDrawnHuapai) {
            this.huapai[p].push(hp);
          }
        }
        if (this.shan.lastZimoGold) {
          if (pai === 'gp') this.goldHand[p].p += 1;
          else if (pai === 'gs') this.goldHand[p].s += 1;
          else if (pai === 'gN') this.goldHand[p].z += 1;
        }
        const pochiColor = pochiColorFromPai(rawPai);
        if (pochiColor) this.pochiHand[p][pochiColor] += 1;
      }
    }
    for (const p of [0, 1, 2] as PlayerId[]) {
      dlog('[qipai tiles]', { player: p, tiles: tiles[p], length: tiles[p].length });
      try {
        const sp = buildShoupai(tiles[p]);
        this.shoupai.set(p, sp);
      } catch (e: any) {
        console.error('[qipai shoupai error]', { player: p, tiles: tiles[p], err: e?.message });
        this.shoupai.set(p, new Majiang.Shoupai([])); // empty fallback
      }
      this.he.set(p, new Majiang.He());
      this.events.push({ type: 'qipai', player: p, tiles: tiles[p] });
    }
    dlog('[qipai] shan.baopai=', [...this.shan.baopai], 'shan.fubaopai=', [...(this.shan.fubaopai ?? [])], 'huapai=', { ...this.huapai }, 'feverActive=', { ...this.feverActive });
  }

  /** 現 lunban 家のツモ */
  zimo(): Pai | null {
    if (this.shan.paishu === 0) return null;
    // P0-1: 宣言牌が ron されず次 zimo に到達 → fever 確定、 marker クリア
    this.feverDeclareDapaiPlayer = null;
    // R11 codex P2 #3 fix: shan.zimo() の前 に shan latch [_pai / lastDrawnHuapai /
    // lastZimoGold / lastZimoPochi] を完全 snapshot、 sp.zimo throw 時に 全 復元
    const _shanPaiSnap = [...(this.shan as any)._pai];
    const _shanLastDrawnHuapaiSnap = [...this.shan.lastDrawnHuapai];
    const _shanLastZimoGoldSnap = this.shan.lastZimoGold;
    const _shanLastZimoPochiSnap = this.shan.lastZimoPochi;
    let rawPai: any;
    try {
      rawPai = this.shan.zimo();
    } catch (e: any) {
      // huapai skip 中の exhaust [paishu>0 でも 内部で throw]
      // R14 P1 #3 fix: shan.zimo throw 経路でも shan latch を完全 rollback。
      // 旧 code は単 return null で huapai skip 中に partial mutate された state が
      // 残り、 山が消えた状態で 流局扱いになる破損が残ってた。
      (this.shan as any)._pai = _shanPaiSnap;
      this.shan.lastDrawnHuapai = _shanLastDrawnHuapaiSnap;
      this.shan.lastZimoGold = _shanLastZimoGoldSnap;
      this.shan.lastZimoPochi = _shanLastZimoPochiSnap;
      dlog('[zimo] shan exhausted via huapai skip', e?.message);
      return null;
    }
    const pai = rawPai as Pai;
    const corePai = toCorePai(pai);
    const player = this.lunbanToPlayerId(this.state.lunban);
    const spForZimo = this.shoupai.get(player);
    // P0-6b 検出 [2026-05-12]: 通常 zimo で 4 枚消費済の牌が来てないか
    {
      const fulouCount = countTileInFulou(spForZimo, corePai);
      if (fulouCount >= 4) {
        // eslint-disable-next-line no-console
        console.log('!!!P0-6b regular zimo 矛盾', { player, pai, rawPai, fulouCount, fulou: [...spForZimo._fulou], lastZimoGold: this.shan.lastZimoGold });
      }
    }
    // R4 P1 #14 fix + R11 P2 #3 fix: sp.zimo throw 時に shan latch も完全 rollback
    try {
      patchAnmikaShoupai(spForZimo).zimo(pai);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log('!!!sp.zimo throw [regular zimo]', { player, pai, err: e?.message });
      // R11 P2 #3 fix: shan._pai / 華牌 / lastZimoGold / lastZimoPochi を 完全 restore
      (this.shan as any)._pai = _shanPaiSnap;
      this.shan.lastDrawnHuapai = _shanLastDrawnHuapaiSnap;
      this.shan.lastZimoGold = _shanLastZimoGoldSnap;
      this.shan.lastZimoPochi = _shanLastZimoPochiSnap;
      return null;
    }
    // 華牌があれば player の huapai に追加 [手牌には入れない]
    if (this.shan.lastDrawnHuapai.length > 0) {
      for (const hp of this.shan.lastDrawnHuapai) {
        this.huapai[player].push(hp);
        // 春効果 [局中変動]:
        // - 春 1 枚目: haruActive on、 1 chip オール 全家から徴収 [+2 winner / -1 each]
        // - 既に haruActive 中 + 他華 [f2/f3/f4] 抜く: +1 オール 追加発動
        // - 春 2 枚目: 発動せず [アガリ時 春春 扱い]
        // 春効果は アガリ時に winner のみ集計 [リョー新ルール]、 局中加算なし
      }
    }
    if (this.shan.lastZimoGold) {
      if (pai === 'gp') this.goldHand[player].p += 1;
      else if (pai === 'gs') this.goldHand[player].s += 1;
      else if (pai === 'gN') this.goldHand[player].z += 1;
    }
    const rawColor = pochiColorFromPai(rawPai);
    if (rawColor && corePai === 'z5') {
      this.pochiHand[player][rawColor] += 1;
      const c = rawColor;
      // 白待ち check [ルール 2-3 補足: 白待ちなら逆ぽっち効果回避]
      // ツモ前の手牌で z5 を待ってたか、 つまり z5 を加えるとアガリ形になるなら 「白待ち」
      // [tingpai はツモ前の状態で z5 含むかで判定]
      const tingBeforeZimo = this.getTingpaiListBeforeZimo(player);
      const isWhiteWaiting = tingBeforeZimo.includes('z5');
      // [2026-05-21 リョー仕様確定]: 「白ぽっちは局でリセット、 リーチ後のツモ時しか適用されない」
      //   → pochi 倍率 set は **リーチ済 (lizhi) + 白待ちでない** ツモのみ。
      //   リーチ前の z5 ツモは pochiHand stock のみ inc、 mul は変えない。
      if (!isWhiteWaiting && this.lizhi.has(player)) {
        this.applyPochiColorMultiplier(player, c);
        // 逆ぽっち [赤/黄] ツモで kinpeiTarget 未選択なら強制自動
        if ((c === 'yellow' || c === 'red') && this.kinpeiTarget[player] === null) {
          this.autoResolveKinpei(player);
        }
      }
    }
    // 直前ツモ情報を保存 [ツモ切り時の色判定用]
    this.lastZimoInfo = {
      player,
      pai,
      pochi: corePai === 'z5' ? (this.shan.lastZimoPochi ?? null) : null,
      gold: this.shan.lastZimoGold && (pai === 'gp' || pai === 'gs' || pai === 'gN'),
    };
    this.events.push({ type: 'zimo', player, pai });
    dlog('[zimo]', { player, pai, rawPai, pochi: rawColor, gold: this.shan.lastZimoGold, drawnHua: [...this.shan.lastDrawnHuapai], huapaiAfter: [...this.huapai[player]] });
    return pai;
  }

  /** 打牌、 拡張表記情報 [meta.gold / meta.pochi] を受けて 河の表示色を記録
   *  meta 未指定で z5 / 金牌の場合、 自動で pochiHand / goldHand から取り出して decrement */
  /** R10 P0 #5 / #6 / #7 fix: 嶺上 / 北抜き 代替ツモ で 通常 zimo と 同等の side effect を適用する
   *  共通 helper。 pochi 倍率効果 + lastZimoInfo + 華牌 push [重複保持] を まとめる */
  applyRinshanZimoEffects(player: PlayerId, pai: string, rawPai: any): void {
    const corePai = toCorePai(pai);
    // ぽっち効果 [白ぽっち z5]
    const rawColor = pochiColorFromPai(rawPai);
    if (rawColor && corePai === 'z5') {
      const tingBeforeZimo = this.getTingpaiListBeforeZimo(player);
      const isWhiteWaiting = tingBeforeZimo.includes('z5');
      // [2026-05-21 リョー仕様]: pochi 倍率 set は **リーチ済 + 白待ちでない** ツモのみ
      // (嶺上 / 北抜き 代替ツモも同様)
      if (!isWhiteWaiting && this.lizhi.has(player)) {
        this.applyPochiColorMultiplier(player, rawColor);
        if ((rawColor === 'yellow' || rawColor === 'red') && this.kinpeiTarget[player] === null) {
          this.autoResolveKinpei(player);
        }
      }
    }
    // lastZimoInfo [ツモ切り meta 判定用]
    this.lastZimoInfo = {
      player,
      pai,
      pochi: corePai === 'z5' ? (this.shan.lastZimoPochi ?? null) : null,
      gold: this.shan.lastZimoGold && (pai === 'gp' || pai === 'gs' || pai === 'gN'),
    };
    this.events.push({ type: 'zimo', player, pai });
  }

  dapai(pai: Pai, meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' }): void {
    // R8 P0 #3 fix: 加槓 window は dapai 時点で必ず clear、 嶺上ツモ後の通常打牌に
    // qianggang: true が付く誤判定を防ぐ
    this.qianggangPending = false;
    // 2026-05-14 codex review fix: 「北は河に切れない」 仕様を Game3 API で保証。
    // dapai('z4') 直叩き は declareNukiBei に auto-route [silent redirect、 既存 test 互換]
    // R8 P2 #1 fix: 北抜き不可なら throw [silent return で lastDapai に z4 残る bug 解消]
    const coreDapai = toCorePai(pai);
    if (coreDapai === 'z4') {
      const _player = this.lunbanToPlayerId(this.state.lunban);
      if (!this.canNukiBei(_player)) {
        throw new Error(`dapai('${pai}'): 北抜き不可 [player=${_player}]`);
      }
      const rep = this.declareNukiBei(_player, { gold: pai === 'gN' || meta?.gold === true });
      if (rep === null) {
        throw new Error(`dapai('${pai}'): declareNukiBei 失敗 [player=${_player}]`);
      }
      return;
    }
    const player = this.lunbanToPlayerId(this.state.lunban);
    const spInst = this.shoupai.get(player);
    if (!spInst) {
      console.error('[dapai error] shoupai.get(player) undefined', { player, lunban: this.state.lunban, mapSize: this.shoupai.size, mapKeys: Array.from(this.shoupai.keys()) });
      throw new Error(`shoupai not set for player ${player}`);
    }
    let paiForHand: string = pai;
    const expanded = spInst._bingpai?.__anmika;
    if (expanded) {
      if (coreDapai === 'z5' && !pochiColorFromPai(pai as string)) {
        const zimoRaw: string | null = this.lastZimoInfo.player === player && toCorePai(this.lastZimoInfo.pai as string) === 'z5'
          ? (this.lastZimoInfo.pai as string)
          : null;
        if (zimoRaw && pochiColorFromPai(zimoRaw) && expanded[zimoRaw] > 0) paiForHand = zimoRaw;
        else if (expanded.z5b > 0) paiForHand = 'z5b';
        else if (expanded.z5r > 0) paiForHand = 'z5r';
        else if (expanded.z5g > 0) paiForHand = 'z5g';
        else if (expanded.z5y > 0) paiForHand = 'z5y';
      } else if (coreDapai === 'p0' && pai !== 'gp' && meta?.gold !== false && expanded.gp > 0) {
        paiForHand = 'gp';
      } else if (coreDapai === 's0' && pai !== 'gs' && meta?.gold !== false && expanded.gs > 0) {
        paiForHand = 'gs';
      }
    }
    patchAnmikaShoupai(spInst).dapai(paiForHand);
    this.he.get(player).dapai(coreDapai);
    // リーチ宣言牌は he._pai 末尾に `_` suffix を追加 [UI 表示で 図形ごと 90 度横倒し表現用]
    // [リョー指示 2026-05-12]
    // 注意: ツモ切り convention `<tile>_` でも _pai に `_` 付いて入る可能性あり、
    //       それを lizhi marker と区別するため、 lizhi marker は **2 連続** `__` にする
    //       [bug 2 fix 2026-05-14、 リョー報告: リーチ宣言後も曲がりっぱなし問題]
    if (this.lizhiDeclareDapai[player]) {
      const heInst = this.he.get(player);
      const arr = (heInst as any)._pai as string[];
      if (arr && arr.length > 0) {
        const last = arr[arr.length - 1];
        if (typeof last === 'string' && !last.endsWith('__')) {
          arr[arr.length - 1] = last + '__';
        }
      }
    }
    let pochiColor = meta?.pochi;
    let isGold = meta?.gold ?? false;
    // meta 未指定で z5: 直前ツモが z5 同色なら ツモ切り扱いで ツモ色を優先採用
    // それ以外は pochiHand から先頭色取り出し
    const rawPochiColor = pochiColorFromPai(paiForHand);
    if (rawPochiColor) pochiColor = rawPochiColor;
    if (coreDapai === 'z5') {
      const ph = this.pochiHand[player];
      // [2026-05-16 fix: 河の z5 色消える bug 真因解消]
      //   旧 code [2026-05-14 codex review fix] は 「ph 在庫 0 なら discardLog.pochi=null」
      //   だったが、 これは pochiHand stock counter [v33 fuzz invariant 対象] と
      //   discardLog.pochi 文字列 [表示専用] を 混同してた。 リョー指示 [2026-05-15]:
      //   「pochiHand stock の数値変動と、 discardLog entry の color 文字列は 独立」。
      //   修正方針:
      //     - meta あり → 必ず discardLog に記録、 stock は best-effort で 1 枚 decrement [clamp 0]
      //     - tsumokiri [lastZimoInfo z5 同色] → ツモ色を必ず採用、 stock も best-effort decrement
      //     - fallback → ph 先頭色 採用 [従来通り]、 全 0 なら 真に色不明で undefined のまま
      //   → 表示は entry.pochi に従う、 stock 在庫 0 でも色情報は失わない
      const dec = (color: 'blue' | 'red' | 'green' | 'yellow') => {
        if ((ph as any)[color] > 0) (ph as any)[color] -= 1;
      };
      if (rawPochiColor) {
        pochiColor = rawPochiColor;
        dec(rawPochiColor);
      } else if (meta?.pochi) {
        // 明示 meta あり: 在庫の有無に関わらず entry に記録、 在庫があれば 1 枚消費
        const mp = meta.pochi as 'blue' | 'red' | 'green' | 'yellow';
        pochiColor = mp;
        dec(mp);
      } else if (this.lastZimoInfo.player === player && toCorePai(this.lastZimoInfo.pai as string) === 'z5' && this.lastZimoInfo.pochi) {
        // tsumokiri 経路: 直前ツモ色を採用、 在庫があれば 1 枚消費
        const tp = this.lastZimoInfo.pochi as 'blue' | 'red' | 'green' | 'yellow';
        pochiColor = tp;
        dec(tp);
      } else {
        // fallback [CPU / 手出し meta なし]: 先頭色 [青→赤→緑→黄]、 全 0 なら undefined
        if (ph.blue > 0) { pochiColor = 'blue'; ph.blue -= 1; }
        else if (ph.red > 0) { pochiColor = 'red'; ph.red -= 1; }
        else if (ph.green > 0) { pochiColor = 'green'; ph.green -= 1; }
        else if (ph.yellow > 0) { pochiColor = 'yellow'; ph.yellow -= 1; }
      }
    }
    if (coreDapai === 'p0' || coreDapai === 's0') {
      const kind = coreDapai === 'p0' ? 'p' : 's';
      if (paiForHand === 'gp' || paiForHand === 'gs') isGold = true;
      // [2026-05-16 fix: 河の gold 5p/5s 色消える bug 真因解消、 z5 ぽっち色 fix と同 pattern]
      //   旧 code [2026-05-14 codex review fix] は 「goldHand[kind]===0 なら gold=false 強制」
      //   だったが、 これは goldHand stock counter [v33 fuzz invariant 対象] と
      //   discardLog.gold flag [表示専用] を 混同してた。
      //   修正方針 [z5 と同じ]:
      //     - meta あり → 必ず discardLog に gold flag 記録、 stock は best-effort decrement [clamp 0]
      //     - tsumokiri [lastZimoInfo 同色 gold] → ツモ gold flag を必ず採用、 stock も best-effort decrement
      //     - fallback → 在庫あれば gold 採用 [従来通り]、 なければ false
      //   → 表示は entry.gold に従う、 stock 在庫 0 でも gold 情報は失わない
      if (meta && typeof meta.gold === 'boolean') {
        // 明示 meta あり: 在庫の有無に関わらず entry に記録、 在庫があれば 1 枚消費 [clamp 0]
        isGold = meta.gold;
        if (meta.gold && this.goldHand[player][kind] > 0) {
          this.goldHand[player][kind] -= 1;
        }
      } else {
        // meta 未指定 [tsumokiri / CPU 経路]: 直前ツモ情報を優先、 なければ goldHand fallback
        if (this.lastZimoInfo.player === player && toCorePai(this.lastZimoInfo.pai as string) === coreDapai) {
          isGold = !!this.lastZimoInfo.gold;
          if (isGold && this.goldHand[player][kind] > 0) this.goldHand[player][kind] -= 1;
        } else if (this.goldHand[player][kind] > 0) {
          isGold = true;
          this.goldHand[player][kind] -= 1;
        }
      }
    }
    // z4 [北] / 金北 [gN normalize=z4]: meta あれば優先、 なければ goldHand.z で auto
    if (coreDapai === 'z4') {
      // [2026-05-16 fix: 同 pattern、 meta あり時 在庫 0 でも gold flag 保持]
      if (meta && typeof meta.gold === 'boolean') {
        isGold = meta.gold;
        if (meta.gold && this.goldHand[player].z > 0) {
          this.goldHand[player].z -= 1;
        }
      } else if (this.lastZimoInfo.player === player && toCorePai(this.lastZimoInfo.pai as string) === 'z4') {
        isGold = !!this.lastZimoInfo.gold;
        if (isGold && this.goldHand[player].z > 0) this.goldHand[player].z -= 1;
      }
    }
    // ツモ切り判定 [手出し / ツモ切り の UI 区別用 2026-05-15]
    //   直前 zimo 情報の player + pai が dapai と一致 → ツモ切り
    //   注: 副露直後 [_zimo に mianzi が入る] / 北抜き / 嶺上 でも lastZimoInfo は
    //       常に最新 zimo を反映している、 副露後の 1 打目は lastZimoInfo.player !== player
    //       か lastZimoInfo.pai !== pai なので 自然に手出し扱い
    const isTsumogiri = this.lastZimoInfo.player === player && this.lastZimoInfo.pai === paiForHand;
    this.discardLog[player].push({ pai: paiForHand, gold: isGold, pochi: pochiColor, tsumogiri: isTsumogiri });
    this.events.push({ type: 'dapai', player, pai: paiForHand });
    // 注: justNukidBei は ここで clear しない。 dapai 開始時点で clear すると
    //     直後の getPonCandidates [store 側] が flag false で 抜き直後 dapai を
    //     ポン可と誤判定する [ルール 2-4 「抜き直後の他家ポン不可」 違反]。
    //     clear は store.ts 側 innerDiscard の pon check 後で行う。
    // 一発消失判定:
    //   リーチ宣言牌の dapai は猶予 [一発ロン受け window 残す]、
    //   それ以外の dapai [= リーチ後 自分の 2 回目以降] で消失
    if (this.lizhiDeclareDapai[player]) {
      this.lizhiDeclareDapai[player] = false; // 猶予を消費、 yifaActive は維持
    } else {
      this.yifaActive[player] = false;
    }
    // 嶺上消失: 普通の dapai 後は嶺上開花対象外
    this.lingshangActive[player] = false;
    // 第一打終了 [天和 / 地和 失効]
    this.diyizimo = false;
    // 次の lunban に [3 麻なので mod 3]
    this.state.lunban = ((this.state.lunban + 1) % 3) as Lunban;
  }

  /** lunban を player_id に変換 [起家 = 0、 最初は qijia から、 反時計周り P0→P2→P1
   *  リョー指示 2026-05-13: 局内打牌順も反時計、 qijia=0 で lunban 0→1→2 = player 0→2→1] */
  lunbanToPlayerId(lunban: Lunban): PlayerId {
    // 2026-05-14 codex review fix: currentOya 参照に変更、 子アガリ後 lunban=0 が現親を指す
    return (((this.currentOya - lunban) % 3 + 3) % 3) as PlayerId;
  }

  /** シャンテン数 [majiang-core 流用、 player-agnostic] */
  xiangting(player: PlayerId): number {
    const sp = this.shoupai.get(player);
    if (!sp) return 99; // 手牌未配給時 [transition 中] は -1 ではなく大値返して crash 防止
    return Math.min(Majiang.Util.xiangting(sp), americanChitoiXiangting(sp));
  }

  /** AI 用: 手牌に pai を 1 枚追加した時の xiangting [鳴き効率簡易判定用]
   *  実 pon は面子1個 fixed だが majiang-core API 都合で +1 zimo 相当で近似
   *  [2026-05-21 ゆーま 自走 CPU 教育: ポン判定のシャンテン進化チェック用] */
  estimateXiangtingWithExtra(player: PlayerId, pai: string): { base: number; withExtra: number } {
    const sp = this.shoupai.get(player);
    if (!sp) return { base: 99, withExtra: 99 };
    const base = Majiang.Util.xiangting(sp);
    const num = pai[1] === '0' ? 5 : parseInt(pai[1]);
    const colorKey = pai[0];
    const cur = sp._bingpai?.[colorKey]?.[num] ?? 0;
    if (cur >= 4) return { base, withExtra: base };
    try {
      const clone = sp.clone();
      clone._bingpai[colorKey][num] = cur + 1;
      clone._zimo = `${colorKey}${num}`;
      return { base, withExtra: Majiang.Util.xiangting(clone) };
    } catch {
      return { base, withExtra: base };
    }
  }

  /** AI 用: シャンテン最小化する打牌候補を返す。
   *  同シャンテン候補内では: 全リーチ家の現物 [+10] > 字牌 [+3] > 端牌 [+2] > 2/8 [+1] > 中央 */
  pickBestDiscard(player: PlayerId): Pai | null {
    const sp = this.shoupai.get(player);
    if (!sp) return null;
    let candidates: string[];
    try {
      candidates = sp.get_dapai(false);
    } catch {
      return null;
    }
    if (!candidates || candidates.length === 0) return null;
    candidates = candidates.filter((c: string) => !c.startsWith('z4'));
    if (candidates.length === 0) return null;
    // フィーバー立直中: フィーバー player 以外は ツモ切り強制 [AI も従う]
    //   ただし z4 [北] は dapai 不可 [抜き北 path に任せる]、 ここでは候補から除外済の
    //   pickBestDiscard fallback に進めて 通常 heuristic 経由で他の打牌を選ばせる
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player] && sp._zimo) {
      const z = sp._zimo;
      if (typeof z === 'string' && z.length <= 2 && z !== 'z4') {
        return z;
      }
    }
    const lizhiOpponents = [0, 1, 2].filter((p) => p !== player && this.lizhi.has(p as PlayerId)) as PlayerId[];
    const baseTile = (p: string) => {
      const stripped = p.replace(/[\+\=\-_*]/g, '');
      return stripped[0] + (stripped[1] === '0' ? '5' : stripped[1]);
    };
    // ukeire 計算 [リョー指示 2026-05-13 「CPU 打牌品質上げ」]:
    // dapai 後の手で 各 tile を draw して xt が下がる枚数 を 残枚数 weighted で count
    // 残枚数は 他家手 + 全 player 河 の見えた枚数を差し引く [2026-05-14 ゆーま 自走、 視認 枯渇牌を ukeire から除外]
    const visibleElsewhere = (s_: string, n_: number): number => {
      let v = 0;
      for (const p of [0, 1, 2] as PlayerId[]) {
        if (p !== player) {
          const sp_p = this.shoupai.get(p);
          v += (sp_p?._bingpai?.[s_]?.[n_] ?? 0);
        }
        const he = this.he.get(p);
        for (const d of (he?._pai ?? []) as string[]) {
          const stripped = d.replace(/[\+=\-_*]/g, '');
          const dn = stripped[1] === '0' ? 5 : parseInt(stripped[1]);
          if (stripped[0] === s_ && dn === n_) v++;
        }
      }
      return v;
    };
    const computeUkeire = (sp_after: any, baseXt: number): number => {
      let ukeire = 0;
      const validKinds: Array<['m'|'p'|'s'|'z', number]> = [];
      for (let n = 1; n <= 9; n++) {
        if (n === 7 || n === 9) validKinds.push(['m', n]);  // ANMIKA: m7/m9 のみ
        validKinds.push(['p', n]); validKinds.push(['s', n]);
      }
      for (let n = 1; n <= 7; n++) validKinds.push(['z', n]);
      for (const [s, n] of validKinds) {
        try {
          const cur = sp_after._bingpai?.[s]?.[n] ?? 0;
          if (cur >= 4) continue;
          const remaining = Math.max(0, 4 - cur - visibleElsewhere(s, n));
          if (remaining === 0) continue;
          const sp_test = sp_after.clone();
          sp_test._bingpai[s][n] += 1;
          sp_test._zimo = `${s}${n}`;
          const xtAfter = Majiang.Util.xiangting(sp_test);
          if (xtAfter < baseXt) ukeire += remaining;
        } catch (e) { /* skip */ }
      }
      return ukeire;
    };

    // 自家 ぽっち累積 [pochiMultiplier] の chip 絶対値が 2 以上なら z5 残し優先度を強める
    // [リョー指示 2026-05-21 自走 CPU 教育: ぽっち累積効果 加味]
    const selfPochiMult = Math.abs(normalizePochiMultiplier(this.pochiMultiplier?.[player]).chip);
    // 自家 7 暗刻 [フィーバー seed] 数: m7/p7/s7 で 3 枚以上保持してる種類数
    let feverSeedCount = 0;
    for (const ss of ['m','p','s'] as const) {
      if ((sp._bingpai?.[ss]?.[7] ?? 0) >= 3) feverSeedCount++;
    }
    // スジ安牌 helper [リーチ家の河 4-5-6 ベース、 三麻 m は m7/m9 のみで スジ概念ほぼ無効]
    const isSujiSafe = (lp: PlayerId, baseP: string): boolean => {
      if (baseP[0] !== 'p' && baseP[0] !== 's') return false;
      const num = baseP[1] === '0' ? 5 : parseInt(baseP[1]);
      if (!Number.isFinite(num)) return false;
      const he = this.he.get(lp);
      if (!he) return false;
      const heNums = new Set<number>();
      for (const d of (he._pai ?? []) as string[]) {
        const stripped = d.replace(/[\+=\-_*]/g, '');
        if (stripped[0] === baseP[0]) {
          heNums.add(stripped[1] === '0' ? 5 : parseInt(stripped[1]));
        }
      }
      if (num === 1 && heNums.has(4)) return true;
      if (num === 9 && heNums.has(6)) return true;
      if (num === 7 && heNums.has(4)) return true;
      if (num === 3 && heNums.has(6)) return true;
      if (num === 4 && heNums.has(1) && heNums.has(7)) return true;
      if (num === 5 && heNums.has(2) && heNums.has(8)) return true;
      if (num === 6 && heNums.has(3) && heNums.has(9)) return true;
      if (num === 2 && heNums.has(5)) return true;
      if (num === 8 && heNums.has(5)) return true;
      return false;
    };
    // 壁安牌: 隣接 ±1/±2 が 4 枚見えていれば そのリャンメン待ち消失
    const isKabeSafe = (baseP: string): boolean => {
      if (baseP[0] !== 'p' && baseP[0] !== 's') return false;
      const num = baseP[1] === '0' ? 5 : parseInt(baseP[1]);
      if (!Number.isFinite(num)) return false;
      for (const delta of [1, 2, -1, -2]) {
        const adj = num + delta;
        if (adj < 1 || adj > 9) continue;
        const selfHas = sp._bingpai?.[baseP[0]]?.[adj] ?? 0;
        const seen = selfHas + visibleElsewhere(baseP[0], adj);
        if (seen >= 4) return true;
      }
      return false;
    };

    let bestPai: string | null = null;
    let bestShanten = 99;
    let bestUkeire = -1;
    let bestPriority = -1;
    for (const c of candidates) {
      const basePai = c.replace(/_$/, '');
      const sp_clone = sp.clone();
      try {
        sp_clone.dapai(c);
      } catch {
        continue;
      }
      const xt = Majiang.Util.xiangting(sp_clone);
      // ukeire は xt <= 5 まで計算 [2026-05-21 ゆーま 自走: 4→5 拡張、 序盤精度上げ]
      const ukeire = (xt <= 5) ? computeUkeire(sp_clone, xt) : 0;
      const s = basePai[0];
      const n = basePai[1] === '0' ? 5 : parseInt(basePai[1]);
      let prio = 0;
      if (s === 'z') prio = 3;
      else if (n === 1 || n === 9) prio = 2;
      else if (n === 2 || n === 8) prio = 1;
      // 7 暗刻 [フィーバー狙い] 効率: m7/p7/s7 を切らない方向 [リョー指示 2026-05-13]
      if (n === 7 && (s === 'm' || s === 'p' || s === 's')) {
        const heldCount = sp._bingpai?.[s]?.[7] ?? 0;
        if (heldCount >= 3) prio -= 5;
        else if (heldCount >= 2) prio -= 3;
        else prio -= 1;
      }
      // フィーバー seed 揃ってる時 周辺 [6/8] も保険で軽く残し
      if (feverSeedCount >= 1 && (n === 6 || n === 8) && (s === 'm' || s === 'p' || s === 's')) {
        prio -= 1;
      }
      // m9 残し [国士 / 清老頭 系]、 2 枚以上保持なら強め残し
      if (s === 'm' && n === 9) {
        const m9Count = sp._bingpai?.m?.[9] ?? 0;
        if (m9Count >= 2) prio -= 2; else prio -= 1;
      }
      // z5 [ぽっち] 残し: 自家 pochiMultiplier 累積 に応じ加重
      if (s === 'z' && n === 5) {
        if (selfPochiMult >= 4) prio -= 4;
        else if (selfPochiMult >= 2) prio -= 2;
        else prio -= 1;
      }
      // 金牌 [gp / gs / gN] 残し [リョー指示 2026-05-14]
      if (basePai === 'p0' && (this.goldHand[player]?.p ?? 0) > 0) prio -= 3;
      else if (basePai === 's0' && (this.goldHand[player]?.s ?? 0) > 0) prio -= 3;
      else if (basePai === 'z4' && (this.goldHand[player]?.z ?? 0) > 0) prio -= 3;
      // 赤 5 [非金] は chip 2 倍、 軽く残す
      if ((basePai === 'p0' || basePai === 's0') && prio > -3) prio -= 1;
      // リーチ家への 安牌評価 [現物 +10 > スジ +4 > カベ +2 > 危険 -5]
      // [2026-05-21 ゆーま 自走 CPU 教育: スジ / カベ 評価追加で 守備強化]
      if (lizhiOpponents.length > 0) {
        const isGenbutsuAll = lizhiOpponents.every((lp) => {
          const he = this.he.get(lp);
          return he?._pai?.some((d: string) => baseTile(d) === baseTile(basePai));
        });
        if (isGenbutsuAll) prio += 10;
        else {
          const isSujiAll = lizhiOpponents.every((lp) => isSujiSafe(lp, basePai));
          if (isSujiAll) prio += 4;
          else if (isKabeSafe(basePai)) prio += 2;
          else prio -= 5;
        }
      }
      // 比較順: xt 最小 > ukeire 最大 > priority 最大
      const better = xt < bestShanten
        || (xt === bestShanten && ukeire > bestUkeire)
        || (xt === bestShanten && ukeire === bestUkeire && prio > bestPriority);
      if (better) {
        bestShanten = xt;
        bestUkeire = ukeire;
        bestPriority = prio;
        bestPai = c;
      }
    }
    return bestPai;
  }

  /** 北を手牌構成 [雀頭/面子/ロン牌] として使う和了は、役満だけ許可する。 */
  canUseBeiMaterialForAgari(player: PlayerId, ronpai: Pai | null = null, fromPlayer: PlayerId | null = null): boolean {
    const sp = this.shoupai.get(player);
    if (!handUsesBeiMaterial(sp, ronpai)) return true;
    const prevSnapshot = this.preHuleSnapshot;
    this.saveSnapshot();
    let fakeRes: any = null;
    try {
      fakeRes = this.hule(player, ronpai, fromPlayer);
    } catch {
      fakeRes = null;
    }
    this.restoreSnapshot();
    this.preHuleSnapshot = prevSnapshot;
    return resultHasYakuman(fakeRes);
  }

  private canTsumoByHuleResult(player: PlayerId): boolean {
    const prevSnapshot = this.preHuleSnapshot;
    this.saveSnapshot();
    let fakeRes: any = null;
    try {
      fakeRes = this.hule(player);
    } catch {
      fakeRes = null;
    }
    this.restoreSnapshot();
    this.preHuleSnapshot = prevSnapshot;
    return !!fakeRes;
  }

  /** ツモ和了判定 [現家がツモった牌で和了可能か]
   *  アンミカ独自: リーチ済 player が白 [z5] をツモった場合、 オールマイティ判定で z5 を
   *  任意の牌に置換して和了可能か試す [赤 / 金 5 を除く]
   *  + ダマ禁止: 副露ナシ + リーチナシ + 役満ナシ なら ボタン出さない */
  canTsumo(player: PlayerId): boolean {
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) return false;
    const dbg = { player, zimo: sp?._zimo, lizhi: this.lizhi.has(player), fever: this.feverActive[player] };
    try {
      let result = Majiang.Util.hule_mianzi(sp);
      // R6 P1 #6 fix: 通常形で組めない場合、 m7→m1 substitution で 国士 / 清老頭 が成立する case を 拾う
      if (!result || result.length === 0) {
        const m7Count = sp._bingpai.m?.[7] ?? 0;
        if (m7Count > 0) {
          const spClone = sp.clone();
          spClone._bingpai.m[1] = (spClone._bingpai.m[1] ?? 0) + m7Count;
          spClone._bingpai.m[7] = 0;
          if (spClone._zimo === 'm7') spClone._zimo = 'm1';
          const r7 = Majiang.Util.hule_mianzi(spClone);
          if (r7 && r7.length > 0) result = r7;
        }
      }
      if ((!result || result.length === 0) && americanChitoiComplete(sp)) {
        result = [[]];
      }
      if (!result || result.length === 0) {
        return this.canTsumoByHuleResult(player);
      }
      if (result && result.length > 0) {
        // [2026-05-15 bug C fix] 北 [z4] 単騎: 役満絡み [字一色 / 大三元 / 国士 等] でない限り
        // アガリ不可 [リョー仕様]。 ツモ牌が z4 で、 ツモ前の手牌の待ちが z4 のみ なら 単騎判定。
        if (toCorePai(sp._zimo) === 'z4') {
          const tingBefore = this.getTingpaiListBeforeZimo(player);
          if (tingBefore.length === 1 && tingBefore[0] === 'z4') {
            const _prevSnap = this.preHuleSnapshot;
            this.saveSnapshot();
            let fakeRes: any = null;
            try { fakeRes = this.hule(player); } catch { /* ignore */ }
            this.restoreSnapshot();
            this.preHuleSnapshot = _prevSnap;
            if (!fakeRes) return false;
            const isYakuman = (fakeRes.damanguan ?? 0) > 0
              || (fakeRes.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**');
            if (!isYakuman) return false;
          }
        }
        if (!this.canUseBeiMaterialForAgari(player)) return false;
        // ダマ禁止 check: 役満なら OK、 副露なし + リーチなしなら役満以外 NG
        // 2026-05-14 Round 2 codex fix P1 #7: 役満限定 accept、 通常役なら reject
        // R9 P2 #11 fix: 副露手も hule() で 役なし check、 UI に出てから失敗する bug 解消
        const hasFulou = sp._fulou && sp._fulou.length > 0;
        if (hasFulou) {
          const _prevSnapshot = this.preHuleSnapshot;
          this.saveSnapshot();
          let fakeRes: any = null;
          try { fakeRes = this.hule(player); } catch { /* ignore */ }
          this.restoreSnapshot();
          this.preHuleSnapshot = _prevSnapshot;
          if (!fakeRes) return false;
        }
        if (!hasFulou && !this.lizhi.has(player)) {
          // R7 P1 #5 fix: 判定 reactive 呼出で preHuleSnapshot を上書きする bug 解消、
          // 既存 snapshot を退避 → saveSnapshot → restoreSnapshot → 退避を書き戻す
          const _prevSnapshot = this.preHuleSnapshot;
          this.saveSnapshot();
          let fakeRes: any = null;
          try { fakeRes = this.hule(player); } catch { /* ignore */ }
          this.restoreSnapshot();
          this.preHuleSnapshot = _prevSnapshot;
          if (!fakeRes) return false;
          const isYakuman = (fakeRes.damanguan ?? 0) > 0
            || (fakeRes.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**');
          if (!isYakuman) return false;
        }
        return true;
      }
    } catch { /* ignore */ }
    // [2026-05-21 fix] _zimo は z5b/r/g/y 等 raw colored pochi で入る [commit 4d1f476f]、
    // toCorePai 経由で正規化。 以下 z5 比較は 全て同パターンで修正。
    if (this.lizhi.has(player) && sp._zimo && toCorePai(sp._zimo) === 'z5') {
      const r = this.canTsumoWithPochiSwap(sp);
      dlog('[canTsumo z5 swap]', { ...dbg, swapResult: r });
      return r;
    }
    return false;
  }

  /** 待ち牌一覧 [helper 委譲] */
  getTingpaiList(player: PlayerId): string[] {
    return getTingpaiListHelper(this.shoupai.get(player));
  }

  /** ツモ前の手牌で待ち牌一覧 [helper 委譲] */
  getTingpaiListBeforeZimo(player: PlayerId): string[] {
    return getTingpaiListBeforeZimoHelper(this.shoupai.get(player));
  }

  /** ぽっちオールマイティ判定 [helper 委譲] */
  canTsumoWithPochiSwap(sp: any): boolean {
    return canTsumoWithPochiSwapHelper(sp);
  }

  /** ポン候補取得。 from は打牌者、 player は ポンしたい家、 pai は打牌された牌
   *  方向 [majiang-core 慣習]: '+' = 上家 [自分より前の打牌者]、 '-' = 下家
   *  座席は反時計回り [0→1→2→0]、 player から見て 1 つ前 [diff=2] が上家、 1 つ後 [diff=1] が下家 */
  getPonCandidates(player: PlayerId, from: PlayerId, pai: Pai): string[] {
    const sp = this.shoupai.get(player);
    if (!sp) return [];
    if (this.lizhi.has(player)) return [];
    // 抜き直後の他家ポン不可 [ルール 2-4]
    if (this.justNukidBei[from]) return [];
    // 反時計周り [P0→P2→P1] 用に dir 計算を逆方向に [2026-05-13 fix]
    // from が player の何個前 [反時計]: diff=1 → 上家 (+)、 diff=2 → 下家 (-)
    const diff = (from - player + 3) % 3;
    let dir: string;
    if (diff === 1) dir = '+';      // from は player の上家 [反時計の 1 つ前]
    else if (diff === 2) dir = '-';  // from は player の下家
    else return [];
    const paiWithDir = pai + dir;
    try {
      return sp.get_peng_mianzi(paiWithDir) ?? [];
    } catch {
      return [];
    }
  }

  /** ポン実行 [player が mianzi で副露、 lunban を player に移す]
   *  majiang-core の Shoupai.fulou は mianzi 内の「方向 mark の前の 数字 3 個」 を
   *  decrease する仕様、 つまり 「自分の手牌 2 枚 + 方向 mark 直前の鳴き牌 1 枚」 で
   *  方向 mark 直前の数字は decrease しない、 _bingpai に追加するのは不要 */
  declarePon(player: PlayerId, mianzi: string, fromPlayer: PlayerId): boolean {
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    try {
      sp.fulou(mianzi);
    } catch (e) {
      this.events.push({ type: 'pingju', reason: `pon failed: ${e}` });
      return false;
    }
    const takenPai = this.discardLog[fromPlayer]?.[this.discardLog[fromPlayer].length - 1]?.pai ?? toCorePai(mianzi.slice(0, 2));
    sp._anmikaFulou = sp._anmikaFulou ?? [];
    sp._anmikaFulou.push({ mianzi, from: fromPlayer, taken: takenPai });
    // 河の最後の牌に副露マーカー [+/=/-] を付ける、 majiang-core の He.fulou に任せる
    const fromHe = this.he.get(fromPlayer);
    if (fromHe && typeof fromHe.fulou === 'function') {
      try { fromHe.fulou(mianzi); } catch { /* ignore: 河マーカーは UI 表示用 */ }
    }
    // [2026-05-15 bug 3 注] z5 ポン時 pochiHand の同期 decrement は 既存 inventory invariant
    // [v33 fuzz test] と矛盾、 pochiHand は z5* 個別 stock として保持し fulou は consume しない設計。
    // 河 表示色は fromPlayer.discardLog[index].pochi が真実、 He.fulou は marker append のみで
    // index 不変なので 副露時 河の色情報は 既存 path で 落ちないはず。
    // 「鳴かれた 色消える」 のは fromPlayer 側 dapai 時点で pochi 記録漏れ [pochiHand 在庫 0
    // + meta 未指定 + lastZimoInfo 不一致] な 別 case [既存 dapai 851-872 行 fallback でも 救えない]。
    // 注: ポン後 _zimo に mianzi が入る [majiang-core 慣習、 ツモ済 state を擬似化]
    //     dapai が `if (! this._zimo) throw` で門前打牌不可になるのを回避するため必須
    //     toString は _zimo.length>2 を判別して手牌に混入させない [Shoupai.toString line 115]
    // lunban を player に [反時計周り 2026-05-13 fix: 逆変換も反時計]
    this.state.lunban = (((this.currentOya - player) % 3 + 3) % 3) as Lunban;
    // 副露介入で他家の一発消失、 自分も一発消失 [副露ありはリーチ後の対象外]
    this.yifaActive = { 0: false, 1: false, 2: false };
    this.diyizimo = false;
    // [2026-05-15 fix bug B] 副露 [鳴き] した player は シュバ倍率を強制 解除。
    // 仕様: シュバ発動条件 = ゾロ目連続 → リーチ + シュバ宣言、 副露とは両立しない。
    // 通常 path では declareLizhi 経由でしか shuvariActive=true にならないが、
    // 何らかの bug や future change で 立ったまま 副露 した場合の保険として ここで落とす。
    this.shuvariActive[player] = false;
    this.events.push({ type: 'fulou', player, from: fromPlayer, mianzi, pai: takenPai } as any);
    return true;
  }

  /** ロン和了判定 [other player が pai で和了可能か、 厳密フリテン check 込み]
   *  白ぽっち オールマイティ: リーチ済 + ロン牌 z5 で 通常 hule 役なしなら swap 試行 */
  canRon(player: PlayerId, pai: Pai, fromPlayer: PlayerId | null = null): boolean {
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    const feverDeclareDiscard = this.feverDeclareDapaiPlayer !== null && fromPlayer === this.feverDeclareDapaiPlayer;
    const feverPlayerDiscard = fromPlayer !== null && this.feverActive[fromPlayer];
    if (someoneFever && !this.feverActive[player] && !feverDeclareDiscard && !feverPlayerDiscard) return false;
    try {
      const sp_clone = sp.clone();
      sp_clone.zimo(pai);
      let result = Majiang.Util.hule_mianzi(sp_clone);
      // R6 P1 #6 fix: m7 ロン牌 / 手牌 m7 で 通常形組めない場合、 m7→m1 substitution で
      // 国士無双 / 清老頭 を 拾う [ロン牌 m7 含む置換]
      if (!result || result.length === 0) {
        const ronpaiIsM7 = (pai as string).startsWith('m7');
        const m7Count = sp.clone()._bingpai.m?.[7] ?? 0;
        if (m7Count > 0 || ronpaiIsM7) {
          const ssClone = sp.clone();
          // R22 #2 fix: 手牌 m7 を m1 に swap [手牌側のみ]
          ssClone._bingpai.m[1] = (ssClone._bingpai.m[1] ?? 0) + (ssClone._bingpai.m?.[7] ?? 0);
          ssClone._bingpai.m[7] = 0;
          // R22 #2 fix: ロン牌は m7 のときだけ m1 に変換 + bingpai.m[1] +=1、
          // 旧 code は ロン牌 が m7 じゃない時 [例 p5 ロン] でも +=1 して 存在しない 1m 追加 →
          // 違法ロン許可 / 合法ロン落ち bug
          const ronAsM1 = ronpaiIsM7 ? ('m1' + (pai as string).slice(2)) : pai;
          ssClone._zimo = ronAsM1;
          if (ronpaiIsM7) {
            ssClone._bingpai.m[1] = (ssClone._bingpai.m[1] ?? 0) + 1;
          }
          const r7 = Majiang.Util.hule_mianzi(ssClone);
          if (r7 && r7.length > 0) result = r7;
        }
      }
      // R6 P0 #1 fix: 白ぽっち swap で 初めて成立する ロンを UI に出す。
      // リーチ済 + z5 ロン + 通常解なし の場合、 swap 候補で hule 成立を確認
      // 2026-05-14 user 報告 fix: オールマイティ swap は 手牌に z5 が 1 枚以上 ある時のみ可。
      // 旧 code は手牌の z5 を取り除かず swap 加算してて 「正ぽっち z5 ロン [間八萬 / 白待ち 外]」
      // が 通ってしまう bug。 手牌の z5 を 1 枚 swap tile に置換した状態で 元 ron z5 を加えて 完成判定
      const z5InHand = sp._bingpai.z?.[5] ?? 0;
      // [2026-05-21 fix] pai は z5b/r/g/y 等 raw colored pochi で入る場合あり、 toCorePai 経由
      const paiIsZ5 = pai && toCorePai(pai as string) === 'z5';
      if ((!result || result.length === 0) && this.lizhi.has(player) && paiIsZ5 && z5InHand > 0) {
        const swapTargets: string[] = [];
        for (const s of ['m', 'p', 's', 'z']) {
          const len = s === 'z' ? 8 : 10;
          for (let n = 1; n < len; n++) {
            if (!isValidAnmikaTile(s, n)) continue;
            swapTargets.push(`${s}${n}`);
          }
        }
        for (const swap of swapTargets) {
          try {
            const ssClone = sp.clone();
            const ss = swap[0]; const nn = parseInt(swap[1]);
            // 手牌の z5 を 1 枚 swap tile に置換 [オールマイティ実体化]
            ssClone._bingpai.z[5] -= 1;
            ssClone._bingpai[ss][nn] += 1;
            // ron tile z5 を 加える
            ssClone.zimo(pai);
            const r2 = Majiang.Util.hule_mianzi(ssClone);
            if (r2 && r2.length > 0) { result = r2; break; }
            if (americanChitoiComplete(ssClone)) { result = [[]]; break; }
          } catch { /* skip */ }
        }
      }
      if ((!result || result.length === 0) && americanChitoiComplete(sp, pai)) {
        result = [[]];
      }
      if (!result || result.length === 0) return false;
      // 間八萬 [z5 ロン] 特例:
      //  - 切られた z5 が逆ぽ [赤・黄] なら ロン不可 [見逃しにならない]
      //  - 自家河に z5 / m8 があってもフリテン化しない [リョー指示]
      const isKanpa = paiIsZ5 && this.isKanpaman(player, 'z5');
      if (isKanpa && fromPlayer !== null) {
        const discardEntry = this.discardLog[fromPlayer]?.at(-1);
        if (discardEntry?.pochi === 'red' || discardEntry?.pochi === 'yellow') {
          return false;
        }
      }
      // 厳密フリテン: 自家河に「待ち牌のいずれか」が 1 枚でもあれば不可
      // R8 P1 #5 fix: 白ぽっち swap で初めて成立する手は通常 tingpai が空のため、
      // tingpai 空でも スワップ成立 [上 swap fallback 経路で result 拾った場合] なら
      // フリテン check skip して accept、 ただし z5 ロン限定
      const ting: string[] = Array.from(new Set([
        ...((Majiang.Util.tingpai(sp) ?? []) as string[]),
        ...this.getTingpaiList(player),
      ]));
      const isSwapOnly = ting.length === 0 && paiIsZ5 && this.lizhi.has(player);
      // R22 低 #2 fix: m7→m1 swap で成立する case も ting 空 / 通常 tingpai に乗らないので、
      // m7 ロン牌 [pai 自体が m7] か 手牌に m7 ある時 は ting 空でも accept、
      // 後段 furiten check は元手の ting baseline で行う [m7 swap 待ちは furiten 厳密判定 から除外]
      const isM7SwapOnly = ting.length === 0
        && ((pai as string).startsWith('m7') || (sp._bingpai.m?.[7] ?? 0) > 0);
      if (ting.length === 0 && !isSwapOnly && !isM7SwapOnly) return false;
      const baseTile = (p: string) => {
        const stripped = p.replace(/[\+\=\-_*]/g, '');
        return stripped[0] + (stripped[1] === '0' ? '5' : stripped[1]);
      };
      const tingNorm = new Set(ting.map(baseTile));
      const myHe = this.he.get(player);
      // フィーバー中はフリテン判定 skip [ルール 5-3 何度でもアガリ可能]
      if (myHe?._pai && !this.feverActive[player]) {
        for (const discarded of myHe._pai as string[]) {
          // 間八萬時は z5 / m8 のフリテン化を回避
          if (isKanpa && (baseTile(discarded) === 'z5' || baseTile(discarded) === 'm8')) continue;
          if (tingNorm.has(baseTile(discarded))) return false;
        }
      }
      // [2026-05-15 bug C fix] 北 [z4] 単騎: 役満絡み 以外 ロン不可。
      // ロン牌 z4 で 元手の待ちが [z4] のみ → 単騎判定。 役満確定 でなければ reject。
      if (pai === 'z4' && ting.length === 1 && ting[0] === 'z4') {
        const _prevSnap = this.preHuleSnapshot;
        this.saveSnapshot();
        let fakeRes: any = null;
        const fakeFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
        try { fakeRes = this.hule(player, pai, fakeFromPlayer); } catch { /* ignore */ }
        this.restoreSnapshot();
        this.preHuleSnapshot = _prevSnap;
        if (!fakeRes) return false;
        const isYakuman = (fakeRes.damanguan ?? 0) > 0
          || (fakeRes.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**');
        if (!isYakuman) return false;
      }
      const beiFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
      if (!this.canUseBeiMaterialForAgari(player, pai, beiFromPlayer)) return false;
      // ダマ禁止 check: 副露なし + リーチなし → 役満以外ならロン不可
      // 2026-05-14 Round 2 codex fix P1 #7: 旧版は fakeRes truthy なら通してた、
      // 実際 役満限定 [damanguan>=1 / hupai に '*' / '**' / fanshu===undefined] のみ accept
      const hasFulou = sp._fulou && sp._fulou.length > 0;
      // R9 P2 #11 fix: 副露手も fake hule() で 役なし check
      if (hasFulou) {
        const _prevSnapshot = this.preHuleSnapshot;
        this.saveSnapshot();
        let fakeRes: any = null;
        const fakeFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
        try { fakeRes = this.hule(player, pai, fakeFromPlayer); } catch { /* ignore */ }
        this.restoreSnapshot();
        this.preHuleSnapshot = _prevSnapshot;
        if (!fakeRes) return false;
      }
      if (!hasFulou && !this.lizhi.has(player)) {
        // R7 P1 #5 fix: 既存 snapshot 退避、 判定後 書き戻す
        const _prevSnapshot = this.preHuleSnapshot;
        this.saveSnapshot();
        let fakeRes: any = null;
        const fakeFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
        try { fakeRes = this.hule(player, pai, fakeFromPlayer); } catch { /* ignore */ }
        this.restoreSnapshot();
        this.preHuleSnapshot = _prevSnapshot;
        if (!fakeRes) return false;
        // R6 P1 #5 fix: canTsumo の R4 #22 と同じく fanshu === undefined を削除、
        // damanguan>0 / 明示 ** のみで yakuman 判定
        const isYakuman = (fakeRes.damanguan ?? 0) > 0
          || (fakeRes.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**');
        if (!isYakuman) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 和了 [手牌が完成形なら点数情報を返す]
   *  ron 牌は方向 [+/=/-] 必須、 lizhi / 場風 / 自風 / baopai 等を全部 param に渡す */
  hule(player: PlayerId, ronpai: Pai | null = null, fromPlayer: PlayerId | null = null): any {
    const sp = this.shoupai.get(player);
    if (!sp) return null;
    let ronpaiWithDir: string | null = null;
    if (ronpai && fromPlayer !== null) {
      // 反時計 [2026-05-13 fix]: from が player の上家=diff 1、下家=diff 2
      const diff = (fromPlayer - player + 3) % 3;
      const dir = diff === 1 ? '+' : (diff === 2 ? '-' : '');
      if (dir) ronpaiWithDir = ronpai.slice(0, 2) + dir;
    }
    const isLizhi = this.lizhi.has(player) ? 1 : 0;
    const isYifa = this.yifaActive[player];
    const isLingshang = this.lingshangActive[player];
    // 海底 / 河底: 山切れ後の最終アガリ、 ロン=2 / ツモ=1
    const isHaidi = this.shan.paishu === 0 ? (ronpai ? 2 : 1) : 0;
    // 天和 / 地和: 配牌直後 [diyizimo true]、 ツモアガリで親=天和 / 子=地和
    let isTianhu = 0;
    if (this.diyizimo && !ronpai) {
      // 2026-05-14 codex review fix: 現親判定で 子アガリ後の天和/地和 を正しく判定
      isTianhu = (player === this.currentOya) ? 1 : 2;
    }
    // アンミカ向け rule override [配給原点 35000 / 東風戦 / 親流れあり]
    // 詳細は docs/api_spec.md §6 参照
    const anmikaRule = Majiang.rule({
      '配給原点': 35000,
      '順位点': ['30.0', '0', '-30.0'],
      '場数': 1,                  // 東風戦
      '連荘方式': 3,              // ノーテン連荘 [アンミカ: ノーテン親流れナシ、 流局でも親継続]
      'ノーテン罰あり': true,    // 流局聴牌料あり
      'クイタンあり': true,
      '途中流局あり': false,      // 確認必要だが安全側
      '一発あり': true,
      '裏ドラあり': true,
    });
    const param = Majiang.Util.hule_param({
      rule: anmikaRule,
      zhuangfeng: this.changfengZ - 1,
      menfeng: this.zifengZ(player) - 1,
      lizhi: isLizhi,
      yifa: isYifa,
      qianggang: this.qianggangPending && ronpai ? true : false,
      lingshang: isLingshang,
      haidi: isHaidi,
      tianhu: isTianhu,
      // majiang-core は 'z5' のみ認識、 z5* [色付き] は 'z5' に正規化、 f1-4 [華牌] は indicator として無効なので除外
      baopai: (this.shan.baopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f')).map(normalizeBaopaiForMajiang),
      fubaopai: isLizhi ? (this.shan.fubaopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f')).map(normalizeBaopaiForMajiang) : null,
      changbang: this.state.benbang,
      lizhibang: this.state.lizhibang,
    });
    // 秋効果: 表 / 裏ドラ表を物理追加してから hule。 使い切り [filter で f3 削除]
    // ルール: baopai に秋があれば「ドラもう 1 枚めくる」 効果も発動 [山残あれば]
    const akiHandTotal = this.huapai[player].filter((p) => p === 'f3').length;
    const akiHandRemaining = Math.max(0, akiHandTotal - this.akiUsedCount[player]);
    let aki = akiHandRemaining;
    const isLizhiAgari = this.lizhi.has(player);
    const baopaiAki = (this.shan.baopai ?? []).filter((p: any) => p === 'f3').length;
    const fubaopaiAki = isLizhiAgari ? ((this.shan.fubaopai ?? []).filter((p: any) => p === 'f3').length) : 0;
    aki += baopaiAki + fubaopaiAki;
    // 秋金北 [kinpeiTarget=aki + 秋 1 枚以上]: 秋効果 +1 回 [もう 1 枚ドラめくり、 リョー指示 2026-05-12]
    if (this.kinpeiTarget[player] === 'aki' && akiHandRemaining >= 1) {
      aki += 1;
    }
    if (aki > 0 && (this.shan as any)._pai.length === 0) {
      // 山残なし → 秋効果不発 [ルール: 下段しか山が残っていない場合は使用不可]
      aki = 0;
    }
    dlog('[aki check]', { player, akiInHand: this.huapai[player].filter(p => p === 'f3').length, baopaiAki, fubaopaiAki, totalAki: aki, baopaiNow: [...this.shan.baopai], fubaopaiNow: [...(this.shan.fubaopai ?? [])] });
    // 4/8 華判定用に 「自分抜き分」 の huapai 数を 秋 cascade 前に snapshot
    // [ドラ表示由来の華は 4華/8華 対象外、 リョー指示 2026-05-11]
    (this as any)._huapaiOwnLengthAtHule = (this as any)._huapaiOwnLengthAtHule ?? {};
    (this as any)._huapaiOwnLengthAtHule[player] = this.huapai[player].length;
    if (aki > 0) {
      const isLizhi = this.lizhi.has(player);
      dlog('[aki effect] pushing', { player, aki, willAddBaopai: aki, isLizhi });
      // 秋効果: 華が出たらドラ表示領域には残しつつ、次の通常牌までめくる。
      // 途中で f3 が出ても効果回数は増やさない [秋金北の過剰めくり防止]。
      let akiRemaining = aki;
      const drawWithCascade = (isFu: boolean): string | null => {
        let newPai = this.shan.drawNewDora(isFu);
        while (newPai && newPai.startsWith('f')) {
          // [Fix 2026-05-13]: ドラめくり由来の f を huapai[player] に push しない
          // L1033 コメント 「ドラ表示由来の華は 4華/8華 対象外」 と整合
          // 春夏秋冬 打点 [applyHuapaiEffect L1270-1275] は baopai/fubaopai 由来の f も
          // 別途 hua array に追加しているので、 huapai に push しなくても 打点計算は維持される
          // 秋効果中にめくれた f3 は「華牌なので飛ばす」だけにする。
          // ここで効果回数を増やすと、秋金北が秋秋以上に増殖して 3 枚めくりになる。
          newPai = this.shan.drawNewDora(isFu);
        }
        return newPai;
      };
      while (akiRemaining > 0) {
        drawWithCascade(false);
        if (isLizhi) drawWithCascade(true);
        akiRemaining -= 1;
        if (this.shan.paishu === 0) break;
      }
      param.baopai = (this.shan.baopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f')).map(normalizeBaopaiForMajiang);
      if (isLizhi) param.fubaopai = (this.shan.fubaopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f')).map(normalizeBaopaiForMajiang);
      // 秋使い切り flag [huapai は残す、 春チップ計算等で抜き枚数に含める]
      this.akiUsedCount[player] += akiHandRemaining;
    }

    let result: any;
    let huleErr: any = null;
    try {
      const spForHule = sp.clone();
      result = Majiang.Util.hule(spForHule, ronpaiWithDir, param);
    } catch (e) {
      huleErr = e;
      result = null;
    }
    dlog('[hule debug]', { player, ronpai, ronpaiWithDir, fromPlayer, isLizhi, paramBaopai: param.baopai, paramFubaopai: param.fubaopai, hupaiInResult: result?.hupai, fanshu: result?.fanshu, defen: result?.defen, hasResult: !!result, err: huleErr?.message });
    if (!result && americanChitoiComplete(sp, ronpaiWithDir)) {
      const quadCount = countAmericanChitoiQuads(sp, ronpaiWithDir);
      result = {
        hupai: [{ name: '七対子', fanshu: 2 }],
        fu: 25,
        fanshu: 2,
        damanguan: 0,
        defen: 0,
        fenpei: [0, 0, 0, 0],
      };
      if (quadCount > 0) {
        result.hupai.push({ name: `アメリカ七対子 [${quadCount}種 4 枚使い]`, fanshu: 4 * quadCount });
        result.fanshu += 4 * quadCount;
      }
      // [2026-05-21 fix] アメリカ七対子 fallback path で 標準 yaku 加算 漏れ:
      // 立直 / 門前清自摸和 / 一発 / 嶺上 / 海底 / 河底 / 天和 を hupai に追加
      if (isLizhi) {
        result.hupai.push({ name: '立直', fanshu: 1 });
        result.fanshu += 1;
      }
      if (!ronpai) {
        result.hupai.push({ name: '門前清自摸和', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isYifa) {
        result.hupai.push({ name: '一発', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isLingshang) {
        result.hupai.push({ name: '嶺上開花', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isHaidi) {
        result.hupai.push({ name: ronpai ? '河底撈魚' : '海底摸月', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isTianhu) {
        result.hupai.push({ name: '天和', fanshu: '*' });
        result.damanguan = (result.damanguan ?? 0) + 1;
      }
    }
    // 神ぽっち: 正ぽ [z5] がドラ表 / 裏ドラ表に出てる場合、 任意の牌をドラ表示扱い
    // [リョー指示 2026-05-10: 自動で最多牌のドラ表示に差し替え]
    // 神ぽっち発動条件: baopai / fubaopai に z5 が出てて、 その色が正ぽ [緑/青] のみ
    // 逆ぽ [赤/黄] はただの白扱い [リョー指示]
    const baopaiHasZ5 = (this.shan.baopai ?? []).some((b: any) => isPositiveZ5(b));
    const fubaopaiHasZ5 = (this.shan.fubaopai ?? []).some((b: any) => isPositiveZ5(b));
    if ((baopaiHasZ5 || fubaopaiHasZ5)) {
      // ドラ表示牌 神ぽっち: 手牌 + 抜き北 を候補に [華は対象外]
      const target = this.mostCommonPaiInHand(sp, { player, includeHua: false });
      dlog('[kami pochi]', { winner: player, target, bingpai: sp._bingpai });
      if (target) {
        const indicator = this.doraIndicatorOf(target);
        // 神ぽ indicator は majiang-core 用に正規化 [m7/m9 循環対応]
        const adjustedIndicator = normalizeBaopaiForMajiang(indicator);
        const newBaopai = (this.shan.baopai ?? []).map((b: any) => isPositiveZ5(b) ? adjustedIndicator : normalizeBaopaiForMajiang(b));
        const newFubaopai = (this.shan.fubaopai ?? []).map((b: any) => isPositiveZ5(b) ? adjustedIndicator : normalizeBaopaiForMajiang(b));
        const newParam = { ...param, baopai: newBaopai, fubaopai: this.lizhi.has(player) ? newFubaopai : param.fubaopai };
        try {
          const spForHule = sp.clone();
          const newResult = Majiang.Util.hule(spForHule, ronpaiWithDir, newParam);
          // result が null でも newResult があれば採用、 さらに fanshu 大なら更新
          if (newResult && newResult.fanshu !== undefined) {
            if (!result || newResult.fanshu > (result.fanshu ?? 0)) {
              result = newResult;
              result.hupai = result.hupai ?? [];
              result.hupai.push({ name: `神ぽっち [${indicator}→ドラ ${target}]`, fanshu: 0 });
              // [2026-05-21 fix] 神ぽっち適用後の param を保持、 後続の 白ぽっちオールマイティ
              // swap path がこの修正済 baopai/fubaopai を使い続けるように。 旧 code は param 更新せず
              // → swap が原 fubaopai で計算 → 神ぽっち ura ドラ消える bug。
              param.baopai = newBaopai;
              if (this.lizhi.has(player)) param.fubaopai = newFubaopai;
            }
          }
        } catch { /* skip */ }
      }
    }
    // 白ぽっち オールマイティ: リーチ済 + アガリ牌 z5 で 役なしなら swap 試行
    // 2026-05-14 codex review fix [Group O+P]: ロンも swap 試行、 高め取り [最大 fanshu 探索]
    //   旧: ツモ + 役なし のみ swap、 ロンは対象外。 仕様 「高め取り」 [複数 swap 候補から最高打点 採用]
    // R12 P0 #6 fix: ロン swap には 手牌 z5 必須 [canRon と一致]、 旧 code は ronpai z5 だけで
    // 通って 間八萬 / 白待ち外 でも別形に化ける bug
    // [2026-05-21 fix] _zimo / ronpai は z5b/r/g/y 等 raw 可、 toCorePai 経由で比較
    const zimoIsZ5b = sp._zimo ? toCorePai(sp._zimo) === 'z5' : false;
    const ronpaiIsZ5b = ronpai ? toCorePai(ronpai) === 'z5' : false;
    const isPochiAgariPai = zimoIsZ5b || ronpaiIsZ5b;
    const z5InHandForSwap = sp._bingpai.z?.[5] ?? 0;
    const ronSwapAllowed = ronpai ? z5InHandForSwap > 0 : true;
    if (this.lizhi.has(player) && isPochiAgariPai && ronSwapAllowed) {
      const swapTargets: string[] = [];
      for (const s of ['m', 'p', 's', 'z']) {
        const len = s === 'z' ? 8 : 10;
        for (let n = 1; n < len; n++) {
          if (!isValidAnmikaTile(s, n)) continue;
          swapTargets.push(`${s}${n}`);
        }
      }
      let best: any = null;
      // 既に通常 result があるなら base としてその fanshu を比較対象に [高め取り]
      const baseFan = result ? (typeof result.fanshu === 'number' ? result.fanshu : 99) : -1;
      for (const swap of swapTargets) {
        try {
          const spClone = sp.clone();
          const ss = swap[0]; const nn = parseInt(swap[1]);
          if (!ronpai) {
            // R6 P0 #1 fix: ツモ swap = z5 を swap に置換 [z5 は _zimo として手牌内]
            spClone._bingpai.z[5] -= 1;
            spClone._bingpai[ss][nn] += 1;
            spClone._zimo = swap;
          } else {
            // R13 P1 #7 fix: ロン swap も canRon と一致させる。 canRon は
            // 「手牌 z5 を 1 枚 swap に置換 + ron pai z5 はそのまま」 で simulate してて、
            // hule もそれに合わせる。 旧 code は ronpai を swap に置換してた = canRon と不整合、
            // 結果として canRon 通過手と hule 完成手 がズレる可能性
            spClone._bingpai.z[5] -= 1;
            spClone._bingpai[ss][nn] += 1;
          }
          // R13 P1 #7 fix: ron 時は ronpaiSwapped = z5 [元の ronpai] のまま、 swap に書換しない
          const ronpaiSwapped = ronpaiWithDir;
          let r = Majiang.Util.hule(spClone, ronpaiSwapped, param);
          if ((!r || !((r.fanshu !== undefined) || ((r.damanguan ?? 0) > 0) || (r.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**')))
            && americanChitoiComplete(spClone, ronpai ? ronpaiWithDir : null)) {
            const quadCount = countAmericanChitoiQuads(spClone, ronpai ? ronpaiWithDir : null);
            r = {
              hupai: [{ name: '七対子', fanshu: 2 }],
              fu: 25,
              fanshu: 2,
              damanguan: 0,
              defen: 0,
              fenpei: [0, 0, 0, 0],
            };
            if (quadCount > 0) {
              r.hupai.push({ name: `アメリカ七対子 [${quadCount}種 4 枚使い]`, fanshu: 4 * quadCount });
              r.fanshu += 4 * quadCount;
            }
          }
          if (r && (r.fanshu !== undefined || (r.damanguan ?? 0) > 0 || (r.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**'))) {
            // R8 P1 #6 fix: 高め取り を [damanguan, fanshu, fu, defen] 多段優先で比較。
            // 旧 code は fanshu のみ比較で 役満は undefined → 99 扱いで 単役満 / ダブル役満 が区別不能、
            // 同翻 でも 符 / 実点 差で 取りこぼし
            const scoreOf = (x: any): [number, number, number, number] => [
              x.damanguan ?? 0,
              typeof x.fanshu === 'number' ? x.fanshu : 99,
              x.fu ?? 0,
              Array.isArray(x.defen) ? Math.max(...x.defen.map((d: any) => +d || 0)) : (+x.defen || 0),
            ];
            const cmp = (a: [number, number, number, number], b: [number, number, number, number]) => {
              for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
              return 0;
            };
            // R9 P1 #9 fix: 既存 result も scoreOf で比較、 [0, baseFan, 0, 0] では既存 damanguan が
            // 落ちて 通常 result がダブル役満でも swap 候補の単役満が 勝ってしまう bug 解消
            const baseScore: [number, number, number, number] = result
              ? scoreOf(result)
              : [-1, -1, -1, -1];
            const newScore = scoreOf(r);
            if (cmp(newScore, baseScore) > 0 && (!best || cmp(newScore, scoreOf(best)) > 0)) {
              best = r;
              best._allmightyPochi = swap;
            }
          }
        } catch { /* skip */ }
      }
      if (best) {
        result = best;
        result.hupai = result.hupai ?? [];
        result.hupai.push({ name: `白ぽっち オールマイティ [${best._allmightyPochi}]${ronpai ? ' [ロン]' : ''}`, fanshu: 0 });
      }
    }
    // アンミカ独自: 7m を ヤオチュー牌として扱う再判定
    // majiang-core の判定で役無し or 通常役のみ → 「7m を 1m として扱う」 国士 / 清老頭等を後付け
    const anmikaYakuman = anmikaTry7mYakuman(sp, ronpaiWithDir);
    if (anmikaYakuman) {
      // 既存 result より役満が強いなら上書き
      if (!result || (result.damanguan ?? 0) === 0) {
        result = anmikaYakuman;
      }
    }
    // 2026-05-14 codex review fix [Group Q]: 清老頭 / チャンタ / 純チャンタ の m7→m1 substitution
    //   m7 を m1 に置換した sp clone で 再 hule、 majiang-core が認識する 全帯么 / 純全帯么 を pick up、
    //   既存 result が同名役なし or fanshu が低いなら上書き
    try {
      // R3 P2 #15 fix: m7 ロン牌も m1 扱いに、 ronpaiWithDir が m7 の case で
      // チャンタ / 純チャンタ / 清老頭 が拾われない bug を修正
      const ronpaiIsM7 = ronpaiWithDir !== null && ronpaiWithDir.startsWith('m7');
      const m7Count = sp._bingpai.m?.[7] ?? 0;
      if (m7Count > 0 || ronpaiIsM7) {
        const spClone7 = sp.clone();
        spClone7._bingpai.m[1] = (spClone7._bingpai.m[1] ?? 0) + m7Count;
        spClone7._bingpai.m[7] = 0;
        // 副露内 m7 は そのまま [簡略、 完全対応は後続版]
        // ronpai が m7 なら m1 に置換 [方向 marker 維持]
        const ronpaiSub = ronpaiIsM7 ? ('m1' + ronpaiWithDir!.slice(2)) : ronpaiWithDir;
        const r7 = Majiang.Util.hule(spClone7, ronpaiSub, param);
        if (r7 && r7.hupai) {
          const upgradeNames = ['全帯么', '純全帯么', '清老頭'];
          const hasUpgrade = r7.hupai.some((h: any) => upgradeNames.some(n => h.name?.includes(n)));
          if (hasUpgrade) {
            const baseFan = result ? (typeof result.fanshu === 'number' ? result.fanshu : 99) : -1;
            const newFan = typeof r7.fanshu === 'number' ? r7.fanshu : 99;
            if (newFan > baseFan) {
              // hupai marker 追加して result 上書き
              r7.hupai.push({ name: 'アンミカ m7=1m 扱い', fanshu: 0 });
              result = r7;
            }
          }
        }
      }
    } catch { /* skip */ }
    // R3 P1 #12 fix: result null でも、 抜き北を手牌に戻すと 字一色 / 四喜和 / 国士無双
    // 役満が成立する case を fallback で検出。 nukidora > 0 + z4 戻し で hule_mianzi が解になり、
    // かつ 上記 役満 条件を満たすなら、 minimal result を構築して post-process に進める
    if (!result && ((this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0)) > 0) {
      try {
        const spClone = sp.clone();
        spClone._bingpai.z[4] += (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
        const fallback = Majiang.Util.hule(spClone, ronpaiWithDir, param);
        if (fallback && fallback.hupai) {
          const hasYakuman = (fallback.damanguan ?? 0) > 0
            || fallback.hupai.some((h: any) => ['字一色', '大四喜', '小四喜', '国士無双'].some(n => h.name?.includes(n)));
          if (hasYakuman) {
            result = fallback;
            // marker、 後段の判定で 「抜き北戻し成立」 を識別可能に
            result.hupai.push({ name: 'アンミカ 北抜き戻し役満成立', fanshu: 0 });
          }
        }
      } catch { /* skip */ }
    }
    if (!result) return null;
    (result as any)._ronpaiForChip = ronpai ?? null;
    // R9 P1 #2 fix: アンミカ独自役の役満化を ダマ禁止 / 役なし禁止 reject の 前 に走らせる、
    // 面前ダマ 三風 / 間八萬 / 萬子混一色 等 post-process でしか役満化しない手が 先 reject される bug 解消
    // R12 P1 #9 fix: 白ぽっち allmighty swap 適用後は アガリ牌を _allmightyPochi 置換後の牌に
    // 差し替えて post-process に渡す。 旧 code は 元 z5 を渡してて 三連刻 / 萬子混一色 /
    // オールスター 独自役 が swap 後の手と一致しない bug
    const agariPaiForPost = (result as any)._allmightyPochi
      ? ((result as any)._allmightyPochi as string)
      : (ronpai ?? sp._zimo ?? null);
    // R13 P1 #6 fix: ダブロン chipBreakdown / chipTotal 混入対策
    //  - post-process 前の chipBreakdown 長 を記録、 applyHule で _preBreakdown を slice する基準
    //  - post-process 前の chipLedger snapshot も取って、 applyHule の chipBefore に使う
    //    [preHuleSnapshot は dabuon 全 hule で共有なので、 2 人目 hule の chipBefore が
    //     1 人目 applyChipOall 影響分 [八華 100 オール等] を含まない値になる]
    (result as any)._postProcessChipStart = this.chipBreakdown.length;
    (result as any)._chipLedgerBeforeThis = {
      0: this.chipLedger[0], 1: this.chipLedger[1], 2: this.chipLedger[2],
    };
    this.applyAnmikaYakuPostProcess(result, player, ronpai !== null, agariPaiForPost, fromPlayer, ronpai);
    (result as any)._anmikaPostProcessApplied = true;
    if (handUsesBeiMaterial(sp, ronpai) && !resultHasYakuman(result)) {
      dlog('[hule reject] 北を手牌構成に使用した非役満和了', { player, ronpai, hupai: result.hupai, fanshu: result.fanshu, damanguan: result.damanguan });
      return null;
    }
    // アンミカ独自: 面前ダマアガリ禁止 [役満を除く]
    // ルール 1.1 「面前時のダマアガリ不可、 副露後のダマは可、 国士・天和・地和・人和はダマOK」
    const hasFulou = sp._fulou && sp._fulou.length > 0;
    const isYakuman = result.damanguan && result.damanguan > 0;
    if (!hasFulou && !this.lizhi.has(player) && !isYakuman) {
      return null;
    }
    // 役無しアガリ禁止 [リョー指示 2026-05-12]: fanshu === 0 かつ damanguan ナシなら reject
    // 抜きドラ等は後で加算するので、 ここでは majiang-core の base fanshu を見る
    if ((result.fanshu ?? 0) === 0 && !isYakuman) {
      return null;
    }
    // 抜きドラ加算 [アンミカ: 1 枚 = 1 翻、 4 枚抜きで 8 翻 [+4 ボーナス]]
    //   通常 z4 + 金北 [nukidoraGold] 両方カウント
    const nuki = (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
    if (nuki > 0 && result.fanshu !== undefined) {
      result.hupai = result.hupai ?? [];
      const fanAdd = nuki >= 4 ? 8 : nuki;
      result.hupai.push({ name: nuki >= 4 ? '抜きドラ ×4 [8翻]' : `抜きドラ ×${nuki}`, fanshu: fanAdd });
      result.fanshu += fanAdd;
      // 裏 / 表 ドラ表に z3 [西] indicator [→ z4 北 ドラ] が出てる場合、 抜き北も追加ドラとして count
      // [リョー指示 2026-05-11: 西捲れ + 北抜き済 で 抜きドラ枚数分の ドラ翻 を加算]
      const isLizhiAgari = this.lizhi.has(player);
      const baopaiHasZ3 = (this.shan.baopai ?? []).filter((p: any) => toCorePai(p) === 'z3').length;
      const fubaopaiHasZ3 = isLizhiAgari ? (this.shan.fubaopai ?? []).filter((p: any) => toCorePai(p) === 'z3').length : 0;
      const extraNukiDora = (baopaiHasZ3 + fubaopaiHasZ3) * nuki;
      if (extraNukiDora > 0) {
        result.hupai.push({ name: `北ドラ [西indicator ×${baopaiHasZ3 + fubaopaiHasZ3} × 抜き ${nuki}]`, fanshu: extraNukiDora });
        result.fanshu += extraNukiDora;
      }
    }
    // [2026-05-15 fix bug A] majiang-core hule.js の 「ドラ」 / 「裏ドラ」 count に
    // 0 牌複数枚漏れバグ あり [hule.js L570 / L588 `m.replace(/0/, '5')` に g flag 無、
    // suitstr 内の 2 つ目以降の '0' が 5 として match されない]。 anmika 側で補正:
    // - 手牌 bingpai[s][0] [赤/金 5] が 2 枚以上ある suit について、 indicator next が s5 の
    //   とき (count - 1) を 「ドラ」 / 「裏ドラ」 entry に加算
    // - 副露内に '0' が 2 枚以上ある suitstr [例 暗槓 0 牌 2 枚] についても max(0, zeros - 1) 補正
    // 旧 削除 code は 0 牌 N 枚をすべて加算していて 1 枚分二重計上、 完全削除では (N-1) 不足。
    // ここで N-1 だけ補正する [N=1 なら 補正 0]。
    if (result.fanshu !== undefined) {
      const isLizhiAgari = this.lizhi.has(player);
      const computeNext = (ind: string): string => {
        let i = ind;
        if (i === 'gp') i = 'p5';
        else if (i === 'gs') i = 's5';
        else if (i === 'gN') i = 'z4';
        else if (i.length > 2 && i[0] === 'z' && i[1] === '5') i = 'z5';
        const sx = i[0];
        const nRaw = i[1] === '0' ? 5 : parseInt(i[1]);
        if (!Number.isFinite(nRaw)) return '';
        let nextN: number;
        if (sx === 'z') {
          if (nRaw <= 4) nextN = (nRaw % 4) + 1;
          else nextN = ((nRaw - 4) % 3) + 5;
        } else {
          nextN = (nRaw % 9) + 1;
        }
        return `${sx}${nextN}`;
      };
      // suit ごとに 「majiang-core が漏らす 0 数」 を算出 [手牌 + 各副露 単位]
      const zeroDeficitForSuit = (suit: 'p' | 's' | 'm'): number => {
        let deficit = 0;
        const handZeros = sp._bingpai[suit]?.[0] ?? 0;
        if (handZeros >= 2) deficit += handZeros - 1;
        for (const m of sp._fulou ?? []) {
          const ms = m as string;
          if (ms[0] !== suit) continue;
          const zeros = (ms.match(/0/g) || []).length;
          if (zeros >= 2) deficit += zeros - 1;
        }
        return deficit;
      };
      const computeExtra = (indicators: string[]): number => {
        let extra = 0;
        for (const ind of indicators) {
          if (typeof ind !== 'string') continue;
          const next = computeNext(ind);
          if (next === 'p5') extra += zeroDeficitForSuit('p');
          else if (next === 's5') extra += zeroDeficitForSuit('s');
          // m に赤/金 5 は anmika 仕様上ナシだが念のため
          else if (next === 'm5') extra += zeroDeficitForSuit('m');
        }
        return extra;
      };
      const baopaiList = [...(this.shan.baopai ?? [])].filter((p: any) => typeof p === 'string');
      const fubaopaiList = isLizhiAgari ? [...(this.shan.fubaopai ?? [])].filter((p: any) => typeof p === 'string') : [];
      const extraDora = computeExtra(baopaiList);
      const extraUra = computeExtra(fubaopaiList);
      result.hupai = result.hupai ?? [];
      if (extraDora > 0) {
        const doraE = result.hupai.find((h: any) => h.name === 'ドラ');
        if (doraE && typeof doraE.fanshu === 'number') doraE.fanshu += extraDora;
        else result.hupai.push({ name: 'ドラ [赤/金 5 補正]', fanshu: extraDora });
        result.fanshu += extraDora;
      }
      if (extraUra > 0) {
        const uraE = result.hupai.find((h: any) => h.name === '裏ドラ');
        if (uraE && typeof uraE.fanshu === 'number') uraE.fanshu += extraUra;
        else result.hupai.push({ name: '裏ドラ [赤/金 5 補正]', fanshu: extraUra });
        result.fanshu += extraUra;
      }
    }
    // アンミカ独自役 post-process [リーのみ / 三風 / アメリカ七対子 / 小車輪 / 大車輪 / 八連荘]
    // R9 P1 #2: 役満 reject 前に既に走らせてる場合 skip [重複呼出防止]
    if (!(result as any)._anmikaPostProcessApplied) {
      this.applyAnmikaYakuPostProcess(result, player, ronpai !== null, ronpai ?? sp._zimo ?? null, fromPlayer, ronpai);
    }
    // アンミカ華牌 [春夏秋冬] の打点効果
    this.applyHuapaiEffect(result, player);
    // フィーバー立直: tier 2 [ダブル] / tier 3 [トリプル] は 打点 + 祝儀を末尾で ×2 / ×4
    // [リョー指示 2026-05-12: fanshu 加算じゃなく 最終 defen / chip 倍率、 例 10翻 baiman × 2]
    if (this.feverActive[player]) {
      result.hupai = result.hupai ?? [];
      const tier = this.feverTier[player];
      const tierLabel = tier === 3 ? 'トリプル' : tier === 2 ? 'ダブル' : '';
      result.hupai.push({ name: `${tierLabel}フィーバー立直`, fanshu: 0 });
      if (tier >= 2 && result.fanshu !== undefined) {
        const mul = tier === 3 ? 4 : 2;
        // defen / defen3 を ×mul
        if (typeof result.defen === 'number') result.defen = result.defen * mul;
        if (typeof result.defen3 === 'number') result.defen3 = result.defen3 * mul;
        if (result.fenpei) result.fenpei = result.fenpei.map((x: number) => x * mul);
        result.hupai.push({ name: `${tierLabel}フィーバー [打点 ×${mul}]`, fanshu: 0 });
      }
    }
    return result;
  }

  /** 華牌 [春夏秋冬] の打点効果を hule result に加算 [アンミカ ルール 2-2]
   *  - 夏: 打点 1 ランクアップ。 マンガン未満は fanshu+1、 マンガン以降は段階を 1 段上げる
   *    [マンガン→ハネマン→倍マン→三倍→役満→五倍→六倍]
   *  - 夏夏: 2 ランクアップ
   *  - 秋: 上がったときにドラ 1 枚増やす [カンドラ相当、 表 + 裏もリーチ時]、 秋秋なら 2 枚
   *  - 春・春春・冬・冬冬: 祝儀系のため、 chip 表示のみ */
  applyHuapaiEffect(result: any, player: PlayerId): void {
    if (!result || result.fanshu === undefined) return;
    // ルール 2-2: ドラ表示牌の華牌もアガリ時に抜いたものとして計算
    // [リーチアガリ時のみ裏ドラの華も追加]
    const hua = [...this.huapai[player]];
    const isLizhiAgari = this.lizhi.has(player);
    for (const p of (this.shan.baopai ?? [])) if (typeof p === 'string' && p.startsWith('f')) hua.push(p);
    if (isLizhiAgari) {
      for (const p of (this.shan.fubaopai ?? [])) if (typeof p === 'string' && p.startsWith('f')) hua.push(p);
    }
    const haru = hua.filter((p) => p === 'f1').length;
    const natsu = hua.filter((p) => p === 'f2').length;
    const aki = hua.filter((p) => p === 'f3').length;
    // 2026-05-14 codex review fix: 冬 [アリス] は 「実際に抜いた / 使う選択 した player」 限定の効果、
    // baopai/fubaopai 表示牌由来は冬 effect の対象外。 own huapai 限定 count に変更
    const fuyu = this.huapai[player].filter((p) => p === 'f4').length;
    result.hupai = result.hupai ?? [];

    // 秋効果は hule 前に baopai 物理追加で対応済 [majiang-core が「ドラ N / 裏ドラ N」
    // を自動加算してくれる、 祝儀計算でも 全 baopai / fubaopai を見れば 通常ドラと同等扱い]
    if (aki > 0) {
      result.hupai.push({ name: `秋${'秋'.repeat(aki - 1)} [ドラ表追加]`, fanshu: 0 });
    }

    // 夏金北 / 夏夏金北: kinpeiTarget='natsu' で適用
    // - 夏金北 [natsu==1]: 夏もう 1 回 = 夏夏相当 = +2 段アップ
    // - 夏夏金北 [natsu>=2]: +N 段アップは取消、 後続 applyChipsOnHule で base ×4
    const isNatsuKinpei = this.kinpeiTarget[player] === 'natsu';
    const natsuKinpeiActive = natsu >= 2 && isNatsuKinpei;  // 夏夏金北 [×4]
    const natsuEffect = natsu + (isNatsuKinpei && natsu === 1 ? 1 : 0);  // 夏金北単体 = natsu=2 相当
    // 夏: 打点ランクアップ N 段 [マンガン未満なら直接マンガン、 マンガン以降は段階アップ]
    if (natsuEffect > 0 && !natsuKinpeiActive) {
      const beforeFan = result.fanshu;
      const beforeLevel = fanshuLevel(beforeFan, result.fu ?? 30);
      const afterLevel = Math.min(beforeLevel + natsuEffect, LEVEL_TO_FANSHU.length - 1);
      const afterFan = LEVEL_TO_FANSHU[afterLevel] || beforeFan + natsuEffect;
      const labelN = natsuEffect === 1 ? '夏' : natsuEffect === 2 ? '夏夏' : `夏×${natsuEffect}`;
      const kinpeiNote = isNatsuKinpei && natsu === 1 ? ' [夏金北]' : '';
      result.hupai.push({ name: `${labelN}${kinpeiNote} [打点ランクアップ Lv${beforeLevel}→${afterLevel} ${beforeFan}→${afterFan}翻相当]`, fanshu: afterFan - beforeFan });
      result.fanshu = afterFan;
    }

    // 春効果は applyChipsOnHule 側で集計 [二重表示防止のため、 ここでは push しない]
    if (fuyu > 0) {
      result.hupai.push({ name: `冬${'冬'.repeat(fuyu - 1)} [アリス祝儀のみ]`, fanshu: 0 });
    }
  }

  /** アンミカ独自役の post-process [3-1 高ハン役 + 3-2 役満]
   *  majiang-core 標準にない役を hupai に追加 / damanguan 上書き */
  applyAnmikaYakuPostProcess(result: any, player: PlayerId, isRon: boolean, agariPai: string | null = null, fromPlayer: PlayerId | null = null, ronpaiOrig: string | null = null): void {
    if (!result || !result.hupai) return;
    const sp = this.shoupai.get(player);
    const isMenzen = !sp._fulou || sp._fulou.length === 0 || sp._fulou.every((m: string) => m.match(/^[mpsz]\d{4}$/));
    // R9 P1 #1 fix: ロン時 sp._bingpai は pre-ron 13 枚で agariPai を含まない、
    // post-process 多数 [三風 / 三連刻 / 四連刻 / 七対子 / 混一色 / オールスター] が
    // ロン牌で完成する case を取りこぼす。 ronpai 込み view を作って 以下 _bp で参照
    // R13 P1 #7 fix: 白ぽっち allmighty 適用後は 手牌 z5 を 1 枚 swap tile に置換、
    // canRon / hule の swap 動作 と post-process 判定 を整合
    const _bp = (() => {
      const base = {
        m: [...(sp._bingpai.m ?? [])],
        p: [...(sp._bingpai.p ?? [])],
        s: [...(sp._bingpai.s ?? [])],
        z: [...(sp._bingpai.z ?? [])],
      };
      const allmighty = (result as any)._allmightyPochi as string | undefined;
      if (allmighty && allmighty.length >= 2) {
        const sCh = allmighty[0];
        const nN = parseInt(allmighty[1], 10);
        if ((sCh === 'm' || sCh === 'p' || sCh === 's' || sCh === 'z') && Number.isFinite(nN)) {
          // 手牌 z5 を 1 枚 swap tile に置換
          if ((base.z[5] ?? 0) > 0) {
            base.z[5] -= 1;
            base[sCh][nN] = (base[sCh][nN] ?? 0) + 1;
          }
        }
      }
      // ロン牌込み view [allmighty 後でも ron path で agariPai を加算、
      // tsumo path は zimo として手牌内なので加算なし]
      // R14 P1 #1 fix: ロン牌は **元 ronpai** [z5] を加算する。
      // 旧 code は agariPai [allmighty swap tile] を加算してて _bp 内 swap tile が 2 重加算 [手牌 + ロン]、
      // 三連刻 / 混一色 / 国士13面 で false positive / negative
      // canRon の動作: 手牌 z5 → swap tile [_bp.z[5]-=1, _bp[s][n]+=1]、 ロン牌は元 z5 のまま [_bp.z[5]+=1]
      // つまり swap tile +1、 z5 ±0 が正しい view
      const ronView = (isRon && ronpaiOrig) ? ronpaiOrig : (isRon ? agariPai : null);
      if (ronView && ronView.length >= 2) {
        const sCh = ronView[0];
        const nN = parseInt(ronView[1], 10);
        if ((sCh === 'm' || sCh === 'p' || sCh === 's' || sCh === 'z') && Number.isFinite(nN)) {
          base[sCh][nN] = (base[sCh][nN] ?? 0) + 1;
        }
      }
      return base;
    })();

    // 間八萬 [かんぱーまん]: m7/m9 持ち + アガリ牌 z5 [ぽっち経由 m8、 山に m8 はない]
    if (this.isKanpaman(player, agariPai)) {
      if (!isRon) {
        result.hupai.push({ name: '間八萬 [本役満ツモ]', fanshu: '*' });
        result.fanshu = undefined;
        result.damanguan = (result.damanguan ?? 0) + 1;
      } else {
        result.hupai.push({ name: '間八萬', fanshu: 8 });
        if (result.fanshu !== undefined) result.fanshu += 8;
      }
      // 789 三色完成 [m789 + p789 + s789] → +4 翻
      if (sp._bingpai.p[7] >= 1 && sp._bingpai.p[8] >= 1 && sp._bingpai.p[9] >= 1 &&
          sp._bingpai.s[7] >= 1 && sp._bingpai.s[8] >= 1 && sp._bingpai.s[9] >= 1) {
        result.hupai.push({ name: '789 三色 [間八萬複合]', fanshu: 4 });
        if (result.fanshu !== undefined) result.fanshu += 4;
      }
    }

    // オープン立直: +1 翻、 ただし出アガリ [isRon] + 放銃者が非リーチ なら 押し出し本役満 [役満化]
    // [リョー指示 2026-05-11: リーチしてない人が放銃した時のみ役満、 リーチ者同士の放銃は通常 +1 翻]
    if (this.openLizhi.has(player)) {
      const fromIsLizhi = fromPlayer !== null && this.lizhi.has(fromPlayer);
      if (isRon && !fromIsLizhi) {
        result.hupai = result.hupai.filter((h: any) => h.name !== '立直');
        result.hupai.push({ name: 'オープン立直 押し出し本役満 [非リーチ者放銃]', fanshu: '*' });
        result.fanshu = undefined;
        result.damanguan = (result.damanguan ?? 0) + 1;
      } else if (result.fanshu !== undefined) {
        result.hupai.push({ name: 'オープン立直', fanshu: 1 });
        result.fanshu += 1;
      }
    }

    // リーのみ [カラス]: 立直のみ + 他役 (ドラ・赤含む) なし + 出アガリ → 役満
    if (isRon && this.lizhi.has(player) && isMenzen) {
      const onlyLizhi = result.hupai.length === 1 && result.hupai[0].name === '立直';
      const noDoraNoBaopai = !result.hupai.some((h: any) => h.name === 'ドラ' || h.name === '赤ドラ' || h.name === '裏ドラ');
      if (onlyLizhi && noDoraNoBaopai && this.huapai[player].length === 0) {
        result.hupai = [{ name: 'カラス [リーのみ役満]', fanshu: '*' }];
        result.fanshu = undefined;
        result.damanguan = 1;
      }
    }

    // 八連荘: 8 本場以降 + 親アガリ → 本役満 [リョー指示 2026-05-11: ロンも対象]
    // 2026-05-14 codex review fix: 八連荘 判定も現親で、 親流れ後の現親 八連荘 を正しく検知
    if (this.state.benbang >= 8 && player === this.currentOya) {
      result.hupai.push({ name: isRon ? '八連荘 [ロン]' : '八連荘 [ツモ]', fanshu: '*' });
      result.damanguan = (result.damanguan ?? 0) + 1;
      result.fanshu = undefined;
    }

    // 三風 [東南西を刻子]: z1z1z1 + z2z2z2 + z3z3z3 全部含むなら役満
    // R9 P1 #1 fix: _bp [ロン牌込み view] で 判定、 ロン牌で刻子完成 取りこぼし防止
    const tripletZ = (n: number) => (_bp.z[n] >= 3) || sp._fulou.some((m: string) => m.match(new RegExp(`^z${n}{3}`)));
    if (tripletZ(1) && tripletZ(2) && tripletZ(3)) {
      result.hupai.push({ name: '三風 [役満]', fanshu: '*' });
      result.damanguan = (result.damanguan ?? 0) + 1;
      result.fanshu = undefined;
    }

    // アメリカ七対子: 七対子 + 同種 4 枚 (= 同 pai 4 枚) → 4 枚使いごとに +4 ハン
    const isQidui = result.hupai.some((h: any) => h.name === '七対子');
    if (isQidui) {
      let quadCount = 0;
      // R9 P1 #1 fix: _bp で判定、 ロン牌が 4 枚目になる七対子 取りこぼし防止
      for (const s of ['m', 'p', 's', 'z']) {
        const len = s === 'z' ? 8 : 10;
        for (let n = 1; n < len; n++) {
          if (!isValidAnmikaTile(s, n)) continue;
          if (((_bp as any)[s]?.[n] ?? 0) === 4) quadCount++;
        }
      }
      if (quadCount > 0 && !result.hupai.some((h: any) => typeof h.name === 'string' && h.name.startsWith('アメリカ七対子'))) {
        result.hupai.push({ name: `アメリカ七対子 [${quadCount}種 4 枚使い]`, fanshu: 4 * quadCount });
        if (result.fanshu !== undefined) result.fanshu += 4 * quadCount;
      }
    }

    // 大車輪 [チンイツ七対子] / 小車輪 [ホンイツ七対子]
    if (isQidui && result.hupai.some((h: any) => h.name === '清一色')) {
      result.hupai.push({ name: '大車輪 [役満]', fanshu: '*' });
      result.damanguan = (result.damanguan ?? 0) + 1;
      result.fanshu = undefined;
    } else if (isQidui && result.hupai.some((h: any) => h.name === '混一色')) {
      // 小車輪 [混一色七対子]: ボーナス +1 翻 [混一色 + 七対子 が成立した時の追加 1 翻]
      // [リョー指示 2026-05-15: 混一色 3翻 + 七対子 2翻 = 5翻 → 小車輪成立で 6翻、 単独 6翻 ではない]
      result.hupai.push({ name: '小車輪 [+1翻]', fanshu: 1 });
      if (result.fanshu !== undefined) result.fanshu += 1;
    }

    // 混老対 [混老頭 + 七対子]: +6 翻、 対々込みなら +8 翻
    if (isQidui && result.hupai.some((h: any) => h.name === '混老頭')) {
      const hasToitoi = result.hupai.some((h: any) => h.name === '対々和');
      const fanAdd = hasToitoi ? 8 : 6;
      result.hupai.push({ name: hasToitoi ? '混老対+対々 [+8翻]' : '混老対 [+6翻]', fanshu: fanAdd });
      if (result.fanshu !== undefined) result.fanshu += fanAdd;
    }

    // 四喜和 / 国士で抜き北を手牌使用 [ルール 2-4]、 既存字一色と同じパターンで擬似追加 hule
    if (!result.hupai.some((h: any) => ['大四喜', '小四喜', '国士無双'].some(n => h.name?.includes(n)))
        && ((this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0)) > 0) {
      try {
        const spClone = sp.clone();
        spClone._bingpai.z[4] += (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
        const r = Majiang.Util.hule_mianzi(spClone);
        if (r && r.length > 0) {
          // 四喜和判定: z1z2z3z4 全部 暗刻 + 雀頭
          const z1 = spClone._bingpai.z[1] ?? 0;
          const z2 = spClone._bingpai.z[2] ?? 0;
          const z3 = spClone._bingpai.z[3] ?? 0;
          const z4 = spClone._bingpai.z[4] ?? 0;
          const isShouShiSuxi = (z1 >= 3 && z2 >= 3 && z3 >= 3 && z4 >= 2)
            || (z1 >= 2 && z2 >= 3 && z3 >= 3 && z4 >= 3)
            || (z1 >= 3 && z2 >= 2 && z3 >= 3 && z4 >= 3)
            || (z1 >= 3 && z2 >= 3 && z3 >= 2 && z4 >= 3);
          const isDaSuxi = z1 >= 3 && z2 >= 3 && z3 >= 3 && z4 >= 3;
          if (isDaSuxi) {
            result.hupai.push({ name: '大四喜 [北抜き手牌使用、 ダブル役満]', fanshu: '**' });
            result.damanguan = (result.damanguan ?? 0) + 2;
          } else if (isShouShiSuxi) {
            result.hupai.push({ name: '小四喜 [北抜き手牌使用]', fanshu: '*' });
            result.damanguan = (result.damanguan ?? 0) + 1;
          }
          result.fanshu = result.damanguan ? undefined : result.fanshu;
        }
      } catch { /* skip */ }
    }

    // チャンタ [全帯么] 4/2 + 純チャンタ [純全帯么] 6/4 [アンミカ独自翻数]
    const fixYakuFan = (oldName: string, newName: string, menzenFan: number, fuluFan: number) => {
      const idx = result.hupai.findIndex((h: any) => h.name.startsWith(oldName));
      if (idx >= 0) {
        const newFan = isMenzen ? menzenFan : fuluFan;
        const oldFan = result.hupai[idx].fanshu ?? 0;
        result.hupai[idx] = { name: newName, fanshu: newFan };
        if (typeof oldFan === 'number' && result.fanshu !== undefined) result.fanshu += (newFan - oldFan);
      }
    };
    fixYakuFan('全帯么', 'チャンタ', 4, 2);
    fixYakuFan('純全帯么', '純チャンタ', 6, 4);

    // サイコロチャンス記録 [リョー指示: 画面実装は後回し、 記録のみ]
    result.saiKoroChances = result.saiKoroChances ?? [];
    const saiMode: 'tsumo' | 'ron' = isRon ? 'ron' : 'tsumo';
    const addSai = (name: string, baseChip: 70 | 140 | 35 | 100 | 300, shuvariApplicable: boolean, count: number = 1, plusMinus: '+' | '-' = '+') => {
      result.saiKoroChances.push({ name, baseChip, shuvariApplicable, count, plusMinus, mode: saiMode });
    };
    // R9 P1 #3 fix: 三連刻 / 本役満アガリ saiKoro 抽出を 全 post-process の 最後 に移動
    // [元: ここ 1867-1884、 移動先: 関数末尾 「本役満 / 三連刻 サイコロ抽出」]
    // 間八萬ツモ [本役満] = 既に damanguan>=1 で記録済
    // リーのみ [カラス] = 出目当て効果 2 倍 [サイコロチャンス記録 + flag]
    if (result.hupai.some((h: any) => h.name?.startsWith('カラス'))) {
      addSai('カラス [出目当て効果 ×2]', 140, true);
    }
    // 八連荘 [親アガリ 8 本場+] = 140 chip サイコロ
    if (result.hupai.some((h: any) => h.name?.startsWith('八連荘'))) {
      addSai('八連荘', 140, true);
    }
    // 白ぽっち即ツモの祝儀 0 枚サイコロは applyHule で chip 集計後に判定する。
    // オールスター: 赤 5p + 赤 5s + 金 5p + 金 5s 揃い [bingpai[s][0] には金分も含まれる、
    // 純粋な赤は bingpai[s][0] - goldHand[s] で算出]
    // R9 P1 #1 fix: ロン時 ronpai が p0 / s0 [赤] や gp / gs [金] の場合 _bp 経由で 含む。
    // ロン牌の金 / 赤 判定は discardLog[fromPlayer].at(-1) の gold / pochi で判別
    const goldP = this.goldHand[player].p ?? 0;
    const goldS = this.goldHand[player].s ?? 0;
    // ロン牌が金 5p / 金 5s なら golds 加算 [自家 goldHand には入らない、 ロン時の祝儀 source]
    let ronGoldP = 0, ronGoldS = 0;
    if (isRon && fromPlayer !== null) {
      const lastDiscard = this.discardLog[fromPlayer]?.at(-1);
      if (lastDiscard?.gold && lastDiscard.pai === 'p0') ronGoldP = 1;
      else if (lastDiscard?.gold && lastDiscard.pai === 's0') ronGoldS = 1;
    }
    const hasRed5p = ((_bp.p[0] ?? 0) - goldP - ronGoldP) >= 1;
    const hasRed5s = ((_bp.s[0] ?? 0) - goldS - ronGoldS) >= 1;
    const hasGold5p = (goldP + ronGoldP) >= 1;
    const hasGold5s = (goldS + ronGoldS) >= 1;
    if (hasRed5p && hasRed5s && hasGold5p && hasGold5s) {
      addSai('オールスター', 70, true);
      result.hupai.push({ name: 'オールスター [赤金 4 枚揃い]', fanshu: 0 });
    }

    // 北の役満特殊化 [ルール 2-4]: 字一色 / 四喜和 / 国士無双 のみ抜き北を手牌使用可
    // 既存 result が字一色/四喜和/国士でない + 北抜きあり なら、 z4 を擬似追加して役満形成可か再判定
    // 2026-05-14 codex review fix: 金北 [nukidoraGold] も 抜き北として 字一色 / 四喜和 等の素材に加える
    const yakumanByBeiNames = ['字一色', '小四喜', '大四喜', '国士無双'];
    const hasYakumanByBei = result.hupai.some((h: any) => yakumanByBeiNames.some(n => h.name?.includes(n)));
    const totalNukibei = (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
    if (!hasYakumanByBei && totalNukibei > 0) {
      try {
        const spClone = sp.clone();
        spClone._bingpai.z[4] += totalNukibei;
        const r = Majiang.Util.hule_mianzi(spClone);
        if (r && r.length > 0) {
          // 字一色 check: 全字牌
          const allZi = (() => {
            for (const s of ['m', 'p', 's']) {
              for (let n = 0; n <= 9; n++) if ((spClone._bingpai[s][n] ?? 0) > 0) return false;
            }
            return true;
          })();
          if (allZi) {
            result.hupai.push({ name: '字一色 [北抜き手牌使用]', fanshu: '*' });
            result.fanshu = undefined;
            result.damanguan = (result.damanguan ?? 0) + 1;
          }
        }
      } catch { /* skip */ }
    }

    // 大四喜 / 四槓子 ダブル役満化
    // R10 P0 #3 fix: 既存 single 役満 [damanguan=1] を double に昇格、 差分 +1 加算 [+2 だと 3 になる]
    for (const yk of ['大四喜', '四槓子']) {
      if (result.hupai.some((h: any) => h.name === yk)) {
        result.hupai = result.hupai.map((h: any) =>
          h.name === yk ? { name: `${yk} [ダブル役満]`, fanshu: '**' } : h
        );
        result.damanguan = (result.damanguan ?? 0) + 1;
      }
    }

    // 国士無双 13 面: agariPai を除いた残り 13 枚で 国士 13 種が 1 枚ずつ → ダブル役満
    // [hupai name は anmikaTry7mYakuman 経由で「国士無双 [7m=1m アンミカ]」 もあるので includes で判定]
    if (result.hupai.some((h: any) => typeof h.name === 'string' && h.name.includes('国士無双'))) {
      const isThirteen = (() => {
        if (!agariPai) return false;
        // アンミカ独自: m7 を m1 にマージ [m1 がなければ m7 で代用扱い]
        const counts: Record<string, number> = {};
        counts['m1'] = (sp._bingpai.m?.[1] ?? 0) + (sp._bingpai.m?.[7] ?? 0);
        counts['m9'] = sp._bingpai.m?.[9] ?? 0;
        for (const s of ['p', 's'] as const) {
          counts[`${s}1`] = sp._bingpai[s]?.[1] ?? 0;
          counts[`${s}9`] = sp._bingpai[s]?.[9] ?? 0;
        }
        for (let n = 1; n <= 7; n++) counts[`z${n}`] = sp._bingpai.z?.[n] ?? 0;
        // R9 P1 #4 fix: ロン時 sp._bingpai は pre-ron 13 枚で agariPai を含まない、
        // counts -= 1 すると 13 面判定が ほぼ常に false。 ツモのみ -1、 ロンは 13 枚 そのまま
        const normalizedAgari = agariPai === 'm7' ? 'm1' : agariPai;
        if (!isRon && counts[normalizedAgari] !== undefined && counts[normalizedAgari] > 0) {
          counts[normalizedAgari] -= 1;
        }
        const yao13 = ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];
        // 13面: agariPai を -1 した後、 全 13 種 が 1 枚ずつ揃ってる [= pre-zimo で全種 1 枚 = 13 種から任意で待てる]
        // 単騎: agariPai を -1 すると 0 になる種があり、 別の種が 2 枚 [= pre-zimo で 12 種 + 1 種ペア]
        return yao13.every(y => (counts[y] ?? 0) === 1);
      })();
      // フリテン check [note 仕様 2026-05-12]: 自家河に 13 ヤオ牌のいずれかが含まれてたら
      // ダブル役満として認定しない、 単役満扱い [name は通常 「国士無双」 のまま]
      const yao13 = ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];
      const ownHe = this.he.get(player);
      const ownDiscardSet = new Set<string>();
      if (ownHe?._pai) {
        for (const dp of ownHe._pai as string[]) {
          const stripped = dp.replace(/[\+=\-_*]/g, '');
          // 7m はアンミカで 1m 換算なので set には m1 として追加
          const normalized = stripped === 'm7' ? 'm1' : stripped.startsWith('z5') ? 'z5' : stripped;
          ownDiscardSet.add(normalized);
        }
      }
      const isFuriten = yao13.some((y) => ownDiscardSet.has(y));
      if (isThirteen && !isFuriten) {
        result.hupai = result.hupai.map((h: any) =>
          typeof h.name === 'string' && h.name.includes('国士無双')
            ? { name: '国士無双 [13面 ダブル役満]', fanshu: '**' } : h
        );
        // R10 P0 #3 fix: 国士 single [damanguan=1] を double に昇格、 差分 +1
        result.damanguan = (result.damanguan ?? 0) + 1;
        result.fanshu = undefined;
      }
    }

    // 純正九蓮: 九蓮宝燈 + ツモ → ダブル役満
    if (!isRon && result.hupai.some((h: any) => h.name === '九蓮宝燈')) {
      result.hupai = result.hupai.map((h: any) =>
        h.name === '九蓮宝燈' ? { name: '純正九蓮宝燈 [ダブル役満]', fanshu: '**' } : h
      );
      // R10 P0 #3 fix: 九蓮 single → double 差分 +1
      result.damanguan = (result.damanguan ?? 0) + 1;
    }

    // 天和 / 地和 [diyizimo + ツモ] = ダブル役満
    // 2026-05-14 codex review fix: 現親判定で 子アガリ後局の天和/地和 ダブル昇格を正しく
    if (this.diyizimo && !isRon) {
      const isOya = player === this.currentOya;
      const tianHuName = isOya ? '天和' : '地和';
      if (result.hupai.some((h: any) => h.name === tianHuName)) {
        result.hupai = result.hupai.map((h: any) =>
          h.name === tianHuName ? { name: `${tianHuName} [ダブル役満]`, fanshu: '**' } : h
        );
        // R10 P0 #3 fix: 天和 / 地和 single → double 差分 +1
        result.damanguan = (result.damanguan ?? 0) + 1;
      }
    }

    // 人和 [子配牌 + 第一ツモ前ロン] = ダブル役満
    // 2026-05-14 codex review fix: 現親判定で 子アガリ後の人和 判定が正しく
    if (this.diyizimo && isRon && player !== this.currentOya) {
      result.hupai.push({ name: '人和 [ダブル役満]', fanshu: '**' });
      result.damanguan = (result.damanguan ?? 0) + 2;
      result.fanshu = undefined;
    }

    // 三連刻 [同種 連番 3 つの刻子]: 全 player の bingpai check で n,n+1,n+2 の刻子
    // R9 P1 #1 fix: _bp [ロン牌込み] で 判定、 ロン牌で 3 つ目の 刻子完成 取りこぼし防止
    for (const s of ['m', 'p', 's']) {
      for (let n = 1; n <= 7; n++) {
        const tripletAt = (k: number) => {
          if (((_bp as any)[s]?.[k] ?? 0) >= 3) return true;
          return sp._fulou.some((m: string) => m.match(new RegExp(`^${s}${k}{3}`)));
        };
        if (tripletAt(n) && tripletAt(n + 1) && tripletAt(n + 2)) {
          result.hupai.push({ name: `三連刻 [${s}${n}-${n + 2}]`, fanshu: 4 });
          if (result.fanshu !== undefined) result.fanshu += 4;
          break;
        }
      }
    }

    // 四連刻 [同種 連番 4 つの刻子] = ダブル役満
    // R9 P1 #1 fix: _bp で 判定
    for (const s of ['m', 'p', 's']) {
      for (let n = 1; n <= 6; n++) {
        const tripletAt = (k: number) => {
          if (((_bp as any)[s]?.[k] ?? 0) >= 3) return true;
          return sp._fulou.some((m: string) => m.match(new RegExp(`^${s}${k}{3}`)));
        };
        if (tripletAt(n) && tripletAt(n + 1) && tripletAt(n + 2) && tripletAt(n + 3)) {
          result.hupai.push({ name: `四連刻 [ダブル役満]`, fanshu: '**' });
          result.damanguan = (result.damanguan ?? 0) + 2;
          result.fanshu = undefined;
          break;
        }
      }
    }

    // 裸単騎
    if (sp._fulou && sp._fulou.length === 4) {
      result.hupai.push({ name: '裸単騎 [役満]', fanshu: '*' });
      result.damanguan = (result.damanguan ?? 0) + 1;
      result.fanshu = undefined;
    }

    // 三色同刻 [アンミカ独自 4 翻、 鳴き下がりナシ、 note 仕様 2026-05-12]
    // majiang-core は 面前 2 翻 / 鳴き 1 翻 [kuisagari]、 両方とも 4 翻に上書き
    const sankokuShoku = result.hupai.find((h: any) => h.name === '三色同刻');
    if (sankokuShoku) {
      const prevFan = sankokuShoku.fanshu;
      sankokuShoku.fanshu = 4;
      sankokuShoku.name = '三色同刻 [アンミカ 4翻]';
      if (result.fanshu !== undefined && typeof prevFan === 'number') result.fanshu += (4 - prevFan);
    }

    // 萬子混一色 [本役満、 m7/m9 + 字牌 のみ、 mrfujii note 仕様 2026-05-12]
    // majiang-core が混一色 [萬子 suite] を判定済 + 副露 / 手牌に p/s 牌 ナシ なら 役満化
    const honitsu = result.hupai.find((h: any) => h.name === '混一色');
    if (honitsu) {
      // R9 P1 #1 fix: _bp [ロン牌込み] で判定、 ロン牌が p/s なら混一色不成立 [_bp 経由で正確]
      const hasP = (_bp.p ?? []).some((c: number) => (c ?? 0) > 0);
      const hasS = (_bp.s ?? []).some((c: number) => (c ?? 0) > 0);
      const hasManzi = (_bp.m?.[7] ?? 0) > 0 || (_bp.m?.[9] ?? 0) > 0;
      // 副露牌の suite も確認
      let fulouHasPS = false;
      let fulouHasM = false;
      for (const m of sp._fulou ?? []) {
        const s0 = (m as string)[0];
        if (s0 === 'p' || s0 === 's') fulouHasPS = true;
        if (s0 === 'm') fulouHasM = true;
      }
      if (!hasP && !hasS && !fulouHasPS && (hasManzi || fulouHasM)) {
        result.hupai.push({ name: '萬子混一色 [本役満]', fanshu: '*' });
        result.damanguan = (result.damanguan ?? 0) + 1;
        result.fanshu = undefined;
      }
    }

    // 8 華: 春夏秋冬 8 枚抜き [全て] アガリ → 100 オール
    // [リョー指示 2026-05-11: 自分抜き分のみ、 ドラ表示由来は対象外]
    // 副露時 chip 半減 [鳴き四華 35 / 鳴き八華 70 / 八華四北 副露時は仕様未明、 通常 300 据置]
    const huaCount = (this as any)._huapaiOwnLengthAtHule?.[player] ?? this.huapai[player].length;
    const nukiTotal = (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
    const hasFulou = (sp._fulou?.length ?? 0) > 0;
    // 四華 [春夏秋冬 各 1 枚以上] 条件 [リョー指示 2026-05-12: 自分抜き分で 4 種完備]
    const huaList = this.huapai[player] ?? [];
    const hasHaru = huaList.includes('f1');
    const hasNatsu = huaList.includes('f2');
    const hasAki = huaList.includes('f3');
    const hasFuyu = huaList.includes('f4');
    const hasAll4Hua = hasHaru && hasNatsu && hasAki && hasFuyu;
    if (huaCount >= 8) {
      this.applyChipOall(player, 100, { bypassShuvari: true, bypassPochi: true, bypassFever: true });
      result.hupai.push({ name: '八華 [+100オール]', fanshu: 0 });
      // サイコロチャンス: 八華 = 出目当て 2 回 [副露時 base 35 / 面前 70]
      addSai('八華', hasFulou ? 35 : 70, true, 2);
    } else if (hasAll4Hua && nukiTotal >= 4) {
      this.applyChipOall(player, 100, { bypassShuvari: true, bypassPochi: true, bypassFever: true });
      result.hupai.push({ name: '四華四北 [+100オール]', fanshu: 0 });
      // サイコロチャンス: 四華四北 = 出目当て 2 回、 シュバ非適用
      addSai('四華四北', 70, false, 2);
    } else if (hasAll4Hua) {
      // 四華 [単独] サイコロチャンス [副露時 35 / 面前 70]
      addSai('四華', hasFulou ? 35 : 70, true);
    }
    if (huaCount >= 8 && nukiTotal >= 4) {
      this.applyChipOall(player, 200, { bypassShuvari: true, bypassPochi: true, bypassFever: true });
      result.hupai.push({ name: '八華四北 [+300オール]', fanshu: 0 });
      // サイコロチャンス: 八華四北 = 出目当て 3 回、 シュバ非適用
      addSai('八華四北', 70, false, 3);
    } else if (nukiTotal >= 4 && !hasAll4Hua) {
      // [2026-05-21 リョー指示] 四北 単独 サイコロチャンス [八華四北 / 四華四北 と排他]
      // base 70 シュバ適用 出目当て 1 回
      addSai('四北', 70, true);
    }

    // 白暗カンアガリ サイコロチャンス [面前 / 副露問わず、 z5 暗槓を含むアガリ]
    // majiang-core の暗槓は方向 suffix なし。大明槓は通常 suffix 付きだが、保存済み局面や
    // 呼出元の正規化で suffix が落ちても _anmikaFulou に open-call metadata が残るので除外する。
    const openZ5Kans = new Set(
      ((sp as any)._anmikaFulou ?? [])
        .filter((f: any) => typeof f?.mianzi === 'string' && /^z5[050]{3}[\+=\-]?$/.test(f.mianzi))
        .map((f: any) => String(f.mianzi).replace(/[\+=\-_*]/g, '')),
    );
    const hasZ5Ankan = (sp._fulou ?? []).some((m: string) => {
      const raw = String(m);
      if (!/^z5[050]{3}$/.test(raw)) return false;
      return !openZ5Kans.has(raw);
    });
    if (hasZ5Ankan) {
      addSai('白暗カンアガリ', 70, true);
    }
    // R9 P1 #3 fix: 全 post-process 完了後に 「本役満 / 三連刻 / 三色同刻」 のサイコロ抽出を実行、
    // 旧 code は 三連刻 / 四連刻 / 萬子混一色 検出 前 に走らせてて これら役の本役満 saiKoro 発火しなかった
    // R10 P0 #4 fix: 三連刻 / 三色同刻 は post-process で suffix 付き [例: '三連刻 [m1-3]'、
    // '三色同刻 [アンミカ 4翻]'] に改名されるため、 完全一致では 拾えない。 includes で判定
    if (isMenzen) {
      if (result.hupai.some((h: any) => typeof h.name === 'string' && h.name.startsWith('三連刻'))) addSai('三連刻', 70, true);
      if (result.hupai.some((h: any) => typeof h.name === 'string' && h.name.startsWith('三色同刻'))) addSai('三色同刻', 70, true);
    }
    const hasYakumanMarker = (result.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**');
    if ((result.damanguan ?? 0) >= 1 || hasYakumanMarker) {
      const dmg = result.damanguan ?? (hasYakumanMarker ? 1 : 0);
      const count = Math.max(1, dmg);
      addSai('本役満アガリ', 70, false, count);
    }
  }

  /** ドラ表示牌から 「次の牌」 を決定し、 sp の手牌中 該当牌の数を返す
   *  金牌 [gp/gs/gN] / 白 [z5*] は normalize してから次の牌を計算 */
  countDoraFromIndicator(sp: any, indicator: string): number {
    if (!sp || !indicator) return 0;
    // 金 / 白 特殊 key を 通常牌 key に正規化 [normalizePai と同等]
    let ind = indicator;
    if (ind === 'gp') ind = 'p5';
    else if (ind === 'gs') ind = 's5';
    else if (ind === 'gN') ind = 'z4';
    else if (ind.length > 2 && ind[0] === 'z' && ind[1] === '5') ind = 'z5';
    const s = ind[0];
    const n = ind[1] === '0' ? 5 : parseInt(ind[1]);
    if (!Number.isFinite(n)) return 0;
    if (s !== 'm' && s !== 'p' && s !== 's' && s !== 'z') return 0; // f* 等の華牌 indicator は ドラ計算外
    let nextN: number;
    if (s === 'z') {
      // 字牌の循環: 1-4 [東南西北] / 5-7 [白發中]
      if (n <= 4) nextN = (n % 4) + 1;
      else nextN = ((n - 4) % 3) + 5;
    } else {
      nextN = (n % 9) + 1;
    }
    return sp._bingpai[s][nextN] ?? 0;
  }

  /** 三麻の点数移動を適用。 result は majiang-core の hule 戻り値、 winner はアガリ家、 loser は放銃家 [ロン時]。
   *  3 麻独自計算: base 点 = fu * 2^(fanshu+2) [上限 mangan 2000、 役満 8000+]、
   *  親ロン = base*6、 子ロン = base*4、 親ツモ = 子 each base*2 [×2人]、
   *  子ツモ = 親 base*2 + 他子 base*1。 100 の位切り上げ。 */
  applyHule(result: any, winner: PlayerId, loser: PlayerId | null): void {
    if (!result) return;
    // R4 P2 #21 fix: snapshot 漏れ path でも トビ賞 判定が走るよう、 applyHule 冒頭で
    // 常に beforeDefen を snapshot。 preHuleSnapshot?.defen の fallback では「現在 defen」 を
    // 参照してしまい preDefen[p] >= 0 が成立しない bug を解消
    const beforeDefen = { ...this.state.defen };
    // 逆ぽっち payment mode: 通常通り計算した後、 winner / 他家 の defen delta を × -1 で反転
    // [リョー指示 2026-05-11、 リーチ供託のみ常に winner 受取で反転対象外、 親子 / 本場 等の swap-side-effect を排除]
    const isPochiReverse = this.pochiPaymentMode[winner];
    // 2026-05-14 codex review fix: 現親判定で 子アガリ後の親計算 / 親払い 正しく
    const isOya = winner === this.currentOya;
    const oyaSeat = this.currentOya;
    // フィーバー tier 倍率 [tier 2 = ×2、 tier 3 = ×4]、 リョー指示 2026-05-12: 最終打点に乗る
    const feverMul = this.feverActive[winner]
      ? (this.feverTier[winner] === 3 ? 4 : this.feverTier[winner] === 2 ? 2 : 1)
      : 1;
    const baseRaw = computeSanmaBase(result);
    const base = baseRaw * feverMul;
    const ceil100 = (n: number) => Math.ceil(n / 100) * 100;
    let winnerGain = 0;
    if (loser !== null) {
      // ロン
      const ronPay = isOya ? ceil100(base * 6) : ceil100(base * 4);
      const benbangBonus = this.state.benbang * 2000;
      const total = ronPay + benbangBonus;
      this.state.defen[winner] += total;
      this.state.defen[loser] -= total;
      winnerGain = total;
    } else {
      // ツモ
      const benbangEach = this.state.benbang * 1000;
      const tsumoBonus = 1000;
      if (isOya) {
        const koPay = ceil100(base * 2) + benbangEach + tsumoBonus;
        for (const p of [0, 1, 2] as PlayerId[]) {
          if (p === winner) continue;
          this.state.defen[p] -= koPay;
          winnerGain += koPay;
        }
      } else {
        const oyaPay = ceil100(base * 2) + benbangEach + tsumoBonus;
        const koPay = ceil100(base * 1) + benbangEach + tsumoBonus;
        for (const p of [0, 1, 2] as PlayerId[]) {
          if (p === winner) continue;
          if (p === oyaSeat) {
            this.state.defen[p] -= oyaPay;
            winnerGain += oyaPay;
          } else {
            this.state.defen[p] -= koPay;
            winnerGain += koPay;
          }
        }
      }
      this.state.defen[winner] += winnerGain;
    }
    // 逆ぽっち: 上で動いた defen delta を × -1 で反転 [リーチ供託は次の step で別途加算なので影響外]
    if (isPochiReverse) {
      if (loser !== null) {
        // ron: winner += total, loser -= total を反転
        this.state.defen[winner] -= 2 * winnerGain;
        this.state.defen[loser] += 2 * winnerGain;
      } else {
        // tsumo: winner += winnerGain と 各 non-winner -= payment を全 反転
        this.state.defen[winner] -= 2 * winnerGain;
        if (isOya) {
          const koPay = ceil100(base * 2) + this.state.benbang * 1000 + 1000;
          for (const p of [0, 1, 2] as PlayerId[]) {
            if (p === winner) continue;
            this.state.defen[p] += 2 * koPay;
          }
        } else {
          const oyaPay = ceil100(base * 2) + this.state.benbang * 1000 + 1000;
          const koPay = ceil100(base * 1) + this.state.benbang * 1000 + 1000;
          for (const p of [0, 1, 2] as PlayerId[]) {
            if (p === winner) continue;
            this.state.defen[p] += 2 * (p === oyaSeat ? oyaPay : koPay);
          }
        }
      }
      winnerGain = -winnerGain; // result.defen / defen3 に書き戻す用
    }
    // リーチ供託は winner [origWinner] に [反転対象外、 常時受取]
    this.state.defen[winner] += this.state.lizhibang * 1000;
    this.state.lizhibang = 0;
    // 加槓 window 終了
    this.qianggangPending = false;
    // アガリ時祝儀計算 [winner にチップ集計、 他家から徴収]
    // R12 P0 #7 fix: chipBefore は preHuleSnapshot 由来にする。 旧 code は this.chipLedger[winner]
    // をそのまま読んでて、 post-process [八華 / 四華四北 / 八華四北] が applyChipOall で先に
    // chipLedger を mutate 済の case で result.chipTotal から先行祝儀分が抜ける bug。
    // result.chipTotal を post-process 分込みで整合させる
    // R13 P1 #6 fix: chipBefore は この hule 専用 snapshot [post-process 前] を優先、
    // fallback で preHuleSnapshot. dabuon 2 人目 で 1 人目 applyChipOall の影響を除外
    const chipBefore = (result as any)._chipLedgerBeforeThis?.[winner]
      ?? this.preHuleSnapshot?.chipLedger?.[winner]
      ?? this.chipLedger[winner];
    // R10 P0 #9 fix: post-process [8華 / 四華四北 etc] が applyChipOall で chipBreakdown に
    // entry 追加済の case あり、 reset で消える bug 解消。 pre-reset 分を保持して prepend
    // R13 P1 #6 fix: ダブロン chipBreakdown 混入対策。 _postProcessChipStart からの slice で
    // この hule の post-process 分のみ取り、 過去 hule の entry を含めない
    const postStart = (result as any)._postProcessChipStart ?? 0;
    const _preBreakdown = this.chipBreakdown.slice(postStart);
    this.chipBreakdown = []; // アガリ毎 reset [トビ賞 entry も含めて build]
    // トビ賞 [飛んだ瞬間 trigger、 半荘 1 回限定]: 自家以外で defen<0 になった player いれば、
    // マイナスにさせた player [= winner] が +5 base chip [シュバ・ダブフィ・トリフィ・ぽっち全倍率]
    // トビ賞 [リョー指示 2026-05-12]: 「≥0 → <0」 への遷移時のみ trigger
    // 1 局で複数人飛ぶケース [2 トビ] / 逆ぽっち正ぽっちで 同一人 2 回飛ぶケース 両方 OK
    // hule 前 [applyHule 前] の defen を preHuleSnapshot から取り出して比較
    // R4 P2 #21 fix: snapshot 漏れ path でも beforeDefen を信用、 preHuleSnapshot は副次
    const afterDefen = { ...this.state.defen };
    const delta = {
      0: afterDefen[0] - beforeDefen[0],
      1: afterDefen[1] - beforeDefen[1],
      2: afterDefen[2] - beforeDefen[2],
    } as Record<PlayerId, number>;
    const preDefen = beforeDefen;
    for (const p of [0, 1, 2] as PlayerId[]) {
      if (preDefen[p] >= 0 && this.state.defen[p] < 0) {
        for (const recipient of [0, 1, 2] as PlayerId[]) {
          if (recipient === p) continue;
          if (delta[recipient] > 0) {
            this.applyChipFromLoser(recipient, p, 5, { label: `トビ賞 [p${p} 飛び]`, mode: loser === null ? 'tsumo' : 'ron' });
          }
        }
      }
    }
    this.applyChipsOnHule(result, winner, loser, beforeDefen);
    // R10 P0 #9: pre-reset 分 [post-process applyChipOall] を prepend して 完全な breakdown に
    result.chipBreakdown = [..._preBreakdown, ...this.chipBreakdown];
    result.chipTotal = this.chipLedger[winner] - chipBefore;
    const chipDelta = this.chipLedger[winner] - chipBefore;
    // 白ぽっち即ツモ + 祝儀 0 枚 → サイコロ。
    // yifaActive が残っている時だけを「即ツモ」とし、後巡の白ぽっちツモは対象外。
    // [2026-05-21 fix] commit 4d1f476f で z5b/z5r/z5g/z5y を 独立 牌化したため、
    // _zimo / lastZimoInfo.pai は z5b 等 raw 文字列で入る。 toCorePai で z5 正規化して比較。
    const sp_w = this.shoupai.get(winner);
    const zimoIsZ5 = sp_w?._zimo ? toCorePai(sp_w._zimo) === 'z5' : false;
    const lastZimoIsZ5 = this.lastZimoInfo.pai
      ? toCorePai(this.lastZimoInfo.pai as string) === 'z5'
      : false;
    const isImmediatePochiTsumo =
      loser === null
      && zimoIsZ5
      && this.yifaActive[winner]
      && this.lastZimoInfo.player === winner
      && lastZimoIsZ5
      && !!this.lastZimoInfo.pochi;
    if (isImmediatePochiTsumo && chipDelta === 0) {
      result.saiKoroChances = result.saiKoroChances ?? [];
      result.saiKoroChances.push({ name: '白ぽっち即ツモ祝儀 0 枚', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'tsumo' });
    }
    // 3 麻実点を defen / defen3 両方に書き戻し [古い majiang-core の 4 麻 defen を上書き]
    // winnerGain は 逆ぽっち反転時に既に -値 になってる
    result.defen3 = winnerGain;
    result.defen = winnerGain;
    if (isPochiReverse) {
      result._pochiPaymentApplied = true;
    }
    // hule event 記録 [トントンブー 判定等で使用]
    // 牌譜 top-level state は nextRound 後の値になり得るため、和了評価時点の局状態も残す。
    this.events.push({
      type: 'hule',
      player: winner,
      isRon: loser !== null,
      isOya,
      changbang: this.state.changbang,
      jushu: this.state.jushu,
      benbang: this.state.benbang,
      qijia: this.state.qijia,
      zhuangfeng: this.changfengZ - 1,
      menfeng: this.zifengZ(winner) - 1,
      hupai: (result.hupai ?? []).map((h: any) => ({ name: h.name, fanshu: h.fanshu })),
      defenBefore: beforeDefen,
      defenAfter: afterDefen,
      delta,
    } as any);
  }

  /** アガリ時の祝儀 [チップ] 集計 [赤金 / 抜きドラ / 春春 / 冬 / 冬冬 / 役満等]
   *  「N オール」 [+2N winner / -N each] 形式で applyChipOall を使う */
  /** 冬 chip [アリス / チューリップ / 上下段]
   *  山末尾上段 1 枚ずつ pop、 winner 現物 [bingpai + 抜きドラ z4 + 抜き華] と一致したら chip
   *  - アリス [冬1枚]: 通常牌は現物のみ、 0 hit で終了
   *  - チューリップ [冬2枚]: + 隣接 ±1 [m7↔m9 循環、 m8=z5 代用]、 0 hit or 山尽きまで
   *  - 冬冬金北: 上下段 ペア、 上下計 0 hit で終了
   *  - 華 [f1-f4]: winner.huapai.length 分 hit
   *  - 副露時: chip 半減 [+1 / hit、 通常 +2 / hit] */
  applyFuyuChip(winner: PlayerId, loser: PlayerId | null, fuyuCount: number, hasKinpei: boolean): void {
    applyFuyuChipHelper(this._huleChipCtx(), winner, loser, fuyuCount, hasKinpei);
  }

  applyChipsOnHule(result: any, winner: PlayerId, loser: PlayerId | null, beforeDefen?: Record<PlayerId, number>): void {
    const ctx = this._huleChipCtx();
    if (beforeDefen) ctx.beforeDefen = beforeDefen;
    ctx.ronpai = (result as any)._ronpaiForChip ?? null;
    applyChipsOnHuleHelper(ctx, result, winner, loser);
  }

  /** 最多牌 [手牌の bingpai で枚数最大の pai key、 例 'm9'、 同点なら数牌優先] */
  /** 神ぽっち target 候補: 手牌中の 最多枚数 tile を返す
   *  opts.player を渡せば nukidora [北抜き済] も z4 として count に加算
   *  opts.includeHua=true なら huapai [抜き華] も候補 [冬めくり時]
   */
  mostCommonPaiInHand(sp: any, opts: { player?: PlayerId; includeHua?: boolean } = {}): string | null {
    const counts: Record<string, number> = {};
    // 赤 / 金 5 は _bingpai[p/s][5] 側に含まれるので 5 として count。
    // 副露内の 0 も 5 に正規化して、神ぽっち target の最多牌判定に含める。
    for (const s of ['m', 'p', 's'] as const) {
      for (let n = 1; n <= 9; n++) {
        const c = sp._bingpai[s]?.[n] ?? 0;
        if (c > 0) counts[`${s}${n}`] = c;
      }
    }
    for (let n = 1; n <= 7; n++) {
      const c = sp._bingpai.z?.[n] ?? 0;
      if (c > 0) counts[`z${n}`] = c;
    }
    if (opts.player !== undefined) {
      const nuki = this.nukidora[opts.player] ?? 0;
      const nukiG = this.nukidoraGold[opts.player] ?? 0;
      if (nuki + nukiG > 0) counts['z4'] = (counts['z4'] ?? 0) + nuki + nukiG;
      if (opts.includeHua) {
        for (const hp of this.huapai[opts.player] ?? []) {
          counts[hp] = (counts[hp] ?? 0) + 1;
        }
      }
    }
    for (const m of sp._fulou ?? []) {
      const stripped = String(m).replace(/[\+=\-_*]/g, '');
      const suit = stripped[0];
      if (suit !== 'm' && suit !== 'p' && suit !== 's' && suit !== 'z') continue;
      for (let i = 1; i < stripped.length; i++) {
        const raw = stripped[i];
        const n = raw === '0' ? 5 : parseInt(raw, 10);
        if (!Number.isFinite(n) || !isValidAnmikaTile(suit, n)) continue;
        const key = `${suit}${n}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    let best: { pai: string; n: number } | null = null;
    for (const [pai, n] of Object.entries(counts)) {
      if (!best || n > best.n) best = { pai, n };
    }
    return best?.pai ?? null;
  }

  /** ドラ表示牌 → ドラ牌 [helper に委譲] */
  doraIndicatorOf(pai: string): string {
    return doraIndicatorOfHelper(pai);
  }

  /** baopai / fubaopai の z5 の色判定は牌 key [z5b/z5r/z5g/z5y] 自体で済む、
   *  別途 _pochiColor 配列は不要 */

  /** 間八萬判定: 山に m8 が存在しない [アンミカ三麻仕様] ため、 アガリ牌 z5 から ぽっち swap で m8 化したケースのみ
   *  - 副露なし [面前]
   *  - 手牌に m7 / m9 が各 1 枚以上
   *  - アガリ牌 [ロン or ツモ] が z5 [= 白ぽっち / 神ぽっち で m8 を選択した推定]
   *  実際の swap 結果まで判定するには hule 側で m8 swap 確定を flag 立てる必要があるが、
   *  簡略実装として「m7+m9 持ち + z5 アガリ」 を間八萬条件とする */
  /** 間八萬厳密判定:
   *  1. 副露なし [面前]
   *  2. アガリ牌が z5 [白ぽ swap で m8 として アガる仕様、 山に m8 自体ナシ]
   *  3. 手牌に m7 と m9 が各 1 枚以上
   *  4. 「m8 として swap」 で m789 順子を含むアガリ形になる
   *  → これで「カン 8m 嵌張待ち」 が m7m8m9 順子で成立 = 間八萬確定
   *  ロジック: sp clone で z5 → m8 swap → hule_mianzi で全分解候補取得 → m7m8m9 順子含む解があるか check */
  isKanpaman(player: PlayerId, agariPai: string | null): boolean {
    return isKanpamanHelper(this.shoupai.get(player), agariPai);
  }

  /** アガリ止め可能か: 親アガリ + オーラス [最終場の最終 jushu]
   *  2026-05-14 codex review fix: 現親判定で 子アガリ後の親アガリ止め 正しく */
  canAgariyame(winner: PlayerId): boolean {
    if (winner !== this.currentOya) return false;
    if (this.state.changbang !== this.changshu - 1) return false;
    if (this.state.jushu !== 2) return false;
    return true;
  }

  /** アガリ止め: 半荘を終了 [state.finished=true] */
  agariyame(): void {
    this.state.finished = true;
    this.events.push({ type: 'pingju', reason: 'アガリ止め [親判断]' });
  }

  /** 次局へ進む。 親アガリなら連荘 [本場 +1]、 子アガリなら親流れ [jushu++ + 親移動]、
   *  流局 [winner null/undefined] は親維持 + 本場+1 [リョー指示 2026-05-15: 子アガリ
   *  以外で 親は流れない、 ノーテン流局でも親継続] */
  nextRound(opts: { winner?: PlayerId | null; renchan?: boolean; preShuffledPool?: Pai[] } = {}): void {
    const { winner, renchan } = opts;
    // 旧 bug: winner === null [流局] でも winner !== undefined は true で「子アガリ」
    // path に入って 親流れしてた。 winner != null [== null で undefined / null 両方除外]
    if (winner != null) {
      // 現在の親 = (qijia + jushu) mod 3 [リョー指示 2026-05-12 fix: 旧 qijia 直比較は誤り]
      const currentOya = (((this.state.qijia - this.state.jushu) % 3 + 3) % 3) as PlayerId;
      const wasOya = winner === currentOya;
      if (wasOya || renchan) {
        this.state.benbang += 1;
      } else {
        this.state.jushu += 1;
        this.state.benbang = 0;
        if (this.state.jushu >= 3) {
          this.state.jushu = 0;
          this.state.changbang += 1;
        }
      }
    } else {
      // 流局 [winner null/undefined]: 親維持 + 本場+1
      this.state.benbang += 1;
    }
    // 返り東: changshu 完了 + 全員 40000 未達 → changbang を巻き戻して東 1 から再スタート
    if (this.state.changbang > this.changshu - 1) {
      const top = Math.max(...[0, 1, 2].map((p) => this.state.defen[p as PlayerId]));
      if (top < 40000) {
        this.state.changbang = 0;
        this.state.jushu = 0;
        // 返り東 message を残しておく [game.events に]
        this.events.push({ type: 'pingju', reason: '返り東 [全員 40000 未達]' });
      }
    }
    // 山と手牌をリセット [オンライン時は host が preShuffledPool 共有、 desync 防止 2026-05-13]
    this.shan = new Shan3(this.shanRule, opts.preShuffledPool);
    this.shoupai.clear();
    this.he.clear();
    this.lizhi.clear();
    this.openLizhi.clear();
    this.state.lunban = 0;
    this.nukidora = { 0: 0, 1: 0, 2: 0 };
    this.nukidoraGold = { 0: 0, 1: 0, 2: 0 };
    this.yifaActive = { 0: false, 1: false, 2: false };
    this.lizhiDeclareDapai = { 0: false, 1: false, 2: false };
    this.lingshangActive = { 0: false, 1: false, 2: false };
    this.qianggangPending = false;
    this.snapshotLocked = false;
    this.diyizimo = true;
    this.goldHand = {
      0: { p: 0, s: 0, z: 0 },
      1: { p: 0, s: 0, z: 0 },
      2: { p: 0, s: 0, z: 0 },
    };
    this.huapai = { 0: [], 1: [], 2: [] };
    this.feverActive = { 0: false, 1: false, 2: false };
    this.feverTier = { 0: 1, 1: 1, 2: 1 };
    this.feverWinCount = { 0: 0, 1: 0, 2: 0 };
    this.shuvariActive = { 0: false, 1: false, 2: false };
    // shuvariUsed は半荘累積、 reset しない
    this.pochiHand = {
      0: { blue: 0, red: 0, green: 0, yellow: 0 },
      1: { blue: 0, red: 0, green: 0, yellow: 0 },
      2: { blue: 0, red: 0, green: 0, yellow: 0 },
    };
    this.discardLog = { 0: [], 1: [], 2: [] };
    // ぽっち効果は kyoku 単位。 fever 継続中も nextRound [局終了] で neutral に戻す。
    this.pochiMultiplier = {
      0: { ...NEUTRAL_POCHI_MULTIPLIER },
      1: { ...NEUTRAL_POCHI_MULTIPLIER },
      2: { ...NEUTRAL_POCHI_MULTIPLIER },
    };
    this.pochiPaymentMode = { 0: false, 1: false, 2: false };
    this.pochiChipReverse = { 0: false, 1: false, 2: false };
    this.pochiChipDouble = { 0: false, 1: false, 2: false };
    this.haruActive = { 0: false, 1: false, 2: false };
    this.fuyuSkip = { 0: false, 1: false, 2: false };
    this.fuyuConsumed = { 0: false, 1: false, 2: false };
    this.kinpeiTarget = { 0: null, 1: null, 2: null };
    this.akiUsedCount = { 0: 0, 1: 0, 2: 0 };
    // chipLedger は半荘累積、 reset しない
  }

  /** 大明槓候補 [他家の打牌に対し、 player が同種 3 枚持ちなら可]
   *  2026-05-14 codex review fix: 抜き直後ポン抑制 [ルール 2-4] + フィーバー副露禁止 を
   *  Game3 API 単体でも保証。 旧版は store 側 filter のみだったが、 API 直叩きで保護漏れ */
  getDamingangCandidates(player: PlayerId, from: PlayerId, pai: Pai): string[] {
    const sp = this.shoupai.get(player);
    if (!sp) return [];
    if (this.lizhi.has(player)) return [];
    // 抜き直後の他家ポン/カン不可 [ルール 2-4]
    if (this.justNukidBei[from]) return [];
    // フィーバー中は非フィーバー player の副露禁止
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) return [];
    // 反時計 2026-05-13 fix
    const diff = (from - player + 3) % 3;
    let dir: string;
    if (diff === 1) dir = '+';      // from は player の上家 [反時計の 1 つ前]
    else if (diff === 2) dir = '-';  // from は player の下家
    else return [];
    try {
      return sp.get_gang_mianzi(pai + dir) ?? [];
    } catch {
      return [];
    }
  }

  /** 大明槓実行 [player が mianzi で fulou、 嶺上ツモ、 ドラ表追加、 lunban を player に]
   *  fulou の decrease 仕様 [方向前の数字のみ] により _bingpai 事前加算は不要
   *  R3 P0 #4 fix: 嶺上ツモ失敗時に sp.fulou / he.fulou / state.lunban / shan を全 rollback */
  declareDamingang(player: PlayerId, mianzi: string, fromPlayer: PlayerId): Pai | null {
    const sp = this.shoupai.get(player);
    if (!sp) return null;
    // snapshot for rollback
    const _origLunban = this.state.lunban;
    const _origBingpai = { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] };
    const _origFulou = [...sp._fulou];
    const _origZimo = sp._zimo;
    const fromHe = this.he.get(fromPlayer);
    const _origFromHePai = fromHe ? [...(fromHe._pai ?? [])] : null;
    // R22 #3 fix: shan 全 state snapshot [rinshanUsed / lastDrawnHuapai / lastZimoGold/Pochi 含む]
    const _shanSnap = (this.shan as any).snapshot?.bind(this.shan)?.() ?? null;
    const shanReadAny = this.shan as any;
    const _shanPai = [...shanReadAny._pai];
    const _shanBaopai = [...(shanReadAny._baopai ?? [])];
    const _shanFubaopai = shanReadAny._fubaopai ? [...shanReadAny._fubaopai] : null;
    const _shanWeikaigang = shanReadAny._weikaigang;
    try {
      sp.fulou(mianzi);
    } catch {
      return null;
    }
    const takenPai = this.discardLog[fromPlayer]?.[this.discardLog[fromPlayer].length - 1]?.pai ?? toCorePai(mianzi.slice(0, 2));
    sp._anmikaFulou = sp._anmikaFulou ?? [];
    sp._anmikaFulou.push({ mianzi, from: fromPlayer, taken: takenPai });
    // 河の最後の牌に副露マーカーを付ける [大明槓も同じく He.fulou に mianzi を渡す]
    if (fromHe && typeof fromHe.fulou === 'function') {
      try { fromHe.fulou(mianzi); } catch { /* ignore */ }
    }
    // [2026-05-15 bug 3 注] 大明槓も同様に pochiHand decrement しない [v33 inventory invariant 維持]
    // lunban を player に [反時計 2026-05-13]
    this.state.lunban = (((this.currentOya - player) % 3 + 3) % 3) as Lunban;
    let replacement: Pai | null = null;
    let rawReplacement: any = null;
    try {
      rawReplacement = this.shan.gangzimo();
      replacement = rawReplacement as Pai;
      const coreReplacement = toCorePai(replacement);
      sp.zimo(replacement);
      this.shan.kaigang();
      // R8 P1 #8 fix: 嶺上で gold / pochi / 華牌 を 通常 zimo と同じく反映
      if (this.shan.lastZimoGold) {
        if (replacement === 'gp') this.goldHand[player].p += 1;
        else if (replacement === 'gs') this.goldHand[player].s += 1;
        else if (replacement === 'gN') this.goldHand[player].z += 1;
      }
      const pochiColor = pochiColorFromPai(rawReplacement);
      if (pochiColor && coreReplacement === 'z5') {
        this.pochiHand[player][pochiColor] += 1;
      }
      // R10 P0 #5 #6 fix: 大明槓 嶺上 でも ぽっち効果 + lastZimoInfo 反映
      this.applyRinshanZimoEffects(player, replacement, rawReplacement);
      if (this.shan.lastDrawnHuapai.length > 0) {
        for (const hp of this.shan.lastDrawnHuapai) {
          this.huapai[player].push(hp);  // R10 P0 #7: 重複保持 [枚数が意味あり、 春春 / 夏夏 / 八華 等]
        }
      }
    } catch {
      replacement = null;
      // R3 P0 #4: 全 rollback
      sp._bingpai.m = _origBingpai.m; sp._bingpai.p = _origBingpai.p;
      sp._bingpai.s = _origBingpai.s; sp._bingpai.z = _origBingpai.z;
      sp._fulou = _origFulou; sp._zimo = _origZimo;
      this.state.lunban = _origLunban;
      if (fromHe && _origFromHePai) fromHe._pai = _origFromHePai;
      // shan 全 restore [pai / baopai / fubaopai / weikaigang + R22 #3 で rinshanUsed/huapai/gold/pochi も]
      // 注: _pai / _baopai / _fubaopai は majiang-core 内部 field [private]、 cast 必須
      const shanAny = this.shan as any;
      // R22 #3 fix: Shan3.restore で rinshanUsed / lastDrawnHuapai / lastZimoGold / lastZimoPochi 含む完全 rollback、
      // 旧 code は _pai/_baopai/_fubaopai/_weikaigang のみで rinshanUsed 等 残ってた
      if (_shanSnap && typeof shanAny.restore === 'function') {
        shanAny.restore(_shanSnap);
      } else {
        shanAny._pai = _shanPai;
        if (shanAny._baopai) shanAny._baopai.length = 0;
        shanAny._baopai?.push(..._shanBaopai);
        if (_shanFubaopai && shanAny._fubaopai) {
          shanAny._fubaopai.length = 0;
          shanAny._fubaopai.push(..._shanFubaopai);
        }
        shanAny._weikaigang = _shanWeikaigang;
      }
    }
    // R9 P2 #12 fix: replacement null [カン失敗 / rollback] では yifa / events 更新しない、
    // 旧 code は失敗でも 一発消滅 / event 記録残ってた bug 解消
    if (replacement !== null) {
      this.yifaActive = { 0: false, 1: false, 2: false };
      this.lingshangActive[player] = true;
      this.events.push({ type: 'gang', player, mianzi });
      // [2026-05-15 fix bug B] 大明槓 [鳴き派生] でも シュバ倍率 強制 解除。
      // 副露 と 同様 ゾロ目連続 シュバ宣言 と両立しない。
      this.shuvariActive[player] = false;
    }
    this.diyizimo = false;
    return replacement;
  }

  /** 暗槓 / 加槓 候補 [現家ツモ後のみ]。 majiang-core の get_gang_mianzi 流用
   *  フィーバー中の非フィーバー player はカンも禁止 [手牌操作不可]
   *
   *  アンミカ独自 filter [P0-6 対策、 2026-05-12]:
   *    helpers.ts:35-36 で gp/gs → p0/s0 normalize されてるため、
   *    プレイヤーが 金 5 + 赤 5 両方持つと bingpai[0]==2 状態になり、
   *    majiang-core の get_gang_mianzi は ankan candidate を `p5500` 形式で出す。
   *    これを ankan すると 4 物理タイル消費 + 嶺上で normalize後の p0 を再 inc し
   *    `bingpai inventory が 5 枚 p0 相当」 の矛盾を起こす。
   *    現行仕様: majiang-core の `s5500` / `p5500` は赤/金を含む正しい暗槓表記なので許可する。
   *    declareKan 側の snapshot rollback と inventory test で破綻を検出する。 */
  getKanCandidates(player: PlayerId): string[] {
    const sp = this.shoupai.get(player);
    if (!sp) return [];
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) return [];
    // [2026-05-15 bug 9 fix] 嶺上 [_rinshan] 残量 check:
    // 嶺上が 1 枚も無ければ カン後の 嶺上ツモ 不可、 候補 0 件で UI に出さない。
    // 旧 code は declareKan → shan.gangzimo throw → rollback で 「カン候補は表示されたのに 失敗」
    // という UX 不整合 [華 抜きすぎで 嶺上枯渇] を起こしていた。
    // リョー仕様: 嶺上 16 - 華枚数 ≥ 1 [= rinshan.length >= 1] なら カン OK。
    const rinshanLen = (this.shan as any)._rinshan?.length ?? 0;
    if (rinshanLen < 1) return [];
    try {
      return sp.get_gang_mianzi() ?? [];
    } catch {
      return [];
    }
  }

  /** 暗槓 / 加槓 実行 [嶺上ツモ + ドラ表追加]。 mianzi は get_gang_mianzi 戻り値の 1 要素
   *  R3 P0 #4 fix: 嶺上ツモ失敗時に sp.gang / shan を全 rollback */
  declareKan(player: PlayerId, mianzi: string): Pai | null {
    const sp = this.shoupai.get(player);
    if (!sp) return null;
    dlog('[declareKan]', { player, mianzi, baopaiBefore: [...this.shan.baopai] });
    // [2026-05-15 bug 6 fix] リーチ後 ankan: 待ち変動 禁止。
    //   ankan 前後で tingpai が 一致しない場合 reject [テンパイ崩れ防止]。
    //   加槓 [\d{3}[+=-]\d$] は元々 リーチ中 不可なので 影響なし。 ankan のみ check。
    const isAnkanReq = !!mianzi.match(/^[mpsz]\d{4}$/);
    if (isAnkanReq && this.lizhi.has(player)) {
      try {
        const tingBefore = new Set((Majiang.Util.tingpai(sp) ?? []) as string[]);
        const sp_after = sp.clone();
        try { sp_after.gang(mianzi); } catch { return null; }
        // ankan 後は 13 枚 + 嶺上ツモ 不要時点の tingpai を取る [_zimo は ankan で消費済]
        const tingAfter = new Set((Majiang.Util.tingpai(sp_after) ?? []) as string[]);
        if (tingBefore.size !== tingAfter.size) {
          dlog('[declareKan] reject: lizhi 中 ankan で 待ち変動', { player, mianzi, tingBefore: [...tingBefore], tingAfter: [...tingAfter] });
          return null;
        }
        for (const t of tingBefore) {
          if (!tingAfter.has(t)) {
            dlog('[declareKan] reject: lizhi 中 ankan で 待ち変動', { player, mianzi, tingBefore: [...tingBefore], tingAfter: [...tingAfter] });
            return null;
          }
        }
      } catch { /* 判定失敗時は安全側で reject せず 続行 [既存挙動互換] */ }
    }
    // snapshot for rollback
    const _origBingpai = { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] };
    const _origFulou = [...sp._fulou];
    const _origZimo = sp._zimo;
    // R24 P1 #3 fix: declareKan [暗槓/加槓] も declareDamingang と同じく Shan3.snapshot/restore で
    // rinshanUsed / lastDrawnHuapai / lastZimoGold / lastZimoPochi 含む完全 rollback 化、
    // 旧 code は _pai/_baopai/_fubaopai/_weikaigang のみ個別復元で rinshanUsed 等 残ってた
    const _shanSnap = (this.shan as any).snapshot?.bind(this.shan)?.() ?? null;
    const shanReadAny = this.shan as any;
    const _shanPai = [...shanReadAny._pai];
    const _shanBaopai = [...(shanReadAny._baopai ?? [])];
    const _shanFubaopai = shanReadAny._fubaopai ? [...shanReadAny._fubaopai] : null;
    const _shanWeikaigang = shanReadAny._weikaigang;
    try {
      sp.gang(mianzi);
    } catch {
      return null;
    }
    // 嶺上ツモ
    let replacement: Pai | null = null;
    let rawReplacement: any = null;
    try {
      rawReplacement = this.shan.gangzimo();
      replacement = rawReplacement as Pai;
      const coreReplacement = toCorePai(replacement);
      sp.zimo(replacement);
      // カン後即ドラ表開示 [カンドラあり前提]
      this.shan.kaigang();
      // R8 P1 #8 fix: 嶺上で gold / pochi / 華牌 を 反映 [大明槓と同様]
      if (this.shan.lastZimoGold) {
        if (replacement === 'gp') this.goldHand[player].p += 1;
        else if (replacement === 'gs') this.goldHand[player].s += 1;
        else if (replacement === 'gN') this.goldHand[player].z += 1;
      }
      const pochiColor = pochiColorFromPai(rawReplacement);
      if (pochiColor && coreReplacement === 'z5') {
        this.pochiHand[player][pochiColor] += 1;
      }
      // R10 P0 #5 #6 fix: 暗槓 / 加槓 嶺上 でも ぽっち効果 + lastZimoInfo 反映
      this.applyRinshanZimoEffects(player, replacement, rawReplacement);
      if (this.shan.lastDrawnHuapai.length > 0) {
        for (const hp of this.shan.lastDrawnHuapai) {
          this.huapai[player].push(hp);  // R10 P0 #7: 重複保持 [枚数が意味あり、 春春 / 夏夏 / 八華 等]
        }
      }
      dlog('[declareKan after kaigang]', { player, baopaiAfter: [...this.shan.baopai], fubaopaiAfter: [...(this.shan.fubaopai ?? [])] });
      // P0-6b 検出: replacement が 既に fulou で 4 枚消費済の牌なら state corruption
      const fulouCount = countTileInFulou(sp, replacement);
      if (fulouCount >= 4) {
        // eslint-disable-next-line no-console
        console.log('!!!P0-6b declareKan rinshan 矛盾', { player, mianzi, replacement, fulouCount, fulou: [...sp._fulou], shanPaishu: this.shan.paishu });
      }
      // P0-6 検出: 暗槓 [\d{4}$] 直後 _zimo が ankan と同種だと 5 枚目存在 = state corruption
      // [V32 fuzz で発見、 2026-05-12 yuma 調査中、 root cause 未特定]
      const isAnkan = !!mianzi.match(/^[mpsz]\d{4}$/);
      if (isAnkan && replacement && replacement[0] === mianzi[0]) {
        const ankanN = mianzi[1]; // 第 1 字目の数字 [s8888 なら '8']
        const repN = replacement[1] === '0' ? '5' : replacement[1];
        if (ankanN === repN || (ankanN === '5' && replacement[1] === '0')) {
          // eslint-disable-next-line no-console
          console.log('!!!P0-6 corruption detect ankan+同種_zimo', { player, mianzi, replacement, shanPaishu: this.shan.paishu, shanRestFront: [...(this.shan as any)._pai].slice(0, 6), bingpaiPostAnkan: { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] } });
        }
      }
    } catch {
      replacement = null;
      // R3 P0 #4: 全 rollback
      sp._bingpai.m = _origBingpai.m; sp._bingpai.p = _origBingpai.p;
      sp._bingpai.s = _origBingpai.s; sp._bingpai.z = _origBingpai.z;
      sp._fulou = _origFulou; sp._zimo = _origZimo;
      const shanRestoreAny = this.shan as any;
      // R24 P1 #3 fix: Shan3.restore で完全 rollback、 失敗時 fallback で個別 field 復元
      if (_shanSnap && typeof shanRestoreAny.restore === 'function') {
        shanRestoreAny.restore(_shanSnap);
      } else {
        shanRestoreAny._pai = _shanPai;
        if (shanRestoreAny._baopai) { shanRestoreAny._baopai.length = 0; shanRestoreAny._baopai.push(..._shanBaopai); }
        if (_shanFubaopai && shanRestoreAny._fubaopai) {
          shanRestoreAny._fubaopai.length = 0;
          shanRestoreAny._fubaopai.push(..._shanFubaopai);
        }
        shanRestoreAny._weikaigang = _shanWeikaigang;
      }
    }
    // R9 P2 #12 fix: カン失敗 [replacement null] では yifa / lingshang / events / qianggang 更新しない
    if (replacement !== null) {
      // 副露介入で他家の一発消失
      for (const p of [0, 1, 2] as PlayerId[]) {
        if (p !== player) this.yifaActive[p] = false;
      }
      this.lingshangActive[player] = true;
      // 加槓判定: format が 'XXX+/=/-X' なら加槓、 他家ロン受け window
      if (mianzi.match(/\d{3}[\+\=\-]\d$/)) {
        // 槍槓 window は store 側が嶺上前に管理する。嶺上ツモ後まで true を残すと
        // 牌譜復元時に「まだ槍槓待ち」と誤認するので、ここでは立てない。
        this.qianggangPending = false;
      }
      this.events.push({ type: 'gang', player, mianzi });
    }
    this.diyizimo = false;
    return replacement;
  }

  /** 場風 [changbang から、 0=東 1=南 2=西] を z 牌の番号として返す [1-3] */
  get changfengZ(): number { return Math.min(this.state.changbang + 1, 3); }

  /** 現親 [子アガリで jushu 進むごとに 反時計回り回転、 起家 = qijia は局共通固定]
   *  2026-05-14 codex review fix: 親判定が state.qijia 固定で 子アガリ後の現親見ない
   *  問題を解消、 全 callsite [八連荘 / 天和地和 / 親計算 / 自風 / canAgariyame 等] で参照 */
  get currentOya(): PlayerId {
    return (((this.state.qijia - this.state.jushu) % 3 + 3) % 3) as PlayerId;
  }

  /** player の自風 [現親からの相対位置] を z 牌番号で返す [1=東, 2=南, 3=西]
   *  2026-05-14 codex review fix: state.qijia 固定だと 子アガリ後の自風がズレる、 currentOya 参照に変更 */
  zifengZ(player: PlayerId): number {
    const relative = (player - this.currentOya + 3) % 3;
    return relative + 1;
  }

  /** リーチ宣言牌候補 [打牌後も聴牌維持できる打牌一覧] */
  getLizhiCandidates(player: PlayerId): string[] {
    const sp = this.shoupai.get(player);
    if (!sp) return [];
    if (Math.min(Majiang.Util.xiangting(sp), americanChitoiXiangting(sp)) > 0) return [];
    let candidates: string[];
    try {
      candidates = sp.get_dapai(false);
    } catch {
      return [];
    }
    if (!candidates) return [];
    return candidates.filter((c: string) => {
      const sp_clone = sp.clone();
      try {
        sp_clone.dapai(c);
      } catch {
        return false;
      }
      return Math.min(Majiang.Util.xiangting(sp_clone), americanChitoiXiangting(sp_clone)) === 0;
    });
  }

  /** フィーバーリーチ可能か + 種別 [single/double/triple]
   *  ルール 5-4: 7s + 7p 両方 = ダブル、 7s + 7p + 7m 全 = トリプル */
  canFeverLizhi(player: PlayerId): { ok: boolean; tiles: string[]; tier: 1 | 2 | 3 } {
    return canFeverLizhiHelper(this.shoupai.get(player));
  }

  /** [2026-05-15 bug 8] 打牌候補ごとに fever 可否を返す。
   *  Map<dapai_pai, FeverCheck>、 fever 可な candidate のみ含む。
   *  store gate 側で 「fever 可な dapai のみ fever 宣言可能」 に使う。 */
  feverCandidatesByDapai(player: PlayerId): Map<string, { ok: boolean; tiles: string[]; tier: 1 | 2 | 3 }> {
    return feverCandidatesByDapaiHelper(this.shoupai.get(player));
  }

  /** フィーバーリーチ中フラグ [_player ごと]、 declareLizhi で feverActive 立てる */
  feverActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** フィーバー declare 時の wait snapshot [リョー指示 2026-05-12: tsumo で動かないように] */
  feverDeclareTing: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };

  /** フィーバー tier [1=single / 2=double / 3=triple]、 打点 / 祝儀倍率: 1x / 2x / 4x */
  feverTier: Record<PlayerId, 1 | 2 | 3> = { 0: 1, 1: 1, 2: 1 };

  /** フィーバー宣言 dapai marker [P0-1 2026-05-11]
   *  declareLizhi(opts.fever) で player を set、 宣言牌の他家ロンで undo 判定に使う、
   *  宣言牌が ron されず次 zimo を迎えたら clear */
  feverDeclareDapaiPlayer: PlayerId | null = null;

  /** フィーバー成立後、 待ち牌が山に残ってるか check
   *  全 0 なら 1 人テンパイ流局 [ルール 5-2 step 4] */
  isFeverWaitExhausted(player: PlayerId): boolean {
    return isFeverWaitExhaustedHelper(
      this.getTingpaiList(player),
      this.shoupai as any,
      this.he as any,
      [...(this.shan.baopai ?? [])]
    );
  }

  /** シュバリーチ: 東風 1 回につき 1 度宣言可、 当局のみ祝儀 2 倍 */
  shuvariActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** シュバリーチ使用済 [半荘内 1 回限定] */
  shuvariUsed: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** [削除予定 / 2026-05-14 codex review fix] tobiChipPaid: 旧 「半荘内 1 回限定」 仕様は
   *  リョー再修正 [フィーバー逆ぽで 1 局中 複数飛び発生し得る] により 削除。 都度 apply で OK
   *  field 自体は 古い参照保護で 残置、 値は 未使用 */
  tobiChipPaid: boolean = false;

  /** リーチ可能か [ツモ後・聴牌・点棒 1000 以上・副露ナシ。 ただし暗槓は門前扱いで OK] */
  canLizhi(player: PlayerId): boolean {
    if (this.lizhi.has(player)) return false;
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    // ルール 1.1 リーチ 0 点持ち可 [トビ扱い、 流局や他家アガリで負け]、 0 以上で OK
    if (this.state.defen[player] < 0) return false;
    // 副露 check: 暗槓 [\d{4} form、 方向 mark 無し] のみなら門前扱いで OK
    if (sp._fulou && sp._fulou.length > 0) {
      const hasNonAnkan = sp._fulou.some((m: string) => !m.match(/^[mpsz]\d{4}$/));
      if (hasNonAnkan) return false;
    }
    if (!sp._zimo) return false;
    if (Math.min(Majiang.Util.xiangting(sp), americanChitoiXiangting(sp)) <= 0) return true;
    // アメリカン七対子 [m7→m1 swap] でテンパイ成立する場合も リーチ可 [2026-05-15]
    //   既存 canRon / canTsumo の m7→m1 substitution と整合、 swap 後の 13 枚で xiangting==0 なら OK
    //   副露ありは 既に上で reject 済 [暗槓は門前扱い、 暗槓のみなら m1 swap も legal]
    const m7Count = sp._bingpai.m?.[7] ?? 0;
    if (m7Count > 0) {
      try {
        const spClone = sp.clone();
        spClone._bingpai.m[1] = (spClone._bingpai.m[1] ?? 0) + m7Count;
        spClone._bingpai.m[7] = 0;
        if (Majiang.Util.xiangting(spClone) <= 0) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  /** オープン立直中のプレイヤー [+2000 供託、 +1 翻、 待ち開示] */
  openLizhi: Set<PlayerId> = new Set();

  /** リーチ宣言 [現家のみ、 canLizhi 全条件 check]
   *  shuvari: シュバリーチオプション [半荘 1 回まで、 当局祝儀 2 倍]
   *  open: オープン立直 [+1000 供託 = 計 2000、 アガリ時 +1 翻、 待ち開示] */
  declareLizhi(opts: { shuvari?: boolean; open?: boolean; fever?: boolean; feverCheck?: FeverCheck; feverDapai?: Pai } = {}): boolean {
    const player = this.lunbanToPlayerId(this.state.lunban);
    if (!this.canLizhi(player)) return false;
    // オープン三軒目 block [リョー指示 2026-05-11、 仕様: 既 2 人 openLizhi なら 3 人目は不可]
    if (opts.open && this.openLizhi.size >= 2) return false;
    const feverCheck = opts.feverCheck ?? this.canFeverLizhi(player);
    // R3 P1 #13 fix: opts.fever 明示時は事前に canFeverLizhi check、 NG なら全 reject。
    // R24 fix: 打牌後だけ fever 条件を満たす conditional case は store から feverCheck を渡して許可。
    if (opts.fever && !feverCheck.ok) {
      dlog('[lizhi] fever 宣言 reject [feverCheck false]', { player });
      return false;
    }
    // R3 P2 #16 fix: opts.open は 2000 点 コスト、 残点 2000 点未満なら reject
    if (opts.open && this.state.defen[player] < 2000) return false;
    const cost = opts.open ? 2000 : 1000;
    this.state.defen[player] -= cost;
    this.state.lizhibang += opts.open ? 2 : 1;
    this.lizhi.add(player);
    if (opts.open) this.openLizhi.add(player);
    this.yifaActive[player] = true;
    this.lizhiDeclareDapai[player] = true;
    // フィーバー: opts.fever 明示時のみ active [事前 canFeverLizhi check 済]
    if (opts.fever) {
      this.feverActive[player] = true;
      this.feverTier[player] = feverCheck.tier;
      this.feverDeclareDapaiPlayer = player; // P0-1: 宣言牌 ron 時 undo 用 marker
      let declareTing = this.getTingpaiList(player);
      if (opts.feverDapai) {
        try {
          const spAfter = this.shoupai.get(player)?.clone();
          spAfter?.dapai(opts.feverDapai);
          declareTing = getTingpaiListHelper(spAfter);
        } catch { /* fallback to current ting */ }
      }
      this.feverDeclareTing[player] = [...declareTing];
    }
    if (opts.shuvari && !this.shuvariUsed[player]) {
      this.shuvariActive[player] = true;
      this.shuvariUsed[player] = true;
    }
    this.events.push({ type: 'lizhi', player, open: !!opts.open, fever: !!opts.fever, shuvari: !!opts.shuvari });
    return true;
  }
}

// applyRankUp は fanshuLevel + LEVEL_TO_FANSHU で代替済 [削除]
function _legacyApplyRankUp(_fanshu: number, _levels: number): number { return _fanshu; }
void _legacyApplyRankUp;
