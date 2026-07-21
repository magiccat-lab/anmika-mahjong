import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

export type WinPipelineStage =
  | 'idle'
  | 'ron-decision'
  | 'fulou'
  | 'qianggang'
  | 'fuyu'
  | 'kinpei'
  | 'kami-pochi'
  | 'pochi-swap'
  | 'saikoro'
  | 'fever'
  | 'round-ended'
  | 'pingju';

export type WinPipelineState = {
  stage: WinPipelineStage;
  owner: number | null;
};

export type PendingKinpei = {
  winner: number;
  /** Positive pochi: winner. Reverse pochi: every other player may submit the table's decision. */
  decisionOwners?: number[];
  decisionOwnerIndex?: number;
  isRon: boolean;
  ronfrom: number | null;
  /** 和了計算で新たに表示された華を、snapshot 復元後も選択肢として保持する。 */
  availableHuapai?: string[];
  otherWinners?: number[];
  humanOthers?: number[];
  cutinQueued?: boolean;
  /** この和了で冬の使用可否を既に選択済みなら、金北再計算後に再表示しない。 */
  fuyuDecisionMade?: boolean;
};

export type PendingFuyu = {
  winner: number;
  /** Positive pochi: winner. Reverse pochi: every other player may submit the table's decision. */
  decisionOwners?: number[];
  decisionOwnerIndex?: number;
  isRon: boolean;
  ronfrom: number | null;
  /** 秋効果で表示された冬を、snapshot 復元後の冬・金北選択へ引き継ぐ。 */
  availableHuapai?: string[];
  otherWinners?: number[];
  humanOthers?: number[];
  cutinQueued?: boolean;
};

export type PendingKamiPochi = {
  winner: number;
  context: 'dora' | 'fuyu';
  occurrenceKey: string;
  rawPai?: string;
  tier?: 'upper' | 'lower';
  candidates: string[];
  decisionOwners: number[];
  decisionOwnerIndex: number;
  isRon: boolean;
  ronfrom: number | null;
};

export type PendingPochiSwap = {
  winner: number;
  kind: 'white' | 'deka';
  candidates: Array<{ target: string; expectedChip: number; fanshu: number | null; damanguan: number }>;
  decisionOwners: number[];
  decisionOwnerIndex: number;
  isRon: boolean;
  ronfrom: number | null;
};

export type PendingFeverContinue = {
  winner: number;
  isRon: boolean;
  /** ron 継続の再開席基準 [リョー裁定 2026-07-21 裁定6: 放銃者の次から]。
   * 未保持 [旧保存データ等] は winner 基準の旧挙動で進める。 */
  ronfrom?: number | null;
};

export type ReactionCandidate = {
  player: number;
  mianzi: string[];
};

export type PendingQianggang = {
  player: number;
  mianzi: string;
  kakanPai: string;
};

export type PendingSaiKoroChance = {
  awardKey?: string;
  name: string;
  baseChip: number;
  shuvariApplicable: boolean;
  /** The role itself is always played as Shuba dice, even without declaration. */
  alwaysShuvari?: boolean;
  /** Number of non-double rolls in this independent dice session. */
  rollCount?: number;
  count: number;
  plusMinus: '+' | '-';
  winner?: number;
  mode?: 'tsumo' | 'ron';
};

export type PendingSaiKoro = {
  winner: number;
  chances: PendingSaiKoroChance[];
  currentIdx: number;
  selectedCombo: [number, number] | null;
  rolls: Array<{ dice: [number, number]; hit: boolean; zoro: boolean }>;
  finalized: boolean;
  summary: { hits: number; chipN: number; zoroBonusTotal: number } | null;
};

export type RonResult = { player: number; result: any };

/** 放銃者から反時計回り [p0→p2→p1] に近い勝者を先にする。 */
export function sortRonResultsByKamicha(
  discarder: PlayerId,
  results: RonResult[],
): RonResult[] {
  const distance = (player: number): number => (discarder - player + 3) % 3;
  return [...results].sort((a, b) => distance(a.player) - distance(b.player));
}

/** WSA-A6 settlement seam. Every batch goes through the same upper-seat order
 * before applyHule, so the first claimant of riichi deposits is deterministic. */
