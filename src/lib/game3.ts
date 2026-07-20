
// 三麻の game loop 最小実装
// majiang-core の Shoupai / xiangting / hule を使い、 山とプレイヤー数だけ自前で 3 人化する

// @ts-ignore - majiang-core は型定義なし、 後で d.ts 用意
import Majiang from '@kobalab/majiang-core';

import type { GameEvent, GameState, Lunban, Pai, PlayerId } from './types';
import { Shan3, defaultSanmaRule, type ShanRule } from './shan3';

// 共通 helper は helpers.ts に分離 [code clean-up 2026-05-10]
import { DEBUG_LOG, dlog, normalizePai, toCorePai, isGoldPai, isNijiPai, buildShoupai, normalizeBaopaiForMajiang, pochiColorFromPai, addAnmikaPai, patchAnmikaShoupai, countGoldInHand, countPochiInHand, countNijiInHand, isPositiveZ5, isNegativeZ5, fanshuLevel, LEVEL_TO_FANSHU, isValidAnmikaTile } from './helpers';

/** 門前判定: 副露なし or 暗槓のみ [/^[mpsz]\d{4}$/] を門前扱い */
function isMenzenHand(sp: any): boolean {
  return !sp._fulou || sp._fulou.length === 0
    || sp._fulou.every((m: string) => /^[mpsz]\d{4}$/.test(m));
}

/** 他家リーチ中、自分がこのシャンテン以上ならベタオリへ切り替える
 *  [0 = テンパイ、1 = 1 シャンテンまでは押す] */
const PICK_FOLD_XIANGTING = 2;

/** Shared riichi shanten, including this ruleset's m7-as-m1 fallback. */
function lizhiXiangting(sp: any): number {
  if (!sp) return 99;
  let best = Math.min(Majiang.Util.xiangting(sp), americanChitoiXiangting(sp));
  const m7Count = Number(sp._bingpai?.m?.[7] ?? 0);
  if (m7Count > 0) {
    try {
      const swapped = sp.clone();
      swapped._bingpai.m[1] = Number(swapped._bingpai.m[1] ?? 0) + m7Count;
      swapped._bingpai.m[7] = 0;
      best = Math.min(best, Majiang.Util.xiangting(swapped));
    } catch { /* keep the ordinary/american result */ }
  }
  return best;
}

/** Public/river tile kind under the physical Anmika catalog. */
function anmikaTileKind(pai: string): string {
  const stripped = String(pai).replace(/[\+\=\-_*]/g, '');
  const core = toCorePai(stripped);
  if (core.length < 2) return '';
  const kind = `${core[0]}${core[1] === '0' ? '5' : core[1]}`;
  // v1/v2 paifu may still contain the old m1 spelling.
  return kind === 'm1' ? 'm7' : kind;
}

/** 明副露(非暗槓)の数 */
function openMeldCount(sp: any): number {
  return (sp._fulou ?? []).filter((m: string) => !/^[mpsz]\d{4}$/.test(m)).length;
}

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

type AmericanChitoiFallbackYaku = {
  numeric: Array<{ name: string; fanshu: number }>;
  yakuman: Array<{ name: string; fanshu: '*' }>;
};

/**
 * majiang-core rejects a seven-pairs shape that uses one physical four-of-a-kind
 * as two pairs.  When that happens it also cannot report the ordinary yaku that
 * depend only on the tile multiset.  Reconstruct those yaku from the same 14
 * tiles so the American-seven-pairs fallback is scored like every other hand.
 */
function americanChitoiFallbackYaku(
  sp: any,
  ronpai: string | null,
): AmericanChitoiFallbackYaku {
  const counts: Record<'m' | 'p' | 's' | 'z', number[]> = {
    m: [...(sp?._bingpai?.m ?? [])],
    p: [...(sp?._bingpai?.p ?? [])],
    s: [...(sp?._bingpai?.s ?? [])],
    z: [...(sp?._bingpai?.z ?? [])],
  };
  if (ronpai) {
    const core = toCorePai(String(ronpai).replace(/[+\-=*_]/g, ''));
    const suit = core[0] as 'm' | 'p' | 's' | 'z';
    const number = core[1] === '0' ? 5 : Number(core[1]);
    if ((suit === 'm' || suit === 'p' || suit === 's' || suit === 'z')
        && Number.isInteger(number)) {
      counts[suit][number] = Number(counts[suit][number] ?? 0) + 1;
    }
  }

  const present: Array<{ suit: 'm' | 'p' | 's' | 'z'; number: number }> = [];
  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const max = suit === 'z' ? 7 : 9;
    for (let number = 1; number <= max; number++) {
      if ((counts[suit][number] ?? 0) > 0) present.push({ suit, number });
    }
  }
  const isTerminal = ({ suit, number }: (typeof present)[number]) => (
    suit !== 'z' && (number === 1 || number === 9 || (suit === 'm' && number === 7))
  );
  const isYaochu = (tile: (typeof present)[number]) => tile.suit === 'z' || isTerminal(tile);
  const numeric: AmericanChitoiFallbackYaku['numeric'] = [];
  const yakuman: AmericanChitoiFallbackYaku['yakuman'] = [];

  if (present.length > 0 && present.every((tile) => tile.suit !== 'z' && !isTerminal(tile))) {
    numeric.push({ name: '断幺九', fanshu: 1 });
  }
  if (present.length > 0 && present.every(isYaochu)) {
    numeric.push({ name: '混老頭', fanshu: 2 });
  }

  const numberedSuits = new Set(
    present.filter((tile) => tile.suit !== 'z').map((tile) => tile.suit),
  );
  const hasHonors = present.some((tile) => tile.suit === 'z');
  if (numberedSuits.size === 1) {
    numeric.push(hasHonors
      ? { name: '混一色', fanshu: 3 }
      : { name: '清一色', fanshu: 6 });
  }

  if (present.length > 0 && present.every((tile) => tile.suit === 'z')) {
    yakuman.push({ name: '字一色', fanshu: '*' });
  } else if (present.length > 0 && !hasHonors && present.every(isTerminal)) {
    yakuman.push({ name: '清老頭', fanshu: '*' });
  }
  const greenTiles = new Set(['s2', 's3', 's4', 's6', 's8', 'z6']);
  if (present.length > 0
      && present.every((tile) => greenTiles.has(`${tile.suit}${tile.number}`))) {
    yakuman.push({ name: '緑一色', fanshu: '*' });
  }
  return { numeric, yakuman };
}

/** Physical red fives only; gold fives share core index 0 and must be removed. */
function countPhysicalRedDora(sp: any, ronpai: string | null): number {
  const expanded = sp?._bingpai?.__anmika ?? {};
  let count = Math.max(0, Number(sp?._bingpai?.p?.[0] ?? 0) - Number(expanded.gp ?? 0))
    + Math.max(0, Number(sp?._bingpai?.s?.[0] ?? 0) - Number(expanded.gs ?? 0));
  if (ronpai) {
    const raw = String(ronpai).replace(/[+\-=*_]/g, '');
    if (raw === 'p0' || raw === 's0') count += 1;
  }
  return count;
}
import { canFeverLizhi as canFeverLizhiHelper, isFeverWaitExhausted as isFeverWaitExhaustedHelper, feverCandidatesByDapai as feverCandidatesByDapaiHelper, rainbowKanUpgradeTier, type FeverCheck } from './game3/feverLizhi';
import { isKanpaman as isKanpamanHelper, doraIndicatorOf as doraIndicatorOfHelper } from './game3/yaku';
import { computeChipMultiplier as computeChipMultiplierHelper, applyChipOall as applyChipOallHelper, applyChipFromLoser as applyChipFromLoserHelper, type ChipState as ChipStateT, type ChipBreakdownEntry } from './game3/chip';
import { getTingpaiList as getTingpaiListHelper, getTingpaiListBeforeZimo as getTingpaiListBeforeZimoHelper, canTsumoWithPochiSwap as canTsumoWithPochiSwapHelper, americanChitoiXiangting, americanChitoiComplete, countAmericanChitoiQuads } from './game3/tingpai';
import { saveSnapshot as saveSnapshotHelper, restoreSnapshot as restoreSnapshotHelper, type PreHuleSnapshot } from './game3/snapshot';
import { applyFuyuChip as applyFuyuChipHelper, applyChipsOnHule as applyChipsOnHuleHelper, type HuleChipCtx, type FuyuAdvanceResult, type FuyuRevealState } from './game3/huleChip';
import { physicalDiscardCandidates, resolvePhysicalDiscardPai, restorePhysicalHandState, snapshotPhysicalHandState } from './game3/tileIdentity';
import { evaluateWinPoints } from './game3/settlement';
import {
  createFirstTurnState,
  hasAnyFirstTurnEligibility,
  isFirstTurnTsumoEligible,
  isRenhouEligible,
  markFirstTurnCall,
  markFirstTurnDiscard,
  markFirstTurnDraw,
  normalizeFirstTurnState,
  type FirstTurnState,
} from './game3/firstTurn';
import { claimTileIdentity } from './game3/claimTile';
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
    const core = toCorePai(stripped);
    if (core.length >= 2) ronpaiBase = core;
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

function resultHasYakuman(result: any): boolean {
  return (result?.damanguan ?? 0) > 0
    || (result?.hupai ?? []).some((h: any) => h?.fanshu === '*' || h?.fanshu === '**');
}

export type KamiPochiContext = 'dora' | 'fuyu';
export type KamiPochiDoraSource = 'baopai' | 'fubaopai';
export type KamiPochiDoraOccurrence = {
  key: string;
  source: KamiPochiDoraSource;
  index: number;
  raw: string;
  target: string | null;
};
export type KamiPochiPendingChoice = {
  winner: PlayerId;
  context: KamiPochiContext;
  occurrenceKey?: string;
  candidates: string[];
  decisionOwners: PlayerId[];
};
export type PochiSwapCandidateSummary = {
  target: string;
  expectedChip: number;
  fanshu: number | null;
  damanguan: number;
};
export type PochiSwapPendingChoice = {
  winner: PlayerId;
  kind: 'white' | 'deka';
  candidates: PochiSwapCandidateSummary[];
  decisionOwners: PlayerId[];
};

function resultHasNamedYaku(result: any, patterns: RegExp[]): boolean {
  return (result?.hupai ?? []).some((h: any) => {
    const name = String(h?.name ?? '');
    return patterns.some((pattern) => pattern.test(name));
  });
}

/** 門前ダマを例外的に認める役。ルールで列挙された4種だけに限定する。 */
function resultAllowsMenzenDama(result: any): boolean {
  return resultHasNamedYaku(result, [/国士/, /天和/, /地和/, /人和/]);
}

/** 北を手牌構成に使える役。抜き北はこの制限の対象外。 */
function resultAllowsBeiMaterial(result: any): boolean {
  return resultHasNamedYaku(result, [/国士/, /字一色/, /大四喜/, /小四喜/, /四喜和/]);
}

