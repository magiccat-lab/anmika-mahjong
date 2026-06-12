import type { Game3 } from '../game3';
import type { PlayerId } from '../types';

export type WinPipelineStage =
  | 'idle'
  | 'ron-decision'
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

type WinPipelineLike = {
  game: Game3;
  awaitingRonDecision: boolean;
  pendingQianggang: { player: number } | null;
  pendingFuyu: { winner: number } | null;
  pendingKinpei: { winner: number } | null;
  pendingSaiKoro: { winner: number; chances?: Array<{ winner?: number }>; currentIdx?: number } | null;
  pendingFeverContinue: { winner: number; isRon: boolean } | null;
  pendingPingju: boolean;
  roundEnded: boolean;
};

export function getWinPipelineState(s: WinPipelineLike): WinPipelineState {
  if (s.pendingQianggang) return { stage: 'qianggang', owner: s.pendingQianggang.player };
  if (s.awaitingRonDecision) return { stage: 'ron-decision', owner: null };
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
      s.pendingFeverContinue = { winner: opts.winner, isRon: opts.isRon };
    }
    s.roundEnded = false;
    return;
  }
  s.roundEnded = true;
}
