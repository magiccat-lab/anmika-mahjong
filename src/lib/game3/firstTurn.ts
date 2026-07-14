import type { PlayerId } from '../types';

export type FirstTurnPlayerState = {
  drawCount: number;
  hasDiscarded: boolean;
};

export type FirstTurnState = {
  players: Record<PlayerId, FirstTurnPlayerState>;
  callOccurred: boolean;
};

export function createFirstTurnState(): FirstTurnState {
  return {
    players: {
      0: { drawCount: 0, hasDiscarded: false },
      1: { drawCount: 0, hasDiscarded: false },
      2: { drawCount: 0, hasDiscarded: false },
    },
    callOccurred: false,
  };
}

export function normalizeFirstTurnState(value: any): FirstTurnState {
  const state = createFirstTurnState();
  state.callOccurred = !!value?.callOccurred;
  for (const player of [0, 1, 2] as PlayerId[]) {
    state.players[player] = {
      drawCount: Math.max(0, Number(value?.players?.[player]?.drawCount ?? 0)),
      hasDiscarded: !!value?.players?.[player]?.hasDiscarded,
    };
  }
  return state;
}

export function markFirstTurnDraw(state: FirstTurnState, player: PlayerId): void {
  state.players[player].drawCount += 1;
}

export function markFirstTurnDiscard(state: FirstTurnState, player: PlayerId): void {
  state.players[player].hasDiscarded = true;
}

export function markFirstTurnCall(state: FirstTurnState): void {
  state.callOccurred = true;
}

export function isFirstTurnTsumoEligible(state: FirstTurnState, player: PlayerId): boolean {
  const own = state.players[player];
  return !state.callOccurred && !own.hasDiscarded && own.drawCount <= 1;
}

export function isRenhouEligible(state: FirstTurnState, player: PlayerId, oya: PlayerId): boolean {
  const own = state.players[player];
  return player !== oya
    && !state.callOccurred
    && !own.hasDiscarded
    && own.drawCount === 0;
}

export function hasAnyFirstTurnEligibility(state: FirstTurnState): boolean {
  if (state.callOccurred) return false;
  return ([0, 1, 2] as PlayerId[]).some((player) => {
    const own = state.players[player];
    return !own.hasDiscarded && own.drawCount <= 1;
  });
}
