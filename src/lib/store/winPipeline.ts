import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

export type WinPipelineStage =
  | 'idle'
  | 'ron-decision'
  | 'fulou'
  | 'qianggang'
  | 'fuyu'
  | 'kinpei'
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
  isRon: boolean;
  ronfrom: number | null;
  /** 秋効果で表示された冬を、snapshot 復元後の冬・金北選択へ引き継ぐ。 */
  availableHuapai?: string[];
  otherWinners?: number[];
  humanOthers?: number[];
  cutinQueued?: boolean;
};

export type PendingFeverContinue = {
  winner: number;
  isRon: boolean;
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
  name: string;
  baseChip: number;
  shuvariApplicable: boolean;
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
  for (const claim of sorted) {
    if (claim.result?._anmikaRonSettlementApplied) continue;
    game.applyHule(claim.result, claim.player as PlayerId, discarder);
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
  pendingSaiKoro: PendingSaiKoro | null;
  pendingFeverContinue: PendingFeverContinue | null;
  pendingPingju: boolean;
  roundEnded: boolean;
};

export function getWinPipelineState(s: WinPipelineLike): WinPipelineState {
  if (s.pendingQianggang) return { stage: 'qianggang', owner: s.pendingQianggang.player };
  if (s.awaitingRonDecision) return { stage: 'ron-decision', owner: null };
  if (s.awaitingFulou) return { stage: 'fulou', owner: null };
  if (s.pendingFuyu) return { stage: 'fuyu', owner: s.pendingFuyu.winner };
  if (s.pendingKinpei) return { stage: 'kinpei', owner: s.pendingKinpei.winner };
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
  s.pendingFuyu = pending;
  s.roundEnded = false;
}

export function clearFuyuStage(s: WinPipelineLike): void {
  s.pendingFuyu = null;
}

export function enterKinpeiStage(s: WinPipelineLike, pending: PendingKinpei): void {
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
}

export function advanceSaiKoroStage(s: WinPipelineLike): void {
  const ps = s.pendingSaiKoro;
  if (!ps) return;
  const nextIdx = ps.currentIdx + 1;
  if (nextIdx >= ps.chances.length) {
    clearSaiKoroStage(s);
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
  opts: { winner: PlayerId; isRon: boolean },
): void {
  if (s.pendingKinpei) {
    s.roundEnded = false;
    return;
  }
  if (s.game.feverActive[opts.winner]) {
    if (!s.pendingFeverContinue) {
      s.game.feverWinCount[opts.winner] += 1;
      enterFeverContinueStage(s, { winner: opts.winner, isRon: opts.isRon });
    }
    s.roundEnded = false;
    return;
  }
  s.roundEnded = true;
}