export function settleRonResultsInKamichaOrder(
  game: Game3,
  discarder: PlayerId,
  results: RonResult[],
): RonResult[] {
  const sorted = sortRonResultsByKamicha(discarder, results);
  game.prepareDoubleRonAutumnBeforeWinter(sorted, discarder);
  for (const claim of sorted) {
    if (claim.result?._anmikaRonSettlementApplied) continue;
    game.applyHule(claim.result, claim.player as PlayerId, discarder);
    // [2026-07-21 監査 D-10 fix] この claimant の冬 [正ぽっちで pending 停止] を、
    // 次 claimant の applyHule より前に完了させる。旧実装は 1 人目の冬が pending の
    // まま一括 loop が 2 人目を評価し、同じ牌山を先に消費して上家順の牌山順・支払額が
    // ずれていた。神ぽっちは常に自動高目取り [モーダルなし] なので同期で解決できる。
    // pending が無い通常ケースは while が即 break するため挙動は変わらない
    let guard = 0;
    while (guard++ < 64) {
      const pending = game.getPendingFuyuKamiPochi(claim.player as PlayerId);
      if (!pending?.occurrenceKey) break;
      const best = game.bestFuyuKamiPochiTarget(claim.player as PlayerId);
      const pick = pending.candidates.includes(best) ? best : pending.candidates[0];
      const advance = game.resumeFuyuKamiPochi(claim.player as PlayerId, pending.occurrenceKey, pick);
      if (!advance || advance.status === 'complete') break;
    }
    claim.result._anmikaRonSettlementApplied = true;
  }
  return sorted;
}

type WinPipelineLike = {
  game: Game3;
  awaitingRonDecision: boolean;
  awaitingFulou: boolean;
  ronPassedPlayers: number[];
  ronDeclaredPlayers: number[];
  ronResults: Array<{ player: number; result: any }>;
  ponCandidates: ReactionCandidate[];
  kanCandidates: ReactionCandidate[];
  pendingQianggang: PendingQianggang | null;
  pendingFuyu: PendingFuyu | null;
  pendingKinpei: PendingKinpei | null;
  pendingKamiPochi: PendingKamiPochi | null;
  pendingPochiSwap: PendingPochiSwap | null;
  pendingSaiKoro: PendingSaiKoro | null;
  pendingFeverContinue: PendingFeverContinue | null;
  pendingPingju: boolean;
  roundEnded: boolean;
};

export function getWinPipelineState(s: WinPipelineLike): WinPipelineState {
  if (s.pendingQianggang) return { stage: 'qianggang', owner: s.pendingQianggang.player };
  // A claimant can enter one of these decisions while the remaining
  // double-ron candidates are still open.  Resolve the modal first, then
  // expose the reaction window again.
  if (s.pendingFuyu) return { stage: 'fuyu', owner: s.pendingFuyu.decisionOwners?.[0] ?? s.pendingFuyu.winner };
  if (s.pendingKinpei) return { stage: 'kinpei', owner: s.pendingKinpei.decisionOwners?.[0] ?? s.pendingKinpei.winner };
  if (s.pendingKamiPochi) {
    return { stage: 'kami-pochi', owner: s.pendingKamiPochi.decisionOwners[s.pendingKamiPochi.decisionOwnerIndex] ?? null };
  }
  if (s.pendingPochiSwap) {
    return { stage: 'pochi-swap', owner: s.pendingPochiSwap.decisionOwners[s.pendingPochiSwap.decisionOwnerIndex] ?? null };
  }
  if (s.awaitingRonDecision) return { stage: 'ron-decision', owner: null };
  if (s.awaitingFulou) return { stage: 'fulou', owner: null };
  if (s.pendingSaiKoro) {
    const chance = s.pendingSaiKoro.chances?.[s.pendingSaiKoro.currentIdx ?? 0];
    return { stage: 'saikoro', owner: chance?.winner ?? s.pendingSaiKoro.winner };
  }
  if (s.pendingFeverContinue) return { stage: 'fever', owner: s.pendingFeverContinue.winner };
  if (s.pendingPingju) return { stage: 'pingju', owner: null };
  if (s.roundEnded) return { stage: 'round-ended', owner: null };
  return { stage: 'idle', owner: null };
}