function handUsesBeiMaterial(sp: any, ronpai: Pai | null = null): boolean {
  const inHand = (sp?._bingpai?.z?.[4] ?? 0) > 0;
  if (inHand) return true;
  if (!ronpai) return false;
  const stripped = String(ronpai).replace(/[\+\=\-_*]/g, '');
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
  /** 第一巡かつ鳴きのない宣言をダブル立直として保持する。 */
  doubleLizhi: Set<PlayerId> = new Set();
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
      tongaeshi: false,
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

  /** 補充牌の出どころがカンか。北抜き・華抜きの補充は lingshangActive のみ true で
   *  本 flag は false → 海底摸月の抑制だけ効き、嶺上開花は付かない
   *  [2026-07-18 リョー裁定: 北・華抜きの補充ツモに嶺上開花ナシ、カンのみ] */
  lingshangFromKan: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 席別の第一巡状態。天和・地和・人和を他家の打牌から独立して判定する。 */
  firstTurnState: FirstTurnState = createFirstTurnState();

  /** 旧牌譜・テスト互換。新規ロジックは firstTurnState と席別 predicate を使う。 */
  get diyizimo(): boolean { return hasAnyFirstTurnEligibility(this.firstTurnState); }
  set diyizimo(value: boolean) {
    if (value) {
      this.firstTurnState = createFirstTurnState();
      return;
    }
    this.firstTurnState = createFirstTurnState();
    this.firstTurnState.callOccurred = true;
  }

  restoreFirstTurnState(value: unknown): void {
    this.firstTurnState = normalizeFirstTurnState(value);
  }

  isFirstTurnTsumoEligible(player: PlayerId): boolean {
    return isFirstTurnTsumoEligible(this.firstTurnState, player);
  }

  isRenhouEligible(player: PlayerId): boolean {
    return isRenhouEligible(this.firstTurnState, player, this.currentOya);
  }

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
  /** 祝儀期待値同率時に pending UI から指定されたオールマイティ牌。 */
  pochiSwapChoice: Record<PlayerId, string | null> = { 0: null, 1: null, 2: null };

  /** 祝儀 [チップ] ledger、 局中変動 [春発動 / 抜きドラ etc] + アガリ時集計 [赤金 / 役満等]
   *  +N = 受取 / -N = 支払い、 半荘終了でも reset しない [累積] */
  chipLedger: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };

  /** 春発動済 (= 春を 1 枚抜き、 局中変動効果が active) flag */
  haruActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** applyHule 前 snapshot [金北選択変更時の巻き戻し用] */
  preHuleSnapshot: PreHuleSnapshot | null = null;
  /** ダブロン / modal 再計算中に preHuleSnapshot を上書きしないための lock */
  snapshotLocked = false;
  /**
   * hule() が秋で確定させた牌山だけを、同じ result object に非公開で対応付ける。
   * result 自体へ山を埋め込むとオンライン投影で伏せ牌が漏れるため WeakMap に保持する。
   */
  private readonly _huleRevealStateByResult = new WeakMap<object, {
    shan: ReturnType<Shan3['snapshot']>;
    akiUsedCount: Record<PlayerId, number>;
    effectiveHuapai: string[];
  }>();
  private _snapshotRefs() {
    return {
      defen: this.state.defen,
      chipLedger: this.chipLedger,
      akiUsedCount: this.akiUsedCount,
      feverActive: this.feverActive,
      feverSaiAwarded: this.feverSaiAwarded,
      lateShuvariWindow: this.lateShuvariWindow,
      goldHand: this.goldHand,
      pochiHand: this.pochiHand,
      huapai: this.huapai,
      nukidora: this.nukidora,
      nukidoraGold: this.nukidoraGold,
      kinpeiTarget: this.kinpeiTarget,
      kamiPochiDoraChoices: this.kamiPochiDoraChoices,
      shan: this.shan,
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

  /** ロック非依存のローカル snapshot [2026-07-20 リョー報告: 秋のドラ表が漏れる 再発]
   *  saveSnapshot() は snapshotLocked 中に黙ってスキップされるのに restoreSnapshot() は
   *  実行されるので、ダブロン評価中に hule() が失敗すると秋カスケードの物理ドラめくりが
   *  巻き戻らず、ドラ表示牌の 3 枚目 4 枚目が局中に見えてしまう。
   *  投機的に hule() を呼ぶ側はこのペアで自前に巻き戻すこと。 */
  captureSnapshot(): any {
    return saveSnapshotHelper(this._snapshotRefs());
  }
  applySnapshot(snap: any): void {
    if (!snap) return;
    restoreSnapshotHelper(this._snapshotRefs(), snap);
  }

  /**
   * 公式Q&A: ダブロンで片方が秋、片方が冬なら、冬は秋の追加ドラ表示後から開始する。
   *
   * 各ロン候補は同じ和了前 snapshot から個別評価するため、最後に評価した候補が冬側だと
   * 秋で進んだ固定牌山が失われる。hule() 時に WeakMap へ保存した秋側の牌山だけを採用し、
   * 点棒・祝儀・金北選択など他の評価 state は触らない。金北選択はこの処理より前に確定済み。
   */
  prepareDoubleRonAutumnBeforeWinter(
    claims: Array<{ player: number; result: any }>,
    _discarder: PlayerId,
  ): void {
    if (claims.length < 2 || claims.some((claim) => claim.result?._anmikaRonSettlementApplied)) return;

    const hasWinter = claims.some((claim) => {
      const player = claim.player as PlayerId;
      const evaluated = claim.result && typeof claim.result === 'object'
        ? this._huleRevealStateByResult.get(claim.result as object)
        : undefined;
      // Plain Winter is not appended to result.hupai until applyHule(), which
      // runs after this ordering seam.  Detect it from the exact flowers that
      // were effective while this claimant was evaluated instead of relying
      // on a display label that does not exist yet.
      const effectiveHuapai = evaluated?.effectiveHuapai
        ?? this.effectiveHuapaiAtHule(player);
      return effectiveHuapai.includes('f4')
        && (!this.feverActive[player] || this.fuyuConsumed[player]);
    });
    if (!hasWinter) return;

    const autumnStates = claims
      .filter((claim) => Number(claim.result?._akiRevealCount ?? 0) > 0)
      .map((claim) => ({
        player: claim.player as PlayerId,
        state: this._huleRevealStateByResult.get(claim.result as object),
      }))
      .filter((entry): entry is {
        player: PlayerId;
        state: {
          shan: ReturnType<Shan3['snapshot']>;
          akiUsedCount: Record<PlayerId, number>;
          effectiveHuapai: string[];
        };
      } => !!entry.state);
    if (autumnStates.length === 0) return;

    // 三麻のダブロンでは通常1人分だが、両者に秋がある場合も、より深く進んだ状態を採る。
    // 同じ表示枚数なら固定位置から開くため、物理状態は同一になる。
    const selected = autumnStates.reduce((best, entry) => {
      const progress = entry.state.shan.baopai.length + (entry.state.shan.fubaopai?.length ?? 0);
      const bestProgress = best.state.shan.baopai.length + (best.state.shan.fubaopai?.length ?? 0);
      return progress > bestProgress ? entry : best;
    });
    try {
      this.shan.restore(selected.state.shan);
      for (const entry of autumnStates) {
        this.akiUsedCount[entry.player] = Math.max(
          this.akiUsedCount[entry.player] ?? 0,
          entry.state.akiUsedCount[entry.player] ?? 0,
        );
      }
    } catch {
      // 旧牌譜等で対応する in-memory state が不完全でも、通常の和了精算は止めない。
    }
  }

  /** フィーバー中の冬保留 flag [true なら冬発動 skip、 アガリ毎にリセット、 廃止予定] */
  fuyuSkip: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** フィーバー中の冬「使う」 選択 flag [true で冬発動 + フィーバー終了] */
  fuyuConsumed: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** 冬めくりの途中停止/再開 state。正ぽっち物理出現ごとに任意牌選択を待つ。 */
  fuyuRevealState: Record<PlayerId, FuyuRevealState | null> = { 0: null, 1: null, 2: null };

  /** 秋効果使用済枚数 [使い切ると huapai は残るが effect は発動しない] */
  akiUsedCount: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };

  /** 金北強化選択 [局中固定、 1 回選んだら変更不可、 null=未選択 / 保留] */
  kinpeiTarget: Record<PlayerId, 'haru' | 'natsu' | 'aki' | 'fuyu' | null> = { 0: null, 1: null, 2: null };
  /** ドラ表/裏ドラ表に現れた正ぽっちを、物理出現 source:index ごとに任意指定する。 */
  kamiPochiDoraChoices: Record<PlayerId, Record<string, string>> = { 0: {}, 1: {}, 2: {} };

  /** 金北強化を選択 [外部 UI から 1 回のみ呼ぶ、 既に選択済なら無視] */
  setKinpeiChoice(
    player: PlayerId,
    target: 'haru' | 'natsu' | 'aki' | 'fuyu',
    availableHuapai: string[] = this.effectiveHuapaiAtHule(player),
  ): boolean {
    if (this.kinpeiTarget[player] !== null) return false;
    // 金北の強化は 手牌 or 抜き で持ってる時に適用 [リョー指示 2026-05-12]
    if (this.goldHand[player].z === 0 && (this.nukidoraGold[player] ?? 0) === 0) return false;
    // 自分で抜いた華 + 表示中の華 [リーチ和了時は裏も] と一致確認
    const has = availableHuapai.includes(`f${ {haru:1,natsu:2,aki:3,fuyu:4}[target] }`);
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

  /** 和了時に「抜いた扱い」となる華牌。
   *  自分で抜いた華に、表ドラ表示の華と、リーチ和了時だけ裏ドラ表示の華を加える。
   *  秋効果で追加表示された華も shan の表示列に残るため同じ経路で含まれる。 */
  effectiveHuapaiAtHule(player: PlayerId): string[] {
    const hua: string[] = [...(this.huapai[player] ?? [])];
    for (const p of (this.shan?.baopai ?? [])) {
      if (typeof p === 'string' && /^f[1-4]$/.test(p)) hua.push(p);
    }
    if (this.lizhi.has(player)) {
      for (const p of (this.shan?.fubaopai ?? [])) {
        if (typeof p === 'string' && /^f[1-4]$/.test(p)) hua.push(p);
      }
    }
    return hua;
  }

  /** 逆ぽっちでは和了者以外の二家、正ぽっちでは和了者本人が効果を選ぶ。 */
  pochiDecisionOwners(winner: PlayerId): PlayerId[] {
    if (this.pochiPaymentMode[winner]) {
      return ([0, 1, 2] as PlayerId[]).filter((player) => player !== winner);
    }
    return [winner];
  }

  setPochiSwapChoice(player: PlayerId, target: string, candidates: PochiSwapCandidateSummary[]): boolean {
    if (!candidates.some((candidate) => candidate.target === target)) return false;
    this.pochiSwapChoice[player] = target;
    return true;
  }

  clearPochiSwapChoice(player: PlayerId): void {
    this.pochiSwapChoice[player] = null;
  }

  /** 神ぽっちは所有牌に限定せず任意牌を指定する。ドラ27種、冬は華4種も加えた31種。 */
  getKamiPochiCandidates(context: KamiPochiContext = 'dora'): string[] {
    const candidates = ['m7', 'm9'];
    for (const s of ['p', 's'] as const) {
      for (let n = 1; n <= 9; n++) candidates.push(`${s}${n}`);
    }
    for (let n = 1; n <= 7; n++) candidates.push(`z${n}`);
    if (context === 'fuyu') candidates.push('f1', 'f2', 'f3', 'f4');
    return candidates;
  }

  getKamiPochiDoraOccurrences(player: PlayerId): KamiPochiDoraOccurrence[] {
    const occurrences: KamiPochiDoraOccurrence[] = [];
    const append = (source: KamiPochiDoraSource, list: unknown[]): void => {
      list.forEach((raw, index) => {
        if (typeof raw !== 'string' || !isPositiveZ5(raw)) return;
        const key = `${source}:${index}`;
        occurrences.push({ key, source, index, raw, target: this.kamiPochiDoraChoices[player][key] ?? null });
      });
    };
    append('baopai', [...(this.shan.baopai ?? [])]);
    if (this.lizhi.has(player)) append('fubaopai', [...(this.shan.fubaopai ?? [])]);
    return occurrences;
  }

  createKamiPochiPending(
    winner: PlayerId,
    context: KamiPochiContext,
    occurrenceKey?: string,
    decisionOwners: PlayerId[] = this.pochiDecisionOwners(winner),
  ): KamiPochiPendingChoice | null {
    const candidates = this.getKamiPochiCandidates(context);
    return candidates.length > 0
      ? { winner, context, occurrenceKey, candidates, decisionOwners: [...decisionOwners] }
      : null;
  }

  setKamiPochiDoraChoice(player: PlayerId, occurrenceKey: string, target: string): boolean {
    const normalized = toCorePai(target).replace(/0$/, '5');
    const occurrence = this.getKamiPochiDoraOccurrences(player).find((item) => item.key === occurrenceKey);
    if (!occurrence || !this.getKamiPochiCandidates('dora').includes(normalized)) return false;
    this.kamiPochiDoraChoices[player][occurrenceKey] = normalized;
    return true;
  }

  clearKamiPochiDoraChoices(player: PlayerId): void {
    this.kamiPochiDoraChoices[player] = {};
  }

  /** 強制自動: 抜いてる華 [手牌] + ドラ表示牌 / 裏ドラ表示牌 の華 から 冬>秋>夏>春 priority で選ぶ
   *  [リョー指示 2026-05-12: 手牌 0 + 金北抜きの場合 ドラ表示の華で自動強化、 完全 0 ならスキップ] */
  autoResolveKinpei(
    player: PlayerId,
    availableHuapai: string[] = this.effectiveHuapaiAtHule(player),
  ): void {
    if (this.kinpeiTarget[player] !== null) return;
    if (this.goldHand[player].z === 0 && (this.nukidoraGold[player] ?? 0) === 0) return;
    const huaSources = availableHuapai;
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
      shuvariActive: this.shuvariActive,
      fuyuConsumed: this.fuyuConsumed,
      fuyuRevealState: this.fuyuRevealState,
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
    if (sp._zimo.length > 3) return false; // 副露直後の擬似 zimo は除外
    // 海底の北も必ず抜く。嶺上 reserve が既に空、または残りが華だけなら
    // 抜き処理を確定した後に store が共通の流局遷移へ送る。ここで false にすると
    // 河へも切れない北を抱えたまま進行不能になる。
    // リーチ宣言牌の確定前は他 action 不可。成立後に待ち不変の暗槓があればカンを優先する。
    if (this.lizhiDeclareDapai[player]) return false;
    if (this.lizhi.has(player) && this.getForcedLizhiKanCandidates(player).length > 0) return false;
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
    const _origPhysicalHand = snapshotPhysicalHandState(sp);
    // 金北 / 通常 z4 区別 [リョー指示 2026-05-12 + R12 P2 #5 fix 2026-05-14]
    // 旧: goldHand.z>0 なら常に金北優先 → 通常北クリックでも金北が抜かれる bug
    // 新: meta.gold で明示、 meta なしなら 通常北優先 [通常北ナシなら 金北 fallback]
    const goldZ4 = this.goldHand[player].z;
    const totalZ4 = _origZ4;
    const normalZ4 = totalZ4 - goldZ4;
    // 明示した現物が無い場合は別種の北へフォールバックしない。オンライン
    // action の meta を偽装して通常北を金北（または逆）として抜く経路を閉じる。
    if (meta?.gold === true && goldZ4 <= 0) return null;
    if (meta?.gold === false && normalZ4 <= 0) return null;
    sp._bingpai.z[4] -= 1;
    sp._zimo = null;
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
    // 抜き北そのものは河の打牌ではない。次の通常打牌へのポン・大明槓を妨げない。
    this.justNukidBei[player] = false;
    // 王牌から代替ツモ。live wall が 0 でも海底北の補充は行う。
    // R3 P0 #3 fix: shan.zimo 前に shan 内部 state を snapshot、 sp.zimo 失敗時に全 rollback
    const shanAny0 = this.shan as any;
    const _shanSnapshot = this.shan.snapshot();
    let rawReplacement: any;
    try {
      rawReplacement = this.shan.nukizimo();
    } catch (e: any) {
      dlog('[declareNukiBei] shan exhausted', e?.message);
      sp._bingpai.z[4] = _origZ4; sp._zimo = _origZimo;
      this.goldHand[player].z = _origGoldZ; this.nukidoraGold[player] = _origNukidoraGold;
      this.nukidora[player] = _origNukidora; this.justNukidBei[player] = _origJustNukid;
      restorePhysicalHandState(sp, _origPhysicalHand);
      shanAny0.restore(_shanSnapshot);
      return null;
    }
    if (rawReplacement === null) {
      // The remaining replacement reserve consisted only of flowers.  North
      // and those flowers are genuinely extracted; with no tile left to
      // discard, the store completes the hand through the normal draw path.
      for (const hp of this.shan.lastDrawnHuapai) this.huapai[player].push(hp);
      this.lastZimoInfo = { player: null, pai: null, pochi: null, gold: false };
      this.lingshangActive[player] = false;
      this.lingshangFromKan[player] = false;
      return null;
    }
    const replacement = rawReplacement as Pai;
    const coreReplacement = toCorePai(replacement);
    try {
      sp.zimo(replacement);
    } catch (e: any) {
      // P0-6b: sp.zimo が bingpai[n]==4 拒否で throw [既に 4 枚消費済の牌が rinshan に来た state corruption]
      if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) console.log('!!!P0-6b nukibei sp.zimo throw', { player, replacement, rawReplacement, err: e?.message, bingpai: { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] }, fulou: [...sp._fulou] });
      // R3 P0 #3 fix: shan / hand state 全 rollback、 partial mutate を残さない
      sp._bingpai.z[4] = _origZ4; sp._zimo = _origZimo;
      this.goldHand[player].z = _origGoldZ; this.nukidoraGold[player] = _origNukidoraGold;
      this.nukidora[player] = _origNukidora; this.justNukidBei[player] = _origJustNukid;
      restorePhysicalHandState(sp, _origPhysicalHand);
      shanAny0.restore(_shanSnapshot);
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
    // 北抜き補充はカン由来ではない [カン補充→打牌せず北抜きの上書きも含む]
    this.lingshangFromKan[player] = false;
    // P0-6b 検出 [2026-05-12]: nukibei rinshan で 既に ankan 済の牌が混入してないか
    const fulouCounts = countTileInFulou(sp, coreReplacement);
    if (fulouCounts >= 4) {
      if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) console.log('!!!P0-6b nukibei rinshan 矛盾', { player, replacement, rawReplacement, fulouCounts, fulou: [...sp._fulou] });
    }
    // 2026-05-14 codex review fix: 通常 zimo と同じく lastDrawnHuapai 反映 + 白待ち回避
    if (this.shan.lastDrawnHuapai.length > 0) {
      for (const hp of this.shan.lastDrawnHuapai) {
        this.huapai[player].push(hp);
      }
    }
    // 北抜きは鳴き扱いにせず、ダブル立直の第一巡資格を壊さない。
    return replacement;
  }
  /** 旧牌譜互換フィールド。北抜き後の通常打牌への鳴きを抑止してはならない。 */
  justNukidBei: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 半荘終了判定: トビ + 局数消化 + 返り東チェック [全員 40000 未達なら継続]
   *  2026-05-14 codex review note: 戻り false が 「終了 ない → 継続」 を意味、 返り東 state へ
   *  実際に巻き戻すのは nextRound 側 [changbang=0 / jushu=0 + 'pingju' event push]。
   *  caller contract: isGameEnd() で false なら必ず nextRound() を続けて呼ぶ事 [単独使用禁止] */
  isGameEnd(opts: { ignoreTobiFor?: PlayerId } = {}): boolean {
    // 自己トビも例外なく終局する。ignoreTobiFor は旧呼出互換のため受けるが適用しない。
    void opts;
    for (const p of [0, 1, 2] as PlayerId[]) {
      if (this.state.defen[p] < 0) return true;
    }
    // 返り東中: 毎局誰か 40000 以上で終了
    if (this.state.tongaeshi) {
      const top = Math.max(...[0, 1, 2].map((p) => this.state.defen[p as PlayerId]));
      if (top >= 40000) return true;
      return false;
    }
    const requiredChang = this.changshu;
    if (this.state.changbang > requiredChang - 1) {
      // オーラス終了時、 誰か 40000 以上ならゲーム終了、 なければ返り東 [継続]
      const top = Math.max(...[0, 1, 2].map((p) => this.state.defen[p as PlayerId]));
      if (top >= 40000) return true;
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
    // トントンブー: 東1局中に子の和了が一度もなく、トビで終了した場合に親へ6枚オール。
    // 親の逆和了による自トビや流局由来の自トビも成立し得るため「親の和了」は必須にしない。
    // 一方、子の和了で飛んだ直後は nextRound 前で jushu=0 のままなので、局状態だけでは
    // 誤付与される。和了イベントを併用して「子の和了なし」を厳密に確認する。
    if (this.state.jushu === 0 && this.state.changbang === 0) {
      const oya = this.currentOya;
      const tobi = ([0, 1, 2] as PlayerId[]).some(p => this.state.defen[p] < 0);
      const childWonInEastOne = this.events.some((event) => {
        const e = event as any;
        if (e.type !== 'hule') return false;
        if (e.changbang != null && e.changbang !== 0) return false;
        if (e.jushu != null && e.jushu !== 0) return false;
        const winners: PlayerId[] = Array.isArray(e.players)
          ? e.players
          : e.player != null ? [e.player] : [];
        return winners.some((winner) => winner !== oya);
      });
      if (tobi && !childWonInEastOne) {
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

  initFromDeal(deal: {
    hands: Record<PlayerId, Pai[]>;
    huapai?: Record<PlayerId, Pai[]>;
    goldHand?: Record<PlayerId, { p: number; s: number; z: number }>;
    pochiHand?: any;
  }): void {
    this.firstTurnState = createFirstTurnState();
    const dg = { p: 0, s: 0, z: 0 };
    const dp = { blue: 0, red: 0, green: 0, yellow: 0 };
    this.goldHand = deal.goldHand ?? { 0: { ...dg }, 1: { ...dg }, 2: { ...dg } };
    this.huapai = deal.huapai ?? { 0: [], 1: [], 2: [] };
    this.pochiHand = deal.pochiHand ?? { 0: { ...dp }, 1: { ...dp }, 2: { ...dp } };
    for (const p of [0, 1, 2] as PlayerId[]) {
      this.shoupai.set(p, buildShoupai(deal.hands[p]));
      this.he.set(p, new Majiang.He());
      this.events.push({ type: 'qipai', player: p, tiles: deal.hands[p] });
    }
  }

  /** 配牌 [13 枚 × 3 人]、 同時に金牌 / 華牌の player 別カウント */
  qipai(): void {
    this.firstTurnState = createFirstTurnState();
    this.kamiPochiDoraChoices = { 0: {}, 1: {}, 2: {} };
    this.fuyuRevealState = { 0: null, 1: null, 2: null };
    this.pochiSwapChoice = { 0: null, 1: null, 2: null };
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
    // 宣言牌がロンされず次ツモに到達した時点でFEVERと保留中シュバリを確定する。
    if (this.feverDeclareDapaiPlayer !== null) {
      this.confirmFeverDeclaration(this.feverDeclareDapaiPlayer);
    }
    // 華牌 skip は live wall だけでなく嶺上牌と rinshanUsed も動かす。
    // 失敗時に一部だけ戻すと補充牌が消えるため、山全体を transaction 化する。
    const _shanSnap = this.shan.snapshot();
    let rawPai: any;
    try {
      rawPai = this.shan.zimo();
    } catch (e: any) {
      // huapai skip 中の exhaust [paishu>0 でも 内部で throw]
      this.shan.restore(_shanSnap);
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
        if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) console.log('!!!P0-6b regular zimo 矛盾', { player, pai, rawPai, fulouCount, fulou: [...spForZimo._fulou], lastZimoGold: this.shan.lastZimoGold });
      }
    }
    // R4 P1 #14 fix + R11 P2 #3 fix: sp.zimo throw 時に shan latch も完全 rollback
    try {
      patchAnmikaShoupai(spForZimo).zimo(pai);
    } catch (e: any) {
      if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) console.log('!!!sp.zimo throw [regular zimo]', { player, pai, err: e?.message });
      this.shan.restore(_shanSnap);
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
      // 華を抜いた補充牌は北抜きと同じ嶺上牌。海底の華でも補充牌を
      // ツモ和了でき、打牌した場合だけその後の河底/流局へ進む。
      this.lingshangActive[player] = true;
      this.lingshangFromKan[player] = false;
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
    // でかぽっち: リーチ一発で p1/p2 ツモ → ぽっちカットイン + 色倍率
    if (this.lizhi.has(player) && this.yifaActive[player] && !this.shan.lastZimoPochi) {
      if (corePai === 'p1') {
        this.shan.lastZimoPochi = 'green';
      } else if (corePai === 'p2') {
        this.shan.lastZimoPochi = 'yellow';
        this.applyPochiColorMultiplier(player, 'yellow');
        if (this.kinpeiTarget[player] === null) this.autoResolveKinpei(player);
      }
    }
    // 直前ツモ情報を保存 [ツモ切り時の色判定用]
    const isDekapochi = this.lizhi.has(player) && this.yifaActive[player] && (corePai === 'p1' || corePai === 'p2');
    this.lastZimoInfo = {
      player,
      pai,
      pochi: corePai === 'z5' ? (this.shan.lastZimoPochi ?? null)
        : isDekapochi ? (this.shan.lastZimoPochi ?? null)
        : null,
      gold: this.shan.lastZimoGold && (pai === 'gp' || pai === 'gs' || pai === 'gN'),
    };
    this.events.push({ type: 'zimo', player, pai });
    markFirstTurnDraw(this.firstTurnState, player);
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

  /** Exact physical identity of the current standalone draw. */
  private currentPhysicalZimoPai(player: PlayerId, sp: any): string | null {
    if (typeof sp?._zimo !== 'string' || sp._zimo.length > 3) return null;
    const coreZimo = toCorePai(sp._zimo.replace(/[_*]$/, ''));
    const last = this.lastZimoInfo.player === player && typeof this.lastZimoInfo.pai === 'string'
      ? this.lastZimoInfo.pai.replace(/[_*]$/, '')
      : null;
    if (last && toCorePai(last) === coreZimo) return last;
    const expanded = typeof sp._anmikaZimo === 'string'
      ? sp._anmikaZimo.replace(/[_*]$/, '')
      : null;
    if (expanded && toCorePai(expanded) === coreZimo) return expanded;
    return sp._zimo.replace(/[_*]$/, '');
  }

  /** オープン立直の当たり牌は、手牌の全打牌候補が当たり牌の場合だけ打てる。 */
  private isOpenReachWaitDiscardForbidden(player: PlayerId, pai: string): boolean {
    if (this.lizhi.has(player) || this.openLizhi.size === 0) return false;
    const waits = new Set<string>();
    for (const reacher of this.openLizhi) {
      if (reacher === player) continue;
      for (const wait of this.getTingpaiList(reacher)) waits.add(anmikaTileKind(wait));
    }
    const core = anmikaTileKind(pai);
    if (!waits.has(core)) return false;
    const sp = this.shoupai.get(player);
    let candidates: string[] = [];
    try { candidates = sp?.get_dapai?.(false) ?? []; } catch { return true; }
    return candidates.some((candidate) => {
      const c = anmikaTileKind(candidate);
      return c !== 'z4' && !waits.has(c);
    });
  }

  /** Resolve an action payload to the one physical tile it would consume. */
  resolveDiscardPai(
    player: PlayerId,
    pai: string,
    meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' },
  ): string {
    const sp = this.shoupai.get(player);
    if (!sp) throw new Error(`shoupai not set for player ${player}`);
    return resolvePhysicalDiscardPai({
      requestedPai: String(pai).replace(/[_*]$/, ''),
      meta,
      lastDrawnPai: this.lastZimoInfo.player === player ? this.lastZimoInfo.pai : null,
      expanded: sp._bingpai?.__anmika,
      bingpai: sp._bingpai,
    });
  }

  dapai(pai: Pai, meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' }): void {
    // R8 P0 #3 fix: 加槓 window は dapai 時点で必ず clear、 嶺上ツモ後の通常打牌に
    // qianggang: true が付く誤判定を防ぐ
    this.qianggangPending = false;
    // 2026-05-14 codex review fix: 「北は河に切れない」 仕様を Game3 API で保証。
    // dapai('z4') 直叩き は declareNukiBei に auto-route [silent redirect、 既存 test 互換]
    // R8 P2 #1 fix: 北抜き不可なら throw [silent return で lastDapai に z4 残る bug 解消]
    const player = this.lunbanToPlayerId(this.state.lunban);
    // リーチ後の待ち不変暗槓は強制。リーチ宣言牌を切る瞬間だけは宣言成立に必要なので除外する。
    const forcedKan = this.getForcedLizhiKanCandidates(player);
    if (!this.lizhiDeclareDapai[player] && forcedKan.length > 0) {
      throw new Error(`リーチ後の待ち不変カンが必須 [${forcedKan.join(',')}]`);
    }
    const requestedPai = String(pai).replace(/[_*]$/, '');
    const spInst = this.shoupai.get(player);
    if (!spInst) {
      console.error('[dapai error] shoupai.get(player) undefined', { player, lunban: this.state.lunban, mapSize: this.shoupai.size, mapKeys: Array.from(this.shoupai.keys()) });
      throw new Error(`shoupai not set for player ${player}`);
    }
    // Resolve the physical assertion before the z4 auto-nuki branch.  Without
    // this, `gN`/meta.gold=true could silently consume an ordinary north (and
    // the reverse) because consumeNukiBei intentionally has a fallback mode.
    const paiForHand = this.resolveDiscardPai(player, requestedPai, meta);
    const coreDapai = toCorePai(paiForHand);
    if (coreDapai === 'z4') {
      if (!this.canNukiBei(player)) {
        throw new Error(`dapai('${pai}'): 北抜き不可 [player=${player}]`);
      }
      const nukiBefore = (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
      const rep = this.declareNukiBei(player, { gold: paiForHand === 'gN' });
      const nukiAfter = (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
      // null can mean either an invalid physical request or a successfully
      // extracted final North whose replacement reserve has been exhausted.
      // Only the former is an API error; Store/authority settle the latter as
      // the common exhaustive-draw transition.
      if (rep === null && nukiAfter <= nukiBefore) {
        throw new Error(`dapai('${pai}'): declareNukiBei 失敗 [player=${player}]`);
      }
      return;
    }
    const isDeclarationDiscard = this.lizhiDeclareDapai[player];
    const trueZimo = this.currentPhysicalZimoPai(player, spInst);
    if (!isDeclarationDiscard && this.lizhi.has(player) && trueZimo !== null
      && paiForHand !== trueZimo) {
      throw new Error('立直後はツモ切りのみ');
    }
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    const isForcedFeverTsumogiri = someoneFever && !this.feverActive[player] && trueZimo !== null;
    if (isForcedFeverTsumogiri && paiForHand !== trueZimo) {
      throw new Error('フィーバー中の非宣言者はツモ切りのみ');
    }
    // FEVER's later, explicit rule forces every non-declarer to tsumogiri and
    // suppresses their wins/tenpai.  Let that forced tile through even when an
    // older open-reach restriction would otherwise leave no legal action.
    if (!isForcedFeverTsumogiri && this.isOpenReachWaitDiscardForbidden(player, paiForHand)) {
      throw new Error('オープン立直の待ち牌は、手牌全部が当たり牌の場合以外は打牌不可');
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
    // 河の色・金属性は、検証済みの物理牌名からだけ決める。並行在庫や
    // lastZimoInfo を根拠にすると、通常赤牌を金牌、別色の白を任意色へ
    // 変造できてしまう。
    const pochiColor = pochiColorFromPai(paiForHand) ?? undefined;
    const isGold = paiForHand === 'gp' || paiForHand === 'gs' || paiForHand === 'gN';
    if (pochiColor && this.pochiHand[player][pochiColor] > 0) {
      this.pochiHand[player][pochiColor] -= 1;
    }
    if (isGold) {
      const kind = paiForHand === 'gp' ? 'p' : paiForHand === 'gs' ? 's' : 'z';
      if (this.goldHand[player][kind] > 0) this.goldHand[player][kind] -= 1;
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
      if (!this.shuvariUsed[player] && !this.feverPendingShuvari[player]) {
        this.lateShuvariWindow[player] = true;
      }
    } else {
      this.yifaActive[player] = false;
    }
    // 宣言者以外の次の一打が成立した時点で、遅延シュバリ受付を閉じる。
    for (const p of [0, 1, 2] as PlayerId[]) {
      if (p !== player) this.lateShuvariWindow[p] = false;
    }
    // 嶺上消失: 普通の dapai 後は嶺上開花対象外
    this.lingshangActive[player] = false;
    this.lingshangFromKan[player] = false;
    // 第一打終了 [天和 / 地和 失効]
    markFirstTurnDiscard(this.firstTurnState, player);
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
    return lizhiXiangting(sp);
  }

  /** AI 用: 手牌に pai を 1 枚追加した時の xiangting [鳴き効率簡易判定用]
   *  実 pon は面子1個 fixed だが majiang-core API 都合で +1 zimo 相当で近似
   *  [2026-05-21 ゆーま 自走 CPU 教育: ポン判定のシャンテン進化チェック用] */
  estimateXiangtingWithExtra(player: PlayerId, pai: string): { base: number; withExtra: number } {
    const sp = this.shoupai.get(player);
    if (!sp) return { base: 99, withExtra: 99 };
    const base = lizhiXiangting(sp);
    const num = pai[1] === '0' ? 5 : parseInt(pai[1]);
    const colorKey = pai[0];
    const cur = sp._bingpai?.[colorKey]?.[num] ?? 0;
    if (cur >= 4) return { base, withExtra: base };
    try {
      const clone = sp.clone();
      clone._bingpai[colorKey][num] = cur + 1;
      clone._zimo = `${colorKey}${num}`;
      return { base, withExtra: lizhiXiangting(clone) };
    } catch {
      return { base, withExtra: base };
    }
  }

  /** AI 用: シャンテン最小化する打牌候補を返す。
   *  同シャンテン候補内では: 全リーチ家の現物 [+10] > 字牌 [+3] > 端牌 [+2] > 2/8 [+1] > 中央
   *  他家リーチ中に自分がこのシャンテン以上 [遠い] なら安全度優先へ切り替える */
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
    candidates = candidates.filter((c: string) => toCorePai(c.replace(/[_*]$/, '')) !== 'z4');
    if (candidates.length === 0) return null;
    // フィーバー立直中: フィーバー player 以外は ツモ切り強制 [AI も従う]
    //   ただし z4 [北] は dapai 不可 [抜き北 path に任せる]、 ここでは候補から除外済の
    //   pickBestDiscard fallback に進めて 通常 heuristic 経由で他の打牌を選ばせる
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    const mustTsumogiri = (someoneFever && !this.feverActive[player])
      || (this.lizhi.has(player) && !this.lizhiDeclareDapai[player]);
    if (mustTsumogiri) {
      const z = this.currentPhysicalZimoPai(player, sp);
      if (z && toCorePai(z) !== 'z4') return z as Pai;
    }
    const lizhiOpponents = [0, 1, 2].filter((p) => p !== player && this.lizhi.has(p as PlayerId)) as PlayerId[];
    const baseTile = (p: string) => {
      const stripped = p.replace(/[\+\=\-_*]/g, '');
      const core = toCorePai(stripped);
      if (core.length < 2) return '';
      return core[0] + (core[1] === '0' ? '5' : core[1]);
    };
    // ukeire 計算 [リョー指示 2026-05-13 「CPU 打牌品質上げ」]:
    // dapai 後の手で 各 tile を draw して xt が下がる枚数 を 残枚数 weighted で count
    // 残枚数は自家手牌と公開情報だけから推定する。他家の伏せ牌を読むことは禁止。
    const visibleElsewhere = (s_: string, n_: number): number => {
      let v = 0;
      for (const p of [0, 1, 2] as PlayerId[]) {
        const sp_p = this.shoupai.get(p);
        for (const mianzi of (sp_p?._fulou ?? []) as string[]) {
          v += countTileInFulou({ _fulou: [mianzi] }, `${s_}${n_}`);
        }
        const he = this.he.get(p);
        for (const d of (he?._pai ?? []) as string[]) {
          const visibleBase = baseTile(d);
          const dn = parseInt(visibleBase[1]);
          if (visibleBase[0] === s_ && dn === n_) v++;
        }
      }
      for (const indicator of this.shan.baopai ?? []) {
        const visibleBase = baseTile(indicator);
        if (visibleBase[0] === s_ && parseInt(visibleBase[1]) === n_) v++;
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
          const xtAfter = lizhiXiangting(sp_test);
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
        const discardedBase = baseTile(d);
        if (discardedBase[0] === baseP[0]) {
          heNums.add(parseInt(discardedBase[1]));
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

    // [2026-07-20 リョー指示] 押し引き。旧実装は比較順が
    // 「シャンテン最小 → 受け入れ最大 → 安全度」で、安全度は同シャンテン同受け入れ
    // の時しか出番が無かった。つまり他家リーチ中でも 1 シャンテン縮むなら無筋を切る。
    // 自分がリーチ済 [降りられない] でも テンパイ / 1 シャンテン [押す価値がある]
    // でもない時だけ、安全度優先へ切り替える。
    const myXiangtingNow = lizhiXiangting(sp);
    const foldMode = lizhiOpponents.length > 0
      && !this.lizhi.has(player)
      && myXiangtingNow >= PICK_FOLD_XIANGTING;

    let bestPai: string | null = null;
    let bestShanten = 99;
    let bestUkeire = -1;
    let bestPriority = -1;
    let bestSafety = -99;
    for (const c of candidates) {
      const basePai = c.replace(/_$/, '');
      const sp_clone = sp.clone();
      try {
        sp_clone.dapai(c);
      } catch {
        continue;
      }
      const xt = lizhiXiangting(sp_clone);
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
      // [2026-07-20] safety を prio と分けて持つ。prio には祝儀温存の減点
      // [金 -3 / ぽっち -4 / 7 牌 -5 等] が混ざっているので、ベタオリで prio を
      // 最優先にすると「危険でも祝儀牌以外を切る」挙動になり放銃が増える。
      let safety = 0;
      if (lizhiOpponents.length > 0) {
        const isGenbutsuAll = lizhiOpponents.every((lp) => {
          const he = this.he.get(lp);
          return he?._pai?.some((d: string) => baseTile(d) === baseTile(basePai));
        });
        if (isGenbutsuAll) safety = 10;
        else {
          const isSujiAll = lizhiOpponents.every((lp) => isSujiSafe(lp, basePai));
          if (isSujiAll) safety = 4;
          else if (isKabeSafe(basePai)) safety = 2;
          else safety = -5;
        }
        prio += safety;
      }
      // 通常は xt 最小 > ukeire 最大 > priority 最大。
      // ベタオリ中は safety [純粋な安全度] を最優先し、同安全度の中で手を進める
      const better = foldMode
        ? (safety > bestSafety
          || (safety === bestSafety && xt < bestShanten)
          || (safety === bestSafety && xt === bestShanten && ukeire > bestUkeire))
        : (xt < bestShanten
          || (xt === bestShanten && ukeire > bestUkeire)
          || (xt === bestShanten && ukeire === bestUkeire && prio > bestPriority));
      if (better) {
        bestShanten = xt;
        bestUkeire = ukeire;
        bestPriority = prio;
        bestSafety = safety;
        bestPai = c;
      }
    }
    return bestPai;
  }

  /** 北を手牌構成 [雀頭/面子/ロン牌] として使う和了は、役満だけ許可する。 */
  canUseBeiMaterialForAgari(player: PlayerId, ronpai: Pai | null = null, fromPlayer: PlayerId | null = null): boolean {
    const sp = this.shoupai.get(player);
    if (!handUsesBeiMaterial(sp, ronpai)) return true;
    const fakeRes = this.evaluateHuleDry(player, ronpai, fromPlayer);
    return resultAllowsBeiMaterial(fakeRes);
  }

  /** 投機評価用に hule() を安全に呼ぶ [判定のみ、状態は完全に巻き戻す]。
   *  従来の saveSnapshot()/restoreSnapshot() ペアは snapshotLocked 中に save が
   *  黙ってスキップされ、restore が古い/空の preHuleSnapshot を書き戻すため、
   *  秋カスケードの物理ドラめくり [hule() 内 drawNewDora] が漏れてドラ表が
   *  増殖したり、stale 復元で局が進行不能になる [2026-07-17 リョー報告 根治]。
   *  ロックに関係なくローカル snapshot で必ず巻き戻す。 */
  private evaluateHuleDry(player: PlayerId, ronpai: Pai | null = null, fromPlayer: PlayerId | null = null): any {
    const localSnap = saveSnapshotHelper(this._snapshotRefs());
    try {
      return this.hule(player, ronpai, fromPlayer);
    } catch {
      return null;
    } finally {
      restoreSnapshotHelper(this._snapshotRefs(), localSnap);
    }
  }

  private canTsumoByHuleResult(player: PlayerId): boolean {
    return !!this.evaluateHuleDry(player);
  }

  /** ツモ和了判定 [現家がツモった牌で和了可能か]
   *  アンミカ独自: リーチ済 player が白 [z5] をツモった場合、 オールマイティ判定で z5 を
   *  任意の牌に置換して和了可能か試す [赤 / 金 5 を除く]
   *  + ダマ禁止: 副露ナシ + リーチナシ + 役満ナシ なら ボタン出さない */
  canTsumo(player: PlayerId): boolean {
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    // 立直後の合法暗槓は強制。槓をツモ和了で回避することはできない。
    if (this.lizhi.has(player) && !this.lizhiDeclareDapai[player]
      && this.getForcedLizhiKanCandidates(player).length > 0) return false;
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
            const fakeRes = this.evaluateHuleDry(player);
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
        // WSA: 暗槓のみは門前扱い [isMenzenHand] — hasFulou 直比較だと暗槓手がダマ禁止をバイパス
        const hasFulou = !isMenzenHand(sp);
        if (hasFulou) {
          const fakeRes = this.evaluateHuleDry(player);
          if (!fakeRes) return false;
        }
        if (!hasFulou && !this.lizhi.has(player)) {
          // R7 P1 #5 fix: 判定 reactive 呼出で preHuleSnapshot を上書きする bug 解消、
          // 既存 snapshot を退避 → saveSnapshot → restoreSnapshot → 退避を書き戻す
          const fakeRes = this.evaluateHuleDry(player);
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
    // でかぽっち: リーチ一発ツモで p1→緑ぽっち、p2→黄ぽっち扱い
    if (this.lizhi.has(player) && this.yifaActive[player] && sp._zimo) {
      const core = toCorePai(sp._zimo);
      if (core === 'p1' || core === 'p2') {
        const r = canTsumoWithPochiSwapHelper(sp, core);
        dlog('[canTsumo dekapochi swap]', { ...dbg, core, swapResult: r });
        return r;
      }
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
    // get_peng_mianzi is a majiang-core boundary. The river keeps the
    // physical Anmika face, while core receives its normalized face.
    const paiWithDir = toCorePai(pai) + dir;
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
    // mianzi is already a majiang-core string (for example p555+), never an
    // expanded physical tile name.  Its first suit/digit pair is the fallback.
    const takenPai = this.discardLog[fromPlayer]?.[this.discardLog[fromPlayer].length - 1]?.pai
      ?? `${mianzi[0]}${mianzi[1]}`;
    sp._anmikaFulou = sp._anmikaFulou ?? [];
    sp._anmikaFulou.push({ mianzi, from: fromPlayer, taken: takenPai });
    // 河の最後の牌に副露マーカー [+/=/-] を付ける、 majiang-core の He.fulou に任せる
    const fromHe = this.he.get(fromPlayer);
    if (fromHe && typeof fromHe.fulou === 'function') {
      try { fromHe.fulou(mianzi); } catch { /* ignore: 河マーカーは UI 表示用 */ }
    }
    // patchAnmikaShoupai.fulou が手牌から使った expanded tile を在庫から減らし、
    // _anmikaFulouPhysical に物理牌名を移す。鳴かれた牌の色は takenPai に保持する。
    // 注: ポン後 _zimo に mianzi が入る [majiang-core 慣習、 ツモ済 state を擬似化]
    //     dapai が `if (! this._zimo) throw` で門前打牌不可になるのを回避するため必須
    //     toString は core 側で _zimo の mianzi を判別して手牌に混入させない [Shoupai.toString line 115]
    // lunban を player に [反時計周り 2026-05-13 fix: 逆変換も反時計]
    this.state.lunban = (((this.currentOya - player) % 3 + 3) % 3) as Lunban;
    // 副露介入で他家の一発消失、 自分も一発消失 [副露ありはリーチ後の対象外]
    this.yifaActive = { 0: false, 1: false, 2: false };
    markFirstTurnCall(this.firstTurnState);
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
    // 2026-07-16 リョー裁定: フィーバー成立後は宣言牌ロン [P0-1] を除き、
    // フィーバー者以外は和了不可。旧実装の「フィーバー者の捨て牌は他家ロン可」を撤廃
    // [フィーバー宣言者がロンされて振り込み扱いになる実害の報告による]
    if (someoneFever && !this.feverActive[player] && !feverDeclareDiscard) return false;
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
          // ロン牌が m7 なら m1 に変換する。それ以外のロン牌も zimo() で
          // counts と _zimo の両方へ加える必要がある。_zimo だけ代入すると、
          // m7→m1 解釈で字牌等を待つ国士の合法ロンを落とす。
          const ronAsM1 = ronpaiIsM7 ? ('m1' + (pai as string).slice(2)) : pai;
          ssClone.zimo(ronAsM1);
          const r7 = Majiang.Util.hule_mianzi(ssClone);
          if (r7 && r7.length > 0) result = r7;
        }
      }
      // ぽっちのオールマイティ効果はリーチ後の「ツモ」に限る。
      // ロンの例外は、正ぽっちを存在しない m8 として受ける嵌八萬だけ。
      const paiIsZ5 = pai && toCorePai(pai as string) === 'z5';
      const isKanpa = !!paiIsZ5 && this.lizhi.has(player) && this.isKanpaman(player, pai as string);
      const physicalColor = fromPlayer !== null
        ? (claimTileIdentity(pai as string).pochiColor ?? this.discardLog[fromPlayer]?.at(-1)?.pochi)
        : claimTileIdentity(pai as string).pochiColor;
      const isPositiveKanpaClaim = isKanpa && (physicalColor === 'green' || physicalColor === 'blue');
      if ((!result || result.length === 0) && isPositiveKanpaClaim) result = [[]];
      if ((!result || result.length === 0) && americanChitoiComplete(sp, pai)) {
        result = [[]];
      }
      if (!result || result.length === 0) return false;
      // 嵌八萬 [z5 ロン] 特例:
      //  - 切られた z5 が逆ぽ [赤・黄] なら ロン不可 [見逃しにならない]
      //  - 自家河に z5 / m8 があってもフリテン化しない [リョー指示]
      if (isKanpa && !isPositiveKanpaClaim) return false;
      // 厳密フリテン: 自家河に「待ち牌のいずれか」が 1 枚でもあれば不可
      // 嵌八萬は通常の牌 catalog に m8 がないため tingpai が空でも成立する。
      const ting = this.getTingpaiList(player);
      const isKanpamanOnly = ting.length === 0 && isPositiveKanpaClaim;
      if (ting.length === 0 && !isKanpamanOnly) return false;
      const baseTile = anmikaTileKind;
      const tingNorm = new Set(ting.map(baseTile));
      const myHe = this.he.get(player);
      // フィーバー中はフリテン判定 skip [ルール 5-3 何度でもアガリ可能]
      if (myHe?._pai && !this.feverActive[player]) {
        for (const discarded of myHe._pai as string[]) {
          // 嵌八萬時は z5 / m8 のフリテン化を回避
          if (isKanpa && (baseTile(discarded) === 'z5' || baseTile(discarded) === 'm8')) continue;
          if (tingNorm.has(baseTile(discarded))) return false;
        }
      }
      // 北抜きへのロンは「北単騎かつ、北を構成牌に使える列挙役満」だけ。
      // 国士13面などの多面待ちは、北でも抜きロンの対象にならない。
      const isBeiRon = toCorePai(String(pai).replace(/[\+\=\-_*]/g, '')) === 'z4';
      if (isBeiRon) {
        const normalizedWaits = new Set(ting.map((wait) => {
          const core = toCorePai(String(wait).replace(/[\+\=\-_*]/g, ''));
          return core[0] + (core[1] === '0' ? '5' : core[1]);
        }));
        if (normalizedWaits.size !== 1 || !normalizedWaits.has('z4')) return false;
        const fakeFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
        const fakeRes = this.evaluateHuleDry(player, pai, fakeFromPlayer);
        if (!fakeRes || !resultAllowsBeiMaterial(fakeRes)) return false;
      }
      const beiFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
      if (!this.canUseBeiMaterialForAgari(player, pai, beiFromPlayer)) return false;
      // ダマ禁止 check: 副露なし + リーチなし → 役満以外ならロン不可
      // 2026-05-14 Round 2 codex fix P1 #7: 旧版は fakeRes truthy なら通してた、
      // 実際 役満限定 [damanguan>=1 / hupai に '*' / '**' / fanshu===undefined] のみ accept
      // WSA: 暗槓のみは門前扱い [isMenzenHand]
      const hasFulou = !isMenzenHand(sp);
      // R9 P2 #11 fix: 副露手も fake hule() で 役なし check
      if (hasFulou) {
        const fakeFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
        const fakeRes = this.evaluateHuleDry(player, pai, fakeFromPlayer);
        if (!fakeRes) return false;
      }
      if (!hasFulou && !this.lizhi.has(player)) {
        // R7 P1 #5 fix: 既存 snapshot 退避、 判定後 書き戻す
        const fakeFromPlayer = fromPlayer !== null ? fromPlayer : (((player + 1) % 3) as PlayerId);
        const fakeRes = this.evaluateHuleDry(player, pai, fakeFromPlayer);
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
      if (dir) ronpaiWithDir = toCorePai(ronpai) + dir;
    }
    const isLizhi = this.doubleLizhi.has(player) ? 2 : (this.lizhi.has(player) ? 1 : 0);
    const isYifa = this.yifaActive[player];
    const isLingshang = this.lingshangActive[player];
    // 嶺上開花はカン補充のみ。北・華抜きの補充ツモには付かない [2026-07-18 リョー裁定]
    const isLingshangKaihua = isLingshang && this.lingshangFromKan[player];
    // 海底 / 河底: 山切れ後の最終アガリ、 ロン=2 / ツモ=1。
    // 北・華の補充牌ツモは嶺上であり、海底摸月とは複合しない [嶺上開花の有無と独立]。
    // その補充牌を切って他家がロンする時点では lingshang=false なので河底になる。
    const isHaidi = this.shan.paishu === 0 && !isLingshang ? (ronpai ? 2 : 1) : 0;
    // 天和 / 地和: 配牌直後 [diyizimo true]、 ツモアガリで親=天和 / 子=地和
    let isTianhu = 0;
    if (this.isFirstTurnTsumoEligible(player) && !ronpai) {
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
      'ノーテン罰あり': false,   // アンミカ: ノーテン流局なし [2026-05-23 audit]
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
      lingshang: isLingshangKaihua,
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
    const isLizhiAgari = this.lizhi.has(player);
    const baopaiAki = (this.shan.baopai ?? []).filter((p: any) => p === 'f3').length;
    const fubaopaiAki = isLizhiAgari ? ((this.shan.fubaopai ?? []).filter((p: any) => p === 'f3').length) : 0;
    const baseAkiCount = akiHandRemaining + baopaiAki + fubaopaiAki;
    let aki = baseAkiCount;
    // 秋金北は「秋がちょうど1枚」の時だけ秋秋相当へ強化する。
    // 既に秋が2枚以上なら秋秋金北の翻数祝儀へ移るため、ドラ追加回数は増やさない。
    const akiKinpeiSingleBoost = this.kinpeiTarget[player] === 'aki' && baseAkiCount === 1;
    if (akiKinpeiSingleBoost) {
      aki += 1;
    }
    if (aki > 0 && this.shan.paishu < 2) {
      // 山残なし → 秋効果不発 [ルール: 下段しか山が残っていない場合は使用不可]
      aki = 0;
    }
    dlog('[aki check]', { player, akiInHand: this.huapai[player].filter(p => p === 'f3').length, baopaiAki, fubaopaiAki, totalAki: aki, baopaiNow: [...this.shan.baopai], fubaopaiNow: [...(this.shan.fubaopai ?? [])] });
    // 4/8 華判定用に 「自分抜き分」 の huapai 数を 秋 cascade 前に snapshot
    // [ドラ表示由来の華は 4華/8華 対象外、 リョー指示 2026-05-11]
    (this as any)._huapaiOwnLengthAtHule = (this as any)._huapaiOwnLengthAtHule ?? {};
    (this as any)._huapaiOwnLengthAtHule[player] = this.huapai[player].length;
    let akiRevealCount = 0;
    if (aki > 0) {
      const isLizhi = this.lizhi.has(player);
      dlog('[aki effect] pushing', { player, aki, willAddBaopai: aki, isLizhi });
      // 秋効果でめくった華もその表示枠を占め、和了時に抜いた扱い。
      // 華だから通常牌まで飛ばすことはせず、f3 [秋] の場合だけ新たな秋効果を1回追加する。
      let akiRemaining = aki;
      while (akiRemaining > 0) {
        // 上段が無く下段1枚だけなら秋は使えない。
        if (this.shan.paishu < 2) break;
        let newlyRevealedAki = 0;
        const visible = this.shan.drawNewDora(false);
        if (visible === null) break;
        akiRevealCount += 1;
        if (visible === 'f3') newlyRevealedAki += 1;
        // 表示位置はリーチ有無に関係なく [上, 下] の固定ペア。
        // 下段は常にlive wallから物理切出しして裏表示枠へ保持し、
        // リーチ和了時だけ公開・得点・秋連鎖へ含める。
        const hidden = this.shanRule.fudora ? this.shan.drawNewDora(true) : null;
        if (isLizhi && hidden === 'f3') newlyRevealedAki += 1;
        akiRemaining -= 1;
        // 秋金北でめくった牌が2枚目の秋なら、秋秋金北へ移行し、
        // その秋による「3枚目」の追加ドラは発生させない。
        if (!akiKinpeiSingleBoost) akiRemaining += newlyRevealedAki;
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
    // 嵌八萬ロンだけは、正ぽっちの物理和了牌を山に存在しない m8 として評価する。
    // 一般のぽっちロンにはオールマイティ効果を広げない。
    if (!result && ronpai && fromPlayer !== null && isLizhi && this.isKanpaman(player, ronpai)) {
      const pochiColor = claimTileIdentity(ronpai).pochiColor
        ?? this.discardLog[fromPlayer]?.at(-1)?.pochi;
      if (pochiColor === 'green' || pochiColor === 'blue') {
        try {
          const dir = ronpaiWithDir?.slice(2) ?? '';
          result = Majiang.Util.hule(sp.clone(), `m8${dir}`, param);
          if (result) (result as any)._kanpamanPochi = true;
        } catch { /* skip */ }
      }
    }
    dlog('[hule debug]', { player, ronpai, ronpaiWithDir, fromPlayer, isLizhi, paramBaopai: param.baopai, paramFubaopai: param.fubaopai, hupaiInResult: result?.hupai, fanshu: result?.fanshu, defen: result?.defen, hasResult: !!result, err: huleErr?.message });
    if (!result && americanChitoiComplete(sp, ronpaiWithDir)) {
      const quadCount = countAmericanChitoiQuads(sp, ronpaiWithDir);
      const fallbackYaku = americanChitoiFallbackYaku(sp, ronpai);
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
        // Keep the core name/fan here so the common post-process applies this
        // table's 4-fan double-riichi ruling exactly as it does normally.
        const reach = isLizhi === 2
          ? { name: '両立直', fanshu: 2 }
          : { name: '立直', fanshu: 1 };
        result.hupai.push(reach);
        result.fanshu += reach.fanshu;
      }
      if (!ronpai) {
        result.hupai.push({ name: '門前清自摸和', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isYifa) {
        result.hupai.push({ name: '一発', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isLingshangKaihua) {
        result.hupai.push({ name: '嶺上開花', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isHaidi) {
        result.hupai.push({ name: ronpai ? '河底撈魚' : '海底摸月', fanshu: 1 });
        result.fanshu += 1;
      }
      if (isTianhu === 1) {
        result.hupai.push({ name: '天和', fanshu: '*' });
        result.damanguan = (result.damanguan ?? 0) + 1;
      } else if (isTianhu === 2) {
        result.hupai.push({ name: '地和', fanshu: '*' });
        result.damanguan = (result.damanguan ?? 0) + 1;
      }
      // WSA: 槍槓
      if (this.qianggangPending && ronpai) {
        result.hupai.push({ name: '槍槓', fanshu: 1 });
        result.fanshu += 1;
      }
      for (const yaku of fallbackYaku.numeric) {
        result.hupai.push(yaku);
        result.fanshu += yaku.fanshu;
      }
      const redDora = countPhysicalRedDora(sp, ronpai);
      if (redDora > 0) {
        result.hupai.push({ name: '赤ドラ', fanshu: redDora });
        result.fanshu += redDora;
      }
      // WSA: 通常ドラ・裏ドラ [majiang-core bypass のため手動カウント]
      const acBaopai = (this.shan.baopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f')).map(normalizeBaopaiForMajiang);
      for (const indicator of acBaopai) {
        const cnt = this.countDoraFromIndicator(sp, indicator, ronpai);
        if (cnt > 0) { result.hupai.push({ name: 'ドラ', fanshu: cnt }); result.fanshu += cnt; }
      }
      if (isLizhi) {
        const acFubaopai = (this.shan.fubaopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f')).map(normalizeBaopaiForMajiang);
        for (const indicator of acFubaopai) {
          const cnt = this.countDoraFromIndicator(sp, indicator, ronpai);
          if (cnt > 0) { result.hupai.push({ name: '裏ドラ', fanshu: cnt }); result.fanshu += cnt; }
        }
      }
      // This fallback has already counted every physical 5 (normal/red/gold).
      // The later majiang-core zero-tile deficit repair must not run again.
      (result as any)._anmikaCompleteDoraCount = true;
      for (const yaku of fallbackYaku.yakuman) {
        result.hupai.push(yaku);
        result.damanguan += 1;
      }
      if (result.damanguan > 0) result.fanshu = undefined;
    }
    // majiang-core が通常面子の解を高く採った場合でも、同じ牌姿にアメリカ七対子の
    // 解があれば独立候補として比較する。大/小車輪は後段 post-process で確定する。
    if (result
        && !result.hupai?.some((h: any) => h.name === '七対子')
        && americanChitoiComplete(sp, ronpaiWithDir)) {
      const inheritedNames = [
        '立直', 'ダブリー', '両立直', '門前清自摸和', '一発', '嶺上開花',
        '海底摸月', '河底撈魚', '槍槓', 'ドラ', '裏ドラ', '赤ドラ',
        '断幺九', '混老頭', '混一色', '清一色',
      ];
      const inherited = (result.hupai ?? [])
        .filter((h: any) => typeof h?.fanshu === 'number'
          && inheritedNames.some((name) => String(h.name ?? '').startsWith(name)))
        .map((h: any) => ({ ...h }));
      const quadCount = countAmericanChitoiQuads(sp, ronpaiWithDir);
      const americanResult: any = {
        hupai: [{ name: '七対子', fanshu: 2 }, ...inherited],
        fu: 25,
        fanshu: 2 + inherited.reduce((sum: number, h: any) => sum + (Number(h.fanshu) || 0), 0),
        damanguan: 0,
        defen: 0,
        fenpei: [0, 0, 0, 0],
      };
      if (quadCount > 0) {
        americanResult.hupai.push({ name: `アメリカ七対子 [${quadCount}種 4 枚使い]`, fanshu: 4 * quadCount });
        americanResult.fanshu += 4 * quadCount;
      }
      // 面子解が二盃口なら、車輪を採用しても二盃口の15枚オール祝儀は残る。
      if ((result.hupai ?? []).some((h: any) => h.name === '二盃口')) {
        americanResult.hupai.push({ name: '二盃口', fanshu: 0 });
      }
      const hasQing = americanResult.hupai.some((h: any) => String(h.name).startsWith('清一色'));
      const hasHun = americanResult.hupai.some((h: any) => String(h.name).startsWith('混一色'));
      const candidateScore: [number, number] = [hasQing ? 1 : 0, americanResult.fanshu + (hasHun ? 1 : 0)];
      const currentScore: [number, number] = [result.damanguan ?? 0, typeof result.fanshu === 'number' ? result.fanshu : 99];
      if (candidateScore[0] > currentScore[0]
          || (candidateScore[0] === currentScore[0] && candidateScore[1] > currentScore[1])) {
        result = americanResult;
      }
    }

    // 神ぽっち: 正ぽ [z5] がドラ表 / 裏ドラ表に出てる場合、 任意の牌をドラ表示扱い
    // 指定牌は pending choice で選ぶ。未選択なら勝手に最多牌へ固定しない。
    // 神ぽっち発動条件: baopai / fubaopai に z5 が出てて、 その色が正ぽ [緑/青] のみ
    // 逆ぽ [赤/黄] はただの白扱い [リョー指示]
    const kamiDoraOccurrences = this.getKamiPochiDoraOccurrences(player);
    const selectedKamiDora = kamiDoraOccurrences.filter((occurrence) => occurrence.target !== null);
    if (selectedKamiDora.length > 0) {
        const replaceIndicators = (source: KamiPochiDoraSource, list: unknown[]): string[] => list.map((raw, index) => {
          const normalizedRaw = normalizeBaopaiForMajiang(String(raw));
          if (!isPositiveZ5(String(raw))) return normalizedRaw;
          const target = this.kamiPochiDoraChoices[player][`${source}:${index}`];
          if (!target) return normalizedRaw;
          return normalizeBaopaiForMajiang(this.doraIndicatorOf(target));
        });
        const newBaopai = replaceIndicators('baopai', [...(this.shan.baopai ?? [])]);
        const newFubaopai = replaceIndicators('fubaopai', [...(this.shan.fubaopai ?? [])]);
        const newParam = { ...param, baopai: newBaopai, fubaopai: this.lizhi.has(player) ? newFubaopai : param.fubaopai };
        try {
          const spForHule = sp.clone();
          const newResult = Majiang.Util.hule(spForHule, ronpaiWithDir, newParam);
          // result が null でも newResult があれば採用、 さらに fanshu 大なら更新
          if (newResult && newResult.fanshu !== undefined) {
            if (!result || newResult.fanshu > (result.fanshu ?? 0)) {
              result = newResult;
              result.hupai = result.hupai ?? [];
              const choices = selectedKamiDora.map((occurrence) => `${occurrence.key}→${occurrence.target}`).join(', ');
              result.hupai.push({ name: `神ぽっち [${choices}]`, fanshu: 0 });
              // [2026-05-21 fix] 神ぽっち適用後の param を保持、 後続の 白ぽっちオールマイティ
              // swap path がこの修正済 baopai/fubaopai を使い続けるように。 旧 code は param 更新せず
              // → swap が原 fubaopai で計算 → 神ぽっち ura ドラ消える bug。
              param.baopai = newBaopai;
              if (this.lizhi.has(player)) param.fubaopai = newFubaopai;
            }
          }
        } catch { /* skip */ }
    }
    // 白ぽっち オールマイティ: リーチ後のツモ牌 z5 を候補ごとに実体化し、
    // 全祝儀処理後の期待値で強制高目を選ぶ。ロンの例外は上段の嵌八萬だけ。
    // [2026-05-21 fix] _zimo / ronpai は z5b/r/g/y 等 raw 可、 toCorePai 経由で比較
    const zimoIsZ5b = sp._zimo ? toCorePai(sp._zimo) === 'z5' : false;
    const ronpaiIsZ5b = ronpai ? toCorePai(ronpai) === 'z5' : false;
    const isPochiAgariPai = zimoIsZ5b || ronpaiIsZ5b;
    const ronSwapAllowed = !ronpai;
    const estimatePochiChip = (
      candidate: any,
      kind: 'white' | 'deka',
      from: string,
      target: string,
    ): number => {
      const dryResult = {
        ...candidate,
        _akiRevealCount: akiRevealCount,
        hupai: (candidate?.hupai ?? []).map((h: any) => ({ ...h })),
        fenpei: Array.isArray(candidate?.fenpei) ? [...candidate.fenpei] : candidate?.fenpei,
        saiKoroChances: Array.isArray(candidate?.saiKoroChances)
          ? candidate.saiKoroChances.map((chance: any) => ({ ...chance }))
          : [],
      };
      const dryState: ChipStateT = {
        shuvariActive: { ...this.shuvariActive },
        feverActive: { ...this.feverActive },
        feverTier: { ...this.feverTier },
        pochiMultiplier: {
          0: typeof this.pochiMultiplier[0] === 'number' ? this.pochiMultiplier[0] : { ...this.pochiMultiplier[0] },
          1: typeof this.pochiMultiplier[1] === 'number' ? this.pochiMultiplier[1] : { ...this.pochiMultiplier[1] },
          2: typeof this.pochiMultiplier[2] === 'number' ? this.pochiMultiplier[2] : { ...this.pochiMultiplier[2] },
        },
        chipLedger: { 0: 0, 1: 0, 2: 0 },
        chipBreakdown: [],
      };
      const dryOall = (t: PlayerId, n: number, o: any = {}) => applyChipOallHelper(dryState, t, n, o);
      const dryRon = (w: PlayerId, l: PlayerId, n: number, o: any = {}) => applyChipFromLoserHelper(dryState, w, l, n, o);

      // 独自役・役満・サイコロ候補まで実際と同じ後処理を通す。ここで発生する
      // オールオールスター等の直接祝儀だけ dry ledger に受け、実局 state は触らない。
      const ownOall = Object.getOwnPropertyDescriptor(this, 'applyChipOall');
      const ownRon = Object.getOwnPropertyDescriptor(this, 'applyChipFromLoser');
      (this as any).applyChipOall = dryOall;
      (this as any).applyChipFromLoser = dryRon;
      try {
        this.applyAnmikaYakuPostProcess(dryResult, player, false, target, null, null, param);
      } finally {
        if (ownOall) Object.defineProperty(this, 'applyChipOall', ownOall);
        else delete (this as any).applyChipOall;
        if (ownRon) Object.defineProperty(this, 'applyChipFromLoser', ownRon);
        else delete (this as any).applyChipFromLoser;
      }

      // 抜き北の翻と西表示による北ドラを、実際の後処理と同じ順で候補打点へ反映する。
      const nuki = (this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0);
      if (nuki > 0 && typeof dryResult.fanshu === 'number') {
        const fanAdd = nuki >= 4 ? 8 : nuki;
        dryResult.hupai.push({ name: nuki >= 4 ? '抜きドラ ×4 [8翻]' : `抜きドラ ×${nuki}`, fanshu: fanAdd });
        dryResult.fanshu += fanAdd;
        const z3Indicators = (this.shan.baopai ?? []).filter((p: any) => toCorePai(p) === 'z3').length
          + (this.lizhi.has(player)
            ? (this.shan.fubaopai ?? []).filter((p: any) => toCorePai(p) === 'z3').length
            : 0);
        if (z3Indicators > 0) {
          const extra = z3Indicators * nuki;
          dryResult.hupai.push({ name: '北ドラ', fanshu: extra });
          dryResult.fanshu += extra;
        }
      }
      this.applyHuapaiEffect(dryResult, player);

      const dryCtx = this._huleChipCtx();
      dryCtx.ronpai = null;
      dryCtx.state = undefined;
      // 冬は候補ごとの既知山順シミュレーターで最善の神ぽっちまで評価するため、
      // 汎用 helper 側では一旦保留状態にして二重計上を防ぐ。
      dryCtx.feverActive = { ...this.feverActive, [player]: true };
      dryCtx.fuyuConsumed = { ...this.fuyuConsumed, [player]: false };
      dryCtx.fuyuRevealState = { 0: null, 1: null, 2: null };
      dryCtx.applyChipOall = dryOall;
      dryCtx.applyChipFromLoser = dryRon;
      applyChipsOnHuleHelper(dryCtx, dryResult, player, null);

      let expected = Math.abs(dryState.chipLedger[player]);
      const fuyuExpected = this.estimateFuyuChipForSwap(player, null, null, from, target);
      expected += fuyuExpected * Math.abs(this.computeChipMultiplier(player, { mode: 'tsumo' }));

      const immediateWhite = kind === 'white' && !ronpai && this.yifaActive[player]
        && this.lastZimoInfo.player === player && !!this.lastZimoInfo.pochi;
      // 祝儀0の即ツモサイコロは裏祝儀1枚より期待値が高い裁定。比較用の保守値。
      if (immediateWhite && expected === 0) expected = 2;
      const diceCount = (dryResult.saiKoroChances ?? [])
        .reduce((sum: number, chance: any) => sum + Math.max(1, Number(chance?.count) || 1), 0);
      if (diceCount > 0) expected += diceCount * 2;
      if (kind === 'deka') expected += 1; // 35枚サイコロは全候補共通なので tie-break 値だけ加える。
      return expected;
    };
    if (this.lizhi.has(player) && isPochiAgariPai && ronSwapAllowed) {
      const swapTargets: string[] = [];
      for (const s of ['m', 'p', 's', 'z']) {
        const len = s === 'z' ? 8 : 10;
        for (let n = 1; n < len; n++) {
          if (!isValidAnmikaTile(s, n)) continue;
          swapTargets.push(`${s}${n}`);
        }
      }
      // 嵌八萬専用。m8 は物理牌 catalog には存在しないが、ぽっちの代用先にはなる。
      swapTargets.push('m8');
      const validCandidates: any[] = [];
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
            r._allmightyPochi = swap;
            if (swap === 'm8' && this.isKanpaman(player, sp._zimo ?? 'z5', 'z5')) {
              r._kanpamanPochi = true;
            }
            r._pochiExpectedChip = estimatePochiChip(r, 'white', 'z5', swap);
            validCandidates.push(r);
          }
        } catch { /* skip */ }
      }
      const maxExpected = validCandidates.length > 0
        ? Math.max(...validCandidates.map((candidate) => candidate._pochiExpectedChip))
        : -Infinity;
      const topCandidates = validCandidates.filter((candidate) => candidate._pochiExpectedChip === maxExpected);
      const explicit = this.pochiSwapChoice[player];
      // 高目は常に自動選択 [リョー裁定 2026-07-17: 協議モーダルは出さない]。
      // 祝儀期待値タイの時は打点 [役満数→翻数] で自動タイブレーク
      const best = (explicit ? topCandidates.find((candidate) => candidate._allmightyPochi === explicit) : null)
        ?? topCandidates.slice().sort((a, b) =>
          ((b.damanguan ?? 0) - (a.damanguan ?? 0))
          || ((typeof b.fanshu === 'number' ? b.fanshu : 0) - (typeof a.fanshu === 'number' ? a.fanshu : 0)))[0]
        ?? null;
      if (best) {
        result = best;
        result.hupai = result.hupai ?? [];
        result.hupai.push({ name: `白ぽっち オールマイティ [${best._allmightyPochi}]${ronpai ? ' [ロン]' : ''}`, fanshu: 0 });
      }
    }
    // でかぽっち オールマイティ: リーチ一発 + ツモ牌 p1/p2 → swap 試行 [高め取り]
    const zimoCore = sp._zimo ? toCorePai(sp._zimo) : null;
    const isDekapochiEligible = !ronpai && this.lizhi.has(player) && this.yifaActive[player]
      && (zimoCore === 'p1' || zimoCore === 'p2');
    if (isDekapochiEligible && zimoCore) {
      const fromSuit = zimoCore[0];
      const fromNum = parseInt(zimoCore[1]);
      const swapTargets: string[] = [];
      for (const s of ['m', 'p', 's', 'z']) {
        const len = s === 'z' ? 8 : 10;
        for (let n = 1; n < len; n++) {
          if (!isValidAnmikaTile(s, n)) continue;
          swapTargets.push(`${s}${n}`);
        }
      }
      swapTargets.push('m8');
      const validCandidates: any[] = [];
      for (const swap of swapTargets) {
        try {
          const spClone = sp.clone();
          const ss = swap[0]; const nn = parseInt(swap[1]);
          if ((spClone._bingpai[fromSuit]?.[fromNum] ?? 0) < 1) continue;
          spClone._bingpai[fromSuit][fromNum] -= 1;
          if (spClone._bingpai[ss][nn] >= 4) continue;
          spClone._bingpai[ss][nn] += 1;
          spClone._zimo = swap;
          let r = Majiang.Util.hule(spClone, null, param);
          if ((!r || !((r.fanshu !== undefined) || ((r.damanguan ?? 0) > 0)))
            && americanChitoiComplete(spClone)) {
            r = { hupai: [{ name: '七対子', fanshu: 2 }], fu: 25, fanshu: 2, damanguan: 0, defen: 0, fenpei: [0, 0, 0, 0] };
          }
          if (r && (r.fanshu !== undefined || (r.damanguan ?? 0) > 0)) {
            r._dekapochiSwap = swap;
            r._dekapochiFrom = zimoCore;
            if (swap === 'm8' && this.isKanpaman(player, zimoCore, zimoCore)) {
              r._kanpamanPochi = true;
            }
            r._pochiExpectedChip = estimatePochiChip(r, 'deka', zimoCore, swap);
            validCandidates.push(r);
          }
        } catch { /* skip */ }
      }
      const maxExpected = validCandidates.length > 0
        ? Math.max(...validCandidates.map((candidate) => candidate._pochiExpectedChip))
        : -Infinity;
      const topCandidates = validCandidates.filter((candidate) => candidate._pochiExpectedChip === maxExpected);
      const explicit = this.pochiSwapChoice[player];
      // 高目は常に自動選択 [リョー裁定 2026-07-17: 白ぽっちと同じく協議モーダルは出さない]。
      // 祝儀期待値タイの時は打点 [役満数→翻数] で自動タイブレーク
      const best = (explicit ? topCandidates.find((candidate) => candidate._dekapochiSwap === explicit) : null)
        ?? topCandidates.slice().sort((a, b) =>
          ((b.damanguan ?? 0) - (a.damanguan ?? 0))
          || ((typeof b.fanshu === 'number' ? b.fanshu : 0) - (typeof a.fanshu === 'number' ? a.fanshu : 0)))[0]
        ?? null;
      if (best) {
        result = best;
        result._dekapochiFrom = zimoCore;
        result.hupai = result.hupai ?? [];
        const color = zimoCore === 'p1' ? '緑' : '黄';
        result.hupai.push({ name: `でかぽっち オールマイティ [${best._dekapochiSwap}] (${color})`, fanshu: 0 });
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
    //   m7 を m1 に置換した sp clone で 再 hule、 majiang-core が認識する 全帯幺 / 純全帯幺 を pick up、
    //   既存 result が同名役なし or fanshu が低いなら上書き
    try {
      // R3 P2 #15 fix: m7 ロン牌も m1 扱いに、 ronpaiWithDir が m7 の case で
      // チャンタ / 純チャンタ / 清老頭 が拾われない bug を修正
      const ronpaiIsM7 = ronpaiWithDir !== null && ronpaiWithDir.startsWith('m7');
      const m7Count = sp._bingpai.m?.[7] ?? 0;
      const fulouHasM7 = (sp._fulou ?? []).some((m: string) => m.startsWith('m') && m.includes('7'));
      if (m7Count > 0 || ronpaiIsM7 || fulouHasM7) {
        const spClone7 = sp.clone();
        spClone7._bingpai.m[1] = (spClone7._bingpai.m[1] ?? 0) + m7Count;
        spClone7._bingpai.m[7] = 0;
        // m7 ツモ和了は _zimo も m1 化しないと hule_mianzi の和了牌 marker が付かず
        // 置換判定ごと全滅する [tingpai 側 1746 行と同じ swap、 2026-07-19 混老頭適用漏れ fix]
        if (spClone7._zimo === 'm7') spClone7._zimo = 'm1';
        if (spClone7._fulou) {
          spClone7._fulou = spClone7._fulou.map((m: string) =>
            m.startsWith('m') && m.includes('7') ? m.replace(/7/g, '1') : m
          );
        }
        const ronpaiSub = ronpaiIsM7 ? ('m1' + ronpaiWithDir!.slice(2)) : ronpaiWithDir;
        const r7 = Majiang.Util.hule(spClone7, ronpaiSub, param);
        if (r7 && r7.hupai) {
          const upgradeNames = ['全帯幺', '純全帯幺', '清老頭', '混老頭'];
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
    // 面前ダマ 三風 / 嵌八萬 / 萬子混一色 等 post-process でしか役満化しない手が 先 reject される bug 解消
    // R12 P1 #9 fix: 白ぽっち allmighty swap 適用後は アガリ牌を _allmightyPochi 置換後の牌に
    // 差し替えて post-process に渡す。 旧 code は 元 z5 を渡してて 三連刻 / 萬子混一色 /
    // オールスター 独自役 が swap 後の手と一致しない bug
    const agariPaiForPost = ((result as any)._allmightyPochi
      ?? (result as any)._dekapochiSwap
      ?? ((result as any)._kanpamanPochi ? 'm8' : null)
      ?? ronpai
      ?? sp._zimo
      ?? null) as string | null;
    // R13 P1 #6 fix: ダブロン chipBreakdown / chipTotal 混入対策
    //  - post-process 前の chipBreakdown 長 を記録、 applyHule で _preBreakdown を slice する基準
    //  - post-process 前の chipLedger snapshot も取って、 applyHule の chipBefore に使う
    //    [preHuleSnapshot は dabuon 全 hule で共有なので、 2 人目 hule の chipBefore が
    //     1 人目 applyChipOall 影響分 [八華 100 オール等] を含まない値になる]
    (result as any)._postProcessChipStart = this.chipBreakdown.length;
    (result as any)._chipLedgerBeforeThis = {
      0: this.chipLedger[0], 1: this.chipLedger[1], 2: this.chipLedger[2],
    };
    this.applyAnmikaYakuPostProcess(result, player, ronpai !== null, agariPaiForPost, fromPlayer, ronpai, param);
    (result as any)._anmikaPostProcessApplied = true;
    if (handUsesBeiMaterial(sp, ronpai) && !resultAllowsBeiMaterial(result)) {
      dlog('[hule reject] 北を手牌構成に使用できない役', { player, ronpai, hupai: result.hupai, fanshu: result.fanshu, damanguan: result.damanguan });
      return null;
    }
    // アンミカ独自: 面前ダマアガリ禁止 [役満を除く]
    // ルール 1.1 「面前時のダマアガリ不可、 副露後のダマは可、 国士・天和・地和・人和はダマOK」
    // WSA: 暗槓のみは門前扱い [isMenzenHand]
    const hasFulou = !isMenzenHand(sp);
    const isYakuman = result.damanguan && result.damanguan > 0;
    if (!hasFulou && !this.lizhi.has(player) && !resultAllowsMenzenDama(result)) {
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
    if (result.fanshu !== undefined && !(result as any)._anmikaCompleteDoraCount) {
      const isLizhiAgari = this.lizhi.has(player);
      const computeNext = (ind: string): string => {
        const i = toCorePai(ind);
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
    (result as any)._akiRevealCount = akiRevealCount;
    // R9 P1 #2: 役満 reject 前に既に走らせてる場合 skip [重複呼出防止]
    if (!(result as any)._anmikaPostProcessApplied) {
      this.applyAnmikaYakuPostProcess(result, player, ronpai !== null, ronpai ?? sp._zimo ?? null, fromPlayer, ronpai, param);
    }
    // アンミカ華牌 [春夏秋冬] の打点効果
    this.applyHuapaiEffect(result, player);
    // フィーバー立直: tier 2/3/4 は 打点 + 祝儀を末尾で ×2/×4/×8
    // [リョー指示 2026-05-12: fanshu 加算じゃなく 最終 defen / chip 倍率、 例 10翻 baiman × 2]
    if (this.feverActive[player]) {
      result.hupai = result.hupai ?? [];
      const tier = this.feverTier[player];
      const tierLabel = tier === 4 ? 'クアドラプル' : tier === 3 ? 'トリプル' : tier === 2 ? 'ダブル' : '';
      result.hupai.push({ name: `${tierLabel}フィーバー立直`, fanshu: 0 });
      if (tier >= 2 && result.fanshu !== undefined) {
        const mul = tier === 4 ? 8 : tier === 3 ? 4 : 2;
        // defen / defen3 を ×mul
        if (typeof result.defen === 'number') result.defen = result.defen * mul;
        if (typeof result.defen3 === 'number') result.defen3 = result.defen3 * mul;
        if (result.fenpei) result.fenpei = result.fenpei.map((x: number) => x * mul);
        result.hupai.push({ name: `${tierLabel}フィーバー [打点 ×${mul}]`, fanshu: 0 });
      }
    }
    delete (result as any)._anmikaCompleteDoraCount;
    if (typeof result === 'object') {
      this._huleRevealStateByResult.set(result, {
        shan: this.shan.snapshot(),
        akiUsedCount: { ...this.akiUsedCount },
        effectiveHuapai: this.effectiveHuapaiAtHule(player),
      });
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
    // hule が成立していない評価用オブジェクトへ、秋の表示や夏の倍率だけを
    // 書き込んではならない。役満は fanshu が未定義なので damanguan も見る。
    if (!result || (result.fanshu === undefined && (result.damanguan ?? 0) <= 0)) return;
    // ルール 2-2: ドラ表示牌の華牌もアガリ時に抜いたものとして計算
    // [リーチアガリ時のみ裏ドラの華も追加]
    const hua = this.effectiveHuapaiAtHule(player);
    const haru = hua.filter((p) => p === 'f1').length;
    const natsu = hua.filter((p) => p === 'f2').length;
    const aki = hua.filter((p) => p === 'f3').length;
    const fuyu = hua.filter((p) => p === 'f4').length;
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
    if (natsuKinpeiActive) (result as any)._pointPaymentMultiplier = 4;
    const natsuEffect = natsu + (isNatsuKinpei && natsu === 1 ? 1 : 0);  // 夏金北単体 = natsu=2 相当
    // 夏: 打点ランクアップ N 段 [マンガン未満なら直接マンガン、 マンガン以降は段階アップ]
    if (natsuEffect > 0 && !natsuKinpeiActive && (result.damanguan ?? 0) > 0) {
      const beforeBase = Number((result as any)._basePointOverride) > 0
        ? Number((result as any)._basePointOverride)
        : 8000 * (result.damanguan ?? 1);
      // 本役満の次は五倍満 [10000]、さらに次は六倍満 [12000]。
      // 複合役満を夏で減額しないため、既存基本点より小さい override は設定しない。
      const promotedBase = natsuEffect >= 2 ? 12000 : 10000;
      const afterBase = Math.max(beforeBase, promotedBase);
      (result as any)._basePointOverride = afterBase;
      const labelN = natsuEffect === 1 ? '夏' : natsuEffect === 2 ? '夏夏' : `夏×${natsuEffect}`;
      const kinpeiNote = isNatsuKinpei && natsu === 1 ? ' [夏金北]' : '';
      result.hupai.push({
        name: `${labelN}${kinpeiNote} [本役満ランクアップ ${beforeBase}→${afterBase}基本点]`,
        fanshu: 0,
      });
    } else if (natsuEffect > 0 && !natsuKinpeiActive && result.fanshu !== undefined) {
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
  applyAnmikaYakuPostProcess(result: any, player: PlayerId, isRon: boolean, agariPai: string | null = null, fromPlayer: PlayerId | null = null, ronpaiOrig: string | null = null, huleParam: any = null): void {
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
      const dekapochi = (result as any)._dekapochiSwap as string | undefined;
      const swapTarget = allmighty ?? dekapochi;
      const swapFrom = allmighty ? 'z5' : ((result as any)._dekapochiFrom as string | undefined);
      if (swapTarget && swapFrom && swapTarget.length >= 2) {
        const sCh = swapTarget[0];
        const nN = parseInt(swapTarget[1], 10);
        const fromCore = toCorePai(swapFrom);
        const fromSuit = fromCore[0];
        const fromNum = parseInt(fromCore[1] === '0' ? '5' : fromCore[1], 10);
        if ((sCh === 'm' || sCh === 'p' || sCh === 's' || sCh === 'z') && Number.isFinite(nN)) {
          // ツモった白ぽっち / でかぽっちを採用候補へ置換した物理 view。
          if ((fromSuit === 'm' || fromSuit === 'p' || fromSuit === 's' || fromSuit === 'z')
              && Number.isFinite(fromNum) && (base[fromSuit][fromNum] ?? 0) > 0) {
            base[fromSuit][fromNum] -= 1;
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
      const ronView = isRon && (result as any)._kanpamanPochi
        ? 'm8'
        : ((isRon && ronpaiOrig) ? toCorePai(ronpaiOrig) : (isRon ? toCorePai(agariPai ?? '') : null));
      if (ronView && ronView.length >= 2) {
        const sCh = ronView[0];
        const nN = parseInt(ronView[1], 10);
        if ((sCh === 'm' || sCh === 'p' || sCh === 's' || sCh === 'z') && Number.isFinite(nN)) {
          base[sCh][nN] = (base[sCh][nN] ?? 0) + 1;
        }
      }
      return base;
    })();

    // 嵌八萬 [かんぱーまん]: m7/m9 持ち + アガリ牌 z5 [ぽっち経由 m8、 山に m8 はない]
    const claimIdentity = claimTileIdentity(isRon ? ronpaiOrig : null);
    const kanpamanFrom: string = ((result as any)._dekapochiSwap === 'm8'
      ? ((result as any)._dekapochiFrom as string | undefined)
      : 'z5') ?? 'z5';
    const kanpamanAgariPai: string | null = (result as any)._kanpamanPochi
      ? kanpamanFrom
      : ((isRon && claimIdentity.core === 'z5' ? claimIdentity.raw : agariPai) ?? null);
    if (this.lizhi.has(player) && this.isKanpaman(player, kanpamanAgariPai, kanpamanFrom)) {
      if (!isRon) {
        result.hupai.push({ name: '嵌八萬 [本役満ツモ]', fanshu: '*' });
        result.fanshu = undefined;
        result.damanguan = (result.damanguan ?? 0) + 1;
      } else {
        result.hupai.push({ name: '嵌八萬', fanshu: 8 });
        if (result.fanshu !== undefined) result.fanshu += 8;
      }
      // 789 三色完成 [m789 + p789 + s789] → +4 翻
      if (sp._bingpai.p[7] >= 1 && sp._bingpai.p[8] >= 1 && sp._bingpai.p[9] >= 1 &&
          sp._bingpai.s[7] >= 1 && sp._bingpai.s[8] >= 1 && sp._bingpai.s[9] >= 1) {
        result.hupai.push({ name: '789 三色 [嵌八萬複合]', fanshu: 4 });
        if (result.fanshu !== undefined) result.fanshu += 4;
        (result as any)._kanpaman789 = true;
      }
      // 嵌八萬 + チャンタ: m7→m1 置換では z5 が壊れるため z5→m8 swap で再判定
      const hasChantaAlready = result.hupai.some((h: any) =>
        h.name?.includes('全帯') || h.name?.includes('純全'));
      if (!hasChantaAlready && typeof result.fanshu === 'number' && huleParam) {
        try {
          const spKP = sp.clone();
          const isTsumoKP = !isRon;
          if (isTsumoKP && (spKP._bingpai.z[5] ?? 0) > 0) {
            spKP._bingpai.z[5] -= 1;
          }
          spKP._bingpai.m[8] = (spKP._bingpai.m[8] ?? 0) + 1;
          const m7left = spKP._bingpai.m[7] ?? 0;
          if (m7left > 1) {
            spKP._bingpai.m[1] = (spKP._bingpai.m[1] ?? 0) + (m7left - 1);
            spKP._bingpai.m[7] = 1;
          }
          if (isTsumoKP) spKP._zimo = 'm8';
          const diff = fromPlayer === null ? 0 : (fromPlayer - player + 3) % 3;
          const dir = diff === 1 ? '+' : diff === 2 ? '-' : '';
          const ronKP = isTsumoKP ? null : `m8${dir}`;
          const rKP = Majiang.Util.hule(spKP, ronKP, huleParam);
          if (rKP?.hupai) {
            for (const h of rKP.hupai) {
              if (h.name?.includes('全帯') || h.name?.includes('純全')) {
                result.hupai.push({ ...h, name: h.name + ' [嵌八萬複合]' });
                if (typeof h.fanshu === 'number') result.fanshu += h.fanshu;
                break;
              }
            }
          }
        } catch { /* skip */ }
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
      const noNuki = ((this.nukidora[player] ?? 0) + (this.nukidoraGold[player] ?? 0)) === 0;
      const noVisibleHua = this.effectiveHuapaiAtHule(player).length === 0;
      if (onlyLizhi && noDoraNoBaopai && noNuki && noVisibleHua) {
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
      // ロン成立時も「親役満ツモ」と同じ二家払いで精算する。
      (result as any)._treatAsTsumo = true;
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

    // 混老対: 混老頭そのものを 6 翻役へ置換する。七対子・対々和は通常どおり別計上。
    const honroutou = result.hupai.find((h: any) => h.name === '混老頭');
    if (honroutou) {
      const oldFan = typeof honroutou.fanshu === 'number' ? honroutou.fanshu : 2;
      honroutou.name = '混老対 [6翻]';
      honroutou.fanshu = 6;
      if (result.fanshu !== undefined) result.fanshu += 6 - oldFan;
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

    // チャンタ [全帯幺] 4/2 + 純チャンタ [純全帯幺] 6/4 [アンミカ独自翻数]
    const fixYakuFan = (oldName: string, newName: string, menzenFan: number, fuluFan: number) => {
      const idx = result.hupai.findIndex((h: any) => h.name.startsWith(oldName));
      if (idx >= 0) {
        const newFan = isMenzen ? menzenFan : fuluFan;
        const oldFan = result.hupai[idx].fanshu ?? 0;
        result.hupai[idx] = { name: newName, fanshu: newFan };
        if (typeof oldFan === 'number' && result.fanshu !== undefined) result.fanshu += (newFan - oldFan);
      }
    };
    fixYakuFan('混全帯幺', 'チャンタ', 4, 2);
    fixYakuFan('純全帯幺', '純チャンタ', 6, 4);
    fixYakuFan('両立直', 'ダブリー', 4, 4);

    // サイコロチャンス記録 [リョー指示: 画面実装は後回し、 記録のみ]
    result.saiKoroChances = result.saiKoroChances ?? [];
    const saiMode: 'tsumo' | 'ron' = isRon ? 'ron' : 'tsumo';
    const registeredSaiAwardKeys = new Set<string>(
      result.saiKoroChances
        .map((chance: any) => chance?.awardKey)
        .filter((key: unknown): key is string => typeof key === 'string'),
    );
    const addSai = (
      awardKey: string,
      name: string,
      baseChip: 70 | 140 | 35 | 100 | 300,
      shuvariApplicable: boolean,
      count: number = 1,
      plusMinus: '+' | '-' = '+',
      alwaysShuvari: boolean = false,
    ) => {
      if (registeredSaiAwardKeys.has(awardKey)) return;
      registeredSaiAwardKeys.add(awardKey);
      result.saiKoroChances.push({ awardKey, name, baseChip, shuvariApplicable, alwaysShuvari, count, plusMinus, mode: saiMode });
    };
    const YAKUMAN_SAI_BASE = {
      カラス: 140,
      八連荘: 140,
      天和: 140,
      地和: 140,
      人和: 140,
      その他本役満: 70,
    } as const;
    // 天和・地和・人和は 140 枚・常時シュバ・二度 [独立 2 セッション]。
    const TENHOU_FAMILY_SAI_COUNT = 2;
    const dedicatedYakumanAwards = [
      { role: 'カラス', awardKey: 'yakuman:カラス', name: 'カラス [出目当て効果 ×2]', baseChip: YAKUMAN_SAI_BASE.カラス, shuvariApplicable: true, count: 1, yakumanUnits: 1 },
      { role: '八連荘', awardKey: 'yakuman:八連荘', name: '八連荘', baseChip: YAKUMAN_SAI_BASE.八連荘, shuvariApplicable: true, count: 1, yakumanUnits: 1 },
      { role: '天和', awardKey: 'yakuman:天和', name: '天和', baseChip: YAKUMAN_SAI_BASE.天和, shuvariApplicable: false, alwaysShuvari: true, count: TENHOU_FAMILY_SAI_COUNT, yakumanUnits: 2 },
      { role: '地和', awardKey: 'yakuman:地和', name: '地和', baseChip: YAKUMAN_SAI_BASE.地和, shuvariApplicable: false, alwaysShuvari: true, count: TENHOU_FAMILY_SAI_COUNT, yakumanUnits: 2 },
      { role: '人和', awardKey: 'yakuman:人和', name: '人和', baseChip: YAKUMAN_SAI_BASE.人和, shuvariApplicable: false, alwaysShuvari: true, count: TENHOU_FAMILY_SAI_COUNT, yakumanUnits: 2 },
    ] as const;
    const hasAwardRole = (role: string): boolean => result.hupai.some(
      (h: any) => typeof h.name === 'string' && h.name.startsWith(role),
    );
    const registerDedicatedYakuman = (role: string): void => {
      const award = dedicatedYakumanAwards.find((candidate) => candidate.role === role);
      if (!award || !hasAwardRole(award.role)) return;
      addSai(award.awardKey, award.name, award.baseChip, award.shuvariApplicable, award.count, '+', 'alwaysShuvari' in award && award.alwaysShuvari);
    };
    // R9 P1 #3 fix: 三連刻 / 本役満アガリ saiKoro 抽出を 全 post-process の 最後 に移動
    // [元: ここ 1867-1884、 移動先: 関数末尾 「本役満 / 三連刻 サイコロ抽出」]
    // 嵌八萬ツモ [本役満] = 既に damanguan>=1 で記録済
    // リーのみ [カラス] = 出目当て効果 2 倍 [サイコロチャンス記録 + flag]
    registerDedicatedYakuman('カラス');
    // 八連荘 [親アガリ 8 本場+] = 140 chip サイコロ
    registerDedicatedYakuman('八連荘');
    // 嵌八萬+789: ツモは本役満分と別にもう1回、ロンは140枚を1回。
    if ((result as any)._kanpaman789) {
      if (isRon) addSai('kanpaman:789-ron', '嵌八萬+789 [ロン]', 140, true, 1);
      else addSai('kanpaman:789-extra', '嵌八萬+789 [追加]', 70, true, 1);
    }
    // 白ぽっち即ツモの祝儀 0 枚サイコロは applyHule で chip 集計後に判定する。
    // オールスター: 赤 5p + 赤 5s + 金 5p + 金 5s 揃い [bingpai[s][0] には金分も含まれる、
    // 純粋な赤は bingpai[s][0] - goldHand[s] で算出]
    // R9 P1 #1 fix: ロン時 ronpai が p0 / s0 [赤] や gp / gs [金] の場合 _bp 経由で 含む。
    // ロン牌の金 / 赤は result が保持する物理 claim tile から判別する。
    const calledPhysicalTiles = (sp._anmikaFulou ?? [])
      .map((entry: any) => entry?.taken)
      .filter((tile: unknown): tile is string => typeof tile === 'string');
    // goldHand follows tiles dealt/drawn by this player (including tiles
    // moved from their own hand into a meld). A called river tile is stored
    // only in _anmikaFulou.taken, so include that physical source explicitly.
    const calledGoldP = calledPhysicalTiles.filter((tile: string) => tile === 'gp').length;
    const calledGoldS = calledPhysicalTiles.filter((tile: string) => tile === 'gs').length;
    const goldP = (this.goldHand[player].p ?? 0) + calledGoldP;
    const goldS = (this.goldHand[player].s ?? 0) + calledGoldS;
    const ronGoldP = isRon && claimIdentity.goldSuit === 'p' ? 1 : 0;
    const ronGoldS = isRon && claimIdentity.goldSuit === 's' ? 1 : 0;
    const fulouZeroCount = (suit: 'p' | 's'): number => (sp._fulou ?? []).reduce(
      (sum: number, m: string) => sum + (String(m)[0] === suit ? (String(m).match(/0/g)?.length ?? 0) : 0),
      0,
    );
    const hasRed5p = ((_bp.p[0] ?? 0) + fulouZeroCount('p') - goldP - ronGoldP) >= 1;
    const hasRed5s = ((_bp.s[0] ?? 0) + fulouZeroCount('s') - goldS - ronGoldS) >= 1;
    const hasGold5p = (goldP + ronGoldP) >= 1;
    const hasGold5s = (goldS + ronGoldS) >= 1;
    if (hasRed5p && hasRed5s && hasGold5p && hasGold5s) {
      // 虹牌の枚数でサイコロ回数を増やす (4→5→6→7回)
      const nijiInHand = countNijiInHand(sp);
      const nijiFromOwnHandInFulou = (sp._anmikaFulouPhysical ?? []).reduce(
        (sum: number, physical: any) => sum + (physical?.consumed ?? []).filter((p: string) => isNijiPai(p)).length,
        0,
      );
      const nijiCalledFromRiver = calledPhysicalTiles.filter((p: string) => isNijiPai(p)).length;
      const ronNiji = isRon && isNijiPai(claimIdentity.raw ?? '') ? 1 : 0;
      const totalNiji = nijiInHand.total + nijiFromOwnHandInFulou + nijiCalledFromRiver + ronNiji;
      const saiRollCount = 4 + totalNiji;
      addSai('オールスター', 'オールスター', 70, true, 1);
      if (totalNiji === 3) {
        // オールオールスター: 赤2+金2+虹3 → 77枚オール追加 (全倍率適用)
        result.hupai.push({ name: 'オールオールスター [赤金虹 全揃い]', fanshu: 0 });
        this.applyChipOall(player, 77, { label: 'オールオールスター 77枚' });
      } else {
        result.hupai.push({ name: `オールスター [赤金 4 枚揃い${totalNiji > 0 ? ` + 虹${totalNiji}` : ''}]`, fanshu: 0 });
      }
      if (saiRollCount > 4) {
        result.saiKoroChances = result.saiKoroChances ?? [];
        const existing = result.saiKoroChances.find((c: any) => c.awardKey === 'オールスター');
        if (existing) existing.rollCount = saiRollCount;
      }
    }

    // キング・オブ・アンミカ: 全12種の物理特殊牌を含む和了 [称号のみ、祝儀なし]。
    const kingTiles = ['p0', 's0', 'gp', 'gs', 'gN', 'np3', 'ns3', 'nz3', 'z5b', 'z5r', 'z5g', 'z5y'] as const;
    const physicalSeen = new Set<string>();
    const addPhysical = (raw: unknown): void => {
      if (typeof raw !== 'string') return;
      const stripped = raw.replace(/[\+=\-_*]/g, '');
      if ((kingTiles as readonly string[]).includes(stripped)) physicalSeen.add(stripped);
    };
    const expanded = sp._bingpai?.__anmika ?? {};
    for (const tile of kingTiles) {
      if (tile !== 'p0' && tile !== 's0' && (expanded[tile] ?? 0) > 0) addPhysical(tile);
    }
    // core の 0 は赤と金を合算するため、expanded の金在庫との差分で赤を判別する。
    if ((_bp.p?.[0] ?? 0) - (expanded.gp ?? 0) - ronGoldP > 0) addPhysical('p0');
    if ((_bp.s?.[0] ?? 0) - (expanded.gs ?? 0) - ronGoldS > 0) addPhysical('s0');
    for (const physical of sp._anmikaFulouPhysical ?? []) {
      for (const tile of physical?.consumed ?? []) addPhysical(tile);
    }
    for (const called of sp._anmikaFulou ?? []) addPhysical(called?.taken);
    // 副露文字列の 0 から、physical metadata で金と判明した枚数を引いた残りが赤。
    const furoPhysical = [
      ...(sp._anmikaFulouPhysical ?? []).flatMap((p: any) => p?.consumed ?? []),
      ...(sp._anmikaFulou ?? []).map((p: any) => p?.taken),
    ];
    const furoGoldP = furoPhysical.filter((p: string) => p === 'gp').length;
    const furoGoldS = furoPhysical.filter((p: string) => p === 'gs').length;
    if (fulouZeroCount('p') > furoGoldP) addPhysical('p0');
    if (fulouZeroCount('s') > furoGoldS) addPhysical('s0');
    if (isRon) addPhysical(claimIdentity.raw);
    if (kingTiles.every((tile) => physicalSeen.has(tile))) {
      result.hupai.push({ name: 'キング・オブ・アンミカ', fanshu: 0 });
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
        const agariCore = toCorePai(agariPai);
        const normalizedAgari = agariCore === 'm7' ? 'm1' : agariCore;
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
          const core = toCorePai(stripped);
          const normalized = core === 'm7' ? 'm1' : core;
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

    // 純正九蓮: 和了前 13 枚が 1112345678999 の九面待ちで、同色牌の自河フリテンなし。
    // ツモかロンかでは判定しない [majiang-core の純正判定も同じ形を見る]。
    const jiulian = result.hupai.find((h: any) => typeof h.name === 'string' && h.name.includes('九蓮宝燈'));
    if (jiulian) {
      const pureSuit = (['m', 'p', 's'] as const).find((s) => {
        const counts = [...(sp._bingpai[s] ?? [])];
        if (!isRon && agariPai && toCorePai(agariPai)[0] === s) {
          const n = Number(toCorePai(agariPai)[1] === '0' ? 5 : toCorePai(agariPai)[1]);
          if (Number.isFinite(n) && (counts[n] ?? 0) > 0) counts[n] -= 1;
        }
        const expected = [3, 1, 1, 1, 1, 1, 1, 1, 3];
        return expected.every((n, i) => (counts[i + 1] ?? 0) === n)
          && (['m', 'p', 's'] as const).every((other) => other === s
            || (sp._bingpai[other] ?? []).every((n: number) => (n ?? 0) === 0))
          && (sp._bingpai.z ?? []).every((n: number) => (n ?? 0) === 0)
          && (sp._fulou?.length ?? 0) === 0;
      });
      const ownHe = this.he.get(player);
      const isJiulianFuriten = !!pureSuit && (ownHe?._pai ?? []).some((raw: string) => {
        const core = toCorePai(String(raw).replace(/[\+=\-_*]/g, ''));
        return core[0] === pureSuit && /^[1-9]$/.test(core[1] ?? '');
      });
      const shouldBeDouble = !!pureSuit && !isJiulianFuriten;
      const wasDouble = jiulian.fanshu === '**' || String(jiulian.name).includes('純正');
      if (shouldBeDouble && !wasDouble) result.damanguan = (result.damanguan ?? 0) + 1;
      if (!shouldBeDouble && wasDouble) result.damanguan = Math.max(1, (result.damanguan ?? 1) - 1);
      jiulian.name = shouldBeDouble ? '純正九蓮宝燈 [ダブル役満]' : '九蓮宝燈';
      jiulian.fanshu = shouldBeDouble ? '**' : '*';
    }

    // 天和 / 地和 [diyizimo + ツモ] = ダブル役満
    // 2026-05-14 codex review fix: 現親判定で 子アガリ後局の天和/地和 ダブル昇格を正しく
    if (this.isFirstTurnTsumoEligible(player) && !isRon) {
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
    if (this.isRenhouEligible(player) && isRon) {
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

    // 裸単騎: 手牌が雀頭だけなら、4 面子に暗槓が混じっていても成立する。
    if ((sp._fulou?.length ?? 0) === 4) {
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
    // 副露時 chip 半減 [鳴き四華 35 / 鳴き八華 70]。八華四北の300枚は副露でも固定。
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
    if (huaCount >= 8 && nukiTotal >= 4) {
      // 複合時は八華100+追加200ではなく、八華四北300を一度だけ記録する。
      this.applyChipOall(player, 300, { bypassShuvari: true, label: '八華四北 300枚オール' });
      result.hupai.push({ name: '八華四北 [+300オール]', fanshu: 0 });
      for (let i = 1; i <= 3; i++) addSai(`八華四北:${i}`, `八華四北 ${i}/3`, 70, false, 1);
    } else if (huaCount >= 8) {
      this.applyChipOall(player, 100, { bypassShuvari: true, label: '八華 100枚オール' });
      result.hupai.push({ name: '八華 [+100オール]', fanshu: 0 });
      // 鳴いていても八華は70枚を独立2回。
      addSai('八華:1', '八華 1/2', 70, true, 1);
      addSai('八華:2', '八華 2/2', 70, true, 1);
    } else if (hasAll4Hua && nukiTotal >= 4) {
      this.applyChipOall(player, 100, { bypassShuvari: true, label: '四華四北 100枚オール' });
      result.hupai.push({ name: '四華四北 [+100オール]', fanshu: 0 });
      // 鳴き四華四北は35枚と70枚を各1回。面前なら70枚を独立2回。
      addSai('四華四北:1', '四華四北 1/2', hasFulou ? 35 : 70, false, 1);
      addSai('四華四北:2', '四華四北 2/2', 70, false, 1);
    } else if (hasAll4Hua) {
      addSai('四華', '四華', hasFulou ? 35 : 70, true);
    } else if (nukiTotal >= 4) {
      addSai('四北', '四北', 70, true);
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
      addSai('白暗カンアガリ', '白暗カンアガリ', 70, true);
    }
    // R9 P1 #3 fix: 全 post-process 完了後に 「本役満 / 三連刻 / 三色同刻」 のサイコロ抽出を実行、
    // 旧 code は 三連刻 / 四連刻 / 萬子混一色 検出 前 に走らせてて これら役の本役満 saiKoro 発火しなかった
    // R10 P0 #4 fix: 三連刻 / 三色同刻 は post-process で suffix 付き [例: '三連刻 [m1-3]'、
    // '三色同刻 [アンミカ 4翻]'] に改名されるため、 完全一致では 拾えない。 includes で判定
    if (isMenzen) {
      if (result.hupai.some((h: any) => typeof h.name === 'string' && h.name.startsWith('三連刻'))) addSai('三連刻', '三連刻', 70, true);
      if (result.hupai.some((h: any) => typeof h.name === 'string' && h.name.startsWith('三色同刻'))) addSai('三色同刻', '三色同刻', 70, true);
    }
    const hasYakumanMarker = (result.hupai ?? []).some((h: any) => h.fanshu === '*' || h.fanshu === '**');
    if ((result.damanguan ?? 0) >= 1 || hasYakumanMarker) {
      // 天和系は後段で役名が確定するため、ここで全専用役を再走査する。
      // 先に登録済みのカラス・八連荘は awardKey で no-op になる。
      for (const award of dedicatedYakumanAwards) registerDedicatedYakuman(award.role);
      const dedicatedYakumanUnits = dedicatedYakumanAwards
        .filter((award) => hasAwardRole(award.role))
        .reduce((sum, award) => sum + award.yakumanUnits, 0);
      const totalYakumanUnits = Math.max(hasYakumanMarker ? 1 : 0, result.damanguan ?? 0);
      const genericYakumanCount = Math.max(0, totalYakumanUnits - dedicatedYakumanUnits);
      if (genericYakumanCount > 0) {
        addSai('yakuman:その他本役満', '本役満アガリ', YAKUMAN_SAI_BASE.その他本役満, false, genericYakumanCount);
      }
    }
  }

  /** ドラ表示牌から 「次の牌」 を決定し、 sp の手牌中 該当牌の数を返す
   *  expanded tile は core 牌へ normalize してから次の牌を計算 */
  countDoraFromIndicator(sp: any, indicator: string, ronpai: string | null = null): number {
    if (!sp || !indicator) return 0;
    const ind = toCorePai(indicator);
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
    let count = sp._bingpai[s]?.[nextN] ?? 0;

    // This helper is used by the American-seven-pairs fallback, where
    // majiang-core did not produce a result and therefore did not count dora
    // for us. Keep it complete for callers that provide a melded hand too.
    for (const mianzi of sp._fulou ?? []) {
      const stripped = String(mianzi).replace(/[+=\-_*]/g, '');
      if (stripped[0] !== s) continue;
      for (const digit of stripped.slice(1)) {
        const tileN = digit === '0' ? 5 : Number(digit);
        if (tileN === nextN) count += 1;
      }
    }

    // A ron tile is passed separately to majiang-core and is not present in
    // sp._bingpai. The fallback must add it explicitly, including expanded
    // identities such as gp/np3/z5b.
    if (ronpai) {
      const ronCore = toCorePai(String(ronpai).replace(/[+=\-_*]/g, ''));
      const ronN = ronCore[1] === '0' ? 5 : Number(ronCore[1]);
      if (ronCore[0] === s && ronN === nextN) count += 1;
    }
    return count;
  }

  /** 三麻の点数移動を適用。 result は majiang-core の hule 戻り値、 winner はアガリ家、 loser は放銃家 [ロン時]。
   *  3 麻独自計算: base 点 = fu * 2^(fanshu+2) [上限 mangan 2000、 役満 8000+]、
   *  親ロン = base*6、 子ロン = base*4、 親ツモ = 子 each base*2 [×2人]、
   *  子ツモ = 親 base*2 + 他子 base*1。 100 の位切り上げ。 */
  applyHule(result: any, winner: PlayerId, loser: PlayerId | null): void {
    if (!result) return;
    // シュバリー宣言牌への放銃はリーチ不成立と同じ扱いで、シュバ権を消費しない
    // [リョー指摘 2026-07-17: 宣言牌放銃でシュバ棒が消える]。
    // lizhiDeclareDapai は宣言者の次の自打牌まで true のため、コレが立ったまま
    // 放銃 = 宣言牌そのものへのロンと判定できる。lateシュバは宣言牌通過後にしか
    // 宣言できないので誤返金はない
    if (loser !== null && this.lizhiDeclareDapai[loser] && this.shuvariActive[loser]) {
      this.shuvariActive[loser] = false;
      this.shuvariUsed[loser] = false;
      this.events.push({ type: 'shuvariRefund', player: loser } as any);
    }
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
    // フィーバー tier 倍率 [tier 2/3/4 = ×2/×4/×8]、最終打点に乗る。
    const feverMul = this.feverActive[winner]
      ? (this.feverTier[winner] === 4 ? 8 : this.feverTier[winner] === 3 ? 4 : this.feverTier[winner] === 2 ? 2 : 1)
      : 1;
    const pointEvaluation = evaluateWinPoints({
      result,
      winner,
      loser,
      oya: oyaSeat,
      benbang: this.state.benbang,
      feverMultiplier: feverMul,
      pointMultiplier: Number((result as any)._pointPaymentMultiplier ?? 1),
      reverse: isPochiReverse,
    });
    for (const p of [0, 1, 2] as PlayerId[]) this.state.defen[p] += pointEvaluation.deltas[p];
    let winnerGain = pointEvaluation.winnerGain;
    (result as any)._pointPaymentMultiplierApplied = true;
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
        // Reverse-pochi tsumo can make the winner self-bust.  The match ends,
        // but no opponent is awarded a tobi prize for that self-inflicted loss.
        if (p === winner && isPochiReverse && loser === null) continue;
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
    // ぽっちツモのサイコロは 2 系統が独立して存在する [リョー裁定 2026-07-17、65アンミカルール §4-1]:
    //  A) ぽっちツモ + その和了の祝儀 0 枚 → 救済サイコロ [一発は不要]
    //  B) 即ぽっちツモ [一発中] → サイコロ [祝儀の有無と無関係]
    // 両立時は 2 セッション。base はどちらも 70 で固定し、
    // 色の増減 [青=+2 / 赤=-2 / 緑=+1 / 黄=-1、即赤=-140 等] は
    // pochiMultiplier [applyChipOall の chip 倍率] が符号込みで自動適用する。
    // ここで 140 や '-' を焼き込むと倍率と二重掛けになる [280 事故] ので厳禁。
    // [2026-05-21 fix] commit 4d1f476f で z5b/z5r/z5g/z5y を 独立 牌化したため、
    // _zimo / lastZimoInfo.pai は z5b 等 raw 文字列で入る。 toCorePai で z5 正規化して比較。
    const sp_w = this.shoupai.get(winner);
    const zimoIsZ5 = sp_w?._zimo ? toCorePai(sp_w._zimo) === 'z5' : false;
    const lastZimoIsZ5 = this.lastZimoInfo.pai
      ? toCorePai(this.lastZimoInfo.pai as string) === 'z5'
      : false;
    const isPochiTsumo =
      loser === null
      && zimoIsZ5
      && this.lastZimoInfo.player === winner
      && lastZimoIsZ5
      && !!this.lastZimoInfo.pochi;
    if (isPochiTsumo && chipDelta === 0) {
      result.saiKoroChances = result.saiKoroChances ?? [];
      result.saiKoroChances.push({ awardKey: '白ぽっちツモ祝儀0', name: '白ぽっちツモ祝儀 0 枚', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'tsumo' });
    }
    if (isPochiTsumo && this.yifaActive[winner]) {
      result.saiKoroChances = result.saiKoroChances ?? [];
      result.saiKoroChances.push({ awardKey: '白ぽっち即ツモ', name: '白ぽっち即ツモ', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'tsumo' });
    }
    // でかぽっち即ツモ → サイコロ base 35 [70×0.5]。2p [黄扱い] の -35 は
    // ツモ時に applyPochiColorMultiplier(yellow) 済みの倍率が自動で符号反転する
    const zimoCoreDeka = sp_w?._zimo ? toCorePai(sp_w._zimo) : null;
    const isDekapochiTsumo =
      loser === null
      && this.yifaActive[winner]
      && this.lizhi.has(winner)
      && (zimoCoreDeka === 'p1' || zimoCoreDeka === 'p2')
      && (result.hupai ?? []).some((h: any) => h.name?.includes('でかぽっち'));
    if (isDekapochiTsumo) {
      result.saiKoroChances = result.saiKoroChances ?? [];
      result.saiKoroChances.push({ awardKey: 'でかぽっち', name: 'でかぽっち', baseChip: 35, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'tsumo' });
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
   *  ドラ表示牌の隣にあたる山の深い側から上段を1枚ずつ開き、
   *  winner 現物 [bingpai + 抜きドラ z4 + 抜き華] と一致したら chip
   *  - アリス [冬1枚]: 通常牌は現物のみ、 0 hit で終了
   *  - チューリップ [冬2枚]: + 隣接 ±1 [m7↔m9 循環、 m8=z5 代用]、 0 hit or 山尽きまで
   *  - 冬冬金北: 上下段 ペア、 上下計 0 hit で終了
   *  - 華 [f1-f4]: winner.huapai.length 分 hit
   *  - 副露時: chip 半減 [+1 / hit、 通常 +2 / hit] */
  applyFuyuChip(winner: PlayerId, loser: PlayerId | null, fuyuCount: number, hasKinpei: boolean): FuyuAdvanceResult {
    return applyFuyuChipHelper(this._huleChipCtx(), winner, loser, fuyuCount, hasKinpei);
  }

  getPendingFuyuKamiPochi(winner: PlayerId): KamiPochiPendingChoice | null {
    const state = this.fuyuRevealState[winner];
    const pending = state?.pendingChoice;
    if (!state || !pending) return null;
    return this.createKamiPochiPending(winner, 'fuyu', pending.occurrenceKey);
  }

  resumeFuyuKamiPochi(winner: PlayerId, occurrenceKey: string, target: string): FuyuAdvanceResult | null {
    const state = this.fuyuRevealState[winner];
    if (!state || state.complete || state.pendingChoice?.occurrenceKey !== occurrenceKey) return null;
    if (!this.getKamiPochiCandidates('fuyu').includes(target)) return null;
    const advance = applyFuyuChipHelper(
      this._huleChipCtx(),
      winner,
      state.loser,
      state.fuyuCount,
      state.hasKinpei,
      { occurrenceKey, target },
    );
    if (advance.status === 'complete' && this.feverActive[winner] && this.fuyuConsumed[winner]) {
      this.endFever(winner);
    }
    return advance;
  }

  clearFuyuRevealState(winner: PlayerId): void {
    this.fuyuRevealState[winner] = null;
  }

  /** オールマイティ候補比較用。既知の山順で冬を最後まで仮走査し、正ぽっちは最善の任意牌を選ぶ。 */
  estimateFuyuChipForSwap(
    winner: PlayerId,
    loser: PlayerId | null,
    ronpai: string | null,
    from: string,
    target: string,
  ): number {
    const sp = this.shoupai.get(winner);
    if (!sp) return 0;
    const hua = this.effectiveHuapaiAtHule(winner);
    const fuyuCount = hua.filter((p) => p === 'f4').length;
    if (fuyuCount < 1 || (this.feverActive[winner] && !this.fuyuConsumed[winner])) return 0;
    const tulip = fuyuCount >= 2;
    const lowerDeck = this.kinpeiTarget[winner] === 'fuyu';
    const genbutsu: Record<string, number> = {};
    const add = (raw: string, n = 1): void => {
      const core = /^f[1-4]$/.test(raw) ? raw : toCorePai(raw).replace(/0$/, '5');
      genbutsu[core] = (genbutsu[core] ?? 0) + n;
    };
    for (const s of ['m', 'p', 's'] as const) {
      for (let n = 1; n <= 9; n++) if ((sp._bingpai[s]?.[n] ?? 0) > 0) add(`${s}${n}`, sp._bingpai[s][n]);
    }
    for (let n = 1; n <= 7; n++) if ((sp._bingpai.z?.[n] ?? 0) > 0) add(`z${n}`, sp._bingpai.z[n]);
    for (const meld of sp._fulou ?? []) {
      const raw = String(meld).replace(/[\+=\-_*]/g, '');
      for (const digit of raw.slice(1)) add(`${raw[0]}${digit}`);
    }
    if (ronpai) add(ronpai);
    const nuki = (this.nukidora[winner] ?? 0) + (this.nukidoraGold[winner] ?? 0);
    if (nuki > 0) add('z4', nuki);
    for (const flower of hua) add(flower);
    const fromCore = toCorePai(from).replace(/0$/, '5');
    if ((genbutsu[fromCore] ?? 0) > 0) genbutsu[fromCore] -= 1;
    add(target);

    const hit = (raw: string, kamiHua = false): number => {
      if (/^f[1-4]$/.test(raw)) return hua.length + (kamiHua ? 1 : 0);
      const norm = toCorePai(raw).replace(/0$/, '5');
      const matches = new Set<string>([norm]);
      if (tulip) {
        const s = norm[0];
        const n = Number(norm[1]);
        if (s === 'm' && n === 7) { matches.add('m9'); matches.add('z5'); }
        else if (s === 'm' && n === 9) { matches.add('m7'); matches.add('z5'); }
        else if (s === 'z' && n === 5) { matches.add('m7'); matches.add('m9'); }
        else if (s === 'z' && n === 3) { matches.add('z1'); matches.add('z4'); }
        else if (s !== 'z') {
          matches.add(`${s}${n > 1 ? n - 1 : 9}`);
          matches.add(`${s}${n < 9 ? n + 1 : 1}`);
        }
      }
      return [...matches].reduce((sum, tile) => sum + (genbutsu[tile] ?? 0), 0);
    };
    const kamiBest = (): number => Math.max(...this.getKamiPochiCandidates('fuyu').map(
      (candidate) => hit(candidate, candidate.startsWith('f')),
    ));
    const wall = [...((this.shan as any)._pai ?? [])] as string[];
    let nextUpperIndex = 0;
    let totalHits = 0;
    while (true) {
      const upperIndex = lowerDeck ? 0 : nextUpperIndex;
      if (upperIndex >= wall.length) break;
      const pair = [wall.splice(upperIndex, 1)[0]];
      if (lowerDeck) {
        if (upperIndex < wall.length) pair.push(wall.splice(upperIndex, 1)[0]);
      } else {
        nextUpperIndex = upperIndex + 1;
      }
      const pairHits = pair.reduce((sum, pai) => sum + ((pai === 'z5b' || pai === 'z5g') ? kamiBest() : hit(pai)), 0);
      if (pairHits === 0) break;
      totalHits += pairHits;
    }
    const chipPerHit = (sp._fulou ?? []).some((m: string) => /[\+=\-]/.test(m)) ? 1 : 2;
    const base = totalHits * chipPerHit;
    return loser === null ? base * 2 : base;
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
    const counts = this.paiCountsInHand(sp, opts);
    let best: { pai: string; n: number } | null = null;
    for (const [pai, n] of Object.entries(counts)) {
      if (!best || n > best.n) best = { pai, n };
    }
    return best?.pai ?? null;
  }

  /** 神ぽっち target 判定用の現物 count [mostCommonPaiInHand の数え方そのもの] */
  paiCountsInHand(sp: any, opts: { player?: PlayerId; includeHua?: boolean } = {}): Record<string, number> {
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
    return counts;
  }

  /** 冬の神ぽっち自動高め取り [リョー裁定 2026-07-20: モーダルを出さない]。
   *  華 candidate は常に「華総数 + 1」hit [applyFuyuChip の華規則]、
   *  通常牌は現物 count。チューリップ隣接ボーナスまでは見ない近似。 */
  bestFuyuKamiPochiTarget(winner: PlayerId): string {
    const candidates = this.getKamiPochiCandidates('fuyu');
    const sp = this.shoupai.get(winner);
    const counts = sp ? this.paiCountsInHand(sp, { player: winner }) : {};
    const flowerValue = this.effectiveHuapaiAtHule(winner).length + 1;
    let best = candidates[0];
    let bestN = -1;
    for (const candidate of candidates) {
      const n = candidate.startsWith('f') ? flowerValue : (counts[candidate] ?? 0);
      if (n > bestN) { best = candidate; bestN = n; }
    }
    return best;
  }

  /** ドラ表示牌 → ドラ牌 [helper に委譲] */
  doraIndicatorOf(pai: string): string {
    return doraIndicatorOfHelper(pai);
  }

  /** baopai / fubaopai の z5 の色判定は牌 key [z5b/z5r/z5g/z5y] 自体で済む、
   *  別途 _pochiColor 配列は不要 */

  /** 嵌八萬判定: 山に m8 が存在しない [アンミカ三麻仕様] ため、 アガリ牌 z5 から ぽっち swap で m8 化したケースのみ
   *  - 副露なし [面前]
   *  - 手牌に m7 / m9 が各 1 枚以上
   *  - アガリ牌 [ロン or ツモ] が z5 [= 白ぽっち / 神ぽっち で m8 を選択した推定]
   *  実際の swap 結果まで判定するには hule 側で m8 swap 確定を flag 立てる必要があるが、
   *  実際の判定は次の厳密判定に委譲する。 */
  /** 嵌八萬厳密判定:
   *  1. 副露なし [面前]
   *  2. アガリ牌が z5 [白ぽ swap で m8 として アガる仕様、 山に m8 自体ナシ]
   *  3. 手牌に m7 と m9 が各 1 枚以上
   *  4. 「m8 として swap」 で m789 順子を含むアガリ形になる
   *  → これで「カン 8m 嵌張待ち」 が m7m8m9 順子で成立 = 嵌八萬確定
   *  ロジック: sp clone で z5 → m8 swap → hule_mianzi で全分解候補取得 → m7m8m9 順子含む解があるか check */
  isKanpaman(player: PlayerId, agariPai: string | null, substituteFrom: string = 'z5'): boolean {
    return isKanpamanHelper(this.shoupai.get(player), agariPai, substituteFrom);
  }

  /** アガリ止め可能か: 親アガリ + オーラス [最終場の最終 jushu]
   *  2026-05-14 codex review fix: 現親判定で 子アガリ後の親アガリ止め 正しく */
  canAgariyame(winner: PlayerId): boolean {
    if (winner !== this.currentOya) return false;
    if (this.state.changbang !== this.changshu - 1) return false;
    if (this.state.jushu !== 2) return false;
    if (this.state.defen[winner] < 40000) return false;
    if (this.getRanking()[0]?.player !== winner) return false;
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
        this.state.tongaeshi = true;
        this.events.push({ type: 'pingju', reason: '返り東 [全員 40000 未達]' });
      }
    }
    // 山と手牌をリセット [オンライン時は host が preShuffledPool 共有、 desync 防止 2026-05-13]
    this.shan = new Shan3(this.shanRule, opts.preShuffledPool);
    this.shoupai.clear();
    this.he.clear();
    this.lizhi.clear();
    this.doubleLizhi.clear();
    this.openLizhi.clear();
    this.state.lunban = 0;
    this.nukidora = { 0: 0, 1: 0, 2: 0 };
    this.nukidoraGold = { 0: 0, 1: 0, 2: 0 };
    this.yifaActive = { 0: false, 1: false, 2: false };
    this.lizhiDeclareDapai = { 0: false, 1: false, 2: false };
    this.lingshangActive = { 0: false, 1: false, 2: false };
    this.lingshangFromKan = { 0: false, 1: false, 2: false };
    this.qianggangPending = false;
    this.snapshotLocked = false;
    this.firstTurnState = createFirstTurnState();
    this.goldHand = {
      0: { p: 0, s: 0, z: 0 },
      1: { p: 0, s: 0, z: 0 },
      2: { p: 0, s: 0, z: 0 },
    };
    this.huapai = { 0: [], 1: [], 2: [] };
    this.feverActive = { 0: false, 1: false, 2: false };
    this.feverTier = { 0: 1, 1: 1, 2: 1 };
    this.feverDeclareTing = { 0: [], 1: [], 2: [] };
    this.feverDeclareDapaiPlayer = null;
    this.feverPendingShuvari = { 0: false, 1: false, 2: false };
    this.feverSaiAwarded = { 0: [], 1: [], 2: [] };
    this.feverWinCount = { 0: 0, 1: 0, 2: 0 };
    this.shuvariActive = { 0: false, 1: false, 2: false };
    this.lateShuvariWindow = { 0: false, 1: false, 2: false };
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
    this.pochiSwapChoice = { 0: null, 1: null, 2: null };
    this.haruActive = { 0: false, 1: false, 2: false };
    this.fuyuSkip = { 0: false, 1: false, 2: false };
    this.fuyuConsumed = { 0: false, 1: false, 2: false };
    this.fuyuRevealState = { 0: null, 1: null, 2: null };
    this.kinpeiTarget = { 0: null, 1: null, 2: null };
    this.kamiPochiDoraChoices = { 0: {}, 1: {}, 2: {} };
    this.akiUsedCount = { 0: 0, 1: 0, 2: 0 };
    // WSA: justNukidBei を次局で持ち越さない [北抜き→ツモ和了で flag 残留する path]
    this.justNukidBei = { 0: false, 1: false, 2: false };
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
    if (this.shan.paishu <= 0) return [];
    // フィーバー中は非フィーバー player の副露禁止
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) return [];
    // WSA: 嶺上残量・カンドラ上限を getKanCandidates と同じ基準で check
    if (!this.shan.canDrawRinshan) return [];
    if (!this.shan.canOpenKanDora) return [];
    // 反時計 2026-05-13 fix
    const diff = (from - player + 3) % 3;
    let dir: string;
    if (diff === 1) dir = '+';      // from は player の上家 [反時計の 1 つ前]
    else if (diff === 2) dir = '-';  // from は player の下家
    else return [];
    try {
      // Keep the physical discard in discardLog and normalize only at the
      // majiang-core boundary.
      return sp.get_gang_mianzi(toCorePai(pai) + dir) ?? [];
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
    const _origPhysicalHand = snapshotPhysicalHandState(sp);
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
    const takenPai = this.discardLog[fromPlayer]?.[this.discardLog[fromPlayer].length - 1]?.pai
      ?? `${mianzi[0]}${mianzi[1]}`;
    sp._anmikaFulou = sp._anmikaFulou ?? [];
    sp._anmikaFulou.push({ mianzi, from: fromPlayer, taken: takenPai });
    // 河の最後の牌に副露マーカーを付ける [大明槓も同じく He.fulou に mianzi を渡す]
    if (fromHe && typeof fromHe.fulou === 'function') {
      try { fromHe.fulou(mianzi); } catch { /* ignore */ }
    }
    // patchAnmikaShoupai.fulou が使用した expanded tile を _anmikaFulouPhysical へ移す。
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
      restorePhysicalHandState(sp, _origPhysicalHand);
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
      this.lingshangFromKan[player] = true;
      this.events.push({ type: 'gang', player, mianzi });
      // [2026-05-15 fix bug B] 大明槓 [鳴き派生] でも シュバ倍率 強制 解除。
      // 副露 と 同様 ゾロ目連続 シュバ宣言 と両立しない。
      this.shuvariActive[player] = false;
    }
    if (replacement !== null) markFirstTurnCall(this.firstTurnState);
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
    // リーチ宣言牌をまだ切っていない間は、先に宣言打牌を完了させる。
    if (this.lizhi.has(player) && this.lizhiDeclareDapai[player]) return [];
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) return [];
    // 海底牌を引いた後は暗槓・加槓とも不可。
    if (this.shan.paishu <= 0) return [];
    // [2026-05-15 bug 9 fix] 嶺上 [_rinshan] 残量 check:
    // 嶺上が 1 枚も無ければ カン後の 嶺上ツモ 不可、 候補 0 件で UI に出さない。
    // 旧 code は declareKan → shan.gangzimo throw → rollback で 「カン候補は表示されたのに 失敗」
    // という UX 不整合 [華 抜きすぎで 嶺上枯渇] を起こしていた。
    // 華を自動で抜いた後に実牌が 1 枚以上残る場合だけカン可能。
    if (!this.shan.canDrawRinshan) return [];
    // WSA-A2: 初期ドラ・秋ドラの総枚数ではなく、カン由来ドラ4回を上限にする。
    // gangzimo と同じ述語を候補生成にも使い、表示後の silent failure を防ぐ。
    if (!this.shan.canOpenKanDora) return [];
    try {
      const candidates = (sp.get_gang_mianzi() ?? []) as string[];
      if (!this.lizhi.has(player)) return candidates;
      return candidates.filter((mianzi) => this.isWaitPreservingLizhiKan(player, mianzi));
    } catch {
      return [];
    }
  }

  /** リーチ後に強制される、待ち不変の合法暗槓候補。 */
  getForcedLizhiKanCandidates(player: PlayerId): string[] {
    if (!this.lizhi.has(player)) return [];
    return this.getKanCandidates(player);
  }

  /** リーチ後暗槓の前後で待ちが完全一致するか。判定不能時は安全側で不可。 */
  private isWaitPreservingLizhiKan(player: PlayerId, mianzi: string): boolean {
    if (!/^[mpsz]\d{4}$/.test(mianzi)) return false;
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    // 送り槓禁止: リーチ後に槓できるのは、いま引いた牌と同種の暗槓だけ。
    if (typeof sp._zimo !== 'string' || sp._zimo.length > 3) return false;
    const drawBase = toCorePai(sp._zimo).replace('0', '5');
    const kanBase = `${mianzi[0]}${mianzi[1] === '0' ? '5' : mianzi[1]}`;
    if (drawBase !== kanBase) return false;
    try {
      // リーチ待ちはツモ牌を除いた宣言済み13枚で比較する。
      const tingBefore = new Set(this.getTingpaiListBeforeZimo(player));
      const spAfter = sp.clone();
      spAfter.gang(mianzi);
      const tingAfter = new Set(getTingpaiListHelper(spAfter));
      return tingBefore.size === tingAfter.size && [...tingBefore].every((tile) => tingAfter.has(tile));
    } catch {
      return false;
    }
  }

  /** 暗槓 / 加槓 実行 [嶺上ツモ + ドラ表追加]。 mianzi は get_gang_mianzi 戻り値の 1 要素
   *  R3 P0 #4 fix: 嶺上ツモ失敗時に sp.gang / shan を全 rollback */
  declareKan(player: PlayerId, mianzi: string): Pai | null {
    const sp = this.shoupai.get(player);
    if (!sp) return null;
    if (this.lizhi.has(player) && this.lizhiDeclareDapai[player]) return null;
    if (this.shan.paishu <= 0) return null;
    if (!this.getKanCandidates(player).includes(mianzi)) return null;
    dlog('[declareKan]', { player, mianzi, baopaiBefore: [...this.shan.baopai] });
    // [2026-05-15 bug 6 fix] リーチ後 ankan: 待ち変動 禁止。
    //   ankan 前後で tingpai が 一致しない場合 reject [テンパイ崩れ防止]。
    //   加槓 [\d{3}[+=-]\d$] は元々 リーチ中 不可なので 影響なし。 ankan のみ check。
    if (this.lizhi.has(player) && !this.isWaitPreservingLizhiKan(player, mianzi)) {
      dlog('[declareKan] reject: リーチ中の待ち変動または判定不能カン', { player, mianzi });
      return null;
    }
    // snapshot for rollback
    const _origBingpai = { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] };
    const _origFulou = [...sp._fulou];
    const _origZimo = sp._zimo;
    const _origPhysicalHand = snapshotPhysicalHandState(sp);
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
        if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) console.log('!!!P0-6b declareKan rinshan 矛盾', { player, mianzi, replacement, fulouCount, fulou: [...sp._fulou], shanPaishu: this.shan.paishu });
      }
      // P0-6 検出: 暗槓 [\d{4}$] 直後 _zimo が ankan と同種だと 5 枚目存在 = state corruption
      // [V32 fuzz で発見、 2026-05-12 yuma 調査中、 root cause 未特定]
      const isAnkan = !!mianzi.match(/^[mpsz]\d{4}$/);
      if (isAnkan && replacement && replacement[0] === mianzi[0]) {
        const ankanN = mianzi[1]; // 第 1 字目の数字 [s8888 なら '8']
        const repN = replacement[1] === '0' ? '5' : replacement[1];
        if (ankanN === repN || (ankanN === '5' && replacement[1] === '0')) {
          if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) console.log('!!!P0-6 corruption detect ankan+同種_zimo', { player, mianzi, replacement, shanPaishu: this.shan.paishu, shanRestFront: [...(this.shan as any)._pai].slice(0, 6), bingpaiPostAnkan: { m: [...sp._bingpai.m], p: [...sp._bingpai.p], s: [...sp._bingpai.s], z: [...sp._bingpai.z] } });
        }
      }
    } catch {
      replacement = null;
      // R3 P0 #4: 全 rollback
      sp._bingpai.m = _origBingpai.m; sp._bingpai.p = _origBingpai.p;
      sp._bingpai.s = _origBingpai.s; sp._bingpai.z = _origBingpai.z;
      sp._fulou = _origFulou; sp._zimo = _origZimo;
      restorePhysicalHandState(sp, _origPhysicalHand);
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
      // 自分の暗槓を含め、槓が成立した時点で全員の一発が消える。
      this.yifaActive = { 0: false, 1: false, 2: false };
      // 虹牌を含む暗槓で全虹が初めて揃った場合、通常立直→ダブルFEVER、
      // 通常/ダブルFEVER→トリプル/クアドラプルへ昇格する。
      if (this.lizhi.has(player) && /^[mpsz]\d{4}$/.test(mianzi)) {
        const latestPhysical = (sp._anmikaFulouPhysical ?? []).at(-1);
        const consumed = (latestPhysical?.mianzi === mianzi ? latestPhysical.consumed : []) ?? [];
        if (consumed.some((p: string) => p === 'np3' || p === 'ns3' || p === 'nz3')) {
          const fever = this.canFeverLizhi(player);
          const upgradedTier = rainbowKanUpgradeTier(fever, this.feverActive[player], this.feverTier[player]);
          if (upgradedTier !== null) {
            this.feverActive[player] = true;
            this.feverTier[player] = upgradedTier;
            this.feverDeclareTing[player] = this.getTingpaiListBeforeZimo(player);
          }
        }
      }
      this.lingshangActive[player] = true;
      this.lingshangFromKan[player] = true;
      // 加槓判定: format が 'XXX+/=/-X' なら加槓、 他家ロン受け window
      if (mianzi.match(/\d{3}[\+\=\-]\d$/)) {
        // 槍槓 window は store 側が嶺上前に管理する。嶺上ツモ後まで true を残すと
        // 牌譜復元時に「まだ槍槓待ち」と誤認するので、ここでは立てない。
        this.qianggangPending = false;
      }
      this.events.push({ type: 'gang', player, mianzi });
    }
    if (replacement !== null) markFirstTurnCall(this.firstTurnState);
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
    // 自風は手番の回転と同じ向きで振る [リョー指摘 2026-07-17]。
    // この game の回転は index 降順 [手番 lunbanToPlayerId = oya - lunban、
    // 親流れも oya-1] なので、東=親、南=親-1 [下家]、西=親-2 [上家]。
    // 旧式 (player - oya) は逆回転で、下家の表示風と自風役が両方ズレていた
    const relative = (this.currentOya - player + 3) % 3;
    return relative + 1;
  }

  /** リーチ宣言牌候補 [打牌後も聴牌維持できる打牌一覧] */
  getLizhiCandidates(player: PlayerId): string[] {
    const sp = this.shoupai.get(player);
    if (!sp) return [];
    if (lizhiXiangting(sp) > 0) return [];
    let candidates: string[];
    try {
      candidates = sp.get_dapai(false);
    } catch {
      return [];
    }
    if (!candidates) return [];
    const legalCoreCandidates = candidates.filter((c: string) => {
      // 北は金北を含めて河へ切れないため、宣言牌にもなれない。
      if (toCorePai(c.replace(/[_*]$/, '')) === 'z4') return false;
      const sp_clone = sp.clone();
      try {
        sp_clone.dapai(c);
      } catch {
        return false;
      }
      return lizhiXiangting(sp_clone) === 0;
    });
    // Public Game3 APIs return the tile the player can actually select.  The
    // core names remain an implementation detail at the majiang-core boundary.
    return physicalDiscardCandidates(sp, legalCoreCandidates);
  }

  /** フィーバーリーチ可能か + 種別 [single/double/triple]
   *  ルール 5-4: 7s + 7p 両方 = ダブル、 7s + 7p + 7m 全 = トリプル */
  canFeverLizhi(player: PlayerId): FeverCheck {
    return canFeverLizhiHelper(this.shoupai.get(player));
  }

  /** [2026-05-15 bug 8] 打牌候補ごとに fever 可否を返す。
   *  Map<dapai_pai, FeverCheck>、 fever 可な candidate のみ含む。
   *  store gate 側で 「fever 可な dapai のみ fever 宣言可能」 に使う。 */
  feverCandidatesByDapai(player: PlayerId): Map<string, FeverCheck> {
    return feverCandidatesByDapaiHelper(this.shoupai.get(player));
  }

  /** フィーバーリーチ中フラグ [_player ごと]、 declareLizhi で feverActive 立てる */
  feverActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
  /** フィーバー declare 時の wait snapshot [リョー指示 2026-05-12: tsumo で動かないように] */
  feverDeclareTing: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };

  /** フィーバー tier [1/2/3/4]、 打点・祝儀倍率は 1/2/4/8。 */
  feverTier: Record<PlayerId, 1 | 2 | 3 | 4> = { 0: 1, 1: 1, 2: 1 };

  /** フィーバー宣言 dapai marker [P0-1 2026-05-11]
   *  declareLizhi(opts.fever) で player を set、 宣言牌の他家ロンで undo 判定に使う、
   *  宣言牌が ron されず次 zimo を迎えたら clear */
  feverDeclareDapaiPlayer: PlayerId | null = null;

  /** FEVER宣言牌がロンされなかった時点で初めて確定するシュバリ宣言。 */
  feverPendingShuvari: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** フィーバー成立後、 待ち牌が山に残ってるか check
   *  全 0 なら 1 人テンパイ流局 [ルール 5-2 step 4] */
  isFeverWaitExhausted(player: PlayerId): boolean {
    const waits = this.feverDeclareTing[player].length > 0
      ? this.feverDeclareTing[player]
      : this.getTingpaiList(player);
    const liveWall = this.shan.isBlind ? undefined : ([...((this.shan as any)._pai ?? [])] as string[]);
    return isFeverWaitExhaustedHelper(
      waits,
      this.shoupai as any,
      this.he as any,
      [...(this.shan.baopai ?? [])],
      liveWall,
    );
  }

  /** FEVER中、一度だけ発生するサイコロ条件の消費済awardKey。 */
  feverSaiAwarded: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };

  /** シュバリーチ: 東風 1 回につき 1 度宣言可、 当局のみ祝儀 2 倍 */
  shuvariActive: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** シュバリーチ使用済 [半荘内 1 回限定] */
  shuvariUsed: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  /** 通常立直成立後、次の一打まで追加シュバリ宣言を受け付ける。 */
  lateShuvariWindow: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };

  isFeverEstablished(player: PlayerId): boolean {
    return this.feverActive[player] && this.feverDeclareDapaiPlayer !== player;
  }

  isFeverConfirmed(player: PlayerId): boolean {
    return this.isFeverEstablished(player);
  }

  confirmFeverDeclaration(player: PlayerId): void {
    if (this.feverDeclareDapaiPlayer !== player) return;
    if (this.feverPendingShuvari[player] && !this.shuvariUsed[player]) {
      this.shuvariActive[player] = true;
      this.shuvariUsed[player] = true;
    }
    this.feverPendingShuvari[player] = false;
    this.feverDeclareDapaiPlayer = null;
  }

  cancelFeverDeclaration(player: PlayerId): void {
    if (this.feverDeclareDapaiPlayer !== player) return;
    this.endFever(player);
  }

  endFever(player: PlayerId): void {
    this.feverActive[player] = false;
    this.feverTier[player] = 1;
    this.feverDeclareTing[player] = [];
    this.feverPendingShuvari[player] = false;
    this.feverSaiAwarded[player] = [];
    this.lateShuvariWindow[player] = false;
    if (this.feverDeclareDapaiPlayer === player) this.feverDeclareDapaiPlayer = null;
  }

  canDeclareLateShuvari(player: PlayerId): boolean {
    return this.lizhi.has(player)
      && this.lateShuvariWindow[player]
      && !this.shuvariUsed[player]
      && !this.shuvariActive[player]
      && !this.feverPendingShuvari[player];
  }

  declareLateShuvari(player: PlayerId): boolean {
    if (!this.canDeclareLateShuvari(player)) return false;
    if (this.feverDeclareDapaiPlayer === player) {
      // FEVER宣言牌がロンされた場合は権利を消費しない。宣言成立時に確定する。
      this.feverPendingShuvari[player] = true;
    } else {
      this.shuvariActive[player] = true;
      this.shuvariUsed[player] = true;
    }
    this.lateShuvariWindow[player] = false;
    this.events.push({ type: 'lizhi', player, shuvari: true, late: true } as any);
    return true;
  }

  /** [削除予定 / 2026-05-14 codex review fix] tobiChipPaid: 旧 「半荘内 1 回限定」 仕様は
   *  リョー再修正 [フィーバー逆ぽで 1 局中 複数飛び発生し得る] により 削除。 都度 apply で OK
   *  field 自体は 古い参照保護で 残置、 値は 未使用 */
  tobiChipPaid: boolean = false;

  /** リーチ可能か [ツモ後・聴牌・副露ナシ。箱下からの宣言も可、暗槓は門前扱い] */
  canLizhi(player: PlayerId): boolean {
    if (this.lizhi.has(player)) return false;
    // フィーバー成立中は宣言者以外のアガリ・聴牌を成立させず、強制ツモ切りだけを行う。
    // ここを許すと、非宣言者がリーチ選択状態に入った後に打牌側のツモ切り制限と
    // 競合し、UI/CPU とも進行待ちになる経路が生じる。宣言可否の根元で止める。
    const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => this.feverActive[p]);
    if (someoneFever && !this.feverActive[player]) return false;
    const sp = this.shoupai.get(player);
    if (!sp) return false;
    // 箱下リーチ可。点棒不足・負点を理由に宣言を止めず、供託後さらに負値になり得る。
    // 副露 check: 暗槓 [\d{4} form、 方向 mark 無し] のみなら門前扱いで OK
    if (sp._fulou && sp._fulou.length > 0) {
      const hasNonAnkan = sp._fulou.some((m: string) => !m.match(/^[mpsz]\d{4}$/));
      if (hasNonAnkan) return false;
    }
    if (!sp._zimo) return false;
    // A tenpai-shaped hand is not sufficient: at least one legal declaration
    // discard must exist.  In particular, a hand whose sole preserving discard
    // is z4/gN must nuki instead of entering an unfinishable pending state.
    return this.getLizhiCandidates(player).length > 0;
  }

  /** オープン立直中のプレイヤー [+2000 供託、 +1 翻、 待ち開示] */
  openLizhi: Set<PlayerId> = new Set();

  /** リーチ宣言 [現家のみ、 canLizhi 全条件 check]
   *  shuvari: シュバリーチオプション [半荘 1 回まで、 当局祝儀 2 倍]
   *  open: オープン立直 [+1000 供託 = 計 2000、 アガリ時 +1 翻、 待ち開示] */
  declareLizhi(opts: { shuvari?: boolean; open?: boolean; fever?: boolean; feverCheck?: FeverCheck; feverDapai?: Pai } = {}): boolean {
    const player = this.lunbanToPlayerId(this.state.lunban);
    if (!this.canLizhi(player)) return false;
    let feverCheck = opts.feverCheck ?? this.canFeverLizhi(player);
    if (opts.fever) {
      // FEVER is established by the declaration discard.  Require one exact
      // physical tile that simultaneously preserves riichi tenpai and the
      // FEVER shape; a caller-supplied pre-discard FeverCheck alone is not
      // authoritative and could otherwise charge an unfinishable declaration.
      const feverDapai = opts.feverDapai
        ? String(opts.feverDapai).replace(/[_*]$/, '')
        : null;
      const legalLizhi = new Set(
        this.getLizhiCandidates(player).map((pai) => pai.replace(/[_*]$/, '')),
      );
      const verified = feverDapai && legalLizhi.has(feverDapai)
        ? this.feverCandidatesByDapai(player).get(feverDapai)
        : undefined;
      if (!verified?.ok) {
        dlog('[lizhi] fever 宣言 reject [no legal physical declaration discard]', {
          player,
          feverDapai,
        });
        return false;
      }
      feverCheck = verified;
    }
    const cost = opts.open ? 2000 : 1000;
    this.state.defen[player] -= cost;
    this.state.lizhibang += opts.open ? 2 : 1;
    this.lizhi.add(player);
    const first = this.firstTurnState.players[player];
    if (!this.firstTurnState.callOccurred && !first.hasDiscarded && first.drawCount <= 1) {
      this.doubleLizhi.add(player);
    }
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
      if (opts.fever) {
        this.feverPendingShuvari[player] = true;
      } else {
        this.shuvariActive[player] = true;
        this.shuvariUsed[player] = true;
      }
    }
    this.events.push({ type: 'lizhi', player, open: !!opts.open, fever: !!opts.fever, shuvari: !!opts.shuvari });
    return true;
  }
}

// applyRankUp は fanshuLevel + LEVEL_TO_FANSHU で代替済 [削除]
function _legacyApplyRankUp(_fanshu: number, _levels: number): number { return _fanshu; }
void _legacyApplyRankUp;
