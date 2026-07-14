import { describe, expect, it } from 'vitest';
import {
  createFirstTurnState,
  isFirstTurnTsumoEligible,
  isRenhouEligible,
  markFirstTurnCall,
  markFirstTurnDiscard,
  markFirstTurnDraw,
} from '../game3/firstTurn';

describe('per-player first-turn eligibility', () => {
  it('keeps an undrawn child eligible for renhou after the dealer discards', () => {
    const state = createFirstTurnState();
    markFirstTurnDraw(state, 0);
    markFirstTurnDiscard(state, 0);

    expect(isFirstTurnTsumoEligible(state, 0)).toBe(false);
    expect(isRenhouEligible(state, 2, 0)).toBe(true);
    expect(isRenhouEligible(state, 1, 0)).toBe(true);
  });

  it('expires only the child who has already drawn or discarded', () => {
    const state = createFirstTurnState();
    markFirstTurnDraw(state, 2);
    markFirstTurnDiscard(state, 2);

    expect(isRenhouEligible(state, 2, 0)).toBe(false);
    expect(isRenhouEligible(state, 1, 0)).toBe(true);
  });

  it('any call invalidates tenhou, chiihou and renhou for everyone', () => {
    const state = createFirstTurnState();
    markFirstTurnCall(state);

    for (const player of [0, 1, 2] as const) {
      expect(isFirstTurnTsumoEligible(state, player)).toBe(false);
      expect(isRenhouEligible(state, player, 0)).toBe(false);
    }
  });
});