export function blockingWinPipelineReason(s: WinPipelineLike): string | null {
  const state = getWinPipelineState(s);
  if (state.stage === 'idle' || state.stage === 'round-ended' || state.stage === 'pingju') {
    return null;
  }
  return state.stage;
}

export function enterRonDecisionStage(s: WinPipelineLike, opts: {
  ponCandidates?: ReactionCandidate[];
  kanCandidates?: ReactionCandidate[];
  ronPassedPlayers?: number[];
  ronDeclaredPlayers?: number[];
  ronResults?: Array<{ player: number; result: any }>;
} = {}): void {
  s.awaitingRonDecision = true;
  s.awaitingFulou = false;
  s.ronPassedPlayers = opts.ronPassedPlayers ?? [];
  s.ronDeclaredPlayers = opts.ronDeclaredPlayers ?? [];
  s.ronResults = opts.ronResults ?? [];
  if (opts.ponCandidates) s.ponCandidates = opts.ponCandidates;
  if (opts.kanCandidates) s.kanCandidates = opts.kanCandidates;
  s.roundEnded = false;
}

export function continueRonDecisionStage(s: WinPipelineLike): void {
  s.awaitingRonDecision = true;
  s.awaitingFulou = false;
  s.roundEnded = false;
}

export function finishRonDecisionStage(s: WinPipelineLike): void {
  s.awaitingRonDecision = false;
  s.awaitingFulou = false;
}

export function enterFulouStage(s: WinPipelineLike, opts: {
  ponCandidates: ReactionCandidate[];
  kanCandidates: ReactionCandidate[];
}): void {
  s.awaitingRonDecision = false;
  s.awaitingFulou = true;
  s.ponCandidates = opts.ponCandidates;
  s.kanCandidates = opts.kanCandidates;
  s.roundEnded = false;
}

export function replaceReactionCandidates(s: WinPipelineLike, opts: {
  ponCandidates: ReactionCandidate[];
  kanCandidates: ReactionCandidate[];
}): void {
  s.ponCandidates = opts.ponCandidates;
  s.kanCandidates = opts.kanCandidates;
}

export function clearReactionStage(s: WinPipelineLike, opts: {
  clearCandidates?: boolean;
  clearRonTracking?: boolean;
} = {}): void {
  s.awaitingRonDecision = false;
  s.awaitingFulou = false;
  if (opts.clearCandidates !== false) {
    s.ponCandidates = [];
    s.kanCandidates = [];
  }
  if (opts.clearRonTracking !== false) {
    s.ronPassedPlayers = [];
    s.ronDeclaredPlayers = [];
    s.ronResults = [];
  }
}

export function enterQianggangStage(s: WinPipelineLike, pending: PendingQianggang): void {
  s.pendingQianggang = pending;
  s.game.qianggangPending = true;
  s.roundEnded = false;
}

export function clearQianggangStage(s: WinPipelineLike): PendingQianggang | null {
  const pending = s.pendingQianggang;
  s.pendingQianggang = null;
  s.game.qianggangPending = false;
  return pending;
}

export function enterFuyuStage(s: WinPipelineLike, pending: PendingFuyu): void {
  pending.decisionOwners = pending.decisionOwners?.length
    ? [...pending.decisionOwners]
    : (s.game.pochiPaymentMode[pending.winner as PlayerId]
      ? ([0, 1, 2] as PlayerId[]).filter((p) => p !== pending.winner)
      : [pending.winner]);
  s.pendingFuyu = pending;
  s.roundEnded = false;
}

export function clearFuyuStage(s: WinPipelineLike): void {
  s.pendingFuyu = null;
}

export function enterKinpeiStage(s: WinPipelineLike, pending: PendingKinpei): void {
  pending.decisionOwners = pending.decisionOwners?.length
    ? [...pending.decisionOwners]
    : (s.game.pochiPaymentMode[pending.winner as PlayerId]
      ? ([0, 1, 2] as PlayerId[]).filter((p) => p !== pending.winner)
      : [pending.winner]);
  s.pendingKinpei = pending;
  s.roundEnded = false;
}

export function clearKinpeiStage(s: WinPipelineLike): void {
  s.pendingKinpei = null;
}

