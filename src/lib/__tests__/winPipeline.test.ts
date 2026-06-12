import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import { blockingWinPipelineReason, getWinPipelineState, settleAfterWin } from '../store/winPipeline';

function baseState() {
  return {
    game: new Game3(),
    awaitingRonDecision: false,
    pendingQianggang: null,
    pendingFuyu: null,
    pendingKinpei: null,
    pendingSaiKoro: null,
    pendingFeverContinue: null,
    pendingPingju: false,
    roundEnded: false,
  };
}

describe('winPipeline state machine helper', () => {
  it('derives the blocking winner pipeline stage in priority order', () => {
    const s: any = baseState();
    s.pendingKinpei = { winner: 1 };
    expect(getWinPipelineState(s)).toEqual({ stage: 'kinpei', owner: 1 });
    expect(blockingWinPipelineReason(s)).toBe('kinpei');

    s.pendingSaiKoro = { winner: 0, chances: [{ name: 'x', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+', winner: 2 }], currentIdx: 0 };
    expect(getWinPipelineState(s)).toEqual({ stage: 'kinpei', owner: 1 });

    s.pendingKinpei = null;
    expect(getWinPipelineState(s)).toEqual({ stage: 'saikoro', owner: 2 });
  });

  it('defers fever settlement while kinpei is pending and applies it once', () => {
    const s: any = baseState();
    s.game.feverActive[0] = true;
    s.pendingKinpei = { winner: 0 };

    settleAfterWin(s, { winner: 0, isRon: true });
    expect(s.roundEnded).toBe(false);
    expect(s.pendingFeverContinue).toBeNull();
    expect(s.game.feverWinCount[0]).toBe(0);

    s.pendingKinpei = null;
    settleAfterWin(s, { winner: 0, isRon: true });
    expect(s.roundEnded).toBe(false);
    expect(s.pendingFeverContinue).toEqual({ winner: 0, isRon: true });
    expect(s.game.feverWinCount[0]).toBe(1);

    settleAfterWin(s, { winner: 0, isRon: true });
    expect(s.game.feverWinCount[0]).toBe(1);
  });
});
