import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import {
  advanceSaiKoroStage,
  appendSaiKoroChances,
  blockingWinPipelineReason,
  enterFulouStage,
  enterRonDecisionStage,
  getWinPipelineState,
  settleAfterWin,
} from '../store/winPipeline';

function baseState() {
  return {
    game: new Game3(),
    awaitingRonDecision: false,
    awaitingFulou: false,
    ronPassedPlayers: [],
    ronDeclaredPlayers: [],
    ronResults: [],
    ponCandidates: [],
    kanCandidates: [],
    pendingQianggang: null,
    pendingFuyu: null,
    pendingKinpei: null,
    pendingKamiPochi: null,
    pendingPochiSwap: null,
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
    s.game.feverDeclareTing[0] = ['p1'];
    (s.game.shan as any)._pai = ['p1'];
    s.pendingKinpei = { winner: 0 };

    settleAfterWin(s, { winner: 0, isRon: true });
    expect(s.roundEnded).toBe(false);
    expect(s.pendingFeverContinue).toBeNull();
    expect(s.game.feverWinCount[0]).toBe(0);

    s.pendingKinpei = null;
    settleAfterWin(s, { winner: 0, isRon: true });
    expect(s.roundEnded).toBe(false);
    expect(s.pendingFeverContinue).toEqual({ winner: 0, isRon: true, ronfrom: null });
    expect(s.game.feverWinCount[0]).toBe(1);

    settleAfterWin(s, { winner: 0, isRon: true });
    expect(s.game.feverWinCount[0]).toBe(1);
  });

  it('moves reaction windows through explicit stages', () => {
    const s: any = baseState();
    enterRonDecisionStage(s, {
      ponCandidates: [{ player: 1, mianzi: ['z555+'] }],
      kanCandidates: [],
    });
    expect(getWinPipelineState(s)).toEqual({ stage: 'ron-decision', owner: null });
    expect(s.ronPassedPlayers).toEqual([]);
    expect(s.ponCandidates).toHaveLength(1);

    enterFulouStage(s, { ponCandidates: s.ponCandidates, kanCandidates: [] });
    expect(getWinPipelineState(s)).toEqual({ stage: 'fulou', owner: null });
    expect(s.awaitingRonDecision).toBe(false);
    expect(s.awaitingFulou).toBe(true);
  });

  it('keeps a post-win tile choice ahead of an unfinished double-ron window', () => {
    const s: any = baseState();
    enterRonDecisionStage(s);
    s.pendingKamiPochi = {
      winner: 1,
      context: 'dora',
      occurrenceKey: 'baopai:0',
      candidates: ['p1'],
      decisionOwners: [2],
      decisionOwnerIndex: 0,
      isRon: true,
      ronfrom: 0,
    };
    expect(getWinPipelineState(s)).toEqual({ stage: 'kami-pochi', owner: 2 });
  });

  it('queues and advances saikoro chances without carrying roll state', () => {
    const s: any = baseState();
    appendSaiKoroChances(s, 0, [
      { name: 'one', baseChip: 1, shuvariApplicable: false, count: 1, plusMinus: '+', winner: 0 },
      { name: 'two', baseChip: 2, shuvariApplicable: false, count: 1, plusMinus: '+', winner: 1 },
    ]);
    s.pendingSaiKoro.selectedCombo = [1, 2];
    s.pendingSaiKoro.rolls.push({ dice: [1, 2], hit: true, zoro: false });
    s.pendingSaiKoro.finalized = true;

    advanceSaiKoroStage(s);
    expect(s.pendingSaiKoro.currentIdx).toBe(1);
    expect(s.pendingSaiKoro.selectedCombo).toBeNull();
    expect(s.pendingSaiKoro.rolls).toEqual([]);
    expect(getWinPipelineState(s)).toEqual({ stage: 'saikoro', owner: 1 });

    s.pendingSaiKoro.finalized = true;
    advanceSaiKoroStage(s);
    expect(s.pendingSaiKoro).toBeNull();
  });
});
