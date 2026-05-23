import { describe, it, expect } from 'vitest';
import {
  Game3,
  nextPochiMultiplier,
  type PochiMultiplier,
} from '../game3';
import { applyChipFromLoser, type ChipState } from '../game3/chip';

function chipState(pm: PochiMultiplier): ChipState {
  return {
    shuvariActive: { 0: false, 1: false, 2: false },
    feverActive: { 0: false, 1: false, 2: false },
    feverTier: { 0: 1, 1: 1, 2: 1 },
    pochiMultiplier: { 0: pm, 1: { defen: 1, chip: 1 }, 2: { defen: 1, chip: 1 } },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    chipBreakdown: [],
  };
}

describe('pochi multiplier spec 2026-05-21', () => {
  it('first tsumo sets the color tuple', () => {
    expect(nextPochiMultiplier({ defen: 1, chip: 1 }, 'green')).toEqual({ defen: 1, chip: 1 });
    expect(nextPochiMultiplier({ defen: 1, chip: 1 }, 'blue')).toEqual({ defen: 1, chip: 2 });
    expect(nextPochiMultiplier({ defen: 1, chip: 1 }, 'yellow')).toEqual({ defen: -1, chip: -1 });
    expect(nextPochiMultiplier({ defen: 1, chip: 1 }, 'red')).toEqual({ defen: -1, chip: -2 });
  });

  it('same direction keeps the higher absolute value', () => {
    expect(nextPochiMultiplier({ defen: 1, chip: 2 }, 'green')).toEqual({ defen: 1, chip: 2 });
    expect(nextPochiMultiplier({ defen: 1, chip: 1 }, 'blue')).toEqual({ defen: 1, chip: 2 });
    expect(nextPochiMultiplier({ defen: -1, chip: -2 }, 'yellow')).toEqual({ defen: -1, chip: -2 });
    expect(nextPochiMultiplier({ defen: -1, chip: -1 }, 'red')).toEqual({ defen: -1, chip: -2 });
  });

  it('negative to positive applies the positive reversal bonus', () => {
    expect(nextPochiMultiplier({ defen: -1, chip: -2 }, 'blue')).toEqual({ defen: 1, chip: 8 });
    expect(nextPochiMultiplier({ defen: -1, chip: -1 }, 'green')).toEqual({ defen: 1, chip: 2 });
    expect(nextPochiMultiplier({ defen: -1, chip: -1 }, 'blue')).toEqual({ defen: 1, chip: 4 });
  });

  it('positive to negative simply multiplies by the new color tuple', () => {
    expect(nextPochiMultiplier({ defen: 1, chip: 2 }, 'red')).toEqual({ defen: -1, chip: -4 });
    expect(nextPochiMultiplier({ defen: 1, chip: 1 }, 'yellow')).toEqual({ defen: -1, chip: -1 });
  });

  it('nextRound resets every player to neutral', () => {
    const g = new Game3();
    g.qipai();
    g.pochiMultiplier[0] = { defen: -1, chip: -4 };
    g.pochiMultiplier[1] = { defen: 1, chip: 8 };
    g.pochiPaymentMode[0] = true;
    g.pochiChipDouble[0] = true;

    g.nextRound();

    expect(g.pochiMultiplier).toEqual({
      0: { defen: 1, chip: 1 },
      1: { defen: 1, chip: 1 },
      2: { defen: 1, chip: 1 },
    });
    expect(g.pochiPaymentMode).toEqual({ 0: false, 1: false, 2: false });
    expect(g.pochiChipDouble).toEqual({ 0: false, 1: false, 2: false });
  });

  it('fever ron payments reuse the same kyoku multiplier until nextRound', () => {
    const st = chipState({ defen: 1, chip: 2 });
    st.feverActive[0] = true;
    st.feverTier[0] = 2;

    applyChipFromLoser(st, 0, 1, 1);
    applyChipFromLoser(st, 0, 2, 1);

    expect(st.chipLedger).toEqual({ 0: 8, 1: -4, 2: -4 });
    expect(st.chipBreakdown.map((b) => b.multiplier)).toEqual([4, 4]);
  });

  it('handles yellow to red to green and independent players', () => {
    const p0 = nextPochiMultiplier(nextPochiMultiplier(nextPochiMultiplier({ defen: 1, chip: 1 }, 'yellow'), 'red'), 'green');
    const p1 = nextPochiMultiplier({ defen: 1, chip: 1 }, 'blue');
    const p2 = nextPochiMultiplier({ defen: 1, chip: 1 }, 'red');

    expect(p0).toEqual({ defen: 1, chip: 4 });
    expect(p1).toEqual({ defen: 1, chip: 2 });
    expect(p2).toEqual({ defen: -1, chip: -2 });
  });
});