export function enterFeverContinueStage(s: WinPipelineLike, pending: PendingFeverContinue): void {
  s.pendingFeverContinue = pending;
  s.roundEnded = false;
}

export function clearFeverContinueStage(s: WinPipelineLike): void {
  s.pendingFeverContinue = null;
}

export function appendSaiKoroChances(
  s: WinPipelineLike,
  winner: number,
  chances: PendingSaiKoroChance[],
): void {
  if (chances.length === 0) return;
  if (s.pendingSaiKoro) {
    s.pendingSaiKoro = {
      ...s.pendingSaiKoro,
      chances: [...s.pendingSaiKoro.chances, ...chances],
    };
    return;
  }
  s.pendingSaiKoro = {
    winner,
    chances,
    currentIdx: 0,
    selectedCombo: null,
    rolls: [],
    finalized: false,
    summary: null,
  };
  s.roundEnded = false;
}

export function clearSaiKoroStage(s: WinPipelineLike): void {
  s.pendingSaiKoro = null;
  // [2026-07-21 監査 D-07 fix] サイコロ完了 [全消化/置換空] まで遅延していた
  // FEVER 終了をここで実行する。倍率は最後の chance まで snapshot どおり生きる
  const pendingEnd = (s.game as any).feverEndPendingAfterEffects as Record<number, boolean> | undefined;
  if (pendingEnd) {
    for (const p of [0, 1, 2] as const) {
      if (pendingEnd[p]) {
        pendingEnd[p] = false;
        s.game.endFever(p as PlayerId);
      }
    }
  }
}

export function advanceSaiKoroStage(s: WinPipelineLike): void {
  const ps = s.pendingSaiKoro;
  if (!ps) return;
  const nextIdx = ps.currentIdx + 1;
  if (nextIdx >= ps.chances.length) {
    clearSaiKoroStage(s);
    // 流し役満は流局結果にサイコロが付随する。全セッション終了後は
    // pendingPingju を保ったまま局終了画面へ戻す。
    if (s.pendingPingju) s.roundEnded = true;
    return;
  }
  s.pendingSaiKoro = {
    winner: ps.winner,
    chances: ps.chances,
    currentIdx: nextIdx,
    selectedCombo: null,
    rolls: [],
    finalized: false,
    summary: null,
  };
}

export function replaceSaiKoroChances(
  s: WinPipelineLike,
  chances: PendingSaiKoroChance[],
): void {
  if (!s.pendingSaiKoro) return;
  if (chances.length === 0) {
    clearSaiKoroStage(s);
    return;
  }
  s.pendingSaiKoro = {
    ...s.pendingSaiKoro,
    chances,
    currentIdx: Math.min(s.pendingSaiKoro.currentIdx, chances.length - 1),
  };
}

export function settleAfterWin(
  s: WinPipelineLike,
  opts: { winner: PlayerId; isRon: boolean; ronfrom?: number | null },
): void {
  if (s.pendingFuyu || s.pendingKinpei || s.pendingKamiPochi || s.pendingPochiSwap) {
    s.roundEnded = false;
    return;
  }
  if (s.game.feverActive[opts.winner]) {
    // 最後に生存していた待ち牌で和了した場合、FEVERはその和了で終了する。
    if (s.game.isFeverWaitExhausted(opts.winner)) {
      // [2026-07-21 監査 D-07 fix] この和了で発生したサイコロ chance が残っている間は
      // endFever を遅延する [clearSaiKoroStage が発火]。旧実装は queue 直後に終了し、
      // 実際に振る時だけ tier 1 扱いで倍率が消えていた
      if (s.pendingSaiKoro) {
        s.game.feverEndPendingAfterEffects[opts.winner] = true;
      } else {
        s.game.endFever(opts.winner);
      }
      s.roundEnded = true;
      return;
    }
    if (!s.pendingFeverContinue) {
      s.game.feverWinCount[opts.winner] += 1;
      enterFeverContinueStage(s, {
        winner: opts.winner,
        isRon: opts.isRon,
        ronfrom: opts.ronfrom ?? null,
      });
    }
    s.roundEnded = false;
    return;
  }
  s.roundEnded = true;
}
